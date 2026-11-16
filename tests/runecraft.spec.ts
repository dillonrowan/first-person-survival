// End-to-end checks of the mysterious ruins and the world map, driven through the dev console.

import { expect, test } from "@playwright/test";

type Game = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

declare global {
    interface Window {
        game?: Game;
    }
}

test.setTimeout(480_000);
test.use({ launchOptions: { args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] } });

test("the air ruins name the talisman, then take the player to the altar; M shows the map", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/?x=2986&y=3288");
    await page.waitForFunction(() => !!window.game?.npcs && window.game.player.ready, undefined, { timeout: 180_000, polling: 1000 });

    const blocked = await page.evaluate(() => {
        const g = window.game!;
        g.items.depositAll();
        const ruins = g.skillLocs.near(0, 2985, 3292, 3).find((i: any) => i.loc.name === "Mysterious ruins");
        if (!ruins) return undefined;
        (window as any).__ruins = ruins;
        g.skillSystem.locAction(ruins, "Enter");
        return { actions: ruins.loc.actions, log: document.querySelector("#message-log")!.textContent };
    });
    expect(blocked?.actions).toEqual(["Enter"]);
    expect(blocked?.log).toContain("You need an air talisman to enter these ruins.");

    const arrived = await page.evaluate(() => {
        const g = window.game!;
        g.give("Air talisman");
        g.skillSystem.locAction((window as any).__ruins, "Enter");
        return { x: g.player.x, y: g.player.y, arrival: g.skillsData.runecraft.altars.find((a: any) => a.rune === "Air").arrival };
    });
    expect(Math.hypot(arrived.x - arrived.arrival.x, arrived.y - arrived.arrival.y)).toBeLessThan(6);

    await page.evaluate(() => window.game!.tp(2986, 3288));
    await page.keyboard.press("KeyM");
    await expect(page.locator("#world-map")).toBeVisible();
    await expect(page.locator(".world-map-legend")).toContainText("Air altar");
    await expect(page.locator(".world-map-status")).toContainText("You are at", { timeout: 180_000 });
    await page.screenshot({ path: "C:/Users/Dillon/AppData/Local/Temp/claude/fea7d02c7be8cc6e/28fc9a82-799d-4890-ac6c-5d56d1a87e43/scratchpad/world-map.png" });
    await page.keyboard.press("Escape");
    await expect(page.locator("#world-map")).toBeHidden();
    expect(errors).toEqual([]);
});
