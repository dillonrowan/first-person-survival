import { describe, expect, it } from "vitest";

import { gfxFrameAt } from "../combat/SpellGfxView";
import type { NpcModelData } from "./NpcFormat";
import { SPELL_GRAPHICS, decodeSpellGfx, encodeSpellGfx } from "./SpellGfxFormat";
import { SPELLS } from "../combat/Spells";

function frame(x: number, alpha: number): NpcModelData {
    const mesh = (n: number) => ({
        positions: Int16Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? x : i)),
        colors: Uint8Array.from({ length: n * 4 }, (_, i) => (i % 4 === 3 ? alpha : 200)),
        uvs: new Int16Array(n * 2),
        sources: Uint16Array.from({ length: n }, (_, i) => i),
        indices: n ? Uint32Array.from([0, 1, 2]) : new Uint32Array(0),
    });
    return { vertexCount: 3, bounds: Float32Array.from([0, 0, 0, 1]), opaque: mesh(0), transparent: mesh(3) };
}

describe("spell graphic files", () => {
    it("round-trip every frame with its length", () => {
        const bytes = encodeSpellGfx({ frameLengths: [2, 5, 1], frames: [frame(10, 255), frame(-7, 128), frame(3, 0)] });
        const gfx = decodeSpellGfx(bytes.buffer as ArrayBuffer);
        expect(gfx.frameLengths).toEqual([2, 5, 1]);
        expect(gfx.frames).toHaveLength(3);
        expect(gfx.frames[1].transparent.positions[0]).toBe(-7);
        expect(gfx.frames[1].transparent.colors[3]).toBe(128);
        expect(Array.from(gfx.frames[2].transparent.indices)).toEqual([0, 1, 2]);
        expect(gfx.frames[0].opaque.indices.length).toBe(0);
    });

    it("name graphics for every combat spell", () => {
        for (const spell of SPELLS) {
            expect(SPELL_GRAPHICS[spell.id], spell.id).toBeDefined();
        }
    });
});

describe("gfxFrameAt", () => {
    // Frames of 2, 2 and 4 client cycles (20 ms each): 0.16 s in all.
    const lengths = [2, 2, 4];
    it("holds each frame for its cycles", () => {
        expect(gfxFrameAt(lengths, 0, false)).toBe(0);
        expect(gfxFrameAt(lengths, 0.039, false)).toBe(0);
        expect(gfxFrameAt(lengths, 0.041, false)).toBe(1);
        expect(gfxFrameAt(lengths, 0.081, false)).toBe(2);
    });
    it("holds the last frame when played once, and wraps when looping", () => {
        expect(gfxFrameAt(lengths, 1, false)).toBe(2);
        expect(gfxFrameAt(lengths, 0.161, true)).toBe(0);
    });
});
