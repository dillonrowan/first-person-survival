import { describe, expect, it } from "vitest";

import type { Body, BodySource } from "../physics/Bodies";
import { units } from "../player/MoveMath";
import { Arrow, BowController, launchArrow, stepArrows } from "./Bow";
import { tuning } from "./tuning";

const run = (bow: BowController, seconds: number, attackDown: boolean, speed = 0): number => {
    let shots = 0;
    for (let t = 0; t < seconds - 1e-9; t += 0.01) {
        if (bow.update(0.01, { attackDown, speed })) {
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

    it("zooms only when drawn and almost still, and sways after 4 s", () => {
        const bow = new BowController();
        run(bow, 2, true, 3);
        expect(bow.zoom).toBe(0);
        run(bow, 0.5, true, 0);
        expect(bow.zoom).toBeGreaterThan(0.9);
        expect(bow.sway(1)).toEqual([0, 0]);
        run(bow, 5, true, 0);
        expect(Math.abs(bow.sway(1)[0])).toBeGreaterThan(0);
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

    it("hit a body in their path", () => {
        const target: Body<string> = { x: 0, y: 3, z: 0, radius: 0.4, height: 1.8, plane: 0, owner: "npc" };
        const bodies: BodySource<string> = { collectBodies: (_p, _a, _b, _c, _d, out) => out.push(target) };
        const arrows: Arrow[] = [launchArrow({ x: 0, y: 0, z: 1.25, plane: 0 }, 0, 0)];
        const hits = stepArrows(arrows, 0.1, bodies, open, flat);
        expect(hits.map((h) => h.body.owner)).toEqual(["npc"]);
        expect(arrows.length).toBe(0);
    });
});
