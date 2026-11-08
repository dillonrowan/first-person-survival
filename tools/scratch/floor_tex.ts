import { readCacheFiles } from "../world-export/cache-files";
import { createWorldLoaders } from "../world-export/WorldLoaders";
const L = createWorldLoaders(readCacheFiles("cache"));
const ids = new Set<number>();
for (let id = 0; id < 1200; id++) { try { const t: any = L.sceneBuilder.overlayTypeLoader.load(id); if (t.textureId >= 0) ids.add(t.textureId); } catch {} }
for (const id of [...ids].sort((a, b) => a - b)) {
    let r = 0, g = 0, b = 0, n = 0;
    try { const px = L.textureLoader.getPixelsArgb(id, 128, true, 0.7); for (const p of px) { r += (p >> 16) & 255; g += (p >> 8) & 255; b += p & 255; n++; } } catch (e) { console.log(id, "fail", String(e).slice(0, 80)); continue; }
    const m: any = L.textureLoader.getMaterial(id);
    console.log(id, `avg #${[r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("")}`, `anim ${m.animU},${m.animV}`, `alpha ${m.alphaCutOff}`);
}
