import { TextureLoader } from "./rs/texture/TextureLoader";
import { buildPalette } from "./rs/util/ColorUtil";

// The OSRS client's middle brightness setting (lower is brighter, 1.0 is the darkest).
export const BRIGHTNESS = 0.8;

/** Converts lit HSL face colors and cache texture ids into the world format's RGBA and layers. */
export class FaceColors {
    private readonly palette: Int32Array;
    private readonly textureLayers = new Map<number, number>();

    constructor(textureLoader: Pick<TextureLoader, "getTextureIds">) {
        this.palette = buildPalette(BRIGHTNESS, 0, 512);
        // Layer 0 of the texture array is plain white, so cache texture i lives at layer i + 1.
        textureLoader.getTextureIds().forEach((id, i) => this.textureLayers.set(id, i + 1));
    }

    hslToRgba(hsl: number, textureLayer: number, alpha: number): number {
        if (textureLayer !== 0) {
            // Textured faces only carry a lightness value that modulates the texture.
            const light = (((hsl & 0x7f) / 127) * 255) | 0;
            return ((light << 24) | (light << 16) | (light << 8) | alpha) >>> 0;
        }
        return ((this.palette[hsl & 0xffff] << 8) | alpha) >>> 0;
    }

    textureLayer(textureId: number): number {
        return textureId === -1 ? 0 : (this.textureLayers.get(textureId) ?? 0);
    }
}
