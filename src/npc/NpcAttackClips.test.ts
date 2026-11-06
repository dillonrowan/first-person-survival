import { describe, expect, it } from "vitest";

import type { NpcAttackClip } from "../world/NpcFormat";
import { CLIENT_CYCLE_SECONDS, frameAtCycle } from "./NpcAnimation";
import { GUARD_ATTACKS, NpcAttacker, attacksFromClips } from "./NpcAttacks";
import { BodyRig, HitReactions } from "./HitPose";
import { LUNGE_CLIP } from "./HitClips";

const attackClip = (frameLengths: number[], hitCycle: number, shove = false): NpcAttackClip => ({
    frameLengths: Uint16Array.from(frameLengths),
    frameStep: -1,
    positions: new Int16Array(frameLengths.length * 3),
    hitCycle,
    shove,
});

describe("attacks from cache clips", () => {
    it("last their clip and land on its impact frame", () => {
        const [slash, kick] = attacksFromClips([attackClip([4, 4, 6, 8], 11), attackClip([5, 5], 7, true)], 1.5);

        expect(slash.total).toBeCloseTo(22 * CLIENT_CYCLE_SECONDS);
        expect(slash.hitTimes).toEqual([11 * CLIENT_CYCLE_SECONDS]);
        expect(slash.clip).toBe(0);
        expect(kick.push).toBe(true);
        expect(kick.clip).toBe(1);
    });

    it("reach further for bigger bodies", () => {
        const [small] = attacksFromClips([attackClip([10], 5)], 0.8);
        const [big] = attacksFromClips([attackClip([10], 5)], 3);
        expect(big.range).toBeGreaterThan(small.range);
    });

    it("are what the attacker strikes with, impact on time", () => {
        const attacks = attacksFromClips([attackClip([10, 10, 10], 15)], 1.5);
        const attacker = new NpcAttacker(() => 0, attacks);
        const dt = 1 / 100;
        let t = 0;
        let started = -1;
        const hits: number[] = [];
        while (t < 10 && !(hits.length > 0 && !attacker.busy)) {
            for (const e of attacker.update(dt, 0.1, 0, true)) {
                hits.push(t);
                expect(e.attack.clip).toBe(0);
            }
            if (attacker.busy && started < 0) {
                started = t;
            }
            t += dt;
        }
        expect(hits.length).toBe(1);
        expect(hits[0] - started).toBeCloseTo(0.3, 1);
        expect(attacker.current).toBeUndefined();
    });

    it("fall back to the guard's table without clips", () => {
        const attacker = new NpcAttacker(() => 0);
        for (let t = 0; t < 10 && !attacker.busy; t += 0.01) {
            attacker.update(0.01, 0.1, 0, true);
        }
        expect(GUARD_ATTACKS).toContain(attacker.current);
    });
});

describe("frameAtCycle", () => {
    it("finds the frame shown and holds the last one", () => {
        const clip = { frameLengths: Uint16Array.from([2, 3, 1]) };
        expect([0, 1, 2, 4, 5, 6, 99].map((c) => frameAtCycle(clip, c))).toEqual([0, 0, 1, 1, 2, 2, 2]);
    });
});

describe("generic lunge", () => {
    it("leans the body furthest forward at the strike's impact, and settles after", () => {
        const skeleton = { parents: Int8Array.from([-1, 0]), pivots: Int16Array.from([0, -51, 0, 0, -51, -38]), partOf: Uint8Array.from(Array(16).fill(0).map((_, i) => (i < 8 ? 0 : 1))) };
        const base = Float32Array.from(Array.from({ length: 16 }, (_, i) => [(i % 2) * 0.1, 0.2 + ((i >> 1) % 2) * 0.4, i < 8 ? (i >> 2) % 2 * 0.3 : 0.4 + ((i >> 2) % 2) * 0.2]).flat());
        const reactions = new HitReactions(new BodyRig({ vertexCount: 16, skeleton }, base));
        const pitchAt = (time: number) => {
            reactions.setLunge({ time, hitTime: 0.6, total: 1.4 });
            reactions.pose();
            return 2 * Math.asin(reactions.local[0]);
        };
        const peak = pitchAt(0.6);
        expect(peak).toBeCloseTo(LUNGE_CLIP.data[LUNGE_CLIP.impactFrame * 3], 3);
        expect(pitchAt(0.3)).toBeLessThan(0); // gathering back
        expect(Math.abs(pitchAt(1.4))).toBeLessThan(0.01);
        expect(reactions.active).toBe(true);
        reactions.setLunge(undefined);
        reactions.update(0.016);
        reactions.update(0.016);
        expect(reactions.active).toBe(false);
    });
});
