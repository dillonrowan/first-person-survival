import * as THREE from "three";

import type { Target, TargetSource } from "../interaction/Interaction";
import { Box3, rayBox } from "../physics/Bodies";
import type { DoorGeometry } from "./World";
import { InteractiveLoc, REGION_SIZE, RegionListener } from "./WorldFormat";

/** Lowest box a skill target is aimed at, so flat things (patches, stumps) can be hit. */
const MIN_TARGET_HEIGHT = 1;

export type SkillLocWorld = {
    addRegionListener(listener: RegionListener): void;
    regionInteractives(mapX: number, mapY: number): { locs: InteractiveLoc[]; doorGeometries: DoorGeometry[] } | undefined;
    groundHeight(plane: number, x: number, y: number): number;
};

/** A tree, rock, facility, patch or hotspot of a loaded map square, or one the game placed (a fire). */
export type SkillLocInstance = {
    readonly loc: InteractiveLoc;
    /** "plane:x:y:id": stable across region reloads, so skill state can be kept by it. */
    readonly key: string;
    readonly mapX: number;
    readonly mapY: number;
    readonly geometries: DoorGeometry[];
    /** Meshes made so far, by doorMeshes index. */
    readonly meshes: Map<number, THREE.Group>;
    /** The doorMeshes index on show, or -1 for none. */
    shown: number;
    /** A runtime loc's own model. */
    object?: THREE.Object3D;
};

export const skillLocKey = (loc: Pick<InteractiveLoc, "plane" | "tileX" | "tileY" | "id">) => `${loc.plane}:${loc.tileX}:${loc.tileY}:${loc.id}`;
const regionKey = (mapX: number, mapY: number) => (mapX << 8) | mapY;

/**
 * Skill targets of the loaded map squares. Trees, rocks, patches and hotspots have several looks
 * (doorMeshes); `look` picks the one to show from the skills' own state, which survives unloads.
 */
export class SkillLocs {
    private readonly regions = new Map<number, SkillLocInstance[]>();
    private readonly byKey = new Map<string, SkillLocInstance>();
    private readonly runtime = new Set<SkillLocInstance>();

    /** The doorMeshes index to show for an instance: undefined for its placed look, -1 for nothing. */
    look?: (instance: SkillLocInstance) => number | undefined;
    /** The actions offered for an instance; defaults to the loc's own (without Examine). */
    actionsOf?: (instance: SkillLocInstance) => string[];

    constructor(
        private readonly world: SkillLocWorld,
        private readonly scene: THREE.Scene,
        private readonly materials: { opaque: THREE.Material; transparent: THREE.Material },
    ) {
        world.addRegionListener({
            loaded: (mapX, mapY) => this.regionLoaded(mapX, mapY),
            unloaded: (mapX, mapY) => this.regionUnloaded(mapX, mapY),
        });
    }

    get(key: string): SkillLocInstance | undefined {
        return this.byKey.get(key);
    }

    all(): SkillLocInstance[] {
        return [...this.byKey.values()];
    }

    /** Instances within `r` tiles of a point on a plane. */
    near(plane: number, x: number, y: number, r: number): SkillLocInstance[] {
        return this.all().filter((i) => i.loc.plane === plane && distanceTo(i.loc, x, y) <= r);
    }

    /** Whether any skill loc covers this tile. */
    occupies(plane: number, x: number, y: number): boolean {
        return this.all().some((i) => i.loc.plane === plane && x >= i.loc.tileX && x < i.loc.tileX + i.loc.sizeX && y >= i.loc.tileY && y < i.loc.tileY + i.loc.sizeY);
    }

    /** Shows the look `look` picks now (after a skill changed its state). */
    refresh(key: string): void {
        const instance = this.byKey.get(key);
        if (instance) this.apply(instance);
    }

    /** Places a loc of the game's own (a fire, a trap) with its model at the tile's ground height. */
    addRuntime(loc: Omit<InteractiveLoc, "kind" | "level" | "rotation" | "skill">, object: THREE.Object3D): SkillLocInstance {
        const full: InteractiveLoc = { ...loc, kind: "skill", level: loc.plane, rotation: 0, skill: {} };
        const ground = this.world.groundHeight(loc.plane, loc.tileX + 0.5, loc.tileY + 0.5);
        object.position.set(loc.tileX + loc.sizeX / 2, ground, -(loc.tileY + loc.sizeY / 2));
        this.scene.add(object);
        const instance: SkillLocInstance = { loc: full, key: skillLocKey(full), mapX: 0, mapY: 0, geometries: [], meshes: new Map(), shown: -1, object };
        this.runtime.add(instance);
        this.byKey.set(instance.key, instance);
        return instance;
    }

    removeRuntime(instance: SkillLocInstance): void {
        if (!this.runtime.delete(instance)) return;
        if (instance.object) this.scene.remove(instance.object);
        if (this.byKey.get(instance.key) === instance) this.byKey.delete(instance.key);
    }

    targetSource(): TargetSource {
        const box: Box3 = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
        return (ray) => {
            let best: Target | undefined;
            const reach = ray.range + 3;
            for (const instance of this.byKey.values()) {
                const loc = instance.loc;
                if (loc.plane !== ray.plane || distanceTo(loc, ray.ox, ray.oy) > reach) continue;
                const actions = this.actionsOf?.(instance) ?? loc.actions.filter((a) => a !== "Examine");
                if (actions.length === 0) continue;
                const ground = this.world.groundHeight(loc.plane, loc.tileX + loc.sizeX / 2, loc.tileY + loc.sizeY / 2);
                Object.assign(box, {
                    minX: loc.tileX,
                    minY: loc.tileY,
                    maxX: loc.tileX + loc.sizeX,
                    maxY: loc.tileY + loc.sizeY,
                    minZ: ground,
                    maxZ: ground + Math.max(loc.height, MIN_TARGET_HEIGHT),
                });
                const t = rayBox(ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, box, ray.range);
                if (t !== undefined && (!best || t < best.distance)) {
                    best = { kind: "skill-loc", label: loc.name, actions, distance: t, ref: instance };
                }
            }
            return best;
        };
    }

    private apply(instance: SkillLocInstance): void {
        const skill = instance.loc.skill;
        if (instance.object || !skill || (skill.mesh === undefined && !skill.stateMeshes && !skill.furnitureMeshes)) return;
        const want = this.look?.(instance) ?? skill.mesh ?? -1;
        if (want === instance.shown) return;
        if (instance.shown >= 0) {
            const old = instance.meshes.get(instance.shown);
            if (old) old.visible = false;
        }
        instance.shown = want;
        if (want < 0) return;
        let group = instance.meshes.get(want);
        if (!group) {
            group = this.createMesh(instance, want);
            instance.meshes.set(want, group);
        }
        group.visible = true;
    }

    private createMesh(instance: SkillLocInstance, index: number): THREE.Group {
        const group = new THREE.Group();
        const geometry = instance.geometries[index];
        // Region meshes are in region-local tiles.
        group.position.set(instance.mapX * REGION_SIZE, 0, -instance.mapY * REGION_SIZE);
        const parts: [THREE.BufferGeometry | undefined, THREE.Material, number][] = [
            [geometry?.opaque, this.materials.opaque, 1],
            [geometry?.transparent, this.materials.transparent, 2],
        ];
        for (const [part, material, order] of parts) {
            if (!part) continue;
            const mesh = new THREE.Mesh(part, material);
            mesh.renderOrder = order;
            group.add(mesh);
        }
        this.scene.add(group);
        return group;
    }

    private regionLoaded(mapX: number, mapY: number): void {
        const key = regionKey(mapX, mapY);
        const data = this.world.regionInteractives(mapX, mapY);
        if (!data || this.regions.has(key)) return;
        const list: SkillLocInstance[] = [];
        for (const loc of data.locs) {
            if (loc.kind !== "skill") continue;
            const instance: SkillLocInstance = { loc, key: skillLocKey(loc), mapX, mapY, geometries: data.doorGeometries, meshes: new Map(), shown: -1 };
            list.push(instance);
            this.byKey.set(instance.key, instance);
            this.apply(instance);
        }
        this.regions.set(key, list);
    }

    private regionUnloaded(mapX: number, mapY: number): void {
        const key = regionKey(mapX, mapY);
        for (const instance of this.regions.get(key) ?? []) {
            // The geometry belongs to the World, which frees it.
            for (const group of instance.meshes.values()) this.scene.remove(group);
            if (this.byKey.get(instance.key) === instance) this.byKey.delete(instance.key);
        }
        this.regions.delete(key);
    }
}

/** Distance from a point to a loc's footprint (0 inside). */
export function distanceTo(loc: Pick<InteractiveLoc, "tileX" | "tileY" | "sizeX" | "sizeY">, x: number, y: number): number {
    const dx = Math.max(loc.tileX - x, 0, x - (loc.tileX + loc.sizeX));
    const dy = Math.max(loc.tileY - y, 0, y - (loc.tileY + loc.sizeY));
    return Math.hypot(dx, dy);
}
