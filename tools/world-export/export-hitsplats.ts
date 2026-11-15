// Exports the OSRS hitsplat sprites and the digits of their font from the cache into one atlas
// (public/ui/hitsplats.png and hitsplats.json). Reads only the sprite index; takes seconds.
//
//   npm run export-hitsplats
//
// Hitsplat definitions are config archive 32. The ones the game shows: damage on "me" (16, its
// sprite 1359, the red splat), block on "me" (12, 1358, the blue zero), poison (2, which shows 68 or
// 70 by a setting: 68's sprite 1360 is the poison splat the OSRS wiki shows), max hit (43, which
// shows 48 by default, 3571) and venom (5, 1632). Each matches the wiki's image pixel for pixel in
// shape (oldschool.runescape.wiki/w/Hitsplat). They set no font, so the client draws their numbers
// with p11_full, white with a black shadow.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { HitsplatAtlas, HitsplatKind } from "../../src/ui/HitsplatFormat";
import { readCacheFiles } from "./cache-files";
import { encodePng } from "./png";
import { IndexedSprite } from "./rs/sprite/IndexedSprite";
import { SpriteLoader } from "./rs/sprite/SpriteLoader";
import { createWorldLoaders } from "./WorldLoaders";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "public", "ui");

/** Sprite id and the definition text offset of each hitsplat the game uses. */
const SPLATS: Record<HitsplatKind, { sprite: number; textOffsetY: number }> = {
    damage: { sprite: 1359, textOffsetY: 1 },
    block: { sprite: 1358, textOffsetY: 1 },
    poison: { sprite: 1360, textOffsetY: 1 },
    max: { sprite: 3571, textOffsetY: 1 },
    venom: { sprite: 1632, textOffsetY: 1 },
};
const FONT = "p11_full";
const CELL = 25;

const cache = readCacheFiles(path.join(ROOT, "cache"));
const loaders = createWorldLoaders(cache);

/** A sprite as RGBA in its full cell (offsets applied); `tint` replaces every colour. */
function rgbaOf(sprite: IndexedSprite, tint?: number): { width: number; height: number; rgba: Uint8Array } {
    const { width, height } = sprite;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < sprite.subHeight; y++) {
        for (let x = 0; x < sprite.subWidth; x++) {
            const index = sprite.pixels[x + y * sprite.subWidth] & 0xff;
            if (index === 0) continue;
            const rgb = tint ?? sprite.palette[index];
            const at = ((y + sprite.yOffset) * width + x + sprite.xOffset) * 4;
            rgba.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255], at);
        }
    }
    return { width, height, rgba };
}

const splatSprites = Object.entries(SPLATS).map(([kind, def]) => {
    const sprite = SpriteLoader.loadIntoIndexedSprite(loaders.spriteIndex, def.sprite);
    if (!sprite) throw new Error(`Hitsplat sprite ${def.sprite} (${kind}) not in the cache`);
    return { kind: kind as HitsplatKind, def, image: rgbaOf(sprite) };
});
const fontId = loaders.spriteIndex.getArchiveId(FONT);
const glyphs = fontId >= 0 ? SpriteLoader.loadIntoIndexedSprites(loaders.spriteIndex, fontId) : undefined;
if (!glyphs) throw new Error(`Font ${FONT} not in the cache`);
const digits = Array.from({ length: 10 }, (_, d) => glyphs[48 + d]);
const glyphWidth = digits[0].width;
const glyphHeight = digits[0].height;

// Row 0: the splats; row 1: white digits; row 2: black digits (the shadow).
const width = Math.max(CELL * splatSprites.length, glyphWidth * 10);
const height = CELL + glyphHeight * 2;
const atlas = new Uint8Array(width * height * 4);
const blit = (image: { width: number; height: number; rgba: Uint8Array }, ox: number, oy: number) => {
    for (let y = 0; y < image.height; y++) {
        atlas.set(image.rgba.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((oy + y) * width + ox) * 4);
    }
};

const manifest: HitsplatAtlas = {
    image: "hitsplats.png",
    cell: CELL,
    splats: {} as HitsplatAtlas["splats"],
    glyphs: { width: glyphWidth, height: glyphHeight, whiteY: CELL, blackY: CELL + glyphHeight, digits: [] },
};
splatSprites.forEach(({ kind, def, image }, i) => {
    blit(image, i * CELL, 0);
    manifest.splats[kind] = { x: i * CELL, y: 0, textOffsetY: def.textOffsetY };
});
digits.forEach((glyph, d) => {
    blit(rgbaOf(glyph, 0xffffff), d * glyphWidth, CELL);
    blit(rgbaOf(glyph, 0x000000), d * glyphWidth, CELL + glyphHeight);
    // Advance: the glyph ink plus one pixel of space.
    manifest.glyphs.digits.push({ x: d * glyphWidth, left: glyph.xOffset, advance: glyph.subWidth + 1 });
});

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "hitsplats.png"), encodePng(width, height, atlas));
fs.writeFileSync(path.join(OUT_DIR, "hitsplats.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log(`Exported ${splatSprites.length} hitsplats and the digits of ${FONT} to public/ui/hitsplats.png`);
