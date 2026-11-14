import { describe, expect, it } from "vitest";

import { MAGIC_STYLE, MELEE_STYLES, RANGED_STYLES } from "./CombatStyles";
import { meleeType, sumBonuses } from "./Equipment";
import {
    attackRate,
    combatLevel,
    environmentDamage,
    hitChance,
    levelForXp,
    npcAttackRoll,
    npcDefenceRoll,
    npcMaxHit,
    playerDefenceRoll,
    playerMagicAttack,
    playerMeleeAttack,
    playerRangedAttack,
    stochasticRound,
    xpForLevel,
} from "./Osrs";
import { SPELLS } from "./Spells";
import { NO_BONUSES } from "../world/ItemFormat";
import type { NpcCombatStats } from "../world/NpcFormat";

const BRONZE_SWORD = { ...NO_BONUSES, stab: 4, slash: 3, crush: -2, defSlash: 2, defCrush: 1, strength: 5 };
const BRONZE_MACE = { ...NO_BONUSES, stab: 1, slash: -2, crush: 6, strength: 5 };
const STAFF = { ...NO_BONUSES, slash: -1, crush: 7, magic: 4, defStab: 2, defSlash: 3, defCrush: 1, defMagic: 4, strength: 3 };
const SHORTBOW_BRONZE_ARROWS = { ...NO_BONUSES, ranged: 8, rangedStrength: 7 };
const accurate = MELEE_STYLES[0];
const aggressive = MELEE_STYLES[1];
const rangedAccurate = RANGED_STYLES[0];

const goblin: NpcCombatStats = {
    hitpoints: 5,
    attack: 1,
    strength: 1,
    defence: 1,
    ranged: 1,
    magic: 1,
    attackBonus: -21,
    strengthBonus: -15,
    rangedAttack: 0,
    rangedStrength: 0,
    magicAttack: 0,
    magicDamage: 0,
    defenceBonus: { stab: -15, slash: -15, crush: -15, magic: -15, light: -15, standard: -15, heavy: -15 },
    meleeType: "crush",
    speedTicks: 4,
    maxHit: {},
};

describe("levels and XP", () => {
    it("matches the OSRS XP table", () => {
        expect([1, 2, 3, 10, 50, 99].map(xpForLevel)).toEqual([0, 83, 174, 1154, 101333, 13034431]);
    });

    it("inverts it", () => {
        expect([82, 83, 1154, 13034431, 200000000].map(levelForXp)).toEqual([1, 2, 10, 99, 99]);
    });

    it("computes the combat level", () => {
        expect(combatLevel({ melee: 1, defence: 1, hitpoints: 10, ranged: 1, magic: 1 })).toBe(3);
        expect(combatLevel({ melee: 99, defence: 99, hitpoints: 99, ranged: 99, magic: 99 })).toBe(113);
    });
});

describe("hit chance", () => {
    it("uses the wiki formula on both sides of the roll", () => {
        expect(hitChance(816, 490)).toBeCloseTo(0.698898, 6);
        expect(hitChance(100, 200)).toBeCloseTo(0.248756, 6);
    });
});

describe("player attacks", () => {
    it("melee", () => {
        expect(playerMeleeAttack(1, accurate, BRONZE_SWORD)).toEqual({ attackRoll: 816, maxHit: 1, defenceType: "stab" });
        const whip = { ...NO_BONUSES, slash: 82, strength: 82 };
        const r = playerMeleeAttack(99, aggressive, whip);
        expect(r.maxHit).toBe(25);
        expect(r.attackRoll).toBe(107 * 146);
    });

    it("ranged", () => {
        expect(playerRangedAttack(1, rangedAccurate, SHORTBOW_BRONZE_ARROWS, false)).toEqual({
            attackRoll: 864,
            maxHit: 1,
            defenceType: "standard",
        });
        const r = playerRangedAttack(99, rangedAccurate, { ...NO_BONUSES, ranged: 69, rangedStrength: 49 }, false);
        expect(r.maxHit).toBe(19);
        expect(r.attackRoll).toBe(14630);
        expect(playerRangedAttack(1, rangedAccurate, NO_BONUSES, true).defenceType).toBe("heavy");
    });

    it("magic", () => {
        const wind = SPELLS[0];
        expect(playerMagicAttack(1, STAFF, wind)).toEqual({ attackRoll: 680, maxHit: 2, defenceType: "magic" });
        const fireWave = SPELLS.find((s) => s.id === "fire-wave")!;
        expect(playerMagicAttack(75, { ...NO_BONUSES, magicDamage: 15 }, fireWave).maxHit).toBe(23);
        expect(MAGIC_STYLE.kind).toBe("magic");
    });

    it("picks the melee type from the largest bonus", () => {
        expect(meleeType(BRONZE_SWORD)).toBe("stab");
        expect(meleeType(BRONZE_MACE)).toBe("crush");
        expect(meleeType({ ...NO_BONUSES, slash: 82 })).toBe("slash");
        expect(sumBonuses(BRONZE_SWORD, SHORTBOW_BRONZE_ARROWS).ranged).toBe(8);
    });
});

describe("NPC rolls", () => {
    it("matches the goblin", () => {
        expect(npcDefenceRoll(goblin, "stab")).toBe(490);
        expect(npcDefenceRoll(goblin, "magic")).toBe(490);
        expect(npcAttackRoll(goblin, "melee")).toBe(430);
        expect(npcMaxHit(goblin, "melee")).toBe(1);
        expect(npcMaxHit({ ...goblin, maxHit: { melee: 8 } }, "melee")).toBe(8);
        expect(npcMaxHit(goblin, "dragonfire")).toBe(50);
    });
});

describe("player defence", () => {
    it("rolls defence and magic defence", () => {
        expect(playerDefenceRoll(1, 1, NO_BONUSES, "slash", 0)).toBe(576);
        expect(playerDefenceRoll(1, 1, NO_BONUSES, "magic", 0)).toBe(576);
        expect(playerDefenceRoll(1, 1, NO_BONUSES, "slash", 3)).toBe(768);
    });
});

describe("helpers", () => {
    it("rounds stochastically", () => {
        expect(stochasticRound(2.5, () => 0.4)).toBe(3);
        expect(stochasticRound(2.5, () => 0.6)).toBe(2);
        expect(stochasticRound(3, () => 0)).toBe(3);
    });

    it("rates attacks by the share of the interval", () => {
        expect(attackRate(1.2, 2.4)).toBe(0.5);
        expect(attackRate(Infinity, 2.4)).toBe(1);
    });

    it("scales environment damage to max health", () => {
        expect(environmentDamage(30, 10)).toBe(3);
        expect(environmentDamage(5, 10)).toBe(1);
        expect(environmentDamage(0, 10)).toBe(0);
        expect(environmentDamage(20, 157)).toBe(31);
    });
});
