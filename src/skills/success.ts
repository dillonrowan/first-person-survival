import { random } from "../game/Random";
import type { Chance } from "../world/SkillFormat";

/**
 * The OSRS skilling success chance at a level, interpolated between the chance out of 256 at level
 * 1 (`low`) and at level 99 (`high`) [wiki: Module:Skilling success chart].
 */
export function successChance(c: Chance, level: number): number {
    const L = Math.min(99, Math.max(1, level));
    const v = Math.floor((c.low * (99 - L)) / 98 + (c.high * (L - 1)) / 98 + 0.5) + 1;
    return Math.min(1, Math.max(0, v / 256));
}

export function roll(c: Chance, level: number): boolean {
    return random() < successChance(c, level);
}
