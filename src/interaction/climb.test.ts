import { describe, expect, it } from "vitest";

import { CollisionFlag } from "../world/WorldFormat";
import { ClimbWorld, climbActions, climbDirection, findArrivalTile, planClimb } from "./climb";

type Spec = { floors?: string[]; blocked?: string[]; regions?: string[] };

/** A world with floors/blocked tiles given as "plane,x,y" and regions as "x,y" of covered tiles. */
function world({ floors = [], blocked = [], regions = [] }: Spec): ClimbWorld {
    return {
        hasFloor: (plane, x, y) => plane === 0 || floors.includes(`${plane},${x},${y}`),
        collisionFlags: (plane, x, y) => (blocked.includes(`${plane},${x},${y}`) ? CollisionFlag.OBJECT : 0),
        hasRegion: (x, y) => regions.includes(`${x},${y}`),
    };
}

const ladder = { plane: 0, tileX: 10, tileY: 20, sizeX: 1, sizeY: 1 };
const from = { x: 10.5, y: 19.5 };

describe("findArrivalTile", () => {
    it("skips tiles without a floor and blocked tiles, and takes the one nearest the player", () => {
        const w = world({ floors: ["1,10,21", "1,12,20", "1,11,19"], blocked: ["1,11,19"] });

        expect(findArrivalTile(w, 1, 10.5, 20.5, from)).toEqual({ x: 10.5, y: 21.5 });
    });

    it("widens the search to 16 tiles when nothing is close, and gives up beyond", () => {
        expect(findArrivalTile(world({ floors: ["1,24,20"] }), 1, 10.5, 20.5, from)).toEqual({ x: 24.5, y: 20.5 });
        expect(findArrivalTile(world({ floors: ["1,40,20"] }), 1, 10.5, 20.5, from)).toBeUndefined();
    });
});

describe("planClimb", () => {
    it("goes up and down a plane to a walkable tile", () => {
        const w = world({ floors: ["1,10,21"] });

        expect(planClimb(w, ladder, "up", from)).toEqual({ plane: 1, x: 10.5, y: 21.5 });
        expect(planClimb(w, { ...ladder, plane: 1 }, "down", from)).toEqual({ plane: 0, x: 10.5, y: 19.5 });
    });

    it("says so when it leads nowhere", () => {
        expect(planClimb(world({}), ladder, "up", from)).toEqual({ message: "It leads nowhere you can go yet." });
        expect(planClimb(world({}), ladder, "down", from)).toMatchObject({ message: expect.any(String) });
    });

    it("links the surface and the dungeon only when the other square is exported", () => {
        const surface = { ...ladder, tileX: 10, tileY: 20 };
        const dungeon = { ...ladder, tileX: 10, tileY: 6420 };

        expect(planClimb(world({ regions: ["10,6420"] }), surface, "down", from)).toEqual({ plane: 0, x: 10.5, y: 6420.5 });
        expect(planClimb(world({}), surface, "down", from)).toMatchObject({ message: expect.any(String) });
        expect(planClimb(world({ regions: ["10,20"] }), dungeon, "up", from)).toEqual({ plane: 0, x: 10.5, y: 20.5 });
    });
});

describe("Top-floor and Bottom-floor (Lumbridge castle staircases)", () => {
    const floors = ["1,10,21", "2,10,21", "3,10,21"];
    const w = world({ floors });
    const stair = (plane: number) => ({ ...ladder, plane });

    it("reads the action names", () => {
        expect(climbDirection("Bottom-floor", w, stair(2), from)).toBe("bottom");
        expect(climbDirection("Top-floor", w, stair(0), from)).toBe("top");
    });

    it("Bottom-floor goes to plane 0, never up", () => {
        expect(planClimb(w, stair(2), "bottom", from)).toEqual({ plane: 0, x: 10.5, y: 19.5 });
        expect(planClimb(w, stair(1), "bottom", from)).toMatchObject({ plane: 0 });
    });

    it("Top-floor goes to the highest plane that has a floor", () => {
        expect(planClimb(world({ floors: ["1,10,21", "2,10,21"] }), stair(0), "top", from)).toMatchObject({ plane: 2 });
    });
});

describe("Top-floor ignores far-away floors of a higher plane", () => {
    it("lands on the plane that has a floor at the staircase, not a roof 8 tiles away", () => {
        const w = world({ floors: ["2,10,21", "3,18,21"] });

        expect(planClimb(w, { ...ladder, plane: 0 }, "top", from)).toMatchObject({ plane: 2, x: 10.5, y: 21.5 });
    });
});

describe("climbActions", () => {
    it("drops a plain Climb when Climb-up or Climb-down exist, so both stay reachable", () => {
        expect(climbActions(["Climb", "Climb-up", "Climb-down"]).slice(0, 2)).toEqual(["Climb-up", "Climb-down"]);
        expect(climbActions(["Climb"])).toEqual(["Climb"]);
        expect(climbActions(["Climb-up", "Top-floor"])).toEqual(["Climb-up", "Top-floor"]);
    });
});

describe("climbDirection", () => {
    it("follows the action's name, and a plain Climb goes up when there is an up", () => {
        const withUp = world({ floors: ["1,10,21"] });

        expect(climbDirection("Climb-down", withUp, ladder, from)).toBe("down");
        expect(climbDirection("Climb-up", world({}), ladder, from)).toBe("up");
        expect(climbDirection("Climb", withUp, ladder, from)).toBe("up");
        expect(climbDirection("Climb", world({}), ladder, from)).toBe("down");
    });
});
