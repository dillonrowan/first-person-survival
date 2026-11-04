import * as THREE from "three";

import type { NpcManifest, NpcModelData, NpcSpawnInfo } from "../world/NpcFormat";
import type { RegionListener } from "../world/WorldFormat";
import { CLIENT_CYCLE_SECONDS } from "./NpcAnimation";
import { SERVER_TICK_SECONDS } from "./NpcMovement";
import { NpcModels, SharedNpcModel } from "./NpcModels";
import { Npc, NpcWorld, Occupancy } from "./Npc";

const MAX_CLIENT_CYCLES_PER_UPDATE = 50;
const MAX_SERVER_TICKS_PER_UPDATE = 5;

const regionKey = (mapX: number, mapY: number) => (mapX << 8) | mapY;

type RegionNpcs = {
    /** Appearance indices acquired from the model cache, released again on unload. */
    appearances: number[];
    npcs: Npc[];
};

/** Creates the NPCs of the regions the world has loaded, and runs their animation and wandering. */
export class Npcs {
    private readonly spawnsByRegion = new Map<number, NpcSpawnInfo[]>();
    private readonly regions = new Map<number, RegionNpcs>();
    private readonly models: NpcModels;
    private readonly occupancy = new Occupancy();
    private clientTime = 0;
    private serverTime = 0;

    constructor(
        private readonly manifest: NpcManifest,
        private readonly world: NpcWorld & {
            addRegionListener(listener: RegionListener): void;
        },
        private readonly scene: THREE.Scene,
        private readonly materials: { opaque: THREE.Material; transparent: THREE.Material },
        loadModel: (file: string) => Promise<NpcModelData>,
        private readonly random: () => number = Math.random,
    ) {
        this.models = new NpcModels(loadModel);
        for (const spawn of manifest.spawns) {
            const key = regionKey(spawn.x >> 6, spawn.y >> 6);
            const list = this.spawnsByRegion.get(key);
            if (list) {
                list.push(spawn);
            } else {
                this.spawnsByRegion.set(key, [spawn]);
            }
        }
        world.addRegionListener({
            loaded: (mapX, mapY) => this.regionLoaded(mapX, mapY),
            unloaded: (mapX, mapY) => this.regionUnloaded(mapX, mapY),
        });
    }

    /** Number of NPCs currently in the scene. */
    get count(): number {
        let total = 0;
        for (const region of this.regions.values()) {
            total += region.npcs.length;
        }
        return total;
    }

    /** All NPCs currently in the scene. */
    all(): Npc[] {
        return [...this.regions.values()].flatMap((region) => region.npcs);
    }

    /** Model files currently held in memory. */
    get loadedModelCount(): number {
        return this.models.size;
    }

    /** Tiles currently covered by NPCs. */
    get occupiedTileCount(): number {
        return this.occupancy.size;
    }

    /** Advances all NPCs by `dt` seconds. */
    update(dt: number): void {
        this.clientTime += dt;
        this.serverTime += dt;
        const cycles = Math.min(
            Math.floor(this.clientTime / CLIENT_CYCLE_SECONDS),
            MAX_CLIENT_CYCLES_PER_UPDATE,
        );
        // Keep the remainder, but forget time lost to a long pause.
        this.clientTime = Math.min(this.clientTime - cycles * CLIENT_CYCLE_SECONDS, CLIENT_CYCLE_SECONDS);
        const ticks = Math.min(
            Math.floor(this.serverTime / SERVER_TICK_SECONDS),
            MAX_SERVER_TICKS_PER_UPDATE,
        );
        this.serverTime = Math.min(this.serverTime - ticks * SERVER_TICK_SECONDS, SERVER_TICK_SECONDS);

        for (const region of this.regions.values()) {
            for (const npc of region.npcs) {
                for (let t = 0; t < ticks; t++) {
                    npc.serverTick(this.occupancy, this.random);
                }
                for (let c = 0; c < cycles; c++) {
                    npc.clientCycle();
                }
                npc.sync();
            }
        }
    }

    private regionLoaded(mapX: number, mapY: number): void {
        const key = regionKey(mapX, mapY);
        const spawns = this.spawnsByRegion.get(key);
        if (!spawns || this.regions.has(key)) {
            return;
        }
        const appearances = [...new Set(spawns.map((spawn) => spawn.appearance))];
        const region: RegionNpcs = { appearances, npcs: [] };
        this.regions.set(key, region);

        // acquire() counts the use right away, so an unload while loading releases it again.
        const loading = appearances.map((index) =>
            this.models.acquire(this.manifest.appearances[index].file),
        );
        void Promise.allSettled(loading).then((results) => {
            if (this.regions.get(key) !== region) {
                return; // Unloaded while the models were loading.
            }
            const models = new Map<number, SharedNpcModel>();
            results.forEach((result, i) => {
                if (result.status === "fulfilled") {
                    models.set(appearances[i], result.value);
                } else {
                    console.warn("Failed to load NPC model", result.reason);
                }
            });
            for (const spawn of spawns) {
                const model = models.get(spawn.appearance);
                if (model) {
                    this.createNpc(region, spawn, model);
                }
            }
        });
    }

    private createNpc(region: RegionNpcs, spawn: NpcSpawnInfo, model: SharedNpcModel): void {
        const npc = new Npc(
            this.manifest.appearances[spawn.appearance],
            spawn,
            model,
            this.materials,
            this.world,
            this.random,
        );
        this.occupancy.add(spawn.plane, spawn.x, spawn.y, Math.max(1, npc.appearance.size));
        npc.sync();
        this.scene.add(npc.group);
        region.npcs.push(npc);
    }

    private regionUnloaded(mapX: number, mapY: number): void {
        const key = regionKey(mapX, mapY);
        const region = this.regions.get(key);
        if (!region) {
            return;
        }
        this.regions.delete(key);
        for (const npc of region.npcs) {
            this.occupancy.remove(npc.info.plane, npc.tileX, npc.tileY, Math.max(1, npc.appearance.size));
            npc.dispose();
        }
        region.npcs.length = 0;
        for (const index of region.appearances) {
            this.models.release(this.manifest.appearances[index].file);
        }
    }
}
