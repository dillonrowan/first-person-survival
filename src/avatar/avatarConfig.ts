/** Roles of the bones the game drives. */
export const BONE_ROLES = [
    "hips",
    "spine",
    "chest",
    "neck",
    "head",
    "upperarm_l",
    "upperarm_r",
    "forearm_l",
    "forearm_r",
    "hand_l",
    "hand_r",
    "thigh_l",
    "thigh_r",
    "shin_l",
    "shin_r",
    "foot_l",
    "foot_r",
] as const;
export type BoneRole = (typeof BONE_ROLES)[number];

/** Node name of each bone role in the character's glTF. Change these to match your rig. */
export const BONES: Record<BoneRole, string> = Object.fromEntries(
    BONE_ROLES.map((role) => [role, role]),
) as Record<BoneRole, string>;

export const SOCKET_EYE = "socket_eye";
export const SOCKET_HAND_R = "socket_hand_r";
export const SOCKET_HAND_L = "socket_hand_l";
/** Meshes whose node name starts with this are hidden in first person. */
export const HEAD_PART_PREFIX = "head_";

export const REQUIRED_CLIPS = ["idle", "walk", "run", "airborne"] as const;
export type ClipName = (typeof REQUIRED_CLIPS)[number] | "walk_back";

/**
 * Ground speed each authored locomotion clip was made for, in the model's own units per second
 * (metres for a typical export). The loader rescales them with the model, so playback matches the
 * game's walk and sprint speeds. Only used for real models; the placeholder carries its own.
 */
export const CLIP_SPEEDS = { walk: 1.4, run: 3.5, walk_back: 1.2 } as const;

/** Triangle budget of the character model. */
export const MAX_TRIANGLES = 8000;

/** First person: how far the body is moved back so looking down shows legs, not the torso. */
export const FP_BODY_BACK_OFFSET = 0.15;
/** Spine and chest each bend by pitch times this (negative: looking down leans forward). */
export const TORSO_PITCH_FACTOR = -0.25;
