import * as THREE from "three";

import type { Target, TargetSource } from "../interaction/Interaction";
import { climbActions } from "../interaction/climb";
import { Body, BodySource, Box3, rayBox } from "../physics/Bodies";
import { FlagEdit, transitionEdits } from "./CollisionEdits";
import type { DoorGeometry } from "./World";
import { InteractiveLoc, REGION_SIZE, RegionListener } from "./WorldFormat";

/** Seconds a door takes to swing. */
const SWING_SECONDS = 0.3;
/** Half the thickness of the box a door is aimed at; wider than the wall's collision box. */
const TARGET_HALF_THICKNESS = 0.12;
const MIN_CLIMB_TARGET_HEIGHT = 1.5;

/** The parts of World this needs. */
export type InteractivesWorld = {
    addRegionListener(listener: RegionListener): void;
    regionInteractives(
        mapX: number,
        mapY: number,
    ): { locs: InteractiveLoc[]; doorGeometries: DoorGeometry[] } | undefined;
    groundHeight(plane: number, x: number, y: number): number;
    applyFlagEdits(edits: readonly FlagEdit[]): void;
    setPersistentEdits(id: string, edits: FlagEdit[] | undefined): void;
};

export type DoorInstance = {
    readonly loc: InteractiveLoc;
    readonly key: string;
    /** In its other state than the one it was placed in. */
    toggled: boolean;
    readonly pivot: THREE.Group;
    angle: number;
    /** The other leaf of a gate or double door. */
    partner?: DoorInstance;
};

type RegionInteractives = { doors: DoorInstance[]; climbs: InteractiveLoc[] };

const regionKey = (mapX: number, mapY: number) => (mapX << 8) | mapY;
const doorKey = (loc: InteractiveLoc) => `${loc.plane}:${loc.tileX}:${loc.tileY}:${loc.id}`;

/** Whether the door stands open right now. */
export function isDoorOpen(door: DoorInstance): boolean {
    return door.loc.door!.placedOpen !== door.toggled;
}

/** Box of the edge a door leaf lies on, x/y only, with the given half thickness. */
export function edgeBox(tileX: number, tileY: number, rotation: number, t: number) {
    switch (rotation & 3) {
        case 0:
            return { minX: tileX - t, minY: tileY, maxX: tileX + t, maxY: tileY + 1 };
        case 1:
            return { minX: tileX, minY: tileY + 1 - t, maxX: tileX + 1, maxY: tileY + 1 + t };
        case 2:
            return { minX: tileX + 1 - t, minY: tileY, maxX: tileX + 1 + t, maxY: tileY + 1 };
        default:
            return { minX: tileX, minY: tileY - t, maxX: tileX + 1, maxY: tileY + t };
    }
}

/** Rotation (edge) a door leaf currently lies on. */
function currentRotation(door: DoorInstance): number {
    return door.toggled ? door.loc.door!.rotationB : door.loc.rotation;
}

/**
 * Doors, gates and ladders of the loaded map squares. Doors swing around their hinge and move
 * their collision with them; ladders and stairs are only targets (see climb.ts).
 */
export class WorldInteractives {
    private readonly regions = new Map<number, RegionInteractives>();
    /** Doors in their other state; kept when squares unload so doors stay where the player left them. */
    private readonly toggledDoors = new Set<string>();
    private readonly animating = new Set<DoorInstance>();

    constructor(
        private readonly world: InteractivesWorld,
        private readonly scene: THREE.Scene,
        private readonly materials: { opaque: THREE.Material; transparent: THREE.Material },
        private readonly blockers: { bodies?: BodySource; player?: () => Body | undefined } = {},
    ) {
        world.addRegionListener({
            loaded: (mapX, mapY) => this.regionLoaded(mapX, mapY),
            unloaded: (mapX, mapY) => this.regionUnloaded(mapX, mapY),
        });
    }

    get doorCount(): number {
        let total = 0;
        for (const region of this.regions.values()) {
            total += region.doors.length;
        }
        return total;
    }

    allDoors(): DoorInstance[] {
        return [...this.regions.values()].flatMap((region) => region.doors);
    }

    /**
     * Opens or closes a door. Returns false, changing nothing, if a body stands where the door
     * would swing to.
     */
    toggle(door: DoorInstance): boolean {
        // The leaves of a gate or double door move together.
        const leaves = door.partner ? [door, door.partner] : [door];
        for (const leaf of leaves) {
            const destinationRotation = leaf.toggled ? leaf.loc.rotation : leaf.loc.door!.rotationB;
            const destination = edgeBox(leaf.loc.tileX, leaf.loc.tileY, destinationRotation, TARGET_HALF_THICKNESS);
            if (this.isOccupied(leaf.loc.plane, destination)) {
                return false;
            }
        }
        for (const leaf of leaves) {
            this.toggleLeaf(leaf);
        }
        return true;
    }

    private toggleLeaf(door: DoorInstance): void {
        const data = door.loc.door!;
        const toggled = !door.toggled;
        const edits = toggled
            ? transitionEdits(door.loc.plane, data.flagsA, data.flagsB)
            : transitionEdits(door.loc.plane, data.flagsB, data.flagsA);
        this.world.applyFlagEdits(edits);
        this.world.setPersistentEdits(door.key, toggled ? edits : undefined);

        door.toggled = toggled;
        if (toggled) {
            this.toggledDoors.add(door.key);
        } else {
            this.toggledDoors.delete(door.key);
        }
        this.animating.add(door);
    }

    /** Swings doors towards their state. Call once per frame. */
    update(dt: number): void {
        for (const door of this.animating) {
            const target = door.toggled ? door.loc.door!.swing * (Math.PI / 2) : 0;
            const step = (Math.PI / 2 / SWING_SECONDS) * dt;
            const difference = target - door.angle;
            door.angle = Math.abs(difference) <= step ? target : door.angle + Math.sign(difference) * step;
            door.pivot.rotation.y = door.angle;
            if (door.angle === target) {
                this.animating.delete(door);
            }
        }
    }

    /** Aims at the nearest door, gate or ladder hit by the ray. */
    targetSource(): TargetSource {
        const box: Box3 = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
        return (ray) => {
            let best: Target | undefined;
            const consider = (target: Target) => {
                if (!best || target.distance < best.distance) {
                    best = target;
                }
            };
            const reach = ray.range + 2;
            for (const region of this.regions.values()) {
                for (const door of region.doors) {
                    const loc = door.loc;
                    if (loc.plane !== ray.plane || !near(loc, ray.ox, ray.oy, reach)) {
                        continue;
                    }
                    const edge = edgeBox(loc.tileX, loc.tileY, currentRotation(door), TARGET_HALF_THICKNESS);
                    const ground = this.world.groundHeight(loc.plane, loc.tileX + 0.5, loc.tileY + 0.5);
                    Object.assign(box, edge, { minZ: ground, maxZ: ground + loc.height });
                    const t = rayBox(ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, box, ray.range);
                    if (t !== undefined) {
                        consider({
                            kind: "door",
                            label: loc.name,
                            actions: [isDoorOpen(door) ? "Close" : "Open"],
                            distance: t,
                            ref: door,
                        });
                    }
                }
                for (const loc of region.climbs) {
                    if (loc.plane !== ray.plane || !near(loc, ray.ox, ray.oy, reach)) {
                        continue;
                    }
                    const ground = this.world.groundHeight(loc.plane, loc.tileX + 0.5, loc.tileY + 0.5);
                    Object.assign(box, {
                        minX: loc.tileX,
                        minY: loc.tileY,
                        maxX: loc.tileX + loc.sizeX,
                        maxY: loc.tileY + loc.sizeY,
                        minZ: ground,
                        maxZ: ground + Math.max(loc.height, MIN_CLIMB_TARGET_HEIGHT),
                    });
                    const t = rayBox(ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, box, ray.range);
                    if (t !== undefined) {
                        consider({
                            kind: "climb",
                            label: loc.name,
                            actions: climbActions(loc.actions).slice(0, 2),
                            distance: t,
                            ref: loc,
                        });
                    }
                }
            }
            return best;
        };
    }

    private isOccupied(plane: number, box: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
        const bodies: Body[] = [];
        this.blockers.bodies?.collectBodies(plane, box.minX, box.minY, box.maxX, box.maxY, bodies);
        const player = this.blockers.player?.();
        if (player && player.plane === plane) {
            bodies.push(player);
        }
        return bodies.some((body) => {
            const dx = body.x - Math.min(Math.max(body.x, box.minX), box.maxX);
            const dy = body.y - Math.min(Math.max(body.y, box.minY), box.maxY);
            return dx * dx + dy * dy < body.radius * body.radius;
        });
    }

    private regionLoaded(mapX: number, mapY: number): void {
        const key = regionKey(mapX, mapY);
        const data = this.world.regionInteractives(mapX, mapY);
        if (!data || this.regions.has(key)) {
            return;
        }
        const region: RegionInteractives = { doors: [], climbs: [] };
        const byIndex = new Map<number, DoorInstance>();
        data.locs.forEach((loc, index) => {
            if (loc.kind === "climb") {
                region.climbs.push(loc);
            } else if (loc.door) {
                const door = this.createDoor(loc, mapX, mapY, data.doorGeometries[loc.door.mesh]);
                region.doors.push(door);
                byIndex.set(index, door);
            }
        });
        data.locs.forEach((loc, index) => {
            const partner = loc.door?.partner;
            if (partner !== undefined) {
                byIndex.get(index)!.partner = byIndex.get(partner);
            }
        });
        this.regions.set(key, region);
    }

    private createDoor(
        loc: InteractiveLoc,
        mapX: number,
        mapY: number,
        geometry: DoorGeometry | undefined,
    ): DoorInstance {
        const data = loc.door!;
        const key = doorKey(loc);
        const toggled = this.toggledDoors.has(key);
        const [hingeX, hingeY] = data.hinge;

        // The meshes are in region-local units; offset them so the pivot sits on the hinge.
        const pivot = new THREE.Group();
        pivot.position.set(hingeX, 0, -hingeY);
        const parts: [THREE.BufferGeometry | undefined, THREE.Material, number][] = [
            [geometry?.opaque, this.materials.opaque, 1],
            [geometry?.transparent, this.materials.transparent, 2],
        ];
        for (const [part, material, renderOrder] of parts) {
            if (part) {
                const mesh = new THREE.Mesh(part, material);
                mesh.position.set(mapX * REGION_SIZE - hingeX, 0, -mapY * REGION_SIZE + hingeY);
                mesh.renderOrder = renderOrder;
                pivot.add(mesh);
            }
        }
        const angle = toggled ? data.swing * (Math.PI / 2) : 0;
        pivot.rotation.y = angle;
        this.scene.add(pivot);
        return { loc, key, toggled, pivot, angle };
    }

    private regionUnloaded(mapX: number, mapY: number): void {
        const key = regionKey(mapX, mapY);
        const region = this.regions.get(key);
        if (!region) {
            return;
        }
        for (const door of region.doors) {
            this.animating.delete(door);
            // The geometry belongs to the World, which frees it.
            this.scene.remove(door.pivot);
        }
        this.regions.delete(key);
    }
}

/** Cheap pre-check: is the loc within `reach` tiles of the ray's origin? */
function near(loc: InteractiveLoc, x: number, y: number, reach: number): boolean {
    return (
        loc.tileX - reach <= x && x <= loc.tileX + loc.sizeX + reach &&
        loc.tileY - reach <= y && y <= loc.tileY + loc.sizeY + reach
    );
}
