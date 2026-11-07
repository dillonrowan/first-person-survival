import { describe, expect, it } from "vitest";

import {
    InteractiveLoc,
    LEVELS,
    MeshData,
    REGION_SIZE,
    RegionData,
    decodeRegion,
    encodeRegion,
} from "./WorldFormat";

function mesh(vertices: number, seed = 1): MeshData {
    return {
        positions: Int16Array.from({ length: vertices * 4 }, (_, i) => i * seed - 5),
        colors: Uint8Array.from({ length: vertices * 4 }, (_, i) => (i * 7 * seed) & 255),
        uvs: Int16Array.from({ length: vertices * 2 }, (_, i) => -i * 100),
        indices: Uint32Array.from(vertices >= 3 ? [0, 1, 2] : []),
        bounds: Float32Array.from([1, 2, 3, 4]),
    };
}

const door: InteractiveLoc = {
    kind: "door",
    id: 1535,
    name: "Door",
    actions: ["Open"],
    plane: 0,
    level: 0,
    tileX: 3207,
    tileY: 3214,
    sizeX: 1,
    sizeY: 1,
    rotation: 0,
    height: 2,
    door: {
        placedOpen: false,
        hinge: [3207, 3215],
        swing: 1,
        rotationB: 1,
        flagsA: [[3207, 3214, 0x80]],
        flagsB: [[3207, 3214, 0x02]],
        mesh: 0,
    },
};

function region(overrides: Partial<RegionData> = {}): RegionData {
    const tiles = LEVELS * REGION_SIZE * REGION_SIZE;
    return {
        mapX: 50,
        mapY: 50,
        terrain: mesh(5),
        opaque: mesh(3),
        transparent: mesh(0),
        heights: new Int32Array(LEVELS * 65 * 65).fill(-7),
        renderFlags: new Uint8Array(tiles).fill(2),
        floors: new Uint8Array(tiles).fill(1),
        collision: new Int32Array(tiles).fill(0x100),
        water: new Uint8Array(tiles),
        interactives: [],
        doorMeshes: [],
        ...overrides,
    };
}

/** Decodes from a buffer at offset 0, like the game does after gunzip. */
function roundTrip(data: RegionData) {
    const bytes = encodeRegion(data);
    return decodeRegion(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

describe("region format", () => {
    it("round-trips meshes, terrain data, interactives and door meshes", () => {
        const data = region({
            interactives: [door, { ...door, kind: "climb", name: "Ladder — up", door: undefined }],
            doorMeshes: [{ opaque: mesh(4, 3), transparent: mesh(3, 2) }],
        });

        const decoded = roundTrip(data);

        expect(decoded.mapX).toBe(50);
        expect(Array.from(decoded.terrain.positions)).toEqual(Array.from(data.terrain.positions));
        expect(Array.from(decoded.collision.slice(0, 3))).toEqual([0x100, 0x100, 0x100]);
        expect(Array.from(decoded.water ?? []).length).toBe(LEVELS * REGION_SIZE * REGION_SIZE);
        expect(decoded.interactives).toEqual(JSON.parse(JSON.stringify(data.interactives)));
        expect(decoded.doorMeshes).toHaveLength(1);
        expect(Array.from(decoded.doorMeshes[0].opaque.positions)).toEqual(
            Array.from(data.doorMeshes[0].opaque.positions),
        );
        expect(Array.from(decoded.doorMeshes[0].transparent.indices)).toEqual([0, 1, 2]);
        expect(decoded.doorMeshes[0].opaque.bounds[3]).toBe(4);
    });

    it("pads the interactive JSON so the door meshes stay aligned", () => {
        for (const name of ["", "a", "ab", "abc", "abcd"]) {
            const decoded = roundTrip(
                region({
                    interactives: [{ ...door, name }],
                    doorMeshes: [{ opaque: mesh(3), transparent: mesh(0) }],
                }),
            );
            expect(decoded.interactives[0].name).toBe(name);
            expect(decoded.doorMeshes[0].opaque.indices.length).toBe(3);
        }
    });

    it("still reads version 1 files, without interactives", () => {
        const bytes = encodeRegion(region());
        // A version 1 file is the same up to the end of the collision section.
        const tilesBytes = LEVELS * REGION_SIZE * REGION_SIZE;
        const v1Length = bytes.length - 8; // minus the two u32 of the empty v2 tail
        const v1 = bytes.slice(0, v1Length);
        new DataView(v1.buffer).setUint32(4, 1, true);
        expect(tilesBytes).toBeGreaterThan(0);

        const decoded = decodeRegion(v1.buffer as ArrayBuffer);

        expect(decoded.interactives).toEqual([]);
        expect(decoded.doorMeshes).toEqual([]);
        expect(decoded.collision[0]).toBe(0x100);
    });

    it("rejects unknown versions and other files", () => {
        const bytes = encodeRegion(region());
        new DataView(bytes.buffer).setUint32(4, 99, true);

        expect(() => decodeRegion(bytes.buffer as ArrayBuffer)).toThrow(/re-run/);
        expect(() => decodeRegion(new ArrayBuffer(32))).toThrow(/Not a world region/);
    });
});
