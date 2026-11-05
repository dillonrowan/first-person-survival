import { describe, expect, it } from "vitest";

import { tuning } from "../combat/tuning";
import type { NpcSkeleton } from "../world/NpcFormat";
import { strikeBody } from "./BodyHits";
import { Ragdoll, RagdollWorld } from "./Ragdoll";

/** No floor within reach: only the bodies and the NPC act. */
const air: RagdollWorld = { flagsAt: () => 0, groundHeight: () => -100 };

/** A torso on a leg (0.4 × 1.6 tiles, joined at the hip), base pose at the origin. */
function figure() {
    const box = (x0: number, x1: number, y0: number, y1: number) => {
        const out: number[][] = [];
        for (const z of [-0.1, 0.1]) {
            for (const y of [y0, y1]) {
                for (const x of [x0, x1]) {
                    out.push([x, y, z]);
                }
            }
        }
        return out;
    };
    const torso = box(-0.2, 0.2, 0.8, 1.6);
    const leg = box(-0.1, 0.1, 0, 0.8);
    const base = Float32Array.from([...torso, ...leg].flat());
    const skeleton: NpcSkeleton = {
        partOf: Uint8Array.from([...torso.map(() => 0), ...leg.map(() => 1)]),
        parents: Int8Array.from([-1, 0]),
        pivots: Int16Array.from([0, -154, 0, 0, -102, 0]),
    };
    return { base, skeleton };
}

function bodyAt(x: number, z: number, mass = 90): Ragdoll {
    const { base, skeleton } = figure();
    const current = base.map((v, i) => (i % 3 === 0 ? v + x : i % 3 === 2 ? v + z : v));
    return new Ragdoll(skeleton, base, current, mass, 0);
}

/** A standing NPC's body at tile (x, y), reaching far up and down so the falling body meets it. */
const standing = (x: number, y: number) => ({ x, y, z: -200, radius: 0.35, height: 400, plane: 0, owner: null });

/** Flies a body along +x into an NPC 1.2 tiles away; returns the first hit, if any. */
function fling(speed: number, canKnockDown = true) {
    const body = bodyAt(100.5, -100.5);
    body.setVelocity(speed, 0, 0);
    const npc = standing(101.7, 100.5);
    for (let f = 0; f < 60; f++) {
        body.step(1 / 60, air);
        const before = body.velocity()[0];
        const hit = strikeBody(body, npc, 90, canKnockDown);
        if (hit) {
            return { hit, before, after: body.velocity()[0], body, npc };
        }
    }
    return { hit: undefined, body, npc };
}

describe("bodies knocking NPCs over (spec 20.7)", () => {
    it("knocks over an NPC it flies into, sharing their momentum", () => {
        const { hit, before, after } = fling(4);
        expect(hit).toBeDefined();
        // Along the flight, away from the body.
        expect(hit!.dirX).toBeGreaterThan(0.9);
        expect(Math.abs(hit!.dirY)).toBeLessThan(0.3);
        // Equal masses: the NPC sets off at half the body's speed, and the body keeps the other half.
        expect(hit!.speed).toBeCloseTo(before! / 2, 1);
        expect(after!).toBeCloseTo(before! / 2, 1);
        // Below 300 u/s it does no damage.
        expect(hit!.damage).toBe(0);
    });

    it("also hurts above 300 u/s, as in Dark Messiah", () => {
        const { hit } = fling(9);
        expect(hit).toBeDefined();
        expect(hit!.damage).toBe(tuning.ragdollHitDamage * tuning.strengthScale);
    });

    it("leaves standing an NPC that a slow body only drifts into, and stops the body at it", () => {
        // 1 tile/s is under 75 u/s.
        const { hit, body, npc } = fling(1);
        expect(hit).toBeUndefined();
        const touch = body.touchCylinder(npc.x, -npc.y, npc.z, npc.z + npc.height, npc.radius);
        // Resting against it at most, not inside it.
        expect(touch?.depth ?? 0).toBeLessThan(0.06);
        expect(body.velocity()[0]).toBeLessThan(0.1);
    });

    it("is stopped by an NPC it may not knock over", () => {
        const { hit, body } = fling(4, false);
        expect(hit).toBeUndefined();
        expect(body.velocity()[0]).toBeLessThan(0.5);
    });

    it("keeps two bodies out of each other, pushing the one it runs into", () => {
        const still = bodyAt(100.5, -100.5);
        const moving = bodyAt(99.4, -100.5);
        moving.setVelocity(4, 0, 0);
        for (let f = 0; f < 40; f++) {
            still.step(1 / 60, air);
            moving.step(1 / 60, air);
            Ragdoll.collide(still, moving);
        }
        // The struck body was set moving the same way; the other did not pass through it.
        expect(still.velocity()[0]).toBeGreaterThan(0.5);
        expect(moving.rootPosition()[0]).toBeLessThan(still.rootPosition()[0] - 0.3);
    });
});
