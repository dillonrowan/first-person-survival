// File format of the exported world map. Written once by tools/world-export, read by the game.
//
// public/world/
//   world.json         WorldManifest
//   textures.png       texture atlas, TEXTURE_SIZE px cells, `columns` per row (layer 0 = white)
//   regions/X_Y.bin    one gzip-compressed region per 64x64-tile map square (see encodeRegion)
//   npcs.json, npcs/*.bin   optional NPC spawns and baked models (see NpcFormat.ts)

export const WORLD_FORMAT_VERSION = 1;

/** Tiles per region (an OSRS map square). */
export const REGION_SIZE = 64;
/** Height levels ("planes") per region. */
export const LEVELS = 4;
/** RS geometry uses 128 units per tile; heights use the same scale with +y pointing down. */
export const RS_UNITS_PER_TILE = 128;
/** Mesh UVs are stored as int16 in units of 1 / UV_SCALE. */
export const UV_SCALE = 4096;
export const TEXTURE_SIZE = 128;

/**
 * Region-local triangle mesh. 16 bytes per vertex.
 * Positions are RS units relative to the region's south-west corner (+x east, +y down, +z north).
 */
export type MeshData = {
    /** x, y, z, info per vertex. info = textureLayer | depthPriority << 8 | plane << 13 */
    positions: Int16Array;
    /** r, g, b, a per vertex, lighting already baked in. */
    colors: Uint8Array;
    /** u, v per vertex, in units of 1 / UV_SCALE. */
    uvs: Int16Array;
    indices: Uint32Array;
    /** Bounding sphere in game space (tiles, +y up, north is -z): x, y, z, radius. */
    bounds: Float32Array;
};

export type RegionData = {
    mapX: number;
    mapY: number;
    /** Tile models (ground, floors) and roofs. Render double-sided, so upper floors work as
     *  ceilings and roofs (which OSRS only models from outside) still show from indoors. */
    terrain: MeshData;
    /** Loc models (walls, roofs, trees, furniture...), back faces culled. */
    opaque: MeshData;
    /** Loc faces with alpha or transparent textures, alpha blended. */
    transparent: MeshData;
    /** Corner heights, (REGION_SIZE + 1)^2 per level, index (level * 65 + x) * 65 + y. RS units, negative is up. */
    heights: Int32Array;
    /** Tile render flags, REGION_SIZE^2 per level, index (level * 64 + x) * 64 + y. 0x2 on level 1 = bridge. */
    renderFlags: Uint8Array;
    /** 1 where a level has a visible ground/floor tile, same indexing as renderFlags. */
    floors: Uint8Array;
    /** OSRS collision flags, same indexing as renderFlags. Bridges are already moved down a level. */
    collision: Int32Array;
};

export type TextureLayer = {
    /** Cache texture id, -1 for the white layer 0 used by untextured faces. */
    id: number;
    /** UV scroll per second (water, lava...). */
    animU: number;
    animV: number;
    /** Fragments below this texture alpha are discarded. */
    alphaCutOff: number;
};

export type WorldManifest = {
    format: number;
    source: { game: string; revision: number; cacheId: number; timestamp: string };
    regionSize: number;
    /** Exported regions as [mapX, mapY]. World tile x = mapX * 64 + localX, likewise for y. */
    regions: [number, number][];
    spawn: { x: number; y: number; plane: number };
    textures: { file: string; tileSize: number; columns: number; layers: TextureLayer[] };
    /** NPC spawn list (an NpcManifest file); absent in exports made without NPCs. */
    npcs?: { file: string; spawns: number; appearances: number };
};

/** Told when the game streams a region in or out. */
export type RegionListener = {
    loaded(mapX: number, mapY: number): void;
    unloaded(mapX: number, mapY: number): void;
};

export function regionFileName(mapX: number, mapY: number): string {
    return `${mapX}_${mapY}.bin`;
}

/** Collision flags, as used by the OSRS client (see CollisionMap in tools/world-export). */
export const CollisionFlag = {
    WALL_NORTH_WEST: 0x1,
    WALL_NORTH: 0x2,
    WALL_NORTH_EAST: 0x4,
    WALL_EAST: 0x8,
    WALL_SOUTH_EAST: 0x10,
    WALL_SOUTH: 0x20,
    WALL_SOUTH_WEST: 0x40,
    WALL_WEST: 0x80,
    OBJECT: 0x100,
    FLOOR_DECORATION: 0x40000,
    FLOOR: 0x200000,
} as const;

// Little-endian binary layout, every section 4-byte aligned:
//   u32 magic, u32 version, i32 mapX, i32 mapY
//   3 x mesh (terrain, opaque, transparent):
//     u32 vertexCount, u32 indexCount, f32[4] bounds,
//     i16[4 * vertexCount] positions, u8[4 * vertexCount] colors,
//     i16[2 * vertexCount] uvs, u32[indexCount] indices
//   i32[LEVELS * 65 * 65] heights, u8[LEVELS * 64 * 64] renderFlags, u8[LEVELS * 64 * 64] floors,
//   i32[LEVELS * 64 * 64] collision
const MAGIC = 0x57535046; // "FPSW"
const HEIGHTS_LENGTH = LEVELS * (REGION_SIZE + 1) * (REGION_SIZE + 1);
const TILES_LENGTH = LEVELS * REGION_SIZE * REGION_SIZE;

function meshByteLength(mesh: MeshData): number {
    const vertexCount = mesh.positions.length / 4;
    return 24 + vertexCount * 16 + mesh.indices.length * 4;
}

export function encodeRegion(region: RegionData): Uint8Array {
    const meshes = [region.terrain, region.opaque, region.transparent];
    const byteLength =
        16 +
        meshes.reduce((sum, mesh) => sum + meshByteLength(mesh), 0) +
        HEIGHTS_LENGTH * 4 +
        TILES_LENGTH * 2 +
        TILES_LENGTH * 4;

    const bytes = new Uint8Array(byteLength);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    const writeArray = (array: ArrayBufferView) => {
        bytes.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), offset);
        offset += array.byteLength;
    };

    view.setUint32(0, MAGIC, true);
    view.setUint32(4, WORLD_FORMAT_VERSION, true);
    view.setInt32(8, region.mapX, true);
    view.setInt32(12, region.mapY, true);
    offset = 16;

    for (const mesh of meshes) {
        view.setUint32(offset, mesh.positions.length / 4, true);
        view.setUint32(offset + 4, mesh.indices.length, true);
        offset += 8;
        writeArray(mesh.bounds);
        writeArray(mesh.positions);
        writeArray(mesh.colors);
        writeArray(mesh.uvs);
        writeArray(mesh.indices);
    }

    writeArray(region.heights);
    writeArray(region.renderFlags);
    writeArray(region.floors);
    writeArray(region.collision);

    return bytes;
}

/** Decodes an (already decompressed) region file. Arrays are views into `buffer`. */
export function decodeRegion(buffer: ArrayBuffer): RegionData {
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== MAGIC) {
        throw new Error("Not a world region file");
    }
    const version = view.getUint32(4, true);
    if (version !== WORLD_FORMAT_VERSION) {
        throw new Error(`Unsupported region format ${version}, re-run npm run export-world`);
    }
    const mapX = view.getInt32(8, true);
    const mapY = view.getInt32(12, true);
    let offset = 16;

    const readMesh = (): MeshData => {
        const vertexCount = view.getUint32(offset, true);
        const indexCount = view.getUint32(offset + 4, true);
        offset += 8;
        const bounds = new Float32Array(buffer, offset, 4);
        offset += 16;
        const positions = new Int16Array(buffer, offset, vertexCount * 4);
        offset += vertexCount * 8;
        const colors = new Uint8Array(buffer, offset, vertexCount * 4);
        offset += vertexCount * 4;
        const uvs = new Int16Array(buffer, offset, vertexCount * 2);
        offset += vertexCount * 4;
        const indices = new Uint32Array(buffer, offset, indexCount);
        offset += indexCount * 4;
        return { positions, colors, uvs, indices, bounds };
    };

    const terrain = readMesh();
    const opaque = readMesh();
    const transparent = readMesh();

    const heights = new Int32Array(buffer, offset, HEIGHTS_LENGTH);
    offset += HEIGHTS_LENGTH * 4;
    const renderFlags = new Uint8Array(buffer, offset, TILES_LENGTH);
    offset += TILES_LENGTH;
    const floors = new Uint8Array(buffer, offset, TILES_LENGTH);
    offset += TILES_LENGTH;
    const collision = new Int32Array(buffer, offset, TILES_LENGTH);

    return { mapX, mapY, terrain, opaque, transparent, heights, renderFlags, floors, collision };
}
