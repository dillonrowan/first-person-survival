import { NpcAttackClip, NpcClip, NpcMeshData, NpcModelData } from "../../src/world/NpcFormat";
import { RS_UNITS_PER_TILE } from "../../src/world/WorldFormat";
import { FaceColors } from "./FaceColors";
import { ChosenAttack, PLAYER_FRAME_BASE, holdsWeapon } from "./NpcAttackAnims";
import { FrameBase, buildSkeleton } from "./NpcSkeleton";
import { quantizeUv } from "./MeshBuilder";
import { NpcAppearanceTask } from "./NpcSpawns";
import { NpcType } from "./rs/config/npctype/NpcType";
import { NpcTypeLoader } from "./rs/config/npctype/NpcTypeLoader";
import { SeqTypeLoader } from "./rs/config/seqtype/SeqTypeLoader";
import { Model } from "./rs/model/Model";
import { TextureLoader } from "./rs/texture/TextureLoader";

/** Same depth bias scheme as locs (see RegionBuilder): face priority + 1 + this. */
const PRIORITY_NPC = 1;

export type NpcModelSource = {
    /** A lit model of the NPC, animated to `frame` of `seqId` (-1 for the base pose). */
    getModel(type: NpcType, seqId: number, frame: number): Model | undefined;
    /** The frame base (labelled transform groups) of an animation, for the ragdoll skeleton. */
    getFrameBase?(seqId: number): (FrameBase & { id?: number }) | undefined;
};

class NpcMeshBuilder {
    private readonly positions: number[] = [];
    private readonly colors: number[] = [];
    private readonly uvs: number[] = [];
    private readonly sources: number[] = [];
    private readonly indices: number[] = [];
    private readonly byKey = new Map<string, number>();

    addVertex(
        source: number,
        x: number,
        y: number,
        z: number,
        rgba: number,
        u: number,
        v: number,
        info: number,
    ): number {
        const uq = quantizeUv(u);
        const vq = quantizeUv(v);
        const key = `${source},${rgba},${uq},${vq},${info}`;
        const cached = this.byKey.get(key);
        if (cached !== undefined) {
            return cached;
        }
        const index = this.sources.length;
        this.byKey.set(key, index);
        this.positions.push(x, y, z, info);
        // Bytes r, g, b, a.
        this.colors.push(
            (rgba >>> 24) & 0xff,
            (rgba >>> 16) & 0xff,
            (rgba >>> 8) & 0xff,
            rgba & 0xff,
        );
        this.uvs.push(uq, vq);
        this.sources.push(source);
        return index;
    }

    addTriangle(a: number, b: number, c: number): void {
        this.indices.push(a, b, c);
    }

    get isEmpty(): boolean {
        return this.indices.length === 0;
    }

    build(): NpcMeshData {
        return {
            positions: Int16Array.from(this.positions),
            colors: Uint8Array.from(this.colors),
            uvs: Int16Array.from(this.uvs),
            sources: Uint16Array.from(this.sources),
            indices: Uint32Array.from(this.indices),
        };
    }
}

/** Picks an NPC's attack sequences (see NpcAttackAnims). */
export type NpcAttackSource = {
    choose(idleSeqId: number, frameBase: number, armed: boolean): ChosenAttack[];
};

/** Bakes an NPC appearance (lit mesh plus idle, walk and attack frames) into an NpcModelData. */
export class NpcModelBuilder {
    private warnedClamp = false;

    constructor(
        private readonly npcTypeLoader: Pick<NpcTypeLoader, "load">,
        private readonly models: NpcModelSource,
        private readonly seqTypeLoader: Pick<SeqTypeLoader, "load">,
        private readonly colors: FaceColors,
        private readonly textureLoader: Pick<TextureLoader, "isTransparent">,
        private readonly attackSource?: NpcAttackSource,
    ) {}

    build(task: NpcAppearanceTask): NpcModelData | undefined {
        const display = this.npcTypeLoader.load(task.displayId);
        const base = this.models.getModel(display, -1, -1);
        if (!base || base.verticesCount > 0xffff) {
            return undefined;
        }

        const opaque = new NpcMeshBuilder();
        const transparent = new NpcMeshBuilder();
        this.addFaces(base, opaque, transparent);
        if (opaque.isEmpty && transparent.isEmpty) {
            return undefined;
        }

        const idle = this.bakeClip(display, base, task.idleSeqId);
        const walk =
            task.walkSeqId !== -1 ? this.bakeClip(display, base, task.walkSeqId) : undefined;

        // The walk usually moves more limbs than the idle, so its frame base splits more parts.
        const frameBase =
            (task.walkSeqId !== -1 ? this.models.getFrameBase?.(task.walkSeqId) : undefined) ??
            this.models.getFrameBase?.(task.idleSeqId);
        const skeleton = buildSkeleton(
            base.vertexLabels,
            base.verticesX,
            base.verticesY,
            base.verticesZ,
            base.verticesCount,
            frameBase,
        );

        const attacks = this.bakeAttacks(display, base, task.idleSeqId, skeleton);

        return {
            vertexCount: base.verticesCount,
            bounds: computeBounds(base, [idle, walk, ...(attacks ?? [])]),
            opaque: opaque.build(),
            transparent: transparent.build(),
            idle,
            walk,
            skeleton,
            attacks,
        };
    }

    /** The NPC's melee attacks from the cache, each with the moment its blow lands. */
    private bakeAttacks(
        display: NpcType,
        base: Model,
        idleSeqId: number,
        skeleton: NpcModelData["skeleton"],
    ): NpcAttackClip[] | undefined {
        const frameBase = this.attackSource && this.models.getFrameBase?.(idleSeqId)?.id;
        if (frameBase === undefined) {
            return undefined;
        }
        const armed =
            frameBase === PLAYER_FRAME_BASE &&
            holdsWeapon(base.verticesCount, base.verticesX, base.verticesY, base.verticesZ, skeleton);
        const attacks: NpcAttackClip[] = [];
        for (const { seqId, shove } of this.attackSource!.choose(idleSeqId, frameBase, armed)) {
            const clip = this.bakeClip(display, base, seqId);
            if (clip) {
                attacks.push({ ...clip, hitCycle: impactCycle(clip, base), shove });
            }
        }
        return attacks.length > 0 ? attacks : undefined;
    }

    // Same face rules as RegionBuilder.addModel.
    private addFaces(model: Model, opaque: NpcMeshBuilder, transparent: NpcMeshBuilder): void {
        for (let f = 0; f < model.faceCount; f++) {
            if (model.faceColors3[f] === -2) {
                continue;
            }
            const textureId = model.faceTextures ? model.faceTextures[f] : -1;
            let alpha = 0xff;
            if (model.faceAlphas && textureId === -1) {
                alpha = 0xff - (model.faceAlphas[f] & 0xff);
            }
            if (alpha === 0 || alpha === 1) {
                continue;
            }
            const isTransparent =
                alpha < 0xff || (textureId !== -1 && this.textureLoader.isTransparent(textureId));
            const mesh = isTransparent ? transparent : opaque;

            const layer = this.colors.textureLayer(textureId);
            const priority =
                (model.faceRenderPriorities ? model.faceRenderPriorities[f] : 0) + 1 + PRIORITY_NPC;
            const info = (layer & 0xff) | ((priority & 0x1f) << 8);

            const hslA = model.faceColors1[f];
            let hslB = model.faceColors2[f];
            let hslC = model.faceColors3[f];
            if (hslC === -1) {
                hslC = hslB = hslA;
            }

            const uvs = model.uvs;
            const hasUv = uvs !== undefined && layer !== 0;
            const vertices = [model.indices1[f], model.indices2[f], model.indices3[f]];
            const hsls = [hslA, hslB, hslC];
            const ids = vertices.map((vertex, i) =>
                mesh.addVertex(
                    vertex,
                    model.verticesX[vertex],
                    model.verticesY[vertex],
                    model.verticesZ[vertex],
                    this.colors.hslToRgba(hsls[i], layer, alpha),
                    hasUv ? uvs[f * 6 + i * 2] : 0,
                    hasUv ? uvs[f * 6 + i * 2 + 1] : 0,
                    info,
                ),
            );
            mesh.addTriangle(ids[0], ids[1], ids[2]);
        }
    }

    private bakeClip(display: NpcType, base: Model, seqId: number): NpcClip | undefined {
        if (seqId === -1) {
            return undefined;
        }
        const seq = this.seqTypeLoader.load(seqId);
        if (seq.isSkeletalSeq() || !seq.frameIds || seq.frameIds.length === 0) {
            return undefined;
        }
        const frameCount = seq.frameIds.length;
        const count = base.verticesCount;
        const positions = new Int16Array(frameCount * count * 3);
        const frameLengths = new Uint16Array(frameCount);
        for (let f = 0; f < frameCount; f++) {
            let model = this.models.getModel(display, seqId, f);
            if (!model || model.verticesCount !== count) {
                model = base;
            }
            for (let v = 0; v < count; v++) {
                const i = (f * count + v) * 3;
                positions[i] = this.clamp(model.verticesX[v]);
                positions[i + 1] = this.clamp(model.verticesY[v]);
                positions[i + 2] = this.clamp(model.verticesZ[v]);
            }
            frameLengths[f] = Math.max(1, seq.frameLengths[f] ?? 1);
        }
        return { frameLengths, frameStep: seq.frameStep, positions };
    }

    private clamp(value: number): number {
        if (value > 32767 || value < -32767) {
            if (!this.warnedClamp) {
                this.warnedClamp = true;
                console.warn("NPC vertex outside the 16-bit range was clamped");
            }
            return value > 0 ? 32767 : -32767;
        }
        return value;
    }
}

/**
 * Client cycle of an attack's impact: the middle of the frame where the upper body reaches
 * furthest forward (RS models face -z, +y is down).
 */
export function impactCycle(clip: NpcClip, base: Pick<Model, "verticesCount" | "verticesY">): number {
    const count = base.verticesCount;
    let top = 0;
    for (let v = 0; v < count; v++) {
        top = Math.max(top, -base.verticesY[v]);
    }
    let best = -Infinity;
    let bestFrame = 0;
    for (let f = 0; f < clip.frameLengths.length; f++) {
        for (let v = 0; v < count; v++) {
            const i = (f * count + v) * 3;
            if (-clip.positions[i + 1] > top * 0.3 && -clip.positions[i + 2] > best) {
                best = -clip.positions[i + 2];
                bestFrame = f;
            }
        }
    }
    let cycle = 0;
    for (let f = 0; f < bestFrame; f++) {
        cycle += clip.frameLengths[f];
    }
    return cycle + Math.ceil(clip.frameLengths[bestFrame] / 2);
}

function computeBounds(base: Model, clips: (NpcClip | undefined)[]): Float32Array {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    const add = (x: number, y: number, z: number) => {
        // Same axis conversion as the vertex shader: tiles, +y up, north is -z.
        const tx = x / RS_UNITS_PER_TILE;
        const ty = -y / RS_UNITS_PER_TILE;
        const tz = -z / RS_UNITS_PER_TILE;
        minX = Math.min(minX, tx);
        maxX = Math.max(maxX, tx);
        minY = Math.min(minY, ty);
        maxY = Math.max(maxY, ty);
        minZ = Math.min(minZ, tz);
        maxZ = Math.max(maxZ, tz);
    };
    for (let v = 0; v < base.verticesCount; v++) {
        add(base.verticesX[v], base.verticesY[v], base.verticesZ[v]);
    }
    for (const clip of clips) {
        if (clip) {
            for (let i = 0; i < clip.positions.length; i += 3) {
                add(clip.positions[i], clip.positions[i + 1], clip.positions[i + 2]);
            }
        }
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    return new Float32Array([cx, cy, cz, Math.hypot(maxX - cx, maxY - cy, maxZ - cz)]);
}
