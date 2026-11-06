import { describe, expect, it } from "vitest";

import { BodyRig, HitReactions, fitHumanoid, movePoint } from "./HitPose";
import { HIT_BONES, HIT_CLIPS, HIT_RIG_JOINTS } from "./HitClips";

type Part = { parent: number; pivot: [number, number, number]; centre: [number, number, number] };

/** A model of box-shaped parts (tiles, three.js axes, facing +z). */
function model(parts: Part[]) {
    const base: number[] = [];
    const partOf: number[] = [];
    parts.forEach((p, i) => {
        for (const dx of [-0.04, 0.04]) {
            for (const dy of [-0.04, 0.04]) {
                for (const dz of [-0.04, 0.04]) {
                    base.push(p.centre[0] + dx, p.centre[1] + dy, p.centre[2] + dz);
                    partOf.push(i);
                }
            }
        }
    });
    const skeleton = {
        parents: Int8Array.from(parts.map((p) => p.parent)),
        pivots: Int16Array.from(parts.flatMap((p) => [p.pivot[0] * 128, -p.pivot[1] * 128, -p.pivot[2] * 128].map(Math.round))),
        partOf: Uint8Array.from(partOf),
    };
    return new BodyRig({ vertexCount: partOf.length, skeleton }, Float32Array.from(base));
}

/** Guard-like body: pelvis root, torso, head, two 3-part arms and legs, a sword in the right hand. */
const GUARD: Part[] = [
    { parent: -1, pivot: [0, 0.8, 0], centre: [0, 0.8, 0] },
    { parent: 0, pivot: [0, 0.86, 0], centre: [0, 1.1, 0] },
    { parent: 0, pivot: [-0.12, 0.75, 0], centre: [-0.12, 0.55, 0] },
    { parent: 0, pivot: [0.12, 0.75, 0], centre: [0.12, 0.55, 0] },
    { parent: 1, pivot: [0, 1.32, 0], centre: [0, 1.42, 0.05] },
    { parent: 1, pivot: [-0.2, 1.22, 0], centre: [-0.21, 1.1, 0] },
    { parent: 1, pivot: [0.2, 1.22, 0], centre: [0.21, 1.1, 0] },
    { parent: 2, pivot: [-0.12, 0.42, 0], centre: [-0.12, 0.2, 0] },
    { parent: 3, pivot: [0.12, 0.42, 0], centre: [0.12, 0.2, 0] },
    { parent: 5, pivot: [-0.22, 1.0, 0], centre: [-0.23, 0.9, 0] },
    { parent: 6, pivot: [0.22, 1.0, 0], centre: [0.23, 0.9, 0] },
    { parent: 7, pivot: [-0.12, 0.05, 0], centre: [-0.12, 0.03, 0.08] },
    { parent: 8, pivot: [0.12, 0.05, 0], centre: [0.12, 0.03, 0.08] },
    { parent: 9, pivot: [-0.24, 0.78, 0], centre: [-0.25, 0.72, 0.02] },
    { parent: 10, pivot: [0.24, 0.78, 0], centre: [0.25, 0.72, 0.02] },
    { parent: 13, pivot: [-0.25, 0.75, 0.05], centre: [-0.25, 0.9, 0.3] },
];

const bone = (name: (typeof HIT_BONES)[number]) => HIT_BONES.indexOf(name);

/** Where `part`'s centre is drawn after the reaction's motion. */
function moved(rig: BodyRig, reactions: HitReactions, part: number): [number, number, number] {
    const out = { q: new Float32Array(rig.partCount * 4), t: new Float32Array(rig.partCount * 3) };
    reactions.motion(undefined, 0, out);
    return movePoint(out.q, out.t, part, [rig.centroids[part * 3], rig.centroids[part * 3 + 1], rig.centroids[part * 3 + 2]]);
}

function play(reactions: HitReactions, seconds: number): void {
    for (let t = 0; t < seconds; t += 1 / 60) {
        reactions.update(1 / 60);
    }
}

describe("fitHumanoid", () => {
    it("fits the rig to a humanoid body, gear riding on the hand", () => {
        const h = model(GUARD).humanoid!;
        expect(h).toBeDefined();
        const boneOf = (part: number) => HIT_BONES[h.boneOfPart[part]];
        expect([0, 1, 4, 5, 9, 13, 6, 2, 7, 11, 3].map(boneOf)).toEqual([
            "pelvis", "spine", "head", "upperarm.R", "forearm.R", "hand.R", "upperarm.L", "thigh.R", "shin.R", "foot.R", "thigh.L",
        ]);
        expect(boneOf(15)).toBe("hand.R");
        // The pelvis turns about the middle of the hips.
        Array.from(h.joints.slice(0, 3)).forEach((v, k) => expect(v).toBeCloseTo([0, 0.75, 0][k], 2));
    });

    it("handles a chest root with the legs hanging from it", () => {
        // Skeleton-style: the root is the chest, a pelvis piece and the legs hang off it.
        const parts: Part[] = [
            { parent: -1, pivot: [0, 1.15, 0], centre: [0, 1.15, 0] },
            { parent: 0, pivot: [0, 1.32, 0], centre: [0, 1.42, 0.05] },
            { parent: 0, pivot: [-0.2, 1.22, 0], centre: [-0.21, 1.1, 0] },
            { parent: 0, pivot: [0.2, 1.22, 0], centre: [0.21, 1.1, 0] },
            { parent: 0, pivot: [-0.12, 0.75, 0], centre: [-0.12, 0.55, 0] },
            { parent: 0, pivot: [0.12, 0.75, 0], centre: [0.12, 0.55, 0] },
            { parent: 0, pivot: [0, 0.82, 0], centre: [0, 0.8, 0] },
            { parent: 2, pivot: [-0.22, 1.0, 0], centre: [-0.24, 0.85, 0] },
            { parent: 3, pivot: [0.22, 1.0, 0], centre: [0.24, 0.85, 0] },
            { parent: 4, pivot: [-0.12, 0.42, 0], centre: [-0.12, 0.2, 0] },
            { parent: 5, pivot: [0.12, 0.42, 0], centre: [0.12, 0.2, 0] },
        ];
        const h = model(parts).humanoid!;
        expect(h).toBeDefined();
        expect(HIT_BONES[h.boneOfPart[0]]).toBe("spine");
        expect(HIT_BONES[h.boneOfPart[6]]).toBe("pelvis");
        expect(HIT_BONES[h.boneOfPart[4]]).toBe("thigh.R");
        // The waist bends just above the hips, not at the chest.
        expect(h.joints[bone("spine") * 3 + 1]).toBeLessThan(0.95);
    });

    it("rejects a four-legged body", () => {
        const parts: Part[] = [
            { parent: -1, pivot: [0, 0.6, 0], centre: [0, 0.6, 0] },
            { parent: 0, pivot: [0, 0.7, 0.45], centre: [0, 0.75, 0.6] },
            { parent: 0, pivot: [-0.15, 0.55, 0.35], centre: [-0.15, 0.3, 0.35] },
            { parent: 0, pivot: [0.15, 0.55, 0.35], centre: [0.15, 0.3, 0.35] },
            { parent: 0, pivot: [-0.15, 0.55, -0.35], centre: [-0.15, 0.3, -0.35] },
            { parent: 0, pivot: [0.15, 0.55, -0.35], centre: [0.15, 0.3, -0.35] },
            { parent: 2, pivot: [-0.15, 0.25, 0.35], centre: [-0.15, 0.05, 0.35] },
            { parent: 3, pivot: [0.15, 0.25, 0.35], centre: [0.15, 0.05, 0.35] },
            { parent: 4, pivot: [-0.15, 0.25, -0.35], centre: [-0.15, 0.05, -0.35] },
            { parent: 5, pivot: [0.15, 0.25, -0.35], centre: [0.15, 0.05, -0.35] },
        ];
        const rig = model(parts);
        expect(rig.humanoid).toBeUndefined();
        expect(fitHumanoid(rig.parents, rig.pivots, rig.centroids, rig.sizes, rig.height)).toBeUndefined();
    });
});

describe("hit clips", () => {
    type Kind = "pelvis" | "spine" | "head" | "upperarm" | "forearm" | "hand" | "thigh" | "shin" | "foot";
    // Largest turn and twist about a limb's own length (degrees) a human joint takes in a hit.
    const RANGE: Record<Kind, number> = { pelvis: 20, spine: 45, head: 50, upperarm: 110, forearm: 130, hand: 40, thigh: 80, shin: 120, foot: 50 };
    const TWIST: Partial<Record<Kind, number>> = { spine: 25, upperarm: 40, forearm: 20, thigh: 25, shin: 10 };
    /** Flexion sign about the body's side axis (+x): knees bend back, elbows forward. */
    const HINGE: Partial<Record<Kind, number>> = { shin: 1, forearm: -1 };
    const CHILD: Record<string, string> = { spine: "head", "upperarm.R": "forearm.R", "forearm.R": "hand.R", "upperarm.L": "forearm.L", "forearm.L": "hand.L", "thigh.R": "shin.R", "shin.R": "foot.R", "thigh.L": "shin.L", "shin.L": "foot.L" };
    const stride = HIT_BONES.length * 4 + 3;
    const deg = (rad: number) => (rad * 180) / Math.PI;
    const joint = (name: string) => HIT_RIG_JOINTS.slice(bone(name as never) * 3, bone(name as never) * 3 + 3);
    /** Signed turn (degrees) of quaternion q about a unit axis: its twist in a swing-twist split. */
    const twistAbout = (q: number[], axis: number[]) => {
        const p = q[0] * axis[0] + q[1] * axis[1] + q[2] * axis[2];
        return deg(2 * Math.atan2(p, q[3]));
    };

    for (const [name, clip] of Object.entries(HIT_CLIPS)) {
        it(`${name} moves the body like a human's`, () => {
            const problems = new Set<string>();
            for (let f = 0; f < clip.frames; f++) {
                for (const [b, boneName] of HIT_BONES.entries()) {
                    const kind = boneName.split(".")[0] as Kind;
                    let q = Array.from(clip.data.slice(f * stride + b * 4, f * stride + b * 4 + 4));
                    if (q[3] < 0) {
                        q = q.map((v) => -v);
                    }
                    const angle = deg(2 * Math.acos(Math.min(1, q[3])));
                    if (!clip.loop && (f === 0 || f === clip.frames - 1) && angle > 2) {
                        problems.add(`${boneName} not at rest on frame ${f} (${angle.toFixed(0)}°)`);
                    }
                    if (angle > RANGE[kind]) {
                        problems.add(`${boneName} turned ${angle.toFixed(0)}°`);
                    }
                    const child = CHILD[boneName];
                    if (child && TWIST[kind] !== undefined) {
                        const a = joint(boneName);
                        const c = joint(child);
                        const len = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
                        const twist = Math.abs(twistAbout(q, [(c[0] - a[0]) / len, (c[1] - a[1]) / len, (c[2] - a[2]) / len]));
                        if (twist > TWIST[kind]!) {
                            problems.add(`${boneName} twisted ${twist.toFixed(0)}° about its length`);
                        }
                    }
                    const hinge = HINGE[kind];
                    if (hinge && angle > 3) {
                        if (twistAbout(q, [1, 0, 0]) * hinge < -3) {
                            problems.add(`${boneName} bends the wrong way`);
                        }
                        const axis = Math.hypot(q[0], q[1], q[2]);
                        if (deg(Math.acos(Math.min(1, Math.abs(q[0]) / axis))) > 25) {
                            problems.add(`${boneName} turns off its hinge`);
                        }
                    }
                }
            }
            expect([...problems]).toEqual([]);
        });
    }
});

describe("HitReactions", () => {
    it("throws the head back from a frontal push, then recovers", () => {
        const rig = model(GUARD);
        const reactions = new HitReactions(rig, () => 0.9);
        reactions.hit("push", -1, 0, 0.6);
        play(reactions, 0.2);
        const head = moved(rig, reactions, 4);
        expect(head[2]).toBeLessThan(rig.centroids[4 * 3 + 2] - 0.1);
        play(reactions, 1.2);
        expect(reactions.active).toBe(false);
    });

    it("mirrors side hits", () => {
        const rig = model(GUARD);
        const right = new HitReactions(rig);
        right.hit("stagger", 0, -1);
        const left = new HitReactions(rig);
        left.hit("stagger", 0, 1);
        play(right, 0.15);
        play(left, 0.15);
        expect(moved(rig, right, 4)[0]).toBeLessThan(-0.05);
        expect(moved(rig, left, 4)[0]).toBeGreaterThan(0.05);
    });

    it("keeps the body joined at every joint", () => {
        const rig = model(GUARD);
        const reactions = new HitReactions(rig);
        reactions.hit("push", -1, 0.3);
        play(reactions, 0.25);
        const out = { q: new Float32Array(rig.partCount * 4), t: new Float32Array(rig.partCount * 3) };
        reactions.motion(undefined, 0, out);
        const joints = rig.humanoid!.joints;
        for (const [child, parent] of [[9, 5], [13, 9], [7, 2], [11, 7], [4, 1], [5, 1]]) {
            const b = rig.humanoid!.boneOfPart[child];
            const j: [number, number, number] = [joints[b * 3], joints[b * 3 + 1], joints[b * 3 + 2]];
            const a = movePoint(out.q, out.t, child, j);
            const c = movePoint(out.q, out.t, parent, j);
            expect(Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2])).toBeLessThan(1e-3);
        }
    });

    it("bends knees like a human's and never crosses the legs", () => {
        const rig = model(GUARD);
        const h = rig.humanoid!;
        const out = { q: new Float32Array(rig.partCount * 4), t: new Float32Array(rig.partCount * 3) };
        const at = (part: number, b: number): [number, number, number] =>
            movePoint(out.q, out.t, part, [h.joints[b * 3], h.joints[b * 3 + 1], h.joints[b * 3 + 2]]);
        const legs = (side: "R" | "L") => {
            const [thigh, shin, foot] = side === "R" ? [2, 7, 11] : [3, 8, 12];
            return [at(thigh, bone(`thigh.${side}`)), at(shin, bone(`shin.${side}`)), at(foot, bone(`foot.${side}`))];
        };
        const lerp = (a: number[], b: number[], s: number) => a.map((v, k) => v + (b[k] - v) * s);
        const segmentGap = (a: number[][], b: number[][]) => {
            let gap = Infinity;
            for (let i = 0; i <= 10; i++) {
                for (let j = 0; j <= 10; j++) {
                    const p = lerp(a[0], a[1], i / 10);
                    const q = lerp(b[0], b[1], j / 10);
                    gap = Math.min(gap, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
                }
            }
            return gap;
        };
        const check = (reactions: HitReactions, label: string) => {
            for (let t = 0; t < 1.2; t += 1 / 30) {
                reactions.update(1 / 30);
                reactions.motion(undefined, 0, out);
                const sides = { R: legs("R"), L: legs("L") };
                for (const [hip, knee, ankle] of Object.values(sides)) {
                    // The knee's offset from the hip-ankle line: forwards (+z), not sideways.
                    const axis = [ankle[0] - hip[0], ankle[1] - hip[1], ankle[2] - hip[2]];
                    const len = Math.hypot(...axis);
                    const rel = [knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2]];
                    const along = (rel[0] * axis[0] + rel[1] * axis[1] + rel[2] * axis[2]) / (len * len);
                    const off = rel.map((v, k) => v - axis[k] * along);
                    expect(off[2], `${label} knee forward at ${t.toFixed(2)}s`).toBeGreaterThan(-0.01);
                    expect(Math.abs(off[0]), `${label} knee sideways at ${t.toFixed(2)}s`).toBeLessThan(0.06);
                }
                for (const a of [[0, 1], [1, 2]]) {
                    for (const b of [[0, 1], [1, 2]]) {
                        const gap = segmentGap(a.map((i) => sides.R[i]), b.map((i) => sides.L[i]));
                        expect(gap, `${label} legs apart at ${t.toFixed(2)}s`).toBeGreaterThan(0.08);
                    }
                }
            }
        };
        for (const kind of ["flinch", "stagger", "push"] as const) {
            for (const [along, left] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                for (const height of [0.2, 0.6, 0.9]) {
                    for (const coin of [0.2, 0.8]) {
                        const reactions = new HitReactions(rig, () => coin);
                        reactions.hit(kind, along, left, height);
                        check(reactions, `${kind} ${along},${left} @${height}`);
                    }
                }
            }
        }
        const stunned = new HitReactions(rig);
        stunned.setStunned(true);
        check(stunned, "stun");
    });

    it("springs the parts of other bodies back to rest", () => {
        const rig = model([
            { parent: -1, pivot: [0, 0.4, 0], centre: [0, 0.4, 0] },
            { parent: 0, pivot: [0, 0.45, 0.3], centre: [0, 0.5, 0.5] },
            { parent: 0, pivot: [0, 0.4, -0.3], centre: [0, 0.35, -0.6] },
        ]);
        const reactions = new HitReactions(rig);
        reactions.hit("stagger", -1, 0.5, 0.5);
        play(reactions, 0.1);
        expect(Math.hypot(...moved(rig, reactions, 2).map((v, k) => v - rig.centroids[2 * 3 + k]))).toBeGreaterThan(0.02);
        play(reactions, 4);
        expect(reactions.active).toBe(false);
    });
});
