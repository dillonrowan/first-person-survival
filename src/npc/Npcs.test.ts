import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { NpcManifest, NpcModelData } from "../world/NpcFormat";
import { CollisionFlag, RegionListener } from "../world/WorldFormat";
import { Occupancy } from "./Npc";
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
