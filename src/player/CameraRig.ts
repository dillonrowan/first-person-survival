import * as THREE from "three";

import { EYE_HEIGHT } from "./Player";
import type { Input } from "./Input";

const THIRD_PERSON_DISTANCE = 2.5;
const THIRD_PERSON_LIFT = 0.3;

export type CameraTarget = { x: number; y: number; z: number; yaw: number; pitch: number; eyeHeight?: number };

/**
 * Added to the first-person view: rotation (radians), and the eyes leaning ahead along the view's
 * heading and dipping down (tiles).
 */
export type CameraOffset = { pitch: number; yaw: number; roll: number; lean?: number; dip?: number };

/** Places the camera at the player's eyes, or (dev builds, V) behind the player. */
export class CameraRig {
    mode: "first" | "third" = "first";

    private readonly eye = new THREE.Vector3();
    private readonly direction = new THREE.Vector3();

    constructor(
        private readonly camera: THREE.PerspectiveCamera,
        private readonly allowThirdPerson: boolean = false,
    ) {}

    handleInput(input: Pick<Input, "wasPressed">): void {
        if (this.allowThirdPerson && input.wasPressed("KeyV")) {
            this.mode = this.mode === "first" ? "third" : "first";
        }
    }

    /**
     * `offset` (first person only) is added to the view: swing follow, impact shake, leaning in to
     * pick a pocket.
     */
    update(target: CameraTarget, offset?: CameraOffset): void {
        this.eye.set(target.x, target.z + (target.eyeHeight ?? EYE_HEIGHT), -target.y);
        if (this.mode === "first") {
            this.camera.position.copy(this.eye);
            const lean = offset?.lean ?? 0;
            this.camera.position.x -= Math.sin(target.yaw) * lean;
            this.camera.position.z -= Math.cos(target.yaw) * lean;
            this.camera.position.y -= offset?.dip ?? 0;
            this.camera.rotation.set(target.pitch + (offset?.pitch ?? 0), target.yaw + (offset?.yaw ?? 0), offset?.roll ?? 0, "YXZ");
            return;
        }
        const cosPitch = Math.cos(target.pitch);
        this.direction.set(
            -Math.sin(target.yaw) * cosPitch,
            Math.sin(target.pitch),
            -Math.cos(target.yaw) * cosPitch,
        );
        this.camera.position
            .copy(this.eye)
            .addScaledVector(this.direction, -THIRD_PERSON_DISTANCE);
        this.camera.position.y += THIRD_PERSON_LIFT;
        this.camera.lookAt(this.eye);
    }
}
