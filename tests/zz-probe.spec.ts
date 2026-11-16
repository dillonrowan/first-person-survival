import { test } from "@playwright/test";

test.setTimeout(400_000);
test.use({ launchOptions: { args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] } });

test("probe fire and strokes", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(m.text()));
    await page.goto(`http://127.0.0.1:4174/?x=3222&y=3240`);
    await page.waitForFunction(() => !!(window as any).game?.npcs && (window as any).game.player.ready, undefined, { timeout: 180_000, polling: 1000 });
    page.on("close", () => console.log(errors.join(" | ")));
    await page.addStyleTag({ content: "#overlay{display:none!important}" });
    await page.waitForTimeout(100);
    try { await page.evaluate(async () => {
        const g = (window as any).game;
        g.give("Tinderbox");
        g.give("Logs");
        const slot = g.items.inventory.slots.findIndex((s: any) => s?.id === 1511);
        g.skillSystem.itemOption(slot, "Light");
        let fire;
        for (let i = 0; i < 40 && !fire; i++) {
            await new Promise((r) => setTimeout(r, 500));
            fire = g.skillLocs.all().find((i: any) => i.loc.name === "Fire");
        }
        if (!fire) {
            const r = await fetch("/world/skill-models/loc-26185.bin");
            let err = "";
            try {
                const mod = await import("/src/skills/SkillsSetup.ts" as any);
                err = Object.keys(mod).join(",");
            } catch (e) { err = String(e); }
            throw new Error("no fire: " + g.items.count(1511) + " tinder " + g.items.count(590) + " fetch " + r.status + " " + r.headers.get("content-type") + " " + err + " log " + [...document.querySelectorAll("#message-log *")].slice(-4).map((e) => e.textContent).join(" / "));
        }
        g.player.x = fire.loc.tileX + 0.5;
        g.player.y = fire.loc.tileY - 1.1;
        g.player.yaw = 0;
        g.player.pitch = -0.45;
    }); } finally { console.log("ERRORS", errors.join(" | ")); }
    for (let k = 0; k < 3; k++) {
        await page.waitForTimeout(170);
        await page.screenshot({ path: `test-results/fire-${k}.png` });
    }
    for (const [tool, kind] of [["Bronze axe", "chop"], ["Bronze pickaxe", "mine"]] as const) {
        await page.evaluate((tool) => {
            const g = (window as any).game;
            g.give(tool);
            const slot = g.items.inventory.slots.findIndex((s: any) => s && g.db.get(s.id)?.name === tool);
            g.items.wield(slot);
            g.player.pitch = 0;
        }, tool);
        await page.waitForTimeout(3000);
        for (const t of [0, 0.38, 0.46, 0.55, 0.8]) {
            await page.evaluate(([kind, t]) => {
                (window as any).game.skillSystem.toolMotion = () => ({ kind, t });
            }, [kind, t] as const);
            await page.waitForTimeout(300);
            await page.screenshot({ path: `test-results/${kind}-${t}.png` });
        }
        await page.evaluate(() => delete (window as any).game.skillSystem.toolMotion);
    }
    console.log(errors.join("\n"));
});
