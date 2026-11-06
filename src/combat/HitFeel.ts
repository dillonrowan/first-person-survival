import type * as THREE from "three";

import type { DamageResult } from "./Damage";

/** Shortest and added longest hit-stop (seconds), and how fast the world runs during it. [design] */
const STOP_MIN = 0.035;
const STOP_RANGE = 0.075;
const STOP_TIME_SCALE = 0.05;
/** Camera kick: spring (per second²), damping ratio, and pitch/roll speed per unit strength (rad/s). [design] */
const KICK_SPRING = 250;
const KICK_DAMPING = 0.5;
const KICK_PITCH = 0.3;
const KICK_ROLL = 0.18;

/** How hard a hit lands, 0..1, from what it did to the target. */
export function impactStrength(result: Pick<DamageResult, "reaction" | "killed" | "knockedDown">): number {
    if (result.killed || result.knockedDown) {
        return 1;
    }
    return { none: 0.3, flinch: 0.4, stagger: 0.65, push: 0.85, knockdown: 1 }[result.reaction];
}

/**
 * The weight of a landed blow: a brief hit-stop that nearly freezes the swing and the struck body,
 * and a small kick of the camera that springs back.
 */
export class HitFeel {
    private stop = 0;
    private pitch = 0;
    private roll = 0;
    private pitchSpeed = 0;
    private rollSpeed = 0;

    constructor(private readonly random: () => number = Math.random) {}

    /** A blow of `strength` (0..1) landed. */
    impact(strength: number): void {
        const s = Math.min(1, Math.max(0, strength));
        this.stop = Math.max(this.stop, STOP_MIN + STOP_RANGE * s);
        this.pitchSpeed -= KICK_PITCH * (0.4 + s);
        this.rollSpeed += KICK_ROLL * (0.4 + s) * (this.random() < 0.5 ? -1 : 1);
    }

    /** True during a hit-stop. */
    get stopped(): boolean {
        return this.stop > 0;
    }

    /** Time step for the fight (swings, NPCs) this frame: almost nothing during a hit-stop. */
    worldDt(dt: number): number {
        if (this.stop <= 0) {
            return dt;
        }
        this.stop = Math.max(0, this.stop - dt);
        return dt * STOP_TIME_SCALE;
    }

    update(dt: number): void {
        const damping = 2 * KICK_DAMPING * Math.sqrt(KICK_SPRING);
        this.pitchSpeed += (-KICK_SPRING * this.pitch - damping * this.pitchSpeed) * dt;
        this.rollSpeed += (-KICK_SPRING * this.roll - damping * this.rollSpeed) * dt;
        this.pitch += this.pitchSpeed * dt;
        this.roll += this.rollSpeed * dt;
    }

    /** Adds the kick to a first-person camera already placed this frame. */
    apply(camera: THREE.Camera): void {
        camera.rotation.x += this.pitch;
        camera.rotation.z += this.roll;
    }
}
