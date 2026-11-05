import { CollisionFlag } from "../world/WorldFormat";

export type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** Looks up the OSRS collision flags of a tile, see CollisionFlag. */
export type FlagsAt = (plane: number, tileX: number, tileY: number) => number;

export const WALL_HALF_THICKNESS = 0.08;

/** Flags that make a whole tile solid. */
export const BLOCKS_TILE =
    CollisionFlag.OBJECT | CollisionFlag.FLOOR | CollisionFlag.FLOOR_DECORATION;

const t = WALL_HALF_THICKNESS;
/** Thin box per wall flag, as [flag, minX, minY, maxX, maxY] relative to the tile's SW corner. */
const WALL_BOXES: [number, number, number, number, number][] = [
    [CollisionFlag.WALL_WEST, -t, 0, t, 1],
    [CollisionFlag.WALL_EAST, 1 - t, 0, 1 + t, 1],
    [CollisionFlag.WALL_SOUTH, 0, -t, 1, t],
    [CollisionFlag.WALL_NORTH, 0, 1 - t, 1, 1 + t],
    // Corner pieces, which stop the player cutting diagonally past a wall's end.
    [CollisionFlag.WALL_NORTH_WEST, -t, 1 - t, t, 1 + t],
    [CollisionFlag.WALL_NORTH_EAST, 1 - t, 1 - t, 1 + t, 1 + t],
    [CollisionFlag.WALL_SOUTH_EAST, 1 - t, -t, 1 + t, t],
    [CollisionFlag.WALL_SOUTH_WEST, -t, -t, t, t],
];

/**
 * Replaces `out` with the collision boxes of the tiles around the given area: solid squares for
 * blocked tiles and thin boxes along tile edges for walls. With mode "walls" only wall boxes are
 * produced (used for line of sight, where objects like counters must not block).
 */
export function collectTileBoxes(
    flagsAt: FlagsAt,
    plane: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    out: Box[],
    mode: "all" | "walls" = "all",
): void {
    out.length = 0;
    for (let tx = Math.floor(minX) - 1; tx <= Math.floor(maxX) + 1; tx++) {
        for (let ty = Math.floor(minY) - 1; ty <= Math.floor(maxY) + 1; ty++) {
            const flags = flagsAt(plane, tx, ty);
            if (flags === 0) {
                continue;
            }
            if (mode === "all" && flags & BLOCKS_TILE) {
                out.push({ minX: tx, minY: ty, maxX: tx + 1, maxY: ty + 1 });
                continue;
            }
            for (const [flag, x0, y0, x1, y1] of WALL_BOXES) {
                if (flags & flag) {
                    out.push({ minX: tx + x0, minY: ty + y0, maxX: tx + x1, maxY: ty + y1 });
                }
            }
        }
    }
}
