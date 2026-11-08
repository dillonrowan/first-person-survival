// End-to-end checks of the NPC pipeline against real data. The committed spawn list and cache
// sections always run. The exported-world section is skipped when `public/world/` is unavailable,
// and run after `npm run download-cache` /
// `npm run export-world`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";

import { Npcs } from "../../src/npc/Npcs";
import {
    NpcManifest,
    NpcModelData,
    decodeNpcModel,
    encodeNpcModel,
} from "../../src/world/NpcFormat";
import { RegionListener, WorldManifest } from "../../src/world/WorldFormat";
import { readCacheFiles } from "./cache-files";
import { FaceColors } from "./FaceColors";
import { NpcModelBuilder } from "./NpcModelBuilder";
import { NpcAppearanceTask, NpcSelection, readNpcSpawnFile, selectNpcs } from "./NpcSpawns";
import { createWorldLoaders } from "./WorldLoaders";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CACHE_DIR = path.join(ROOT, "cache");
const WORLD_DIR = path.join(ROOT, "public", "world");
const SPAWN_FILE = path.join(ROOT, "tools", "world-export", "data", "npc-spawns-osrs.json");

const hasWorld = fs.existsSync(path.join(WORLD_DIR, "npcs.json"));

describe("committed NPC spawn list", () => {
    const spawns = readNpcSpawnFile(SPAWN_FILE);

    it("has the OSRS spawns, all with valid fields", () => {
        expect(spawns.length).toBeGreaterThan(20000);
        for (const s of spawns) {
            expect(s.level).toBeGreaterThanOrEqual(0);
            expect(s.level).toBeLessThanOrEqual(3);
            expect(s.x).toBeGreaterThanOrEqual(0);
            expect(s.y).toBeGreaterThanOrEqual(0);
        }
    });

    it("places Hans in Lumbridge castle", () => {
        const hans = spawns.find((s) => s.name === "Hans");

        expect(hans).toMatchObject({ x: 3207, y: 3233, level: 0 });
    });
});

describe("NPCs from the downloaded cache", () => {
    let loaders: ReturnType<typeof createWorldLoaders>;
    let builder: NpcModelBuilder;
    let lumbridge: NpcSelection;

    beforeAll(() => {
        loaders = createWorldLoaders(readCacheFiles(CACHE_DIR));
        builder = new NpcModelBuilder(
            loaders.npcTypeLoader,
            loaders.npcModelLoader,
            loaders.seqTypeLoader,
            new FaceColors(loaders.textureLoader),
            loaders.textureLoader,
        );
        lumbridge = selectNpcs(
            readNpcSpawnFile(SPAWN_FILE),
            (mapX, mapY) => mapX === 50 && mapY === 50,
            loaders.npcTypeLoader,
            loaders.varManager,
        );
    }, 120_000);

    it("decodes every NPC and animation definition without errors", () => {
        const errors: unknown[][] = [];
        const original = console.error;
        console.error = (...args) => errors.push(args);
        try {
            for (let id = 0; id < loaders.npcTypeLoader.getCount(); id++) {
                loaders.npcTypeLoader.load(id);
            }
            for (let id = 0; id < loaders.seqTypeLoader.getCount(); id++) {
                loaders.seqTypeLoader.load(id);
            }
        } finally {
            console.error = original;
        }

        expect(errors).toEqual([]);
    }, 60_000);

    it("reads known definitions", () => {
        const demon = loaders.npcTypeLoader.load(240);
        const man = loaders.npcTypeLoader.load(3106);

        expect(demon).toMatchObject({ name: "Black demon", size: 3, height: 459 });
        expect(man).toMatchObject({ name: "Man", idleSeqId: 808, walkSeqId: 819 });
    });

    it("selects Lumbridge's NPCs, including Hans and the Cook, in region 50,50 only", () => {
        const names = lumbridge.appearances.map((a) => a.name);

        expect(names).toEqual(expect.arrayContaining(["Hans", "Man", "Cook"]));
        expect(lumbridge.spawns.length).toBeGreaterThan(100);
        for (const spawn of lumbridge.spawns) {
            expect(spawn.x >> 6).toBe(50);
            expect(spawn.y >> 6).toBe(50);
        }
    });

    it("bakes Man with a 12-frame idle and an 8-frame walk whose frames really differ", () => {
        const task = lumbridge.appearances.find((a) => a.id === 3106) as NpcAppearanceTask;
        const model = builder.build(task)!;

        expect(model.idle!.frameLengths.length).toBe(12);
        expect(model.walk!.frameLengths.length).toBe(8);
        expect(model.vertexCount).toBeGreaterThan(100);
        expect(model.opaque.indices.length).toBeGreaterThan(0);
        for (const bound of model.bounds) {
            expect(Number.isFinite(bound)).toBe(true);
        }
        // Animation moves vertices: some frames differ from frame 0.
        const frame = (clip: NonNullable<typeof model.walk>, f: number) =>
            clip.positions.slice(f * model.vertexCount * 3, (f + 1) * model.vertexCount * 3);
        const first = frame(model.walk!, 0);
        expect([1, 2, 3, 4, 5, 6, 7].some((f) => frame(model.walk!, f).some((v, i) => v !== first[i]))).toBe(true);
        // Every mesh vertex points at a real model vertex.
        for (const source of model.opaque.sources) {
            expect(source).toBeLessThan(model.vertexCount);
        }
    });

    it("bakes every NPC type in Lumbridge and survives the file format round trip", () => {
        for (const task of lumbridge.appearances) {
            const model = builder.build(task);
            loaders.npcModelLoader.clearCache();
            if (!model) {
                continue; // no visible faces; the exporter drops these
            }
            const bytes = encodeNpcModel(model);
            const decoded = decodeNpcModel(
                bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
            );

            expect(decoded.vertexCount, task.name).toBe(model.vertexCount);
            expect(Array.from(decoded.opaque.indices), task.name).toEqual(Array.from(model.opaque.indices));
            expect(decoded.idle?.positions.length, task.name).toBe(model.idle?.positions.length);
        }
    }, 120_000);

    it("plays a real baked NPC in the game runtime: it animates and wanders", async () => {
        const task = lumbridge.appearances.find((a) => a.id === 3106) as NpcAppearanceTask;
        const baked = builder.build(task)!;
        const file = encodeNpcModel(baked);
        const data: NpcModelData = decodeNpcModel(
            file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
        );

        const listeners: RegionListener[] = [];
        const manifest: NpcManifest = {
            format: 1,
            source: "test",
            appearances: [{ ...task, file: "npcs/3106_3106.bin" }],
            spawns: [{ appearance: 0, x: 3222, y: 3218, plane: 0, orientation: 0 }],
        };
        const scene = new THREE.Scene();
        const material = new THREE.MeshBasicMaterial();
        const npcs = new Npcs(
            manifest,
            {
                collisionFlags: () => 0,
                groundHeight: () => 0,
                renderLevel: (plane) => plane,
                addRegionListener: (l) => {
                    listeners.push(l);
                },
            },
            scene,
            { opaque: material, transparent: material },
            async () => data,
            () => 0,
        );
        listeners.forEach((l) => l.loaded(50, 50));
        await new Promise((resolve) => setTimeout(resolve, 0));
        const npc = npcs.all()[0];
        const positions = (npc.group.children[0] as THREE.Mesh).geometry.getAttribute("a_position");
        const atStart = Array.from(positions.array as Int16Array);

        // random() = 0 always wanders towards 5 tiles south-west of the spawn.
        for (let i = 0; i < 100; i++) {
            npcs.update(0.1);
        }

        expect(npcs.count).toBe(1);
        expect(npc.tileX).toBeLessThan(3222);
        expect(npc.tileY).toBeLessThan(3218);
        expect(Array.from(positions.array as Int16Array)).not.toEqual(atStart);
        // The info component (texture layer, priority, plane) is never overwritten by animation.
        const after = positions.array as Int16Array;
        for (let i = 3; i < after.length; i += 4) {
            expect(after[i]).toBe(atStart[i]);
        }
    });
});

describe.skipIf(!hasWorld)("exported world with NPCs", () => {
    const read = (file: string) => fs.readFileSync(path.join(WORLD_DIR, file));
    const world: WorldManifest = hasWorld ? JSON.parse(read("world.json").toString()) : ({} as never);
    const npcs: NpcManifest = hasWorld ? JSON.parse(read("npcs.json").toString()) : ({} as never);

    it("lists NPCs in world.json that match npcs.json", () => {
        expect(world.npcs).toEqual({
            file: "npcs.json",
            spawns: npcs.spawns.length,
            appearances: npcs.appearances.length,
        });
        expect(npcs.spawns.length).toBeGreaterThan(0);
    });

    it("has a model file for every appearance and a valid appearance for every spawn", () => {
        for (const appearance of npcs.appearances) {
            expect(fs.existsSync(path.join(WORLD_DIR, appearance.file)), appearance.file).toBe(true);
        }
        for (const spawn of npcs.spawns) {
            expect(npcs.appearances[spawn.appearance]).toBeDefined();
            expect(spawn.plane).toBeGreaterThanOrEqual(0);
            expect(spawn.plane).toBeLessThanOrEqual(3);
        }
    });

    it("only spawns NPCs inside exported regions", () => {
        const regions = new Set(world.regions.map(([x, y]) => `${x},${y}`));

        for (const spawn of npcs.spawns) {
            expect(regions.has(`${spawn.x >> 6},${spawn.y >> 6}`), `${spawn.x},${spawn.y}`).toBe(true);
        }
    });

    it("writes decodable model files with consistent animation data", () => {
        // Every 25th file keeps the test fast while covering all kinds of NPCs.
        for (const appearance of npcs.appearances.filter((_, i) => i % 25 === 0)) {
            const raw = gunzipSync(read(appearance.file));
            const model = decodeNpcModel(
                raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
            );

            expect(model.opaque.indices.length + model.transparent.indices.length, appearance.file).toBeGreaterThan(0);
            for (const clip of [model.idle, model.walk]) {
                if (clip) {
                    expect(clip.positions.length).toBe(clip.frameLengths.length * model.vertexCount * 3);
                }
            }
            for (const mesh of [model.opaque, model.transparent]) {
                for (const index of mesh.indices) {
                    expect(index).toBeLessThan(mesh.sources.length);
                }
                for (const source of mesh.sources) {
                    expect(source).toBeLessThan(model.vertexCount);
                }
            }
            // Ragdoll skeleton (spec 20.2): a tree with parents before children, every part used.
            const skeleton = model.skeleton!;
            expect(skeleton, appearance.file).toBeDefined();
            const parts = skeleton.parents.length;
            expect(skeleton.parents[0]).toBe(-1);
            skeleton.parents.forEach((parent, i) => i > 0 && expect(parent).toBeLessThan(i));
            for (const part of skeleton.partOf) {
                expect(part === 255 || part < parts).toBe(true);
            }
        }
        // Reading thousands of model files is slow while other test files run in parallel.
    }, 30_000);
});
