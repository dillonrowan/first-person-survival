import type { RuneCost } from "./Equipment";

export type SpellDef = {
    id: string;
    name: string;
    level: number;
    maxHit: number;
    /** Base XP for casting. */
    xp: number;
    color: number;
    runes: RuneCost[];
};

/** Cache item ids of the runes. */
export const RUNE = {
    air: 556,
    water: 555,
    earth: 557,
    fire: 554,
    mind: 558,
    chaos: 562,
    death: 560,
    blood: 565,
    wrath: 21880,
    body: 559,
    cosmic: 564,
    nature: 561,
    law: 563,
    soul: 566,
    astral: 9075,
} as const;

/** All fifteen runes, in the order the player starts with them. */
export const ALL_RUNES: number[] = [
    RUNE.air,
    RUNE.water,
    RUNE.earth,
    RUNE.fire,
    RUNE.mind,
    RUNE.chaos,
    RUNE.death,
    RUNE.blood,
    RUNE.wrath,
    RUNE.body,
    RUNE.cosmic,
    RUNE.nature,
    RUNE.law,
    RUNE.soul,
    RUNE.astral,
];

type Element = "wind" | "water" | "earth" | "fire";
const COLORS: Record<Element, number> = { wind: 0xd8f0ff, water: 0x3a7bff, earth: 0x4caf50, fire: 0xff7a1a };
const cost = (...pairs: [number, number][]): RuneCost[] => pairs.map(([item, count]) => ({ item, count }));
const { air, water, earth, fire, mind, chaos, death, blood, wrath } = RUNE;

const spell = (tier: string, element: Element, level: number, maxHit: number, xp: number, runes: RuneCost[]): SpellDef => {
    const name = `${element[0].toUpperCase()}${element.slice(1)} ${tier}`;
    return { id: name.toLowerCase().replace(" ", "-"), name, level, maxHit, xp, color: COLORS[element], runes };
};

/** The standard spellbook's 20 combat spells (OSRS wiki: level, max hit at unlock, XP, runes), in level order. */
export const SPELLS: readonly SpellDef[] = [
    spell("Strike", "wind", 1, 2, 5.5, cost([air, 1], [mind, 1])),
    spell("Strike", "water", 5, 4, 7.5, cost([air, 1], [water, 1], [mind, 1])),
    spell("Strike", "earth", 9, 6, 9.5, cost([air, 1], [earth, 2], [mind, 1])),
    spell("Strike", "fire", 13, 8, 11.5, cost([air, 2], [fire, 3], [mind, 1])),
    spell("Bolt", "wind", 17, 9, 13.5, cost([air, 2], [chaos, 1])),
    spell("Bolt", "water", 23, 10, 16.5, cost([air, 2], [water, 2], [chaos, 1])),
    spell("Bolt", "earth", 29, 11, 19.5, cost([air, 2], [earth, 3], [chaos, 1])),
    spell("Bolt", "fire", 35, 12, 22.5, cost([air, 3], [fire, 4], [chaos, 1])),
    spell("Blast", "wind", 41, 13, 25.5, cost([air, 3], [death, 1])),
    spell("Blast", "water", 47, 14, 28.5, cost([air, 3], [water, 3], [death, 1])),
    spell("Blast", "earth", 53, 15, 31.5, cost([air, 3], [earth, 4], [death, 1])),
    spell("Blast", "fire", 59, 16, 34.5, cost([air, 4], [fire, 5], [death, 1])),
    spell("Wave", "wind", 62, 17, 36, cost([air, 5], [blood, 1])),
    spell("Wave", "water", 65, 18, 37.5, cost([air, 5], [water, 7], [blood, 1])),
    spell("Wave", "earth", 70, 19, 40, cost([air, 5], [earth, 7], [blood, 1])),
    spell("Wave", "fire", 75, 20, 42.5, cost([air, 5], [fire, 7], [blood, 1])),
    spell("Surge", "wind", 81, 21, 44.5, cost([air, 7], [wrath, 1])),
    spell("Surge", "water", 85, 22, 46.5, cost([air, 7], [water, 10], [wrath, 1])),
    spell("Surge", "earth", 90, 23, 48.2, cost([air, 7], [earth, 10], [wrath, 1])),
    spell("Surge", "fire", 95, 24, 50.5, cost([air, 7], [fire, 10], [wrath, 1])),
];

/** Standard spells take 5 ticks (3.0 s). */
export const SPELL_TICKS = 5;

export const spellById = (id: string): SpellDef | undefined => SPELLS.find((s) => s.id === id);

const STORAGE_KEY = "first-person-survival.spell.v1";
type SpellStorage = Pick<Storage, "getItem" | "setItem">;

/** The one equipped spell, saved. */
export class Spellbook {
    private spell: SpellDef = SPELLS[0];

    constructor(private readonly storage?: SpellStorage) {
        try {
            const saved = spellById(storage?.getItem(STORAGE_KEY) ?? "");
            if (saved) this.spell = saved;
        } catch {
            // Unreadable storage: keep the default.
        }
    }

    get equipped(): SpellDef {
        return this.spell;
    }

    unlocked(spell: SpellDef, magicLevel: number): boolean {
        return spell.level <= magicLevel;
    }

    /** Equips an unlocked spell; false (and no change) for an unknown or locked one. */
    equip(id: string, magicLevel: number): boolean {
        const spell = spellById(id);
        if (!spell || !this.unlocked(spell, magicLevel)) return false;
        this.spell = spell;
        try {
            this.storage?.setItem(STORAGE_KEY, spell.id);
        } catch {
            // Not saved; still equipped for this session.
        }
        return true;
    }

    /** The equipped spell if the level allows it. */
    castable(magicLevel: number): SpellDef | undefined {
        return this.unlocked(this.spell, magicLevel) ? this.spell : undefined;
    }
}
