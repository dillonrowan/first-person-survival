// Artisan recipes (Cooking, Smithing, Crafting, Fletching, Herblore), the facilities they use,
// firemaking logs, water filling and the sawmill.

import type { Chance, Facility, RecipeDef } from "../../../src/world/SkillFormat";
import type { Chart, Recipe } from "../fetch-wiki-skills";
import type { SkillsExportContext } from "./SkillContext";

/** Ticks per action when the wiki gives none. */
const DEFAULT_TICKS: Record<string, number> = { Smithing: 5, Crafting: 3, Fletching: 3, Herblore: 2, Cooking: 4, Firemaking: 4, Construction: 4, Runecraft: 1 };

/** Wiki facility (per skill) → this game's facility; anything else drops the recipe. */
function facilityOf(skill: string, facility: string | null): Facility | null | undefined {
    if (facility === null || facility === "") return null;
    const f = facility.toLowerCase();
    if (skill === "Cooking") return f === "cooking range" || f === "range" ? "range" : f === "fire" ? "fire" : undefined;
    if (f === "furnace") return "furnace";
    if (f === "anvil") return skill === "Smithing" ? "anvil" : undefined;
    if (f === "spinning wheel") return "spinning wheel";
    if (f === "potter's wheel") return "potter's wheel";
    if (f === "pottery oven") return "pottery oven";
    if (f === "loom") return "loom";
    if (f === "water") return "water";
    return undefined;
}

/** Cache loc names (and the action they need) of each facility. */
export const FACILITY_LOCS: [Facility, RegExp, RegExp][] = [
    ["furnace", /^(Furnace|Small furnace|Lava forge|Clay forge|Volcanic Furnace|Lovakite furnace|Ancient Furnace|Forge)$/i, /^(Smelt|Use)$/i],
    ["anvil", /^(Anvil|Barbarian anvil|Rusted anvil)$/i, /^(Smith|Use)$/i],
    ["range", /^(Range|Cooking range|Stove|Fancy range|Cooking stove|Oven|Clay oven|Simple stove|Cooker|Gnome cooker|Cooking pot)$/i, /^Cook$/i],
    ["fire", /^Fire$/i, /^Cook$/i],
    ["spinning wheel", /^Spinning wheel$/i, /^Spin$/i],
    ["potter's wheel", /^Potter's wheel$/i, /^(Form|Use)$/i],
    ["pottery oven", /^Pottery oven$/i, /^(Fire|Use)$/i],
    ["loom", /^Loom$/i, /^(Weave|Use)$/i],
    ["water", /^(Fountain|Well|Sink|Water pump|Waterpump|Water trough|Pump and drain)$/i, /.*/],
];

/** Every loc id per facility. Facilities need no action match when their name has none. */
export function facilityLocs(ctx: SkillsExportContext): Map<number, Facility> {
    const out = new Map<number, Facility>();
    for (const [facility, name, action] of FACILITY_LOCS) {
        for (const id of ctx.locsWhere((n, actions) => name.test(n) && (facility === "water" || actions.some((a) => action.test(a))))) {
            if (!out.has(id)) out.set(id, facility);
        }
    }
    out.set(26185, "fire");
    return out;
}

function burnChartSeries(charts: Chart[] | undefined, want: RegExp): Chance | undefined {
    const chart = charts?.[0];
    if (!chart) return undefined;
    const s = chart.series.find((x) => want.test(x.label)) ?? chart.series[0];
    return s && { low: s.low, high: s.high };
}

export function exportRecipes(ctx: SkillsExportContext, cookingCharts: Record<string, Chart[]>, fishCatches: Set<number>): RecipeDef[] {
    const out: RecipeDef[] = [];
    const skills = new Set(["Cooking", "Smithing", "Crafting", "Fletching", "Herblore"]);
    const seen = new Set<string>();
    const counts: Record<string, number> = {};
    for (const r of ctx.wiki.recipes) {
        const main = r.skills[0];
        if (!skills.has(main.skill)) continue;
        if (r.skills.some((s) => !skills.has(s.skill) && !/^(Magic|Ranged|Prayer)$/.test(s.skill) && s.skill !== main.skill)) continue;
        const facility = facilityOf(main.skill, r.facility);
        if (facility === undefined) continue;
        const def = toRecipe(ctx, r, facility, out.length);
        if (!def) continue;
        const key = JSON.stringify([def.materials, def.output, def.facility]);
        if (seen.has(key)) continue;
        seen.add(key);
        if (main.skill === "Cooking" && (facility === "range" || facility === "fire")) {
            const charts = cookingCharts[r.output.name] ?? cookingCharts[r.page];
            const range = burnChartSeries(charts, /range/i);
            const fire = burnChartSeries(charts, /fire/i);
            const burnt = burntItem(ctx, r, fishCatches);
            if (range && burnt !== undefined) def.burn = { chance: range, ...(fire ? { fireChance: fire } : {}), burnt };
        }
        if (main.skill === "Smithing" && r.output.name === "Iron bar" && facility === "furnace") {
            def.burn = { chance: { low: 128, high: 128 }, burnt: -1 };
        }
        def.verb = verbOf(main.skill, r, facility);
        out.push(def);
        counts[main.skill] = (counts[main.skill] ?? 0) + 1;
    }
    ctx.log(`recipes: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    return out;
}

function verbOf(skill: string, r: Recipe, facility: Facility | null): string | undefined {
    if (skill === "Herblore") return r.materials.length === 1 && /^Grimy /.test(r.materials[0].name) ? "clean" : "mix";
    if (skill === "Smithing") return facility === "furnace" ? "smelt" : "smith";
    if (skill === "Fletching") {
        if (r.materials.some((m) => m.name === "Bow string")) return "string";
        if (r.tools.some((t) => t.includes("Knife"))) return "cut";
    }
    if (skill === "Cooking") return "cook";
    return undefined;
}

export function toRecipe(ctx: SkillsExportContext, r: Recipe, facility: Facility | null, id: number): RecipeDef | undefined {
    const main = r.skills[0];
    const output = ctx.resolveItem(r.output.name);
    const materials = r.materials.map((m) => ({ item: ctx.resolveItem(m.name), qty: m.qty }));
    const tools = r.tools.map((alts) => alts.flatMap((n) => ctx.resolveItem(n) ?? []));
    if (output === undefined || materials.some((m) => m.item === undefined) || tools.some((t) => t.length === 0) || materials.length === 0) return undefined;
    return {
        id,
        skill: main.skill.toLowerCase(),
        level: main.level,
        xp: main.xp,
        ...(r.skills.length > 1 ? { extra: r.skills.slice(1).map((s) => ({ skill: s.skill.toLowerCase(), level: s.level, xp: s.xp })) } : {}),
        ticks: Math.max(1, r.ticks ?? DEFAULT_TICKS[main.skill] ?? 3),
        materials: materials as { item: number; qty: number }[],
        tools,
        facility,
        output: { item: output, qty: r.output.qty },
    };
}

/** The burnt version of a cooked item: "Burnt <name>", else a generic burnt food. */
function burntItem(ctx: SkillsExportContext, r: Recipe, fishCatches: Set<number>): number | undefined {
    const byName = (n: string) => ctx.items.find((i) => i.name.toLowerCase() === n.toLowerCase())?.id;
    const raw = r.materials[0] && ctx.resolveItem(r.materials[0].name);
    const fish = /^Raw /.test(r.materials[0]?.name ?? "") && raw !== undefined && fishCatches.has(raw);
    const names = [`Burnt ${r.output.name.toLowerCase()}`, ...(fish ? ["Burnt fish"] : []), "Burnt meat", "Burnt pie", "Burnt pizza", "Burnt cake", "Burnt bread"];
    for (const n of names) {
        const id = byName(n);
        if (id !== undefined) return id;
    }
    return undefined;
}

export function exportFiremaking(ctx: SkillsExportContext): { log: number; level: number; xp: number }[] {
    const out: { log: number; level: number; xp: number }[] = [];
    for (const row of ctx.wiki.calc.Firemaking ?? []) {
        const name = String(row.name ?? "");
        if (!/(logs|branches)$/i.test(name) || /pyre|special/i.test(String(row.type ?? ""))) continue;
        const log = ctx.resolveItem(name);
        if (log !== undefined && !out.some((o) => o.log === log)) out.push({ log, level: Number(row.level) || 1, xp: Number(row.xp) || 0 });
    }
    return out;
}

export function exportFills(ctx: SkillsExportContext): { from: number; to: number }[] {
    return [
        ["Vial", "Vial of water"],
        ["Bucket", "Bucket of water"],
        ["Jug", "Jug of water"],
    ].flatMap(([a, b]) => {
        const from = ctx.resolveItem(a);
        const to = ctx.resolveItem(b);
        return from === undefined || to === undefined ? [] : [{ from, to }];
    });
}

/** The sawmill operator's planks: logs and coins in, plank out, instantly. */
export function sawmillRecipes(ctx: SkillsExportContext, firstId: number): RecipeDef[] {
    const coins = 995;
    const rows: [string, number, string][] = [
        ["Logs", 100, "Plank"],
        ["Oak logs", 250, "Oak plank"],
        ["Teak logs", 500, "Teak plank"],
        ["Mahogany logs", 1500, "Mahogany plank"],
    ];
    return rows.flatMap(([logs, price, plank], i) => {
        const log = ctx.resolveItem(logs);
        const out = ctx.resolveItem(plank);
        if (log === undefined || out === undefined) return [];
        return [{ id: firstId + i, skill: "construction", level: 1, xp: 0, ticks: 1, materials: [{ item: log, qty: 1 }, { item: coins, qty: price }], tools: [], facility: "sawmill" as const, output: { item: out, qty: 1 } }];
    });
}
