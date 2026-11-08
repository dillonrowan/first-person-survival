import * as THREE from "three";

import { tuning } from "../combat/tuning";
import { sweepAxis } from "./Sweep";
import type { Box, FlagsAt } from "./TileColliders";

/** What a prop needs from the world. */
export type PropWorld = {
    flagsAt: FlagsAt;
    groundHeight(plane: number, x: number, y: number): number;
    hasFloor(plane: number, x: number, y: number): boolean;
};

/** A collision with walls or the ground during a step, speeds in tiles/s. */
export type WorldImpact = { speed: number; speedLoss: number };

/** Longest move per collision sub-step; keeps fast throws from tunnelling through thin walls. */
const MAX_SUBSTEP = 0.2;
/** Landing slower than this does not bounce. */
const MIN_BOUNCE_SPEED = 1.5;
/** Resting props follow the ground down this far per step (slopes). */
const STEP_DOWN = 0.1;
/** Spin left after an impact, radians/s per tile/s of impact speed. [design] */
const IMPACT_SPIN = 0.6;
const MAX_IMPACT_SPIN = 8;
/** How fast a resting prop rolls onto its nearest flat side, 1/s. */
const SETTLE_RATE = 6;

const UP = new THREE.Vector3(0, 1, 0);
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const scratchAxis = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchTarget = new THREE.Quaternion();

/**
 * A loose object (spec 19.10): an upright cylinder in world tiles (x east, y north, z = bottom
 * height) that falls, slides with friction, bounces off walls and floors and spins. Its orientation
 * is only drawn; collision always uses the upright cylinder.
 */
export class PropBody {
    vx = 0;
    vy = 0;
    vz = 0;
    /** Angular velocity in three.js axes (x east, y up, z south), radians/s. */
    readonly spin = new THREE.Vector3();
    readonly orientation = new THREE.Quaternion();
    asleep = true;
    grounded = true;
    /** Top of whatever the body rests on besides the ground (another prop), or -Infinity. */
    support = -Infinity;
    private still = 0;

    constructor(
        public x: number,
        public y: number,
        public z: number,
        public plane: number,
        readonly radius: number,
        readonly height: number,
        readonly mass: number,
    ) {}

    get speed(): number {
        return Math.hypot(this.vx, this.vy, this.vz);
    }

    get top(): number {
        return this.z + this.height;
    }

    wake(): void {
        this.asleep = false;
        this.still = 0;
    }

    /** Adds an impulse in kg·tiles/s. */
    applyImpulse(jx: number, jy: number, jz = 0): void {
        this.vx += jx / this.mass;
        this.vy += jy / this.mass;
        this.vz += jz / this.mass;
        if (jz > 0) {
            this.grounded = false;
        }
        this.wake();
    }

    /** Moves along one axis, stopped by tile walls and blocked tiles; returns true if blocked. */
    moveAxis(world: PropWorld, alongX: boolean, delta: number, boxes: Box[]): boolean {
        const start = alongX ? this.x : this.y;
        const end = sweepAxis(world.flagsAt, this.plane, this.x, this.y, this.radius, alongX, delta, boxes);
        if (alongX) {
            this.x = end;
        } else {
            this.y = end;
        }
        return Math.abs(end - start) < Math.abs(delta) - 1e-6;
    }

    /**
     * Advances the body by dt. Collisions with walls and the ground are appended to `impacts`.
     * `random` spins the body on impacts.
     */
    step(dt: number, world: PropWorld, boxes: Box[], impacts: WorldImpact[], random: () => number = Math.random): void {
        if (this.asleep) {
            return;
        }
        const e = tuning.propRestitution;
        this.vz -= tuning.gravity * dt;

        // Horizontal movement against walls, in sub-steps.
        const dx = this.vx * dt;
        const dy = this.vy * dt;
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MAX_SUBSTEP));
        let hitX = false;
        let hitY = false;
        for (let i = 0; i < steps; i++) {
            if (!hitX && this.moveAxis(world, true, dx / steps, boxes)) {
                hitX = true;
            }
            if (!hitY && this.moveAxis(world, false, dy / steps, boxes)) {
                hitY = true;
            }
        }
        if (hitX || hitY) {
            const before = this.speed;
            if (hitX) {
                this.vx = -this.vx * e;
            }
            if (hitY) {
                this.vy = -this.vy * e;
            }
            this.impact(impacts, before, random);
        }

        // Off the edge of an upper floor: fall to the plane below.
        while (this.plane > 0 && !world.hasFloor(this.plane, this.x, this.y)) {
            this.plane--;
            this.grounded = false;
        }

        const ground = Math.max(world.groundHeight(this.plane, this.x, this.y), this.support);
        this.z += this.vz * dt;
        if (this.z <= ground) {
            const before = this.speed;
            this.z = ground;
            const landing = -this.vz;
            this.vz = landing > MIN_BOUNCE_SPEED ? landing * e : 0;
            this.grounded = true;
            if (landing > MIN_BOUNCE_SPEED) {
                this.impact(impacts, before, random);
            }
        } else if (this.grounded && this.vz <= 0 && this.z - ground <= STEP_DOWN) {
            this.z = ground;
            this.vz = 0;
        } else {
            this.grounded = false;
        }

        if (this.grounded && this.vz === 0) {
            // Coulomb friction on the ground.
            const h = Math.hypot(this.vx, this.vy);
            if (h > 0) {
                const slowed = Math.max(0, h - tuning.propFriction * tuning.gravity * dt);
                this.vx *= slowed / h;
                this.vy *= slowed / h;
            }
            this.spin.multiplyScalar(Math.exp(-6 * dt));
        } else {
            this.spin.multiplyScalar(Math.exp(-0.3 * dt));
        }

        this.integrateOrientation(dt);
        if (this.grounded && this.vz === 0 && this.spin.lengthSq() < 0.25) {
            this.settle(dt);
        }

        if (this.grounded && this.speed < tuning.propSleepSpeed && this.spin.lengthSq() < 0.01) {
            this.still += dt;
            if (this.still >= tuning.propSleepTime) {
                this.vx = this.vy = this.vz = 0;
                this.spin.set(0, 0, 0);
                this.asleep = true;
            }
        } else {
            this.still = 0;
        }
    }

    private impact(impacts: WorldImpact[], before: number, random: () => number): void {
        impacts.push({ speed: before, speedLoss: before - this.speed });
        const amount = Math.min(MAX_IMPACT_SPIN, before * IMPACT_SPIN);
        this.spin.x += (random() - 0.5) * 2 * amount;
        this.spin.y += (random() - 0.5) * amount;
        this.spin.z += (random() - 0.5) * 2 * amount;
    }

    private integrateOrientation(dt: number): void {
        const w = this.spin.length();
        if (w < 1e-6) {
            return;
        }
        scratchAxis.copy(this.spin).divideScalar(w);
        scratchQuat.setFromAxisAngle(scratchAxis, w * dt);
        this.orientation.premultiply(scratchQuat).normalize();
    }

    /** Rolls a resting body onto the side nearest to lying flat. */
    private settle(dt: number): void {
        let best = AXES[1];
        let bestDot = 0;
        for (const axis of AXES) {
            const d = scratchAxis.copy(axis).applyQuaternion(this.orientation).dot(UP);
            if (Math.abs(d) > Math.abs(bestDot)) {
                bestDot = d;
                best = axis;
            }
        }
        scratchAxis.copy(best).applyQuaternion(this.orientation);
        if (bestDot < 0) {
            scratchAxis.negate();
        }
        if (scratchAxis.dot(UP) > 0.99999) {
            return;
        }
        scratchTarget.setFromUnitVectors(scratchAxis, UP).multiply(this.orientation);
        this.orientation.slerp(scratchTarget, Math.min(1, SETTLE_RATE * dt));
    }
}

/**
 * Elastic collision between two overlapping cylinders (mass-weighted, restitution e): changes both
 * velocities and separates them. Returns each body's loss of speed, or undefined if they do not
 * touch or are already moving apart. Static bodies (`a.asleep` treated as movable) all move here.
 */
export function collideBodies(
    a: PropBody,
    b: PropBody,
    e: number,
    separate: (body: PropBody, dx: number, dy: number) => void,
): { lossA: number; lossB: number; closing: number } | undefined {
    if (a.plane !== b.plane || !(a.z < b.top - 0.05 && b.z < a.top - 0.05)) {
        return undefined;
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const min = a.radius + b.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) {
        return undefined;
    }
    const d = Math.sqrt(d2);
    const nx = d > 1e-6 ? dx / d : 1;
    const ny = d > 1e-6 ? dy / d : 0;
    const invA = 1 / a.mass;
    const invB = 1 / b.mass;
    // Push apart along the normal, the lighter body moving more.
    const overlap = min - d;
    separate(a, -nx * overlap * (invA / (invA + invB)), -ny * overlap * (invA / (invA + invB)));
    separate(b, nx * overlap * (invB / (invA + invB)), ny * overlap * (invB / (invA + invB)));

    const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (closing <= 0) {
        return undefined;
    }
    const beforeA = a.speed;
    const beforeB = b.speed;
    const j = ((1 + e) * closing) / (invA + invB);
    a.vx -= j * invA * nx;
    a.vy -= j * invA * ny;
    b.vx += j * invB * nx;
    b.vy += j * invB * ny;
    a.wake();
    b.wake();
    return { lossA: beforeA - a.speed, lossB: beforeB - b.speed, closing };
}
