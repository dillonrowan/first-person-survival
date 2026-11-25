// Scans every map square of the cache for placed locs that could be dungeon entrances.

import { ByteBuffer } from "./rs/io/ByteBuffer";
import { Scene } from "./rs/scene/Scene";
import { createWorldLoaders } from "./WorldLoaders";
import { Candidate, StateInfo, isCandidateState, isSurfaceTile } from "./DungeonCandidates";

type Loaders = ReturnType<typeof createWorldLoaders>;

const WORLDAREA_GROUP_ID = (98 << 8) | 199;

/** Every map square that has loc data: [mapX, mapY]. */
export function listMapSquares(loaders: Loaders): [number, number][] {
    const squares: [number, number][] = [];
    for (const id of loaders.sceneBuilder.mapFileLoader.mapIndex.getArchiveIds()) {
        if (id === WORLDAREA_GROUP_ID) continue;
        squares.push([id >> 8, id & 0xff]);
    }
    return squares.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Every state a loc can show: itself, plus each multiloc target. */
function statesOf(loaders: Loaders, id: number): StateInfo[] {
    const base = loaders.locTypeLoader.load(id);
    const ids = [id];
    for (const target of base.transforms ?? []) {
        if (target !== -1 && !ids.includes(target)) ids.push(target);
    }
    return ids.map((stateId) => {
        const t = loaders.locTypeLoader.load(stateId);
        return { id: stateId, name: t.name, actions: t.actions.filter((a): a is string => !!a) };
    });
}

/** All placed locs of one square, with raw type and rotation (no edge culling). */
export type PlacedLoc = { id: number; level: number; localX: number; localY: number; type: number; rotation: number };

export function decodePlacedLocs(data: Int8Array): PlacedLoc[] {
    const buffer = new ByteBuffer(data);
    const out: PlacedLoc[] = [];
    let id = -1;
    let idDelta: number;
    while ((idDelta = buffer.readSmart3()) !== 0) {
        id += idDelta;
        let pos = 0;
        let posDelta: number;
        while ((posDelta = buffer.readUnsignedSmart()) !== 0) {
            pos += posDelta - 1;
            const attributes = buffer.readUnsignedByte();
            out.push({
                id,
                level: pos >> 12,
                localX: (pos >> 6) & 0x3f,
                localY: pos & 0x3f,
                type: attributes >> 2,
                rotation: attributes & 3,
            });
        }
    }
    return out;
}

/**
 * Scans one square: every loc that is a candidate in any of its states, or whose id (in any state)
 * is in `extraIds` (the objects an external transport starts at, such as levers and portals).
 */
export function scanSquare(
    loaders: Loaders,
    mapX: number,
    mapY: number,
    candidateCache: Map<number, StateInfo[] | null>,
    extraIds: ReadonlySet<number> = new Set(),
): Candidate[] {
    const locData = loaders.sceneBuilder.getLocData(mapX, mapY);
    if (!locData) return [];
    const terrain = loaders.sceneBuilder.getTerrainData(mapX, mapY);
    let bridge: ((x: number, y: number) => boolean) | undefined;
    if (terrain) {
        const scene = new Scene(Scene.MAX_LEVELS, 64, 64);
        loaders.sceneBuilder.decodeTerrain(scene, terrain, 0, 0, mapX * 64, mapY * 64);
        bridge = (x, y) => (scene.tileRenderFlags[1][x][y] & 2) === 2;
    }
    const found: Candidate[] = [];
    for (const loc of decodePlacedLocs(locData)) {
        let states = candidateCache.get(loc.id);
        if (states === undefined) {
            const all = statesOf(loaders, loc.id);
            states = all.some((s) => isCandidateState(s.name, s.actions) || extraIds.has(s.id)) ? all : null;
            candidateCache.set(loc.id, states);
        }
        if (!states) continue;
        const type = loaders.locTypeLoader.load(loc.id);
        const plane = bridge?.(loc.localX, loc.localY) ? loc.level - 1 : loc.level;
        const x = mapX * 64 + loc.localX;
        const y = mapY * 64 + loc.localY;
        found.push({
            id: loc.id,
            states,
            x,
            y,
            level: loc.level,
            plane,
            type: loc.type,
            rotation: loc.rotation,
            sizeX: type.sizeX,
            sizeY: type.sizeY,
            mapFunctionId: type.mapFunctionId,
            surface: isSurfaceTile(y),
        });
    }
    return found;
}

/**
 * Whether two neighbouring map squares are joined by walkable ground: some pair of tiles facing
 * each other across their shared edge, both with a floor and not blocked (terrain only, plane 0).
 */
export function createEdgeOpen(loaders: Loaders): (a: [number, number], b: [number, number]) => boolean {
    const walkable = new Map<number, Uint8Array | undefined>();
    const walkMask = (mapX: number, mapY: number): Uint8Array | undefined => {
        const key = (mapX << 8) | mapY;
        if (walkable.has(key)) return walkable.get(key);
        const terrain = loaders.sceneBuilder.getTerrainData(mapX, mapY);
        let mask: Uint8Array | undefined;
        if (terrain) {
            const scene = new Scene(Scene.MAX_LEVELS, 64, 64);
            loaders.sceneBuilder.decodeTerrain(scene, terrain, 0, 0, mapX * 64, mapY * 64);
            mask = new Uint8Array(64 * 64);
            for (let x = 0; x < 64; x++) {
                for (let y = 0; y < 64; y++) {
                    const floor = scene.tileUnderlays[0][x][y] > 0 || scene.tileOverlays[0][x][y] > 0;
                    mask[x * 64 + y] = floor && (scene.tileRenderFlags[0][x][y] & 1) === 0 ? 1 : 0;
                }
            }
        }
        walkable.set(key, mask);
        return mask;
    };
    return (a, b) => {
        const ma = walkMask(a[0], a[1]);
        const mb = walkMask(b[0], b[1]);
        if (!ma || !mb) return false;
        for (let i = 0; i < 64; i++) {
            const [ia, ib] = b[0] > a[0] ? [63 * 64 + i, i] : b[0] < a[0] ? [i, 63 * 64 + i] : b[1] > a[1] ? [i * 64 + 63, i * 64] : [i * 64, i * 64 + 63];
            if (ma[ia] && mb[ib]) return true;
        }
        return false;
    };
}
