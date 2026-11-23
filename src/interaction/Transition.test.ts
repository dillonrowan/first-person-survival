import { describe, expect, it } from "vitest";

import { BLOCKED_MESSAGE, LOAD_TIMEOUT_SECONDS, Transition, TransitionPlayer } from "./Transition";

function fakePlayer(loadsAfter: number): TransitionPlayer & { waiting: number; teleports: [number, number, number][] } {
    const player = {
        x: 10,
        y: 20,
        plane: 0,
        waiting: 0,
        teleports: [] as [number, number, number][],
        get ready() {
            return this.waiting <= 0;
        },
        teleport(x: number, y: number, plane: number) {
            this.x = x;
            this.y = y;
            this.plane = plane;
            this.teleports.push([x, y, plane]);
            // The destination loads after `loadsAfter` seconds; the origin is already there.
            this.waiting = y > 5000 ? loadsAfter : 0;
        },
    };
    return player;
}

/** Runs the transition for `seconds` in 0.1 s steps, ticking the fake player's loading too. */
function run(t: Transition, player: ReturnType<typeof fakePlayer>, seconds: number) {
    for (let elapsed = 0; elapsed < seconds; elapsed += 0.1) {
        t.update(0.1);
        player.waiting -= 0.1;
    }
}

describe("Transition", () => {
    // The screen fades out, the player is moved, then it fades back in once the square has loaded.
    it("fades, teleports, waits for the destination and fades back in", () => {
        const player = fakePlayer(1);
        const messages: string[] = [];
        const t = new Transition(player, (m) => messages.push(m));
        t.start({ x: 10.5, y: 6420.5, plane: 0, message: "You climb down into the cellar." });

        run(t, player, 0.3);
        expect(player.teleports).toHaveLength(0); // still fading out
        expect(t.opacity).toBeGreaterThan(0.5);

        run(t, player, 0.3);
        expect(player.teleports).toEqual([[10.5, 6420.5, 0]]);
        expect(t.opacity).toBe(1); // held black while the square loads

        run(t, player, 3);
        expect(messages).toEqual(["You climb down into the cellar."]);
        expect(t.opacity).toBe(0);
        expect(t.active).toBe(false);
    });

    // A destination that never loads sends the player back and says so.
    it("returns the player to the origin when the destination does not load in time", () => {
        const player = fakePlayer(Infinity);
        const messages: string[] = [];
        const t = new Transition(player, (m) => messages.push(m));
        t.start({ x: 10.5, y: 6420.5, plane: 0, message: "Never shown." });

        run(t, player, LOAD_TIMEOUT_SECONDS + 3);
        expect(player.teleports).toEqual([[10.5, 6420.5, 0], [10, 20, 0]]);
        expect(messages).toEqual([BLOCKED_MESSAGE]);
        expect(t.active).toBe(false);
    });

    // A region that is known to have failed does not wait for the timeout.
    it("gives up straight away when the destination region failed to load", () => {
        const player = fakePlayer(Infinity);
        const messages: string[] = [];
        const t = new Transition(player, (m) => messages.push(m), () => true);
        t.start({ x: 10.5, y: 6420.5, plane: 0 });
        run(t, player, 1.5);
        expect(messages).toEqual([BLOCKED_MESSAGE]);
        expect(player.teleports.at(-1)).toEqual([10, 20, 0]);
    });

    // A second start while one runs is ignored, so a double press cannot stack teleports.
    it("ignores a start while one is running", () => {
        const player = fakePlayer(0);
        const t = new Transition(player, () => {});
        t.start({ x: 1, y: 6000, plane: 0 });
        t.start({ x: 2, y: 7000, plane: 0 });
        run(t, player, 2);
        expect(player.teleports).toEqual([[1, 6000, 0]]);
    });
});
