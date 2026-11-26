import { onTile } from "./FallingBricks";

/**
 * The bear traps of Callisto and Artio [OSRS Wiki: Callisto/Strategies, Artio/Strategies]: at 66%
 * and 33% health the boss roars and "deploys bear traps that snare and damage players when stepped
 * on": up to 15 damage, and the player is bound for a few seconds. The traps "linger for a short
 * duration before expiring", and after the 33% roar they are laid again with every attack.
 *
 * The wiki gives neither how many traps there are, nor how long they last or bind; the values
 * marked [design] are this game's.
 */

/** Most damage a trap deals [wiki: "up to 15"]. */
export const TRAP_MAX_DAMAGE = 15;
/** Seconds a sprung trap binds the player ("a few seconds"). [design: 5 ticks] */
export const TRAP_BIND_SECONDS = 5 * 0.6;
/** Seconds a trap waits before it expires ("a short duration"). [design: 15 ticks] */
export const TRAP_SECONDS = 15 * 0.6;

export type BearTrap = {
    /** South-west corner of its tile. */
    x: number;
    y: number;
    plane: number;
    /** Seconds until it expires. */
    left: number;
};

export type TrapTarget = { x: number; y: number; plane: number };

export class BearTraps {
    readonly traps: BearTrap[] = [];

    constructor(private readonly random: () => number = Math.random) {}

    /** Lays a fresh set on these tiles; the traps still out are replaced. */
    lay(tiles: readonly { x: number; y: number }[], plane: number): void {
        this.traps.length = 0;
        for (const { x, y } of tiles) {
            this.traps.push({ x, y, plane, left: TRAP_SECONDS });
        }
    }

    /** True if an armed trap is on this tile. */
    at(x: number, y: number, plane: number): boolean {
        return this.traps.some((t) => t.plane === plane && t.x === x && t.y === y);
    }

    /** Clears every trap (the fight ended or reset). */
    clear(): void {
        this.traps.length = 0;
    }

    /**
     * Ages the traps and springs the one the player stands on. Returns the damage of each trap that
     * caught the player, and calls `sprung` for it; expired traps are removed.
     */
    update(dt: number, player: TrapTarget | undefined, sprung?: (trap: BearTrap) => void): number[] {
        const hits: number[] = [];
        for (let i = this.traps.length - 1; i >= 0; i--) {
            const trap = this.traps[i];
            trap.left -= dt;
            if (player && onTile(player, trap)) {
                this.traps.splice(i, 1);
                sprung?.(trap);
                hits.push(1 + Math.floor(this.random() * TRAP_MAX_DAMAGE));
            } else if (trap.left <= 0) {
                this.traps.splice(i, 1);
            }
        }
        return hits;
    }
}
