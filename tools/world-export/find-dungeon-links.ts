// Finds which overworld entrances lead into which dungeons. See docs/dungeon-links-findings.md.
//
//   npm run find-dungeon-links                 inventory the cache, resolve links, write data/dungeon-links.json
//   npm run find-dungeon-links -- --offline    skip the external transport download (cache pairs only)
//
// The cache holds the entrances (loc ids, positions, verbs) but not where they lead. Links come from
// pairing a surface entrance with an exit 6400 tiles north (cache-pair), and from the RuneLite
// "Shortest Path" object transports (BSD-2) matched to cache locs by object id and position.
// Hand fixes live in data/dungeon-links-overrides.json, which this script reads but never writes.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readCacheFiles } from "./cache-files";
import { Candidate, isSurfaceTile, transitionVerbs, verbDirection } from "./DungeonCandidates";
import { createEdgeOpen, listMapSquares, scanSquare } from "./DungeonInventory";
import {
    DungeonLink, ExternalRow, OpenMatch, Tile, arrivalBeside, candidateDirections, dungeonNameFor, findOpenInCache,
    findOpenInRows, isClosedHatch, isTransportOption, nearestRow, pairAcrossSurface, parseTransportRows, rowsForCandidate,
    tileDistance, touchesUnderground,
} from "./DungeonLinkResolver";
import { DUNGEON_LINKS_FILE, readDungeonNames, readDungeonOverrides, selectDungeonSquares } from "./DungeonLinks";
import { createWorldLoaders } from "./WorldLoaders";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CACHE_DIR = path.join(ROOT, "cache");
const OUT_DIR = path.join(ROOT, "tools", "world-export", "out");
const LINKS_FILE = DUNGEON_LINKS_FILE;

/** Pinned commit of Skretzo/shortest-path (BSD-2-Clause) whose transport files were used. */
const SHORTEST_PATH_SHA = "a7dd4a27f7909b30ea710a6d4a2d5b6706a13865";
const TRANSPORTS_BASE = `https://raw.githubusercontent.com/Skretzo/shortest-path/${SHORTEST_PATH_SHA}/src/main/resources/transports`;
/** The files with object transports: walking ones, levers (the King Black Dragon lever) and portals (Stronghold of Security). */
const TRANSPORT_FILES = ["transports.tsv", "teleportation_levers.tsv", "teleportation_portals.tsv", "agility_shortcuts.tsv"];
const USER_AGENT = "first-person-survival-dungeon-research (non-commercial hobby project)";

const SOURCE_EXTERNAL = `shortest-path@${SHORTEST_PATH_SHA.slice(0, 7)}`;
const DISAGREEMENT_TILES = 5;

/** Downloads the transport files into a fresh directory (untrusted data: parsed, never executed). */
async function downloadTransports(): Promise<ExternalRow[]> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shortest-path-"));
    const rows: ExternalRow[] = [];
    for (const name of TRANSPORT_FILES) {
        const response = await fetch(`${TRANSPORTS_BASE}/${name}`, { headers: { "User-Agent": USER_AGENT } });
        if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
        const file = path.join(dir, name);
        fs.writeFileSync(file, await response.text());
        rows.push(...parseTransportRows(fs.readFileSync(file, "utf8")));
    }
    return rows;
}

const linkKey = (l: Pick<DungeonLink, "locId" | "from" | "action">) => `${l.locId}:${l.from.join(",")}:${l.action.toLowerCase()}`;

async function main() {
    const offline = process.argv.includes("--offline");
    console.log("Reading cache...");
    const cache = readCacheFiles(CACHE_DIR);
    const loaders = createWorldLoaders(cache);
    const squares = listMapSquares(loaders);

    let rows: ExternalRow[] = [];
    if (!offline) {
        console.log("Downloading Shortest Path transports...");
        rows = await downloadTransports();
        console.log(`${rows.length} object transports`);
    }
    const externalIds = new Set(rows.filter((r) => isTransportOption(r.option)).map((r) => r.objectId));

    const stateCache = new Map<number, any>();
    const candidates: Candidate[] = [];
    for (const [mapX, mapY] of squares) candidates.push(...scanSquare(loaders, mapX, mapY, stateCache, externalIds));
    const surface = candidates.filter((c) => c.surface);
    const underground = candidates.filter((c) => !c.surface);
    console.log(`${squares.length} map squares, ${candidates.length} candidates (${surface.length} surface, ${underground.length} underground)`);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, "candidates.json"), JSON.stringify({ revision: cache.download.revision, candidates }));

    const lookup = (id: number) => {
        try {
            const t = loaders.locTypeLoader.load(id);
            return { name: t.name, actions: t.actions.filter((a): a is string => !!a) };
        } catch {
            return undefined;
        }
    };

    // 1. External links, matched to cache locs.
    const links = new Map<string, DungeonLink>();
    const openOf = new Map<Candidate, OpenMatch>();
    const externalDest = new Map<string, Tile>();
    for (const c of candidates) {
        let open: OpenMatch | undefined;
        if (isClosedHatch(c)) {
            open = findOpenInCache(c, lookup) ?? findOpenInRows(c, rows);
            if (open) openOf.set(c, open);
        }
        const matched = rowsForCandidate(c, rows, open ? [open.openId] : []).filter((r) => isTransportOption(r.option));
        const byAction = new Map<string, ExternalRow[]>();
        for (const r of matched) byAction.set(r.option.toLowerCase(), [...(byAction.get(r.option.toLowerCase()) ?? []), r]);
        for (const group of byAction.values()) {
            const from: Tile = [c.x, c.y, c.plane];
            // A two-way loc (a pipe, a gap) lists one row per side under one action: keep both, and the
            // game takes the one that leads away from where the player stands.
            const first = nearestRow(c, group);
            const back = group.find((r) => r !== first && tileDistance(r.dest, first.origin) <= 3 && tileDistance(r.origin, first.dest) <= 3);
            for (const row of back ? [first, back] : [first]) {
                if (!touchesUnderground(from, row.dest)) continue;
                const link: DungeonLink = {
                    locId: c.id,
                    name: c.states[0].name === "null" ? row.target : c.states[0].name,
                    action: row.option,
                    from,
                    to: row.dest,
                    dungeon: dungeonNameFor(row, rows),
                    source: SOURCE_EXTERNAL,
                    ...(open ? { openId: open.openId, openMethod: open.method } : {}),
                    ...(row.requires.length ? { requires: row.requires } : {}),
                };
                const key = row === first ? linkKey(link) : `${linkKey(link)}:${row.dest.join(",")}`;
                links.set(key, link);
                externalDest.set(key, row.dest);
            }
        }
    }
    const externalCount = links.size;

    // 2. Cache pairs: a surface entrance and the exit 6400 tiles north of it. Cross-check against the external tile.
    const undergroundUp = underground.filter((u) => candidateDirections(u).has("up"));
    const disagreements: { link: string; external: Tile; cache: Tile; distance: number }[] = [];
    let agreed = 0;
    const unresolved: { candidate: Candidate; reason: string }[] = [];
    let sameSpot = 0;
    let cachePairLinks = 0;
    for (const c of surface) {
        if (!candidateDirections(c).has("down")) continue;
        const pair = pairAcrossSurface(c, undergroundUp);
        const existing = [...links.values()].filter((l) => l.locId === c.id && l.from[0] === c.x && l.from[1] === c.y && !isSurfaceTile(l.to[1]));
        if (pair.kind === "pair") {
            if (existing.length) {
                const d = Math.hypot(existing[0].to[0] - pair.to[0], existing[0].to[1] - pair.to[1]);
                const far = existing[0].to[2] !== pair.to[2] || d > DISAGREEMENT_TILES;
                if (far) disagreements.push({ link: linkKey(existing[0]), external: existing[0].to, cache: pair.to, distance: d });
                else agreed++;
                continue;
            }
            const verb = transitionVerbs(c.states.flatMap((s) => s.actions)).find((v) => verbDirection(v) === "down") ?? "Climb-down";
            const open = openOf.get(c);
            const link: DungeonLink = {
                locId: c.id,
                name: c.states[0].name,
                action: verb,
                from: [c.x, c.y, c.plane],
                to: pair.to,
                dungeon: "",
                source: "cache-pair",
                ...(open ? { openId: open.openId, openMethod: open.method } : {}),
            };
            links.set(linkKey(link), link);
            cachePairLinks++;
            // The way back out, unless an external row already gives it.
            const upVerb = transitionVerbs(pair.partner.states.flatMap((s) => s.actions)).find((v) => verbDirection(v) === "up") ?? "Climb-up";
            const back: DungeonLink = {
                locId: pair.partner.id,
                name: pair.partner.states[0].name,
                action: upVerb,
                from: [pair.partner.x, pair.partner.y, pair.partner.plane],
                to: arrivalBeside(c),
                dungeon: "",
                source: "cache-pair",
            };
            if (!links.has(linkKey(back))) {
                links.set(linkKey(back), back);
                cachePairLinks++;
            }
            continue;
        }
        if (existing.length) continue;
        // A same-spot plane change is handled by the runtime's climb heuristic.
        const stairs = surface.some((o) => o !== c && Math.abs(o.x - c.x) <= 3 && Math.abs(o.y - c.y) <= 3 && o.plane !== c.plane && candidateDirections(o).has("up"));
        if (stairs) {
            sameSpot++;
            continue;
        }
        unresolved.push({ candidate: c, reason: pair.kind === "ambiguous" ? `ambiguous: ${pair.partners.length} exits near +6400` : "no exit near +6400 and no external transport" });
    }

    // Dungeon names for cache pairs come from the nearest named link.
    const named = [...links.values()].filter((l) => l.dungeon);
    for (const l of links.values()) {
        if (l.dungeon) continue;
        let best: DungeonLink | undefined;
        let bestD = 80;
        for (const o of named) {
            const d = tileDistance([l.to[0], l.to[1], 0], [o.from[0], o.from[1], 0]);
            if (d < bestD && !isSurfaceTile(o.from[1])) {
                best = o;
                bestD = d;
            }
        }
        l.dungeon = best?.dungeon ?? "";
    }

    // 3. Overrides: exclusions, then hand-written links.
    {
        const overrides = readDungeonOverrides();
        for (const e of overrides.exclude ?? []) {
            for (const [key, l] of links) {
                if (l.locId === e.locId && l.from.join(",") === e.from.join(",") && (!e.action || l.action.toLowerCase() === e.action.toLowerCase())) links.delete(key);
            }
        }
        for (const l of overrides.links ?? []) links.set(linkKey(l), { ...l, source: l.source ?? "override" });
        // Hand names of map squares (data/dungeon-names.json, also used by export-map) name the links into them.
        const names = readDungeonNames();
        for (const l of links.values()) l.dungeon = names.get(((l.to[0] >> 6) << 8) | (l.to[1] >> 6)) ?? l.dungeon;
    }

    const sorted = [...links.values()].sort(
        (a, b) => a.from[1] - b.from[1] || a.from[0] - b.from[0] || a.from[2] - b.from[2] || a.locId - b.locId || a.action.localeCompare(b.action),
    );

    // Acceptance checks.
    const entrances = sorted.filter((l) => isSurfaceTile(l.from[1]) && !isSurfaceTile(l.to[1]));
    const dungeons = new Set(entrances.map((l) => l.dungeon));
    const exitLinks = sorted.filter((l) => !isSurfaceTile(l.from[1]) && isSurfaceTile(l.to[1]));
    const noWayBack = entrances
        .filter((l) => !exitLinks.some((e) => Math.hypot(e.from[0] - l.to[0], e.from[1] - l.to[1]) <= 100))
        .map((l) => ({ locId: l.locId, name: l.name, from: l.from, to: l.to, dungeon: l.dungeon }));

    const sources: { name: string; ref?: string; url?: string; license?: string }[] = [{ name: "cache" }];
    if (!offline) sources.push({ name: "shortest-path", ref: SHORTEST_PATH_SHA, url: "https://github.com/Skretzo/shortest-path", license: "BSD-2-Clause" });
    fs.mkdirSync(path.dirname(LINKS_FILE), { recursive: true });
    fs.writeFileSync(
        LINKS_FILE,
        JSON.stringify({ cacheRevision: cache.download.revision, generated: cache.download.timestamp, sources, links: sorted }, null, 1) + "\n",
    );

    // How many dungeon squares the default export would take.
    const withTerrain = new Set(squares.filter(([x, y]) => loaders.sceneBuilder.getTerrainData(x, y)).map(([x, y]) => (x << 8) | y));
    const exists = (x: number, y: number) => withTerrain.has((x << 8) | y);
    const excludedSquares = new Set((readDungeonOverrides().excludeSquares ?? []).map(([x, y]) => (x << 8) | y));
    const selection = selectDungeonSquares(sorted, exists, createEdgeOpen(loaders), excludedSquares);
    const looseCount = selectDungeonSquares(sorted, exists).squares.length;

    const report = {
        dungeonSquares: { count: selection.squares.length, withoutEdgeCheck: looseCount, components: selection.components.sort((a, b) => b.squares - a.squares).slice(0, 30) },
        candidates: candidates.length,
        surfaceCandidates: surface.length,
        links: sorted.length,
        bySource: { external: externalCount, cachePair: cachePairLinks },
        entrances: entrances.length,
        dungeons: dungeons.size,
        noWayBack,
        sameSpotSurfaceStairs: sameSpot,
        crossCheck: { agreed, disagreements },
        hatchesWithoutOpenModel: candidates.filter((c) => isClosedHatch(c) && !openOf.has(c)).map((c) => ({ id: c.id, x: c.x, y: c.y })),
        unresolved: unresolved.map((u) => ({ id: u.candidate.id, name: u.candidate.states[0].name, x: u.candidate.x, y: u.candidate.y, plane: u.candidate.plane, reason: u.reason })),
    };
    fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 1));
    console.log(JSON.stringify({ ...report, unresolved: report.unresolved.length, crossCheck: { agreed, disagreements: disagreements.length }, hatchesWithoutOpenModel: report.hatchesWithoutOpenModel.length }, null, 1));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
