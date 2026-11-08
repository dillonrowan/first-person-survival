import { describe, expect, it } from "vitest";

import { tuning } from "../combat/tuning";
import { NpcCombatBrain, combatSteps, stepWeight } from "./NpcCombat";
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
