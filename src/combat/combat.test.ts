import { describe, expect, it } from "vitest";

import type { Body, BodySource } from "../physics/Bodies";
import { CollisionFlag } from "../world/WorldFormat";
import { Combatant } from "./Combatant";
import { applyHit, damageAmount, hitboxMultiplier, reactionFor } from "./Damage";
import { rayDirection, traceRay, viewToWorld } from "./SwingRay";
import { MOVE_SETS, Ray } from "./moves";
import { tuning } from "./tuning";
import { WEAPONS, weaponById } from "./weapons";

const target = (x: number, y: number, radius = 0.35): Body<string> => ({
    x,
    y,
    z: 0,
    radius,
    height: 1.7,
    plane: 0,
    owner: `npc@${x},${y}`,
});

const source = (list: Body<string>[]): BodySource<string> => ({
    collectBodies: (_p, _a, _b, _c, _d, out) => out.push(...list),
});

// Player at (100.5, 100.5) facing north (yaw 0, level), eyes at 1.25.
const attacker = { x: 100.5, y: 100.5, eyeZ: 1.25, yaw: 0, pitch: 0, plane: 0 };
const sword = weaponById("sword");
const flat: Ray = { on: 0, off: 0.1, roll: 0, vertical: false, sweep: 90 };
const noWalls = () => 0;

describe("attack ray (spec 17.2)", () => {
    it("fans 90° across the crosshair: impact +Y sweeps from right to left", () => {
        const start = rayDirection(flat, 1, 0);
        const mid = rayDirection(flat, 1, 0.5);
        const end = rayDirection(flat, 1, 1);
        expect(start.x).toBeCloseTo(Math.SQRT1_2); // 45° right
        expect(mid).toEqual({ x: -0, y: 0, z: 1 });
        expect(end.x).toBeCloseTo(-Math.SQRT1_2); // 45° left
        expect(rayDirection(flat, -1, 0).x).toBeCloseTo(-Math.SQRT1_2); // impact −Y: left to right
    });

    it("rolls the fan: 90° sweeps bottom to top, a vertical ray chops top to bottom", () => {
        const rolled = { ...flat, roll: 90 };
        expect(rayDirection(rolled, 1, 0).y).toBeCloseTo(-Math.SQRT1_2);
        expect(rayDirection(rolled, 1, 1).y).toBeCloseTo(Math.SQRT1_2);
        const chop = { ...flat, vertical: true };
        expect(rayDirection(chop, 1, 0).y).toBeCloseTo(Math.SQRT1_2);
        expect(rayDirection(chop, 1, 1).y).toBeCloseTo(-Math.SQRT1_2);
    });

    it("turns with the view", () => {
        const east = viewToWorld({ x: 0, y: 0, z: 1 }, -Math.PI / 2, 0);
        expect(east.x).toBeCloseTo(1);
        expect(east.y).toBeCloseTo(0);
        const up = viewToWorld({ x: 0, y: 0, z: 1 }, 0, Math.PI / 4);
        expect(up.z).toBeCloseTo(Math.SQRT1_2);
    });

    it("hits a target in front within reach, once per swing", () => {
        const b = target(100.5, 102);
        const seen = new Set<Body<string>>();
        expect(traceRay(attacker, sword.reach, flat, 1, 0, 1, source([b]), noWalls, seen)).toHaveLength(1);
        expect(traceRay(attacker, sword.reach, flat, 1, 0, 1, source([b]), noWalls, seen)).toHaveLength(0);
    });

    it("misses targets out of reach or behind", () => {
        const far = target(100.5, 100.5 + sword.reach + 0.4);
        const behind = target(100.5, 99.5);
        expect(traceRay(attacker, sword.reach, flat, 1, 0, 1, source([far, behind]), noWalls, new Set())).toHaveLength(0);
    });

    it("only hits what the current slice of the fan covers", () => {
        // 40° to the right: an impact +Y sweep passes it early, not late.
        const right = target(100.5 + Math.sin(0.7) * 1.5, 100.5 + Math.cos(0.7) * 1.5, 0.2);
        expect(traceRay(attacker, sword.reach, flat, 1, 0, 0.2, source([right]), noWalls, new Set())).toHaveLength(1);
        expect(traceRay(attacker, sword.reach, flat, 1, 0.8, 1, source([right]), noWalls, new Set())).toHaveLength(0);
    });

    it("never hits through a wall", () => {
        const b = target(100.5, 102.6); // within reach, but past the wall on the edge at y = 102
        const wall = (_p: number, x: number, y: number) => (x === 100 && y === 101 ? CollisionFlag.WALL_NORTH : 0);
        expect(traceRay(attacker, sword.reach, flat, 1, 0, 1, source([b]), wall, new Set())).toHaveLength(0);
    });

    it("a thrust traces only the centre line", () => {
        const thrust: Ray = { ...flat, sweep: 0 };
        const side = target(100.5 + 1.2, 101.5, 0.2);
        expect(traceRay(attacker, sword.reach, thrust, 1, 0, 1, source([side]), noWalls, new Set())).toHaveLength(0);
        expect(traceRay(attacker, sword.reach, thrust, 1, 0, 1, source([target(100.5, 102)]), noWalls, new Set())).toHaveLength(1);
    });

    it("gives each sword move its ray: quick A rolls +10°, power R +45°, power T is a thrust", () => {
        expect(MOVE_SETS.sword.quick[0].time?.rays[0].roll).toBe(10);
        expect(MOVE_SETS.sword.power.R.time?.rays[0].roll).toBe(45);
        expect(MOVE_SETS.sword.power.T.time?.rays[0].sweep).toBe(0);
        expect(MOVE_SETS.sword.fall.time?.rays[0].vertical).toBe(true);
    });
});

describe("hit zones (spec 18.3)", () => {
    it("use the guard's hitbox multipliers by height", () => {
        expect(hitboxMultiplier(0.92)).toBe(3);
        expect(hitboxMultiplier(0.7)).toBe(0.5);
        expect(hitboxMultiplier(0.5)).toBe(1);
        expect(hitboxMultiplier(0.2)).toBe(1.25);
        const quick = MOVE_SETS.sword.quick[0].hits[0];
        expect(damageAmount(sword, quick, { hitbox: 3 })).toBeCloseTo(3 * damageAmount(sword, quick));
    });

    it("scale quick strikes with weapon speed but not the rush", () => {
        expect(MOVE_SETS.sword.quick[0].changeSpeed).toBe(true);
        expect(MOVE_SETS.sword.rush.changeSpeed).toBeFalsy();
    });
});

describe("damage", () => {
    const quick = MOVE_SETS.sword.quick[0].hits[0];
    const powerHit = MOVE_SETS.sword.power.default.hits[0];

    it("follows WDmg × HitPow × strength with armour, piercing and awareness", () => {
        expect(damageAmount(sword, quick, { armour: 0 })).toBeCloseTo(21, 9);
        expect(damageAmount(sword, powerHit, { armour: 0 })).toBeCloseTo(45, 9);
        expect(damageAmount(sword, quick, { armour: 0.5 })).toBeCloseTo(21 * (1 - 0.5 * 0.9), 9);
        expect(damageAmount(sword, quick, { armour: 0, unaware: true })).toBeCloseTo(63, 9);
    });

    it("sizes reactions by fraction of max health", () => {
        expect(reactionFor(0.01, quick)).toBe("none");
        expect(reactionFor(0.1, quick)).toBe("flinch");
        expect(reactionFor(0.25, quick)).toBe("stagger");
        expect(reactionFor(0.35, powerHit)).toBe("push");
        expect(reactionFor(0.35, quick)).toBe("stagger");
        expect(reactionFor(0.5, quick)).toBe("knockdown");
    });

    it("knocks down only when the fall roll succeeds, and pushes on push flags", () => {
        const fall = MOVE_SETS.sword.fall.hits[0]; // fallChance 0.6, alwayspush 1
        const a = new Combatant(50);
        const down = applyHit(a, sword, fall, { armour: 0 }, () => 0.1);
        expect(down.knockedDown).toBe(true);
        expect(a.knockedDown).toBe(true);
        expect(down.push).toBe(2); // knocked down: long slide

        const b = new Combatant(50);
        const stays = applyHit(b, sword, fall, { armour: 0 }, () => 0.9);
        expect(stays.knockedDown).toBe(false);
        expect(stays.reaction).toBe("push");
    });

    it("kills at zero health", () => {
        const c = new Combatant(20);
        expect(applyHit(c, sword, quick, { armour: 0 }, () => 0.99).killed).toBe(true);
        expect(c.dead).toBe(true);
    });
});

describe("Combatant", () => {
    it("counts reactions down, keeps the stronger one, and stands up after a knockdown", () => {
        const c = new Combatant(100);
        c.hurt(1, "knockdown");
        c.hurt(1, "flinch");
        expect(c.reaction).toBe("knockdown");
        c.update(tuning.knockdownDuration + 0.01);
        expect(c.reaction).toBe("standup");
        expect(c.knockedDown).toBe(false);
        expect(c.incapacitated).toBe(true);
        c.update(c.standUpTime + 0.01);
        expect(c.reaction).toBe("none");
        expect(c.incapacitated).toBe(false);
    });

    it("uses the hit animation times: small hits do not stop the target, medium and long ones do", () => {
        const c = new Combatant(100);
        c.hurt(1, "flinch");
        expect(c.incapacitated).toBe(false);
        c.hurt(1, "stagger");
        expect(c.reactionTime).toBeCloseTo(tuning.mediumHitTime, 9);
        c.hurt(1, "push");
        expect(c.reactionTime).toBeCloseTo(tuning.longHitTime, 9);
        expect(c.incapacitated).toBe(true);
    });
});

describe("move and weapon tables", () => {
    it("give every family a full move set", () => {
        for (const set of Object.values(MOVE_SETS)) {
            expect(set.quick.length).toBe(2);
            for (const dir of ["default", "L", "R", "B", "T"] as const) {
                expect(set.power[dir].hits.length).toBeGreaterThan(0);
            }
            for (const move of [set.rush, set.fall, set.trample, set.huge]) {
                expect(move.hits.length).toBeGreaterThan(0);
            }
        }
        for (const w of WEAPONS) {
            expect(w.reach).toBeGreaterThan(1);
            expect(w.parryCos).toBeGreaterThan(0);
            expect(w.weight).toBeGreaterThan(0);
        }
    });
});
