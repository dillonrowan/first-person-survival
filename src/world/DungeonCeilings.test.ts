import { describe, expect, it } from "vitest";

import { ceilingTheme, topLevels } from "./DungeonCeilings";
import { dungeonAt } from "./MapFormat";

describe("ceilingTheme", () => {
    // The set fits the dungeon's name; plain caves are the default, and open-sky places get none.
    it("picks a set by name", () => {
        expect(ceilingTheme("Asgarnia Ice Dungeon")).toBe("ice");
        expect(ceilingTheme("King Black Dragon Lair")).toBe("lava");
        expect(ceilingTheme("Varrock Sewers")).toBe("sewer");
        expect(ceilingTheme("Vet'ion's Rest")).toBe("crypt");
        expect(ceilingTheme("Tombs of Amascut")).toBe("sandstone");
        expect(ceilingTheme("Chambers of Xeric")).toBe("masonry");
        expect(ceilingTheme("Callisto's Den")).toBe("cave");
        expect(ceilingTheme("Zanaris")).toBeNull();
    });
});

describe("topLevels", () => {
    // A ceiling goes over the highest floor of each tile, so it never cuts through an upper floor.
    it("keeps the highest floored level per tile", () => {
        const floors = new Uint8Array(4 * 64 * 64);
        floors[0 * 4096 + 5] = 1;
        floors[0 * 4096 + 6] = 1;
        floors[2 * 4096 + 6] = 1;
        const top = topLevels(floors);
        expect([top[5], top[6], top[7]]).toEqual([0, 2, -1]);
    });
});

describe("dungeonAt", () => {
    it("finds the area holding a tile by its map square", () => {
        const areas = [{ squares: [[29, 81]] as [number, number][] }, { squares: [[35, 73], [36, 73]] as [number, number][] }];
        expect(dungeonAt(areas, 1859, 5243)).toBe(0);
        expect(dungeonAt(areas, 2340, 4700)).toBe(1);
        expect(dungeonAt(areas, 3200, 3200)).toBe(-1);
    });
});
