import { firstWallHit, ObstacleTop, segmentCircle } from "../combat/Bow";
import type { Box, FlagsAt } from "../physics/TileColliders";
import { AttackStyle, ProjectileInfo, ProjectileKind, RANGED_MAX } from "./AttackStyle";

/** An arrow, spell, rock, spit or fireball an NPC has shot at the player. Positions in tiles. */
export type NpcProjectile = {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    plane: number;
    kind: ProjectileKind;
    color: number;
    style: AttackStyle;
    hitPow: number;
    /** Where it was shot from, for the push direction. */
    fromX: number;
    fromY: number;
    age: number;
    /** Seconds it flies before it gives up. */
    life: number;
};

/** The player as a projectile sees them: a vertical cylinder. */
export type ProjectileTarget = { x: number; y: number; z: number; radius: number; height: number; plane: number };

/** Fraction of the player height a projectile aims at: the chest. */
const AIM_HEIGHT = 0.7;

/**
 * Shoots a projectile in a straight line at where the player is now, with no lead and no gravity,
 * so the player can sidestep it.
 */
export function launchNpcProjectile(
    from: { x: number; y: number; z: number; plane: number },
    target: ProjectileTarget,
    info: ProjectileInfo,
    style: AttackStyle,
    hitPow: number,
): NpcProjectile {
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const dz = target.z + AIM_HEIGHT * target.height - from.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const k = info.speed / d;
    return {
        x: from.x,
        y: from.y,
        z: from.z,
        vx: dx * k,
        vy: dy * k,
        vz: dz * k,
        plane: from.plane,
        kind: info.kind,
        color: info.color,
        style,
        hitPow,
        fromX: from.x,
        fromY: from.y,
        age: 0,
        life: RANGED_MAX / info.speed + 1,
    };
}

const boxes: Box[] = [];

/**
 * Flies the projectiles. One that reaches the player is removed and returned; one that meets a wall
 * (below its top, see `obstacleTop`), the ground or the end of its life is removed.
 */
export function stepNpcProjectiles(
    list: NpcProjectile[],
    dt: number,
    target: ProjectileTarget | undefined,
    flagsAt: FlagsAt,
    groundHeight: (plane: number, x: number, y: number) => number,
    obstacleTop?: ObstacleTop,
): NpcProjectile[] {
    const hits: NpcProjectile[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.age += dt;
        if (p.age > p.life) {
            list.splice(i, 1);
            continue;
        }
        const x1 = p.x + p.vx * dt;
        const y1 = p.y + p.vy * dt;
        const z1 = p.z + p.vz * dt;

        let reach: number | undefined;
        if (target && target.plane === p.plane) {
            const t = segmentCircle(p.x, p.y, x1, y1, target.x, target.y, target.radius);
            if (t !== undefined) {
                const z = p.z + (z1 - p.z) * t;
                if (z >= target.z && z <= target.z + target.height) {
                    reach = t;
                }
            }
        }
        const wall = firstWallHit(flagsAt, p.plane, p.x, p.y, p.z, x1, y1, z1, obstacleTop, boxes);
        if (reach !== undefined && (wall === undefined || reach <= wall)) {
            hits.push(p);
            list.splice(i, 1);
            continue;
        }
        if (wall !== undefined) {
            list.splice(i, 1);
            continue;
        }
        p.x = x1;
        p.y = y1;
        p.z = z1;
        if (p.z <= groundHeight(p.plane, p.x, p.y)) {
            list.splice(i, 1);
        }
    }
    return hits;
}
