import type { Combatant, Reaction } from "./Combatant";
import type { HitEvent } from "./moves";
import { tuning } from "./tuning";
import type { WeaponDef } from "./weapons";

export type DamageContext = {
    /** Defender's armour 0..1 (fraction of damage absorbed before piercing). */
    armour?: number;
    /** Defender has not noticed the attacker (×3 in the game's data). */
    unaware?: boolean;
    /** Difficulty multiplier on this damage. */
    difficulty?: number;
    /** Hit-zone multiplier (hitboxes_modifier: head 3, chest 0.5, stomach 1, limbs 1.25). */
    hitbox?: number;
};

/**
 * Hit zone from where a hit lands on a body, 0 (feet) to 1 (top) (spec 18.3): the guard's
 * hitboxes_modifier [data], mapped onto height bands [design].
 */
export function hitboxMultiplier(height: number): number {
    if (height >= 0.85) {
        return 3; // head
    }
    if (height >= 0.6) {
        return 0.5; // chest
    }
    if (height >= 0.45) {
        return 1; // stomach
    }
    return 1.25; // legs
}

export type DamageResult = {
    amount: number;
    reaction: Reaction;
    stunned: boolean;
    knockedDown: boolean;
    /** Push level on the defender: 0 none, 1 medium, 2 long, 3 huge. */
    push: number;
    killed: boolean;
    /** The attack was rolled and missed: no damage, but the target still reacts. */
    missed: boolean;
};

/**
 * Damage of one hit (docs/combat-movement-spec.md 5.2, a design formula built on the game's
 * inputs): WDmg × HitPow × strength × (1 − armour × (1 − piercing)) × awareness × difficulty.
 */
export function damageAmount(weapon: WeaponDef, hit: HitEvent, ctx: DamageContext = {}): number {
    const armour = Math.min(1, Math.max(0, ctx.armour ?? tuning.baseArmour));
    return (
        weapon.damage *
        hit.hitPow *
        tuning.strengthScale *
        (1 - armour * (1 - weapon.piercing)) *
        (ctx.unaware ? tuning.unawareMultiplier : 1) *
        (ctx.difficulty ?? 1) *
        (ctx.hitbox ?? 1)
    );
}

/** Reaction size from damage as a fraction of max health (spec 5.3). */
export function reactionFor(fraction: number, hit: HitEvent): Reaction {
    if (fraction > tuning.knockdownFraction) {
        return "knockdown";
    }
    if (fraction > tuning.pushFraction) {
        return hit.push ? "push" : "stagger";
    }
    if (fraction > tuning.staggerFraction) {
        return "stagger";
    }
    if (fraction >= tuning.flinchFraction) {
        return "flinch";
    }
    return "none";
}

/**
 * Applies a hit to a defender. `random` returns numbers in [0, 1) for the stun and fall rolls. A
 * "knockdown"-sized hit only knocks down if the move's fall chance roll succeeds; otherwise it
 * staggers (spec 5.3).
 */
export function applyHit(
    defender: Combatant,
    weapon: WeaponDef,
    hit: HitEvent,
    ctx: DamageContext = {},
    random: () => number = Math.random,
): DamageResult {
    return applyDamage(defender, damageAmount(weapon, hit, ctx), hit, weapon.stunMultiplier, random);
}

/**
 * Applies `amount` damage from a hit: the reaction by its share of max health, the stun and fall
 * rolls and the push. `minReaction` makes even a 0 (a miss) flinch the defender.
 */
export function applyDamage(
    defender: Combatant,
    amount: number,
    hit: HitEvent,
    stunMultiplier: number,
    random: () => number = Math.random,
    opts: { minReaction?: "flinch"; missed?: boolean } = {},
): DamageResult {
    let reaction = reactionFor(amount / defender.maxHealth, hit);
    if (reaction === "none" && opts.minReaction) {
        reaction = opts.minReaction;
    }
    if (reaction === "knockdown" && !(random() < hit.fallChance)) {
        reaction = hit.push ? "push" : "stagger";
    }
    const stunned =
        reaction !== "knockdown" && random() < hit.stunChance * tuning.stunChanceMultiplier * stunMultiplier;
    defender.hurt(amount, reaction, stunned);

    // Push level: 0 none, 1 medium slide, 2 long slide, 3 huge. The target turns it into a distance
    // from its hit animations (spec 5.3); alwayspush 1 pushes "more with more damage", 2 always hugely.
    let push = reaction === "push" || reaction === "knockdown" ? 2 : reaction === "stagger" ? 1 : 0;
    if (hit.alwaysPush === 1) {
        push = Math.max(push, 1);
    } else if (hit.alwaysPush === 2) {
        push = 3;
    }
    if (defender.dead) {
        push = Math.max(push, 2);
    }
    return {
        amount,
        reaction,
        stunned,
        knockedDown: reaction === "knockdown",
        push,
        killed: defender.dead,
        missed: opts.missed ?? false,
    };
}
