import * as THREE from "three";

import { HIT_BONES } from "../npc/HitClips";
import { BodyRig } from "../npc/HitPose";
import { basePositions } from "../npc/NpcModels";
import { EYE_HEIGHT, SPRINT_SPEED, WALK_SPEED } from "../player/Player";
import type { NpcMeshData, NpcModelData } from "../world/NpcFormat";
import { RS_UNITS_PER_TILE } from "../world/WorldFormat";
import type { AvatarAsset } from "./AvatarAsset";
import { BONES, BoneRole, SOCKET_EYE, SOCKET_HAND_L, SOCKET_HAND_R } from "./avatarConfig";
import { placeholderClips } from "./PlaceholderAvatar";

type HitBone = (typeof HIT_BONES)[number];

/** Parent of each avatar bone; parents come first. */
const PARENT: [BoneRole, BoneRole | undefined][] = [
    ["hips", undefined],
    ["spine", "hips"],
    ["chest", "spine"],
    ["neck", "chest"],
    ["head", "neck"],
    ["upperarm_l", "chest"],
    ["forearm_l", "upperarm_l"],
    ["hand_l", "forearm_l"],
    ["upperarm_r", "chest"],
    ["forearm_r", "upperarm_r"],
    ["hand_r", "forearm_r"],
    ["thigh_l", "hips"],
    ["shin_l", "thigh_l"],
    ["foot_l", "shin_l"],
    ["thigh_r", "hips"],
    ["shin_r", "thigh_r"],
    ["foot_r", "shin_r"],
];

/**
 * The fitted humanoid bone (HitPose) each avatar bone sits on, and so the vertices it carries. The
 * chest and neck share the waist and neck joints: the torso bends at the waist with both of the
 * torso lean's bones, and the neck rides on the head, so hiding the head in first person hides it.
 */
const SOURCE: Record<BoneRole, HitBone> = {
    hips: "pelvis",
    spine: "spine",
    chest: "spine",
    neck: "head",
    head: "head",
    upperarm_l: "upperarm.L",
    forearm_l: "forearm.L",
    hand_l: "hand.L",
    upperarm_r: "upperarm.R",
    forearm_r: "forearm.R",
    hand_r: "hand.R",
    thigh_l: "thigh.L",
    shin_l: "shin.L",
    foot_l: "foot.L",
    thigh_r: "thigh.R",
    shin_r: "shin.R",
    foot_r: "foot.R",
};
/** Avatar bone carrying the vertices of each fitted bone. */
const CARRIER: Record<HitBone, BoneRole> = {
    pelvis: "hips",
    spine: "chest",
    head: "head",
    "upperarm.R": "upperarm_r",
    "forearm.R": "forearm_r",
    "hand.R": "hand_r",
    "upperarm.L": "upperarm_l",
    "forearm.L": "forearm_l",
    "hand.L": "hand_l",
    "thigh.R": "thigh_r",
    "shin.R": "shin_r",
    "foot.R": "foot_r",
    "thigh.L": "thigh_l",
    "shin.L": "shin_l",
    "foot.L": "foot_l",
};
/** The eyes sit this share of the way from the neck joint to the top of the head. [design] */
const EYE_UP = 0.5;

/**
 * An NPC model from the cache (Hans, say) as the player's body: its base pose skinned to the avatar
 * rig, which is fitted to its body parts like the NPC hit reactions' (`fitHumanoid`), and animated
 * by the placeholder's procedural clips. Drawn unlit in its baked vertex colours, like the NPCs.
 * Undefined when the model has no skeleton or is not a humanoid.
 */
export function createCacheAvatar(data: NpcModelData): AvatarAsset | undefined {
    if (!data.skeleton || data.skeleton.parents.length === 0) {
        return undefined;
    }
    const base = basePositions(data);
    const rig = new BodyRig(data, base);
    const humanoid = rig.humanoid;
    if (!humanoid) {
        return undefined;
    }
    const joint = (bone: HitBone) => new THREE.Vector3().fromArray(humanoid.joints, HIT_BONES.indexOf(bone) * 3);
    const boneOfVertex = (v: number): BoneRole => CARRIER[HIT_BONES[humanoid.boneOfPart[rig.partOf[v]]] ?? "pelvis"];

    const bones = {} as Record<BoneRole, THREE.Bone>;
    const index = new Map<BoneRole, number>();
    for (const [role, parent] of PARENT) {
        const bone = new THREE.Bone();
        bone.name = BONES[role];
        bone.position.copy(joint(SOURCE[role]));
        if (parent) {
            bone.position.sub(joint(SOURCE[parent]));
            bones[parent].add(bone);
        }
        bones[role] = bone;
        index.set(role, index.size);
    }

    // Sockets: the eyes above the neck joint, each hand in the middle of the fist.
    const extent = (role: BoneRole) => {
        const box = new THREE.Box3();
        const p = new THREE.Vector3();
        for (let v = 0; v < data.vertexCount; v++) {
            if (boneOfVertex(v) === role) box.expandByPoint(p.fromArray(base, v * 3));
        }
        return box;
    };
    const neck = joint("head");
    const headBox = extent("head");
    const eye = new THREE.Object3D();
    eye.name = SOCKET_EYE;
    const eyeY = headBox.isEmpty() ? neck.y : neck.y + EYE_UP * (headBox.max.y - neck.y);
    eye.position.set(0, eyeY - neck.y, headBox.isEmpty() ? 0 : headBox.max.z - neck.z);
    bones.head.add(eye);
    const hand = (role: "hand_r" | "hand_l", name: string) => {
        const socket = new THREE.Object3D();
        socket.name = name;
        const box = extent(role);
        if (!box.isEmpty()) {
            socket.position.copy(box.getCenter(new THREE.Vector3())).sub(joint(SOURCE[role]));
        }
        bones[role].add(socket);
        return socket;
    };
    const handR = hand("hand_r", SOCKET_HAND_R);
    const handL = hand("hand_l", SOCKET_HAND_L);

    const model = new THREE.Group();
    const scale = eyeY > 0 ? EYE_HEIGHT / eyeY : 1;
    model.scale.setScalar(scale);
    model.rotation.y = Math.PI; // the base pose faces +Z, the game's yaw 0 faces -Z
    const root = new THREE.Group();
    root.add(model);
    model.add(bones.hips);
    model.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(PARENT.map(([role]) => bones[role]));
    for (const [part, transparent] of [[data.opaque, false], [data.transparent, true]] as const) {
        if (part.indices.length === 0) continue;
        const mesh = new THREE.SkinnedMesh(skinnedGeometry(part, (v) => index.get(boneOfVertex(v))!), meshMaterial(transparent));
        mesh.name = transparent ? "body_transparent" : "body";
        // The body is always next to the camera, and skinned bounds are unreliable.
        mesh.frustumCulled = false;
        model.add(mesh);
        mesh.updateMatrixWorld(true);
        mesh.bind(skeleton);
    }

    root.updateMatrixWorld(true);
    return {
        root,
        model,
        scale,
        bones,
        sockets: { eye, handR, handL },
        clips: placeholderClips(),
        // The procedural cycles are timed for the game's own speeds.
        clipSpeeds: { walk: WALK_SPEED, run: SPRINT_SPEED, walk_back: WALK_SPEED },
        // No separate head meshes: the head bone is shrunk in first person.
        headParts: [],
    };
}

/** A mesh's base pose (tiles, three.js axes) and colours, each vertex on one bone. */
function skinnedGeometry(part: NpcMeshData, boneOf: (modelVertex: number) => number): THREE.BufferGeometry {
    const count = part.sources.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 4);
    const skinIndex = new Uint16Array(count * 4);
    const skinWeight = new Float32Array(count * 4);
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
        positions[i * 3] = part.positions[i * 4] / RS_UNITS_PER_TILE;
        positions[i * 3 + 1] = -part.positions[i * 4 + 1] / RS_UNITS_PER_TILE;
        positions[i * 3 + 2] = -part.positions[i * 4 + 2] / RS_UNITS_PER_TILE;
        // The NPC shader draws the baked colours as they are: as sRGB, so they come out the same.
        color.setRGB(part.colors[i * 4] / 255, part.colors[i * 4 + 1] / 255, part.colors[i * 4 + 2] / 255, THREE.SRGBColorSpace);
        colors.set([color.r, color.g, color.b, part.colors[i * 4 + 3] / 255], i * 4);
        skinIndex[i * 4] = boneOf(part.sources[i]);
        skinWeight[i * 4] = 1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
    geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
    geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
    return geometry;
}

function meshMaterial(transparent: boolean): THREE.Material {
    return new THREE.MeshBasicMaterial({ vertexColors: true, transparent, depthWrite: !transparent });
}
