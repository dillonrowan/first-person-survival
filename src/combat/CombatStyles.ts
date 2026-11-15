import type { WeaponFamily } from "./weapons";

export type XpKind = "melee" | "defence" | "ranged" | "longrange" | "magic";

/** An attack style: the bonuses it adds to the effective levels (OSRS) and where its XP goes. */
export type CombatStyleDef = {
    id: string;
    name: string;
    kind: "melee" | "ranged" | "magic";
    accuracy: number;
    strength: number;
    defence: number;
    /** Ranged rapid: one tick faster. */
    rapid?: boolean;
    xp: XpKind;
};

export const MELEE_STYLES: readonly CombatStyleDef[] = [
    { id: "accurate", name: "Accurate", kind: "melee", accuracy: 3, strength: 0, defence: 0, xp: "melee" },
    { id: "aggressive", name: "Aggressive", kind: "melee", accuracy: 0, strength: 3, defence: 0, xp: "melee" },
    { id: "defensive", name: "Defensive", kind: "melee", accuracy: 0, strength: 0, defence: 3, xp: "defence" },
];

export const RANGED_STYLES: readonly CombatStyleDef[] = [
    { id: "accurate", name: "Accurate", kind: "ranged", accuracy: 3, strength: 3, defence: 0, xp: "ranged" },
    { id: "rapid", name: "Rapid", kind: "ranged", accuracy: 0, strength: 0, defence: 0, rapid: true, xp: "ranged" },
    { id: "longrange", name: "Longrange", kind: "ranged", accuracy: 0, strength: 0, defence: 3, xp: "longrange" },
];

/** Every cast uses this, whatever melee or ranged style is selected. */
export const MAGIC_STYLE: CombatStyleDef = {
    id: "spell",
    name: "Spell",
    kind: "magic",
    accuracy: 0,
    strength: 0,
    defence: 0,
    xp: "magic",
};

export function stylesFor(family: WeaponFamily): readonly CombatStyleDef[] {
    return family === "bow" || family === "crossbow" ? RANGED_STYLES : MELEE_STYLES;
}

export type XpGains = Partial<Record<"melee" | "defence" | "ranged" | "magic" | "hitpoints", number>>;

/**
 * XP for `damage` dealt: 4 per damage to the style's skill and 4/3 to Hitpoints; longrange splits
 * 2 Ranged and 2 Defence; magic gives 2 per damage plus the spell's base XP. PlayerCombat pays
 * magic XP at once, and only for a spell that does damage; melee and ranged XP waits for the kill.
 */
export function xpForDamage(style: CombatStyleDef, damage: number, spellXp = 0): XpGains {
    const hitpoints = (damage * 4) / 3;
    switch (style.xp) {
        case "melee":
            return { melee: damage * 4, hitpoints };
        case "defence":
            return { defence: damage * 4, hitpoints };
        case "ranged":
            return { ranged: damage * 4, hitpoints };
        case "longrange":
            return { ranged: damage * 2, defence: damage * 2, hitpoints };
        case "magic":
            return { magic: damage * 2 + spellXp, hitpoints };
    }
}
