import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decodeNpcModel } from "../../src/world/NpcFormat";
// Usage: export_item.ts <items/ID.bin> <out.json>
// Writes an item model (base mesh only) as JSON for checking its size and orientation in Blender:
// vertices in tiles (Blender axes: x east, y north, z up), faces as model-vertex triples, and the
// lowest and highest points. The ground model should fit in about 1 x 1 x 1 tile and rest on z = 0.
const [file, out] = process.argv.slice(2);
const b = gunzipSync(readFileSync("public/world/" + file));
const m = decodeNpcModel(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const U = 128; // RS units per tile
const base = new Array(m.vertexCount * 3).fill(0);
const meshes: { indices: number[]; colors: number[] }[] = [];
for (const mesh of [m.opaque, m.transparent]) {
    for (let i = 0; i < mesh.sources.length; i++) {
        const v = mesh.sources[i];
        // RS: x east, y down, z north.
        base[v * 3] = mesh.positions[i * 4] / U;
        base[v * 3 + 1] = mesh.positions[i * 4 + 2] / U;
        base[v * 3 + 2] = -mesh.positions[i * 4 + 1] / U;
    }
    const tris: number[] = [];
    for (let i = 0; i < mesh.indices.length; i++) tris.push(mesh.sources[mesh.indices[i]]);
    const cols: number[] = [];
    for (let i = 0; i < mesh.indices.length; i += 3) {
        const k = mesh.indices[i] * 4;
        cols.push(mesh.colors[k], mesh.colors[k + 1], mesh.colors[k + 2]);
    }
    meshes.push({ indices: tris, colors: cols });
}
const zs = base.filter((_, i) => i % 3 === 2);
writeFileSync(out, JSON.stringify({ vertexCount: m.vertexCount, base, meshes, lowest: Math.min(...zs), highest: Math.max(...zs) }));
console.log("verts", m.vertexCount, "lowest z", Math.min(...zs).toFixed(3), "highest z", Math.max(...zs).toFixed(3));
