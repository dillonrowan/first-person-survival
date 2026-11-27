import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { fallbackCombatStats } from "../combat/Osrs";
import type { NpcAttackClip, NpcManifest, NpcModelData } from "../world/NpcFormat";
import { CollisionFlag, type RegionListener } from "../world/WorldFormat";
import { ADJACENT } from "./AttackStyle";
import { BearTraps, TRAP_MAX_DAMAGE, TRAP_SECONDS } from "./BearTraps";
import { ARTIO, BEAR_SEQ, CALLISTO, CallistoFight, KNOCKBACK_SPEED, knockBackPath } from "./Callisto";
import { Npcs } from "./Npcs";
import { NPC_EFFECTS } from "./NpcSpells";

const orb = { kind: "orb" as const, speed: 9, color: 0 };
const rock = { kind: "rock" as const, speed: 8, color: 0 };

const manifest: NpcManifest = {
    format: 5,
    source: "test",
    appearances: [
        {
            id: CALLISTO.id,
            displayId: CALLISTO.id,
            name: "Callisto",
            size: 5,
            combatLevel: 470,
            rotationSpeed: 32,
            file: "npcs/6609_6609.bin",
            actions: ["Attack"],
            attackStyles: [
                { style: "melee", weight: 1, hitPow: 0.7, minGap: 0, cooldownScale: 1 },
                { style: "magic", weight: 0.25, hitPow: 0.7, minGap: 0, maxGap: 8, projectile: orb, cooldownScale: 1 },
                { style: "ranged", weight: 1, hitPow: 0.4, minGap: 1, maxGap: 8, projectile: rock, cooldownScale: 1 },
            ],
            combat: { ...fallbackCombatStats(470), hitpoints: 1000 },
        },
    ],
    // His den in map square 52,161, where OSRS puts him.
    spawns: [{ appearance: 0, x: 3359, y: 10328, plane: 0, orientation: 0 }],
};

const clip = (frames: number, length = 5) => ({
    frameLengths: Uint16Array.from({ length: frames }, () => length),
    frameStep: -1,
    positions: new Int16Array(frames * 3 * 3),
});
const attackClip = (seqId: number, style: NpcAttackClip["style"] = "melee"): NpcAttackClip => ({
    ...clip(4),
    hitCycle: 10,
    shove: false,
    seqId,
    style,
    launch: [1, 1],
});

function model(): NpcModelData {
    const empty = {
        positions: new Int16Array(0),
        colors: new Uint8Array(0),
        uvs: new Int16Array(0),
        sources: new Uint16Array(0),
        indices: new Uint32Array(0),
    };
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
        transparent: empty,
        idle: clip(2),
        walk: clip(2),
        attacks: [attackClip(10012), attackClip(10014, "magic"), attackClip(10013, "ranged")],
        extras: [attackClip(BEAR_SEQ.enrage), attackClip(BEAR_SEQ.death)],
    };
}

function seeded(seed = 777) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function den() {
    const listeners: RegionListener[] = [];
    const world = {
        collisionFlags: () => 0,
        groundHeight: () => 0,
        renderLevel: () => 0,
        addRegionListener: (l: RegionListener) => listeners.push(l),
    };
    const npcs = new Npcs(
        manifest,
        world,
        new THREE.Scene(),
        { opaque: new THREE.MeshBasicMaterial(), transparent: new THREE.MeshBasicMaterial() },
        async () => model(),
        seeded(),
    );
    const traps = new BearTraps(seeded(5));
    const roars: string[] = [];
    npcs.behaviourFor = (npc) =>
        new CallistoFight(npc, CALLISTO, {
            traps,
            random: seeded(9),
            open: () => true,
            roar: (_n, boss) => roars.push(boss.name),
        });
    listeners.forEach((l) => l.loaded(52, 161));
    await flush();
    const callisto = npcs.all()[0];
    return { npcs, callisto, fight: callisto.behaviour as CallistoFight, traps, roars };
}

const playerAt = (x: number, y: number) => ({ x, y, z: 0, radius: 0.3, height: 1.4, plane: 0, owner: null });

function run(npcs: Npcs, seconds: number, player: ReturnType<typeof playerAt> | undefined, until?: () => boolean) {
    const struck: string[] = [];
    for (let t = 0; t < seconds && !until?.(); t += 0.02) {
        npcs.update(0.02, player, 0, { sincePlayerAttack: 0, strike: (_n, e) => struck.push(e.attack.style) });
    }
    return struck;
}

describe("Callisto's fight", () => {
    it("attacks a player as soon as they are in the den", async () => {
        const { npcs, callisto, fight } = await den();
        run(npcs, 0.5, playerAt(3340.5, 10328.5));
        expect(fight.fighting).toBe(false);
        run(npcs, 0.1, playerAt(3359.5, 10334.5));
        expect(fight.fighting).toBe(true);
        expect(callisto.alerted).toBe(true);
    });

    it("swipes only when next to the player, hard, and throws a slow knockback orb", async () => {
        const { callisto } = await den();
        const melee = callisto.attacker.all.filter((a) => a.style === "melee" && a.id !== "roar");
        const magic = callisto.attacker.all.filter((a) => a.style === "magic");
        expect(melee.length).toBeGreaterThan(0);
        expect(melee.every((a) => a.maxGap === ADJACENT && a.minHit === CALLISTO.meleeMin)).toBe(true);
        expect(magic.every((a) => a.projectile?.speed === KNOCKBACK_SPEED)).toBe(true);
    });

    it("roars at 66% and 33%, laying bear traps across the den, none under himself", async () => {
        const { npcs, callisto, fight, traps, roars } = await den();
        const player = playerAt(3359.5, 10335.5);
        run(npcs, 0.2, player);
        callisto.combatant.health = 650;
        run(npcs, 6, player, () => traps.traps.length > 0);
        expect(roars).toEqual(["Callisto"]);
        expect(callisto.attacker.current === fight.roar || traps.traps.length > 0).toBe(true);
        run(npcs, 3, player, () => traps.traps.length > 0);
        expect(traps.traps).toHaveLength(CALLISTO.traps);
        const r = callisto.body.radius + 0.5;
        for (const t of traps.traps) {
            expect(t.x).toBeGreaterThanOrEqual(CALLISTO.arena.minX);
            expect(t.x).toBeLessThan(CALLISTO.arena.maxX);
            expect(Math.abs(t.x + 0.5 - callisto.body.x) < r && Math.abs(t.y + 0.5 - callisto.body.y) < r).toBe(false);
        }
        // Only once per threshold.
        run(npcs, 3, player);
        expect(roars).toHaveLength(1);
        callisto.combatant.health = 320;
        run(npcs, 6, player, () => roars.length > 1);
        expect(roars).toHaveLength(2);
    });

    it("lays fresh traps with every attack after the 33% roar", async () => {
        const { npcs, callisto, fight, traps } = await den();
        const player = playerAt(3359.5, 10335.5);
        run(npcs, 0.2, player);
        callisto.combatant.health = 300;
        run(npcs, 6, player, () => fight.roared.size === 2 && !callisto.attacker.busy && traps.traps.length > 0);
        traps.clear();
        run(npcs, 10, player, () => traps.traps.length > 0);
        expect(traps.traps.length).toBe(CALLISTO.traps);
    });

    it("clears his traps when the player leaves, and dies with his own animation", async () => {
        const { npcs, callisto, fight, traps } = await den();
        run(npcs, 0.2, playerAt(3359.5, 10335.5));
        fight.layTraps(callisto);
        expect(traps.traps.length).toBeGreaterThan(0);
        run(npcs, 0.1, playerAt(3340.5, 10328.5));
        expect(traps.traps).toHaveLength(0);
        expect(fight.fighting).toBe(false);
        run(npcs, 0.2, playerAt(3359.5, 10335.5));
        callisto.combatant.hurt(callisto.combatant.health, "flinch");
        run(npcs, 0.3, playerAt(3359.5, 10335.5));
        expect(callisto.ragdoll).toBeUndefined();
        expect(callisto.visualAnimationFrame).toBeGreaterThan(0);
    });
});

describe("Callisto's and Artio's knockback", () => {
    const open = () => 0;

    it("throws 3 tiles across open floor, away from the boss", () => {
        expect(knockBackPath(open, 0, 10.5, 10.5, 10.5, 5, 3)).toEqual({ clear: 3, trap: false });
    });

    it("stops at a wall: 0, 1 or 2 tiles", () => {
        // A wall along the north edge of tile y = 12.
        const wall = (_p: number, _x: number, y: number) => (y === 12 ? CollisionFlag.WALL_NORTH : 0);
        expect(knockBackPath(wall, 0, 10.5, 10.5, 10.5, 5, 3)).toEqual({ clear: 2, trap: false });
        expect(knockBackPath(wall, 0, 10.5, 12.5, 10.5, 5, 3)).toEqual({ clear: 0, trap: false });
        const blocked = (_p: number, _x: number, y: number) => (y === 12 ? CollisionFlag.OBJECT : 0);
        expect(knockBackPath(blocked, 0, 10.5, 10.5, 10.5, 5, 3)).toEqual({ clear: 1, trap: false });
    });

    it("is stopped by a bear trap when the boss's traps block it (Callisto's)", () => {
        const trap = (x: number, y: number) => x === 10 && y === 12;
        expect(knockBackPath(open, 0, 10.5, 10.5, 10.5, 5, 3, trap)).toEqual({ clear: 1, trap: true });
    });

    it("goes diagonally only when both sides are open", () => {
        expect(knockBackPath(open, 0, 10.5, 10.5, 5.5, 5.5, 3)).toEqual({ clear: 3, trap: false });
        const east = (_p: number, x: number, y: number) => (x === 11 && y === 10 ? CollisionFlag.OBJECT : 0);
        expect(knockBackPath(east, 0, 10.5, 10.5, 5.5, 5.5, 3)).toEqual({ clear: 0, trap: false });
    });

    it("hurts 5 if it flies all 3 tiles and 50 against a wall; only Callisto's traps block and stun", () => {
        const callisto = NPC_EFFECTS[CALLISTO.id].magic![0].knockBack!;
        const artio = NPC_EFFECTS[ARTIO.id].magic![0].knockBack!;
        expect(callisto.damage).toEqual([50, 35, 20, 5]);
        expect(callisto.trapsBlock).toBe(true);
        expect(callisto.stun).toBeGreaterThan(0);
        expect(artio.trapsBlock).toBe(false);
        expect(artio.stun).toBe(0);
    });
});

describe("bear traps", () => {
    it("catch a player who steps on one, for up to 15, and expire otherwise", () => {
        const traps = new BearTraps(() => 0.999);
        traps.lay([{ x: 5, y: 5 }, { x: 8, y: 8 }], 0);
        expect(traps.at(5, 5, 0)).toBe(true);
        const sprung: number[] = [];
        const hits = traps.update(0.1, { x: 5.5, y: 5.5, plane: 0 }, (t) => sprung.push(t.x));
        expect(hits).toEqual([TRAP_MAX_DAMAGE]);
        expect(sprung).toEqual([5]);
        expect(traps.at(5, 5, 0)).toBe(false);
        expect(traps.update(TRAP_SECONDS, undefined)).toEqual([]);
        expect(traps.traps).toHaveLength(0);
    });

    it("are replaced by a fresh set", () => {
        const traps = new BearTraps();
        traps.lay([{ x: 1, y: 1 }], 0);
        traps.lay([{ x: 2, y: 2 }, { x: 3, y: 3 }], 0);
        expect(traps.traps.map((t) => t.x)).toEqual([2, 3]);
    });
});
