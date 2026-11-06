import { Body, BodySource, segmentHitsBoxes2D } from "../physics/Bodies";
import { Box, FlagsAt, collectTileBoxes } from "../physics/TileColliders";
import { segmentCircle } from "./Bow";
import type { HitEvent, Ray } from "./moves";
import { tuning } from "./tuning";

/** A direction in view space: x right, y up, z forward. */
export type ViewDir = { x: number; y: number; z: number };

const DEG = Math.PI / 180;

/**
 * Which way a ray sweeps (spec 17.2): +1 if the move's impact direction is positive on the swept
 * axis (horizontal: impact Y, "to the left"; vertical: impact X), else −1.
 */
export function raySign(ray: Ray, impact: HitEvent["impact"]): number {
    return (ray.vertical ? impact.x : impact.y) > 0 ? 1 : -1;
}

/**
 * Direction of the attack ray at progress `t` (0..1) through its window, in view space
 * (gh 0x223b39b0): angle = (t − 0.5) × sweep × sign, applied as a local yaw (horizontal) or pitch
 * (vertical) inside the view frame rolled by the ray's roll. Positive roll banks the right side
 * down; positive local yaw turns left; positive local pitch turns down (Source conventions).
 */
export function rayDirection(ray: Ray, sign: number, t: number): ViewDir {
    const a = (t - 0.5) * ray.sweep * sign * DEG;
    const r = ray.roll * DEG;
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    if (ray.vertical) {
        // forward·cos − up(rolled)·sin, up(r) = (sin r, cos r, 0)
        return { x: -Math.sin(r) * sinA, y: -Math.cos(r) * sinA, z: cosA };
    }
    // forward·cos + left(rolled)·sin, left(r) = (−cos r, sin r, 0)
    return { x: -Math.cos(r) * sinA, y: Math.sin(r) * sinA, z: cosA };
}

/** View-space direction to world tiles (x east, y north, z up); pitch is positive looking up. */
export function viewToWorld(d: ViewDir, yaw: number, pitch: number): ViewDir {
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const sp = Math.sin(pitch);
    const cp = Math.cos(pitch);
    // right (cy, sy, 0), up (sy·sp, −cy·sp, cp), forward (−sy·cp, cy·cp, sp)
    return {
        x: cy * d.x + sy * sp * d.y - sy * cp * d.z,
        y: sy * d.x - cy * sp * d.y + cy * cp * d.z,
        z: cp * d.y + sp * d.z,
    };
}

export type RayAttacker = { x: number; y: number; eyeZ: number; yaw: number; pitch: number; plane: number };

export type RayHit<T> = {
    body: Body<T>;
    dirX: number;
    dirY: number;
    distance: number;
    /** Where on the body's height the line struck, 0 = feet, 1 = top of the head. */
    height: number;
    /**
     * Which way the blade was moving across the ground where it struck (unit, world tiles), or
     * undefined for a thrust or a chop that moves mostly up or down.
     */
    swingX?: number;
    swingY?: number;
};

/**
 * Horizontal direction (world tiles, unit) the ray sweeps at progress `t`, or undefined when it
 * hardly moves sideways: a thrust, or a vertical chop seen from above.
 */
export function sweepDirection(ray: Ray, sign: number, t: number, yaw: number, pitch: number): { x: number; y: number } | undefined {
    if (ray.sweep === 0) {
        return undefined;
    }
    const ahead = viewToWorld(rayDirection(ray, sign, t + 0.01), yaw, pitch);
    const behind = viewToWorld(rayDirection(ray, sign, t - 0.01), yaw, pitch);
    const dx = ahead.x - behind.x;
    const dy = ahead.y - behind.y;
    const along = Math.hypot(dx, dy);
    // Less than half the blade's motion is sideways: no clear direction across the ground.
    if (along < 0.5 * Math.hypot(dx, dy, ahead.z - behind.z)) {
        return undefined;
    }
    return { x: dx / along, y: dy / along };
}

/**
 * Which way a hit drives its target (unit, world tiles): mostly the way the blade was moving,
 * partly away from the attacker (tuning.swingPushWeight). Thrusts drive straight away.
 */
export function pushDirection(hit: Pick<RayHit<unknown>, "dirX" | "dirY" | "swingX" | "swingY">): { x: number; y: number } {
    if (hit.swingX === undefined || hit.swingY === undefined) {
        return { x: hit.dirX, y: hit.dirY };
    }
    const w = tuning.swingPushWeight;
    const x = hit.dirX * (1 - w) + hit.swingX * w;
    const y = hit.dirY * (1 - w) + hit.swingY * w;
    const length = Math.hypot(x, y);
    return length > 1e-6 ? { x: x / length, y: y / length } : { x: hit.dirX, y: hit.dirY };
}

/** Largest angle between two traced lines in one update, degrees. [design: finer than a tick] */
const STEP_DEG = 4;

/**
 * The attack ray between progress `from` and `to` (spec 17.2): lines from the eye, `reach` long,
 * sampled at most 4° apart. The first body each line touches is hit (walls stop the line); bodies
 * already in `alreadyHit` are skipped and new ones added.
 */
export function traceRay<T>(
    attacker: RayAttacker,
    reach: number,
    ray: Ray,
    sign: number,
    from: number,
    to: number,
    bodies: BodySource<T>,
    flagsAt: FlagsAt,
    alreadyHit: Set<Body<T>>,
): RayHit<T>[] {
    const hits: RayHit<T>[] = [];
    const found: Body<T>[] = [];
    const boxes: Box[] = [];
    bodies.collectBodies(attacker.plane, attacker.x - reach - 2, attacker.y - reach - 2, attacker.x + reach + 2, attacker.y + reach + 2, found);
    if (found.length === 0) {
        return hits;
    }
    const samples = Math.max(1, Math.ceil((Math.abs(to - from) * ray.sweep) / STEP_DEG));
    for (let i = 0; i <= samples; i++) {
        if (i === 0 && from > 0) {
            continue; // the previous update traced this line already
        }
        const t = from + ((to - from) * i) / samples;
        const d = viewToWorld(rayDirection(ray, sign, t), attacker.yaw, attacker.pitch);
        const x1 = attacker.x + d.x * reach;
        const y1 = attacker.y + d.y * reach;
        const z1 = attacker.eyeZ + d.z * reach;
        let best: { t: number; body: Body<T>; z: number } | undefined;
        for (const b of found) {
            if (alreadyHit.has(b)) {
                continue;
            }
            const s = segmentCircle(attacker.x, attacker.y, x1, y1, b.x, b.y, b.radius);
            if (s === undefined || (best && s >= best.t)) {
                continue;
            }
            const z = attacker.eyeZ + (z1 - attacker.eyeZ) * s;
            if (z >= b.z && z <= b.z + b.height) {
                best = { t: s, body: b, z };
            }
        }
        if (!best) {
            continue;
        }
        boxes.length = 0;
        collectTileBoxes(flagsAt, attacker.plane, Math.min(attacker.x, x1), Math.min(attacker.y, y1), Math.max(attacker.x, x1), Math.max(attacker.y, y1), boxes, "walls");
        const wall = segmentHitsBoxes2D(attacker.x, attacker.y, x1, y1, boxes);
        if (wall !== undefined && wall < best.t) {
            continue;
        }
        alreadyHit.add(best.body);
        const dx = best.body.x - attacker.x;
        const dy = best.body.y - attacker.y;
        const dist = Math.hypot(dx, dy);
        const swing = sweepDirection(ray, sign, t, attacker.yaw, attacker.pitch);
        hits.push({
            body: best.body,
            dirX: dist > 1e-6 ? dx / dist : d.x,
            dirY: dist > 1e-6 ? dy / dist : d.y,
            distance: dist,
            height: best.body.height > 0 ? (best.z - best.body.z) / best.body.height : 0.5,
            swingX: swing?.x,
            swingY: swing?.y,
        });
    }
    return hits;
}
