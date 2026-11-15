import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { Chart, Recipe, SkillDrop } from "./fetch-wiki-skills";
import type { PatchTable } from "./wiki/farmingSource";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "wiki");
const load = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8")) as T;

describe("committed wiki skill data", () => {
    it("has skilling loot", () => {
        const drops = load<SkillDrop[]>("drops.json");
        expect(drops.length).toBeGreaterThan(5000);
        expect(drops.find((d) => d.page === "Oak tree" && d.item === "Oak logs")).toMatchObject({ rarity: "Always", type: "woodcutting" });
    });

    it("has the bronze bar recipe", () => {
        const recipes = load<Recipe[]>("recipes.json");
        const bar = recipes.find((r) => r.output.name === "Bronze bar" && r.facility === "Furnace");
        expect(bar).toMatchObject({ skills: [{ skill: "Smithing", level: 1, xp: 6.2 }], ticks: 5 });
        expect(bar!.materials.map((m) => m.name)).toEqual(["Copper ore", "Tin ore"]);
    });

    it("has success charts", () => {
        const pages = load<{ pages: Record<string, { charts: Chart[] }> }>("skill-info.json").pages;
        expect(pages["Oak tree"].charts[0].series[0]).toMatchObject({ label: "Bronze", low: 32, high: 100 });
    });

    it("has RuneLite's herb patch states", () => {
        const farming = load<{ patches: PatchTable[] }>("farming.json");
        const herb = farming.patches.find((p) => p.impl === "HERB")!;
        expect(herb.ranges).toContainEqual({ from: 4, to: 7, produce: "GUAM", state: "GROWING", stageExpr: "value - 4" });
    });

    it("has every slayer master", () => {
        const masters = load<{ master: string; tasks: unknown[] }[]>("slayer-masters.json");
        expect(masters.map((m) => m.master).sort()).toEqual(
            ["chaeldar", "duradel", "konar", "krystilia", "mazchna", "mortimer", "nieve", "turael", "vannaka"],
        );
        for (const m of masters) expect(m.tasks.length).toBeGreaterThan(5);
    });
});

describe("parseLocLines", () => {
    it("reads every tile of main-map rows and skips instances", async () => {
        const { parseLocLines } = await import("./fetch-wiki-skills");
        const text = `{{ObjectLocLine
|name = Fishing spot (small net, bait)
|mapID = 0
|plane = 0
|x:3086,y:3227|x:3085,y:3230
}}
{{ObjectLocLine
|name = Rod Fishing spot (lure, bait)
|mapID = -1
|plane = 1
|x:3104,y:3424
}}
{{ObjectLocLine
|name = Rod Fishing spot (lure, bait)
|mapID = 41
|plane = 0
|x:3288,y:6010
}}`;
        expect(parseLocLines(text)).toEqual([
            { x: 3086, y: 3227, plane: 0 },
            { x: 3085, y: 3230, plane: 0 },
            { x: 3104, y: 3424, plane: 1 },
        ]);
    });
});
