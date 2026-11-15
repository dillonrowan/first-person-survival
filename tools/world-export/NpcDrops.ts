import type { NpcDrop } from "../../src/world/NpcFormat";
import type { WikiAttackRow } from "./fetch-wiki-attacks";
import type { WikiDrop } from "./fetch-wiki-items";

/**
 * The drop table of an NPC: the wiki entries of its page. When the page lists several levels, only
 * the entries of this NPC level are kept (all of them if none match). Items the cache does not know
 * by name are skipped. Undefined when nothing remains.
 */
export function dropsFor(
    row: WikiAttackRow | undefined,
    drops: Record<string, WikiDrop[]>,
    idOf: (name: string) => number | undefined,
): NpcDrop[] | undefined {
    const entries = row ? drops[row.page] : undefined;
    if (!row || !entries) return undefined;
    const sameLevel = entries.filter((e) => e.level === undefined || e.level === String(row.level));
    const out: NpcDrop[] = [];
    for (const e of sameLevel.length > 0 ? sameLevel : entries) {
        const item = idOf(e.item);
        if (item !== undefined) {
            out.push({ item, min: e.qtyLow, max: e.qtyHigh, chance: e.chance, rolls: e.rolls });
        }
    }
    return out.length > 0 ? out : undefined;
}
