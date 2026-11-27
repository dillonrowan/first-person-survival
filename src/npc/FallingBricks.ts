/**
 * Scurrius's Falling Bricks [OSRS Wiki: Scurrius/Strategies]: he stomps, a looming shadow marks
 * each tile a piece of rubble will hit (one on the tile the player stood on when the stomp began,
 * the others at random around the arena), and the rubble lands a moment later, hurting a player
 * still on that tile for 15-22 (solo).
 */

/** Seconds from the shadow appearing to the rubble landing (3 ticks; the wiki gives none). [design] */
export const BRICK_FALL_SECONDS = 1.8;
/** Damage of one piece (solo Scurrius) [OSRS Wiki: Scurrius, max hit 22, "15-22"]. */
export const BRICK_DAMAGE: readonly [number, number] = [15, 22];
/** How far past a tile's edge the player's centre still counts as on it, tiles. [design] */
const TILE_MARGIN = 0.15;

export type Brick = {
    /** South-west corner of the tile it falls on. */
    x: number;
    y: number;
    plane: number;
    /** Seconds until it lands. */
    left: number;
};

export type BrickTarget = { x: number; y: number; plane: number };

export class FallingBricks {
    readonly falling: Brick[] = [];

    constructor(private readonly random: () => number = Math.random) {}

    /** Marks tiles for rubble; each lands BRICK_FALL_SECONDS later. */
    drop(tiles: readonly { x: number; y: number }[], plane: number): void {
        for (const { x, y } of tiles) {
            this.falling.push({ x, y, plane, left: BRICK_FALL_SECONDS });
        }
    }

    /** Clears every piece still falling (the fight was reset). */
    clear(): void {
        this.falling.length = 0;
    }

    /**
     * Advances the rubble. Returns the damage of each piece that landed on `player`, and calls
     * `landed` for every piece that landed.
     */
    update(dt: number, player: BrickTarget | undefined, landed?: (brick: Brick) => void): number[] {
        const hits: number[] = [];
        for (let i = this.falling.length - 1; i >= 0; i--) {
            const brick = this.falling[i];
            brick.left -= dt;
            if (brick.left > 0) {
                continue;
            }
            this.falling.splice(i, 1);
            landed?.(brick);
            if (player && onTile(player, brick)) {
                const [lo, hi] = BRICK_DAMAGE;
                hits.push(lo + Math.floor(this.random() * (hi - lo + 1)));
            }
        }
        return hits;
    }
}

/** True if the player's centre stands on the tile with its south-west corner at (x, y). */
export function onTile(player: BrickTarget, tile: BrickTarget): boolean {
    return (
        player.plane === tile.plane &&
        player.x >= tile.x - TILE_MARGIN &&
        player.x < tile.x + 1 + TILE_MARGIN &&
        player.y >= tile.y - TILE_MARGIN &&
        player.y < tile.y + 1 + TILE_MARGIN
    );
}
