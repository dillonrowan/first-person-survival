import type { XpGains } from "./CombatStyles";
import { MAX_XP, combatLevel, levelForXp, xpForLevel } from "./Osrs";

export type SkillId = "melee" | "defence" | "ranged" | "magic" | "hitpoints";
export const SKILLS: SkillId[] = ["melee", "defence", "ranged", "magic", "hitpoints"];
export const SKILL_NAMES: Record<SkillId, string> = {
    melee: "Melee",
    defence: "Defence",
    ranged: "Ranged",
    magic: "Magic",
    hitpoints: "Hitpoints",
};

export type LevelUp = { skill: SkillId; level: number };

const STORAGE_KEY = "first-person-survival.skills.v1";
type SkillStorage = Pick<Storage, "getItem" | "setItem">;

/** Hitpoints start at level 10, every other skill at level 1. */
const START_XP: Record<SkillId, number> = { melee: 0, defence: 0, ranged: 0, magic: 0, hitpoints: xpForLevel(10) };

/** The player skills: XP per skill, saved to storage after every gain. */
export class PlayerSkills {
    private readonly xpOf: Record<SkillId, number> = { ...START_XP };

    constructor(private readonly storage?: SkillStorage) {
        try {
            const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null") as Partial<Record<SkillId, unknown>> | null;
            for (const id of SKILLS) {
                const v = saved?.[id];
                if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
                    this.xpOf[id] = Math.min(MAX_XP, v);
                }
            }
        } catch {
            // Unreadable or corrupt save: start fresh.
        }
    }

    xp(id: SkillId): number {
        return this.xpOf[id];
    }

    level(id: SkillId): number {
        return levelForXp(this.xpOf[id]);
    }

    levels(): Record<SkillId, number> {
        return {
            melee: this.level("melee"),
            defence: this.level("defence"),
            ranged: this.level("ranged"),
            magic: this.level("magic"),
            hitpoints: this.level("hitpoints"),
        };
    }

    combatLevel(): number {
        return combatLevel(this.levels());
    }

    /** Adds XP and returns the levels gained. */
    addXp(gains: XpGains): LevelUp[] {
        const ups: LevelUp[] = [];
        for (const id of SKILLS) {
            const gain = gains[id];
            if (gain === undefined || !Number.isFinite(gain) || gain <= 0) continue;
            const before = this.level(id);
            this.xpOf[id] = Math.min(MAX_XP, this.xpOf[id] + gain);
            const after = this.level(id);
            if (after > before) ups.push({ skill: id, level: after });
        }
        try {
            this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.xpOf));
        } catch {
            // Not saved this time.
        }
        return ups;
    }
}
