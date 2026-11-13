import { MeshData, REGION_SIZE, RS_UNITS_PER_TILE } from "./WorldFormat";

/** Height-grid cells per tile side: fine enough to tell a fence from the tree beside it. */
export const TOP_CELLS = 4;
const SIDE = REGION_SIZE * TOP_CELLS;
const EMPTY = -32768;

/**
 * The highest point of a region's loc models (walls, fences, trees, roofs...) over each cell of a
 * TOP_CELLS × TOP_CELLS grid per tile, in RS units with up positive; EMPTY where nothing stands.
 * Collision says only that a wall is there; this says how tall it is, so a projectile can clear it.
 * A triangle counts at its highest point over every cell its footprint's bounds touch, which errs
 * toward solid.
 */
export function buildObstacleTops(meshes: readonly MeshData[]): Int16Array {
    const tops = new Int16Array(SIDE * SIDE).fill(EMPTY);
    const cell = RS_UNITS_PER_TILE / TOP_CELLS;
    for (const { positions, indices } of meshes) {
        for (let i = 0; i + 2 < indices.length; i += 3) {
            let minX = Infinity;
            let maxX = -Infinity;
            let minZ = Infinity;
            let maxZ = -Infinity;
            let top = -Infinity;
            for (let k = 0; k < 3; k++) {
                const v = indices[i + k] * 4;
                // Region-local RS units: x east, y down, z north.
                minX = Math.min(minX, positions[v]);
                maxX = Math.max(maxX, positions[v]);
                minZ = Math.min(minZ, positions[v + 2]);
                maxZ = Math.max(maxZ, positions[v + 2]);
                top = Math.max(top, Math.min(32767, -positions[v + 1]));
            }
            const x0 = Math.max(0, Math.floor(minX / cell));
            const x1 = Math.min(SIDE - 1, Math.floor(maxX / cell));
            const z0 = Math.max(0, Math.floor(minZ / cell));
            const z1 = Math.min(SIDE - 1, Math.floor(maxZ / cell));
            for (let x = x0; x <= x1; x++) {
                for (let z = z0; z <= z1; z++) {
                    const c = x * SIDE + z;
                    if (top > tops[c]) tops[c] = top;
                }
            }
        }
    }
    return tops;
}

/**
 * Highest loc point (tiles, up positive) over a box given in region-local tiles, or -Infinity if
 * nothing stands there.
 */
export function obstacleTopIn(tops: Int16Array, minX: number, minY: number, maxX: number, maxY: number): number {
    const x0 = Math.max(0, Math.floor(minX * TOP_CELLS));
    const x1 = Math.min(SIDE - 1, Math.floor(maxX * TOP_CELLS));
    const y0 = Math.max(0, Math.floor(minY * TOP_CELLS));
    const y1 = Math.min(SIDE - 1, Math.floor(maxY * TOP_CELLS));
    let top = EMPTY;
    for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
            top = Math.max(top, tops[x * SIDE + y]);
        }
    }
    return top === EMPTY ? -Infinity : top / RS_UNITS_PER_TILE;
}
