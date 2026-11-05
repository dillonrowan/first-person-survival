import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { EYE_HEIGHT } from "../player/Player";
import { BONES, BONE_ROLES, BoneRole, CLIP_SPEEDS, HEAD_PART_PREFIX, SOCKET_EYE, SOCKET_HAND_L, SOCKET_HAND_R } from "./avatarConfig";
import { GltfJson, checkAvatarGltf } from "./AvatarContract";
import { createPlaceholderAvatar } from "./PlaceholderAvatar";

export type AvatarAsset = {
    /** Placed at the player's feet and turned to the body's yaw. */
    root: THREE.Group;
    /** The character, turned to face -Z and scaled to the game's size. */
    model: THREE.Object3D;
    /** Game tiles per model unit. */
    scale: number;
    bones: Partial<Record<BoneRole, THREE.Bone>>;
    sockets: { eye: THREE.Object3D; handR?: THREE.Object3D; handL?: THREE.Object3D };
    clips: Map<string, THREE.AnimationClip>;
    /** Ground speed of the locomotion clips in tiles per second. */
    clipSpeeds: { walk: number; run: number; walk_back: number };
    /** Nodes hidden in first person. */
    headParts: THREE.Object3D[];
};

/** Loads the character at `url`; falls back to a placeholder if it is missing or invalid. */
export async function loadAvatarAsset(url: string): Promise<AvatarAsset> {
    try {
        const response = await fetch(url);
        // Vite's dev server answers missing files with index.html (status 200), so check the type.
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || contentType.includes("text/html")) {
            throw new Error(`HTTP ${response.status}`);
        }
        const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), "");
        const report = checkAvatarGltf(gltf.parser.json as GltfJson);
        report.warnings.forEach((warning) => console.warn(`${url}: ${warning}`));
        if (report.errors.length > 0) {
            throw new Error(report.errors.join(" "));
        }
        return prepareAvatar(gltf.scene, gltf.animations);
    } catch (e) {
        console.info(`Using the placeholder character (${url}: ${e instanceof Error ? e.message : e})`);
        return createPlaceholderAvatar();
    }
}

/** Normalizes a loaded character: size, facing, materials, root motion. */
export function prepareAvatar(scene: THREE.Object3D, animations: THREE.AnimationClip[]): AvatarAsset {
    const root = new THREE.Group();
    const model = new THREE.Group();
    model.add(scene);
    root.add(model);
    root.updateMatrixWorld(true);

    const eye = scene.getObjectByName(SOCKET_EYE)!;
    const eyeHeight = eye.getWorldPosition(new THREE.Vector3()).y - root.position.y;
    const scale = eyeHeight > 0 ? EYE_HEIGHT / eyeHeight : 1;
    model.scale.setScalar(scale);
    model.rotation.y = Math.PI; // glTF characters face +Z, the game's yaw 0 faces -Z

    const headParts: THREE.Object3D[] = [];
    scene.traverse((object) => {
        if (object.name.startsWith(HEAD_PART_PREFIX)) {
            headParts.push(object);
        }
        if (object instanceof THREE.Mesh) {
            object.material = toLambert(object.material);
            // The avatar is always next to the camera, and skinned bounds are unreliable.
            object.frustumCulled = false;
        }
    });

    const bones: AvatarAsset["bones"] = {};
    for (const role of BONE_ROLES) {
        bones[role] = scene.getObjectByName(BONES[role]) as THREE.Bone;
    }

    const clips = new Map<string, THREE.AnimationClip>();
    for (const clip of animations) {
        stripRootMotion(clip);
        clips.set(clip.name, clip);
    }

    root.updateMatrixWorld(true);
    return {
        root,
        model,
        scale,
        bones,
        sockets: {
            eye,
            handR: scene.getObjectByName(SOCKET_HAND_R) ?? undefined,
            handL: scene.getObjectByName(SOCKET_HAND_L) ?? undefined,
        },
        clips,
        clipSpeeds: {
            walk: CLIP_SPEEDS.walk * scale,
            run: CLIP_SPEEDS.run * scale,
            walk_back: CLIP_SPEEDS.walk_back * scale,
        },
        headParts,
    };
}

function toLambert<T extends THREE.Material | THREE.Material[]>(material: T): T {
    const convert = (m: THREE.Material): THREE.Material => {
        if (!(m instanceof THREE.MeshStandardMaterial)) {
            return m;
        }
        const lambert = new THREE.MeshLambertMaterial({
            name: m.name,
            map: m.map,
            color: m.color,
            vertexColors: m.vertexColors,
            transparent: m.transparent,
            opacity: m.opacity,
            alphaTest: m.alphaTest,
            side: m.side,
        });
        m.dispose();
        return lambert;
    };
    return (Array.isArray(material) ? material.map(convert) : convert(material)) as T;
}

/** Locomotion happens in place: the game moves the root, so hip x/z keys would double it. */
function stripRootMotion(clip: THREE.AnimationClip): void {
    for (const track of clip.tracks) {
        if (track.name === `${BONES.hips}.position`) {
            const v = track.values;
            for (let i = 0; i < v.length; i += 3) {
                v[i] = v[0];
                v[i + 2] = v[2];
            }
        }
    }
}
