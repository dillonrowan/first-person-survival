import type { NpcDrop } from "../world/NpcFormat";
import type { Stack } from "./ItemContainer";

/**
 * Rolls an NPC drop table: entries that always drop (chance 1) drop; then, for each of the table
 * rolls, one entry of the rest is picked with probability equal to its chance (the chances add up
 * along the table, the remainder is nothing), and drops a quantity from min to max.
 */
export function rollDrops(drops: readonly NpcDrop[], random: () => number): Stack[] {
    const out: Stack[] = [];
    const quantity = (d: NpcDrop) => (d.min >= d.max ? d.min : d.min + Math.floor(random() * (d.max - d.min + 1)));
    for (const d of drops) {
        if (d.chance >= 1) out.push({ id: d.item, qty: quantity(d) });
    }
    const rest = drops.filter((d) => d.chance < 1);
    const rolls = Math.max(1, ...rest.map((d) => d.rolls));
    for (let i = 0; i < rolls && rest.length > 0; i++) {
        let x = random();
        for (const d of rest) {
            x -= d.chance;
            if (x < 0) {
                out.push({ id: d.item, qty: quantity(d) });
                break;
            }
        }
    }
    return out;
}
