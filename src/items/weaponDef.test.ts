import { describe, expect, it } from "vitest";

import { UNARMED } from "../combat/weapons";
import type { CacheWeaponInfo } from "../world/CacheWeaponFormat";
import { weaponDefFor } from "./weaponDef";

const db = { get: (id: number) => ({ 1: { name: "Staff of air" }, 2: { name: "Poisoned dagger" } })[id as 1 | 2] as never };
const entry = (cacheId: number, name: string, family: CacheWeaponInfo["family"]): CacheWeaponInfo => ({
    id: `cache-${cacheId}`,
    cacheId,
    name,
    family,
    file: "",
    grip: [0, 0, 0],
    blade: [0, 0, 0],
});

describe("weaponDefFor", () => {
    it("is fists with nothing wielded", () => {
        expect(weaponDefFor(undefined, db, [])).toBe(UNARMED);
    });

    it("uses the exported weapon of the item, by id then by name", () => {
        const list = [entry(1, "Staff of air", "staff"), entry(9, "Poisoned dagger", "daggers")];
        expect(weaponDefFor({ id: 1, qty: 1 }, db, list)).toMatchObject({ id: "cache-1", family: "staff" });
        expect(weaponDefFor({ id: 2, qty: 1 }, db, list)).toMatchObject({ id: "cache-9", family: "daggers" });
    });

    it("falls back to a placeholder of the family the name suggests", () => {
        expect(weaponDefFor({ id: 1, qty: 1 }, db, [])).toMatchObject({ id: "cache-1", name: "Staff of air", family: "staff" });
    });
});
