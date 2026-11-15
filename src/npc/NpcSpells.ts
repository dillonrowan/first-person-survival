import type { SkillId } from "../combat/SkillId";
import { SPELL_GRAPHICS, type SpellGraphics } from "../world/SpellGfxFormat";

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

export type NpcEffects = {
    /** One picked at random per magic attack. */
    magic?: NpcSpell[];
    ranged?: AttackGfx;
    onHit?: HitEffect[];
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
    6609: { ranged: { cast: 2349, projectile: 2350, impact: 2351 }, magic: [{ name: "Shockwave", gfx: { projectile: 395 }, damaging: true }] }, // Callisto [wiki: the KBD's icy breath projectile]
    6610: { ranged: { projectile: 2356, impact: 2357 }, magic: [{ name: "Magic", gfx: { projectile: 2358, impact: 2359 }, damaging: true }] }, // Venenatis
    6611: { magic: [{ name: "Lightning", gfx: { cast: 2344, impact: 2346 }, damaging: true }] }, // Vet'ion
    8058: { ranged: { projectile: 1477, impact: 1478 }, magic: [{ name: "Magic", gfx: { projectile: 1479, impact: 1480 }, damaging: true }] }, // Vorkath
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
export function npcGraphicIds(): number[] {
    const ids = new Set<number>();
    const add = (g?: AttackGfx) => [g?.cast, g?.projectile, g?.impact].forEach((id) => id !== undefined && ids.add(id));
    for (const e of Object.values(NPC_EFFECTS)) {
        add(e.ranged);
        e.magic?.forEach((s) => add(s.gfx));
    }
    return [...ids].sort((a, b) => a - b);
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
