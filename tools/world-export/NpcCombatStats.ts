import type { DefenceType, MeleeType, NpcCombatStats } from "../../src/world/NpcFormat";
import type { WikiAttackRow } from "./fetch-wiki-attacks";

/** The parts of an NpcType this reads. */
export type CombatNpc = {
    /** attack, defence, strength, hitpoints, ranged, magic. */
    stats: number[];
    hasStats: boolean;
    params?: Map<number, unknown>;
    combatLevel: number;
};

/**
 * Levels, bonuses, melee type, speed and max hits of an NPC. Levels come from the cache's stat
 * opcodes (74-79) and bonuses from its params (the same ids as item bonuses: 0-4 attack, 5-9
 * defence, 10 strength, 12 ranged strength, 299 magic damage x10); the wiki fills what the cache
 * lacks. NPC params are incomplete in the cache (no attack bonus, often no ranged defence).
 */
export function combatStatsFor(npc: CombatNpc, wiki?: WikiAttackRow): NpcCombatStats {
    const w = wiki?.stats ?? {};
    const param = (id: number): number | undefined => {
        const v = npc.params?.get(id);
        return typeof v === "number" ? v : undefined;
    };
    const level = (cache: number, fromWiki: number | undefined) =>
        Math.max(1, npc.hasStats ? cache : (fromWiki ?? 1));
    const hitpoints = npc.hasStats
        ? Math.max(1, npc.stats[3])
        : Math.max(1, w.hitpoints ?? (wiki?.stats ? 1 : npc.combatLevel));
    const meleeAttacks = [param(0), param(1), param(2)].filter((v): v is number => v !== undefined);
    const attackBonus = meleeAttacks.length > 0 ? Math.max(...meleeAttacks) : (w.attackBonus ?? 0);
    const rangedDefence = param(9);
    const defenceBonus: Record<DefenceType, number> = {
        stab: param(5) ?? w.defStab ?? 0,
        slash: param(6) ?? w.defSlash ?? 0,
        crush: param(7) ?? w.defCrush ?? 0,
        magic: param(8) ?? w.defMagic ?? 0,
        light: rangedDefence ?? w.defLight ?? 0,
        standard: rangedDefence ?? w.defStandard ?? 0,
        heavy: rangedDefence ?? w.defHeavy ?? 0,
    };
    const meleeStyle = wiki?.styles.find((s) => s.style === "melee");
    const raw = meleeStyle?.raw.toLowerCase() ?? "";
    const meleeType: MeleeType = (["stab", "slash", "crush"] as const).find((t) => raw.includes(t)) ?? "slash";
    const maxHit: NpcCombatStats["maxHit"] = {};
    for (const s of wiki?.styles ?? []) {
        if (s.maxHit !== undefined) maxHit[s.style] = s.maxHit;
    }
    return {
        hitpoints,
        attack: level(npc.stats[0], w.attack),
        strength: level(npc.stats[2], w.strength),
        defence: level(npc.stats[1], w.defence),
        ranged: level(npc.stats[4], w.ranged),
        magic: level(npc.stats[5], w.magic),
        attackBonus,
        strengthBonus: param(10) ?? w.strengthBonus ?? 0,
        rangedAttack: param(4) ?? w.rangedAttack ?? 0,
        rangedStrength: param(12) ?? w.rangedStrength ?? 0,
        magicAttack: param(3) ?? w.magicAttack ?? 0,
        magicDamage: param(299) !== undefined ? param(299)! / 10 : (w.magicDamage ?? 0),
        defenceBonus,
        meleeType,
        speedTicks: wiki?.speedTicks ?? 4,
        maxHit,
        // The wiki gives the starting damage; damage is floor((severity + 4) / 5), so 5 x damage.
        ...(w.poisonous ? { poisonSeverity: 5 * w.poisonous } : {}),
        ...(w.poisonImmune ? { poisonImmune: true } : {}),
    };
}
