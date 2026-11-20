import path from "node:path";
import { readCacheFiles } from "../world-export/cache-files";
import { createWorldLoaders } from "../world-export/WorldLoaders";
const L = createWorldLoaders(readCacheFiles(path.resolve("cache")));
for (const id of [26185, 26186, 43475, 49927]) {
    try {
        const t: any = L.locTypeLoader.load(id);
        console.log(id, t.name, JSON.stringify(t.models), JSON.stringify(t.types), "seq", t.seqId, "ambient", t.ambient, t.contrast);
        if (t.seqId >= 0) { const s: any = L.seqTypeLoader.load(t.seqId); console.log("  frames", s.frameIds?.length, JSON.stringify(s.frameLengths), "skeletal", !!s.skeletalId && s.skeletalId); }
    } catch (e) { console.log(id, String(e)); }
}
