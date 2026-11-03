import { gzipSync } from "fflate";
import fs from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";

import { encodeRegion, regionFileName } from "../../src/world/WorldFormat";
import { RegionBuilder, RegionStats } from "./RegionBuilder";
import { CacheFiles, createWorldLoaders } from "./WorldLoaders";

export type ExportWorkerData = {
    info: CacheFiles["info"];
    dat2: SharedArrayBuffer;
    indexFiles: [number, ArrayBuffer][];
    xteas: [number, number[]][];
    regionDir: string;
};

export type ExportTask = { mapX: number; mapY: number };

export type ExportResult =
    | { type: "ready" }
    | { type: "region"; mapX: number; mapY: number; bytes: number; stats: RegionStats }
    | { type: "empty"; mapX: number; mapY: number }
    | { type: "error"; mapX: number; mapY: number; message: string };

const data = workerData as ExportWorkerData;
const port = parentPort!;
const post = (result: ExportResult) => port.postMessage(result);

const builder = new RegionBuilder(
    createWorldLoaders({
        info: data.info,
        dat2: data.dat2,
        indexFiles: new Map(data.indexFiles),
        xteas: new Map(data.xteas),
    }),
);

port.on("message", ({ mapX, mapY }: ExportTask) => {
    try {
        const built = builder.build(mapX, mapY);
        // Model caches would otherwise grow across the whole export.
        builder.clearCaches();
        if (!built || built.stats.triangles === 0) {
            post({ type: "empty", mapX, mapY });
            return;
        }
        const file = gzipSync(encodeRegion(built.region), { level: 6 });
        fs.writeFileSync(path.join(data.regionDir, regionFileName(mapX, mapY)), file);
        post({ type: "region", mapX, mapY, bytes: file.length, stats: built.stats });
    } catch (e) {
        post({
            type: "error",
            mapX,
            mapY,
            message: e instanceof Error ? (e.stack ?? e.message) : String(e),
        });
    }
});

post({ type: "ready" });
