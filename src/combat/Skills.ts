import type { XpGains } from "./CombatStyles";
import { MAX_XP, combatLevel, levelForXp, xpForLevel } from "./Osrs";

import type { SkillId } from "./SkillId";

export type { SkillId };
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
/** Temporary drains (current level minus base level per skill), saved apart from the XP. */
const DRAIN_KEY = "first-person-survival.drains.v1";
/** Skills a drain can lower: Hitpoints is health, which damage lowers instead. */
export const DRAINABLE: SkillId[] = ["melee", "defence", "ranged", "magic"];
/** A drained (or boosted) level moves back one level towards its base every 60 seconds [wiki: Temporary skill drain]. */
export const RESTORE_INTERVAL = 60;
type SkillStorage = Pick<Storage, "getItem" | "setItem">;

/** Hitpoints start at level 10, every other skill at level 1. */
const START_XP: Record<SkillId, number> = { melee: 0, defence: 0, ranged: 0, magic: 0, hitpoints: xpForLevel(10) };

/** The player skills: XP per skill, saved to storage after every gain. */
export class PlayerSkills {
    private readonly xpOf: Record<SkillId, number> = { ...START_XP };
    /** Current level minus base level: below 0 while drained. */
    private readonly offsetOf: Record<SkillId, number> = { melee: 0, defence: 0, ranged: 0, magic: 0, hitpoints: 0 };
    private restoreTimer = 0;

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
        try {
            const drains = JSON.parse(storage?.getItem(DRAIN_KEY) ?? "null") as Partial<Record<SkillId, unknown>> | null;
            for (const id of DRAINABLE) {
                const v = drains?.[id];
                if (typeof v === "number" && Number.isInteger(v) && v < 0) {
                    this.offsetOf[id] = Math.max(-this.level(id), v);
                }
            }
        } catch {
            // No drains then.
        }
    }

    /** The level in use: the base level less any drain. Combat rolls and spell casting use it. */
    current(id: SkillId): number {
        return Math.max(0, this.level(id) + this.offsetOf[id]);
    }

    /** True while the skill is below its base level. */
    drained(id: SkillId): boolean {
        return this.offsetOf[id] < 0;
    }

    /** Lowers a skill's current level by `amount` (not below 0). Returns the levels taken. */
    drain(id: SkillId, amount: number): number {
        if (!DRAINABLE.includes(id) || !(amount > 0)) return 0;
        const take = Math.min(Math.floor(amount), this.current(id));
        if (take <= 0) return 0;
        this.offsetOf[id] -= take;
        this.saveDrains();
        return take;
    }

    /** Lowers a skill's current level to `level` if it is above it (the Mourner's vial). */
    drainTo(id: SkillId, level: number): number {
        return this.drain(id, this.current(id) - level);
    }

    /** Ticks the restore timer: every RESTORE_INTERVAL seconds each drained skill gains a level back. */
    update(dt: number): boolean {
        if (!DRAINABLE.some((id) => this.offsetOf[id] !== 0)) {
            this.restoreTimer = 0;
            return false;
        }
        this.restoreTimer += dt;
        if (this.restoreTimer < RESTORE_INTERVAL) return false;
        this.restoreTimer -= RESTORE_INTERVAL;
        for (const id of DRAINABLE) {
            this.offsetOf[id] -= Math.sign(this.offsetOf[id]);
        }
        this.saveDrains();
        return true;
    }

    private saveDrains(): void {
        try {
            this.storage?.setItem(DRAIN_KEY, JSON.stringify(this.offsetOf));
        } catch {
            // Not saved this time.
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
