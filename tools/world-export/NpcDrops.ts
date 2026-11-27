import type { NpcDrop } from "../../src/world/NpcFormat";
import type { WikiAttackRow } from "./fetch-wiki-attacks";
import type { WikiDrop } from "./fetch-wiki-items";

/**
 * Rows the wiki lists beside the main table, each rolled on its own (its "Tertiary" drops): keys,
 * clue scrolls, champion scrolls, ensouled heads and the like. The wiki data does not mark them, so
 * they are told by name.
 */
const TERTIARY = /^(Clue scroll|Scroll box|Ensouled |Long bone|Curved bone|Ancient shard|Dark totem)|\bkey\b|champion scroll$/i;

/**
 * The drop table of an NPC: the wiki entries of its page. When the page lists several levels, only
 * the entries of this NPC level are kept (all of them if none match). When it has several versions
 * of the table (members and free-to-play, a monster's areas), only one is kept: the members one,
 * else the one named for the NPC level, else the first.
 * Tertiary rows (TERTIARY) are marked to roll on their own; the main table is one roll, so where its
 * chances add up to more than 1 (wiki rounding) they are scaled to fit. Items the cache does not
 * know by name are skipped. Undefined when nothing remains.
 */
export function dropsFor(
    row: WikiAttackRow | undefined,
    drops: Record<string, WikiDrop[]>,
    idOf: (name: string) => number | undefined,
): NpcDrop[] | undefined {
    const entries = row ? drops[row.page] : undefined;
    if (!row || !entries) return undefined;
    // A drop level may list several ("42,48").
    const sameLevel = entries.filter((e) => e.level === undefined || e.level.split(",").map((l) => l.trim()).includes(String(row.level)));
    const levelled = sameLevel.length > 0 ? sameLevel : entries;
    const versions = [...new Set(levelled.flatMap((e) => (e.version ? [e.version] : [])))];
    const version = versions.includes("Members") ? "Members" : (versions.find((v) => v === `Level ${row.level}`) ?? versions[0]);
    const out: NpcDrop[] = [];
    for (const e of levelled) {
        if (e.version !== undefined && e.version !== version) continue;
        const item = idOf(e.item);
        if (item !== undefined) {
            const tertiary = e.chance < 1 && TERTIARY.test(e.item);
            out.push({ item, min: e.qtyLow, max: e.qtyHigh, chance: e.chance, rolls: e.rolls, ...(tertiary ? { tertiary } : {}) });
        }
    }
    const main = out.filter((d) => d.chance < 1 && !d.tertiary);
    const total = main.reduce((sum, d) => sum + d.chance, 0);
    if (total > 1) for (const d of main) d.chance /= total;
    return out.length > 0 ? out : undefined;
}
