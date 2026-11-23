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
    await page.goto("/?x=3210&y=3217");
    await page.waitForFunction(() => !!window.game?.player?.ready, undefined, { timeout: 180_000, polling: 1000 });
    const surfaceSky = await clearColour(page);
    await shot(page, "lumbridge-1-surface");

    const used = await act(page, 3209, 3216, "Climb-down");
    expect(used?.links?.[0]).toMatchObject({ x: 3210, y: 9616 });
    await page.waitForTimeout(150);
    await shot(page, "lumbridge-2-fading");
    await arrive(page, true, 9000);
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
