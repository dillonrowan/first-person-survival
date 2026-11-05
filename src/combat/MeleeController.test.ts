import { describe, expect, it } from "vitest";

import { MeleeController, MeleeInput, powerDirection } from "./MeleeController";
import { tuning } from "./tuning";
import { weaponById } from "./weapons";

const DT = 0.015;

function input(extra: Partial<MeleeInput> = {}): MeleeInput {
    return {
        attackDown: false,
        forward: 0,
        strafe: 0,
        pitch: 0,
        megasprinting: false,
        airborne: false,
        fallSpeed: 0,
        aimingAtKnockedDown: false,
        ...extra,
    };
}

/** Holds the button for `seconds`, then releases; returns every move started. */
function pressFor(melee: MeleeController, seconds: number, extra: Partial<MeleeInput> = {}): string[] {
    const started: string[] = [];
    for (let t = 0; t < seconds; t += DT) {
        const e = melee.update(DT, input({ ...extra, attackDown: true }));
        if (e.started) started.push(e.started.id);
    }
    const e = melee.update(DT, input(extra));
    if (e.started) started.push(e.started.id);
    return started;
}

function runOut(melee: MeleeController, seconds = 2): string[] {
    const started: string[] = [];
    for (let t = 0; t < seconds; t += DT) {
        const e = melee.update(DT, input());
        if (e.started) started.push(e.started.id);
    }
    return started;
}

describe("MeleeController", () => {
    it("turns a tap shorter than the charge threshold into a quick strike", () => {
        const melee = new MeleeController(weaponById("sword"));
        expect(pressFor(melee, 0.2)).toEqual(["quick_A"]);
    });

    it("charges after the threshold and releases a power attack in the held direction", () => {
        const melee = new MeleeController(weaponById("sword"));
        const started: string[] = [];
        for (let t = 0; t < 0.5; t += DT) {
            const e = melee.update(DT, input({ attackDown: true, strafe: -1 }));
            if (e.started) started.push(e.started.id);
            if (t > tuning.chargeThreshold + DT) expect(melee.isCharging).toBe(true);
        }
        expect(started).toEqual([]); // nothing until release
        expect(melee.update(DT, input({ strafe: -1 })).started?.id).toBe("power_L");
    });

    it("charges faster with daggers", () => {
        const melee = new MeleeController(weaponById("daggers"));
        expect(pressFor(melee, 0.25)[0]).toBe("power");
    });

    it("chains quick strikes A→B only when pressed after 60% of the swing", () => {
        const melee = new MeleeController(weaponById("sword"));
        pressFor(melee, 0.03);
        const total = melee.swing!.timeline.windup + melee.swing!.timeline.active + melee.swing!.timeline.recovery;
        // Too early: ignored.
        melee.update(DT, input({ attackDown: true }));
        melee.update(DT, input());
        while (melee.swing && melee.swing.elapsed < total * 0.7) {
            melee.update(DT, input());
        }
        // In the chain window: buffered, then played as B when the swing ends.
        melee.update(DT, input({ attackDown: true }));
        expect(runOut(melee)).toEqual(["quick_B"]);
    });

    it("starts the combo again from A after a pause", () => {
        const melee = new MeleeController(weaponById("sword"));
        pressFor(melee, 0.03);
        runOut(melee, 3);
        expect(pressFor(melee, 0.03)).toEqual(["quick_A"]);
    });

    it("picks rush while megasprinting, falling attack while falling fast, trample on a knocked-down target", () => {
        const melee = new MeleeController(weaponById("sword"));
        expect(pressFor(melee, 0.5, { megasprinting: true })).toEqual(["rush"]);
        runOut(melee);
        expect(pressFor(melee, 0.03, { airborne: true, fallSpeed: tuning.fallAttackSpeed + 0.1 })[0]).toBe("fall");
        runOut(melee);
        expect(pressFor(melee, 0.5, { aimingAtKnockedDown: true, pitch: -1 })).toEqual(["trample"]);
    });

    it("spends a full adrenaline bar on a huge attack", () => {
        const melee = new MeleeController(weaponById("sword"));
        melee.addAdrenaline(1000);
        expect(melee.adrenaline).toBe(tuning.adrenalineMax);
        expect(pressFor(melee, 0.5)).toEqual(["huge"]);
        expect(melee.adrenaline).toBe(0);
    });

    it("loses one adrenaline point every 20 seconds", () => {
        const melee = new MeleeController(weaponById("sword"));
        melee.addAdrenaline(5);
        runOut(melee, 19.9);
        expect(melee.adrenaline).toBe(5);
        runOut(melee, 0.2);
        expect(melee.adrenaline).toBe(4);
    });

    it("reports each hit's active window exactly once, in slices that add up to the whole window", () => {
        const melee = new MeleeController(weaponById("sword"));
        let covered = 0;
        let started = false;
        for (let t = 0; t < 2; t += DT) {
            const e = melee.update(DT, input({ attackDown: t < 0.5, megasprinting: true }));
            started ||= e.started?.id === "rush";
            for (const slice of e.active) covered += slice.to - slice.from;
        }
        expect(started).toBe(true);
        expect(covered).toBeCloseTo(2, 6); // rush has two hit events
    });
});

describe("powerDirection", () => {
    it("maps movement keys to variants", () => {
        const base = { forward: 0, strafe: 0, pitch: 0, airborne: false };
        expect(powerDirection(base)).toBe("default");
        expect(powerDirection({ ...base, strafe: 1 })).toBe("R");
        expect(powerDirection({ ...base, forward: -1 })).toBe("B");
        expect(powerDirection({ ...base, forward: 1 })).toBe("default");
        expect(powerDirection({ ...base, forward: 1, pitch: 0.7 })).toBe("T");
        expect(powerDirection({ ...base, forward: 1, airborne: true })).toBe("T");
    });
});
