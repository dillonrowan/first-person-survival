import { describe, expect, it } from "vitest";

import { PlayerSkills } from "../combat/Skills";
import { ALL_RUNES, RUNE, SPELLS } from "../combat/Spells";
import { ItemInfo, NO_BONUSES } from "../world/ItemFormat";
import { ItemContainer } from "./ItemContainer";
import { ItemDb } from "./ItemDb";
import { PlayerItems } from "./PlayerItems";

const base = (id: number, name: string, extra: Partial<ItemInfo> = {}): ItemInfo => ({
    id,
    name,
    examine: "",
    stackable: false,
    model: `items/${id}.bin`,
    icon: { zoom: 2000, xan: 0, yan: 0, zan: 0, xOffset: 0, yOffset: 0 },
    actions: [],
    ...extra,
});

const runeNames = ["Air", "Water", "Earth", "Fire", "Mind", "Chaos", "Death", "Blood", "Wrath", "Body", "Cosmic", "Nature", "Law", "Soul", "Astral"];
const ITEMS: ItemInfo[] = [
    ...ALL_RUNES.map((id, i) => base(id, `${runeNames[i]} rune`, { stackable: true })),
    base(1436, "Rune essence", { stackable: true }),
    base(1277, "Bronze sword", { slot: "weapon", bonuses: { ...NO_BONUSES, stab: 4, strength: 5 }, speedTicks: 4 }),
    base(1291, "Bronze longsword", { slot: "weapon", bonuses: { ...NO_BONUSES, slash: 5, strength: 7 }, speedTicks: 5 }),
    base(1205, "Bronze dagger", { slot: "weapon" }),
    base(1422, "Bronze mace", { slot: "weapon" }),
    base(1379, "Staff", { slot: "weapon", bonuses: { ...NO_BONUSES, magic: 4 }, speedTicks: 5 }),
    base(1381, "Staff of air", { slot: "weapon", bonuses: { ...NO_BONUSES, magic: 10 }, speedTicks: 5 }),
    base(841, "Shortbow", { slot: "weapon", bonuses: { ...NO_BONUSES, ranged: 8 }, speedTicks: 4 }),
    base(882, "Bronze arrow", { slot: "ammo", stackable: true, bonuses: { ...NO_BONUSES, rangedStrength: 7 } }),
    base(1540, "Anti-dragon shield", { slot: "shield", bonuses: { ...NO_BONUSES, defSlash: 9 } }),
    base(5000, "Big scimitar", { slot: "weapon", requirements: [{ skill: "melee", level: 40 }] }),
    base(5001, "Great maul", { slot: "weapon", twoHanded: true }),
    base(379, "Lobster", { heal: 12 }),
    base(617, "Coins"),
    base(995, "Coins", { stackable: true }),
];
const db = new ItemDb(ITEMS);
const fakeStorage = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};
const items = (skills = new PlayerSkills(), storage?: ReturnType<typeof fakeStorage>) => new PlayerItems(db, skills, storage);
const emptyInventory = (p: PlayerItems) => p.inventory.clear();

describe("ItemContainer", () => {
    it("fills 28 slots with non-stackables and returns what does not fit", () => {
        const inv = new ItemContainer(28, false, db);
        expect(inv.add(1277, 28)).toBe(0);
        expect(inv.add(1277, 1)).toBe(1);
        expect(inv.freeSlots()).toBe(0);
    });

    it("stacks stackable items in one slot", () => {
        const inv = new ItemContainer(28, false, db);
        inv.add(RUNE.air, 999);
        inv.add(RUNE.air, 1);
        expect(inv.slots.filter(Boolean)).toEqual([{ id: RUNE.air, qty: 1000 }]);
    });

    it("stacks rune essence even though the cache does not", () => {
        const inv = new ItemContainer(28, false, db);
        inv.add(1436, 100);
        expect(inv.freeSlots()).toBe(27);
    });

    it("stacks everything in the bank", () => {
        const bank = new ItemContainer(Infinity, true, db);
        bank.add(1277, 3);
        expect(bank.slots).toEqual([{ id: 1277, qty: 3 }]);
    });

    it("removes across several slots", () => {
        const inv = new ItemContainer(28, false, db);
        inv.add(1277, 3);
        expect(inv.remove(1277, 2)).toBe(2);
        expect(inv.count(1277)).toBe(1);
        expect(inv.remove(1277, 5)).toBe(1);
    });
});

describe("ItemDb", () => {
    it("finds the preferred item of a name the cache uses twice, else the lowest id", () => {
        expect(db.byName("coins")?.id).toBe(995);
        expect(db.byName("Bronze sword")?.id).toBe(1277);
    });
});

describe("PlayerItems", () => {
    it("starts with 999 of every rune and a bronze sword wielded", () => {
        const p = items();
        expect(p.inventory.slots.filter(Boolean)).toHaveLength(20);
        for (const rune of ALL_RUNES) expect(p.inventory.count(rune)).toBe(999);
        expect(p.equipment.get("weapon")?.id).toBe(1277);
        expect(p.equipment.get("ammo")).toEqual({ id: 882, qty: 999 });
    });

    it("wielding swaps the old weapon into the same slot", () => {
        const p = items();
        const slot = p.inventory.slots.findIndex((s) => s?.id === 1291);
        expect(p.wield(slot)).toBeUndefined();
        expect(p.equipment.get("weapon")?.id).toBe(1291);
        expect(p.inventory.slots[slot]?.id).toBe(1277);
    });

    it("needs the skill level", () => {
        const p = items();
        p.inventory.add(5000, 1);
        const slot = p.inventory.slots.findIndex((s) => s?.id === 5000);
        expect(p.wield(slot)).toBe("You need a Melee level of 40 to wear this.");
        expect(p.equipment.get("weapon")?.id).toBe(1277);
    });

    it("takes the shield off for a two-handed weapon", () => {
        const p = items();
        p.give(1540, 1);
        p.wield(p.inventory.slots.findIndex((s) => s?.id === 1540));
        expect(p.equipment.get("shield")?.id).toBe(1540);
        p.give(5001, 1);
        p.wield(p.inventory.slots.findIndex((s) => s?.id === 5001));
        expect(p.equipment.get("weapon")?.id).toBe(5001);
        expect(p.equipment.get("shield")).toBeUndefined();
        expect(p.inventory.count(1540)).toBe(1);
    });

    it("refuses a swap with no room", () => {
        const p = items();
        p.give(1540, 1);
        p.wield(p.inventory.slots.findIndex((s) => s?.id === 1540));
        p.give(5001, 1);
        const slot = p.inventory.slots.findIndex((s) => s?.id === 5001);
        p.inventory.add(1277, p.inventory.freeSlots()); // full
        expect(p.wield(slot)).toMatch(/enough free inventory space/);
        expect(p.equipment.get("shield")?.id).toBe(1540);
    });

    it("spends runes for a spell", () => {
        const p = items();
        const fireStrike = SPELLS.find((s) => s.id === "fire-strike")!;
        expect(p.hasRunes(fireStrike.runes)).toBe(true);
        p.useRunes(fireStrike.runes);
        expect(p.inventory.count(RUNE.air)).toBe(997);
        expect(p.inventory.count(RUNE.fire)).toBe(996);
        expect(p.inventory.count(RUNE.mind)).toBe(998);
    });

    it("cannot cast without enough runes", () => {
        const p = items();
        p.inventory.remove(RUNE.mind, 999);
        expect(p.hasRunes(SPELLS[0].runes)).toBe(false);
    });

    it("gets unlimited air runes from a staff of air", () => {
        const p = items();
        p.give(1381, 1);
        p.wield(p.inventory.slots.findIndex((s) => s?.id === 1381));
        p.useRunes(SPELLS[0].runes);
        expect(p.inventory.count(RUNE.air)).toBe(999);
        expect(p.inventory.count(RUNE.mind)).toBe(998);
    });

    it("sums the bonuses of the weapon and the ammunition", () => {
        const b = items().bonuses();
        expect(b.stab).toBe(4);
        expect(b.strength).toBe(5);
        expect(b.rangedStrength).toBe(7);
    });

    it("counts and uses arrows from the ammo slot", () => {
        const p = items();
        expect(p.ammoCount("arrow")).toBe(999);
        expect(p.ammoCount("bolt")).toBe(0);
        p.useAmmo();
        expect(p.ammoCount("arrow")).toBe(998);
    });

    it("eats food and heals up to the maximum", () => {
        const p = items();
        p.give(379, 1);
        const target = { health: 5, maxHealth: 10 };
        const slot = p.inventory.slots.findIndex((s) => s?.id === 379);
        expect(p.eat(slot, target)).toBe("You eat the lobster.");
        expect(target.health).toBe(10);
        expect(p.inventory.count(379)).toBe(0);
    });

    it("saves and loads", () => {
        const storage = fakeStorage();
        const p = items(new PlayerSkills(), storage);
        p.deposit(0, 100);
        const again = items(new PlayerSkills(), storage);
        expect(again.inventory.count(RUNE.air)).toBe(899);
        expect(again.bank.count(RUNE.air)).toBe(100);
        expect(again.equipment.get("weapon")?.id).toBe(1277);
    });

    it("deposits and withdraws, taking only what fits", () => {
        const p = items();
        emptyInventory(p);
        p.inventory.add(1277, 28);
        p.depositAll();
        expect(p.bank.count(1277)).toBe(28);
        p.inventory.add(1291, 26);
        expect(p.withdraw(p.bank.slots.findIndex((s) => s?.id === 1277), 10)).toMatch(/enough inventory space/);
        expect(p.inventory.count(1277)).toBe(2);
        expect(p.bank.count(1277)).toBe(26);
    });

    it("cycles the wheel through the inventory weapons", () => {
        const p = items();
        const before = p.equipment.get("weapon")!.id;
        p.cycleWeapon(1);
        expect(p.equipment.get("weapon")!.id).not.toBe(before);
    });
});
