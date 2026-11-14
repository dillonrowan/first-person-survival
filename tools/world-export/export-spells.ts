// Exports the spot animations of the standard combat spells (cast, projectile, impact) and the
// splash from the cache to public/spells/ (outside public/world/, so the world export never
// deletes it). Reads only configs, models and animation frames; takes seconds.
//
//   npm run export-spells
//
// Each frame is baked as its own lit mesh in the NPC model format, so the game draws it with the
// world shader and texture atlas (run export-world first for the atlas, as for items).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { gzipSync } from "fflate";

import { npcGraphicIds } from "../../src/npc/NpcSpells";
import { SPELL_GRAPHICS, SPLASH_GRAPHIC, SpellGfxManifest, encodeSpellGfx } from "../../src/world/SpellGfxFormat";
import { readCacheFiles } from "./cache-files";
import { FaceColors } from "./FaceColors";
import { ConfigType } from "./rs/cache/ConfigType";
import { ArchiveSpotAnimTypeLoader } from "./rs/config/spotanimtype/SpotAnimType";
import { bakeSpotAnim } from "./SpellGfx";
import { createWorldLoaders } from "./WorldLoaders";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "public", "spells");

const cache = readCacheFiles(path.join(ROOT, "cache"));
const loaders = createWorldLoaders(cache);
const spots = new ArchiveSpotAnimTypeLoader(loaders.info, loaders.configIndex.getArchive(ConfigType.DAT2.spotAnims));
const faceColors = new FaceColors(loaders.textureLoader);

// The splash, the spells, and the NPC attack graphics (arrows, rocks, spit, boss attacks).
const ids = new Set<number>([SPLASH_GRAPHIC, ...npcGraphicIds()]);
for (const g of Object.values(SPELL_GRAPHICS)) {
    ids.add(g.cast).add(g.projectile).add(g.impact);
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
const manifest: SpellGfxManifest = { format: 1, source: `osrs-${loaders.info.revision}`, files: {} };
let bytes = 0;
for (const id of [...ids].sort((a, b) => a - b)) {
    const gfx = bakeSpotAnim(spots.load(id), { ...loaders, faceColors });
    if (!gfx) {
        console.warn(`Spot animation ${id} has no model; skipped`);
        continue;
    }
    const file = `${id}.bin`;
    // A fixed timestamp, so an unchanged graphic exports to the same bytes.
    const data = gzipSync(encodeSpellGfx(gfx), { level: 9, mtime: 0 });
    fs.writeFileSync(path.join(OUT_DIR, file), data);
    manifest.files[id] = file;
    bytes += data.length;
}
fs.writeFileSync(path.join(OUT_DIR, "spells.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log(`Exported ${Object.keys(manifest.files).length} spell graphics (${(bytes / 1024).toFixed(0)} KB) to public/spells/`);
