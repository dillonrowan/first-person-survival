import { ADJACENT } from "./AttackStyle";
import type { CombatContext, Npc, NpcBehaviour } from "./Npc";
import type { NpcAttack } from "./NpcAttacks";

/**
 * Obor, the hill giant boss of the Edgeville Dungeon [OSRS Wiki: Obor].
 *
 * - He clubs a player next to him and throws at anyone further ("a melee attack he can use when in
 *   melee range of the player, and a ranged attack that he can use from any distance").
 * - Out of his reach he mostly stands and throws: after each throw he has a 1 in 3 chance of coming
 *   after the player instead, until his next attack.
 * - Next to him he clubs two attacks in three and throws the third (the wiki's odds without
 *   protection prayers, which this game has none of, are not given; these are its odds with
 *   Protect from Missiles).
 * - His slam: each club has a 25% chance to knock the player back, and a knock back has a 1 in 3
 *   chance to knock them down.
 * - He is aggressive: a player climbing down into his arena starts the fight. He resets when the
 *   player leaves it.
 */

export const OBOR_ID = 7416;

/** His sequences on the giant skeleton, baked as extra clips (npc-attack-overrides extraSeqs). */
export const OBOR_SEQ = {
    death: 4653, // GIANT_UPDATE_BASIC_DEATH
} as const;

/** His arena (exported collision of map square 48,153): floor x 3084..3099, y 9797..9804. */
export const ARENA = { minX: 3084, maxX: 3100, minY: 9797, maxY: 9805, plane: 0 } as const;

/** Chance a throw at a player out of his reach is followed by him coming after them [wiki: 1/3]. */
export const APPROACH_CHANCE = 1 / 3;
/** Next to him: relative odds of a club against a throw [wiki, with Protect from Missiles: 1/3 ranged]. */
const CLUB_WEIGHT = 2;
const THROW_WEIGHT = 1;
/** His slam [wiki: 25% knock back, 1/3 of those knocked down]. */
export const SLAM = { chance: 0.25, downChance: 1 / 3 } as const;

export type OborMode = "waiting" | "fighting";

/** True if (x, y) is on his arena's floor. */
export function inArena(x: number, y: number, plane: number): boolean {
    return plane === ARENA.plane && x >= ARENA.minX && x < ARENA.maxX && y >= ARENA.minY && y < ARENA.maxY;
}

export class OborFight implements NpcBehaviour {
    mode: OborMode = "waiting";
    goal: NpcBehaviour["goal"];
    readonly deathSeq = OBOR_SEQ.death;
    /** Coming after the player (until his next attack) instead of standing and throwing. */
    approaching = false;
    private readonly home: { x: number; y: number };

    constructor(
        private readonly npc: Npc,
        private readonly random: () => number,
    ) {
        npc.combatant.steadfast = true;
        this.home = { x: npc.body.x, y: npc.body.y };
        for (const a of npc.attacker.all) {
            if (a.style === "melee") {
                a.maxGap = ADJACENT;
                a.weight = CLUB_WEIGHT;
                a.knockBack = SLAM;
            } else {
                a.minGap = 0;
                a.weight = THROW_WEIGHT;
            }
        }
        this.setFighting(false);
    }

    update(npc: Npc, dt: number, ctx: CombatContext): void {
        if (npc.combatant.dead) {
            this.goal = undefined;
            return;
        }
        const player = ctx.player;
        const inside = !!player && inArena(player.x, player.y, player.plane);
        if (this.mode === "waiting") {
            if (inside) {
                npc.becomeAlerted(player.x, player.y);
                this.mode = "fighting";
                this.setFighting(true);
            } else {
                // Back to where he stands, waiting for the next player; he does not wander about.
                npc.hold(2);
                this.goal = { ...this.home, run: false };
                return;
            }
        } else if (!inside || !npc.alerted) {
            this.reset();
            return;
        }
        const started = npc.attacker.started;
        if (started) {
            this.approaching = this.choosesToApproach(started);
        }
        // Coming after the player, he walks as any NPC does; otherwise he stands and faces them.
        const here = { x: npc.body.x, y: npc.body.y };
        this.goal = this.approaching
            ? undefined
            : { ...here, run: false, faceX: player.x - npc.body.x, faceY: player.y - npc.body.y };
    }

    /** After a throw at a player out of his reach, a 1 in 3 chance he comes after them. */
    private choosesToApproach(attack: NpcAttack): boolean {
        return attack.style !== "melee" && this.random() < APPROACH_CHANCE;
    }

    private setFighting(fighting: boolean): void {
        this.npc.attacker.allow = () => fighting;
    }

    /** Back to the start: full health, at home, waiting for the next player. */
    reset(): void {
        const c = this.npc.combatant;
        if (!c.dead) c.health = c.maxHealth;
        this.mode = "waiting";
        this.approaching = false;
        this.goal = { ...this.home, run: false };
        this.setFighting(false);
    }
}
