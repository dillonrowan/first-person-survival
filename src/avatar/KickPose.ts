import { tuning } from "../combat/tuning";

/**
 * The body's front kick, keyed at the kick animation's 24 fps (authored and previewed in Blender
 * on the placeholder rig: chamber the knee, thrust the hips forward and lean back as the leg
 * extends heel first, re-chamber, set the foot down). Lengths are in leg lengths (hip joint to
 * ankle) so the keys fit any rig; directions are in the body's space (+X right, +Y up, -Z ahead).
 */
export type KickSample = {
    /** Ankle relative to the kicking hip joint (after `hips` moved it). */
    foot: [number, number, number];
    /** Where the knee bends towards (from the hip). */
    knee: [number, number, number];
    /** Foot turned about the body's right axis (radians, + lifts the toes: the sole faces ahead). */
    toes: number;
    /** Spine and chest bend back (radians, split between them). */
    lean: number;
    /** Hips moved down (-) and forward (-Z), in leg lengths. */
    hips: [number, number];
    /** First-person view pitch (radians, - looks down) so the leg comes into view. */
    look: number;
    /** How much of the kick is posed over the animation (0..1). */
    weight: number;
};

type Key = [frame: number, sample: KickSample];

const REST: KickSample = { foot: [0, -1, 0], knee: [0, -0.13, -1], toes: 0, lean: 0, hips: [0, 0], look: 0, weight: 0 };

/** Looking ahead: a push kick at stomach height. Hit at frame 8 (kickHitTimeMedium). */
const MEDIUM: Key[] = [
    [0, REST],
    [4, { foot: [0, -0.26, -0.32], knee: [0, 1, -0.8], toes: -0.7, lean: 0.12, hips: [-0.044, -0.029], look: -0.2, weight: 1 }],
    [8, { foot: [-0.044, 0.3, -0.92], knee: [0, 1.4, -1], toes: 1.3, lean: 0.42, hips: [-0.059, -0.13], look: -0.3, weight: 1 }],
    [10, { foot: [-0.044, 0.26, -0.9], knee: [0, 1.4, -1], toes: 1.2, lean: 0.4, hips: [-0.059, -0.115], look: -0.29, weight: 1 }],
    [14, { foot: [0, -0.3, -0.33], knee: [0, 1, -0.8], toes: -0.5, lean: 0.14, hips: [-0.044, -0.029], look: -0.14, weight: 1 }],
    [21, REST],
];

/** Looking down: a front kick at knee height. Hit at frame 6 (kickHitTimeLow). */
const LOW: Key[] = [
    [0, REST],
    [3, { foot: [0, -0.5, -0.27], knee: [0, 0.5, -1], toes: -0.5, lean: 0.06, hips: [-0.044, -0.03], look: -0.1, weight: 1 }],
    [6, { foot: [-0.044, -0.44, -0.86], knee: [0, 0.6, -1], toes: 0.9, lean: 0.22, hips: [-0.07, -0.13], look: -0.18, weight: 1 }],
    [8, { foot: [-0.044, -0.46, -0.83], knee: [0, 0.6, -1], toes: 0.8, lean: 0.2, hips: [-0.07, -0.115], look: -0.17, weight: 1 }],
    [13, { foot: [0, -0.53, -0.3], knee: [0, 0.5, -1], toes: -0.4, lean: 0.07, hips: [-0.044, -0.03], look: -0.08, weight: 1 }],
    [21, REST],
];

const FPS = 24;

const flatten = (s: KickSample): number[] => [...s.foot, ...s.knee, s.toes, s.lean, ...s.hips, s.look, s.weight];

/**
 * Cubic Hermite through the keys (tangents from the neighbours, flat at the ends), so the leg
 * moves without stopping at each key.
 */
function hermite(keys: Key[], frame: number): number[] {
    const values = keys.map(([, s]) => flatten(s));
    const last = keys.length - 1;
    if (frame <= keys[0][0]) return values[0];
    if (frame >= keys[last][0]) return values[last];
    let i = 0;
    while (keys[i + 1][0] < frame) i++;
    const tangent = (j: number, c: number) =>
        j === 0 || j === last ? 0 : (values[j + 1][c] - values[j - 1][c]) / (keys[j + 1][0] - keys[j - 1][0]);
    const h = keys[i + 1][0] - keys[i][0];
    const s = (frame - keys[i][0]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return values[i].map(
        (a, c) =>
            (2 * s3 - 3 * s2 + 1) * a +
            (s3 - 2 * s2 + s) * h * tangent(i, c) +
            (-2 * s3 + 3 * s2) * values[i + 1][c] +
            (s3 - s2) * h * tangent(i + 1, c),
    );
}

/** The kick's pose `elapsed` seconds in; undefined when not kicking. */
export function kickSample(elapsed: number | undefined, low: boolean): KickSample | undefined {
    if (elapsed === undefined || elapsed >= tuning.kickDuration) {
        return undefined;
    }
    const v = hermite(low ? LOW : MEDIUM, elapsed * FPS);
    return {
        foot: [v[0], v[1], v[2]],
        knee: [v[3], v[4], v[5]],
        toes: v[6],
        lean: v[7],
        hips: [v[8], v[9]],
        look: v[10],
        weight: Math.min(1, Math.max(0, v[11])),
    };
}
