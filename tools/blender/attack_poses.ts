// Bakes NPCs with the current exporter code (no export needed) and writes, per NPC, an OBJ with its
// rest pose and its pose at each attack's hit cycle, side by side (vertex colours), for checking
// which attack animations the export picks and when their blows land:
//
//   npx tsx tools/blender/attack_poses.ts <outDir> <npcId>...
//   blender --background --python tools/blender/render_attack_poses.py -- <outDir>
//
// tools/world-export/audit-npc-attacks.ts lists the NPCs worth looking at.
import fs from "node:fs";
import path from "node:path";
import { readCacheFiles } from "../world-export/cache-files";
import { FaceColors } from "../world-export/FaceColors";
import { NpcAttackPicker, buildAttackIndex, readAnimationNames } from "../world-export/NpcAttackAnims";
import { NpcModelBuilder } from "../world-export/NpcModelBuilder";
import { attackRulesFor } from "../world-export/NpcAttackRules";
import { createWorldLoaders } from "../world-export/WorldLoaders";
import type { NpcClip } from "../../src/world/NpcFormat";
const [outDir, ...ids] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const loaders = createWorldLoaders(readCacheFiles("cache"));
const names = readAnimationNames(path.join("tools", "world-export", "data", "animation-names-runelite.json"));
const builder = new NpcModelBuilder(loaders.npcTypeLoader, loaders.npcModelLoader, loaders.seqTypeLoader, new FaceColors(loaders.textureLoader), loaders.textureLoader,
    new NpcAttackPicker(buildAttackIndex(names, (id) => loaders.npcModelLoader.getAnimationBase(id)?.id)));
const wiki = JSON.parse(fs.readFileSync("tools/world-export/data/npc-attacks-wiki.json", "utf8"));
const frameAt = (clip: NpcClip, cycle: number) => { let c = 0; for (let f = 0; f < clip.frameLengths.length; f++) { c += clip.frameLengths[f]; if (cycle < c) return f; } return clip.frameLengths.length - 1; };
const index: { id: number; name: string; poses: string[] }[] = [];
for (const id of ids.map(Number)) {
    const t = loaders.npcTypeLoader.load(id);
    const rules = attackRulesFor(wiki[id]);
    const data = builder.build({ id, displayId: id, name: t.name, size: t.size, combatLevel: t.combatLevel, rotationSpeed: 32, file: "", idleSeqId: t.idleSeqId, walkSeqId: t.walkSeqId, ...(rules ? { attackStyles: rules.infos, styleSeqs: rules.seqs } : {}) } as any);
    if (!data) continue;
    const n = data.vertexCount;
    let minX = Infinity, maxX = -Infinity;
    for (let v = 0; v < data.opaque.positions.length; v += 4) { minX = Math.min(minX, data.opaque.positions[v]); maxX = Math.max(maxX, data.opaque.positions[v]); }
    const width = (maxX - minX) * 1.4 + 64;
    const poses: { label: string; pos: (v: number) => [number, number, number] }[] = [];
    const src = data.idle ?? data.walk;
    poses.push({ label: "rest", pos: (v) => src ? [src.positions[v * 3], src.positions[v * 3 + 1], src.positions[v * 3 + 2]] : [0, 0, 0] });
    for (const a of data.attacks ?? []) {
        const f = frameAt(a, a.hitCycle);
        poses.push({ label: `${a.style} ${names.get(a.seqId) ?? a.seqId} hit ${a.hitCycle}/${[...a.frameLengths].reduce((x, y) => x + y, 0)}`, pos: (v) => [a.positions[(f * n + v) * 3], a.positions[(f * n + v) * 3 + 1], a.positions[(f * n + v) * 3 + 2]] });
    }
    const lines: string[] = [];
    let vi = 1;
    poses.forEach((p, k) => {
        for (const mesh of [data.opaque, data.transparent]) {
            const base = vi;
            const count = mesh.sources.length;
            for (let i = 0; i < count; i++) {
                const s = mesh.sources[i];
                const [x, y, z] = src || k > 0 ? p.pos(s) : [mesh.positions[i * 4], mesh.positions[i * 4 + 1], mesh.positions[i * 4 + 2]];
                const c = [0, 1, 2].map((j) => (mesh.colors[i * 4 + j] / 255).toFixed(3));
                lines.push(`v ${((x + k * width) / 128).toFixed(4)} ${(z / 128).toFixed(4)} ${(-y / 128).toFixed(4)} ${c.join(" ")}`);
            }
            for (let i = 0; i < mesh.indices.length; i += 3) lines.push(`f ${base + mesh.indices[i]} ${base + mesh.indices[i + 1]} ${base + mesh.indices[i + 2]}`);
            vi += count;
        }
    });
    fs.writeFileSync(path.join(outDir, `${id}.obj`), lines.join("\n"));
    index.push({ id, name: t.name, poses: poses.map((p) => p.label) });
}
fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index, null, 1));
console.log(index.map((i) => `${i.id} ${i.name}: ${i.poses.join(" | ")}`).join("\n"));
