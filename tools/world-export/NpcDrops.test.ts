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

    it("matches a level in a list of levels", () => {
        const drops = { Goblin: [drop("Bones", "2,5"), drop("Coins", "13")] };
        expect(dropsFor(row(5), drops, idOf)?.map((d) => d.item)).toEqual([526]);
    });

    it("keeps entries without a level and falls back to all entries", () => {
        const drops = { Goblin: [drop("Bones"), drop("Coins", "5")] };
        expect(dropsFor(row(2), drops, idOf)?.map((d) => d.item)).toEqual([526]);
        expect(dropsFor(row(9), { Goblin: [drop("Coins", "5")] }, idOf)?.map((d) => d.item)).toEqual([995]);
    });

    it("keeps one version of the table: the members one, else the first", () => {
        const v = (item: string, version: string): WikiDrop => ({ ...drop(item), chance: 0.25, version });
        const both = { Goblin: [v("Bones", "Members"), v("Coins", "Members"), v("Bones", "Free-to-play"), v("Rune scimitar", "Free-to-play")] };
        expect(dropsFor(row(), both, idOf)?.map((d) => d.item)).toEqual([526, 995]);
        const other = { Goblin: [v("Coins", "Normal"), v("Bones", "Wilderness")] };
        expect(dropsFor(row(), other, idOf)?.map((d) => d.item)).toEqual([995]);
        const levels = { Goblin: [v("Coins", "Level 2"), v("Bones", "Level 5")] };
        expect(dropsFor(row(5), levels, idOf)?.map((d) => d.item)).toEqual([526]);
    });

    it("marks keys and clue scrolls as tertiary and scales a main table over one roll", () => {
        const ids2: Record<string, number> = { ...ids, "Giant key": 20754, "Clue scroll (beginner)": 23182, "Giant bones": 532 };
        const drops = {
            Goblin: [
                { ...drop("Giant bones"), chance: 1 },
                { ...drop("Coins"), chance: 0.75 },
                { ...drop("Rune scimitar"), chance: 0.5 },
                { ...drop("Giant key"), chance: 1 / 16 },
                { ...drop("Clue scroll (beginner)"), chance: 1 / 50 },
            ],
        };
        const out = dropsFor(row(), drops, (n) => ids2[n])!;
        expect(out.filter((d) => d.tertiary).map((d) => d.item)).toEqual([20754, 23182]);
        expect(out.find((d) => d.item === 995)!.chance).toBeCloseTo(0.6);
        expect(out.find((d) => d.item === 1333)!.chance).toBeCloseTo(0.4);
        expect(out.find((d) => d.item === 532)!.chance).toBe(1);
        expect(out.find((d) => d.item === 20754)!.chance).toBeCloseTo(1 / 16);
    });

    it("skips items the cache does not know and pages without drops", () => {
        expect(dropsFor(row(), { Goblin: [drop("Unknown")] }, idOf)).toBeUndefined();
        expect(dropsFor(row(), {}, idOf)).toBeUndefined();
        expect(dropsFor(undefined, { Goblin: [drop("Bones")] }, idOf)).toBeUndefined();
    });
});
