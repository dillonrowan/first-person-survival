import { describe, expect, it } from "vitest";

import { combatStatsFor } from "./NpcCombatStats";
import type { WikiAttackRow } from "./fetch-wiki-attacks";

const npc = (over: Partial<Parameters<typeof combatStatsFor>[0]> = {}) => ({
    stats: [1, 1, 1, 1, 1, 1],
    hasStats: false,
    combatLevel: 1,
    ...over,
});
const row = (over: Partial<WikiAttackRow> = {}): WikiAttackRow => ({ page: "X", styles: [], ...over });

describe("combatStatsFor", () => {
    it("takes levels from the cache when it has them", () => {
        const s = combatStatsFor(
            npc({ stats: [3, 4, 5, 6, 1, 1], hasStats: true }),
            row({ stats: { hitpoints: 99 } }),
        );
        expect(s.hitpoints).toBe(6);
        expect(s.attack).toBe(3);
        expect(s.defence).toBe(4);
        expect(s.strength).toBe(5);
    });

    it("reads bonuses from params and fills gaps from the wiki", () => {
        const s = combatStatsFor(
            npc({ params: new Map<number, unknown>([[5, -15], [10, -15]]) }),
            row({ stats: { attackBonus: -21, defStandard: -15 } }),
        );
        expect(s.defenceBonus.stab).toBe(-15);
        expect(s.strengthBonus).toBe(-15);
        expect(s.attackBonus).toBe(-21);
        expect(s.defenceBonus.standard).toBe(-15);
        expect(s.defenceBonus.slash).toBe(0);
    });

    it("picks the melee type from the wiki style text", () => {
        const crush = row({ styles: [{ style: "melee", raw: "Crush" }] });
        expect(combatStatsFor(npc(), crush).meleeType).toBe("crush");
        const plain = row({ styles: [{ style: "melee", raw: "Melee" }] });
        expect(combatStatsFor(npc(), plain).meleeType).toBe("slash");
    });

    it("keeps the wiki max hits per style and the speed", () => {
        const s = combatStatsFor(
            npc(),
            row({
                speedTicks: 6,
                styles: [
                    { style: "melee", raw: "Slash", maxHit: 8 },
                    { style: "dragonfire", raw: "Dragonfire", maxHit: 50 },
                ],
            }),
        );
        expect(s.maxHit).toEqual({ melee: 8, dragonfire: 50 });
        expect(s.speedTicks).toBe(6);
    });

    it("turns the wiki starting poison damage into a severity, and keeps immunity", () => {
        const s = combatStatsFor(npc(), row({ stats: { poisonous: 11, poisonImmune: true } }));
        expect(s.poisonSeverity).toBe(55);
        expect(s.poisonImmune).toBe(true);
        expect(combatStatsFor(npc(), row()).poisonSeverity).toBeUndefined();
    });

    it("falls back to the combat level for hitpoints", () => {
        const s = combatStatsFor(npc({ combatLevel: 13 }));
        expect(s.hitpoints).toBe(13);
        expect(s.attack).toBe(1);
        expect(s.speedTicks).toBe(4);
    });
});
