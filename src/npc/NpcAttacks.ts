import { tuning } from "../combat/tuning";
import { units } from "../player/MoveMath";
import type { NpcAttackClip } from "../world/NpcFormat";
import { CLIENT_CYCLE_SECONDS } from "./NpcAnimation";

/**
 * One NPC melee attack (docs/combat-movement-spec.md 16.6): the guard's combatmovedatas entry plus
 * the timing and root motion of its animation in npc_guard_combat_animations.mdl.
 */
export type NpcAttack = {
    id: string;
    /** HitPow of each impact event. */
    hitPow: number[];
    /** Seconds from the start of the attack to each impact event (2102). */
    hitTimes: number[];
    /** Whole animation, seconds. */
    total: number;
    /** combatmovedatas range, tiles. */
    range: number;
    /** Forward root motion over the attack, tiles. */
    lunge: number;
    /** alwayspush: the hit always shoves the player. */
    push: boolean;
    breaksParry: boolean;
    /** Index of the NPC's attack clip this plays (NpcModelData.attacks); none for the guard table. */
    clip?: number;
};

const attack = (
    id: string,
    hitPow: number[],
    hitTimes: number[],
    total: number,
    rangeU: number,
    lungeU: number,
    push = false,
): NpcAttack => ({ id, hitPow, hitTimes, total, range: units(rangeU), lunge: units(lungeU), push, breaksParry: false });

/** The guard's strikes (spec 16.6). */
export const GUARD_ATTACKS: readonly NpcAttack[] = [
    attack("left", [0.7], [0.875], 1.5, 50, 40),
    attack("right", [0.7], [0.75], 1.667, 60, 50),
    attack("top", [0.7], [0.583], 1.5, 50, 70),
    attack("bottom", [0.7], [0.708], 1.667, 50, 40),
    attack("fast", [0.4, 0.4], [0.542, 1.083], 1.917, 60, 55),
    attack("forward", [0.7], [0.708], 1.583, 60, 120),
    attack("jump", [0.7], [0.917], 1.667, 70, 130, true),
    attack("long", [0.7], [0.833], 2.083, 60, 110),
    attack("bash", [0.7], [0.459], 1.5, 40, 30, true),
    attack("kick", [0.7], [0.5], 1.375, 40, 0, true),
];

/** Height of the guard the strike ranges above are for, tiles; bigger bodies reach further. [design] */
const GUARD_HEIGHT = 1.5;

/**
 * Strikes from an NPC's own attack animations: each lands where its clip reaches furthest
 * forward and lasts the clip. Reach and lunge are the guard's typical ones (60 u and 40 u),
 * scaled with the body's height.
 */
export function attacksFromClips(clips: readonly NpcAttackClip[], bodyHeight: number): NpcAttack[] {
    const scale = Math.min(2.5, Math.max(0.6, bodyHeight / GUARD_HEIGHT));
    return clips.map((clip, i) => {
        const cycles = clip.frameLengths.reduce((sum, length) => sum + length, 0);
        return {
            id: `clip${i}`,
            hitPow: [0.7],
            hitTimes: [clip.hitCycle * CLIENT_CYCLE_SECONDS],
            total: Math.max(cycles, clip.hitCycle + 1) * CLIENT_CYCLE_SECONDS,
            range: units(60) * scale,
            lunge: units(40) * scale,
            push: clip.shove,
            breaksParry: false,
            clip: i,
        };
    });
}

/**
 * Damage of an NPC strike on the player (spec 16.5):
 * max(0, (strength + WDmg) × HitPow − armour × 100) × difficulty.
 */
export function npcStrikeDamage(
    hitPow: number,
    strength = tuning.npcStrength,
    weaponDamage = tuning.npcWeaponDamage,
    armour = tuning.playerArmour,
    difficulty = 1,
): number {
    return Math.max(0, (strength + weaponDamage) * hitPow - armour * 100) * difficulty;
}

/** Attacks that reach `gap` tiles (distance between the two bodies' edges) with their lunge. */
export function attacksInReach(gap: number, attacks: readonly NpcAttack[] = GUARD_ATTACKS): NpcAttack[] {
    return attacks.filter((a) => a.range + a.lunge >= gap);
}

export type StrikeEvent = { attack: NpcAttack; hitIndex: number };

/**
 * When an NPC attacks (spec 10.1, 16.6): "cool" mode waits 2.0–3.5 s between attacks, "berserker"
 * 0–1 s; the mode flips every 10–15 s, and goes berserk once the player has not attacked for 2 s.
 * After being hit it waits 1 s (mm_ai_attack_latence_after_hit). An attack plays its animation
 * length, moving forward by its root motion until the last impact, and reports each impact.
 */
export class NpcAttacker {
    current: NpcAttack | undefined;
    elapsed = 0;
    berserk = false;
    private cooldown: number;
    private rhythm: number;
    private nextHit = 0;

    constructor(
        private readonly random: () => number = Math.random,
        private readonly attacks: readonly NpcAttack[] = GUARD_ATTACKS,
    ) {
        this.cooldown = this.pickCooldown();
        this.rhythm = this.between(tuning.rhythmSwitchMin, tuning.rhythmSwitchMax);
    }

    get busy(): boolean {
        return this.current !== undefined;
    }

    /** Forward speed of the lunge right now, tiles/s. */
    get lungeSpeed(): number {
        const a = this.current;
        if (!a || a.lunge === 0) {
            return 0;
        }
        const until = a.hitTimes[a.hitTimes.length - 1];
        return this.elapsed < until ? a.lunge / until : 0;
    }

    /** Stops an attack in progress (the NPC was staggered) and delays the next one. */
    interrupt(): void {
        this.current = undefined;
        this.cooldown = Math.max(this.cooldown, 1);
    }

    /**
     * Advances timers. `gap` is the distance between the bodies' edges, `sincePlayerAttack` seconds
     * since the player last swung. Returns the impacts that happened this update.
     */
    update(dt: number, gap: number, sincePlayerAttack: number, canStart: boolean): StrikeEvent[] {
        const events: StrikeEvent[] = [];
        this.rhythm -= dt;
        if (this.rhythm <= 0) {
            this.berserk = !this.berserk;
            this.rhythm = this.between(tuning.rhythmSwitchMin, tuning.rhythmSwitchMax);
        }
        if (sincePlayerAttack >= tuning.berserkAfterIdle && !this.berserk) {
            this.berserk = true;
            this.cooldown = Math.min(this.cooldown, this.pickCooldown());
        }
        const a = this.current;
        if (a) {
            this.elapsed += dt;
            while (this.nextHit < a.hitTimes.length && this.elapsed >= a.hitTimes[this.nextHit]) {
                events.push({ attack: a, hitIndex: this.nextHit });
                this.nextHit++;
            }
            if (this.elapsed >= a.total) {
                this.current = undefined;
                this.cooldown = this.pickCooldown();
            }
            return events;
        }
        this.cooldown -= dt;
        if (this.cooldown <= 0 && canStart) {
            const options = attacksInReach(gap, this.attacks);
            if (options.length > 0) {
                this.current = options[Math.floor(this.random() * options.length)];
                this.elapsed = 0;
                this.nextHit = 0;
            }
        }
        return events;
    }

    private pickCooldown(): number {
        return this.berserk
            ? this.between(tuning.attackBerserkMin, tuning.attackBerserkMax)
            : this.between(tuning.attackCoolMin, tuning.attackCoolMax);
    }

    private between(a: number, b: number): number {
        return a + this.random() * (b - a);
    }
}
