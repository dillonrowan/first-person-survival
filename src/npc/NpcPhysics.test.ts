import { describe, expect, it } from "vitest";

import { CollisionFlag } from "../world/WorldFormat";
import { Knockback, findSnapTile, stepKnockback } from "./NpcPhysics";

const RADIUS = 0.35;

function run(k: Knockback, world: Parameters<typeof stepKnockback>[3], seconds = 3): number {
    let t = 0;
    while (t < seconds && stepKnockback(k, 0.015, RADIUS, world)) {
        t += 0.015;
    }
    return t;
}

describe("NPC knockback", () => {
    it("slides to a stop under friction", () => {
        const k: Knockback = { x: 100.5, y: 100.5, vx: 0, vy: 4, plane: 0 };
        const t = run(k, { flagsAt: () => 0 });
        expect(t).toBeGreaterThan(0.2);
        expect(t).toBeLessThan(2);
        expect(k.y).toBeGreaterThan(101);
    });

    it("never ends inside a wall, however hard it is pushed", () => {
        const wall = (_p: number, x: number, y: number) => (y === 102 ? CollisionFlag.OBJECT : 0);
        for (const speed of [2, 6, 20, 60]) {
            const k: Knockback = { x: 100.5, y: 100.5, vx: 0.3 * speed, vy: speed, plane: 0 };
            run(k, { flagsAt: wall });
            expect(k.y).toBeLessThanOrEqual(102 - RADIUS + 1e-3);
        }
    });

    it("drops to the plane below when pushed off a floor's edge", () => {
        const k: Knockback = { x: 100.5, y: 100.5, vx: 0, vy: 6, plane: 1 };
        run(k, { flagsAt: () => 0, hasFloor: (plane, _x, y) => plane === 0 || y < 101 });
        expect(k.plane).toBe(0);
    });

    it("settles on the nearest free, unblocked tile", () => {
        const blocked = (_p: number, x: number, y: number) => (x === 100 && y === 101 ? CollisionFlag.OBJECT : 0);
        const taken = new Set(["101,101"]);
        const tile = findSnapTile(100.5, 101.4, 1, 0, blocked, (_p, x, y) => !taken.has(`${x},${y}`));
        expect(tile).not.toEqual({ x: 100, y: 101 });
        expect(tile).not.toEqual({ x: 101, y: 101 });
        expect(Math.hypot(tile.x + 0.5 - 100.5, tile.y + 0.5 - 101.4)).toBeLessThan(1.2);
    });
});
