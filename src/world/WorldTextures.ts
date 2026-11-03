import * as THREE from "three";

import { WorldManifest } from "./WorldFormat";

export type WorldTextures = {
    /** One layer per manifest texture layer (layer 0 is white). */
    array: THREE.DataArrayTexture;
    /** Width = layer count. Per layer: u scroll/s, v scroll/s, alpha cut-off. */
    materials: THREE.DataTexture;
};

/** Loads textures.png and splits its grid into a texture array the world shader samples. */
export async function loadWorldTextures(
    baseUrl: string,
    manifest: WorldManifest,
    renderer: THREE.WebGLRenderer,
): Promise<WorldTextures> {
    const { file, tileSize, columns, layers } = manifest.textures;

    const response = await fetch(baseUrl + file);
    if (!response.ok) {
        throw new Error(`Failed to load ${file}: ${response.status}`);
    }
    const bitmap = await createImageBitmap(await response.blob(), {
        premultiplyAlpha: "none",
        colorSpaceConversion: "none",
    });
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    const atlas = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    bitmap.close();

    const layerBytes = tileSize * tileSize * 4;
    const rowBytes = tileSize * 4;
    const data = new Uint8Array(layers.length * layerBytes);
    for (let layer = 0; layer < layers.length; layer++) {
        const cellX = (layer % columns) * tileSize;
        const cellY = Math.floor(layer / columns) * tileSize;
        for (let y = 0; y < tileSize; y++) {
            const src = ((cellY + y) * canvas.width + cellX) * 4;
            data.set(atlas.subarray(src, src + rowBytes), layer * layerBytes + y * rowBytes);
        }
    }

    const array = new THREE.DataArrayTexture(data, tileSize, tileSize, layers.length);
    array.format = THREE.RGBAFormat;
    array.type = THREE.UnsignedByteType;
    array.wrapS = THREE.RepeatWrapping;
    array.wrapT = THREE.RepeatWrapping;
    array.magFilter = THREE.LinearFilter;
    array.minFilter = THREE.LinearMipmapLinearFilter;
    array.generateMipmaps = true;
    array.anisotropy = renderer.capabilities.getMaxAnisotropy();
    array.needsUpdate = true;

    const materialData = new Float32Array(layers.length * 4);
    layers.forEach((layer, i) => {
        materialData[i * 4] = layer.animU;
        materialData[i * 4 + 1] = layer.animV;
        materialData[i * 4 + 2] = layer.alphaCutOff;
    });
    const materials = new THREE.DataTexture(
        materialData,
        layers.length,
        1,
        THREE.RGBAFormat,
        THREE.FloatType,
    );
    materials.needsUpdate = true;

    return { array, materials };
}
