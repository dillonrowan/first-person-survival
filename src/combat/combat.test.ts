import { describe, expect, it } from "vitest";

import type { Body, BodySource } from "../physics/Bodies";
import { CollisionFlag } from "../world/WorldFormat";
import { Combatant } from "./Combatant";
import { applyHit, damageAmount, hitboxMultiplier, reactionFor } from "./Damage";
import { PlayerCombat, type CombatTarget } from "./PlayerCombat";
import { pushDirection, rayDirection, sweepDirection, traceRay, viewToWorld } from "./SwingRay";
import { MOVE_SETS, Ray } from "./moves";
import { tuning } from "./tuning";
import { ANTI_DRAGON_SHIELD } from "./Shields";
import { WEAPONS, weaponById } from "./weapons";
import type { AttackStyle } from "../npc/AttackStyle";
import { fallbackCombatStats } from "./Osrs";
import { XpLedger } from "./XpLedger";
import { NO_GEAR, type CombatGear } from "./Equipment";
import { PlayerSkills } from "./Skills";
import { Spellbook, SPELLS } from "./Spells";

/** The attacker stats of a level 1 NPC with these max hits. */
const attackerStats = (maxHit: Partial<Record<AttackStyle, number>>) => ({ ...fallbackCombatStats(1), maxHit });
/** Cycles through the values: a strike that hits draws 3 numbers (hit, damage, rounding). */
const scripted = (...values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
};
const HITS_FOR_MAX = [0, 0.99, 0.5];

const target = (x: number, y: number, radius = 0.35, height = 1.7): Body<string> => ({
    x,
    y,
    z: 0,
    radius,
    height,
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

    it("allows limited downward aim for a low giant spider", () => {
        const spider = target(100.5, 102, 0.35, 0.5);
        expect(traceRay(attacker, sword.reach, flat, 1, 0, 1, source([spider]), noWalls, new Set())).toHaveLength(1);
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

describe("which way a hit drives its target", () => {
    it("knows which way the blade moves across the ground", () => {
        // Facing north: right to left is west (−x), left to right east (+x).
        const rightToLeft = sweepDirection(flat, 1, 0.5, 0, 0)!;
        expect(rightToLeft.x).toBeCloseTo(-1);
        expect(rightToLeft.y).toBeCloseTo(0);
        expect(sweepDirection(flat, -1, 0.5, 0, 0)!.x).toBeCloseTo(1);
        // Facing east, left to right is south.
        expect(sweepDirection(flat, -1, 0.5, -Math.PI / 2, 0)!.y).toBeCloseTo(-1);
        // A thrust and a straight-down chop have no sideways direction.
        expect(sweepDirection({ ...flat, sweep: 0 }, 1, 0.5, 0, 0)).toBeUndefined();
        expect(sweepDirection({ ...flat, vertical: true }, 1, 0.5, 0, 0)).toBeUndefined();
    });

    it("reports the blade's direction with each hit", () => {
        // Left to right, struck where the arc first touches the target: moving east (and a little
        // forward, as the arc still curves there).
        const [hit] = traceRay(attacker, sword.reach, flat, -1, 0, 1, source([target(100.5, 101.5)]), noWalls, new Set());
        expect(hit.swingX).toBeGreaterThan(0.9);
        expect(Math.abs(hit.swingY!)).toBeLessThan(0.45);
    });

    it("drives mostly along the swing, partly away from the attacker; thrusts straight away", () => {
        const ahead = { dirX: 0, dirY: 1 };
        const swept = pushDirection({ ...ahead, swingX: 1, swingY: 0 });
        expect(Math.hypot(swept.x, swept.y)).toBeCloseTo(1);
        expect(swept.x).toBeGreaterThan(0.85);
        expect(swept.y).toBeGreaterThan(0.25);
        expect(pushDirection(ahead)).toEqual({ x: 0, y: 1 });
    });

    it("pushes a struck NPC the way each quick strike swings: A to the right, B to the left", () => {
        const pushes: number[] = [];
        const dummy: CombatTarget = {
            combatant: new Combatant(10_000),
            attackable: true,
            inCombat: true,
            takeHit: (dirX) => pushes.push(dirX),
            kick: () => "hit",
        };
        const body: Body<CombatTarget> = { x: 100.5, y: 101.3, z: 0, radius: 0.35, height: 1.7, plane: 0, owner: dummy };
        const combat = new PlayerCombat({ collectBodies: (_p, _a, _b, _c, _d, out) => out.push(body) }, noWalls, () => 0.99);
        const player = {
            ...attacker,
            z: 0,
            eyeHeight: 1.25,
            sprinting: false,
            grounded: true,
            verticalSpeed: 0,
            stamina: { value: 10, spend: () => true },
            applyImpulse: () => {},
        };
        // Two clicks, 0.8 s apart.
        for (let click = 0; click < 2; click++) {
            for (let t = 0; t < 0.8; t += 0.01) {
                combat.update(0.01, player, { attackDown: t < 0.03, forward: 0, strafe: 0 });
            }
        }
        // Struck a little left (A) or right (B) of centre, where the arc also carries forward.
        expect(pushes).toHaveLength(2);
        expect(pushes[0]).toBeGreaterThan(0.6);
        expect(pushes[1]).toBeLessThan(-0.6);
    });

    it("lets the player attack a low giant spider with the longsword", () => {
        let hits = 0;
        const spider: CombatTarget = {
            combatant: new Combatant(100),
            attackable: true,
            inCombat: true,
            takeHit: () => hits++,
            kick: () => "hit",
        };
        const body: Body<CombatTarget> = {
            x: 100.5,
            y: 101.3,
            z: 0,
            radius: 0.35,
            height: 0.5,
            plane: 0,
            owner: spider,
        };
        const combat = new PlayerCombat({ collectBodies: (_p, _a, _b, _c, _d, out) => out.push(body) }, noWalls, () => 0.99);
        combat.weaponIndex = WEAPONS.findIndex((weapon) => weapon.id === "sword");
        let reports = 0;
        combat.onHit = () => reports++;
        const player = {
            ...attacker,
            z: 0,
            eyeHeight: 1.25,
            sprinting: false,
            grounded: true,
            verticalSpeed: 0,
            stamina: { value: 10, spend: () => true },
            applyImpulse: () => {},
        };
        for (let t = 0; t < 0.8; t += 0.01) {
            combat.update(0.01, player, { attackDown: t < 0.03, forward: 0, strafe: 0 });
        }
        expect(hits).toBeGreaterThan(0);
        expect(reports).toBeGreaterThan(0);
        expect(spider.combatant.health).toBeLessThan(100);
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
    it("with unlimited health still reacts to hits but never loses health", () => {
        const c = new Combatant(100);
        c.unlimitedHealth = true;
        c.hurt(1e6, "stagger");
        expect(c.health).toBe(100);
        expect(c.dead).toBe(false);
        expect(c.reaction).toBe("stagger");
    });

    it("gives the player unlimited health while tuning.playerUnlimitedHealth is on", () => {
        const combat = new PlayerCombat(source([]) as never, noWalls, scripted(...HITS_FOR_MAX));
        const player = {
            ...attacker,
            z: 0,
            eyeHeight: 1.25,
            sprinting: false,
            grounded: true,
            verticalSpeed: 0,
            stamina: { value: 10, spend: () => true },
            applyImpulse: () => {},
        };
        const strike = {
            fromX: 100.5,
            fromY: 101.5,
            gap: 0,
            range: 1,
            hitPow: 100,
            breaksParry: false,
            push: false,
            style: "melee" as const,
            attacker: attackerStats({ melee: 100 }),
        };
        const before = tuning.playerUnlimitedHealth;
        try {
            tuning.playerUnlimitedHealth = true;
            combat.update(0.01, player, { attackDown: false, forward: 0, strafe: 0 });
            expect(combat.receiveStrike(player, strike, true).outcome).toBe("hit");
            expect(combat.combatant.healthFraction).toBe(1);
            tuning.playerUnlimitedHealth = false;
            combat.update(0.01, player, { attackDown: false, forward: 0, strafe: 0 });
            combat.receiveStrike(player, strike, true);
            expect(combat.combatant.dead).toBe(true);
        } finally {
            tuning.playerUnlimitedHealth = before;
        }
    });

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

describe("NPC attack styles against the player", () => {
    function setup(random = scripted(...HITS_FOR_MAX)) {
        const combat = new PlayerCombat(source([]) as never, noWalls, random);
        const pushes: number[] = [];
        const player = {
            ...attacker,
            z: 0,
            eyeHeight: 1.25,
            sprinting: false,
            grounded: true,
            verticalSpeed: 0,
            stamina: { value: 10, spend: () => true },
            applyImpulse: (x: number, y: number) => pushes.push(Math.hypot(x, y)),
        };
        combat.update(0.01, player, { attackDown: false, forward: 0, strafe: 0 });
        return { combat, player, pushes };
    }
    // Max hits per style; the scripted rolls hit and roll the top of the range.
    const maxHits = { melee: 4, ranged: 4, magic: 4, dragonfire: 50, icebreath: 20 };
    const strike = (style: AttackStyle, extra: object = {}) => ({
        fromX: 100.5, fromY: 101.5, gap: 0, range: 1, hitPow: 0.5, breaksParry: style !== "melee", push: false, style,
        attacker: attackerStats(maxHits), ...extra,
    });

    it("hits an arrow, spell or breath that already arrived without a gap or cone test", () => {
        const { combat, player } = setup();
        const far = strike("ranged", { gap: 10, direct: true });

        expect(combat.receiveStrike(player, far, false)).toMatchObject({ outcome: "hit", style: "ranged" });
        expect(combat.receiveStrike(player, { ...far, direct: false }, false).outcome).toBe("miss");
    });

    it("does not parry anything but a melee blow", () => {
        for (const style of ["ranged", "magic", "dragonfire", "icebreath"] as const) {
            const { combat, player } = setup();
            combat.blocking = true;
            expect(combat.receiveStrike(player, strike(style, { breaksParry: false, direct: true }), true).outcome).toBe("hit");
        }
    });

    it("cuts dragonfire to a tenth with an anti-dragon shield, but not icy breath", () => {
        const bare = setup();
        expect(bare.combat.receiveStrike(bare.player, strike("dragonfire", { direct: true }), true).damage).toBe(50);

        const shielded = setup();
        shielded.combat.shield = ANTI_DRAGON_SHIELD;
        const fire = shielded.combat.receiveStrike(shielded.player, strike("dragonfire", { direct: true }), true);
        expect(fire.damage).toBe(5);
        expect(fire.shielded).toBe(true);
        const ice = shielded.combat.receiveStrike(shielded.player, strike("icebreath", { direct: true }), true);
        expect(ice.damage).toBe(20);
        expect(ice.shielded).toBe(false);
    });

    it("loses the shield while a bow takes both hands", () => {
        const { combat, player } = setup();
        combat.shield = ANTI_DRAGON_SHIELD;
        expect(combat.shieldActive).toBe(true);
        combat.equipWeapon(WEAPONS.find((w) => w.family === "bow")!);

        expect(combat.shieldActive).toBe(false);
        expect(combat.receiveStrike(player, strike("dragonfire", { direct: true }), true).damage).toBe(50);
    });

    it("rolls a miss: no damage, but the player still flinches and is pushed", () => {
        const { combat, player, pushes } = setup(scripted(0.999));
        const report = combat.receiveStrike(player, strike("melee"), true);

        expect(report).toMatchObject({ outcome: "hit", damage: 0, missed: true });
        expect(combat.combatant.health).toBe(combat.combatant.maxHealth);
        expect(combat.combatant.reaction).toBe("flinch");
        expect(pushes).toHaveLength(1);
    });

    it("rolls damage from 0 to the max hit", () => {
        const zero = setup(scripted(0, 0, 0.5));
        expect(zero.combat.receiveStrike(zero.player, strike("melee"), true).damage).toBe(0);
        const top = setup(scripted(0, 0.99, 0.5));
        expect(top.combat.receiveStrike(top.player, strike("melee"), true).damage).toBe(4);
    });

    it("scales a strike by how much of the attack interval has passed", () => {
        const { combat, player } = setup(scripted(0, 0.99, 0));
        expect(combat.receiveStrike(player, strike("melee", { rate: 0.5 }), true).damage).toBe(2);
    });

    it("lets a poisonous monster poison the player, hit or miss, but not with breath", () => {
        const poisonous = { ...attackerStats(maxHits), poisonSeverity: 30 };
        // Miss (0.999), then the poison roll (0.1 < 1/4).
        const missed = setup(scripted(0.999, 0.1));
        const report = missed.combat.receiveStrike(missed.player, strike("melee", { attacker: poisonous }), true);
        expect(report).toMatchObject({ missed: true, poisoned: true });
        expect(missed.combat.combatant.poison.severity).toBe(30);
        // A failed poison roll (0.9).
        const lucky = setup(scripted(0.999, 0.9));
        expect(lucky.combat.receiveStrike(lucky.player, strike("melee", { attacker: poisonous }), true).poisoned).toBeUndefined();
        const breath = setup(scripted(0.999, 0.1));
        breath.combat.receiveStrike(breath.player, strike("dragonfire", { attacker: poisonous, direct: true }), true);
        expect(breath.combat.combatant.poison.active).toBe(false);
    });

    it("splits a breath max hit over its ticks", () => {
        const { combat, player } = setup(scripted(0, 0.99, 0.5));
        const tick = combat.receiveStrike(player, strike("dragonfire", { direct: true, share: 0.25 }), true);
        expect(tick.damage).toBe(Math.floor(0.99 * (Math.ceil(50 * 0.25) + 1)));
    });

    it("pushes a little for arrows and spells, not at all for breath", () => {
        const melee = setup();
        melee.combat.receiveStrike(melee.player, strike("melee"), true);
        const arrow = setup();
        arrow.combat.receiveStrike(arrow.player, strike("ranged", { direct: true }), true);
        const fire = setup();
        fire.combat.receiveStrike(fire.player, strike("dragonfire", { direct: true }), true);

        expect(arrow.pushes[0]).toBeCloseTo(melee.pushes[0] * tuning.npcProjectilePush);
        expect(fire.pushes).toEqual([]);
    });
});

describe("OSRS damage from the player", () => {
    const player = {
        ...attacker,
        z: 0,
        eyeHeight: 1.25,
        sprinting: false,
        grounded: true,
        verticalSpeed: 0,
        stamina: { value: 10, spend: () => true },
        applyImpulse: () => {},
    };
    const idle = { attackDown: false, forward: 0, strafe: 0 };

    function dummy(hp = 5) {
        const ledger = new XpLedger();
        const target: CombatTarget = {
            combatant: new Combatant(hp),
            attackable: true,
            inCombat: true,
            combatStats: { ...fallbackCombatStats(1), hitpoints: hp },
            xpLedger: ledger,
            takeHit: () => undefined,
            kick: () => "hit",
        };
        const body: Body<CombatTarget> = { x: 100.5, y: 101.3, z: 0, radius: 0.35, height: 1.7, plane: 0, owner: target };
        return { target, ledger, bodies: { collectBodies: (_p: number, _a: number, _b: number, _c: number, _d: number, out: Body<CombatTarget>[]) => void out.push(body) } };
    }

    it("rolls a melee hit with the OSRS formulas and banks the XP", () => {
        const { target, ledger, bodies } = dummy(1000);
        const combat = new PlayerCombat(bodies, noWalls, scripted(0, 0.99, 0));
        combat.weaponIndex = WEAPONS.findIndex((w) => w.id === "sword");
        combat.melee.weapon = sword;
        for (let t = 0; t < 0.8; t += 0.01) {
            combat.update(0.01, player, { attackDown: t < 0.03, forward: 0, strafe: 0 });
        }
        const dealt = 1000 - target.combatant.health;
        expect(dealt).toBeGreaterThanOrEqual(1);
        // Level 1 Melee, no gear: max hit 1, so a hit deals 1 (scaled by the move and hit zone).
        const xp = ledger.drain();
        expect(xp.melee).toBeCloseTo(4 * dealt);
        expect(xp.hitpoints).toBeCloseTo((4 * dealt) / 3);
    });

    it("poisons with a poisoned weapon on a damaging hit, but not an immune monster", () => {
        const swing = (immune: boolean) => {
            const { target, bodies } = dummy(1000);
            (target as { combatStats: object }).combatStats = { ...target.combatStats!, poisonImmune: immune };
            // Hit, top roll, round up, no stun (0.99; a flinch has no fall roll), then the poison roll (0).
            const combat = new PlayerCombat(bodies, noWalls, scripted(0, 0.99, 0, 0.99, 0), new PlayerSkills(), new Spellbook(), {
                ...NO_GEAR,
                weaponName: () => "Bronze dagger(p)",
            });
            combat.melee.weapon = sword;
            let poisoned = false;
            combat.onHit = ({ result }) => (poisoned ||= !!result.poisoned);
            for (let t = 0; t < 0.8; t += 0.01) {
                combat.update(0.01, player, { attackDown: t < 0.03, forward: 0, strafe: 0 });
            }
            return { poisoned, severity: target.combatant.poison.severity };
        };
        const hit = swing(false);
        expect(hit.poisoned).toBe(true);
        // Bronze dagger(p): severity 20, and the first poison hit (4) lands at once.
        expect(hit.severity).toBeGreaterThanOrEqual(19);
        expect(swing(true).poisoned).toBe(false);
    });

    it("a missed swing deals 0 but the target still reacts", () => {
        const { target, ledger, bodies } = dummy(1000);
        const combat = new PlayerCombat(bodies, noWalls, scripted(0.999));
        combat.melee.weapon = sword;
        let missed = false;
        combat.onHit = ({ result }) => (missed = result.missed);
        for (let t = 0; t < 0.8; t += 0.01) {
            combat.update(0.01, player, { attackDown: t < 0.03, forward: 0, strafe: 0 });
        }
        expect(missed).toBe(true);
        expect(target.combatant.health).toBe(1000);
        expect(target.combatant.reaction).toBe("flinch");
        expect(ledger.empty).toBe(true);
    });

    function casting(gear: Partial<CombatGear> = {}, skills = new PlayerSkills(), book = new Spellbook()) {
        const used: number[][] = [];
        const combat = new PlayerCombat(source([]) as never, noWalls, () => 0.5, skills, book, {
            ...NO_GEAR,
            useRunes: (cost) => void used.push(cost.map((c) => c.count)),
            ...gear,
        });
        const failures: string[] = [];
        combat.onCastFailed = (m) => failures.push(m);
        return { combat, used, failures };
    }

    it("casts the equipped spell with any weapon, spending its runes", () => {
        const { combat, used } = casting();
        combat.update(0.01, player, { ...idle, castPressed: true });

        expect(combat.arrows).toHaveLength(1);
        expect(combat.arrows[0].spell).toBeDefined();
        expect(combat.arrows[0].gravity).toBe(0);
        expect(used).toEqual([[1, 1]]); // Wind Strike: 1 air, 1 mind
    });

    it("waits between casts", () => {
        const { combat } = casting();
        combat.update(0.01, player, { ...idle, castPressed: true });
        combat.update(0.01, player, { ...idle, castPressed: true });
        expect(combat.arrows).toHaveLength(1);
    });

    it("does not parry with a staff or wand", () => {
        const { combat } = casting();
        combat.equipWeapon(WEAPONS.find((w) => w.family === "staff")!);
        combat.update(0.01, player, { ...idle, blockDown: true });
        expect(combat.holdsCaster).toBe(true);
        expect(combat.blocking).toBe(false);
    });

    it("cannot cast a locked spell or without runes", () => {
        const book = new Spellbook();
        book.equip("fire-bolt", 99);
        const locked = casting({}, new PlayerSkills(), book);
        locked.combat.update(0.01, player, { ...idle, castPressed: true });
        expect(locked.combat.arrows).toHaveLength(0);
        expect(locked.failures[0]).toMatch(/Magic level/);

        const noRunes = casting({ hasRunes: () => false });
        noRunes.combat.update(0.01, player, { ...idle, castPressed: true });
        expect(noRunes.combat.arrows).toHaveLength(0);
        expect(noRunes.failures[0]).toMatch(/runes/);
        expect(SPELLS).toHaveLength(20);
    });

    it("uses one arrow per shot and cannot fire without ammunition", () => {
        let arrows = 0;
        let used = 0;
        const combat = new PlayerCombat(source([]) as never, noWalls, () => 0.5, new PlayerSkills(), new Spellbook(), {
            ...NO_GEAR,
            ammoCount: (kind) => (kind === "arrow" ? arrows : 0),
            useAmmo: () => void used++,
        });
        combat.equipWeapon(WEAPONS.find((w) => w.family === "bow")!);
        const shoot = () => {
            for (let t = 0; t < 2.5; t += 0.01) {
                combat.update(0.01, player, { attackDown: true, forward: 0, strafe: 0 });
            }
            for (let t = 0; t < 1; t += 0.01) {
                combat.update(0.01, player, { attackDown: false, forward: 0, strafe: 0 });
            }
        };
        shoot();
        expect(used).toBe(0);
        arrows = 5;
        shoot();
        expect(used).toBeGreaterThan(0);
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
