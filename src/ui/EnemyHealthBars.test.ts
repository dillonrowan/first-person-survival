import { describe, expect, it } from "vitest";

import type { Combatant } from "../combat/Combatant";
import type { Npc } from "../npc/Npc";
import { enemyHealthBarFillFraction, shouldShowEnemyHealthBar } from "./EnemyHealthBars";

type TestNpc = Pick<Npc, "gone" | "body" | "combatant">;

const npc = (
    sinceHurt: number,
    overrides: Partial<TestNpc["body"]> = {},
    healthFraction = 1,
    dead = false,
): TestNpc => ({
    gone: false,
    body: {
        x: 10,
        y: 20,
        plane: 0,
        ...overrides,
    } as TestNpc["body"],
    combatant: {
        dead,
        sinceHurt,
        healthFraction,
    } as Combatant,
});

describe("enemy health bars", () => {
    it("only appears after damage and disappears five seconds later", () => {
        expect(shouldShowEnemyHealthBar(npc(0), 10, 20, 0)).toBe(true);
        expect(shouldShowEnemyHealthBar(npc(4.999), 10, 20, 0)).toBe(true);
        expect(shouldShowEnemyHealthBar(npc(5), 10, 20, 0)).toBe(true);
        expect(shouldShowEnemyHealthBar(npc(5.001), 10, 20, 0)).toBe(false);
        expect(shouldShowEnemyHealthBar(npc(Infinity), 10, 20, 0)).toBe(false);
    });

    it("stays hidden for gone, dead, distant, or off-plane NPCs", () => {
        const dead = npc(0, {}, 1, true);
        expect(shouldShowEnemyHealthBar(dead, 10, 20, 0)).toBe(false);

        const gone = npc(0);
        gone.gone = true;
        expect(shouldShowEnemyHealthBar(gone, 10, 20, 0)).toBe(false);

        expect(shouldShowEnemyHealthBar(npc(0, { x: 22.1 }), 10, 20, 0)).toBe(false);
        expect(shouldShowEnemyHealthBar(npc(0, { plane: 1 }), 10, 20, 0)).toBe(false);
    });

    it("shows green health by its remaining fraction", () => {
        expect(enemyHealthBarFillFraction(npc(0, {}, 0.75))).toBe(0.75);
        expect(enemyHealthBarFillFraction(npc(0, {}, -0.2))).toBe(0);
        expect(enemyHealthBarFillFraction(npc(0, {}, 1.2))).toBe(1);
    });
});
