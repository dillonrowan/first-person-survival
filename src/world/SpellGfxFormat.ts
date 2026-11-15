// File format of the exported spell graphics (OSRS spot animations). Written by
// tools/world-export/export-spells.ts, read by the game.

import { NpcModelData, decodeNpcModel, encodeNpcModel } from "./NpcFormat";

/** Spot animation ids of one spell: on the caster, in flight, and on the target. */
export type SpellGraphics = { cast: number; projectile: number; impact: number };

/**
 * The standard combat spells' spot animations, from the cache (config archive 13): each element's
 * spells share a model per tier and differ by recolour. Keyed by the ids in src/combat/Spells.ts.
 */
export const SPELL_GRAPHICS: Record<string, SpellGraphics> = {
    "wind-strike": { cast: 90, projectile: 91, impact: 92 },
    "water-strike": { cast: 93, projectile: 94, impact: 95 },
    "earth-strike": { cast: 96, projectile: 97, impact: 98 },
    "fire-strike": { cast: 99, projectile: 100, impact: 101 },
    "wind-bolt": { cast: 117, projectile: 118, impact: 119 },
    "water-bolt": { cast: 120, projectile: 121, impact: 122 },
    "earth-bolt": { cast: 123, projectile: 124, impact: 125 },
    "fire-bolt": { cast: 126, projectile: 127, impact: 128 },
    "wind-blast": { cast: 132, projectile: 133, impact: 134 },
    "water-blast": { cast: 135, projectile: 136, impact: 137 },
    "earth-blast": { cast: 138, projectile: 139, impact: 140 },
    "fire-blast": { cast: 129, projectile: 130, impact: 131 },
    "wind-wave": { cast: 158, projectile: 159, impact: 160 },
    "water-wave": { cast: 161, projectile: 162, impact: 163 },
    "earth-wave": { cast: 164, projectile: 165, impact: 166 },
    "fire-wave": { cast: 155, projectile: 156, impact: 157 },
    "wind-surge": { cast: 1455, projectile: 1456, impact: 1457 },
    "water-surge": { cast: 1458, projectile: 1459, impact: 1460 },
    "earth-surge": { cast: 1461, projectile: 1462, impact: 1463 },
    "fire-surge": { cast: 1464, projectile: 1465, impact: 1466 },
    // Curses, cast by NPCs such as dark wizards.
    confuse: { cast: 102, projectile: 103, impact: 104 },
    weaken: { cast: 105, projectile: 106, impact: 107 },
    curse: { cast: 108, projectile: 109, impact: 110 },
};

/** Height above the caster's feet (RS units) where an NPC's cast graphic plays. [design] */
export const CAST_HEIGHT = 92;

/** The blue cloud shown on the target when a spell misses (splashes). */
export const SPLASH_GRAPHIC = 85;

/**
 * Height above the target's feet (RS units, 128 per tile) where impact and splash graphics play.
 * The server sends it with the graphic, so it is not in the cache: 100 is the usual "high" graphic
 * height. [design]
 */
export const IMPACT_HEIGHT = 100;

/** One spot animation baked frame by frame: every frame is a whole lit mesh (alpha fades included). */
export type SpellGfx = {
    /** Duration of each frame in 20 ms client cycles. */
    frameLengths: number[];
    frames: NpcModelData[];
};

export type SpellGfxManifest = {
    format: 1;
    source: string;
    /** File of each spot animation id, relative to the manifest. */
    files: Record<string, string>;
};

export const SPELL_GFX_FORMAT_VERSION = 1;
const MAGIC = 0x47535046; // "FPSG"

// Little-endian: u32 magic, u32 version, u32 frameCount, u32[frameCount] frameLengths,
// then per frame u32 byteLength and an NPC model file (no clips), padded to 4 bytes.
export function encodeSpellGfx(gfx: SpellGfx): Uint8Array {
    const blobs = gfx.frames.map((f) => encodeNpcModel(f));
    const size = 12 + gfx.frameLengths.length * 4 + blobs.reduce((n, b) => n + 4 + ((b.length + 3) & ~3), 0);
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    view.setUint32(0, MAGIC, true);
    view.setUint32(4, SPELL_GFX_FORMAT_VERSION, true);
    view.setUint32(8, gfx.frames.length, true);
    let at = 12;
    for (const length of gfx.frameLengths) {
        view.setUint32(at, length, true);
        at += 4;
    }
    for (const blob of blobs) {
        view.setUint32(at, blob.length, true);
        out.set(blob, at + 4);
        at += 4 + ((blob.length + 3) & ~3);
    }
    return out;
}

export function decodeSpellGfx(buffer: ArrayBuffer): SpellGfx {
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== MAGIC) {
        throw new Error("Not a spell graphic file");
    }
    const version = view.getUint32(4, true);
    if (version !== SPELL_GFX_FORMAT_VERSION) {
        throw new Error(`Unsupported spell graphic format ${version}, re-run npm run export-spells`);
    }
    const count = view.getUint32(8, true);
    let at = 12;
    const frameLengths: number[] = [];
    for (let i = 0; i < count; i++) {
        frameLengths.push(view.getUint32(at, true));
        at += 4;
    }
    const frames: NpcModelData[] = [];
    for (let i = 0; i < count; i++) {
        const length = view.getUint32(at, true);
        // Each frame decodes from its own buffer: the NPC decoder reads from offset 0.
        frames.push(decodeNpcModel(buffer.slice(at + 4, at + 4 + length)));
        at += 4 + ((length + 3) & ~3);
    }
    return { frameLengths, frames };
}
