import { describe, expect, it } from "vitest";

import { tuning } from "../combat/tuning";
import { NpcCombatBrain, chooseStep, combatSteps, stepWeight, zonesFor } from "./NpcCombat";
import { slideSpeedForDistance, stepKnockback } from "./NpcPhysics";

describe("combat step weights", () => {
    it("prefer steps that end between the Red and Green zones", () => {
        const fwd = combatSteps().find((s) => s.forward === 1 && s.length === tuning.stepLengths[2])!;
        const back = combatSteps().find((s) => s.forward === -1 && s.length === tuning.stepLengths[2])!;
        // Too far: stepping in ends in Green, stepping out ends beyond Yellow.
        const far = tuning.zoneGreen + tuning.stepLengths[2] * 0.5;
        expect(stepWeight(fwd, far)).toBeGreaterThan(stepWeight(back, far));
        // Too close: stepping back beats stepping into the Red zone.
        const close = tuning.zoneRed + 0.05;
        expect(stepWeight(back, close)).toBeGreaterThan(stepWeight(fwd, close));
    });
});

describe("NpcCombatBrain", () => {
    const sense = (d: number, playerYaw = 0) => ({
        x: 0,
        y: -d,
        playerX: 0,
        playerY: 0,
        playerYaw,
        healthFraction: 1,
    });

    it("runs from far away, combat-walks near, and zig-zags when looked at", () => {
        const brain = new NpcCombatBrain(() => 0.5);
        const far = brain.update(0.02, sense(10, Math.PI / 2)); // the player looks west, not at it
        expect(Math.hypot(far.vx, far.vy)).toBeCloseTo(tuning.npcRunSpeed, 6);
        expect(far.vx).toBeCloseTo(0, 6);
        const near = brain.update(0.02, sense(4, Math.PI / 2));
        expect(Math.hypot(near.vx, near.vy)).toBeCloseTo(tuning.npcCombatWalkSpeed, 6);
        // The player at the origin looks south (yaw π), straight at the NPC at (0, -10).
        const zig = brain.update(0.02, sense(10, Math.PI));
        expect(Math.abs(zig.vx)).toBeGreaterThan(0.5);
    });

    it("fights within the Yellow zone facing the player, and flees when badly hurt", () => {
        const brain = new NpcCombatBrain(() => 0.3);
        const m = brain.update(0.02, sense(tuning.zoneYellow - 0.1));
        expect(m.mode).toBe("fight");
        expect(m.faceY).toBeCloseTo(1, 6);
        const flee = brain.update(0.02, { ...sense(1.5), healthFraction: 0.1 });
        expect(flee.mode).toBe("flee");
        expect(flee.vy).toBeLessThan(0);
    });
});

describe("an NPC that keeps its distance", () => {
    const sense = (d: number) => ({ x: 0, y: -d, playerX: 0, playerY: 0, playerYaw: 0, healthFraction: 1 });
    const distances = { engage: 6, ideal: 5 };

    it("settles into a fight from 6 tiles and chases from further", () => {
        const brain = new NpcCombatBrain(() => 0.5, distances);

        expect(brain.update(0.02, sense(7)).mode).toBe("chase");
        expect(brain.update(0.02, sense(5.8)).mode).toBe("fight");
        // Hysteresis: it keeps fighting until 0.4 tiles past the engage distance.
        expect(brain.update(0.02, sense(6.3)).mode).toBe("fight");
        expect(brain.update(0.02, sense(6.5)).mode).toBe("chase");
    });

    it("steps in when too far, out when too close, around its ideal distance", () => {
        const zones = zonesFor(distances);
        const fwd = combatSteps().find((s) => s.forward === 1 && s.length === tuning.stepLengths[0])!;
        const back = combatSteps().find((s) => s.forward === -1 && s.length === tuning.stepLengths[0])!;

        expect(stepWeight(fwd, 5.45, zones)).toBeGreaterThan(stepWeight(back, 5.45, zones));
        expect(stepWeight(back, zones.red + 0.05, zones)).toBeGreaterThan(stepWeight(fwd, zones.red + 0.05, zones));
        // Over a few hundred picks it never steps from beyond 6 tiles outwards.
        let outward = 0;
        let seed = 1;
        const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 300; i++) {
            const step = chooseStep(5.9, random, undefined, zones);
            outward += step.forward < 0 ? 1 : 0;
        }
        expect(outward).toBeLessThan(60);
    });

    it("leaves the guard's zones alone", () => {
        const brain = new NpcCombatBrain(() => 0.5);

        expect(brain.update(0.02, sense(tuning.zoneYellow + 1)).mode).toBe("chase");
        expect(brain.update(0.02, sense(tuning.zoneYellow - 0.1)).mode).toBe("fight");
    });
});

describe("slideSpeedForDistance", () => {
    it("starts a friction slide that travels the wanted distance", () => {
        for (const distance of [0.3, tuning.mediumHitDistance.front, tuning.longHitDistance.front]) {
            const k = { x: 0, y: 0, vx: 0, vy: slideSpeedForDistance(distance), plane: 0 };
            while (stepKnockback(k, 0.005, 0.35, { flagsAt: () => 0 })) {
                // keep sliding
            }
            expect(k.y).toBeCloseTo(distance, 1);
        }
    });
});
