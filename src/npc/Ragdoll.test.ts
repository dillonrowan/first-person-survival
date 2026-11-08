import { describe, expect, it } from "vitest";

import { CollisionFlag } from "../world/WorldFormat";
import type { NpcClip, NpcSkeleton } from "../world/NpcFormat";
import { tuning } from "../combat/tuning";
import { deathLaunch } from "./NpcPhysics";
import { Ragdoll, RagdollWorld, foldPivotlessParts, singlePartSkeleton } from "./Ragdoll";

const flat: RagdollWorld = { flagsAt: () => 0, groundHeight: () => 0 };

/**
 * A standing figure in base-pose model space (three.js axes, tiles): a torso box from 0.8 to 1.6
 * up, and a leg box from 0 to 0.8 hanging from it at the hip (0, 0.8, 0).
 */
function figure() {
    const torso = [
        [-0.2, 0.8, -0.1], [0.2, 0.8, -0.1], [0.2, 1.6, -0.1], [-0.2, 1.6, -0.1],
        [-0.2, 0.8, 0.1], [0.2, 0.8, 0.1], [0.2, 1.6, 0.1], [-0.2, 1.6, 0.1],
    ];
    const leg = [
        [-0.1, 0, -0.1], [0.1, 0, -0.1], [0.1, 0.8, -0.1], [-0.1, 0.8, -0.1],
        [-0.1, 0, 0.1], [0.1, 0, 0.1], [0.1, 0.8, 0.1], [-0.1, 0.8, 0.1],
    ];
    const base = Float32Array.from([...torso, ...leg].flat());
    const skeleton: NpcSkeleton = {
        partOf: Uint8Array.from([...torso.map(() => 0), ...leg.map(() => 1)]),
        parents: Int8Array.from([-1, 0]),
        // Pivots are model units (RS axes, Ã—128, +y down): the hip at height 0.8.
        pivots: Int16Array.from([0, -154, 0, 0, -102, 0]),
    };
    return { base, skeleton, count: 16 };
}

/** The figure placed in the world at (x, height, z), as drawn when the ragdoll starts. */
function placed(base: Float32Array, x: number, y: number, z: number): Float32Array {
    const out = new Float32Array(base.length);
    for (let i = 0; i < base.length; i += 3) {
        out[i] = base[i] + x;
        out[i + 1] = base[i + 1] + y;
        out[i + 2] = base[i + 2] + z;
    }
    return out;
}

/** An axis-aligned box's 8 corners, three.js axes, tiles. */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): number[][] {
    const out: number[][] = [];
    for (const z of [z0, z1]) {
        for (const y of [y0, y1]) {
            for (const x of [x0, x1]) {
                out.push([x, y, z]);
            }
        }
    }
    return out;
}

/** Model units (RS axes, Ã—128, +y down, +z north) of a three.js point. */
const rs = ([x, y, z]: number[]) => [Math.round(x * 128), Math.round(-y * 128), Math.round(-z * 128)];

/**
 * A torso on a thigh on a shin (the knee at 0.4 tiles up), whose walk folds the shin back (its
 * foot towards âˆ’z) by 0â€¦60Â°, as a knee bends.
 */
function legFigure() {
    const torso = box(-0.2, 0.2, 0.8, 1.6, -0.1, 0.1);
    const thigh = box(-0.1, 0.1, 0.4, 0.8, -0.1, 0.1);
    const shin = box(-0.1, 0.1, 0, 0.4, -0.1, 0.1);
    const vertices = [...torso, ...thigh, ...shin];
    const base = Float32Array.from(vertices.flat());
    const skeleton: NpcSkeleton = {
        partOf: Uint8Array.from([...torso.map(() => 0), ...thigh.map(() => 1), ...shin.map(() => 2)]),
        parents: Int8Array.from([-1, 0, 1]),
        pivots: Int16Array.from([...rs([0, 1.2, 0]), ...rs([0, 0.8, 0]), ...rs([0, 0.4, 0])]),
    };
    const angles = [0, 15, 30, 45, 60];
    const positions = new Int16Array(angles.length * vertices.length * 3);
    angles.forEach((deg, f) => {
        const a = (deg * Math.PI) / 180;
        vertices.forEach(([x, y, z], v) => {
            const isShin = v >= 16;
            // Shin turned about the knee's x axis: y' = y cos âˆ’ z sin, z' = y sin + z cos.
            const ry = y - 0.4;
            const p = isShin ? [x, 0.4 + ry * Math.cos(a) - z * Math.sin(a), ry * Math.sin(a) + z * Math.cos(a)] : [x, y, z];
            positions.set(rs(p), (f * vertices.length + v) * 3);
        });
    });
    const walk: NpcClip = { frameLengths: new Uint16Array(angles.length).fill(3), frameStep: 0, positions };
    return { base, skeleton, walk, count: vertices.length };
}

/** Signed bend of the shin from the thigh's line, degrees: positive with the foot forward (+z of the thigh). */
function kneeBend(out: Float32Array): number {
    const mean = (vs: number[]) => [0, 1, 2].map((k) => vs.reduce((s, v) => s + out[v * 3 + k], 0) / vs.length);
    // Thigh vertices 8â€“15 (front face z = +0.1: corners 12â€“15), shin 16â€“23 (bottom y = 0: 16, 17, 20, 21).
    const front = mean([12, 13, 14, 15]);
    const backFace = mean([8, 9, 10, 11]);
    const forward = unit([front[0] - backFace[0], front[1] - backFace[1], front[2] - backFace[2]]);
    const bottom = mean([16, 17, 20, 21]);
    const top = mean([18, 19, 22, 23]);
    const shin = unit([bottom[0] - top[0], bottom[1] - top[1], bottom[2] - top[2]]);
    return (Math.asin(Math.max(-1, Math.min(1, shin[0] * forward[0] + shin[1] * forward[1] + shin[2] * forward[2]))) * 180) / Math.PI;
}

function unit(a: number[]): number[] {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
}

function run(ragdoll: Ragdoll, world: RagdollWorld, seconds: number): void {
    for (let t = 0; t < seconds; t += 1 / 60) {
        ragdoll.step(1 / 60, world);
    }
}

describe("ragdoll (spec 20)", () => {
    it("collapses onto the floor and comes to rest with no vertex below it", () => {
        const { base, skeleton, count } = figure();
        const ragdoll = new Ragdoll(skeleton, base, placed(base, 100.5, 0, -100.5), 90, 0);
        ragdoll.setVelocity(1.5, 0, 0);
        run(ragdoll, flat, 4);
        const out = new Float32Array(count * 3);
        ragdoll.computeWorld(flat, out);
        let highest = -Infinity;
        for (let v = 0; v < count; v++) {
            expect(out[v * 3 + 1]).toBeGreaterThanOrEqual(-1e-4);
            highest = Math.max(highest, out[v * 3 + 1]);
        }
        // Fallen over: nothing is still up at torso height.
        expect(highest).toBeLessThan(1);
        expect(ragdoll.asleep).toBe(true);
    });

    it("does not jump off the floor when it starts standing on it", () => {
        const { base, skeleton, count } = figure();
        const ragdoll = new Ragdoll(skeleton, base, placed(base, 100.5, 0, -100.5), 90, 0);
        ragdoll.settleOnFloor(flat);
        const out = new Float32Array(count * 3);
        for (let frame = 0; frame < 120; frame++) {
            ragdoll.step(1 / 60, flat);
            ragdoll.computeWorld(flat, out);
            let lowest = Infinity;
            let highest = -Infinity;
            for (let v = 0; v < count; v++) {
                lowest = Math.min(lowest, out[v * 3 + 1]);
                highest = Math.max(highest, out[v * 3 + 1]);
            }
            if (frame < 20) {
                // Standing on the floor at the start, it stays there while it begins to tip.
                expect(lowest).toBeLessThan(0.05);
            }
            // It never rises above its standing height (1.6 tiles plus the particle radius).
            expect(highest).toBeLessThan(1.7);
        }
    });

    it("keeps its parts rigid and joined at the hip", () => {
        const { base, skeleton, count } = figure();
        const ragdoll = new Ragdoll(skeleton, base, placed(base, 100.5, 0, -100.5), 90, 0);
        ragdoll.setVelocity(3, 2, 0);
        run(ragdoll, flat, 2);
        const out = new Float32Array(count * 3);
        ragdoll.computeWorld(flat, out);
        const dist = (a: number, b: number) =>
            Math.hypot(out[a * 3] - out[b * 3], out[a * 3 + 1] - out[b * 3 + 1], out[a * 3 + 2] - out[b * 3 + 2]);
        // Torso diagonal and leg length keep their size.
        expect(dist(0, 6)).toBeCloseTo(Math.hypot(0.4, 0.8, 0.2), 1);
        expect(dist(8, 10)).toBeCloseTo(Math.hypot(0.2, 0.8), 1);
    });

    it("is stopped by walls", () => {
        const { base, skeleton, count } = figure();
        // A blocked tile column at x = 102.
        const world: RagdollWorld = { ...flat, flagsAt: (_p, x) => (x === 102 ? CollisionFlag.OBJECT : 0) };
        const ragdoll = new Ragdoll(skeleton, base, placed(base, 101.5, 0, -100.5), 90, 0);
        ragdoll.setVelocity(8, 0, 0);
        run(ragdoll, world, 2);
        const out = new Float32Array(count * 3);
        ragdoll.computeWorld(world, out);
        for (let v = 0; v < count; v++) {
            expect(out[v * 3]).toBeLessThan(102.15);
        }
    });

    it("folds parts that only spin on their joint, and tiny parts, into their parents", () => {
        const { base, skeleton } = figure();
        // A third part: one vertex group of 8 at the hip, with its joint at its own centre.
        const extra = Array.from({ length: 8 }, (_, i) => [0.05 * (i & 1), 0.8, 0.05 * ((i >> 1) & 1)]).flat();
        const wide = Float32Array.from([...base, ...extra]);
        const folded = foldPivotlessParts(
            {
                partOf: Uint8Array.from([...skeleton.partOf, ...new Array(8).fill(2)]),
                parents: Int8Array.from([-1, 0, 0]),
                pivots: Int16Array.from([...skeleton.pivots, 3, -102, 3]),
            },
            wide,
        );
        expect(folded.parents.length).toBe(2);
        // The folded vertices now belong to the torso, the leg is untouched.
        expect(folded.partOf[16]).toBe(0);
        expect(folded.partOf[8]).toBe(1);
    });

    it("comes to rest and sleeps within a few seconds", () => {
        const { base, skeleton } = figure();
        const ragdoll = new Ragdoll(skeleton, base, placed(base, 100.5, 0, -100.5), 90, 0);
        ragdoll.settleOnFloor(flat);
        ragdoll.setVelocity(2, 0, 1);
        run(ragdoll, flat, 5);
        expect(ragdoll.asleep).toBe(true);
    });

    it("bends a knee the way its walk bends it, and not backwards (spec 20.4)", () => {
        const { base, skeleton, walk, count } = legFigure();
        // In the air, so only the joints act.
        const air: RagdollWorld = { flagsAt: () => 0, groundHeight: () => -100 };
        const kicked = (vz: number) => {
            const ragdoll = new Ragdoll(skeleton, base, placed(base, 100.5, 0, -100.5), 90, 0, [undefined, walk]);
            // Kick the shin's particles (below the knee) along z.
            for (let i = 0; i < ragdoll.pos.length; i += 3) {
                if (ragdoll.pos[i + 1] < 0.39) {
                    ragdoll.prev[i + 2] = ragdoll.pos[i + 2] - vz / 120;
                }
            }
            const out = new Float32Array(count * 3);
            let most = 0;
            for (let f = 0; f < 40; f++) {
                ragdoll.step(1 / 60, air);
                ragdoll.computeWorld(air, out);
                const bend = kneeBend(out);
                most = Math.abs(bend) > Math.abs(most) ? bend : most;
            }
            return most;
        };
        // Kicked forward: the knee would have to bend backwards. It stops about 10Â° past straight.
        expect(kicked(8)).toBeLessThan(20);
        // Kicked back, it folds the way it folds when walking, well past straight.
        expect(kicked(-8)).toBeLessThan(-45);
    });

    it("learns the same limits for every body of a model, and lets each start in its own pose", () => {
        const { base, skeleton, walk } = legFigure();
        const a = new Ragdoll(skeleton, base, placed(base, 100.5, 0, -100.5), 90, 0, [undefined, walk]);
        const b = new Ragdoll(skeleton, base, placed(base, 100.5, 0, -100.5), 90, 0, [undefined, walk]);
        expect(a.limits[2]).toBeDefined();
        expect(b.limits[2]).toEqual(a.limits[2]);
        // Each ragdoll owns its limits: widening one for its start pose leaves the other alone.
        expect(b.limits[2]).not.toBe(a.limits[2]);
    });

    it("keeps body parts out of each other (spec 20.5)", () => {
        // A torso with two legs side by side (x = Â±0.15, 0.2 wide), the right one starting swung
        // 12Â° across into the left one.
        const torso = box(-0.3, 0.3, 0.8, 1.6, -0.1, 0.1);
        const left = box(-0.25, -0.05, 0, 0.8, -0.1, 0.1);
        const right = box(0.05, 0.25, 0, 0.8, -0.1, 0.1);
        const base = Float32Array.from([...torso, ...left, ...right].flat());
        const skeleton: NpcSkeleton = {
            partOf: Uint8Array.from([...torso.map(() => 0), ...left.map(() => 1), ...right.map(() => 2)]),
            parents: Int8Array.from([-1, 0, 0]),
            pivots: Int16Array.from([...rs([0, 1.2, 0]), ...rs([-0.15, 0.8, 0]), ...rs([0.15, 0.8, 0])]),
        };
        const a = (-12 * Math.PI) / 180;
        const current = placed(base, 100.5, 0, -100.5);
        for (let v = 16; v < 24; v++) {
            const x = base[v * 3] - 0.15;
            const y = base[v * 3 + 1] - 0.8;
            current[v * 3] = 100.5 + 0.15 + x * Math.cos(a) - y * Math.sin(a);
            current[v * 3 + 1] = 0.8 + x * Math.sin(a) + y * Math.cos(a);
        }
        const feet = (out: Float32Array) => {
            const mean = (vs: number[]) => [0, 1, 2].map((k) => vs.reduce((s, v) => s + out[v * 3 + k], 0) / vs.length);
            const l = mean([8, 9, 12, 13]);
            const r = mean([16, 17, 20, 21]);
            return Math.hypot(l[0] - r[0], l[1] - r[1], l[2] - r[2]);
        };
        expect(feet(current)).toBeLessThan(0.15);
        const ragdoll = new Ragdoll(skeleton, base, current, 90, 0);
        ragdoll.settleOnFloor(flat);
        run(ragdoll, flat, 1);
        const out = new Float32Array(24 * 3);
        ragdoll.computeWorld(flat, out);
        // Pushed apart to about where their spheres (radius â‰ˆ 0.14) touch.
        expect(feet(out)).toBeGreaterThan(0.22);
    });

    it("settles within two seconds of a shove (spec 20.6)", () => {
        const { base, skeleton, walk } = legFigure();
        for (const [vx, vz] of [[3, 0.5], [-2, 2], [6, -1]]) {
            const ragdoll = new Ragdoll(skeleton, base, placed(base, 100.5, 0, -100.5), 90, 0, [undefined, walk]);
            ragdoll.settleOnFloor(flat);
            ragdoll.setVelocity(vx, 0, vz);
            run(ragdoll, flat, 2.2);
            expect(ragdoll.asleep).toBe(true);
        }
    });

    it("moves the same far out on the map as at its origin", () => {
        const { base, skeleton, count } = figure();
        const fall = (x: number, z: number) => {
            const ragdoll = new Ragdoll(skeleton, base, placed(base, x, 0, z), 90, 0);
            ragdoll.settleOnFloor(flat);
            ragdoll.setVelocity(1.5, 0, 0.5);
            run(ragdoll, flat, 0.75);
            const out = new Float32Array(count * 3);
            ragdoll.computeWorld(flat, out);
            return Array.from(out, (v, i) => (i % 3 === 0 ? v - x : i % 3 === 2 ? v - z : v));
        };
        const near = fall(0.5, -0.5);
        const far = fall(3200.5, -3200.5);
        near.forEach((v, i) => expect(Math.abs(v - far[i])).toBeLessThan(0.02));
    });

    it("holds the skin together where no joint does (spec 20.8)", () => {
        // As in a giant rat: hips (the root), a tail behind them that wags ±60° in the walk, and
        // a chest in front that hangs from the tail (its joint at the hips' front), so its learned
        // limits are as wide as the wag. The mesh joins the chest straight to the hips.
        const hips = box(-0.2, 0.2, 0.4, 0.8, -0.6, 0);
        const tail = box(-0.05, 0.05, 0.55, 0.65, -1.4, -0.6);
        const chest = box(-0.2, 0.2, 0.4, 0.8, 0, 0.6);
        const vertices = [...hips, ...tail, ...chest];
        const base = Float32Array.from(vertices.flat());
        const skeleton: NpcSkeleton = {
            partOf: Uint8Array.from([...hips.map(() => 0), ...tail.map(() => 1), ...chest.map(() => 2)]),
            parents: Int8Array.from([-1, 0, 1]),
            pivots: Int16Array.from([...rs([0, 0.6, -0.3]), ...rs([0, 0.6, -0.6]), ...rs([0, 0.6, 0])]),
        };
        const angles = [-60, -30, 0, 30, 60];
        const positions = new Int16Array(angles.length * vertices.length * 3);
        angles.forEach((deg, f) => {
            const a = (deg * Math.PI) / 180;
            vertices.forEach(([x, y, z], v) => {
                // The tail turns about the vertical through its root (0, ·, −0.6).
                const p = v >= 8 && v < 16 ? [x * Math.cos(a) + (z + 0.6) * Math.sin(a), y, -0.6 - x * Math.sin(a) + (z + 0.6) * Math.cos(a)] : [x, y, z];
                positions.set(rs(p), (f * vertices.length + v) * 3);
            });
        });
        const walk: NpcClip = { frameLengths: new Uint16Array(angles.length).fill(3), frameStep: 0, positions };
        // Box corners: index z·4 + y·2 + x. Hips' front face (z = 0): 4–7; chest's back face: 16–19.
        const seam = [[4, 16], [5, 17], [6, 18], [7, 19]];
        const skin = {
            indices: Uint32Array.from([4, 5, 16, 5, 17, 16, 6, 7, 18, 7, 19, 18, 4, 6, 16, 6, 18, 16, 5, 7, 17, 7, 19, 17]),
            sources: Uint16Array.from({ length: 24 }, (_, v) => v),
        };
        const air: RagdollWorld = { flagsAt: () => 0, groundHeight: () => -100 };
        const stretch = (withSkin: boolean) => {
            const ragdoll = new Ragdoll(skeleton, base, placed(base, 100.5, 0, -100.5), 90, 0, [undefined, walk], withSkin ? [skin] : []);
            // Swat the chest sideways. Particles are relative to the ragdoll's origin; particle 0
            // is the root's centroid.
            const originZ = ragdoll.rootPosition()[2] - ragdoll.pos[2];
            for (let i = 0; i < ragdoll.pos.length; i += 3) {
                if (ragdoll.pos[i + 2] + originZ > -100.5 + 0.05) {
                    ragdoll.prev[i] = ragdoll.pos[i] - 8 / 120;
                }
            }
            const out = new Float32Array(24 * 3);
            let most = 0;
            for (let f = 0; f < 40; f++) {
                ragdoll.step(1 / 60, air);
                ragdoll.computeWorld(air, out);
                for (const [a, b] of seam) {
                    const now = Math.hypot(out[a * 3] - out[b * 3], out[a * 3 + 1] - out[b * 3 + 1], out[a * 3 + 2] - out[b * 3 + 2]);
                    const rest = Math.hypot(base[a * 3] - base[b * 3], base[a * 3 + 1] - base[b * 3 + 1], base[a * 3 + 2] - base[b * 3 + 2]);
                    most = Math.max(most, now - rest);
                }
            }
            return most;
        };
        // Without the skin the chest swings off the hips and tears the seam open (about a tile)...
        expect(stretch(false)).toBeGreaterThan(0.5);
        // ...with it, the seam stretches about as far as the ligaments allow (0.05).
        expect(stretch(true)).toBeLessThan(0.1);
    });

    it("starts each part where it is drawn, even one whose folded-in segment is bent", () => {
        // A torso with a 4-vertex tail along −z (folded into it), drawn with the tail swung up.
        const torso = box(-0.2, 0.2, 0.8, 1.6, -0.1, 0.1);
        const tail = [[0, 1, -0.1], [0.03, 1, -0.1], [0, 1, -0.9], [0.03, 1, -0.9]];
        const leg = box(-0.1, 0.1, 0, 0.8, -0.1, 0.1);
        const base = Float32Array.from([...torso, ...tail, ...leg].flat());
        const skeleton: NpcSkeleton = {
            partOf: Uint8Array.from([...torso.map(() => 0), ...tail.map(() => 1), ...leg.map(() => 2)]),
            parents: Int8Array.from([-1, 0, 0]),
            pivots: Int16Array.from([...rs([0, 1.2, 0]), ...rs([0, 1, -0.1]), ...rs([0, 0.8, 0])]),
        };
        const current = placed(base, 100.5, 0, -100.5);
        // Tail swung straight up about its root (0, 1, −0.1).
        for (let v = 8; v < 12; v++) {
            const dz = base[v * 3 + 2] + 0.1;
            current[v * 3 + 1] = 1 - dz;
            current[v * 3 + 2] = -100.5 - 0.1;
        }
        const ragdoll = new Ragdoll(skeleton, base, current, 90, 0);
        const out = new Float32Array(base.length);
        ragdoll.computeWorld({ flagsAt: () => 0, groundHeight: () => -100 }, out);
        // The torso is drawn where it was, not turned to follow the tail's tip.
        for (let v = 0; v < 8; v++) {
            for (let k = 0; k < 3; k++) {
                expect(Math.abs(out[v * 3 + k] - current[v * 3 + k])).toBeLessThan(0.01);
            }
        }
    });

    it("falls as one rigid body without a skeleton", () => {
        const { base, count } = figure();
        const ragdoll = new Ragdoll(singlePartSkeleton(base, count), base, placed(base, 100.5, 0.5, -100.5), 90, 0);
        run(ragdoll, flat, 3);
        expect(ragdoll.partCount).toBe(1);
        const out = new Float32Array(count * 3);
        ragdoll.computeWorld(flat, out);
        for (let v = 0; v < count; v++) {
            expect(out[v * 3 + 1]).toBeGreaterThanOrEqual(-1e-4);
        }
    });

    it("is thrown well along a killing blow by the death launch, further by a harder one", () => {
        const { base, skeleton } = figure();
        /** Killed by a blow towards +x (three.js), as Npc.startRagdoll starts the body; tiles moved. */
        const thrown = (hitPow: number | undefined) => {
            const ragdoll = new Ragdoll(skeleton, base, placed(base, 100.5, 0, -100.5), tuning.npcBaseMass, 0);
            ragdoll.settleOnFloor(flat);
            ragdoll.setVelocity(0, 0, 0);
            ragdoll.applyImpulse(tuning.deathForce, 0, 0);
            if (hitPow !== undefined) {
                const launch = deathLaunch(1, 0, hitPow, tuning.npcBaseMass);
                ragdoll.addVelocity(launch.vx, launch.up, -launch.vy);
            }
            const [x0, , z0] = ragdoll.rootPosition();
            run(ragdoll, flat, 4);
            expect(ragdoll.asleep).toBe(true);
            const [x1, , z1] = ragdoll.rootPosition();
            expect(Math.abs(z1 - z0)).toBeLessThan(0.3);
            return x1 - x0;
        };
        // The death impulse alone hardly moves a body; the launch throws it.
        expect(thrown(undefined)).toBeLessThan(0.2);
        const quick = thrown(0.7);
        const power = thrown(1.5);
        expect(quick).toBeGreaterThan(1.5);
        expect(power).toBeGreaterThan(quick + 0.3);
    });
});
