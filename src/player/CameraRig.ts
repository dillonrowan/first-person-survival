import * as THREE from "three";

import { EYE_HEIGHT } from "./Player";

/** Third-person camera distances behind the eyes (tiles): the first notch out, the farthest, and each notch. */
export const THIRD_PERSON_MIN = 1.5;
export const THIRD_PERSON_MAX = 6;
export const ZOOM_STEP = 0.75;
/** How quickly the third-person distance eases to the wheel's (per second). */
const ZOOM_DAMPING = 12;
const THIRD_PERSON_LIFT = 0.3;

export type CameraTarget = { x: number; y: number; z: number; yaw: number; pitch: number; eyeHeight?: number };

/**
 * Added to the first-person view: rotation (radians), and the eyes leaning ahead along the view's
 * heading and dipping down (tiles).
 */
export type CameraOffset = { pitch: number; yaw: number; roll: number; lean?: number; dip?: number };

/**
 * Places the camera at the player's eyes, or behind the player: the mouse wheel zooms out of first
 * person into third and back in.
 */
export class CameraRig {
    /** Wanted distance behind the eyes: 0 in first person, else THIRD_PERSON_MIN..THIRD_PERSON_MAX. */
    private zoom = 0;
    /** The drawn distance, easing towards `zoom`. */
    private distance = THIRD_PERSON_MIN;

    private readonly eye = new THREE.Vector3();
    private readonly direction = new THREE.Vector3();

    constructor(private readonly camera: THREE.PerspectiveCamera) {}

    get mode(): "first" | "third" {
        return this.zoom === 0 ? "first" : "third";
    }

    /** `notches` from the mouse wheel: positive (scrolled down) zooms out, negative in. */
    zoomBy(notches: number): void {
        if (notches === 0) {
            return;
        }
        let zoom = this.zoom;
        for (let i = 0; i < Math.abs(notches); i++) {
            zoom =
                notches > 0
                    ? zoom === 0
                        ? THIRD_PERSON_MIN
                        : Math.min(THIRD_PERSON_MAX, zoom + ZOOM_STEP)
                    : zoom <= THIRD_PERSON_MIN
                      ? 0
                      : Math.max(THIRD_PERSON_MIN, zoom - ZOOM_STEP);
        }
        if (this.zoom === 0 && zoom > 0) {
            // Out of first person: start at the closest distance rather than easing from the last one.
            this.distance = THIRD_PERSON_MIN;
        }
        this.zoom = zoom;
    }

    /**
     * Pitch of the line through the reticule, from the eyes, for a view at `pitch`. In third person
     * the camera sits THIRD_PERSON_LIFT above the line behind the eyes and looks at them, so the
     * reticule's line passes through the eyes a little steeper down than the view: a shot from the
     * eyes along it goes where the reticule is.
     */
    aimPitch(pitch: number): number {
        if (this.mode === "first") return pitch;
        const d = this.distance;
        return Math.atan2(d * Math.sin(pitch) - THIRD_PERSON_LIFT, d * Math.cos(pitch));
    }

    /**
     * `offset` (first person only) is added to the view: swing follow, impact shake, leaning in to
     * pick a pocket.
     */
    update(target: CameraTarget, offset?: CameraOffset, dt = 0): void {
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
        this.distance = THREE.MathUtils.damp(this.distance, this.zoom, ZOOM_DAMPING, dt);
        const cosPitch = Math.cos(target.pitch);
        this.direction.set(-Math.sin(target.yaw) * cosPitch, Math.sin(target.pitch), -Math.cos(target.yaw) * cosPitch);
        this.camera.position.copy(this.eye).addScaledVector(this.direction, -this.distance);
        this.camera.position.y += THIRD_PERSON_LIFT;
        this.camera.lookAt(this.eye);
    }
}
