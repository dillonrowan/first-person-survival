// Cache-independent checks of region interactive export. The mock region below represents
// synthetic cache locs for one door, one ladder, and one physics prop.

import { describe, expect, it } from "vitest";

import { REGION_SIZE, RegionData, decodeRegion, encodeRegion } from "../../src/world/WorldFormat";

describe("mock cache region data", () => {
    const mesh = {
        positions: Int16Array.from([0, 0, 0, 0]),
        colors: Uint8Array.from([255, 255, 255, 255]),
        uvs: Int16Array.from([0, 0]),
        indices: Uint32Array.from([0]),
        bounds: Float32Array.from([0, 0, 0, 1]),
    };

    // Tests synthetic cache door collision, climb actions, and wood prop metadata survive serialization.
    it("encodes and decodes doors, climbs, props, and collision without a cache", () => {
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
