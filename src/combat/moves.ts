import { units } from "../player/MoveMath";
import { tuning } from "./tuning";
import type { MeleeFamily, WeaponFamily } from "./weapons";

/**
 * One hit event of a move (docs/combat-movement-spec.md 12). Impact direction is in the attacker's
 * frame: x ahead, y to the attacker's left, z up. A sideways swing travels towards +y.
 */
export type HitEvent = {
    hitPow: number;
    impact: { x: number; y: number; z: number };
    adrenaline: number;
    /** Push the target if the hit is big enough (`push`). */
    push: boolean;
    /** 0 none, 1 always push, 2 huge push (`alwayspush`). */
    alwaysPush: 0 | 1 | 2;
    breaksParry: boolean;
    stunChance: number;
    fallChance: number;
};

export type MoveKind = "quick" | "power" | "rush" | "fall" | "trample" | "huge";
export type PowerDirection = "default" | "L" | "R" | "B" | "T";

/**
 * One attack ray (docs/combat-movement-spec.md 17.2): between `on` and `off` (seconds from the
 * start of the layer) a line from the eye sweeps `sweep` degrees across the view, centred on the
 * crosshair, in a plane rolled by `roll` degrees. Horizontal rays turn about the view's (rolled) up
 * axis, vertical ones about its right axis. A thrust has sweep 0: a single centre trace.
 */
export type Ray = { on: number; off: number; roll: number; vertical: boolean; sweep: number };

/** A move's first-person layer: its length and its rays, one per hit (spec 17.3). */
export type MoveTime = { total: number; rays: Ray[] };

export type MoveDef = {
    id: string;
    kind: MoveKind;
    hits: HitEvent[];
    /** Forward lunge on the attacker when the swing starts, tiles per second (pushplayercoeff). */
    lunge: number;
    time?: MoveTime;
    /** The weapon's speed_attack scales this move (change_speed 1: quick strikes, power releases). */
    changeSpeed?: boolean;
};

/**
 * How a weapon family's quick strikes chain and end (spec 18.2) and how long its power wind-up
 * takes (the tap/hold boundary from idle, 18.1).
 */
export type ComboRules = {
    /** Index of the strike after strike `i`. */
    next: (i: number) => number;
    /** Length of the "end" layer played when the chain stops after strike `i`; none: straight to idle. */
    endAfter: Partial<Record<number, number>>;
    /** layer_bigslash_*_in length per direction. */
    windup: Record<PowerDirection, number>;
    /** Hold during a quick strike that cancels into the wind-up (mm_player_mintime_to_bigslash). */
    holdToCharge: number;
};

const sameWindup = (s: number): Record<PowerDirection, number> => ({ default: s, L: s, R: s, B: s, T: s });

/** Quick strikes alternate left-to-right and right-to-left, with no end layer to wait out. [design] */
const alternate = (i: number) => (i + 1) % 2;

export const COMBOS: Record<WeaponFamily, ComboRules> = {
    sword: {
        next: alternate,
        endAfter: {},
        windup: { default: 0.5, L: 0.5, R: 0.5, B: 0.667, T: 0.667 },
        holdToCharge: tuning.chargeThreshold,
    },
    daggers: {
        next: alternate,
        endAfter: {},
        windup: sameWindup(0.5),
        holdToCharge: tuning.chargeThresholdDaggers,
    },
    staff: {
        next: alternate,
        endAfter: {},
        windup: sameWindup(1.542),
        holdToCharge: tuning.chargeThreshold,
    },
    bow: {
        next: () => 0,
        endAfter: {},
        windup: sameWindup(0.5),
        holdToCharge: tuning.chargeThreshold,
    },
    crossbow: {
        next: () => 0,
        endAfter: {},
        windup: sameWindup(0.5),
        holdToCharge: tuning.chargeThreshold,
    },
};

/** Seconds, already divided by the weapon's speed. `rays` holds each hit's ray in those seconds. */
export type Timeline = { windup: number; active: number; recovery: number; rays: Ray[] };

/** The ray of hit `index` (moves with more hits than rays reuse the last ray). */
export function rayFor(timeline: Timeline, index: number): Ray {
    return timeline.rays[Math.min(index, timeline.rays.length - 1)];
}

export function timelineFor(move: MoveDef, weaponSpeed: number): Timeline {
    const s = move.time && !move.changeSpeed ? 1 : 1 / weaponSpeed;
    if (move.time) {
        const rays = move.time.rays.map((r) => ({ ...r, on: r.on * s, off: r.off * s }));
        const on = Math.min(...rays.map((r) => r.on));
        const off = Math.max(...rays.map((r) => r.off));
        return { windup: on, active: off - on, recovery: move.time.total * s - off, rays };
    }
    const quick = move.kind === "quick";
    const windup = (quick ? tuning.quickWindup : tuning.powerWindup) * s;
    const active = (quick ? tuning.quickActive : tuning.powerActive) * s * Math.max(1, move.hits.length * 0.75);
    const slot = active / move.hits.length;
    return {
        windup,
        active,
        recovery: (quick ? tuning.quickRecovery : tuning.powerRecovery) * s,
        rays: move.hits.map((_, i) => ({ on: windup + i * slot, off: windup + (i + 1) * slot, roll: 0, vertical: false, sweep: SWEEP })),
    };
}

/** Width of every attack ray's fan. [cvar mm_activate_trample_angle 90] */
const SWEEP = 90;
/** A thrust (impact event, no ray) traces for one server tick either side of the event. [design] */
const THRUST_HALF = 0.015;

const ray = (on: number, off: number, roll = 0): Ray => ({ on, off, roll, vertical: false, sweep: SWEEP });
const vray = (on: number, off: number, roll = 0): Ray => ({ on, off, roll, vertical: true, sweep: SWEEP });
const thrust = (at: number): Ray => ({ on: at - THRUST_HALF, off: at + THRUST_HALF, roll: 0, vertical: false, sweep: 0 });
const t = (total: number, ...rays: Ray[]): MoveTime => ({ total, rays });

/**
 * Quick strikes for every family [design]: a slash from left to right, then back from right to
 * left, each sloping slightly downwards (forehand from high right, backhand from high left). Timed
 * at speed 1; the weapon's weight-based speed stretches or shortens them (weapons.ts `swingTime`).
 */
const QUICK_TIMES = [t(0.4, ray(0.12, 0.26, 10)), t(0.4, ray(0.12, 0.26, -10))];

/** Rays from the first-person animations' 2186/2198/2190/2102 events (spec 17.3). */
const TIMES = {
    swordQuick: QUICK_TIMES,
    swordPower: {
        default: t(1.067, ray(0.133, 0.233, -45)),
        L: t(0.8, ray(0.033, 0.2)),
        R: t(1.033, ray(0.2, 0.433, 45)),
        B: t(1.267, thrust(0.233)),
        T: t(1, thrust(0.167)),
    } as Record<PowerDirection, MoveTime>,
    swordRush: t(1.958, ray(0.166, 0.333), ray(0.958, 1.124, 45)),
    fall: t(1, vray(0.1, 0.267)),
    swordHuge: t(2.083, ray(0.292, 0.458, 135), ray(0.833, 1, -45)),
    /** layer_combo_*_trample has no ray events. [design: vertical ray 0.6–0.9 s] */
    trample: t(1.875, vray(0.6, 0.9)),
    daggersQuick: QUICK_TIMES,
    daggersPower: {
        default: t(1.333, ray(0.167, 0.3), ray(0.7, 0.833, 90)),
        L: t(1.333, ray(0.167, 0.3), ray(0.7, 0.833, 90)),
        R: t(1.333, ray(0.167, 0.3), ray(0.7, 0.833, 90)),
        // Stepping back or forward: a double stab, drawn back between the two. [design]
        B: t(0.967, thrust(0.133), thrust(0.367)),
        T: t(0.833, thrust(0.133), thrust(0.367)),
    } as Record<PowerDirection, MoveTime>,
    daggersRush: t(1.767, ray(0.868, 0.967), ray(1.101, 1.2)),
    /** layer_combo_daggers_huge: impact events only (2102, then 2139). */
    daggersHuge: t(1.367, thrust(0.3), thrust(0.767)),
    staffQuick: QUICK_TIMES,
    staffPower: {
        default: t(2.778, ray(0.407, 0.556, -60), ray(1.409, 1.556, 120)),
        L: t(2.593, ray(0.371, 0.555), ray(0.962, 1.26)),
        R: t(2.593, ray(0.371, 0.555), ray(0.962, 1.26)),
        B: t(1.967, ray(0.366, 0.533, 80), thrust(1.166)),
        T: t(2.5, ray(0.368, 0.5, -60), ray(1.268, 1.4, 90)),
    } as Record<PowerDirection, MoveTime>,
    staffRush: t(1.667, ray(0.067, 0.267), thrust(1.133)),
    staffFall: t(1.2, vray(0.1, 0.267)),
    /** layer_combo_staff_huge: impact events 2102 and 2139. */
    staffHuge: t(2.333, thrust(0.166), thrust(0.389)),
};

const timed = (move: MoveDef, time: MoveTime): MoveDef => ({ ...move, time });

const hit = (
    hitPow: number,
    impact: [number, number, number],
    adrenaline: number,
    extra: Partial<HitEvent> = {},
): HitEvent => ({
    hitPow,
    impact: { x: impact[0], y: impact[1], z: impact[2] },
    adrenaline,
    push: false,
    alwaysPush: 0,
    breaksParry: false,
    stunChance: 0,
    fallChance: 0,
    ...extra,
});

const power = (impact: [number, number, number], adrenaline: number, lungeU = 0): MoveDef => ({
    id: "power",
    kind: "power",
    hits: [hit(1.5, impact, adrenaline, { push: true, breaksParry: true, stunChance: 0.8 })],
    lunge: units(lungeU),
});

const SWORD_RUSH: MoveDef = {
    id: "rush",
    kind: "rush",
    hits: [
        hit(0.5, [1, -1, 0], 1, { alwaysPush: 1, stunChance: 0.1 }),
        hit(1.5, [1, 1, 0], 1, { alwaysPush: 1, stunChance: 0.4 }),
    ],
    lunge: units(500),
};
const SWORD_FALL: MoveDef = {
    id: "fall",
    kind: "fall",
    hits: [hit(2, [1, 0, -1], 1, { push: true, alwaysPush: 1, breaksParry: true, stunChance: 0.4, fallChance: 0.6 })],
    lunge: 0,
};
const SWORD_HUGE: MoveDef = {
    id: "huge",
    kind: "huge",
    hits: [
        hit(30, [1, 1, 0], 0, { breaksParry: true, stunChance: 0.2, fallChance: 0.1 }),
        hit(30, [1, -1, 0], 0, { alwaysPush: 1, stunChance: 0.4, fallChance: 0.5 }),
    ],
    lunge: 0,
};
const trample = (hitPow: number, alwaysPush: 1 | 2): MoveDef => ({
    id: "trample",
    kind: "trample",
    hits: [hit(hitPow, [0, 1, 0], 0, { push: true, alwaysPush, breaksParry: true, stunChance: 0.1, fallChance: 0.9 })],
    lunge: 0,
});

export type MoveSet = {
    quick: MoveDef[];
    power: Record<PowerDirection, MoveDef>;
    rush: MoveDef;
    fall: MoveDef;
    trample: MoveDef;
    huge: MoveDef;
};

/**
 * The two alternating quick strikes: A swings left to right (impact towards the attacker's right,
 * −Y), B right to left (+Y). `extra` holds the family's hit properties.
 */
const quickMoves = (extra: Partial<HitEvent> = {}): MoveDef[] =>
    [-1, 1].map((y, i) => ({ id: `quick_${"AB"[i]}`, kind: "quick", hits: [hit(0.7, [0, y, 0], 0.5, extra)], lunge: 0 }));

/** Adds the animation timelines (spec 16.3) to a family's moves. */
function withTimes(
    set: MoveSet,
    times: {
        quick: MoveTime[];
        power: Record<PowerDirection, MoveTime>;
        rush: MoveTime;
        fall: MoveTime;
        huge: MoveTime;
    },
): MoveSet {
    // Quick strikes and power releases scale with speed_attack; the combos do not (spec 18.3).
    return {
        quick: set.quick.map((m, i) => ({ ...timed(m, times.quick[i % times.quick.length]), changeSpeed: true })),
        power: Object.fromEntries(
            Object.entries(set.power).map(([dir, m]) => [dir, { ...timed(m, times.power[dir as PowerDirection]), changeSpeed: true }]),
        ) as Record<PowerDirection, MoveDef>,
        rush: timed(set.rush, times.rush),
        fall: timed(set.fall, times.fall),
        trample: timed(set.trample, TIMES.trample),
        huge: timed(set.huge, times.huge),
    };
}

/** Move sets per weapon family, from first_basic.qct (no-shield variants), with their timelines. */
export const MOVE_SETS: Record<WeaponFamily, MoveSet> = {} as Record<WeaponFamily, MoveSet>;

const BASE_SETS: Record<MeleeFamily, MoveSet> = {
    sword: {
        quick: quickMoves(),
        power: {
            default: { ...power([0, 1, 0], 3), id: "power" },
            L: { ...power([0, -1, 0], 3), id: "power_L" },
            R: { ...power([0, 1, 0], 1), id: "power_R" },
            B: { ...power([1, 0, 0], 3, 250), id: "power_B" },
            T: { ...power([1, 0, 0], 3, 300), id: "power_T" },
        },
        rush: SWORD_RUSH,
        fall: SWORD_FALL,
        trample: trample(30, 1),
        huge: SWORD_HUGE,
    },
    daggers: {
        quick: quickMoves({ push: true }),
        // Only the default dagger power attack was tabulated; other directions mirror it. [design]
        power: Object.fromEntries(
            (["default", "L", "R", "B", "T"] as PowerDirection[]).map((dir) => [
                dir,
                {
                    id: dir === "default" ? "power" : `power_${dir}`,
                    kind: "power",
                    hits: [0, 1].map(() => hit(1.5, [1, 0, -1], 1.5, { alwaysPush: 1, stunChance: 0.8 })),
                    lunge: 0,
                } satisfies MoveDef,
            ]),
        ) as Record<PowerDirection, MoveDef>,
        rush: {
            id: "rush",
            kind: "rush",
            hits: [0.5, 1.5].map((p) => hit(p, [1, 0, -1], 0.5, { alwaysPush: 1, stunChance: 0.8 })),
            lunge: units(500),
        },
        fall: SWORD_FALL, // dagger table entry not tabulated [design]
        trample: trample(30, 1),
        huge: SWORD_HUGE, // [design]
    },
    staff: {
        quick: quickMoves({ stunChance: 0.05, fallChance: 0.1 }),
        power: Object.fromEntries(
            (["default", "L", "R", "B", "T"] as PowerDirection[]).map((dir) => [
                dir,
                {
                    id: dir === "default" ? "power" : `power_${dir}`,
                    kind: "power",
                    hits: [0, 1].map(() =>
                        hit(1.5, [1, 0, 0], 1, {
                            push: true,
                            alwaysPush: 2,
                            breaksParry: true,
                            stunChance: 0.1,
                            fallChance: 0.2,
                        }),
                    ),
                    lunge: 0,
                } satisfies MoveDef,
            ]),
        ) as Record<PowerDirection, MoveDef>,
        rush: SWORD_RUSH, // [design]
        fall: {
            id: "fall",
            kind: "fall",
            hits: [
                hit(2, [1, 0, 0], 1.5, {
                    push: true,
                    alwaysPush: 2,
                    breaksParry: true,
                    stunChance: 0.1,
                    fallChance: 0.5,
                }),
            ],
            lunge: 0,
        },
        trample: trample(20, 2),
        huge: SWORD_HUGE, // [design]
    },
};

MOVE_SETS.sword = withTimes(BASE_SETS.sword, {
    quick: TIMES.swordQuick,
    power: TIMES.swordPower,
    rush: TIMES.swordRush,
    fall: TIMES.fall,
    huge: TIMES.swordHuge,
});
MOVE_SETS.daggers = withTimes(BASE_SETS.daggers, {
    quick: TIMES.daggersQuick,
    power: TIMES.daggersPower,
    rush: TIMES.daggersRush,
    fall: TIMES.fall,
    huge: TIMES.daggersHuge,
});
MOVE_SETS.staff = withTimes(BASE_SETS.staff, {
    quick: TIMES.staffQuick,
    power: TIMES.staffPower,
    rush: TIMES.staffRush,
    fall: TIMES.staffFall,
    huge: TIMES.staffHuge,
});
// The bow's melee is the kick; its "moves" reuse the sword set so melee code stays total. [design]
MOVE_SETS.bow = MOVE_SETS.sword;
MOVE_SETS.crossbow = MOVE_SETS.sword;
