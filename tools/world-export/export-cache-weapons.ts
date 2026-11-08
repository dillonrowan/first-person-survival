import fs from "node:fs";
import path from "node:path";
import { CacheSystem } from "./rs/cache/CacheSystem";
import { MemoryStore } from "./rs/cache/store/MemoryStore";
import { IndexModelLoader } from "./rs/model/ModelLoader";

const readCacheFile = (file: string) => {
    const bytes = fs.readFileSync(file);
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return copy;
};

const root = process.cwd();
const cacheDir = path.join(root, "cache");
const indexFiles: (ArrayBuffer | undefined)[] = [];
for (let id = 0; id < 255; id++) {
    const file = path.join(cacheDir, `main_file_cache.idx${id}`);
    if (fs.existsSync(file)) {
        indexFiles[id] = readCacheFile(file);
    }
}

const cache = CacheSystem.fromStore(
    new MemoryStore(
        readCacheFile(path.join(cacheDir, "main_file_cache.dat2")),
        indexFiles,
        readCacheFile(path.join(cacheDir, "main_file_cache.idx255")),
    ),
);
const items = cache.getIndex(2).getArchive(10);
const modelLoader = new IndexModelLoader(cache.getIndex(7));
const weapons = new Map<number, { id: string; cacheId: number; name: string; family: string; model: number }>();
const unwanted = /(handle|arrowtips?|bolt tips?|unstrung|training|seedling|kit|piece|half of|broken|blighted|crystal tool seed)/i;
const familyFor = (name: string) => {
    if (/dagger/i.test(name)) return "daggers";
    if (/staff/i.test(name)) return "staff";
    return "sword";
};

for (let itemId = 0; itemId < items.fileCount; itemId++) {
    const file = items.getFile(itemId);
    if (!file) continue;
    const bytes = file.data;
    let name: string | undefined;
    let model = -1;

    for (let i = 0; i < bytes.length - 2 && name === undefined; i++) {
        if ((bytes[i] & 0xff) !== 2) continue;
        let candidate = "";
        for (let p = i + 1; p < Math.min(bytes.length, i + 100); p++) {
            const c = bytes[p] & 0xff;
            if (c === 0) break;
            if (c < 32 || c > 126) {
                candidate = "";
                break;
            }
            candidate += String.fromCharCode(c);
        }
        if (candidate && /\b(sword|dagger|scimitar|mace|maul|club|staff|bow|halberd|spear|axe|wand|whip|crossbow|claws|sickle|flail|glaive|rapier|hasta|sceptre|scepter|anchor)\b/i.test(candidate)) {
            name = candidate;
        }
    }
    if (!name || unwanted.test(name)) continue;

    for (let i = 0; i < bytes.length - 3; i++) {
        if ((bytes[i] & 0xff) !== 1) continue;
        const candidate = ((bytes[i + 1] & 0xff) << 8) | (bytes[i + 2] & 0xff);
        if (candidate > 0 && candidate < 200_000) {
            model = candidate;
            break;
        }
    }
    if (model < 0) continue;
    const family = familyFor(name);
    weapons.set(itemId, { id: `cache-${itemId}`, cacheId: itemId, name, family, model });
}

const output = [...weapons.values()].sort((a, b) => a.name.localeCompare(b.name));
fs.mkdirSync(path.join(root, "public", "world"), { recursive: true });
fs.writeFileSync(path.join(root, "public", "world", "cache-weapons.json"), JSON.stringify(output, null, 2));
const geometryDir = path.join(root, "public", "world", "cache-weapons");
fs.mkdirSync(geometryDir, { recursive: true });
for (const weapon of output) {
    const model = modelLoader.getModel(weapon.model);
    if (!model) continue;
    const positions = new Array<number>();
    const indices = new Array<number>();
    for (let vertex = 0; vertex < model.verticesCount; vertex++) {
        positions.push(model.verticesX[vertex], -model.verticesY[vertex], -model.verticesZ[vertex]);
    }
    for (let face = 0; face < model.faceCount; face++) {
        indices.push(model.indices1[face], model.indices2[face], model.indices3[face]);
    }
    fs.writeFileSync(
        path.join(geometryDir, `${weapon.cacheId}.json`),
        JSON.stringify({ positions, indices }),
    );
}
console.log(`Exported ${output.length} cache weapons.`);
