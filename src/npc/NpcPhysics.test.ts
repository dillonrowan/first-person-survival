import { describe, expect, it } from "vitest";

import { CollisionFlag } from "../world/WorldFormat";
import { tuning } from "../combat/tuning";
import { Knockback, deathLaunch, findSnapTile, stepKnockback } from "./NpcPhysics";

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

describe("death launch", () => {
    const speed = (l: { vx: number; vy: number }) => Math.hypot(l.vx, l.vy);
    const quick = 0.7;
    const power = 1.5;

    it("throws the body along the killing blow, with some lift", () => {
        const l = deathLaunch(0.6, -0.8, quick, tuning.npcBaseMass);
        expect(l.vx / speed(l)).toBeCloseTo(0.6);
        expect(l.vy / speed(l)).toBeCloseTo(-0.8);
        expect(speed(l)).toBeGreaterThan(3);
        expect(l.up).toBeGreaterThan(1);
    });

    it("throws harder blows further, up to a limit", () => {
        const base = tuning.npcBaseMass;
        expect(speed(deathLaunch(1, 0, power, base))).toBeGreaterThan(speed(deathLaunch(1, 0, quick, base)));
        expect(speed(deathLaunch(1, 0, 30, base))).toBeCloseTo(speed(deathLaunch(1, 0, tuning.deathLaunchMaxPow, base)));
    });

    it("throws heavier bodies less far, within limits", () => {
        const light = speed(deathLaunch(1, 0, quick, 20));
        const normal = speed(deathLaunch(1, 0, quick, tuning.npcBaseMass));
        const heavy = speed(deathLaunch(1, 0, quick, 2000));
        expect(light).toBeGreaterThan(normal);
        expect(heavy).toBeLessThan(normal);
        expect(heavy).toBeCloseTo(normal * tuning.deathLaunchMassScale[0]);
    });
});
