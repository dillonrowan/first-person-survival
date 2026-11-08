import { describe, expect, it } from "vitest";

import { units } from "../player/MoveMath";
import { IMPACT_TABLES, fallDamage, impactDamage, kineticJoules, readDamageTable } from "./ImpactDamage";

const WALL = { mass: Infinity, speed: 0, speedLoss: 0, isStatic: true };

describe("physics impact damage (spec 19.5)", () => {
    it("reads Source's damage tables as a step, stopping at the first higher threshold", () => {
        const npc = IMPACT_TABLES.npc.linear;
        expect(readDamageTable(npc, 100)).toBe(0);
        expect(readDamageTable(npc, 150 * 150)).toBe(5);
        expect(readDamageTable(npc, 400 * 400)).toBe(50);
        // The shipped glass table lists 500² before 250²: 300² stops at 500² and takes 75.
        expect(readDamageTable(IMPACT_TABLES.glass.linear, 300 * 300)).toBe(75);
        expect(readDamageTable(IMPACT_TABLES.glass.linear, 600 * 600)).toBe(500);
    });

    it("breaks a thrown crate against a wall but only scratches a kicked one", () => {
        const prop = { allowStatic: true };
        const thrown = impactDamage(IMPACT_TABLES.npc, { mass: 40, speed: units(841), speedLoss: units(841 * 0.75) }, WALL, prop);
        expect(thrown).toBe(100);
        const kicked = impactDamage(IMPACT_TABLES.npc, { mass: 40, speed: units(168), speedLoss: units(168) }, WALL, prop);
        expect(kicked).toBe(5);
        // Without allowStatic the still wall gates it out entirely.
        expect(impactDamage(IMPACT_TABLES.npc, { mass: 40, speed: units(841), speedLoss: units(841) }, WALL)).toBe(0);
    });

    it("ignores bodies lighter than the table's minimum mass and caps small ones", () => {
        const player = { mass: 85, speed: 0, speedLoss: 0 };
        expect(impactDamage(IMPACT_TABLES.player, player, { mass: 1, speed: units(2000), speedLoss: units(2000) })).toBe(0);
        const pot = impactDamage(IMPACT_TABLES.player, player, { mass: 4, speed: units(2400), speedLoss: units(2400) });
        expect(pot).toBe(IMPACT_TABLES.player.smallMassCap);
    });

    it("hurts the player with heavy fast props by their share of the energy", () => {
        // 40 kg at 841 u/s stopping on an 85 kg player: 841² × 40 / 85 ≈ 333k > 550² → 50.
        const damage = impactDamage(
            IMPACT_TABLES.player,
            { mass: 85, speed: 0, speedLoss: 0 },
            { mass: 40, speed: units(841), speedLoss: units(841) },
        );
        expect(damage).toBe(50);
    });

    it("measures impact energy in joules for NPC hit reactions", () => {
        expect(kineticJoules(40, units(168))).toBeCloseTo(364, -1);
        expect(kineticJoules(40, units(841))).toBeGreaterThan(4000);
    });
});

describe("fall damage (spec 19.8)", () => {
    it("is stock Source fall damage above 526.5 u/s, ×0.6, ignored below 5", () => {
        expect(fallDamage(units(500))).toBe(0);
        expect(fallDamage(units(540))).toBe(0); // 13.5 × 0.2525 × 0.6 ≈ 2 < 5
        expect(fallDamage(units(922.5))).toBeCloseTo(60, 5);
        expect(fallDamage(units(1000))).toBeCloseTo((1000 - 526.5) * (100 / 396) * 0.6, 5);
    });
});
