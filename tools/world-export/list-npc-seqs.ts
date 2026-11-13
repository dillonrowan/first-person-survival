// Lists the animation sequences an NPC could attack with: its idle and walk sequences, its frame
// base (skeleton), and every named sequence on that frame base. Use it to find the sequence id for
// an `seq` rule in data/npc-attack-overrides.ts when the name heuristic of NpcAttackAnims.ts picks
// the wrong one (or none, and the attack reuses the melee animation).
//
//   npx tsx tools/world-export/list-npc-seqs.ts 260 253

import path from "node:path";
import { fileURLToPath } from "node:url";

import { readCacheFiles } from "./cache-files";
import { buildAttackIndex, readAnimationNames } from "./NpcAttackAnims";
import { createWorldLoaders } from "./WorldLoaders";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ids = process.argv.slice(2).map(Number);
if (ids.length === 0 || ids.some((id) => !Number.isInteger(id))) {
    console.error("usage: npx tsx tools/world-export/list-npc-seqs.ts <npcId> [<npcId>...]");
    process.exit(1);
}

const loaders = createWorldLoaders(readCacheFiles(path.join(ROOT, "cache")));
const names = readAnimationNames(path.join(ROOT, "tools", "world-export", "data", "animation-names-runelite.json"));
const index = buildAttackIndex(names, (seqId) => loaders.npcModelLoader.getFrameBase(seqId)?.id);
const byBase = new Map(index.byBase);

const frames = (seqId: number): string => {
    try {
        return String(loaders.seqTypeLoader.load(seqId).frameIds?.length ?? 0);
    } catch {
        return "?";
    }
};

for (const id of ids) {
    const npc = loaders.npcTypeLoader.load(id);
    const idle = npc.idleSeqId;
    const base = idle !== -1 ? loaders.npcModelLoader.getFrameBase(idle)?.id : undefined;
    console.log(`\n${npc.name} (${id}): idle ${idle} ${names.get(idle) ?? "(unnamed)"}, walk ${npc.walkSeqId}, frame base ${base ?? "none"}`);
    if (base === undefined) {
        continue;
    }
    for (const seqId of (byBase.get(base) ?? []).sort((a, b) => a - b)) {
        console.log(`  ${String(seqId).padStart(6)} ${names.get(seqId)} frames=${frames(seqId)}`);
    }
}
