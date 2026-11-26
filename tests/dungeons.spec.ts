// End-to-end checks of dungeon entrances: the Lumbridge cellar trapdoor and the closed Edgeville
// trapdoor, down and back up, driven through the dev console (window.game).

import { expect, test, type Page } from "@playwright/test";

type Game = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

declare global {
    interface Window {
        game?: Game;
    }
}

test.setTimeout(600_000);
test.use({ launchOptions: { args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] } });

const SHOTS = process.env.DUNGEON_SHOTS;

async function shot(page: Page, name: string) {
    if (!SHOTS) return;
    await page.addStyleTag({ content: "#overlay { display: none !important; }" });
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Runs an action on the entrance whose footprint starts at x, y, as pressing its key would. */
async function act(page: Page, x: number, y: number, action: string) {
    return page.evaluate(([x, y, action]) => {
        const g = window.game!;
        for (const region of g.interactives.regions.values()) {
            for (const [kind, list] of [["climb", region.climbs], ["passage", region.passages], ["hatch", region.hatches]] as const) {
                for (const item of list) {
                    const loc = item.loc ?? item;
                    if (loc.tileX === x && loc.tileY === y) {
                        g.interaction.onAction({ kind, label: loc.name, actions: [action], distance: 0, ref: item }, action, 0);
                        return { kind, name: loc.name, links: loc.links, open: item.open };
                    }
                }
            }
        }
        return undefined;
    }, [x, y, action] as const);
}

/** Waits until the player stands, loaded, on the far side of `y` and the fade has cleared. */
async function arrive(page: Page, below: boolean, y: number) {
    await page.waitForFunction(
        ([below, y]) => {
            const p = window.game!.player;
            const fade = Number(getComputedStyle(document.getElementById("fade")!).opacity);
            return p.ready && (below ? p.y > y : p.y < y) && fade < 0.05;
        },
        [below, y] as const,
        { timeout: 120_000, polling: 250 },
    );
}

/** The nearest entrance within `radius` of the player whose link leads back to the surface. */
async function exitNear(page: Page, radius: number) {
    return page.evaluate((radius) => {
        const g = window.game!;
        let best: { x: number; y: number; action: string; d: number } | undefined;
        for (const region of g.interactives.regions.values()) {
            for (const item of [...region.climbs, ...region.passages, ...region.hatches]) {
                const loc = item.loc ?? item;
                for (const link of loc.links ?? []) {
                    if (link.y >= 66 * 64) continue;
                    const d = Math.hypot(loc.tileX - g.player.x, loc.tileY - g.player.y);
                    if (d <= radius && (!best || d < best.d)) best = { x: loc.tileX, y: loc.tileY, action: link.action, d };
                }
            }
        }
        return best;
    }, radius);
}

const clearColour = (page: Page) =>
    page.evaluate(() => {
        let c = { r: 0, g: 0, b: 0 };
        window.game!.renderer.getClearColor({ copy: (v: typeof c) => (c = { r: v.r, g: v.g, b: v.b }) });
        return Math.max(c.r, c.g, c.b);
    });

test("the Lumbridge cellar trapdoor leads down and its ladder back up", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto("/?x=3210&y=3217");
    await page.waitForFunction(() => !!window.game?.player?.ready, undefined, { timeout: 180_000, polling: 1000 });
    const surfaceSky = await clearColour(page);
    await shot(page, "lumbridge-1-surface");

    const used = await act(page, 3209, 3216, "Climb-down");
    expect(used?.links?.[0]).toMatchObject({ x: 3210, y: 9616 });
    await page.waitForTimeout(150);
    await shot(page, "lumbridge-2-fading");
    await arrive(page, true, 9000).catch((e) => {
        throw new Error([String(e), ...errors].join(" | "));
    });
    await page.waitForTimeout(2000);
    await shot(page, "lumbridge-3-cellar");
    const below = await page.evaluate(() => ({ x: window.game!.player.x, y: window.game!.player.y, log: document.querySelector("#message-log")!.textContent }));
    expect(Math.hypot(below.x - 3210.5, below.y - 9616.5)).toBeLessThan(3);
    expect(below.log).toMatch(/You climb down into/);
    expect(await clearColour(page)).toBeLessThan(surfaceSky * 0.5);

    const exit = await exitNear(page, 10);
    expect(exit).toBeDefined();
    await act(page, exit!.x, exit!.y, exit!.action);
    await arrive(page, false, 4000);
    await page.waitForTimeout(2000);
    await shot(page, "lumbridge-4-back");
    const back = await page.evaluate(() => ({ x: window.game!.player.x, y: window.game!.player.y }));
    expect(Math.hypot(back.x - 3210, back.y - 3216)).toBeLessThan(5);
    expect(await clearColour(page)).toBeGreaterThan(surfaceSky * 0.8);
    expect(errors).toEqual([]);
});

/** Starts at a tile, uses the loc at (x, y) and waits until the player stands, loaded, near `to`. */
async function travel(page: Page, start: [number, number, number], loc: [number, number], action: string, to: [number, number], within = 12) {
    await page.goto(`/?x=${start[0]}&y=${start[1]}&plane=${start[2]}`);
    await page.waitForFunction(() => !!window.game?.player?.ready, undefined, { timeout: 180_000, polling: 1000 });
    const used = await act(page, loc[0], loc[1], action);
    expect(used, `a loc with ${action} at ${loc.join(",")}`).toBeDefined();
    await page.waitForFunction(
        ([x, y, within]) => {
            const p = window.game!.player;
            const fade = Number(getComputedStyle(document.getElementById("fade")!).opacity);
            return p.ready && Math.hypot(p.x - x, p.y - y) < within && fade < 0.05;
        },
        [to[0], to[1], within] as const,
        { timeout: 120_000, polling: 250 },
    );
    return page.evaluate(() => ({ x: window.game!.player.x, y: window.game!.player.y, plane: window.game!.player.plane }));
}

// Teleport-style ways between dungeon areas and into boss lairs and raids, from the Shortest Path
// lever and portal files and the hand-made links.
const WAYS: { name: string; start: [number, number, number]; loc: [number, number]; action: string; to: [number, number]; within?: number }[] = [
    { name: "the King Black Dragon lever", start: [3067, 10255, 0], loc: [3067, 10253], action: "Pull", to: [2271, 4680] },
    { name: "a Stronghold of Security portal", start: [1863, 5237, 0], loc: [1863, 5238], action: "Use", to: [1914, 5222] },
    { name: "Callisto's Den", start: [3291, 3847, 0], loc: [3291, 3849], action: "Enter", to: [3358, 10317] },
    { name: "Hunter's End", start: [3115, 3674, 0], loc: [3115, 3676], action: "Enter", to: [1758, 11533] },
    { name: "the Silk Chasm", start: [3321, 3792, 0], loc: [3321, 3794], action: "Enter", to: [3422, 10190] },
    { name: "the Theatre of Blood", start: [3678, 3214, 0], loc: [3678, 3216], action: "Enter", to: [3190, 4446] },
    { name: "the Tombs of Amascut", start: [3357, 9110, 0], loc: [3357, 9112], action: "Enter", to: [3548, 5163] },
    // The first Chambers of Xeric room: the link leads to its centre, the game to the nearest floor.
    { name: "the Chambers of Xeric", start: [1233, 3571, 0], loc: [1232, 3573], action: "Enter", to: [3280, 5136], within: 18 },
    { name: "Verzik Vitur's gate", start: [3168, 4321, 0], loc: [3166, 4328], action: "Enter", to: [3236, 4316] },
    { name: "Kraken Cove", start: [2278, 3609, 0], loc: [2277, 3611], action: "Enter", to: [2276, 9988] },
];
for (const way of WAYS) {
    test(`${way.name} leads where it should`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        const consoleErrors: string[] = [];
        page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
        const within = way.within ?? 12;
        const at = await travel(page, way.start, way.loc, way.action, way.to, within).catch(async (e) => {
            const where = await page.evaluate(() => ({ x: window.game?.player.x, y: window.game?.player.y, plane: window.game?.player.plane, log: document.querySelector("#message-log")?.textContent?.slice(-200) }));
            throw new Error([String(e), JSON.stringify(where), ...consoleErrors].join(" | "));
        });
        await shot(page, way.name.replace(/\W+/g, "-"));
        expect(Math.hypot(at.x - way.to[0], at.y - way.to[1])).toBeLessThan(within);
        expect(errors).toEqual([]);
    });
}

test("Scurrius' lair: in through the broken bars, he fights, out across the sewage water", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    // The Varrock Sewers corridor west of the bars, then the arena beyond them.
    const inside = await travel(page, [3280, 9867, 0], [3282, 9867], "Climb-through", [3291, 9867], 4);
    expect(inside.plane).toBe(0);
    await shot(page, "scurrius-1-arena");

    // He is aggressive: walking into the arena starts the fight.
    await page.waitForFunction(
        () => window.game!.npcs.all().some((n: any) => n.appearance.name === "Scurrius" && n.alerted && n.behaviour?.mode === "fighting"),
        undefined,
        { timeout: 60_000, polling: 250 },
    );
    await page.evaluate(() => {
        // Face him for the screenshot: the player looks along (-sin yaw, cos yaw).
        const g = window.game!;
        const s = g.npcs.all().find((n: any) => n.appearance.name === "Scurrius");
        g.player.yaw = Math.atan2(-(s.body.x - g.player.x), s.body.y - g.player.y);
    });
    await page.waitForTimeout(1500);
    await shot(page, "scurrius-2-fight");

    expect(await act(page, 3288, 9867, "Cross")).toBeDefined();
    // West, back past the bars into the sewer.
    await page.waitForFunction(
        () => {
            const p = window.game!.player;
            return p.ready && p.x < 3282 && Number(getComputedStyle(document.getElementById("fade")!).opacity) < 0.05;
        },
        undefined,
        { timeout: 120_000, polling: 250 },
    );
    const out = await page.evaluate(() => ({ x: window.game!.player.x, y: window.game!.player.y }));
    expect(Math.hypot(out.x - 3281, out.y - 9867)).toBeLessThan(4);
    expect(errors).toEqual([]);
});

test("Bryophyta's lair: in through her gate, she fights, out over the rock pile", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    // The Varrock Sewers south of her gate, then her chamber beyond it.
    const inside = await travel(page, [3174, 9898, 0], [3174, 9901], "Open", [3215, 9937], 4);
    expect(inside.plane).toBe(0);

    // She is aggressive: walking into the chamber starts the fight.
    await page.waitForFunction(
        () => window.game!.npcs.all().some((n: any) => n.appearance.name === "Bryophyta" && n.alerted && n.behaviour?.mode === "fighting"),
        undefined,
        { timeout: 60_000, polling: 250 },
    );
    await page.evaluate(() => {
        const g = window.game!;
        const b = g.npcs.all().find((n: any) => n.appearance.name === "Bryophyta");
        g.player.yaw = Math.atan2(-(b.body.x - g.player.x), b.body.y - g.player.y);
    });
    await page.waitForTimeout(1500);
    await shot(page, "bryophyta-fight");

    expect(await act(page, 3212, 9937, "Clamber")).toBeDefined();
    // South, back through the gate into the sewer.
    await page.waitForFunction(
        () => {
            const p = window.game!.player;
            return p.ready && p.y < 9901 && Number(getComputedStyle(document.getElementById("fade")!).opacity) < 0.05;
        },
        undefined,
        { timeout: 120_000, polling: 250 },
    );
    const out = await page.evaluate(() => ({ x: window.game!.player.x, y: window.game!.player.y }));
    expect(Math.hypot(out.x - 3174.5, out.y - 9899.5)).toBeLessThan(4);
    expect(errors).toEqual([]);
});

test("Obor's lair: in through his gate, down the rocks, he fights, back up and out", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    // The hill giants of the Edgeville Dungeon, east of his gate; then the safe zone beyond it.
    const inside = await travel(page, [3097, 9832, 0], [3095, 9832], "Open", [3091, 9814], 4);
    expect(inside.plane).toBe(0);
    await shot(page, "obor-1-safe-zone");
    // Nothing happens up here: he waits for a player in his arena.
    expect(await page.evaluate(() => window.game!.npcs.all().find((n: any) => n.appearance.name === "Obor")?.behaviour?.mode)).toBe("waiting");

    // Down the rocks into the arena: he is aggressive.
    expect(await act(page, 3091, 9806, "Climb")).toBeDefined();
    await arrive(page, false, 9805);
    await page.waitForFunction(
        () => window.game!.npcs.all().some((n: any) => n.appearance.name === "Obor" && n.alerted && n.behaviour?.mode === "fighting"),
        undefined,
        { timeout: 60_000, polling: 250 },
    );
    await page.evaluate(() => {
        const g = window.game!;
        const o = g.npcs.all().find((n: any) => n.appearance.name === "Obor");
        g.player.yaw = Math.atan2(-(o.body.x - g.player.x), o.body.y - g.player.y);
    });
    await page.waitForTimeout(1500);
    await shot(page, "obor-2-fight");

    // Back up the rocks: he gives up and heals; then out through the inner gate.
    expect(await act(page, 3091, 9805, "Climb")).toBeDefined();
    await arrive(page, true, 9807);
    expect(await page.evaluate(() => window.game!.npcs.all().find((n: any) => n.appearance.name === "Obor")?.behaviour?.mode)).toBe("waiting");
    expect(await act(page, 3091, 9815, "Quick-exit")).toBeDefined();
    await arrive(page, true, 9825);
    const out = await page.evaluate(() => ({ x: window.game!.player.x, y: window.game!.player.y }));
    expect(Math.hypot(out.x - 3096.5, out.y - 9832.5)).toBeLessThan(4);
    expect(errors).toEqual([]);
});

test("the King Black Dragon claws and breathes his four breaths, and dies with his own animation", async ({ page }) => {
    test.setTimeout(400_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/?x=2269&y=4689");
    await page.waitForFunction(
        () => !!window.game?.player?.ready && window.game.npcs.all().some((n: any) => n.appearance.name === "King Black Dragon"),
        undefined,
        { timeout: 180_000, polling: 1000 },
    );
    // Survive his breaths and note each one that reaches the player.
    await page.evaluate(() => {
        const g = window.game!;
        g.tuning.playerUnlimitedHealth = true;
        const w = window as any;
        w.__breaths = [];
        const struck = g.combat.onStruck;
        g.combat.onStruck = (r: any) => {
            if (r.breath) w.__breaths.push(r.breath.name);
            struck(r);
        };
        const kbd = g.npcs.all().find((n: any) => n.appearance.name === "King Black Dragon");
        g.player.yaw = Math.atan2(-(kbd.body.x - g.player.x), kbd.body.y - g.player.y);
    });
    // He is aggressive and breathes from range: wait for several breaths.
    await page.waitForFunction(() => (window as any).__breaths.length >= 6, undefined, { timeout: 240_000, polling: 500 });
    await shot(page, "kbd-fight");
    const seen = await page.evaluate(() => ({ breaths: [...new Set((window as any).__breaths)], log: document.querySelector("#message-log")?.textContent ?? "" }));
    expect(seen.breaths.length).toBeGreaterThan(1);
    expect(seen.breaths.every((b) => ["fiery", "toxic", "icy", "shocking"].includes(b as string))).toBe(true);
    expect(seen.log).toMatch(/dragon's (fiery|toxic|icy|shocking) breath/);

    // Killed, he plays his death animation instead of falling as a ragdoll.
    const death = await page.evaluate(async () => {
        const g = window.game!;
        const kbd = g.npcs.all().find((n: any) => n.appearance.name === "King Black Dragon");
        kbd.combatant.hurt(kbd.combatant.health, "flinch");
        await new Promise((r) => setTimeout(r, 1500));
        return { ragdoll: !!kbd.ragdoll, frame: kbd.visualAnimationFrame, steadfast: kbd.combatant.steadfast };
    });
    expect(death).toMatchObject({ ragdoll: false, steadfast: true });
    expect(death.frame).toBeGreaterThan(0);
    expect(errors).toEqual([]);
});

for (const bear of [
    { name: "Callisto", start: [3359, 10335] },
    { name: "Artio", start: [1759, 11551] },
] as const) {
    test(`${bear.name} swipes, fires crescents and knocks back, roars up bear traps, and dies with his own animation`, async ({ page }) => {
        test.setTimeout(400_000);
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.goto(`/?x=${bear.start[0]}&y=${bear.start[1]}`);
        await page.waitForFunction(
            (name) => !!window.game?.player?.ready && window.game.npcs.all().some((n: any) => n.appearance.name === name),
            bear.name,
            { timeout: 180_000, polling: 1000 },
        );
        // Survive the fight and note every strike that reaches the player.
        await page.evaluate((name) => {
            const g = window.game!;
            g.tuning.playerUnlimitedHealth = true;
            const w = window as any;
            w.__struck = [];
            const struck = g.combat.onStruck;
            g.combat.onStruck = (r: any) => {
                w.__struck.push({ style: r.style, damage: r.damage, knocked: r.knocked, missed: r.missed });
                struck(r);
            };
            const boss = g.npcs.all().find((n: any) => n.appearance.name === name);
            g.player.yaw = Math.atan2(-(boss.body.x - g.player.x), boss.body.y - g.player.y);
        }, bear.name);
        // Aggressive: crescents while the player is out of reach (kept so, at the den's far end from
        // the boss), and in time the knockback orb.
        await page.waitForFunction(
            (name) => {
                const g = window.game!;
                const s = (window as any).__struck as { style: string; knocked?: string }[];
                const boss = g.npcs.all().find((n: any) => n.appearance.name === name);
                const gap = Math.hypot(boss.body.x - g.player.x, boss.body.y - g.player.y) - boss.body.radius;
                if (!s.some((r) => r.style === "ranged") && gap < 3 && g.player.boundFor <= 0) {
                    const den = boss.behaviour.boss.arena;
                    const north = boss.body.y < (den.minY + den.maxY) / 2;
                    g.player.teleport((den.minX + den.maxX) / 2, north ? den.maxY - 1.5 : den.minY + 2.5, den.plane);
                }
                return s.some((r) => r.style === "ranged") && s.some((r) => r.style === "magic" && r.knocked);
            },
            bear.name,
            { timeout: 240_000, polling: 500 },
        );
        await shot(page, `${bear.name}-1-fight`);
        const knock = await page.evaluate(() => ((window as any).__struck as any[]).find((r) => r.style === "magic" && r.knocked));
        // 5, 20, 35 or 50 by how far the player flew [wiki].
        expect([5, 20, 35, 50]).toContain(knock.damage);

        // At 66% the boss roars and lays bear traps; one snaps shut on the player.
        await page.evaluate((name) => {
            const boss = window.game!.npcs.all().find((n: any) => n.appearance.name === name);
            boss.combatant.health = Math.floor(boss.combatant.maxHealth * 0.6);
        }, bear.name);
        await page.waitForFunction(
            (name) => {
                const boss = window.game!.npcs.all().find((n: any) => n.appearance.name === name);
                return boss.behaviour.roared.size === 1 && boss.behaviour.world.traps.traps.length > 0;
            },
            bear.name,
            { timeout: 60_000, polling: 100 },
        );
        await page.waitForTimeout(1000);
        await shot(page, `${bear.name}-2-traps`);
        const caught = await page.evaluate(async (name) => {
            const g = window.game!;
            const boss = g.npcs.all().find((n: any) => n.appearance.name === name);
            const trap = boss.behaviour.world.traps.traps[0];
            g.player.teleport(trap.x + 0.5, trap.y + 0.5, trap.plane);
            await new Promise((r) => setTimeout(r, 600));
            return { bound: g.player.boundFor, log: document.querySelector("#message-log")?.textContent ?? "" };
        }, bear.name);
        expect(caught.log).toMatch(/roars, and bear traps spring up/);
        expect(caught.log).toMatch(/caught in a bear trap/);
        expect(caught.bound).toBeGreaterThan(0);

        // His swipe once next to him: 35-55 for Callisto, 15-35 for Artio [wiki].
        await page.evaluate((name) => {
            const g = window.game!;
            const boss = g.npcs.all().find((n: any) => n.appearance.name === name);
            g.player.teleport(boss.body.x, boss.body.y + boss.body.radius + 0.6, boss.plane);
            g.player.yaw = Math.PI;
        }, bear.name);
        await page.waitForFunction(() => ((window as any).__struck as any[]).some((r) => r.style === "melee" && !r.missed), undefined, {
            timeout: 120_000,
            polling: 250,
        });
        const swipe = await page.evaluate(() => ((window as any).__struck as any[]).find((r) => r.style === "melee" && !r.missed));
        expect(swipe.damage).toBeGreaterThanOrEqual(bear.name === "Callisto" ? 35 : 15);

        // Killed, the boss plays the death animation, and the traps go.
        const death = await page.evaluate(async (name) => {
            const g = window.game!;
            const boss = g.npcs.all().find((n: any) => n.appearance.name === name);
            boss.combatant.hurt(boss.combatant.health, "flinch");
            await new Promise((r) => setTimeout(r, 1500));
            return { ragdoll: !!boss.ragdoll, frame: boss.visualAnimationFrame, traps: boss.behaviour.world.traps.traps.length };
        }, bear.name);
        expect(death).toMatchObject({ ragdoll: false, traps: 0 });
        expect(death.frame).toBeGreaterThan(0);
        expect(errors).toEqual([]);
    });
}

for (const boss of [
    { name: "Obor", start: [3088, 9799], chest: [3085, 9797], key: "Giant key" },
    { name: "Bryophyta", start: [3226, 9934], chest: [3229, 9934], key: "Mossy key" },
] as const) {
    test(`${boss.name}'s chest opens once per kill, with the key, and drops its loot`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.goto(`/?x=${boss.start[0]}&y=${boss.start[1]}`);
        await page.waitForFunction(
            ([x, y, name]) => {
                const g = window.game;
                return (
                    !!g?.player?.ready &&
                    g.skillLocs.all().some((s: any) => s.loc.tileX === x && s.loc.tileY === y) &&
                    g.npcs.all().some((n: any) => n.appearance.name === name)
                );
            },
            [...boss.chest, boss.name] as const,
            { timeout: 180_000, polling: 1000 },
        );
        const open = () =>
            page.evaluate(
                ([x, y]) => {
                    const g = window.game!;
                    const chest = g.skillLocs.all().find((s: any) => s.loc.tileX === x && s.loc.tileY === y);
                    const before = g.groundItems.count;
                    g.skillSystem.locAction(chest, "Open");
                    return { dropped: g.groundItems.count - before, message: document.querySelector("#message-log")?.textContent?.slice(-120) };
                },
                boss.chest,
            );
        const keys = () => page.evaluate((key) => window.game!.items.count(window.game!.db.byName(key).id), boss.key);

        await page.evaluate((key) => window.game!.give(key), boss.key);
        // Not before the boss is dead.
        expect((await open()).dropped).toBe(0);
        expect(await keys()).toBe(1);

        await page.evaluate((name) => {
            const b = window.game!.npcs.all().find((n: any) => n.appearance.name === name);
            b.combatant.hurt(b.combatant.health, "flinch");
        }, boss.name);
        await page.waitForTimeout(500);
        const looted = await open();
        expect(looted.dropped).toBeGreaterThan(0);
        expect(await keys()).toBe(0);
        await shot(page, `${boss.name.toLowerCase()}-chest`);

        // Once per kill.
        await page.evaluate((key) => window.game!.give(key), boss.key);
        expect((await open()).dropped).toBe(0);
        expect(await keys()).toBe(1);
        expect(errors).toEqual([]);
    });
}

test("the world map shows the dungeon the player is in, and the surface from it", async ({ page }) => {
    await page.goto("/?x=3210&y=9617");
    await page.waitForFunction(() => !!window.game?.player?.ready, undefined, { timeout: 180_000, polling: 1000 });
    await page.evaluate(() => window.game!.worldMap.open());
    await expect(page.locator("#world-map strong")).toHaveText("Lumbridge Castle cellar", { timeout: 30_000 });
    await shot(page, "map-dungeon");
    await page.getByRole("button", { name: "Surface" }).click();
    await expect(page.locator("#world-map strong")).toHaveText("World map");
    await shot(page, "map-surface");
});

test("the Edgeville trapdoor opens, then leads down", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/?x=3097&y=3467");
    await page.waitForFunction(() => !!window.game?.player?.ready, undefined, { timeout: 180_000, polling: 1000 });
    await shot(page, "edgeville-1-closed");

    // A closed hatch only offers Open; Climb-down comes once it is open.
    const opened = await act(page, 3097, 3468, "Open");
    expect(opened?.kind).toBe("hatch");
    const isOpen = await page.evaluate(() => window.game!.interactives.allHatches().find((h: any) => h.loc.tileX === 3097 && h.loc.tileY === 3468)?.open);
    expect(isOpen).toBe(true);
    await shot(page, "edgeville-2-open");

    await act(page, 3097, 3468, "Climb-down");
    await arrive(page, true, 9000);
    await page.waitForTimeout(2000);
    await shot(page, "edgeville-3-dungeon");
    const below = await page.evaluate(() => ({ y: window.game!.player.y, plane: window.game!.player.plane }));
    expect(below.y).toBeGreaterThan(9800);

    const exit = await exitNear(page, 12);
    expect(exit).toBeDefined();
    await act(page, exit!.x, exit!.y, exit!.action);
    await arrive(page, false, 4000);
    await shot(page, "edgeville-4-back");
    expect(errors).toEqual([]);
});
