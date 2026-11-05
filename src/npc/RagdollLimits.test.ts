import { describe, expect, it } from "vitest";

import {
    Vec3,
    axisAngle,
    clampDirection,
    dot,
    fitRotation,
    includePose,
    learnJointLimit,
    mul,
    twistAbout,
    twistExcess,
    unit,
} from "./RagdollLimits";

const DEG = Math.PI / 180;
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Direction `angle` from straight down (−y) towards +z, in the y–z plane. */
const swing = (angle: number): Vec3 => [0, -Math.cos(angle), Math.sin(angle)];

describe("ragdoll joint limits (spec 20.4)", () => {
    it("finds the rotation between two poses of a rigid part, even half a turn", () => {
        const points = [0.3, 0, 0, -0.1, 0.2, 0, 0, -0.1, 0.4, -0.2, -0.1, -0.4];
        for (const [axis, angle] of [[unit([1, 2, 3]), 40 * DEG], [unit([0, 1, 0]), 170 * DEG]] as const) {
            const r = axisAngle(axis, angle);
            const moved: number[] = [];
            for (let i = 0; i < points.length; i += 3) {
                moved.push(...mul(r, [points[i], points[i + 1], points[i + 2]]));
            }
            const fit = fitRotation(points, moved, IDENTITY);
            expect(fit.misfit).toBeLessThan(1e-6);
            fit.r.forEach((x, k) => expect(x).toBeCloseTo(r[k], 4));
        }
    });

    it("tells a part that deforms from one that turns", () => {
        const points = [0.3, 0, 0, -0.3, 0, 0, 0, 0.3, 0, 0, -0.3, 0];
        const squashed = [0.3, 0, 0, -0.3, 0, 0, 0, 0.05, 0, 0, -0.05, 0];
        expect(fitRotation(points, squashed, IDENTITY).misfit).toBeGreaterThan(0.1);
    });

    it("measures twist about a limb's own axis", () => {
        const axis: Vec3 = [0, -1, 0];
        // The child turned 30° about its own (downward) axis, the parent not at all.
        expect(twistAbout(IDENTITY, axisAngle(axis, 30 * DEG), axis)).toBeCloseTo(30 * DEG, 5);
        // A bend about a crosswise axis is no twist.
        expect(twistAbout(IDENTITY, axisAngle([1, 0, 0], 50 * DEG), axis)).toBeCloseTo(0, 5);
    });

    it("learns a hinge from a walk: a knee bends on the way it bends, and hardly the other way", () => {
        // The walk folds the shin back 0…60° from hanging straight down.
        const samples = [0, 15, 30, 45, 60].map((a) => ({ dir: swing(a * DEG), twist: 0 }));
        const limit = learnJointLimit(samples, swing(0));
        expect(clampDirection(limit, swing(0))).toBeUndefined();
        expect(clampDirection(limit, swing(90 * DEG))).toBeUndefined();
        // Past the walk's 60°, as far as Dark Messiah's knee (100°)…
        expect(clampDirection(limit, swing(95 * DEG))).toBeUndefined();
        // …but backwards only its 10°.
        expect(clampDirection(limit, swing(-5 * DEG))).toBeUndefined();
        const back = clampDirection(limit, swing(-40 * DEG));
        expect(back).toBeDefined();
        // Clamped to about 10° back.
        expect(Math.acos(dot(back!, swing(-10 * DEG))) / DEG).toBeLessThan(6);
    });

    it("clamps a limb pointing behind its range back the short way", () => {
        const limit = learnJointLimit([0, 20, 40].map((a) => ({ dir: swing(a * DEG), twist: 0 })), swing(0));
        // Straight up, a little to +z: behind the range, nearer its +z end.
        const d = unit([0, 1, 0.3]);
        const clamped = clampDirection(limit, d)!;
        expect(clamped[2]).toBeGreaterThan(0);
    });

    it("keeps twists inside the range the animations show, and treats twists near ±180° as neighbours", () => {
        const limit = learnJointLimit([10, 20].map((t) => ({ dir: swing(0), twist: t * DEG })), swing(0));
        expect(twistExcess(limit, 15 * DEG)).toBe(0);
        expect(twistExcess(limit, 80 * DEG)).toBeGreaterThan(0);
        expect(twistExcess(limit, -60 * DEG)).toBeLessThan(0);
        const wrapped = learnJointLimit([170, -170].map((t) => ({ dir: swing(0), twist: t * DEG })), swing(0));
        // 0 (rest) and ±170° are all inside one arc through ±180°, not 340° wide through 0.
        expect(wrapped.twistMax - wrapped.twistMin).toBeLessThan(260 * DEG);
        expect(twistExcess(wrapped, 179 * DEG)).toBe(0);
    });

    it("widens a limit to hold the pose a body starts in", () => {
        const limit = learnJointLimit([0, 10].map((a) => ({ dir: swing(a * DEG), twist: 0 })), swing(0));
        const start = unit([0.5, -1, 0]);
        expect(clampDirection(limit, start)).toBeDefined();
        includePose(limit, start, 0, 0.05);
        expect(clampDirection(limit, start)).toBeUndefined();
    });
});
