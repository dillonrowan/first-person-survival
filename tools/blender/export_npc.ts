import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { frameAtCycle } from "../../src/npc/NpcAnimation";
import { decodeNpcModel } from "../../src/world/NpcFormat";
// Usage: export_npc.ts <npcs/ID_ID.bin> <out.json> [attackIndex]
// With attackIndex the JSON also carries that attack clip (every frame, converted like idle0) and
// the frame it releases or strikes on, for checking launch points and release frames in Blender.
const [file, out, attackArg] = process.argv.slice(2);
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
let attack: object | undefined;
if (attackArg !== undefined) {
    const clip = m.attacks?.[Number(attackArg)];
    if (!clip) throw new Error(`no attack ${attackArg}; the model has ${m.attacks?.length ?? 0}`);
    const frames: number[][] = [];
    for (let f = 0; f < clip.frameLengths.length; f++) {
        frames.push(Array.from({ length: n * 3 }, (_, i) => (i % 3 === 0 ? 1 : -1) * clip.positions[f * n * 3 + i] / U));
    }
    attack = {
        style: clip.style, seqId: clip.seqId, hitCycle: clip.hitCycle, launch: clip.launch,
        frameLengths: Array.from(clip.frameLengths), releaseFrame: frameAtCycle(clip, clip.hitCycle), frames,
    };
}
writeFileSync(out, JSON.stringify({
    attack,
    vertexCount: n, base, idle0, meshes,
    parents: Array.from(sk.parents), partOf: Array.from(sk.partOf),
    pivots: Array.from(sk.pivots).map((v, i) => (i % 3 === 0 ? 1 : -1) * v / U),
    idleFrames: idle.frameLengths.length,
}));
console.log("verts", n, "parts", sk.parents.length, "idle frames", idle.frameLengths.length);
