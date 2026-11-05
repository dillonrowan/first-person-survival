import * as THREE from "three";

import { EYE_HEIGHT, SPRINT_SPEED, WALK_SPEED } from "../player/Player";
import type { AvatarAsset } from "./AvatarAsset";
import { BONES, BoneRole, HEAD_PART_PREFIX, SOCKET_EYE, SOCKET_HAND_R } from "./avatarConfig";

/** [role, parent role, local offset]. Feet end on y = 0 and the model faces +Z. */
const SKELETON: [BoneRole, BoneRole | undefined, [number, number, number]][] = [
    ["hips", undefined, [0, 0.75, 0]],
    ["spine", "hips", [0, 0.1, 0]],
    ["chest", "spine", [0, 0.2, 0]],
    ["neck", "chest", [0, 0.12, 0]],
    ["head", "neck", [0, 0.03, 0]],
    ["upperarm_l", "chest", [0.2, 0.08, 0]],
    ["forearm_l", "upperarm_l", [0, -0.28, 0]],
    ["hand_l", "forearm_l", [0, -0.26, 0]],
    ["upperarm_r", "chest", [-0.2, 0.08, 0]],
    ["forearm_r", "upperarm_r", [0, -0.28, 0]],
    ["hand_r", "forearm_r", [0, -0.26, 0]],
    ["thigh_l", "hips", [0.1, -0.02, 0]],
    ["shin_l", "thigh_l", [0, -0.34, 0]],
    ["foot_l", "shin_l", [0, -0.34, 0]],
    ["thigh_r", "hips", [-0.1, -0.02, 0]],
    ["shin_r", "thigh_r", [0, -0.34, 0]],
    ["foot_r", "shin_r", [0, -0.34, 0]],
];

const SKIN = 0xd9a577;
const TOP = 0x4a6b3a;
const BOTTOM = 0x6b4a2f;

/** [bone, size, centre relative to the bone, colour, node name] */
const PARTS: [BoneRole, [number, number, number], [number, number, number], number, string][] = [
    ["chest", [0.34, 0.5, 0.18], [0, -0.05, 0], TOP, "torso"],
    ["hips", [0.32, 0.18, 0.18], [0, 0, 0], BOTTOM, "pelvis"],
    ["head", [0.2, 0.22, 0.2], [0, 0.1, 0], SKIN, `${HEAD_PART_PREFIX}skull`],
    ["neck", [0.08, 0.1, 0.08], [0, 0.02, 0], SKIN, "neck"],
    ["upperarm_l", [0.09, 0.3, 0.09], [0, -0.14, 0], TOP, "arm_ul"],
    ["forearm_l", [0.08, 0.28, 0.08], [0, -0.13, 0], SKIN, "arm_fl"],
    ["upperarm_r", [0.09, 0.3, 0.09], [0, -0.14, 0], TOP, "arm_ur"],
    ["forearm_r", [0.08, 0.28, 0.08], [0, -0.13, 0], SKIN, "arm_fr"],
    ["thigh_l", [0.13, 0.36, 0.13], [0, -0.17, 0], BOTTOM, "leg_ul"],
    ["shin_l", [0.11, 0.36, 0.11], [0, -0.17, 0], BOTTOM, "leg_ll"],
    ["foot_l", [0.12, 0.06, 0.24], [0, -0.02, 0.05], 0x2b2b2b, "foot_l"],
    ["thigh_r", [0.13, 0.36, 0.13], [0, -0.17, 0], BOTTOM, "leg_ur"],
    ["shin_r", [0.11, 0.36, 0.11], [0, -0.17, 0], BOTTOM, "leg_lr"],
    ["foot_r", [0.12, 0.06, 0.24], [0, -0.02, 0.05], 0x2b2b2b, "foot_r"],
];

const SAMPLES = 8;

/** A quaternion track that rotates a bone about X by `angle(t)` for t in [0, 1). */
function swing(role: BoneRole, duration: number, angle: (phase: number) => number) {
    const times: number[] = [];
    const values: number[] = [];
    const q = new THREE.Quaternion();
    const axis = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i <= SAMPLES; i++) {
        const phase = i / SAMPLES;
        times.push(phase * duration);
        q.setFromAxisAngle(axis, angle(phase));
        values.push(q.x, q.y, q.z, q.w);
    }
    return new THREE.QuaternionKeyframeTrack(`${BONES[role]}.quaternion`, times, values);
}

function gait(name: string, duration: number, amplitude: number): THREE.AnimationClip {
    const tau = Math.PI * 2;
    const leg = (offset: number) => (p: number) => Math.sin((p + offset) * tau) * amplitude;
    const knee = (offset: number) => (p: number) =>
        Math.max(0, -Math.sin((p + offset) * tau)) * amplitude * 1.4;
    return new THREE.AnimationClip(name, duration, [
        swing("thigh_l", duration, leg(0)),
        swing("thigh_r", duration, leg(0.5)),
        swing("shin_l", duration, knee(0)),
        swing("shin_r", duration, knee(0.5)),
        swing("upperarm_l", duration, leg(0.5)),
        swing("upperarm_r", duration, leg(0)),
    ]);
}

/** A stand-in character built in code, with the same shape as a loaded glTF avatar. */
export function createPlaceholderAvatar(): AvatarAsset {
    const root = new THREE.Group();
    const model = new THREE.Group();
    model.rotation.y = Math.PI;
    root.add(model);

    const bones = {} as Record<BoneRole, THREE.Bone>;
    for (const [role, parent, offset] of SKELETON) {
        const bone = new THREE.Bone();
        bone.name = BONES[role];
        bone.position.set(...offset);
        bones[role] = bone;
        (parent ? bones[parent] : model).add(bone);
    }
    for (const [role, size, centre, color, name] of PARTS) {
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(...size),
            new THREE.MeshLambertMaterial({ color }),
        );
        mesh.name = name;
        mesh.position.set(...centre);
        bones[role].add(mesh);
    }

    const eye = new THREE.Object3D();
    eye.name = SOCKET_EYE;
    eye.position.set(0, EYE_HEIGHT - 0.75 - 0.1 - 0.2 - 0.12 - 0.03, 0.08);
    bones.head.add(eye);
    const handR = new THREE.Object3D();
    handR.name = SOCKET_HAND_R;
    bones.hand_r.add(handR);

    const breathe = (p: number) => Math.sin(p * Math.PI * 2) * 0.03;
    const clips = new Map<string, THREE.AnimationClip>([
        ["idle", new THREE.AnimationClip("idle", 3, [swing("chest", 3, breathe)])],
        ["walk", gait("walk", 0.8, 0.6)],
        ["run", gait("run", 0.5, 0.95)],
        [
            "airborne",
            new THREE.AnimationClip("airborne", 1, [
                swing("thigh_l", 1, () => -0.5),
                swing("thigh_r", 1, () => 0.2),
                swing("shin_l", 1, () => 0.8),
                swing("shin_r", 1, () => 0.4),
            ]),
        ],
    ]);

    root.updateMatrixWorld(true);
    return {
        root,
        model,
        scale: 1,
        bones,
        sockets: { eye, handR },
        clips,
        // The placeholder's cycles are timed for the game's own speeds.
        clipSpeeds: { walk: WALK_SPEED, run: SPRINT_SPEED, walk_back: WALK_SPEED },
        headParts: [bones.head.getObjectByName(`${HEAD_PART_PREFIX}skull`)!],
    };
}
