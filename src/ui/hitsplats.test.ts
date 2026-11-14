import { describe, expect, it } from "vitest";

import { SLOT_OFFSETS, digitPositions, pickSlot, splatKind } from "./Hitsplats";

const atlas = {
    cell: 25,
    glyphs: {
        width: 11,
        height: 12,
        whiteY: 25,
        blackY: 37,
        // Every digit 5 pixels of ink starting at column 1, advance 6.
        digits: Array.from({ length: 10 }, (_, d) => ({ x: d * 11, left: 1, advance: 6 })),
    },
};

describe("splatKind", () => {
    it("is the blue block splat for a miss or a 0, the max splat for a max hit, else red", () => {
        expect(splatKind({ missed: true, amount: 0 })).toBe("block");
        expect(splatKind({ missed: false, amount: 0 })).toBe("block");
        expect(splatKind({ missed: false, amount: 3 })).toBe("damage");
        expect(splatKind({ missed: false, amount: 25, maxHit: true })).toBe("max");
    });
});

describe("pickSlot", () => {
    it("takes the first free slot, else replaces the one that ends soonest", () => {
        expect(pickSlot([-Infinity, -Infinity, -Infinity, -Infinity], 0)).toBe(0);
        expect(pickSlot([2, -Infinity, -Infinity, -Infinity], 1)).toBe(1);
        expect(pickSlot([2, 3, 1.5, 4], 1)).toBe(2);
        expect(pickSlot([0.5, 3, 2, 4], 1)).toBe(0);
    });

    it("uses the OSRS layout: middle, above, upper left, upper right", () => {
        expect(SLOT_OFFSETS).toEqual([[0, 0], [0, -20], [-15, -10], [15, -10]]);
    });
});

describe("digitPositions", () => {
    it("centres the number in the splat", () => {
        // One digit: 5 pixels of ink in 25: starts at column 10, so the glyph cell at 9.
        expect(digitPositions(7, atlas)).toEqual([{ digit: 7, x: 9 }]);
        // Two digits: 11 pixels of ink: starts at 7.
        expect(digitPositions(12, atlas)).toEqual([
            { digit: 1, x: 6 },
            { digit: 2, x: 12 },
        ]);
        expect(digitPositions(0, atlas)).toEqual([{ digit: 0, x: 9 }]);
    });
});
