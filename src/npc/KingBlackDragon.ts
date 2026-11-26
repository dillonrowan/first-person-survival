import { ADJACENT } from "./AttackStyle";
import type { CombatContext, Npc, NpcBehaviour } from "./Npc";

/**
 * The King Black Dragon [OSRS Wiki: King Black Dragon, King Black Dragon/Strategies]. His fight is
 * the ordinary NPC one with his own attacks: next to the player one attack in three is melee, the
 * rest (and every attack from further away) are breaths, half of them fire and half his toxic, icy
 * and shocking breaths (NpcSpells.ts, kingBlackDragon). This adds what the boss does besides:
 *
 * - He is aggressive: "players should be prepared to fight as soon as they enter the lair, as the
 *   King Black Dragon is aggressive and may attack immediately from a distance".
 * - "The Melee attack is only used when the player is standing in Melee distance."
 * - He is never knocked down, and dies with his own death animation instead of as a ragdoll.
 */

export const KING_BLACK_DRAGON_ID = 239;

/** His sequences baked as extra clips (npc-attack-overrides extraSeqs). */
export const KING_BLACK_DRAGON_SEQ = {
    death: 92, // DRAGON_DEATH
} as const;

/** His lair (exported collision of map square 35,73): floor x 2256..2293, y 4680..4711. */
export const LAIR = { minX: 2256, maxX: 2294, minY: 4680, maxY: 4712, plane: 0 } as const;

/** True if (x, y) is on his lair's floor. */
export function inLair(x: number, y: number, plane: number): boolean {
    return plane === LAIR.plane && x >= LAIR.minX && x < LAIR.maxX && y >= LAIR.minY && y < LAIR.maxY;
}

export class KingBlackDragonFight implements NpcBehaviour {
    readonly deathSeq = KING_BLACK_DRAGON_SEQ.death;

    constructor(npc: Npc) {
        npc.combatant.steadfast = true;
        for (const a of npc.attacker.all) {
            if (a.style === "melee") a.maxGap = ADJACENT;
        }
    }

    update(npc: Npc, _dt: number, ctx: CombatContext): void {
        const player = ctx.player;
        if (!npc.alerted && !npc.combatant.dead && player && inLair(player.x, player.y, player.plane)) {
            npc.becomeAlerted(player.x, player.y);
        }
    }
}
