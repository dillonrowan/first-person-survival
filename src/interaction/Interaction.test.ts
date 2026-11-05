import { describe, expect, it } from "vitest";

import type { Body, BodySource } from "../physics/Bodies";
import { CollisionFlag } from "../world/WorldFormat";
import { Interaction, InteractionPlayer, Target } from "./Interaction";
import { cleanName, npcTargetSource } from "./targets";

/** Fake NPCs: a body whose owner carries just the fields the target source reads. */
function fakeNpc(x: number, y: number, name: string, actions?: string[]): Body {
    return {
        x,
        y,
        z: 0,
        radius: 0.35,
        height: 1.7,
        plane: 0,
        owner: { appearance: { name, actions } },
    };
}

function source(list: Body[]): BodySource {
    return {
        collectBodies: (plane, _a, _b, _c, _d, out) => {
            out.push(...list.filter((b) => b.plane === plane));
        },
    };
}

// Looks north (yaw 0, pitch 0) from the middle of a tile.
const player: InteractionPlayer = { x: 100.5, y: 100.5, z: 0, plane: 0, yaw: 0, pitch: 0, flying: false };

function setup(npcs: Body[], flags: (x: number, y: number) => number = () => 0) {
  const prompts: string[] = [];
  const actions: [Target, string, number][] = [];
  const interaction = new Interaction(
      (_plane, x, y) => flags(x, y),
      [npcTargetSource(source(npcs) as never)],
      { setPrompt: (text) => prompts.push(text), showMessage: () => {} },
      (target, action, index) => actions.push([target, action, index]),
  );
  return { interaction, prompts, actions };
}

// A pressed key set for wasPressed.
const keys = (...codes: string[]) => ({ wasPressed: (code: string) => codes.includes(code) });

describe("Interaction", () => {
    it("targets the nearer of two NPCs in line", () => {
        const { interaction } = setup([
            fakeNpc(100.5, 104, "Far", ["Talk-to"]),
            fakeNpc(100.5, 102, "Near", ["Talk-to"]),
        ]);

        interaction.update(player, keys());

        expect(interaction.target?.label).toBe("Near");
    });

    it("targets nothing beyond range or off to the side", () => {
        const { interaction } = setup([fakeNpc(100.5, 110, "Far"), fakeNpc(104, 101, "Side")]);

        interaction.update(player, keys());

        expect(interaction.target).toBeUndefined();
    });

    it("is blocked by a wall in between but not by an object", () => {
        const wallBetween = (x: number, y: number) => (x === 100 && y === 102 ? CollisionFlag.WALL_SOUTH : 0);
        const objectBetween = (x: number, y: number) => (x === 100 && y === 102 ? CollisionFlag.OBJECT : 0);
        const npc = () => [fakeNpc(100.5, 103, "Cook", ["Talk-to"])];

        const walled = setup(npc(), wallBetween);
        walled.interaction.update(player, keys());
        expect(walled.interaction.target).toBeUndefined();

        const counter = setup(npc(), objectBetween);
        counter.interaction.update(player, keys());
        expect(counter.interaction.target?.label).toBe("Cook");
    });

    it("shows a prompt, falls back to Interact, and fires each key once per press", () => {
        const { interaction, prompts, actions } = setup([
            fakeNpc(100.5, 102, "<col=ffff00>Hans</col>", ["Talk-to", "Attack"]),
        ]);

        interaction.update(player, keys());
        interaction.update(player, keys());
        expect(prompts).toEqual(["[E] Talk-to Hans   [R] Attack"]); // unchanged text is set once

        interaction.update(player, keys("KeyE"));
        interaction.update(player, keys("KeyR"));
        interaction.update(player, keys());
        expect(actions.map(([, action, index]) => [action, index])).toEqual([
            ["Talk-to", 0],
            ["Attack", 1],
        ]);

        const plain = setup([fakeNpc(100.5, 102, "Man")]);
        plain.interaction.update(player, keys("KeyR")); // there is no second action
        expect(plain.prompts).toEqual(["[E] Interact Man"]);
        expect(plain.actions).toHaveLength(0);
    });

    it("clears the prompt when looking away or flying", () => {
        const { interaction, prompts } = setup([fakeNpc(100.5, 102, "Man", ["Talk-to"])]);

        interaction.update(player, keys());
        interaction.update({ ...player, yaw: Math.PI }, keys());
        interaction.update(player, keys());
        interaction.update({ ...player, flying: true }, keys());

        expect(prompts).toEqual(["[E] Talk-to Man", "", "[E] Talk-to Man", ""]);
    });

    it("strips colour tags from names", () => {
        expect(cleanName("<col=00ffff>Iceberg</col>")).toBe("Iceberg");
    });
});
