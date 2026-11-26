import { onTile } from "./FallingBricks";

/**
 * Vet'ion's lightning and shield bash [OSRS Wiki: Vet'ion/Strategies]: an area of tiles is marked
 * (the glow of a coming bolt, the shadow of the bash) and hits whoever still stands in it a moment
 * later. A bolt hits a 3x3 area, harder on its centre tile.
 */

export type StrikeKind = "lightning" | "bash";

export type StrikeTile = { x: number; y: number };

export type Strike = {
    kind: StrikeKind;
    /** South-west corners of the tiles it hits. */
    tiles: readonly StrikeTile[];
    /** A bolt's centre tile: the full max hit there, SPLASH_SHARE of it on the tiles around. */
    centre?: StrikeTile;
    plane: number;
    /** Max hit. */
    max: number;
    /** Seconds until it lands. */
    left: number;
};

/**
 * Share of a bolt's max hit on the tiles around its centre [wiki: "Being caught in its AoE will
 * deal light damage, while being directly on a strike will deal higher damage"]. [design]
 */
export const SPLASH_SHARE = 1 / 3;

export type StrikeHit = { strike: Strike; damage: number };

export class GroundStrikes {
    readonly pending: Strike[] = [];

    constructor(private readonly random: () => number = Math.random) {}

    /** Marks an area that lands in `seconds`. */
    add(strike: Omit<Strike, "left">, seconds: number): void {
        this.pending.push({ ...strike, left: seconds });
    }

    /** Clears every strike still to land (the fight is over). */
    clear(): void {
        this.pending.length = 0;
    }

    /**
     * Advances the strikes. Returns those that landed with the player in their area, each with its
     * damage (0 to its max hit, or to the splash share of it off a bolt's centre).
     */
    update(dt: number, player: { x: number; y: number; plane: number } | undefined): StrikeHit[] {
        const hits: StrikeHit[] = [];
        for (let i = this.pending.length - 1; i >= 0; i--) {
            const strike = this.pending[i];
            strike.left -= dt;
            if (strike.left > 0) {
                continue;
            }
            this.pending.splice(i, 1);
            if (!player || !strike.tiles.some((t) => onTile(player, { ...t, plane: strike.plane }))) {
                continue;
            }
            const direct = !strike.centre || onTile(player, { ...strike.centre, plane: strike.plane });
            const max = direct ? strike.max : Math.floor(strike.max * SPLASH_SHARE);
            hits.push({ strike, damage: Math.floor(this.random() * (max + 1)) });
        }
        return hits;
    }
}

/** The 3x3 tiles of a bolt on `centre`. */
export function boltTiles(centre: StrikeTile): StrikeTile[] {
    const tiles: StrikeTile[] = [];
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            tiles.push({ x: centre.x + dx, y: centre.y + dy });
        }
    }
    return tiles;
}
