// Combat sound effects taken from the OSRS cache (index 4), by their Jagex names (OSRS Wiki
// "List of sound IDs"). tools/world-export renders each to public/world/sounds/<name>.wav; the game
// plays them. Footsteps are not here: the cache has none per ground type (see Footsteps.ts).

export const CACHE_SOUNDS = {
    // Weapon swings.
    hacksword_slash: 2500,
    hacksword_stab: 2501,
    stabsword_slash: 2548,
    stabsword_stab: 2549,
    keris_slash: 2506,
    keris_stab: 2507,
    mace_crush: 2508,
    warhammer_crush: 2567,
    "2H_slash": 2503,
    "2H_crush": 2502,
    staff_crush: 2556,
    staff_stab: 2562,
    staff_double: 2557,
    unarmed_punch: 2566,
    unarmed_kick: 2565,
    human_attack: 2564,
    shortbow: 2702,
    // Blows landing, blocks and the player's body.
    sword_hit: 2510,
    clobber: 2531,
    staff_hit: 2560,
    leather_hit: 24,
    slice_arrow_hit: 3573,
    human_block_1: 511,
    swordclash3: 1975,
    swordclash4: 21,
    swordclash5: 1971,
    land_flat: 2469,
    watersplash: 2496,
    // Voices: attack, hit and death of each kind of body.
    human_hit: 513,
    human_hit2: 514,
    human_hit3: 515,
    human_hit4: 516,
    human_hit5: 517,
    human_death: 512,
    female_hit: 506,
    female_hit1: 507,
    female_hit2: 508,
    female_death: 505,
    goblin_attack: 469,
    goblin_hit: 472,
    goblin_death: 471,
    zombie_attack: 918,
    zombie_hit: 923,
    zombie_death: 922,
    skeleton_attack: 776,
    skelly_hit: 779,
    skeleton_death: 777,
    ghost_attack: 436,
    ghost_hit: 439,
    ghost_death: 438,
    wolf_attack: 909,
    wolf_hit: 912,
    wolf_death: 911,
    dog_attack: 3717,
    dog_hit: 3719,
    dog_death: 3718,
    rat_attack: 710,
    rat_hit: 713,
    rat_death: 711,
    dragon_attack: 408,
    dragon_hit: 410,
    dragon_death: 409,
    troll_attack: 861,
    troll_hit: 868,
    troll_death: 866,
    giant_attack: 448,
    giant_hit: 451,
    giant_death: 450,
    demon_attack: 400,
    demon_hit: 404,
    demon_death: 403,
    big_spider_attack: 3605,
    big_spider_hit: 3607,
    big_spider_death: 3606,
    scorpion_attack: 3611,
    scorpion_hit: 3612,
    scorpion_death: 3610,
    cow_attack: 369,
    cow_hit: 371,
    cow_death: 370,
    chicken_attack: 355,
    chicken_hit: 357,
    chicken_death: 356,
    imp_attack: 534,
    imp_hit: 536,
    imp_death: 535,
    dwarf_attack: 417,
    dwarf_hit: 419,
    dwarf_death: 418,
} as const;

export type CacheSound = keyof typeof CACHE_SOUNDS;

export type Voice = { attack: CacheSound[]; hit: CacheSound[]; death: CacheSound[] };

const creature = (name: string): Voice => ({
    attack: [`${name}_attack` as CacheSound],
    hit: [`${name}_hit` as CacheSound],
    death: [`${name}_death` as CacheSound],
});

/** The sounds each kind of body makes. Human-kit NPCs strike with their weapon's swing instead. */
export const VOICES = {
    human: { attack: ["human_attack"], hit: ["human_hit", "human_hit2", "human_hit3", "human_hit4", "human_hit5"], death: ["human_death"] },
    female: { attack: ["human_attack"], hit: ["female_hit", "female_hit1", "female_hit2"], death: ["female_death"] },
    goblin: creature("goblin"),
    zombie: creature("zombie"),
    skeleton: { attack: ["skeleton_attack"], hit: ["skelly_hit"], death: ["skeleton_death"] },
    ghost: creature("ghost"),
    wolf: creature("wolf"),
    dog: creature("dog"),
    rat: creature("rat"),
    dragon: creature("dragon"),
    troll: creature("troll"),
    giant: creature("giant"),
    demon: creature("demon"),
    spider: creature("big_spider"),
    scorpion: creature("scorpion"),
    cow: creature("cow"),
    chicken: creature("chicken"),
    imp: creature("imp"),
    dwarf: creature("dwarf"),
} satisfies Record<string, Voice>;

export type VoiceName = keyof typeof VOICES;

/**
 * Which voice a body has, from the words of its idle animation's Jagex name (an NPC whose idle is
 * "SLICE_SURFACE_GOBLIN_SQUAT_READY" is a goblin) or, for NPCs on the player's skeleton, whether
 * its name reads as a woman's.
 */
export function voiceFor(idleAnimationName: string | undefined, humanKit: boolean, npcName: string): VoiceName | undefined {
    const words = new Set((idleAnimationName ?? "").split("_"));
    const has = (...w: string[]) => w.some((x) => words.has(x));
    if (has("GOBLIN", "HOBGOBLIN")) return "goblin";
    if (has("ZOMBIE")) return "zombie";
    if (has("SKELETON", "SKELLY")) return "skeleton";
    if (has("GHOST", "SPECTER", "BANSHEE")) return "ghost";
    if (has("WOLF")) return "wolf";
    if (has("DOG", "JACKAL")) return "dog";
    if (has("RAT", "MOUSE")) return "rat";
    if (has("DRAGON")) return "dragon";
    if (has("TROLL")) return "troll";
    if (has("GIANT", "OGRE", "CYCLOPS", "ZOGRE")) return "giant";
    if (has("DEMON", "DEMONS", "ABYSSAL", "IMP")) return has("IMP") ? "imp" : "demon";
    if (has("SPIDER")) return "spider";
    if (has("SCORPION")) return "scorpion";
    if (has("COW", "YAK")) return "cow";
    if (has("CHICKEN", "BIRD", "DUCK", "PENG")) return "chicken";
    if (has("DWARF")) return "dwarf";
    if (humanKit || has("HUMAN", "PRISONER", "BARROW")) {
        return /\b(woman|lady|girl|female|queen|princess|priestess|witch|nun|mother|wife|sister|duchess|maiden)\b/i.test(npcName)
            ? "female"
            : "human";
    }
    return undefined;
}
