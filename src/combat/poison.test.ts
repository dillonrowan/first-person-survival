import { describe, expect, it } from "vitest";

import { POISON_INTERVAL, Poison, weaponPoisonSeverity } from "./Poison";

describe("Poison", () => {
    it("hits at once, then every 18 s, dropping by one every five hits", () => {
        const poison = new Poison();
        expect(poison.apply(30)).toBe(true); // weapon poison++: starts at 6
        const hits: number[] = [];
        hits.push(poison.update(0));
        for (let i = 0; i < 40; i++) {
            const d = poison.update(POISON_INTERVAL);
            if (d > 0) hits.push(d);
        }
        expect(POISON_INTERVAL).toBeCloseTo(18);
        expect(hits.slice(0, 7)).toEqual([6, 6, 6, 6, 6, 5, 5]);
        expect(hits).toHaveLength(30);
        expect(hits[hits.length - 1]).toBe(1);
        expect(poison.active).toBe(false);
    });

    it("waits the interval between hits", () => {
        const poison = new Poison();
        poison.apply(20);
        expect(poison.update(0.1)).toBe(4);
        expect(poison.update(10)).toBe(0);
        expect(poison.update(8)).toBe(4);
    });

    it("ignores a weaker poison and takes a stronger one", () => {
        const poison = new Poison();
        poison.apply(30);
        expect(poison.apply(20)).toBe(false);
        expect(poison.severity).toBe(30);
        expect(poison.apply(55)).toBe(true);
        expect(poison.damage).toBe(11);
        poison.cure();
        expect(poison.active).toBe(false);
    });
});

describe("weaponPoisonSeverity", () => {
    it("reads (p), (p+), (p++) and karambwan paste, 14 less for ranged", () => {
        expect(weaponPoisonSeverity("Bronze dagger(p)", "melee")).toBe(20);
        expect(weaponPoisonSeverity("Iron spear(p+)", "melee")).toBe(25);
        expect(weaponPoisonSeverity("Rune dagger(p++)", "melee")).toBe(30);
        expect(weaponPoisonSeverity("Dragon spear(kp)", "melee")).toBe(30);
        expect(weaponPoisonSeverity("Bronze arrow(p)", "ranged")).toBe(6);
        expect(weaponPoisonSeverity("Rune arrow(p++)", "ranged")).toBe(16);
        expect(weaponPoisonSeverity("Bronze dagger", "melee")).toBe(0);
        expect(weaponPoisonSeverity(undefined, "melee")).toBe(0);
    });
});
