import type { NpcModelData } from "../../src/world/NpcFormat";
import type { SpellGfx } from "../../src/world/SpellGfxFormat";
import type { FaceColors } from "./FaceColors";
import { buildModelMeshes, computeBounds } from "./NpcModelBuilder";
import type { SpotAnimType } from "./rs/config/spotanimtype/SpotAnimType";
import type { SeqTypeLoader } from "./rs/config/seqtype/SeqTypeLoader";
import { Model } from "./rs/model/Model";
import { ModelData } from "./rs/model/ModelData";
import type { ModelLoader } from "./rs/model/ModelLoader";
import type { SeqFrameLoader } from "./rs/model/seq/SeqFrameLoader";
import type { TextureLoader } from "./rs/texture/TextureLoader";

/** Depth priority bias, as for NPCs. */
const PRIORITY_GFX = 1;
const EMPTY_MESH = {
    positions: new Int16Array(0),
    colors: new Uint8Array(0),
    uvs: new Int16Array(0),
    sources: new Uint16Array(0),
    indices: new Uint32Array(0),
};

export type SpotAnimSource = {
    modelLoader: Pick<ModelLoader, "getModel">;
    textureLoader: TextureLoader;
    seqTypeLoader: Pick<SeqTypeLoader, "load">;
    seqFrameLoader: Pick<SeqFrameLoader, "load">;
    faceColors: FaceColors;
};

/**
 * Bakes a spot animation the way the client draws it (SpotAnimation.getModel): the model recoloured
 * and retextured, lit with ambient + 64 and contrast + 850, posed to each frame of its sequence
 * (alpha fades included), then scaled and turned by its orientation (degrees). Undefined when the
 * model is missing or has no visible face.
 */
export function bakeSpotAnim(spot: SpotAnimType, src: SpotAnimSource): SpellGfx | undefined {
    const raw = spot.modelId >= 0 ? src.modelLoader.getModel(spot.modelId) : undefined;
    if (!raw) {
        return undefined;
    }
    const data = ModelData.merge([raw], 1);
    spot.recolorFrom?.forEach((from, i) => data.recolor(from, spot.recolorTo![i]));
    spot.retextureFrom?.forEach((from, i) => data.retexture(from, spot.retextureTo![i]));
    const lit = data.light(src.textureLoader, spot.ambient + 64, spot.contrast + 850, -30, -50, -30);

    const seq = spot.sequenceId >= 0 ? src.seqTypeLoader.load(spot.sequenceId) : undefined;
    const animated = seq && !seq.isSkeletalSeq() && seq.frameIds && seq.frameIds.length > 0;
    const frameCount = animated ? seq.frameIds.length : 1;
    const frameLengths: number[] = [];
    const frames: NpcModelData[] = [];
    for (let f = 0; f < frameCount; f++) {
        let model: Model;
        const seqFrame = animated ? src.seqFrameLoader.load(seq.frameIds[f]) : undefined;
        if (seqFrame) {
            model = Model.copyAnimated(lit, !seqFrame.hasAlphaTransform, !seqFrame.hasColorTransform);
            model.animate(seqFrame, undefined, seq!.op14);
        } else {
            model = Model.copyAnimated(lit, true, true);
        }
        if (spot.widthScale !== 128 || spot.heightScale !== 128) {
            model.scale(spot.widthScale, spot.heightScale, spot.widthScale);
        }
        if (spot.orientation === 90) model.rotate90();
        else if (spot.orientation === 180) model.rotate180();
        else if (spot.orientation === 270) model.rotate270();

        const meshes = buildModelMeshes(model, src.faceColors, src.textureLoader, PRIORITY_GFX);
        frames.push({
            vertexCount: model.verticesCount,
            bounds: computeBounds(model, []),
            opaque: meshes?.opaque ?? EMPTY_MESH,
            transparent: meshes?.transparent ?? EMPTY_MESH,
        });
        frameLengths.push(animated ? Math.max(1, seq.frameLengths[f] ?? 1) : 1);
    }
    if (frames.every((f) => f.opaque.indices.length === 0 && f.transparent.indices.length === 0)) {
        return undefined;
    }
    return { frameLengths, frames };
}
