import { describe, expect, it } from "vitest";

import { Candidate, isCandidateState, verbDirection } from "./DungeonCandidates";
import {
    arrivalBeside, cleanSectionName, dungeonNameFor, findOpenInCache, findOpenInRows, isClosedHatch, nearestRow,
    isTransportOption, pairAcrossSurface, parseTransportRows, rowsForCandidate,
} from "./DungeonLinkResolver";

function candidate(over: Partial<Candidate> & { name?: string; actions?: string[] }): Candidate {
    const { name = "Ladder", actions = ["Climb-down"], ...rest } = over;
    return {
        id: 1, states: [{ id: over.id ?? 1, name, actions }], x: 3200, y: 3200, level: 0, plane: 0, type: 10, rotation: 0,
        sizeX: 1, sizeY: 1, mapFunctionId: -1, surface: true, ...rest,
    };
}

const TSV = [
    "# Origin\tDestination\tmenuOption menuTarget objectID\tSkills\tItems\tQuests",
    "# Lumbridge\t\t\t",
    "3210 3216 0\t3210 9616 0\tClimb-down Trapdoor 14880\t\t\t",
    "# Dwarven Mine - extra note\t\t\t",
    "3018 3450 0\t3018 9850 0\tClimb-down Trapdoor 11867\t60 Mining\t\tCook's Assistant",
    "\t3200 3200 0\tCast Teleport 0",
].join("\n");

describe("transport file parsing", () => {
    // Rows carry origin, destination, option, object id and requirements; headings become sections.
    it("parses rows with their section and requirements", () => {
        const rows = parseTransportRows(TSV);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ origin: [3210, 3216, 0], dest: [3210, 9616, 0], option: "Climb-down", target: "Trapdoor", objectId: 14880, section: "Lumbridge" });
        expect(rows[1].section).toBe("Dwarven Mine");
        expect(rows[1].requires).toEqual(["skills: 60 Mining", "quests: Cook's Assistant"]);
    });

    // Each file orders its requirement columns differently (the lever file has none), by its header.
    it("reads requirement columns by the header's names", () => {
        const levers = parseTransportRows(["# Origin\tDestination\tmenuOption menuTarget objectID\tDuration", "3067 10253 0\t2271 4680 0\tPull Lever 1816\t5"].join("\n"));
        expect(levers[0]).toMatchObject({ option: "Pull", target: "Lever", objectId: 1816, requires: [] });
        const portals = parseTransportRows(["# Origin\tDestination\tmenuOption menuTarget objectID\tItems\tQuests\tVarbits", "1 6400 0\t2 6400 0\tUse Portal 20786\t\tA quest\t"].join("\n"));
        expect(portals[0].requires).toEqual(["quests: A quest"]);
    });

    // Levers and portals move the player; doors (which swing in the game) and dialogue options do not.
    it("tells transport options from others", () => {
        expect(["Pull", "Use", "Enter", "Pass-Through", "Climb-down"].every(isTransportOption)).toBe(true);
        expect(["Open", "Talk-to", "Check-Fee"].some(isTransportOption)).toBe(false);
    });

    // Sub-headings and notes are not dungeon names.
    it("cleans section names", () => {
        expect(cleanSectionName("Ice Queen's lair - Ladders phase one")).toBe("Ice Queen's lair");
        expect(cleanSectionName("Inside")).toBe("");
        expect(cleanSectionName("Karamja (varbit:4566=0?COINS=200)")).toBe("Karamja");
    });
});

describe("candidate verbs", () => {
    // Direction comes from the verb; Open only counts for trapdoor-like names.
    it("classifies verbs and states", () => {
        expect(verbDirection("Climb-down")).toBe("down");
        expect(verbDirection("Leave")).toBe("up");
        expect(verbDirection("Climb")).toBeUndefined();
        expect(isCandidateState("Manhole", ["Open"])).toBe(true);
        expect(isCandidateState("Door", ["Open"])).toBe(false);
    });
});

describe("hatches", () => {
    const closed = candidate({ id: 1579, name: "Trapdoor", actions: ["Open"] });

    // A closed trapdoor is found by name and verb, and its open model by a nearby id with Climb-down.
    it("finds the open model in the cache or the transport rows", () => {
        expect(isClosedHatch(closed)).toBe(true);
        const lookup = (id: number) => (id === 1581 ? { name: "Trapdoor", actions: ["Climb-down", "Close"] } : undefined);
        expect(findOpenInCache(closed, lookup)).toEqual({ openId: 1581, method: "neighbour-id" });
        expect(findOpenInCache(closed, () => undefined)).toBeUndefined();
        const rows = parseTransportRows("# A\t\n3097 3468 0\t3096 9867 0\tClimb-down Trapdoor 1581\t\t");
        expect(findOpenInRows(candidate({ id: 1579, name: "Trapdoor", actions: ["Open"], x: 3097, y: 3469 }), rows)).toEqual({ openId: 1581, method: "external" });
    });
});

describe("matching", () => {
    // Rows match a loc by object id and a standing tile within one tile of its footprint.
    it("matches rows by id and position", () => {
        const c = candidate({ id: 14880, name: "Trapdoor", x: 3209, y: 3216 });
        const rows = parseTransportRows(TSV);
        expect(rowsForCandidate(c, rows)).toHaveLength(1);
        expect(rowsForCandidate({ ...c, x: 3300 }, rows)).toHaveLength(0);
        expect(nearestRow(c, rows.concat(rows))).toBe(rows[0]);
    });

    // An arrival beside a rotated partner is on the side it faces.
    it("places arrival on the facing side", () => {
        expect(arrivalBeside(candidate({ x: 10, y: 10, rotation: 0 }))).toEqual([9, 10, 0]);
        expect(arrivalBeside(candidate({ x: 10, y: 10, rotation: 1 }))).toEqual([10, 11, 0]);
        expect(arrivalBeside(candidate({ x: 10, y: 10, rotation: 2, sizeX: 2 }))).toEqual([12, 10, 0]);
    });

    // A dungeon takes the section of the nearest underground exit, not the surface section.
    it("names the dungeon from nearby underground rows", () => {
        const rows = parseTransportRows(["# Varrock\t", "3237 3458 0\t3237 9858 0\tClimb-down Manhole 882\t\t", "# Varrock Sewers\t", "3237 9858 0\t3237 3458 0\tClimb-up Ladder 17384\t\t"].join("\n"));
        expect(dungeonNameFor(rows[0], rows)).toBe("Varrock Sewers");
    });
});

describe("pairing across the surface", () => {
    const entrance = candidate({ x: 3000, y: 3150 });
    const exit = (dx: number, dy: number) => candidate({ id: 2, x: 3000 + dx, y: 9550 + dy, surface: false, actions: ["Climb-up"] });

    // A single exit near +6400 is the partner; several close together are ambiguous.
    it("pairs unique partners and rejects ambiguous ones", () => {
        expect(pairAcrossSurface(entrance, [exit(1, 0)]).kind).toBe("pair");
        expect(pairAcrossSurface(entrance, [exit(1, 0), exit(0, 1)]).kind).toBe("ambiguous");
        expect(pairAcrossSurface(entrance, [exit(1, 0), exit(6, 0)]).kind).toBe("pair");
        expect(pairAcrossSurface(entrance, [exit(30, 0)]).kind).toBe("none");
    });
});
