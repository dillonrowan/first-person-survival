import { describe, expect, it } from "vitest";

import { groundItemSpawns } from "./GroundItemExport";

const ids: Record<string, number> = { "Air rune": 556, Goblin: 3 };
const line = (page: string, x: number, y: number, qty = 1) => ({ page, x, y, plane: 0, qty });

describe("groundItemSpawns", () => {
    it("keeps item pages inside exported regions, once", () => {
        const out = groundItemSpawns(
            [line("Air rune", 3150, 3247), line("Air rune", 3150, 3247), line("Air rune", 100, 100), line("Nothing", 3150, 3247), line("Goblin", 3150, 3247)],
            (name) => ids[name],
            new Set(["Goblin"]),
            (mapX, mapY) => mapX === 49 && mapY === 50,
        );
        expect(out).toEqual([{ item: 556, qty: 1, x: 3150, y: 3247, plane: 0 }]);
    });
});
