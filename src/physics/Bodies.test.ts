import { describe, expect, it } from "vitest";

import { Body, computePush, rayBox, rayCylinder, segmentHitsBoxes2D } from "./Bodies";

const body = (x: number, y: number, z = 0, radius = 0.35, height = 1.5): Body => ({
    x,
    y,
    z,
    radius,
    height,
    plane: 0,
    owner: null,
});

describe("computePush", () => {
    it("pushes out along the contact normal by the overlap depth", () => {
        const out = { x: 0, y: 0 };
        const hit = computePush(10.5, 10, 0, 0.3, 1.4, [body(10, 10)], 1, 0, out);

        expect(hit).toBe(true);
        expect(out.x).toBeCloseTo(0.65 - 0.5, 3);
        expect(out.y).toBeCloseTo(0, 6);
    });

    it("does nothing for a body that is out of reach or vertically separate", () => {
        const out = { x: 0, y: 0 };
        expect(computePush(11, 10, 0, 0.3, 1.4, [body(10, 10)], 1, 0, out)).toBe(false);
        expect(computePush(10.2, 10, 3, 0.3, 1.4, [body(10, 10)], 1, 0, out)).toBe(false);
    });

    it("uses the fallback direction when the centres coincide", () => {
        const out = { x: 0, y: 0 };
        computePush(10, 10, 0, 0.3, 1.4, [body(10, 10)], 0, -2, out);

        expect(out.x).toBeCloseTo(0, 6);
        expect(out.y).toBeLessThan(0);
    });
});

describe("rayCylinder", () => {
    it("hits the side, hits the top from above and misses to the side", () => {
        const b = body(5, 0);
        expect(rayCylinder(0, 0, 1, 1, 0, 0, b, 10)).toBeCloseTo(4.65, 6);
        expect(rayCylinder(5, 0, 5, 0, 0, -1, b, 10)).toBeCloseTo(3.5, 6);
        expect(rayCylinder(0, 2, 1, 1, 0, 0, b, 10)).toBeUndefined();
        expect(rayCylinder(0, 0, 1, 1, 0, 0, b, 3)).toBeUndefined(); // out of range
    });
});

describe("rayBox and segmentHitsBoxes2D", () => {
    it("intersect boxes along the ray", () => {
        const box = { minX: 2, minY: -1, minZ: 0, maxX: 3, maxY: 1, maxZ: 2 };
        expect(rayBox(0, 0, 1, 1, 0, 0, box, 10)).toBeCloseTo(2, 6);
        expect(rayBox(0, 5, 1, 1, 0, 0, box, 10)).toBeUndefined();

        const wall = { minX: 2, minY: -1, maxX: 2.1, maxY: 1 };
        expect(segmentHitsBoxes2D(0, 0, 4, 0, [wall])).toBeCloseTo(0.5, 6);
        expect(segmentHitsBoxes2D(0, 3, 4, 3, [wall])).toBeUndefined();
    });
});
