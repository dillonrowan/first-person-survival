import { describe, expect, it } from "vitest";

import { Spellbook } from "../combat/Spells";
import { costText, spellRows } from "./SpellbookPanel";

describe("spellRows", () => {
    it("unlocks only Wind Strike at Magic 1", () => {
        const rows = spellRows(new Spellbook(), 1);
        expect(rows.filter((r) => !r.locked).map((r) => r.id)).toEqual(["wind-strike"]);
        expect(rows.find((r) => r.selected)?.id).toBe("wind-strike");
    });

    it("unlocks eight spells at Magic 35 and marks the equipped one", () => {
        const book = new Spellbook();
        book.equip("fire-bolt", 35);
        const rows = spellRows(book, 35);
        expect(rows.filter((r) => !r.locked)).toHaveLength(8);
        expect(rows.find((r) => r.selected)?.id).toBe("fire-bolt");
    });

    it("lists the runes of a spell", () => {
        const fireBolt = spellRows(new Spellbook(), 99).find((r) => r.id === "fire-bolt")!;
        expect(fireBolt.cost).toBe("3 Air · 4 Fire · 1 Chaos");
        expect(costText({ runes: [{ item: 556, count: 1 }, { item: 558, count: 1 }] } as never)).toBe("1 Air · 1 Mind");
    });
});
