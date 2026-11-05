import * as THREE from "three";

import { Body, BodySource, computePush } from "../physics/Bodies";
import { sweepAxis } from "../physics/Sweep";
import { BLOCKS_TILE, Box, FlagsAt } from "../physics/TileColliders";
import type { World } from "../world/World";
import { LEVELS } from "../world/WorldFormat";
import type { Input } from "./Input";
import { MoveMode, Vec2, accelerate, airAccelerate, friction, speedFor, wishSpeed } from "./MoveMath";
import { Stamina } from "./Stamina";
import { tuning } from "../combat/tuning";

// Distances are in tiles. An OSRS floor is 240 units (1.875 tiles) high.
export const EYE_HEIGHT = 1.25;
/** Half the width of the player's square footprint. Doorways are one tile wide. */
export const PLAYER_RADIUS = 0.3;
export const PLAYER_HEIGHT = 1.4;
export const CROUCH_EYE_HEIGHT = 0.8;
/** Default running and sprint speed in tiles per second (design choices, see MoveMath). */
export const WALK_SPEED = speedFor("run");
export const SPRINT_SPEED = speedFor("sprint");
const FLY_SPEED = 12;
const FLY_FAST_SPEED = 40;
/** Walking down slopes stays glued to the ground within this drop per frame. */
const STEP_DOWN = 0.35;
const MOUSE_SENSITIVITY = 0.0022;
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
    crouching = false;
    walking = false;
    /** Current eye height above the feet; eases towards the standing or crouching height. */
    eyeHeight = EYE_HEIGHT;
    readonly stamina = new Stamina();
    /** Called on touching down with the downward speed in tiles/s (fall damage, spec 19.8). */
    onLanded?: (speed: number) => void;
    /** Set when flying is switched off or the player teleports, so that drop does not hurt. */
    private ignoreNextLanding = false;

    /** Simulated horizontal velocity, persisting between updates (Source-style acceleration). */
    private readonly vel: Vec2 = { x: 0, y: 0 };
    private velocityZ = 0;
    private onGround = false;
    /** Seconds since take-off while the held-jump boost may still apply, or -1. */
    private jumpHeld = -1;
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

    /** Vertical velocity in tiles per second (negative while falling). */
    get verticalSpeed(): number {
        return this.velocityZ;
    }

    get speed(): number {
        return Math.hypot(this.velocityX, this.velocityY);
    }

    /**
     * Velocity the player is trying to move at, tiles/s, before bodies stop it. Props the player
     * walks into are shoved at this speed (spec 19.10).
     */
    get intentX(): number {
        return this.vel.x;
    }

    get intentY(): number {
        return this.vel.y;
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
        this.vel.x = this.vel.y = 0;
        this.onGround = false;
        this.placed = false;
        this.ignoreNextLanding = true;
        if (this.world.isLoaded(x, y)) {
            this.placeOnWalkableTile();
        }
    }

    /** Adds to the player's velocity, for knockback and lunges. Tiles per second. */
    applyImpulse(x: number, y: number, z = 0): void {
        this.vel.x += x;
        this.vel.y += y;
        if (z !== 0) {
            this.velocityZ += z;
            this.onGround = false;
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
            this.vel.x = this.vel.y = 0;
            if (!this.world.isLoaded(this.x, this.y)) {
                return;
            }
            this.placeOnWalkableTile();
        }

        if (input.wasPressed("KeyN")) {
            this.setFlying(!this.flying);
        }

        const forward = input.axis("KeyW", "KeyS");
        const strafe = input.axis("KeyD", "KeyA");
        const startX = this.x;
        const startY = this.y;
        if (this.flying) {
            this.fly(dt, input, forward, strafe);
        } else {
            this.walk(dt, input, forward, strafe);
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

    private walk(dt: number, input: PlayerInput, forward: number, strafe: number): void {
        this.crouching = input.isDown("KeyC");
        this.walking = input.isDown("AltLeft", "AltRight");
        const wantsSprint = input.isDown("ShiftLeft", "ShiftRight") && forward > 0 && !this.crouching;
        // Megasprint needs the start threshold to begin, then runs until stamina is empty.
        this.sprinting =
            wantsSprint && (this.sprinting ? this.stamina.canContinueSprint : this.stamina.canStartSprint);
        const mode: MoveMode = this.crouching
            ? "crouch"
            : this.sprinting
              ? "sprint"
              : this.walking
                ? "walk"
                : "run";
        this.stamina.update(dt, this.sprinting && this.speed > 0.5);
        const targetEye = this.crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
        this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 14);

        // Yaw 0 looks north; forward is (-sin, cos) and right is (cos, sin) in (east, north).
        const sin = Math.sin(this.yaw);
        const cos = Math.cos(this.yaw);
        let wishX = strafe * cos - forward * sin;
        let wishY = strafe * sin + forward * cos;
        const length = Math.hypot(wishX, wishY);
        if (length > 0) {
            wishX /= length;
            wishY /= length;
        }
        const wish = wishSpeed(mode, forward, strafe);
        const wishDir = { x: wishX, y: wishY };
        if (this.onGround) {
            friction(this.vel, dt);
            if (length > 0) {
                accelerate(this.vel, wishDir, wish, dt);
            }
        } else if (length > 0) {
            airAccelerate(this.vel, wishDir, wish, dt);
        }

        const dx = this.vel.x * dt;
        const dy = this.vel.y * dt;
        const moving = this.vel.x !== 0 || this.vel.y !== 0;
        this.moveX = moving ? wishX : 0;
        this.moveY = moving ? wishY : 0;

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
        const startX = this.x;
        const startY = this.y;
        for (let i = 0; i < steps; i++) {
            this.x = this.sweep(true, dx / steps);
            this.y = this.sweep(false, dy / steps);
            this.resolveBodies();
        }
        // A blocked axis loses its velocity (clipping against an axis-aligned surface).
        if (Math.abs(this.x - startX) < Math.abs(dx) - 1e-4) {
            this.vel.x = 0;
        }
        if (Math.abs(this.y - startY) < Math.abs(dy) - 1e-4) {
            this.vel.y = 0;
        }

        // Walked off the edge of an upper floor: fall to the plane below.
        while (this.plane > 0 && !this.world.hasFloor(this.plane, this.x, this.y)) {
            this.plane--;
            this.onGround = false;
        }

        const ground = this.world.groundHeight(this.plane, this.x, this.y);
        // Spec 16.2: 160 u/s take-off, allowed while falling with ground within 17 u below; holding
        // jump adds 672 u/s² for 0.3 s more.
        const nearGround = this.onGround || (this.velocityZ < 0 && this.z - ground <= tuning.jumpGroundSnap);
        if (nearGround && input.wasPressed("Space")) {
            this.velocityZ = this.crouching ? tuning.jumpSpeed : Math.max(0, this.velocityZ) + tuning.jumpSpeed;
            this.onGround = false;
            this.jumpHeld = 0;
        } else if (this.jumpHeld >= 0) {
            const left = tuning.jumpHoldTime - this.jumpHeld;
            if (!input.isDown("Space") || left <= 0) {
                this.jumpHeld = -1;
            } else {
                this.velocityZ += tuning.jumpHoldAccel * Math.min(dt, left);
                this.jumpHeld += dt;
            }
        }

        this.velocityZ -= tuning.gravity * dt;
        this.z += this.velocityZ * dt;
        if (this.z <= ground) {
            const landing = -this.velocityZ;
            this.z = ground;
            this.velocityZ = 0;
            if (!this.onGround && landing > 0) {
                if (this.ignoreNextLanding) {
                    this.ignoreNextLanding = false;
                } else {
                    this.onLanded?.(landing);
                }
            }
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
        this.ignoreNextLanding = !flying;
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
        return sweepAxis(this.flagsAt, this.plane, this.x, this.y, RADIUS, alongX, delta, this.boxes);
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
