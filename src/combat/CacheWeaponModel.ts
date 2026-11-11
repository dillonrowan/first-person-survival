import * as THREE from "three";

import type { CacheWeaponInfo } from "../world/CacheWeaponFormat";
import type { NpcModelData } from "../world/NpcFormat";
import { RS_UNITS_PER_TILE } from "../world/WorldFormat";

/** RS units (y down, z south) to tiles in three.js axes, as the world vertex shader does. */
const toThree = ([x, y, z]: readonly number[]) =>
    new THREE.Vector3(x, -y, -z).divideScalar(RS_UNITS_PER_TILE);

/**
 * Rotation taking the worn model into the weapon art contract (docs/weapon-models.md): grip at the
 * origin, blade along +Y, edge along +Z. The worn model's up becomes the edge side, so a blade
 * held flat in the OSRS base pose keeps its flat in the YZ plane.
 */
export function cacheWeaponOrientation(info: Pick<CacheWeaponInfo, "grip" | "tip">): THREE.Quaternion {
    const blade = toThree(info.tip).sub(toThree(info.grip)).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    let edge = up.clone().addScaledVector(blade, -up.dot(blade));
    if (edge.lengthSq() < 1e-6) {
        // Blade points straight up or down: the edge faces forward.
        edge = new THREE.Vector3(0, 0, -1).addScaledVector(blade, blade.z);
    }
    edge.normalize();
    const side = new THREE.Vector3().crossVectors(blade, edge);
    // Columns are the contract's axes in model space; its transpose maps model to contract.
    const toModel = new THREE.Matrix4().makeBasis(side, blade, edge);
    return new THREE.Quaternion().setFromRotationMatrix(toModel).invert();
}

/** The exported model as the held weapon, drawn with the world materials like NPCs. */
export function createCacheWeaponModel(
    info: CacheWeaponInfo,
    data: NpcModelData,
    materials: { opaque: THREE.Material; transparent: THREE.Material },
): THREE.Group {
    const model = new THREE.Group();
    model.position.copy(toThree(info.grip)).negate();
    for (const [source, transparent] of [[data.opaque, false], [data.transparent, true]] as const) {
        if (source.indices.length === 0) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("a_position", new THREE.BufferAttribute(source.positions, 4));
        geometry.setAttribute("a_color", new THREE.BufferAttribute(source.colors, 4, true));
        geometry.setAttribute("a_uv", new THREE.BufferAttribute(source.uvs, 2));
        geometry.setIndex(new THREE.BufferAttribute(source.indices, 1));
        // No `position` attribute for three.js to measure, so supply culling bounds.
        const [cx, cy, cz, radius] = data.bounds;
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), radius);
        const mesh = new THREE.Mesh(geometry, transparent ? materials.transparent : materials.opaque);
        mesh.renderOrder = transparent ? 2 : 1;
        model.add(mesh);
    }
    const weapon = new THREE.Group();
    weapon.name = `weapon_${info.id}`;
    weapon.quaternion.copy(cacheWeaponOrientation(info));
    weapon.add(model);
    return weapon;
}
