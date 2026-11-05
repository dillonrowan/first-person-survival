import { tuning } from "../combat/tuning";
import { sweepAxis } from "../physics/Sweep";
import type { Box, FlagsAt } from "../physics/TileColliders";
import type { NpcClip, NpcSkeleton } from "../world/NpcFormat";
import {
    JointLimit,
    Vec3,
    axisAngle,
    clampDirection,
    cross3,
    dot,
    fitRotation,
    includePose,
    learnJointLimit,
    matMul,
    mul,
    mulT,
    twistAbout,
    twistExcess,
    unit,
} from "./RagdollLimits";

/** What a ragdoll needs from the world. */
export type RagdollWorld = {
    flagsAt: FlagsAt;
    groundHeight(plane: number, x: number, y: number): number;
    hasFloor?(plane: number, x: number, y: number): boolean;
};

/** Collision radius of a particle, tiles. [design] */
const PARTICLE_RADIUS = 0.04;
const SUBSTEPS = 2;
const ITERATIONS = 8;
/** Velocity kept per substep (Source ragdolls: damping 0, rotdamping 1.5; this is the linear part). [design] */
const DAMPING = 0.995;
/**
 * Below REST_SPEED (mean particle speed, tiles/s) a body is settling: it keeps only REST_DAMPING
 * of its velocity per substep, so the last wobble dies in a fraction of a second. Stands in for
 * the guard's heavy bodies (.phy inertia ×10, rotdamping 1.5) and Havok's deactivation of slow
 * bodies. [data npc_guard.phy; values design]
 */
const REST_SPEED = 0.36;
const REST_DAMPING = 0.8;
/** A resting body moving faster than this (tiles/s) is moving again. [design] */
const WAKE_SPEED = 1.2;
/**
 * Settling after landing (spec 20.6): from LANDED_FREE seconds after the body's root first lies
 * on the floor, its damping ramps over LANDED_RAMP seconds from DAMPING to REST_DAMPING, and it
 * is put to sleep LANDED_SLEEP seconds after landing. Havok deactivates resting bodies the same
 * way; Dark Messiah's heavy, rotation-damped bodies (inertia 10, rotdamping 1.5) come to rest
 * within about a second of hitting the ground. [data npc_guard.phy; values design]
 */
const LANDED_FREE = 0.3;
const LANDED_RAMP = 0.5;
const LANDED_SLEEP = 1.5;
/** Fraction of sliding a particle on the ground loses per substep (flesh on stone). [design] */
const GROUND_FRICTION = 0.35;
/** Fraction of a joint-limit violation (bend or twist) undone per iteration, and the most turned at once, radians. [design] */
const LIMIT_STIFFNESS = 0.5;
const MAX_LIMIT_TURN = 0.08;
/** Turns smaller than this (radians) are not worth making. [design] */
const MIN_LIMIT_TURN = 0.002;
/** Margin kept around the pose a ragdoll starts in inside its joint limits, radians. [design] */
const START_MARGIN = 0.05;
/** Fraction of an overlap between two body parts undone per iteration, and the most per iteration, tiles. [design] */
const COLLISION_STIFFNESS = 0.5;
const MAX_COLLISION_PUSH = 0.01;
/** Most two bodies (or a body and a standing NPC) are pushed apart in one frame, tiles. [design] */
const MAX_BODY_PUSH = 0.05;
/** A body pushed into a sleeping one faster than this (tiles/s) wakes it. [design] */
const WAKE_BY_BODY_SPEED = 0.3;
/** Two spheres the model itself puts closer than this fraction of their reach never collide. [design] */
const MIN_CONTACT_FRACTION = 0.3;
/**
 * A part whose vertices miss its best-fit rotation by more than this (mean squared, over its mean
 * squared size) in an animation frame is not moving rigidly there: the frame teaches nothing about
 * its joints. [design]
 */
const RIGID_MISFIT = 0.02;
/** A particle this close above the floor (tiles) rests on it. [design] */
const FLOOR_CONTACT = 0.01;
/** A floor contact sliding slower than this (tiles/s) sticks. [design] */
const STATIC_FRICTION_SPEED = 0.6;
/** Angular damping of every part, per second. [data npc_guard.phy: rotdamping 1.5] */
const ROT_DAMPING = 1.5;
/** Joints closer than this to their part's centroid are not limited (their direction is noise). [design] */
const MIN_LIMIT_LEVER = 0.06;
/** Smallest distance of a part's third frame point from its axis, tiles. [design] */
const MIN_FRAME_OFFSET = 0.08;
/** Asleep after a mean particle speed below this (tiles/s) for SLEEP_TIME seconds. [design] */
const SLEEP_SPEED = 0.12;
/** A body is put to sleep this long after it was last disturbed, whatever it is doing (Havok deactivates resting bodies too). [design] */
const MAX_AWAKE_TIME = 5;
const SLEEP_TIME = 0.3;

type Part = {
    /** Particles defining the part's frame: centroid, farthest vertex, and one off that line. */
    c: number;
    e1: number;
    e2: number;
    /** Joint particle shared with the parent, or -1 for the root. */
    joint: number;
    parent: number;
    /** Model vertices of the part. */
    vertices: number[];
    /** Rest frame in base-pose model space (three.js axes, tiles): origin and orthonormal basis. */
    restOrigin: [number, number, number];
    restBasis: number[];
    /** Rest direction from the joint to the centroid, base-pose model space. */
    restDir: [number, number, number];
    /** False when the joint sits (almost) at the centroid: no direction to limit. */
    limited: boolean;
    /** Bend and twist limits of the joint with the parent, learned from the animations. */
    limit?: JointLimit;
    /** Collision spheres in base-pose model space (centre x, y, z, radius per sphere). */
    spheres: number[];
    mass: number;
    /** Every particle the part holds rigid: its three, its hull, its joint and its children's joints. */
    set: number[];
    /** Extra collision particles at the part's extreme vertices. */
    hull: number[];
    /** Model vertices giving the part's frame in animation frames (its e1 and e2 directions). */
    e1v: number;
    e2v: number;
    /** Joint with the parent in base-pose model space. */
    pivot: Vec3;
    /** True when a real vertex lies far enough off the part's axis to measure its twist. */
    frameReliable: boolean;
    /** The part's own particles: its frame points and hull, not the joints it shares. */
    own: number[];
    /**
     * Every particle of the part and the parts hanging from it except its joint with its parent
     * (what turns with it when the joint bends), every other particle but that joint, and which
     * parts are in the first set. A turn of either set about the joint keeps every part rigid.
     */
    subtree: number[];
    complement: number[];
    subtreeParts: Uint8Array;
    /** Share of a bend at its joint taken by this side: the other side's share of their inertia about it. */
    childShare: number;
};

/**
 * The sphere pairs of two parts that may collide, and how far apart the parts' centroids must be
 * for none of them to touch. `pairs`: sphere offset in a, sphere offset in b, contact distance.
 */
type SphereGroup = { a: number; b: number; reach: number; pairs: number[] };

/** A part's best-fit motion in an animation frame: rotation from the base pose, and centroid. */
type PoseFit = { r: number[]; c: number[] };

/** Joint limits and colliding sphere pairs learned from each model's animations, by its skeleton. */
const learnedByModel = new WeakMap<NpcSkeleton, { limits: (JointLimit | undefined)[]; groups: SphereGroup[] }>();

const sub = (a: ArrayLike<number>, i: number, b: ArrayLike<number>, j: number): [number, number, number] => [
    a[i * 3] - b[j * 3],
    a[i * 3 + 1] - b[j * 3 + 1],
    a[i * 3 + 2] - b[j * 3 + 2],
];
const cross = (a: number[], b: number[]): [number, number, number] => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: number[]): [number, number, number] => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
};

/** The whole model as one part, for files exported before skeletons (it falls as one rigid body). */
export function singlePartSkeleton(base: Float32Array, vertexCount: number): NpcSkeleton {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let v = 0; v < vertexCount; v++) {
        x += base[v * 3];
        y += base[v * 3 + 1];
        z += base[v * 3 + 2];
    }
    const n = Math.max(1, vertexCount);
    // Pivots are model units (RS axes): undo the three.js axes of `base`.
    return {
        partOf: new Uint8Array(vertexCount),
        parents: Int8Array.from([-1]),
        pivots: Int16Array.from([Math.round((x / n) * 128), Math.round((-y / n) * 128), Math.round((-z / n) * 128)]),
    };
}

/** Parts with fewer vertices (ear tips, hooves, fingers) ride rigidly on their parent. [design] */
const MIN_RAGDOLL_PART_VERTICES = 8;

/**
 * Folds into its parent every part whose joint sits (almost) at its own centroid, and every part
 * of a few vertices; their children hang from the parent at their own joints. A part spinning in
 * place on its joint shows little and gives its children's joint limits a frame that never
 * settles, and tiny parts only jitter.
 */
export function foldPivotlessParts(skeleton: NpcSkeleton, base: Float32Array): NpcSkeleton {
    const count = skeleton.parents.length;
    const sums = new Float64Array(count * 4);
    for (let v = 0; v < skeleton.partOf.length; v++) {
        const p = skeleton.partOf[v] === 255 ? 0 : skeleton.partOf[v];
        sums[p * 4] += base[v * 3];
        sums[p * 4 + 1] += base[v * 3 + 1];
        sums[p * 4 + 2] += base[v * 3 + 2];
        sums[p * 4 + 3]++;
    }
    // Each part's surviving owner: itself, or the nearest ancestor that survives.
    const owner = Int32Array.from({ length: count }, (_, i) => i);
    for (let p = 1; p < count; p++) {
        const n = sums[p * 4 + 3] || 1;
        const lever = Math.hypot(
            sums[p * 4] / n - skeleton.pivots[p * 3] / 128,
            sums[p * 4 + 1] / n + skeleton.pivots[p * 3 + 1] / 128,
            sums[p * 4 + 2] / n + skeleton.pivots[p * 3 + 2] / 128,
        );
        if ((lever < MIN_LIMIT_LEVER || sums[p * 4 + 3] < MIN_RAGDOLL_PART_VERTICES) && skeleton.parents[p] >= 0) {
            owner[p] = owner[skeleton.parents[p]];
        }
    }
    const kept = [...owner.keys()].filter((p) => owner[p] === p);
    if (kept.length === count) {
        return skeleton;
    }
    const index = new Map(kept.map((p, i) => [p, i]));
    return {
        partOf: skeleton.partOf.map((p) => (p === 255 ? 255 : index.get(owner[p])!)),
        parents: Int8Array.from(kept.map((p) => (skeleton.parents[p] < 0 ? -1 : index.get(owner[skeleton.parents[p]])!))),
        pivots: Int16Array.from(kept.flatMap((p) => [skeleton.pivots[p * 3], skeleton.pivots[p * 3 + 1], skeleton.pivots[p * 3 + 2]])),
    };
}

/** Most collision spheres per part, and their smallest and largest radius, tiles. [design] */
const MAX_SPHERES = 5;
const MIN_SPHERE_RADIUS = 0.03;
const MAX_SPHERE_RADIUS = 0.45;
/** Fraction of a slice's vertices its sphere reaches. [design] */
const SPHERE_COVER = 0.75;

/**
 * Collision spheres for a part (spec 20.5): its vertices cut into slices along its longest axis,
 * each slice a sphere at its centre whose radius is the slices' typical distance from it, so a
 * leg is a chain of spheres and a torso one or two big ones. Returns x, y, z, radius per sphere.
 */
export function buildSpheres(vertices: readonly number[], base: Float32Array): number[] {
    if (vertices.length === 0) {
        return [];
    }
    const n = vertices.length;
    const c = [0, 0, 0];
    for (const v of vertices) {
        for (let k = 0; k < 3; k++) {
            c[k] += base[v * 3 + k] / n;
        }
    }
    // Longest axis by power iteration on the covariance.
    const cov = new Array(9).fill(0);
    for (const v of vertices) {
        const d = [base[v * 3] - c[0], base[v * 3 + 1] - c[1], base[v * 3 + 2] - c[2]];
        for (let r = 0; r < 3; r++) {
            for (let q = 0; q < 3; q++) {
                cov[r * 3 + q] += d[r] * d[q];
            }
        }
    }
    let axis: Vec3 = [1, 0.5, 0.25];
    for (let i = 0; i < 16; i++) {
        axis = unit(mul(cov, axis));
    }
    const t = vertices.map((v) => (base[v * 3] - c[0]) * axis[0] + (base[v * 3 + 1] - c[1]) * axis[1] + (base[v * 3 + 2] - c[2]) * axis[2]);
    const tMin = Math.min(...t);
    const tMax = Math.max(...t);
    // Typical thickness: the median distance from the axis.
    const radial = vertices
        .map((v, i) => {
            const d = [base[v * 3] - c[0] - axis[0] * t[i], base[v * 3 + 1] - c[1] - axis[1] * t[i], base[v * 3 + 2] - c[2] - axis[2] * t[i]];
            return Math.hypot(d[0], d[1], d[2]);
        })
        .sort((x, y) => x - y);
    const thickness = Math.max(MIN_SPHERE_RADIUS, radial[Math.floor(radial.length / 2)]);
    const count = Math.max(1, Math.min(MAX_SPHERES, Math.round((tMax - tMin) / (1.6 * thickness))));
    const spheres: number[] = [];
    for (let s = 0; s < count; s++) {
        const lo = tMin + ((tMax - tMin) * s) / count;
        const hi = tMin + ((tMax - tMin) * (s + 1)) / count;
        const slice = vertices.filter((_, i) => t[i] >= lo - 1e-9 && t[i] <= hi + 1e-9);
        if (slice.length === 0) {
            continue;
        }
        const sc = [0, 0, 0];
        for (const v of slice) {
            for (let k = 0; k < 3; k++) {
                sc[k] += base[v * 3 + k] / slice.length;
            }
        }
        // The surface is the slice's vertices: most of them lie within the sphere.
        const dists = slice
            .map((v) => Math.hypot(base[v * 3] - sc[0], base[v * 3 + 1] - sc[1], base[v * 3 + 2] - sc[2]))
            .sort((x, y) => x - y);
        const radius = Math.min(MAX_SPHERE_RADIUS, Math.max(MIN_SPHERE_RADIUS, dists[Math.floor(dists.length * SPHERE_COVER)]));
        spheres.push(sc[0], sc[1], sc[2], radius);
    }
    return spheres;
}

/** A part's reach from its centroid: its farthest sphere surface, tiles. */
function reachOf(part: { spheres: number[]; restOrigin: number[] }): number {
    let r = 0;
    for (let s = 0; s < part.spheres.length; s += 4) {
        r = Math.max(
            r,
            Math.hypot(part.spheres[s] - part.restOrigin[0], part.spheres[s + 1] - part.restOrigin[1], part.spheres[s + 2] - part.restOrigin[2]) + part.spheres[s + 3],
        );
    }
    return r;
}

/** Rotates point i of `p` by `angle` about the unit axis `k` through `o`. */
function rotateAbout(p: Float32Array, i: number, o: ArrayLike<number>, k: Vec3, cos: number, sin: number): void {
    const vx = p[i] - o[0];
    const vy = p[i + 1] - o[1];
    const vz = p[i + 2] - o[2];
    const kv = k[0] * vx + k[1] * vy + k[2] * vz;
    const cx = k[1] * vz - k[2] * vy;
    const cy = k[2] * vx - k[0] * vz;
    const cz = k[0] * vy - k[1] * vx;
    p[i] = o[0] + vx * cos + cx * sin + k[0] * kv * (1 - cos);
    p[i + 1] = o[1] + vy * cos + cy * sin + k[1] * kv * (1 - cos);
    p[i + 2] = o[2] + vz * cos + cz * sin + k[2] * kv * (1 - cos);
}

/** Orthonormal basis (columns u, v, w, row-major 3×3) from an origin and two more points. */
function frame(u0: number[], v0: number[]): number[] {
    const u = normalize(u0);
    let w = cross(u, v0);
    if (Math.hypot(w[0], w[1], w[2]) < 1e-9) {
        w = cross(u, Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
    }
    w = normalize(w);
    const v = cross(w, u);
    return [u[0], v[0], w[0], u[1], v[1], w[1], u[2], v[2], w[2]];
}

/** R = current · restᵀ, both row-major orthonormal bases. */
function rotationBetween(current: number[], rest: number[], out: number[]): void {
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            out[r * 3 + c] =
                current[r * 3] * rest[c * 3] + current[r * 3 + 1] * rest[c * 3 + 1] + current[r * 3 + 2] * rest[c * 3 + 2];
        }
    }
}

/**
 * An NPC's ragdoll (spec 20): Verlet particles (three.js axes: x east, y up, z south; relative to
 * a local origin), three per body part plus hull points and one shared per joint. Every part is
 * held rigid by distance constraints between all of its particles, neighbouring parts share their
 * joint particle (a ball joint), each joint keeps within bend and twist limits learned from the
 * NPC's animations (spec 20.4), and body parts collide with each other (spec 20.5). Particles
 * collide with the floor and tile walls; drawn vertices are moved out of the floor too. A landed
 * body settles and sleeps within about a second and a half (spec 20.6).
 */
export class Ragdoll {
    readonly pos: Float32Array;
    readonly prev: Float32Array;
    private readonly invMass: Float32Array;
    private readonly ca: Uint16Array;
    private readonly cb: Uint16Array;
    private readonly rest: Float32Array;
    private readonly parts: Part[] = [];
    private readonly basis: number[][] = [];
    private readonly rotation: number[][] = [];
    private readonly boxes: Box[] = [];
    private still = 0;
    /** Seconds simulated since the body was last disturbed. */
    private awakeFor = 0;
    /** Mean particle speed over the last frame, tiles/s. */
    private lastSpeed = Infinity;
    /** Length of the last step, seconds: velocities are particle motion per substep of it. */
    private lastDt = 1 / 60;
    /** Each part's reach from its centroid to its farthest sphere surface, tiles. */
    private readonly partReach: number[];
    private readonly totalMass: number;
    /**
     * Set once the body slows below REST_SPEED, cleared when it speeds up past WAKE_SPEED or is
     * disturbed: the gap keeps it from flicking between the two.
     */
    private resting = false;
    /** Seconds since the root part first lay on the floor (−1: not yet). */
    private landedFor = -1;
    /** Set when the body was last held up by a standing NPC or another body (spec 20.7). */
    private propped = false;
    /** 1 for each particle on (or just above) the floor at the last ground pass. */
    private onFloor: Uint8Array;
    /** 1 for each part with one of its own particles on the floor, per limit pass. */
    private readonly partDown: Uint8Array;
    private readonly scratch: number[] = new Array(9).fill(0);
    /**
     * Positions at the start of the substep, moved along with every correction that moves a part
     * without changing its speed (joint limits, parts pushed apart): friction holds contacts
     * against sliding, not against those.
     */
    private readonly substepStart: Float32Array;
    /** World position (x, z) of the particles' origin. */
    private readonly originX: number;
    private readonly originZ: number;
    /** Colliding sphere pairs, and every sphere's world centre this iteration (offsets per part below). */
    private readonly spherePairs: SphereGroup[];
    private readonly sphereWorld: Float32Array;
    private readonly sphereOffset: number[] = [];
    asleep = false;

    /**
     * `base`: base-pose model positions (three.js axes, tiles, 3 per model vertex); `current`: the
     * same vertices where they are drawn now, in world space.
     */
    constructor(
        exported: NpcSkeleton,
        private readonly base: Float32Array,
        current: Float32Array,
        totalMass: number,
        public plane: number,
        /** The NPC's baked animations (idle, walk): the joint limits are learned from them. */
        clips: readonly (NpcClip | undefined)[] = [],
    ) {
        const skeleton = foldPivotlessParts(exported, base);
        const partCount = skeleton.parents.length;
        const vertexLists: number[][] = Array.from({ length: partCount }, () => []);
        for (let v = 0; v < skeleton.partOf.length; v++) {
            const p = skeleton.partOf[v];
            vertexLists[p === 255 ? 0 : p].push(v);
        }
        // Particles live relative to a local origin near the body: at map coordinates (thousands of
        // tiles) single floats only resolve steps of 1/4000 tile, noise that the joint frames of a
        // small body (a goblin's hand) cannot take.
        this.originX = Math.round(current[0] || 0);
        this.originZ = Math.round(current[2] || 0);
        const points: number[] = [];
        const add = (x: number, y: number, z: number) => {
            points.push(x - this.originX, y, z - this.originZ);
            return points.length / 3 - 1;
        };
        // Volume of each part's box stands in for its share of the mass, as Source's .phy masses
        // are volume × density. [data npc_guard.phy]
        const volumes = vertexLists.map((vs) => {
            if (vs.length === 0) {
                return 0;
            }
            const min = [Infinity, Infinity, Infinity];
            const max = [-Infinity, -Infinity, -Infinity];
            for (const v of vs) {
                for (let k = 0; k < 3; k++) {
                    min[k] = Math.min(min[k], base[v * 3 + k]);
                    max[k] = Math.max(max[k], base[v * 3 + k]);
                }
            }
            return Math.max(0.05, max[0] - min[0]) * Math.max(0.05, max[1] - min[1]) * Math.max(0.05, max[2] - min[2]);
        });
        const totalVolume = volumes.reduce((a, b) => a + b, 0) || 1;

        // The rigid motion of each part from base pose to now, to place its joint where it is drawn.
        const pivot = (p: number): [number, number, number] => [
            skeleton.pivots[p * 3] / 128,
            -skeleton.pivots[p * 3 + 1] / 128,
            -skeleton.pivots[p * 3 + 2] / 128,
        ];
        for (let p = 0; p < partCount; p++) {
            const vs = vertexLists[p].length > 0 ? vertexLists[p] : vertexLists[0];
            // Centroids, base and current.
            const cb = [0, 0, 0];
            const cc = [0, 0, 0];
            for (const v of vs) {
                for (let k = 0; k < 3; k++) {
                    cb[k] += base[v * 3 + k] / vs.length;
                    cc[k] += current[v * 3 + k] / vs.length;
                }
            }
            // e1: farthest vertex from the centroid; e2: farthest from that line.
            let e1 = vs[0];
            let best = -1;
            for (const v of vs) {
                const d = (base[v * 3] - cb[0]) ** 2 + (base[v * 3 + 1] - cb[1]) ** 2 + (base[v * 3 + 2] - cb[2]) ** 2;
                if (d > best) {
                    best = d;
                    e1 = v;
                }
            }
            const axis = normalize([base[e1 * 3] - cb[0], base[e1 * 3 + 1] - cb[1], base[e1 * 3 + 2] - cb[2]]);
            let e2 = vs[0];
            best = -1;
            for (const v of vs) {
                const d = [base[v * 3] - cb[0], base[v * 3 + 1] - cb[1], base[v * 3 + 2] - cb[2]];
                const t = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
                const off = (d[0] - axis[0] * t) ** 2 + (d[1] - axis[1] * t) ** 2 + (d[2] - axis[2] * t) ** 2;
                if (off > best) {
                    best = off;
                    e2 = v;
                }
            }
            const restBasis = frame(
                [base[e1 * 3] - cb[0], base[e1 * 3 + 1] - cb[1], base[e1 * 3 + 2] - cb[2]],
                [base[e2 * 3] - cb[0], base[e2 * 3 + 1] - cb[1], base[e2 * 3 + 2] - cb[2]],
            );
            const currentBasis = frame(
                [current[e1 * 3] - cc[0], current[e1 * 3 + 1] - cc[1], current[e1 * 3 + 2] - cc[2]],
                [current[e2 * 3] - cc[0], current[e2 * 3 + 1] - cc[1], current[e2 * 3 + 2] - cc[2]],
            );
            const r: number[] = new Array(9);
            rotationBetween(currentBasis, restBasis, r);
            const toCurrent = (b: number[]): [number, number, number] => {
                const d = [b[0] - cb[0], b[1] - cb[1], b[2] - cb[2]];
                return [
                    cc[0] + r[0] * d[0] + r[1] * d[1] + r[2] * d[2],
                    cc[1] + r[3] * d[0] + r[4] * d[1] + r[5] * d[2],
                    cc[2] + r[6] * d[0] + r[7] * d[1] + r[8] * d[2],
                ];
            };
            const c = add(cc[0], cc[1], cc[2]);
            const pe1 = add(current[e1 * 3], current[e1 * 3 + 1], current[e1 * 3 + 2]);
            // A thin part (a horn, a finger, a blade) has no vertex far enough off its axis to give a
            // stable frame; it gets a point a fixed distance off the axis instead.
            const e2Base = [base[e2 * 3], base[e2 * 3 + 1], base[e2 * 3 + 2]];
            const e2Point = best > MIN_FRAME_OFFSET * MIN_FRAME_OFFSET ? e2Base : (() => {
                const side = normalize(cross(axis, Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
                return [cb[0] + side[0] * MIN_FRAME_OFFSET, cb[1] + side[1] * MIN_FRAME_OFFSET, cb[2] + side[2] * MIN_FRAME_OFFSET];
            })();
            const pe2At = toCurrent(e2Point);
            const pe2 = add(pe2At[0], pe2At[1], pe2At[2]);
            const parent = skeleton.parents[p];
            let joint = -1;
            const pv = pivot(p);
            if (parent >= 0) {
                const at = toCurrent(pv);
                joint = add(at[0], at[1], at[2]);
            }
            const restFrameBasis = frame(
                [base[e1 * 3] - cb[0], base[e1 * 3 + 1] - cb[1], base[e1 * 3 + 2] - cb[2]],
                [e2Point[0] - cb[0], e2Point[1] - cb[1], e2Point[2] - cb[2]],
            );
            // Collision hull: the part's extreme vertices along each axis of its frame, so the
            // floor and walls touch the body where its surface is, not only at its frame points.
            const hull: number[] = [];
            const used = new Set<number>([e1, e2]);
            for (let axisIndex = 0; axisIndex < 3; axisIndex++) {
                const ax = [restFrameBasis[axisIndex], restFrameBasis[3 + axisIndex], restFrameBasis[6 + axisIndex]];
                let lo = vs[0];
                let hi = vs[0];
                let loT = Infinity;
                let hiT = -Infinity;
                for (const v of vs) {
                    const t = (base[v * 3] - cb[0]) * ax[0] + (base[v * 3 + 1] - cb[1]) * ax[1] + (base[v * 3 + 2] - cb[2]) * ax[2];
                    if (t < loT) {
                        loT = t;
                        lo = v;
                    }
                    if (t > hiT) {
                        hiT = t;
                        hi = v;
                    }
                }
                for (const v of [lo, hi]) {
                    if (!used.has(v)) {
                        used.add(v);
                        hull.push(add(current[v * 3], current[v * 3 + 1], current[v * 3 + 2]));
                    }
                }
            }
            this.parts.push({
                c,
                e1: pe1,
                e2: pe2,
                joint,
                parent,
                vertices: vertexLists[p],
                restOrigin: [cb[0], cb[1], cb[2]],
                restBasis: restFrameBasis,
                restDir: normalize([cb[0] - pv[0], cb[1] - pv[1], cb[2] - pv[2]]),
                limited: Math.hypot(cb[0] - pv[0], cb[1] - pv[1], cb[2] - pv[2]) >= MIN_LIMIT_LEVER,
                spheres: buildSpheres(vertexLists[p], base),
                mass: Math.max(0.5, (totalMass * volumes[p]) / totalVolume),
                set: [],
                hull,
                e1v: e1,
                e2v: e2,
                pivot: pv,
                frameReliable: best > MIN_FRAME_OFFSET * MIN_FRAME_OFFSET,
                own: [c, pe1, pe2, ...hull],
                subtree: [],
                complement: [],
                subtreeParts: new Uint8Array(0),
                childShare: 1,
            });
            this.basis.push(new Array(9).fill(0));
            this.rotation.push(new Array(9).fill(0));
        }
        let offset = 0;
        for (const part of this.parts) {
            this.sphereOffset.push(offset);
            offset += part.spheres.length;
        }
        // What is learned from the animations is the same for every NPC of a model: learn it once.
        const learned = clips.some(Boolean) ? learnedByModel.get(exported) : undefined;
        if (learned) {
            learned.limits.forEach((limit, i) => (this.parts[i].limit = limit && { ...limit }));
            this.spherePairs = learned.groups;
        } else {
            const fits = this.learnLimits(clips);
            this.spherePairs = this.collidingSpheres(fits);
            if (clips.some(Boolean)) {
                learnedByModel.set(exported, { limits: this.parts.map((part) => part.limit && { ...part.limit }), groups: this.spherePairs });
            }
        }
        this.sphereWorld = new Float32Array(this.parts.reduce((n, part) => n + part.spheres.length, 0));
        this.partReach = this.parts.map(reachOf);
        this.totalMass = this.parts.reduce((m, part) => m + part.mass, 0);

        this.pos = Float32Array.from(points);
        this.prev = Float32Array.from(points);
        this.onFloor = new Uint8Array(points.length / 3);
        this.partDown = new Uint8Array(this.parts.length);
        this.substepStart = Float32Array.from(points);
        const mass = new Float32Array(points.length / 3);
        const pairs: [number, number][] = [];
        this.parts.forEach((part, p) => {
            const set = [part.c, part.e1, part.e2, ...part.hull];
            if (part.joint >= 0) {
                set.push(part.joint);
            }
            this.parts.forEach((child) => {
                if (child.parent === p && child.joint >= 0) {
                    set.push(child.joint);
                }
            });
            part.set = set;
            for (const i of set) {
                mass[i] += part.mass / set.length;
            }
            for (let a = 0; a < set.length; a++) {
                for (let b = a + 1; b < set.length; b++) {
                    pairs.push([set[a], set[b]]);
                }
            }
        });
        this.invMass = mass.map((m) => (m > 0 ? 1 / m : 0));
        this.splitAtJoints(mass);
        this.ca = Uint16Array.from(pairs.map((p) => p[0]));
        this.cb = Uint16Array.from(pairs.map((p) => p[1]));
        this.rest = Float32Array.from(pairs.map(([a, b]) => Math.hypot(...sub(this.pos, a, this.pos, b))));
        // The pose the body starts in (the NPC's last animation frame) is allowed, whatever the
        // idle and walk showed: starting outside a limit would snap the limb.
        this.updateFrames();
        this.parts.forEach((part, i) => {
            if (!part.limit) {
                return;
            }
            const rq = this.rotation[part.parent];
            const d = unit(sub(this.pos, part.c, this.pos, part.joint));
            includePose(part.limit, mulT(rq, d), twistAbout(rq, this.rotation[i], part.limit.twistAxis), START_MARGIN);
        });
    }

    /** Each joint's two sides (spec 20.4): the subtree hanging from it and the rest of the body. */
    private splitAtJoints(mass: Float32Array): void {
        const count = this.pos.length / 3;
        const children = this.parts.map(() => [] as number[]);
        this.parts.forEach((part, i) => {
            if (part.parent >= 0) {
                children[part.parent].push(i);
            }
        });
        this.parts.forEach((part, i) => {
            if (part.parent < 0) {
                return;
            }
            const inParts = new Uint8Array(this.parts.length);
            const inSubtree = new Uint8Array(count);
            const stack = [i];
            while (stack.length > 0) {
                const s = stack.pop()!;
                inParts[s] = 1;
                this.parts[s].set.forEach((k) => (inSubtree[k] = 1));
                stack.push(...children[s]);
            }
            const j = part.joint;
            let inertiaChild = 0;
            let inertiaRest = 0;
            for (let k = 0; k < count; k++) {
                if (k === j) {
                    continue;
                }
                const r2 = (this.pos[k * 3] - this.pos[j * 3]) ** 2 + (this.pos[k * 3 + 1] - this.pos[j * 3 + 1]) ** 2 + (this.pos[k * 3 + 2] - this.pos[j * 3 + 2]) ** 2;
                if (inSubtree[k]) {
                    part.subtree.push(k);
                    inertiaChild += mass[k] * r2;
                } else {
                    part.complement.push(k);
                    inertiaRest += mass[k] * r2;
                }
            }
            part.subtreeParts = inParts;
            part.childShare = inertiaChild + inertiaRest > 0 ? inertiaRest / (inertiaChild + inertiaRest) : 1;
        });
    }

    get partCount(): number {
        return this.parts.length;
    }

    /** The learned limit of each part's joint with its parent (undefined for the root). */
    get limits(): (JointLimit | undefined)[] {
        return this.parts.map((part) => part.limit);
    }

    /**
     * Learns every joint's bend and twist limits from the animations (spec 20.4): in each frame,
     * where the child points and how far it is twisted in its parent's frame.
     */
    private learnLimits(clips: readonly (NpcClip | undefined)[]): (PoseFit | undefined)[][] {
        const count = this.base.length / 3;
        const poses: Float32Array[] = [];
        for (const clip of clips) {
            if (!clip) {
                continue;
            }
            const frames = clip.frameLengths.length;
            for (let f = 0; f < frames; f++) {
                const pose = new Float32Array(count * 3);
                const at = f * count * 3;
                for (let v = 0; v < count; v++) {
                    pose[v * 3] = clip.positions[at + v * 3] / 128;
                    pose[v * 3 + 1] = -clip.positions[at + v * 3 + 1] / 128;
                    pose[v * 3 + 2] = -clip.positions[at + v * 3 + 2] / 128;
                }
                poses.push(pose);
            }
        }
        // Each part's frame in a pose, from its centroid and its two reference vertices.
        const frameOf = (part: Part, pose: Float32Array) => {
            const c = [0, 0, 0];
            for (const v of part.vertices) {
                for (let k = 0; k < 3; k++) {
                    c[k] += pose[v * 3 + k] / part.vertices.length;
                }
            }
            const basis = frame(
                [pose[part.e1v * 3] - c[0], pose[part.e1v * 3 + 1] - c[1], pose[part.e1v * 3 + 2] - c[2]],
                [pose[part.e2v * 3] - c[0], pose[part.e2v * 3 + 1] - c[1], pose[part.e2v * 3 + 2] - c[2]],
            );
            return { c, basis };
        };
        const restFrames = this.parts.map((part) => (part.vertices.length > 0 ? frameOf(part, this.base) : undefined));
        // Each part's vertices relative to its base-pose centroid.
        const offsets = this.parts.map((part, i) => {
            const rest = restFrames[i];
            return rest ? Float64Array.from(part.vertices.flatMap((v) => [0, 1, 2].map((k) => this.base[v * 3 + k] - rest.c[k]))) : undefined;
        });
        const samples: { dir: Vec3; twist: number }[][] = this.parts.map(() => []);
        const fitsPerPose: (PoseFit | undefined)[][] = [];
        for (const pose of poses) {
            // Each part's rigid motion from the base pose: the best fit over all its vertices,
            // started from the frame through its reference vertices. A part that deforms in this
            // frame (a merged label moving on its own) gives no sample.
            const rotations = this.parts.map((part, i) => {
                const rest = restFrames[i];
                const from = offsets[i];
                if (!rest || !from) {
                    return undefined;
                }
                const now = frameOf(part, pose);
                const guess = new Array(9);
                rotationBetween(now.basis, rest.basis, guess);
                const to = Float64Array.from(part.vertices.flatMap((v) => [0, 1, 2].map((k) => pose[v * 3 + k] - now.c[k])));
                const { r, misfit } = fitRotation(from, to, guess);
                return misfit < RIGID_MISFIT ? { r, c: now.c } : undefined;
            });
            fitsPerPose.push(rotations);
            this.parts.forEach((part, i) => {
                const q = part.parent;
                const rq = q >= 0 ? rotations[q] : undefined;
                const rp = rotations[i];
                const restQ = q >= 0 ? restFrames[q] : undefined;
                if (!rq || !rp || !restQ) {
                    return;
                }
                // The joint where the parent carries it, and the child's direction from it.
                const off = mul(rq.r, [part.pivot[0] - restQ.c[0], part.pivot[1] - restQ.c[1], part.pivot[2] - restQ.c[2]]);
                const joint = [rq.c[0] + off[0], rq.c[1] + off[1], rq.c[2] + off[2]];
                const dir = unit(mulT(rq.r, [rp.c[0] - joint[0], rp.c[1] - joint[1], rp.c[2] - joint[2]]));
                samples[i].push({ dir, twist: twistAbout(rq.r, rp.r, part.restDir) });
            });
        }
        this.parts.forEach((part, i) => {
            if (part.parent >= 0 && part.limited) {
                part.limit = learnJointLimit(samples[i], part.restDir);
            }
        });
        return fitsPerPose;
    }

    /**
     * Sphere pairs that collide (spec 20.5). As in Source when a model names no collision rules
     * (gh 0x223715a0), every part collides with every other except its parent and its children.
     * Spheres the model itself brings closer than touching, in its base pose or its animations
     * (an arm against the body, a tail between the legs), may come that close and no closer;
     * spheres it puts deep inside each other (armour over a body) never collide.
     */
    private collidingSpheres(fitsPerPose: (PoseFit | undefined)[][]): SphereGroup[] {
        const groups: SphereGroup[] = [];
        const bound = this.parts.map(reachOf);
        const centre = (part: Part, fit: PoseFit, s: number): Vec3 => {
            const d = mul(fit.r, [part.spheres[s] - part.restOrigin[0], part.spheres[s + 1] - part.restOrigin[1], part.spheres[s + 2] - part.restOrigin[2]]);
            return [fit.c[0] + d[0], fit.c[1] + d[1], fit.c[2] + d[2]];
        };
        for (let a = 0; a < this.parts.length; a++) {
            for (let b = a + 1; b < this.parts.length; b++) {
                const pa = this.parts[a];
                const pb = this.parts[b];
                if (pa.parent === b || pb.parent === a) {
                    continue;
                }
                const pairs: number[] = [];
                for (let i = 0; i < pa.spheres.length; i += 4) {
                    for (let k = 0; k < pb.spheres.length; k += 4) {
                        const reach = pa.spheres[i + 3] + pb.spheres[k + 3];
                        let closest = Math.hypot(
                            pa.spheres[i] - pb.spheres[k],
                            pa.spheres[i + 1] - pb.spheres[k + 1],
                            pa.spheres[i + 2] - pb.spheres[k + 2],
                        );
                        for (const fits of fitsPerPose) {
                            const fa = fits[a];
                            const fb = fits[b];
                            if (fa && fb) {
                                const ca = centre(pa, fa, i);
                                const cb = centre(pb, fb, k);
                                closest = Math.min(closest, Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]));
                            }
                        }
                        const contact = Math.min(reach, closest);
                        if (contact >= MIN_CONTACT_FRACTION * reach) {
                            pairs.push(i, k, contact);
                        }
                    }
                }
                if (pairs.length > 0) {
                    groups.push({ a, b, reach: bound[a] + bound[b], pairs });
                }
            }
        }
        return groups;
    }

    /**
     * Raises the whole body (positions and previous positions alike, so without adding motion) until
     * no particle is inside the floor. Call once before the first step: a body starting with its
     * feet on the ground would otherwise be pushed out of it with a jolt.
     */
    settleOnFloor(world: RagdollWorld): void {
        const p = this.pos;
        let lift = 0;
        for (let i = 0; i < p.length; i += 3) {
            lift = Math.max(lift, this.groundAt(world, p[i], p[i + 2]) + PARTICLE_RADIUS - p[i + 1]);
        }
        if (lift > 0) {
            for (let i = 1; i < p.length; i += 3) {
                p[i] += lift;
                this.prev[i] += lift;
            }
        }
    }

    /** Sets every particle's velocity (tiles/s, three.js axes), e.g. the motion the NPC had. */
    setVelocity(vx: number, vy: number, vz: number, dt = this.lastDt): void {
        const h = dt / SUBSTEPS;
        for (let i = 0; i < this.pos.length; i += 3) {
            this.prev[i] = this.pos[i] - vx * h;
            this.prev[i + 1] = this.pos[i + 1] - vy * h;
            this.prev[i + 2] = this.pos[i + 2] - vz * h;
        }
        this.wake();
    }

    /** Adds a velocity (tiles/s, three.js axes) to the whole body, e.g. a kick on a lying NPC. */
    addVelocity(vx: number, vy: number, vz: number, dt = this.lastDt): void {
        const h = dt / SUBSTEPS;
        for (let i = 0; i < this.pos.length; i += 3) {
            this.prev[i] -= vx * h;
            this.prev[i + 1] -= vy * h;
            this.prev[i + 2] -= vz * h;
        }
        this.wake();
    }

    /**
     * Adds an impulse (kg·tiles/s, three.js axes) to the root part's particles, like Source's death
     * force on the hit body.
     */
    applyImpulse(jx: number, jy: number, jz: number, dt = this.lastDt): void {
        const root = this.parts[0];
        const h = dt / SUBSTEPS;
        const dv = 1 / root.mass;
        for (const i of [root.c, root.e1, root.e2]) {
            this.prev[i * 3] -= jx * dv * h;
            this.prev[i * 3 + 1] -= jy * dv * h;
            this.prev[i * 3 + 2] -= jz * dv * h;
        }
        this.wake();
    }

    wake(): void {
        this.asleep = false;
        this.still = 0;
        this.awakeFor = 0;
        this.lastSpeed = Infinity;
        this.resting = false;
        this.landedFor = -1;
    }

    /** Root centroid in three.js world space. */
    rootPosition(): [number, number, number] {
        const i = this.parts[0].c * 3;
        return [this.pos[i] + this.originX, this.pos[i + 1], this.pos[i + 2] + this.originZ];
    }

    /** True when any of the particles rests on the floor. */
    private touching(set: number[]): boolean {
        for (const k of set) {
            if (this.onFloor[k] === 1) {
                return true;
            }
        }
        return false;
    }

    /** Floor height under a particle position (local x, z). */
    private groundAt(world: RagdollWorld, x: number, z: number): number {
        return world.groundHeight(this.plane, x + this.originX, -(z + this.originZ));
    }

    step(dt: number, world: RagdollWorld): void {
        if (this.asleep || dt <= 0) {
            return;
        }
        const h = dt / SUBSTEPS;
        const g = tuning.gravity * h * h;
        const p = this.pos;
        const o = this.prev;
        const start = Float32Array.from(p);
        const root = this.rootPosition();
        while (this.plane > 0 && world.hasFloor && !world.hasFloor(this.plane, root[0], -root[2])) {
            this.plane--;
        }
        const spinKept = Math.exp(-ROT_DAMPING * h);
        // A settling body loses its last wobble fast, and a landed one ever faster (spec 20.6).
        const ramp = Math.min(1, Math.max(0, (this.landedFor - LANDED_FREE) / LANDED_RAMP));
        const kept = this.lastSpeed < REST_SPEED ? REST_DAMPING : DAMPING + (REST_DAMPING - DAMPING) * ramp;
        for (let s = 0; s < SUBSTEPS; s++) {
            const before = this.substepStart;
            before.set(p);
            this.dampSpin(spinKept);
            for (let i = 0; i < p.length; i += 3) {
                const vx = (p[i] - o[i]) * kept;
                const vy = (p[i + 1] - o[i + 1]) * kept;
                const vz = (p[i + 2] - o[i + 2]) * kept;
                o[i] = p[i];
                o[i + 1] = p[i + 1];
                o[i + 2] = p[i + 2];
                p[i] += vx;
                p[i + 1] += vy - g;
                p[i + 2] += vz;
            }
            for (let it = 0; it < ITERATIONS; it++) {
                this.solveDistances();
                this.updateFrames();
                // Limits every other pass: half the cost, and they hold as well.
                if (it % 2 === 0) {
                    this.solveJointLimits();
                }
                this.solveSelfCollision();
                this.collideGround(world, before, STATIC_FRICTION_SPEED * h);
            }
            this.collideWalls(world, before);
        }
        // Judge the body as a whole: the mean motion of its particles, so one limb held against the
        // floor by its joint limit (shuffling a few millimetres) does not keep it awake.
        let moved = 0;
        for (let i = 0; i < p.length; i += 3) {
            moved += Math.hypot(p[i] - start[i], p[i + 1] - start[i + 1], p[i + 2] - start[i + 2]);
        }
        this.lastSpeed = moved / (p.length / 3) / dt;
        this.lastDt = dt;
        this.resting = this.resting ? this.lastSpeed < WAKE_SPEED : this.lastSpeed < REST_SPEED;
        this.still = this.lastSpeed < SLEEP_SPEED ? this.still + dt : 0;
        // Landed: the root part lies on the floor, or the body rests against a standing NPC or
        // another body (it may never reach the floor).
        if (this.landedFor >= 0) {
            this.landedFor += dt;
        } else if (this.touching(this.parts[0].set) || this.propped) {
            this.landedFor = 0;
        }
        this.propped = false;
        this.awakeFor += dt;
        if (this.still >= SLEEP_TIME || this.awakeFor >= MAX_AWAKE_TIME || this.landedFor >= LANDED_SLEEP) {
            this.asleep = true;
            o.set(p);
        }
    }

    /**
     * Angular damping: each part's particles keep the part's mean velocity but only `kept` of their
     * motion relative to it (its spin).
     */
    private dampSpin(kept: number): void {
        const p = this.pos;
        const o = this.prev;
        for (const part of this.parts) {
            let mx = 0;
            let my = 0;
            let mz = 0;
            for (const k of part.set) {
                mx += p[k * 3] - o[k * 3];
                my += p[k * 3 + 1] - o[k * 3 + 1];
                mz += p[k * 3 + 2] - o[k * 3 + 2];
            }
            const n = part.set.length;
            mx /= n;
            my /= n;
            mz /= n;
            for (const k of part.set) {
                const i = k * 3;
                o[i] = p[i] - (mx + (p[i] - o[i] - mx) * kept);
                o[i + 1] = p[i + 1] - (my + (p[i + 1] - o[i + 1] - my) * kept);
                o[i + 2] = p[i + 2] - (mz + (p[i + 2] - o[i + 2] - mz) * kept);
            }
        }
    }

    private solveDistances(): void {
        const p = this.pos;
        const w = this.invMass;
        for (let k = 0; k < this.ca.length; k++) {
            const a = this.ca[k] * 3;
            const b = this.cb[k] * 3;
            const dx = p[b] - p[a];
            const dy = p[b + 1] - p[a + 1];
            const dz = p[b + 2] - p[a + 2];
            const d = Math.hypot(dx, dy, dz) || 1e-9;
            const wa = w[this.ca[k]];
            const wb = w[this.cb[k]];
            const f = (d - this.rest[k]) / d / (wa + wb || 1);
            p[a] += dx * f * wa;
            p[a + 1] += dy * f * wa;
            p[a + 2] += dz * f * wa;
            p[b] -= dx * f * wb;
            p[b + 1] -= dy * f * wb;
            p[b + 2] -= dz * f * wb;
        }
    }

    /** Current basis and rotation (base pose → now) of each part. */
    private updateFrames(): void {
        const p = this.pos;
        this.parts.forEach((part, i) => {
            const b = frame(sub(p, part.e1, p, part.c), sub(p, part.e2, p, part.c));
            this.basis[i] = b;
            rotationBetween(b, part.restBasis, this.rotation[i]);
        });
    }

    /**
     * Keeps every joint inside the bend and twist limits learned from the animations (spec 20.4):
     * a knee folds the way it folds when walking and never backwards.
     */
    private solveJointLimits(): void {
        const p = this.pos;
        const down = this.partDown;
        this.parts.forEach((part, i) => (down[i] = this.touching(part.own) ? 1 : 0));
        this.parts.forEach((part, index) => {
            const limit = part.limit;
            if (part.parent < 0 || !limit) {
                return;
            }
            const rq = this.rotation[part.parent];
            const j = part.joint * 3;
            const c = part.c * 3;
            const d = unit([p[c] - p[j], p[c + 1] - p[j + 1], p[c + 2] - p[j + 2]]);
            const clamped = clampDirection(limit, mulT(rq, d));
            if (clamped) {
                // Bend the joint back inside: the limb and everything hanging from it turn about
                // the joint one way, the rest of the body the other, shared by inertia so the
                // correction does not set the body spinning. Turning whole sides keeps every part
                // rigid, so the limit never fights the distance constraints.
                const target = mul(rq, clamped);
                const axis = cross3(d, target);
                const s = Math.hypot(axis[0], axis[1], axis[2]);
                const angle = Math.min(MAX_LIMIT_TURN, Math.atan2(s, dot(d, target)) * LIMIT_STIFFNESS);
                if (angle > MIN_LIMIT_TURN) {
                    this.turnJoint(part, [axis[0] / s, axis[1] / s, axis[2] / s], angle);
                }
            }
            // Twist about the limb's own axis, likewise. Only parts with a frame of their own: a
            // thin part's twist is too noisy to hold.
            if (!part.frameReliable) {
                return;
            }
            const excess = twistExcess(limit, twistAbout(rq, this.rotation[index], limit.twistAxis));
            const angle = Math.max(-MAX_LIMIT_TURN, Math.min(MAX_LIMIT_TURN, excess * LIMIT_STIFFNESS));
            if (Math.abs(angle) > MIN_LIMIT_TURN) {
                this.turnJoint(part, unit([p[c] - p[j], p[c + 1] - p[j + 1], p[c + 2] - p[j + 2]]), -angle);
            }
        });
    }

    /**
     * Turns a joint by `angle` about the world `axis` through it: the part's side by its share,
     * the rest of the body back by the remainder. Positions and previous positions turn together,
     * so the turn itself adds no speed (a body lying on the floor, turned, would otherwise flick
     * the contacts that lift off it into the air); then the two sides' spin about the axis that
     * carries the joint further past its limit is taken away, keeping their angular momentum. A
     * limit can only take energy out of the body.
     */
    private turnJoint(part: Part, axis: Vec3, angle: number): void {
        const p = this.pos;
        const o = this.prev;
        const j = part.joint * 3;
        const origin = [p[j], p[j + 1], p[j + 2]];
        // A side resting on the floor is held by it: the side in the air turns alone. When both
        // or neither touch, they share the turn by inertia.
        let childDown = false;
        let restDown = false;
        this.partDown.forEach((isDown, i) => {
            if (isDown && part.subtreeParts[i]) {
                childDown = true;
            } else if (isDown) {
                restDown = true;
            }
        });
        const share = childDown === restDown ? part.childShare : restDown ? 1 : 0;
        const childAngle = angle * share;
        const restAngle = childAngle - angle;
        const s = this.substepStart;
        let cos = Math.cos(childAngle);
        let sin = Math.sin(childAngle);
        for (const k of part.subtree) {
            rotateAbout(p, k * 3, origin, axis, cos, sin);
            rotateAbout(o, k * 3, origin, axis, cos, sin);
            rotateAbout(s, k * 3, origin, axis, cos, sin);
        }
        cos = Math.cos(restAngle);
        sin = Math.sin(restAngle);
        for (const k of part.complement) {
            rotateAbout(p, k * 3, origin, axis, cos, sin);
            rotateAbout(o, k * 3, origin, axis, cos, sin);
            rotateAbout(s, k * 3, origin, axis, cos, sin);
        }
        // Every part's rotation turns with its side.
        const turnChild = axisAngle(axis, childAngle);
        const turnRest = axisAngle(axis, restAngle);
        const was = this.scratch;
        this.rotation.forEach((r, i) => {
            for (let k = 0; k < 9; k++) {
                was[k] = r[k];
            }
            matMul(part.subtreeParts[i] ? turnChild : turnRest, was, r);
        });
        // Each side's spin about the axis: angular momentum over moment of inertia.
        const spin = (set: number[]): [number, number] => {
            let momentum = 0;
            let inertia = 0;
            for (const k of set) {
                const m = 1 / (this.invMass[k] || 1);
                const rx = p[k * 3] - origin[0];
                const ry = p[k * 3 + 1] - origin[1];
                const rz = p[k * 3 + 2] - origin[2];
                const vx = p[k * 3] - o[k * 3];
                const vy = p[k * 3 + 1] - o[k * 3 + 1];
                const vz = p[k * 3 + 2] - o[k * 3 + 2];
                momentum += m * ((ry * vz - rz * vy) * axis[0] + (rz * vx - rx * vz) * axis[1] + (rx * vy - ry * vx) * axis[2]);
                const along = rx * axis[0] + ry * axis[1] + rz * axis[2];
                inertia += m * (rx * rx + ry * ry + rz * rz - along * along);
            }
            return [momentum, inertia];
        };
        const [lc, ic] = spin(part.subtree);
        const [lr, ir] = spin(part.complement);
        if (ic <= 0 || ir <= 0) {
            return;
        }
        // Relative spin, positive in the direction the correction turned the joint.
        const relative = (lc / ic - lr / ir) * Math.sign(angle);
        if (relative >= 0) {
            return;
        }
        const omega = relative * Math.sign(angle);
        const spinOf = (set: number[], change: number) => {
            for (const k of set) {
                const rx = p[k * 3] - origin[0];
                const ry = p[k * 3 + 1] - origin[1];
                const rz = p[k * 3 + 2] - origin[2];
                // v += change · (axis × r)
                o[k * 3] -= change * (axis[1] * rz - axis[2] * ry);
                o[k * 3 + 1] -= change * (axis[2] * rx - axis[0] * rz);
                o[k * 3 + 2] -= change * (axis[0] * ry - axis[1] * rx);
            }
        };
        spinOf(part.subtree, (-omega * ir) / (ic + ir));
        spinOf(part.complement, (omega * ic) / (ic + ir));
    }

    /** Every collision sphere's centre where its part is now (local coordinates), from the parts' current rotations. */
    private placeSpheres(): void {
        const p = this.pos;
        const w = this.sphereWorld;
        this.parts.forEach((part, i) => {
            const r = this.rotation[i];
            const c = part.c * 3;
            const [ox, oy, oz] = part.restOrigin;
            const base = this.sphereOffset[i];
            for (let s = 0; s < part.spheres.length; s += 4) {
                const d = [part.spheres[s] - ox, part.spheres[s + 1] - oy, part.spheres[s + 2] - oz];
                w[base + s] = p[c] + r[0] * d[0] + r[1] * d[1] + r[2] * d[2];
                w[base + s + 1] = p[c + 1] + r[3] * d[0] + r[4] * d[1] + r[5] * d[2];
                w[base + s + 2] = p[c + 2] + r[6] * d[0] + r[7] * d[1] + r[8] * d[2];
                w[base + s + 3] = part.spheres[s + 3];
            }
        });
    }

    /** Mean velocity of a part's particles, tiles per substep. */
    private partVelocity(part: Part): Vec3 {
        const p = this.pos;
        const o = this.prev;
        const v: Vec3 = [0, 0, 0];
        for (const k of part.set) {
            v[0] += p[k * 3] - o[k * 3];
            v[1] += p[k * 3 + 1] - o[k * 3 + 1];
            v[2] += p[k * 3 + 2] - o[k * 3 + 2];
        }
        return [v[0] / part.set.length, v[1] / part.set.length, v[2] / part.set.length];
    }

    /** Moves a part's particles by `move` without changing their speed, then changes their velocity by `dv` (tiles per substep). */
    private shiftPart(part: Part, move: Vec3, dv: Vec3): void {
        for (const k of part.set) {
            for (let x = 0; x < 3; x++) {
                this.pos[k * 3 + x] += move[x];
                this.prev[k * 3 + x] += move[x] - dv[x];
            }
        }
    }

    /** The body's mass, kg. */
    get mass(): number {
        return this.totalMass;
    }

    /** Velocity of the body's centre of mass, tiles/s (three.js axes). */
    velocity(): Vec3 {
        const p = this.pos;
        const o = this.prev;
        const v: Vec3 = [0, 0, 0];
        let total = 0;
        for (let k = 0; k < p.length / 3; k++) {
            const m = this.invMass[k] > 0 ? 1 / this.invMass[k] : 0;
            total += m;
            v[0] += m * (p[k * 3] - o[k * 3]);
            v[1] += m * (p[k * 3 + 1] - o[k * 3 + 1]);
            v[2] += m * (p[k * 3 + 2] - o[k * 3 + 2]);
        }
        const h = this.lastDt / SUBSTEPS;
        return [v[0] / total / h, v[1] / total / h, v[2] / total / h];
    }

    /** A sphere around the whole body: centre (three.js world space) and radius, tiles. */
    bounds(): { x: number; y: number; z: number; r: number } {
        const [x, y, z] = this.rootPosition();
        let r = 0;
        this.parts.forEach((part, i) => {
            const c = part.c * 3;
            r = Math.max(r, Math.hypot(this.pos[c] + this.originX - x, this.pos[c + 1] - y, this.pos[c + 2] + this.originZ - z) + this.partReach[i]);
        });
        return { x, y, z, r };
    }

    /**
     * Where the body touches an upright cylinder (a standing NPC: axis at three.js x, z, from
     * `bottom` to `top`): the horizontal direction from the axis out to the touching parts (depth-
     * weighted), how deep the deepest sphere is in, and how fast the body's centre of mass moves
     * in along it (tiles/s; negative when moving away). Undefined when nothing touches.
     */
    touchCylinder(x: number, z: number, bottom: number, top: number, radius: number): { nx: number; nz: number; depth: number; closing: number } | undefined {
        this.updateFrames();
        this.placeSpheres();
        const w = this.sphereWorld;
        let nx = 0;
        let nz = 0;
        let depth = 0;
        for (let s = 0; s < w.length; s += 4) {
            const dx = w[s] + this.originX - x;
            const dz = w[s + 2] + this.originZ - z;
            const d = Math.hypot(dx, dz);
            const r = w[s + 3];
            const overlap = r + radius - d;
            if (overlap <= 0 || w[s + 1] + r < bottom || w[s + 1] - r > top) {
                continue;
            }
            const scale = d > 1e-6 ? overlap / d : 0;
            nx += dx * scale;
            nz += dz * scale;
            depth = Math.max(depth, overlap);
        }
        if (depth === 0) {
            return undefined;
        }
        const v = this.velocity();
        let l = Math.hypot(nx, nz);
        if (l < 1e-9) {
            // Centred on the axis: out the way the body came from.
            nx = -v[0];
            nz = -v[2];
            l = Math.hypot(nx, nz) || 1;
        }
        nx /= l;
        nz /= l;
        return { nx, nz, depth, closing: -(v[0] * nx + v[2] * nz) };
    }

    /**
     * Pushes the body out of an upright cylinder that does not give way (a standing NPC it is not
     * knocking down): each part inside is moved out sideways, without changing its speed, and its
     * motion into the cylinder stops.
     */
    pushOutOfCylinder(x: number, z: number, bottom: number, top: number, radius: number): void {
        if (this.asleep) {
            // At rest against the NPC: it stays as it lies.
            return;
        }
        this.updateFrames();
        this.placeSpheres();
        const w = this.sphereWorld;
        let moved = false;
        this.parts.forEach((part, i) => {
            const first = this.sphereOffset[i];
            let best = 0;
            let n: Vec3 = [0, 0, 0];
            for (let s = first; s < first + part.spheres.length; s += 4) {
                const dx = w[s] + this.originX - x;
                const dz = w[s + 2] + this.originZ - z;
                const d = Math.hypot(dx, dz);
                const r = w[s + 3];
                const overlap = r + radius - d;
                if (overlap > best && d > 1e-6 && w[s + 1] + r >= bottom && w[s + 1] - r <= top) {
                    best = overlap;
                    n = [dx / d, 0, dz / d];
                }
            }
            if (best <= 0) {
                return;
            }
            const push = Math.min(MAX_BODY_PUSH, best);
            const v = this.partVelocity(part);
            const into = Math.min(0, v[0] * n[0] + v[2] * n[2]);
            this.shiftPart(part, [n[0] * push, 0, n[2] * push], [-n[0] * into, 0, -n[2] * into]);
            moved = true;
        });
        if (moved) {
            this.propped = true;
        }
    }

    /** Adds a velocity (tiles/s, three.js axes) to the whole body, scaled for the last step's length. */
    addSpeed(vx: number, vy: number, vz: number): void {
        this.addVelocity(vx, vy, vz, this.lastDt);
    }

    /**
     * Two bodies on the ground keep out of each other (spec 20.7): overlapping spheres of their
     * parts push the parts apart, the lighter further, without adding speed, and their motion into
     * each other stops. A sleeping body only gives way, and wakes, when it is really pushed.
     */
    static collide(a: Ragdoll, b: Ragdoll): void {
        if ((a.asleep && b.asleep) || a.plane !== b.plane) {
            return;
        }
        const ba = a.bounds();
        const bb = b.bounds();
        if (Math.hypot(ba.x - bb.x, ba.y - bb.y, ba.z - bb.z) >= ba.r + bb.r) {
            return;
        }
        a.updateFrames();
        a.placeSpheres();
        b.updateFrames();
        b.placeSpheres();
        // b's local coordinates in a's.
        const ox = b.originX - a.originX;
        const oz = b.originZ - a.originZ;
        const wa = a.sphereWorld;
        const wb = b.sphereWorld;
        let touched = false;
        a.parts.forEach((pa, i) => {
            const ca = pa.c * 3;
            b.parts.forEach((pb, j) => {
                const cb = pb.c * 3;
                const reach = a.partReach[i] + b.partReach[j];
                if ((a.pos[ca] - b.pos[cb] - ox) ** 2 + (a.pos[ca + 1] - b.pos[cb + 1]) ** 2 + (a.pos[ca + 2] - b.pos[cb + 2] - oz) ** 2 >= reach * reach) {
                    return;
                }
                const fa = a.sphereOffset[i];
                const fb = b.sphereOffset[j];
                for (let s = fa; s < fa + pa.spheres.length; s += 4) {
                    for (let t = fb; t < fb + pb.spheres.length; t += 4) {
                        const dx = wb[t] + ox - wa[s];
                        const dy = wb[t + 1] - wa[s + 1];
                        const dz = wb[t + 2] + oz - wa[s + 2];
                        const contact = wa[s + 3] + wb[t + 3];
                        const d2 = dx * dx + dy * dy + dz * dz;
                        if (d2 >= contact * contact) {
                            continue;
                        }
                        const d = Math.sqrt(d2) || 1e-6;
                        const n: Vec3 = d2 > 0 ? [dx / d, dy / d, dz / d] : [0, 1, 0];
                        const va = a.partVelocity(pa);
                        const vb = b.partVelocity(pb);
                        const closing = Math.min(0, (vb[0] - va[0]) * n[0] + (vb[1] - va[1]) * n[1] + (vb[2] - va[2]) * n[2]);
                        // A sleeping body stays put unless pushed hard; then it wakes and shares.
                        const hard = -closing / (a.lastDt / SUBSTEPS) > WAKE_BY_BODY_SPEED;
                        const aMoves = !a.asleep || hard;
                        const bMoves = !b.asleep || hard;
                        const shareA = !bMoves ? 1 : !aMoves ? 0 : pb.mass / (pa.mass + pb.mass);
                        const push = Math.min(MAX_BODY_PUSH, contact - d);
                        a.propped = b.propped = true;
                        if (aMoves) {
                            a.shiftPart(pa, [-n[0] * push * shareA, -n[1] * push * shareA, -n[2] * push * shareA], [n[0] * closing * shareA, n[1] * closing * shareA, n[2] * closing * shareA]);
                        }
                        if (bMoves) {
                            const s2 = 1 - shareA;
                            b.shiftPart(pb, [n[0] * push * s2, n[1] * push * s2, n[2] * push * s2], [-n[0] * closing * s2, -n[1] * closing * s2, -n[2] * closing * s2]);
                        }
                        if (hard) {
                            touched = true;
                        }
                        // The spheres moved with their parts.
                        for (let k = fa; k < fa + pa.spheres.length; k += 4) {
                            wa[k] -= n[0] * push * shareA;
                            wa[k + 1] -= n[1] * push * shareA;
                            wa[k + 2] -= n[2] * push * shareA;
                        }
                        for (let k = fb; k < fb + pb.spheres.length; k += 4) {
                            wb[k] += n[0] * push * (1 - shareA);
                            wb[k + 1] += n[1] * push * (1 - shareA);
                            wb[k + 2] += n[2] * push * (1 - shareA);
                        }
                    }
                }
            });
        });
        if (touched) {
            if (a.asleep) {
                a.wake();
            }
            if (b.asleep) {
                b.wake();
            }
        }
    }

    /**
     * Keeps body parts out of each other (spec 20.5): two overlapping spheres of different parts
     * push the parts apart, the lighter one further, and stop their motion into each other. The
     * push moves previous positions too, so it adds no speed: only the stop changes velocities,
     * and a stop can only take energy out.
     */
    private solveSelfCollision(): void {
        if (this.spherePairs.length === 0) {
            return;
        }
        const p = this.pos;
        const o = this.prev;
        const w = this.sphereWorld;
        this.placeSpheres();
        const velocity = (part: Part): Vec3 => {
            const v: Vec3 = [0, 0, 0];
            for (const k of part.set) {
                v[0] += p[k * 3] - o[k * 3];
                v[1] += p[k * 3 + 1] - o[k * 3 + 1];
                v[2] += p[k * 3 + 2] - o[k * 3 + 2];
            }
            return [v[0] / part.set.length, v[1] / part.set.length, v[2] / part.set.length];
        };
        // Moves a part's particles by `move` (current and previous) and changes their velocity by `dv`.
        const shift = (index: number, move: Vec3, dv: Vec3) => {
            for (const k of this.parts[index].set) {
                for (let x = 0; x < 3; x++) {
                    p[k * 3 + x] += move[x];
                    o[k * 3 + x] += move[x] - dv[x];
                    this.substepStart[k * 3 + x] += move[x];
                }
            }
            const first = this.sphereOffset[index];
            const end = first + this.parts[index].spheres.length;
            for (let s = first; s < end; s += 4) {
                w[s] += move[0];
                w[s + 1] += move[1];
                w[s + 2] += move[2];
            }
        };
        const down = this.resting ? this.parts.map((part) => this.touching(part.set)) : undefined;
        for (const { a, b, reach, pairs } of this.spherePairs) {
            // At rest, two parts both lying on the floor are left as they lie: they cannot sink
            // into each other, and nudging them apart only fights the floor's grip. A limb lying
            // on the body is still held up by it.
            if (down && down[a] && down[b]) {
                continue;
            }
            const ca = this.parts[a].c * 3;
            const cb = this.parts[b].c * 3;
            if ((p[ca] - p[cb]) ** 2 + (p[ca + 1] - p[cb + 1]) ** 2 + (p[ca + 2] - p[cb + 2]) ** 2 >= reach * reach) {
                continue;
            }
            for (let q = 0; q < pairs.length; q += 3) {
                this.pushApart(a, pairs[q], b, pairs[q + 1], pairs[q + 2], velocity, shift);
            }
        }
    }

    /** Pushes two overlapping spheres' parts apart (see solveSelfCollision). */
    private pushApart(
        a: number,
        sa: number,
        b: number,
        sb: number,
        contact: number,
        velocity: (part: Part) => Vec3,
        shift: (index: number, move: Vec3, dv: Vec3) => void,
    ): void {
        const w = this.sphereWorld;
        const ia = this.sphereOffset[a] + sa;
        const ib = this.sphereOffset[b] + sb;
        const dx = w[ib] - w[ia];
        const dy = w[ib + 1] - w[ia + 1];
        const dz = w[ib + 2] - w[ia + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= contact * contact) {
            return;
        }
        const d = Math.sqrt(d2) || 1e-6;
        const push = Math.min(MAX_COLLISION_PUSH, (contact - d) * COLLISION_STIFFNESS);
        const pa = this.parts[a];
        const pb = this.parts[b];
        const shareA = pb.mass / (pa.mass + pb.mass);
        const n: Vec3 = d2 > 0 ? [dx / d, dy / d, dz / d] : [0, 1, 0];
        // Their speed towards each other along the contact normal, taken away by mass.
        const va = velocity(pa);
        const vb = velocity(pb);
        const closing = Math.min(0, (vb[0] - va[0]) * n[0] + (vb[1] - va[1]) * n[1] + (vb[2] - va[2]) * n[2]);
        shift(a, [-n[0] * push * shareA, -n[1] * push * shareA, -n[2] * push * shareA], [n[0] * closing * shareA, n[1] * closing * shareA, n[2] * closing * shareA]);
        shift(
            b,
            [n[0] * push * (1 - shareA), n[1] * push * (1 - shareA), n[2] * push * (1 - shareA)],
            [-n[0] * closing * (1 - shareA), -n[1] * closing * (1 - shareA), -n[2] * closing * (1 - shareA)],
        );
    }

    /** `start`: positions at the start of the substep; `slip`: most a contact may slide in it and still stick. */
    private collideGround(world: RagdollWorld, start: Float32Array, slip: number): void {
        const p = this.pos;
        const o = this.prev;
        for (let i = 0; i < p.length; i += 3) {
            const ground = this.groundAt(world, p[i], p[i + 2]) + PARTICLE_RADIUS;
            this.onFloor[i / 3] = p[i + 1] < ground + FLOOR_CONTACT ? 1 : 0;
            if (p[i + 1] < ground) {
                p[i + 1] = ground;
                // Landing kills the downward motion. Moving `prev` along matters: Verlet would
                // otherwise turn the push out of the floor into an upward velocity and launch the body.
                o[i + 1] = ground;
                const sx = p[i] - o[i];
                const sz = p[i + 2] - o[i + 2];
                // Static friction holds a slow contact where it was at the start of the substep
                // (that point moved along with the joint limits' turns and the pushes between
                // parts, which are not sliding): the body cannot creep across the floor.
                const mx = p[i] - start[i];
                const mz = p[i + 2] - start[i + 2];
                if (mx * mx + mz * mz < slip * slip) {
                    p[i] = start[i];
                    p[i + 2] = start[i + 2];
                    o[i] = p[i];
                    o[i + 2] = p[i + 2];
                } else {
                    // Sliding friction: lose part of this step's sliding.
                    o[i] += sx * GROUND_FRICTION;
                    o[i + 2] += sz * GROUND_FRICTION;
                }
            }
        }
    }

    /** Tile walls and blocked tiles stop particles (tile space: x = X, y = −Z). */
    private collideWalls(world: RagdollWorld, before: Float32Array): void {
        const p = this.pos;
        for (let i = 0; i < p.length; i += 3) {
            const x0 = before[i] + this.originX;
            const y0 = -(before[i + 2] + this.originZ);
            const x1 = sweepAxis(world.flagsAt, this.plane, x0, y0, PARTICLE_RADIUS, true, p[i] + this.originX - x0, this.boxes);
            const y1 = sweepAxis(world.flagsAt, this.plane, x1, y0, PARTICLE_RADIUS, false, -(p[i + 2] + this.originZ) - y0, this.boxes);
            p[i] = x1 - this.originX;
            p[i + 2] = -y1 - this.originZ;
        }
    }

    /**
     * Writes every model vertex's world position (three.js axes, 3 per vertex) into `out`. A part
     * whose vertices would sink into the floor is lifted out, in the drawing and in the simulation.
     */
    computeWorld(world: RagdollWorld, out: Float32Array): void {
        this.updateFrames();
        const p = this.pos;
        const b = this.base;
        this.parts.forEach((part, i) => {
            const r = this.rotation[i];
            const [ox, oy, oz] = part.restOrigin;
            const c = part.c * 3;
            const tx = p[c] + this.originX;
            const ty = p[c + 1];
            const tz = p[c + 2] + this.originZ;
            let lowest = Infinity;
            for (const v of part.vertices) {
                const dx = b[v * 3] - ox;
                const dy = b[v * 3 + 1] - oy;
                const dz = b[v * 3 + 2] - oz;
                const x = tx + r[0] * dx + r[1] * dy + r[2] * dz;
                const y = ty + r[3] * dx + r[4] * dy + r[5] * dz;
                const z = tz + r[6] * dx + r[7] * dy + r[8] * dz;
                out[v * 3] = x;
                out[v * 3 + 1] = y;
                out[v * 3 + 2] = z;
                lowest = Math.min(lowest, y - world.groundHeight(this.plane, x, -z));
            }
            if (lowest < 0) {
                // The hull particles keep the body out of the floor; what is left is the surface
                // between them, a few hundredths of a tile. It is lifted in the drawing only:
                // moving particles here would push energy into the joints and set the body twitching.
                for (const v of part.vertices) {
                    out[v * 3 + 1] -= lowest;
                }
            }
        });
    }

    /**
     * three.js yaw (rotation.y) that turns the model's facing (+z, south, in its base pose) the way
     * the root part now faces, flattened onto the ground.
     */
    rootYaw(): number | undefined {
        this.updateFrames();
        const r = this.rotation[0];
        // Lying on its back or front the facing points up or down: no usable direction.
        return Math.hypot(r[2], r[8]) < 0.3 ? undefined : Math.atan2(r[2], r[8]);
    }
}
