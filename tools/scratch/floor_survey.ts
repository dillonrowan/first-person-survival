import { readFileSync, writeFileSync } from "node:fs";
import { readCacheFiles } from "../world-export/cache-files";
import { createWorldLoaders } from "../world-export/WorldLoaders";
import { LocLoadType } from "../world-export/rs/scene/SceneBuilder";
const L = createWorldLoaders(readCacheFiles("cache"));
const world = JSON.parse(readFileSync("public/world/world.json", "utf8"));
const regions: [number, number][] = world.regions;
const step = Number(process.argv[2] ?? 1);
const over = new Map<number, { n: number; at: string; lvls: Set<number> }>();
const under = new Map<number, { n: number; at: string; lvls: Set<number> }>();
const bump = (m: typeof over, id: number, at: string, lvl: number) => { const e = m.get(id) ?? { n: 0, at, lvls: new Set() }; e.n++; e.lvls.add(lvl); m.set(id, e); };
const t0 = Date.now();
for (let r = 0; r < regions.length; r += step) {
    const [mx, my] = regions[r];
    const scene = L.sceneBuilder.buildScene(mx * 64, my * 64, 64, 64, false, LocLoadType.NO_MODELS);
    for (let lvl = 0; lvl < 4; lvl++) for (let x = 0; x < 64; x++) for (let y = 0; y < 64; y++) {
        const o = scene.tileOverlays[lvl][x][y], u = scene.tileUnderlays[lvl][x][y];
        const at = `${mx * 64 + x},${my * 64 + y},${lvl}`;
        if (o > 0) bump(over, o - 1, at, lvl); else if (u > 0) bump(under, u - 1, at, lvl);
    }
}
const hex = (v: number) => "#" + (v >>> 0).toString(16).padStart(6, "0");
const out: string[] = [`regions ${Math.ceil(regions.length / step)} in ${((Date.now() - t0) / 1000).toFixed(0)}s`];
out.push("== OVERLAYS (id n tex rgb secondary hideUnderlay at levels)");
for (const [id, e] of [...over].sort((a, b) => b[1].n - a[1].n).slice(0, 70)) {
    const t: any = L.sceneBuilder.overlayTypeLoader.load(id);
    out.push(`${id} ${e.n} tex=${t.textureId} rgb=${hex(t.primaryRgb)} sec=${t.secondaryRgb >= 0 ? hex(t.secondaryRgb) : "-"} hide=${t.hideUnderlay} at ${e.at} lv ${[...e.lvls].join("")}`);
}
out.push("== UNDERLAYS (id n rgb at)");
for (const [id, e] of [...under].sort((a, b) => b[1].n - a[1].n).slice(0, 70)) {
    const t: any = L.sceneBuilder.underlayTypeLoader.load(id);
    out.push(`${id} ${e.n} rgb=${hex(t.rgbColor ?? t.rgb ?? 0)} h${t.hue} s${t.saturation} l${t.lightness} at ${e.at} lv ${[...e.lvls].join("")}`);
}
writeFileSync("tools/scratch/floors.txt", out.join("\n"));
console.log(out[0]);
