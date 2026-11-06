import { units } from "../player/MoveMath";

/** The move set a weapon uses (first_basic.qct has one per family). */
export type WeaponFamily = "sword" | "daggers" | "staff" | "bow";

export type WeaponDef = {
    /** Also the model file name: public/models/weapons/<id>.glb. */
    id: string;
    name: string;
    family: WeaponFamily;
    /** Base damage (WDmg). */
    damage: number;
    /** Reach in tiles (rangeattack). */
    reach: number;
    /** Fraction of armour ignored (WPiercing). */
    piercing: number;
    /** Parry cone: cos of the half-angle (parry_cos; larger is narrower, spec 6). */
    parryCos: number;
    /** Weight in kilograms; sets how fast the weapon swings (`speed`). [design] */
    weight: number;
    /** Animation-rate multiplier (speed_attack); timelines are divided by it. From `weight`. */
    speed: number;
    /** Stun chance multiplier (stunmultiplicator). */
    stunMultiplier: number;
};

/** Seconds one quick strike takes with a weapon of `weight` kg: heavier swings slower. [design] */
export const swingTime = (weight: number) => 0.18 + 0.15 * weight;

/** Length of the quick strike timelines in moves.ts at speed 1. */
const QUICK_STRIKE_TIME = 0.4;

/** `weight` and the swing speed it gives. */
const weighing = (weight: number) => ({ weight, speed: QUICK_STRIKE_TIME / swingTime(weight) });

/**
 * Generic weapon classes with values from the spec's per-weapon table (13). The names are ours;
 * the numbers are the example weapons' entity_data, except speed, which comes from the weight.
 */
export const WEAPONS: readonly WeaponDef[] = [
    {
        id: "sword",
        name: "Longsword",
        family: "sword",
        damage: 3,
        reach: units(100),
        piercing: 0.1,
        parryCos: 0.5,
        ...weighing(1.5),
        stunMultiplier: 1,
    },
    {
        id: "shortsword",
        name: "Shortsword",
        family: "sword",
        damage: 2.5,
        reach: units(90),
        piercing: 0.2,
        parryCos: 0.5,
        ...weighing(1),
        stunMultiplier: 1,
    },
    {
        id: "daggers",
        name: "Daggers",
        family: "daggers",
        damage: 1,
        reach: units(80),
        piercing: 0.5,
        parryCos: 0.2,
        ...weighing(0.4),
        stunMultiplier: 1,
    },
    {
        id: "club",
        name: "Club",
        family: "sword",
        damage: 3,
        reach: units(100),
        piercing: 0.2,
        parryCos: 0.5,
        ...weighing(2),
        stunMultiplier: 1,
    },
    {
        id: "staff",
        name: "Staff",
        family: "staff",
        damage: 2,
        reach: units(110),
        piercing: 0.5,
        parryCos: 0.7,
        ...weighing(2.2),
        stunMultiplier: 1,
    },
    {
        // bow_classic.qct (spec 16.4). Reach and parry do not apply; it cannot parry. [design]
        id: "bow",
        name: "Bow",
        family: "bow",
        damage: 2,
        reach: units(80),
        piercing: 0.3,
        parryCos: 2,
        ...weighing(0.8),
        stunMultiplier: 1,
    },
];

export function weaponById(id: string): WeaponDef {
    const weapon = WEAPONS.find((w) => w.id === id);
    if (!weapon) {
        throw new Error(`Unknown weapon ${id}`);
    }
    return weapon;
}
