import type { AttackStyle } from "../npc/AttackStyle";
import { SERVER_TICK_SECONDS } from "../npc/NpcMovement";
import type { DefenceType, NpcCombatStats } from "../world/NpcFormat";
import type { EquipmentBonuses } from "../world/ItemFormat";
import type { CombatStyleDef } from "./CombatStyles";
import { meleeType } from "./Equipment";
import type { SpellDef } from "./Spells";

/** OSRS formulas (oldschool.runescape.wiki: Damage per second, Combat level, Experience). Pure functions. */

export const TICK_SECONDS = SERVER_TICK_SECONDS;
export const MAX_XP = 200_000_000;

/** XP needed for `level`: floor(1/4 * sum over l < level of floor(l + 300 * 2^(l/7))). */
export function xpForLevel(level: number): number {
    let sum = 0;
    for (let l = 1; l < level; l++) {
        sum += Math.floor(l + 300 * Math.pow(2, l / 7));
    }
    return Math.floor(sum / 4);
}

const LEVEL_XP: number[] = Array.from({ length: 100 }, (_, l) => (l === 0 ? 0 : xpForLevel(l)));

/** The level (1..99) `xp` reaches. */
export function levelForXp(xp: number): number {
    let level = 1;
    for (let l = 2; l <= 99; l++) {
        if (LEVEL_XP[l] <= xp) level = l;
    }
    return level;
}

/** Combat level; Melee counts as Attack + Strength, and there is no Prayer. */
export function combatLevel(l: { melee: number; defence: number; hitpoints: number; ranged: number; magic: number }): number {
    const base = (l.defence + l.hitpoints) / 4;
    const melee = (13 * 2 * l.melee) / 40;
    const ranged = (13 * Math.floor((3 * l.ranged) / 2)) / 40;
    const magic = (13 * Math.floor((3 * l.magic) / 2)) / 40;
    return Math.floor(base + Math.max(melee, ranged, magic));
}

/** Chance that an attack roll (max `a`) beats a defence roll (max `d`). */
export function hitChance(a: number, d: number): number {
    return a > d ? 1 - (d + 2) / (2 * (a + 1)) : a / (2 * (d + 1));
}

/** Rounds up with probability equal to the fraction; always draws one random number. */
export function stochasticRound(x: number, random: () => number): number {
    const floor = Math.floor(x);
    return floor + (random() < x - floor ? 1 : 0);
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** One attack of the player, rolled when it starts and resolved when it lands. */
export type PlayerAttack = {
    kind: "melee" | "ranged" | "magic";
    attackRoll: number;
    maxHit: number;
    defenceType: DefenceType;
    /** 0..1: how much of the weapon interval (OSRS ticks) had passed since the previous attack. */
    rate: number;
    style: CombatStyleDef;
    spellXp?: number;
};

type Rolls = { attackRoll: number; maxHit: number; defenceType: DefenceType };

export function playerMeleeAttack(melee: number, style: CombatStyleDef, bonuses: EquipmentBonuses): Rolls {
    const type = meleeType(bonuses);
    const effAttack = melee + style.accuracy + 8;
    const effStrength = melee + style.strength + 8;
    return {
        attackRoll: effAttack * (bonuses[type] + 64),
        maxHit: Math.floor((effStrength * (bonuses.strength + 64) + 320) / 640),
        defenceType: type,
    };
}

/** The ammunition strength is already in `bonuses.rangedStrength` (the ammo slot). */
export function playerRangedAttack(ranged: number, style: CombatStyleDef, bonuses: EquipmentBonuses, crossbow: boolean): Rolls {
    const eff = ranged + style.accuracy + 8;
    return {
        attackRoll: eff * (bonuses.ranged + 64),
        maxHit: Math.floor(0.5 + (eff * (bonuses.rangedStrength + 64)) / 640),
        defenceType: crossbow ? "heavy" : "standard",
    };
}

export function playerMagicAttack(magic: number, bonuses: EquipmentBonuses, spell: Pick<SpellDef, "maxHit">): Rolls {
    return {
        attackRoll: (magic + 9) * (bonuses.magic + 64),
        maxHit: Math.floor(spell.maxHit * (1 + bonuses.magicDamage / 100)),
        defenceType: "magic",
    };
}

export function npcDefenceRoll(s: NpcCombatStats, type: DefenceType): number {
    if (type === "magic") return (s.magic + 9) * (s.defenceBonus.magic + 64);
    return (s.defence + 9) * (s.defenceBonus[type] + 64);
}

export function npcAttackRoll(s: NpcCombatStats, style: "melee" | "ranged" | "magic"): number {
    switch (style) {
        case "melee":
            return (s.attack + 9) * (s.attackBonus + 64);
        case "ranged":
            return (s.ranged + 9) * (s.rangedAttack + 64);
        case "magic":
            return (s.magic + 9) * (s.magicAttack + 64);
    }
}

/** The wiki max hit for the style, else the OSRS formula from the NPC level and bonus. */
export function npcMaxHit(s: NpcCombatStats, style: AttackStyle): number {
    const wiki = s.maxHit[style];
    if (wiki !== undefined) return wiki;
    switch (style) {
        case "melee":
            return Math.max(1, Math.floor(((s.strength + 9) * (s.strengthBonus + 64) + 320) / 640));
        case "ranged":
            return Math.max(1, Math.floor(0.5 + ((s.ranged + 9) * (s.rangedStrength + 64)) / 640));
        case "magic":
            return Math.max(1, Math.floor(Math.floor(0.5 + ((s.magic + 9) * 64) / 640) * (1 + s.magicDamage / 100)));
        default:
            return 50; // dragonfire and icy breath, unprotected [wiki]
    }
}

/**
 * The player defence roll against an NPC attack. Magic defence is 70% Magic and 30% Defence;
 * `styleDefence` is the defensive style bonus (+3).
 */
export function playerDefenceRoll(
    defence: number,
    magic: number,
    bonuses: EquipmentBonuses,
    type: DefenceType,
    styleDefence: number,
): number {
    if (type === "magic") {
        const level = Math.floor((7 * magic + 3 * (defence + styleDefence)) / 10);
        return (level + 8) * (bonuses.defMagic + 64);
    }
    const effective = defence + styleDefence + 8;
    const bonus =
        type === "stab" ? bonuses.defStab : type === "slash" ? bonuses.defSlash : type === "crush" ? bonuses.defCrush : bonuses.defRanged;
    return effective * (bonus + 64);
}

/** Share of the weapon attack interval that has passed since the last attack, at most 1. */
export function attackRate(sinceLast: number, intervalSeconds: number): number {
    return Math.min(1, sinceLast / intervalSeconds);
}

/** An NPC with no exported stats: every level is its combat level, no bonuses. */
export function fallbackCombatStats(combatLevel: number): NpcCombatStats {
    const level = Math.max(1, combatLevel);
    return {
        hitpoints: level,
        attack: level,
        strength: level,
        defence: level,
        ranged: level,
        magic: level,
        attackBonus: 0,
        strengthBonus: 0,
        rangedAttack: 0,
        rangedStrength: 0,
        magicAttack: 0,
        magicDamage: 0,
        defenceBonus: { stab: 0, slash: 0, crush: 0, magic: 0, light: 0, standard: 0, heavy: 0 },
        meleeType: "slash",
        speedTicks: 4,
        maxHit: {},
    };
}

/**
 * Damage from the world (falls, props, bodies) was tuned for 100 health: keep it the same share of
 * the target maximum health.
 */
export function environmentDamage(old: number, maxHealth: number): number {
    return old <= 0 ? 0 : Math.max(1, Math.round((old / 100) * maxHealth));
}
