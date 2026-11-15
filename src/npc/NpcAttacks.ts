import { TICK_SECONDS, attackRate } from "../combat/Osrs";
import { tuning } from "../combat/tuning";
import { units } from "../player/MoveMath";
import type { NpcAttackClip } from "../world/NpcFormat";
import { ADJACENT, AttackStyle, BreathInfo, NpcStyledAttackInfo, ProjectileInfo, RANGED_MAX } from "./AttackStyle";
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
    style: AttackStyle;
    /** Relative pick chance among the attacks in reach. */
    weight: number;
    /** Closest and furthest gap (tiles between body edges) the attack starts from. */
    minGap: number;
    maxGap: number;
    /** Ranged and magic attacks, and breath that is thrown as a fireball, fly as this. */
    projectile?: ProjectileInfo;
    /** Dragonfire and icy breath: a cone in front of the mouth; each hit time is a damage tick. */
    breath?: BreathInfo;
    /** Multiplies the cooldown that follows (slower attackers wait longer). */
    cooldownScale: number;
    /** [forward, up] tiles from the model origin where a projectile or breath leaves the body. */
    launch?: [number, number];
};

const attack = (
    id: string,
    hitPow: number[],
    hitTimes: number[],
    total: number,
    rangeU: number,
    lungeU: number,
    push = false,
): NpcAttack => ({
    id,
    hitPow,
    hitTimes,
    total,
    range: units(rangeU),
    lunge: units(lungeU),
    push,
    breaksParry: false,
    style: "melee",
    weight: 1,
    minGap: 0,
    maxGap: units(rangeU) + units(lungeU),
    cooldownScale: 1,
});

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
            style: "melee",
            weight: 1,
            minGap: 0,
            maxGap: units(60) * scale + units(40) * scale,
            cooldownScale: 1,
        };
    });
}

/** Release time of an attack with no clip at all, client cycles. */
const NO_CLIP_HIT_CYCLE = 30;

/**
 * Strikes for an NPC with several attack styles (NpcAppearanceInfo.attackStyles). Each style plays
 * its own clips and splits its weight over them; a style with no clip of its own plays the first
 * melee clip, and with no clips at all a plain 1.2 s attack that lands at 0.6 s.
 */
export function attacksFromStyles(
    infos: readonly NpcStyledAttackInfo[],
    clips: readonly NpcAttackClip[],
    bodyHeight: number,
): NpcAttack[] {
    const scale = Math.min(2.5, Math.max(0.6, bodyHeight / GUARD_HEIGHT));
    const out: NpcAttack[] = [];
    for (const info of infos) {
        let own = clips.flatMap((clip, i) => (clip.style === info.style ? [i] : []));
        if (own.length === 0) {
            const melee = clips.findIndex((clip) => clip.style === "melee");
            own = melee >= 0 ? [melee] : clips.length > 0 ? [0] : [];
        }
        if (own.length === 0) {
            out.push(styledAttack(info, undefined, -1, scale, info.weight));
            continue;
        }
        for (const i of own) {
            out.push(styledAttack(info, clips[i], i, scale, info.weight / own.length));
        }
    }
    return out;
}

function styledAttack(
    info: NpcStyledAttackInfo,
    clip: NpcAttackClip | undefined,
    index: number,
    scale: number,
    weight: number,
): NpcAttack {
    const cycles = clip ? clip.frameLengths.reduce((sum, length) => sum + length, 0) : 0;
    const hitCycle = clip ? clip.hitCycle : NO_CLIP_HIT_CYCLE;
    const release = hitCycle * CLIENT_CYCLE_SECONDS;
    let total = clip ? Math.max(cycles, hitCycle + 1) * CLIENT_CYCLE_SECONDS : 2 * release;
    let hitTimes = [release];
    let hitPow = [info.hitPow];
    if (info.breath) {
        const { ticks, duration } = info.breath;
        hitTimes = Array.from({ length: ticks }, (_, k) => release + (k * duration) / ticks);
        hitPow = Array.from({ length: ticks }, () => info.hitPow / ticks);
        total = Math.max(total, release + duration);
    }
    const melee = info.style === "melee";
    const range = melee ? units(60) * scale : (info.maxGap ?? RANGED_MAX);
    const lunge = melee ? units(40) * scale : 0;
    const attack: NpcAttack = {
        id: `${info.style}${index}`,
        hitPow,
        hitTimes,
        total,
        range,
        lunge,
        push: melee && !!clip?.shove,
        breaksParry: !melee,
        style: info.style,
        weight,
        minGap: info.minGap,
        maxGap: melee ? range + lunge : (info.maxGap ?? RANGED_MAX),
        cooldownScale: info.cooldownScale ?? 1,
    };
    if (index >= 0) attack.clip = index;
    if (info.projectile) attack.projectile = info.projectile;
    if (info.breath) attack.breath = info.breath;
    if (clip && !melee) attack.launch = clip.launch;
    return attack;
}

/** Attacks that start from `gap` tiles (distance between the two bodies' edges). */
export function attacksInReach(gap: number, attacks: readonly NpcAttack[] = GUARD_ATTACKS): NpcAttack[] {
    return attacks.filter((a) => gap >= a.minGap && gap <= a.maxGap);
}

/** `rate` is how much of the NPC attack interval (OSRS ticks) had passed since its previous attack. */
export type StrikeEvent = { attack: NpcAttack; hitIndex: number; rate: number };

/**
 * When an NPC attacks (spec 10.1, 16.6): "cool" mode waits 2.0–3.5 s between attacks, "berserker"
 * 0–1 s; the mode flips every 10–15 s, and goes berserk once the player has not attacked for 2 s.
 * After being hit it waits 1 s (mm_ai_attack_latence_after_hit). An attack plays its animation
 * length, moving forward by its root motion until the last impact, and reports each impact.
 */
export class NpcAttacker {
    current: NpcAttack | undefined;
    /** The attack that began in the latest update, if any. */
    started: NpcAttack | undefined;
    elapsed = 0;
    berserk = false;
    private cooldown: number;
    private rhythm: number;
    private nextHit = 0;
    private sinceStart = Infinity;
    private rate = 1;

    constructor(
        private readonly random: () => number = Math.random,
        private readonly attacks: readonly NpcAttack[] = GUARD_ATTACKS,
        /** The NPC OSRS attack speed in ticks; attacks started sooner than this hit for less. */
        private readonly speedTicks = 4,
    ) {
        this.cooldown = this.pickCooldown();
        this.rhythm = this.between(tuning.rhythmSwitchMin, tuning.rhythmSwitchMax);
    }

    get busy(): boolean {
        return this.current !== undefined;
    }

    /** True if some attack starts from further than next to the player (arrows, spells, fireballs). */
    get hasDistanceAttack(): boolean {
        return this.attacks.some((a) => a.style !== "melee" && a.maxGap > ADJACENT);
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
        this.started = undefined;
        this.sinceStart += dt;
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
                events.push({ attack: a, hitIndex: this.nextHit, rate: this.rate });
                this.nextHit++;
            }
            if (this.elapsed >= a.total) {
                this.current = undefined;
                this.cooldown = this.pickCooldown(a.cooldownScale);
            }
            return events;
        }
        this.cooldown -= dt;
        if (this.cooldown <= 0 && canStart) {
            const options = attacksInReach(gap, this.attacks);
            if (options.length > 0) {
                this.current = this.pick(options);
                this.started = this.current;
                this.rate = attackRate(this.sinceStart, this.speedTicks * TICK_SECONDS);
                this.sinceStart = 0;
                this.elapsed = 0;
                this.nextHit = 0;
            }
        }
        return events;
    }

    /** A weighted random pick: with equal weights, the same as a uniform one. */
    private pick(options: readonly NpcAttack[]): NpcAttack {
        let r = this.random() * options.reduce((sum, a) => sum + a.weight, 0);
        for (const a of options) {
            r -= a.weight;
            if (r < 0) {
                return a;
            }
        }
        return options[options.length - 1];
    }

    private pickCooldown(scale = 1): number {
        return (
            (this.berserk
                ? this.between(tuning.attackBerserkMin, tuning.attackBerserkMax)
                : this.between(tuning.attackCoolMin, tuning.attackCoolMax)) * scale
        );
    }

    private between(a: number, b: number): number {
        return a + this.random() * (b - a);
    }
}
