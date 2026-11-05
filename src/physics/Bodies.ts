import type { Box } from "./TileColliders";

/** A vertical cylinder that other things cannot walk through. Tile units, z = feet height. */
export type Body<T = unknown> = {
    x: number;
    y: number;
    z: number;
    radius: number;
    height: number;
    plane: number;
    owner: T;
};

export interface BodySource<T = unknown> {
    /** Appends the bodies on `plane` whose circle overlaps the box. Must not allocate. */
    collectBodies(
        plane: number,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
        out: Body<T>[],
    ): void;
}

export type Box3 = {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
};

const SEPARATION = 1e-4;

/**
 * Total displacement that moves a cylinder (px, py, pz, radius, height) out of every body it
 * overlaps, written to `out`. Returns false if it overlaps none. `fallback` is the direction used
 * when centres coincide.
 */
export function computePush(
    px: number,
    py: number,
    pz: number,
    radius: number,
    height: number,
    bodies: readonly Body[],
    fallbackX: number,
    fallbackY: number,
    out: { x: number; y: number },
): boolean {
    let pushX = 0;
    let pushY = 0;
    let hit = false;
    for (const b of bodies) {
        if (!(pz < b.z + b.height && b.z < pz + height)) {
            continue;
        }
        const dx = px - b.x;
        const dy = py - b.y;
        const min = radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) {
            continue;
        }
        const d = Math.sqrt(d2);
        let nx: number;
        let ny: number;
        if (d < 1e-6) {
            const length = Math.hypot(fallbackX, fallbackY);
            nx = length > 0 ? fallbackX / length : 1;
            ny = length > 0 ? fallbackY / length : 0;
        } else {
            nx = dx / d;
            ny = dy / d;
        }
        const depth = min - d + SEPARATION;
        pushX += nx * depth;
        pushY += ny * depth;
        hit = true;
    }
    out.x = pushX;
    out.y = pushY;
    return hit;
}

/** Distance along a ray (unit direction not required, t is in direction units) to a body. */
export function rayCylinder(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    body: Body,
    maxT: number,
): number | undefined {
    const bottom = body.z;
    const top = body.z + body.height;
    const r2 = body.radius * body.radius;
    let best = Infinity;
    const consider = (t: number) => {
        if (t >= 0 && t <= maxT && t < best) {
            best = t;
        }
    };

    // Side surface.
    const fx = ox - body.x;
    const fy = oy - body.y;
    const a = dx * dx + dy * dy;
    if (a > 1e-12) {
        const b = 2 * (fx * dx + fy * dy);
        const c = fx * fx + fy * fy - r2;
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
            const root = Math.sqrt(disc);
            for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
                const z = oz + dz * t;
                if (z >= bottom && z <= top) {
                    consider(t);
                }
            }
        }
    }
    // Caps.
    if (Math.abs(dz) > 1e-12) {
        for (const capZ of [bottom, top]) {
            const t = (capZ - oz) / dz;
            const cx = fx + dx * t;
            const cy = fy + dy * t;
            if (cx * cx + cy * cy <= r2) {
                consider(t);
            }
        }
    }
    return best === Infinity ? undefined : best;
}

/** Slab test of a ray against an axis-aligned box. Returns the entry distance, 0 if inside. */
export function rayBox(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    box: Box3,
    maxT: number,
): number | undefined {
    let tMin = 0;
    let tMax = maxT;
    const axes: [number, number, number, number][] = [
        [ox, dx, box.minX, box.maxX],
        [oy, dy, box.minY, box.maxY],
        [oz, dz, box.minZ, box.maxZ],
    ];
    for (const [o, d, lo, hi] of axes) {
        if (Math.abs(d) < 1e-12) {
            if (o < lo || o > hi) {
                return undefined;
            }
            continue;
        }
        let t0 = (lo - o) / d;
        let t1 = (hi - o) / d;
        if (t0 > t1) {
            [t0, t1] = [t1, t0];
        }
        tMin = Math.max(tMin, t0);
        tMax = Math.min(tMax, t1);
        if (tMin > tMax) {
            return undefined;
        }
    }
    return tMin;
}

/** First t in [0, 1] at which the segment A->B touches any box, or undefined. */
export function segmentHitsBoxes2D(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    boxes: readonly Box[],
): number | undefined {
    const dx = bx - ax;
    const dy = by - ay;
    let best = Infinity;
    for (const box of boxes) {
        let tMin = 0;
        let tMax = 1;
        let miss = false;
        for (const [o, d, lo, hi] of [
            [ax, dx, box.minX, box.maxX],
            [ay, dy, box.minY, box.maxY],
        ] as const) {
            if (Math.abs(d) < 1e-12) {
                if (o < lo || o > hi) {
                    miss = true;
                    break;
                }
                continue;
            }
            let t0 = (lo - o) / d;
            let t1 = (hi - o) / d;
            if (t0 > t1) {
                [t0, t1] = [t1, t0];
            }
            tMin = Math.max(tMin, t0);
            tMax = Math.min(tMax, t1);
            if (tMin > tMax) {
                miss = true;
                break;
            }
        }
        if (!miss && tMin < best) {
            best = tMin;
        }
    }
    return best === Infinity ? undefined : best;
}
