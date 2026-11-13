import { describe, expect, it } from "vitest";

import { STYLE_CODES, STYLE_FROM_CODE, styleFromWiki } from "./AttackStyle";

describe("styleFromWiki", () => {
    it.each([
        ["Dragonfire", "dragonfire"],
        ["Icy breath", "icebreath"],
        ["Magical melee", "melee"],
        ["Ranged melee", "melee"],
        ["Magic", "magic"],
        ["Magical ranged", "magic"],
        ["Ranged magic", "magic"],
        ["Curse", "magic"],
        ["Ranged", "ranged"],
        ["Typeless Ranged", "ranged"],
        ["Stab", "melee"],
        ["Slash", "melee"],
        ["Crush", "melee"],
        ["Melee", "melee"],
        ["Melee (Crush?)", "melee"],
    ])("%s -> %s", (raw, style) => {
        expect(styleFromWiki(raw)).toBe(style);
    });

    it.each(["Typeless", "Poison", "Area of effect", "Various", "Bleed", "All", "None", "Special"])(
        "ignores %s",
        (raw) => {
            expect(styleFromWiki(raw)).toBeUndefined();
        },
    );

    it("has matching byte codes", () => {
        for (const [style, code] of Object.entries(STYLE_CODES)) {
            expect(STYLE_FROM_CODE[code]).toBe(style);
        }
    });
});
