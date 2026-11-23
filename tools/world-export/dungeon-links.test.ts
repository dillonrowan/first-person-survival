// Checks of the dungeon link data and how the exporter attaches it. The link file checks always
// run; the rest need the cache (npm run download-cache) and skip without it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { isCacheAvailable, readCacheFiles } from "./cache-files";
import { isSurfaceTile } from "./DungeonCandidates";
import { DUNGEON_LINKS_FILE, DungeonLinkIndex, readDungeonLinkFile, selectDungeonSquares, validateDungeonLinkFile } from "./DungeonLinks";
import { RegionBuilder } from "./RegionBuilder";
import { createWorldLoaders } from "./WorldLoaders";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CACHE = path.join(ROOT, "cache");
const file = readDungeonLinkFile(DUNGEON_LINKS_FILE);

describe("dungeon link file", () => {
    // The committed data must be valid, duplicate-free and say where every link came from.
    it.skipIf(!file)("is valid and every link has provenance", () => {
        expect(() => validateDungeonLinkFile(JSON.parse(fs.readFileSync(DUNGEON_LINKS_FILE, "utf8")))).not.toThrow();
        expect(file!.links.length).toBeGreaterThan(100);
    });

    // A malformed file fails loudly rather than exporting wrong links.
    it("rejects duplicates and links without a source", () => {
        const link = { locId: 1, name: "Ladder", action: "Climb-down", from: [1, 2, 0], to: [1, 6402, 0], dungeon: "X", source: "cache-pair" };
        const wrap = (links: unknown[]) => ({ cacheRevision: 1, generated: "", sources: [], links });
        expect(() => validateDungeonLinkFile(wrap([link, link]))).toThrow(/duplicate/);
        expect(() => validateDungeonLinkFile(wrap([{ ...link, source: "" }]))).toThrow(/source/);
    });

    // Every dungeon the surface leads into can be left again (a link back out starts near its arrival).
    it.skipIf(!file)("lets the player leave nearly every dungeon it enters", () => {
        const entrances = file!.links.filter((l) => isSurfaceTile(l.from[1]) && !isSurfaceTile(l.to[1]));
        const exits = file!.links.filter((l) => !isSurfaceTile(l.from[1]) && isSurfaceTile(l.to[1]));
        const trapped = entrances.filter((e) => !exits.some((x) => Math.hypot(x.from[0] - e.to[0], x.from[1] - e.to[1]) <= 100));
        expect(trapped.length / entrances.length).toBeLessThan(0.05);
    });
});

describe("selecting dungeon squares", () => {
    const link = (from: [number, number, number], to: [number, number, number]) => ({ locId: 1, name: "L", action: "Climb-down", from, to, dungeon: "", source: "test" });

    // Squares come from surface links, grow through existing neighbours, and follow links that start inside.
    it("floods from surface links and follows underground links", () => {
        const links = [link([100, 100, 0], [100, 6500, 0]), link([100, 6500, 0], [3000, 9000, 0])];
        const exists = (x: number, y: number) => (x === 1 && (y === 101 || y === 102)) || (x === 46 && y === 140);
        const selection = selectDungeonSquares(links, exists);
        expect(selection.squares).toEqual([[1, 101], [1, 102], [46, 140]]);
        expect(selection.components.map((c) => c.squares).sort()).toEqual([1, 2]);
    });

    // A neighbour only joins when the edge between the two is open.
    it("respects the edge check", () => {
        const links = [link([100, 100, 0], [100, 6500, 0])];
        const selection = selectDungeonSquares(links, (x, y) => x === 1 && (y === 101 || y === 102), () => false);
        expect(selection.squares).toEqual([[1, 101]]);
    });
});

describe.skipIf(!isCacheAvailable(CACHE) || !file)("links in the region export", () => {
    const loaders = createWorldLoaders(readCacheFiles(CACHE));
    const builder = new RegionBuilder(loaders, undefined, undefined, new DungeonLinkIndex(file!.links));

    // The Lumbridge castle trapdoor is a floor decoration with a Climb-down; it must carry its link.
    it("exports the Lumbridge cellar trapdoor with its link", () => {
        const region = builder.build(50, 50)!.region;
        const loc = region.interactives.find((i) => i.tileX === 3209 && i.tileY === 3216 && i.links);
        expect(loc).toBeDefined();
        expect(loc!.links![0]).toMatchObject({ action: "Climb-down", x: 3210, y: 9616, plane: 0 });
    }, 120_000);

    // The Edgeville trapdoor starts closed: its open model is exported as a second mesh to swap in.
    it("exports a closed trapdoor as a hatch with both models", () => {
        const region = builder.build(48, 54)!.region;
        const hatch = region.interactives.find((i) => i.tileX === 3097 && i.tileY === 3468);
        expect(hatch?.kind).toBe("passage");
        expect(hatch?.actions).toEqual(["Open"]);
        expect(hatch?.hatch?.openActions).toContain("Climb-down");
        expect(region.doorMeshes[hatch!.hatch!.openMesh].opaque.indices.length).toBeGreaterThan(0);
        expect(region.doorMeshes[hatch!.hatch!.closedMesh].opaque.indices.length).toBeGreaterThan(0);
    }, 120_000);

    // Every link starts at a loc the cache has: the exported region carries the link for that loc id.
    it("attaches the Stronghold of Security entrance, which does not follow +6400", () => {
        const region = builder.build(48, 53)!.region;
        const loc = region.interactives.find((i) => i.tileX === 3081 && i.tileY === 3420);
        expect(loc?.links?.[0]).toMatchObject({ x: 1859, y: 5243 });
    }, 120_000);
});
