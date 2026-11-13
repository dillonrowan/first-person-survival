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
import { Model } from "./rs/model/Model";
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

/**
 * Where the weapon's business end points (CacheWeaponInfo.blade). The cache places every worn model
 * in the hand of the base pose but does not say which end strikes, so read it from the shape: along
 * the line from the grip to the farthest vertex, a weapon held near one end (sword, dagger, axe)
 * strikes with the long end. One held mid-shaft (staff, spear, halberd, bow) is authored like a
 * sword blade, head pointing forward and up from the hand, so it strikes with the end facing that
 * way, and its axis runs butt to head rather than from the hand. Thrown weapons are the exception:
 * darts are pinched mid-shaft with the point aimed back, so a `headForward` of false keeps the
 * long end.
 */
function weaponBlade(model: Model, headForward: boolean): [number, number, number] {
    const offsets: [number, number, number][] = [];
    for (let v = 0; v < model.verticesCount; v++) {
        offsets.push([model.verticesX[v] - GRIP[0], model.verticesY[v] - GRIP[1], model.verticesZ[v] - GRIP[2]]);
    }
    const length = (o: readonly number[]) => Math.hypot(o[0], o[1], o[2]);
    const far = offsets.reduce((a, b) => (length(b) > length(a) ? b : a), [0, 0, 0]);
    const axis = far.map((c) => c / (length(far) || 1));
    const along = (o: readonly number[]) => o[0] * axis[0] + o[1] * axis[1] + o[2] * axis[2];

    const reach = Math.max(...offsets.map(along));
    const backReach = -Math.min(...offsets.map(along));
    const midShaft = backReach > reach * HELD_MID_SHAFT;
    const sign = headForward && midShaft && along(FORWARD_UP) < 0 ? -1 : 1;
    const end = (s: number) => offsets.reduce((a, b) => (s * along(b) > s * along(a) ? b : a), [0, 0, 0]);
    const head = end(sign);
    const butt = midShaft ? end(-sign) : [0, 0, 0];
    return [head[0] - butt[0], head[1] - butt[1], head[2] - butt[2]];
}

/** A weapon whose short end reaches this fraction of its long end is held mid-shaft. */
const HELD_MID_SHAFT = 0.6;
/** Forward and up from the base pose's hand, RS axes (y down, z south): where heads point. */
const FORWARD_UP = [0, -1, -2];
/** Obj category of darts, knives and thrownaxes. */
const THROWN_CATEGORY = 24;

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

    const blade = weaponBlade(model, obj.category !== THROWN_CATEGORY);
    const file = `${MODEL_DIR}/${id}.bin`;
    files.set(file, gzipSync(encodeNpcModel({
        vertexCount: model.verticesCount,
        bounds: computeBounds(model, []),
        ...meshes,
    }), { level: 6 }));
    weapons.push({ id: `cache-${id}`, cacheId: id, name: obj.name, family: cacheWeaponFamily(obj.name), file, grip: GRIP, blade });
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
