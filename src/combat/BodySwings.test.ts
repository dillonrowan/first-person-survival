import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { blockPose, chargePose, guardPose, swingPose } from "./BodySwings";
import { MOVE_SETS, timelineFor, type MoveDef } from "./moves";
import { rayDirection, raySign } from "./SwingRay";

const BLADE = new THREE.Vector3(0, 1, 0);
/** Hans's right shoulder in the body's view frame (Avatar.viewFrame, looking level). */
const SHOULDER = new THREE.Vector3(0.144, -0.144, 0.171);
/** Arm length plus how far the shoulder may reach forward (FP_SHOULDER_REACH). */
const MAX_REACH = 0.45 + 0.3;

const sword = MOVE_SETS.sword;
const moves: MoveDef[] = [...sword.quick, ...Object.values(sword.power), sword.rush, sword.fall, sword.huge];

describe("third-person swings", () => {
    it("points the blade along the attack ray as it sweeps", () => {
        for (const move of moves) {
            const timeline = timelineFor(move, 1);
            timeline.rays.forEach((ray, i) => {
                const sign = raySign(ray, move.hits[Math.min(i, move.hits.length - 1)].impact);
                for (const u of [0, 0.5, 1]) {
                    const pose = swingPose(move, timeline, ray.on + u * (ray.off - ray.on), guardPose(0), 0);
                    const d = rayDirection(ray, sign, ray.sweep === 0 ? 0.5 : u);
                    const blade = BLADE.clone().applyQuaternion(pose.quat);
                    expect(blade.dot(new THREE.Vector3(d.x, d.y, -d.z)), `${move.id} ray ${i} at ${u}`).toBeGreaterThan(0.99);
                }
            });
        }
    });

    it("starts from what was drawn and moves without jumps", () => {
        for (const move of moves) {
            const timeline = timelineFor(move, 1);
            const total = timeline.windup + timeline.active + timeline.recovery;
            // A power attack starts from its charge; a quick strike from the guard.
            const start = move.kind === "quick" ? guardPose(0) : chargePose(move, 1, 0);
            const first = swingPose(move, timeline, 0, start, 0);
            expect(first.pos.distanceTo(start.pos)).toBeLessThan(1e-6);
            let last = first;
            for (let e = 0; e <= total; e += 1 / 120) {
                const pose = swingPose(move, timeline, e, start, 0);
                // At 120 fps, never more than about 70° or 0.25 tiles between frames.
                expect(pose.quat.angleTo(last.quat), `${move.id} at ${e.toFixed(3)}`).toBeLessThan(1.2);
                expect(pose.pos.distanceTo(last.pos), `${move.id} at ${e.toFixed(3)}`).toBeLessThan(0.25);
                expect(pose.pos.distanceTo(SHOULDER), `${move.id} at ${e.toFixed(3)}`).toBeLessThan(MAX_REACH);
                last = pose;
            }
        }
    });

    it("keeps the guard and block at the body whatever the view's pitch", () => {
        for (const pose of [guardPose, blockPose]) {
            const level = pose(0);
            const down = pose(-0.8);
            // Turned back from the pitched frame into the body's space, the guard has not moved.
            const unpitched = down.pos.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.8);
            if (pose === guardPose) expect(unpitched.distanceTo(level.pos)).toBeLessThan(1e-6);
            expect(down.pos.distanceTo(SHOULDER.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.8))).toBeLessThan(MAX_REACH);
        }
    });

    it("lowers the guard to an at-ease hold", () => {
        const ready = guardPose(0, 0);
        const ease = guardPose(0, 1);
        expect(ease.pos.y).toBeLessThan(ready.pos.y - 0.1);
        // Blade tipped down at ease, up in the guard.
        expect(BLADE.clone().applyQuaternion(ease.quat).y).toBeLessThan(0);
        expect(BLADE.clone().applyQuaternion(ready.quat).y).toBeGreaterThan(0);
    });
});
