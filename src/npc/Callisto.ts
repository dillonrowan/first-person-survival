import type { FlagsAt } from "../physics/TileColliders";
import { BLOCKS_TILE } from "../physics/TileColliders";
import { CollisionFlag } from "../world/WorldFormat";
import { ADJACENT } from "./AttackStyle";
import type { BearTraps } from "./BearTraps";
import { extraMove } from "./BossMoves";
import type { CombatContext, Npc, NpcBehaviour } from "./Npc";
import type { NpcAttack } from "./NpcAttacks";
import { BEAR_ENRAGE_GFX } from "./NpcSpells";

/**
 * Callisto, and Artio, his smaller version in Hunter's End [OSRS Wiki: Callisto, Artio and their
 * Strategies pages; the 2023 Wilderness boss rework]. Both fight the same way:
 *
 * - A crushing swipe when next to the player (Callisto 35-55, Artio 15-35): "his melee attack deals
 *   massive damage".
 * - Crescents fired across the den when the player is not next to them (Callisto up to 31, Artio
 *   17), and now and then a slow orb that throws the player 3 tiles back (NpcSpells.ts,
 *   bearKnockBack): 5 damage if they fly all 3, up to 50 if a wall stops them at once.
 * - At 66% and 33% they roar, glowing red, and "deploy bear traps all across the arena"
 *   (BearTraps.ts); after the 33% roar, new traps "with every attack".
 * - Aggressive: a player in the den is attacked at once.
 *
 * The wiki gives no number of traps; the values marked [design] are this game's. The splash of the
 * swipe and the knockback onto other players, and the bosses breaking free of the player's binds,
 * have nothing to act on here (one player, no freezing spells).
 */

/** Their sequences (NPC_CALLISTO_*), baked as extra clips (npc-attack-overrides extraSeqs). */
export const BEAR_SEQ = {
    enrage: 10015, // NPC_CALLISTO_ENRAGED01: the roar
    death: 10017, // NPC_CALLISTO_DEATH01
} as const;

/** Health fractions of the roars [wiki: "At specific health intervals (66% and 33%)"]. */
export const ROAR_AT: readonly number[] = [0.66, 0.33];
/** Speed of the knockback orb, tiles/s [wiki: "a slow magic attack"]. [design] */
export const KNOCKBACK_SPEED = 4;
/** When the traps appear, as a share of the roar's clip (its head is up, the glow at its height). [design] */
const TRAPS_AT = 0.5;

export type Arena = { minX: number; maxX: number; minY: number; maxY: number; plane: number };

export type BearBoss = {
    id: number;
    name: string;
    /** The den's floor (cache collision; Hunter's End is a copy of Callisto's Den). */
    arena: Arena;
    /** Least damage of a landed swipe [wiki: Callisto 35, Artio 15]. */
    meleeMin: number;
    /** Traps per roar. [design] */
    traps: number;
    /** The red glow of its roar. */
    enrageGfx: number;
};

export const CALLISTO: BearBoss = {
    id: 6609,
    name: "Callisto",
    arena: { minX: 3351, maxX: 3368, minY: 10317, maxY: 10337, plane: 0 },
    meleeMin: 35,
    traps: 12,
    enrageGfx: BEAR_ENRAGE_GFX.callisto,
};

export const ARTIO: BearBoss = {
    id: 11992,
    name: "Artio",
    arena: { minX: 1751, maxX: 1768, minY: 11533, maxY: 11553, plane: 0 },
    meleeMin: 15,
    traps: 8,
    enrageGfx: BEAR_ENRAGE_GFX.artio,
};

export const BEAR_BOSSES: readonly BearBoss[] = [CALLISTO, ARTIO];

/** True if (x, y) is on the den's floor. */
export function inArena(arena: Arena, x: number, y: number, plane: number): boolean {
    return plane === arena.plane && x >= arena.minX && x < arena.maxX && y >= arena.minY && y < arena.maxY;
}

/** What the fight needs of the rest of the game. */
export type BearWorld = {
    traps: BearTraps;
    random(): number;
    /** True if the player could stand on the tile (a trap may go there). */
    open(x: number, y: number, plane: number): boolean;
    /** The roar began: the boss glows red. */
    roar?(npc: Npc, boss: BearBoss): void;
};

export class CallistoFight implements NpcBehaviour {
    readonly deathSeq = BEAR_SEQ.death;
    /** The roar that lays the traps, started by the fight only. */
    readonly roar: NpcAttack;
    /** ROAR_AT thresholds already roared at this fight. */
    readonly roared = new Set<number>();
    fighting = false;
    /** A threshold was passed while another attack played: roar once it ends. */
    private pending = false;

    constructor(
        npc: Npc,
        readonly boss: BearBoss,
        private readonly world: BearWorld,
    ) {
        npc.combatant.steadfast = true;
        for (const a of npc.attacker.all) {
            if (a.style === "melee") {
                // "His melee attack is used when he can reach his target."
                a.maxGap = ADJACENT;
                a.minHit = boss.meleeMin;
            } else if (a.style === "magic" && a.projectile) {
                a.projectile = { ...a.projectile, speed: KNOCKBACK_SPEED };
            }
        }
        this.roar = { ...extraMove(npc, BEAR_SEQ.enrage, { id: "roar", style: "melee", special: "traps" }, TRAPS_AT), weight: 0 };
        npc.attacker.extend([this.roar]);
        npc.attacker.allow = (a) => a !== this.roar;
    }

    update(npc: Npc, _dt: number, ctx: CombatContext): void {
        const player = ctx.player;
        if (npc.combatant.dead) {
            if (this.fighting) this.end();
            return;
        }
        const inside = !!player && inArena(this.boss.arena, player.x, player.y, player.plane);
        if (!this.fighting) {
            if (inside) {
                npc.becomeAlerted(player.x, player.y);
                this.fighting = true;
            }
            return;
        }
        if (!inside || !npc.alerted) {
            // The player got away: the traps go, the fight waits for them.
            this.end();
            return;
        }
        const f = npc.combatant.healthFraction;
        for (const at of ROAR_AT) {
            if (f <= at && !this.roared.has(at)) {
                this.roared.add(at);
                this.pending = true;
            }
        }
        if (this.pending && npc.attacker.force(this.roar)) {
            this.pending = false;
        }
        // After the last roar, fresh traps come with every attack.
        const started = npc.attacker.started;
        if (started && started !== this.roar && this.roared.has(ROAR_AT[ROAR_AT.length - 1])) {
            this.layTraps(npc);
        }
    }

    special(npc: Npc, attack: NpcAttack, when: "start" | "impact"): void {
        if (attack.special !== "traps") return;
        if (when === "start") this.world.roar?.(npc, this.boss);
        else this.layTraps(npc);
    }

    /** Traps on random open tiles of the den, none under the boss. */
    layTraps(npc: Npc): void {
        const { arena, traps } = this.boss;
        const r = this.world.random;
        const tiles: { x: number; y: number }[] = [];
        const taken = new Set<string>();
        const reach = npc.body.radius + 0.5;
        for (let tries = 0; tiles.length < traps && tries < traps * 20; tries++) {
            const x = arena.minX + Math.floor(r() * (arena.maxX - arena.minX));
            const y = arena.minY + Math.floor(r() * (arena.maxY - arena.minY));
            const key = `${x},${y}`;
            if (taken.has(key) || !this.world.open(x, y, arena.plane)) continue;
            if (Math.abs(x + 0.5 - npc.body.x) < reach && Math.abs(y + 0.5 - npc.body.y) < reach) continue;
            taken.add(key);
            tiles.push({ x, y });
        }
        this.world.traps.lay(tiles, arena.plane);
    }

    /** The fight is over (the player left or the boss died): no traps, the roars come again. */
    private end(): void {
        this.fighting = false;
        this.pending = false;
        this.roared.clear();
        this.world.traps.clear();
    }
}

/**
 * How far a knockback from the boss throws a player standing at (x, y): it steps up to `tiles`
 * tiles away from the boss (the nearest of the 8 directions), stopping before a wall, a blocked
 * tile or (with `blocked`) a bear trap. `clear` is the tiles flown; `trap` is true if a trap
 * stopped it.
 */
export function knockBackPath(
    flagsAt: FlagsAt,
    plane: number,
    x: number,
    y: number,
    fromX: number,
    fromY: number,
    tiles: number,
    blocked?: (x: number, y: number) => boolean,
): { clear: number; trap: boolean } {
    const dx = x - fromX;
    const dy = y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    // Within 22.5 degrees of an axis, straight along it.
    const sx = Math.abs(dx / d) > 0.383 ? Math.sign(dx) : 0;
    const sy = Math.abs(dy / d) > 0.383 ? Math.sign(dy) : 0;
    let tx = Math.floor(x);
    let ty = Math.floor(y);
    for (let clear = 0; clear < tiles; clear++) {
        if ((sx === 0 && sy === 0) || !canStep(flagsAt, plane, tx, ty, sx, sy)) {
            return { clear, trap: false };
        }
        if (blocked?.(tx + sx, ty + sy)) {
            return { clear, trap: true };
        }
        tx += sx;
        ty += sy;
    }
    return { clear: tiles, trap: false };
}

const WALL_TOWARD: Record<string, number> = {
    "1,0": CollisionFlag.WALL_EAST,
    "-1,0": CollisionFlag.WALL_WEST,
    "0,1": CollisionFlag.WALL_NORTH,
    "0,-1": CollisionFlag.WALL_SOUTH,
};

/** True if one step from tile (x, y) by (sx, sy) meets no wall or blocked tile. */
function canStep(flagsAt: FlagsAt, plane: number, x: number, y: number, sx: number, sy: number): boolean {
    if (sx !== 0 && sy !== 0) {
        // A diagonal step needs both of its sides open, as in OSRS.
        return (
            canStep(flagsAt, plane, x, y, sx, 0) &&
            canStep(flagsAt, plane, x, y, 0, sy) &&
            canStep(flagsAt, plane, x + sx, y, 0, sy) &&
            canStep(flagsAt, plane, x, y + sy, sx, 0)
        );
    }
    if (flagsAt(plane, x, y) & WALL_TOWARD[`${sx},${sy}`]) return false;
    const next = flagsAt(plane, x + sx, y + sy);
    return (next & (BLOCKS_TILE | WALL_TOWARD[`${-sx},${-sy}`])) === 0;
}
