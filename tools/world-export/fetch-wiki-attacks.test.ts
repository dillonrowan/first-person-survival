import { describe, expect, it } from "vitest";

import { WikiAttackRow, parseMaxHits, parsePoisonous, rowToEntry } from "./fetch-wiki-attacks";

const styles = (...names: string[]): WikiAttackRow["styles"] => names.map((s) => ({ style: s as never, raw: s }));

describe("parseMaxHits", () => {
    it("reads labelled max hits", () => {
        const s = styles("melee", "dragonfire");
        parseMaxHits(["8 (Slash)", "50 (Dragonfire)"], s);
        expect(s.map((x) => x.maxHit)).toEqual([8, 50]);
    });

    it("applies a bare number to every style", () => {
        const s = styles("magic", "ranged", "melee");
        parseMaxHits(["28"], s);
        expect(s.map((x) => x.maxHit)).toEqual([28, 28, 28]);
    });

    it("reads 'N Label' text", () => {
        const s = styles("magic", "melee");
        parseMaxHits(["13 Magic; 9 Melee"], s);
        expect(s.map((x) => x.maxHit)).toEqual([13, 9]);
    });

    it("skips specials and applies the first plain number", () => {
        const s = styles("ranged", "melee");
        parseMaxHits(["14 (standard); 24 (special)"], s);
        expect(s.map((x) => x.maxHit)).toEqual([14, 14]);
    });
});

describe("rowToEntry", () => {
    it("builds an entry with deduplicated styles", () => {
        const e = rowToEntry({
            page_name: "Green dragon",
            attack_style: ["Slash", "Dragonfire"],
            max_hit: ["8 (Slash)", "50 (Dragonfire)"],
            attack_speed: 4,
            combat_level: 79,
        });
        expect(e.page).toBe("Green dragon");
        expect(e.speedTicks).toBe(4);
        expect(e.styles.map((s) => s.style)).toEqual(["melee", "dragonfire"]);
    });

    it("falls back to melee when every style is ignored", () => {
        const e = rowToEntry({ page_name: "X", attack_style: "Typeless" });
        expect(e.styles).toEqual([{ style: "melee", raw: "Typeless" }]);
    });

    it("reads the monster stats and bonuses", () => {
        const e = rowToEntry({
            page_name: "Goblin",
            attack_style: "Crush",
            hitpoints: 5,
            attack_level: 1,
            attack_bonus: -21,
            strength_bonus: -15,
            stab_defence_bonus: -15,
            standard_range_defence_bonus: -15,
        });
        expect(e.stats?.hitpoints).toBe(5);
        expect(e.stats?.attackBonus).toBe(-21);
        expect(e.stats?.defStandard).toBe(-15);
        expect(e.stats?.defMagic).toBeUndefined();
    });

    it("reads stats given as arrays of strings", () => {
        const e = rowToEntry({ page_name: "X", attack_style: "Slash", hitpoints: ["12"] });
        expect(e.stats?.hitpoints).toBe(12);
    });

    it("reads the poison of a monster and its immunity", () => {
        const e = rowToEntry({ page_name: "Tribesman", attack_style: "Stab", poisonous: "Yes (11)", poison_resistance: "100" });
        expect(e.stats?.poisonous).toBe(11);
        expect(e.stats?.poisonImmune).toBe(true);
        const plain = rowToEntry({ page_name: "Goblin", attack_style: "Crush", poisonous: "No", poison_resistance: "0" });
        expect(plain.stats?.poisonous).toBeUndefined();
        expect(plain.stats?.poisonImmune).toBeUndefined();
    });
});

describe("parsePoisonous", () => {
    it("reads Yes (N) only", () => {
        expect(parsePoisonous("Yes (11)")).toBe(11);
        expect(parsePoisonous(["Yes (6) (Members worlds only)"])).toBe(6);
        expect(parsePoisonous("Yes")).toBeUndefined();
        expect(parsePoisonous("Yes ([[venom]])")).toBeUndefined();
        expect(parsePoisonous("[[Disease]] (5)")).toBeUndefined();
        expect(parsePoisonous(undefined)).toBeUndefined();
    });
});
