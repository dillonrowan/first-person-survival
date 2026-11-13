import { describe, expect, it } from "vitest";

import type { NpcAttackClip } from "../world/NpcFormat";
import type { AttackStyle, NpcStyledAttackInfo } from "./AttackStyle";
import { CLIENT_CYCLE_SECONDS, frameAtCycle } from "./NpcAnimation";
import { GUARD_ATTACKS, NpcAttacker, attacksFromClips, attacksFromStyles, attacksInReach } from "./NpcAttacks";
import { BodyRig, HitReactions } from "./HitPose";
import { LUNGE_CLIP } from "./HitClips";

const attackClip = (frameLengths: number[], hitCycle: number, shove = false, style: AttackStyle = "melee"): NpcAttackClip => ({
    frameLengths: Uint16Array.from(frameLengths),
    frameStep: -1,
    positions: new Int16Array(frameLengths.length * 3),
    hitCycle,
    shove,
    seqId: -1,
    style,
    launch: [0.5, 1.5],
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

const BREATH = { length: 3, halfAngle: 0.5, duration: 0.8, ticks: 4, element: "fire" as const };
const DRAGON: NpcStyledAttackInfo[] = [
    { style: "melee", weight: 5, hitPow: 0.7, minGap: 0 },
    { style: "dragonfire", weight: 1, hitPow: 2, minGap: 0, maxGap: 1, breath: BREATH },
];
const dragonClips = () => [attackClip([4, 4, 6, 8], 11), attackClip([5, 5, 5, 5, 5], 15, false, "dragonfire")];

/** A small seeded generator, so the weighted picks are reproducible. */
function seeded(seed: number): () => number {
    let a = seed;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Starts `count` attacks at `gap` and tallies their styles. */
function tally(attacks: ReturnType<typeof attacksFromStyles>, gap: number, count: number, random = seeded(7)) {
    const attacker = new NpcAttacker(random, attacks);
    const counts: Record<string, number> = {};
    for (let i = 0; i < count; i++) {
        attacker.update(10, gap, 0, true); // the cooldown runs out: an attack starts
        const style = attacker.started?.style;
        if (style) counts[style] = (counts[style] ?? 0) + 1;
        attacker.update(10, gap, 0, true); // it plays out
    }
    return counts;
}

describe("attacks from styles", () => {
    it("play each style's own clip; breath hits in ticks from the release", () => {
        const [melee, fire] = attacksFromStyles(DRAGON, dragonClips(), 1.5);

        expect(melee).toMatchObject({ style: "melee", clip: 0, weight: 5, maxGap: melee.range + melee.lunge });
        expect(fire).toMatchObject({ style: "dragonfire", clip: 1, weight: 1, breaksParry: true, lunge: 0, maxGap: 1 });
        expect(fire.launch).toEqual([0.5, 1.5]);
        expect(fire.hitTimes).toHaveLength(4);
        expect(fire.hitTimes[0]).toBeCloseTo(15 * CLIENT_CYCLE_SECONDS);
        expect(fire.hitTimes[3] - fire.hitTimes[0]).toBeCloseTo(0.6);
        expect(fire.hitPow).toEqual([0.5, 0.5, 0.5, 0.5]);
        expect(fire.total).toBeCloseTo(15 * CLIENT_CYCLE_SECONDS + 0.8);
    });

    it("split a style's weight over its clips and fall back to the melee clip", () => {
        const clips = [attackClip([10], 5), attackClip([10], 5, false, "ranged"), attackClip([10], 6, false, "ranged")];
        const attacks = attacksFromStyles(
            [
                { style: "melee", weight: 1, hitPow: 0.7, minGap: 0 },
                { style: "ranged", weight: 2, hitPow: 0.5, minGap: 0, maxGap: 8, projectile: { kind: "arrow", speed: 14, color: 0 } },
                { style: "magic", weight: 1, hitPow: 0.5, minGap: 0, maxGap: 8 },
            ],
            clips,
            1.5,
        );

        expect(attacks.filter((a) => a.style === "ranged").map((a) => [a.clip, a.weight])).toEqual([[1, 1], [2, 1]]);
        expect(attacks.find((a) => a.style === "magic")!.clip).toBe(0);
    });

    it("play a plain 1.2 s attack when the model has no clip at all", () => {
        const [attack] = attacksFromStyles([{ style: "magic", weight: 1, hitPow: 0.7, minGap: 0, maxGap: 8 }], [], 1.5);

        expect(attack.clip).toBeUndefined();
        expect(attack.hitTimes).toEqual([0.6]);
        expect(attack.total).toBeCloseTo(1.2);
    });

    it("breathe about one attack in six when next to the player", () => {
        const counts = tally(attacksFromStyles(DRAGON, dragonClips(), 1.5), 0.5, 6000);

        expect(counts.dragonfire / 6000).toBeGreaterThan(1 / 6 - 0.02);
        expect(counts.dragonfire / 6000).toBeLessThan(1 / 6 + 0.02);
        expect(counts.dragonfire + counts.melee).toBe(6000);
    });

    it("start only the attacks whose gap range holds", () => {
        const dragon = attacksFromStyles(DRAGON, dragonClips(), 1.5);
        const rune = attacksFromStyles(
            [DRAGON[0], { ...DRAGON[1], maxGap: 8, projectile: { kind: "fireball", speed: 9, color: 0 }, breath: undefined }],
            dragonClips(),
            1.5,
        );
        const shaman = attacksFromStyles(
            [DRAGON[0], { style: "ranged", weight: 1, hitPow: 0.5, minGap: 1, maxGap: 8 }],
            [attackClip([10], 5), attackClip([10], 5, false, "ranged")],
            1.5,
        );

        expect(attacksInReach(0.5, dragon).map((a) => a.style)).toEqual(["melee", "dragonfire"]);
        expect(attacksInReach(1.5, dragon).map((a) => a.style)).toEqual(["melee"]);
        expect(attacksInReach(3, dragon)).toEqual([]);
        expect(attacksInReach(3, rune).map((a) => a.style)).toEqual(["dragonfire"]);
        expect(attacksInReach(0.5, shaman).map((a) => a.style)).toEqual(["melee"]);
        expect(attacksInReach(3, shaman).map((a) => a.style)).toEqual(["ranged"]);
    });

    it("wait longer after a slow attacker's strike", () => {
        const slow = attacksFromStyles([{ style: "melee", weight: 1, hitPow: 0.7, minGap: 0, cooldownScale: 2 }], [attackClip([10], 5)], 1.5);
        const fast = attacksFromStyles([{ style: "melee", weight: 1, hitPow: 0.7, minGap: 0, cooldownScale: 1 }], [attackClip([10], 5)], 1.5);
        const wait = (attacks: typeof slow) => {
            const attacker = new NpcAttacker(() => 0.5, attacks);
            attacker.update(10, 0.5, 0, true);
            attacker.update(10, 0.5, 0, true); // finished: the cooldown restarts
            let t = 0;
            while (!attacker.started && t < 100) {
                attacker.update(0.1, 0.5, 0, true);
                t += 0.1;
            }
            return t;
        };

        expect(wait(slow)).toBeGreaterThan(wait(fast) * 1.8);
    });

    it("know whether an NPC attacks from a distance", () => {
        expect(new NpcAttacker(Math.random, attacksFromStyles(DRAGON, dragonClips(), 1.5)).hasDistanceAttack).toBe(false);
        expect(
            new NpcAttacker(Math.random, attacksFromStyles([{ style: "magic", weight: 1, hitPow: 0.5, minGap: 0, maxGap: 8 }], [], 1.5)).hasDistanceAttack,
        ).toBe(true);
        expect(new NpcAttacker().hasDistanceAttack).toBe(false);
    });
});
