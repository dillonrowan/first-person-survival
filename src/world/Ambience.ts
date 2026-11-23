// The look of the underground: sky and fog fade to near-black below the surface band of the map.

/** First world tile row of the dungeon band: map squares north of y 65 (64 tiles each) are underground. */
export const UNDERGROUND_Y = 66 * 64;

export function isUnderground(tileY: number): boolean {
    return tileY >= UNDERGROUND_Y;
}

/** Colour of dark places, as 0..1 display channels. */
const DARK = [0.02, 0.02, 0.03] as const;
/** Seconds to fade between the surface and dungeon look. */
const FADE_SECONDS = 1.2;

/** A colour whose channels can be written in place (THREE.Vector3 fits). */
export type MutableColor = { x: number; y: number; z: number };

/**
 * Blends a shared fog colour and the clear colour between the surface sky and darkness. The fog
 * vector is written in place, because every world material reads the same one.
 */
export class Ambience {
    /** 0 on the surface, 1 fully underground. */
    level = 0;

    constructor(
        private readonly sky: readonly [number, number, number],
        private readonly fog: MutableColor,
        private readonly setClear: (r: number, g: number, b: number) => void,
    ) {}

    /** Moves towards the look of the tile row the player stands on. */
    update(dt: number, playerTileY: number): void {
        const target = isUnderground(playerTileY) ? 1 : 0;
        const step = dt / FADE_SECONDS;
        this.level = target > this.level ? Math.min(target, this.level + step) : Math.max(target, this.level - step);
        const channel = (i: 0 | 1 | 2) => this.sky[i] + (DARK[i] - this.sky[i]) * this.level;
        this.fog.x = channel(0);
        this.fog.y = channel(1);
        this.fog.z = channel(2);
        this.setClear(this.fog.x, this.fog.y, this.fog.z);
    }
}
