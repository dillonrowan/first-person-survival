// What every part of the skills export shares: the wiki data, item name resolution, the cache's
// loc and NPC names, and the coverage report.

import fs from "node:fs";
import path from "node:path";

import type { Chart, Infobox, Recipe, SkillDrop } from "../fetch-wiki-skills";
import type { LootEntry } from "../../../src/world/SkillFormat";
import type { ItemInfo } from "../../../src/world/ItemFormat";
import { PREFERRED_ITEM_IDS } from "../../../src/world/ItemFormat";
import type { NpcManifest } from "../../../src/world/NpcFormat";
import type { WorldLoaders } from "../WorldLoaders";
import { stripNameTags } from "../NpcSpawns";
import { stripLinks } from "../wiki/Wikitext";

export type SkillPage = { templates: { name: string; params: Record<string, string> }[]; charts: Chart[]; infobox?: Infobox };
export type WikiData = {
    drops: SkillDrop[];
    recipes: Recipe[];
    pages: Record<string, SkillPage>;
    calc: Record<string, Record<string, unknown>[]>;
    scenery: { page: string; ids: number[] }[];
    npcs: { page: string; ids: number[]; name: string }[];
    monsters: { page: string; ids: number[]; version: string; hitpoints: number; slayerLevel: number; slayerXp: number; slayerCategories: string[] }[];
    slayerMasters: { master: string; tasks: { category: string; weight: number; slayerLevel: number }[] }[];
    shops: { page: string; owner: string; map: { x: number; y: number; plane: number } | null; items: { name: string; stock: number; price: number; shopPays: number | null; restockTicks: number }[] }[];
    altars: { rune: string; altarId: number; altar: { x: number; y: number; plane: number } | null; ruinsIds: number[]; ruins: { x: number; y: number; plane: number } | null }[];
    farming: { source: string; patches: { impl: string; ranges: { from: number; to: number; produce: string; state: string; stageExpr: string }[] }[]; produce: { produce: string; name: string; impl: string; tickrate: number; stages: number; regrow?: number; harvestStages?: number }[] };
};

export function loadWikiData(dir: string): WikiData {
    const load = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as T;
    return {
        drops: load("drops.json"),
        recipes: load("recipes.json"),
        pages: load<{ pages: Record<string, SkillPage> }>("skill-info.json").pages,
        calc: load("calc.json"),
        scenery: load("scenery.json"),
        npcs: load("npcs.json"),
        monsters: load("monsters.json"),
        slayerMasters: load("slayer-masters.json"),
        shops: load("shops.json"),
        altars: load("altars.json"),
        farming: load("farming.json"),
    };
}

/** Named rarities as chances of one roll. [design] */
const NAMED_RARITY: Record<string, number> = { always: 1, common: 1 / 8, uncommon: 1 / 50, rare: 1 / 300, "very rare": 1 / 3000, varies: 1 / 128, unknown: 1 / 128 };

/** "3/128", "1/5,000", "Always" or a named rarity to a chance; undefined for "Once" and the like. */
export function rarityChance(text: string): number | undefined {
    const t = stripLinks(text).trim().toLowerCase();
    if (t in NAMED_RARITY) return NAMED_RARITY[t];
    const m = /^~?([\d.,]+)\s*\/\s*([\d.,]+)/.exec(t);
    if (!m) return undefined;
    const a = Number(m[1].replace(/,/g, ""));
    const b = Number(m[2].replace(/,/g, ""));
    return a > 0 && b > 0 ? Math.min(1, a / b) : undefined;
}

/** Pets, clue nests and the like: drops this game leaves out. */
const UNUSED_LOOT = /^(Clue scroll|Clue (nest|geode|bottle)|Scroll box|Rocky|Beaver|Heron|Rock golem|Baby chinchompa|Giant squirrel|Tangleroot|Bird nest|Rift guardian|Phoenix|Ensouled |Brimstone key|.*champion scroll)/i;

export type SkillsExportContext = ReturnType<typeof createSkillsContext>;

export function createSkillsContext(wiki: WikiData, loaders: WorldLoaders, items: ItemInfo[], npcManifest: NpcManifest | undefined) {
    const report: string[] = [];
    const unresolved = new Map<string, number>();
    const itemByName = new Map<string, ItemInfo>();
    for (const item of items) {
        const key = item.name.toLowerCase();
        const existing = itemByName.get(key);
        if (!existing || item.id < existing.id) itemByName.set(key, item);
    }
    const itemIds = new Set(items.map((i) => i.id));

    /** An item id by its exact name (case-insensitive); undefined, and noted in the report, if none. */
    const resolveItem = (rawName: string): number | undefined => {
        const name = stripLinks(rawName).replace(/\s*\(noted\)\s*$/i, "").trim();
        if (name === "") return undefined;
        const key = name.toLowerCase();
        const preferred = PREFERRED_ITEM_IDS[key];
        const id = preferred !== undefined && itemIds.has(preferred) ? preferred : itemByName.get(key)?.id;
        if (id === undefined && name !== "") unresolved.set(name, (unresolved.get(name) ?? 0) + 1);
        return id;
    };

    const locCount = loaders.locTypeLoader.getCount();
    /** Every loc's display name (tags stripped) and actions, loaded once. */
    const locs: { name: string; actions: string[] }[] = [];
    for (let id = 0; id < locCount; id++) {
        const t = loaders.locTypeLoader.load(id);
        locs.push({ name: stripNameTags(t.name ?? ""), actions: (t.actions ?? []).filter((a): a is string => !!a) });
    }
    const locsWhere = (test: (name: string, actions: string[], id: number) => boolean): number[] => {
        const out: number[] = [];
        locs.forEach((l, id) => {
            if (l.name !== "null" && test(l.name, l.actions, id)) out.push(id);
        });
        return out;
    };

    const sceneryIds = new Map<string, number[]>();
    for (const s of wiki.scenery) sceneryIds.set(s.page, [...(sceneryIds.get(s.page) ?? []), ...s.ids]);
    /** Loc ids of a wiki page: its scenery bucket ids and its skill page infobox ids. */
    const pageLocIds = (page: string): number[] =>
        [...new Set([...(sceneryIds.get(page) ?? []), ...(wiki.pages[page]?.infobox?.ids ?? [])])].filter((id) => id < locCount);

    const spawned = npcManifest?.appearances ?? [];
    /** Where each appearance (by NPC id) is spawned. */
    const spawnsOf = (id: number): { x: number; y: number; plane: number }[] =>
        (npcManifest?.spawns ?? []).filter((s) => spawned[s.appearance]?.id === id);
    const npcIdsOf = new Map<string, number[]>();
    for (const n of [...wiki.npcs, ...wiki.monsters]) npcIdsOf.set(n.page, [...(npcIdsOf.get(n.page) ?? []), ...n.ids]);
    /** NPC ids of a wiki page (npc and monster buckets plus the skill page infobox). */
    const pageNpcIds = (page: string): number[] => [...new Set([...(npcIdsOf.get(page) ?? []), ...(wiki.pages[page]?.infobox?.ids ?? [])])];
    /** Spawned NPC appearance ids with this name (case-insensitive). */
    const spawnedNamed = (name: string): number[] =>
        spawned.filter((a) => stripNameTags(a.name).toLowerCase() === name.toLowerCase()).map((a) => a.id);

    /** The page's drop rows of one type ("woodcutting", "thieving"…) as loot. */
    const lootOf = (page: string, type: string, table?: string): LootEntry[] => {
        const out: LootEntry[] = [];
        for (const d of wiki.drops) {
            if (d.page !== page || d.type !== type || (table !== undefined && d.table !== table)) continue;
            if (UNUSED_LOOT.test(d.item)) continue;
            const p = rarityChance(d.rarity);
            const item = resolveItem(d.item);
            if (p === undefined || item === undefined) continue;
            out.push({ item, min: d.qLow, max: Math.max(d.qLow, d.qHigh), p });
        }
        return out;
    };

    return {
        wiki,
        loaders,
        items,
        itemIds,
        resolveItem,
        locs,
        locsWhere,
        pageLocIds,
        pageNpcIds,
        spawned,
        spawnsOf,
        spawnedNamed,
        lootOf,
        report,
        unresolved,
        log: (line: string) => report.push(line),
    };
}

/** The first number in a wiki value ("37.5", "{{Fmt|40}}"). */
export function num(v: string | undefined, fallback = 0): number {
    const m = /-?[\d.]+/.exec(stripLinks(v ?? "").replace(/,/g, ""));
    return m ? Number(m[0]) : fallback;
}

/** Tool names from a wiki `tool` field: "[[Axe]]", "{{plink|Fishing rod}}<br />OR<br />{{plink|…}}". */
export function toolNames(field: string): string[] {
    const plinks = [...field.matchAll(/\{\{plink\|([^|}]+)/gi)].map((m) => m[1].trim());
    if (plinks.length > 0) return plinks;
    return stripLinks(field)
        .split(/\bOR\b|,|<br\s*\/?>/i)
        .map((s) => s.trim())
        .filter(Boolean);
}
