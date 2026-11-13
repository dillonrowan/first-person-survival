import { describe, expect, it } from "vitest";

import { buildObstacleTops, obstacleTopIn } from "./ObstacleTops";
import type { MeshData } from "./WorldFormat";

/** One vertical quad (two triangles), RS units: x east, y down, z north. */
function quad(x0: number, z0: number, x1: number, z1: number, height: number): MeshData {
    const positions = Int16Array.from([x0, 0, z0, 0, x1, 0, z1, 0, x1, -height, z1, 0, x0, -height, z0, 0]);
    return {
        positions,
        colors: new Uint8Array(16),
        uvs: new Int16Array(8),
        indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
        bounds: new Float32Array(4),
    };
}

describe("obstacle tops", () => {
    it("know how tall a fence is along its line, and nothing beside it", () => {
        // A fence 1 tile tall along the north edge of tiles 10..11 (z = 3 tiles), and a tree
        // 4 tiles tall two tiles further north.
        const fence = quad(10 * 128, 3 * 128, 12 * 128, 3 * 128, 128);
        const tree = quad(10 * 128, 5 * 128 + 64, 10 * 128 + 32, 5 * 128 + 64, 512);
        const tops = buildObstacleTops([fence, tree]);
        expect(obstacleTopIn(tops, 10.5, 2.92, 10.6, 3.08)).toBeCloseTo(1, 6);
        expect(obstacleTopIn(tops, 10, 5.4, 10.3, 5.6)).toBeCloseTo(4, 6);
        expect(obstacleTopIn(tops, 20, 20, 21, 21)).toBe(-Infinity);
    });
});
