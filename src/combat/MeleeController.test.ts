import { describe, expect, it } from "vitest";

import { MeleeController, MeleeInput, powerDirection } from "./MeleeController";
import { MOVE_SETS, timelineFor } from "./moves";
import { tuning } from "./tuning";
import { swingTime, weaponById } from "./weapons";

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
    it("starts the wind-up on press and makes a release before it ends a quick strike (spec 18.1)", () => {
        const melee = new MeleeController(weaponById("sword"));
        melee.update(DT, input({ attackDown: true }));
        expect(melee.phase).toBe("windup");
        expect(pressFor(melee, 0.4)).toEqual(["quick_A"]);
    });

    it("charges once the 0.5 s wind-up ends and releases a power attack in the pressed direction", () => {
        const melee = new MeleeController(weaponById("sword"));
        const started: string[] = [];
        for (let t = 0; t < 0.6; t += DT) {
            const e = melee.update(DT, input({ attackDown: true, strafe: -1 }));
            if (e.started) started.push(e.started.id);
            if (t < 0.45) expect(melee.isCharging).toBe(false);
        }
        expect(melee.isCharging).toBe(true);
        expect(started).toEqual([]); // nothing until release
        expect(melee.update(DT, input({ strafe: -1 })).started?.id).toBe("power_L");
    });

    it("winds up 0.667 s for the back and overhead variants, 1.542 s with a staff", () => {
        const sword = new MeleeController(weaponById("sword"));
        expect(pressFor(sword, 0.6, { forward: 1 })).toEqual(["quick_A"]);
        runOut(sword);
        expect(pressFor(sword, 0.7, { forward: 1 })).toEqual(["power_T"]);
        const staff = new MeleeController(weaponById("staff"));
        expect(pressFor(staff, 1.2)).toEqual(["quick_A"]);
    });

    it("queues the next strike for a press at any point of a quick strike", () => {
        const melee = new MeleeController(weaponById("sword"));
        pressFor(melee, 0.03);
        // Straight away, early in A: still queued (no 60% gate during strikes).
        melee.update(DT, input({ attackDown: true }));
        melee.update(DT, input());
        expect(runOut(melee)).toEqual(["quick_B"]);
    });

    it("alternates left-to-right (A) and right-to-left (B) strikes, click after click", () => {
        for (const id of ["sword", "daggers", "staff"]) {
            const melee = new MeleeController(weaponById(id));
            const order: string[] = [];
            for (let i = 0; i < 5; i++) {
                order.push(...pressFor(melee, 0.03));
                order.push(...runOut(melee, 0.3));
            }
            expect(order).toEqual(["quick_A", "quick_B", "quick_A", "quick_B", "quick_A"]);
            expect(MOVE_SETS[weaponById(id).family].quick.map((m) => m.hits[0].impact.y)).toEqual([-1, 1]);
        }
    });

    it("goes straight back to idle after a strike, ready for the next click", () => {
        const melee = new MeleeController(weaponById("sword"));
        pressFor(melee, 0.03);
        while (melee.swing) melee.update(DT, input());
        expect(melee.phase).toBe("idle");
        expect(pressFor(melee, 0.03)).toEqual(["quick_B"]);
    });

    it("swings once per click: queued clicks cut into the recovery of the strike before", () => {
        const melee = new MeleeController(weaponById("daggers"));
        const started: string[] = [...pressFor(melee, 0.015)];
        // Two more clicks straight away.
        for (let i = 0; i < 2; i++) {
            melee.update(DT, input({ attackDown: true }));
            melee.update(DT, input());
        }
        started.push(...runOut(melee, 1));
        expect(started).toEqual(["quick_A", "quick_B", "quick_A"]);
    });

    describe("never loses a click", () => {
        /** One update in which the button went down and came up again (a tap between frames). */
        const tap = (melee: MeleeController) => melee.update(DT, input({ attackPressed: true })).started?.id;

        it("strikes on a tap shorter than one update", () => {
            const melee = new MeleeController(weaponById("sword"));
            expect(tap(melee)).toBe("quick_A");
        });

        it("queues taps shorter than one update during a strike", () => {
            const melee = new MeleeController(weaponById("sword"));
            tap(melee);
            tap(melee);
            tap(melee);
            expect(runOut(melee)).toEqual(["quick_B", "quick_A"]);
        });

        it("queues up to three clicks during one strike, each one more strike", () => {
            const melee = new MeleeController(weaponById("staff"));
            const started = [...pressFor(melee, 0.03)];
            for (let i = 0; i < 3; i++) {
                melee.update(DT, input({ attackDown: true }));
                melee.update(DT, input());
            }
            started.push(...runOut(melee));
            expect(started).toEqual(["quick_A", "quick_B", "quick_A", "quick_B"]);
        });

        it("follows a power attack with the strikes clicked during it, before its recovery ends", () => {
            const melee = new MeleeController(weaponById("sword"));
            const started = pressFor(melee, 0.6);
            expect(started).toEqual(["power"]);
            const length = melee.swing!.timeline;
            melee.update(DT, input({ attackDown: true }));
            melee.update(DT, input());
            let at = 2 * DT;
            let next: string | undefined;
            while (!next && at < 3) {
                next = melee.update(DT, input()).started?.id;
                at += DT;
            }
            expect(next).toBe("quick_A");
            expect(at).toBeLessThan(length.windup + length.active + length.recovery);
        });

        it("counts a release and press in the same update during the wind-up as two clicks", () => {
            const melee = new MeleeController(weaponById("sword"));
            melee.update(DT, input({ attackDown: true }));
            expect(melee.phase).toBe("windup");
            // Up and down again between updates: the button reads down, but it was pressed anew.
            expect(melee.update(DT, input({ attackDown: true, attackPressed: true })).started?.id).toBe("quick_A");
            melee.update(DT, input());
            expect(runOut(melee)).toEqual(["quick_B"]);
        });

        it("keeps clicks queued before a press that is held into a wind-up and released as a strike", () => {
            const melee = new MeleeController(weaponById("sword"));
            const started = [...pressFor(melee, 0.03)];
            // A click, then a press held past the charge threshold, released before it charges.
            melee.update(DT, input({ attackDown: true }));
            melee.update(DT, input());
            started.push(...pressFor(melee, tuning.chargeThreshold + 0.05));
            started.push(...runOut(melee));
            // Three presses, three strikes.
            expect(started).toHaveLength(3);
            expect(started.every((id) => id.startsWith("quick"))).toBe(true);
        });

        it("spends earlier clicks on a charge that completes, adding no strike after the power attack", () => {
            const melee = new MeleeController(weaponById("sword"));
            pressFor(melee, 0.03);
            melee.update(DT, input({ attackDown: true }));
            melee.update(DT, input());
            const started = [...pressFor(melee, 1.2)];
            started.push(...runOut(melee));
            expect(started.filter((id) => id.startsWith("power"))).toHaveLength(1);
            expect(started.at(-1)).toMatch(/^power/);
        });
    });

    it("swings lighter weapons faster: daggers, shortsword, longsword, club, staff", () => {
        const times = ["daggers", "shortsword", "sword", "club", "staff"].map((id) => {
            const w = weaponById(id);
            const tl = timelineFor(MOVE_SETS[w.family].quick[0], w.speed);
            return tl.windup + tl.active + tl.recovery;
        });
        for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
        expect(times[0]).toBeCloseTo(swingTime(weaponById("daggers").weight), 9);
        expect(times[0]).toBeLessThan(0.3);
    });

    it("cancels a quick strike into the wind-up when held for the charge threshold", () => {
        const melee = new MeleeController(weaponById("sword"));
        pressFor(melee, 0.03);
        for (let t = 0; t < tuning.chargeThreshold + 0.03; t += DT) {
            melee.update(DT, input({ attackDown: true, strafe: 1 }));
        }
        expect(melee.phase).toBe("windup");
        expect(melee.chargedMove?.id).toBe("power_R");
    });

    it("cancels into the wind-up after 0.18 s with daggers", () => {
        const melee = new MeleeController(weaponById("daggers"));
        pressFor(melee, 0.03);
        for (let t = 0; t < 0.2; t += DT) {
            melee.update(DT, input({ attackDown: true }));
        }
        expect(melee.phase).toBe("windup");
    });

    it("starts the combo again from A after a pause", () => {
        const melee = new MeleeController(weaponById("sword"));
        pressFor(melee, 0.03);
        runOut(melee, 3);
        expect(pressFor(melee, 0.03)).toEqual(["quick_A"]);
    });

    it("picks rush while megasprinting, falling attack while falling fast, trample on a knocked-down target", () => {
        const melee = new MeleeController(weaponById("sword"));
        expect(pressFor(melee, 0.6, { megasprinting: true })).toEqual(["rush"]);
        runOut(melee);
        expect(pressFor(melee, 0.03, { airborne: true, fallSpeed: tuning.fallAttackSpeed + 0.1 })[0]).toBe("fall");
        runOut(melee);
        expect(pressFor(melee, 0.6, { aimingAtKnockedDown: true, pitch: -1 })).toEqual(["trample"]);
    });

    it("spends a full adrenaline bar on a huge attack", () => {
        const melee = new MeleeController(weaponById("sword"));
        melee.addAdrenaline(1000);
        expect(melee.adrenaline).toBe(tuning.adrenalineMax);
        expect(pressFor(melee, 0.6)).toEqual(["huge"]);
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
            const e = melee.update(DT, input({ attackDown: t < 0.6, megasprinting: true }));
            started ||= e.started?.id === "rush";
            for (const slice of e.active) covered += slice.to - slice.from;
        }
        expect(started).toBe(true);
        expect(covered).toBeCloseTo(2, 6); // rush has two hit events
    });
});

describe("powerDirection (spec 17.1)", () => {
    it("maps movement keys to variants: left, then right, then forward, then back", () => {
        const base = { forward: 0, strafe: 0 };
        expect(powerDirection(base)).toBe("default");
        expect(powerDirection({ ...base, strafe: -1 })).toBe("L");
        expect(powerDirection({ ...base, strafe: 1 })).toBe("R");
        expect(powerDirection({ ...base, forward: 1 })).toBe("T");
        expect(powerDirection({ ...base, forward: -1 })).toBe("B");
        expect(powerDirection({ forward: 1, strafe: -1 })).toBe("L");
        expect(powerDirection({ forward: -1, strafe: 1 })).toBe("R");
    });

    it("locks the variant when the wind-up starts, not at release", () => {
        const melee = new MeleeController(weaponById("sword"));
        melee.update(DT, input({ attackDown: true, forward: 1 }));
        expect(melee.chargedMove?.id).toBe("power_T");
        // Change keys while winding up and holding: still T.
        for (let t = 0; t < 0.8; t += DT) {
            melee.update(DT, input({ attackDown: true, strafe: 1 }));
        }
        expect(melee.update(DT, input({ strafe: 1 })).started?.id).toBe("power_T");
    });
});
