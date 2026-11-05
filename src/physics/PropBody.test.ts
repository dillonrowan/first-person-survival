import { describe, expect, it } from "vitest";

import { tuning } from "../combat/tuning";
import { CollisionFlag } from "../world/WorldFormat";
import { PropBody, PropWorld, WorldImpact, collideBodies } from "./PropBody";
import type { Box } from "./TileColliders";

const flat: PropWorld = { flagsAt: () => 0, groundHeight: () => 0, hasFloor: () => true };

function run(body: PropBody, world: PropWorld, seconds: number, impacts: WorldImpact[] = []): void {
    const boxes: Box[] = [];
    for (let t = 0; t < seconds; t += 1 / 60) {
        body.step(1 / 60, world, boxes, impacts, () => 0.5);
    }
}

describe("prop bodies (spec 19.10)", () => {
    it("falls, lands with an impact and goes to sleep", () => {
        const body = new PropBody(10.5, 10.5, 2, 0, 0.3, 0.8, 40);
        body.wake();
        const impacts: WorldImpact[] = [];
        run(body, flat, 3, impacts);
        expect(body.z).toBe(0);
        expect(body.asleep).toBe(true);
        expect(impacts.length).toBeGreaterThan(0);
        // A two-tile drop lands at about sqrt(2 g h).
        expect(impacts[0].speed).toBeCloseTo(Math.sqrt(2 * tuning.gravity * 2), 0);
    });

    it("slides about v² / (2 μ g) under friction", () => {
        const body = new PropBody(10.5, 10.5, 0, 0, 0.3, 0.8, 40);
        body.applyImpulse(40 * 3.43, 0);
        run(body, flat, 3);
        const expected = (3.43 * 3.43) / (2 * tuning.propFriction * tuning.gravity);
        expect(body.x - 10.5).toBeCloseTo(expected, 1);
    });

    it("bounces off a wall with the restitution, losing speed", () => {
        const wall = (_p: number, x: number) => (x === 12 ? CollisionFlag.OBJECT : 0);
        const world = { ...flat, flagsAt: wall };
        const body = new PropBody(10.5, 10.5, 0, 0, 0.3, 0.8, 40);
        body.applyImpulse(40 * 8, 0);
        const impacts: WorldImpact[] = [];
        run(body, world, 0.3, impacts);
        expect(body.x).toBeLessThan(12 - 0.3);
        expect(impacts.some((i) => i.speedLoss > 4)).toBe(true);
        expect(body.vx).toBeLessThanOrEqual(0);
    });

    it("never tunnels through a wall when thrown very fast", () => {
        const wall = (_p: number, x: number) => (x === 12 ? CollisionFlag.OBJECT : 0);
        const body = new PropBody(10.5, 10.5, 0.5, 0, 0.3, 0.8, 5);
        body.applyImpulse(5 * 50, 0);
        run(body, { ...flat, flagsAt: wall }, 1);
        expect(body.x).toBeLessThan(12);
    });

    it("exchanges momentum between colliding bodies by mass", () => {
        const a = new PropBody(10, 10, 0, 0, 0.3, 0.8, 10);
        const b = new PropBody(10.55, 10, 0, 0, 0.3, 0.8, 40);
        a.vx = 5;
        const result = collideBodies(a, b, 0.25, (body, dx, dy) => {
            body.x += dx;
            body.y += dy;
        });
        expect(result).toBeDefined();
        expect(b.vx).toBeGreaterThan(0);
        expect(a.vx).toBeLessThan(5);
        // Momentum is conserved.
        expect(a.vx * 10 + b.vx * 40).toBeCloseTo(50, 6);
        expect(b.x - a.x).toBeGreaterThanOrEqual(0.6 - 1e-9);
    });
});
