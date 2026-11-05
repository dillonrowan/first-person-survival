// Builds Lumbridge's map square from the downloaded cache (in memory, nothing is written) and
// checks the doors and ladders it finds. Skipped when `cache/` does not exist, as in CI.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { REGION_SIZE, RegionData, decodeRegion, encodeRegion } from "../../src/world/WorldFormat";
import { readCacheFiles } from "./cache-files";
import { RegionBuilder } from "./RegionBuilder";
import { createWorldLoaders } from "./WorldLoaders";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CACHE_DIR = path.join(ROOT, "cache");
const hasCache = fs.existsSync(path.join(CACHE_DIR, "info.json"));

describe.skipIf(!hasCache)("Lumbridge doors and ladders from the cache", () => {
    let region: RegionData;

    beforeAll(() => {
        const builder = new RegionBuilder(createWorldLoaders(readCacheFiles(CACHE_DIR)));
        region = builder.build(50, 50)!.region;
    }, 180_000);

    it("finds doors with a mesh each, inside the region", () => {
        const doors = region.interactives.filter((i) => i.kind === "door");

        expect(doors.length).toBeGreaterThan(3);
        expect(region.doorMeshes).toHaveLength(doors.length);
        for (const door of doors) {
            expect(door.tileX >> 6).toBe(50);
            expect(door.tileY >> 6).toBe(50);
            expect(door.door!.flagsB.length).toBeGreaterThan(0);
            const mesh = region.doorMeshes[door.door!.mesh];
            expect(mesh.opaque.indices.length + mesh.transparent.indices.length).toBeGreaterThan(0);
            expect(door.height).toBeGreaterThan(0.5);
        }
        expect(doors.some((d) => /door|gate/i.test(d.name))).toBe(true);
    });

    it("keeps the collision of a closed door baked into the region", () => {
        const closed = region.interactives.find(
            (i) => i.door && !i.door.placedOpen && i.door.flagsA.length > 0 && i.plane === 0,
        )!;
        expect(closed).toBeDefined();

        for (const [x, y, mask] of closed.door!.flagsA) {
            if (x >> 6 === 50 && y >> 6 === 50) {
                const flags = region.collision[((x & 63) * REGION_SIZE + (y & 63))];
                expect(flags & mask).toBe(mask);
            }
        }
    });

    it("finds a staircase or ladder with a climb action", () => {
        const climbs = region.interactives.filter((i) => i.kind === "climb");

        expect(climbs.length).toBeGreaterThan(0);
        expect(climbs.every((c) => c.actions.some((a) => /^climb/i.test(a)))).toBe(true);
    });

    it("survives the file format", () => {
        const bytes = encodeRegion(region);
        const decoded = decodeRegion(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

        expect(decoded.interactives).toEqual(JSON.parse(JSON.stringify(region.interactives)));
        expect(decoded.doorMeshes).toHaveLength(region.doorMeshes.length);
    });

    it("pairs the two leaves of the cow pen gate", () => {
        const cowPen = new RegionBuilder(createWorldLoaders(readCacheFiles(CACHE_DIR))).build(50, 51)!.region;
        const leaves = cowPen.interactives.filter(
            (i) => i.name === "Gate" && i.tileX === 3253 && (i.tileY === 3266 || i.tileY === 3267),
        );

        expect(leaves).toHaveLength(2);
        const [low, high] = leaves.sort((a, b) => a.tileY - b.tileY);
        expect(cowPen.interactives[low.door!.partner!]).toBe(high);
        expect(cowPen.interactives[high.door!.partner!]).toBe(low);
        expect(low.door!.hinge).toEqual([3253, 3266]);
        expect(high.door!.hinge).toEqual([3253, 3268]);
    }, 180_000);
});
