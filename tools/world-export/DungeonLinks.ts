// Reads data/dungeon-links.json (written by find-dungeon-links.ts) for the world export: attaches
// links to the entrances it exports and picks which dungeon map squares to export.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LocLink } from "../../src/world/WorldFormat";
import { SURFACE_MAX_MAP_Y, isSurfaceTile } from "./DungeonCandidates";
import type { DungeonLink, Tile } from "./DungeonLinkResolver";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DUNGEON_LINKS_FILE = path.join(ROOT, "tools", "world-export", "data", "dungeon-links.json");
export const DUNGEON_LINKS_OVERRIDES_FILE = path.join(ROOT, "tools", "world-export", "data", "dungeon-links-overrides.json");

/** Hand fixes (data/dungeon-links-overrides.json): never written by a script. */
export type DungeonLinkOverrides = {
    /** Links to drop. */
    exclude?: { locId: number; from: Tile; action?: string }[];
    /** Links to add or replace; they need a source like any other. */
    links?: DungeonLink[];
    /** Map squares to leave out of the dungeon export (minigames, instances the flood fill ran into). */
    excludeSquares?: [number, number][];
};

export function readDungeonOverrides(): DungeonLinkOverrides {
    return fs.existsSync(DUNGEON_LINKS_OVERRIDES_FILE) ? (JSON.parse(fs.readFileSync(DUNGEON_LINKS_OVERRIDES_FILE, "utf8")) as DungeonLinkOverrides) : {};
}

export type DungeonLinkFile = {
    cacheRevision: number;
    generated: string;
    sources: { name: string; ref?: string; url?: string; license?: string }[];
    links: DungeonLink[];
};

const isTile = (value: unknown): value is Tile =>
    Array.isArray(value) && value.length === 3 && value.every((n) => Number.isInteger(n));

/** Validates a parsed link file; throws on the first malformed entry. */
export function validateDungeonLinkFile(raw: unknown): DungeonLinkFile {
    const file = raw as Partial<DungeonLinkFile> | undefined;
    if (!file || !Number.isInteger(file.cacheRevision) || typeof file.generated !== "string" || !Array.isArray(file.sources) || !Array.isArray(file.links)) {
        throw new Error("dungeon-links.json needs cacheRevision, generated, sources and links");
    }
    const seen = new Set<string>();
    file.links.forEach((link, index) => {
        const where = `dungeon-links.json link ${index}`;
        if (!Number.isInteger(link.locId) || typeof link.name !== "string" || typeof link.action !== "string" || !isTile(link.from) || !isTile(link.to)) {
            throw new Error(`${where}: needs locId, name, action, from and to`);
        }
        if (typeof link.source !== "string" || link.source === "") {
            throw new Error(`${where}: every link records its source`);
        }
        const key = `${link.locId}:${link.from.join(",")}:${link.action.toLowerCase()}`;
        if (seen.has(key)) throw new Error(`${where}: duplicate link ${key}`);
        seen.add(key);
    });
    return file as DungeonLinkFile;
}

export function readDungeonLinkFile(file: string): DungeonLinkFile | undefined {
    return fs.existsSync(file) ? validateDungeonLinkFile(JSON.parse(fs.readFileSync(file, "utf8"))) : undefined;
}

const tileKey = (plane: number, x: number, y: number, id: number) => `${plane}:${x}:${y}:${id}`;

/** Links by the loc that carries them: its collision plane, south-west tile and id. */
export class DungeonLinkIndex {
    private readonly byLoc = new Map<string, DungeonLink[]>();

    constructor(readonly links: DungeonLink[]) {
        for (const link of links) {
            const key = tileKey(link.from[2], link.from[0], link.from[1], link.locId);
            this.byLoc.set(key, [...(this.byLoc.get(key) ?? []), link]);
        }
    }

    /** The links of the loc `id` standing at (x, y) on collision plane `plane`. */
    linksForLoc(plane: number, x: number, y: number, id: number): DungeonLink[] {
        return this.byLoc.get(tileKey(plane, x, y, id)) ?? [];
    }

    /** The open model's loc id if one link names it. */
    openIdFor(plane: number, x: number, y: number, id: number): number | undefined {
        return this.linksForLoc(plane, x, y, id).find((l) => l.openId !== undefined)?.openId;
    }

    /** Link count by key, to report how many were attached. */
    get size(): number {
        return this.links.length;
    }
}

/** The format's own shape of a link: where, not which loc. */
export function toLocLink(link: DungeonLink): LocLink {
    return { action: link.action, x: link.to[0], y: link.to[1], plane: link.to[2], ...(link.dungeon ? { dungeon: link.dungeon } : {}) };
}

const squareKey = (mapX: number, mapY: number) => (mapX << 8) | mapY;
const squareOf = (tileX: number, tileY: number): [number, number] => [tileX >> 6, tileY >> 6];

export type DungeonSelection = {
    /** Non-surface map squares to export, as [mapX, mapY]. */
    squares: [number, number][];
    /** Connected groups of those squares with their bounding box. */
    components: { squares: number; bounds: [number, number, number, number]; links: number }[];
};

/**
 * The dungeon squares reachable from the surface: the squares surface links arrive in, grown by
 * flood fill through neighbouring non-surface squares that exist, then repeated for links that
 * start in newly added squares. `edgeOpen` can tighten adjacency (default: any neighbour counts).
 */
export function selectDungeonSquares(
    links: DungeonLink[],
    exists: (mapX: number, mapY: number) => boolean,
    edgeOpen: (a: [number, number], b: [number, number]) => boolean = () => true,
    excluded: ReadonlySet<number> = new Set(),
): DungeonSelection {
    const chosen = new Map<number, [number, number]>();
    const queue: [number, number][] = [];
    const add = (mapX: number, mapY: number) => {
        const key = squareKey(mapX, mapY);
        if (mapY <= SURFACE_MAX_MAP_Y || chosen.has(key) || excluded.has(key) || !exists(mapX, mapY)) return;
        chosen.set(key, [mapX, mapY]);
        queue.push([mapX, mapY]);
    };

    const fromSquare = new Map<number, DungeonLink[]>();
    for (const link of links) {
        const key = squareKey(...squareOf(link.from[0], link.from[1]));
        fromSquare.set(key, [...(fromSquare.get(key) ?? []), link]);
    }
    for (const link of links) {
        if (isSurfaceTile(link.from[1])) add(...squareOf(link.to[0], link.to[1]));
    }
    while (queue.length > 0) {
        const [mapX, mapY] = queue.shift()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (edgeOpen([mapX, mapY], [mapX + dx, mapY + dy])) add(mapX + dx, mapY + dy);
        }
        for (const link of fromSquare.get(squareKey(mapX, mapY)) ?? []) {
            add(...squareOf(link.to[0], link.to[1]));
        }
    }

    // Components by 4-connectivity of the chosen squares.
    const seen = new Set<number>();
    const components: DungeonSelection["components"] = [];
    for (const [key, start] of chosen) {
        if (seen.has(key)) continue;
        const stack = [start];
        seen.add(key);
        let count = 0;
        let linkCount = 0;
        const bounds: [number, number, number, number] = [start[0], start[1], start[0], start[1]];
        while (stack.length > 0) {
            const [mx, my] = stack.pop()!;
            count++;
            linkCount += fromSquare.get(squareKey(mx, my))?.length ?? 0;
            bounds[0] = Math.min(bounds[0], mx);
            bounds[1] = Math.min(bounds[1], my);
            bounds[2] = Math.max(bounds[2], mx);
            bounds[3] = Math.max(bounds[3], my);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const next = squareKey(mx + dx, my + dy);
                if (chosen.has(next) && !seen.has(next)) {
                    seen.add(next);
                    stack.push([mx + dx, my + dy]);
                }
            }
        }
        components.push({ squares: count, bounds, links: linkCount });
    }
    return { squares: [...chosen.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]), components };
}
