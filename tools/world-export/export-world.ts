// One-time conversion of the OSRS cache (cache/) into the game's world map (public/world/).
//
//   npm run export-world                         Gielinor's surface (map squares with y < 66)
//   npm run export-world -- --area all           also dungeons, minigames and instances
//   npm run export-world -- --area 44,48,54,56   map squares x 44..54, y 48..56 (inclusive)
//   npm run export-world -- --workers 4
//   npm run export-world -- --no-npcs            skip the NPC models and spawns
//   npm run export-world -- --npcs-only          re-bake only the NPCs of the exported map
//
// The cache decoders live in rs/; RegionBuilder turns each decoded map square into the meshes
// and collision data the game loads.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { NpcManifest } from "../../src/world/NpcFormat";
import { PREFERRED_ITEM_IDS } from "../../src/world/ItemFormat";
import { attackRulesFor } from "./NpcAttackRules";
import { combatStatsFor } from "./NpcCombatStats";
import { dropsFor } from "./NpcDrops";
import { groundItemSpawns } from "./GroundItemExport";
import type { WikiDrop, WikiItemSpawn } from "./fetch-wiki-items";
import type { WikiAttackRow } from "./fetch-wiki-attacks";
import {
    REGION_SIZE,
    TEXTURE_SIZE,
    TextureLayer,
    WORLD_FORMAT_VERSION,
    WorldManifest,
} from "../../src/world/WorldFormat";
import { readCacheFiles } from "./cache-files";
import { ExportResult, ExportTask, ExportWorkerData } from "./export-worker";
import { encodePng } from "./png";
import { BRIGHTNESS } from "./FaceColors";
import { AttackIndex, buildAttackIndex, readAnimationNames } from "./NpcAttackAnims";
import { NpcAppearanceTask, finalizeNpcManifest, readNpcSpawnFile, selectNpcs } from "./NpcSpawns";
import { TextureLoader } from "./rs/texture/TextureLoader";
import { createWorldLoaders } from "./WorldLoaders";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CACHE_DIR = path.join(ROOT, "cache");
const OUT_DIR = path.join(ROOT, "public", "world");
const REGION_DIR = path.join(OUT_DIR, "regions");
const NPC_DIR = path.join(OUT_DIR, "npcs");
const NPC_SPAWN_FILE = path.join(ROOT, "tools", "world-export", "data", "npc-spawns-osrs.json");
/** Attack styles of every NPC from the OSRS wiki (npm run fetch-wiki-attacks). */
const NPC_ATTACKS_WIKI_FILE = path.join(ROOT, "tools", "world-export", "data", "npc-attacks-wiki.json");
const WIKI_DROPS_FILE = path.join(ROOT, "tools", "world-export", "data", "wiki-drops.json");
const WIKI_ITEM_SPAWNS_FILE = path.join(ROOT, "tools", "world-export", "data", "wiki-item-spawns.json");
const GROUND_ITEMS_FILE = "ground-items.json";

/** Lowercase item name to the lowest id of a named, non-template item with an inventory model. */
function itemIdsByName(loaders: ReturnType<typeof createWorldLoaders>): (name: string) => number | undefined {
    const byName = new Map<string, number>();
    for (let id = 0; id < loaders.objTypeLoader.getCount(); id++) {
        const obj = loaders.objTypeLoader.load(id);
        if (obj.isTemplated || obj.name === "null" || obj.inventoryModel === -1) continue;
        const key = obj.name.toLowerCase();
        if (!byName.has(key)) byName.set(key, id);
    }
    return (name) => {
        const key = name.toLowerCase();
        const preferred = PREFERRED_ITEM_IDS[key];
        return preferred !== undefined && byName.has(key) ? preferred : byName.get(key);
    };
}

function readJsonIfPresent<T>(file: string, fallback: T): T {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) as T;
    console.warn(`${path.relative(ROOT, file)} not found: run npm run fetch-wiki-items`);
    return fallback;
}

/** Writes ground-items.json from the wiki spawn lines; undefined when there is no item data. */
function exportGroundItems(
    loaders: ReturnType<typeof createWorldLoaders>,
    exportedRegions: [number, number][],
): NonNullable<WorldManifest["groundItems"]> | undefined {
    if (!fs.existsSync(WIKI_ITEM_SPAWNS_FILE)) {
        console.warn("No wiki item spawns: world exported without ground items (npm run fetch-wiki-items)");
        return undefined;
    }
    const lines = JSON.parse(fs.readFileSync(WIKI_ITEM_SPAWNS_FILE, "utf8")) as WikiItemSpawn[];
    const monsters = new Set(
        Object.values(JSON.parse(fs.readFileSync(NPC_ATTACKS_WIKI_FILE, "utf8")) as Record<string, WikiAttackRow>).map((r) => r.page),
    );
    const keys = new Set(exportedRegions.map(([x, y]) => (x << 8) | y));
    const spawns = groundItemSpawns(lines, itemIdsByName(loaders), monsters, (mapX, mapY) => keys.has((mapX << 8) | mapY));
    fs.writeFileSync(path.join(OUT_DIR, GROUND_ITEMS_FILE), JSON.stringify({ format: 1, spawns }));
    console.log(`Ground items: ${spawns.length} spawns`);
    return { file: GROUND_ITEMS_FILE, spawns: spawns.length };
}
const ANIMATION_NAMES_FILE = path.join(ROOT, "tools", "world-export", "data", "animation-names-runelite.json");
const NPC_MANIFEST_FILE = "npcs.json";

// Lumbridge, where new OSRS characters start.
const DEFAULT_SPAWN = { x: 3222, y: 3218, plane: 0 };

// Textures scroll `anim` texels per 20 ms client cycle on a 128-texel texture:
// `time / 0.02 * anim / 128` (time in seconds).
const TEXTURE_ANIM_PER_SECOND = 50 / 128;
const ATLAS_COLUMNS = 16;

type Area = { x1: number; y1: number; x2: number; y2: number };

const AREAS: Record<string, Area> = {
    // Everything north of y 65 is dungeons, minigames and instances, not connected to the surface.
    surface: { x1: 0, y1: 0, x2: 255, y2: 65 },
    all: { x1: 0, y1: 0, x2: 255, y2: 255 },
};

// A worker peaks at roughly 300 MB while building dense regions; keep headroom on top of that.
const WORKER_MEMORY_BYTES = 600 * 1024 * 1024;

function defaultWorkerCount(): number {
    const byCores = os.cpus().length - 2;
    const byMemory = Math.floor(os.freemem() / WORKER_MEMORY_BYTES);
    return Math.max(1, Math.min(6, byCores, byMemory));
}

function parseArgs(argv: string[]): { area: Area; workers: number; npcs: boolean; npcsOnly: boolean } {
    let area = AREAS.surface;
    let npcs = true;
    let npcsOnly = false;
    let workers = defaultWorkerCount();
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = argv[i + 1];
        if (arg === "--area" && value) {
            i++;
            if (AREAS[value]) {
                area = AREAS[value];
            } else {
                const [x1, y1, x2, y2] = value.split(",").map(Number);
                if ([x1, y1, x2, y2].some((n) => !Number.isInteger(n))) {
                    throw new Error(`--area expects surface, all or x1,y1,x2,y2, got "${value}"`);
                }
                area = {
                    x1: Math.min(x1, x2),
                    y1: Math.min(y1, y2),
                    x2: Math.max(x1, x2),
                    y2: Math.max(y1, y2),
                };
            }
        } else if (arg === "--no-npcs") {
            npcs = false;
        } else if (arg === "--npcs-only") {
            npcsOnly = true;
        } else if (arg === "--workers" && value) {
            i++;
            workers = Math.max(1, Number(value) | 0);
        } else {
            throw new Error(`Unknown argument "${arg}"`);
        }
    }
    return { area, workers, npcs, npcsOnly };
}

function exportTextures(textureLoader: TextureLoader): WorldManifest["textures"] {
    const ids = textureLoader.getTextureIds();
    const layerCount = ids.length + 1;
    if (layerCount > 256) {
        // The vertex format stores the layer in 8 bits.
        throw new Error(`Too many textures for the world format: ${ids.length}`);
    }

    const rows = Math.ceil(layerCount / ATLAS_COLUMNS);
    const width = ATLAS_COLUMNS * TEXTURE_SIZE;
    const height = rows * TEXTURE_SIZE;
    const atlas = new Uint8Array(width * height * 4);

    const white = new Int32Array(TEXTURE_SIZE * TEXTURE_SIZE).fill(-1);
    const writeLayer = (layer: number, argb: Int32Array) => {
        const cellX = (layer % ATLAS_COLUMNS) * TEXTURE_SIZE;
        const cellY = Math.floor(layer / ATLAS_COLUMNS) * TEXTURE_SIZE;
        for (let y = 0; y < TEXTURE_SIZE; y++) {
            for (let x = 0; x < TEXTURE_SIZE; x++) {
                const pixel = argb[y * TEXTURE_SIZE + x];
                const i = ((cellY + y) * width + cellX + x) * 4;
                atlas[i] = (pixel >> 16) & 0xff;
                atlas[i + 1] = (pixel >> 8) & 0xff;
                atlas[i + 2] = pixel & 0xff;
                atlas[i + 3] = (pixel >>> 24) & 0xff;
            }
        }
    };

    const layers: TextureLayer[] = [{ id: -1, animU: 0, animV: 0, alphaCutOff: 0 }];
    writeLayer(0, white);
    ids.forEach((id, i) => {
        let pixels: Int32Array = white;
        try {
            pixels = textureLoader.getPixelsArgb(id, TEXTURE_SIZE, true, BRIGHTNESS);
        } catch (e) {
            console.warn(`Texture ${id} failed to load, using white`, e);
        }
        writeLayer(i + 1, pixels);

        const material = textureLoader.getMaterial(id);
        layers.push({
            id,
            animU: material.animU * TEXTURE_ANIM_PER_SECOND,
            animV: material.animV * TEXTURE_ANIM_PER_SECOND,
            alphaCutOff: material.alphaCutOff,
        });
    });

    const file = "textures.png";
    fs.writeFileSync(path.join(OUT_DIR, file), encodePng(width, height, atlas));
    return { file, tileSize: TEXTURE_SIZE, columns: ATLAS_COLUMNS, layers };
}

function formatDuration(ms: number): string {
    const s = Math.round(ms / 1000);
    return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function createWorkerData(cache: ReturnType<typeof readCacheFiles>, attackIndex?: AttackIndex): ExportWorkerData {
    return {
        info: cache.info,
        dat2: cache.dat2 as SharedArrayBuffer,
        indexFiles: [...cache.indexFiles],
        xteas: [...cache.xteas],
        regionDir: REGION_DIR,
        npcDir: NPC_DIR,
        attackIndex,
    };
}

/** Every named sequence by its frame base, to find each NPC's attacks among its skeleton's. */
function createAttackIndex(loaders: ReturnType<typeof createWorldLoaders>): AttackIndex {
    const names = readAnimationNames(ANIMATION_NAMES_FILE);
    const index = buildAttackIndex(names, (id) => loaders.npcModelLoader.getFrameBase(id)?.id);
    loaders.seqFrameLoader.clearCache();
    return index;
}

/** Runs tasks on a pool of export workers; `onResult` sees every result except "ready". */
async function runWorkerPool(
    workerData: ExportWorkerData,
    tasks: ExportTask[],
    workerCount: number,
    onResult: (result: ExportResult) => void,
): Promise<void> {
    const queue = [...tasks];
    const runWorker = (taskLimit: number) =>
        new Promise<void>((resolve, reject) => {
            const worker = new Worker(new URL("./export-worker.ts", import.meta.url), {
                workerData,
                resourceLimits: {
                    maxOldGenerationSizeMb: 8192,
                    maxYoungGenerationSizeMb: 2048,
                },
            });
            let assigned = 0;
            const next = () => {
                const task = queue.shift();
                if (task) {
                    assigned++;
                    worker.postMessage(task);
                } else if (assigned >= taskLimit || queue.length === 0) {
                    worker.terminate().then(() => resolve(), reject);
                }
            };
            worker.on("message", (result: ExportResult) => {
                if (result.type !== "ready") {
                    onResult(result);
                }
                if (assigned >= taskLimit || queue.length === 0) {
                    worker.terminate().then(() => resolve(), reject);
                } else {
                    next();
                }
            });
            worker.on("error", reject);
        });

    while (queue.length > 0) {
        await Promise.all(
            Array.from(
                { length: Math.min(workerCount, queue.length) },
                () => runWorker(10),
            ),
        );
    }
}

function createProgressLogger(total: number, label: string) {
    const start = Date.now();
    let lastLog = 0;
    return (done: number, bytes: number, force = false) => {
        const now = Date.now();
        if (!force && now - lastLog < 3000) {
            return;
        }
        lastLog = now;
        const elapsed = now - start;
        const eta = done > 0 ? (elapsed / done) * (total - done) : 0;
        console.log(
            `  ${done}/${total} ${label}, ${(bytes / 1048576).toFixed(0)} MiB, ` +
                `${formatDuration(elapsed)} elapsed, ~${formatDuration(eta)} left`,
        );
    };
}

async function exportRegions(
    cache: ReturnType<typeof readCacheFiles>,
    regions: [number, number][],
    workerCount: number,
): Promise<[number, number][]> {
    const exported: [number, number][] = [];
    const failed: string[] = [];
    let done = 0;
    let bytes = 0;
    const logProgress = createProgressLogger(regions.length, "regions");

    const tasks: ExportTask[] = regions.map(([mapX, mapY]) => ({ kind: "region", mapX, mapY }));
    await runWorkerPool(createWorkerData(cache), tasks, workerCount, (result) => {
        done++;
        if (result.type === "region") {
            exported.push([result.mapX, result.mapY]);
            bytes += result.bytes;
        } else if (result.type === "error") {
            failed.push(result.label);
            console.error(`${result.label} failed:`, result.message);
        }
        logProgress(done, bytes);
    });
    logProgress(done, bytes, true);
    if (failed.length > 0) {
        console.warn(`${failed.length} regions failed and were skipped: ${failed.join(" ")}`);
    }

    return exported.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Selects NPC spawns inside the exported regions and bakes one model file per appearance. */
async function exportNpcs(
    cache: ReturnType<typeof readCacheFiles>,
    loaders: ReturnType<typeof createWorldLoaders>,
    exportedRegions: [number, number][],
    workerCount: number,
): Promise<NonNullable<WorldManifest["npcs"]> | undefined> {
    const exportedKeys = new Set(exportedRegions.map(([x, y]) => (x << 8) | y));
    const scenes = new Map<string, ReturnType<typeof loaders.sceneBuilder.buildScene>>();
    const waterAt = (plane: number, x: number, y: number) => {
        const mapX = x >> 6;
        const mapY = y >> 6;
        const key = `${mapX},${mapY}`;
        let scene = scenes.get(key);
        if (!scene) {
            scene = loaders.sceneBuilder.buildScene(mapX * 64, mapY * 64, 64, 64);
            scenes.set(key, scene);
        }
        const lx = x - mapX * 64;
        const ly = y - mapY * 64;
        const overlayId = scene.tileOverlays[plane]?.[lx]?.[ly] - 1;
        if (overlayId === undefined || overlayId < 0) {
            return false;
        }
        return loaders.overlayTypeLoader.load(overlayId).name?.toLowerCase().includes("water") === true;
    };
    const selection = selectNpcs(
        readNpcSpawnFile(NPC_SPAWN_FILE),
        (mapX, mapY) => exportedKeys.has((mapX << 8) | mapY),
        loaders.npcTypeLoader,
        loaders.varManager,
        waterAt,
    );
    if (selection.appearances.length === 0) {
        console.log("No NPC spawns in the exported area");
        return undefined;
    }

    // Attack styles from the wiki: NPCs with more than melee get one clip per style.
    const wiki = JSON.parse(fs.readFileSync(NPC_ATTACKS_WIKI_FILE, "utf8")) as Record<string, WikiAttackRow>;
    let styled = 0;
    for (const task of selection.appearances) {
        const rules = attackRulesFor(wiki[task.id]);
        if (rules) {
            task.attackStyles = rules.infos;
            task.styleSeqs = rules.seqs;
            styled++;
        }
    }
    console.log(`${styled} of ${selection.appearances.length} NPC appearances have attack styles beyond melee`);

    // Levels, bonuses and max hits: the cache's stat opcodes and params, filled in from the wiki.
    // Drop tables come from the wiki too.
    const wikiDrops = readJsonIfPresent<Record<string, WikiDrop[]>>(WIKI_DROPS_FILE, {});
    const idOf = itemIdsByName(loaders);
    for (const task of selection.appearances) {
        const display = loaders.npcTypeLoader.load(task.displayId);
        const row = wiki[task.displayId] ?? wiki[task.id];
        task.combat = combatStatsFor(display, row);
        const drops = dropsFor(row, wikiDrops, idOf);
        if (drops) task.drops = drops;
    }

    console.log("Indexing attack animations...");
    const attackIndex = createAttackIndex(loaders);

    fs.rmSync(NPC_DIR, { recursive: true, force: true });
    fs.mkdirSync(NPC_DIR, { recursive: true });
    console.log(`Exporting ${selection.appearances.length} NPC models...`);
    const built = new Set<number>();
    const failed: string[] = [];
    let done = 0;
    let bytes = 0;
    let withWalk = 0;
    const logProgress = createProgressLogger(selection.appearances.length, "NPC models");

    const tasks: ExportTask[] = selection.appearances.map(
        (npc: NpcAppearanceTask, index): ExportTask => ({ kind: "npc", index, npc }),
    );
    let withAttacks = 0;
    let fallbacks = 0;
    await runWorkerPool(createWorkerData(cache, attackIndex), tasks, workerCount, (result) => {
        done++;
        if (result.type === "npc") {
            withAttacks += result.attacks > 0 ? 1 : 0;
            if (result.styles.length > 0) {
                const task = selection.appearances[result.index];
                const text = result.styles.map((s) => `${s.style}=${s.seqId}${s.fallback ? " (fallback)" : ""}`).join(" ");
                fallbacks += result.styles.filter((s) => s.fallback).length;
                console.log(`attack styles: ${task.name} (${task.id}): ${text}`);
            }
            built.add(result.index);
            bytes += result.bytes;
            withWalk += result.hasWalk ? 1 : 0;
        } else if (result.type === "error") {
            failed.push(result.label);
            console.error(`${result.label} failed:`, result.message);
        }
        logProgress(done, bytes);
    });
    logProgress(done, bytes, true);
    if (failed.length > 0) {
        console.warn(`${failed.length} NPC models failed and were skipped: ${failed.join(" ")}`);
    }

    const manifest: NpcManifest = finalizeNpcManifest(
        selection,
        built,
        `osrs-${cache.download.revision}`,
    );
    fs.writeFileSync(path.join(OUT_DIR, NPC_MANIFEST_FILE), JSON.stringify(manifest));

    console.log(`${styled} NPCs with styled attacks, ${fallbacks} fallback animations`);
    const { skipped } = selection;
    console.log(
        `NPCs: ${manifest.spawns.length} spawns, ${manifest.appearances.length} appearances ` +
            `(${withWalk} can walk, ${withAttacks} with attacks), ${(bytes / 1048576).toFixed(0)} MiB; skipped ` +
            `${skipped.outsideArea} outside the area, ${skipped.nameMismatch} name mismatches, ` +
            `${skipped.noModel} without model, ${skipped.noIdle} without idle animation`,
    );
    return {
        file: NPC_MANIFEST_FILE,
        spawns: manifest.spawns.length,
        appearances: manifest.appearances.length,
    };
}

async function main() {
    const { area, workers, npcs, npcsOnly } = parseArgs(process.argv.slice(2));

    console.log("Reading cache...");
    const cache = readCacheFiles(CACHE_DIR);
    const { download } = cache;
    console.log(
        `OSRS revision ${download.revision} (OpenRS2 #${download.id}, ${download.timestamp})`,
    );

    const loaders = createWorldLoaders(cache);

    if (npcsOnly) {
        // Keep the map; re-bake the NPCs standing on it.
        const worldFile = path.join(OUT_DIR, "world.json");
        if (!fs.existsSync(worldFile)) {
            throw new Error(`No exported map in ${OUT_DIR}; run a full export first`);
        }
        const world: WorldManifest = JSON.parse(fs.readFileSync(worldFile, "utf8"));
        world.npcs = await exportNpcs(cache, loaders, world.regions, workers);
        world.groundItems = exportGroundItems(loaders, world.regions);
        fs.writeFileSync(worldFile, JSON.stringify(world));
        console.log("Done: NPCs re-exported");
        return;
    }

    const regions: [number, number][] = [];
    for (let x = area.x1; x <= area.x2; x++) {
        for (let y = area.y1; y <= area.y2; y++) {
            if (loaders.sceneBuilder.getTerrainData(x, y)) {
                regions.push([x, y]);
            }
        }
    }
    if (regions.length === 0) {
        throw new Error("No map squares in the selected area");
    }

    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(REGION_DIR, { recursive: true });

    console.log("Exporting textures...");
    const textures = exportTextures(loaders.textureLoader);
    console.log(`  ${textures.layers.length - 1} textures -> ${textures.file}`);

    console.log(`Exporting ${regions.length} regions with ${workers} workers...`);
    const exported = await exportRegions(cache, regions, workers);

    const spawnRegion: [number, number] = [
        Math.floor(DEFAULT_SPAWN.x / REGION_SIZE),
        Math.floor(DEFAULT_SPAWN.y / REGION_SIZE),
    ];
    let spawn = DEFAULT_SPAWN;
    if (!exported.some(([x, y]) => x === spawnRegion[0] && y === spawnRegion[1])) {
        // Lumbridge is outside the exported area: start in the middle of it instead.
        const [x, y] = exported[Math.floor(exported.length / 2)];
        spawn = {
            x: x * REGION_SIZE + REGION_SIZE / 2,
            y: y * REGION_SIZE + REGION_SIZE / 2,
            plane: 0,
        };
    }

    const npcInfo = npcs ? await exportNpcs(cache, loaders, exported, workers) : undefined;

    const manifest: WorldManifest = {
        format: WORLD_FORMAT_VERSION,
        source: {
            game: download.game,
            revision: download.revision,
            cacheId: download.id,
            timestamp: download.timestamp,
        },
        regionSize: REGION_SIZE,
        regions: exported,
        spawn,
        textures,
        npcs: npcInfo,
        groundItems: exportGroundItems(loaders, exported),
    };
    fs.writeFileSync(path.join(OUT_DIR, "world.json"), JSON.stringify(manifest));

    console.log(`Done: ${exported.length} regions in ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
