// Items exported from the cache and the OSRS wiki. Written once by tools/world-export, read by the game.
//
// public/world/
//   items.json         ItemManifest: every item with an inventory model
//   items/{id}.bin     gzip-compressed NpcModelData (see NpcFormat) without clips: the item's
//                      inventory model, lit like the client lights it (shared by items that look alike)

import type { MeleeType } from "./NpcFormat";

export type EquipSlot = "head" | "cape" | "neck" | "weapon" | "body" | "shield" | "legs" | "hands" | "feet" | "ring" | "ammo";
export const EQUIP_SLOTS: EquipSlot[] = ["head", "cape", "neck", "weapon", "body", "shield", "legs", "hands", "feet", "ring", "ammo"];
/** Cache wearPos1 to slot. */
export const WEAR_POS_SLOT: Record<number, EquipSlot> = {
    0: "head",
    1: "cape",
    2: "neck",
    3: "weapon",
    4: "body",
    5: "shield",
    7: "legs",
    9: "hands",
    10: "feet",
    12: "ring",
    13: "ammo",
};

export type EquipmentBonuses = {
    stab: number;
    slash: number;
    crush: number;
    magic: number;
    ranged: number;
    defStab: number;
    defSlash: number;
    defCrush: number;
    defMagic: number;
    defRanged: number;
    /** Melee strength. */
    strength: number;
    rangedStrength: number;
    /** Percent. */
    magicDamage: number;
};

export const NO_BONUSES: EquipmentBonuses = {
    stab: 0,
    slash: 0,
    crush: 0,
    magic: 0,
    ranged: 0,
    defStab: 0,
    defSlash: 0,
    defCrush: 0,
    defMagic: 0,
    defRanged: 0,
    strength: 0,
    rangedStrength: 0,
    magicDamage: 0,
};

export type { MeleeType };

/**
 * Bonuses and attack speed from an item's cache params: 0-4 stab, slash, crush, magic, ranged
 * attack; 5-9 the same defences; 10 melee strength; 12 ranged strength (ammo); 189 ranged strength
 * (weapons); 299 magic damage in tenths of a percent; 14 attack speed in ticks. Absent means 0.
 */
export function bonusesFromParams(params: Map<number, unknown> | undefined): { bonuses: EquipmentBonuses; speedTicks: number } {
    const p = (id: number): number => {
        const v = params?.get(id);
        return typeof v === "number" ? v : 0;
    };
    const speed = params?.get(14);
    return {
        bonuses: {
            stab: p(0),
            slash: p(1),
            crush: p(2),
            magic: p(3),
            ranged: p(4),
            defStab: p(5),
            defSlash: p(6),
            defCrush: p(7),
            defMagic: p(8),
            defRanged: p(9),
            strength: p(10),
            rangedStrength: p(189) + p(12),
            magicDamage: p(299) / 10,
        },
        speedTicks: typeof speed === "number" ? speed : 4,
    };
}

export type ItemIcon = { zoom: number; xan: number; yan: number; zan: number; xOffset: number; yOffset: number };
export type ItemRequirement = { skill: "melee" | "defence" | "ranged" | "magic" | "hitpoints"; level: number };

export type ItemInfo = {
    id: number;
    name: string;
    examine: string;
    stackable: boolean;
    /** Model file relative to public/world/ (shared by items that look the same). */
    model: string;
    icon: ItemIcon;
    /** Inventory menu options from the cache, e.g. ["Wield", "Drop"]. */
    actions: string[];
    slot?: EquipSlot;
    twoHanded?: true;
    bonuses?: EquipmentBonuses;
    speedTicks?: number;
    requirements?: ItemRequirement[];
    heal?: number;
};

export type ItemManifest = { format: 1; source: string; items: ItemInfo[] };

/**
 * Item names the cache gives several items, where the lowest id is not the real one: an old
 * non-stacking "Coins" (617) comes before the coins everyone uses (995), and the chinchompas that
 * are thrown are later copies. Lowercase name to id; every other name means its lowest id.
 */
export const PREFERRED_ITEM_IDS: Record<string, number> = {
    coins: 995,
    chinchompa: 10033,
    "red chinchompa": 10034,
    "black chinchompa": 11959,
};

/** Rune essence and pure essence stack in this game (they do not in the cache). */
export const FORCED_STACKABLE = new Set([1436, 7936]);
/** Cache skill codes of item requirements. Attack and Strength are both Melee here. */
export const SKILL_CODE: Record<number, ItemRequirement["skill"]> = { 0: "melee", 1: "defence", 2: "melee", 3: "hitpoints", 4: "ranged", 6: "magic" };
