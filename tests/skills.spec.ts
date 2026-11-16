// End-to-end checks of skilling in the real game, driven through the dev console (window.game).
// The tree and range checks need a map exported with skill locs (export-world after
// export-skills); they are skipped on an older export.

import { expect, test, Page } from "@playwright/test";

type Game = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

declare global {
    interface Window {
        game?: Game;
    }
}

test.setTimeout(240_000);
// The GPU where there is one: software rendering runs the game at 1-2 frames a second.
test.use({ launchOptions: { args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] } });

/** Opens the game at a tile (each test has a fresh browser profile, so a fresh save). */
async function start(page: Page, x: number, y: number): Promise<void> {
    await page.goto(`/?x=${x}&y=${y}`);
    // Poll on a timer: headless rendering is slow enough to starve animation-frame polling.
    await page.waitForFunction(() => !!window.game?.npcs && window.game.player.ready, undefined, { timeout: 180_000, polling: 1000 });
}

test("fishing (rod: cast, bite, hook, reel; net: scoop) and banking work", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await start(page, 3087, 3230); // Draynor's net and bait spots (placed from the wiki)

    // A rod and bait at the nearest spot: the option wields the rod; a cast lands; wait for the bite.
    const started = await page.evaluate(() => {
        const g = window.game!;
        g.items.depositAll();
        g.setLevel("fishing", 99); // every roll bites, so the test does not wait long
        g.give("Fishing rod");
        g.give("Fishing bait", 5);
        const spot = g.fishingSpots.spots
            .filter((s: any) => s.plane === g.player.plane)
            .sort((a: any, b: any) => Math.hypot(a.x - g.player.x, a.y - g.player.y) - Math.hypot(b.x - g.player.x, b.y - g.player.y))[0];
        (window as any).__spot = spot;
        const handled = g.skillSystem.fishing.spotAction(spot, "Bait");
        g.skillSystem.update({ acted: false, panelOpen: false, dead: false, dt: 0.016, pointer: { pressed: true, down: true, aimed: spot } });
        return { handled, wielded: g.items.equipment.get("weapon")?.id, phase: g.skillSystem.active?.phase };
    });
    expect(started.handled).toBe(true);
    expect(started.wielded).toBe(307);
    expect(started.phase).toBe("cast");
    await page.waitForFunction(() => window.game!.skillSystem.active?.phase === "bite", undefined, { timeout: 90_000, polling: 100 });
    const hooked = await page.evaluate(() => {
        const g = window.game!;
        g.skillSystem.update({ acted: false, panelOpen: false, dead: false, dt: 0.016, pointer: { pressed: true, down: true, aimed: (window as any).__spot } });
        return g.skillSystem.active?.phase;
    });
    expect(hooked).toBe("reel");
    // The reel bar shows on the next frame.
    await page.waitForFunction(() => !document.querySelector("#fishing-bar")!.classList.contains("hidden"), undefined, { timeout: 30_000, polling: 100 });
    const reeled = await page.evaluate(() => {
        const g = window.game!;
        const spot = (window as any).__spot;
        const job = g.skillSystem.active;
        // Land it: keep the zone on the fish (as a player holding and letting go would).
        for (let i = 0; i < 200 && job.minigame; i++) {
            const m = job.minigame;
            m.zoneAt = Math.min(1 - m.zone, Math.max(0, m.fishAt - m.zone / 2));
            g.skillSystem.update({ acted: false, panelOpen: false, dead: false, dt: 0.05, pointer: { pressed: false, down: false, aimed: spot } });
        }
        // At level 99 bait brings herring as well as sardines.
        return g.items.count(g.db.byName("Raw sardine").id) + g.items.count(g.db.byName("Raw herring").id);
    });
    expect(reeled).toBe(1);

    // A small net scoops instead: no line, each scoop rolls; held down, it scoops until a fish comes up.
    const scooped = await page.evaluate(() => {
        const g = window.game!;
        const spot = (window as any).__spot;
        g.give("Small fishing net");
        g.skillSystem.fishing.spotAction(spot, "Small Net");
        const job = g.skillSystem.active;
        const stroke = job?.stroke;
        const shrimps = () => g.items.count(g.db.byName("Raw shrimps").id) + g.items.count(g.db.byName("Raw anchovies").id);
        for (let i = 0; i < 200 && shrimps() === 0 && g.skillSystem.active === job; i++) {
            g.skillSystem.update({ acted: false, panelOpen: false, dead: false, dt: 0.1, pointer: { pressed: false, down: true, aimed: spot } });
        }
        return { stroke, wielded: g.items.equipment.get("weapon")?.id, fish: shrimps(), xp: g.skills.xp("fishing") };
    });
    expect(scooped.stroke).toBe("scoop");
    expect(scooped.wielded).toBe(303);
    expect(scooped.fish).toBe(1);
    expect(scooped.xp).toBeGreaterThan(0);

    // Banking: deposit everything.
    const banked = await page.evaluate(() => {
        const g = window.game!;
        g.items.depositAll();
        return g.items.bank.count(g.db.byName("Raw shrimps").id) + g.items.bank.count(g.db.byName("Raw anchovies").id);
    });
    expect(banked).toBeGreaterThanOrEqual(1);
    expect(errors).toEqual([]);
});

test("a tree gives logs and a range cooks", async ({ page }) => {
    await start(page, 3192, 3230); // trees west of Lumbridge castle
    const hasSkillLocs = await page.evaluate(() => window.game!.skillLocs.all().length > 0);
    test.skip(!hasSkillLocs, "the map was exported without skill locs");

    const chopped = await page.evaluate(() => {
        const g = window.game!;
        g.give("Bronze axe");
        const tree = g.skillLocs
            .all()
            .filter((i: any) => i.loc.name === "Tree" && i.loc.plane === g.player.plane)
            .sort((a: any, b: any) => Math.hypot(a.loc.tileX - g.player.x, a.loc.tileY - g.player.y) - Math.hypot(b.loc.tileX - g.player.x, b.loc.tileY - g.player.y))[0];
        g.skillSystem.locAction(tree, "Chop down"); // wields the axe
        const wielded = g.items.equipment.get("weapon")?.id;
        // A click on the tree (as main.ts sends it) starts the chopping; held on the tree, the
        // strokes go on, and each blow rolls for a log.
        const started = g.skillSystem.clickLoc(tree, true);
        let motions = 0;
        for (let n = 0; n < 600 && g.items.count(1511) === 0 && g.skillSystem.active; n++) {
            g.skillSystem.update({ acted: false, panelOpen: false, dead: false, dt: 0.1, pointer: { pressed: false, down: true, aimed: tree } });
            if (g.skillSystem.toolMotion()?.kind === "chop") motions++;
        }
        return { wielded, started, motions, logs: g.items.count(1511) };
    });
    expect(chopped.wielded).toBe(1351);
    expect(chopped.started).toBe(true);
    expect(chopped.motions).toBeGreaterThan(0);
    const logs = chopped.logs;
    expect(logs).toBeGreaterThanOrEqual(1);

    await page.evaluate(() => window.game!.tp(3209, 3214, 0));
    await page.waitForFunction(() => window.game!.skillLocs.all().some((i: any) => /range/i.test(i.loc.name)), undefined, { timeout: 60_000, polling: 1000 });
    const cooked = await page.evaluate(() => {
        const g = window.game!;
        g.give("Raw shrimps");
        const range = g.skillLocs.all().find((i: any) => /range/i.test(i.loc.name));
        const slot = g.items.inventory.slots.findIndex((s: any) => s?.id === g.db.byName("Raw shrimps").id);
        g.skillSystem.useItemOnLoc(range, slot);
        document.querySelector<HTMLButtonElement>("#make-menu .choice-option")!.click();
        g.clock.advance(10);
        // Cooked or burnt (the burnt item has its own name, e.g. "Burnt fish").
        return g.items.inventory.slots.filter((st: any) => st && /^(shrimps|burnt .*)$/i.test(g.db.get(st.id)?.name)).length;
    });
    expect(cooked).toBe(1);
});
