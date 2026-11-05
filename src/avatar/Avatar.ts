import * as THREE from "three";

import { SPRINT_SPEED, WALK_SPEED } from "../player/Player";
import { AvatarAnimator, LocomotionInput } from "./AvatarAnimator";
import type { AvatarAsset } from "./AvatarAsset";
import { FP_BODY_BACK_OFFSET, TORSO_PITCH_FACTOR } from "./avatarConfig";

const BODY_TURN_DAMPING = 10;
/** An idle body only turns once the view is this far from where it faces. */
const IDLE_TURN_THRESHOLD = (50 * Math.PI) / 180;
const MOVING_SPEED = 0.2;
const HIDDEN_HEAD_SCALE = 1e-3;

export type AvatarTarget = LocomotionInput & {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
};

const wrapAngle = (angle: number) => THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI;
const PITCH_AXIS = new THREE.Vector3(1, 0, 0);

/** The player's body: follows the player, animates, and hides its head in first person. */
export class Avatar {
    readonly animator: AvatarAnimator;
    bodyYaw = 0;

    private readonly q = new THREE.Quaternion();
    private lastLean = 0;

    constructor(
        private readonly asset: AvatarAsset,
        walkSpeed = WALK_SPEED,
        sprintSpeed = SPRINT_SPEED,
    ) {
        this.animator = new AvatarAnimator(asset, walkSpeed, sprintSpeed);
    }

    get root(): THREE.Group {
        return this.asset.root;
    }

    private lean(angle: number): void {
        for (const role of ["spine", "chest"] as const) {
            this.asset.bones[role]?.quaternion.multiply(this.q.setFromAxisAngle(PITCH_AXIS, angle));
        }
    }

    update(dt: number, target: AvatarTarget, mode: "first" | "third"): void {
        const root = this.asset.root;
        root.position.set(target.x, target.z, -target.y);

        const difference = wrapAngle(target.yaw - this.bodyYaw);
        if (target.speed > MOVING_SPEED || Math.abs(difference) > IDLE_TURN_THRESHOLD) {
            this.bodyYaw += difference * (1 - Math.exp(-BODY_TURN_DAMPING * dt));
        }
        root.rotation.y = this.bodyYaw;

        // Undo last frame's lean first: bones the clips do not animate would otherwise keep adding it.
        this.lean(-this.lastLean);
        this.animator.update(dt, target);
        // Lean the torso towards where the player looks, on top of the animation.
        this.lastLean = target.pitch * TORSO_PITCH_FACTOR;
        this.lean(this.lastLean);

        const firstPerson = mode === "first";
        for (const part of this.asset.headParts) {
            part.visible = !firstPerson;
        }
        const head = this.asset.bones.head;
        if (firstPerson && head && this.asset.headParts.length === 0) {
            head.scale.setScalar(HIDDEN_HEAD_SCALE);
        } else if (head) {
            head.scale.setScalar(1);
        }
        // Moved back (towards +Z of the root) so looking down shows legs, not the inside of the torso.
        this.asset.model.position.z = firstPerson ? FP_BODY_BACK_OFFSET : 0;
        root.updateMatrixWorld(true);
    }
}
