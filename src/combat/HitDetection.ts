import { Body, BodySource, segmentHitsBoxes2D } from "../physics/Bodies";
import { Box, FlagsAt, collectTileBoxes } from "../physics/TileColliders";
import type { HitEvent } from "./moves";
import { tuning } from "./tuning";

export type Attacker = {
    x: number;
    y: number;
    /** Height of the eyes (the swing's centre line). */
    eyeZ: number;
    yaw: number;
    plane: number;
};

export type ArcHit<T> = {
    body: Body<T>;
    /** Unit direction from attacker to target, in world tiles. */
    dirX: number;
    dirY: number;
    distance: number;
};

/** Heights the blade covers relative to the eyes: chest to just above the head. [design] */
const BAND_BELOW_EYES = 1.2;
const BAND_ABOVE_EYES = 0.3;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Angles of the part of a swing covered by `from..to` (fractions of the hit's active window),
 * relative to where the attacker faces; positive is to the attacker's left. Sideways swings
 * (impact y ≠ 0) travel across the side arc towards +y; thrusts and chops cover a narrow cone
 * for the whole window.
 */
export function sweptAngles(impact: HitEvent["impact"], from: number, to: number): [number, number] {
    if (impact.y === 0) {
        return [-tuning.thrustArc, tuning.thrustArc];
    }
    const sign = Math.sign(impact.y);
    const angleAt = (f: number) => sign * tuning.sideArc * (2 * f - 1);
    const a = angleAt(from);
    const b = angleAt(to);
    return [Math.min(a, b), Math.max(a, b)];
}

/**
 * Bodies touched by one slice of a swing: within reach, inside the swept angles, overlapping the
 * blade's height band, not behind a wall, and not in `alreadyHit`. Hit bodies are added to it.
 */
export function sweepArc<T>(
    attacker: Attacker,
    reach: number,
    impact: HitEvent["impact"],
    from: number,
    to: number,
    bodies: BodySource<T>,
    flagsAt: FlagsAt,
    alreadyHit: Set<Body<T>>,
    exclude?: unknown,
): ArcHit<T>[] {
    const [lo, hi] = sweptAngles(impact, from, to);
    const range = reach + tuning.searchHull;
    const found: Body<T>[] = [];
    bodies.collectBodies(
        attacker.plane,
        attacker.x - range - 2,
        attacker.y - range - 2,
        attacker.x + range + 2,
        attacker.y + range + 2,
        found,
    );
    const fx = -Math.sin(attacker.yaw);
    const fy = Math.cos(attacker.yaw);
    const boxes: Box[] = [];
    const hits: ArcHit<T>[] = [];
    for (const body of found) {
        if (alreadyHit.has(body) || body.owner === exclude) {
            continue;
        }
        const dx = body.x - attacker.x;
        const dy = body.y - attacker.y;
        const d = Math.hypot(dx, dy);
        if (d - body.radius > range) {
            continue;
        }
        if (body.z > attacker.eyeZ + BAND_ABOVE_EYES || body.z + body.height < attacker.eyeZ - BAND_BELOW_EYES) {
            continue;
        }
        if (d > 1e-6) {
            // Bearing relative to facing; positive is left (counter-clockwise seen from above).
            const bearing = wrap(Math.atan2(dy, dx) - Math.atan2(fy, fx));
            const pad = Math.asin(Math.min(1, body.radius / d));
            if (bearing < lo - pad || bearing > hi + pad) {
                continue;
            }
            // Walls between the attacker and the near side of the target block the blade.
            const edge = Math.max(0, d - body.radius);
            const ex = attacker.x + (dx / d) * edge;
            const ey = attacker.y + (dy / d) * edge;
            collectTileBoxes(
                flagsAt,
                attacker.plane,
                Math.min(attacker.x, ex),
                Math.min(attacker.y, ey),
                Math.max(attacker.x, ex),
                Math.max(attacker.y, ey),
                boxes,
                "walls",
            );
            if (segmentHitsBoxes2D(attacker.x, attacker.y, ex, ey, boxes) !== undefined) {
                continue;
            }
        }
        alreadyHit.add(body);
        hits.push({
            body,
            dirX: d > 1e-6 ? dx / d : fx,
            dirY: d > 1e-6 ? dy / d : fy,
            distance: d,
        });
    }
    return hits;
}
