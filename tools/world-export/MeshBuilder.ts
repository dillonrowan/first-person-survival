import { MeshData, RS_UNITS_PER_TILE, UV_SCALE } from "../../src/world/WorldFormat";

/** Growable vertex/index buffers that merge identical vertices. */
export class MeshBuilder {
    private positions: Int16Array;
    private colors: Uint32Array;
    private uvs: Int16Array;
    private indices: Uint32Array;
    private vertexByHash = new Map<number, number>();

    vertexCount = 0;
    indexCount = 0;

    constructor(initialVertices: number = 4096) {
        this.positions = new Int16Array(initialVertices * 4);
        this.colors = new Uint32Array(initialVertices);
        this.uvs = new Int16Array(initialVertices * 2);
        this.indices = new Uint32Array(initialVertices * 3);
    }

    /** Adds a vertex given in region-local RS units and returns its index. */
    addVertex(
        x: number,
        y: number,
        z: number,
        rgba: number,
        u: number,
        v: number,
        textureLayer: number,
        priority: number,
        plane: number,
    ): number {
        const info = (textureLayer & 0xff) | ((priority & 0x1f) << 8) | ((plane & 0x3) << 13);
        const uq = quantizeUv(u);
        const vq = quantizeUv(v);
        // Colors are stored as bytes r, g, b, a; read back little-endian.
        const color =
            (((rgba >>> 24) & 0xff) |
                (((rgba >>> 16) & 0xff) << 8) |
                (((rgba >>> 8) & 0xff) << 16) |
                ((rgba & 0xff) << 24)) >>>
            0;

        let hash = 0x811c9dc5;
        hash = Math.imul(hash ^ x, 0x01000193);
        hash = Math.imul(hash ^ y, 0x01000193);
        hash = Math.imul(hash ^ z, 0x01000193);
        hash = Math.imul(hash ^ info, 0x01000193);
        hash = Math.imul(hash ^ color, 0x01000193);
        hash = Math.imul(hash ^ (uq | (vq << 16)), 0x01000193);

        const cached = this.vertexByHash.get(hash);
        if (cached !== undefined) {
            const p = cached * 4;
            const t = cached * 2;
            if (
                this.positions[p] === x &&
                this.positions[p + 1] === y &&
                this.positions[p + 2] === z &&
                this.positions[p + 3] === info &&
                this.colors[cached] === color &&
                this.uvs[t] === uq &&
                this.uvs[t + 1] === vq
            ) {
                return cached;
            }
        }

        if (this.vertexCount >= this.colors.length) {
            this.grow();
        }

        const index = this.vertexCount++;
        if (cached === undefined) {
            this.vertexByHash.set(hash, index);
        }

        const p = index * 4;
        this.positions[p] = x;
        this.positions[p + 1] = y;
        this.positions[p + 2] = z;
        this.positions[p + 3] = info;
        this.colors[index] = color;
        this.uvs[index * 2] = uq;
        this.uvs[index * 2 + 1] = vq;

        return index;
    }

    addTriangle(a: number, b: number, c: number): void {
        if (this.indexCount + 3 > this.indices.length) {
            const grown = new Uint32Array(this.indices.length * 2);
            grown.set(this.indices);
            this.indices = grown;
        }
        this.indices[this.indexCount++] = a;
        this.indices[this.indexCount++] = b;
        this.indices[this.indexCount++] = c;
    }

    build(): MeshData {
        const positions = this.positions.slice(0, this.vertexCount * 4);
        return {
            positions,
            colors: new Uint8Array(this.colors.buffer.slice(0, this.vertexCount * 4)),
            uvs: this.uvs.slice(0, this.vertexCount * 2),
            indices: this.indices.slice(0, this.indexCount),
            bounds: computeBounds(positions, this.vertexCount),
        };
    }

    private grow(): void {
        const capacity = this.colors.length * 2;
        const positions = new Int16Array(capacity * 4);
        positions.set(this.positions);
        this.positions = positions;
        const colors = new Uint32Array(capacity);
        colors.set(this.colors);
        this.colors = colors;
        const uvs = new Int16Array(capacity * 2);
        uvs.set(this.uvs);
        this.uvs = uvs;
    }
}

function quantizeUv(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(-32767, Math.min(32767, Math.round(value * UV_SCALE)));
}

function computeBounds(positions: Int16Array, count: number): Float32Array {
    if (count === 0) {
        return new Float32Array(4);
    }
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < count * 4; i += 4) {
        // Same axis conversion as the vertex shader: tiles, +y up, north is -z.
        const x = positions[i] / RS_UNITS_PER_TILE;
        const y = -positions[i + 1] / RS_UNITS_PER_TILE;
        const z = -positions[i + 2] / RS_UNITS_PER_TILE;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const radius = Math.hypot(maxX - cx, maxY - cy, maxZ - cz);
    return new Float32Array([cx, cy, cz, radius]);
}
