import { describe, expect, it } from "vitest";

import { HitFeel, StunFeel, impactStrength } from "./HitFeel";

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

describe("StunFeel", () => {
    it("snaps the view up when a parry's blow lands, then lets it go", () => {
        const feel = new StunFeel();
        feel.kick(1);
        feel.update(1 / 60, false);
        expect(feel.view.pitch).toBeGreaterThan(0.2);
        expect(feel.view.roll).toBeGreaterThan(0.1);
        expect(feel.fov).toBeGreaterThan(0.1);
        for (let i = 0; i < 120; i++) feel.update(1 / 60, false);
        expect(Math.abs(feel.view.pitch)).toBeLessThan(0.01);
        expect(feel.fov).toBeLessThan(0.01);
    });

    it("jolts the view a little when the blade is caught, fully when the blow lands", () => {
        const caught = new StunFeel();
        caught.kick(-1, 0.35);
        caught.update(1 / 60, false);
        const struck = new StunFeel();
        struck.kick(-1);
        struck.update(1 / 60, false);
        expect(caught.view.roll).toBeLessThan(0);
        expect(caught.view.pitch).toBeLessThan(struck.view.pitch * 0.5);
        // The blow back still lands fully on a head jolted by the catch.
        caught.kick(1);
        caught.update(1 / 60, false);
        expect(caught.view.pitch).toBeGreaterThan(struck.view.pitch * 0.9);
    });

    it("sways the view while stunned and settles after", () => {
        const feel = new StunFeel();
        let most = 0;
        for (let i = 0; i < 120; i++) {
            feel.update(1 / 60, true);
            most = Math.max(most, Math.abs(feel.view.roll));
        }
        expect(most).toBeGreaterThan(0.03);
        for (let i = 0; i < 60; i++) feel.update(1 / 60, false);
        expect(Math.hypot(feel.view.pitch, feel.view.yaw, feel.view.roll)).toBeLessThan(1e-9);
    });

    it("a parry does not freeze the parrying NPC", () => {
        expect(impactStrength({ reaction: "flinch", killed: false, knockedDown: false, defence: "parry" })).toBe(0);
    });
});
