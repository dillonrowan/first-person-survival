import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { tuning } from "../combat/tuning";
import type { NpcManifest, NpcModelData } from "../world/NpcFormat";
import { CollisionFlag, RegionListener } from "../world/WorldFormat";
import { Npc, Occupancy } from "./Npc";
import { Npcs } from "./Npcs";

const APPEARANCE = {
    id: 1,
    displayId: 1,
    name: "Man",
    size: 1,
    combatLevel: 2,
    rotationSpeed: 32,
    file: "npcs/1_1.bin",
};

// Region 50,50 covers tiles 3200..3263 on both axes; 51,50 starts at x 3264.
const manifest: NpcManifest = {
    format: 1,
    source: "test",
    appearances: [APPEARANCE],
    spawns: [
        { appearance: 0, x: 3222, y: 3218, plane: 0, orientation: 0 },
        { appearance: 0, x: 3300, y: 3218, plane: 0, orientation: 512 },
    ],
};

/** A triangle with an idle and a walk clip of two frames each. */
function modelData(): NpcModelData {
    const clip = () => ({
        frameLengths: Uint16Array.from([2, 2]),
        frameStep: -1,
        positions: Int16Array.from({ length: 2 * 3 * 3 }, (_, i) => i),
    });
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
        idle: clip(),
        walk: clip(),
    };
}

function fakeWorld(flags: (x: number, y: number) => number = () => 0) {
    const listeners: RegionListener[] = [];
    return {
        listeners,
        collisionFlags: (_plane: number, x: number, y: number) => flags(x, y),
        groundHeight: () => 0,
        renderLevel: (plane: number) => plane,
        addRegionListener: (listener: RegionListener) => {
            listeners.push(listener);
        },
        load: (mapX: number, mapY: number) => listeners.forEach((l) => l.loaded(mapX, mapY)),
        unload: (mapX: number, mapY: number) => listeners.forEach((l) => l.unloaded(mapX, mapY)),
    };
}

const materials = {
    opaque: new THREE.MeshBasicMaterial(),
    transparent: new THREE.MeshBasicMaterial(),
};

/** Lets pending promise callbacks run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(
    options: {
        flags?: (x: number, y: number) => number;
        random?: () => number;
        loadModel?: (file: string) => Promise<NpcModelData>;
    } = {},
) {
    const world = fakeWorld(options.flags);
    const scene = new THREE.Scene();
    const npcs = new Npcs(
        manifest,
        world,
        scene,
        materials,
        options.loadModel ?? (async () => modelData()),
        options.random ?? (() => 0.5),
    );
    return { world, scene, npcs };
}

describe("Npcs", () => {
    it("creates the NPCs of a region when the world loads it", async () => {
        const { world, scene, npcs } = setup();

        world.load(50, 50);
        await flush();

        expect(npcs.count).toBe(1);
        expect(scene.children).toHaveLength(1);
        const npc = npcs.all()[0];
        expect(npc.group.position.toArray()).toEqual([3222.5, 0, -3218.5]);
        expect(npc.group.children).toHaveLength(1); // only the opaque mesh; the transparent one is empty
        expect(npcs.occupiedTileCount).toBe(1);
        expect(npcs.loadedModelCount).toBe(1);
    });

    it("ignores regions without NPCs and loads each region once", async () => {
        const { world, npcs } = setup();

        world.load(10, 10);
        world.load(50, 50);
        world.load(50, 50);
        await flush();

        expect(npcs.count).toBe(1);
    });

    it("removes the NPCs, their tiles and their models when the region unloads", async () => {
        const { world, scene, npcs } = setup();
        world.load(50, 50);
        world.load(51, 50);
        await flush();
        expect(npcs.count).toBe(2);
        expect(npcs.loadedModelCount).toBe(1); // both regions share one model file

        world.unload(50, 50);
        expect(npcs.count).toBe(1);
        expect(scene.children).toHaveLength(1);
        expect(npcs.occupiedTileCount).toBe(1);
        expect(npcs.loadedModelCount).toBe(1); // still used by the other region

        world.unload(51, 50);
        expect(npcs.count).toBe(0);
        expect(scene.children).toHaveLength(0);
        expect(npcs.occupiedTileCount).toBe(0);
        expect(npcs.loadedModelCount).toBe(0);
    });

    it("creates nothing for a region that unloaded before its models arrived", async () => {
        let resolve!: (data: NpcModelData) => void;
        const pending = new Promise<NpcModelData>((r) => (resolve = r));
        const { world, scene, npcs } = setup({ loadModel: () => pending });

        world.load(50, 50);
        world.unload(50, 50);
        resolve(modelData());
        await flush();

        expect(npcs.count).toBe(0);
        expect(scene.children).toHaveLength(0);
        expect(npcs.loadedModelCount).toBe(0);
    });

    it("keeps going when a model fails to load", async () => {
        const warn = console.warn;
        console.warn = () => {};
        try {
            const { world, npcs } = setup({ loadModel: () => Promise.reject(new Error("404")) });

            world.load(50, 50);
            await flush();

            expect(npcs.count).toBe(0);
        } finally {
            console.warn = warn;
        }
    });

    it("creates NPCs for regions that were already loaded when it was created", async () => {
        const world = fakeWorld();
        world.addRegionListener = (listener: RegionListener) => {
            world.listeners.push(listener);
            listener.loaded(50, 50);
        };
        const npcs = new Npcs(manifest, world, new THREE.Scene(), materials, async () => modelData());
        await flush();

        expect(npcs.count).toBe(1);
    });

    it("makes an NPC take its first wander step on a server tick", async () => {
        // random() = 0 always rolls a wander and picks a target 5 tiles south-west of the spawn.
        const { world, npcs } = setup({ random: () => 0 });
        world.load(50, 50);
        await flush();
        const npc = npcs.all()[0];

        npcs.update(0.6);

        expect([npc.tileX, npc.tileY]).toEqual([3221, 3217]);
        expect(npc.orientation).toBe(256); // facing south-west
        expect(npcs.occupiedTileCount).toBe(1); // moved, not duplicated
    });

    it("keeps walking smoothly towards the new tile and arrives", async () => {
        const { world, npcs } = setup({ random: () => 0 });
        world.load(50, 50);
        await flush();
        const npc = npcs.all()[0];

        // 0.6 s: one server tick and 30 client cycles; a tile is 128 units at 4 units per cycle.
        npcs.update(0.6);
        const before = npc.fineX;
        npcs.update(0.2);

        expect(npc.fineX).toBeLessThan(before);
        expect(npc.fineX).toBeGreaterThanOrEqual(3221 * 128 + 64);
    });

    it("does not step into walls", async () => {
        const wall = (x: number, y: number) => (x === 3221 && y === 3217 ? CollisionFlag.OBJECT : 0);
        const { world, npcs } = setup({ random: () => 0, flags: wall });
        world.load(50, 50);
        await flush();
        const npc = npcs.all()[0];

        npcs.update(0.6);

        expect(npc.tileX === 3221 && npc.tileY === 3217).toBe(false);
    });

    it("does not wander when it never rolls a wander", async () => {
        const { world, npcs } = setup({ random: () => 0.99 });
        world.load(50, 50);
        await flush();
        const npc = npcs.all()[0];

        npcs.update(3);

        expect([npc.tileX, npc.tileY]).toEqual([3222, 3218]);
    });
});

const playerAt = (x: number, y: number) => ({
    x,
    y,
    z: 0,
    radius: 0.3,
    height: 1.4,
    plane: 0,
    owner: null,
});

describe("Npcs and the player", () => {
    it("never plans a step onto the tile the player stands on", async () => {
        const { world, npcs } = setup({ random: () => 0 });
        world.load(50, 50);
        await flush();
        const npc = npcs.all()[0];

        // The NPC's first wander step would go to 3221, 3217.
        npcs.update(0.6, playerAt(3221.5, 3217.5));

        expect([npc.tileX, npc.tileY]).toEqual([3222, 3218]);
    });

    it("stalls mid-step while the player is in the way and resumes when they leave", async () => {
        const { world, npcs } = setup({ random: () => 0 });
        world.load(50, 50);
        await flush();
        const npc = npcs.all()[0];
        npcs.update(0.6); // takes the step and is partway there
        const before = npc.fineX;

        npcs.update(0.1, playerAt(3221.5, 3217.5));
        expect(npc.fineX).toBe(before);

        npcs.update(0.1, undefined);
        expect(npc.fineX).toBeLessThan(before);
    });

    it("does not count the player as an NPC tile once they are gone", async () => {
        const { world, npcs } = setup({ random: () => 0.99 });
        world.load(50, 50);
        await flush();

        npcs.update(0.1, playerAt(3230.5, 3230.5));
        expect(npcs.occupiedTileCount).toBe(2);

        npcs.update(0.1, undefined);
        expect(npcs.occupiedTileCount).toBe(1);
    });

    it("reports the bodies of NPCs on a plane inside a box", async () => {
        const { world, npcs } = setup();
        world.load(50, 50);
        await flush();
        const out: unknown[] = [];

        npcs.collectBodies(0, 3222, 3218, 3223, 3219, out as never[]);
        expect(out).toHaveLength(1);

        out.length = 0;
        npcs.collectBodies(1, 3222, 3218, 3223, 3219, out as never[]);
        npcs.collectBodies(0, 3230, 3230, 3231, 3231, out as never[]);
        expect(out).toHaveLength(0);
    });

    it("turns to face a point and holds still while held", async () => {
        const { world, npcs } = setup({ random: () => 0 });
        world.load(50, 50);
        await flush();
        const npc = npcs.all()[0];

        npc.hold(2);
        npc.faceTowards(3222.5, 3230); // due north of the NPC
        npcs.update(0.6);

        expect([npc.tileX, npc.tileY]).toEqual([3222, 3218]);
        expect(npc.orientation).toBe(1024);
    });
});

describe("Occupancy", () => {
    it("tracks the tiles of NPCs of any size per plane", () => {
        const occupancy = new Occupancy();
        occupancy.add(0, 10, 10, 2);

        expect(occupancy.isFree(0, 11, 11, 1)).toBe(false);
        expect(occupancy.isFree(0, 12, 10, 1)).toBe(true);
        expect(occupancy.isFree(1, 10, 10, 1)).toBe(true);
        expect(occupancy.isFree(0, 9, 9, 2)).toBe(false); // overlaps at (10, 10)

        occupancy.remove(0, 10, 10, 2);
        expect(occupancy.size).toBe(0);
    });
});

describe("NPC combat", () => {
    async function oneNpc(flags?: (x: number, y: number) => number) {
        const world = fakeWorld(flags);
        const attackable = { ...manifest, appearances: [{ ...APPEARANCE, actions: ["Talk-to", "Attack"] }] };
        const npcs = new Npcs(attackable, world, new THREE.Scene(), materials, async () => modelData(), () => 0.5);
        world.load(50, 50);
        await flush();
        return { npcs, npc: npcs.all()[0] };
    }

    it("is attackable only with an Attack option and gets health from its combat level", async () => {
        const { npc } = await oneNpc();
        expect(npc.attackable).toBe(true);
        expect(npc.combatant.maxHealth).toBeGreaterThan(0);
    });

    it("is knocked back, never into a wall, and settles on a free tile once it loses the player", async () => {
        // A wall two tiles north of the spawn (3222, 3218).
        const { npcs, npc } = await oneNpc((x, y) => (y === 3220 ? CollisionFlag.OBJECT : 0));
        npc.combatant.hurt(1, "stagger");
        npc.takeHit(0, 1, 8, 3222.5, 3217);
        for (let i = 0; i < 200; i++) {
            npcs.update(0.02);
            expect(npc.body.y).toBeLessThanOrEqual(3220 - npc.body.radius + 1e-3);
        }
        expect(npc.knockback).toBeUndefined();
        // No player to fight: after TimeUntilNPCLoosePlayer it gives up and returns to the grid.
        expect(npc.inCombat).toBe(false);
        expect(npc.tileY).toBe(3219);
        expect(npcs.occupiedTileCount).toBe(1);
    });

    it("dies into a ragdoll that lies on the floor, then is removed after corpseTime", async () => {
        const { npcs, npc } = await oneNpc();
        npc.combatant.hurt(1e6, "knockdown");
        const found: unknown[] = [];
        npcs.collectBodies(0, 3200, 3200, 3260, 3260, found as never[]);
        expect(found).toHaveLength(0);
        for (let i = 0; i < 150; i++) {
            npcs.update(0.02);
        }
        expect(npc.ragdoll).toBeDefined();
        expect(npc.gone).toBe(false);
        expect(npcs.occupiedTileCount).toBe(0);
        // No drawn vertex is below the floor (height 0): RS units are +y down.
        const mesh = npc.group.children[0] as THREE.Mesh;
        const positions = mesh.geometry.getAttribute("a_position").array as Int16Array;
        for (let i = 0; i < positions.length; i += 4) {
            expect(npc.group.position.y - positions[i + 1] / 128).toBeGreaterThanOrEqual(-0.01);
        }
        for (let t = 0; t < tuning.corpseTime; t += 0.5) {
            npcs.update(0.5);
        }
        expect(npc.gone).toBe(true);
        expect(npc.group.visible).toBe(false);
    });

    it("gets up from a knockdown ragdoll and returns to its animation", async () => {
        const { npcs, npc } = await oneNpc();
        npc.combatant.hurt(1, "knockdown");
        npcs.update(0.02);
        expect(npc.ragdoll).toBeDefined();
        for (let t = 0; t < tuning.knockdownDuration + tuning.standUpBack + tuning.standUpFront; t += 0.02) {
            npcs.update(0.02);
        }
        expect(npc.ragdoll).toBeUndefined();
        expect(npc.combatant.reaction).toBe("none");
    });
});

describe("bodies knocking NPCs over (spec 20.7)", () => {
    /** A standing box 0.6 × 1.5 × 0.3 tiles (RS units: +y down), idle and walk holding still. */
    function boxModel(): NpcModelData {
        const corners: number[] = [];
        for (const z of [-19, 19]) {
            for (const y of [0, -192]) {
                for (const x of [-38, 38]) {
                    corners.push(x, y, z);
                }
            }
        }
        const clip = () => ({ frameLengths: Uint16Array.from([2, 2]), frameStep: -1, positions: Int16Array.from([...corners, ...corners]) });
        const faces = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
        return {
            vertexCount: 8,
            bounds: Float32Array.from([0, 0.75, 0, 0.9]),
            opaque: {
                positions: Int16Array.from(Array.from({ length: 8 }, (_, v) => [corners[v * 3], corners[v * 3 + 1], corners[v * 3 + 2], 0]).flat()),
                colors: new Uint8Array(32).fill(255),
                uvs: new Int16Array(16),
                sources: Uint16Array.from({ length: 8 }, (_, v) => v),
                indices: Uint32Array.from(faces),
            },
            transparent: {
                positions: new Int16Array(0),
                colors: new Uint8Array(0),
                uvs: new Int16Array(0),
                sources: new Uint16Array(0),
                indices: new Uint32Array(0),
            },
            idle: clip(),
            walk: clip(),
        };
    }

    /** Two attackable box NPCs side by side, one tile apart along x; returns the west one first. */
    async function twoNpcs() {
        const world = fakeWorld();
        const pair: NpcManifest = {
            ...manifest,
            appearances: [{ ...APPEARANCE, actions: ["Attack"] }],
            spawns: [
                { appearance: 0, x: 3222, y: 3218, plane: 0, orientation: 0 },
                { appearance: 0, x: 3223, y: 3218, plane: 0, orientation: 0 },
            ],
        };
        const npcs = new Npcs(pair, world, new THREE.Scene(), materials, async () => boxModel(), () => 0.5);
        world.load(50, 50);
        await flush();
        const [west, east] = npcs.all().sort((a, b) => a.body.x - b.body.x);
        return { npcs, west, east };
    }

    /**
     * Kills the west NPC and throws its body east at `speed` tiles/s, a little upwards so it flies
     * instead of tripping over its feet; returns once the east one is down (or after 2 s).
     */
    function fling(npcs: Npcs, west: Npc, east: Npc, speed: number): boolean {
        west.combatant.hurt(1e6, "knockdown");
        npcs.update(0.02);
        west.ragdoll!.addVelocity(speed, 2, 0);
        for (let t = 0; t < 2; t += 0.02) {
            npcs.update(0.02);
            if (east.combatant.knockedDown) {
                return true;
            }
        }
        return false;
    }

    it("knocks over the NPC a flying body hits, which falls onto its own ragdoll and gets up again", async () => {
        const { npcs, west, east } = await twoNpcs();
        const health = east.combatant.health;
        expect(fling(npcs, west, east, 5)).toBe(true);
        npcs.update(0.02);
        expect(east.ragdoll).toBeDefined();
        // Under 300 u/s: no damage, and it is not defeated.
        expect(east.combatant.health).toBe(health);
        for (let t = 0; t < tuning.knockdownPhysics + tuning.standUpBack + tuning.standUpFront + 0.5; t += 0.02) {
            npcs.update(0.02);
        }
        expect(east.ragdoll).toBeUndefined();
        expect(east.combatant.dead).toBe(false);
        expect(east.combatant.reaction).toBe("none");
    });

    it("never kills: a fast body leaves even a nearly dead NPC standing up again", async () => {
        const { npcs, west, east } = await twoNpcs();
        east.combatant.health = 1;
        expect(fling(npcs, west, east, 10)).toBe(true);
        expect(east.combatant.health).toBe(1);
        expect(east.combatant.dead).toBe(false);
    });
});

describe("NPC combat movement and kicks", () => {
    async function oneNpc(flags?: (x: number, y: number) => number) {
        const world = fakeWorld(flags);
        const attackable = { ...manifest, appearances: [{ ...APPEARANCE, actions: ["Attack"] }] };
        let seed = 1;
        const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const npcs = new Npcs(attackable, world, new THREE.Scene(), materials, async () => modelData(), random);
        world.load(50, 50);
        await flush();
        return { npcs, npc: npcs.all()[0] };
    }
    const playerAt = (x: number, y: number) => ({ x, y, z: 0, radius: 0.3, height: 1.4, plane: 0, owner: null });

    it("runs in from afar, then holds its distance with short steps instead of walking into the player", async () => {
        const { npcs, npc } = await oneNpc();
        const player = playerAt(3222.5, 3230.5); // 12 tiles north
        npc.takeHit(0, 1, 0, player.x, player.y);
        let maxSpeed = 0;
        for (let i = 0; i < 100; i++) {
            npcs.update(0.02, player, Math.PI / 2); // the player looks west, not at it
            maxSpeed = Math.max(maxSpeed, npc.moveSpeed);
        }
        expect(maxSpeed).toBeGreaterThan(3); // running: 165 u/s, about 3.4 tiles/s
        for (let i = 0; i < 600; i++) {
            npcs.update(0.02, player, Math.PI / 2);
            const d = Math.hypot(npc.body.x - player.x, npc.body.y - player.y);
            expect(d).toBeGreaterThanOrEqual(npc.body.radius + player.radius - 1e-3);
        }
        const d = Math.hypot(npc.body.x - player.x, npc.body.y - player.y);
        expect(d).toBeLessThan(3.2); // inside the Yellow zone, plus hysteresis
        expect(npc.inCombat).toBe(true);
    });

    it("is shoved back about as far as its long hit when kicked, and dodges more often with every kick", async () => {
        const { npcs, npc } = await oneNpc();
        npc.faceTowards(3222.5, 3240); // facing away from the kicker (south): cannot dodge
        npc.rotation = npc.orientation;
        const y0 = npc.body.y;
        expect(npc.kick(0, 1, 3222.5, y0 - 1.5)).toBe("hit");
        for (let i = 0; i < 100; i++) {
            npcs.update(0.02);
        }
        expect(npc.body.y - y0).toBeGreaterThan(1.1); // long hit from behind: 64 u, about 1.3 tiles
        expect(npc.body.y - y0).toBeLessThan(2.4);

        // Facing the kicker, repeated kicks are dodged sooner or later (chance 0.2, 0.5, 0.8, 1).
        let dodged = false;
        for (let i = 0; i < 4 && !dodged; i++) {
            npc.faceTowards(npc.body.x, npc.body.y - 2);
            npc.rotation = npc.orientation;
            npc.combatant.reset();
            dodged = npc.kick(0, 1, npc.body.x, npc.body.y - 1.5) === "dodged";
        }
        expect(dodged).toBe(true);
    });

    it("is knocked down when a kick slams it into a wall", async () => {
        // A blocked row one tile north of the spawn tile (3222, 3218).
        const { npcs, npc } = await oneNpc((_x, y) => (y === 3219 ? CollisionFlag.OBJECT : 0));
        npc.faceTowards(3222.5, 3240); // facing away: cannot dodge
        npc.rotation = npc.orientation;
        npc.kick(0, 1, 3222.5, npc.body.y - 1.5);
        let down = false;
        for (let i = 0; i < 50; i++) {
            npcs.update(0.02);
            down ||= npc.combatant.knockedDown;
        }
        expect(down).toBe(true);
    });
});
