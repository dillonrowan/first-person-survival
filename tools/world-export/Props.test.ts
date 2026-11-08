import { describe, expect, it } from "vitest";

import { propClassFor, propExtent } from "./Props";

describe("physics prop selection (spec 19.1)", () => {
    it("matches movable objects by their whole name", () => {
        expect(propClassFor("Crate")).toEqual({ material: "wood", mass: 40 });
        expect(propClassFor("Crates")?.mass).toBe(100);
        expect(propClassFor("Barrel")?.mass).toBe(60);
        expect(propClassFor("Sacks")?.material).toBe("cloth");
        expect(propClassFor("Pot")?.material).toBe("pottery");
        expect(propClassFor("Boxes")?.mass).toBe(20);
        expect(propClassFor("Crate of fish")).toBeUndefined();
        expect(propClassFor("Bank chest")).toBeUndefined();
        expect(propClassFor("Chairs")).toBeUndefined();
    });

    it("measures a model's radius and height in tiles", () => {
        // A 1 × 1 tile box, 0.5 tiles tall, standing on its origin (RS: +y down, 128 units a tile).
        const xs = [-64, 64, 64, -64, -64, 64, 64, -64];
        const ys = [0, 0, 0, 0, -64, -64, -64, -64];
        const zs = [-64, -64, 64, 64, -64, -64, 64, 64];
        const extent = propExtent(xs, ys, zs, 8, 128);
        expect(extent.height).toBeCloseTo(0.5);
        expect(extent.radius).toBeCloseTo(Math.SQRT1_2);
        expect(extent.bottom).toBeCloseTo(0);
    });
});
