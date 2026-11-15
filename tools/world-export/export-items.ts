// Exports every item with an inventory model from the cache (public/world/items.json and items/).
//
//   npm run export-items
//
// Each item's inventory model is recolored, retextured, scaled and lit exactly as the client draws
// its inventory icon, and written in the NPC model format so the game draws it with the world
// shader and texture atlas (on the ground, and rendered once into a 36x32 icon). Items that look
// the same share a file. Run export-world first: the atlas comes from it. Wiki food heals come
// from data/wiki-food.json (npm run fetch-wiki-items).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { gzipSync } from "fflate";

import { ItemInfo, ItemManifest } from "../../src/world/ItemFormat";
import { encodeNpcModel } from "../../src/world/NpcFormat";
import { readCacheFiles } from "./cache-files";
import { FaceColors } from "./FaceColors";
import { itemInfoFor } from "./ItemExport";
import { buildModelMeshes, computeBounds } from "./NpcModelBuilder";
import { ModelData } from "./rs/model/ModelData";
import { createWorldLoaders } from "./WorldLoaders";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUT_DIR = path.join(ROOT, "public", "world");
const MODEL_DIR = "items";
/** Depth priority bias, as for NPCs. */
const PRIORITY_ITEM = 1;

const foodFile = path.join(HERE, "data", "wiki-food.json");
const food: Record<string, number> = fs.existsSync(foodFile) ? JSON.parse(fs.readFileSync(foodFile, "utf8")) : {};

const cache = readCacheFiles(path.join(ROOT, "cache"));
const loaders = createWorldLoaders(cache);
const faceColors = new FaceColors(loaders.textureLoader);

const items: ItemInfo[] = [];
const fileByLook = new Map<string, string>();
const files = new Map<string, Uint8Array>();
let skipped = 0;

for (let id = 0; id < loaders.objTypeLoader.getCount(); id++) {
    const obj = loaders.objTypeLoader.load(id);
    if (obj.isTemplated || obj.name === "null" || obj.inventoryModel === -1) continue;

    const key = JSON.stringify([
        obj.inventoryModel,
        obj.recolorFrom,
        obj.recolorTo,
        obj.retextureFrom,
        obj.retextureTo,
        obj.resizeX,
        obj.resizeY,
        obj.resizeZ,
        obj.ambient,
        obj.contrast,
    ]);
    let file = fileByLook.get(key);
    if (!file) {
        const base = loaders.modelLoader.getModel(obj.inventoryModel);
        if (!base) {
            skipped++;
            continue;
        }
        const data = ModelData.merge([base], 1);
        obj.recolorFrom?.forEach((from, i) => data.recolor(from, obj.recolorTo![i]));
        obj.retextureFrom?.forEach((from, i) => data.retexture(from, obj.retextureTo![i]));
        if (obj.resizeX !== 128 || obj.resizeY !== 128 || obj.resizeZ !== 128) {
            data.resize(obj.resizeX, obj.resizeY, obj.resizeZ);
        }
        // The client lights an inventory model with these values.
        const model = data.light(loaders.textureLoader, obj.ambient + 64, obj.contrast + 768, -50, -10, -50);
        const meshes =
            model.verticesCount <= 0xffff
                ? buildModelMeshes(model, faceColors, loaders.textureLoader, PRIORITY_ITEM)
                : undefined;
        if (!meshes) {
            skipped++;
            continue;
        }
        file = `${MODEL_DIR}/${id}.bin`;
        fileByLook.set(key, file);
        files.set(
            file,
            gzipSync(encodeNpcModel({ vertexCount: model.verticesCount, bounds: computeBounds(model, []), ...meshes }), {
                level: 6,
            }),
        );
    }
    items.push(itemInfoFor(obj, food, file));
}
items.sort((a, b) => a.id - b.id);

// Replace the previous export entirely so removed items leave no stale files.
fs.rmSync(path.join(OUT_DIR, MODEL_DIR), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT_DIR, MODEL_DIR), { recursive: true });
for (const [file, bytes] of files) {
    fs.writeFileSync(path.join(OUT_DIR, file), bytes);
}
const manifest: ItemManifest = { format: 1, source: "osrs-242", items };
fs.writeFileSync(path.join(OUT_DIR, "items.json"), JSON.stringify(manifest) + "\n");
console.log(`Exported ${items.length} items in ${files.size} model files (${skipped} skipped).`);
