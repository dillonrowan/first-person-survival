import { describe, expect, it } from "vitest";

import { PlayerSkills, RESTORE_INTERVAL } from "../combat/Skills";
import { xpForLevel } from "../combat/Osrs";
import { applyDrain, runHitEffects } from "./NpcHitEffects";
import { NPC_EFFECTS, drainAmount, npcGraphicIds, pickNpcSpell } from "./NpcSpells";

const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};
const skillsAt = (level: number, storage = memory()) => {
    const skills = new PlayerSkills(storage);
    skills.addXp({ melee: xpForLevel(level), defence: xpForLevel(level), ranged: xpForLevel(level), magic: xpForLevel(level) });
    return skills;
};

describe("NPC spells and effects", () => {
    it("gives the dark wizards their wiki spells and drains", () => {
        expect(NPC_EFFECTS[512].magic!.map((s) => s.name)).toEqual(["Water Strike", "Confuse"]);
        expect(NPC_EFFECTS[510].magic!.map((s) => s.name)).toEqual(["Earth Strike", "Weaken"]);
        expect(NPC_EFFECTS[512].magic![1]).toMatchObject({ damaging: false, drain: { skills: ["melee"], flat: 5 } });
    });

    it("picks one of the list, skipping a spell whose drain still lasts", () => {
        expect(pickNpcSpell(512, () => 0)?.name).toBe("Water Strike");
        expect(pickNpcSpell(512, () => 0.99)?.name).toBe("Confuse");
        expect(pickNpcSpell(3029, () => 0)).toBeUndefined();
        // The Ardougne necromancer only casts Weaken, and not again until Strength is restored.
        expect(pickNpcSpell(1025, () => 0)?.name).toBe("Weaken");
        expect(pickNpcSpell(1025, () => 0, () => true)).toBeUndefined();
    });

    it("lists every graphic the table uses for the export", () => {
        const ids = npcGraphicIds();
        for (const id of [94, 102, 1291, 276, 330, 2350, 168, 10, 27]) expect(ids).toContain(id);
    });

    it("computes drains from the current level", () => {
        expect(drainAmount({ skills: ["melee"], percent: 0.8 }, 70)).toBe(56);
        expect(drainAmount({ skills: ["melee"], percent: 0.05, flat: 1 }, 40)).toBe(3);
        expect(drainAmount({ skills: ["melee"], to: 20 }, 70)).toBe(50);
        expect(drainAmount({ skills: ["melee"], to: 20 }, 10)).toBe(0);
    });
});

describe("temporary skill drains", () => {
    it("lowers the current level, never below 0 or for Hitpoints", () => {
        const skills = skillsAt(40);
        expect(skills.drain("melee", 5)).toBe(5);
        expect(skills.current("melee")).toBe(35);
        expect(skills.level("melee")).toBe(40);
        expect(skills.drained("melee")).toBe(true);
        expect(skills.drain("defence", 99)).toBe(40);
        expect(skills.current("defence")).toBe(0);
        expect(skills.drain("hitpoints", 3)).toBe(0);
    });

    it("restores one level per skill every 60 seconds, and survives a reload", () => {
        const storage = memory();
        const skills = skillsAt(40, storage);
        skills.drain("melee", 2);
        skills.drain("magic", 1);
        expect(new PlayerSkills(storage).current("melee")).toBe(38);
        expect(skills.update(RESTORE_INTERVAL - 1)).toBe(false);
        expect(skills.update(1)).toBe(true);
        expect(skills.current("melee")).toBe(39);
        expect(skills.current("magic")).toBe(40);
        skills.update(RESTORE_INTERVAL);
        expect(skills.drained("melee")).toBe(false);
    });

    it("drains an aberrant spectre's stats only without a nose peg", () => {
        const spectre = NPC_EFFECTS[2].onHit!;
        const bare = skillsAt(70);
        runHitEffects(spectre, { missed: false, damage: 3 }, bare, () => 0, undefined, false);
        expect(bare.current("melee")).toBe(70 - 56);
        expect(bare.current("defence")).toBe(70 - 28);
        const pegged = skillsAt(70);
        runHitEffects(spectre, { missed: false, damage: 3 }, pegged, () => 0, "Nose peg", false);
        expect(pegged.drained("melee")).toBe(false);
        const missed = skillsAt(70);
        runHitEffects(spectre, { missed: true, damage: 0 }, missed, () => 0, undefined, false);
        expect(missed.drained("melee")).toBe(false);
    });

    it("throws the Mourner's vial once a fight, and Loar Shade only drains on damaging hits", () => {
        const skills = skillsAt(70);
        const first = runHitEffects(NPC_EFFECTS[9233].onHit!, { missed: false, damage: 1 }, skills, () => 0, undefined, false);
        expect(first.firedOnce).toBe(true);
        expect(skills.current("ranged")).toBe(20);
        const shade = skillsAt(50);
        runHitEffects(NPC_EFFECTS[1276].onHit!, { missed: false, damage: 0 }, shade, () => 0, undefined, false);
        expect(shade.drained("melee")).toBe(false);
        runHitEffects(NPC_EFFECTS[1276].onHit!, { missed: false, damage: 2 }, shade, () => 0, undefined, false);
        expect(shade.current("melee")).toBe(49);
    });

    it("applies a curse's drain to each of its skills", () => {
        const skills = skillsAt(30);
        expect(applyDrain(skills, { skills: ["melee", "defence"], flat: 5 })).toEqual({ melee: 5, defence: 5 });
    });
});
