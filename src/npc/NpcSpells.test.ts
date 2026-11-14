import { describe, expect, it } from "vitest";

import { SPELL_GRAPHICS } from "../world/SpellGfxFormat";
import { NPC_SPELLS, pickNpcSpell } from "./NpcSpells";

describe("NPC spells", () => {
    it("gives the dark wizards their wiki spells, all with graphics", () => {
        expect(NPC_SPELLS[512].map((s) => s.id)).toEqual(["water-strike", "confuse"]);
        expect(NPC_SPELLS[510].map((s) => s.id)).toEqual(["earth-strike", "weaken"]);
        for (const list of Object.values(NPC_SPELLS)) {
            for (const spell of list) expect(SPELL_GRAPHICS[spell.id], spell.id).toBeDefined();
        }
    });

    it("picks one of the list at random, and nothing for NPCs without one", () => {
        expect(pickNpcSpell(512, () => 0)).toEqual({ id: "water-strike", damaging: true });
        expect(pickNpcSpell(512, () => 0.99)).toEqual({ id: "confuse", damaging: false });
        expect(pickNpcSpell(3029, () => 0)).toBeUndefined();
    });
});
