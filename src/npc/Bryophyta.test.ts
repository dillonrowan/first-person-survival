import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { fallbackCombatStats } from "../combat/Osrs";
import type { NpcAttackClip, NpcManifest, NpcModelData } from "../world/NpcFormat";
import type { RegionListener } from "../world/WorldFormat";
import { BRYOPHYTA_ID, BRYOPHYTA_SEQ, BryophytaFight, GROWTHLINGS, GROWTHLING_ID, inChamber } from "./Bryophyta";
import { Npcs } from "./Npcs";

const orb = { kind: "orb" as const, speed: 9, color: 0 };

const manifest: NpcManifest = {
    format: 5,
    source: "test",
    appearances: [
        {
            id: BRYOPHYTA_ID,
            displayId: BRYOPHYTA_ID,
            name: "Bryophyta",
            size: 3,
            combatLevel: 128,
            rotationSpeed: 32,
            file: "npcs/8195_8195.bin",
            actions: ["Attack"],
            attackStyles: [
                { style: "melee", weight: 1, hitPow: 0.7, minGap: 0, cooldownScale: 1.5 },
                { style: "magic", weight: 1, hitPow: 0.44, minGap: 0, maxGap: 8, projectile: orb, cooldownScale: 1.5 },
            ],
            combat: { ...fallbackCombatStats(128), hitpoints: 115 },
        },
        { id: GROWTHLING_ID, displayId: GROWTHLING_ID, name: "Growthling", size: 1, combatLevel: 37, rotationSpeed: 32, file: "npcs/8194_8194.bin", actions: ["Attack"] },
    ],
    // Map square 50,155: her chamber. The growthlings have no spawn: she calls them up.
    spawns: [{ appearance: 0, x: 3220, y: 9933, plane: 0, orientation: 0 }],
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

function model(attacks: NpcAttackClip[], extras?: NpcAttackClip[]): NpcModelData {
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
        attacks,
        ...(extras ? { extras } : {}),
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

async function lair() {
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
        async (file) =>
            file.startsWith("npcs/8195")
                ? model([attackClip(4658), attackClip(7173, "magic")], Object.values(BRYOPHYTA_SEQ).map((s) => attackClip(s)))
                : model([attackClip(3262)]),
        random,
    );
    const messages: string[] = [];
    npcs.behaviourFor = (npc) =>
        npc.appearance.id === BRYOPHYTA_ID
            ? new BryophytaFight(npc, {
                  summonGrowthling: (x, y, plane) => npcs.summon(GROWTHLING_ID, x, y, plane),
                  random,
                  say: (text) => messages.push(text),
              })
            : undefined;
    listeners.forEach((l) => l.loaded(50, 155));
    await flush();
    const bryophyta = npcs.all()[0];
    return { npcs, bryophyta, fight: bryophyta.behaviour as BryophytaFight, messages };
}

const playerAt = (x: number, y: number) => ({ x, y, z: 0, radius: 0.3, height: 1.4, plane: 0, owner: null });

function run(npcs: Npcs, seconds: number, player: ReturnType<typeof playerAt> | undefined, sincePlayerAttack = 0, until?: () => boolean) {
    const struck: string[] = [];
    for (let t = 0; t < seconds && !until?.(); t += 0.02) {
        npcs.update(0.02, player, 0, { sincePlayerAttack, strike: (_n, e) => struck.push(e.attack.style) });
    }
    return struck;
}

describe("Bryophyta's fight", () => {
    it("waits in her chamber until a player walks in, then attacks", async () => {
        const { npcs, bryophyta, fight } = await lair();
        run(npcs, 2, playerAt(3174.5, 9899.5));
        expect(bryophyta.alerted).toBe(false);
        run(npcs, 0.1, playerAt(3215.5, 9937.5));
        expect(fight.mode).toBe("fighting");
        expect(bryophyta.alerted).toBe(true);
    });

    it("stands her ground and casts at a player out of her reach", async () => {
        const { npcs, bryophyta } = await lair();
        const start = { x: bryophyta.body.x, y: bryophyta.body.y };
        const struck = run(npcs, 20, playerAt(3215.5, 9939.5));
        expect(Math.hypot(bryophyta.body.x - start.x, bryophyta.body.y - start.y)).toBeLessThan(0.4);
        expect(struck.length).toBeGreaterThan(0);
        expect(struck.every((s) => s === "magic")).toBe(true);
    });

    it("clubs a player next to her", async () => {
        const { npcs, bryophyta } = await lair();
        const struck = run(npcs, 30, playerAt(bryophyta.body.x, bryophyta.body.y + 1.9));
        expect(struck).toContain("melee");
    });

    it("calls up three growthlings once hurt, and takes no damage while they live", async () => {
        const { npcs, bryophyta, fight, messages } = await lair();
        const player = playerAt(3215.5, 9939.5);
        run(npcs, 0.2, player);
        // Not before she has lost a quarter of her health.
        run(npcs, 30, player);
        expect(fight.growthlings.size).toBe(0);

        bryophyta.combatant.health = 80;
        run(npcs, 120, player, 0, () => fight.growthlings.size > 0);
        await flush();
        await flush();
        expect(fight.growthlings.size).toBe(GROWTHLINGS);
        expect(messages).toContain("Bryophyta calls up her growthlings!");
        const growthlings = [...fight.growthlings];
        expect(growthlings.every((g) => g.alerted && inChamber(g.body.x, g.body.y, 0))).toBe(true);
        expect(fight.damageTaken).toBe(0);

        // Any weapon kills them; with the last one gone she can be hurt again.
        for (const g of growthlings) g.combatant.hurt(g.combatant.health, "flinch");
        npcs.update(0.02, player);
        expect(fight.damageTaken).toBe(1);
    });

    it("does not summon while the player leaves her alone", async () => {
        const { npcs, bryophyta, fight } = await lair();
        const player = playerAt(3215.5, 9939.5);
        run(npcs, 0.2, player);
        bryophyta.combatant.health = 80;
        run(npcs, 60, player, 30);
        expect(fight.growthlings.size).toBe(0);
    });

    it("resets when the player gets away", async () => {
        const { npcs, bryophyta, fight } = await lair();
        run(npcs, 0.2, playerAt(3215.5, 9939.5));
        bryophyta.combatant.health = 50;
        run(npcs, 30, undefined, 0, () => fight.mode === "waiting");
        expect(fight.mode).toBe("waiting");
        expect(bryophyta.combatant.health).toBe(bryophyta.combatant.maxHealth);
    });

    it("plays her death animation", async () => {
        const { npcs, bryophyta } = await lair();
        run(npcs, 0.2, playerAt(3215.5, 9939.5));
        bryophyta.combatant.hurt(bryophyta.combatant.health, "flinch");
        run(npcs, 0.3, playerAt(3215.5, 9939.5));
        expect(bryophyta.ragdoll).toBeUndefined();
        expect(bryophyta.visualAnimationFrame).toBeGreaterThan(0);
    });
});
