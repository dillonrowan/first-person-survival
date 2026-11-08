import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { argosScreenshot } from "@argos-ci/playwright";

const fixtures = JSON.parse(
    readFileSync(new URL("./fixtures/npc-animation.json", import.meta.url), "utf8"),
) as Array<{
    id: number;
    idleFrames: number[];
    walkFrames: number[];
    attackFrames?: number[];
    yaws: number[];
}>;

declare global {
    interface Window {
        __NPC_VISUAL_TEST__?: {
            ready(): boolean;
            select(id: number): Promise<void>;
            setPose(pose: "idle" | "walk" | "attack"): void;
            setAttack(index: number): void;
            setFrame(frame: number): void;
            setYaw(degrees: number): void;
            advance(cycles: number): void;
            render(): void;
            frame(): number;
        };
    }
}

test.use({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 1 });

test("renders deterministic NPC idle frames", async ({ page }) => {
    await page.goto("/npc-animation-test.html");
    await expect(page.locator("[data-npc-visual-status]")).toHaveAttribute(
        "data-npc-visual-status",
        "ready",
        { timeout: 30_000 },
    );

    const fixture = fixtures[0];
    await page.evaluate(async (id) => {
        await window.__NPC_VISUAL_TEST__?.select(id);
    }, fixture.id);
    await page.evaluate(() => window.__NPC_VISUAL_TEST__?.render());

    await page.evaluate((frame) => window.__NPC_VISUAL_TEST__?.setFrame(frame), fixture.idleFrames[0]);
    await page.evaluate(() => window.__NPC_VISUAL_TEST__?.render());
    await expect.poll(() => page.evaluate(() => window.__NPC_VISUAL_TEST__?.frame())).toBe(
        fixture.idleFrames[0],
    );
    const firstFrame = await page.locator("canvas").screenshot();
    await argosScreenshot(page, "npc-5241-idle-frame-0", {
        element: page.locator("canvas"),
    });

    await page.evaluate((frame) => window.__NPC_VISUAL_TEST__?.setFrame(frame), fixture.idleFrames[1]);
    await page.evaluate(() => window.__NPC_VISUAL_TEST__?.render());
    await expect.poll(() => page.evaluate(() => window.__NPC_VISUAL_TEST__?.frame())).toBe(
        fixture.idleFrames[1],
    );
    const secondFrame = await page.locator("canvas").screenshot();

    const firstHash = createHash("sha256").update(firstFrame).digest("hex");
    const secondHash = createHash("sha256").update(secondFrame).digest("hex");
    expect(firstHash).not.toBe(secondHash);
    expect(firstFrame.length).toBeGreaterThan(1_000);
    await argosScreenshot(page, "npc-5241-idle-frame-45", {
        element: page.locator("canvas"),
    });
});

test("renders walk pose and facing changes", async ({ page }) => {
    await page.goto("/npc-animation-test.html");
    await page.locator("[data-npc-visual-status=ready]").waitFor({ timeout: 30_000 });
    const fixture = fixtures[0];
    await page.evaluate(async (id) => window.__NPC_VISUAL_TEST__?.select(id), fixture.id);
    await page.evaluate(() => window.__NPC_VISUAL_TEST__?.setPose("walk"));
    await page.evaluate((frame) => window.__NPC_VISUAL_TEST__?.setFrame(frame), fixture.walkFrames[1]);
    await page.evaluate((yaw) => window.__NPC_VISUAL_TEST__?.setYaw(yaw), fixture.yaws[0]);
    await page.evaluate(() => window.__NPC_VISUAL_TEST__?.render());
    const screenshot = await page.locator("canvas").screenshot();
    expect(screenshot.length).toBeGreaterThan(1_000);
    await argosScreenshot(page, "npc-5241-walk-frame-4-front", {
        element: page.locator("canvas"),
    });
});

test("renders Lumbridge guard attack frames", async ({ page }) => {
    await page.goto("/npc-animation-test.html");
    await page.locator("[data-npc-visual-status=ready]").waitFor({ timeout: 30_000 });
    const fixture = fixtures.find(({ id }) => id === 6709)!;
    await page.evaluate(async (id) => window.__NPC_VISUAL_TEST__?.select(id), fixture.id);
    await page.evaluate(() => window.__NPC_VISUAL_TEST__?.setPose("attack"));
    await page.evaluate(() => window.__NPC_VISUAL_TEST__?.setAttack(0));

    await page.evaluate((frame) => window.__NPC_VISUAL_TEST__?.setFrame(frame), fixture.attackFrames![0]);
    await page.evaluate(() => window.__NPC_VISUAL_TEST__?.render());
    await expect.poll(() => page.evaluate(() => window.__NPC_VISUAL_TEST__?.frame())).toBe(
        fixture.attackFrames![0],
    );
    await argosScreenshot(page, "npc-6709-attack-frame-4-windup", {
        element: page.locator("canvas"),
    });

    await page.evaluate((frame) => window.__NPC_VISUAL_TEST__?.setFrame(frame), fixture.attackFrames![1]);
    await page.evaluate(() => window.__NPC_VISUAL_TEST__?.render());
    await expect.poll(() => page.evaluate(() => window.__NPC_VISUAL_TEST__?.frame())).toBe(
        fixture.attackFrames![1],
    );
    await argosScreenshot(page, "npc-6709-attack-frame-8-impact", {
        element: page.locator("canvas"),
    });
});
