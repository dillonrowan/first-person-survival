import * as THREE from "three";

import { isRepeaterCrossbow, type CacheWeaponInfo } from "../world/CacheWeaponFormat";
import type { NpcModelData } from "../world/NpcFormat";
import { RS_UNITS_PER_TILE } from "../world/WorldFormat";
import { BowString } from "./BowString";
import { CrossbowRig, magazineFaces, stringFaces } from "./CrossbowRig";

/** RS units (y down, z south) to tiles in three.js axes, as the world vertex shader does. */
const toThree = ([x, y, z]: readonly number[]) =>
    new THREE.Vector3(x, -y, -z).divideScalar(RS_UNITS_PER_TILE);

/**
 * Rotation taking the worn model into the weapon art contract (docs/weapon-models.md): grip at the
 * origin, blade along +Y, edge along +Z. The OSRS base pose holds weapons forward with the cutting
 * edge down (axe and halberd blades below the shaft, a scimitar's spine on top), so the worn
 * model's down becomes the edge side. A bow lies with its limbs curving up from the hand; the bow
 * view needs them curving back toward the archer along +Z, so for bows the model's up is +Z.
 */
export function cacheWeaponOrientation(info: Pick<CacheWeaponInfo, "blade" | "family">): THREE.Quaternion {
    if (info.family === "crossbow") {
        return CROSSBOW_ORIENTATION.clone();
    }
    const blade = toThree(info.blade).normalize();
    const facing = new THREE.Vector3(0, info.family === "bow" ? 1 : -1, 0);
    let edge = facing.clone().addScaledVector(blade, -facing.dot(blade));
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

/**
 * Worn crossbows all lie the same way, unlike their exported blade directions: the prod toward
 * -Y, the limbs along ±X and the stock above the hand (+Z). A half turn about Z puts the muzzle on
 * +Y with the rail still on top, the crossbow contract (CrossbowRig).
 */
const CROSSBOW_ORIENTATION = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);

/**
 * The exported model as the held weapon, drawn with the world materials like NPCs. A hand-drawn bow
 * also gets a string and nocked arrow (the models have none), found by name as a `BowString`; a
 * crossbow loses its drawn string for a `CrossbowRig` (string and bolt), found by name too. A
 * repeating crossbow's magazine box is split off into the rig, which slides it along the rail.
 */
export function createCacheWeaponModel(
    info: CacheWeaponInfo,
    data: NpcModelData,
    materials: { opaque: THREE.Material; transparent: THREE.Material },
): THREE.Group {
    const orientation = cacheWeaponOrientation(info);
    const crossbow = info.family === "crossbow";
    const parts = [
        { part: data.opaque, transparent: false },
        { part: data.transparent, transparent: true },
    ].map((p) => ({ ...p, points: crossbow ? [...contractPoints(info, p.part.positions, orientation)] : [] }));
    // Crossbows: drop the drawn string (the rig draws its own).
    const kept: THREE.Vector3[] = [];
    const string: THREE.Vector3[] = [];
    const strung = parts.map(({ part, points }) => {
        if (!crossbow) return part.indices;
        const drop = stringFaces(points, part.indices);
        part.indices.forEach((v, i) => (drop.has(Math.floor(i / 3)) ? string : kept).push(points[v]));
        return part.indices.filter((_, i) => !drop.has(Math.floor(i / 3)));
    });
    // A repeater: split the magazine box, standing over the string, from the rest.
    const stringTop = Math.max(-Infinity, ...string.map((p) => p.z));
    const repeater = crossbow && isRepeaterCrossbow(info.name) && string.length > 0;
    const magazineBounds = new THREE.Box3();
    const split = parts.map(({ points }, n) => {
        const indices = strung[n];
        if (!repeater) return { body: indices, magazine: new Uint32Array(0) };
        const box = magazineFaces(points, indices, stringTop);
        indices.forEach((v, i) => box.has(Math.floor(i / 3)) && magazineBounds.expandByPoint(points[v]));
        return {
            body: indices.filter((_, i) => !box.has(Math.floor(i / 3))),
            magazine: indices.filter((_, i) => box.has(Math.floor(i / 3))),
        };
    });
    const mesh = (n: number, indices: Uint32Array): THREE.Mesh | undefined => {
        const { part, transparent } = parts[n];
        if (indices.length === 0) return undefined;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("a_position", new THREE.BufferAttribute(part.positions, 4));
        geometry.setAttribute("a_color", new THREE.BufferAttribute(part.colors, 4, true));
        geometry.setAttribute("a_uv", new THREE.BufferAttribute(part.uvs, 2));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        // No `position` attribute for three.js to measure, so supply culling bounds.
        const [cx, cy, cz, radius] = data.bounds;
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), radius);
        const result = new THREE.Mesh(geometry, transparent ? materials.transparent : materials.opaque);
        result.renderOrder = transparent ? 2 : 1;
        return result;
    };
    /** Meshes in RS model space, turned into the contract (grip at the origin). */
    const contract = (meshes: (THREE.Mesh | undefined)[]): THREE.Group => {
        const model = new THREE.Group();
        model.position.copy(toThree(info.grip)).negate();
        for (const m of meshes) if (m) model.add(m);
        const held = new THREE.Group();
        held.quaternion.copy(orientation);
        held.add(model);
        return held;
    };
    const held = contract(split.map(({ body }, n) => mesh(n, body)));
    const magazine = repeater && !magazineBounds.isEmpty() ? contract(split.map((s, n) => mesh(n, s.magazine))) : undefined;
    const weapon = new THREE.Group();
    weapon.name = `weapon_${info.id}`;
    weapon.add(held);
    if (info.family === "bow") {
        const points = [data.opaque, data.transparent].flatMap((mesh) => [...contractPoints(info, mesh.positions, orientation)]);
        const bowString = BowString.fit(points);
        if (bowString) {
            weapon.add(bowString);
        }
    } else if (crossbow) {
        const rig = CrossbowRig.fit(kept, string);
        if (rig) {
            if (magazine) rig.attachMagazine(magazine, magazineBounds);
            weapon.add(rig);
        } else if (magazine) {
            weapon.add(magazine);
        }
    }
    return weapon;
}

/** A mesh's vertices in the weapon contract's space (tiles, grip at the origin). */
function* contractPoints(info: CacheWeaponInfo, positions: Int16Array, orientation: THREE.Quaternion): Generator<THREE.Vector3> {
    const grip = toThree(info.grip);
    for (let i = 0; i < positions.length; i += 4) {
        yield toThree([positions[i], positions[i + 1], positions[i + 2]]).sub(grip).applyQuaternion(orientation);
    }
}
