// Turns cache candidates (DungeonCandidates) and external transport rows into dungeon links.
// Pure functions: no cache or network access, so everything here is unit tested.

import { Candidate, Direction, footprint, isSurfaceTile, transitionVerbs, verbDirection } from "./DungeonCandidates";

export type Tile = [x: number, y: number, plane: number];

/** One object transport of the RuneLite "Shortest Path" plugin (transports.tsv). */
export type ExternalRow = {
    origin: Tile;
    dest: Tile;
    option: string;
    target: string;
    objectId: number;
    requires: string[];
    /** The "# Heading" comment above the row in the file. */
    section: string;
};

export type DungeonLink = {
    locId: number;
    name: string;
    action: string;
    from: Tile;
    to: Tile;
    dungeon: string;
    source: string;
    openId?: number;
    openMethod?: string;
    requires?: string[];
    note?: string;
};

/** Rows of the transport file, pared down to the columns we use. */
export function parseTransportRows(text: string): ExternalRow[] {
    const rows: ExternalRow[] = [];
    let section = "";
    // Requirement columns by name; each Shortest Path file orders (and omits) them differently.
    let requirementColumns: [label: string, index: number][] = [["skills", 3], ["items", 4], ["quests", 5], ["varbits", 6], ["varplayers", 7]];
    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith("#")) {
            const heading = line.replace(/^#+\s*/, "").replace(/\t+$/, "").trim();
            if (heading.startsWith("Origin")) {
                const names = line.replace(/^#+\s*/, "").split("\t").map((n) => n.trim().toLowerCase());
                requirementColumns = (["skills", "items", "quests", "varbits", "varplayers"] as const)
                    .map((label): [string, number] => [label, names.indexOf(label)])
                    .filter(([, index]) => index >= 0);
                continue;
            }
            // Notes are not areas; real headings come straight after a blank-ish tab line.
            if (line.includes("\t") && heading) section = cleanSectionName(heading);
            continue;
        }
        const cols = line.split("\t");
        const origin = parseTile(cols[0]);
        const dest = parseTile(cols[1]);
        const menu = cols[2]?.trim().split(/\s+/) ?? [];
        const objectId = Number(menu[menu.length - 1]);
        if (!origin || !dest || menu.length < 3 || !Number.isInteger(objectId)) continue;
        const requires: string[] = [];
        for (const [label, index] of requirementColumns) {
            const value = cols[index]?.trim();
            if (value) requires.push(`${label}: ${value}`);
        }
        rows.push({ origin, dest, option: menu[0], target: menu.slice(1, -1).join(" "), objectId, requires, section });
    }
    return rows;
}

const GENERIC_SECTIONS = /^(inside|north|south|east|west|surface entrance|entrances?|shortcut|one way)(\s|$)/i;

/** A readable area name from a transports.tsv heading: notes, parentheticals and sub-headings dropped. */
export function cleanSectionName(heading: string): string {
    const name = heading.split(/\s+-\s+|:|\(/)[0].trim();
    return GENERIC_SECTIONS.test(name) ? "" : name;
}

function parseTile(text: string | undefined): Tile | undefined {
    const parts = text?.trim().split(/\s+/).map(Number);
    return parts && parts.length === 3 && parts.every(Number.isInteger) ? [parts[0], parts[1], parts[2]] : undefined;
}

/**
 * Options of external rows that do not move the player through the loc itself: doors swing open in
 * the game, and the rest only open a dialogue or a window.
 */
const NOT_TRANSPORT = new Set(["open", "close", "pick-lock", "unlock", "talk-to", "search", "check-fee", "peek", "look-at", "examine"]);

/** Whether an external row's option takes the player somewhere (a verb, a lever pull, a portal). */
export function isTransportOption(option: string): boolean {
    return !NOT_TRANSPORT.has(option.toLowerCase());
}

/** How a closed hatch (trapdoor, manhole) finds its open model. */
export type OpenMatch = { openId: number; method: "multiloc-state" | "neighbour-id" | "external" };

export type LocLookup = (id: number) => { name: string; actions: string[] } | undefined;

const HATCH_NAME = /trap ?door|manhole/i;

/** Whether a candidate starts closed: a hatch whose only way through is "Open". */
export function isClosedHatch(c: Candidate): boolean {
    return c.states.some((s) => HATCH_NAME.test(s.name) && s.actions.some((a) => a.toLowerCase() === "open")) &&
        !c.states.some((s) => s.actions.some((a) => /^climb-down$/i.test(a)));
}

/** The open counterpart of a closed hatch from the cache alone; undefined if there is none. */
export function findOpenInCache(c: Candidate, lookup: LocLookup): OpenMatch | undefined {
    const opens = (actions: string[]) => actions.some((a) => /^(climb-down|close)$/i.test(a));
    for (const state of c.states) {
        if (state.id !== c.id && HATCH_NAME.test(state.name) && opens(state.actions)) {
            return { openId: state.id, method: "multiloc-state" };
        }
    }
    const name = c.states[0].name;
    for (const delta of [1, 2, 3, -1, -2, -3]) {
        const other = lookup(c.id + delta);
        if (other && other.name === name && opens(other.actions)) {
            return { openId: c.id + delta, method: "neighbour-id" };
        }
    }
    return undefined;
}

function inFootprint(c: Candidate, tile: Tile, margin: number): boolean {
    const f = footprint(c);
    return tile[0] >= f.x1 - margin && tile[0] <= f.x2 + margin && tile[1] >= f.y1 - margin && tile[1] <= f.y2 + margin;
}

/** Rows that start at a loc: right object id, standing within one tile of its footprint. */
export function rowsForCandidate(c: Candidate, rows: ExternalRow[], extraIds: number[] = []): ExternalRow[] {
    const ids = new Set([...c.states.map((s) => s.id), ...extraIds]);
    return rows.filter((r) => ids.has(r.objectId) && (r.origin[2] === c.plane || r.origin[2] === c.level) && inFootprint(c, r.origin, 1));
}

/** An external row that starts at a closed hatch but names another object id: the open model. */
export function findOpenInRows(c: Candidate, rows: ExternalRow[]): OpenMatch | undefined {
    const name = c.states[0].name.toLowerCase();
    const ids = new Set(c.states.map((s) => s.id));
    const hit = rows.find(
        (r) => !ids.has(r.objectId) && r.target.toLowerCase() === name && /^climb-down$/i.test(r.option) &&
            (r.origin[2] === c.plane || r.origin[2] === c.level) && inFootprint(c, r.origin, 1),
    );
    return hit ? { openId: hit.objectId, method: "external" } : undefined;
}

/** Where a +6400 pair puts the player: the tile a partner faces (rotation 0 west, 1 north, 2 east, 3 south). */
export function arrivalBeside(partner: Candidate): Tile {
    const f = footprint(partner);
    const [dx, dy] = [[-1, 0], [0, 1], [1, 0], [0, -1]][partner.rotation & 3];
    const x = dx < 0 ? f.x1 - 1 : dx > 0 ? f.x2 + 1 : f.x1;
    const y = dy < 0 ? f.y1 - 1 : dy > 0 ? f.y2 + 1 : f.y1;
    return [x, y, partner.plane];
}

export function candidateDirections(c: Candidate): Set<Direction> {
    const dirs = new Set<Direction>();
    for (const state of c.states) {
        for (const verb of transitionVerbs(state.actions)) {
            const d = verbDirection(verb);
            if (d) dirs.add(d);
        }
    }
    if (isClosedHatch(c)) dirs.add("down");
    return dirs;
}

export type PairResult =
    | { kind: "pair"; partner: Candidate; to: Tile }
    | { kind: "none" }
    | { kind: "ambiguous"; partners: Candidate[] };

/**
 * The underground partner of a surface entrance: an "up" candidate within `radius` tiles of the
 * same spot 6400 tiles north. A unique one is the partner; several are ambiguous unless one is
 * clearly nearest (at least two tiles closer than the next).
 */
export function pairAcrossSurface(c: Candidate, underground: Candidate[], radius = 8): PairResult {
    const near = underground
        .filter((u) => Math.abs(u.x - c.x) <= radius && Math.abs(u.y - (c.y + 6400)) <= radius)
        .map((u) => ({ u, d: Math.hypot(u.x - c.x, u.y - (c.y + 6400)) }))
        .sort((a, b) => a.d - b.d);
    if (near.length === 0) return { kind: "none" };
    if (near.length === 1 || near[1].d - near[0].d >= 2) {
        return { kind: "pair", partner: near[0].u, to: arrivalBeside(near[0].u) };
    }
    return { kind: "ambiguous", partners: near.map((n) => n.u) };
}

export function tileDistance(a: Tile, b: Tile): number {
    return a[2] === b[2] ? Math.hypot(a[0] - b[0], a[1] - b[1]) : Infinity;
}

/** Whether a move touches a dungeon (either end north of the surface band). */
export function touchesUnderground(from: Tile, to: Tile): boolean {
    return !isSurfaceTile(from[1]) || !isSurfaceTile(to[1]);
}

/**
 * The rows of one (loc, action) collapsed to one destination: the row standing nearest the loc's
 * own tile (big caves list one row per standing tile, each leading to its own arrival tile).
 */
export function nearestRow(c: Candidate, rows: ExternalRow[]): ExternalRow {
    return rows.reduce((best, r) => {
        const d = (row: ExternalRow) => Math.hypot(row.origin[0] - c.x, row.origin[1] - c.y);
        return d(r) < d(best) ? r : best;
    });
}

/**
 * Names the dungeon an entrance leads into: the section of the nearest row that starts underground
 * within `radius` tiles of the arrival, else the entrance's own section.
 */
export function dungeonNameFor(row: ExternalRow, all: ExternalRow[], radius = 80): string {
    if (isSurfaceTile(row.dest[1])) return row.section;
    let best: { d: number; section: string } | undefined;
    for (const other of all) {
        if (isSurfaceTile(other.origin[1]) || other.origin[2] !== row.dest[2] && Math.abs(other.origin[2] - row.dest[2]) > 3) continue;
        const d = Math.hypot(other.origin[0] - row.dest[0], other.origin[1] - row.dest[1]);
        if (d <= radius && (!best || d < best.d)) best = { d, section: other.section };
    }
    return best?.section ?? row.section;
}
