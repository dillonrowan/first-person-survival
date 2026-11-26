import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { fallbackCombatStats } from "../combat/Osrs";
import type { NpcAppearanceInfo, NpcAttackClip, NpcManifest, NpcModelData } from "../world/NpcFormat";
import type { RegionListener } from "../world/WorldFormat";
import { ADJACENT } from "./AttackStyle";
import { GroundStrikes, SPLASH_SHARE, boltTiles } from "./GroundStrikes";
import { Npcs } from "./Npcs";
import { VETION_GFX } from "./NpcSpells";
import {
    BOLTS,
    BOLT_SECONDS,
    CALLING_DAMAGE,
    HOUNDS,
    SECOND_FORM_SECONDS,
    VETION,
    VETION_LINES,
    VETION_SEQ,
    VetionFight,
    bashTiles,
    circleCentres,
    lightningCentres,
} from "./Vetion";

const appearance = (id: number, name: string, size: number, hitpoints: number, speedTicks: number): NpcAppearanceInfo => ({
    id,
    displayId: id,
    name,
    size,
    combatLevel: 454,
    rotationSpeed: 32,
    file: `npcs/${id}_${id}.bin`,
    actions: ["Attack"],
    combat: { ...fallbackCombatStats(454), hitpoints, speedTicks, maxHit: { melee: 44, magic: 44 } },
});

const manifest: NpcManifest = {
    format: 5,
    source: "test",
    appearances: [
        appearance(VETION.forms[0], "Vet'ion", 3, 255, 6),
        appearance(VETION.forms[1], "Vet'ion", 3, 255, 5),
        appearance(VETION.hounds[0], "Skeleton Hellhound", 2, 30, 4),
        appearance(VETION.hounds[1], "Greater Skeleton Hellhound", 2, 30, 4),
    ],
    // Vet'ion's Rest, map square 51,159, where OSRS puts him.
    spawns: [{ appearance: 0, x: 3295, y: 10205, plane: 1, orientation: 0 }],
};

const clip = (frames: number, length = 5) => ({
    frameLengths: Uint16Array.from({ length: frames }, () => length),
    frameStep: -1,
    positions: new Int16Array(frames * 3 * 3),
});
const attackClip = (seqId: number, style: NpcAttackClip["style"] = "melee"): NpcAttackClip => ({
    ...clip(12),
    hitCycle: 54,
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
    const seqs = [...VETION_SEQ.lightning, ...VETION_SEQ.bash, VETION_SEQ.rise, ...VETION_SEQ.enrage, ...VETION_SEQ.death];
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
        attacks: [attackClip(9971), attackClip(9969, "magic")],
        extras: seqs.map((seq) => attackClip(seq)),
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

async function rest() {
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
    const strikes = new GroundStrikes(seeded(5));
    const said: string[] = [];
    const played: number[] = [];
    const fight = new VetionFight(VETION, {
        strikes,
        random: seeded(9),
        open: () => true,
        summon: (id, x, y, plane) => npcs.summon(id, x, y, plane),
        transform: (npc, id) => npcs.transform(npc, id),
        playOn: (_npc, gfx) => played.push(gfx),
        playAt: (gfx) => played.push(gfx),
        say: (text) => said.push(text),
    });
    npcs.behaviourFor = (npc) => (VETION.forms.includes(npc.appearance.id) ? fight.attach(npc) : undefined);
    listeners.forEach((l) => l.loaded(51, 159));
    await flush();
    return { npcs, fight, strikes, said, played, vetion: () => fight.npc! };
}

const playerAt = (x: number, y: number) => ({ x, y, z: 0, radius: 0.3, height: 1.4, plane: 1, owner: null });
/** Far from him, in the chamber's south-west corner. */
const FAR = playerAt(3288.5, 10196.5);
/** Next to him, south of his 3x3 (3295..3297, 10205..10207). */
const NEXT_TO = playerAt(3296.5, 10204.2);

function run(npcs: Npcs, seconds: number, player: ReturnType<typeof playerAt> | undefined, until?: () => boolean) {
    const struck: string[] = [];
    for (let t = 0; t < seconds && !until?.(); t += 0.02) {
        npcs.update(0.02, player, 0, { sincePlayerAttack: 0, strike: (_n, e) => struck.push(e.attack.style) });
    }
    return struck;
}

async function settle(npcs: Npcs, player: ReturnType<typeof playerAt>, until: () => boolean, seconds = 10) {
    for (let t = 0; t < seconds && !until(); t += 0.2) {
        run(npcs, 0.2, player);
        await flush();
    }
}

describe("Vet'ion's fight", () => {
    it("attacks a player as soon as they are in his chamber", async () => {
        const { npcs, fight, vetion } = await rest();
        run(npcs, 0.5, playerAt(3295.5, 10192.5));
        expect(fight.fighting).toBe(false);
        run(npcs, 0.1, FAR);
        expect(fight.fighting).toBe(true);
        expect(vetion().alerted).toBe(true);
    });

    it("calls five bolts from afar, one on or next to the player, each hitting 3x3 tiles", async () => {
        const { npcs, strikes, played } = await rest();
        const struck = run(npcs, 12, FAR, () => strikes.pending.some((s) => s.kind === "lightning"));
        const bolts = strikes.pending.filter((s) => s.kind === "lightning");
        expect(bolts).toHaveLength(BOLTS);
        expect(bolts.every((b) => b.tiles.length === 9 && b.max === 44 && b.left <= BOLT_SECONDS)).toBe(true);
        expect(bolts.some((b) => Math.abs(b.centre!.x - 3288) <= 1 && Math.abs(b.centre!.y - 10196) <= 1)).toBe(true);
        expect(played).toContain(VETION_GFX.cast[0]);
        expect(played.filter((g) => g === VETION_GFX.bolt[0])).toHaveLength(BOLTS);
        // His sword swing deals no melee damage.
        expect(struck).toHaveLength(0);
    });

    it("shield bashes only a player next to him, under shadows that hit up to 35", async () => {
        const { npcs, strikes, said, played, vetion } = await rest();
        run(npcs, 30, NEXT_TO, () => strikes.pending.some((s) => s.kind === "bash"));
        const bash = strikes.pending.find((s) => s.kind === "bash")!;
        expect(bash.max).toBe(VETION.bashMax);
        expect(bash.tiles.some((t) => t.x === 3296 && t.y === 10204)).toBe(true);
        expect(played).toContain(VETION_GFX.bash);
        expect(said.some((s) => VETION_LINES.bash.some((l) => s === `Vet'ion: ${l}`))).toBe(true);

        // From afar he walks up before he bashes: every bash starts with the player next to him.
        const gaps: number[] = [];
        for (let t = 0; t < 30; t += 0.02) {
            run(npcs, 0.02, FAR);
            const v = vetion();
            if (v.attacker.started?.id === "bash") {
                gaps.push(Math.hypot(FAR.x - v.body.x, FAR.y - v.body.y) - v.body.radius - FAR.radius);
            }
        }
        expect(gaps.every((g) => g <= ADJACENT)).toBe(true);
    });

    it("calls two hounds at half health, shielded by them until they die", async () => {
        const { npcs, fight, said, vetion } = await rest();
        run(npcs, 0.2, FAR);
        vetion().combatant.health = 120;
        run(npcs, 0.1, FAR);
        expect(fight.damageTaken).toBe(CALLING_DAMAGE);
        await settle(npcs, FAR, () => fight.hounds.size === HOUNDS);
        expect(fight.hounds.size).toBe(HOUNDS);
        expect([...fight.hounds].every((h) => h.appearance.id === VETION.hounds[0] && h.alerted)).toBe(true);
        expect(fight.damageTaken).toBe(0);
        expect(said.some((s) => VETION_LINES.hounds.some((l) => s === `Vet'ion: ${l}`))).toBe(true);

        for (const h of fight.hounds) h.combatant.hurt(h.combatant.health, "flinch");
        run(npcs, 0.1, FAR);
        expect(fight.damageTaken).toBe(1);
        expect(said.some((s) => VETION_LINES.houndsKilled.some((l) => s === `Vet'ion: ${l}`))).toBe(true);
        // Once a form.
        run(npcs, 5, FAR);
        expect(fight.houndsCalled).toEqual([true, false]);
        expect(fight.hounds.size).toBe(0);
    });

    it("rises in his second form at 0 health, behind a circle of bolts, and dies in it", async () => {
        const { npcs, fight, strikes, said, played, vetion } = await rest();
        run(npcs, 0.2, FAR);
        const first = vetion();
        fight.houndsCalled[0] = true;
        first.combatant.hurt(first.combatant.health, "flinch");
        run(npcs, 0.1, FAR);
        expect(first.combatant.dead).toBe(false);
        expect(fight.damageTaken).toBe(0);
        await settle(npcs, FAR, () => fight.form === 1);
        expect(said).toContain(`Vet'ion: ${VETION_LINES.rebirth}`);
        expect(played.filter((g) => g === VETION_GFX.bolt[1]).length).toBeGreaterThanOrEqual(8);
        const second = vetion();
        expect(second).not.toBe(first);
        expect(second.appearance.id).toBe(VETION.forms[1]);
        expect(second.combatant.health).toBe(second.combatant.maxHealth);
        expect(npcs.all()).not.toContain(first);
        expect(fight.fighting).toBe(true);
        strikes.clear();

        second.combatant.hurt(second.combatant.health, "flinch");
        run(npcs, 0.3, FAR);
        expect(second.combatant.dead).toBe(true);
        expect(second.ragdoll).toBeUndefined();
        expect(said.some((s) => VETION_LINES.death.some((l) => s === `Vet'ion: ${l}`))).toBe(true);
        expect(fight.fighting).toBe(false);

        // His first form comes back at his spawn.
        run(npcs, 80, undefined, () => fight.npc !== second);
        expect(vetion().appearance.id).toBe(VETION.forms[0]);
        expect(fight.form).toBe(0);
        expect(Math.floor(vetion().body.x)).toBe(3296);
    });

    it("goes back to his first form with the same health after five minutes in the second", async () => {
        const { npcs, fight, vetion } = await rest();
        run(npcs, 0.2, FAR);
        fight.houndsCalled[0] = true;
        vetion().combatant.hurt(vetion().combatant.health, "flinch");
        await settle(npcs, FAR, () => fight.form === 1);
        fight.houndsCalled[1] = true;
        vetion().combatant.health = 200;
        fight.secondFormFor = SECOND_FORM_SECONDS - 0.1;
        await settle(npcs, FAR, () => fight.form === 0, 20);
        expect(vetion().appearance.id).toBe(VETION.forms[0]);
        expect(vetion().combatant.health).toBe(200);
        expect(fight.houndsCalled).toEqual([true, true]);
    });

    it("resets to his first form at full health when the player leaves", async () => {
        const { npcs, fight, vetion } = await rest();
        run(npcs, 0.2, FAR);
        fight.houndsCalled[0] = true;
        vetion().combatant.hurt(vetion().combatant.health, "flinch");
        await settle(npcs, FAR, () => fight.form === 1);
        vetion().combatant.health = 100;
        await settle(npcs, playerAt(3295.5, 10192.5), () => fight.form === 0);
        expect(fight.fighting).toBe(false);
        expect(vetion().appearance.id).toBe(VETION.forms[0]);
        expect(vetion().combatant.health).toBe(vetion().combatant.maxHealth);
        expect(fight.houndsCalled).toEqual([false, false]);
    });
});

describe("Vet'ion's attack areas", () => {
    it("aims one bolt on or next to the player and the rest on open tiles of the chamber", () => {
        const centres = lightningCentres(VETION.arena, { x: 3290, y: 10200 }, seeded(3), () => true);
        expect(centres).toHaveLength(BOLTS);
        expect(Math.abs(centres[0].x - 3290) <= 1 && Math.abs(centres[0].y - 10200) <= 1).toBe(true);
        expect(new Set(centres.map((c) => `${c.x},${c.y}`)).size).toBe(BOLTS);
        const a = VETION.arena;
        expect(centres.every((c) => c.x >= a.minX && c.x < a.maxX && c.y >= a.minY && c.y < a.maxY)).toBe(true);
    });

    it("bashes two tiles thick on the player's side or diagonal, or one tile all round and under him", () => {
        const sw = { x: 10, y: 10 };
        const key = (ts: { x: number; y: number }[]) => ts.map((t) => `${t.x},${t.y}`).sort();
        // South: 3 wide, 2 deep.
        expect(key(bashTiles(sw, 3, 0, -3, false))).toEqual(key([10, 11, 12].flatMap((x) => [8, 9].map((y) => ({ x, y })))));
        // North-east: the 2x2 corner.
        expect(key(bashTiles(sw, 3, 3, 3, false))).toEqual(key([13, 14].flatMap((x) => [13, 14].map((y) => ({ x, y })))));
        // All round: 5x5 with his own tiles.
        expect(bashTiles(sw, 3, 1, 0, true)).toHaveLength(25);
    });

    it("rings his fall with bolts that miss only under him or 5 tiles out", () => {
        const middle = { x: 0, y: 0 };
        const covered = new Set(circleCentres(middle).flatMap((c) => boltTiles(c)).map((t) => `${t.x},${t.y}`));
        for (let x = -6; x <= 6; x++) {
            for (let y = -6; y <= 6; y++) {
                const d = Math.max(Math.abs(x), Math.abs(y));
                expect(covered.has(`${x},${y}`)).toBe(d >= 2 && d <= 4);
            }
        }
    });

    it("hits full on a bolt's centre, a third around it, and not off it", () => {
        const strikes = new GroundStrikes(() => 0.999);
        const bolt = { kind: "lightning" as const, tiles: boltTiles({ x: 5, y: 5 }), centre: { x: 5, y: 5 }, plane: 0, max: 44 };
        strikes.add(bolt, 1);
        expect(strikes.update(0.5, { x: 5.5, y: 5.5, plane: 0 })).toEqual([]);
        expect(strikes.update(0.6, { x: 5.5, y: 5.5, plane: 0 }).map((h) => h.damage)).toEqual([44]);
        strikes.add(bolt, 0);
        expect(strikes.update(0.1, { x: 6.5, y: 4.5, plane: 0 }).map((h) => h.damage)).toEqual([Math.floor(44 * SPLASH_SHARE)]);
        strikes.add(bolt, 0);
        expect(strikes.update(0.1, { x: 7.5, y: 5.5, plane: 0 })).toEqual([]);
    });
});
