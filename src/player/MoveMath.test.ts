import { describe, expect, it } from "vitest";

import { Stamina } from "./Stamina";
import {
    AIR_SPEED_CAP,
    STOP_SPEED,
    accelerate,
    airAccelerate,
    clipVelocity,
    friction,
    speedFor,
    units,
    wishSpeed,
} from "./MoveMath";

describe("MoveMath", () => {
    it("converts Source units to tiles", () => {
        expect(units(61.065)).toBeCloseTo(1.25, 6);
    });

    it("friction stops a player in finite time, faster below stopspeed", () => {
        const v = { x: 0, y: speedFor("run") };
        let t = 0;
        while (Math.hypot(v.x, v.y) > 0 && t < 5) {
            friction(v, 0.015);
            t += 0.015;
        }
        expect(Math.hypot(v.x, v.y)).toBe(0);
        expect(t).toBeGreaterThan(0.3);
        expect(t).toBeLessThan(1.5);
        const slow = { x: STOP_SPEED / 2, y: 0 };
        friction(slow, 0.1);
        expect(slow.x).toBeCloseTo(STOP_SPEED / 2 - STOP_SPEED * 0.4, 6 + 0);
    });

    it("accelerate ramps up to, and never past, the wish speed", () => {
        const v = { x: 0, y: 0 };
        const wish = speedFor("run");
        for (let i = 0; i < 200; i++) {
            accelerate(v, { x: 0, y: 1 }, wish, 0.015);
        }
        expect(v.y).toBeCloseTo(wish, 6);
        accelerate(v, { x: 0, y: 1 }, wish, 0.015);
        expect(v.y).toBeLessThanOrEqual(wish + 1e-9);
    });

    it("air acceleration only adds up to the capped speed along the wish direction", () => {
        const v = { x: 0, y: 0 };
        for (let i = 0; i < 100; i++) {
            airAccelerate(v, { x: 1, y: 0 }, speedFor("sprint"), 0.015);
        }
        expect(v.x).toBeCloseTo(AIR_SPEED_CAP, 6);
    });

    it("clipVelocity removes only the inward component", () => {
        const v = { x: 3, y: 2 };
        clipVelocity(v, -1, 0);
        expect(v).toEqual({ x: 0, y: 2 });
        const away = { x: -3, y: 1 };
        clipVelocity(away, -1, 0);
        expect(away).toEqual({ x: -3, y: 1 });
    });

    it("wish speed depends on direction and mode", () => {
        expect(wishSpeed("run", 0, 0)).toBe(0);
        expect(wishSpeed("run", -1, 0)).toBeLessThan(wishSpeed("run", 1, 0));
        expect(wishSpeed("sprint", -1, 0)).toBe(wishSpeed("run", -1, 0));
        expect(wishSpeed("sprint", 1, 0)).toBeGreaterThan(wishSpeed("run", 1, 0));
        expect(wishSpeed("crouch", 1, 0)).toBeLessThan(wishSpeed("walk", 1, 0));
    });
});

describe("speed table", () => {
    it("matches the spec in Source units", () => {
        const u = (tiles: number) => tiles / units(1);
        expect(u(wishSpeed("run", 1, 0))).toBeCloseTo(180, 6);
        expect(u(wishSpeed("run", -1, 0))).toBeCloseTo(60, 6);
        expect(u(wishSpeed("run", -1, 1))).toBeCloseTo(80, 6);
        expect(u(wishSpeed("walk", 1, 1))).toBeCloseTo(80, 6);
        expect(u(wishSpeed("crouch", 0, 1))).toBeCloseTo(45, 6);
        expect(u(wishSpeed("sprint", 1, 0))).toBeCloseTo(270, 6);
        expect(u(wishSpeed("sprint", 1, 1))).toBeCloseTo(180, 6); // megasprint is straight ahead only
    });
});

describe("Stamina", () => {
    it("starts megasprint only above the threshold, runs until empty, then regenerates", () => {
        const s = new Stamina();
        expect(s.canStartSprint).toBe(true);
        while (s.canContinueSprint) {
            s.update(0.1, true);
        }
        expect(s.value).toBe(0);
        expect(s.canStartSprint).toBe(false);
        // 0.5 per second (0.06 per 0.12 s): back to the kick threshold of 3 after 6 s.
        for (let t = 0; t < 5.9; t += 0.1) {
            s.update(0.1, false);
        }
        expect(s.canStartSprint).toBe(false);
        s.update(0.2, false);
        expect(s.canStartSprint).toBe(true);
    });

    it("lasts four and a half seconds from full (9 at 2 per second)", () => {
        const s = new Stamina();
        expect(s.max).toBe(9);
        let t = 0;
        while (s.canContinueSprint) {
            s.update(0.015, true);
            t += 0.015;
        }
        expect(t).toBeCloseTo(4.5, 1);
    });

    it("spend refuses when there is not enough", () => {
        const s = new Stamina(3);
        expect(s.spend(3)).toBe(true);
        expect(s.spend(1)).toBe(false);
    });
});
