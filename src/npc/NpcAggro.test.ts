import { describe, expect, it } from "vitest";

import { tuning } from "../combat/tuning";
import { units } from "../player/MoveMath";
import { GUARD_ATTACKS, NpcAttacker, attacksInReach } from "./NpcAttacks";
import { SenseInput, canHear, canSee, presenceFor, sightDelay } from "./NpcSenses";

/** NPC at the origin facing north, player straight ahead at `d` tiles. */
const sense = (d: number, extra: Partial<SenseInput> = {}): SenseInput => ({
    x: 0,
    y: 0,
    eyeZ: 1.2,
    facingX: 0,
    facingY: 1,
    alerted: false,
    playerX: 0,
    playerY: d,
    playerZ: 0,
    playerHeight: 1.4,
    stealth: false,
    visibility: 1,
    presence: 0,
    lineOfSight: true,
    ...extra,
});

describe("NPC sight (spec 16.7)", () => {
    it("sees ahead out to range / visibilityratio (≈1071 u) in full light", () => {
        expect(canSee(sense(units(1000)))).toBe(true);
        expect(canSee(sense(units(1100)))).toBe(false);
    });

    it("uses a 90° cone when calm and 160° when alerted", () => {
        const at = (deg: number) => ({ playerX: Math.sin((deg * Math.PI) / 180) * 5, playerY: Math.cos((deg * Math.PI) / 180) * 5 });
        expect(canSee(sense(5, at(40)))).toBe(true);
        expect(canSee(sense(5, at(50)))).toBe(false);
        expect(canSee(sense(5, { ...at(75), alerted: true }))).toBe(true);
        expect(canSee(sense(5, { ...at(85), alerted: true }))).toBe(false);
    });

    it("walls block sight", () => {
        expect(canSee(sense(3, { lineOfSight: false }))).toBe(false);
    });

    it("stealth narrows the cone and range and delays the reaction", () => {
        expect(canSee(sense(units(700), { stealth: true }))).toBe(false); // 0.6 × 1071 ≈ 643 u
        expect(canSee(sense(units(600), { stealth: true }))).toBe(true);
        expect(sightDelay(units(400), true)).toBeCloseTo(2.4);
        expect(sightDelay(units(600), true)).toBeCloseTo(4);
        expect(sightDelay(units(800), true)).toBeCloseTo(8);
        expect(sightDelay(units(800), false)).toBe(0);
    });

    it("fighting NPCs always see the player within 200 u, even behind them", () => {
        expect(canSee(sense(-units(150), { alerted: true }))).toBe(true);
    });
});

describe("NPC hearing (spec 16.7)", () => {
    it("hears running within 500 u but not crouch-walking at that range", () => {
        const run = presenceFor({ speed: 3, crouching: false, walking: false, sprinting: false });
        const crouch = presenceFor({ speed: 1, crouching: true, walking: false, sprinting: false });
        expect(canHear(sense(units(450), { presence: run }), 0)).toBe(true);
        expect(canHear(sense(units(450), { presence: crouch }), 0)).toBe(false);
        expect(presenceFor({ speed: 0, crouching: false, walking: false, sprinting: false })).toBe(0);
    });
});

describe("NPC strikes (spec 16.5, 16.6)", () => {
    it("hit for the share of the attack interval that has passed since the last attack", () => {
        // 4 ticks = 2.4 s. A berserk NPC swings again as soon as the 1.5 s "left" strike ends.
        const attacker = new NpcAttacker(() => 0, GUARD_ATTACKS, 4);
        const rates: number[] = [];
        for (let t = 0; t < 5; t += 0.05) {
            for (const e of attacker.update(0.05, 0, 10, true)) rates.push(e.rate);
        }
        expect(rates[0]).toBe(1);
        expect(rates.length).toBeGreaterThan(1);
        expect(rates[1]).toBeGreaterThan(0.5);
        expect(rates[1]).toBeLessThan(0.75);
    });

    it("only picks attacks whose range plus lunge reach", () => {
        const close = attacksInReach(units(45));
        expect(close.length).toBe(GUARD_ATTACKS.length - 1); // all but the kick (40 u, no lunge)
        const far = attacksInReach(units(160));
        expect(far.map((a) => a.id).sort()).toEqual(["forward", "jump", "long"]);
    });

    it("waits the cool-down, then reports the impact at the animation's hit time", () => {
        let r = 0;
        const attacker = new NpcAttacker(() => (r = (r + 0.37) % 1));
        const hits: number[] = [];
        let t = 0;
        while (t < 10 && hits.length === 0) {
            const events = attacker.update(0.01, units(20), 0, true);
            t += 0.01;
            if (events.length > 0) {
                hits.push(t);
            }
        }
        expect(hits.length).toBe(1);
        expect(t).toBeGreaterThan(tuning.attackCoolMin);
    });
});
