import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * The Blender-made rod (tools/blender/fishing.py) a fishing rod item is held as, in
 * public/models/fishing/; undefined for items that are not rods. Fly rods get the fly rod, every
 * other rod the spinning rod. [design: not the OSRS look]
 */
export function rodModelFile(itemName: string): string | undefined {
    if (!/\brod\b/i.test(itemName)) return undefined;
    return /\bfly\b/i.test(itemName) ? "fly_rod.glb" : "rod.glb";
}

/**
 * Loads a rod for the hand. It follows the weapon contract (grip at the origin, rod along +Y, reel
 * and guides on +Z); `userData.hold` asks WeaponView for its rod pose and `userData.tipLength` is
 * where the line leaves it.
 */
export async function loadRodModel(url: string): Promise<THREE.Object3D> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), "");
    const model = gltf.scene;
    model.userData.hold = "rod";
    model.userData.tipLength = new THREE.Box3().setFromObject(model).max.y;
    return model;
}
