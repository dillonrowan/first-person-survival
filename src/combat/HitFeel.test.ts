import { describe, expect, it } from "vitest";

import { HitFeel, impactStrength } from "./HitFeel";

describe("HitFeel", () => {
    it("nearly freezes the struck for a moment, longer for heavier blows", () => {
        const holdFor = (strength: number) => {
            const feel = new HitFeel();
            feel.impact(strength);
            let t = 0;
            while (feel.stopped) {
                expect(feel.worldDt(1 / 120)).toBeLessThan(0.001);
                t += 1 / 120;
            }
            expect(feel.worldDt(1 / 60)).toBe(1 / 60);
            return t;
        };
        expect(holdFor(0.3)).toBeGreaterThan(0.04);
        expect(holdFor(1)).toBeGreaterThan(holdFor(0.3));
        expect(holdFor(1)).toBeLessThan(0.13);
    });

    it("rates kills and knockdowns hardest", () => {
        expect(impactStrength({ reaction: "flinch", killed: false, knockedDown: false })).toBeLessThan(
            impactStrength({ reaction: "push", killed: false, knockedDown: false }),
        );
        expect(impactStrength({ reaction: "flinch", killed: true, knockedDown: false })).toBe(1);
    });
});
