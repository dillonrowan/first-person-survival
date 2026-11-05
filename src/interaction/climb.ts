import { BLOCKS_TILE } from "../physics/TileColliders";
import type { InteractiveLoc } from "../world/WorldFormat";

/** Tile rows between the surface and the dungeon copy of the same place in the OSRS map. */
export const DUNGEON_OFFSET = 6400;
const NEAR_RADIUS = 3;
const FAR_RADIUS = 16;
const TOP_PLANE = 3;

/** The parts of World climbing needs. */
export type ClimbWorld = {
    collisionFlags(plane: number, tileX: number, tileY: number): number;
    hasFloor(plane: number, x: number, y: number): boolean;
    hasRegion(x: number, y: number): boolean;
};

/** "top" and "bottom" jump all the way (the castle staircases' "Top-floor" and "Bottom-floor"). */
export type ClimbDirection = "up" | "down" | "top" | "bottom";
export type ClimbDestination = { plane: number; x: number; y: number };
export type ClimbPlan = ClimbDestination | { message: string };

const NOWHERE = "It leads nowhere you can go yet.";

/**
 * The walkable tile on `plane` nearest to `from`, searching around the ladder: first within 3
 * tiles, then within 16. Returns the tile centre.
 */
export function findArrivalTile(
    world: ClimbWorld,
    plane: number,
    centerX: number,
    centerY: number,
    from: { x: number; y: number },
    radii: readonly number[] = [NEAR_RADIUS, FAR_RADIUS],
): { x: number; y: number } | undefined {
    const cx = Math.floor(centerX);
    const cy = Math.floor(centerY);
    for (const radius of radii) {
        let best: { x: number; y: number } | undefined;
        let bestDistance = Infinity;
        for (let tx = cx - radius; tx <= cx + radius; tx++) {
            for (let ty = cy - radius; ty <= cy + radius; ty++) {
                if (
                    !world.hasFloor(plane, tx, ty) ||
                    (world.collisionFlags(plane, tx, ty) & BLOCKS_TILE) !== 0
                ) {
                    continue;
                }
                const distance = Math.hypot(tx + 0.5 - from.x, ty + 0.5 - from.y);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = { x: tx + 0.5, y: ty + 0.5 };
                }
            }
        }
        if (best) {
            return best;
        }
    }
    return undefined;
}

/** Where climbing a ladder or stair leads, or why it leads nowhere. */
export function planClimb(
    world: ClimbWorld,
    loc: Pick<InteractiveLoc, "plane" | "tileX" | "tileY" | "sizeX" | "sizeY">,
    direction: ClimbDirection,
    from: { x: number; y: number },
): ClimbPlan {
    const centerX = loc.tileX + loc.sizeX / 2;
    const centerY = loc.tileY + loc.sizeY / 2;
    const goingUp = direction === "up" || direction === "top";

    // Candidate planes in order of preference: the next one, or the farthest one that has a floor.
    const candidates: number[] = [];
    if (direction === "top") {
        for (let plane = TOP_PLANE; plane > loc.plane; plane--) {
            candidates.push(plane);
        }
    } else if (direction === "bottom") {
        if (loc.plane > 0) {
            candidates.push(0);
        }
    } else {
        candidates.push(goingUp ? loc.plane + 1 : loc.plane - 1);
    }
    // "Top-floor" must end at the top of this staircase, not on any far-away roof of a higher plane.
    const radii = direction === "top" ? [NEAR_RADIUS] : undefined;
    for (const plane of candidates) {
        if (plane >= 0 && plane <= TOP_PLANE) {
            const arrival = findArrivalTile(world, plane, centerX, centerY, from, radii);
            if (arrival) {
                return { plane, ...arrival };
            }
        }
    }
    // Dungeons are copies of the surface 6400 tiles further north; ladders connect the two.
    const surface = goingUp ? loc.tileY >= DUNGEON_OFFSET : loc.plane === 0;
    const otherY = goingUp ? loc.tileY - DUNGEON_OFFSET : loc.tileY + DUNGEON_OFFSET;
    if (surface && otherY >= 0 && world.hasRegion(loc.tileX, otherY)) {
        // The far square may not be loaded yet; the player waits for it and then steps onto land.
        return { plane: 0, x: centerX, y: otherY + (centerY - loc.tileY) };
    }
    return { message: NOWHERE };
}

/**
 * The actions worth offering for a ladder or stair. A plain "Climb" is dropped when the loc also
 * has "Climb-up" or "Climb-down", so those are not pushed out of the two action keys.
 */
export function climbActions(actions: string[]): string[] {
    const specific = actions.some((action) => /^climb-(up|down)$/i.test(action));
    return specific ? actions.filter((action) => !/^climb$/i.test(action)) : actions;
}

/** "Climb-up" and "Climb-down" say where they go; a plain "Climb" goes up if there is an up. */
export function climbDirection(
    action: string,
    world: ClimbWorld,
    loc: Pick<InteractiveLoc, "plane" | "tileX" | "tileY" | "sizeX" | "sizeY">,
    from: { x: number; y: number },
): ClimbDirection {
    if (/^top-floor$/i.test(action)) {
        return "top";
    }
    if (/^bottom-floor$/i.test(action)) {
        return "bottom";
    }
    if (/down$/i.test(action)) {
        return "down";
    }
    if (/up$/i.test(action)) {
        return "up";
    }
    return "message" in planClimb(world, loc, "up", from) ? "down" : "up";
}
