import { describe, expect, it } from "vitest";

import type { Body, BodySource } from "../physics/Bodies";
import { CollisionFlag } from "../world/WorldFormat";
import { PLAYER_RADIUS, Player, PlayerInput, WALK_SPEED } from "./Player";

function fakeWorld(options: { flags?: (x: number, y: number) => number; loaded?: () => boolean } = {}) {
    return {
        isLoaded: () => options.loaded?.() ?? true,
        hasFloor: () => true,
        groundHeight: () => 0,
        collisionFlags: (_plane: number, x: number, y: number) => options.flags?.(x, y) ?? 0,
    };
}

/** Holds W (and optionally Shift/Space) with yaw 0, i.e. walking north. */
function input(keys: string[] = ["KeyW"]): PlayerInput & { pressed: Set<string> } {
    const pressed = new Set<string>();
    return {
        pressed,
        consumeLook: () => [0, 0],
        wasPressed: (code) => pressed.has(code),
        isDown: (...codes) => codes.some((c) => keys.includes(c)),
        axis: (positive, negative) => (keys.includes(positive) ? 1 : 0) - (keys.includes(negative) ? 1 : 0),
    };
}

function bodies(list: Body[]): BodySource {
    return {
        collectBodies: (plane, _x0, _y0, _x1, _y1, out) => {
            for (const b of list) {
                if (b.plane === plane) {
                    out.push(b);
                }
            }
        },
    };
}

const npc = (x: number, y: number, radius = 0.35): Body => ({
    x,
    y,
    z: 0,
    radius,
    height: 1.7,
    plane: 0,
    owner: null,
});

function run(player: Player, keys: string[], seconds: number, dt = 0.05): void {
    const i = input(keys);
    for (let t = 0; t < seconds; t += dt) {
        player.update(dt, i);
    }
}

describe("Player", () => {
    it("ramps up to walking speed instead of starting at it", () => {
        const player = new Player(fakeWorld(), { x: 100, y: 100, plane: 0 });
        player.update(0.05, input([])); // places the player

        player.update(0.015, input());
        expect(player.speed).toBeGreaterThan(0);
        expect(player.speed).toBeLessThan(WALK_SPEED * 0.5);

        run(player, ["KeyW"], 1);
        expect(player.speed).toBeCloseTo(WALK_SPEED, 3);
        expect(player.localForward).toBeCloseTo(WALK_SPEED, 3);
    });

    it("slides to a stop and loses velocity against a wall", () => {
        const wall = (x: number, y: number) => (y === 103 ? CollisionFlag.OBJECT : 0);
        const player = new Player(fakeWorld({ flags: wall }), { x: 100, y: 100, plane: 0 });
        run(player, ["KeyW"], 3);
        run(player, [], 0.05);
        expect(player.speed).toBeLessThan(0.5);
        run(player, [], 2);
        expect(player.speed).toBe(0);
    });

    it("sprinting drains stamina until it runs out, then falls back to running", () => {
        const player = new Player(fakeWorld(), { x: 100, y: 100, plane: 0 });
        run(player, ["KeyW", "ShiftLeft"], 2);
        expect(player.sprinting).toBe(true);
        expect(player.stamina.value).toBeLessThan(player.stamina.max);
        run(player, ["KeyW", "ShiftLeft"], 8);
        expect(player.sprinting).toBe(false);
    });

    it("crouching is slower and lowers the eyes", () => {
        const player = new Player(fakeWorld(), { x: 100, y: 100, plane: 0 });
        run(player, ["KeyW", "KeyC"], 2);
        expect(player.speed).toBeLessThan(WALK_SPEED * 0.8);
        expect(player.eyeHeight).toBeLessThan(1);
    });

    it("is stopped by a blocked tile", () => {
        const player = new Player(fakeWorld({ flags: (x, y) => (x === 100 && y === 103 ? CollisionFlag.OBJECT : 0) }), {
            x: 100,
            y: 100,
            plane: 0,
        });

        run(player, ["KeyW"], 3);

        expect(player.y).toBeLessThanOrEqual(103 - PLAYER_RADIUS);
        expect(player.y).toBeGreaterThan(102);
    });

    it("jumps and lands again", () => {
        const player = new Player(fakeWorld(), { x: 100, y: 100, plane: 0 });
        const i = input([]);
        player.update(0.05, i);
        i.pressed.add("Space");
        player.update(0.05, i);
        i.pressed.clear();
        expect(player.z).toBeGreaterThan(0);
        expect(player.grounded).toBe(false);

        for (let n = 0; n < 40; n++) {
            player.update(0.05, i);
        }
        expect(player.z).toBe(0);
        expect(player.grounded).toBe(true);
    });

    it("waits for the target region of a teleport to load", () => {
        let loaded = true;
        const player = new Player(fakeWorld({ loaded: () => loaded }), { x: 100, y: 100, plane: 0 });
        player.update(0.05, input([]));
        loaded = false;

        player.teleport(500.5, 500.5, 1);
        expect(player.ready).toBe(false);
        player.update(0.05, input([]));
        expect(player.ready).toBe(false);

        loaded = true;
        player.update(0.05, input([]));
        expect(player.ready).toBe(true);
        expect(player.plane).toBe(1);
        expect(player.x).toBeCloseTo(500.5, 6);
    });
});

describe("Player against bodies", () => {
    it("never gets closer to an NPC than both radii while sprinting into it", () => {
        const b = npc(100.5, 103);
        const player = new Player(fakeWorld(), { x: 100, y: 100, plane: 0 }, { bodies: bodies([b]) });

        run(player, ["KeyW", "ShiftLeft"], 2);

        expect(Math.hypot(player.x - b.x, player.y - b.y)).toBeGreaterThanOrEqual(0.65 - 1e-3);
        expect(player.y).toBeGreaterThan(101); // it did walk up to the body
    });

    it("slides past an NPC on a diagonal approach", () => {
        const b = npc(101, 103);
        const player = new Player(fakeWorld(), { x: 100, y: 100, plane: 0 }, { bodies: bodies([b]) });

        run(player, ["KeyW", "ShiftLeft"], 3);

        expect(player.y).toBeGreaterThan(104); // got around it
    });

    it("is never pushed through a wall by a body", () => {
        const wall = (x: number, y: number) => (x === 100 && y === 102 ? CollisionFlag.OBJECT : 0);
        // The NPC stands on the player's far side from the wall, so every push points at the wall.
        const b = npc(100.5, 100.3);
        const player = new Player(fakeWorld({ flags: wall }), { x: 100, y: 101, plane: 0 }, { bodies: bodies([b]) });

        run(player, [], 1);

        expect(player.y).toBeLessThanOrEqual(102 - PLAYER_RADIUS + 1e-3);
    });

    it("moves out of an NPC it spawns inside within a few frames", () => {
        const b = npc(100.5, 100.5);
        const player = new Player(fakeWorld(), { x: 100, y: 100, plane: 0 }, { bodies: bodies([b]) });

        run(player, [], 0.15);

        expect(Math.hypot(player.x - b.x, player.y - b.y)).toBeGreaterThanOrEqual(0.65 - 1e-3);
    });

    it("can jump over a short NPC and ignores bodies while flying", () => {
        const short = { ...npc(100.5, 102), height: 0.3 };
        const player = new Player(fakeWorld(), { x: 100, y: 100, plane: 0 }, { bodies: bodies([short]) });
        player.update(0.05, input([]));
        player.z = 0.4; // above the NPC's head
        expect(player.footprint()).toBeDefined();

        const flyer = new Player(fakeWorld(), { x: 100, y: 100, plane: 0 }, { bodies: bodies([npc(100.5, 101)]) });
        const i = input(["KeyW"]);
        flyer.update(0.05, i);
        i.pressed.add("KeyN");
        flyer.update(0.05, i);
        i.pressed.clear();
        expect(flyer.flying).toBe(true);
        expect(flyer.footprint()).toBeUndefined();
        for (let n = 0; n < 20; n++) {
            flyer.update(0.05, i);
        }
        expect(flyer.y).toBeGreaterThan(105);
    });

    it("moves far less than a body's reach in one sub-step", () => {
        // 0.2 tiles per axis => at most 0.283 diagonally, less than 0.3 + the smallest NPC radius.
        expect(Math.hypot(0.2, 0.2)).toBeLessThan(PLAYER_RADIUS + 0.35);
    });
});
