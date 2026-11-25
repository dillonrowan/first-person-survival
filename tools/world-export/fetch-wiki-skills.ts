// Downloads the OSRS wiki data the non-combat skills need: skilling loot, recipes, skill info
// templates and success charts, calculator modules, slayer masters, shops, runecraft altars,
// fishing spot locations, and RuneLite's farming tables. None of it is in the cache (server data).
//
//   npm run fetch-wiki-skills
//   npm run fetch-wiki-skills -- --only fishing-spots   (one file; needs npcs.json)
//
// Writes tools/world-export/data/wiki/*.json. Combat drops and food heals come from
// fetch-wiki-items (data/wiki-drops.json, data/wiki-food.json) and are not fetched again.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseLuaTable } from "./wiki/Lua";
import { bucketAll, embeddedIn, fetchText, pagesWikitext, raw } from "./wiki/WikiClient";
import { Tile, findTemplates, mapCoords, parseIds, stripLinks, unescapeHtml } from "./wiki/Wikitext";
import { parseFarming, parseProduce } from "./wiki/farmingSource";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "wiki");

const arr = <T>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string => unescapeHtml(String(arr(v as string)[0] ?? "")).trim();
const ints = (v: unknown): number[] => arr(v as string).flatMap((s) => parseIds(String(s)));

// ---------------------------------------------------------------- parsers (exported for tests)

export type SkillDrop = { page: string; table: string; item: string; rarity: string; qLow: number; qHigh: number; noted: boolean; rolls: number; type: string };

/** One `dropsline` row; undefined for rows this game does not use (combat and sailing). */
export function parseDropRow(row: Record<string, unknown>): SkillDrop | undefined {
    const j = JSON.parse(String(row.drop_json ?? "{}")) as Record<string, unknown>;
    const type = String(j["Drop type"] ?? "").toLowerCase();
    if (type === "combat" || type === "sailing" || type === "") return undefined;
    const from = String(j["Dropped from"] ?? "");
    const hash = from.indexOf("#");
    const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);
    return {
        page: str(row.page_name),
        table: hash >= 0 ? from.slice(hash + 1) : "",
        item: unescapeHtml(String(j["Dropped item"] ?? row.item_name ?? "")).trim(),
        rarity: String(j.Rarity ?? ""),
        qLow: num(j["Quantity Low"], 1),
        qHigh: num(j["Quantity High"], num(j["Quantity Low"], 1)),
        noted: /\(noted\)/i.test(String(j["Drop Quantity"] ?? "")),
        rolls: num(j.Rolls, 1),
        type,
    };
}

export type Recipe = {
    page: string;
    skills: { skill: string; level: number; xp: number }[];
    ticks: number | null;
    materials: { name: string; qty: number }[];
    tools: string[][];
    facility: string | null;
    output: { name: string; qty: number };
    members: boolean;
};

/** One `recipe` row; undefined without skills or output, or for Sailing. */
export function parseRecipe(row: Record<string, unknown>): Recipe | undefined {
    const j = JSON.parse(String(row.production_json ?? "{}")) as {
        ticks?: string;
        materials?: { name: string; quantity: string }[];
        tools?: string;
        facilities?: string;
        skills?: { name: string; level: string; experience: string }[];
        output?: { name: string; quantity: string };
        members?: boolean;
    };
    const skills = (j.skills ?? []).map((s) => ({ skill: s.name, level: Number(s.level) || 1, xp: Number(s.experience) || 0 }));
    const output = unescapeHtml(j.output?.name ?? "").trim();
    if (skills.length === 0 || output === "" || skills.some((s) => /sailing/i.test(s.skill))) return undefined;
    const ticks = Number(j.ticks);
    return {
        page: str(row.page_name),
        skills,
        ticks: j.ticks && Number.isFinite(ticks) ? ticks : null,
        materials: (j.materials ?? []).map((m) => ({ name: unescapeHtml(m.name).trim(), qty: Number(m.quantity) || 1 })),
        tools: (j.tools ?? "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .map((t) => t.split(/\s+or\s+/i).map((s) => stripLinks(s).trim()).filter(Boolean)),
        facility: j.facilities ? stripLinks(j.facilities) || null : null,
        output: { name: output, qty: Number(j.output?.quantity) || 1 },
        members: !!j.members,
    };
}

export type Chart = { label: string; cascade: boolean; series: { label: string; low: number; high: number; req: number; image: string }[] };

export function parseChart(params: Record<string, string>): Chart {
    const series: Chart["series"] = [];
    for (let n = 1; params[`low${n}`] !== undefined; n++) {
        series.push({
            label: params[`label${n}`] ?? "",
            low: Number(params[`low${n}`]),
            high: Number(params[`high${n}`]),
            req: Number(params[`req${n}`] ?? 1),
            image: params[`image${n}`] ?? "",
        });
    }
    return { label: params.label ?? "", cascade: /^yes$/i.test(params.cascade ?? ""), series };
}

export type Infobox = { ids: number[]; maps: Tile[]; options: string };

/** The first Infobox Scenery, NPC or Monster of a page: ids, map positions and options. */
export function parseInfobox(text: string): Infobox | undefined {
    for (const name of ["Infobox Scenery", "Infobox NPC", "Infobox Monster"]) {
        const box = findTemplates(text, name)[0];
        if (!box) continue;
        const ids: number[] = [];
        const maps: Tile[] = [];
        for (const [k, v] of Object.entries(box)) {
            if (/^id\d*$/.test(k)) ids.push(...parseIds(v));
            if (/^map\d*$/.test(k)) {
                const m = mapCoords(v);
                if (m) maps.push(m);
            }
        }
        return { ids: [...new Set(ids)], maps, options: box.options ?? "" };
    }
    return undefined;
}

export type SlayerMaster = { master: string; tasks: { category: string; weight: number; slayerLevel: number }[] };

export function parseSlayerMasters(src: string): SlayerMaster[] {
    const out: SlayerMaster[] = [];
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const head = /^local (\w+) = \{\s*$/.exec(lines[i]);
        if (!head || head[1] === "p") continue;
        const tasks: SlayerMaster["tasks"] = [];
        for (i++; i < lines.length && !/^\}\s*$/.test(lines[i]); i++) {
            // Indented lines are the bosses of a boss task, not tasks of their own.
            if (/^\s/.test(lines[i])) continue;
            const m = /name\s*=\s*"(.*?)",\s*requirements\s*=\s*\{(.*?)\},\s*weight\s*=\s*(\d+)/.exec(lines[i]);
            if (!m) continue;
            const slayer = /Slayer\s*=\s*(\d+)/.exec(m[2]);
            tasks.push({ category: stripLinks(m[1]), weight: Number(m[3]), slayerLevel: slayer ? Number(slayer[1]) : 1 });
        }
        out.push({ master: head[1], tasks });
    }
    return out;
}

/** "2.4 seconds", "1 minute, 54 seconds", "4.8s", "45 ticks", "12 minutes<br/>…" to seconds. */
export function parseSeconds(text: string): number | undefined {
    const first = stripLinks(text.split(/<br\s*\/?>/i)[0]).toLowerCase();
    const ticks = /([\d.]+)\s*ticks?/.exec(first);
    if (ticks) return Number(ticks[1]) * 0.6;
    let total = 0;
    let any = false;
    for (const m of first.matchAll(/([\d.]+)\s*(h|hours?|m|min|minutes?|s|sec|seconds?)\b/g)) {
        const v = Number(m[1]);
        total += m[2].startsWith("h") ? v * 3600 : m[2].startsWith("m") ? v * 60 : v;
        any = true;
    }
    if (any) return total;
    const bare = /^([\d.]+)$/.exec(first.trim());
    return bare ? Number(bare[1]) : undefined;
}

// ---------------------------------------------------------------- fetching

const SKILL_TEMPLATES = ["Woodcutting info", "Mining info", "Fishing info", "Thieving info", "Infobox Construction"];
const CALC_SKILLS = ["Woodcutting", "Mining", "Fishing", "Thieving", "Hunter", "Farming", "Runecraft", "Firemaking", "Construction", "Cooking", "Smithing", "Crafting", "Fletching", "Herblore"];
const RUNES = ["Air", "Mind", "Water", "Earth", "Fire", "Body", "Law", "Nature", "Chaos", "Wrath", "Astral"];
const RUNELITE = "https://raw.githubusercontent.com/runelite/runelite/master/runelite-client/src/main/java/net/runelite/client/plugins/timetracking/farming/";

export type FishingSpotPage = { page: string; ids: number[]; places: { x: number; y: number; plane: number }[] };

/**
 * The tiles of an NPC page's location table ({{ObjectLocLine}} / {{LocLine}} rows): rows on the
 * main map only (mapID -1, 0 or none; other maps are instances), every `x:…,y:…` pair.
 */
export function parseLocLines(text: string): { x: number; y: number; plane: number }[] {
    const out: { x: number; y: number; plane: number }[] = [];
    for (const row of [...findTemplates(text, "ObjectLocLine"), ...findTemplates(text, "LocLine")]) {
        const map = parseInt(row.mapID ?? row.mapid ?? "-1");
        if (Number.isInteger(map) && map !== -1 && map !== 0) continue;
        const plane = parseInt(row.plane ?? "0") || 0;
        for (const [key, value] of Object.entries(row)) {
            if (!/^\d+$/.test(key)) continue;
            for (const m of value.matchAll(/x:\s*(\d+)\s*,\s*y:\s*(\d+)/g)) out.push({ x: Number(m[1]), y: Number(m[2]), plane });
        }
    }
    return out;
}

/** Where every fishing spot NPC stands, from its page's location table. */
async function fishingSpots(npcs: { page: string; ids: number[]; name: string }[]): Promise<FishingSpotPage[]> {
    const pages = npcs.filter((n) => /fishing spot/i.test(n.name) || /fishing spot/i.test(n.page));
    const texts = await pagesWikitext([...new Set(pages.map((p) => p.page))]);
    return pages
        .map((p) => ({ page: p.page, ids: p.ids, places: parseLocLines(texts.get(p.page) ?? "") }))
        .filter((p) => p.places.length > 0);
}

function write(name: string, data: unknown): void {
    fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 1) + "\n");
    console.log(`wrote ${name}`);
}

async function skillInfo(): Promise<Record<string, { templates: { name: string; params: Record<string, string> }[]; charts: Chart[]; infobox?: Infobox }>> {
    const pages: Awaited<ReturnType<typeof skillInfo>> = {};
    for (const template of SKILL_TEMPLATES) {
        const titles = (await embeddedIn(template.replace(/ /g, "_"))).filter((t) => !/^(Template|User|Module):/.test(t));
        const texts = await pagesWikitext(titles);
        for (const [page, text] of texts) {
            const found = findTemplates(text, template);
            if (found.length === 0) continue;
            const entry = (pages[page] ??= {
                templates: [],
                charts: findTemplates(text, "Skilling success chart").map(parseChart),
                infobox: parseInfobox(text),
            });
            for (const params of found) entry.templates.push({ name: template, params });
        }
        console.log(`${template}: ${titles.length} pages`);
    }
    return Object.fromEntries(Object.entries(pages).sort(([a], [b]) => a.localeCompare(b)));
}

async function shops() {
    const boxes = await bucketAll("infobox_shop", ["page_name", "shop_name", "owner", "location"]);
    const lines = await bucketAll("storeline", ["sold_by", "sold_item", "store_buy_price", "store_sell_price", "store_currency", "store_stock", "restock_time"]);
    const texts = await pagesWikitext(boxes.map((b) => str(b.page_name)));
    const byShop = new Map<string, { name: string; stock: number; price: number; shopPays: number | null; restockTicks: number }[]>();
    for (const l of lines) {
        const currency = str(l.store_currency);
        // store_sell_price: what the shop sells for; store_buy_price: what it pays.
        const price = parseInt(str(l.store_sell_price).replace(/,/g, ""));
        if ((currency !== "" && currency !== "Coins") || !Number.isInteger(price)) continue;
        const stock = parseInt(str(l.store_stock).replace(/,/g, ""));
        const pays = parseInt(str(l.store_buy_price).replace(/,/g, ""));
        const restock = parseInt(str(l.restock_time));
        const list = byShop.get(str(l.sold_by)) ?? [];
        list.push({
            name: str(l.sold_item),
            stock: Number.isInteger(stock) ? stock : 1000,
            price,
            shopPays: Number.isInteger(pays) ? pays : null,
            restockTicks: Number.isInteger(restock) && restock > 0 ? restock : 100,
        });
        byShop.set(str(l.sold_by), list);
    }
    return boxes
        .map((b) => {
            const page = str(b.page_name);
            const box = findTemplates(texts.get(page) ?? "", "Infobox Shop")[0];
            return { page, owner: stripLinks(str(b.owner)), map: box?.map ? mapCoords(box.map) ?? null : null, items: byShop.get(page) ?? [] };
        })
        .filter((s) => s.items.length > 0)
        .sort((a, b) => a.page.localeCompare(b.page));
}

async function altars() {
    const texts = await pagesWikitext([...RUNES.map((r) => `${r} Altar`), "Mysterious ruins"]);
    const ruins = findTemplates(texts.get("Mysterious ruins") ?? "", "Infobox Scenery")[0] ?? {};
    return RUNES.map((rune) => {
        const box = findTemplates(texts.get(`${rune} Altar`) ?? "", "Infobox Scenery")[0] ?? {};
        let ruinsIds: number[] = [];
        let ruinsAt: Tile | null = null;
        for (let n = 1; ruins[`version${n}`] !== undefined; n++) {
            if (ruins[`version${n}`].trim() === rune) {
                ruinsIds = parseIds(ruins[`id${n}`]);
                ruinsAt = mapCoords(ruins[`map${n}`] ?? "") ?? null;
            }
        }
        const altarIds = parseIds(box.id);
        return { rune, altarId: altarIds[0] ?? -1, altar: mapCoords(box.map ?? "") ?? null, ruinsIds, ruins: ruinsAt };
    });
}

async function farming() {
    const commit = JSON.parse(await fetchText("https://api.github.com/repos/runelite/runelite/commits/master")) as { sha: string };
    return {
        source: `RuneLite (BSD-2-Clause), ${commit.sha}`,
        patches: parseFarming(await fetchText(`${RUNELITE}PatchImplementation.java`)),
        produce: parseProduce(await fetchText(`${RUNELITE}Produce.java`)),
    };
}

async function main(): Promise<void> {
    fs.mkdirSync(OUT, { recursive: true });
    const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
    if (only === "fishing-spots") {
        const npcs = JSON.parse(fs.readFileSync(path.join(OUT, "npcs.json"), "utf8")) as { page: string; ids: number[]; name: string }[];
        write("fishing-spots.json", await fishingSpots(npcs));
        return;
    }
    if (only) throw new Error(`--only: unknown file ${only}`);

    const drops = (await bucketAll("dropsline", ["page_name", "item_name", "drop_json"]))
        .map(parseDropRow)
        .filter((d): d is SkillDrop => !!d);
    write("drops.json", drops);

    const monsters = await bucketAll("infobox_monster", ["page_name", "id", "version_anchor", "name", "hitpoints", "slayer_level", "slayer_experience", "slayer_category"]);
    write(
        "monsters.json",
        monsters
            .map((m) => ({
                page: str(m.page_name),
                ids: ints(m.id),
                version: str(m.version_anchor),
                hitpoints: Number(str(m.hitpoints)) || 0,
                slayerLevel: Number(str(m.slayer_level)) || 0,
                slayerXp: Number(str(m.slayer_experience)) || 0,
                slayerCategories: arr(m.slayer_category as string).map((c) => stripLinks(String(c))).filter(Boolean),
            }))
            .filter((m) => m.ids.length > 0)
            .sort((a, b) => a.page.localeCompare(b.page)),
    );

    const npcs = await bucketAll("infobox_npc", ["page_name", "npc_id", "npc_name"]);
    const npcRows = npcs.map((n) => ({ page: str(n.page_name), ids: ints(n.npc_id), name: str(n.npc_name) })).filter((n) => n.ids.length > 0).sort((a, b) => a.page.localeCompare(b.page));
    write("npcs.json", npcRows);
    write("fishing-spots.json", await fishingSpots(npcRows));

    const scenery = await bucketAll("infobox_scenery", ["page_name", "object_id"]);
    write("scenery.json", scenery.map((s) => ({ page: str(s.page_name), ids: ints(s.object_id) })).filter((s) => s.ids.length > 0).sort((a, b) => a.page.localeCompare(b.page)));

    const recipes = (await bucketAll("recipe", ["page_name", "uses_skill", "production_json"])).map(parseRecipe).filter((r): r is Recipe => !!r);
    write("recipes.json", recipes);

    // Cooking burn chances: the success chart on each cooked item's page.
    const cooked = [...new Set(recipes.filter((r) => r.skills[0].skill === "Cooking").map((r) => r.page))];
    const cookTexts = await pagesWikitext(cooked);
    const cookCharts: Record<string, Chart[]> = {};
    for (const [page, text] of cookTexts) {
        const charts = findTemplates(text, "Skilling success chart").map(parseChart);
        if (charts.length > 0) cookCharts[page] = charts;
    }
    write("cooking-charts.json", cookCharts);

    write("skill-info.json", { pages: await skillInfo() });

    const calc: Record<string, unknown> = {};
    for (const skill of CALC_SKILLS) calc[skill] = parseLuaTable(await raw(`Module:Skill calc/${skill}`));
    write("calc.json", calc);

    write("slayer-masters.json", parseSlayerMasters(await raw("Module:SlayerConsts/MasterTables")));
    write("shops.json", await shops());
    write("altars.json", await altars());
    write("farming.json", await farming());
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
