import { gzipSync } from "fflate";
import fs from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";

import { encodeNpcModel } from "../../src/world/NpcFormat";
import { encodeRegion, regionFileName } from "../../src/world/WorldFormat";
import { FaceColors } from "./FaceColors";
import { AttackIndex, NpcAttackPicker } from "./NpcAttackAnims";
import { NpcModelBuilder } from "./NpcModelBuilder";
import { NpcAppearanceTask } from "./NpcSpawns";
import { RegionBuilder, RegionStats } from "./RegionBuilder";
import { CacheFiles, createWorldLoaders } from "./WorldLoaders";

export type ExportWorkerData = {
    info: CacheFiles["info"];
    dat2: SharedArrayBuffer;
    indexFiles: [number, ArrayBuffer][];
    xteas: [number, number[]][];
    regionDir: string;
    /** Directory the NPC model files are written to (public/world/npcs). */
    npcDir: string;
    /** Named sequences by frame base, for choosing NPC attacks (absent: no attacks baked). */
    attackIndex?: AttackIndex;
};

export type ExportTask =
    | { kind: "region"; mapX: number; mapY: number }
    | { kind: "npc"; index: number; npc: NpcAppearanceTask };

export type ExportResult =
    | { type: "ready" }
    | { type: "region"; mapX: number; mapY: number; bytes: number; stats: RegionStats }
    | { type: "empty"; mapX: number; mapY: number }
    | {
          type: "npc";
          index: number;
          bytes: number;
          hasWalk: boolean;
          attacks: number;
          /** Non-melee attacks baked, for the export log. fallback: reuses the melee animation. */
          styles: { style: string; seqId: number; fallback: boolean }[];
      }
    | { type: "npc-empty"; index: number }
    | { type: "error"; label: string; message: string };

const data = workerData as ExportWorkerData;
const port = parentPort!;
const post = (result: ExportResult) => port.postMessage(result);

const loaders = createWorldLoaders({
    info: data.info,
    dat2: data.dat2,
    indexFiles: new Map(data.indexFiles),
    xteas: new Map(data.xteas),
});
const faceColors = new FaceColors(loaders.textureLoader);
const regionBuilder = new RegionBuilder(loaders, faceColors);
const npcBuilder = new NpcModelBuilder(
    loaders.npcTypeLoader,
    loaders.npcModelLoader,
    loaders.seqTypeLoader,
    faceColors,
    loaders.textureLoader,
    data.attackIndex && new NpcAttackPicker(data.attackIndex),
);

function exportRegion(mapX: number, mapY: number): ExportResult {
    const built = regionBuilder.build(mapX, mapY);
    // Model caches would otherwise grow across the whole export.
    regionBuilder.clearCaches();
    if (!built || built.stats.triangles === 0) {
        return { type: "empty", mapX, mapY };
    }
    const file = gzipSync(encodeRegion(built.region), { level: 6 });
    fs.writeFileSync(path.join(data.regionDir, regionFileName(mapX, mapY)), file);
    return { type: "region", mapX, mapY, bytes: file.length, stats: built.stats };
}

function exportNpc(index: number, npc: NpcAppearanceTask): ExportResult {
    const model = npcBuilder.build(npc);
    loaders.npcModelLoader.clearCache();
    loaders.seqFrameLoader.clearCache();
    if (!model) {
        return { type: "npc-empty", index };
    }
    const file = gzipSync(encodeNpcModel(model), { level: 6 });
    fs.writeFileSync(path.join(data.npcDir, path.basename(npc.file)), file);
    const attacks = model.attacks ?? [];
    const styles = npc.attackStyles
        ? attacks
              .filter((a) => a.style !== "melee")
              .map((a) => ({
                  style: a.style,
                  seqId: a.seqId,
                  fallback: attacks.some((m) => m.style === "melee" && m.seqId === a.seqId),
              }))
        : [];
    return { type: "npc", index, bytes: file.length, hasWalk: model.walk !== undefined, attacks: attacks.length, styles };
}

port.on("message", (task: ExportTask) => {
    try {
        post(
            task.kind === "region"
                ? exportRegion(task.mapX, task.mapY)
                : exportNpc(task.index, task.npc),
        );
    } catch (e) {
        post({
            type: "error",
            label: task.kind === "region" ? `region ${task.mapX},${task.mapY}` : `NPC ${task.npc.file}`,
            message: e instanceof Error ? (e.stack ?? e.message) : String(e),
        });
    }
});

post({ type: "ready" });
