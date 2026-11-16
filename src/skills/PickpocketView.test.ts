import { describe, expect, it } from "vitest";

import { PickpocketView } from "./PickpocketView";

/** Runs the view for `seconds` in 60 fps frames; returns the last offset. */
const run = (view: PickpocketView, seconds: number) => {
    let look = view.update(0);
    for (let t = 0; t < seconds; t += 1 / 60) look = view.update(1 / 60);
    return { ...look };
};

describe("pickpocket look", () => {
    it("glances down and leans in, holding there until the outcome", () => {
        const view = new PickpocketView();
        view.play("reach");
        const look = run(view, 3);
        expect(look.pitch).toBeLessThan(-0.4);
        expect(look.dip).toBeGreaterThan(0.05);
        expect(look.lean).toBeGreaterThan(0.05);
        expect(view.playing).toBe("reach");
    });

    it("is jerked back when caught, then settles upright", () => {
        const view = new PickpocketView();
        view.play("reach");
        run(view, 1.2);
        view.play("caught");
        const jerk = run(view, 0.12);
        expect(jerk.pitch).toBeGreaterThan(0);
        expect(jerk.lean).toBeLessThan(0);
        const after = run(view, 1);
        expect(view.playing).toBeUndefined();
        expect(after).toEqual({ pitch: 0, yaw: 0, roll: 0, lean: 0, dip: 0 });
    });
});
