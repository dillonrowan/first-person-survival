import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decodeNpcModel } from "../../src/world/NpcFormat";
const [file, out] = process.argv.slice(2);
const b = gunzipSync(readFileSync("public/world/" + file));
const m = decodeNpcModel(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const U = 128; // RS units per tile
const base = new Array(m.vertexCount * 3).fill(0);
const meshes: { indices: number[]; colors: number[] }[] = [];
for (const mesh of [m.opaque, m.transparent]) {
    for (let i = 0; i < mesh.sources.length; i++) {
        const v = mesh.sources[i];
        base[v * 3] = mesh.positions[i * 4] / U; base[v * 3 + 1] = -mesh.positions[i * 4 + 1] / U; base[v * 3 + 2] = -mesh.positions[i * 4 + 2] / U;
    }
    // faces as model-vertex triples
    const tris: number[] = [];
    for (let i = 0; i < mesh.indices.length; i++) tris.push(mesh.sources[mesh.indices[i]]);
    const cols: number[] = [];
    for (let i = 0; i < mesh.indices.length; i += 3) { const k = mesh.indices[i] * 4; cols.push(mesh.colors[k], mesh.colors[k + 1], mesh.colors[k + 2]); }
    meshes.push({ indices: tris, colors: cols });
}
const idle = m.idle!;
const n = m.vertexCount;
const idle0 = Array.from({ length: n * 3 }, (_, i) => (i % 3 === 0 ? 1 : -1) * idle.positions[i] / U);
const sk = m.skeleton!;
writeFileSync(out, JSON.stringify({
    vertexCount: n, base, idle0, meshes,
    parents: Array.from(sk.parents), partOf: Array.from(sk.partOf),
    pivots: Array.from(sk.pivots).map((v, i) => (i % 3 === 0 ? 1 : -1) * v / U),
    idleFrames: idle.frameLengths.length,
}));
console.log("verts", n, "parts", sk.parents.length, "idle frames", idle.frameLengths.length);
