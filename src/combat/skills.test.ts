import { describe, expect, it } from "vitest";

import { MAGIC_STYLE, MELEE_STYLES, xpForDamage } from "./CombatStyles";
import { PlayerSkills } from "./Skills";
import { SPELLS, Spellbook } from "./Spells";
import { XpLedger } from "./XpLedger";

const fakeStorage = () => {
    const data = new Map<string, string>();
    return {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        data,
    };
};

describe("PlayerSkills", () => {
    it("starts at level 1 with 10 hitpoints", () => {
        const s = new PlayerSkills();
        expect(s.levels()).toEqual({ melee: 1, defence: 1, ranged: 1, magic: 1, hitpoints: 10 });
        expect(s.combatLevel()).toBe(3);
    });

    it("reports level-ups", () => {
        expect(new PlayerSkills().addXp({ melee: 83 })).toEqual([{ skill: "melee", level: 2 }]);
    });

    it("saves and loads", () => {
        const storage = fakeStorage();
        new PlayerSkills(storage).addXp({ magic: 200 });
        expect(new PlayerSkills(storage).xp("magic")).toBe(200);
    });

    it("starts fresh from a corrupt save", () => {
        const storage = fakeStorage();
        storage.setItem("first-person-survival.skills.v1", "{nope");
        expect(new PlayerSkills(storage).level("melee")).toBe(1);
    });

    it("caps XP at 200 million", () => {
        const s = new PlayerSkills();
        s.addXp({ ranged: 500_000_000 });
        expect(s.xp("ranged")).toBe(200_000_000);
    });
});

describe("xpForDamage", () => {
    it("gives 4 per damage and 4/3 to hitpoints", () => {
        expect(xpForDamage(MELEE_STYLES[2], 3)).toEqual({ defence: 12, hitpoints: 4 });
        expect(xpForDamage(MELEE_STYLES[0], 3)).toEqual({ melee: 12, hitpoints: 4 });
    });

    it("gives the base spell XP even for a splash", () => {
        expect(xpForDamage(MAGIC_STYLE, 0, 5.5)).toEqual({ magic: 5.5, hitpoints: 0 });
        expect(xpForDamage(MAGIC_STYLE, 2, 5.5)).toEqual({ magic: 9.5, hitpoints: 8 / 3 });
    });
});

describe("XpLedger", () => {
    it("adds up and drains", () => {
        const ledger = new XpLedger();
        ledger.add({ melee: 4, hitpoints: 1 });
        ledger.add({ melee: 8 });
        expect(ledger.empty).toBe(false);
        expect(ledger.drain()).toEqual({ melee: 12, hitpoints: 1 });
        expect(ledger.empty).toBe(true);
    });
});

describe("Spellbook", () => {
    it("defaults to Wind Strike", () => {
        expect(new Spellbook().equipped.id).toBe("wind-strike");
    });

    it("equips only unlocked spells", () => {
        const book = new Spellbook();
        expect(book.equip("fire-bolt", 34)).toBe(false);
        expect(book.equip("fire-bolt", 35)).toBe(true);
        expect(book.equipped.name).toBe("Fire Bolt");
    });

    it("saves the equipped spell", () => {
        const storage = fakeStorage();
        new Spellbook(storage).equip("fire-bolt", 99);
        expect(new Spellbook(storage).equipped.id).toBe("fire-bolt");
    });

    it("cannot cast a locked spell", () => {
        const storage = fakeStorage();
        new Spellbook(storage).equip("fire-bolt", 99);
        expect(new Spellbook(storage).castable(1)).toBeUndefined();
    });

    it("has the 20 standard spells in level order", () => {
        expect(SPELLS).toHaveLength(20);
        expect(SPELLS.map((s) => s.level)).toEqual([...SPELLS.map((s) => s.level)].sort((a, b) => a - b));
        expect(SPELLS.find((s) => s.id === "earth-surge")!.xp).toBe(48.2);
        expect(SPELLS.find((s) => s.id === "fire-bolt")!.runes).toEqual([
            { item: 556, count: 3 },
            { item: 554, count: 4 },
            { item: 562, count: 1 },
        ]);
    });
});
