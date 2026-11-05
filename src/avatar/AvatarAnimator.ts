import * as THREE from "three";

import type { AvatarAsset } from "./AvatarAsset";

export type LocomotionInput = {
    /** Ground speed in tiles per second. */
    speed: number;
    /** Velocity along the facing direction; negative when walking backwards. */
    localForward: number;
    grounded: boolean;
    flying: boolean;
};

export type LocomotionState = "idle" | "walk" | "run" | "airborne";

const IDLE_BELOW = 0.2;
const FADE_SECONDS = 0.15;
const LAND_FADE_SECONDS = 0.1;
const SPEED_DAMPING = 12;
const MIN_TIME_SCALE = 0.3;
const MAX_TIME_SCALE = 3;

/** Picks the locomotion clip from the player's motion and scales it to the ground speed. */
export class AvatarAnimator {
    readonly mixer: THREE.AnimationMixer;
    state: LocomotionState = "idle";
    backwards = false;

    private readonly actions = new Map<string, THREE.AnimationAction>();
    private current: THREE.AnimationAction | undefined;
    private smoothedSpeed = 0;

    constructor(
        private readonly asset: AvatarAsset,
        private readonly walkSpeed: number,
        private readonly sprintSpeed: number,
    ) {
        this.mixer = new THREE.AnimationMixer(asset.model);
        for (const [name, clip] of asset.clips) {
            this.actions.set(name, this.mixer.clipAction(clip));
        }
        this.play(this.actionFor("idle"), 0);
    }

    /** TimeScale of the playing clip (negative when it runs backwards). */
    get timeScale(): number {
        return this.current?.timeScale ?? 1;
    }

    update(dt: number, input: LocomotionInput): void {
        this.smoothedSpeed = THREE.MathUtils.damp(this.smoothedSpeed, input.speed, SPEED_DAMPING, dt);
        const speed = this.smoothedSpeed;

        let next: LocomotionState;
        if (!input.grounded && !input.flying) {
            next = "airborne";
        } else if (speed < IDLE_BELOW) {
            next = "idle";
        } else {
            next = speed < (this.walkSpeed + this.sprintSpeed) / 2 ? "walk" : "run";
        }
        this.backwards = (next === "walk" || next === "run") && input.localForward < -IDLE_BELOW;

        let action: THREE.AnimationAction | undefined;
        let timeScale = 1;
        if (next === "walk" || next === "run") {
            const reference = this.asset.clipSpeeds[next];
            const magnitude = THREE.MathUtils.clamp(speed / reference, MIN_TIME_SCALE, MAX_TIME_SCALE);
            const backClip = this.backwards ? this.actions.get("walk_back") : undefined;
            action = backClip ?? this.actionFor(next);
            timeScale = this.backwards && !backClip ? -magnitude : magnitude;
        } else {
            action = this.actionFor(next);
        }

        if (action !== this.current) {
            const landing = this.state === "airborne" && next !== "airborne";
            this.play(action, landing ? LAND_FADE_SECONDS : FADE_SECONDS);
        }
        this.state = next;
        action.timeScale = timeScale;
        this.mixer.update(dt);
    }

    private actionFor(state: string): THREE.AnimationAction {
        return this.actions.get(state) ?? this.actions.get("idle") ?? [...this.actions.values()][0];
    }

    private play(action: THREE.AnimationAction, fade: number): void {
        const previous = this.current;
        action.reset().play();
        if (previous && previous !== action) {
            previous.crossFadeTo(action, fade, false);
        }
        this.current = action;
    }
}
