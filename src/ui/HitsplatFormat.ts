// The OSRS hitsplat atlas (public/ui/hitsplats.png, hitsplats.json), written by
// tools/world-export/export-hitsplats.ts from the cache.

export type HitsplatKind = "damage" | "block" | "poison" | "max" | "venom";

export type HitsplatAtlas = {
    image: string;
    /** Every splat is a cell x cell square (25 in OSRS). */
    cell: number;
    /** Top-left of each splat in the atlas, and how far its number sits below the centre. */
    splats: Record<HitsplatKind, { x: number; y: number; textOffsetY: number }>;
    /** The digits 0-9 of the hitsplat font, each a width x height cell: white, and black for the shadow. */
    glyphs: {
        width: number;
        height: number;
        whiteY: number;
        blackY: number;
        /** Per digit: its cell x, the column its ink starts at, and its advance. */
        digits: { x: number; left: number; advance: number }[];
    };
};
