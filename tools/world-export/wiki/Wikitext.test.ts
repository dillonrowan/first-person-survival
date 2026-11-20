import { describe, expect, it } from "vitest";

import { parseLuaTable } from "./Lua";
import { evalStage } from "./farmingSource";
import { findTemplates, mapCoords, stripLinks } from "./Wikitext";
import { parseSeconds, parseSlayerMasters } from "../fetch-wiki-skills";

describe("findTemplates", () => {
    it("reads named parameters", () => {
        const t = findTemplates("{{Mining info\n|name = Copper rocks\n|level = 1\n|time = 2.4 seconds\n}}", "mining_info");
        expect(t).toEqual([{ name: "Copper rocks", level: "1", time: "2.4 seconds" }]);
    });
    it("keeps nested templates intact", () => {
        const t = findTemplates("{{Fishing info|tool = {{plink|Fishing rod}}<br />OR<br />{{plink|Pearl fishing rod}}|bait=x}}", "Fishing info");
        expect(t[0].tool).toBe("{{plink|Fishing rod}}<br />OR<br />{{plink|Pearl fishing rod}}");
        expect(t[0].bait).toBe("x");
    });
});

describe("mapCoords", () => {
    it("reads the three formats", () => {
        expect(mapCoords("{{Map|x=2474|y=3435|plane=1|mapID=0}}")).toEqual({ x: 2474, y: 3435, plane: 1 });
        expect(mapCoords("{{Map|2984,3291|mtype=pin}}")).toEqual({ x: 2984, y: 3291, plane: 0 });
        expect(mapCoords("{{Map|mtype=pin|x = 2843|y = 4833|mapID=-1}}")).toEqual({ x: 2843, y: 4833, plane: 0 });
    });
});

describe("stripLinks", () => {
    it("unwraps links and drops markup", () => {
        expect(stripLinks("[[Goblin]]s")).toBe("Goblins");
        expect(stripLinks("[[Wolf|Wolves]]<ref>x</ref>")).toBe("Wolves");
    });
});

describe("parseLuaTable", () => {
    it("reads calc rows and nested arrays", () => {
        const v = parseLuaTable(`return {
	{   -- first
    	name = 'Logs',
        level = 1,
        xp = 25,
        members = 'No',
        type = 'Regular'
    }, {
        name = "Bob\\'s",
        materials = {{ name = 'Fishing bait', quantity = 1 }},
        [SlayerConsts.X] = true,
    }
}`) as Record<string, unknown>[];
        expect(v[0]).toEqual({ name: "Logs", level: 1, xp: 25, members: "No", type: "Regular" });
        expect(v[1].materials).toEqual([{ name: "Fishing bait", quantity: 1 }]);
        expect(v[1]["SlayerConsts.X"]).toBe(true);
    });
});

describe("parseSeconds", () => {
    it("reads wiki times", () => {
        expect(parseSeconds("2.4 seconds")).toBe(2.4);
        expect(parseSeconds("1 minute, 54 seconds")).toBe(114);
        expect(parseSeconds("12 minutes<br/>6 minutes (members)")).toBe(720);
        expect(parseSeconds("45 ticks")).toBeCloseTo(27);
        expect(parseSeconds("4.8s")).toBe(4.8);
    });
});

describe("slayer masters", () => {
    it("reads task lines", () => {
        const m = parseSlayerMasters(`local turael = {
[SlayerConsts.TASK_BANSHEES] = { name = "[[Banshee]]s", requirements = {Slayer = 15, Combat = 20}, weight = 8},
[SlayerConsts.TASK_BATS] = { name = "[[Bat]]s", requirements = {Combat = 5}, weight = 7},
}`);
        expect(m).toEqual([{ master: "turael", tasks: [{ category: "Banshees", weight: 8, slayerLevel: 15 }, { category: "Bats", weight: 7, slayerLevel: 1 }] }]);
    });
});

describe("evalStage", () => {
    it("evaluates RuneLite stage expressions", () => {
        expect(evalStage("value - 4", 6)).toBe(2);
        expect(evalStage("10 - value", 9)).toBe(1);
        expect(evalStage("3", 0)).toBe(3);
    });
});
