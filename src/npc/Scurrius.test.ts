import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { fallbackCombatStats } from "../combat/Osrs";
import type { NpcAttackClip, NpcManifest, NpcModelData } from "../world/NpcFormat";
import type { RegionListener } from "../world/WorldFormat";
import { BRICK_FALL_SECONDS, FallingBricks, onTile } from "./FallingBricks";
import { Npcs } from "./Npcs";
import {
    ARENA_CENTRE,
    BITES,
    FOOD_PILES,
    GIANT_RAT_ID,
    LAST_PHASE_PACE,
    RANDOM_BRICKS,
    RATS_PER_WAVE,
    SCURRIUS_IDS,
    SCURRIUS_SEQ,
    ScurriusFight,
    inArena,
} from "./Scurrius";

const orb = { kind: "orb" as const, speed: 9, color: 0 };
const rock = { kind: "rock" as const, speed: 8, color: 0 };

const manifest: NpcManifest = {
    format: 5,
    source: "test",
    appearances: [
        {
            id: 7222,
            displayId: 7222,
            name: "Scurrius",
            size: 3,
            combatLevel: 200,
            rotationSpeed: 64,
            file: "npcs/7222_7222.bin",
            actions: ["Attack"],
            attackStyles: [
                { style: "melee", weight: 1, hitPow: 0.7, minGap: 0 },
                { style: "magic", weight: 1, hitPow: 0.4, minGap: 0, maxGap: 8, projectile: orb },
                { style: "ranged", weight: 1, hitPow: 0.4, minGap: 0, maxGap: 8, projectile: rock },
            ],
            combat: { ...fallbackCombatStats(200), hitpoints: 500 },
        },
        { id: GIANT_RAT_ID, displayId: GIANT_RAT_ID, name: "Giant rat", size: 2, combatLevel: 46, rotationSpeed: 32, file: "npcs/7223_7223.bin", actions: ["Attack"] },
    ],
    // Map square 51,154: the lair. The rats have no spawn: he calls them up.
    spawns: [{ appearance: 0, x: 3302, y: 9866, plane: 0, orientation: 512 }],
};

const clip = (frames: number, length = 5) => ({
    frameLengths: Uint16Array.from({ length: frames }, () => length),
    frameStep: -1,
    positions: new Int16Array(frames * 3 * 3),
});
const attackClip = (seqId: number, style: NpcAttackClip["style"] = "melee", frames = 4): NpcAttackClip => ({
    ...clip(frames),
    hitCycle: 10,
    shove: false,
    seqId,
    style,
    launch: [1, 1],
});

function model(extras = true): NpcModelData {
    return {
        vertexCount: 3,
        bounds: Float32Array.from([0, 1, 0, 2]),
        opaque: {
            positions: Int16Array.from([0, 0, 0, 0, 100, 0, 0, 0, 0, 100, 0, 0]),
            colors: new Uint8Array(12).fill(255),
            uvs: new Int16Array(6),
            sources: Uint16Array.from([0, 1, 2]),
            indices: Uint32Array.from([0, 1, 2]),
        },
        transparent: {
            positions: new Int16Array(0),
            colors: new Uint8Array(0),
            uvs: new Int16Array(0),
            sources: new Uint16Array(0),
            indices: new Uint32Array(0),
        },
        idle: clip(2),
        walk: clip(2),
        attacks: [attackClip(10692), attackClip(10693), attackClip(10696, "magic"), attackClip(10694, "ranged")],
        ...(extras ? { extras: Object.values(SCURRIUS_SEQ).map((seq) => attackClip(seq)) } : {}),
    };
}

/** mulberry32: a seeded random that does not start with tiny values. */
function seeded(seed = 12345) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function lair(options: { extras?: boolean } = {}) {
    const listeners: RegionListener[] = [];
    const world = {
        collisionFlags: () => 0,
        groundHeight: () => 0,
        renderLevel: () => 0,
        addRegionListener: (l: RegionListener) => listeners.push(l),
    };
    const random = seeded();
    const npcs = new Npcs(
        manifest,
        world,
        new THREE.Scene(),
        { opaque: new THREE.MeshBasicMaterial(), transparent: new THREE.MeshBasicMaterial() },
        async (file) => (file.startsWith("npcs/7222") ? model(options.extras ?? true) : { ...model(false), attacks: [attackClip(4933)] }),
        random,
    );
    const bricks = new FallingBricks(random);
    const messages: string[] = [];
    npcs.behaviourFor = (npc) =>
        SCURRIUS_IDS.has(npc.appearance.id)
            ? new ScurriusFight(npc, {
                  bricks,
                  summonRat: (x, y, plane) => npcs.summon(GIANT_RAT_ID, x, y, plane),
                  random,
                  say: (text) => messages.push(text),
              })
            : undefined;
    listeners.forEach((l) => l.loaded(51, 154));
    await flush();
    const scurrius = npcs.all()[0];
    return { npcs, scurrius, fight: scurrius.behaviour as ScurriusFight, bricks, messages };
}

const playerAt = (x: number, y: number) => ({ x, y, z: 0, radius: 0.3, height: 1.4, plane: 0, owner: null });

/** Runs the lair for `seconds` with the player standing at `player`; returns what reached the player. */
function run(npcs: Npcs, seconds: number, player: ReturnType<typeof playerAt> | undefined, until?: () => boolean) {
    const struck: string[] = [];
    for (let t = 0; t < seconds && !until?.(); t += 0.02) {
        npcs.update(0.02, player, 0, { strike: (_n, e) => struck.push(e.attack.id) });
    }
    return struck;
}

describe("Scurrius's fight", () => {
    it("waits in his lair until a player walks into the arena, then attacks", async () => {
        const { npcs, scurrius, fight } = await lair();
        expect(fight.mode).toBe("waiting");
        expect(scurrius.combatant.steadfast).toBe(true);

        run(npcs, 2, playerAt(3281.5, 9867.5)); // in the sewer, behind the bars
        expect(scurrius.alerted).toBe(false);

        run(npcs, 0.1, playerAt(3291.5, 9867.5));
        expect(fight.mode).toBe("fighting");
        expect(scurrius.alerted).toBe(true);
    });

    it("only swipes and stomps in his first phase", async () => {
        const { npcs, scurrius } = await lair();
        const player = playerAt(3300.5, 9867.5);
        const struck = run(npcs, 30, player);
        const started = new Set<string>();
        for (let t = 0; t < 30; t += 0.02) {
            npcs.update(0.02, player, 0, { attackStarted: (_n, a) => started.add(a.id) });
            if (scurrius.attacker.current) started.add(scurrius.attacker.current.id);
        }
        const all = [...started, ...struck];
        expect(all.length).toBeGreaterThan(0);
        expect(all.every((id) => /^(melee|stomp)/.test(id))).toBe(true);
    });

    it("runs to a food pile at 80%, eats ten bites healing on five, then swipes again", async () => {
        const { npcs, scurrius, fight } = await lair();
        const player = playerAt(3300.5, 9864.5);
        run(npcs, 0.5, player);
        const c = scurrius.combatant;
        c.health = Math.floor(c.maxHealth * 0.79);
        run(npcs, 0.1, player);
        expect(fight.mode).toBe("toPile");
        expect(fight.goal?.run).toBe(true);
        expect(FOOD_PILES.some((p) => p.x === fight.goal!.x && p.y === fight.goal!.y)).toBe(true);

        run(npcs, 10, player, () => fight.mode === "eating");
        expect(fight.mode).toBe("eating");
        expect(fight.idleSeq).toBe(SCURRIUS_SEQ.feedingIdle);
        const before = c.health;
        const allowed = scurrius.attacker.all.filter((a) => scurrius.attacker.allow!(a)).map((a) => a.id);
        expect(allowed.some((id) => id.startsWith("melee"))).toBe(false);
        expect(allowed).toEqual(expect.arrayContaining(["feeding-ranged", "feeding-magic", "feeding-stomp", "feeding-summon"]));

        run(npcs, 60, player, () => fight.mode === "fighting");
        expect(fight.mode).toBe("fighting");
        expect(fight.bites).toBe(BITES);
        // Five healing bites of 5 or 10.
        expect(c.health - before).toBeGreaterThanOrEqual(25);
        expect(c.health - before).toBeLessThanOrEqual(50);
        expect(fight.phase).toBe(2);
    });

    it("goes to the middle at 30%, enrages and fights from range, faster", async () => {
        const { npcs, scurrius, fight, messages } = await lair();
        const player = playerAt(3292.5, 9864.5);
        run(npcs, 0.5, player);
        scurrius.combatant.health = Math.floor(scurrius.combatant.maxHealth * 0.29);
        run(npcs, 0.1, player);
        expect(fight.mode).toBe("toCentre");
        expect(fight.phase).toBe(3);

        run(npcs, 10, player, () => fight.mode === "enraged");
        expect(fight.mode).toBe("enraged");
        expect(Math.hypot(scurrius.body.x - ARENA_CENTRE.x, scurrius.body.y - ARENA_CENTRE.y)).toBeLessThan(0.5);
        expect(scurrius.attacker.current?.id).toBe("enrage");
        expect(messages).toContain("Scurrius flies into a rage!");
        expect(scurrius.attacker.pace).toBe(LAST_PHASE_PACE);
        const allowed = scurrius.attacker.all.filter((a) => scurrius.attacker.allow!(a)).map((a) => a.id);
        expect(allowed.sort()).toEqual(["magic2", "ranged3", "stomp", "summon"]);
    });

    it("brings rubble down on the player's tile and around the arena when he stomps", async () => {
        const { scurrius, fight, bricks } = await lair();
        const stomp = scurrius.attacker.all.find((a) => a.id === "stomp")!;
        expect(stomp.special).toBe("bricks");
        expect(stomp.extra).toBe(scurrius.extraIndex(SCURRIUS_SEQ.stomp));

        fight.special(scurrius, stomp, "start", { x: 3295.4, y: 9870.2, plane: 0 });
        fight.special(scurrius, stomp, "impact", { x: 3299.5, y: 9862.5, plane: 0 }); // moved since
        expect(bricks.falling).toHaveLength(1 + RANDOM_BRICKS);
        expect(bricks.falling[0]).toMatchObject({ x: 3295, y: 9870, plane: 0 });
        expect(bricks.falling.every((b) => inArena(b.x, b.y, 0))).toBe(true);

        // It lands after BRICK_FALL_SECONDS on whoever still stands there.
        const target = { x: 3295.5, y: 9870.5, plane: 0 };
        expect(bricks.update(BRICK_FALL_SECONDS - 0.1, target)).toEqual([]);
        const hits = bricks.update(0.2, target);
        expect(hits.length).toBeGreaterThanOrEqual(1);
        expect(hits.every((d) => d >= 15 && d <= 22)).toBe(true);
        expect(bricks.falling).toHaveLength(0);
    });

    it("calls up six aggressive giant rats when he screeches", async () => {
        const { npcs, scurrius, fight, messages } = await lair();
        const summon = scurrius.attacker.all.find((a) => a.id === "summon")!;
        const player = { x: 3292.5, y: 9864.5, plane: 0 };

        fight.special(scurrius, summon, "impact", player);
        await flush();
        await flush();

        const rats = npcs.all().filter((n) => n.appearance.id === GIANT_RAT_ID);
        expect(rats).toHaveLength(RATS_PER_WAVE);
        expect(rats.every((r) => r.alerted && inArena(r.body.x, r.body.y, 0))).toBe(true);
        expect(fight.rats.size).toBe(RATS_PER_WAVE);
        expect(messages).toContain("Scurrius screeches, calling his rats!");
    });

    it("resets when the player gets away: full health, no rats", async () => {
        const { npcs, scurrius, fight } = await lair();
        run(npcs, 0.2, playerAt(3292.5, 9864.5));
        const summon = scurrius.attacker.all.find((a) => a.id === "summon")!;
        fight.special(scurrius, summon, "impact", { x: 3292.5, y: 9864.5, plane: 0 });
        await flush();
        scurrius.combatant.health = 300;

        run(npcs, 30, undefined, () => fight.mode === "waiting");
        expect(fight.mode).toBe("waiting");
        expect(scurrius.combatant.health).toBe(scurrius.combatant.maxHealth);
        expect(fight.rats.size).toBe(0);
        npcs.update(0.02);
        expect(npcs.all().filter((n) => n.appearance.id === GIANT_RAT_ID).every((r) => r.gone)).toBe(true);
    });

    it("plays his death animation instead of falling as a ragdoll", async () => {
        const { npcs, scurrius } = await lair();
        run(npcs, 0.2, playerAt(3292.5, 9864.5));
        scurrius.combatant.hurt(scurrius.combatant.health, "flinch");
        run(npcs, 0.5, playerAt(3292.5, 9864.5));
        expect(scurrius.ragdoll).toBeUndefined();
        expect(scurrius.visualAnimationFrame).toBeGreaterThan(0);
        run(npcs, 5, playerAt(3292.5, 9864.5));
        expect(scurrius.gone).toBe(true);
    });

    it("is not kicked over", async () => {
        const { npcs, scurrius } = await lair();
        run(npcs, 0.2, playerAt(3292.5, 9864.5));
        expect(scurrius.kick(1, 0, scurrius.body.x - 2, scurrius.body.y)).toBe("hit");
        run(npcs, 0.3, playerAt(3292.5, 9864.5));
        expect(scurrius.combatant.knockedDown).toBe(false);
        expect(scurrius.ragdoll).toBeUndefined();
    });

    it("still fights with an export that has no extra clips", async () => {
        const { npcs, scurrius, fight } = await lair({ extras: false });
        const stomp = scurrius.attacker.all.find((a) => a.id === "stomp")!;
        expect(stomp.extra).toBeUndefined();
        run(npcs, 0.5, playerAt(3300.5, 9867.5));
        expect(fight.mode).toBe("fighting");
    });
});

describe("Falling bricks", () => {
    it("counts the player's centre on a tile, with a small margin", () => {
        const brick = { x: 10, y: 20, plane: 0, left: 0 };
        expect(onTile({ x: 10.5, y: 20.5, plane: 0 }, brick)).toBe(true);
        expect(onTile({ x: 11.1, y: 20.5, plane: 0 }, brick)).toBe(true);
        expect(onTile({ x: 11.3, y: 20.5, plane: 0 }, brick)).toBe(false);
        expect(onTile({ x: 10.5, y: 20.5, plane: 1 }, brick)).toBe(false);
    });

    it("tells the view where each piece landed and can be cleared", () => {
        const bricks = new FallingBricks(() => 0);
        bricks.drop([{ x: 1, y: 2 }], 0);
        const landed: number[] = [];
        expect(bricks.update(BRICK_FALL_SECONDS + 0.01, undefined, (b) => landed.push(b.x))).toEqual([]);
        expect(landed).toEqual([1]);
        bricks.drop([{ x: 1, y: 2 }], 0);
        bricks.clear();
        expect(bricks.falling).toHaveLength(0);
    });
});
