import * as THREE from "three";

import { FlagEdit, PersistentEdits, applyFlagEdit } from "./CollisionEdits";
import { gunzip } from "./gunzip";
import { buildObstacleTops, obstacleTopIn } from "./ObstacleTops";
import { WorldMaterials } from "./WorldMaterials";
import {
    InteractiveLoc,
    LEVELS,
    MeshData,
    REGION_SIZE,
    RS_UNITS_PER_TILE,
    RegionListener,
    WorldManifest,
    decodeRegion,
    regionFileName,
} from "./WorldFormat";

/** Regions whose nearest edge is within this many tiles of the player are loaded. */
const LOAD_DISTANCE = 100;
/** ...and dropped again once they are this far away. */
const UNLOAD_DISTANCE = 140;
const MAX_CONCURRENT_LOADS = 4;

const CORNERS = REGION_SIZE + 1;

/** Returned for tiles in regions that are missing or not loaded yet: fully blocked. */
const BLOCKED = 0xffffff;

/** GPU geometry of one door's meshes (either may be absent). */
export type DoorGeometry = {
    opaque?: THREE.BufferGeometry;
    transparent?: THREE.BufferGeometry;
};

type LoadedRegion = {
    mapX: number;
    mapY: number;
    meshes: THREE.Mesh[];
    heights: Int32Array;
    renderFlags: Uint8Array;
    floors: Uint8Array;
    collision: Int32Array;
    water: Uint8Array;
    interactives: InteractiveLoc[];
    doorGeometries: DoorGeometry[];
    /** Highest loc geometry per cell (ObstacleTops). */
    obstacleTops: Int16Array;
};

const regionKey = (mapX: number, mapY: number) => (mapX << 8) | mapY;

/**
 * Streams the exported world map around the player and answers the questions movement needs:
 * how high is the ground and what blocks a tile. Coordinates are OSRS world tiles: x east,
 * y north, as floats (tile 3222 spans x 3222..3223). In three.js space that is (x, height, -y).
 */
export class World {
    private readonly available = new Set<number>();
    private readonly regions = new Map<number, LoadedRegion>();
    private readonly loading = new Set<number>();
    private readonly failed = new Set<number>();
    private readonly listeners: RegionListener[] = [];
    private readonly edits = new PersistentEdits();

    constructor(
        private readonly baseUrl: string,
        manifest: WorldManifest,
        private readonly materials: WorldMaterials,
        private readonly scene: THREE.Scene,
    ) {
        for (const [mapX, mapY] of manifest.regions) {
            this.available.add(regionKey(mapX, mapY));
        }
    }

    /** Calls the listener for every region that loads or unloads, and for those already loaded. */
    addRegionListener(listener: RegionListener): void {
        this.listeners.push(listener);
        for (const region of this.regions.values()) {
            listener.loaded(region.mapX, region.mapY);
        }
    }

    get loadedCount(): number {
        return this.regions.size;
    }

    get pendingCount(): number {
        return this.loading.size;
    }

    /** Streams regions in and out around the player. Call once per frame. */
    update(x: number, y: number): void {
        const minMapX = Math.floor((x - LOAD_DISTANCE) / REGION_SIZE);
        const maxMapX = Math.floor((x + LOAD_DISTANCE) / REGION_SIZE);
        const minMapY = Math.floor((y - LOAD_DISTANCE) / REGION_SIZE);
        const maxMapY = Math.floor((y + LOAD_DISTANCE) / REGION_SIZE);

        const wanted: { mapX: number; mapY: number; distance: number }[] = [];
        for (let mapX = minMapX; mapX <= maxMapX; mapX++) {
            for (let mapY = minMapY; mapY <= maxMapY; mapY++) {
                const key = regionKey(mapX, mapY);
                if (
                    !this.available.has(key) ||
                    this.regions.has(key) ||
                    this.loading.has(key) ||
                    this.failed.has(key)
                ) {
                    continue;
                }
                const distance = distanceToRegion(x, y, mapX, mapY);
                if (distance <= LOAD_DISTANCE) {
                    wanted.push({ mapX, mapY, distance });
                }
            }
        }
        wanted.sort((a, b) => a.distance - b.distance);
        for (const { mapX, mapY } of wanted) {
            if (this.loading.size >= MAX_CONCURRENT_LOADS) {
                break;
            }
            this.load(mapX, mapY);
        }

        for (const [key, region] of this.regions) {
            if (distanceToRegion(x, y, region.mapX, region.mapY) > UNLOAD_DISTANCE) {
                this.unload(key, region);
            }
        }
    }

    /** Whether the exported world has a map square covering this tile (loaded or not). */
    hasRegion(x: number, y: number): boolean {
        return this.available.has(regionKey(Math.floor(x / REGION_SIZE), Math.floor(y / REGION_SIZE)));
    }

    /** Doors and ladders of a loaded map square, with the door geometries. */
    regionInteractives(
        mapX: number,
        mapY: number,
    ): { locs: InteractiveLoc[]; doorGeometries: DoorGeometry[] } | undefined {
        const region = this.regions.get(regionKey(mapX, mapY));
        return region && { locs: region.interactives, doorGeometries: region.doorGeometries };
    }

    /** Changes tile flags now, in the loaded squares. */
    applyFlagEdits(edits: readonly FlagEdit[]): void {
        for (const edit of edits) {
            this.applyEdit(edit);
        }
    }

    /**
     * Keeps edits under `id` applied whenever the squares they touch are loaded again. Pass
     * undefined to forget them; the caller undoes their effect on loaded squares itself.
     */
    setPersistentEdits(id: string, edits: FlagEdit[] | undefined): void {
        this.edits.set(id, edits);
    }

    private applyEdit(edit: FlagEdit): void {
        const region = this.getRegion(edit.tileX, edit.tileY);
        if (!region) {
            return;
        }
        const [lx, ly] = localTile(edit.tileX, edit.tileY);
        const index = (edit.plane * REGION_SIZE + lx) * REGION_SIZE + ly;
        region.collision[index] = applyFlagEdit(region.collision[index], edit);
    }

    isLoaded(x: number, y: number): boolean {
        return this.getRegion(x, y) !== undefined;
    }

    /**
     * The height level that is drawn for a walkable plane. Bridges are stored one level up and
     * walked on from the level below, like the OSRS client's getTileHeight does.
     */
    renderLevel(plane: number, x: number, y: number): number {
        if (plane < LEVELS - 1) {
            const region = this.getRegion(x, y);
            if (region) {
                const [lx, ly] = localTile(x, y);
                if ((region.renderFlags[(REGION_SIZE + lx) * REGION_SIZE + ly] & 0x2) !== 0) {
                    return plane + 1;
                }
            }
        }
        return plane;
    }

    /** Ground height in tiles (up is positive) at a point on a walkable plane. */
    groundHeight(plane: number, x: number, y: number): number {
        const region = this.getRegion(x, y);
        if (!region) {
            return 0;
        }
        const level = this.renderLevel(plane, x, y);
        const fx = x - Math.floor(x);
        const fy = y - Math.floor(y);
        const [lx, ly] = localTile(x, y);
        const base = level * CORNERS;
        const h = region.heights;
        const sw = h[(base + lx) * CORNERS + ly];
        const se = h[(base + lx + 1) * CORNERS + ly];
        const nw = h[(base + lx) * CORNERS + ly + 1];
        const ne = h[(base + lx + 1) * CORNERS + ly + 1];
        const south = sw + (se - sw) * fx;
        const north = nw + (ne - nw) * fx;
        return -(south + (north - south) * fy) / RS_UNITS_PER_TILE;
    }

    /** Whether the walkable plane has a floor tile here (plane 0 always counts as ground). */
    hasFloor(plane: number, x: number, y: number): boolean {
        if (plane === 0) {
            return true;
        }
        const region = this.getRegion(x, y);
        if (!region) {
            return false;
        }
        const level = this.renderLevel(plane, x, y);
        const [lx, ly] = localTile(x, y);
        return region.floors[(level * REGION_SIZE + lx) * REGION_SIZE + ly] !== 0;
    }

    /**
     * Highest point (tiles, up positive) of the walls, fences, trees and other loc models over a
     * box of world tiles, or -Infinity if nothing stands there. Unloaded ground counts as infinitely
     * tall, as its collision counts as blocked.
     */
    obstacleTop(minX: number, minY: number, maxX: number, maxY: number): number {
        let top = -Infinity;
        const mapX0 = Math.floor(minX / REGION_SIZE);
        const mapX1 = Math.floor(maxX / REGION_SIZE);
        const mapY0 = Math.floor(minY / REGION_SIZE);
        const mapY1 = Math.floor(maxY / REGION_SIZE);
        for (let mapX = mapX0; mapX <= mapX1; mapX++) {
            for (let mapY = mapY0; mapY <= mapY1; mapY++) {
                const region = this.regions.get(regionKey(mapX, mapY));
                if (!region) {
                    return Infinity;
                }
                const ox = mapX * REGION_SIZE;
                const oy = mapY * REGION_SIZE;
                top = Math.max(top, obstacleTopIn(region.obstacleTops, minX - ox, minY - oy, maxX - ox, maxY - oy));
            }
        }
        return top;
    }

    /** OSRS collision flags of a tile, see CollisionFlag. Unloaded tiles are fully blocked. */
    collisionFlags(plane: number, tileX: number, tileY: number): number {
        const region = this.getRegion(tileX, tileY);
        if (!region) {
            return BLOCKED;
        }
        const [lx, ly] = localTile(tileX, tileY);
        return region.collision[(plane * REGION_SIZE + lx) * REGION_SIZE + ly];
    }

    isWater(plane: number, tileX: number, tileY: number): boolean {
        const region = this.getRegion(tileX, tileY);
        if (!region) {
            return false;
        }
        const [lx, ly] = localTile(tileX, tileY);
        return region.water[(plane * REGION_SIZE + lx) * REGION_SIZE + ly] !== 0;
    }

    private getRegion(x: number, y: number): LoadedRegion | undefined {
        return this.regions.get(
            regionKey(Math.floor(x / REGION_SIZE), Math.floor(y / REGION_SIZE)),
        );
    }

    private async load(mapX: number, mapY: number): Promise<void> {
        const key = regionKey(mapX, mapY);
        this.loading.add(key);
        try {
            const response = await fetch(`${this.baseUrl}regions/${regionFileName(mapX, mapY)}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = decodeRegion(await gunzip(await response.arrayBuffer()));

            const origin = new THREE.Vector3(mapX * REGION_SIZE, 0, -mapY * REGION_SIZE);
            const meshes: THREE.Mesh[] = [];
            const { terrain, ceiling, opaque, transparent } = this.materials;
            // The terrain geometry is drawn twice, front faces and back faces (ceilings).
            const parts: [MeshData, THREE.Material[]][] = [
                [data.terrain, [terrain, ceiling]],
                [data.opaque, [opaque]],
                [data.transparent, [transparent]],
            ];
            parts.forEach(([mesh, materials], renderOrder) => {
                if (mesh.indices.length === 0) {
                    return;
                }
                const geometry = createGeometry(mesh);
                for (const material of materials) {
                    const object = new THREE.Mesh(geometry, material);
                    object.position.copy(origin);
                    object.renderOrder = renderOrder;
                    object.matrixAutoUpdate = false;
                    object.updateMatrix();
                    meshes.push(object);
                    this.scene.add(object);
                }
            });

            const doorGeometries: DoorGeometry[] = data.doorMeshes.map((door) => ({
                opaque: door.opaque.indices.length > 0 ? createGeometry(door.opaque) : undefined,
                transparent:
                    door.transparent.indices.length > 0 ? createGeometry(door.transparent) : undefined,
            }));

            // Copies, so the decompressed buffer can be freed once the GPU has the meshes.
            this.regions.set(key, {
                mapX,
                mapY,
                meshes,
                heights: data.heights.slice(),
                renderFlags: data.renderFlags.slice(),
                floors: data.floors.slice(),
                collision: data.collision.slice(),
                water: data.water?.slice() ?? new Uint8Array(LEVELS * REGION_SIZE * REGION_SIZE),
                interactives: data.interactives,
                doorGeometries,
                obstacleTops: buildObstacleTops([data.opaque, data.transparent]),
            });
            // Doors the player has used keep their collision after the square streams back in.
            for (const edit of this.edits.forRegion(mapX, mapY)) {
                this.applyEdit(edit);
            }
            for (const listener of this.listeners) {
                listener.loaded(mapX, mapY);
            }
        } catch (e) {
            console.error(`Failed to load region ${mapX},${mapY}`, e);
            this.failed.add(key);
        } finally {
            this.loading.delete(key);
        }
    }

    private unload(key: number, region: LoadedRegion): void {
        for (const mesh of region.meshes) {
            this.scene.remove(mesh);
            // Disposing a geometry shared by two meshes twice is harmless.
            mesh.geometry.dispose();
        }
        this.regions.delete(key);
        for (const listener of this.listeners) {
            listener.unloaded(region.mapX, region.mapY);
        }
        for (const door of region.doorGeometries) {
            door.opaque?.dispose();
            door.transparent?.dispose();
        }
    }
}

/** Tile position within its region, 0..63 on each axis. */
function localTile(x: number, y: number): [number, number] {
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    return [
        tileX - Math.floor(tileX / REGION_SIZE) * REGION_SIZE,
        tileY - Math.floor(tileY / REGION_SIZE) * REGION_SIZE,
    ];
}

function distanceToRegion(x: number, y: number, mapX: number, mapY: number): number {
    const minX = mapX * REGION_SIZE;
    const minY = mapY * REGION_SIZE;
    const dx = Math.max(minX - x, 0, x - (minX + REGION_SIZE));
    const dy = Math.max(minY - y, 0, y - (minY + REGION_SIZE));
    return Math.hypot(dx, dy);
}

function createGeometry(mesh: MeshData): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    // Plain BufferAttributes use the decoded views as-is (the typed subclasses would copy).
    const attributes: [string, THREE.BufferAttribute][] = [
        ["a_position", new THREE.BufferAttribute(mesh.positions, 4)],
        ["a_color", new THREE.BufferAttribute(mesh.colors, 4, true)],
        ["a_uv", new THREE.BufferAttribute(mesh.uvs, 2)],
    ];
    for (const [name, attribute] of attributes) {
        // Drop the CPU copy once uploaded; nothing reads vertex data back.
        attribute.onUpload(releaseArray);
        geometry.setAttribute(name, attribute);
    }
    const index = new THREE.BufferAttribute(mesh.indices, 1);
    index.onUpload(releaseArray);
    geometry.setIndex(index);

    // There is no `position` attribute for three.js to measure, so supply culling bounds.
    const [cx, cy, cz, radius] = mesh.bounds;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), radius);
    geometry.boundingBox = new THREE.Box3(
        new THREE.Vector3(cx - radius, cy - radius, cz - radius),
        new THREE.Vector3(cx + radius, cy + radius, cz + radius),
    );
    return geometry;
}

function releaseArray(this: THREE.BufferAttribute): void {
    (this as { array: unknown }).array = null;
}
