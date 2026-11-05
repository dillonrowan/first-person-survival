import { units } from "../player/MoveMath";
import { tuning } from "./tuning";
import type { WeaponFamily } from "./weapons";

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
 * When a move's hit tracing runs, from its first-person animation (spec 16.3): total length,
 * attack ray on and off, in seconds from the start of the layer.
 */
export type MoveTime = { total: number; on: number; off: number };

export type MoveDef = {
    id: string;
    kind: MoveKind;
    hits: HitEvent[];
    /** Forward lunge on the attacker when the swing starts, tiles per second (pushplayercoeff). */
    lunge: number;
    time?: MoveTime;
};

/** Seconds of each phase, already divided by the weapon's speed. */
export type Timeline = { windup: number; active: number; recovery: number };

export function timelineFor(move: MoveDef, weaponSpeed: number): Timeline {
    const s = 1 / weaponSpeed;
    if (move.time) {
        const { total, on, off } = move.time;
        return { windup: on * s, active: (off - on) * s, recovery: (total - off) * s };
    }
    const quick = move.kind === "quick";
    return {
        windup: (quick ? tuning.quickWindup : tuning.powerWindup) * s,
        active: (quick ? tuning.quickActive : tuning.powerActive) * s * Math.max(1, move.hits.length * 0.75),
        recovery: (quick ? tuning.quickRecovery : tuning.powerRecovery) * s,
    };
}

const t = (total: number, on: number, off: number): MoveTime => ({ total, on, off });
/** Timelines from first_animations_*.mdl (spec 16.3). */
const TIMES = {
    swordQuick: [t(0.3, 0.1, 0.233), t(0.4, 0.2, 0.333), t(0.4, 0.2, 0.333), t(0.4, 0.167, 0.3), t(0.367, 0.2, 0.333)],
    swordPower: {
        default: t(1.067, 0.133, 0.233),
        L: t(0.8, 0.033, 0.2),
        R: t(1.033, 0.2, 0.433),
        B: t(1.267, 0.033, 0.267),
        T: t(1, 0.033, 0.167),
    } as Record<PowerDirection, MoveTime>,
    rush: t(1.958, 0.083, 1.125),
    fall: t(1, 0.1, 0.267),
    huge: t(2.083, 0.292, 1),
    /** layer_combo_*_trample is 1.875 s with no ray events. [design: ray 0.6–0.9 s] */
    trample: t(1.875, 0.6, 0.9),
    daggersQuick: [t(0.233, 0.067, 0.2), t(0.267, 0.1, 0.233), t(0.333, 0.067, 0.2), t(0.233, 0.133, 0.233), t(0.733, 0.267, 0.4)],
    daggersPower: t(1.333, 0.167, 0.833),
    staffQuick: [t(0.467, 0.267, 0.467), t(1, 0.8, 0.967), t(1, 0.733, 0.867), t(1.433, 0.933, 1.033)],
    staffPower: t(2.778, 0.407, 1.556),
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

const quickMoves = (events: HitEvent[]): MoveDef[] =>
    events.map((h, i) => ({ id: `quick_${"ABCDE"[i]}`, kind: "quick", hits: [h], lunge: 0 }));

/** Adds the animation timelines (spec 16.3) to a family's moves. */
function withTimes(set: MoveSet, quick: MoveTime[], power: (dir: PowerDirection) => MoveTime): MoveSet {
    return {
        quick: set.quick.map((m, i) => timed(m, quick[i % quick.length])),
        power: Object.fromEntries(
            Object.entries(set.power).map(([dir, m]) => [dir, timed(m, power(dir as PowerDirection))]),
        ) as Record<PowerDirection, MoveDef>,
        rush: timed(set.rush, TIMES.rush),
        fall: timed(set.fall, TIMES.fall),
        trample: timed(set.trample, TIMES.trample),
        huge: timed(set.huge, TIMES.huge),
    };
}

/** Move sets per weapon family, from first_basic.qct (no-shield variants), with their timelines. */
export const MOVE_SETS: Record<WeaponFamily, MoveSet> = {} as Record<WeaponFamily, MoveSet>;

const BASE_SETS: Record<Exclude<WeaponFamily, "bow">, MoveSet> = {
    sword: {
        quick: quickMoves([1, -1, 1, -1, 1].map((y) => hit(0.7, [0, y, 0], 0.5))),
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
        quick: quickMoves(
            ([[0, -1, 0], [0, 1, 0], [0, -1, 0], [1, 0, 0], [1, 0, 0]] as [number, number, number][]).map((d) =>
                hit(0.7, d, 0.5, { push: true }),
            ),
        ),
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
        quick: quickMoves([
            hit(0.7, [0, 1, 0], 0.5, { stunChance: 0.1, fallChance: 0.1 }),
            hit(0.7, [1, 0, 0], 0.5, { stunChance: 0.05, fallChance: 0.1 }),
            hit(0.7, [0, -1, 0], 0.5, { stunChance: 0.05, fallChance: 0.1 }),
            hit(0.7, [1, 0, 0], 0.5, { stunChance: 0.05, fallChance: 0.1 }),
        ]),
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

MOVE_SETS.sword = withTimes(BASE_SETS.sword, TIMES.swordQuick, (dir) => TIMES.swordPower[dir]);
MOVE_SETS.daggers = withTimes(BASE_SETS.daggers, TIMES.daggersQuick, () => TIMES.daggersPower);
MOVE_SETS.staff = withTimes(BASE_SETS.staff, TIMES.staffQuick, () => TIMES.staffPower);
// The bow's melee is the kick; its "moves" reuse the sword set so melee code stays total. [design]
MOVE_SETS.bow = MOVE_SETS.sword;
