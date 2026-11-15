import { describe, expect, it } from "vitest";

import { parseCoordinates, parseFoodTable, parseRarity, rowToDrop } from "./fetch-wiki-items";

describe("parseRarity", () => {
    it("reads always, fractions and named rarities", () => {
        expect(parseRarity("Always")).toBe(1);
        expect(parseRarity("3/128")).toBeCloseTo(3 / 128);
        expect(parseRarity("1,000/5,000")).toBeCloseTo(0.2);
        expect(parseRarity("Rare")).toBeCloseTo(1 / 256);
        expect(parseRarity("Varies")).toBeUndefined();
    });
});

describe("parseCoordinates", () => {
    it("reads a position with an optional quantity", () => {
        expect(parseCoordinates("3150,3247")).toEqual({ x: 3150, y: 3247, qty: 1 });
        expect(parseCoordinates("3030,3637,qty:5")).toEqual({ x: 3030, y: 3637, qty: 5 });
        expect(parseCoordinates("nope")).toBeUndefined();
    });
});

describe("parseFoodTable", () => {
    it("reads the heal of each food and skips text", () => {
        const text = [
            "|{{plinkt|Shrimps}}",
            "|3",
            "|{{SCP|Cooking|1}}",
            "|-",
            "|{{plinkt|Tea flask}}",
            "| data-sort-value=15 |3 × 5",
            "|",
            "|-",
            "|{{plinkt|Poison chalice}}",
            "| data-sort-value=-1 |Random",
        ].join("\n");
        expect(parseFoodTable(text)).toEqual({ Shrimps: 3, "Tea flask": 3 });
    });
});

describe("rowToDrop", () => {
    const json = (over: object) =>
        JSON.stringify({ Rarity: "3/128", "Quantity Low": 1, "Quantity High": 1, Rolls: 1, "Drop level": "2", ...over });

    it("builds a drop from a dropsline row", () => {
        expect(rowToDrop({ page_name: "Goblin", item_name: "Bronze sq shield", drop_json: json({}) })).toEqual({
            item: "Bronze sq shield",
            qtyLow: 1,
            qtyHigh: 1,
            chance: 3 / 128,
            rolls: 1,
            level: "2",
        });
    });

    it("skips rare drop table rows, unknown rarities and Nothing", () => {
        expect(rowToDrop({ item_name: "X", rare_drop_table: true, drop_json: json({}) })).toBeUndefined();
        expect(rowToDrop({ item_name: "X", drop_json: json({ Rarity: "Varies" }) })).toBeUndefined();
        expect(rowToDrop({ item_name: "Nothing", drop_json: json({}) })).toBeUndefined();
    });
});
