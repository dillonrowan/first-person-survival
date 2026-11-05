import * as THREE from "three";

import type { NpcManifest, NpcModelData, NpcSpawnInfo } from "../world/NpcFormat";
import { RS_UNITS_PER_TILE, type RegionListener } from "../world/WorldFormat";
import { CLIENT_CYCLE_SECONDS } from "./NpcAnimation";
import { SERVER_TICK_SECONDS } from "./NpcMovement";
import { NpcModels, SharedNpcModel } from "./NpcModels";
import { Body, BodySource, segmentHitsBoxes2D } from "../physics/Bodies";
import { Box, collectTileBoxes } from "../physics/TileColliders";
import { tuning } from "../combat/tuning";
import { CombatContext, Npc, NpcWorld, Occupancy } from "./Npc";
import { strikeBody } from "./BodyHits";
import { Ragdoll } from "./Ragdoll";

const MAX_CLIENT_CYCLES_PER_UPDATE = 50;
const MAX_SERVER_TICKS_PER_UPDATE = 5;

const regionKey = (mapX: number, mapY: number) => (mapX << 8) | mapY;

type RegionNpcs = {
    /** Appearance indices acquired from the model cache, released again on unload. */
    appearances: number[];
    npcs: Npc[];
};

/** Creates the NPCs of the regions the world has loaded, and runs their animation and wandering. */
export class Npcs implements BodySource<Npc> {
    private readonly spawnsByRegion = new Map<number, NpcSpawnInfo[]>();
    private readonly regions = new Map<number, RegionNpcs>();
    private readonly models: NpcModels;
    private readonly occupancy = new Occupancy();
    private playerBody: Body | undefined;
    private playerTiles: [number, number, number][] = [];
    private clientTime = 0;
    private serverTime = 0;
    /** Seconds simulated, and when each body last knocked each NPC down (spec 20.7). */
    private time = 0;
    private readonly bodyHits = new WeakMap<Npc, Map<Npc, number>>();

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

    collectBodies(
        plane: number,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
        out: Body<Npc>[],
    ): void {
        for (const region of this.regions.values()) {
            for (const npc of region.npcs) {
                const b = npc.body;
                if (b.plane !== plane || npc.combatant.dead) {
                    continue;
                }
                const dx = b.x - Math.min(Math.max(b.x, minX), maxX);
                const dy = b.y - Math.min(Math.max(b.y, minY), maxY);
                if (dx * dx + dy * dy < b.radius * b.radius) {
                    out.push(b);
                }
            }
        }
    }

    /** Whether the player's cylinder blocks an NPC from moving to (x, y) in tiles. */
    private readonly blockedByPlayer = (npc: Npc, x: number, y: number): boolean => {
        const player = this.playerBody;
        if (!player || npc.plane !== player.plane) {
            return false;
        }
        const b = npc.body;
        if (!(b.z < player.z + player.height && player.z < b.z + b.height)) {
            return false;
        }
        const reach = b.radius + player.radius;
        const d1 = Math.hypot(x - player.x, y - player.y);
        const d0 = Math.hypot(npc.fineX / RS_UNITS_PER_TILE - player.x, npc.fineY / RS_UNITS_PER_TILE - player.y);
        // Only moving closer is blocked, so an NPC that overlaps the player can still separate.
        return d1 < reach && d1 < d0;
    };

    /** Marks the tiles under the player as occupied, so NPCs do not plan steps onto them. */
    private syncPlayerTiles(player: Body | undefined): void {
        for (const [plane, x, y] of this.playerTiles) {
            this.occupancy.remove(plane, x, y, 1);
        }
        this.playerTiles = [];
        if (!player) {
            return;
        }
        const x0 = Math.floor(player.x - player.radius);
        const x1 = Math.floor(player.x + player.radius - 1e-6);
        const y0 = Math.floor(player.y - player.radius);
        const y1 = Math.floor(player.y + player.radius - 1e-6);
        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                this.playerTiles.push([player.plane, x, y]);
                this.occupancy.add(player.plane, x, y, 1);
            }
        }
    }

    /** Bodies near a box: NPCs plus the player, for NPCs moving freely in combat. */
    private readonly collectWithPlayer = (
        plane: number,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
        out: Body[],
    ): void => {
        this.collectBodies(plane, minX, minY, maxX, maxY, out as Body<Npc>[]);
        const p = this.playerBody;
        if (p && p.plane === plane && p.x + p.radius > minX && p.x - p.radius < maxX && p.y + p.radius > minY && p.y - p.radius < maxY) {
            out.push(p);
        }
    };

    /** True if no wall lies on the segment (for NPC sight). */
    private readonly lineOfSight = (plane: number, x0: number, y0: number, x1: number, y1: number): boolean => {
        this.losBoxes.length = 0;
        collectTileBoxes(
            (p, x, y) => this.world.collisionFlags(p, x, y),
            plane,
            Math.min(x0, x1),
            Math.min(y0, y1),
            Math.max(x0, x1),
            Math.max(y0, y1),
            this.losBoxes,
            "walls",
        );
        return segmentHitsBoxes2D(x0, y0, x1, y1, this.losBoxes) === undefined;
    };
    private readonly losBoxes: Box[] = [];

    /**
     * Advances all NPCs by `dt` seconds. `player` is the player's collision body, if any, and
     * `playerYaw` where they look (NPCs zig-zag when looked at). `senses` carries what NPCs can
     * notice of the player and where their strikes go.
     */
    update(
        dt: number,
        player?: Body,
        playerYaw = 0,
        senses: Omit<NonNullable<CombatContext["player"]>, keyof Body | "yaw"> & Pick<CombatContext, "strike"> = {},
    ): void {
        this.playerBody = player;
        this.syncPlayerTiles(player);
        this.clientTime += dt;
        this.serverTime += dt;
        this.time += dt;
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
                    npc.clientCycle(this.blockedByPlayer);
                }
                npc.updateCombat(dt, this.occupancy, {
                    player: player ? { ...player, yaw: playerYaw, ...senses } : undefined,
                    collect: this.collectWithPlayer,
                    lineOfSight: this.lineOfSight,
                    strike: senses.strike,
                });
                npc.sync();
            }
        }
        this.collideBodies();
        this.limitCorpses();
        if (player) {
            this.callForHelp(player);
        }
    }

    /**
     * Bodies meeting NPCs (spec 20.7): a moving ragdoll knocks over the standing NPCs it flies
     * into (they fall onto ragdolls of their own and get up again), is stopped by those it does
     * not, and bodies on the ground push each other apart instead of sinking into each other.
     */
    private collideBodies(): void {
        const all = this.all();
        const bodies = all.filter((npc) => npc.ragdoll && !npc.gone && !npc.gettingUp);
        for (let i = 0; i < bodies.length; i++) {
            const striker = bodies[i];
            const ragdoll = striker.ragdoll!;
            for (let j = i + 1; j < bodies.length; j++) {
                Ragdoll.collide(ragdoll, bodies[j].ragdoll!);
            }
            if (ragdoll.asleep) {
                continue;
            }
            const reach = ragdoll.bounds();
            for (const target of all) {
                const body = target.body;
                const c = target.combatant;
                if (target === striker || target.ragdoll || target.gone || c.dead || c.knockedDown || body.plane !== ragdoll.plane) {
                    continue;
                }
                // Tile space (x, y) is three.js (x, −z).
                if (Math.hypot(body.x - reach.x, body.y + reach.z) > reach.r + body.radius) {
                    continue;
                }
                const hits = this.bodyHits.get(striker) ?? new Map<Npc, number>();
                const again = this.time - (hits.get(target) ?? -Infinity) < tuning.ragdollHitRepeat;
                const hit = strikeBody(ragdoll, body, target.mass, target.attackable && !again);
                if (hit) {
                    hits.set(target, this.time);
                    this.bodyHits.set(striker, hits);
                    target.hitByBody(hit, striker.body.x, striker.body.y);
                }
            }
        }
    }

    /** At most ragdollMax corpses lie around; the oldest go first (cvar g_ragdoll_maxcount). */
    private limitCorpses(): void {
        const corpses: Npc[] = [];
        for (const region of this.regions.values()) {
            for (const npc of region.npcs) {
                if (npc.combatant.dead && !npc.gone) {
                    corpses.push(npc);
                }
            }
        }
        if (corpses.length <= tuning.ragdollMax) {
            return;
        }
        corpses.sort((a, b) => b.deadFor - a.deadFor);
        for (const npc of corpses.slice(0, corpses.length - tuning.ragdollMax)) {
            npc.removeCorpse(this.occupancy);
        }
    }

    /** NPCs that just turned hostile alert up to 3 calm allies within 700 u (spec 16.7). */
    private callForHelp(player: Body): void {
        const all = this.all();
        for (const caller of all) {
            if (!caller.justAlerted) {
                continue;
            }
            caller.justAlerted = false;
            let called = 0;
            for (const other of all) {
                if (called >= tuning.callForHelpMax) {
                    break;
                }
                if (
                    other !== caller &&
                    !other.alerted &&
                    other.attackable &&
                    other.plane === caller.plane &&
                    Math.hypot(other.body.x - caller.body.x, other.body.y - caller.body.y) <= tuning.callForHelpDistance
                ) {
                    other.becomeAlerted(player.x, player.y);
                    other.justAlerted = false;
                    called++;
                }
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
            npc.releaseOccupancy(this.occupancy);
            npc.dispose();
        }
        region.npcs.length = 0;
        for (const index of region.appearances) {
            this.models.release(this.manifest.appearances[index].file);
        }
    }
}
