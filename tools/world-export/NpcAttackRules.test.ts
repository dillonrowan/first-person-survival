import { describe, expect, it } from "vitest";

import { ADJACENT, RANGED_MAX } from "../../src/npc/AttackStyle";
import { attackRulesFor, magicColor } from "./NpcAttackRules";
import type { WikiAttackRow } from "./fetch-wiki-attacks";

const row = (page: string, styles: [string, number?][], speedTicks = 4): WikiAttackRow => ({
    page,
    speedTicks,
    styles: styles.map(([style, maxHit]) => ({ style: style as never, raw: style, maxHit })),
});

describe("attackRulesFor", () => {
    it("gives a green dragon melee (5) and a dragonfire breath cone at melee distance", () => {
        const { infos } = attackRulesFor(row("Green dragon", [["melee", 8], ["dragonfire", 50]]))!;
        expect(infos.map((i) => i.style)).toEqual(["melee", "dragonfire"]);
        expect(infos[0]).toMatchObject({ weight: 5, hitPow: 0.7, minGap: 0 });
        expect(infos[0].maxGap).toBeUndefined();
        expect(infos[1]).toMatchObject({ weight: 1, hitPow: 2, maxGap: ADJACENT });
        expect(infos[1].breath).toMatchObject({ length: 3, ticks: 4, element: "fire" });
        expect(infos[1].projectile).toBeUndefined();
    });

    it("gives long-range dragons a fireball from range", () => {
        const { infos } = attackRulesFor(row("Rune dragon", [["melee", 29], ["dragonfire", 50]]))!;
        expect(infos[1].maxGap).toBe(RANGED_MAX);
        expect(infos[1].projectile).toMatchObject({ kind: "fireball" });
        expect(infos[1].breath).toBeUndefined();
    });

    it("gives a King Black Dragon harder fire", () => {
        const { infos } = attackRulesFor(row("King Black Dragon", [["melee", 25], ["dragonfire", 65]]))!;
        expect(infos[1].hitPow).toBe(2.5);
    });

    it("makes wyvern breath icy and slows its attacks", () => {
        const { infos } = attackRulesFor(row("Taloned Wyvern", [["melee", 12], ["ranged", 10], ["icebreath", 55]], 6))!;
        expect(infos.find((i) => i.style === "icebreath")!.breath!.element).toBe("ice");
        expect(infos[0].cooldownScale).toBe(1.5);
    });

    it("keeps a lizardman shaman spitting only when not adjacent", () => {
        const { infos } = attackRulesFor(row("Lizardman shaman", [["melee", 31], ["ranged", 21]]))!;
        expect(infos[1]).toMatchObject({ style: "ranged", minGap: ADJACENT, maxGap: RANGED_MAX });
        expect(infos[1].projectile).toMatchObject({ kind: "spit" });
        expect(infos[1].hitPow).toBeCloseTo(0.474, 3);
    });

    it("lets an NPC without melee keep a single ranged or magic style", () => {
        const { infos } = attackRulesFor(row("Dark wizard", [["magic", 2]]))!;
        expect(infos).toHaveLength(1);
        expect(infos[0]).toMatchObject({ style: "magic", hitPow: 0.7, minGap: 0, maxGap: RANGED_MAX });
    });

    it("returns undefined for melee-only and unknown NPCs", () => {
        expect(attackRulesFor(row("Goblin", [["melee", 2]]))).toBeUndefined();
        expect(attackRulesFor(undefined)).toBeUndefined();
        // A wiki row that lists no attack style keeps the guard's strikes, not an empty list.
        expect(attackRulesFor(row("Skeleton (Forthos Ruin)", []))).toBeUndefined();
    });

    it("clamps hitPow and falls back to 0.7 without max hits", () => {
        const { infos } = attackRulesFor(row("Thing", [["melee", 1], ["magic", 100], ["ranged"]]))!;
        expect(infos.find((i) => i.style === "magic")!.hitPow).toBe(2.5);
        expect(infos.find((i) => i.style === "ranged")!.hitPow).toBe(0.7);
    });

    it("carries explicit sequence ids", () => {
        const rules = attackRulesFor(row("X", [["melee", 5], ["magic", 5]]), { X: { styles: { magic: { seq: 1234 } } } })!;
        expect(rules.seqs).toEqual({ magic: 1234 });
    });
});

describe("magicColor", () => {
    it("colours spells by caster", () => {
        expect(magicColor("Infernal Mage")).toBe(0xff7a1a);
        expect(magicColor("Dark wizard")).toBe(0xd02020);
        expect(magicColor("Wizard")).toBe(0x9b59ff);
    });
});
