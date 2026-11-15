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

/** Opens the game at a tile (each test has a fresh browser profile, so a fresh save). */
async function start(page: Page, x: number, y: number): Promise<void> {
    await page.goto(`/?x=${x}&y=${y}`);
    // Poll on a timer: headless rendering is slow enough to starve animation-frame polling.
    await page.waitForFunction(() => !!window.game?.npcs && window.game.player.ready, undefined, { timeout: 180_000, polling: 1000 });
}

/** Waits for NPCs with this name to stand near the player. */
async function nearestNpc(page: Page, pattern: string): Promise<void> {
    await page.waitForFunction(
        (p) => {
            const g = window.game!;
            return g.npcs.all().some((n: any) => new RegExp(p, "i").test(n.appearance.name) && !n.gone);
        },
        pattern,
        { timeout: 60_000, polling: 1000 },
    );
}

test("fishing and banking work", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await start(page, 3087, 3230); // Draynor's net and bait spots

    // Fishing: a small net on the nearest net spot.
    await nearestNpc(page, "^fishing spot$");
    const fished = await page.evaluate(() => {
        const g = window.game!;
        g.give("Small fishing net");
        const spot = g.npcs
            .all()
            .filter((n: any) => /^fishing spot$/i.test(n.appearance.name) && n.appearance.actions?.some((a: string) => /net/i.test(a)))
            .sort((a: any, b: any) => Math.hypot(a.body.x - g.player.x, a.body.y - g.player.y) - Math.hypot(b.body.x - g.player.x, b.body.y - g.player.y))[0];
        const action = spot.appearance.actions.find((a: string) => /net/i.test(a));
        const handled = g.skillSystem.npcAction(spot, action);
        // Casts with the crosshair on the spot, one per 2 ticks, until something bites.
        for (let i = 0; i < 40 && g.items.count(g.db.byName("Raw shrimps").id) === 0; i++) {
            g.skillSystem.click(spot);
            g.clock.advance(2);
        }
        const shrimp = g.db.byName("Raw shrimps").id;
        return { handled, shrimp: g.items.count(shrimp), xp: g.skills.xp("fishing") };
    });
    expect(fished.handled).toBe(true);
    expect(fished.shrimp).toBeGreaterThanOrEqual(1);
    expect(fished.xp).toBeGreaterThan(0);

    // Banking: deposit everything.
    const banked = await page.evaluate(() => {
        const g = window.game!;
        g.items.depositAll();
        return g.items.bank.count(g.db.byName("Raw shrimps").id);
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
        // Stand just south of the tree, facing it, and swing: quick strikes driven through combat.
        const loc = tree.loc;
        const cx = loc.tileX + loc.sizeX / 2;
        const cy = loc.tileY + loc.sizeY / 2;
        const swings: { stopped: boolean }[] = [];
        for (let n = 0; n < 60 && g.items.count(1511) === 0; n++) {
            g.player.x = cx;
            g.player.y = loc.tileY - 0.45;
            g.player.yaw = Math.atan2(-(cx - g.player.x), cy - g.player.y);
            g.player.pitch = -0.1;
            const input = (press: boolean) => ({ attackDown: press, attackPressed: press, blockDown: false, kickPressed: false, castPressed: false, forward: 0, strafe: 0 });
            g.combat.update(1 / 60, g.player, input(true));
            let frames = 0;
            while (g.combat.melee.swing && frames++ < 120) g.combat.update(1 / 60, g.player, input(false));
            swings.push({ stopped: frames < 120 });
            g.combat.update(0.5, g.player, input(false));
        }
        return { wielded, logs: g.items.count(1511), swings: swings.length };
    });
    expect(chopped.wielded).toBe(1351);
    expect(chopped.swings).toBeGreaterThan(0);
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
        // Several items share the name "Burnt shrimp", so match by name.
        return g.items.inventory.slots.filter((st: any) => st && /^(shrimps|burnt shrimp)$/i.test(g.db.get(st.id)?.name)).length;
    });
    expect(cooked).toBe(1);
});
