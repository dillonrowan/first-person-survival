import { ADJACENT, AttackStyle, ProjectileKind } from "../../../src/npc/AttackStyle";

/**
 * Rules of OSRS combat that the wiki's attack styles do not encode (server behaviour). Keyed by wiki
 * page name (WikiAttackRow.page); a rule applies to every id of that page. Anything not named here
 * gets the defaults of NpcAttackRules.ts.
 */
export type StyleRule = {
    /** Pick weight against the NPC's other styles. */
    weight?: number;
    /** Closest gap the attack starts from, tiles. */
    minGap?: number;
    /** Furthest gap the attack starts from, tiles. */
    maxGap?: number;
    hitPow?: number;
    projectile?: ProjectileKind;
    color?: number;
    /**
     * Cache sequence id of the body animation, when the name heuristic picks the wrong one; a list
     * bakes one clip each (Scurrius's two tail swipes).
     */
    seq?: number | readonly number[];
    /** Dragonfire as a fireball projectile from range instead of a breath cone at melee distance. */
    longRange?: boolean;
};

export type NpcAttackOverride = {
    styles?: Partial<Record<AttackStyle, StyleRule>>;
    /** Sequences baked as extra clips (NpcModelData.extras) for a boss fight to play by id. */
    extraSeqs?: readonly number[];
    note?: string;
};

const A = ADJACENT;
const ROCK_GREY = 0x777777;
const ROCK_BROWN = 0x6b4a2b;
const SPIT_GREEN = 0x55cc33;
const LONG_RANGE_FIRE: NpcAttackOverride = { styles: { dragonfire: { longRange: true } } };
const BEAR: NpcAttackOverride = {
    styles: { ranged: { minGap: A, projectile: "rock", color: 0xd8d0c0 }, magic: { minGap: 0, weight: 0.25 } },
    extraSeqs: [
        10015, // NPC_CALLISTO_ENRAGED01: the roar
        10017, // NPC_CALLISTO_DEATH01
    ],
};

export const OVERRIDES: Record<string, NpcAttackOverride> = {
    // Melee when adjacent, the other style otherwise.
    "Crazy archaeologist": { styles: { ranged: { minGap: A, projectile: "rock", color: ROCK_BROWN } } },
    "Deranged archaeologist": { styles: { ranged: { minGap: A, projectile: "rock", color: ROCK_BROWN } } },
    // Callisto and Artio swipe when they can reach the player and fire crescents when they cannot
    // [wiki]; now and then the knockback orb, from any distance ("occasionally"). [design: 1 in 5]
    // Their fight is src/npc/Callisto.ts: the roar that lays the bear traps, and their death.
    Callisto: BEAR,
    Artio: BEAR,
    Venenatis: { styles: { ranged: { minGap: A }, magic: { minGap: A } }, note: "TODO special: webs, spiderlings." },
    // Her magic is lightning (KALPHITE_LIGHTNING); the wiki: ranged spines shot from her abdomen.
    "Kalphite Queen": { styles: { ranged: { minGap: A }, magic: { minGap: A, seq: 1172 } } },
    "Demonic gorilla": { styles: { ranged: { minGap: A }, magic: { minGap: A } } },
    "Tortured gorilla": { styles: { ranged: { minGap: A }, magic: { minGap: A } } },
    "Lizardman shaman": {
        styles: { ranged: { minGap: A, projectile: "spit", color: SPIT_GREEN } },
        note: "TODO special: jump, spawns, acid.",
    },
    Arrg: { styles: { ranged: { minGap: A, projectile: "rock", color: ROCK_GREY } } },
    "General Graardor": { styles: { ranged: { minGap: A, projectile: "rock", color: ROCK_GREY } } },
    "The Inadequacy": { styles: { ranged: { minGap: A, projectile: "rock", color: ROCK_GREY } } },
    // Own animations found with list-npc-seqs.ts (the Suqah has no cast, so it keeps its melee one).
    Tortoise: { styles: { ranged: { seq: 3954 } } }, // BATTLE_TORTOISE_ARCHER_ATTACK
    "Chaos Elemental": { styles: { ranged: { seq: 3148 }, magic: { seq: 3149 } } }, // DISCORD, CASTING
    "Commander Zilyana": { styles: { magic: { minGap: A } } },
    "K'ril Tsutsaroth": { styles: { magic: { minGap: A } } },
    "Vet'ion": {
        styles: { magic: { weight: 4, color: 0x9933ff } },
        note: "TODO special: shield bash stun, hellhounds, enrage.",
    },
    Lizardman: { styles: { ranged: { projectile: "spit", color: SPIT_GREEN } } },
    "Lizardman brute": { styles: { ranged: { projectile: "spit", color: SPIT_GREEN } } },
    "Thrower Troll": { styles: { ranged: { projectile: "rock", color: ROCK_GREY } } },
    "Thrower troll (Trollheim)": { styles: { ranged: { projectile: "rock", color: ROCK_GREY } } },
    "Ice troll female": { styles: { ranged: { projectile: "rock", color: ROCK_GREY } } },
    Gnome: { styles: { ranged: { projectile: "arrow" } } },
    "Gnome troop": { styles: { ranged: { projectile: "arrow" } } },

    // Dragons that breathe from range.
    "Bronze dragon": LONG_RANGE_FIRE,
    "Iron dragon": LONG_RANGE_FIRE,
    "Steel dragon": LONG_RANGE_FIRE,
    "Mithril dragon": LONG_RANGE_FIRE,
    "Adamant dragon": LONG_RANGE_FIRE,
    "Rune dragon": LONG_RANGE_FIRE,
    "Brutal black dragon": LONG_RANGE_FIRE,
    "Brutal blue dragon": LONG_RANGE_FIRE,
    "Brutal green dragon": LONG_RANGE_FIRE,
    "Brutal red dragon": LONG_RANGE_FIRE,
    // The wiki: Vorkath spits fireballs; its magic and dragonfire use the pose of its ranged spit.
    Vorkath: {
        styles: { dragonfire: { longRange: true, seq: 7952 }, magic: { seq: 7952 } }, // DS2_VORKATH_RANGED
        note: "TODO special: dragonfire bomb, freeze, venom.",
    },
    // A drake has no breath sequence; it breathes fire with the pose of its ranged attack.
    Drake: { styles: { dragonfire: { longRange: true, seq: 8276 } } }, // DRAKE_RANGED
    // The King Black Dragon: next to the player one attack in three is melee, the rest breaths [wiki:
    // Mod Ash]; he claws and butts with his heads, breathes with all three, and dies as dragons do.
    "King Black Dragon": {
        styles: {
            melee: { seq: [80, 91], weight: 1 }, // DRAGON_ATTACK, DRAGON_HEAD_ATTACK
            dragonfire: { longRange: true, hitPow: 2.5, seq: 81, weight: 2 }, // DRAGON_FIREBREATH_ALL_ATTACK
        },
        extraSeqs: [92], // DRAGON_DEATH
    },
    // Attacks the names do not give, checked against the OSRS Wiki's account of each fight
    // (tools/world-export/audit-npc-attacks.ts lists what the export picked).
    Cerberus: { styles: { magic: { seq: 4490 } } }, // CERBERUS_ATTACK_RANGE: both are balls from her mouths
    "Skeletal Wyvern": { styles: { ranged: { seq: 2989 } } }, // WYVERN_SKELETON_ICEBALL: "Iceball"
    "Corporeal Beast": { styles: { magic: { seq: 1679 } } }, // CORPBEAST_SPRITE_SHOOT_1
    Sotetseg: { styles: { magic: { seq: 8139 } } }, // TOB_SOTETSEG_ATTACK_RANGED: red and grey balls alike
    // Volleys of orbs (blue magic, green ranged), not its spit.
    "The Leviathan": { styles: { ranged: { seq: 10281 }, magic: { seq: 10281 } } }, // NPC_LEVIATHAN_01_PROJECTILE_SINGLE_01
    Zebak: { styles: { magic: { seq: 9624 } } }, // NPC_ZEBAK01_ATTACK_RANGED: spits the pot as it spits the rock
    "TzHaar-Xil": { styles: { ranged: { seq: 2611 } } }, // THZAAR_RING_ATTACK: the throwing ring
    "Experiment No.2": { styles: { ranged: { seq: 6514 } } }, // GRIM_EXPERIMENT_NO2_PROJ_ATTACK: throws the ogleroot
    "Nylocas Vasilias": { styles: { magic: { seq: 4410 } } }, // HOSDUN_SPIDER_BOSS_ATTACK_RANGED: only the carapace colour differs
    "Long-tailed Wyvern": { styles: { ranged: { seq: 7657 } } }, // FOSSIL_NPC_WYVERN_FLIGHT_FIRE, not its claw
    "Taloned Wyvern": { styles: { ranged: { seq: 7657 } } },
    "Spitting Wyvern": { styles: { ranged: { seq: 7657 } } },
    "Ancient Wyvern": { styles: { ranged: { seq: 7657 } } },
    // Obor clubs with the hill giant's attack (his slam, src/npc/Obor.ts) and throws with the giants'
    // forward thrust; he dies as hill giants do.
    Obor: {
        styles: {
            melee: { seq: 4652 }, // GIANT_UPDATE_BASIC_ATTACK
            ranged: { seq: 7173, projectile: "rock", color: 0x8a7a66 }, // GIANT_BASIC_SPELL
        },
        extraSeqs: [
            4653, // GIANT_UPDATE_BASIC_DEATH
        ],
    },
    // Bryophyta clubs with the moss giant's attack and casts with the giants' spell; she stamps to call
    // up her growthlings and dies as moss giants do (src/npc/Bryophyta.ts plays these by id).
    Bryophyta: {
        styles: {
            melee: { seq: 4658 }, // GIANT_UPDATE_MOSS_ATTACK
            magic: { seq: 7173, color: 0x5fae3a }, // GIANT_BASIC_SPELL
        },
        extraSeqs: [
            7183, // GIANT_BASIC_STAMP
            4659, // GIANT_UPDATE_MOSS_DEATH
        ],
    },
    // Scurrius: his two tail swipes, the fur he flings and the lightning he calls. The extra clips are
    // the rest of his fight (src/npc/Scurrius.ts plays them by id): the stomp that brings the bricks
    // down, the screech that calls the rats, eating at a food pile, the run there, the enrage at 30%,
    // the feeding versions of his attacks, his spawn and his death.
    Scurrius: {
        styles: {
            melee: { seq: [10692, 10693] }, // NPC_RAT_BOSS_ATTACK_MELEE_01, _02
            ranged: { seq: 10694, projectile: "rock", color: 0x8a7a66 }, // NPC_RAT_BOSS_ATTACK_RANGED_01
            magic: { seq: 10696, color: 0x6fb8ff }, // NPC_RAT_BOSS_ATTACK_MAGIC_01
        },
        extraSeqs: [
            10686, // SPAWN_01
            10688, // FEEDING_IDLE_01
            10689, // FEEDING_IDLE_02
            10691, // RUN_01
            10695, // FEEDING_ATTACK_RANGED_01
            10697, // FEEDING_ATTACK_MAGIC_01
            10698, // ATTACK_STOMP_01
            10699, // FEEDING_ATTACK_STOMP_01
            10700, // ATTACK_SUMMON_01
            10702, // FEEDING_ATTACK_SUMMON_01
            10704, // ENRAGE_01
            10705, // DEATH_01
        ],
    },
};
