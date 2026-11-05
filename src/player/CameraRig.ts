import * as THREE from "three";

import { EYE_HEIGHT } from "./Player";
import type { Input } from "./Input";

const THIRD_PERSON_DISTANCE = 2.5;
const THIRD_PERSON_LIFT = 0.3;

export type CameraTarget = { x: number; y: number; z: number; yaw: number; pitch: number };

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

    update(target: CameraTarget): void {
        this.eye.set(target.x, target.z + EYE_HEIGHT, -target.y);
        if (this.mode === "first") {
            this.camera.position.copy(this.eye);
            this.camera.rotation.set(target.pitch, target.yaw, 0, "YXZ");
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
