// Downloads every monster's attack styles, max hits and attack speed from the OSRS wiki (Bucket API)
// into data/npc-attacks-wiki.json, keyed by NPC id. The cache has none of this (server data).
//
//   npm run fetch-wiki-attacks

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { AttackStyle, styleFromWiki } from "../../src/npc/AttackStyle";

export type WikiAttackRow = {
    page: string;
    anchor?: string;
    level?: number;
    speedTicks?: number;
    styles: { style: AttackStyle; raw: string; maxHit?: number }[];
};

const API = "https://oldschool.runescape.wiki/api.php";
const PAGE_SIZE = 500;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "npc-attacks-wiki.json");

const arr = <T>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

const SKIP_LABEL = /special|protect|without|with |indirect|recoil/i;

/**
 * Fills `maxHit` of each style from the wiki's free-text max hits: "8 (Slash)", "50 (Dragonfire)",
 * "13 Magic; 9 Melee", or a bare "28" that applies to every style without its own number.
 */
export function parseMaxHits(raw: string[], styles: WikiAttackRow["styles"]): void {
    const parts = raw
        .join("; ")
        .replace(/<br\s*\/?>/gi, "; ")
        .split(";")
        .map((p) => p.trim())
        .filter((p) => p);
    let fallback: number | undefined;
    for (const part of parts) {
        const number = /(\d+)/.exec(part);
        if (!number) continue;
        const value = Number(number[1]);
        const paren = /\(([^)]*)\)/.exec(part);
        const label = (paren ? paren[1] : part.slice((number.index ?? 0) + number[1].length)).trim();
        if (SKIP_LABEL.test(label)) continue;
        if (label === "") {
            fallback ??= value;
            continue;
        }
        const style = styleFromWiki(label);
        if (style) {
            const entry = styles.find((s) => s.style === style);
            if (entry && entry.maxHit === undefined) entry.maxHit = value;
        } else {
            fallback ??= value;
        }
    }
    if (fallback !== undefined) {
        for (const s of styles) s.maxHit ??= fallback;
    }
}

type BucketRow = {
    page_name?: string;
    id?: string | string[];
    attack_style?: string | string[];
    max_hit?: string | string[];
    attack_speed?: string | number | (string | number)[];
    combat_level?: string | number;
    version_anchor?: string;
};

/** One wiki row as the entry each of its ids gets. */
export function rowToEntry(row: BucketRow): WikiAttackRow {
    const raws = arr(row.attack_style).map(String);
    const styles: WikiAttackRow["styles"] = [];
    for (const raw of raws) {
        const style = styleFromWiki(raw);
        if (style && !styles.some((s) => s.style === style)) styles.push({ style, raw });
    }
    if (styles.length === 0 && raws.length > 0) styles.push({ style: "melee", raw: raws[0] });
    parseMaxHits(arr(row.max_hit).map(String), styles);
    const speed = Number(arr(row.attack_speed)[0]);
    const level = Number(row.combat_level);
    return {
        page: row.page_name ?? "",
        ...(row.version_anchor ? { anchor: row.version_anchor } : {}),
        ...(Number.isFinite(level) && level > 0 ? { level } : {}),
        ...(Number.isFinite(speed) && speed > 0 ? { speedTicks: speed } : {}),
        styles,
    };
}

async function fetchPage(offset: number): Promise<BucketRow[]> {
    const query =
        "bucket('infobox_monster').select('page_name','id','attack_style','max_hit','attack_speed','combat_level','version_anchor')" +
        `.limit(${PAGE_SIZE}).offset(${offset}).run()`;
    const url = `${API}?action=bucket&format=json&query=${encodeURIComponent(query)}`;
    const response = await fetch(url, { headers: { "User-Agent": "first-person-survival-dev" } });
    if (!response.ok) throw new Error(`GET ${url}: ${response.status}`);
    return ((await response.json()) as { bucket?: BucketRow[] }).bucket ?? [];
}

async function main(): Promise<void> {
    const entries = new Map<number, WikiAttackRow>();
    for (let offset = 0; ; offset += PAGE_SIZE) {
        const rows = await fetchPage(offset);
        if (rows.length === 0) break;
        for (const row of rows) {
            const entry = rowToEntry(row);
            for (const id of arr(row.id).flatMap((v) => String(v).split(","))) {
                const n = Number(id.trim());
                if (Number.isInteger(n) && !entries.has(n)) entries.set(n, entry);
            }
        }
        console.log(`offset ${offset}: ${rows.length} rows, ${entries.size} ids`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const sorted = [...entries].sort((a, b) => a[0] - b[0]);
    fs.writeFileSync(OUT, JSON.stringify(Object.fromEntries(sorted), null, 1) + "\n");
    console.log(`wrote ${sorted.length} NPCs to ${OUT}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
