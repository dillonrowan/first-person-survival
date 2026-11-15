import { describe, expect, it } from "vitest";

import { dropsFor } from "./NpcDrops";
import type { WikiAttackRow } from "./fetch-wiki-attacks";
import type { WikiDrop } from "./fetch-wiki-items";

const drop = (item: string, level?: string): WikiDrop => ({ item, qtyLow: 1, qtyHigh: 2, chance: 0.5, rolls: 1, ...(level ? { level } : {}) });
const ids: Record<string, number> = { Bones: 526, Coins: 995, "Rune scimitar": 1333 };
const idOf = (name: string) => ids[name];
const row = (level?: number): WikiAttackRow => ({ page: "Goblin", styles: [], ...(level ? { level } : {}) });

describe("dropsFor", () => {
    it("keeps the entries of the NPC level", () => {
        const drops = { Goblin: [drop("Bones", "2"), drop("Coins", "5")] };
        expect(dropsFor(row(2), drops, idOf)).toEqual([{ item: 526, min: 1, max: 2, chance: 0.5, rolls: 1 }]);
    });

    it("keeps entries without a level and falls back to all entries", () => {
        const drops = { Goblin: [drop("Bones"), drop("Coins", "5")] };
        expect(dropsFor(row(2), drops, idOf)?.map((d) => d.item)).toEqual([526]);
        expect(dropsFor(row(9), { Goblin: [drop("Coins", "5")] }, idOf)?.map((d) => d.item)).toEqual([995]);
    });

    it("skips items the cache does not know and pages without drops", () => {
        expect(dropsFor(row(), { Goblin: [drop("Unknown")] }, idOf)).toBeUndefined();
        expect(dropsFor(row(), {}, idOf)).toBeUndefined();
        expect(dropsFor(undefined, { Goblin: [drop("Bones")] }, idOf)).toBeUndefined();
    });
});
