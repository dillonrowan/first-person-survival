// Cache-independent checks of the NPC export pipeline. The mock cache below supplies synthetic
// NPC, animation, model, texture, and appearance data; `public/world` checks remain optional.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
    NpcManifest,
    decodeNpcModel,
    encodeNpcModel,
} from "../../src/world/NpcFormat";
import { WorldManifest } from "../../src/world/WorldFormat";
import { FaceColors } from "./FaceColors";
import { NpcModelBuilder } from "./NpcModelBuilder";
import { NpcAppearanceTask, readNpcSpawnFile } from "./NpcSpawns";
import { CacheInfo } from "./rs/cache/CacheInfo";
import { NpcType } from "./rs/config/npctype/NpcType";
import { SeqType } from "./rs/config/seqtype/SeqType";
import { Model } from "./rs/model/Model";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORLD_DIR = path.join(ROOT, "public", "world");
const SPAWN_FILE = path.join(ROOT, "tools", "world-export", "data", "npc-spawns-osrs.json");
const hasWorld = fs.existsSync(path.join(WORLD_DIR, "npcs.json"));

describe("mock NPC cache data", () => {
    // Synthetic cache metadata and three simple fixture objects represent one NPC with idle and
    // walk animations. This replaces proprietary cache binaries while exercising the same builder
    // and binary format APIs.
    const info: CacheInfo = {
        name: "mock-1",
        game: "oldschool",
        environment: "test",
        revision: 1,
        timestamp: "",
        size: 0,
    };

    const model = () => {
        const value = new Model();
        value.verticesCount = 4;
        value.verticesX = Int32Array.from([0, 100, 0, 100]);
        value.verticesY = Int32Array.from([0, 0, -100, -100]);
        value.verticesZ = Int32Array.from([0, 0, 0, 0]);
        value.faceCount = 1;
        value.indices1 = Int32Array.from([0]);
        value.indices2 = Int32Array.from([1]);
        value.indices3 = Int32Array.from([2]);
        value.faceColors1 = Int32Array.from([1000]);
        value.faceColors2 = Int32Array.from([1000]);
        value.faceColors3 = Int32Array.from([1000]);
        value.faceAlphas = Int8Array.from([0]);
        return value;
    };

    // Tests that animation frame counts and moving geometry survive NPC baking and binary encoding.
    it("bakes animated mock NPC models and round trips the export format", () => {
        const npc = new NpcType(3106, info);
        npc.name = "Mock Man";
        npc.size = 1;
        npc.height = 459;
        const idle = new SeqType(808, info);
        idle.frameIds = [0, 1, 2];
        idle.frameLengths = [1, 1, 1];
        const walk = new SeqType(819, info);
        walk.frameIds = [0, 1, 2, 3, 4, 5, 6, 7];
        walk.frameLengths = [1, 1, 1, 1, 1, 1, 1, 1];
        const task: NpcAppearanceTask = {
            id: 3106,
            displayId: 3106,
            name: "Mock Man",
            size: 1,
            combatLevel: 0,
            rotationSpeed: 32,
            file: "npcs/mock.bin",
            idleSeqId: 808,
            walkSeqId: 819,
        };
        const textureLoader = { getTextureIds: () => [], isTransparent: () => false };
        const builder = new NpcModelBuilder(
            { load: () => npc },
            {
                getModel: (_type, _seqId, frame) => {
                    const value = model();
                    value.verticesX = value.verticesX.map((x) => x + frame * 10);
                    return value;
                },
            },
            { load: (id) => id === 808 ? idle : walk },
            new FaceColors(textureLoader),
            textureLoader,
        );

        const baked = builder.build(task)!;
        const bytes = encodeNpcModel(baked);
        const decoded = decodeNpcModel(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        );

        expect(baked.idle!.frameLengths.length).toBe(3);
        expect(baked.walk!.frameLengths.length).toBe(8);
        expect(decoded.vertexCount).toBe(baked.vertexCount);
        expect(Array.from(decoded.walk!.positions)).toEqual(Array.from(baked.walk!.positions));
        expect(Array.from(decoded.opaque.indices)).toEqual(Array.from(baked.opaque.indices));
    });
});

describe("committed NPC spawn list", () => {
    const spawns = readNpcSpawnFile(SPAWN_FILE);

    // Tests that every committed spawn has valid coordinates and movement level values.
    it("has valid OSRS spawn fields", () => {
        expect(spawns.length).toBeGreaterThan(20000);
        for (const spawn of spawns) {
            expect(spawn.level).toBeGreaterThanOrEqual(0);
            expect(spawn.level).toBeLessThanOrEqual(3);
            expect(spawn.x).toBeGreaterThanOrEqual(0);
            expect(spawn.y).toBeGreaterThanOrEqual(0);
        }
    });

    // Tests that a well-known committed spawn remains associated with its expected Lumbridge tile.
    it("places Hans in Lumbridge castle", () => {
        const hans = spawns.find((spawn) => spawn.name === "Hans");

        expect(hans).toMatchObject({ x: 3207, y: 3233, level: 0 });
    });
});

describe.skipIf(!hasWorld)("exported world with NPCs", () => {
    const read = (file: string) => fs.readFileSync(path.join(WORLD_DIR, file));
    const world: WorldManifest = hasWorld ? JSON.parse(read("world.json").toString()) : ({} as never);
    const npcs: NpcManifest = hasWorld ? JSON.parse(read("npcs.json").toString()) : ({} as never);

    // Tests that the world manifest and NPC manifest report the same appearance and spawn counts.
    it("lists NPCs in world.json that match npcs.json", () => {
        expect(world.npcs).toEqual({
            file: "npcs.json",
            spawns: npcs.spawns.length,
            appearances: npcs.appearances.length,
        });
        expect(npcs.spawns.length).toBeGreaterThan(0);
    });

    // Tests that every exported appearance has a model and every spawn references a real appearance.
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

    // Tests that NPC spawn coordinates belong to exported map regions.
    it("only spawns NPCs inside exported regions", () => {
        const regions = new Set(world.regions.map(([x, y]) => `${x},${y}`));

        for (const spawn of npcs.spawns) {
            expect(regions.has(`${spawn.x >> 6},${spawn.y >> 6}`), `${spawn.x},${spawn.y}`).toBe(true);
        }
    });

    // Samples exported NPC binaries and tests animation, mesh-reference, and skeleton invariants.
    it("writes decodable model files with consistent animation data", () => {
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
            const skeleton = model.skeleton!;
            expect(skeleton, appearance.file).toBeDefined();
            const parts = skeleton.parents.length;
            expect(skeleton.parents[0]).toBe(-1);
            skeleton.parents.forEach((parent, i) => i > 0 && expect(parent).toBeLessThan(i));
            for (const part of skeleton.partOf) {
                expect(part === 255 || part < parts).toBe(true);
            }
        }
    }, 30_000);
});
