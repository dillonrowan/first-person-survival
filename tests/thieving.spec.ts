// End-to-end check of pickpocketing in the real game, driven through the dev console (window.game):
// the view leans in to the pocket, and a caught attempt stuns the player and turns the NPC hostile.

import { expect, test } from "@playwright/test";

type Game = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

declare global {
    interface Window {
        game?: Game;
    }
}

test.setTimeout(240_000);
test.use({ launchOptions: { args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] } });

test("a caught pickpocket turns the NPC on the player", async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/?x=3222&y=3218"); // Lumbridge, where men and women wander
    await page.waitForFunction(() => !!window.game?.npcs && window.game.player.ready, undefined, { timeout: 180_000, polling: 1000 });
    await page.waitForFunction(
        () => window.game!.npcs.all().some((n: any) => !n.gone && (n.appearance.actions ?? []).some((a: string) => /^pickpocket$/i.test(a))),
        undefined,
        { timeout: 60_000, polling: 1000 },
    );

    /** Steps next to the nearest pickpocketable NPC, faces it and tries its pocket; true when it started. */
    const attempt = () =>
        page.evaluate(() => {
            const g = window.game!;
            const npc = g.npcs
                .all()
                .filter((n: any) => !n.gone && !n.inCombat && (n.appearance.actions ?? []).some((a: string) => /^pickpocket$/i.test(a)))
                .sort((a: any, b: any) => Math.hypot(a.body.x - g.player.x, a.body.y - g.player.y) - Math.hypot(b.body.x - g.player.x, b.body.y - g.player.y))[0];
            (window as any).__mark = npc;
            g.tp(Math.round(npc.body.x), Math.round(npc.body.y) - 1, npc.plane);
            return g.skillSystem.npcAction(npc, "Pickpocket") && !!g.skillSystem.active;
        });

    expect(await attempt()).toBe(true);
    await page.waitForTimeout(250); // leaning in to the pocket (an attempt resolves within 2 ticks)
    await page.screenshot({ path: info.outputPath("reach.png") });

    // Level 1 succeeds about 70% of the time: try until caught.
    let caught = false;
    for (let i = 0; i < 40 && !caught; i++) {
        // Resolve the attempt on the game clock, not by waiting: a frame advances the game by at
        // most 0.05 s, so under CI's software renderer (a few fps) the attempt's 2 ticks take
        // longer in real time than any sensible wait.
        const after = await page.evaluate(() => {
            const g = window.game!;
            for (let t = 0; t < 5 && g.skillSystem.active; t++) g.clock.advance(1);
            return { active: !!g.skillSystem.active, stunned: g.skillSystem.thieving.stunned };
        });
        expect(after.active, "the attempt resolves within 5 ticks").toBe(false);
        caught = after.stunned;
        if (!caught) expect(await attempt()).toBe(true);
    }
    expect(caught).toBe(true);
    await page.waitForTimeout(150); // the slap
    await page.screenshot({ path: info.outputPath("caught.png") });
    expect(await page.evaluate(() => (window as any).__mark.inCombat)).toBe(true);
    expect(errors).toEqual([]);
});
