import * as THREE from "three";

import type { MoveDef, Ray, Timeline } from "./moves";
import { rayDirection, raySign } from "./SwingRay";

/**
 * Third-person melee poses: how the body holds and swings a weapon, as other players see it.
 *
 * Poses are in the body's view frame (Avatar.viewFrame: at the eyes, -Z ahead, +X right, turned to
 * the view's yaw and pitch). They are worked out in "body space", the same frame without its pitch,
 * then turned back by the pitch, so a held guard stays at the hip whatever the player looks at.
 *
 * A strike follows its own attack ray (moves.ts, SwingRay.ts): during the ray's window the blade
 * points along the ray as it sweeps, so what is seen to hit is what the hit trace tests. Before
 * the window the same arc runs backwards into a coiled wind-up (blade raised behind the shoulder),
 * after it on into a follow-through, with the arm bent at both ends and straight at contact.
 */

/** Held weapon: grip position, orientation (blade +Y, edge +Z), and where the free hand goes. */
export type BodyPose = { pos: THREE.Vector3; quat: THREE.Quaternion; offHand: THREE.Vector3 };

/** What the swing arcs about: between the right shoulder and the chest (body space, tiles). [design] */
const PIVOT = new THREE.Vector3(0.1, -0.22, 0.1);
/** Grip distance from PIVOT: arm straight at contact, bent at the wind-up and follow-through. [design] */
const CONTACT_REACH = 0.4;
const BENT_REACH = 0.26;
/** A thrust: grip pulled back to this, then driven out to THRUST_REACH. [design] */
const THRUST_DRAWN = 0.16;
const THRUST_REACH = 0.48;
/** How much of the view's pitch a strike follows: chops land lower when looking down. [design] */
const AIM_FOLLOW = 0.7;
/**
 * Where on its arc (0 at the ray's start, 1 at its end) a strike is wound up to, quick and power,
 * and how far it follows through. [design]
 */
const QUICK_COIL = -0.4;
const POWER_COIL = -0.8;
const FOLLOW = 1.45;
/**
 * No deeper a coil than this times the wind-up's length over the first ray's: a move whose ray
 * starts almost at once (a power attack released from its charge) winds up only as far as it can
 * swing back through in time. [design]
 */
const COIL_RATE = 1.2;
/** Wound up: grip raised (tiles per unit of coil) and blade tipped up; follow-through: dropped. [design] */
const COIL_LIFT = 0.14;
const COIL_TIP = 0.7;
const FOLLOW_DROP = 0.1;
const FOLLOW_TIP = 0.5;
/** Fraction of a wind-up spent getting to the coil; the rest accelerates into the ray. [design] */
const GATHER = 0.65;

/** Free hand: up at the left of the chest, pulled the opposite way to the weapon hand. [design] */
const OFF_HAND = new THREE.Vector3(-0.14, -0.42, -0.02);
const OFF_HAND_COUNTER = new THREE.Vector3(-0.4, 0, -0.3);

const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Grip, blade direction and edge direction in body space. */
type Hold = { hand: THREE.Vector3; blade: THREE.Vector3; edge: THREE.Vector3 };

/** Ready: grip in front of the right hip, blade angled forward and up, edge down. [design] */
const GUARD: Hold = { hand: v3(0.18, -0.42, -0.1), blade: v3(-0.12, 0.5, -0.86), edge: v3(0, -1, 0) };
/** At ease: arm hanging, blade pointing forward and down. [design] */
const RELAXED: Hold = { hand: v3(0.21, -0.56, 0.1), blade: v3(0.05, -0.45, -0.89), edge: v3(0, -1, 0) };
/** Blocking: blade held across in front of the face, edge to the enemy. [design] */
const BLOCK: Hold = { hand: v3(0.16, -0.16, -0.2), blade: v3(-0.9, 0.35, -0.25), edge: v3(0, 0.3, -1) };

/** A ray's direction at `u` (0..1 across its window, extrapolated beyond), in three.js axes. */
function rayDir(ray: Ray, sign: number, u: number): THREE.Vector3 {
    const d = rayDirection(ray, sign, ray.sweep === 0 ? 0.5 : u);
    return new THREE.Vector3(d.x, d.y, -d.z);
}

/** The grip and blade `u` of the way along a strike's ray (body space, before the aim's pitch). */
function strike(ray: Ray, sign: number, u: number): Hold {
    const dir = rayDir(ray, sign, u);
    let reach: number;
    const blade = dir.clone();
    const hand = PIVOT.clone();
    if (ray.sweep === 0) {
        // Thrust: drawn back (further the deeper the coil), then driven straight out.
        reach =
            u <= 0
                ? Math.max(0.04, THRUST_DRAWN + 0.15 * u)
                : u < 0.5
                  ? THREE.MathUtils.lerp(THRUST_DRAWN, THRUST_REACH, Math.sin((u / 0.5) * (Math.PI / 2)))
                  : THRUST_REACH - 0.08 * Math.min(1, u - 0.5);
    } else {
        reach = CONTACT_REACH - (CONTACT_REACH - BENT_REACH) * Math.min(1, Math.abs(u - 0.5));
        if (!ray.vertical) {
            const coil = Math.max(0, -u);
            const follow = Math.max(0, u - 1);
            hand.addScaledVector(UP, COIL_LIFT * coil - FOLLOW_DROP * follow);
            blade.addScaledVector(UP, COIL_TIP * coil - FOLLOW_TIP * follow);
        }
    }
    hand.addScaledVector(dir, reach);
    // The edge leads: along the arc's direction of travel (down for a thrust).
    const edge = rayDir(ray, sign, u + 0.01).sub(rayDir(ray, sign, u - 0.01));
    if (edge.lengthSq() < 1e-8) edge.set(0, -1, 0);
    return { hand, blade: blade.normalize(), edge: edge.normalize() };
}

/** Orientation of a hold: weapon +Y along the blade, +Z towards the edge (made square to it). */
function holdQuat(blade: THREE.Vector3, edge: THREE.Vector3): THREE.Quaternion {
    const y = blade.clone().normalize();
    const z = edge.clone().addScaledVector(y, -edge.dot(y));
    if (z.lengthSq() < 1e-8) z.set(0, 0, 1).addScaledVector(y, -y.z);
    z.normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Blends two holds, turning the blade the short way round. */
function lerpHold(a: Hold, b: Hold, t: number): Hold {
    const q = holdQuat(a.blade, a.edge).slerp(holdQuat(b.blade, b.edge), t);
    return {
        hand: a.hand.clone().lerp(b.hand, t),
        blade: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
        edge: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
    };
}

const smooth = (t: number) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
};
const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 2;

/** Goes from `from` to the strike's coil, then accelerates along the arc into the ray (w 0..1). */
function windUp(from: Hold, ray: Ray, sign: number, coil: number, w: number): Hold {
    if (w < GATHER) {
        return lerpHold(from, strike(ray, sign, coil), smooth(w / GATHER));
    }
    const s = ((w - GATHER) / (1 - GATHER)) ** 2;
    return strike(ray, sign, coil * (1 - s));
}

/** The ray and sweep direction of a move's hit `index`. */
function rayOf(move: MoveDef, rays: Ray[], index: number): { ray: Ray; sign: number } {
    const ray = rays[Math.min(index, rays.length - 1)];
    const hit = move.hits[Math.min(index, move.hits.length - 1)];
    return { ray, sign: hit ? raySign(ray, hit.impact) : 1 };
}

/** How far back along `ray` a move winds up (negative) with `lead` seconds before it (COIL_RATE). */
function coilOf(move: MoveDef, ray: Ray, lead: number): number {
    const depth = move.kind === "quick" ? -QUICK_COIL : -POWER_COIL;
    return -Math.min(depth, (COIL_RATE * lead) / Math.max(1e-6, ray.off - ray.on));
}

/** The guard, eased towards the relaxed hold by `relax` (0..1). */
function guardHold(relax: number): Hold {
    return relax > 0 ? lerpHold(GUARD, RELAXED, relax) : GUARD;
}

/** A body-space hold as a pose in the pitched view frame, with the free hand countering the grip. */
function toFrame(hold: Hold, pitch: number): BodyPose {
    const unpitch = new THREE.Quaternion().setFromAxisAngle(X_AXIS, -pitch);
    const quat = holdQuat(hold.blade, hold.edge);
    const off = OFF_HAND.clone().add(
        new THREE.Vector3(
            (hold.hand.x - GUARD.hand.x) * OFF_HAND_COUNTER.x,
            0,
            (hold.hand.z - GUARD.hand.z) * OFF_HAND_COUNTER.z,
        ),
    );
    return {
        pos: hold.hand.clone().applyQuaternion(unpitch),
        quat: unpitch.multiply(quat),
        offHand: off.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(X_AXIS, -pitch)),
    };
}

/** Back from a frame pose to body space (to start a swing from whatever was drawn). */
function fromFrame(pose: BodyPose, pitch: number): Hold {
    const repitch = new THREE.Quaternion().setFromAxisAngle(X_AXIS, pitch);
    const q = repitch.clone().multiply(pose.quat);
    return {
        hand: pose.pos.clone().applyQuaternion(repitch),
        blade: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
        edge: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
    };
}

/** Tilts a strike's arc towards where the player looks (AIM_FOLLOW of the pitch), about PIVOT. */
function aimed(hold: Hold, pitch: number): Hold {
    const q = new THREE.Quaternion().setFromAxisAngle(X_AXIS, pitch * AIM_FOLLOW);
    return {
        hand: hold.hand.clone().sub(PIVOT).applyQuaternion(q).add(PIVOT),
        blade: hold.blade.clone().applyQuaternion(q),
        edge: hold.edge.clone().applyQuaternion(q),
    };
}

/** Ready or at ease (`relax` 0..1). */
export function guardPose(pitch: number, relax = 0): BodyPose {
    return toFrame(guardHold(relax), pitch);
}

/** Holding the block. */
export function blockPose(pitch: number): BodyPose {
    return toFrame(aimed(BLOCK, pitch * 0.5), pitch);
}

/** Winding up a power attack (`progress` 0..1; 1 held charged): drawn back into its coil. */
export function chargePose(move: MoveDef, progress: number, pitch: number): BodyPose {
    const rays = move.time?.rays ?? [];
    if (rays.length === 0) return guardPose(pitch);
    const { ray, sign } = rayOf(move, rays, 0);
    return toFrame(aimed(lerpHold(GUARD, strike(ray, sign, coilOf(move, ray, ray.on)), smooth(progress)), pitch), pitch);
}

/**
 * The pose `elapsed` seconds into a swing of `move` on `timeline`, starting from `start` (what was
 * drawn when it began): wind up into the first ray, sweep each ray in its window (from one to the
 * next through a fresh coil), and follow through (the return to the guard is the caller's).
 */
export function swingPose(move: MoveDef, timeline: Timeline, elapsed: number, start: BodyPose, pitch: number): BodyPose {
    const rays = timeline.rays;
    const total = timeline.windup + timeline.active + timeline.recovery;
    const e = Math.min(Math.max(0, elapsed), total);
    const from = fromFrame(start, pitch);
    if (rays.length === 0) return start;
    let hold: Hold;
    const first = rayOf(move, rays, 0);
    if (e < rays[0].on) {
        const coil = coilOf(move, first.ray, first.ray.on);
        hold = aimed(windUp(aimedInverse(from, pitch), first.ray, first.sign, coil, e / rays[0].on), pitch);
        return toFrame(hold, pitch);
    }
    for (let i = 0; i < rays.length; i++) {
        const { ray, sign } = rayOf(move, rays, i);
        if (e <= ray.off) {
            hold = strike(ray, sign, (e - ray.on) / Math.max(1e-6, ray.off - ray.on));
            return toFrame(aimed(hold, pitch), pitch);
        }
        const next = rays[i + 1];
        if (next && e < next.on) {
            // Between hits: carry on a little, then wind up again into the next ray.
            const k = (e - ray.off) / Math.max(1e-6, next.on - ray.off);
            const carried = strike(ray, sign, 1 + 0.4 * easeOut(Math.min(1, k / 0.4)));
            if (k < 0.4) return toFrame(aimed(carried, pitch), pitch);
            const n = rayOf(move, rays, i + 1);
            const coil = coilOf(move, n.ray, 0.6 * (next.on - ray.off));
            hold = windUp(strike(ray, sign, 1.4), n.ray, n.sign, coil, (k - 0.4) / 0.6);
            return toFrame(aimed(hold, pitch), pitch);
        }
    }
    const last = rayOf(move, rays, rays.length - 1);
    const off = last.ray.off;
    // Follow through, slowing; the return to the guard comes after (the caller's crossfade), or
    // the next strike winds up from here.
    const r = (e - off) / Math.max(1e-6, total - off);
    return toFrame(aimed(strike(last.ray, last.sign, 1 + (FOLLOW - 1) * easeOut(r)), pitch), pitch);
}

/**
 * Third person: a first-person tool pose (a fishing tool's hold and strokes, a mining stroke) moved
 * from the eyes down to the hands, so its shaft passes beside the body rather than through it. [design]
 */
const TOOL_OFFSET = v3(0.02, -0.16, 0.16);

/**
 * A first-person tool pose (`pos`, `quat` relative to the eyes, unpitched) held by the body: lowered
 * by TOOL_OFFSET and tilted with the view about PIVOT, not the eyes, so looking down at the water
 * points the tool down instead of swinging it back into the chest.
 */
export function heldToolPose(pos: THREE.Vector3, quat: THREE.Quaternion, pitch: number): BodyPose {
    const hold: Hold = {
        hand: pos.clone().add(TOOL_OFFSET),
        blade: new THREE.Vector3(0, 1, 0).applyQuaternion(quat),
        edge: new THREE.Vector3(0, 0, 1).applyQuaternion(quat),
    };
    return toFrame(aimed(hold, pitch), pitch);
}

/** Undoes `aimed`, so a start pose (already aimed) is not tilted twice. */
function aimedInverse(hold: Hold, pitch: number): Hold {
    return aimed(hold, -pitch);
}

/** Blends two poses (t 0..1, eased by the caller). */
export function lerpBodyPose(a: BodyPose, b: BodyPose, t: number): BodyPose {
    return {
        pos: a.pos.clone().lerp(b.pos, t),
        quat: a.quat.clone().slerp(b.quat, t),
        offHand: a.offHand.clone().lerp(b.offHand, t),
    };
}
