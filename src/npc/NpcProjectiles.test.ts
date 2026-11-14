import { describe, expect, it } from "vitest";

import { fallbackCombatStats } from "../combat/Osrs";
import type { FlagsAt } from "../physics/TileColliders";
import { CollisionFlag } from "../world/WorldFormat";
import { NpcProjectile, ProjectileTarget, launchNpcProjectile, stepNpcProjectiles } from "./NpcProjectiles";

const open: FlagsAt = () => 0;
const flat = () => 0;
const orb = { kind: "orb" as const, speed: 9, color: 0xffffff };
const from = { x: 0.5, y: 0.5, z: 1, plane: 0 };
const player = (x: number, y: number): ProjectileTarget => ({ x, y, z: 0, radius: 0.3, height: 1.4, plane: 0 });

/** Flies `p` for up to `seconds` with the player standing at `at`; returns whether it hit. */
function fly(p: NpcProjectile, at: ProjectileTarget, seconds: number, flags: FlagsAt = open) {
    const list = [p];
    for (let t = 0; t < seconds; t += 0.02) {
        if (stepNpcProjectiles(list, 0.02, at, flags, flat).length > 0) {
            return { hit: true, list };
        }
    }
    return { hit: false, list };
}

describe("NPC projectiles", () => {
    it("aim at the player chest and fly at their speed", () => {
        const target = player(0.5, 4.5);
        const p = launchNpcProjectile(from, target, orb, "magic", 0.7);

        expect(Math.hypot(p.vx, p.vy, p.vz)).toBeCloseTo(9);
        expect(p.vz).toBeLessThan(0); // from 1 tile up, down to the chest at 0.98
        expect(p.hitPow).toBe(0.7);
        expect(fly(p, target, 1).hit).toBe(true);
    });

    it("carry the shooter stats, attack rate and share of the max hit", () => {
        const attacker = fallbackCombatStats(30);
        const p = launchNpcProjectile(from, player(0.5, 4.5), orb, "ranged", 0.5, attacker, 0.5, 0.25);
        expect(p.attacker).toBe(attacker);
        expect(p.rate).toBe(0.5);
        expect(p.share).toBe(0.25);
        const plain = launchNpcProjectile(from, player(0.5, 4.5), orb, "ranged", 0.5);
        expect(plain.rate).toBe(1);
        expect(plain.share).toBe(1);
    });

    it("miss a player who stepped aside after they were shot", () => {
        const p = launchNpcProjectile(from, player(0.5, 4.5), orb, "ranged", 0.5);

        expect(fly(p, player(2, 4.5), 2).hit).toBe(false);
    });

    it("are stopped by a wall in the way, unless they fly over its top", () => {
        // A wall along the north edge of tile (0, 2), so at y = 3.
        const wall: FlagsAt = (_plane, x, y) => (x === 0 && y === 2 ? CollisionFlag.WALL_NORTH : 0);
        const blocked = fly(launchNpcProjectile(from, player(0.5, 4.5), orb, "ranged", 0.5), player(0.5, 4.5), 1, wall);
        expect(blocked.hit).toBe(false);
        expect(blocked.list).toHaveLength(0);

        const list = [launchNpcProjectile(from, player(0.5, 4.5), orb, "ranged", 0.5)];
        let hit = false;
        for (let t = 0; t < 1 && !hit; t += 0.02) {
            hit = stepNpcProjectiles(list, 0.02, player(0.5, 4.5), wall, flat, () => 0.2).length > 0;
        }
        expect(hit).toBe(true);
    });

    it("ignore a player on another floor, and expire", () => {
        const p = launchNpcProjectile(from, player(0.5, 4.5), orb, "ranged", 0.5);
        expect(fly(p, { ...player(0.5, 4.5), plane: 1 }, 0.9).hit).toBe(false);

        const lost = launchNpcProjectile(from, player(0.5, 4.5), orb, "ranged", 0.5);
        const list = [lost];
        stepNpcProjectiles(list, lost.life + 0.1, undefined, open, flat);
        expect(list).toHaveLength(0);
    });

    it("end in the ground", () => {
        const p = launchNpcProjectile({ ...from, z: 0.2 }, { ...player(0.5, 6), z: -3 }, orb, "ranged", 0.5);
        const list = [p];
        for (let t = 0; t < 1; t += 0.02) {
            stepNpcProjectiles(list, 0.02, undefined, open, flat);
        }
        expect(list).toHaveLength(0);
    });
});
