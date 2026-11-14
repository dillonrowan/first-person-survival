import type { GroundItemManifest } from "../../src/world/WorldFormat";
import type { WikiItemSpawn } from "./fetch-wiki-items";

/**
 * The items lying in the world: wiki spawn lines whose page is an item the cache knows by name,
 * not a monster page, inside an exported region. Exact duplicates are dropped.
 */
export function groundItemSpawns(
    lines: readonly WikiItemSpawn[],
    idOf: (name: string) => number | undefined,
    monsterPages: ReadonlySet<string>,
    regionExported: (mapX: number, mapY: number) => boolean,
): GroundItemManifest["spawns"] {
    const seen = new Set<string>();
    const out: GroundItemManifest["spawns"] = [];
    for (const line of lines) {
        const item = idOf(line.page);
        if (item === undefined || monsterPages.has(line.page) || !regionExported(line.x >> 6, line.y >> 6)) continue;
        const key = `${item},${line.x},${line.y},${line.plane},${line.qty}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ item, qty: line.qty, x: line.x, y: line.y, plane: line.plane });
    }
    return out;
}
