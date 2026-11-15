// Woodcutting trees, mining rocks, fishing spots and the axe and pickaxe tables.

import type { AxeDef, AxeTier, Chance, FishingSpotDef, PickaxeDef, RockDef, TreeDef } from "../../../src/world/SkillFormat";
import { parseSeconds } from "../fetch-wiki-skills";
import { stripLinks } from "../wiki/Wikitext";
import { SkillsExportContext, num, toolNames } from "./SkillContext";

const TICK = 0.6;
const ticks = (seconds: number | undefined, fallback: number) => (seconds === undefined ? fallback : Math.max(1, Math.round(seconds / TICK)));

/** Axes and pickaxes: name, level, tier or ticks per roll [wiki: Axe, Pickaxe, Mining]. */
const AXES: [string, number, AxeTier][] = [
    ["Bronze axe", 1, "bronze"],
    ["Iron axe", 1, "iron"],
    ["Steel axe", 6, "steel"],
    ["Black axe", 11, "black"],
    ["Mithril axe", 21, "mithril"],
    ["Adamant axe", 31, "adamant"],
    ["Rune axe", 41, "rune"],
    ["Dragon axe", 61, "dragon"],
    ["3rd age axe", 61, "dragon"],
    ["Infernal axe", 61, "dragon"],
    ["Crystal axe", 71, "crystal"],
];
const PICKAXES: [string, number, number, number][] = [
    ["Bronze pickaxe", 1, 8, 0],
    ["Iron pickaxe", 1, 7, 0],
    ["Steel pickaxe", 6, 6, 0],
    ["Black pickaxe", 11, 5, 0],
    ["Mithril pickaxe", 21, 5, 0],
    ["Adamant pickaxe", 31, 4, 0],
    ["Rune pickaxe", 41, 3, 0],
    ["Dragon pickaxe", 61, 3, 1 / 6],
    ["3rd age pickaxe", 61, 3, 1 / 6],
    ["Infernal pickaxe", 61, 3, 1 / 6],
    ["Crystal pickaxe", 71, 3, 1 / 4],
];

export function exportTools(ctx: SkillsExportContext): { axes: AxeDef[]; pickaxes: PickaxeDef[] } {
    return {
        axes: AXES.flatMap(([name, level, tier]) => {
            const item = ctx.resolveItem(name);
            return item === undefined ? [] : [{ item, level, tier }];
        }),
        pickaxes: PICKAXES.flatMap(([name, level, t, fastChance]) => {
            const item = ctx.resolveItem(name);
            return item === undefined ? [] : [{ item, level, ticks: t, fastChance }];
        }),
    };
}

/** Despawn ticks and stump loc per tree page [wiki: Woodcutting; Appendix D]; null despawn: 1/8 per log. */
const TREE_TABLE: Record<string, [number | null, number]> = {
    Tree: [null, 1342],
    "Dead tree": [null, 1342],
    "Evergreen tree": [null, 1342],
    "Dying tree": [null, 1342],
    "Burnt tree": [null, 1342],
    "Windswept tree": [null, 1342],
    "Achey Tree": [null, 3371],
    "Jungle tree": [null, 4819],
    "Oak tree": [45, 1356],
    "Willow tree": [50, 9711],
    "Teak tree": [50, 9037],
    "Maple tree": [100, 9712],
    "Hollow tree": [60, 1342],
    "Mahogany tree": [100, 9035],
    "Arctic pine tree": [140, 1342],
    "Yew tree": [190, 9714],
    "Camphor tree": [200, 1342],
    "Magic tree": [390, 9713],
    "Ironwood tree": [400, 1342],
    "Redwood tree": [440, 1342],
    "Rosewood tree": [458, 1342],
    "Mature juniper tree": [null, 1342],
};

const CHOP = /^chop[ -]?(down)?$/i;

export function exportTrees(ctx: SkillsExportContext): TreeDef[] {
    const out: TreeDef[] = [];
    for (const [page, data] of Object.entries(ctx.wiki.pages)) {
        const info = data.templates.find((t) => t.name === "Woodcutting info")?.params;
        if (!info) continue;
        const chart = data.charts[0];
        const loot = ctx.lootOf(page, "woodcutting");
        const level = num(info.level, 1);
        // Pages without an "Always" log row: the regular log of the highest calculator level reached.
        const calcLogs = (ctx.wiki.calc.Woodcutting ?? [])
            .filter((r) => r.type === "Regular" && Number(r.level) <= level && /logs$/i.test(String(r.name)))
            .sort((a, b) => Number(b.level) - Number(a.level))[0];
        const logs = loot.find((l) => l.p === 1)?.item ?? (calcLogs ? ctx.resolveItem(String(calcLogs.name)) : undefined);
        if (!chart || logs === undefined) {
            ctx.log(`woodcutting: skipped ${page} (${!chart ? "no chart" : "no logs"})`);
            continue;
        }
        const chances: Partial<Record<AxeTier, Chance>> = {};
        for (const s of chart.series) {
            const tier = s.label.toLowerCase().split(/\s+/)[0] as AxeTier;
            if (AXES.some((a) => a[2] === tier)) chances[tier] = { low: s.low, high: s.high };
        }
        const name = (info.name ?? page).trim();
        const locIds = new Set(ctx.pageLocIds(page));
        for (const id of ctx.locsWhere((n, actions) => n.toLowerCase() === name.toLowerCase() && actions.some((a) => CHOP.test(a)))) locIds.add(id);
        const [despawn, stump] = TREE_TABLE[page] ?? [null, 1342];
        out.push({
            name,
            locIds: [...locIds].filter((id) => ctx.locs[id].actions.some((a) => CHOP.test(a))).sort((a, b) => a - b),
            level,
            xp: num(info.xp),
            logs,
            respawnTicks: ticks(parseSeconds(info.time ?? ""), 10),
            despawnTicks: despawn,
            depleteChance: page === "Mature juniper tree" ? 1 / 16 : 1 / 8,
            chances,
            stumpLocId: stump,
            extraLoot: loot.filter((l) => l.item !== logs),
        });
    }
    // Pages with the same tree (versions, farming pages) share one entry.
    const byName = new Map<string, TreeDef>();
    for (const t of out) {
        const same = byName.get(t.name.toLowerCase());
        if (same) same.locIds = [...new Set([...same.locIds, ...t.locIds])].sort((a, b) => a - b);
        else byName.set(t.name.toLowerCase(), t);
    }
    return [...byName.values()].filter((t) => t.locIds.length > 0);
}

export function exportRocks(ctx: SkillsExportContext): RockDef[] {
    // Empty rocks: plain "Rocks" with a Mine action and no recolouring, by model.
    const emptyByModels = new Map<string, number>();
    for (let id = 0; id < ctx.locs.length; id++) {
        if (ctx.locs[id].name !== "Rocks" || !ctx.locs[id].actions.includes("Mine")) continue;
        const t = ctx.loaders.locTypeLoader.load(id);
        if (t.recolorTo?.length) continue;
        const key = JSON.stringify(t.models);
        if (!emptyByModels.has(key)) emptyByModels.set(key, id);
    }
    const out: RockDef[] = [];
    for (const [page, data] of Object.entries(ctx.wiki.pages)) {
        const info = data.templates.find((t) => t.name === "Mining info")?.params;
        if (!info) continue;
        const loot = ctx.lootOf(page, "mining");
        const ore = loot.find((l) => l.p === 1)?.item;
        const chart = data.charts[0]?.series[0];
        const locIds = ctx.pageLocIds(page).filter((id) => ctx.locs[id].actions.includes("Mine"));
        if (ore === undefined || !chart || locIds.length === 0) {
            ctx.log(`mining: skipped ${page} (${ore === undefined ? "no ore" : !chart ? "no chart" : "no locs"})`);
            continue;
        }
        const first = ctx.loaders.locTypeLoader.load(locIds[0]);
        const empty = emptyByModels.get(JSON.stringify(first.models));
        out.push({
            name: (info.name ?? page).trim(),
            locIds,
            level: num(info.level, 1),
            xp: num(info.xp),
            ore,
            respawnTicks: ticks(parseSeconds(info.time ?? ""), 4),
            chance: { low: chart.low, high: chart.high },
            depletedLocId: empty ?? 1_000_000 + locIds[0],
        });
    }
    // Rune essence: never depletes; pure essence from level 30.
    const rune = ctx.resolveItem("Rune essence");
    const pure = ctx.resolveItem("Pure essence");
    const essenceLocs = ctx.locsWhere((n, a) => /^(rune )?essence$/i.test(n) && a.includes("Mine"));
    if (rune !== undefined && pure !== undefined && essenceLocs.length > 0) {
        out.push({
            name: "Rune Essence",
            locIds: essenceLocs,
            level: 1,
            xp: 5,
            ore: rune,
            respawnTicks: 1,
            chance: { low: 256, high: 256 },
            depletedLocId: essenceLocs[0],
            essence: { rune, pure, pureLevel: 30 },
        });
    }
    return out;
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, "");
/** Which NPC action a tool means when the block names no action. */
const TOOL_ACTION: [RegExp, string[]][] = [
    [/big fishing net/i, ["bignet"]],
    [/fishing net|small net/i, ["smallnet", "net"]],
    [/lobster pot/i, ["cage"]],
    [/harpoon/i, ["harpoon"]],
    [/fly fishing rod/i, ["lure"]],
    [/rod/i, ["bait", "lure"]],
];

type Catch = FishingSpotDef["catches"][number];

/** XP of a catch from the Fishing calculator, by item. */
function calcXp(ctx: SkillsExportContext, item: number): number | undefined {
    const row = (ctx.wiki.calc.Fishing ?? []).find((r) => {
        const name = String(r.name ?? "");
        return ctx.resolveItem(name) === item || ctx.resolveItem(`Raw ${name.toLowerCase()}`) === item;
    });
    return row ? Number(row.xp) || 0 : undefined;
}

/**
 * What a fishing block catches. A block with several levels names each catch; a block with one
 * level takes the catches from the chart starting at that level (the wiki then gives "Varies" XP).
 * A chart whose series are tools (harpoon, dragon harpoon…) is one catch: the block's sure drop.
 */
function blockCatches(
    ctx: SkillsExportContext,
    page: string,
    p: Record<string, string>,
    levels: number[],
    versions: string[],
    tools: string[],
): Catch[] {
    const charts = ctx.wiki.pages[page].charts;
    const toolIds = new Set(tools.flatMap((n) => ctx.resolveItem(n) ?? []));
    const isTool = (image: string) => {
        const id = ctx.resolveItem(image.replace(/\.png$/i, ""));
        return id !== undefined && (toolIds.has(id) || /harpoon|rod|net|pot$/i.test(image.replace(/\.png$/i, "")));
    };
    if (levels.length > 1) {
        const chart = charts
            .filter((c) => levels.every((l) => c.series.some((s) => s.req === l)))
            .sort((x, y) => x.series.length - y.series.length)[0];
        return levels.flatMap((level, k) => {
            const version = versions[k];
            const fits = chart?.series.filter((s) => s.req === level) ?? [];
            const s = fits.find((x) => version && x.image.toLowerCase().includes(version.toLowerCase())) ?? fits[0];
            const item =
                (s && ctx.resolveItem(s.image.replace(/\.png$/i, ""))) ??
                (version ? ctx.resolveItem(`Raw ${version.toLowerCase()}`) ?? ctx.resolveItem(version) : undefined);
            if (item === undefined) return [];
            // No chart: a middling curve. [design]
            const chance = s ? { low: s.low, high: s.high } : { low: 48, high: 256 };
            return [{ item, level, xp: num(p[`xp${k + 1}`] ?? p.xp), chance }];
        });
    }
    const level = levels[0];
    const chart = charts.find((c) => c.series.length > 0 && Math.min(...c.series.map((s) => s.req)) === level);
    const sure = ctx.lootOf(page, "fishing", p.dropversion).find((l) => l.p === 1)?.item ?? ctx.lootOf(page, "fishing").find((l) => l.p === 1)?.item;
    if (!chart || chart.series.every((s) => isTool(s.image))) {
        if (sure === undefined) return [];
        const s = chart?.series[0];
        return [{ item: sure, level, xp: /\d/.test(p.xp ?? "") ? num(p.xp) : calcXp(ctx, sure) ?? 0, chance: s ? { low: s.low, high: s.high } : { low: 48, high: 256 } }];
    }
    return chart.series.flatMap((s) => {
        const item = ctx.resolveItem(s.image.replace(/\.png$/i, ""));
        if (item === undefined || isTool(s.image)) return [];
        const xp = calcXp(ctx, item) ?? (s.req === level && /\d/.test(p.xp ?? "") ? num(p.xp) : 0);
        return [{ item, level: s.req, xp, chance: { low: s.low, high: s.high } }];
    });
}

export function exportFishing(ctx: SkillsExportContext): FishingSpotDef[] {
    const out: FishingSpotDef[] = [];
    const spots = ctx.spawned.filter((a) => /fishing spot/i.test(a.name));
    for (const [page, data] of Object.entries(ctx.wiki.pages)) {
        if (!data.infobox || !/fishing spot/i.test(page)) continue;
        const ids = new Set(data.infobox.ids);
        const pageSpots = spots.filter((s) => ids.has(s.id));
        if (pageSpots.length === 0) continue;
        for (const t of data.templates) {
            if (t.name !== "Fishing info") continue;
            const p = t.params;
            const actions = [...new Set(pageSpots.flatMap((s) => s.actions ?? []))];
            const tools = toolNames(p.tool ?? "");
            let action = actions.find((a) => normalize(a) === normalize(p.dropversion ?? ""));
            if (!action) {
                const wanted = TOOL_ACTION.find(([re]) => tools.some((n) => re.test(n)))?.[1] ?? [];
                action = actions.find((a) => wanted.includes(normalize(a)));
            }
            const levels: number[] = [];
            const versions: string[] = [];
            for (let n = 1; p[`level${n}`] !== undefined; n++) {
                levels.push(num(p[`level${n}`]));
                versions.push(stripLinks(p[`version${n}`] ?? ""));
            }
            if (levels.length === 0 && p.level !== undefined) {
                levels.push(num(p.level));
                versions.push(stripLinks(p.version ?? ""));
            }
            if (!action || levels.length === 0) {
                ctx.log(`fishing: skipped ${page} / ${p.dropversion ?? "?"} (${!action ? "no action" : "no levels"})`);
                continue;
            }
            const catches = blockCatches(ctx, page, p, levels, versions, tools);
            const toolIds = tools.flatMap((n) => {
                const id = ctx.resolveItem(n);
                return id === undefined ? [] : [id];
            });
            const harpoons = /harpoon/i.test(tools.join()) ? ["Dragon harpoon", "Infernal harpoon", "Crystal harpoon"].flatMap((n) => ctx.resolveItem(n) ?? []) : [];
            const baitName = normalize(action) === "lure" ? "Feather" : /nothing|none/i.test(p.bait ?? "") || !p.bait ? undefined : toolNames(p.bait)[0];
            const bait = baitName ? ctx.resolveItem(baitName) : undefined;
            if (catches.length === 0 || toolIds.length === 0) continue;
            out.push({
                npcIds: pageSpots.filter((s) => s.actions?.includes(action!)).map((s) => s.id),
                action,
                tools: [...toolIds, ...harpoons],
                ...(bait !== undefined ? { bait } : {}),
                catches: catches.sort((a, b) => b.level - a.level),
            });
        }
    }
    // Spawned spots the wiki pages do not list: the block of a spot with the same options.
    const optionsOf = (id: number) => (spots.find((s) => s.id === id)?.actions ?? []).join("|");
    for (const s of spots) {
        for (const a of s.actions ?? []) {
            if (out.some((f) => f.action === a && f.npcIds.includes(s.id))) continue;
            const same = out.filter((f) => f.action === a);
            const f = same.find((x) => x.npcIds.some((id) => optionsOf(id) === optionsOf(s.id))) ?? same[0];
            f?.npcIds.push(s.id);
        }
    }
    const covered = new Set(out.flatMap((f) => f.npcIds.map((id) => `${id}:${f.action}`)));
    const pairs = spots.flatMap((s) => (s.actions ?? []).filter((a) => a !== "Examine").map((a) => `${s.id}:${a}`));
    const missing = pairs.filter((k) => !covered.has(k));
    ctx.log(`fishing: ${pairs.length - missing.length}/${pairs.length} spawned spot actions resolved${missing.length ? `; missing ${missing.slice(0, 20).join(" ")}` : ""}`);
    return out;
}
