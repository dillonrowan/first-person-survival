import {
    ADJACENT,
    AttackStyle,
    BreathInfo,
    NpcStyledAttackInfo,
    ProjectileInfo,
    ProjectileKind,
    RANGED_MAX,
} from "../../src/npc/AttackStyle";
import { NpcAttackOverride, OVERRIDES, StyleRule } from "./data/npc-attack-overrides";
import type { WikiAttackRow } from "./fetch-wiki-attacks";

/** Turns an NPC's wiki attack styles into the attack list the game plays (NpcAppearanceInfo.attackStyles). */

export type StyleRules = {
    infos: NpcStyledAttackInfo[];
    /** Explicit body animations from the overrides, by style. */
    seqs: Partial<Record<AttackStyle, number>>;
};

const SPEED: Record<ProjectileKind, number> = { arrow: 14, orb: 9, rock: 8, spit: 10, fireball: 9 };
/** The primary style's hitPow: a guard's 0.7 (about 5.3 damage). */
const PRIMARY_HIT_POW = 0.7;
const BREATH_HIT_POW = 2.0;
const BREATH: Omit<BreathInfo, "element"> = { length: 3, halfAngle: (30 * Math.PI) / 180, duration: 0.8, ticks: 4 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Colour of a spell's orb from the caster's name. */
export function magicColor(page: string): number {
    const p = page.toLowerCase();
    if (/fire|infernal|pyre/.test(p)) return 0xff7a1a;
    if (/water/.test(p)) return 0x3a7bff;
    if (/earth|druid|moss/.test(p)) return 0x4caf50;
    if (/zamorak|curse|necromancer|dark/.test(p)) return 0xd02020;
    return 0x9b59ff;
}

function projectileFor(style: AttackStyle, rule: StyleRule, page: string): ProjectileInfo | undefined {
    if (style === "ranged") {
        const kind = rule.projectile ?? "arrow";
        return { kind, speed: SPEED[kind], color: rule.color ?? 0xd8c8a0 };
    }
    if (style === "magic") {
        return { kind: "orb", speed: SPEED.orb, color: rule.color ?? magicColor(page) };
    }
    if (style === "dragonfire" && rule.longRange) {
        return { kind: "fireball", speed: SPEED.fireball, color: 0xff7a1a };
    }
    return undefined;
}

/**
 * The attacks of an NPC from its wiki row, or undefined when it has no row, no styles (the wiki
 * lists none) or only melees (it then keeps its melee clips, or the guard's strikes).
 */
export function attackRulesFor(
    row: WikiAttackRow | undefined,
    overrides: Record<string, NpcAttackOverride> = OVERRIDES,
): StyleRules | undefined {
    if (!row || row.styles.length === 0 || (row.styles.length === 1 && row.styles[0].style === "melee")) {
        return undefined;
    }
    const override = overrides[row.page]?.styles ?? {};
    // Melee first: "best first" in the model file.
    const styles = [...row.styles].sort((a, b) => Number(b.style === "melee") - Number(a.style === "melee"));
    const breathes = styles.some((s) => s.style === "dragonfire" || s.style === "icebreath");
    const primary = styles.find((s) => s.style === "melee") ?? styles[0];
    const cooldownScale = clamp((row.speedTicks ?? 4) / 4, 0.5, 2);

    const infos: NpcStyledAttackInfo[] = [];
    const seqs: Partial<Record<AttackStyle, number>> = {};
    for (const s of styles) {
        const rule: StyleRule = override[s.style] ?? {};
        const isBreath = s.style === "dragonfire" || s.style === "icebreath";
        const longRange = s.style === "dragonfire" && !!rule.longRange;

        let hitPow: number;
        if (rule.hitPow !== undefined) {
            hitPow = rule.hitPow;
        } else if (isBreath) {
            hitPow = BREATH_HIT_POW;
        } else if (s === primary) {
            hitPow = PRIMARY_HIT_POW;
        } else if (s.maxHit !== undefined && primary.maxHit !== undefined && primary.maxHit > 0) {
            hitPow = clamp((PRIMARY_HIT_POW * s.maxHit) / primary.maxHit, 0.3, 2.5);
        } else {
            hitPow = PRIMARY_HIT_POW;
        }

        const info: NpcStyledAttackInfo = {
            style: s.style,
            weight: rule.weight ?? (s.style === "melee" && breathes ? 5 : 1),
            hitPow: Math.round(hitPow * 1000) / 1000,
            minGap: rule.minGap ?? 0,
            cooldownScale,
        };
        if (s.style === "ranged" || s.style === "magic") {
            info.maxGap = rule.maxGap ?? RANGED_MAX;
        } else if (isBreath) {
            info.maxGap = rule.maxGap ?? (longRange ? RANGED_MAX : ADJACENT);
        } else if (rule.maxGap !== undefined) {
            info.maxGap = rule.maxGap;
        }
        const projectile = projectileFor(s.style, rule, row.page);
        if (projectile) info.projectile = projectile;
        if (isBreath && !longRange) {
            info.breath = { ...BREATH, element: s.style === "icebreath" ? "ice" : "fire" };
        }
        infos.push(info);
        if (rule.seq !== undefined) seqs[s.style] = rule.seq;
    }
    return { infos, seqs };
}
