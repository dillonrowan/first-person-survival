import type { NpcClip, NpcModelData, NpcSkeleton } from "../world/NpcFormat";
import { RS_UNITS_PER_TILE } from "../world/WorldFormat";
import { HIT_BONES, HIT_CLIPS, HIT_RIG_NECK_HEIGHT, HitClip, HitClipName, LUNGE_CLIP } from "./HitClips";

/**
 * Hit reactions drawn on top of an NPC's baked animation frame. Humanoids play the clips authored
 * in tools/blender/hit_reactions.blend on a virtual skeleton fitted to their body parts; every
 * other body gets spring-damped recoil of each part about its joint. Positions are model space in
 * three.js axes (tiles, +y up, the body facing +z, its left at +x).
 */

type Vec3 = [number, number, number];
type BoneName = (typeof HIT_BONES)[number];

const BONE = Object.fromEntries(HIT_BONES.map((name, i) => [name, i])) as Record<BoneName, number>;
/** Parent of each bone in the authored rig (parents come first). */
const BONE_PARENT = HIT_BONES.map((name) => {
    const parent: Partial<Record<BoneName, BoneName>> = {
        spine: "pelvis",
        head: "spine",
        "upperarm.R": "spine",
        "forearm.R": "upperarm.R",
        "hand.R": "forearm.R",
        "upperarm.L": "spine",
        "forearm.L": "upperarm.L",
        "hand.L": "forearm.L",
        "thigh.R": "pelvis",
        "shin.R": "thigh.R",
        "foot.R": "shin.R",
        "thigh.L": "pelvis",
        "shin.L": "thigh.L",
        "foot.L": "shin.L",
    };
    return parent[name] === undefined ? -1 : BONE[parent[name]!];
});
/** The bone on the other side of the body, for mirrored clips. */
const MIRROR_BONE = HIT_BONES.map((name) => BONE[(name.endsWith(".R") ? name.replace(".R", ".L") : name.replace(".L", ".R")) as BoneName]);
const FRAME_STRIDE = HIT_BONES.length * 4 + 3;

/** Recoil spring (per second²) and damping ratio of non-humanoid parts, and their largest swing. [design] */
const SPRING = 160;
const DAMPING_RATIO = 0.3;
const MAX_SWING = 0.5;
/** Seconds the stun loop fades in and out. [design] */
const STUN_FADE = 0.15;
/** Most hit clips layered at once; the oldest is dropped. [design] */
const MAX_LAYERS = 3;
/** The waist sits this share of the body's height above the hips when no part bends there. [design] */
const WAIST_ABOVE_HIPS = 0.085;

const STRENGTH = { flinch: 1, stagger: 1.6, push: 2.2, stun: 1.4 } as const;
export type HitKind = keyof typeof STRENGTH;

/** A humanoid body's fit to the authored rig. */
export type Humanoid = {
    /** Bone each part rides on. */
    boneOfPart: Int8Array;
    /** Base-pose joint of each bone. */
    joints: Float32Array;
    /** Parts whose motion carries each bone's joint into an animation frame (-1: from the thighs). */
    carriers: number[][];
    /** Body size against the rig, for the pelvis offsets. */
    scale: number;
};

/** A model's body parts and (for humanoids) its fitted skeleton, shared by every NPC using it. */
export class BodyRig {
    readonly parents: Int8Array;
    readonly partOf: Uint8Array;
    readonly pivots: Float32Array;
    readonly centroids: Float32Array;
    readonly sizes: number[];
    readonly height: number;
    readonly humanoid: Humanoid | undefined;
    private readonly vertices: number[][];
    private readonly frames = new Map<NpcClip, ({ parts: Float32Array; bones?: Float32Array } | undefined)[]>();

    constructor(
        private readonly model: Pick<NpcModelData, "vertexCount"> & { skeleton?: NpcSkeleton },
        private readonly base: Float32Array,
    ) {
        const skeleton = model.skeleton!;
        const count = skeleton.parents.length;
        this.parents = skeleton.parents;
        this.partOf = skeleton.partOf.map((p) => (p >= count ? 0 : p));
        this.vertices = Array.from({ length: count }, () => []);
        this.partOf.forEach((p, v) => this.vertices[p].push(v));
        this.sizes = this.vertices.map((v) => v.length);
        this.pivots = new Float32Array(count * 3);
        this.centroids = new Float32Array(count * 3);
        let top = 0;
        for (let p = 0; p < count; p++) {
            this.pivots[p * 3] = skeleton.pivots[p * 3] / RS_UNITS_PER_TILE;
            this.pivots[p * 3 + 1] = -skeleton.pivots[p * 3 + 1] / RS_UNITS_PER_TILE;
            this.pivots[p * 3 + 2] = -skeleton.pivots[p * 3 + 2] / RS_UNITS_PER_TILE;
            const vs = this.vertices[p];
            for (const v of vs) {
                for (let k = 0; k < 3; k++) {
                    this.centroids[p * 3 + k] += base[v * 3 + k] / vs.length;
                }
                top = Math.max(top, base[v * 3 + 1]);
            }
            if (vs.length === 0) {
                this.centroids.set(this.pivots.subarray(p * 3, p * 3 + 3), p * 3);
            }
        }
        this.height = Math.max(0.25, top);
        this.humanoid = fitHumanoid(this.parents, this.pivots, this.centroids, this.sizes, this.height);
    }

    get partCount(): number {
        return this.parents.length;
    }

    /**
     * The joints where `frame` of `clip` draws them: each part's, and each humanoid bone's. A joint
     * is carried by the best affine fit of its parts' vertices from the base pose to the frame.
     */
    jointsAt(clip: NpcClip | undefined, frame: number): { parts: Float32Array; bones?: Float32Array } {
        if (!clip) {
            return { parts: this.pivots, bones: this.humanoid?.joints };
        }
        let cache = this.frames.get(clip);
        if (!cache) {
            cache = new Array(clip.frameLengths.length);
            this.frames.set(clip, cache);
        }
        let found = cache[frame];
        if (!found) {
            const n = this.model.vertexCount;
            const at = (v: number, k: number) => ((k === 0 ? 1 : -1) * clip.positions[(frame * n + v) * 3 + k]) / RS_UNITS_PER_TILE;
            const move = (point: ArrayLike<number>, i: number, carriers: number[]): Vec3 => {
                const p: Vec3 = [point[i * 3], point[i * 3 + 1], point[i * 3 + 2]];
                const fits = carriers.map((q) => carry(this.vertices[q], this.base, at, p)).filter((x): x is Vec3 => x !== undefined);
                return fits.length > 0 ? average(fits) : p;
            };
            const parts = new Float32Array(this.pivots.length);
            for (let p = 0; p < this.partCount; p++) {
                parts.set(move(this.pivots, p, this.parents[p] >= 0 ? [p, this.parents[p]] : [p]), p * 3);
            }
            const h = this.humanoid;
            let bones: Float32Array | undefined;
            if (h) {
                bones = new Float32Array(h.joints.length);
                for (let b = 0; b < HIT_BONES.length; b++) {
                    if (h.carriers[b].length > 0) {
                        bones.set(move(h.joints, b, h.carriers[b]), b * 3);
                    }
                }
                // The pelvis turns about the middle of the hips.
                for (let k = 0; k < 3; k++) {
                    bones[k] = (bones[BONE["thigh.R"] * 3 + k] + bones[BONE["thigh.L"] * 3 + k]) / 2;
                }
            }
            found = { parts, bones };
            cache[frame] = found;
        }
        return found;
    }
}

const rigs = new WeakMap<NpcModelData, BodyRig | null>();

/** The model's rig, or undefined for models without a skeleton. */
export function bodyRig(model: NpcModelData, base: () => Float32Array): BodyRig | undefined {
    let rig = rigs.get(model);
    if (rig === undefined) {
        rig = model.skeleton && model.skeleton.parents.length > 0 ? new BodyRig(model, base()) : null;
        rigs.set(model, rig);
    }
    return rig ?? undefined;
}

/** Where an affine fit of `vertices` (base → frame) carries `point`, if they span 3D. */
function carry(vertices: number[], base: Float32Array, at: (v: number, k: number) => number, point: Vec3): Vec3 | undefined {
    const n = vertices.length;
    if (n < 4) {
        return undefined;
    }
    const mb: Vec3 = [0, 0, 0];
    const mf: Vec3 = [0, 0, 0];
    for (const v of vertices) {
        for (let k = 0; k < 3; k++) {
            mb[k] += base[v * 3 + k] / n;
            mf[k] += at(v, k) / n;
        }
    }
    // A = (Σ f bᵀ)(Σ b bᵀ)⁻¹ over centred points.
    const bb = new Array<number>(9).fill(0);
    const fb = new Array<number>(9).fill(0);
    for (const v of vertices) {
        const b = [base[v * 3] - mb[0], base[v * 3 + 1] - mb[1], base[v * 3 + 2] - mb[2]];
        const f = [at(v, 0) - mf[0], at(v, 1) - mf[1], at(v, 2) - mf[2]];
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                bb[i * 3 + j] += b[i] * b[j];
                fb[i * 3 + j] += f[i] * b[j];
            }
        }
    }
    const inv = invert3(bb);
    if (!inv) {
        return undefined;
    }
    const d = [point[0] - mb[0], point[1] - mb[1], point[2] - mb[2]];
    const out: Vec3 = [...mf];
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            let a = 0;
            for (let k = 0; k < 3; k++) {
                a += fb[i * 3 + k] * inv[k * 3 + j];
            }
            out[i] += a * d[j];
        }
    }
    return out;
}

function invert3(m: number[]): number[] | undefined {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const det = a * A + b * B + c * C;
    // Flat or tiny parts (a hand of four coplanar points) give no reliable fit.
    if (Math.abs(det) < 1e-9) {
        return undefined;
    }
    const s = 1 / det;
    return [A * s, -(b * i - c * h) * s, (b * f - c * e) * s, B * s, (a * i - c * g) * s, -(a * f - c * d) * s, C * s, -(a * h - b * g) * s, (a * e - b * d) * s];
}

const average = (points: Vec3[]): Vec3 => [0, 1, 2].map((k) => points.reduce((s, p) => s + p[k], 0) / points.length) as Vec3;

/**
 * Fits the authored humanoid rig to a body, whatever its part numbering and extras (collarbones,
 * weapons, capes, a chest as the root): head, then each arm and leg traced from its outermost part
 * up to the body, then the waist where they meet. Undefined for anything that is not a humanoid.
 */
export function fitHumanoid(parents: Int8Array, pivots: Float32Array, centroids: Float32Array, sizes: number[], height: number): Humanoid | undefined {
    const count = parents.length;
    const cx = (p: number) => centroids[p * 3];
    const cy = (p: number) => centroids[p * 3 + 1];
    const pivot = (p: number): Vec3 => [pivots[p * 3], pivots[p * 3 + 1], pivots[p * 3 + 2]];
    const ancestors = (p: number): number[] => {
        const out: number[] = [];
        for (let q = p; q >= 0; q = parents[q]) {
            out.push(q);
        }
        return out;
    };
    const solid = [...Array(count).keys()].filter((p) => sizes[p] > 0);
    const extreme = (candidates: number[], score: (p: number) => number) =>
        candidates.length > 0 ? candidates.reduce((a, b) => (score(b) < score(a) ? b : a)) : undefined;

    /** From an outermost part up while it stays off the middle; leading stubs shorter than `stub` dropped. */
    const limb = (end: number, offCentre: number, stub: number): number[] => {
        const chain: number[] = [];
        for (const q of ancestors(end)) {
            if (Math.abs(pivot(q)[0]) < offCentre && chain.length > 0) {
                break;
            }
            chain.unshift(q);
        }
        while (chain.length > 2) {
            const [a, b] = [pivot(chain[0]), pivot(chain[1])];
            if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) >= stub) {
                break;
            }
            chain.shift();
        }
        return chain;
    };

    const head = extreme(
        solid.filter((p) => sizes[p] >= 4 && Math.abs(cx(p)) < 0.12),
        (p) => -cy(p),
    );
    const armZone = solid.filter((p) => cy(p) > 0.3 * height);
    const handR = extreme(armZone.filter((p) => cx(p) < -0.1), cx);
    const handL = extreme(armZone.filter((p) => cx(p) > 0.1), (p) => -cx(p));
    const footR = extreme(solid.filter((p) => cx(p) < -0.02 && cy(p) < 0.35 * height), cy);
    const footL = extreme(solid.filter((p) => cx(p) > 0.02 && cy(p) < 0.35 * height), cy);
    if ([head, handR, handL, footR, footL].some((p) => p === undefined)) {
        return undefined;
    }
    const stub = 0.06 * height;
    const arms = [limb(handR!, 0.06, stub), limb(handL!, 0.06, stub)];
    const legs = [limb(footR!, 0.03, stub), limb(footL!, 0.03, stub)];
    if (arms.some((c) => c.length < 2) || legs.some((c) => c.length < 2)) {
        return undefined;
    }
    // Legs hang below the arms, the head above them; the four limbs are distinct.
    const limbParts = [...arms, ...legs].flat();
    if (new Set(limbParts).size !== limbParts.length || limbParts.includes(head!)) {
        return undefined;
    }
    if (pivot(legs[0][0])[1] >= pivot(arms[0][0])[1] || cy(head!) <= pivot(arms[0][0])[1]) {
        return undefined;
    }
    // Upright: the head well above the hips and not far ahead of them (not a dragon or a bird),
    // the shoulders above the hips, and arms that do not reach the ground (not front legs).
    const hipY = (pivot(legs[0][0])[1] + pivot(legs[1][0])[1]) / 2;
    const hipZ = (pivot(legs[0][0])[2] + pivot(legs[1][0])[2]) / 2;
    const rise = cy(head!) - hipY;
    if (
        rise < 0.3 * height ||
        Math.abs(centroids[head! * 3 + 2] - hipZ) > 0.6 * rise ||
        arms.some((a) => pivot(a[0])[1] - hipY < 0.2 * height) ||
        arms.flat().some((p) => cy(p) < 0.2 * height)
    ) {
        return undefined;
    }

    // The chest: where the head and arms meet.
    const headPath = ancestors(head!);
    const common = (a: number[], b: number[]) => a.find((q) => b.includes(q));
    let chest = common(headPath, ancestors(arms[0][0]));
    chest = chest === undefined ? undefined : common(ancestors(chest), ancestors(arms[1][0]));
    if (chest === undefined) {
        return undefined;
    }
    const legRoots = legs.map((l) => l[0]);
    const chestHoldsLegs = legRoots.some((l) => ancestors(l).includes(chest));

    const boneOfPart = new Int8Array(count).fill(-1);
    const joints = new Float32Array(HIT_BONES.length * 3);
    const carriers: number[][] = HIT_BONES.map(() => []);
    const setBone = (bone: number, firstPart: number, point: Vec3 = pivot(firstPart)) => {
        joints.set(point, bone * 3);
        carriers[bone] = parents[firstPart] >= 0 ? [firstPart, parents[firstPart]] : [firstPart];
    };

    const names: BoneName[][] = [
        ["upperarm.R", "forearm.R", "hand.R"],
        ["upperarm.L", "forearm.L", "hand.L"],
        ["thigh.R", "shin.R", "foot.R"],
        ["thigh.L", "shin.L", "foot.L"],
    ];
    [...arms, ...legs].forEach((chain, i) => {
        names[i].forEach((name, j) => {
            const part = chain[Math.min(j, chain.length - 1)];
            if (j < chain.length) {
                boneOfPart[part] = BONE[name];
                setBone(BONE[name], part);
            } else {
                // No such part (a body without hands): the bone sits at the chain's end and moves nothing.
                setBone(BONE[name], part, [cx(part), cy(part), centroids[part * 3 + 2]]);
            }
        });
    });
    // Collarbones and hip stubs left out of the chains ride on the body.
    for (const [i, chain] of [...arms, ...legs].entries()) {
        for (let q = parents[chain[0]]; q >= 0 && boneOfPart[q] < 0 && q !== chest; q = parents[q]) {
            if (Math.abs(pivot(q)[0]) >= (i < 2 ? 0.06 : 0.03)) {
                boneOfPart[q] = i < 2 ? BONE.spine : BONE.pelvis;
            }
        }
    }

    // The neck: the topmost part below the chest on the way to the head.
    const neck = headPath[headPath.indexOf(chest) - 1] ?? head!;
    boneOfPart[neck] = BONE.head;
    setBone(BONE.head, neck);

    const hips: Vec3 = [0, 1, 2].map((k) => (pivots[legRoots[0] * 3 + k] + pivots[legRoots[1] * 3 + k]) / 2) as Vec3;
    let waist: Vec3;
    if (chestHoldsLegs) {
        // The root is the chest (skeletons, zombies): bend just above the hips.
        waist = [hips[0], hips[1] + WAIST_ABOVE_HIPS * height, hips[2]];
        carriers[BONE.spine] = [chest];
        joints.set(waist, BONE.spine * 3);
        boneOfPart[chest] = BONE.spine;
    } else {
        // The topmost part between the root and the chest bends at the waist.
        const path = ancestors(chest);
        const lower = path[path.length - 2] ?? chest;
        for (const q of path.slice(0, path.indexOf(lower) + 1)) {
            boneOfPart[q] = BONE.spine;
        }
        setBone(BONE.spine, lower);
        waist = pivot(lower);
    }
    joints.set(hips, BONE.pelvis * 3);

    // Everything else rides on its parent's bone (parents come first): the root below a chest is
    // the pelvis, and what hangs straight off a chest root goes with the pelvis below the waist.
    for (let p = 0; p < count; p++) {
        if (boneOfPart[p] >= 0) {
            continue;
        }
        const parent = parents[p];
        if (parent < 0) {
            boneOfPart[p] = BONE.pelvis;
        } else if (parent === chest && chestHoldsLegs) {
            boneOfPart[p] = cy(p) < waist[1] ? BONE.pelvis : BONE.spine;
        } else {
            boneOfPart[p] = boneOfPart[parent];
        }
    }

    const scale = Math.max(0.3, joints[BONE.head * 3 + 1] / HIT_RIG_NECK_HEIGHT);
    return { boneOfPart, joints, carriers, scale };
}

type Layer = { clip: HitClip; time: number; mirror: boolean; weight: number; fade: number };

/** One NPC's running hit reactions: clip layers on a humanoid, part springs on anything else. */
export class HitReactions {
    private readonly layers: Layer[] = [];
    private stun: Layer | undefined;
    private readonly angle: Float32Array;
    private readonly spin: Float32Array;
    private springing = false;
    private wasActive = false;
    /** The generic lunge attack's pitch, forward and lift now (LUNGE_CLIP), while one plays. */
    private lunge: [number, number, number] | undefined;
    /** Local rotation (x, y, z, w) of each bone (humanoids) or part (springs), filled by pose(). */
    readonly local: Float32Array;
    readonly offset: Vec3 = [0, 0, 0];

    constructor(
        readonly rig: BodyRig,
        private readonly random: () => number = Math.random,
    ) {
        this.local = new Float32Array((rig.humanoid ? HIT_BONES.length : rig.partCount) * 4);
        this.angle = new Float32Array(rig.partCount * 3);
        this.spin = new Float32Array(rig.partCount * 3);
    }

    get humanoid(): boolean {
        return this.rig.humanoid !== undefined;
    }

    /** True while anything moves the body, and for one update after so the rest pose is drawn. */
    get active(): boolean {
        return this.layers.length > 0 || this.stun !== undefined || this.springing || this.lunge !== undefined || this.wasActive;
    }

    /**
     * Plays the generic lunge attack (for bodies without an attack animation of their own) `time`
     * seconds into a strike that lands at `hitTime` and lasts `total`; undefined stops it. The clip
     * is time-warped so its impact frame meets the strike's.
     */
    setLunge(strike: { time: number; hitTime: number; total: number } | undefined): void {
        if (!strike) {
            this.lunge = undefined;
            return;
        }
        const impact = LUNGE_CLIP.impactFrame / LUNGE_CLIP.fps;
        const end = (LUNGE_CLIP.frames - 1) / LUNGE_CLIP.fps;
        const { time, hitTime, total } = strike;
        const t =
            time < hitTime
                ? (time / Math.max(1e-6, hitTime)) * impact
                : impact + ((time - hitTime) / Math.max(1e-6, total - hitTime)) * (end - impact);
        const f = Math.min(LUNGE_CLIP.frames - 1, Math.max(0, t * LUNGE_CLIP.fps));
        const i = Math.min(Math.floor(f), LUNGE_CLIP.frames - 2);
        const k = f - i;
        const d = LUNGE_CLIP.data;
        this.lunge = [0, 1, 2].map((c) => d[i * 3 + c] + (d[(i + 1) * 3 + c] - d[i * 3 + c]) * k) as [number, number, number];
    }

    clear(): void {
        this.layers.length = 0;
        this.stun = undefined;
        this.angle.fill(0);
        this.spin.fill(0);
        this.springing = false;
    }

    /**
     * A hit of `kind` pushing the body along (along, left) in its own frame (along > 0 forward,
     * left > 0 towards its left), struck at `height` (0 feet .. 1 head).
     */
    hit(kind: HitKind, along: number, left: number, height = 0.5): void {
        if (!this.rig.humanoid) {
            this.kickSprings(STRENGTH[kind], along, left, height);
            return;
        }
        if (kind === "stun") {
            return; // the stun loop follows the combatant (setStunned)
        }
        const side = Math.abs(left) > Math.abs(along);
        const dir = side ? "side" : along > 0 ? "back" : "front";
        let name = `${kind}_${dir}` as HitClipName;
        // Side clips push the body towards its right; mirror them for a push to its left.
        let mirror = side && left > 0;
        if (kind === "flinch" && height >= 0.82) {
            name = "flinch_head";
            mirror = this.random() < 0.5;
        } else if (kind === "flinch" && height < 0.4) {
            // The struck leg buckles (authored on the right leg): pushed right means struck on the left.
            name = "flinch_leg";
            mirror = side ? left < 0 : this.random() < 0.5;
        }
        this.layers.push({ clip: HIT_CLIPS[name], time: 0, mirror, weight: 1, fade: 0 });
        while (this.layers.length > MAX_LAYERS) {
            this.layers.shift();
        }
    }

    /** Spins every part about its joint away from the hit, the parts near where it struck most. */
    private kickSprings(strength: number, along: number, left: number, height: number): void {
        const rig = this.rig;
        const len = Math.hypot(along, left) || 1;
        const d: Vec3 = [left / len, 0, along / len];
        const hitY = height * rig.height;
        for (let p = 0; p < rig.partCount; p++) {
            const r: Vec3 = p === 0 ? [0, rig.height * 0.5, 0] : ([0, 1, 2].map((k) => rig.centroids[p * 3 + k] - rig.pivots[p * 3 + k]) as Vec3);
            const near = Math.exp(-(((rig.centroids[p * 3 + 1] - hitY) / (0.35 * rig.height)) ** 2)) + 0.3;
            const scale = (strength * near * 0.8) / (r[0] * r[0] + r[1] * r[1] + r[2] * r[2] + 0.02);
            // Torque r × d.
            this.spin[p * 3] += (r[1] * d[2] - r[2] * d[1]) * scale;
            this.spin[p * 3 + 1] += (r[2] * d[0] - r[0] * d[2]) * scale;
            this.spin[p * 3 + 2] += (r[0] * d[1] - r[1] * d[0]) * scale;
        }
        this.springing = true;
    }

    /** Fades the humanoid stun loop in or out. */
    setStunned(stunned: boolean): void {
        if (!this.rig.humanoid) {
            return;
        }
        if (stunned && !this.stun) {
            this.stun = { clip: HIT_CLIPS.stun, time: 0, mirror: this.random() < 0.5, weight: 0, fade: 1 };
        } else if (stunned && this.stun) {
            this.stun.fade = 1;
        } else if (!stunned && this.stun) {
            this.stun.fade = -1;
        }
    }

    update(dt: number): void {
        this.wasActive = this.layers.length > 0 || this.stun !== undefined || this.springing || this.lunge !== undefined;
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const l = this.layers[i];
            l.time += dt;
            if (l.time >= (l.clip.frames - 1) / l.clip.fps) {
                this.layers.splice(i, 1);
            }
        }
        if (this.stun) {
            this.stun.time += dt;
            this.stun.weight = Math.min(1, Math.max(0, this.stun.weight + (this.stun.fade * dt) / STUN_FADE));
            if (this.stun.fade < 0 && this.stun.weight === 0) {
                this.stun = undefined;
            }
        }
        if (this.springing) {
            this.stepSprings(dt);
        }
    }

    private stepSprings(dt: number): void {
        const damping = 2 * DAMPING_RATIO * Math.sqrt(SPRING);
        const steps = Math.max(1, Math.ceil(dt * 120));
        const h = dt / steps;
        for (let s = 0; s < steps; s++) {
            for (let i = 0; i < this.angle.length; i++) {
                this.spin[i] += (-SPRING * this.angle[i] - damping * this.spin[i]) * h;
                this.angle[i] = Math.max(-MAX_SWING, Math.min(MAX_SWING, this.angle[i] + this.spin[i] * h));
            }
        }
        let energy = 0;
        for (let i = 0; i < this.angle.length; i++) {
            energy = Math.max(energy, Math.abs(this.angle[i]), Math.abs(this.spin[i]) * 0.05);
        }
        if (energy < 1e-3) {
            this.angle.fill(0);
            this.spin.fill(0);
            this.springing = false;
        }
    }

    /** Fills `local` and `offset` with the reaction's pose now. */
    pose(): void {
        const local = this.local;
        for (let i = 0; i < local.length; i += 4) {
            local[i] = local[i + 1] = local[i + 2] = 0;
            local[i + 3] = 1;
        }
        this.offset[0] = this.offset[1] = this.offset[2] = 0;
        if (this.lunge) {
            // The whole body leans about its root (+x is its side, so + pitch tips it forward).
            const [pitch, forward, lift] = this.lunge;
            local.set([Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)], 0);
            this.offset[1] = lift * this.rig.height;
            this.offset[2] = forward * this.rig.height;
        }
        const h = this.rig.humanoid;
        if (h) {
            for (const layer of this.layers) {
                this.addLayer(layer, h.scale);
            }
            if (this.stun) {
                this.addLayer(this.stun, h.scale);
            }
            return;
        }
        for (let p = 0; p < this.rig.partCount; p++) {
            const ax = this.angle[p * 3];
            const ay = this.angle[p * 3 + 1];
            const az = this.angle[p * 3 + 2];
            const a = Math.hypot(ax, ay, az);
            if (a > 1e-6) {
                const s = Math.sin(a / 2) / a;
                mulInto(local, p * 4, [ax * s, ay * s, az * s, Math.cos(a / 2)]);
            }
        }
    }

    private addLayer(layer: Layer, scale: number): void {
        const clip = layer.clip;
        const last = clip.frames - 1;
        let f = layer.time * clip.fps;
        f = clip.loop ? f % last : Math.min(last, f);
        const i = Math.min(Math.floor(f), Math.max(0, last - 1));
        const j = Math.min(i + 1, last);
        const k = f - i;
        const d = clip.data;
        const q = [0, 0, 0, 1];
        const identity = [0, 0, 0, 1];
        for (let b = 0; b < HIT_BONES.length; b++) {
            const source = layer.mirror ? MIRROR_BONE[b] : b;
            slerp(d, i * FRAME_STRIDE + source * 4, d, j * FRAME_STRIDE + source * 4, k, q);
            if (layer.mirror) {
                // Reflected through the body's midplane (x = 0).
                q[1] = -q[1];
                q[2] = -q[2];
            }
            if (layer.weight < 1) {
                slerp(identity, 0, q, 0, layer.weight, q);
            }
            mulInto(this.local, b * 4, q);
        }
        const t = HIT_BONES.length * 4;
        for (let axis = 0; axis < 3; axis++) {
            const v = d[i * FRAME_STRIDE + t + axis] + (d[j * FRAME_STRIDE + t + axis] - d[i * FRAME_STRIDE + t + axis]) * k;
            this.offset[axis] += (layer.mirror && axis === 0 ? -v : v) * layer.weight * scale;
        }
    }

    /**
     * Each part's rigid motion (rotation x, y, z, w and translation) for the pose now, about the
     * joints of the drawn frame.
     */
    motion(clip: NpcClip | undefined, frame: number, out: { q: Float32Array; t: Float32Array }): void {
        this.pose();
        const rig = this.rig;
        const joints = rig.jointsAt(clip, frame);
        const h = rig.humanoid;
        if (!h) {
            chainTransforms(rig.parents, joints.parts, this.local, this.offset, out.q, out.t);
            return;
        }
        const bq = new Float32Array(HIT_BONES.length * 4);
        const bt = new Float32Array(HIT_BONES.length * 3);
        chainTransforms(BONE_PARENT, joints.bones!, this.local, this.offset, bq, bt);
        for (let p = 0; p < rig.partCount; p++) {
            const b = h.boneOfPart[p];
            out.q.set(bq.subarray(b * 4, b * 4 + 4), p * 4);
            out.t.set(bt.subarray(b * 3, b * 3 + 3), p * 3);
        }
    }
}

/** out = slerp(a[ai..], b[bi..], t). */
function slerp(a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number, t: number, out: number[]): void {
    const ax = a[ai];
    const ay = a[ai + 1];
    const az = a[ai + 2];
    const aw = a[ai + 3];
    let bx = b[bi];
    let by = b[bi + 1];
    let bz = b[bi + 2];
    let bw = b[bi + 3];
    let cos = ax * bx + ay * by + az * bz + aw * bw;
    if (cos < 0) {
        cos = -cos;
        bx = -bx;
        by = -by;
        bz = -bz;
        bw = -bw;
    }
    let s0 = 1 - t;
    let s1 = t;
    if (cos < 0.9995) {
        const angle = Math.acos(cos);
        const sin = Math.sin(angle);
        s0 = Math.sin((1 - t) * angle) / sin;
        s1 = Math.sin(t * angle) / sin;
    }
    out[0] = ax * s0 + bx * s1;
    out[1] = ay * s0 + by * s1;
    out[2] = az * s0 + bz * s1;
    out[3] = aw * s0 + bw * s1;
}

/** target[i..] = target[i..] × q. */
function mulInto(target: Float32Array, i: number, q: number[]): void {
    const ax = target[i];
    const ay = target[i + 1];
    const az = target[i + 2];
    const aw = target[i + 3];
    const [bx, by, bz, bw] = q;
    target[i] = aw * bx + ax * bw + ay * bz - az * by;
    target[i + 1] = aw * by - ax * bz + ay * bw + az * bx;
    target[i + 2] = aw * bz + ax * by - ay * bx + az * bw;
    target[i + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/**
 * Forward kinematics: each node turns by its local rotation about its joint, carried by its
 * parent (parents before children); the root also moves by `offset`.
 */
export function chainTransforms(parents: ArrayLike<number>, joints: ArrayLike<number>, local: ArrayLike<number>, offset: Vec3, q: Float32Array, t: Float32Array): void {
    for (let p = 0; p < parents.length; p++) {
        const lx = local[p * 4];
        const ly = local[p * 4 + 1];
        const lz = local[p * 4 + 2];
        const lw = local[p * 4 + 3];
        const c: Vec3 = [joints[p * 3], joints[p * 3 + 1], joints[p * 3 + 2]];
        const rc = rotate(lx, ly, lz, lw, c);
        // Local motion: v → l(v − c) + c.
        const lt: Vec3 = [c[0] - rc[0], c[1] - rc[1], c[2] - rc[2]];
        const parent = parents[p];
        if (parent < 0) {
            q.set([lx, ly, lz, lw], p * 4);
            t.set([lt[0] + offset[0], lt[1] + offset[1], lt[2] + offset[2]], p * 3);
            continue;
        }
        const px = q[parent * 4];
        const py = q[parent * 4 + 1];
        const pz = q[parent * 4 + 2];
        const pw = q[parent * 4 + 3];
        q[p * 4] = pw * lx + px * lw + py * lz - pz * ly;
        q[p * 4 + 1] = pw * ly - px * lz + py * lw + pz * lx;
        q[p * 4 + 2] = pw * lz + px * ly - py * lx + pz * lw;
        q[p * 4 + 3] = pw * lw - px * lx - py * ly - pz * lz;
        const r = rotate(px, py, pz, pw, lt);
        t[p * 3] = r[0] + t[parent * 3];
        t[p * 3 + 1] = r[1] + t[parent * 3 + 1];
        t[p * 3 + 2] = r[2] + t[parent * 3 + 2];
    }
}

function rotate(x: number, y: number, z: number, w: number, v: Vec3): Vec3 {
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}

/** Moves one model-space point (three.js axes) by its part's motion. */
export function movePoint(q: Float32Array, t: Float32Array, part: number, v: Vec3): Vec3 {
    const r = rotate(q[part * 4], q[part * 4 + 1], q[part * 4 + 2], q[part * 4 + 3], v);
    return [r[0] + t[part * 3], r[1] + t[part * 3 + 1], r[2] + t[part * 3 + 2]];
}
