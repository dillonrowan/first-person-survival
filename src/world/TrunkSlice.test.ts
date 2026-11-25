import { describe, expect, it } from "vitest";

import { rayCylinder } from "./SkillLocs";
import { TRUNK_SLICES, measureTrunk } from "./TrunkSlice";

/** An n-sided upright prism of `radius` about (cx, cy) from z0 to z1, as unwelded triangles. */
function prism(cx: number, cy: number, radius: number, z0: number, z1: number, n = 8) {
    const verts: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const b = ((i + 1) / n) * Math.PI * 2;
        const p = [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
        const q = [cx + radius * Math.cos(b), cy + radius * Math.sin(b)];
        verts.push([p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1]);
        verts.push([p[0], p[1], z0], [q[0], q[1], z1], [p[0], p[1], z1]);
    }
    return verts;
}

describe("measureTrunk", () => {
    it("finds the trunk under a canopy that hangs into the slices, off the footprint's middle", () => {
        // A trunk of radius 0.2 at (5.3, 7.1) up to 3 tiles, and a canopy 1.5 wide from 1.1 up.
        const verts = [...prism(5.3, 7.1, 0.2, 0, 3), ...prism(5.2, 7, 1.5, 1.1, 3)];
        const trunk = measureTrunk((i) => verts[i], [...verts.keys()], 5, 7, TRUNK_SLICES);
        expect(trunk!.x).toBeCloseTo(5.3, 2);
        expect(trunk!.y).toBeCloseTo(7.1, 2);
        expect(trunk!.radius).toBeCloseTo(0.2, 2);
    });

    it("finds nothing in a model lower than the slices (a stump)", () => {
        const verts = prism(0, 0, 0.3, 0, 0.4);
        expect(measureTrunk((i) => verts[i], [...verts.keys()], 0, 0, TRUNK_SLICES)).toBeUndefined();
    });
});

describe("rayCylinder", () => {
    const trunk = { x: 5, y: 0, radius: 0.5 };
    it("meets the bark, not the middle", () => {
        expect(rayCylinder(0, 0, 1, 1, 0, 0, trunk, 0, 3, 10)).toBeCloseTo(4.5);
    });
    it("misses beside it, above it, and beyond reach", () => {
        expect(rayCylinder(0, 1, 1, 1, 0, 0, trunk, 0, 3, 10)).toBeUndefined();
        expect(rayCylinder(0, 0, 4, 1, 0, 0, trunk, 0, 3, 10)).toBeUndefined();
        expect(rayCylinder(0, 0, 1, 1, 0, 0, trunk, 0, 3, 4)).toBeUndefined();
    });
});
