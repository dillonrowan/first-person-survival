import { describe, expect, it } from "vitest";

import { GUARD_ATTACKS, NpcAttack, NpcAttacker } from "./NpcAttacks";

const move = (id: string, extra: Partial<NpcAttack> = {}): NpcAttack => ({ ...GUARD_ATTACKS[0], id, ...extra });

/** Seconds until the attacker starts its first attack, and which. */
function firstStart(attacker: NpcAttacker): { at: number; id: string | undefined } {
    for (let t = 0; t < 20; t += 0.02) {
        attacker.update(0.02, 0.5, 0, true);
        if (attacker.started) return { at: t, id: attacker.started.id };
    }
    return { at: Infinity, id: undefined };
}

describe("NpcAttacker for a boss", () => {
    it("starts only the attacks its fight allows", () => {
        const attacker = new NpcAttacker(() => 0, [move("swipe"), move("stomp")]);
        attacker.allow = (a) => a.id === "stomp";
        expect(firstStart(attacker).id).toBe("stomp");
    });

    it("starts nothing when its fight allows nothing", () => {
        const attacker = new NpcAttacker(() => 0, [move("swipe")]);
        attacker.allow = () => false;
        expect(firstStart(attacker).id).toBeUndefined();
        expect(attacker.hasDistanceAttack).toBe(false);
    });

    it("waits less between attacks at a faster pace", () => {
        /** Seconds from the end of its first attack to the start of the next. */
        const gap = (pace: number) => {
            const attacker = new NpcAttacker(() => 0.5, [move("swipe")]);
            attacker.pace = pace;
            firstStart(attacker);
            while (attacker.busy) attacker.update(0.02, 0.5, 0, true);
            return firstStart(attacker).at;
        };
        expect(gap(0.5)).toBeGreaterThan(0);
        expect(gap(0.5)).toBeCloseTo(gap(1) / 2, 1);
    });

    it("plays a forced move at once and reports it as started on the next update", () => {
        const enrage = move("enrage", { hitTimes: [], hitPow: [], total: 1 });
        const attacker = new NpcAttacker(() => 0, [move("swipe")]);
        attacker.extend([enrage]);
        expect(attacker.all.map((a) => a.id)).toEqual(["swipe", "enrage"]);

        expect(attacker.force(enrage)).toBe(true);
        expect(attacker.force(move("other"))).toBe(false); // busy
        expect(attacker.update(0.02, 0.5, 0, false)).toEqual([]);
        expect(attacker.started?.id).toBe("enrage");
        attacker.update(0.02, 0.5, 0, false);
        expect(attacker.started).toBeUndefined();
        for (let t = 0; t < 1.1; t += 0.02) attacker.update(0.02, 0.5, 0, false);
        expect(attacker.busy).toBe(false);
    });
});
