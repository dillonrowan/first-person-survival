import { Box, FlagsAt, collectTileBoxes } from "./TileColliders";

const EPSILON = 1e-4;

/**
 * Moves a square footprint (half-width `radius`) along one axis and returns the new coordinate on
 * that axis, stopped by tile colliders. Boxes the footprint already overlaps are ignored, so a bad
 * spot can be walked out of. `boxes` is scratch storage.
 */
export function sweepAxis(
    flagsAt: FlagsAt,
    plane: number,
    x: number,
    y: number,
    radius: number,
    alongX: boolean,
    delta: number,
    boxes: Box[],
): number {
    const start = alongX ? x : y;
    if (delta === 0) {
        return start;
    }
    const target = start + delta;
    const toX = alongX ? target : x;
    const toY = alongX ? y : target;

    collectTileBoxes(
        flagsAt,
        plane,
        Math.min(x, toX) - radius,
        Math.min(y, toY) - radius,
        Math.max(x, toX) + radius,
        Math.max(y, toY) + radius,
        boxes,
    );

    let resolved = target;
    for (const box of boxes) {
        if (box.minX < x + radius && box.maxX > x - radius && box.minY < y + radius && box.maxY > y - radius) {
            continue;
        }
        const [boxMin, boxMax, crossMin, crossMax, cross] = alongX
            ? [box.minX, box.maxX, box.minY, box.maxY, y]
            : [box.minY, box.maxY, box.minX, box.maxX, x];
        if (crossMax <= cross - radius || crossMin >= cross + radius) {
            continue;
        }
        if (delta > 0 && boxMin >= start + radius - EPSILON) {
            resolved = Math.min(resolved, boxMin - radius - EPSILON);
        } else if (delta < 0 && boxMax <= start - radius + EPSILON) {
            resolved = Math.max(resolved, boxMax + radius + EPSILON);
        }
    }
    return resolved;
}
