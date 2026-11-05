// File format of the exported NPCs. Written once by tools/world-export, read by the game.
//
// public/world/
//   npcs.json          NpcManifest: appearances (one model file each) and spawn positions
//   npcs/{id}_{displayId}.bin   gzip-compressed NpcModelData (see encodeNpcModel)
//
// Animation is baked: each file holds the lit base mesh plus the vertex positions of every frame of
// the idle and walk clips, so the game only copies positions and runs no RuneScape animation code.

export const NPC_FORMAT_VERSION = 1;

export type NpcAppearanceInfo = {
    /** Spawn (base) NPC id. */
    id: number;
    /** NPC id whose model is shown (differs from id for multi-NPCs). */
    displayId: number;
    name: string;
    /** Tiles per side. */
    size: number;
    combatLevel: number;
    /** Client rotation units (of 2048 per turn) per 20 ms cycle. */
    rotationSpeed: number;
    /** Model file relative to public/world/. */
    file: string;
    /** Menu options such as "Talk-to" and "Attack", in the cache's order. Absent in older exports. */
    actions?: string[];
};

export type NpcSpawnInfo = {
    /** Index into NpcManifest.appearances. */
    appearance: number;
    /** World tile of the south-west corner. */
    x: number;
    y: number;
    plane: number;
    /** Client orientation: 0 south, 512 west, 1024 north, 1536 east (2048 per turn). */
    orientation: number;
};

export type NpcManifest = {
    format: number;
    source: string;
    appearances: NpcAppearanceInfo[];
    spawns: NpcSpawnInfo[];
};

export type NpcMeshData = {
    /** x, y, z, info per vertex: base pose in model-local RS units. info = textureLayer | depthPriority << 8 */
    positions: Int16Array;
    /** r, g, b, a per vertex, lighting already baked in. */
    colors: Uint8Array;
    /** u, v per vertex, in units of 1 / UV_SCALE. */
    uvs: Int16Array;
    /** Model vertex index of each mesh vertex, to look up its animated position. */
    sources: Uint16Array;
    indices: Uint32Array;
};

export type NpcClip = {
    /** Duration of each frame in 20 ms client cycles. */
    frameLengths: Uint16Array;
    /** Frames to step back after the last frame; 0 or less restarts at frame 0. */
    frameStep: number;
    /** x, y, z per model vertex per frame, index (frame * vertexCount + vertex) * 3. */
    positions: Int16Array;
};

export type NpcModelData = {
    /** Vertices of the animated model (not of the meshes). */
    vertexCount: number;
    /** Bounding sphere in tiles, three.js axes (+y up, north is -z): x, y, z, radius. */
    bounds: Float32Array;
    opaque: NpcMeshData;
    transparent: NpcMeshData;
    idle?: NpcClip;
    walk?: NpcClip;
};

export function npcModelFileName(id: number, displayId: number): string {
    return `${id}_${displayId}.bin`;
}

// Little-endian, every section 4-byte aligned (odd-length 16-bit arrays are padded with 2 bytes):
//   u32 magic, u32 version, u32 vertexCount, u32 clipMask (1 = idle, 2 = walk), f32[4] bounds
//   2 x mesh (opaque, transparent):
//     u32 vertexCount, u32 indexCount, i16[4n] positions, u8[4n] colors, i16[2n] uvs,
//     u16[n] sources (+pad), u32[indexCount] indices
//   each clip in mask order:
//     u32 frameCount, i32 frameStep, u16[frameCount] frameLengths (+pad),
//     i16[frameCount * vertexCount * 3] positions (+pad)
const MAGIC = 0x4e535046; // "FPSN"
const HEADER_BYTES = 32;

const pad4 = (bytes: number) => (bytes + 3) & ~3;

function meshByteLength(mesh: NpcMeshData): number {
    const n = mesh.positions.length / 4;
    return 8 + n * 8 + n * 4 + n * 4 + pad4(n * 2) + mesh.indices.length * 4;
}

function clipByteLength(clip: NpcClip): number {
    return 8 + pad4(clip.frameLengths.length * 2) + pad4(clip.positions.length * 2);
}

export function encodeNpcModel(model: NpcModelData): Uint8Array {
    const clips = [model.idle, model.walk];
    const byteLength =
        HEADER_BYTES +
        meshByteLength(model.opaque) +
        meshByteLength(model.transparent) +
        clips.reduce((sum, clip) => sum + (clip ? clipByteLength(clip) : 0), 0);

    const bytes = new Uint8Array(byteLength);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    const writeArray = (array: ArrayBufferView) => {
        bytes.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), offset);
        offset += pad4(array.byteLength);
    };

    view.setUint32(0, MAGIC, true);
    view.setUint32(4, NPC_FORMAT_VERSION, true);
    view.setUint32(8, model.vertexCount, true);
    view.setUint32(12, (model.idle ? 1 : 0) | (model.walk ? 2 : 0), true);
    offset = 16;
    writeArray(model.bounds);

    for (const mesh of [model.opaque, model.transparent]) {
        view.setUint32(offset, mesh.positions.length / 4, true);
        view.setUint32(offset + 4, mesh.indices.length, true);
        offset += 8;
        writeArray(mesh.positions);
        writeArray(mesh.colors);
        writeArray(mesh.uvs);
        writeArray(mesh.sources);
        writeArray(mesh.indices);
    }

    for (const clip of clips) {
        if (!clip) {
            continue;
        }
        view.setUint32(offset, clip.frameLengths.length, true);
        view.setInt32(offset + 4, clip.frameStep, true);
        offset += 8;
        writeArray(clip.frameLengths);
        writeArray(clip.positions);
    }

    return bytes;
}

/** Decodes an (already decompressed) NPC file. Arrays are views into `buffer`. */
export function decodeNpcModel(buffer: ArrayBuffer): NpcModelData {
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== MAGIC) {
        throw new Error("Not an NPC model file");
    }
    const version = view.getUint32(4, true);
    if (version !== NPC_FORMAT_VERSION) {
        throw new Error(`Unsupported NPC format ${version}, re-run npm run export-world`);
    }
    const vertexCount = view.getUint32(8, true);
    const clipMask = view.getUint32(12, true);
    const bounds = new Float32Array(buffer, 16, 4);
    let offset = HEADER_BYTES;

    const readMesh = (): NpcMeshData => {
        const n = view.getUint32(offset, true);
        const indexCount = view.getUint32(offset + 4, true);
        offset += 8;
        const positions = new Int16Array(buffer, offset, n * 4);
        offset += n * 8;
        const colors = new Uint8Array(buffer, offset, n * 4);
        offset += n * 4;
        const uvs = new Int16Array(buffer, offset, n * 2);
        offset += n * 4;
        const sources = new Uint16Array(buffer, offset, n);
        offset += pad4(n * 2);
        const indices = new Uint32Array(buffer, offset, indexCount);
        offset += indexCount * 4;
        return { positions, colors, uvs, sources, indices };
    };

    const readClip = (): NpcClip => {
        const frameCount = view.getUint32(offset, true);
        const frameStep = view.getInt32(offset + 4, true);
        offset += 8;
        const frameLengths = new Uint16Array(buffer, offset, frameCount);
        offset += pad4(frameCount * 2);
        const positions = new Int16Array(buffer, offset, frameCount * vertexCount * 3);
        offset += pad4(positions.byteLength);
        return { frameLengths, frameStep, positions };
    };

    const opaque = readMesh();
    const transparent = readMesh();
    const idle = clipMask & 1 ? readClip() : undefined;
    const walk = clipMask & 2 ? readClip() : undefined;
    return { vertexCount, bounds, opaque, transparent, idle, walk };
}
