import { describe, expect, it } from "vitest";

import type { Body, BodySource } from "../physics/Bodies";
import { CollisionFlag } from "../world/WorldFormat";
import { KickController, traceKick } from "./Kick";
import { tuning } from "./tuning";

const body = (x: number, y: number, height = 1.7): Body<string> => ({
    x,
    y,
    z: 0,
    radius: 0.35,
    height,
    plane: 0,
    owner: "npc",
});
const source = (list: Body<string>[]): BodySource<string> => ({
    collectBodies: (_p, _a, _b, _c, _d, out) => out.push(...list),
});
const kicker = { x: 100.5, y: 100.5, eyeZ: 1.25, yaw: 0, pitch: 0, plane: 0 };

describe("traceKick", () => {
    it("reaches 100 u (about 2 tiles) along the view", () => {
        expect(traceKick(kicker, source([body(100.5, 102.2)]), () => 0)?.attempt).toBe(0);
        expect(traceKick(kicker, source([body(100.5, 100.5 + tuning.kickReach + 0.5)]), () => 0)).toBeUndefined();
    });

    it("retries lower to find a short or crouched target", () => {
        const short = body(100.5, 102, 0.8); // below eye height
        const hit = traceKick(kicker, source([short]), () => 0);
        expect(hit).toBeDefined();
        expect(hit!.attempt).toBeGreaterThan(0);
    });

    it("is stopped by a wall", () => {
        const wall = (_p: number, x: number, y: number) => (x === 100 && y === 101 ? CollisionFlag.WALL_NORTH : 0);
        expect(traceKick(kicker, source([body(100.5, 102.4)]), wall)).toBeUndefined();
    });
});

describe("KickController", () => {
    it("needs 3 stamina, fires its hit at the animation event and lasts 21 frames", () => {
        const kick = new KickController();
        expect(kick.tryStart(2.9, 0)).toBe(false);
        expect(kick.tryStart(3, 0)).toBe(true);
        expect(kick.low).toBe(false);
        let fired = -1;
        let t = 0;
        while (kick.active) {
            t += 0.01;
            if (kick.update(0.01) && fired < 0) {
                fired = t;
            }
        }
        expect(fired).toBeCloseTo(tuning.kickHitTimeMedium, 1);
        expect(t).toBeCloseTo(tuning.kickDuration, 1);
        expect(kick.tryStart(10, -1)).toBe(true);
        expect(kick.low).toBe(true);
    });
});
