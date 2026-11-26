import type { SkillId } from "../combat/SkillId";
import { type GfxId, SPELL_GRAPHICS, type SpellGraphics } from "../world/SpellGfxFormat";

/**
 * What NPC ranged and magic attacks look like and do beyond damage. The cache has the graphics
 * (spot animations) but not which NPC uses which: that is server data. The ids here come from
 * Jagex's spot animation names (RuneLite's gameval SpotanimID, e.g. LIZARDMAN_SPIT = 1291) matched
 * to the NPC, and from the OSRS wiki's description of each NPC's attacks; the drains from the
 * wiki's "Temporary skill drain" table. Entries marked [design] are a best match where neither says.
 */

/** Spot animations of one attack; any may be absent (a god spell has no projectile, only its impact). */
export type AttackGfx = { cast?: number; projectile?: number; impact?: number };

/** A temporary drain: floor(current level × percent) + flat levels, from each listed skill. */
export type Drain = { skills: SkillId[]; percent?: number; flat?: number; to?: number };

export type NpcSpell = {
    /** Key for messages and tests: the spell's name in OSRS (or what it looks like). */
    name: string;
    gfx?: AttackGfx;
    /** False for curses: rolled for accuracy, no damage, the drain (or bind) on a landed cast. */
    damaging: boolean;
    drain?: Drain;
    /** Not cast again while the drained skill is still below its base level [wiki: Necromancer]. */
    onlyIfUndrained?: boolean;
    /** Seconds a landed cast holds the player in place. */
    bind?: number;
    /** It throws the player back and hurts by how close the wall is, not by a roll (Callisto's). */
    knockBack?: SpellKnockBack;
};

/**
 * Callisto's and Artio's knockback [wiki: Callisto/Strategies]: it "attempts to knock the target 3
 * tiles", dealing 5 if they fly all 3, and 20, 35 or 50 if a wall stops them after 2, 1 or 0.
 */
export type SpellKnockBack = {
    tiles: number;
    /** Damage by the tiles the player flies before something stops them (index 0: none). */
    damage: readonly number[];
    /** Seconds it holds the player after ("temporarily stunned"). */
    stun: number;
    /** Bear traps stop the player as a wall does (Callisto's; Artio's only stop at walls). */
    trapsBlock: boolean;
};

/** An effect of an NPC's successful hits, whatever the style. */
export type HitEffect = {
    chance: number;
    drain: Drain;
    /** Only hits that deal damage [wiki: Loar Shade]. */
    damagingOnly?: boolean;
    /** A head-slot item (by name) that blocks it: earmuffs, a nose peg, a Slayer helmet. */
    blockedBy?: RegExp;
    /** Drains this many of the drainable skills, picked at random (a leech: 1 to 4). */
    randomSkills?: [number, number];
    /** Once per fight (the Mourner's vial). */
    once?: boolean;
    message?: string;
};

/**
 * One of a dragon's breaths, flown as a projectile: the King Black Dragon's fiery, toxic, icy and
 * shocking breath [wiki: King Black Dragon/Strategies].
 */
export type DragonBreath = {
    name: "fiery" | "toxic" | "icy" | "shocking";
    /** Relative pick chance among the dragon's breaths. */
    weight: number;
    gfx: AttackGfx;
    /** Max hit unprotected, and behind an anti-dragon shield [wiki: Dragonfire/King Black Dragon]. */
    max: number;
    shieldedMax: number;
    /** Shown when it burns a player without a shield [wiki: King Black Dragon trivia]. */
    message: string;
    /** What a successful hit may also do (BREATH_EFFECT_CHANCE): poison, freeze or drain. */
    effect?: "poison" | "freeze" | "shock";
};

/**
 * Chance a special breath's effect comes with a successful hit: "a 50% chance ... Antifire shields
 * ... reduce the effect chance to 1 in 8" [wiki: King Black Dragon/Strategies].
 */
export const BREATH_EFFECT_CHANCE = { unprotected: 1 / 2, shielded: 1 / 8 } as const;
/** Icy breath "freezes the player for 10 ticks (6 seconds)" [wiki]. */
export const FREEZE_SECONDS = 10 * 0.6;
/** Shocking breath "drains two levels off of all the player's stats" [wiki]: the drainable ones here. */
export const SHOCK_DRAIN: Drain = { skills: ["melee", "defence", "ranged", "magic"], flat: 2 };

export type NpcEffects = {
    /** One picked at random per magic attack. */
    magic?: NpcSpell[];
    /** A dragon's breaths, one picked by weight per dragonfire attack. Only its toxic breath poisons. */
    breaths?: DragonBreath[];
    ranged?: AttackGfx;
    onHit?: HitEffect[];
    /** Other spot animations its fight plays (Scurrius's falling debris), exported with the rest. */
    other?: GfxId[];
};

const spell = (id: string): AttackGfx => SPELL_GRAPHICS[id] as SpellGraphics;
const strike = (id: string, name: string): NpcSpell => ({ name, gfx: spell(id), damaging: true });
/** A magic attack whose graphics are not known: drawn as the exported orb. */
const unknownMagic: NpcSpell = { name: "Magic", damaging: true };

// OSRS curses as NPCs cast them [wiki: Confuse, Weaken, Curse, Vulnerability: 5%, 5%, 5%, 10%].
const confuse = (drain: Drain = { skills: ["melee"], percent: 0.05 }): NpcSpell => ({ name: "Confuse", gfx: spell("confuse"), damaging: false, drain });
const weaken = (drain: Drain = { skills: ["melee"], percent: 0.05 }): NpcSpell => ({ name: "Weaken", gfx: spell("weaken"), damaging: false, drain });
const curse = (drain: Drain = { skills: ["defence"], percent: 0.05 }): NpcSpell => ({ name: "Curse", gfx: spell("curse"), damaging: false, drain });
const vulnerability: NpcSpell = {
    name: "Vulnerability",
    gfx: { cast: 167, projectile: 168, impact: 169 },
    damaging: false,
    drain: { skills: ["defence"], percent: 0.1 },
};

/** Attack and Strength are one skill here (Melee): a drain of either lowers Melee. */
const MELEE_5: Drain = { skills: ["melee"], flat: 5 };
const ALL_COMBAT: SkillId[] = ["melee", "defence", "ranged", "magic"];

// Arrows and bolts by their Jagex names.
const ARROW = { bronze: { projectile: 10 }, iron: { projectile: 9 }, steel: { projectile: 11 }, crystal: { projectile: 249 } };
const BOLT = { projectile: 27 };

const DARK_WIZARD_7: NpcEffects = {
    // [wiki: "the level 7 variant will attack with Water Strike and Confuse"; the drain table: Attack -5]
    magic: [strike("water-strike", "Water Strike"), confuse(MELEE_5)],
};
const DARK_WIZARD_20: NpcEffects = {
    // [wiki: "the level 20 variant will attack with Earth Strike and Weaken"; Strength -5]
    magic: [strike("earth-strike", "Earth Strike"), weaken(MELEE_5)],
};
const elementalWizard = (id: string, name: string): NpcEffects => ({
    // [wiki: "He will cast <element> Strike when attacked ... he can also cast Weaken"]
    magic: [strike(id, name), weaken()],
});
const troll: NpcEffects = { ranged: { cast: 275, projectile: 276 } }; // TROLL_ROCK_LAUNCH / TRAVEL
const lizardman: NpcEffects = { ranged: { projectile: 1291 } }; // LIZARDMAN_SPIT
const blamishSnail: NpcEffects = { ranged: { cast: 627, projectile: 628, impact: 629 } }; // TREK_SNAIL_ACID_* [design: the swamp snails' acid]
const battleMage = (impact: number): NpcEffects => ({
    // God spells hit with no projectile: the impact plays on the target. [wiki: Battle mage casts god spells]
    magic: [{ name: "God spell", gfx: { impact }, damaging: true }],
});

// The King Black Dragon: half his breaths are fire, the other half his three specials in equal
// shares [wiki: Mod Ash], flown as DRAGON_RANGED_FIRE / TOXIC / ICE / LIGHTNING_ATTACK.
const kingBlackDragon: NpcEffects = {
    breaths: [
        { name: "fiery", weight: 3, gfx: { projectile: 393 }, max: 65, shieldedMax: 15, message: "You're horribly burnt by the dragon's fiery breath!" },
        { name: "toxic", weight: 1, gfx: { projectile: 394 }, max: 50, shieldedMax: 10, message: "You're badly scalded by the dragon's toxic breath!", effect: "poison" },
        { name: "icy", weight: 1, gfx: { projectile: 395 }, max: 50, shieldedMax: 10, message: "You're chilled to the bone by the dragon's icy breath!", effect: "freeze" },
        { name: "shocking", weight: 1, gfx: { projectile: 396 }, max: 50, shieldedMax: 10, message: "You're zapped by the dragon's shocking breath!", effect: "shock" },
    ],
};

// Scurrius, by the graphics on his model's ids (50142-50155) and their VFX_RAT_BOSS_* sequences:
// the fur ball (on the projectile spin PROJANIM_DUKE_SPIT) and its impact (PROJ_RANGED_IMPACT_02),
// the bolt of electricity (PROJ_MAGIC), its cast glow (ATTACK_MAGIC) and impact (PROJ_MAGIC_IMPACT),
// and the falling debris of his stomp (FALLING_DEBRIS).
const scurrius: NpcEffects = {
    ranged: { projectile: 2642, impact: 2643 },
    magic: [{ name: "Bolts of Electricity", gfx: { cast: 2638, projectile: 2640, impact: 3845 }, damaging: true }],
    other: [2644],
};

/**
 * The bear traps Callisto and Artio roar across their dens: the trap loc (47146) appearing
 * (FX_CALLISTO_TRAP, sequence TRAP_BEAR01_SPAWN), waiting (TRAP_BEAR01_IDLE) and snapping shut
 * (TRAP_BEAR01_ACTIVATE).
 */
export const BEAR_TRAP_GFX = { spawn: 2343, idle: "2343@10000", spring: "2343@9999" } as const satisfies Record<string, GfxId>;
/** The red glow of their roar: FX_CALLISTO_ENRAGE, and its _SMALL version for the smaller Artio. */
export const BEAR_ENRAGE_GFX = { callisto: 2352, artio: 2353 } as const;

// Callisto and Artio [wiki: Callisto, Artio and their Strategies pages]: crescents shot from the
// den's far side (FX_CALLISTO_RANGED_SPOTANIM / _PROJECTILE / _IMPACT), and the slow knockback orb,
// which "uses the same projectile ... as the King Black Dragon's icy breath" [wiki: Callisto trivia].
// Neither page says how long the knockback stuns, nor that Artio's does. [design: Callisto 2 ticks]
const bearKnockBack = (stun: number, trapsBlock: boolean): NpcSpell => ({
    name: "Knockback",
    gfx: { projectile: 395 },
    damaging: true,
    knockBack: { tiles: 3, damage: [50, 35, 20, 5], stun, trapsBlock },
});
const bear = (enrage: number, knockBack: NpcSpell): NpcEffects => ({
    ranged: { cast: 2349, projectile: 2350, impact: 2351 },
    magic: [knockBack],
    other: [enrage, BEAR_TRAP_GFX.spawn, BEAR_TRAP_GFX.idle, BEAR_TRAP_GFX.spring],
});

/** Effects by NPC id. */
export const NPC_EFFECTS: Record<number, NpcEffects> = {
    // ----- Magic -----
    512: DARK_WIZARD_7, 5086: DARK_WIZARD_7, 5087: DARK_WIZARD_7,
    510: DARK_WIZARD_20, 5088: DARK_WIZARD_20, 5089: DARK_WIZARD_20,
    // Dark Wizards' Tower and Kourend versions: the wiki names no spells. [design: the level 7 and 20 sets]
    2058: DARK_WIZARD_7, 2059: DARK_WIZARD_7, 2056: DARK_WIZARD_20, 2057: DARK_WIZARD_20,
    1559: elementalWizard("wind-strike", "Wind Strike"),
    1557: elementalWizard("water-strike", "Water Strike"),
    1558: elementalWizard("earth-strike", "Earth Strike"),
    1556: elementalWizard("fire-strike", "Fire Strike"),
    3257: { magic: [strike("fire-strike", "Fire Strike")] }, // Wizard [wiki: "resembles Fire Strike"]
    // Necromancer (Ardougne): Weaken, Strength -floor(5%)-1, not recast while drained [wiki drain table].
    1025: { magic: [weaken({ skills: ["melee"], percent: 0.05, flat: 1 })].map((s) => ({ ...s, onlyIfUndrained: true })) },
    // Necromancer (Great Kourend): magic and Weaken [wiki]; its damaging spell's look is unknown.
    11088: { magic: [unknownMagic, { ...weaken({ skills: ["melee"], percent: 0.05, flat: 1 }), onlyIfUndrained: true }] },
    // Invrigar the Necromancer: Attack, Strength and Defence -5 [wiki drain table].
    511: { magic: [unknownMagic, confuse(MELEE_5), weaken(MELEE_5), curse({ skills: ["defence"], flat: 5 })] },
    // Skeleton Mage (83): "resembles Fire Strike ... sometimes Vulnerability" [wiki].
    4319: { magic: [{ name: "Fire Strike", gfx: { ...spell("fire-strike"), cast: 997 }, damaging: true }, vulnerability] },
    // Chaos druid: Confuse and Bind combined, "binding their target very briefly" [wiki]. [design: 1.8 s]
    520: { magic: [{ name: "Bind", gfx: { ...spell("confuse"), impact: 181 }, damaging: false, bind: 1.8 }] },
    3258: { magic: [{ name: "Entangle", gfx: { cast: 177, projectile: 178, impact: 179 }, damaging: true }] }, // Druid [wiki: like Entangle]
    // Infernal Mage: SLAYER_INFERNALMAGE_MAGICDART_TRAVEL / IMPACT.
    443: { magic: [{ name: "Magic dart", gfx: { projectile: 330, impact: 331 }, damaging: true }] },
    444: { magic: [{ name: "Magic dart", gfx: { projectile: 330, impact: 331 }, damaging: true }] },
    445: { magic: [{ name: "Magic dart", gfx: { projectile: 330, impact: 331 }, damaging: true }] },
    446: { magic: [{ name: "Magic dart", gfx: { projectile: 330, impact: 331 }, damaging: true }] },
    447: { magic: [{ name: "Magic dart", gfx: { projectile: 330, impact: 331 }, damaging: true }] },
    1611: battleMage(76), // Saradomin: SARADOMIN_LIGHTNING
    1610: battleMage(78), // Zamorak: ZAMORAK_FLAME
    1612: battleMage(77), // Guthix: GUNTHIX_CLAW
    // Suqah: "weaker versions of Ice Barrage and Water Wave" [wiki].
    ...Object.fromEntries(
        [787, 788, 789, 790, 791, 792, 793].map((id) => [
            id,
            { magic: [{ name: "Ice Barrage", gfx: { projectile: 368, impact: 369 }, damaging: true }, strike("water-wave", "Water Wave")] },
        ]),
    ),
    // Tortoise: "the mage will use a bluish spell, the archer will shoot a steel arrow" [wiki]. [design: Water Strike]
    6076: { magic: [strike("water-strike", "Water Strike")], ranged: ARROW.steel },
    // Bosses, by their Jagex graphic names.
    6609: bear(BEAR_ENRAGE_GFX.callisto, bearKnockBack(2 * 0.6, true)), // Callisto
    11992: bear(BEAR_ENRAGE_GFX.artio, bearKnockBack(0, false)), // Artio
    6610: { ranged: { projectile: 2356, impact: 2357 }, magic: [{ name: "Magic", gfx: { projectile: 2358, impact: 2359 }, damaging: true }] }, // Venenatis
    6611: { magic: [{ name: "Lightning", gfx: { cast: 2344, impact: 2346 }, damaging: true }] }, // Vet'ion
    8058: { ranged: { projectile: 1477, impact: 1478 }, magic: [{ name: "Magic", gfx: { projectile: 1479, impact: 1480 }, damaging: true }] }, // Vorkath
    7221: scurrius, 7222: scurrius,
    239: kingBlackDragon,
    // Chaos Elemental: Discord, its damaging attack. [design: both styles]
    2054: {
        magic: [{ name: "Discord", gfx: { cast: 556, projectile: 557, impact: 558 }, damaging: true }],
        ranged: { cast: 556, projectile: 557, impact: 558 },
    },

    // ----- Ranged -----
    ...Object.fromEntries([935, 931, 932, 933, 934, 4135, 4136, 4137, 4138, 4139, 5830, 1876].map((id) => [id, troll])),
    ...Object.fromEntries([6914, 6915, 6916, 6917, 8563, 6918, 6919, 8564].map((id) => [id, lizardman])),
    6766: { ranged: { projectile: 1293, impact: 1294 } }, // Lizardman shaman: LIZARDSHAMAN_SPIT_ACID / ACID_SPLASH
    6767: { ranged: { projectile: 1293, impact: 1294 } },
    ...Object.fromEntries([2648, 2650, 2645, 2652, 2647, 2634, 2649, 2646, 2651].map((id) => [id, blamishSnail])),
    // Falador guards fire crossbows [wiki]; Hosidius guards too. [design]
    3270: { ranged: BOLT }, 3273: { ranged: BOLT }, 3274: { ranged: BOLT }, 397: { ranged: BOLT }, 398: { ranged: BOLT },
    6618: { ranged: BOLT }, 7806: { ranged: BOLT }, // Crazy and Deranged archaeologist [design: crossbow]
    // Elves fire crystal bows: SP_ATTACK_GLOW_ARROW_TRAVEL, the glowing arrow. [design]
    5295: { ranged: ARROW.crystal }, 5296: { ranged: ARROW.crystal }, 3428: { ranged: ARROW.crystal },
    // Archers, barbarians, gnomes and monkey archers: plain arrows. [design: bronze, iron for the higher levels]
    3301: { ranged: ARROW.iron }, 4096: { ranged: ARROW.iron }, 4097: { ranged: ARROW.iron }, 4098: { ranged: ARROW.iron },
    6056: { ranged: ARROW.iron },
    3068: { ranged: ARROW.bronze }, 10986: { ranged: ARROW.bronze },
    5968: { ranged: ARROW.bronze }, 5970: { ranged: ARROW.bronze }, 5969: { ranged: ARROW.bronze },
    6094: { ranged: ARROW.bronze }, 6095: { ranged: ARROW.bronze }, 6096: { ranged: ARROW.bronze },
    5966: { ranged: ARROW.bronze }, 5967: { ranged: ARROW.bronze }, 4973: { ranged: ARROW.bronze }, 4974: { ranged: ARROW.bronze },
    6813: { ranged: ARROW.iron }, 5272: { ranged: ARROW.iron }, 5273: { ranged: ARROW.iron }, 5274: { ranged: ARROW.iron },

    // ----- Drains on hit (any style) [wiki: Temporary skill drain] -----
    // Aberrant spectre, without a nose peg or Slayer helmet: Attack, Strength, Ranged, Magic -80%, Defence -40%.
    ...Object.fromEntries(
        [2, 3, 4, 5].map((id) => [
            id,
            {
                onHit: [
                    { chance: 1, drain: { skills: ["melee", "ranged", "magic"], percent: 0.8 }, blockedBy: /nose peg|slayer helmet/i, message: "The aberrant spectre's stench drains your stats!" },
                    { chance: 1, drain: { skills: ["defence"], percent: 0.4 }, blockedBy: /nose peg|slayer helmet/i },
                ],
            },
        ]),
    ),
    // Banshee, without earmuffs or a Slayer helmet: Attack, Strength, Ranged, Magic -20%, Defence -10%.
    414: {
        onHit: [
            { chance: 1, drain: { skills: ["melee", "ranged", "magic"], percent: 0.2 }, blockedBy: /earmuffs|slayer helmet/i, message: "The banshee's scream drains your stats!" },
            { chance: 1, drain: { skills: ["defence"], percent: 0.1 }, blockedBy: /earmuffs|slayer helmet/i },
        ],
    },
    // Leech: 1 from up to 4 skills on each successful hit. [design: 1 to 4 of the drainable skills]
    3233: { onHit: [{ chance: 1, drain: { skills: ALL_COMBAT, flat: 1 }, randomSkills: [1, 4] }] },
    // Loar Shade: 1/20 on a damaging hit, Strength -1.
    1276: { onHit: [{ chance: 1 / 20, drain: { skills: ["melee"], flat: 1 }, damagingOnly: true }] },
    // Feral Vampyre: Strength -1, "unknown percentage of attacks". [design: 1 in 8]
    3237: { onHit: [{ chance: 1 / 8, drain: { skills: ["melee"], flat: 1 }, message: "The vampyre's bite drains your strength." }] },
    // Mourner (level 11 and 13): its vial lowers all combat stats to 20. [design: on its first hit of a fight]
    9233: { onHit: [{ chance: 1, drain: { skills: ALL_COMBAT, to: 20 }, once: true, message: "The Mourner throws a vial at you!" }] },
    9230: { onHit: [{ chance: 1, drain: { skills: ALL_COMBAT, to: 20 }, once: true, message: "The Mourner throws a vial at you!" }] },
};

/** Every spot animation the table uses, for the export. */
export function npcGraphicIds(): GfxId[] {
    const ids = new Set<GfxId>();
    const add = (g?: AttackGfx) => [g?.cast, g?.projectile, g?.impact].forEach((id) => id !== undefined && ids.add(id));
    for (const e of Object.values(NPC_EFFECTS)) {
        add(e.ranged);
        e.magic?.forEach((s) => add(s.gfx));
        e.breaths?.forEach((b) => add(b.gfx));
        e.other?.forEach((id) => ids.add(id));
    }
    return [...ids].sort((a, b) => parseFloat(String(a)) - parseFloat(String(b)) || String(a).localeCompare(String(b)));
}

/** Levels a drain takes from one skill at this current level. */
export function drainAmount(drain: Drain, current: number): number {
    if (drain.to !== undefined) return Math.max(0, current - drain.to);
    return Math.floor(current * (drain.percent ?? 0)) + (drain.flat ?? 0);
}

/**
 * The spell an NPC casts for this attack, or undefined if it has no spell list. Spells that may
 * not be recast while their drain lasts are left out until it has worn off.
 */
export function pickNpcSpell(npcId: number, random: () => number, drained?: (skill: SkillId) => boolean): NpcSpell | undefined {
    const all = NPC_EFFECTS[npcId]?.magic;
    if (!all) return undefined;
    const list = all.filter((s) => !(s.onlyIfUndrained && s.drain && drained && s.drain.skills.some(drained)));
    if (list.length === 0) return all.find((s) => s.damaging);
    return list[Math.floor(random() * list.length) % list.length];
}

/** The breath a dragon breathes for this dragonfire attack, by weight; undefined if it has none listed. */
export function pickBreath(npcId: number, random: () => number): DragonBreath | undefined {
    const breaths = NPC_EFFECTS[npcId]?.breaths;
    if (!breaths?.length) return undefined;
    let r = random() * breaths.reduce((sum, b) => sum + b.weight, 0);
    for (const b of breaths) {
        r -= b.weight;
        if (r < 0) return b;
    }
    return breaths[breaths.length - 1];
}

/** True for an NPC whose poison comes only from a breath (the King Black Dragon's toxic breath). */
export function poisonsOnlyByBreath(npcId: number): boolean {
    return !!NPC_EFFECTS[npcId]?.breaths?.some((b) => b.effect === "poison");
}
