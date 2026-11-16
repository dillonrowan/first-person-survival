// Renders the world map image from the exported regions: public/world/map.png and map.json.
//
//   npm run export-map
//
// Reads only public/world/ (not the cache), so run it after export-world, which clears that folder.
// Ground level seen from above: terrain and loc models (trees, walls, fences) of plane 0, lit as
// the game draws them, with walls traced in white from the collision flags like the OSRS map.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, unzlibSync } from "fflate";

import { MAP_FORMAT_VERSION, type MapManifest } from "../../src/world/MapFormat";
import { CollisionFlag, type MeshData, REGION_SIZE, RS_UNITS_PER_TILE, type WorldManifest, decodeRegion, regionFileName } from "../../src/world/WorldFormat";
import { encodePng } from "./png";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORLD = path.join(HERE, "..", "..", "public", "world");

/** Pixels per tile. */
const SCALE = 2;
/** The mainland: map squares outside it (altar interiors, instances) are left off the map. */
const MAINLAND = { minY: 32, maxY: 65 };
const WALL_COLOR = [238, 238, 238];
const BACKGROUND = [14, 22, 30];

/** Decodes an 8-bit RGBA, non-interlaced PNG (the texture atlas export-world writes). */
function decodePng(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;
    let width = 0;
    let height = 0;
    const idat: Uint8Array[] = [];
    while (offset < bytes.length) {
        const length = view.getUint32(offset);
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        const data = bytes.subarray(offset + 8, offset + 8 + length);
        if (type === "IHDR") {
            width = view.getUint32(offset + 8);
            height = view.getUint32(offset + 12);
            if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error("Only 8-bit RGBA, non-interlaced PNGs are supported");
        } else if (type === "IDAT") idat.push(data);
        offset += 12 + length;
    }
    const joined = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
    idat.reduce((at, d) => (joined.set(d, at), at + d.length), 0);
    const raw = unzlibSync(joined);
    const stride = width * 4;
    const rgba = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const row = rgba.subarray(y * stride, (y + 1) * stride);
        const prev = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
        for (let i = 0; i < stride; i++) {
            const a = i >= 4 ? row[i - 4] : 0;
            const b = prev[i];
            const c = i >= 4 ? prev[i - 4] : 0;
            let v = src[i];
            if (filter === 1) v += a;
            else if (filter === 2) v += b;
            else if (filter === 3) v += (a + b) >> 1;
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            row[i] = v & 0xff;
        }
    }
    return { width, height, rgba };
}

/** Average colour (0..1) of each texture layer's cell in the atlas; layer 0 is white. */
function layerColors(manifest: WorldManifest): Float32Array {
    const atlas = decodePng(fs.readFileSync(path.join(WORLD, manifest.textures.file)));
    const { tileSize, columns, layers } = manifest.textures;
    const out = new Float32Array(layers.length * 3).fill(1);
    for (let layer = 1; layer < layers.length; layer++) {
        const cx = (layer % columns) * tileSize;
        const cy = Math.floor(layer / columns) * tileSize;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let y = cy; y < cy + tileSize && y < atlas.height; y++) {
            for (let x = cx; x < cx + tileSize; x++) {
                const i = (y * atlas.width + x) * 4;
                if (atlas.rgba[i + 3] < 128) continue;
                r += atlas.rgba[i];
                g += atlas.rgba[i + 1];
                b += atlas.rgba[i + 2];
                n++;
            }
        }
        if (n > 0) out.set([r / n / 255, g / n / 255, b / n / 255], layer * 3);
    }
    return out;
}

function main(): void {
    const manifest = JSON.parse(fs.readFileSync(path.join(WORLD, "world.json"), "utf8")) as WorldManifest;
    const squares = manifest.regions.filter(([, y]) => y >= MAINLAND.minY && y <= MAINLAND.maxY);
    if (squares.length === 0) throw new Error("No exported mainland regions: run npm run export-world first");
    const minX = Math.min(...squares.map(([x]) => x));
    const maxX = Math.max(...squares.map(([x]) => x));
    const minY = Math.min(...squares.map(([, y]) => y));
    const maxY = Math.max(...squares.map(([, y]) => y));
    const originX = minX * REGION_SIZE;
    const originY = minY * REGION_SIZE;
    const tilesX = (maxX - minX + 1) * REGION_SIZE;
    const tilesY = (maxY - minY + 1) * REGION_SIZE;
    const width = tilesX * SCALE;
    const height = tilesY * SCALE;
    const colors = layerColors(manifest);

    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) rgba.set([...BACKGROUND, 255], i * 4);
    const depth = new Float32Array(width * height).fill(-Infinity);

    // Pixel column and row of a point in world tiles (row 0 is the north edge).
    const px = (tileX: number) => (tileX - originX) * SCALE;
    const py = (tileY: number) => (originY + tilesY - tileY) * SCALE;

    const drawMesh = (mesh: MeshData, baseX: number, baseY: number) => {
        const { positions, colors: vc, indices } = mesh;
        const sx = new Float32Array(3);
        const sy = new Float32Array(3);
        const sz = new Float32Array(3);
        const col = new Float32Array(9);
        for (let t = 0; t < indices.length; t += 3) {
            let skip = false;
            for (let k = 0; k < 3; k++) {
                const v = indices[t + k];
                const info = positions[v * 4 + 3];
                if (((info >> 13) & 0x7) !== 0) skip = true;
                const layer = info & 0xff;
                sx[k] = px(baseX + positions[v * 4] / RS_UNITS_PER_TILE);
                sy[k] = py(baseY + positions[v * 4 + 2] / RS_UNITS_PER_TILE);
                sz[k] = -positions[v * 4 + 1];
                for (let c = 0; c < 3; c++) col[k * 3 + c] = vc[v * 4 + c] * (colors[layer * 3 + c] ?? 1);
                if (vc[v * 4 + 3] < 128) skip = true;
            }
            if (skip) continue;
            const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
            if (Math.abs(area) < 1e-9) continue;
            const x0 = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2])));
            const x1 = Math.min(width - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])));
            const y0 = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2])));
            const y1 = Math.min(height - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2])));
            for (let y = y0; y <= y1; y++) {
                for (let x = x0; x <= x1; x++) {
                    const cx = x + 0.5;
                    const cy = y + 0.5;
                    const w0 = ((sx[1] - cx) * (sy[2] - cy) - (sx[2] - cx) * (sy[1] - cy)) / area;
                    const w1 = ((sx[2] - cx) * (sy[0] - cy) - (sx[0] - cx) * (sy[2] - cy)) / area;
                    const w2 = 1 - w0 - w1;
                    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                    const z = w0 * sz[0] + w1 * sz[1] + w2 * sz[2];
                    const p = y * width + x;
                    if (z < depth[p]) continue;
                    depth[p] = z;
                    for (let c = 0; c < 3; c++) rgba[p * 4 + c] = Math.min(255, w0 * col[c] + w1 * col[3 + c] + w2 * col[6 + c]);
                }
            }
        }
    };

    const wall = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        rgba.set(WALL_COLOR, (y * width + x) * 4);
    };

    let done = 0;
    for (const [mapX, mapY] of squares) {
        const file = path.join(WORLD, "regions", regionFileName(mapX, mapY));
        const bytes = gunzipSync(fs.readFileSync(file));
        const region = decodeRegion(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
        const baseX = mapX * REGION_SIZE;
        const baseY = mapY * REGION_SIZE;
        drawMesh(region.terrain, baseX, baseY);
        drawMesh(region.opaque, baseX, baseY);
        // Walls of plane 0, one pixel wide along the tile edge they block.
        for (let lx = 0; lx < REGION_SIZE; lx++) {
            for (let ly = 0; ly < REGION_SIZE; ly++) {
                const flags = region.collision[(0 * REGION_SIZE + lx) * REGION_SIZE + ly];
                const left = px(baseX + lx);
                const top = py(baseY + ly + 1);
                for (let i = 0; i < SCALE; i++) {
                    if (flags & CollisionFlag.WALL_NORTH) wall(left + i, top);
                    if (flags & CollisionFlag.WALL_SOUTH) wall(left + i, top + SCALE - 1);
                    if (flags & CollisionFlag.WALL_WEST) wall(left, top + i);
                    if (flags & CollisionFlag.WALL_EAST) wall(left + SCALE - 1, top + i);
                }
                if (flags & (CollisionFlag.WALL_NORTH_WEST | CollisionFlag.WALL_SOUTH_EAST)) for (let i = 0; i < SCALE; i++) wall(left + i, top + i);
                if (flags & (CollisionFlag.WALL_NORTH_EAST | CollisionFlag.WALL_SOUTH_WEST)) for (let i = 0; i < SCALE; i++) wall(left + SCALE - 1 - i, top + i);
            }
        }
        if (++done % 100 === 0) console.log(`${done}/${squares.length} map squares`);
    }

    fs.writeFileSync(path.join(WORLD, "map.png"), encodePng(width, height, rgba));
    const out: MapManifest = { format: MAP_FORMAT_VERSION, image: "map.png", originX, originY, tilesX, tilesY, scale: SCALE };
    fs.writeFileSync(path.join(WORLD, "map.json"), JSON.stringify(out) + "\n");
    console.log(`Wrote map.png (${width}x${height}) and map.json`);
}

main();
