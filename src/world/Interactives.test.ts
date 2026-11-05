import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { Body } from "../physics/Bodies";
import { canStep } from "../npc/NpcMovement";
import { Player, PlayerInput } from "../player/Player";
import { PersistentEdits, applyFlagEdit } from "./CollisionEdits";
import { InteractivesWorld, WorldInteractives, isDoorOpen } from "./Interactives";
import { CollisionFlag, InteractiveLoc, REGION_SIZE, RegionListener } from "./WorldFormat";

// A closed door on the west edge of tile (10, 20). Opening swings it onto the north edge.
const DOOR: InteractiveLoc = {
    kind: "door",
    id: 1535,
    name: "Door",
    actions: ["Open"],
    plane: 0,
    level: 0,
    tileX: 10,
    tileY: 20,
    sizeX: 1,
    sizeY: 1,
    rotation: 0,
    height: 2,
    door: {
        placedOpen: false,
        hinge: [10, 21],
        swing: 1,
        rotationB: 1,
        flagsA: [
            [10, 20, CollisionFlag.WALL_WEST],
            [9, 20, CollisionFlag.WALL_EAST],
        ],
        flagsB: [
            [10, 20, CollisionFlag.WALL_NORTH],
            [10, 21, CollisionFlag.WALL_SOUTH],
        ],
        mesh: 0,
    },
};

const LADDER: InteractiveLoc = {
    kind: "climb",
    id: 16684,
    name: "Ladder",
    actions: ["Climb-up", "Climb-down"],
    plane: 0,
    level: 0,
    tileX: 20,
    tileY: 20,
    sizeX: 1,
    sizeY: 1,
    rotation: 0,
    height: 2,
};

/** A world whose square (0, 0) behaves like the real one: flags reset from the file on reload. */
function fakeWorld(locs: InteractiveLoc[]) {
    const base = new Map<string, number>();
    const current = new Map<string, number>();
    const listeners: RegionListener[] = [];
    const persistent = new PersistentEdits();
    let loaded = false;
    const key = (plane: number, x: number, y: number) => `${plane},${x},${y}`;
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < REGION_SIZE && y < REGION_SIZE;

    for (const [x, y, mask] of DOOR.door!.flagsA) {
        base.set(key(0, x, y), mask);
    }

    const world: InteractivesWorld & {
        flags(plane: number, x: number, y: number): number;
        load(): void;
        unload(): void;
    } = {
        flags: (plane, x, y) => current.get(key(plane, x, y)) ?? 0,
        addRegionListener: (listener) => {
            listeners.push(listener);
        },
        regionInteractives: () => (loaded ? { locs, doorGeometries: locs.map(() => ({})) } : undefined),
        groundHeight: () => 0,
        applyFlagEdits: (edits) => {
            for (const edit of edits) {
                if (loaded && inside(edit.tileX, edit.tileY)) {
                    const k = key(edit.plane, edit.tileX, edit.tileY);
                    current.set(k, applyFlagEdit(current.get(k) ?? 0, edit));
                }
            }
        },
        setPersistentEdits: (id, edits) => persistent.set(id, edits),
        load: () => {
            loaded = true;
            base.forEach((value, k) => current.set(k, value));
            world.applyFlagEdits(persistent.forRegion(0, 0));
            listeners.forEach((l) => l.loaded(0, 0));
        },
        unload: () => {
            loaded = false;
            current.clear();
            listeners.forEach((l) => l.unloaded(0, 0));
        },
    };
    return world;
}

const materials = { opaque: new THREE.MeshBasicMaterial(), transparent: new THREE.MeshBasicMaterial() };

function setup(blockers: ConstructorParameters<typeof WorldInteractives>[3] = {}) {
    const world = fakeWorld([DOOR, LADDER]);
    const scene = new THREE.Scene();
    const interactives = new WorldInteractives(world, scene, materials, blockers);
    world.load();
    return { world, scene, interactives, door: interactives.allDoors()[0] };
}

const body = (x: number, y: number, radius = 0.3): Body => ({ x, y, z: 0, radius, height: 1.4, plane: 0, owner: null });

describe("WorldInteractives", () => {
    it("creates a door object per door and a pivot in the scene, and removes them on unload", () => {
        const { world, scene, interactives } = setup();

        expect(interactives.doorCount).toBe(1);
        expect(scene.children).toHaveLength(1);
        expect(scene.children[0].position.toArray()).toEqual([10, 0, -21]); // on the hinge

        world.unload();
        expect(interactives.doorCount).toBe(0);
        expect(scene.children).toHaveLength(0);
    });

    it("moves a door's collision with it: blocked when closed, passable and re-blocked when open", () => {
        const { world, interactives, door } = setup();
        const flags = (x: number, y: number) => world.flags(0, x, y);

        expect(canStep(flags, 9, 20, 1, 0, 1)).toBe(false); // closed: cannot walk in from the west
        expect(isDoorOpen(door)).toBe(false);

        expect(interactives.toggle(door)).toBe(true);

        expect(isDoorOpen(door)).toBe(true);
        expect(canStep(flags, 9, 20, 1, 0, 1)).toBe(true); // the doorway is free...
        expect(canStep(flags, 10, 20, 0, 1, 1)).toBe(false); // ...and the leaf now lies on the north edge

        interactives.toggle(door);
        expect(canStep(flags, 9, 20, 1, 0, 1)).toBe(false);
        expect(canStep(flags, 10, 20, 0, 1, 1)).toBe(true);
    });

    it("lets the player walk through an opened door only", () => {
        const { world, interactives, door } = setup();
        const walkEast = (): number => {
            const player = new Player(
                {
                    isLoaded: () => true,
                    hasFloor: () => true,
                    groundHeight: () => 0,
                    collisionFlags: (plane, x, y) => world.flags(plane, x, y),
                },
                { x: 7, y: 20, plane: 0 },
            );
            player.yaw = -Math.PI / 2; // east
            const input: PlayerInput = {
                consumeLook: () => [0, 0],
                wasPressed: () => false,
                isDown: () => false,
                axis: (positive) => (positive === "KeyW" ? 1 : 0),
            };
            for (let t = 0; t < 3; t += 0.05) {
                player.update(0.05, input);
            }
            return player.x;
        };

        expect(walkEast()).toBeLessThan(10); // stopped by the closed door
        interactives.toggle(door);
        expect(walkEast()).toBeGreaterThan(11);
    });

    it("swings over about 0.3 seconds", () => {
        const { interactives, door } = setup();

        interactives.toggle(door);
        interactives.update(0.1);
        expect(door.angle).toBeGreaterThan(0);
        expect(door.angle).toBeLessThan(Math.PI / 2);
        interactives.update(1);
        expect(door.angle).toBeCloseTo(Math.PI / 2, 9);
        expect(door.pivot.rotation.y).toBeCloseTo(Math.PI / 2, 9);

        interactives.toggle(door);
        interactives.update(1);
        expect(door.angle).toBe(0);
    });

    it("keeps its state, rotation and collision when the square unloads and loads again", () => {
        const { world, scene, interactives, door } = setup();
        interactives.toggle(door);

        world.unload();
        world.load();

        const again = interactives.allDoors()[0];
        expect(again).not.toBe(door);
        expect(again.toggled).toBe(true);
        expect(again.pivot.rotation.y).toBeCloseTo(Math.PI / 2, 9);
        expect(scene.children).toHaveLength(1);
        expect(world.flags(0, 10, 20)).toBe(CollisionFlag.WALL_NORTH); // not the file's closed flags
        expect(world.flags(0, 9, 20)).toBe(0);
    });

    it("refuses to open onto an NPC standing where the leaf would swing", () => {
        const npc = body(10.5, 21); // on the north edge, where the open leaf would lie
        const bodies = {
            collectBodies: (plane: number, _a: number, _b: number, _c: number, _d: number, out: Body[]) => {
                out.push(npc);
            },
        };
        const { world, interactives, door } = setup({ bodies });

        expect(interactives.toggle(door)).toBe(false);
        expect(door.toggled).toBe(false);
        expect(world.flags(0, 10, 20)).toBe(CollisionFlag.WALL_WEST); // collision untouched
    });

    it("refuses to close a door onto the player", () => {
        const world = fakeWorld([DOOR]);
        let player: Body | undefined;
        const interactives = new WorldInteractives(world, new THREE.Scene(), materials, { player: () => player });
        world.load();
        const door = interactives.allDoors()[0];
        expect(interactives.toggle(door)).toBe(true); // open

        player = body(10, 20.5); // standing in the doorway
        expect(interactives.toggle(door)).toBe(false);
        expect(isDoorOpen(door)).toBe(true);

        player = body(12, 25);
        expect(interactives.toggle(door)).toBe(true);
        expect(isDoorOpen(door)).toBe(false);
    });

    it("targets the door where its leaf is now, and the ladder by its footprint", () => {
        const { interactives, door } = setup();
        const source = interactives.targetSource();
        const ray = (ox: number, oy: number, dx: number, dy: number) => ({
            ox,
            oy,
            oz: 1.25,
            dx,
            dy,
            dz: 0,
            plane: 0,
            range: 2.5,
        });

        const closed = source(ray(8.5, 20.5, 1, 0))!;
        expect(closed.kind).toBe("door");
        expect(closed.actions).toEqual(["Open"]);
        expect(closed.distance).toBeCloseTo(10 - 0.12 - 8.5, 6);
        expect(source(ray(10.5, 19, 0, 1))).toBeUndefined(); // the north edge is open space for now

        interactives.toggle(door);
        const open = source(ray(10.5, 19.5, 0, 1))!;
        expect(open.actions).toEqual(["Close"]);
        expect(source(ray(8.5, 20.5, 1, 0))).toBeUndefined(); // nothing on the west edge any more

        const ladder = source(ray(18.5, 20.5, 1, 0))!;
        expect(ladder).toMatchObject({ kind: "climb", label: "Ladder", actions: ["Climb-up", "Climb-down"] });
        expect(source({ ...ray(18.5, 20.5, 1, 0), plane: 1 })).toBeUndefined();
    });
});

describe("gates", () => {
    // A second leaf north of DOOR; the pair opens together.
    const NORTH_LEAF: InteractiveLoc = {
        ...DOOR,
        id: 1537,
        tileY: 21,
        door: {
            ...DOOR.door!,
            hinge: [10, 22],
            flagsA: [
                [10, 21, CollisionFlag.WALL_WEST],
                [9, 21, CollisionFlag.WALL_EAST],
            ],
            flagsB: [
                [10, 21, CollisionFlag.WALL_NORTH],
                [10, 22, CollisionFlag.WALL_SOUTH],
            ],
            partner: 0,
            mesh: 1,
        },
    };
    const SOUTH_LEAF: InteractiveLoc = {
        ...DOOR,
        door: {
            ...DOOR.door!,
            hinge: [10, 20],
            swing: -1,
            rotationB: 3,
            flagsB: [
                [10, 20, CollisionFlag.WALL_SOUTH],
                [10, 19, CollisionFlag.WALL_NORTH],
            ],
            partner: 1,
        },
    };

    it("opens and closes both leaves from either one, each around its own hinge", () => {
        const world = fakeWorld([SOUTH_LEAF, NORTH_LEAF]);
        const interactives = new WorldInteractives(world, new THREE.Scene(), materials);
        world.load();
        const [south, north] = interactives.allDoors();

        expect(south.partner).toBe(north);
        expect(interactives.toggle(north)).toBe(true);
        expect(isDoorOpen(south) && isDoorOpen(north)).toBe(true);
        expect(world.flags(0, 10, 20)).toBe(CollisionFlag.WALL_SOUTH);
        expect(world.flags(0, 10, 21)).toBe(CollisionFlag.WALL_NORTH);

        interactives.update(1);
        expect(south.pivot.rotation.y).toBeCloseTo(-Math.PI / 2, 9);
        expect(north.pivot.rotation.y).toBeCloseTo(Math.PI / 2, 9);

        expect(interactives.toggle(south)).toBe(true);
        expect(isDoorOpen(south) || isDoorOpen(north)).toBe(false);
    });

    it("refuses when something blocks either leaf's path", () => {
        const npc = body(10.5, 22); // where the north leaf would swing to
        const bodies = { collectBodies: (_p: number, _a: number, _b: number, _c: number, _d: number, out: Body[]) => void out.push(npc) };
        const world = fakeWorld([SOUTH_LEAF, NORTH_LEAF]);
        const interactives = new WorldInteractives(world, new THREE.Scene(), materials, { bodies });
        world.load();
        const [south, north] = interactives.allDoors();

        expect(interactives.toggle(south)).toBe(false);
        expect(isDoorOpen(south) || isDoorOpen(north)).toBe(false);
    });
});

describe("PersistentEdits", () => {
    it("applies set and clear masks and returns edits per map square", () => {
        expect(applyFlagEdit(0b1010, { plane: 0, tileX: 0, tileY: 0, set: 0b0001, clear: 0b1000 })).toBe(0b0011);

        const edits = new PersistentEdits();
        edits.set("a", [
            { plane: 0, tileX: 63, tileY: 5, set: 1, clear: 0 },
            { plane: 0, tileX: 64, tileY: 5, set: 2, clear: 0 }, // neighbouring square
        ]);

        expect(edits.forRegion(0, 0).map((e) => e.tileX)).toEqual([63]);
        expect(edits.forRegion(1, 0).map((e) => e.tileX)).toEqual([64]);
        edits.set("a", undefined);
        expect(edits.size).toBe(0);
    });
});
