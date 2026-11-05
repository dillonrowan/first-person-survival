import {
    BONES,
    BONE_ROLES,
    HEAD_PART_PREFIX,
    MAX_TRIANGLES,
    REQUIRED_CLIPS,
    SOCKET_EYE,
} from "./avatarConfig";

/** The parts of glTF JSON the contract looks at. */
export type GltfJson = {
    nodes?: { name?: string }[];
    skins?: unknown[];
    animations?: { name?: string }[];
    meshes?: { primitives?: { indices?: number }[] }[];
    accessors?: { count?: number }[];
};

export type ContractReport = { errors: string[]; warnings: string[]; triangles: number };

/** Checks a character glTF against docs/player-model.md. Works on the JSON alone. */
export function checkAvatarGltf(json: GltfJson): ContractReport {
    const errors: string[] = [];
    const warnings: string[] = [];
    const nodeNames = new Set((json.nodes ?? []).map((node) => node.name).filter(Boolean));

    if ((json.skins ?? []).length === 0) {
        errors.push("The model has no skin (rig).");
    }
    for (const role of BONE_ROLES) {
        if (!nodeNames.has(BONES[role])) {
            errors.push(`Missing bone "${BONES[role]}" (${role}).`);
        }
    }
    if (!nodeNames.has(SOCKET_EYE)) {
        errors.push(`Missing "${SOCKET_EYE}" (an empty on the head between the eyes).`);
    }

    const clipNames = new Set((json.animations ?? []).map((clip) => clip.name));
    for (const clip of REQUIRED_CLIPS) {
        if (!clipNames.has(clip)) {
            errors.push(`Missing animation "${clip}".`);
        }
    }

    let triangles = 0;
    for (const mesh of json.meshes ?? []) {
        for (const primitive of mesh.primitives ?? []) {
            if (primitive.indices !== undefined) {
                triangles += Math.floor((json.accessors?.[primitive.indices]?.count ?? 0) / 3);
            }
        }
    }
    if (triangles > MAX_TRIANGLES) {
        warnings.push(`${triangles} triangles is over the budget of ${MAX_TRIANGLES}.`);
    }
    if (![...nodeNames].some((name) => name!.startsWith(HEAD_PART_PREFIX))) {
        warnings.push(
            `No "${HEAD_PART_PREFIX}*" mesh: the head bone is shrunk in first person instead.`,
        );
    }
    return { errors, warnings, triangles };
}

/** Reads the JSON chunk of a binary glTF (.glb). */
export function readGlbJson(buffer: ArrayBuffer): GltfJson {
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x46546c67) {
        throw new Error("Not a binary glTF (.glb) file");
    }
    const length = view.getUint32(12, true);
    const type = view.getUint32(16, true);
    if (type !== 0x4e4f534a) {
        throw new Error("The first glTF chunk is not JSON");
    }
    const text = new TextDecoder().decode(new Uint8Array(buffer, 20, length));
    return JSON.parse(text);
}
