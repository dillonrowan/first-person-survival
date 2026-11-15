import { describe, expect, it } from "vitest";

import { rollDrops } from "./Drops";

const scripted = (...values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
};
const table = [
    { item: 526, min: 1, max: 1, chance: 1, rolls: 1 },
    { item: 995, min: 5, max: 10, chance: 0.5, rolls: 1 },
    { item: 1333, min: 1, max: 1, chance: 0.01, rolls: 1 },
];

describe("rollDrops", () => {
    it("always drops the always entries", () => {
        expect(rollDrops(table, scripted(0.99))).toEqual([{ id: 526, qty: 1 }]);
    });

    it("picks an entry by the cumulative chance and rolls its quantity", () => {
        // First roll 0.2 picks coins (cumulative 0.5), then the quantity roll 0.99 gives the top, 10.
        expect(rollDrops(table, scripted(0.2, 0.99))).toEqual([
            { id: 526, qty: 1 },
            { id: 995, qty: 10 },
        ]);
        // 0.505 falls in the second entry (0.5 to 0.51).
        expect(rollDrops(table, scripted(0.505))).toEqual([
            { id: 526, qty: 1 },
            { id: 1333, qty: 1 },
        ]);
    });

    it("rolls the table as many times as it says", () => {
        const twice = table.map((d) => (d.chance < 1 ? { ...d, rolls: 2 } : d));
        expect(rollDrops(twice, scripted(0.2, 0, 0.2, 0)).filter((s) => s.id === 995)).toHaveLength(2);
    });
});
