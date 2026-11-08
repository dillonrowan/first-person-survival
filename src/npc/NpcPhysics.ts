import { STOP_SPEED, friction } from "../player/MoveMath";
import { tuning } from "../combat/tuning";
import { sweepAxis } from "../physics/Sweep";
import { BLOCKS_TILE, Box, FlagsAt } from "../physics/TileColliders";
import type { Tile } from "./NpcMovement";

/** A knocked-back NPC moving freely (in tiles) instead of along the tile grid. */
export type Knockback = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    plane: number;
    /** Set by a kick: hitting a wall hard enough slams the NPC down. */
    kicked?: boolean;
    /** Speed lost against walls in the last step (tiles/s). */
    impact?: number;
};

/**
 * Start speed (tiles/s) at which Source friction (spec 2.1) carries a body `distance` tiles:
 * exponential decay down to stopspeed covers (v − stop) / friction, then the linear part stop / 8.
 */
export function slideSpeedForDistance(distance: number, frictionValue = 4, stop = STOP_SPEED): number {
    if (distance <= 0) {
        return 0;
    }
    const linear = stop / (2 * frictionValue);
    if (distance <= linear) {
        return Math.sqrt(2 * frictionValue * stop * distance);
    }
    return frictionValue * (distance - linear) + stop;
}

/**
 * Force the game gives a kick by the target's mass (gh FUN_223ded60): linear between the min and
 * max weight, clamped to the min and max force.
 */
export function massForce(mass: number): number {
    const { massForceMin: f0, massForceMax: f1, massWeightMin: w0, massWeightMax: w1 } = tuning;
    if (mass <= w0) {
        return f0;
    }
    if (mass >= w1) {
        return f1;
    }
    return f0 + ((mass - w0) * (f1 - f0)) / (w1 - w0);
}

/**
 * Velocity (world tiles/s; `up` positive) a killing blow along (dirX, dirY) with `hitPow` gives a
 * body of `mass` kg as it becomes a ragdoll: harder blows throw it further, heavier bodies less
 * far, and a little lift gets it off the ground instead of dragging on it.
 */
export function deathLaunch(dirX: number, dirY: number, hitPow: number, mass: number): { vx: number; vy: number; up: number } {
    const { deathLaunchSpeed, deathLaunchPerPow, deathLaunchMaxPow, deathLaunchLift, deathLaunchMassScale } = tuning;
    const [least, most] = deathLaunchMassScale;
    const massScale = Math.min(most, Math.max(least, Math.sqrt(tuning.npcBaseMass / Math.max(1, mass))));
    const speed = (deathLaunchSpeed + deathLaunchPerPow * Math.min(Math.max(0, hitPow), deathLaunchMaxPow)) * massScale;
    const length = Math.hypot(dirX, dirY) || 1;
    return { vx: (dirX / length) * speed, vy: (dirY / length) * speed, up: speed * deathLaunchLift };
}

/** Below this speed (tiles/s) a knockback is over. */
export const KNOCKBACK_REST_SPEED = 0.05;
const MAX_SUBSTEP = 0.2;

export type KnockbackWorld = {
    flagsAt: FlagsAt;
    /** Optional: if given, walking off an upper floor's edge drops the NPC to the plane below. */
    hasFloor?: (plane: number, x: number, y: number) => boolean;
};

/**
 * Advances a knockback by `dt`: Source friction, then a swept move against tile colliders (a
 * blocked axis loses its velocity). Returns true while still moving.
 */
export function stepKnockback(k: Knockback, dt: number, radius: number, world: KnockbackWorld, boxes: Box[] = []): boolean {
    const v = { x: k.vx, y: k.vy };
    friction(v, dt);
    k.vx = v.x;
    k.vy = v.y;
    const dx = k.vx * dt;
    const dy = k.vy * dt;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MAX_SUBSTEP));
    const sx = k.x;
    const sy = k.y;
    for (let i = 0; i < steps; i++) {
        k.x = sweepAxis(world.flagsAt, k.plane, k.x, k.y, radius, true, dx / steps, boxes);
        k.y = sweepAxis(world.flagsAt, k.plane, k.x, k.y, radius, false, dy / steps, boxes);
    }
    let lost = 0;
    if (Math.abs(k.x - sx) < Math.abs(dx) - 1e-4) {
        lost = Math.max(lost, Math.abs(k.vx));
        k.vx = 0;
    }
    if (Math.abs(k.y - sy) < Math.abs(dy) - 1e-4) {
        lost = Math.max(lost, Math.abs(k.vy));
        k.vy = 0;
    }
    k.impact = lost;
    while (world.hasFloor && k.plane > 0 && !world.hasFloor(k.plane, k.x, k.y)) {
        k.plane--;
    }
    return Math.hypot(k.vx, k.vy) > KNOCKBACK_REST_SPEED;
}

/**
 * The tile (south-west corner for `size`) nearest to a free position that the NPC can stand on:
 * not blocked, free of other NPCs, and with a floor. Searches rings up to radius 4.
 */
export function findSnapTile(
    x: number,
    y: number,
    size: number,
    plane: number,
    flagsAt: FlagsAt,
    isFree: (plane: number, x: number, y: number, size: number) => boolean,
): Tile {
    const cx = Math.floor(x - size / 2 + 0.5);
    const cy = Math.floor(y - size / 2 + 0.5);
    const walkable = (tx: number, ty: number) => {
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                if (flagsAt(plane, tx + i, ty + j) & BLOCKS_TILE) {
                    return false;
                }
            }
        }
        return isFree(plane, tx, ty, size);
    };
    for (let r = 0; r <= 4; r++) {
        let best: Tile | undefined;
        let bestDistance = Infinity;
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !walkable(cx + dx, cy + dy)) {
                    continue;
                }
                const d = Math.hypot(cx + dx + size / 2 - x, cy + dy + size / 2 - y);
                if (d < bestDistance) {
                    bestDistance = d;
                    best = { x: cx + dx, y: cy + dy };
                }
            }
        }
        if (best) {
            return best;
        }
    }
    return { x: cx, y: cy };
}
