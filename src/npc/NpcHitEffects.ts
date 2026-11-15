import type { SkillId } from "../combat/SkillId";
import { type Drain, type HitEffect, type NpcSpell, drainAmount } from "./NpcSpells";

/** The parts of the player's skills a drain needs. */
export type DrainableSkills = {
    current(id: SkillId): number;
    drain(id: SkillId, amount: number): number;
};

/** Applies a drain to each of its skills. Returns the levels taken per skill (only those > 0). */
export function applyDrain(skills: DrainableSkills, drain: Drain, only?: SkillId[]): Partial<Record<SkillId, number>> {
    const taken: Partial<Record<SkillId, number>> = {};
    for (const id of only ?? drain.skills) {
        const amount = skills.drain(id, drainAmount(drain, skills.current(id)));
        if (amount > 0) taken[id] = amount;
    }
    return taken;
}

/** OSRS-style message for a curse that landed. [design: the client's wording is not documented] */
export function curseMessage(spell: NpcSpell): string {
    switch (spell.name) {
        case "Confuse":
            return "You feel confused.";
        case "Weaken":
            return "You feel weakened.";
        case "Curse":
            return "You feel cursed.";
        case "Vulnerability":
            return "You feel vulnerable.";
        case "Bind":
            return "You have been bound!";
        default:
            return `You have been hit by ${spell.name}.`;
    }
}

export type StrikeOutcome = { missed: boolean; damage: number };

/**
 * Runs an NPC's on-hit effects for one strike that reached the player. `headItem` is the name of
 * what the player wears on their head; `usedOnce` says whether a once-per-fight effect already
 * fired. Returns the messages to show and whether a once-per-fight effect fired now.
 */
export function runHitEffects(
    effects: readonly HitEffect[],
    strike: StrikeOutcome,
    skills: DrainableSkills,
    random: () => number,
    headItem: string | undefined,
    usedOnce: boolean,
): { messages: string[]; firedOnce: boolean } {
    const messages: string[] = [];
    let firedOnce = false;
    if (strike.missed) return { messages, firedOnce };
    for (const effect of effects) {
        if (effect.damagingOnly && strike.damage <= 0) continue;
        if (effect.blockedBy && headItem && effect.blockedBy.test(headItem)) continue;
        if (effect.once && usedOnce) continue;
        if (random() >= effect.chance) continue;
        let only: SkillId[] | undefined;
        if (effect.randomSkills) {
            const [min, max] = effect.randomSkills;
            const count = Math.min(effect.drain.skills.length, min + Math.floor(random() * (max - min + 1)));
            const pool = [...effect.drain.skills];
            only = [];
            for (let i = 0; i < count; i++) only.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
        }
        const taken = applyDrain(skills, effect.drain, only);
        if (effect.once) firedOnce = true;
        if (effect.message && (Object.keys(taken).length > 0 || effect.once)) messages.push(effect.message);
    }
    return { messages, firedOnce };
}
