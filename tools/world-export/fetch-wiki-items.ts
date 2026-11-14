// Downloads item data from the OSRS wiki: monster drop tables (Bucket "dropsline"), item spawns
// (Bucket "locline") and the heal of every food. The cache has none of this (server data).
//
//   npm run fetch-wiki-items
//
// Writes data/wiki-drops.json, data/wiki-item-spawns.json and data/wiki-food.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type WikiDrop = {
    item: string;
    qtyLow: number;
    qtyHigh: number;
    /** 0..1 chance of one roll. */
    chance: number;
    rolls: number;
    /** The combat level of the monster version the drop is listed for, when the wiki says. */
    level?: string;
};

export type WikiItemSpawn = { page: string; x: number; y: number; plane: number; qty: number };

const API = "https://oldschool.runescape.wiki/api.php";
const PAGE_SIZE = 500;
const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
const UA = "first-person-survival-dev";

const arr = <T>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Named rarities of the wiki, as chances of one roll. [design for the numbers] */
const NAMED_RARITY: Record<string, number> = {
    always: 1,
    common: 1 / 16,
    uncommon: 1 / 64,
    rare: 1 / 256,
    "very rare": 1 / 1024,
};

/** "Always", "3/128", "1,000/5,000" or a named rarity to a chance; undefined for anything else. */
export function parseRarity(text: string): number | undefined {
    const t = text.trim().toLowerCase();
    if (t in NAMED_RARITY) return NAMED_RARITY[t];
    const m = /^([\d.,]+)\/([\d.,]+)$/.exec(t);
    if (!m) return undefined;
    const a = Number(m[1].replace(/,/g, ""));
    const b = Number(m[2].replace(/,/g, ""));
    return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : undefined;
}

/** "3030,3637,qty:5" to a position and a quantity (1 when absent). */
export function parseCoordinates(text: string): { x: number; y: number; qty: number } | undefined {
    const parts = text.split(",").map((p) => p.trim());
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isInteger(x) || !Number.isInteger(y)) return undefined;
    const qty = parts.map((p) => /^qty:(\d+)$/.exec(p)).find((m) => m)?.[1];
    return { x, y, qty: qty ? Number(qty) : 1 };
}

/**
 * The heal of each food in the wiki's "Food/All food" table. Each row is `{{plinkt|Name}}` then a
 * heal cell: a number, "per bite × bites" (the whole item is eaten at once here, so the per-bite
 * amount counts), or text, which is skipped.
 */
export function parseFoodTable(text: string): Record<string, number> {
    const lines = text.split(/\r?\n/);
    const out: Record<string, number> = {};
    for (let i = 0; i < lines.length - 1; i++) {
        const name = /^\|\{\{plinkt\|([^|}]+)/.exec(lines[i]);
        if (!name) continue;
        const cell = lines[i + 1].replace(/^\|\s*/, "").replace(/^[^|]*\|\s*/, (m) => (m.includes("data-sort") ? "" : m)).trim();
        const single = /^(\d+)$/.exec(cell);
        const multi = /^(\d+)\s*×\s*(\d+)$/.exec(cell);
        const heal = single ? Number(single[1]) : multi ? Number(multi[1]) : undefined;
        if (heal !== undefined && heal > 0) out[name[1].trim()] = heal;
    }
    return out;
}

type DropBucketRow = { page_name?: string; item_name?: string; rare_drop_table?: boolean | string; drop_json?: string };

/** One dropsline row as a drop, or undefined for rows that cannot be rolled. */
export function rowToDrop(row: DropBucketRow): WikiDrop | undefined {
    if (!row.drop_json || !row.item_name || row.item_name === "Nothing") return undefined;
    if (row.rare_drop_table === true || row.rare_drop_table === "true") return undefined;
    let json: Record<string, unknown>;
    try {
        json = JSON.parse(row.drop_json) as Record<string, unknown>;
    } catch {
        return undefined;
    }
    const chance = parseRarity(String(json["Rarity"] ?? ""));
    if (chance === undefined) return undefined;
    const low = Number(json["Quantity Low"] ?? 1);
    const high = Number(json["Quantity High"] ?? low);
    const rolls = Number(json["Rolls"] ?? 1);
    const level = String(json["Drop level"] ?? "");
    return {
        item: row.item_name,
        qtyLow: Number.isFinite(low) && low > 0 ? low : 1,
        qtyHigh: Number.isFinite(high) && high > 0 ? high : 1,
        chance,
        rolls: Number.isFinite(rolls) && rolls > 0 ? rolls : 1,
        ...(level !== "" ? { level } : {}),
    };
}

async function fetchBucket<T>(query: (offset: number) => string): Promise<T[]> {
    const rows: T[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
        const url = `${API}?action=bucket&format=json&query=${encodeURIComponent(query(offset))}`;
        const response = await fetch(url, { headers: { "User-Agent": UA } });
        if (!response.ok) throw new Error(`GET ${url}: ${response.status}`);
        const page = ((await response.json()) as { bucket?: T[] }).bucket ?? [];
        if (page.length === 0) break;
        rows.push(...page);
        console.log(`offset ${offset}: ${page.length} rows, ${rows.length} total`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return rows;
}

async function main(): Promise<void> {
    const dropRows = await fetchBucket<DropBucketRow>(
        (o) =>
            `bucket('dropsline').select('page_name','item_name','rare_drop_table','drop_json').limit(${PAGE_SIZE}).offset(${o}).run()`,
    );
    const drops: Record<string, WikiDrop[]> = {};
    for (const row of dropRows) {
        const drop = rowToDrop(row);
        if (drop && row.page_name) (drops[row.page_name] ??= []).push(drop);
    }
    fs.writeFileSync(path.join(DATA, "wiki-drops.json"), JSON.stringify(drops) + "\n");
    console.log(`wrote drops of ${Object.keys(drops).length} pages`);

    type LocRow = { page_name?: string; coordinates?: string | string[]; plane?: number | string; mapid?: number | string };
    const locRows = await fetchBucket<LocRow>(
        (o) => `bucket('locline').select('page_name','coordinates','plane','mapid').limit(${PAGE_SIZE}).offset(${o}).run()`,
    );
    const spawns: WikiItemSpawn[] = [];
    for (const row of locRows) {
        if (!row.page_name || Number(row.mapid ?? 0) > 0) continue;
        for (const c of arr(row.coordinates)) {
            const parsed = parseCoordinates(String(c));
            if (parsed) spawns.push({ page: row.page_name, ...parsed, plane: Number(row.plane ?? 0) || 0 });
        }
    }
    fs.writeFileSync(path.join(DATA, "wiki-item-spawns.json"), JSON.stringify(spawns) + "\n");
    console.log(`wrote ${spawns.length} spawn lines`);

    const response = await fetch("https://oldschool.runescape.wiki/w/Food/All_food?action=raw", { headers: { "User-Agent": UA } });
    if (!response.ok) throw new Error(`Food/All_food: ${response.status}`);
    const food = parseFoodTable(await response.text());
    fs.writeFileSync(path.join(DATA, "wiki-food.json"), JSON.stringify(food, null, 1) + "\n");
    console.log(`wrote ${Object.keys(food).length} foods`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
