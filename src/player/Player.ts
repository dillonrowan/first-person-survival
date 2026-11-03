import * as THREE from "three";

import { World } from "../world/World";
import { CollisionFlag, LEVELS } from "../world/WorldFormat";
import { Input } from "./Input";

// Distances are in tiles. An OSRS floor is 240 units (1.875 tiles) high.
const EYE_HEIGHT = 1.25;
/** Half the width of the player's square footprint. Doorways are one tile wide. */
const RADIUS = 0.3;
const WALL_HALF_THICKNESS = 0.08;
const WALK_SPEED = 3.5;
const SPRINT_SPEED = 6.5;
const FLY_SPEED = 12;
const FLY_FAST_SPEED = 40;
const GRAVITY = 18;
const JUMP_SPEED = 5.5;
/** Walking down slopes stays glued to the ground within this drop per frame. */
const STEP_DOWN = 0.35;
const MOUSE_SENSITIVITY = 0.0022;
const EPSILON = 1e-4;

const BLOCKS_TILE = CollisionFlag.OBJECT | CollisionFlag.FLOOR | CollisionFlag.FLOOR_DECORATION;

type Box = { minX: number; minY: number; maxX: number; maxY: number };

const t = WALL_HALF_THICKNESS;
/** Thin box per wall flag, as [flag, minX, minY, maxX, maxY] relative to the tile's SW corner. */
const WALL_BOXES: [number, number, number, number, number][] = [
    [CollisionFlag.WALL_WEST, -t, 0, t, 1],
    [CollisionFlag.WALL_EAST, 1 - t, 0, 1 + t, 1],
    [CollisionFlag.WALL_SOUTH, 0, -t, 1, t],
    [CollisionFlag.WALL_NORTH, 0, 1 - t, 1, 1 + t],
    // Corner pieces, which stop the player cutting diagonally past a wall's end.
    [CollisionFlag.WALL_NORTH_WEST, -t, 1 - t, t, 1 + t],
    [CollisionFlag.WALL_NORTH_EAST, 1 - t, 1 - t, 1 + t, 1 + t],
    [CollisionFlag.WALL_SOUTH_EAST, 1 - t, -t, 1 + t, t],
    [CollisionFlag.WALL_SOUTH_WEST, -t, -t, t, t],
];

/**
 * First-person walker on the exported OSRS map. Position is in world tiles: x east, y north,
 * z = feet height. Collision uses the client's tile flags: blocked tiles are solid squares and
 * wall flags are thin boxes along tile edges.
 */
export class Player {
    x: number;
    y: number;
    z = 0;
    plane: number;
    yaw = 0;
    pitch = 0;
    flying = false;

    private velocityZ = 0;
    private grounded = false;
    private placed = false;
    private readonly boxes: Box[] = [];

    constructor(
        private readonly world: World,
        private readonly camera: THREE.PerspectiveCamera,
        spawn: { x: number; y: number; plane: number },
    ) {
        this.x = spawn.x + 0.5;
        this.y = spawn.y + 0.5;
        this.plane = spawn.plane;
    }

    /** False until the spawn region has loaded and the player is standing on it. */
    get ready(): boolean {
        return this.placed;
    }

    update(dt: number, input: Input): void {
        const [lookX, lookY] = input.consumeLook();
        this.yaw -= lookX * MOUSE_SENSITIVITY;
        this.pitch = THREE.MathUtils.clamp(
            this.pitch - lookY * MOUSE_SENSITIVITY,
            -Math.PI / 2 + 0.01,
            Math.PI / 2 - 0.01,
        );

        if (!this.placed) {
            if (!this.world.isLoaded(this.x, this.y)) {
                this.updateCamera();
                return;
            }
            this.placeOnWalkableTile();
        }

        if (input.wasPressed("KeyF")) {
            this.setFlying(!this.flying);
        }

        const forward = input.axis("KeyW", "KeyS");
        const strafe = input.axis("KeyD", "KeyA");
        if (this.flying) {
            this.fly(dt, input, forward, strafe);
        } else {
            // Yaw 0 looks north; forward is (-sin, cos) and right is (cos, sin) in (east, north).
            const sin = Math.sin(this.yaw);
            const cos = Math.cos(this.yaw);
            let moveX = strafe * cos - forward * sin;
            let moveY = strafe * sin + forward * cos;
            const length = Math.hypot(moveX, moveY);
            if (length > 1) {
                moveX /= length;
                moveY /= length;
            }
            this.walk(dt, input, moveX, moveY);
        }
        this.updateCamera();
    }

    /** Free flight without collision, along the view direction (looking up and pressing W climbs). */
    private fly(dt: number, input: Input, forward: number, strafe: number): void {
        const speed = (input.isDown("ShiftLeft", "ShiftRight") ? FLY_FAST_SPEED : FLY_SPEED) * dt;
        const sinYaw = Math.sin(this.yaw);
        const cosYaw = Math.cos(this.yaw);
        const cosPitch = Math.cos(this.pitch);
        // Not Ctrl: Ctrl+W would close the browser tab, and pages cannot prevent that.
        const up = input.axis("Space", "KeyC");
        this.x += (strafe * cosYaw - forward * sinYaw * cosPitch) * speed;
        this.y += (strafe * sinYaw + forward * cosYaw * cosPitch) * speed;
        this.z += (forward * Math.sin(this.pitch) + up) * speed;
    }

    private walk(dt: number, input: Input, moveX: number, moveY: number): void {
        const speed = input.isDown("ShiftLeft", "ShiftRight") ? SPRINT_SPEED : WALK_SPEED;
        const dx = moveX * speed * dt;
        const dy = moveY * speed * dt;
        // Sub-steps keep fast movement from tunnelling through thin walls.
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.2));
        for (let i = 0; i < steps; i++) {
            this.x = this.sweep(true, dx / steps);
            this.y = this.sweep(false, dy / steps);
        }

        // Walked off the edge of an upper floor: fall to the plane below.
        while (this.plane > 0 && !this.world.hasFloor(this.plane, this.x, this.y)) {
            this.plane--;
            this.grounded = false;
        }

        if (this.grounded && input.wasPressed("Space")) {
            this.velocityZ = JUMP_SPEED;
            this.grounded = false;
        }

        const ground = this.world.groundHeight(this.plane, this.x, this.y);
        this.velocityZ -= GRAVITY * dt;
        this.z += this.velocityZ * dt;
        if (this.z <= ground) {
            this.z = ground;
            this.velocityZ = 0;
            this.grounded = true;
        } else if (this.grounded && this.velocityZ <= 0 && this.z - ground <= STEP_DOWN) {
            this.z = ground;
            this.velocityZ = 0;
        } else {
            this.grounded = false;
        }
    }

    private setFlying(flying: boolean): void {
        this.flying = flying;
        this.velocityZ = 0;
        this.grounded = false;
        if (!flying) {
            // Land on the highest floor that is below the player's feet.
            for (let plane = LEVELS - 1; plane >= 0; plane--) {
                if (
                    this.world.hasFloor(plane, this.x, this.y) &&
                    this.world.groundHeight(plane, this.x, this.y) <= this.z + 0.3
                ) {
                    this.plane = plane;
                    break;
                }
            }
        }
    }

    /** Moves along one axis and returns the new coordinate on that axis, stopped by blockers. */
    private sweep(alongX: boolean, delta: number): number {
        const start = alongX ? this.x : this.y;
        if (delta === 0) {
            return start;
        }
        const target = start + delta;
        const toX = alongX ? target : this.x;
        const toY = alongX ? this.y : target;

        this.collectBoxes(
            Math.min(this.x, toX) - RADIUS,
            Math.min(this.y, toY) - RADIUS,
            Math.max(this.x, toX) + RADIUS,
            Math.max(this.y, toY) + RADIUS,
        );

        let resolved = target;
        for (const box of this.boxes) {
            // Boxes the player already overlaps are ignored, so a bad spot can be walked out of.
            if (
                box.minX < this.x + RADIUS &&
                box.maxX > this.x - RADIUS &&
                box.minY < this.y + RADIUS &&
                box.maxY > this.y - RADIUS
            ) {
                continue;
            }
            const [boxMin, boxMax, crossMin, crossMax, cross] = alongX
                ? [box.minX, box.maxX, box.minY, box.maxY, this.y]
                : [box.minY, box.maxY, box.minX, box.maxX, this.x];
            if (crossMax <= cross - RADIUS || crossMin >= cross + RADIUS) {
                continue;
            }
            if (delta > 0 && boxMin >= start + RADIUS - EPSILON) {
                resolved = Math.min(resolved, boxMin - RADIUS - EPSILON);
            } else if (delta < 0 && boxMax <= start - RADIUS + EPSILON) {
                resolved = Math.max(resolved, boxMax + RADIUS + EPSILON);
            }
        }
        return resolved;
    }

    private collectBoxes(minX: number, minY: number, maxX: number, maxY: number): void {
        this.boxes.length = 0;
        for (let tx = Math.floor(minX) - 1; tx <= Math.floor(maxX) + 1; tx++) {
            for (let ty = Math.floor(minY) - 1; ty <= Math.floor(maxY) + 1; ty++) {
                const flags = this.world.collisionFlags(this.plane, tx, ty);
                if (flags === 0) {
                    continue;
                }
                if (flags & BLOCKS_TILE) {
                    this.boxes.push({ minX: tx, minY: ty, maxX: tx + 1, maxY: ty + 1 });
                    continue;
                }
                for (const [flag, x0, y0, x1, y1] of WALL_BOXES) {
                    if (flags & flag) {
                        this.boxes.push({
                            minX: tx + x0,
                            minY: ty + y0,
                            maxX: tx + x1,
                            maxY: ty + y1,
                        });
                    }
                }
            }
        }
    }

    /** Moves the spawn point to the nearest tile that is not blocked. */
    private placeOnWalkableTile(): void {
        const startX = Math.floor(this.x);
        const startY = Math.floor(this.y);
        for (let radius = 0; radius < 16; radius++) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
                        continue;
                    }
                    const flags = this.world.collisionFlags(this.plane, startX + dx, startY + dy);
                    if ((flags & BLOCKS_TILE) === 0) {
                        this.x = startX + dx + 0.5;
                        this.y = startY + dy + 0.5;
                        this.z = this.world.groundHeight(this.plane, this.x, this.y);
                        this.placed = true;
                        return;
                    }
                }
            }
        }
        this.z = this.world.groundHeight(this.plane, this.x, this.y);
        this.placed = true;
    }

    private updateCamera(): void {
        this.camera.position.set(this.x, this.z + EYE_HEIGHT, -this.y);
        this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    }
}
