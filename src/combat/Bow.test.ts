import { describe, expect, it } from "vitest";

import type { Body, BodySource } from "../physics/Bodies";
import { FlagsAt, WALL_HALF_THICKNESS } from "../physics/TileColliders";
import { units } from "../player/MoveMath";
import { CollisionFlag } from "../world/WorldFormat";
import { Arrow, BowController, RangedProfile, launchArrow, rangedProfile, stepArrows } from "./Bow";
import { tuning } from "./tuning";

const run = (bow: BowController, seconds: number, attackDown: boolean, aimDown = false): number => {
    let shots = 0;
    for (let t = 0; t < seconds - 1e-9; t += 0.01) {
        if (bow.update(0.01, { attackDown, aimDown })) {
            shots++;
        }
    }
    return shots;
};

describe("BowController (spec 16.4)", () => {
    it("is ready to fire 1.433 s into the draw", () => {
        const bow = new BowController();
        run(bow, 1.4, true);
        expect(bow.state).toBe("drawing");
        run(bow, 0.05, true);
        expect(bow.state).toBe("drawn");
    });

    it("releasing early lowers the bow without a shot", () => {
        const bow = new BowController();
        run(bow, 1, true);
        expect(run(bow, 1, false)).toBe(0);
        expect(bow.arrows).toBe(tuning.arrowsStart);
    });

    it("shoots on release and chains into the 1 s re-draw while held", () => {
        const bow = new BowController();
        run(bow, 1.5, true);
        expect(run(bow, 0.05, false)).toBe(1);
        expect(bow.arrows).toBe(tuning.arrowsStart - 1);
        run(bow, 0.25, true); // pressed again during the shot
        expect(bow.state).toBe("drawing");
        run(bow, 0.95, true);
        expect(bow.state).toBe("drawn");
    });

    it("pulls the string back with the draw and lets it down after an early release", () => {
        const bow = new BowController();
        expect(bow.stringPull).toBe(0);
        expect(bow.arrowNocked).toBe(true);
        run(bow, 0.5, true);
        const early = bow.stringPull;
        expect(early).toBeGreaterThan(bow.drawProgress); // eases into the anchor
        run(bow, 0.5, true);
        expect(bow.stringPull).toBeGreaterThan(early);
        run(bow, 0.05, false);
        expect(bow.state).toBe("lowering");
        expect(bow.stringPull).toBeGreaterThan(0);
        expect(bow.arrowNocked).toBe(true);
        run(bow, 0.3, false);
        expect(bow.stringPull).toBe(0);
    });

    it("settles the held bow back to rest quickly after a shot, not in one frame", () => {
        const bow = new BowController();
        run(bow, 1.5, true);
        expect(bow.poseProgress).toBe(1);
        run(bow, 0.02, false);
        expect(bow.state).toBe("shooting");
        expect(bow.poseProgress).toBeGreaterThan(0.9);
        run(bow, 0.13, false);
        expect(bow.poseProgress).toBeGreaterThan(0.2);
        expect(bow.poseProgress).toBeLessThan(0.8);
        run(bow, 0.2, false);
        expect(bow.poseProgress).toBe(0);
    });

    it("loses the arrow on the shot, twangs the string, and nocks again once lowered", () => {
        const bow = new BowController();
        run(bow, 1.5, true);
        expect(bow.stringPull).toBe(1);
        run(bow, 0.02, false);
        expect(bow.state).toBe("shooting");
        expect(bow.arrowNocked).toBe(false);
        expect(Math.abs(bow.stringPull)).toBeLessThan(0.1);
        run(bow, 0.25, false);
        expect(bow.state).toBe("lowering");
        expect(bow.arrowNocked).toBe(false);
        run(bow, 1, false);
        expect(bow.state).toBe("idle");
        expect(bow.arrowNocked).toBe(true);
    });

    it("zooms only while the right mouse is held, and sways after 4 s", () => {
        const bow = new BowController();
        run(bow, 2, true);
        expect(bow.zoom).toBe(0); // fully drawn, but not aiming
        run(bow, 0.5, true, true);
        expect(bow.zoom).toBeGreaterThan(0.9);
        expect(bow.sway(1)).toEqual([0, 0]);
        run(bow, 5, true, true);
        expect(Math.abs(bow.sway(1)[0])).toBeGreaterThan(0);
        run(bow, 1.5, true, false);
        expect(bow.zoom).toBe(0);
        // Not drawn at all: holding the right mouse still zooms.
        const idle = new BowController();
        run(idle, 0.5, false, true);
        expect(idle.zoom).toBeGreaterThan(0.9);
    });
});

describe("arrows", () => {
    const none: BodySource = { collectBodies: () => {} };
    const open = () => 0;
    const flat = () => 0;

    it("fly at 2100 u/s and fall under gravity", () => {
        const a = launchArrow({ x: 0, y: 0, z: 1.25, plane: 0 }, 0, 0);
        expect(Math.hypot(a.vx, a.vy, a.vz)).toBeCloseTo(units(2100));
        const arrows: Arrow[] = [a];
        stepArrows(arrows, 0.1, none, open, flat);
        expect(a.y).toBeCloseTo(units(210));
        expect(a.vz).toBeCloseTo(-units(60));
    });

    /** Ground distance and airtime of a level shot from eye height. */
    const range = (profile: RangedProfile) => {
        const arrows: Arrow[] = [launchArrow({ x: 0, y: 0, z: 1.25, plane: 0 }, 0, 0, profile)];
        let airtime = 0;
        while (!arrows[0].stuck) {
            stepArrows(arrows, 0.01, none, open, flat);
            airtime += 0.01;
        }
        return { distance: arrows[0].y, airtime };
    };

    it("carry further and stay up longer from a longbow or crossbow than from a shortbow", () => {
        const long = rangedProfile({ name: "Yew longbow", family: "bow" });
        const short = rangedProfile({ name: "Magic shortbow", family: "bow" });
        expect(rangedProfile({ name: "Dark bow", family: "bow" })).toBe(long); // not named shortbow
        expect(rangedProfile({ name: "Rune crossbow", family: "crossbow" })).toBe(long);
        expect(short.drawReady).toBeLessThan(long.drawReady);
        expect(short.redrawReady).toBeLessThan(long.redrawReady);
        // Further, and longer in the air.
        expect(range(long).distance).toBeGreaterThan(range(short).distance * 1.5);
        expect(range(long).airtime).toBeGreaterThan(range(short).airtime * 1.2);
    });

    it("draw a shortbow ready sooner", () => {
        const bow = new BowController();
        bow.profile = rangedProfile({ name: "Oak shortbow", family: "bow" });
        run(bow, tuning.shortbowDrawReady + 0.02, true);
        expect(bow.state).toBe("drawn");
    });

    it("never vanish in flight, and disappear only some time after they stick", () => {
        // Straight up: a long flight, well past the time a stuck arrow lasts.
        const arrows: Arrow[] = [launchArrow({ x: 0, y: 0, z: 1.25, plane: 0 }, 0, Math.PI / 2 - 0.01)];
        let flight = 0;
        while (!arrows[0].stuck) {
            stepArrows(arrows, 0.05, none, open, flat);
            flight += 0.05;
        }
        expect(flight).toBeGreaterThan(1);
        stepArrows(arrows, tuning.arrowStuckTime - 0.1, none, open, flat);
        expect(arrows.length).toBe(1);
        stepArrows(arrows, 0.2, none, open, flat);
        expect(arrows.length).toBe(0);
    });

    it("fly over a fence lower than they are, and stick in a wall taller than they are", () => {
        // A wall along the north edge of tile (0, 2), so at y = 3, crossed in the first 0.1 s.
        const fence: FlagsAt = (_plane, x, y) => (x === 0 && y === 2 ? CollisionFlag.WALL_NORTH : 0);
        const shoot = () => [launchArrow({ x: 0.5, y: 0, z: 1.25, plane: 0 }, 0, 0)];
        const low = shoot();
        stepArrows(low, 0.1, none, fence, flat, () => 1);
        expect(low[0].stuck).toBe(false);
        expect(low[0].y).toBeGreaterThan(3);
        const tall = shoot();
        stepArrows(tall, 0.1, none, fence, flat, () => 2);
        expect(tall[0].stuck).toBe(true);
        expect(tall[0].y).toBeCloseTo(3 - WALL_HALF_THICKNESS, 6);
        // Without heights a wall stops it, as before.
        const unknown = shoot();
        stepArrows(unknown, 0.1, none, fence, flat);
        expect(unknown[0].stuck).toBe(true);
    });

    it("hit a body in their path", () => {
        const target: Body<string> = { x: 0, y: 3, z: 0, radius: 0.4, height: 1.8, plane: 0, owner: "npc" };
        const bodies: BodySource<string> = { collectBodies: (_p, _a, _b, _c, _d, out) => out.push(target) };
        const arrows: Arrow[] = [launchArrow({ x: 0, y: 0, z: 1.25, plane: 0 }, 0, 0)];
        const hits = stepArrows(arrows, 0.1, bodies, open, flat);
        expect(hits.map((h) => h.body.owner)).toEqual(["npc"]);
        expect(arrows.length).toBe(0);
    });
});
