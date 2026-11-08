// Builds Lumbridge's map square from the downloaded cache (in memory, nothing is written) and
// checks the doors and ladders it finds.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { REGION_SIZE, RegionData, decodeRegion, encodeRegion } from "../../src/world/WorldFormat";
import { isCacheAvailable, readCacheFiles } from "./cache-files";
import { RegionBuilder } from "./RegionBuilder";
import { createWorldLoaders } from "./WorldLoaders";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CACHE_DIR = path.join(ROOT, "cache");
const hasCache = isCacheAvailable(CACHE_DIR);

describe("mock cache region data", () => {
    const mesh = {
        positions: Int16Array.from([0, 0, 0, 0]),
        colors: Uint8Array.from([255, 255, 255, 255]),
        uvs: Int16Array.from([0, 0]),
        indices: Uint32Array.from([0]),
        bounds: Float32Array.from([0, 0, 0, 1]),
    };

    it("encodes and decodes doors, climbs, props and collision without a cache", () => {
        const region: RegionData = {
            mapX: 50,
            mapY: 50,
            terrain: { ...mesh, indices: new Uint32Array() },
            opaque: mesh,
            transparent: { ...mesh, positions: new Int16Array(), colors: new Uint8Array(), uvs: new Int16Array(), indices: new Uint32Array() },
            heights: new Int32Array((REGION_SIZE + 1) ** 2 * 4),
            renderFlags: new Uint8Array(REGION_SIZE ** 2 * 4),
            floors: new Uint8Array(REGION_SIZE ** 2 * 4),
            collision: new Int32Array(REGION_SIZE ** 2 * 4),
            interactives: [
                { id: 1, kind: "door", name: "Door", actions: ["Open", "Close"], plane: 0, level: 0, tileX: 3200, tileY: 3200, sizeX: 1, sizeY: 1, rotation: 0, height: 2, door: {
                    placedOpen: false, hinge: [3200, 3201], swing: 1, rotationB: 1, flagsA: [[3200, 3200, 0x80]], flagsB: [[3200, 3200, 0x02]], mesh: 0,
                } },
                { id: 2, kind: "climb", name: "Ladder", actions: ["Climb-up"], plane: 0, level: 0, tileX: 3201, tileY: 3200, sizeX: 1, sizeY: 1, rotation: 0, height: 4 },
                { id: 3, kind: "prop", name: "Crate", actions: ["Take"], plane: 0, level: 0, tileX: 3202, tileY: 3200, sizeX: 1, sizeY: 1, rotation: 0, height: 1, prop: { mesh: 1, material: "wood", mass: 10, x: 3202.5, y: 3200.5, z: 0, radius: 0.4 } },
            ],
            doorMeshes: [
                { opaque: mesh, transparent: { ...mesh, indices: new Uint32Array() } },
                { opaque: mesh, transparent: { ...mesh, indices: new Uint32Array() } },
            ],
        };
        const bytes = encodeRegion(region);
        const decoded = decodeRegion(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

        expect(decoded.interactives.map((item) => item.kind)).toEqual(["door", "climb", "prop"]);
        expect(decoded.doorMeshes).toHaveLength(2);
        expect(decoded.interactives[0].door?.flagsA).toEqual([[3200, 3200, 0x80]]);
        expect(decoded.interactives[2].prop?.material).toBe("wood");
    });
});

describe.skipIf(!hasCache)("Lumbridge doors and ladders from the cache", () => {
    let region: RegionData;

    beforeAll(() => {
        const builder = new RegionBuilder(createWorldLoaders(readCacheFiles(CACHE_DIR)));
        region = builder.build(50, 50)!.region;
    }, 180_000);

    it("finds doors with a mesh each, inside the region", () => {
        const doors = region.interactives.filter((i) => i.kind === "door");
        const props = region.interactives.filter((i) => i.kind === "prop");

        expect(doors.length).toBeGreaterThan(3);
        // Doors and physics props each have one entry in doorMeshes.
        expect(region.doorMeshes).toHaveLength(doors.length + props.length);
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

    it("exports crates and barrels as physics props without tile collision (spec 19.1)", () => {
        const props = region.interactives.filter((i) => i.kind === "prop");

        expect(props.length).toBeGreaterThan(0);
        expect(props.some((p) => /crate|barrel/i.test(p.name))).toBe(true);
        for (const prop of props) {
            const data = prop.prop!;
            const mesh = region.doorMeshes[data.mesh];
            expect(mesh.opaque.indices.length + mesh.transparent.indices.length).toBeGreaterThan(0);
            expect(data.mass).toBeGreaterThan(0);
            expect(data.radius).toBeGreaterThan(0);
            expect(prop.height).toBeGreaterThan(0);
            expect(prop.height).toBeLessThanOrEqual(2.5);
            const flags = region.collision[(prop.plane * REGION_SIZE + (prop.tileX & 63)) * REGION_SIZE + (prop.tileY & 63)];
            expect(flags & 0x100).toBe(0);
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
