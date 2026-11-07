import { describe, expect, it } from "vitest";

import { CollisionFlag as F } from "../world/WorldFormat";
import {
    FlagLookup,
    MAX_PATH_STEPS,
    WANDER_RADIUS,
    canStep,
    constrainMovementToEnvironment,
    findWanderPath,
    rotateTowards,
    stepOrientation,
} from "./NpcMovement";

/** Flags for a few tiles; everything else is open. */
function grid(tiles: Record<string, number> = {}): FlagLookup {
    return (x, y) => tiles[`${x},${y}`] ?? 0;
}

describe("canStep", () => {
    it("allows steps on open ground in all eight directions", () => {
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            expect(canStep(grid(), 5, 5, dx, dy, 1)).toBe(true);
        }
    });

    it("is stopped by a wall on the edge it would cross", () => {
        // A wall on the east side of (4, 5) blocks entering it from the east, i.e. stepping west.
        expect(canStep(grid({ "4,5": F.WALL_EAST }), 5, 5, -1, 0, 1)).toBe(false);
        expect(canStep(grid({ "6,5": F.WALL_WEST }), 5, 5, 1, 0, 1)).toBe(false);
        expect(canStep(grid({ "5,4": F.WALL_NORTH }), 5, 5, 0, -1, 1)).toBe(false);
        expect(canStep(grid({ "5,6": F.WALL_SOUTH }), 5, 5, 0, 1, 1)).toBe(false);
        // A wall along another edge does not matter.
        expect(canStep(grid({ "4,5": F.WALL_NORTH }), 5, 5, -1, 0, 1)).toBe(true);
    });

    it("is stopped by objects, floor and floor decoration", () => {
        for (const flag of [F.OBJECT, F.FLOOR, F.FLOOR_DECORATION]) {
            expect(canStep(grid({ "6,5": flag }), 5, 5, 1, 0, 1)).toBe(false);
        }
    });

    it("blocks a diagonal step when a neighbouring straight step is blocked", () => {
        // North-east from (5, 5): (6, 5) and (5, 6) must both be enterable.
        expect(canStep(grid({ "6,5": F.OBJECT }), 5, 5, 1, 1, 1)).toBe(false);
        expect(canStep(grid({ "5,6": F.OBJECT }), 5, 5, 1, 1, 1)).toBe(false);
        expect(canStep(grid({ "6,6": F.OBJECT }), 5, 5, 1, 1, 1)).toBe(false);
        // A wall that only touches the destination's far corner still blocks the diagonal.
        expect(canStep(grid({ "6,6": F.WALL_SOUTH }), 5, 5, 1, 1, 1)).toBe(false);
    });

    it("requires the whole footprint of a large NPC to be free", () => {
        const flags = grid({ "6,6": F.OBJECT });

        expect(canStep(flags, 5, 5, 1, 0, 1)).toBe(true);
        expect(canStep(flags, 5, 5, 1, 0, 2)).toBe(false); // the 2x2 NPC's upper tile hits (6, 6)
    });

    it("blocks tiles of regions that are not loaded (all flags set)", () => {
        expect(canStep(() => 0xffffff, 5, 5, 1, 0, 1)).toBe(false);
    });
});

describe("constrainMovementToEnvironment", () => {
    it("keeps continuous movement on the NPC's environment tiles", () => {
        const land = (x: number, y: number) => x < 101 && y < 101;

        expect(constrainMovementToEnvironment(100.5, 100.5, 101.5, 100.5, land)).toEqual({
            x: 100.5,
            y: 100.5,
        });
        expect(constrainMovementToEnvironment(100.5, 100.5, 100.5, 101.5, land)).toEqual({
            x: 100.5,
            y: 100.5,
        });
    });
});

describe("findWanderPath", () => {
    const spawn = { x: 100, y: 100 };

    it("finds a direct diagonal path", () => {
        const path = findWanderPath(grid(), spawn, { x: 103, y: 103 }, 1, spawn);

        expect(path).toEqual([
            { x: 101, y: 101 },
            { x: 102, y: 102 },
            { x: 103, y: 103 },
        ]);
    });

    it("works with real world coordinates (Lumbridge, x 3222, y 3218)", () => {
        const lumbridge = { x: 3222, y: 3218 };

        const path = findWanderPath(grid(), lumbridge, { x: 3219, y: 3215 }, 1, lumbridge);

        expect(path).toEqual([
            { x: 3221, y: 3217 },
            { x: 3220, y: 3216 },
            { x: 3219, y: 3215 },
        ]);
    });

    it("walks around a wall", () => {
        // A solid column at x = 101 for y 99..101 forces a detour to reach (102, 100).
        const flags = grid({ "101,99": F.OBJECT, "101,100": F.OBJECT, "101,101": F.OBJECT });

        const path = findWanderPath(flags, spawn, { x: 102, y: 100 }, 1, spawn);

        expect(path.length).toBeGreaterThan(2);
        expect(path.at(-1)).toEqual({ x: 102, y: 100 });
        expect(path.every((t) => (flags(t.x, t.y) & F.OBJECT) === 0)).toBe(true);
    });

    it("keeps paths within the spawn environment", () => {
        const water = new Set(["100,100", "101,100", "101,101"]);
        const isWater = (tile: { x: number; y: number }) => water.has(`${tile.x},${tile.y}`);

        const waterPath = findWanderPath(grid(), spawn, { x: 101, y: 101 }, 1, spawn, isWater);
        const landPath = findWanderPath(grid(), { x: 102, y: 100 }, { x: 104, y: 100 }, 1, spawn, (tile) => !isWater(tile));

        expect(waterPath).toEqual([{ x: 101, y: 101 }]);
        expect(waterPath.every(isWater)).toBe(true);
        expect(landPath.every((tile) => !isWater(tile))).toBe(true);
    });

    it("returns nothing when the target is unreachable, the same tile, or too far from the spawn", () => {
        const sealed = grid(
            Object.fromEntries(
                [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => [`${103 + dx},${103 + dy}`, F.OBJECT])),
            ),
        );

        expect(findWanderPath(sealed, spawn, { x: 103, y: 103 }, 1, spawn)).toEqual([]);
        expect(findWanderPath(grid(), spawn, spawn, 1, spawn)).toEqual([]);
        expect(
            findWanderPath(grid(), spawn, { x: 100 + WANDER_RADIUS + 1, y: 100 }, 1, spawn),
        ).toEqual([]);
    });

    it("never leaves the wander radius while detouring", () => {
        const flags = grid({ "103,100": F.OBJECT });
        const path = findWanderPath(flags, { x: 102, y: 100 }, { x: 104, y: 100 }, 1, spawn);

        expect(path.length).toBeGreaterThan(0);
        for (const tile of path) {
            expect(Math.abs(tile.x - spawn.x)).toBeLessThanOrEqual(WANDER_RADIUS);
            expect(Math.abs(tile.y - spawn.y)).toBeLessThanOrEqual(WANDER_RADIUS);
        }
    });

    it("limits a path to the first MAX_PATH_STEPS tiles", () => {
        // A serpentine corridor makes the path long: walls on alternating rows with one gap.
        const tiles: Record<string, number> = {};
        for (let y = 96; y <= 104; y += 2) {
            for (let x = 95; x <= 105; x++) {
                tiles[`${x},${y}`] = F.OBJECT;
            }
            const gap = (y / 2) % 2 === 0 ? 95 : 105;
            delete tiles[`${gap},${y}`];
        }

        const path = findWanderPath(grid(tiles), { x: 95, y: 95 }, { x: 105, y: 105 }, 1, spawn);

        expect(path.length).toBeLessThanOrEqual(MAX_PATH_STEPS);
    });
});

describe("stepOrientation", () => {
    it("maps steps to client orientations", () => {
        expect(stepOrientation(0, -1)).toBe(0); // south
        expect(stepOrientation(-1, -1)).toBe(256);
        expect(stepOrientation(-1, 0)).toBe(512); // west
        expect(stepOrientation(-1, 1)).toBe(768);
        expect(stepOrientation(0, 1)).toBe(1024); // north
        expect(stepOrientation(1, 1)).toBe(1280);
        expect(stepOrientation(1, 0)).toBe(1536); // east
        expect(stepOrientation(1, -1)).toBe(1792);
    });
});

describe("rotateTowards", () => {
    it("turns the short way round by the rotation speed", () => {
        expect(rotateTowards(0, 512, 32)).toBe(32);
        expect(rotateTowards(0, 1536, 32)).toBe(2016); // 1536 is closer going backwards
        expect(rotateTowards(100, 100, 32)).toBe(100);
    });

    it("wraps around 2048", () => {
        expect(rotateTowards(2040, 100, 32)).toBe(24);
    });

    it("snaps to the target when it is within one step", () => {
        expect(rotateTowards(500, 512, 32)).toBe(512);
        expect(rotateTowards(10, 2040, 32)).toBe(2040);
    });

    it("never turns with speed 0", () => {
        expect(rotateTowards(0, 512, 0)).toBe(0);
    });
});
