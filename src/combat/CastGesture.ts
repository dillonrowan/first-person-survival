import * as THREE from "three";

/**
 * The player's spell cast gesture, keyed in the eye frame (x right, y up, -z ahead, tiles): the
 * first-person camera, or the body's view frame (Avatar.viewFrame) in third person, so one set of
 * keys poses both. Blocked out in Blender against the spell effects: the cast graphic plays at the
 * hands (CAST_VIEW_* in main.ts: 0.9 ahead of the eye, 0.45 below it) and the projectile leaves the
 * eye along the view.
 *
 * Both hands always cast. It overshoots out into a thrust, is thrown back by the spell's recoil,
 * drives back out to channel it while the cast graphic plays, and is lowered. Three styles:
 * - a staff, held in both hands (the free hand ahead on the shaft) and driven like a spear so the
 *   shaft passes through the cast graphic; the recoil flings its head up along the projectile's line;
 * - bare hands, both palms pushed together under the graphic, flung apart by the recoil;
 * - any other weapon, raised point-up in the weapon hand beside the free hand's palm.
 */
export type CastStyle = "staff" | "palms" | "armed";

type Key = {
    grip: THREE.Vector3;
    /** The held item's +Y (shaft) and +Z (edge); undefined keeps its orientation. */
    shaft?: THREE.Vector3;
    edge?: THREE.Vector3;
    /** The free hand; undefined: on the shaft, ON_SHAFT ahead of the grip. */
    offHand?: THREE.Vector3;
};

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const STAFF_EDGE = v3(0, -1, 0.2);
/** The raised weapon of the armed style: point up and out to the right, clear of the reticule. [design] */
const RAISED = v3(0.6, 0.75, 0.1);
const RAISED_EDGE = v3(0, 0, -1);
/** How far up the shaft (tiles) the free hand holds a staff. [design] */
const ON_SHAFT = 0.22;
/** The staff levelled at the cast graphic (thrust and channel). */
const LEVELLED = v3(-0.34, -0.29, -0.89);

const palms = (x: number, y: number, z: number): Key => ({ grip: v3(x, y, z), offHand: v3(-x, y, z) });
const armed = (x: number, y: number, z: number): Key => ({ grip: v3(x + 0.02, y, z), shaft: RAISED, edge: RAISED_EDGE, offHand: v3(-x, y, z - 0.02) });

/** Thrust (overshot), recoil, channel and end-of-channel keys of each style. [design] */
const KEYS: Record<CastStyle, [Key, Key, Key, Key]> = {
    staff: [
        { grip: v3(0.17, -0.3, -0.44), shaft: LEVELLED, edge: STAFF_EDGE },
        { grip: v3(0.23, -0.19, -0.29), shaft: v3(-0.28, 0.48, -0.83), edge: STAFF_EDGE },
        { grip: v3(0.2, -0.28, -0.39), shaft: LEVELLED, edge: STAFF_EDGE },
        { grip: v3(0.2, -0.27, -0.38), shaft: v3(-0.34, -0.25, -0.9), edge: STAFF_EDGE },
    ],
    palms: [palms(0.08, -0.3, -0.56), palms(0.2, -0.12, -0.4), palms(0.1, -0.31, -0.5), palms(0.11, -0.3, -0.48)],
    armed: [armed(0.08, -0.3, -0.56), armed(0.2, -0.12, -0.4), armed(0.1, -0.31, -0.5), armed(0.11, -0.3, -0.48)],
};

/** Seconds at which each key is reached, then when the hands are back to their own pose. [design] */
const THRUST = 0.06;
const RECOIL = 0.14;
const CHANNEL = 0.3;
const HELD = 0.42;
export const CAST_LENGTH = 0.75;
/** First person: how far the view kicks up and rolls with the recoil (radians, at strength 1). [design] */
const VIEW_KICK = 0.06;
const VIEW_ROLL = 0.02;

/** The free hand's rest when it has no pose of its own (it hangs as animated): low at the chest. */
export const OFF_HAND_REST = v3(-0.14, -0.42, -0.02);

/** One moment of the gesture: how much it overrides the hands (0..1) and where it puts them. */
export type CastFrame = {
    weight: number;
    grip: THREE.Vector3;
    quat?: THREE.Quaternion;
    offHand: THREE.Vector3;
    /** Added to the first-person view (radians: pitch up, roll). */
    viewPitch: number;
    viewRoll: number;
};

/** The cast style for a held weapon. */
export function castStyle(family: string, unarmed: boolean): CastStyle {
    return unarmed ? "palms" : family === "staff" ? "staff" : "armed";
}

/** How hard a spell kicks by its tier (the id's last word): strikes lightest, surges hardest. [design] */
const TIER_STRENGTH: Record<string, number> = { strike: 0.8, bolt: 0.95, blast: 1.1, wave: 1.25, surge: 1.4 };

export function castStrength(spellId: string): number {
    return TIER_STRENGTH[spellId.slice(spellId.lastIndexOf("-") + 1)] ?? 1;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

function quatOf(shaft: THREE.Vector3, edge: THREE.Vector3): THREE.Quaternion {
    const y = shaft.clone().normalize();
    const z = edge.clone().addScaledVector(y, -edge.dot(y)).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

function lerpKey(a: Key, b: Key, t: number): Pick<CastFrame, "grip" | "quat" | "offHand"> {
    const grip = a.grip.clone().lerp(b.grip, t);
    const quat = a.shaft && b.shaft ? quatOf(a.shaft, a.edge!).slerp(quatOf(b.shaft, b.edge!), t) : undefined;
    // A hand on the shaft stays on it however the staff turns.
    const offHand =
        a.offHand && b.offHand
            ? a.offHand.clone().lerp(b.offHand, t)
            : grip.clone().addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(quat ?? new THREE.Quaternion()), ON_SHAFT);
    return { grip, quat, offHand };
}

/**
 * The gesture `t` seconds into a cast of strength `strength` (bigger spells kick harder), or
 * undefined once it is over: snapped out to the thrust (fast in), sprung back by the recoil, driven
 * out again to channel, then faded back to the hands' own pose.
 */
export function castFrame(style: CastStyle, t: number, strength = 1): CastFrame | undefined {
    if (t < 0 || t >= CAST_LENGTH) return undefined;
    const [thrust, recoil, channel, held] = KEYS[style];
    let weight = 1;
    let pose;
    if (t < THRUST) {
        weight = 1 - (1 - t / THRUST) ** 3;
        pose = lerpKey(thrust, thrust, 0);
    } else if (t < RECOIL) {
        // Thrown back hard, slowing as it peaks.
        pose = lerpKey(thrust, recoil, 1 - (1 - (t - THRUST) / (RECOIL - THRUST)) ** 2);
    } else if (t < CHANNEL) {
        pose = lerpKey(recoil, channel, smooth((t - RECOIL) / (CHANNEL - RECOIL)));
    } else if (t < HELD) {
        pose = lerpKey(channel, held, smooth((t - CHANNEL) / (HELD - CHANNEL)));
    } else {
        pose = lerpKey(held, held, 0);
        weight = 1 - smooth((t - HELD) / (CAST_LENGTH - HELD));
    }
    // The view rides the recoil: up quickly after the thrust, back down as it drives out again.
    const kick = smooth(t < RECOIL ? clamp01((t - THRUST * 0.5) / (RECOIL - THRUST * 0.5)) : 1 - clamp01((t - RECOIL) / (CHANNEL - RECOIL)));
    return { ...pose, weight, viewPitch: VIEW_KICK * strength * kick, viewRoll: -VIEW_ROLL * strength * kick };
}
