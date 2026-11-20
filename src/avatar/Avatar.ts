import * as THREE from "three";

import { EYE_HEIGHT, SPRINT_SPEED, WALK_SPEED } from "../player/Player";
import { AvatarAnimator, LocomotionInput } from "./AvatarAnimator";
import type { AvatarAsset } from "./AvatarAsset";
import type { KickSample } from "./KickPose";
import { FP_NECK_BACK, FP_SHOULDER_REACH, SWING_TWIST_FACTOR, SWING_TWIST_MAX, TORSO_PITCH_FACTOR } from "./avatarConfig";

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
const UP = new THREE.Vector3(0, 1, 0);
/** Where the right elbow points while reaching, in the body's space: out to the right, down, back. */
const ELBOW_POLE = new THREE.Vector3(0.5, -1, 0.3).normalize();
/** The left elbow's: the mirror image. */
const ELBOW_POLE_L = new THREE.Vector3(-0.5, -1, 0.3).normalize();
/** Where the standing knee points while kicking, in the body's space: ahead. */
const KNEE_AHEAD = new THREE.Vector3(0, 0, -1);
const RIGHT = new THREE.Vector3(1, 0, 0);

/**
 * The player's body: follows the player, animates, and hides its head in first person, where it is
 * held behind the eyes so the view never starts inside it and the right hand can be put on the held
 * item's grip (`reachRightHand`).
 */
export class Avatar {
    readonly animator: AvatarAnimator;
    bodyYaw = 0;
    /**
     * Where the body looks from: turned to the view's yaw and pitch (-Z ahead, +X right, like the
     * first-person camera) and placed relative to the neck exactly as the first-person camera is.
     * Third-person holds and swings (combat/BodySwings.ts) are posed in it, so they sit the same on
     * the player's body and on other players' bodies.
     */
    readonly viewFrame = new THREE.Group();

    private readonly q = new THREE.Quaternion();
    private lastLean = 0;
    /** Bones as the animation left them, before `reachRightHand` / `reachLeftHand` moved them. */
    private readonly saved: { bone: THREE.Bone; quat: THREE.Quaternion; pos: THREE.Vector3 }[] = [];
    private readonly v = [0, 1, 2, 3, 4].map(() => new THREE.Vector3());
    private readonly q2 = new THREE.Quaternion();
    private kick: KickSample | undefined;

    constructor(
        private readonly asset: AvatarAsset,
        walkSpeed = WALK_SPEED,
        sprintSpeed = SPRINT_SPEED,
    ) {
        this.animator = new AvatarAnimator(asset, walkSpeed, sprintSpeed);
        this.viewFrame.rotation.order = "YXZ";
        asset.root.add(this.viewFrame);
    }

    /** The kick to pose on the next `update` (KickPose.kickSample), or undefined. */
    setKick(sample: KickSample | undefined): void {
        this.kick = sample;
    }

    get root(): THREE.Group {
        return this.asset.root;
    }

    private lean(angle: number): void {
        for (const role of ["spine", "chest"] as const) {
            this.asset.bones[role]?.quaternion.multiply(this.q.setFromAxisAngle(PITCH_AXIS, angle));
        }
    }

    /** `engaged`: fighting (swinging, charging, blocking, aiming), so the body squares up to the view at once. */
    update(dt: number, target: AvatarTarget, mode: "first" | "third", engaged = false): void {
        const root = this.asset.root;
        root.position.set(target.x, target.z, -target.y);

        const difference = wrapAngle(target.yaw - this.bodyYaw);
        if (engaged || target.speed > MOVING_SPEED || Math.abs(difference) > IDLE_TURN_THRESHOLD) {
            this.bodyYaw += difference * (1 - Math.exp(-BODY_TURN_DAMPING * dt));
        }
        root.rotation.y = this.bodyYaw;

        this.restoreBones();
        // Undo last frame's lean first: bones the clips do not animate would otherwise keep adding it.
        this.lean(-this.lastLean);
        this.animator.update(dt, target);
        // Lean the torso towards where the player looks, on top of the animation. Not in first
        // person: with the neck held behind the eyes, leaning forward would swing the hips and legs
        // back out of view.
        this.lastLean = mode === "first" ? 0 : target.pitch * TORSO_PITCH_FACTOR;
        this.lean(this.lastLean);
        if (this.kick) {
            this.poseKick(this.kick);
        }

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
        // The view frame: FP_NECK_BACK ahead of the neck at eye height, where the first-person
        // camera is relative to the neck (there the body is moved instead). Root space is +Z behind.
        const neckZ = neck ? root.worldToLocal(neck.getWorldPosition(this.v[0])).z : 0;
        this.viewFrame.position.set(0, target.eyeHeight ?? EYE_HEIGHT, neckZ - FP_NECK_BACK);
        this.viewFrame.rotation.set(target.pitch, wrapAngle(target.yaw - this.bodyYaw), 0);
        this.viewFrame.updateMatrixWorld(true);
    }

    /**
     * Turns the torso with the held item, then bends the right arm (two-bone IK on the upper arm
     * and forearm) so the hand socket lands on `grip`, a world position: call after `update` and
     * after the camera has moved. `frame` is what the item is posed in (the first-person camera or
     * `viewFrame`): the further the grip is to one side of it, the further the chest turns that way, so a
     * swing is thrown from the body, not just the arm. Beyond the arm's length the shoulder reaches
     * forward by up to FP_SHOULDER_REACH. Undone by the next `update`, before the animation runs.
     */
    reachRightHand(grip: THREE.Vector3, frame: THREE.Object3D): void {
        const { upperarm_r: upper, forearm_r: fore, hand_r: hand, spine, chest } = this.asset.bones;
        const effector = this.asset.sockets.handR ?? hand;
        if (!upper || !fore || !effector || !upper.parent) {
            return;
        }
        // The grip's bearing from straight ahead in the frame (+ to the right), split over spine
        // and chest. Turning right is clockwise seen from above: about world up by -twist.
        const local = frame.worldToLocal(this.v[0].copy(grip));
        const bearing = Math.atan2(local.x, -local.z);
        const twist = THREE.MathUtils.clamp(bearing * SWING_TWIST_FACTOR, -SWING_TWIST_MAX, SWING_TWIST_MAX);
        for (const bone of [spine, chest]) {
            if (bone) {
                this.save(bone);
                this.turnAboutWorld(bone, UP, -twist / 2);
            }
        }
        this.bendArm(upper, fore, effector, grip, ELBOW_POLE);
    }

    /**
     * Bends the left arm so its hand (socket_hand_l, or the hand bone) lands on `target`, a world
     * position: the free hand in a third-person guard or swing. Call after `reachRightHand`, which
     * turns the torso. Undone by the next `update`.
     */
    reachLeftHand(target: THREE.Vector3): void {
        const { upperarm_l: upper, forearm_l: fore, hand_l: hand } = this.asset.bones;
        const effector = this.asset.sockets.handL ?? hand;
        if (upper && fore && effector && upper.parent) {
            this.bendArm(upper, fore, effector, target, ELBOW_POLE_L);
        }
    }

    /**
     * Poses the right leg's kick over the animation: hips forward and down, torso back, the kicking
     * leg bent (two-bone IK) to put the ankle on the keyed spot with the knee towards the keyed
     * direction, the foot turned by the keyed angle, and the standing foot kept where it was.
     * Undone by the next `update`.
     */
    private poseKick(kick: KickSample): void {
        const { hips, spine, chest, thigh_r, shin_r, foot_r, thigh_l, shin_l, foot_l } = this.asset.bones;
        if (!hips?.parent || !thigh_r || !shin_r || !foot_r) {
            return;
        }
        const root = this.asset.root;
        root.updateMatrixWorld(true);
        const rootQ = root.getWorldQuaternion(new THREE.Quaternion());
        const thighAt = thigh_r.getWorldPosition(new THREE.Vector3());
        const kneeAt = shin_r.getWorldPosition(new THREE.Vector3());
        const ankleR = foot_r.getWorldPosition(new THREE.Vector3());
        const ankleL = foot_l?.getWorldPosition(new THREE.Vector3());
        const footQR = foot_r.getWorldQuaternion(new THREE.Quaternion());
        const footQL = foot_l?.getWorldQuaternion(new THREE.Quaternion());
        const leg = thighAt.distanceTo(kneeAt) + kneeAt.distanceTo(ankleR);
        const right = RIGHT.clone().applyQuaternion(rootQ);

        for (const bone of [spine, chest]) {
            if (bone) {
                this.save(bone);
                this.turnAboutWorld(bone, right, kick.lean / 2);
            }
        }
        this.save(hips);
        const shift = new THREE.Vector3(0, kick.hips[0] * leg, kick.hips[1] * leg).applyQuaternion(rootQ);
        hips.position.copy(hips.parent.worldToLocal(hips.getWorldPosition(new THREE.Vector3()).add(shift)));
        hips.updateWorldMatrix(true, true);

        const foot = new THREE.Vector3(...kick.foot).multiplyScalar(leg).applyQuaternion(rootQ);
        const target = thigh_r.getWorldPosition(new THREE.Vector3()).add(foot).lerp(ankleR, 1 - kick.weight);
        this.bendArm(thigh_r, shin_r, foot_r, target, new THREE.Vector3(...kick.knee).normalize(), 0);
        if (thigh_l && shin_l && foot_l && ankleL) {
            this.bendArm(thigh_l, shin_l, foot_l, ankleL, KNEE_AHEAD, 0);
        }
        // Feet: the kicking one turned about the body's right axis, the standing one as animated.
        this.setWorldQuaternion(foot_r, footQR.premultiply(this.q.setFromAxisAngle(right, kick.toes)));
        if (foot_l && footQL) {
            this.setWorldQuaternion(foot_l, footQL);
        }
    }

    private setWorldQuaternion(bone: THREE.Bone, world: THREE.Quaternion): void {
        if (!bone.parent) return;
        this.save(bone);
        bone.parent.updateWorldMatrix(true, false);
        bone.quaternion.copy(bone.parent.getWorldQuaternion(this.q2).invert().multiply(world));
        bone.updateWorldMatrix(false, true);
    }

    private save(bone: THREE.Bone): void {
        if (!this.saved.some((s) => s.bone === bone)) {
            this.saved.push({ bone, quat: bone.quaternion.clone(), pos: bone.position.clone() });
        }
    }

    /**
     * Two-bone IK: turns `upper` and `fore` so `effector` lands on `grip`, the elbow towards `elbowPole`.
     * Beyond reach, `upper` slides towards `grip` by up to `maxSlide`.
     */
    private bendArm(
        upper: THREE.Bone,
        fore: THREE.Bone,
        effector: THREE.Object3D,
        grip: THREE.Vector3,
        elbowPole: THREE.Vector3,
        maxSlide = FP_SHOULDER_REACH,
    ): void {
        if (!upper.parent) return;
        this.save(upper);
        this.save(fore);
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
        if (excess > 0 && maxSlide > 0) {
            // Out of reach: the shoulder comes forward along the line to the grip.
            const slide = Math.min(excess, maxSlide);
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
        pole.copy(elbowPole).transformDirection(this.asset.root.matrixWorld);
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

    /** Turns `bone` by `angle` about the world direction `axis`. */
    private turnAboutWorld(bone: THREE.Bone, axis: THREE.Vector3, angle: number): void {
        bone.updateWorldMatrix(true, false);
        const local = this.v[1].copy(axis).applyQuaternion(bone.getWorldQuaternion(this.q2).invert());
        bone.quaternion.multiply(this.q.setFromAxisAngle(local, angle));
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

    /** Gives the bones the reaches moved back to the animation, last moved first. */
    private restoreBones(): void {
        for (let i = this.saved.length - 1; i >= 0; i--) {
            const { bone, quat, pos } = this.saved[i];
            bone.quaternion.copy(quat);
            bone.position.copy(pos);
        }
        this.saved.length = 0;
    }
}
