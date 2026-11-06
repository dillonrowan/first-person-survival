import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { HitFeel, impactStrength } from "./HitFeel";

describe("HitFeel", () => {
    it("nearly freezes the fight for a moment, longer for heavier blows", () => {
        const stopFor = (strength: number) => {
            const feel = new HitFeel(() => 0);
            feel.impact(strength);
            let t = 0;
            while (feel.stopped) {
                expect(feel.worldDt(1 / 120)).toBeLessThan(0.001);
                t += 1 / 120;
            }
            expect(feel.worldDt(1 / 60)).toBe(1 / 60);
            return t;
        };
        expect(stopFor(0.3)).toBeGreaterThan(0.04);
        expect(stopFor(1)).toBeGreaterThan(stopFor(0.3));
        expect(stopFor(1)).toBeLessThan(0.13);
    });

    it("kicks the camera and springs it back", () => {
        const feel = new HitFeel(() => 0);
        feel.impact(1);
        const camera = new THREE.PerspectiveCamera();
        let peak = 0;
        for (let i = 0; i < 120; i++) {
            feel.update(1 / 60);
            camera.rotation.set(0, 0, 0);
            feel.apply(camera);
            peak = Math.max(peak, Math.abs(camera.rotation.x));
        }
        expect(peak).toBeGreaterThan(0.01);
        expect(Math.abs(camera.rotation.x)).toBeLessThan(1e-3);
        expect(Math.abs(camera.rotation.z)).toBeLessThan(1e-3);
    });

    it("rates kills and knockdowns hardest", () => {
        expect(impactStrength({ reaction: "flinch", killed: false, knockedDown: false })).toBeLessThan(
            impactStrength({ reaction: "push", killed: false, knockedDown: false }),
        );
        expect(impactStrength({ reaction: "flinch", killed: true, knockedDown: false })).toBe(1);
    });
});
