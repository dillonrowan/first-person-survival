import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { fallbackCombatStats } from "../combat/Osrs";
import type { NpcAttackClip, NpcManifest, NpcModelData } from "../world/NpcFormat";
import type { RegionListener } from "../world/WorldFormat";
import { Npcs } from "./Npcs";
import { OBOR_ID, OBOR_SEQ, OborFight, SLAM } from "./Obor";

const rock = { kind: "rock" as const, speed: 9, color: 0 };

const manifest: NpcManifest = {
    format: 5,
    source: "test",
    appearances: [
        {
            id: OBOR_ID,
            displayId: OBOR_ID,
            name: "Obor",
            size: 2,
            combatLevel: 106,
            rotationSpeed: 32,
            file: "npcs/7416_7416.bin",
            actions: ["Attack"],
            attackStyles: [
                { style: "melee", weight: 1, hitPow: 0.7, minGap: 0, cooldownScale: 1.5 },
                { style: "ranged", weight: 1, hitPow: 0.5, minGap: 1, maxGap: 8, projectile: rock, cooldownScale: 1.5 },
            ],
            combat: { ...fallbackCombatStats(106), hitpoints: 120 },
        },
    ],
    // His arena in map square 48,153.
    spawns: [{ appearance: 0, x: 3091, y: 9798, plane: 0, orientation: 0 }],
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
        attacks: [attackClip(4652), attackClip(7173, "ranged")],
        extras: [attackClip(OBOR_SEQ.death)],
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

/** The lair, with Obor deciding to come after the player by `approach` (default: as OSRS rolls it). */
async function lair(approach: () => number = seeded(31)) {
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
    npcs.behaviourFor = (npc) => (npc.appearance.id === OBOR_ID ? new OborFight(npc, approach) : undefined);
    listeners.forEach((l) => l.loaded(48, 153));
    await flush();
    const obor = npcs.all()[0];
    return { npcs, obor, fight: obor.behaviour as OborFight };
}

const playerAt = (x: number, y: number) => ({ x, y, z: 0, radius: 0.3, height: 1.4, plane: 0, owner: null });

function run(npcs: Npcs, seconds: number, player: ReturnType<typeof playerAt> | undefined, until?: () => boolean) {
    const struck: string[] = [];
    for (let t = 0; t < seconds && !until?.(); t += 0.02) {
        npcs.update(0.02, player, 0, { sincePlayerAttack: 0, strike: (_n, e) => struck.push(e.attack.style) });
    }
    return struck;
}

describe("Obor's fight", () => {
    it("waits until a player climbs down into his arena, then attacks", async () => {
        const { npcs, obor, fight } = await lair();
        // In the safe zone above the arena.
        run(npcs, 2, playerAt(3091.5, 9810.5));
        expect(fight.mode).toBe("waiting");
        expect(run(npcs, 2, playerAt(3091.5, 9810.5))).toEqual([]);
        run(npcs, 0.1, playerAt(3091.5, 9804.5));
        expect(fight.mode).toBe("fighting");
        expect(obor.alerted).toBe(true);
    });

    it("stands and throws at a player out of his reach when he does not come after them", async () => {
        const { npcs, obor } = await lair(() => 0.99);
        const start = { x: obor.body.x, y: obor.body.y };
        const struck = run(npcs, 20, playerAt(3098.5, 9803.5));
        expect(Math.hypot(obor.body.x - start.x, obor.body.y - start.y)).toBeLessThan(0.4);
        expect(struck.length).toBeGreaterThan(2);
        expect(struck.every((s) => s === "ranged")).toBe(true);
    });

    it("comes after the player when he rolls to, and clubs them once next to them", async () => {
        const { npcs, obor, fight } = await lair(() => 0);
        const player = playerAt(3098.5, 9803.5);
        const start = { x: obor.body.x, y: obor.body.y };
        // His first throw, and he is coming.
        run(npcs, 10, player, () => fight.approaching);
        expect(fight.approaching).toBe(true);
        const struck = run(npcs, 40, player);
        expect(Math.hypot(obor.body.x - start.x, obor.body.y - start.y)).toBeGreaterThan(2);
        expect(struck).toContain("melee");
    });

    it("slams: his clubs carry the knock back, his throws do not", async () => {
        const { obor } = await lair();
        const melee = obor.attacker.all.filter((a) => a.style === "melee");
        const ranged = obor.attacker.all.filter((a) => a.style === "ranged");
        expect(melee.length).toBeGreaterThan(0);
        expect(melee.every((a) => a.knockBack === SLAM)).toBe(true);
        expect(ranged.every((a) => a.knockBack === undefined && a.minGap === 0)).toBe(true);
    });

    it("resets when the player leaves the arena", async () => {
        const { npcs, obor, fight } = await lair();
        run(npcs, 0.2, playerAt(3091.5, 9803.5));
        obor.combatant.health = 50;
        run(npcs, 0.1, playerAt(3091.5, 9810.5));
        expect(fight.mode).toBe("waiting");
        expect(obor.combatant.health).toBe(obor.combatant.maxHealth);
    });

    it("plays his death animation", async () => {
        const { npcs, obor } = await lair();
        run(npcs, 0.2, playerAt(3091.5, 9803.5));
        obor.combatant.hurt(obor.combatant.health, "flinch");
        run(npcs, 0.3, playerAt(3091.5, 9803.5));
        expect(obor.ragdoll).toBeUndefined();
        expect(obor.visualAnimationFrame).toBeGreaterThan(0);
    });
});
