import { describe, expect, it } from "vitest";

import { WikiAttackRow, parseMaxHits, rowToEntry } from "./fetch-wiki-attacks";

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
});
