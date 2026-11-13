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
    /** Cache sequence id of the body animation, when the name heuristic picks the wrong one. */
    seq?: number;
    /** Dragonfire as a fireball projectile from range instead of a breath cone at melee distance. */
    longRange?: boolean;
};

export type NpcAttackOverride = { styles?: Partial<Record<AttackStyle, StyleRule>>; note?: string };

const A = ADJACENT;
const ROCK_GREY = 0x777777;
const ROCK_BROWN = 0x6b4a2b;
const SPIT_GREEN = 0x55cc33;
const LONG_RANGE_FIRE: NpcAttackOverride = { styles: { dragonfire: { longRange: true } } };

export const OVERRIDES: Record<string, NpcAttackOverride> = {
    // Melee when adjacent, the other style otherwise.
    "Crazy archaeologist": { styles: { ranged: { minGap: A, projectile: "rock", color: ROCK_BROWN } } },
    "Deranged archaeologist": { styles: { ranged: { minGap: A, projectile: "rock", color: ROCK_BROWN } } },
    Callisto: {
        styles: { ranged: { minGap: A, projectile: "rock", color: ROCK_GREY }, magic: { minGap: A, weight: 0.25 } },
        note: "TODO special: knockback and stun of the magic attack, bear traps.",
    },
    Venenatis: { styles: { ranged: { minGap: A }, magic: { minGap: A } }, note: "TODO special: webs, spiderlings." },
    "Kalphite Queen": { styles: { ranged: { minGap: A }, magic: { minGap: A } } },
    "Demonic gorilla": { styles: { ranged: { minGap: A }, magic: { minGap: A } } },
    "Tortured gorilla": { styles: { ranged: { minGap: A }, magic: { minGap: A } } },
    "Lizardman shaman": {
        styles: { ranged: { minGap: A, projectile: "spit", color: SPIT_GREEN } },
        note: "TODO special: jump, spawns, acid.",
    },
    Arrg: { styles: { ranged: { minGap: A, projectile: "rock", color: ROCK_GREY } } },
    "General Graardor": { styles: { ranged: { minGap: A, projectile: "rock", color: ROCK_GREY } } },
    "The Inadequacy": { styles: { ranged: { minGap: A, projectile: "rock", color: ROCK_GREY } } },
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
    Vorkath: { styles: { dragonfire: { longRange: true } }, note: "TODO special: dragonfire bomb, freeze, venom." },
    Drake: LONG_RANGE_FIRE,
    "King Black Dragon": { styles: { dragonfire: { longRange: true, hitPow: 2.5 } } },
};
