import * as THREE from "three";

import { EYE_HEIGHT, SPRINT_SPEED, WALK_SPEED } from "../player/Player";
import { AvatarAnimator, LocomotionInput } from "./AvatarAnimator";
import type { AvatarAsset } from "./AvatarAsset";
import { FP_NECK_BACK, FP_SHOULDER_REACH, TORSO_PITCH_FACTOR } from "./avatarConfig";

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
    /** Height of the eyes above the feet (lower when crouching); EYE_HEIGHT when absent. */
    eyeHeight?: number;
};

const wrapAngle = (angle: number) => THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI;
const PITCH_AXIS = new THREE.Vector3(1, 0, 0);
/** Where the right elbow points while reaching, in the body's space: out to the right, down, back. */
const ELBOW_POLE = new THREE.Vector3(0.5, -1, 0.3).normalize();

/**
 * The player's body: follows the player, animates, and hides its head in first person, where it is
 * held behind the eyes so the view never starts inside it and the right hand can be put on the held
 * item's grip (`reachRightHand`).
 */
export class Avatar {
    readonly animator: AvatarAnimator;
    bodyYaw = 0;

    private readonly q = new THREE.Quaternion();
    private lastLean = 0;
    /** The right arm as the animation left it, before `reachRightHand` moved it. */
    private armPose: { upper: THREE.Quaternion; shoulder: THREE.Vector3; fore: THREE.Quaternion } | undefined;
    private readonly v = [0, 1, 2, 3, 4].map(() => new THREE.Vector3());
    private readonly q2 = new THREE.Quaternion();

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

        this.restoreArm();
        // Undo last frame's lean first: bones the clips do not animate would otherwise keep adding it.
        this.lean(-this.lastLean);
        this.animator.update(dt, target);
        // Lean the torso towards where the player looks, on top of the animation. Not in first
        // person: with the neck held behind the eyes, leaning forward would swing the hips and legs
        // back out of view.
        this.lastLean = mode === "first" ? 0 : target.pitch * TORSO_PITCH_FACTOR;
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
        const model = this.asset.model;
        model.position.set(0, 0, 0);
        const neck = this.asset.bones.neck;
        if (firstPerson && neck) {
            // The neck is held a fixed distance behind the eyes (towards +Z of the root), however
            // far the torso leans, and the body sinks with the eyes when crouching (it has no
            // crouch clip), so the camera never ends up inside the chest.
            root.updateMatrixWorld(true);
            const local = root.worldToLocal(neck.getWorldPosition(this.v[0]));
            model.position.z = FP_NECK_BACK - local.z;
            model.position.y = (target.eyeHeight ?? EYE_HEIGHT) - EYE_HEIGHT;
        }
        root.updateMatrixWorld(true);
    }

    /**
     * Bends the right arm (two-bone IK on the upper arm and forearm) so the hand socket lands on
     * `grip`, a world position: call after `update` and after the camera has moved. Beyond the
     * arm's length the shoulder reaches forward by up to FP_SHOULDER_REACH. Undone by the next
     * `update`, before the animation runs.
     */
    reachRightHand(grip: THREE.Vector3): void {
        const { upperarm_r: upper, forearm_r: fore, hand_r: hand } = this.asset.bones;
        const effector = this.asset.sockets.handR ?? hand;
        if (!upper || !fore || !effector || !upper.parent) {
            return;
        }
        this.armPose = { upper: upper.quaternion.clone(), shoulder: upper.position.clone(), fore: fore.quaternion.clone() };
        const [shoulder, elbow, end, dir, pole] = this.v;
        upper.updateWorldMatrix(true, true);
        upper.getWorldPosition(shoulder);
        fore.getWorldPosition(elbow);
        effector.getWorldPosition(end);
        const a = shoulder.distanceTo(elbow);
        const b = elbow.distanceTo(end);
        if (a < 1e-6 || b < 1e-6) {
            return;
        }
        let c = shoulder.distanceTo(grip);
        const excess = c - (a + b) * 0.999;
        if (excess > 0) {
            // Out of reach: the shoulder comes forward along the line to the grip.
            const slide = Math.min(excess, FP_SHOULDER_REACH);
            dir.subVectors(grip, shoulder).normalize().multiplyScalar(slide);
            const target = upper.parent.worldToLocal(dir.add(shoulder));
            upper.position.copy(target);
            upper.updateWorldMatrix(true, true);
            upper.getWorldPosition(shoulder);
            fore.getWorldPosition(elbow);
            c = shoulder.distanceTo(grip);
        }
        c = THREE.MathUtils.clamp(c, Math.abs(a - b) + 1e-4, (a + b) * 0.999);
        // The elbow on the circle the two lengths allow, turned towards the pole.
        dir.subVectors(grip, shoulder).normalize();
        pole.copy(ELBOW_POLE).transformDirection(this.asset.root.matrixWorld);
        pole.addScaledVector(dir, -pole.dot(dir));
        if (pole.lengthSq() < 1e-8) {
            pole.set(0, -1, 0).addScaledVector(dir, dir.y);
        }
        pole.normalize();
        const cosA = (a * a + c * c - b * b) / (2 * a * c);
        const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
        const want = end.copy(shoulder).addScaledVector(dir, a * cosA).addScaledVector(pole, a * sinA);
        this.aim(upper, shoulder, elbow, want);
        fore.updateWorldMatrix(true, true);
        fore.getWorldPosition(elbow);
        effector.getWorldPosition(end);
        this.aim(fore, elbow, end, grip);
        fore.updateWorldMatrix(false, true);
    }

    /** Turns `bone` (at world `from`) so the point now at `current` lies towards `wanted`. */
    private aim(bone: THREE.Bone, from: THREE.Vector3, current: THREE.Vector3, wanted: THREE.Vector3): void {
        const now = this.v[3].subVectors(current, from).normalize();
        const goal = this.v[4].subVectors(wanted, from).normalize();
        const turn = this.q.setFromUnitVectors(now, goal);
        const parent = bone.parent!.getWorldQuaternion(this.q2);
        // local' = parent⁻¹ · turn · parent · local
        bone.quaternion.premultiply(parent).premultiply(turn).premultiply(parent.invert());
    }

    private restoreArm(): void {
        const pose = this.armPose;
        const { upperarm_r: upper, forearm_r: fore } = this.asset.bones;
        if (pose && upper && fore) {
            upper.quaternion.copy(pose.upper);
            upper.position.copy(pose.shoulder);
            fore.quaternion.copy(pose.fore);
        }
        this.armPose = undefined;
    }
}
