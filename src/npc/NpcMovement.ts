import { CollisionFlag } from "../world/WorldFormat";

// Server tick of the original game; NPCs decide where to wander once per tick.
export const SERVER_TICK_SECONDS = 0.6;
export const WANDER_CHANCE = 0.1;
export const WANDER_RADIUS = 5;
export const MAX_PATH_STEPS = 24;
export const MAX_QUEUED_STEPS = 10;

export type FlagLookup = (x: number, y: number) => number;
export type Tile = { x: number; y: number };

export function constrainMovementToEnvironment(
    x: number,
    y: number,
    nextX: number,
    nextY: number,
    matchesEnvironment: (x: number, y: number) => boolean,
): { x: number; y: number } {
    if (!matchesEnvironment(nextX, y)) {
        nextX = x;
    }
    if (!matchesEnvironment(nextX, nextY)) {
        nextY = y;
    }
    return { x: nextX, y: nextY };
}

const FLOOR_BLOCKED = CollisionFlag.FLOOR | CollisionFlag.FLOOR_DECORATION;
const SOLID = CollisionFlag.OBJECT | FLOOR_BLOCKED;
const F = CollisionFlag;

// Flags that stop an NPC entering a tile from a direction, as in the OSRS pathfinder.
const BLOCK_WEST = F.WALL_EAST | SOLID;
const BLOCK_EAST = F.WALL_WEST | SOLID;
const BLOCK_SOUTH = F.WALL_NORTH | SOLID;
const BLOCK_NORTH = F.WALL_SOUTH | SOLID;
const BLOCK_SOUTH_WEST = F.WALL_NORTH | F.WALL_NORTH_EAST | F.WALL_EAST | SOLID;
const BLOCK_SOUTH_EAST = F.WALL_NORTH_WEST | F.WALL_NORTH | F.WALL_WEST | SOLID;
const BLOCK_NORTH_WEST = F.WALL_EAST | F.WALL_SOUTH_EAST | F.WALL_SOUTH | SOLID;
const BLOCK_NORTH_EAST = F.WALL_SOUTH | F.WALL_SOUTH_WEST | F.WALL_WEST | SOLID;

function blockMask(dx: number, dy: number): number {
    if (dx === 0) {
        return dy > 0 ? BLOCK_NORTH : BLOCK_SOUTH;
    }
    if (dy === 0) {
        return dx > 0 ? BLOCK_EAST : BLOCK_WEST;
    }
    if (dx < 0) {
        return dy > 0 ? BLOCK_NORTH_WEST : BLOCK_SOUTH_WEST;
    }
    return dy > 0 ? BLOCK_NORTH_EAST : BLOCK_SOUTH_EAST;
}

function canStepSingle(flags: FlagLookup, x: number, y: number, dx: number, dy: number): boolean {
    if ((flags(x + dx, y + dy) & blockMask(dx, dy)) !== 0) {
        return false;
    }
    if (dx !== 0 && dy !== 0) {
        // A diagonal step also needs both neighbouring straight steps to be open.
        return (
            (flags(x + dx, y) & blockMask(dx, 0)) === 0 &&
            (flags(x, y + dy) & blockMask(0, dy)) === 0
        );
    }
    return true;
}

/**
 * Whether an NPC whose south-west tile is (x, y) can take one step. Larger NPCs require every
 * tile of their footprint to pass the single-tile rule (an approximation of the client's rules).
 */
export function canStep(
    flags: FlagLookup,
    x: number,
    y: number,
    dx: number,
    dy: number,
    size: number,
): boolean {
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
            if (!canStepSingle(flags, x + i, y + j, dx, dy)) {
                return false;
            }
        }
    }
    return true;
}

const DIRECTIONS: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
];

/**
 * Shortest 8-way path from one tile to another that stays within WANDER_RADIUS of the spawn.
 * Returns the tiles after the start (at most MAX_PATH_STEPS), or [] if unreachable.
 */
export function findWanderPath(
    flags: FlagLookup,
    from: Tile,
    to: Tile,
    size: number,
    spawn: Tile,
    matchesEnvironment: (tile: Tile) => boolean = () => true,
): Tile[] {
    const inRange = (t: Tile) =>
        Math.abs(t.x - spawn.x) <= WANDER_RADIUS && Math.abs(t.y - spawn.y) <= WANDER_RADIUS;
    if ((from.x === to.x && from.y === to.y) || !inRange(to)) {
        return [];
    }

    // World tiles go up to ~12600 on y, so leave 16 bits for each axis.
    const key = (x: number, y: number) => (x + 1024) * 65536 + (y + 1024);
    const previous = new Map<number, number>();
    previous.set(key(from.x, from.y), -1);
    const queue: Tile[] = [from];
    for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        if (current.x === to.x && current.y === to.y) {
            const path: Tile[] = [];
            let k = key(current.x, current.y);
            while (previous.get(k) !== -1) {
                path.push({ x: Math.floor(k / 65536) - 1024, y: (k % 65536) - 1024 });
                k = previous.get(k)!;
            }
            return path.reverse().slice(0, MAX_PATH_STEPS);
        }
        for (const [dx, dy] of DIRECTIONS) {
            const next = { x: current.x + dx, y: current.y + dy };
            const nextKey = key(next.x, next.y);
            if (
                previous.has(nextKey) ||
                !inRange(next) ||
                !matchesEnvironment(next) ||
                !canStep(flags, current.x, current.y, dx, dy, size)
            ) {
                continue;
            }
            previous.set(nextKey, key(current.x, current.y));
            queue.push(next);
        }
    }
    return [];
}

/** Client orientation (0 south, 512 west, 1024 north, 1536 east) of a step. */
export function stepOrientation(dx: number, dy: number): number {
    if (dx > 0) {
        return dy > 0 ? 1280 : dy < 0 ? 1792 : 1536;
    }
    if (dx < 0) {
        return dy > 0 ? 768 : dy < 0 ? 256 : 512;
    }
    return dy > 0 ? 1024 : 0;
}

/** Turns `rotation` towards `target` by at most `speed` units (2048 per turn). */
export function rotateTowards(rotation: number, target: number, speed: number): number {
    const delta = (target - rotation) & 2047;
    if (delta === 0) {
        return rotation;
    }
    let next = rotation + (delta > 1024 ? -speed : speed);
    if (delta < speed || delta > 2048 - speed) {
        next = target;
    }
    return next & 2047;
}

/** Client orientation that faces a direction given in tiles (dx east, dy north). */
export function faceOrientation(dx: number, dy: number): number {
    return Math.round((Math.atan2(-dx, -dy) * 1024) / Math.PI) & 2047;
}
