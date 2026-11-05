import * as THREE from "three";

import { Body, BodySource, computePush } from "../physics/Bodies";
import { BLOCKS_TILE, Box, FlagsAt, collectTileBoxes } from "../physics/TileColliders";
import type { World } from "../world/World";
import { LEVELS } from "../world/WorldFormat";
import type { Input } from "./Input";

// Distances are in tiles. An OSRS floor is 240 units (1.875 tiles) high.
export const EYE_HEIGHT = 1.25;
/** Half the width of the player's square footprint. Doorways are one tile wide. */
export const PLAYER_RADIUS = 0.3;
export const PLAYER_HEIGHT = 1.4;
export const WALK_SPEED = 3.5;
export const SPRINT_SPEED = 6.5;
const FLY_SPEED = 12;
const FLY_FAST_SPEED = 40;
const GRAVITY = 18;
const JUMP_SPEED = 5.5;
/** Walking down slopes stays glued to the ground within this drop per frame. */
const STEP_DOWN = 0.35;
const MOUSE_SENSITIVITY = 0.0022;
const EPSILON = 1e-4;
/** Longest distance moved per collision sub-step; keeps fast movement from tunnelling. */
const MAX_SUBSTEP = 0.2;
const MAX_PUSH_ITERATIONS = 3;
/** Extra margin when looking for bodies, for pushes that move the player a bit further. */
const BODY_QUERY_MARGIN = 0.5;

const RADIUS = PLAYER_RADIUS;

/** The parts of World the player needs. */
export type PlayerWorld = Pick<World, "isLoaded" | "hasFloor" | "groundHeight" | "collisionFlags">;
/** The parts of Input the player reads. */
export type PlayerInput = Pick<Input, "consumeLook" | "wasPressed" | "axis" | "isDown">;

/**
 * First-person walker on the exported OSRS map. Position is in world tiles: x east, y north,
 * z = feet height. Collision uses the client's tile flags: blocked tiles are solid squares and
 * wall flags are thin boxes along tile edges. Other bodies (NPCs) are cylinders the player is
 * pushed out of, so it slides around them.
 */
export class Player {
    x: number;
    y: number;
    z = 0;
    plane: number;
    yaw = 0;
    pitch = 0;
    flying = false;

    /** Actual velocity of the last update in tiles per second, after collision. */
    velocityX = 0;
    velocityY = 0;
    sprinting = false;

    private velocityZ = 0;
    private onGround = false;
    private placed = false;
    private readonly boxes: Box[] = [];
    private readonly nearby: Body[] = [];
    private readonly push = { x: 0, y: 0 };
    private readonly body: Body<Player>;
    private readonly bodies?: BodySource;
    private readonly flagsAt: FlagsAt;
    private moveX = 0;
    private moveY = 0;

    constructor(
        private readonly world: PlayerWorld,
        spawn: { x: number; y: number; plane: number },
        options: { bodies?: BodySource } = {},
    ) {
        this.x = spawn.x + 0.5;
        this.y = spawn.y + 0.5;
        this.plane = spawn.plane;
        this.bodies = options.bodies;
        this.flagsAt = (plane, x, y) => world.collisionFlags(plane, x, y);
        this.body = {
            x: this.x,
            y: this.y,
            z: 0,
            radius: RADIUS,
            height: PLAYER_HEIGHT,
            plane: spawn.plane,
            owner: this,
        };
    }

    /** False until the spawn region has loaded and the player is standing on it. */
    get ready(): boolean {
        return this.placed;
    }

    get grounded(): boolean {
        return this.onGround;
    }

    get speed(): number {
        return Math.hypot(this.velocityX, this.velocityY);
    }

    /** Velocity along the facing direction: positive walking forward, negative backwards. */
    get localForward(): number {
        return this.velocityX * -Math.sin(this.yaw) + this.velocityY * Math.cos(this.yaw);
    }

    /** The player as a collision cylinder, or undefined while flying or not yet placed. */
    footprint(): Body<Player> | undefined {
        if (!this.placed || this.flying) {
            return undefined;
        }
        const body = this.body;
        body.x = this.x;
        body.y = this.y;
        body.z = this.z;
        body.plane = this.plane;
        return body;
    }

    /** Moves the player; waits for the target region to load if it has not yet. */
    teleport(x: number, y: number, plane: number): void {
        this.x = x;
        this.y = y;
        this.plane = plane;
        this.velocityZ = 0;
        this.onGround = false;
        this.placed = false;
        if (this.world.isLoaded(x, y)) {
            this.placeOnWalkableTile();
        }
    }

    update(dt: number, input: PlayerInput): void {
        const [lookX, lookY] = input.consumeLook();
        this.yaw -= lookX * MOUSE_SENSITIVITY;
        this.pitch = THREE.MathUtils.clamp(
            this.pitch - lookY * MOUSE_SENSITIVITY,
            -Math.PI / 2 + 0.01,
            Math.PI / 2 - 0.01,
        );

        if (!this.placed) {
            this.velocityX = this.velocityY = 0;
            if (!this.world.isLoaded(this.x, this.y)) {
                return;
            }
            this.placeOnWalkableTile();
        }

        if (input.wasPressed("KeyF")) {
            this.setFlying(!this.flying);
        }

        const forward = input.axis("KeyW", "KeyS");
        const strafe = input.axis("KeyD", "KeyA");
        const startX = this.x;
        const startY = this.y;
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
        this.velocityX = dt > 0 ? (this.x - startX) / dt : 0;
        this.velocityY = dt > 0 ? (this.y - startY) / dt : 0;
    }

    /** Free flight without collision, along the view direction (looking up and pressing W climbs). */
    private fly(dt: number, input: PlayerInput, forward: number, strafe: number): void {
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

    private walk(dt: number, input: PlayerInput, moveX: number, moveY: number): void {
        this.sprinting = input.isDown("ShiftLeft", "ShiftRight");
        const speed = this.sprinting ? SPRINT_SPEED : WALK_SPEED;
        const dx = moveX * speed * dt;
        const dy = moveY * speed * dt;
        this.moveX = moveX;
        this.moveY = moveY;

        this.nearby.length = 0;
        this.bodies?.collectBodies(
            this.plane,
            this.x - RADIUS - BODY_QUERY_MARGIN - Math.abs(dx),
            this.y - RADIUS - BODY_QUERY_MARGIN - Math.abs(dy),
            this.x + RADIUS + BODY_QUERY_MARGIN + Math.abs(dx),
            this.y + RADIUS + BODY_QUERY_MARGIN + Math.abs(dy),
            this.nearby,
        );

        // Something may have moved or spawned into the player since the last frame.
        this.resolveBodies();
        // Sub-steps keep fast movement from tunnelling through thin walls and bodies.
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MAX_SUBSTEP));
        for (let i = 0; i < steps; i++) {
            this.x = this.sweep(true, dx / steps);
            this.y = this.sweep(false, dy / steps);
            this.resolveBodies();
        }

        // Walked off the edge of an upper floor: fall to the plane below.
        while (this.plane > 0 && !this.world.hasFloor(this.plane, this.x, this.y)) {
            this.plane--;
            this.onGround = false;
        }

        if (this.onGround && input.wasPressed("Space")) {
            this.velocityZ = JUMP_SPEED;
            this.onGround = false;
        }

        const ground = this.world.groundHeight(this.plane, this.x, this.y);
        this.velocityZ -= GRAVITY * dt;
        this.z += this.velocityZ * dt;
        if (this.z <= ground) {
            this.z = ground;
            this.velocityZ = 0;
            this.onGround = true;
        } else if (this.onGround && this.velocityZ <= 0 && this.z - ground <= STEP_DOWN) {
            this.z = ground;
            this.velocityZ = 0;
        } else {
            this.onGround = false;
        }
    }

    /** Pushes the player out of overlapping bodies; walls always win over the push. */
    private resolveBodies(): void {
        if (this.nearby.length === 0) {
            return;
        }
        for (let i = 0; i < MAX_PUSH_ITERATIONS; i++) {
            if (
                !computePush(
                    this.x,
                    this.y,
                    this.z,
                    RADIUS,
                    PLAYER_HEIGHT,
                    this.nearby,
                    -this.moveX,
                    -this.moveY,
                    this.push,
                )
            ) {
                return;
            }
            this.x = this.sweep(true, this.push.x);
            this.y = this.sweep(false, this.push.y);
        }
    }

    private setFlying(flying: boolean): void {
        this.flying = flying;
        this.velocityZ = 0;
        this.onGround = false;
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

        collectTileBoxes(
            this.flagsAt,
            this.plane,
            Math.min(this.x, toX) - RADIUS,
            Math.min(this.y, toY) - RADIUS,
            Math.max(this.x, toX) + RADIUS,
            Math.max(this.y, toY) + RADIUS,
            this.boxes,
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

    /** Moves the spawn point to the nearest tile that is not blocked and has a floor. */
    private placeOnWalkableTile(): void {
        const startX = Math.floor(this.x);
        const startY = Math.floor(this.y);
        for (let radius = 0; radius < 16; radius++) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
                        continue;
                    }
                    const tx = startX + dx;
                    const ty = startY + dy;
                    const flags = this.world.collisionFlags(this.plane, tx, ty);
                    if ((flags & BLOCKS_TILE) === 0 && this.world.hasFloor(this.plane, tx, ty)) {
                        this.x = tx + 0.5;
                        this.y = ty + 0.5;
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
}
