import { readCacheFiles } from "../world-export/cache-files";
import { createWorldLoaders } from "../world-export/WorldLoaders";
import { readFileSync } from "node:fs";
const L = createWorldLoaders(readCacheFiles("cache"));
const names = JSON.parse(readFileSync("tools/world-export/data/animation-names-runelite.json", "utf8"));
const ids = process.argv.slice(2).map(Number);
for (const id of ids) {
    const s = L.seqTypeLoader.load(id);
    const snd = s.frameSounds ? [...s.frameSounds].map(([f, e]) => `f${f}:${e.map((x: any) => x.id).join("/")}`).join(" ") : "none";
    console.log(id, names[id], "frames", s.frameIds?.length, "sounds:", snd);
}
