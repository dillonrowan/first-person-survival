import { describe, expect, it } from "vitest";

import { bonusesFromParams } from "../../src/world/ItemFormat";
import { ExportObj, itemInfoFor } from "./ItemExport";

const obj = (over: Partial<ExportObj> = {}): ExportObj => ({
    id: 1,
    name: "Thing",
    examine: "A thing.",
    stackable: false,
    inventoryOptions: [undefined, undefined, undefined, undefined, "Drop"],
    wearPos1: -1,
    wearPos2: -1,
    zoom2d: 2000,
    xan2d: 0,
    yan2d: 0,
    zan2d: 0,
    xOffset2d: 0,
    yOffset2d: 0,
    ...over,
});
const params = (entries: [number, unknown][]) => new Map<number, unknown>(entries);

describe("bonusesFromParams", () => {
    it("reads a bronze sword", () => {
        const { bonuses, speedTicks } = bonusesFromParams(params([[0, 4], [1, 3], [2, -2], [6, 2], [7, 1], [10, 5], [14, 4]]));
        expect(bonuses).toMatchObject({ stab: 4, slash: 3, crush: -2, defSlash: 2, defCrush: 1, strength: 5 });
        expect(speedTicks).toBe(4);
    });

    it("reads ammunition strength and magic damage", () => {
        expect(bonusesFromParams(params([[12, 7]])).bonuses.rangedStrength).toBe(7);
        expect(bonusesFromParams(params([[189, 20]])).bonuses.rangedStrength).toBe(20);
        expect(bonusesFromParams(params([[299, 150]])).bonuses.magicDamage).toBe(15);
        expect(bonusesFromParams(undefined).speedTicks).toBe(4);
    });
});

describe("itemInfoFor", () => {
    it("reads skill requirements, merging both Attack and Strength into Melee", () => {
        const staff = obj({ wearPos1: 3, params: params([[434, 6], [436, 70], [435, 0], [437, 70]]) });
        expect(itemInfoFor(staff, {}, "items/1.bin").requirements).toEqual([
            { skill: "magic", level: 70 },
            { skill: "melee", level: 70 },
        ]);
    });

    it("marks two-handed weapons", () => {
        expect(itemInfoFor(obj({ wearPos1: 3, wearPos2: 5 }), {}, "m").twoHanded).toBe(true);
        expect(itemInfoFor(obj({ wearPos1: 3 }), {}, "m").twoHanded).toBeUndefined();
    });

    it("makes rune essence stackable even though the cache does not", () => {
        expect(itemInfoFor(obj({ id: 1436, name: "Rune essence" }), {}, "m").stackable).toBe(true);
        expect(itemInfoFor(obj({ id: 7936, name: "Pure essence" }), {}, "m").stackable).toBe(true);
        expect(itemInfoFor(obj({ id: 2 }), {}, "m").stackable).toBe(false);
    });

    it("takes the heal of food from the wiki table", () => {
        expect(itemInfoFor(obj({ name: "Shrimps" }), { Shrimps: 3 }, "m").heal).toBe(3);
    });

    it("gives only worn items bonuses", () => {
        expect(itemInfoFor(obj(), {}, "m").bonuses).toBeUndefined();
        expect(itemInfoFor(obj({ wearPos1: 5 }), {}, "m").slot).toBe("shield");
    });
});
