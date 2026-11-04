import { describe, expect, it } from "vitest";

import {
    NpcSpawnRecord,
    finalizeNpcManifest,
    resolveDisplayType,
    selectNpcs,
    stripNameTags,
} from "./NpcSpawns";
import { CacheInfo } from "./rs/cache/CacheInfo";
import { NpcType } from "./rs/config/npctype/NpcType";

const osrs242: CacheInfo = {
    name: "osrs-242",
    game: "oldschool",
    environment: "live",
    revision: 242,
    timestamp: "",
    size: 0,
};

type Fields = Partial<
    Pick<
        NpcType,
        | "name"
        | "modelIds"
        | "idleSeqId"
        | "walkSeqId"
        | "size"
        | "spawnDirection"
        | "rotationSpeed"
        | "transforms"
        | "transformVarbit"
        | "combatLevel"
    >
>;

function npc(id: number, fields: Fields = {}): NpcType {
    const type = new NpcType(id, osrs242);
    type.name = "Thing";
    type.modelIds = [1];
    type.idleSeqId = 10;
    Object.assign(type, fields);
    return type;
}

function loader(types: NpcType[]) {
    const byId = new Map(types.map((t) => [t.id, t]));
    return {
        load: (id: number) => byId.get(id) ?? new NpcType(id, osrs242),
        getCount: () => byId.size,
        clearCache() {},
    };
}

const vars = { getVarbit: () => 0, getVarp: () => 0 };
const everywhere = () => true;
const spawn = (id: number, x = 3222, y = 3218, level = 0, name?: string): NpcSpawnRecord => ({
    id,
    name,
    x,
    y,
    level,
});

describe("stripNameTags", () => {
    it("removes colour markup", () => {
        expect(stripNameTags("<col=00ffff>Iceberg</col>")).toBe("Iceberg");
        expect(stripNameTags("Man")).toBe("Man");
    });
});

describe("resolveDisplayType", () => {
    it("uses a plain NPC when its name matches, ignoring colour tags", () => {
        const l = loader([npc(1, { name: "<col=00ffff>Iceberg</col>" })]);

        expect(resolveDisplayType(spawn(1, 0, 0, 0, "Iceberg"), l, vars)?.id).toBe(1);
        expect(resolveDisplayType(spawn(1, 0, 0, 0, "Gull"), l, vars)).toBeUndefined();
    });

    it("accepts any name when the spawn has none", () => {
        expect(resolveDisplayType(spawn(1), loader([npc(1)]), vars)?.id).toBe(1);
    });

    it("resolves a multi-NPC to the shown state, or to a state with the spawn's name", () => {
        const multi = npc(100, {
            name: "null",
            modelIds: undefined,
            transforms: [101, 102, -1],
            transformVarbit: 5,
        });
        const l = loader([multi, npc(101, { name: "Seagull" }), npc(102, { name: "Guard" })]);

        // All variables are 0, so state 0 (id 101) is shown.
        expect(resolveDisplayType(spawn(100, 0, 0, 0, "Seagull"), l, vars)?.id).toBe(101);
        // The spawn is another state of the same multi-NPC.
        expect(resolveDisplayType(spawn(100, 0, 0, 0, "Guard"), l, vars)?.id).toBe(102);
        expect(resolveDisplayType(spawn(100, 0, 0, 0, "Nobody"), l, vars)).toBeUndefined();
    });

    it("falls back to a matching state when the default state is empty", () => {
        const multi = npc(100, {
            name: "null",
            modelIds: undefined,
            transforms: [-1, 101, -1],
            transformVarbit: 5,
        });
        const l = loader([multi, npc(101, { name: "Fungi" })]);

        expect(resolveDisplayType(spawn(100, 0, 0, 0, "Fungi"), l, vars)?.id).toBe(101);
    });
});

describe("selectNpcs", () => {
    it("counts each reason a spawn is skipped", () => {
        const l = loader([
            npc(1),
            npc(2, { name: "Other" }),
            npc(3, { modelIds: [] }),
            npc(4, { idleSeqId: -1 }),
        ]);
        const result = selectNpcs(
            [
                spawn(1),
                spawn(1, 0, 0), // x 0, y 0 is inside the area
                spawn(1, 9000, 9000), // outside the area
                spawn(2, 3222, 3218, 0, "Wrong"),
                spawn(3),
                spawn(4),
            ],
            (mapX, mapY) => mapX < 100 && mapY < 100,
            l,
            vars,
        );

        expect(result.spawns).toHaveLength(2);
        expect(result.skipped).toEqual({
            outsideArea: 1,
            nameMismatch: 1,
            noModel: 1,
            noIdle: 1,
        });
    });

    it("shares one appearance between spawns of the same NPC", () => {
        const result = selectNpcs([spawn(1), spawn(1, 3230, 3220), spawn(2)], everywhere, loader([npc(1), npc(2)]), vars);

        expect(result.appearances.map((a) => a.id)).toEqual([1, 2]);
        expect(result.spawns.map((s) => s.appearance)).toEqual([0, 0, 1]);
        expect(result.appearances[0].file).toBe("npcs/1_1.bin");
    });

    it("takes animations, size and turn speed from the spawn NPC and the model from the shown one", () => {
        const multi = npc(100, {
            name: "Fungi",
            modelIds: undefined,
            transforms: [101, -1],
            transformVarbit: 5,
            idleSeqId: 20,
            walkSeqId: 21,
            size: 2,
            rotationSpeed: 16,
        });
        const shown = npc(101, { name: "Fungi", idleSeqId: 30, walkSeqId: 31, modelIds: [7], combatLevel: 9 });
        const result = selectNpcs([spawn(100, 3222, 3218, 0, "Fungi")], everywhere, loader([multi, shown]), vars);

        expect(result.appearances).toEqual([
            {
                id: 100,
                displayId: 101,
                name: "Fungi",
                size: 2,
                combatLevel: 9,
                rotationSpeed: 16,
                file: "npcs/100_101.bin",
                idleSeqId: 20,
                walkSeqId: 21,
            },
        ]);
    });

    it("uses the shown NPC's animations when the spawn NPC has none, and drops a walk equal to idle", () => {
        const multi = npc(100, { transforms: [101, -1], transformVarbit: 5, modelIds: undefined, idleSeqId: -1 });
        const shown = npc(101, { idleSeqId: 30, walkSeqId: 30 });
        const result = selectNpcs([spawn(100)], everywhere, loader([multi, shown]), vars);

        expect(result.appearances[0].idleSeqId).toBe(30);
        expect(result.appearances[0].walkSeqId).toBe(-1);
    });

    it("converts spawn directions to client orientations", () => {
        const l = loader([
            npc(1, { spawnDirection: 6 }),
            npc(2, { spawnDirection: 3 }),
            npc(3, { spawnDirection: 1 }),
            npc(4, { spawnDirection: 4 }),
        ]);
        const result = selectNpcs([spawn(1), spawn(2), spawn(3), spawn(4)], everywhere, l, vars);

        expect(result.spawns.map((s) => s.orientation)).toEqual([0, 512, 1024, 1536]);
    });

    it("keeps plane and tile of each spawn", () => {
        const result = selectNpcs([spawn(1, 3222, 3218, 2)], everywhere, loader([npc(1)]), vars);

        expect(result.spawns[0]).toMatchObject({ x: 3222, y: 3218, plane: 2 });
    });
});

describe("finalizeNpcManifest", () => {
    it("drops appearances that were not built together with their spawns, and renumbers", () => {
        const selection = selectNpcs(
            [spawn(1), spawn(2, 3230, 3220), spawn(3, 3231, 3221), spawn(2, 3232, 3222)],
            everywhere,
            loader([npc(1), npc(2), npc(3)]),
            vars,
        );

        const manifest = finalizeNpcManifest(selection, new Set([0, 2]), "osrs-242");

        expect(manifest.appearances.map((a) => a.id)).toEqual([1, 3]);
        expect(manifest.spawns.map((s) => [s.x, s.appearance])).toEqual([
            [3222, 0],
            [3231, 1],
        ]);
        expect(manifest.source).toBe("osrs-242");
        // The exporter-only sequence ids are not part of the game's manifest.
        expect(manifest.appearances[0]).not.toHaveProperty("idleSeqId");
    });
});
