/**
 * Joint limits for OSRS ragdolls, learned from the NPC's own animations (spec 20.4).
 *
 * Dark Messiah's ragdolls limit every joint per axis, from its .phy file: knees and elbows are
 * hinges that bend one way only (knee −10°…100°, elbow −100°…20°), shoulders and hips are wide but
 * bounded, the spine and neck stiff. OSRS models carry no such data, but their idle and walk frames
 * show how each joint really moves: a knee folds one way and never the other. So each joint's
 * allowed region is the directions and twists its animations reach, widened towards Dark Messiah's
 * ranges: a joint that only bends away from its rest pose (a hinge) may bend on to 100° but only
 * 10° the other way; one that swings both ways (a hip) gets 25° more on each side.
 */

export type Vec3 = [number, number, number];

/** Limits of one joint, in its parent's base-pose frame (model space, three.js axes). */
export type JointLimit = {
    /** Mean direction from the joint to the child's centroid, and the main and second bend axes. */
    m: Vec3;
    a: Vec3;
    b: Vec3;
    /** Allowed bend along `a` and `b`: angles atan2(d·a, d·m), atan2(d·b, d·m), radians. */
    alphaMin: number;
    alphaMax: number;
    betaMin: number;
    betaMax: number;
    /** Child's rest direction (its twist axis) and allowed twist about it, radians. */
    twistAxis: Vec3;
    twistMin: number;
    twistMax: number;
};

const DEG = Math.PI / 180;
/** Below this range of bend in the animations the joint counts as not animated. */
const MIN_ANIMATED_SPAN = 6 * DEG;
/** Not animated: Dark Messiah's stiff joints (spine ±25–40°, neck ±25–60°). [data npc_guard.phy] */
const STILL_BEND = 30 * DEG;
const STILL_SIDE = 20 * DEG;
const STILL_TWIST = 25 * DEG;
/** Hinge: total bend (knee −10…100° → 110°) and the 10° it may go the wrong way. [data npc_guard.phy] */
const HINGE_SPAN = 110 * DEG;
const HINGE_BACK = 10 * DEG;
/** Rest within this fraction of the range's end: the joint bends one way only (a hinge). */
const HINGE_REST_FRACTION = 0.2;
/** Swinging joints (hips, shoulders): this much past what the animations reach, each way. [design] */
const SWING_EXTRA = 25 * DEG;
const SIDE_EXTRA = 15 * DEG;
const TWIST_EXTRA = 20 * DEG;
/** Bends are kept this far short of 90° from the mean, where the angles stop being defined. */
const MAX_FROM_MEAN = 85 * DEG;

export const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
export const unit = (a: ArrayLike<number>): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
};
/** Some unit vector at right angles to `v`. */
export function perpendicular(v: Vec3): Vec3 {
    return unit(cross3(v, Math.abs(v[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
}

/** Row-major 3×3 matrix times vector, and its transpose times vector. */
export const mul = (r: ArrayLike<number>, v: ArrayLike<number>): Vec3 => [
    r[0] * v[0] + r[1] * v[1] + r[2] * v[2],
    r[3] * v[0] + r[4] * v[1] + r[5] * v[2],
    r[6] * v[0] + r[7] * v[1] + r[8] * v[2],
];
export const mulT = (r: ArrayLike<number>, v: ArrayLike<number>): Vec3 => [
    r[0] * v[0] + r[3] * v[1] + r[6] * v[2],
    r[1] * v[0] + r[4] * v[1] + r[7] * v[2],
    r[2] * v[0] + r[5] * v[1] + r[8] * v[2],
];

/** Row-major 3×3 product a·b. */
export function matMul(a: ArrayLike<number>, b: ArrayLike<number>, out: number[] = new Array(9)): number[] {
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
        }
    }
    return out;
}

/** Rotation matrix (row-major) of `angle` about the unit `axis`. */
export function axisAngle(axis: Vec3, angle: number): number[] {
    const [x, y, z] = axis;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;
    return [
        t * x * x + c, t * x * y - s * z, t * x * z + s * y,
        t * x * y + s * z, t * y * y + c, t * y * z - s * x,
        t * x * z - s * y, t * y * z + s * x, t * z * z + c,
    ];
}

/** Unit quaternion [w, x, y, z] of a row-major rotation matrix. */
export function quatOf(m: ArrayLike<number>): [number, number, number, number] {
    const trace = m[0] + m[4] + m[8];
    let w: number;
    let x: number;
    let y: number;
    let z: number;
    if (trace > 0) {
        const s = Math.sqrt(trace + 1) * 2;
        w = s / 4;
        x = (m[7] - m[5]) / s;
        y = (m[2] - m[6]) / s;
        z = (m[3] - m[1]) / s;
    } else if (m[0] > m[4] && m[0] > m[8]) {
        const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
        w = (m[7] - m[5]) / s;
        x = s / 4;
        y = (m[1] + m[3]) / s;
        z = (m[2] + m[6]) / s;
    } else if (m[4] > m[8]) {
        const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
        w = (m[2] - m[6]) / s;
        x = (m[1] + m[3]) / s;
        y = s / 4;
        z = (m[5] + m[7]) / s;
    } else {
        const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
        w = (m[3] - m[1]) / s;
        x = (m[2] + m[6]) / s;
        y = (m[5] + m[7]) / s;
        z = s / 4;
    }
    const l = Math.hypot(w, x, y, z) || 1;
    return [w / l, x / l, y / l, z / l];
}

function matrixOf([w, x, y, z]: [number, number, number, number]): number[] {
    return [
        1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
        2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
        2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
    ];
}

/**
 * Best-fit rotation R (row-major) taking the points `from` onto `to` (both flat x, y, z lists,
 * relative to their centroids), starting from the guess `start`; and how far the points are from
 * moving rigidly (mean squared misfit over mean squared size). Müller et al., "A Robust Method to
 * Extract the Rotational Part of Deformations" (2016): it converges from any start, also for
 * flat or thin point sets where a polar decomposition breaks down.
 */
export function fitRotation(from: ArrayLike<number>, to: ArrayLike<number>, start: ArrayLike<number>): { r: number[]; misfit: number } {
    // A = Σ to ⊗ from
    const a = new Array(9).fill(0);
    let size = 0;
    for (let i = 0; i < from.length; i += 3) {
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                a[r * 3 + c] += to[i + r] * from[i + c];
            }
        }
        size += from[i] ** 2 + from[i + 1] ** 2 + from[i + 2] ** 2;
    }
    let q = quatOf(start);
    for (let iteration = 0; iteration < 40; iteration++) {
        const r = matrixOf(q);
        // ω = Σ_k col_k(R) × col_k(A) / |Σ_k col_k(R)·col_k(A)|
        let ox = 0;
        let oy = 0;
        let oz = 0;
        let along = 0;
        for (let k = 0; k < 3; k++) {
            const rx = r[k];
            const ry = r[3 + k];
            const rz = r[6 + k];
            const ax = a[k];
            const ay = a[3 + k];
            const az = a[6 + k];
            ox += ry * az - rz * ay;
            oy += rz * ax - rx * az;
            oz += rx * ay - ry * ax;
            along += rx * ax + ry * ay + rz * az;
        }
        const scale = 1 / (Math.abs(along) + 1e-9);
        ox *= scale;
        oy *= scale;
        oz *= scale;
        const angle = Math.hypot(ox, oy, oz);
        if (angle < 1e-9) {
            break;
        }
        const s = Math.sin(angle / 2) / angle;
        const dq: [number, number, number, number] = [Math.cos(angle / 2), ox * s, oy * s, oz * s];
        // q = dq · q
        const [w1, x1, y1, z1] = dq;
        const [w2, x2, y2, z2] = q;
        q = [
            w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
            w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
            w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
            w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
        ];
        const l = Math.hypot(...q);
        q = [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
    }
    const r = matrixOf(q);
    let misfit = 0;
    for (let i = 0; i < from.length; i += 3) {
        const m = mul(r, [from[i], from[i + 1], from[i + 2]]);
        misfit += (m[0] - to[i]) ** 2 + (m[1] - to[i + 1]) ** 2 + (m[2] - to[i + 2]) ** 2;
    }
    return { r, misfit: size > 0 ? misfit / size : 0 };
}

/** Twist (radians) about unit `axis` of the rotation Rqᵀ·Rp (both row-major), by swing-twist decomposition. */
export function twistAbout(rq: ArrayLike<number>, rp: ArrayLike<number>, axis: Vec3): number {
    // m = Rqᵀ Rp
    const m = new Array(9);
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            m[r * 3 + c] = rq[r] * rp[c] + rq[3 + r] * rp[3 + c] + rq[6 + r] * rp[6 + c];
        }
    }
    const [w, x, y, z] = quatOf(m);
    const t = x * axis[0] + y * axis[1] + z * axis[2];
    let angle = 2 * Math.atan2(t, w);
    if (angle > Math.PI) {
        angle -= 2 * Math.PI;
    } else if (angle < -Math.PI) {
        angle += 2 * Math.PI;
    }
    return angle;
}

/** `angle` moved by whole turns into (centre − π, centre + π]. */
export function wrapAround(angle: number, centre: number): number {
    let a = angle;
    while (a > centre + Math.PI) {
        a -= 2 * Math.PI;
    }
    while (a <= centre - Math.PI) {
        a += 2 * Math.PI;
    }
    return a;
}

/**
 * Learns a joint's limits from samples of its child's direction (unit, parent base frame) and
 * twist, one per animation frame; `restDir` is the base pose's direction (twist 0).
 */
export function learnJointLimit(samples: { dir: Vec3; twist: number }[], restDir: Vec3): JointLimit {
    const all = [{ dir: restDir, twist: 0 }, ...samples];
    const m = unit(all.reduce<Vec3>((s, x) => [s[0] + x.dir[0], s[1] + x.dir[1], s[2] + x.dir[2]], [0, 0, 0]));
    // Main bend axis: the direction (at right angles to m) along which the samples spread most.
    const u0 = perpendicular(m);
    const v0 = cross3(m, u0);
    let suu = 0;
    let svv = 0;
    let suv = 0;
    for (const { dir } of all) {
        const pu = dot(dir, u0);
        const pv = dot(dir, v0);
        suu += pu * pu;
        svv += pv * pv;
        suv += pu * pv;
    }
    const theta = 0.5 * Math.atan2(2 * suv, suu - svv);
    const a = unit([
        u0[0] * Math.cos(theta) + v0[0] * Math.sin(theta),
        u0[1] * Math.cos(theta) + v0[1] * Math.sin(theta),
        u0[2] * Math.cos(theta) + v0[2] * Math.sin(theta),
    ]);
    const b = cross3(m, a);
    const alpha = (d: Vec3) => Math.atan2(dot(d, a), dot(d, m));
    const beta = (d: Vec3) => Math.atan2(dot(d, b), dot(d, m));
    let alphaLo = Infinity;
    let alphaHi = -Infinity;
    let betaLo = Infinity;
    let betaHi = -Infinity;
    for (const { dir } of all) {
        alphaLo = Math.min(alphaLo, alpha(dir));
        alphaHi = Math.max(alphaHi, alpha(dir));
        betaLo = Math.min(betaLo, beta(dir));
        betaHi = Math.max(betaHi, beta(dir));
    }
    // Twist: the shortest arc of the circle holding every sample (twists near ±180° are neighbours).
    const twists = all.map((x) => x.twist).sort((p, q) => p - q);
    let gap = twists[0] + 2 * Math.PI - twists[twists.length - 1];
    let twistLo = twists[0];
    let twistHi = twists[twists.length - 1];
    for (let i = 1; i < twists.length; i++) {
        if (twists[i] - twists[i - 1] > gap) {
            gap = twists[i] - twists[i - 1];
            twistLo = twists[i];
            twistHi = twists[i - 1] + 2 * Math.PI;
        }
    }
    const alphaRest = alpha(restDir);
    const betaRest = beta(restDir);
    const span = alphaHi - alphaLo;
    let alphaMin: number;
    let alphaMax: number;
    let betaMin: number;
    let betaMax: number;
    let twistMin: number;
    let twistMax: number;
    if (span < MIN_ANIMATED_SPAN) {
        // Not moved by its animations (a head in a walk): Dark Messiah's stiff joints.
        alphaMin = alphaRest - STILL_BEND;
        alphaMax = alphaRest + STILL_BEND;
        betaMin = betaRest - STILL_SIDE;
        betaMax = betaRest + STILL_SIDE;
        twistMin = -STILL_TWIST;
        twistMax = STILL_TWIST;
    } else {
        if (alphaRest - alphaLo < HINGE_REST_FRACTION * span) {
            // Rest at the low end: a hinge bending towards +a.
            alphaMin = alphaLo - HINGE_BACK;
            alphaMax = Math.max(alphaHi + SWING_EXTRA, alphaLo + HINGE_SPAN - HINGE_BACK);
        } else if (alphaHi - alphaRest < HINGE_REST_FRACTION * span) {
            // Rest at the high end: a hinge bending towards −a.
            alphaMax = alphaHi + HINGE_BACK;
            alphaMin = Math.min(alphaLo - SWING_EXTRA, alphaHi - HINGE_SPAN + HINGE_BACK);
        } else {
            // Swings both ways from rest (a hip, a shoulder).
            alphaMin = alphaLo - SWING_EXTRA;
            alphaMax = alphaHi + SWING_EXTRA;
        }
        betaMin = Math.min(betaLo, betaRest - SIDE_EXTRA) - SIDE_EXTRA;
        betaMax = Math.max(betaHi, betaRest + SIDE_EXTRA) + SIDE_EXTRA;
        twistMin = twistLo - TWIST_EXTRA;
        twistMax = twistHi + TWIST_EXTRA;
    }
    // Centre the box on the middle of its range, so a hinge's 110° fits inside ±85° of its axis.
    const alphaMid = (alphaMin + alphaMax) / 2;
    const betaMid = (betaMin + betaMax) / 2;
    const centre = unit([
        m[0] + a[0] * Math.tan(alphaMid) + b[0] * Math.tan(betaMid),
        m[1] + a[1] * Math.tan(alphaMid) + b[1] * Math.tan(betaMid),
        m[2] + a[2] * Math.tan(alphaMid) + b[2] * Math.tan(betaMid),
    ]);
    const along = dot(a, centre);
    const a2 = unit([a[0] - centre[0] * along, a[1] - centre[1] * along, a[2] - centre[2] * along]);
    const halfAlpha = Math.min(MAX_FROM_MEAN, (alphaMax - alphaMin) / 2);
    const halfBeta = Math.min(MAX_FROM_MEAN, (betaMax - betaMin) / 2);
    const twistFree = twistMax - twistMin >= 2 * Math.PI - TWIST_EXTRA;
    const limit: JointLimit = {
        m: centre,
        a: a2,
        b: cross3(centre, a2),
        alphaMin: -halfAlpha,
        alphaMax: halfAlpha,
        betaMin: -halfBeta,
        betaMax: halfBeta,
        twistAxis: restDir,
        twistMin: twistFree ? -Math.PI : twistMin,
        twistMax: twistFree ? Math.PI : twistMax,
    };
    // Centring is exact only along the box's axes: make sure every pose seen is still inside.
    for (const { dir, twist } of all) {
        includePose(limit, dir, twist, 0);
    }
    includePose(limit, restDir, 0, REST_MARGIN);
    return limit;
}

/** Margin kept around the rest pose inside every limit. [design] */
const REST_MARGIN = 5 * DEG;

/**
 * Widens a limit just enough to hold direction `d` and twist `twist` (plus `margin`), e.g. the
 * pose a ragdoll starts in: a body starting outside its limits would be snapped into them.
 */
export function includePose(limit: JointLimit, d: Vec3, twist: number, margin: number): void {
    const along = dot(d, limit.m);
    if (along > 0) {
        const alpha = Math.atan2(dot(d, limit.a), along);
        const beta = Math.atan2(dot(d, limit.b), along);
        limit.alphaMin = Math.max(-MAX_FROM_MEAN, Math.min(limit.alphaMin, alpha - margin));
        limit.alphaMax = Math.min(MAX_FROM_MEAN, Math.max(limit.alphaMax, alpha + margin));
        limit.betaMin = Math.max(-MAX_FROM_MEAN, Math.min(limit.betaMin, beta - margin));
        limit.betaMax = Math.min(MAX_FROM_MEAN, Math.max(limit.betaMax, beta + margin));
    }
    if (limit.twistMax - limit.twistMin >= 2 * Math.PI) {
        return;
    }
    const t = wrapAround(twist, (limit.twistMin + limit.twistMax) / 2);
    limit.twistMin = Math.min(limit.twistMin, t - margin);
    limit.twistMax = Math.max(limit.twistMax, t + margin);
    if (limit.twistMax - limit.twistMin >= 2 * Math.PI - TWIST_EXTRA) {
        limit.twistMin = -Math.PI;
        limit.twistMax = Math.PI;
    }
}

/** How far (radians) `twist` is past the limit's twist range: negative below it, positive above. */
export function twistExcess(limit: JointLimit, twist: number): number {
    if (limit.twistMax - limit.twistMin >= 2 * Math.PI) {
        return 0;
    }
    const t = wrapAround(twist, (limit.twistMin + limit.twistMax) / 2);
    return t < limit.twistMin ? t - limit.twistMin : t > limit.twistMax ? t - limit.twistMax : 0;
}

/**
 * Clamps a child direction `d` (unit, parent base frame) into the limit's bend box; returns the
 * clamped direction, or undefined when `d` is inside.
 */
export function clampDirection(limit: JointLimit, d: Vec3): Vec3 | undefined {
    // Behind the box (more than 90° from its axis) the bends are taken as if just in front of
    // it, so the clamped direction lies on the near side and the joint turns back the short way.
    const along = Math.max(dot(d, limit.m), 1e-3);
    const alpha = Math.atan2(dot(d, limit.a), along);
    const beta = Math.atan2(dot(d, limit.b), along);
    const a = Math.min(limit.alphaMax, Math.max(limit.alphaMin, alpha));
    const b = Math.min(limit.betaMax, Math.max(limit.betaMin, beta));
    if (a === alpha && b === beta && dot(d, limit.m) > 0) {
        return undefined;
    }
    const ta = Math.tan(a);
    const tb = Math.tan(b);
    return unit([
        limit.m[0] + limit.a[0] * ta + limit.b[0] * tb,
        limit.m[1] + limit.a[1] * ta + limit.b[1] * tb,
        limit.m[2] + limit.a[2] * ta + limit.b[2] * tb,
    ]);
}
