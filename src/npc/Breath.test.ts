import { describe, expect, it } from "vitest";

import { inBreathCone } from "./Breath";

describe("inBreathCone", () => {
    const breath = { length: 3, halfAngle: (30 * Math.PI) / 180 };
    // The NPC at the origin faces +y.
    const hit = (x: number, y: number, gap: number) => inBreathCone(0, 0, 0, 1, x, y, gap, breath);

    it("covers the player straight ahead within the length", () => {
        expect(hit(0, 1.5, 1)).toBe(true);
        expect(hit(0, 3.2, 3)).toBe(true);
    });

    it("misses a player beyond the length, off to the side, or behind", () => {
        expect(hit(0, 4, 3.5)).toBe(false);
        expect(hit(1, 1, 1)).toBe(false); // 45 degrees off
        expect(hit(0, -1.5, 1)).toBe(false);
    });

    it("includes the edge of the cone and ignores the length of the facing vector", () => {
        const edge = (29 * Math.PI) / 180;
        expect(hit(Math.sin(edge) * 2, Math.cos(edge) * 2, 2)).toBe(true);
        const outside = (32 * Math.PI) / 180;
        expect(hit(Math.sin(outside) * 2, Math.cos(outside) * 2, 2)).toBe(false);
        expect(inBreathCone(0, 0, 0, 5, 0, 1, 1, breath)).toBe(true);
    });

    it("hits a player inside the body of the NPC", () => {
        expect(hit(0, 0, -0.5)).toBe(true);
    });
});
