import * as THREE from "three";

import type { NpcAppearanceInfo, NpcClip, NpcSpawnInfo } from "../world/NpcFormat";
import { CollisionFlag, RS_UNITS_PER_TILE } from "../world/WorldFormat";
import { ClipPlayback, advanceClip, orientationToYaw, writeFramePositions } from "./NpcAnimation";
import {
    FlagLookup,
    MAX_QUEUED_STEPS,
    Tile,
    WANDER_CHANCE,
    canStep,
    faceOrientation,
    findWanderPath,
    rotateTowards,
    stepOrientation,
} from "./NpcMovement";
import type { Body } from "../physics/Bodies";
import type { SharedNpcModel } from "./NpcModels";

/** Asks whether an NPC may move to a point (tiles); true means something is in the way. */
export type MoveBlocker = (npc: Npc, x: number, y: number) => boolean;

/** The parts of World an NPC needs. */
export type NpcWorld = {
    collisionFlags(plane: number, tileX: number, tileY: number): number;
    groundHeight(plane: number, x: number, y: number): number;
    renderLevel(plane: number, x: number, y: number): number;
};

/** Which tiles are covered by NPCs, so two NPCs never share a tile. */
export class Occupancy {
    private readonly counts = new Map<number, number>();

    private key(plane: number, x: number, y: number): number {
        return (plane * 8192 + x) * 16384 + y;
    }

    private forEachTile(x: number, y: number, size: number, fn: (x: number, y: number) => void) {
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                fn(x + i, y + j);
            }
        }
    }

    add(plane: number, x: number, y: number, size: number): void {
        this.forEachTile(x, y, size, (tx, ty) => {
            const key = this.key(plane, tx, ty);
            this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
        });
    }

    remove(plane: number, x: number, y: number, size: number): void {
        this.forEachTile(x, y, size, (tx, ty) => {
            const key = this.key(plane, tx, ty);
            const count = (this.counts.get(key) ?? 0) - 1;
            if (count > 0) {
                this.counts.set(key, count);
            } else {
                this.counts.delete(key);
            }
        });
    }

    isFree(plane: number, x: number, y: number, size: number): boolean {
        let free = true;
        this.forEachTile(x, y, size, (tx, ty) => {
            free &&= !this.counts.has(this.key(plane, tx, ty));
        });
        return free;
    }

    get size(): number {
        return this.counts.size;
    }
}

type NpcMesh = { mesh: THREE.Mesh; positions: THREE.BufferAttribute; sources: Uint16Array };

const DEFAULT_ROTATION_SPEED = 32;

/** One NPC in the world: a mesh whose vertices are animated by copying baked frames. */
export class Npc {
    readonly group = new THREE.Group();
    /** South-west tile on the server's grid. */
    tileX: number;
    tileY: number;
    /** Smooth client position in RS units (128 per tile) of the NPC's centre. */
    fineX: number;
    fineY: number;
    rotation: number;
    orientation: number;
    /** Collision cylinder, kept in sync with the drawn position. */
    readonly body: Body<Npc>;

    private readonly spawn: Tile;
    private readonly size: number;
    private readonly rotationSpeed: number;
    private readonly meshes: NpcMesh[] = [];
    private readonly steps: Tile[] = [];
    private serverPath: Tile[] = [];
    private readonly playback: ClipPlayback = { frame: 0, cycle: 0 };
    private walking = false;
    /** True while the last client cycle was blocked by the player. */
    private stalled = false;
    private holdTicks = 0;
    private clip: NpcClip | undefined;
    private dirty = true;

    constructor(
        readonly appearance: NpcAppearanceInfo,
        readonly info: NpcSpawnInfo,
        private readonly model: SharedNpcModel,
        materials: { opaque: THREE.Material; transparent: THREE.Material },
        private readonly world: NpcWorld,
        random: () => number,
    ) {
        this.size = Math.max(1, appearance.size);
        this.rotationSpeed = appearance.rotationSpeed ?? DEFAULT_ROTATION_SPEED;
        this.spawn = { x: info.x, y: info.y };
        this.tileX = info.x;
        this.tileY = info.y;
        this.fineX = info.x * RS_UNITS_PER_TILE + this.size * (RS_UNITS_PER_TILE / 2);
        this.fineY = info.y * RS_UNITS_PER_TILE + this.size * (RS_UNITS_PER_TILE / 2);
        this.rotation = this.orientation = info.orientation;
        this.body = {
            x: this.fineX / RS_UNITS_PER_TILE,
            y: this.fineY / RS_UNITS_PER_TILE,
            z: 0,
            radius: this.size * 0.5 - 0.15,
            height: model.height,
            plane: info.plane,
            owner: this,
        };

        const level = world.renderLevel(info.plane, info.x, info.y);
        for (const shared of model.meshes) {
            const positions = new THREE.BufferAttribute(new Int16Array(shared.source.positions), 4);
            positions.setUsage(THREE.DynamicDrawUsage);
            // Depth bias plane bits, see the vertex shader.
            for (let i = 3; i < positions.array.length; i += 4) {
                positions.array[i] |= level << 13;
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute("a_position", positions);
            geometry.setAttribute("a_color", shared.colors);
            geometry.setAttribute("a_uv", shared.uvs);
            geometry.setIndex(shared.index);
            // There is no `position` attribute for three.js to measure, so supply culling bounds.
            const [cx, cy, cz, radius] = model.data.bounds;
            geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), radius);
            geometry.boundingBox = new THREE.Box3(
                new THREE.Vector3(cx - radius, cy - radius, cz - radius),
                new THREE.Vector3(cx + radius, cy + radius, cz + radius),
            );

            const mesh = new THREE.Mesh(
                geometry,
                shared.transparent ? materials.transparent : materials.opaque,
            );
            mesh.renderOrder = shared.transparent ? 2 : 1;
            this.group.add(mesh);
            this.meshes.push({ mesh, positions, sources: shared.source.sources });
        }

        this.clip = model.data.idle;
        if (this.clip && this.clip.frameLengths.length > 0) {
            // Start at a random point so NPCs of one kind are not in sync.
            this.playback.frame = Math.floor(random() * this.clip.frameLengths.length);
            this.playback.cycle = Math.floor(random() * this.clip.frameLengths[this.playback.frame]);
        }
    }

    /** True if this NPC can wander (has a walk animation). */
    get canWalk(): boolean {
        return this.model.data.walk !== undefined;
    }

    /** Once per server tick (600 ms): maybe pick a wander target, then take one step. */
    serverTick(
        occupancy: Occupancy,
        random: () => number,
    ): void {
        if (this.holdTicks > 0) {
            this.holdTicks--;
            return;
        }
        if (this.stalled) {
            return;
        }
        const plane = this.info.plane;
        const flags: FlagLookup = (x, y) => this.world.collisionFlags(plane, x, y);

        if (
            this.canWalk &&
            (flags(this.spawn.x, this.spawn.y) & CollisionFlag.FLOOR) === 0 &&
            random() < WANDER_CHANCE
        ) {
            const target = {
                x: this.spawn.x + Math.round(random() * 10 - 5),
                y: this.spawn.y + Math.round(random() * 10 - 5),
            };
            this.serverPath = findWanderPath(
                flags,
                { x: this.tileX, y: this.tileY },
                target,
                this.size,
                this.spawn,
            );
        }

        const next = this.serverPath.shift();
        if (!next) {
            return;
        }
        const dx = Math.sign(next.x - this.tileX);
        const dy = Math.sign(next.y - this.tileY);
        occupancy.remove(plane, this.tileX, this.tileY, this.size);
        if (
            this.steps.length < MAX_QUEUED_STEPS &&
            canStep(flags, this.tileX, this.tileY, dx, dy, this.size) &&
            occupancy.isFree(plane, next.x, next.y, this.size)
        ) {
            this.tileX = next.x;
            this.tileY = next.y;
            this.steps.push({ x: next.x, y: next.y });
        } else {
            this.serverPath = [];
        }
        occupancy.add(plane, this.tileX, this.tileY, this.size);
    }

    /** Stops wandering for a number of server ticks (an NPC that is being talked to). */
    hold(ticks: number): void {
        this.serverPath = [];
        this.holdTicks = ticks;
    }

    /** Turns to look at a point in world tiles. */
    faceTowards(x: number, y: number): void {
        this.orientation = faceOrientation(
            x - this.fineX / RS_UNITS_PER_TILE,
            y - this.fineY / RS_UNITS_PER_TILE,
        );
    }

    /** Once per 20 ms client cycle: move towards queued steps, turn, animate. */
    clientCycle(blocker?: MoveBlocker): void {
        const half = this.size * (RS_UNITS_PER_TILE / 2);
        const wasWalking = this.walking;
        const hasSteps = this.steps.length > 0;
        this.stalled = false;

        if (hasSteps) {
            const next = this.steps[0];
            const nextX = next.x * RS_UNITS_PER_TILE + half;
            const nextY = next.y * RS_UNITS_PER_TILE + half;
            this.orientation = stepOrientation(
                Math.sign(nextX - this.fineX),
                Math.sign(nextY - this.fineY),
            );

            let newX = nextX;
            let newY = nextY;
            if (Math.abs(nextX - this.fineX) <= 256 && Math.abs(nextY - this.fineY) <= 256) {
                let speed = 4;
                if (this.rotation !== this.orientation && this.rotationSpeed !== 0) {
                    speed = 2;
                }
                if (this.steps.length > 2) {
                    speed = 6;
                }
                if (this.steps.length > 3) {
                    speed = 8;
                }
                newX = this.fineX + Math.sign(nextX - this.fineX) * Math.min(speed, Math.abs(nextX - this.fineX));
                newY = this.fineY + Math.sign(nextY - this.fineY) * Math.min(speed, Math.abs(nextY - this.fineY));
            }
            // else: too far behind (a long frame), catch up.

            if (blocker?.(this, newX / RS_UNITS_PER_TILE, newY / RS_UNITS_PER_TILE)) {
                this.stalled = true;
            } else {
                this.fineX = newX;
                this.fineY = newY;
                if (this.fineX === nextX && this.fineY === nextY) {
                    this.steps.shift();
                }
            }
        }
        this.walking = hasSteps && !this.stalled;

        this.rotation = rotateTowards(this.rotation, this.orientation, this.rotationSpeed);

        const walk = this.model.data.walk;
        const clip = this.walking && walk ? walk : this.model.data.idle;
        if (clip !== this.clip || wasWalking !== this.walking) {
            if (clip !== this.clip) {
                this.playback.frame = 0;
                this.playback.cycle = 0;
            }
            this.clip = clip;
            this.dirty = true;
        }
        if (this.clip && advanceClip(this.playback, this.clip, 1)) {
            this.dirty = true;
        }
    }

    /** Applies the current position, rotation and animation frame to the meshes. */
    sync(): void {
        const x = this.fineX / RS_UNITS_PER_TILE;
        const y = this.fineY / RS_UNITS_PER_TILE;
        const z = this.world.groundHeight(this.info.plane, x, y);
        this.group.position.set(x, z, -y);
        this.body.x = x;
        this.body.y = y;
        this.body.z = z;
        this.group.rotation.y = orientationToYaw(this.rotation);

        if (this.dirty && this.clip) {
            for (const { positions, sources } of this.meshes) {
                writeFramePositions(
                    positions.array as Int16Array,
                    sources,
                    this.clip.positions,
                    this.playback.frame,
                    this.model.data.vertexCount,
                );
                positions.needsUpdate = true;
            }
        }
        this.dirty = false;
    }

    dispose(): void {
        for (const { mesh } of this.meshes) {
            mesh.geometry.dispose();
        }
        this.group.removeFromParent();
    }
}
