import { describe, expect, it } from "vitest";

import { Ambience, UNDERGROUND_Y, isUnderground } from "./Ambience";

const SKY = [0.55, 0.75, 0.9] as const;

describe("Ambience", () => {
    // The dungeon band starts at map row 66; the surface keeps the sky colour.
    it("tells underground rows from the surface", () => {
        expect(isUnderground(UNDERGROUND_Y - 1)).toBe(false);
        expect(isUnderground(UNDERGROUND_Y)).toBe(true);
    });

    // Fog and clear colour fade to near-black underground and back, written into the shared vector.
    it("fades the shared fog colour down and back up", () => {
        const fog = { x: SKY[0], y: SKY[1], z: SKY[2] };
        const clear: number[][] = [];
        const ambience = new Ambience(SKY, fog, (r, g, b) => clear.push([r, g, b]));

        ambience.update(0.1, 3200);
        expect(fog.x).toBeCloseTo(SKY[0], 6); // surface: unchanged

        ambience.update(0.5, UNDERGROUND_Y + 10);
        expect(fog.x).toBeLessThan(SKY[0]);
        expect(fog.x).toBeGreaterThan(0.03);

        ambience.update(5, UNDERGROUND_Y + 10);
        expect(ambience.level).toBe(1);
        expect(fog.x).toBeLessThan(0.05);
        expect(clear.at(-1)).toEqual([fog.x, fog.y, fog.z]);

        ambience.update(5, 3200);
        expect(fog.y).toBeCloseTo(SKY[1], 6);
    });
});
