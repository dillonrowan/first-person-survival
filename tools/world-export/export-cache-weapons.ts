// Exports every wieldable weapon-slot item from the cache for the weapon menu (public/world/).
//
//   npm run export-cache-weapons
//
// Each item's worn model (what a player holds) is recolored, retextured and lit exactly as the
// client draws it on a player, and written in the NPC model format so the game draws it with the
// world shader and texture atlas. Run export-world first: the atlas comes from it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { gzipSync } from "fflate";

import { CacheWeaponInfo, cacheWeaponFamily } from "../../src/world/CacheWeaponFormat";
import { encodeNpcModel } from "../../src/world/NpcFormat";
import { readCacheFiles } from "./cache-files";
import { FaceColors } from "./FaceColors";
import { buildModelMeshes, computeBounds } from "./NpcModelBuilder";
import { ObjType } from "./rs/config/objtype/ObjType";
import { ModelData } from "./rs/model/ModelData";
import { createWorldLoaders } from "./WorldLoaders";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "public", "world");
const MODEL_DIR = "cache-weapons";
const WEAPON_SLOT = 3;
/** Depth priority bias, as for NPCs. */
const PRIORITY_WEAPON = 1;

/**
 * The right hand of the player's base pose, RS units: every worn weapon model is authored around
 * it. Measured in Blender as the point closest to all of a sample of worn models (daggers, swords,
 * maul, staff, bows); each model passes within 3 units of it.
 */
const GRIP: [number, number, number] = [-32, -95, -4];

/** The models the client merges into a player for this item. */
function wornModel(obj: ObjType, loaders: ReturnType<typeof createWorldLoaders>): ModelData | undefined {
    const parts: ModelData[] = [];
    for (const id of [obj.maleModel0, obj.maleModel1, obj.maleModel2]) {
        const model = id !== -1 ? loaders.modelLoader.getModel(id) : undefined;
        if (model) parts.push(model);
    }
    if (parts.length === 0) return undefined;
    const model = ModelData.merge(parts, parts.length);
    if (obj.maleOffset !== 0) model.translate(0, obj.maleOffset, 0);
    obj.recolorFrom?.forEach((from, i) => model.recolor(from, obj.recolorTo![i]));
    obj.retextureFrom?.forEach((from, i) => model.retexture(from, obj.retextureTo![i]));
    return model;
}

const cache = readCacheFiles(path.join(ROOT, "cache"));
const loaders = createWorldLoaders(cache);
const faceColors = new FaceColors(loaders.textureLoader);

const weapons: CacheWeaponInfo[] = [];
const seen = new Set<string>();
const files = new Map<string, Uint8Array>();
for (let id = 0; id < loaders.objTypeLoader.getCount(); id++) {
    const obj = loaders.objTypeLoader.load(id);
    if (obj.isTemplated || obj.wearPos1 !== WEAPON_SLOT || obj.name === "null" ||
        !obj.inventoryOptions.includes("Wield")) {
        continue;
    }
    // Charged, poisoned and other copies that look the same are listed once.
    const key = JSON.stringify([obj.name, obj.maleModel0, obj.maleModel1, obj.maleModel2, obj.maleOffset,
        obj.recolorFrom, obj.recolorTo, obj.retextureFrom, obj.retextureTo]);
    if (seen.has(key)) continue;
    seen.add(key);

    const data = wornModel(obj, loaders);
    if (!data) continue;
    // The client lights a player's merged model with these values (Player.getModel).
    const model = data.light(loaders.textureLoader, 64, 850, -30, -50, -30);
    const meshes = model.verticesCount <= 0xffff
        ? buildModelMeshes(model, faceColors, loaders.textureLoader, PRIORITY_WEAPON)
        : undefined;
    if (!meshes) continue;

    let tip: [number, number, number] = GRIP;
    let far = -1;
    for (let v = 0; v < model.verticesCount; v++) {
        const x = model.verticesX[v];
        const y = model.verticesY[v];
        const z = model.verticesZ[v];
        const d = (x - GRIP[0]) ** 2 + (y - GRIP[1]) ** 2 + (z - GRIP[2]) ** 2;
        if (d > far) {
            far = d;
            tip = [x, y, z];
        }
    }

    const file = `${MODEL_DIR}/${id}.bin`;
    files.set(file, gzipSync(encodeNpcModel({
        vertexCount: model.verticesCount,
        bounds: computeBounds(model, []),
        ...meshes,
    }), { level: 6 }));
    weapons.push({ id: `cache-${id}`, cacheId: id, name: obj.name, family: cacheWeaponFamily(obj.name), file, grip: GRIP, tip });
}
weapons.sort((a, b) => a.name.localeCompare(b.name) || a.cacheId - b.cacheId);

// Replace the previous export entirely so removed items leave no stale files.
fs.rmSync(path.join(OUT_DIR, MODEL_DIR), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT_DIR, MODEL_DIR), { recursive: true });
for (const [file, bytes] of files) {
    fs.writeFileSync(path.join(OUT_DIR, file), bytes);
}
fs.writeFileSync(path.join(OUT_DIR, "cache-weapons.json"), JSON.stringify(weapons, null, 2) + "\n");

const byFamily = new Map<string, number>();
for (const w of weapons) byFamily.set(w.family, (byFamily.get(w.family) ?? 0) + 1);
console.log(`Exported ${weapons.length} cache weapons (${[...byFamily].map(([f, n]) => `${f} ${n}`).join(", ")}).`);
