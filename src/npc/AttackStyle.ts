/**
 * Attack styles of NPCs. The OSRS cache does not say which styles an NPC uses (server data); they
 * come from the OSRS wiki (tools/world-export/data/npc-attacks-wiki.json) and are written into
 * npcs.json as NpcAppearanceInfo.attackStyles.
 */
export type AttackStyle = "melee" | "ranged" | "magic" | "dragonfire" | "icebreath";
export type ProjectileKind = "arrow" | "orb" | "rock" | "spit" | "fireball";

/** Byte codes for the .bin format. Never renumber. */
export const STYLE_CODES: Record<AttackStyle, number> = { melee: 0, ranged: 1, magic: 2, dragonfire: 3, icebreath: 4 };
export const STYLE_FROM_CODE: AttackStyle[] = ["melee", "ranged", "magic", "dragonfire", "icebreath"];

/** Gap (tiles between body edges) that counts as "next to the player". */
export const ADJACENT = 1.0;
/** Furthest gap a ranged, magic or fireball attack starts from, tiles. */
export const RANGED_MAX = 8;

export type BreathInfo = {
    /** Cone length, tiles. */
    length: number;
    /** Half angle of the cone, radians. */
    halfAngle: number;
    /** Seconds the breath lasts. */
    duration: number;
    /** Damage ticks over the duration. */
    ticks: number;
    element: "fire" | "ice";
};

export type ProjectileInfo = { kind: ProjectileKind; speed: number; color: number };

/** One attack style of an NPC, as written to npcs.json (NpcAppearanceInfo.attackStyles). */
export type NpcStyledAttackInfo = {
    style: AttackStyle;
    /** Relative pick chance for the whole style; split evenly over the style's clips. */
    weight: number;
    hitPow: number;
    minGap: number;
    /** Omitted for melee: melee uses its clip reach (range + lunge). */
    maxGap?: number;
    projectile?: ProjectileInfo;
    breath?: BreathInfo;
    /** Multiplies the cooldown after this attack (wiki attack speed / 4 ticks). */
    cooldownScale?: number;
};

/** Maps one raw wiki attack_style string to a style; undefined means ignore it. */
export function styleFromWiki(raw: string): AttackStyle | undefined {
    const t = raw.toLowerCase();
    if (t.includes("dragonfire")) return "dragonfire";
    if (t.includes("icy breath")) return "icebreath";
    if (t.includes("magical melee") || t.includes("ranged melee")) return "melee";
    if (t.includes("magic") || t.includes("curse")) return "magic";
    if (t.includes("ranged")) return "ranged";
    if (/stab|slash|crush|melee/.test(t)) return "melee";
    return undefined;
}
