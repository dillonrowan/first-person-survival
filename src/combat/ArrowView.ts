import * as THREE from "three";

import type { Arrow } from "./Bow";
import { ARROW_LENGTH, createArrow } from "./BowString";
import { ARROW_CONVERGE } from "./WeaponView";

/**
 * A shot arrow seen leaving the bow: where its head was drawn on the string, closing onto the true
 * flight (which starts at the eye) over its first ARROW_CONVERGE tiles.
 */
type Launch = { offset: THREE.Vector3; from: number };

/**
 * Draws arrows in flight or stuck in the world, with the same model as the nocked arrow. A new
 * arrow starts at the bow's arrow head and swoops into the line of sight, so it flies into what
 * the reticule was on.
 */
export class ArrowView {
    private readonly views: THREE.Object3D[] = [];
    private readonly template = createArrow();
    private readonly launches = new WeakMap<Arrow, Launch>();
    private readonly direction = new THREE.Vector3();
    private readonly head = new THREE.Vector3();
    private readonly start = new THREE.Vector3();

    constructor(private readonly scene: THREE.Scene) {}

    /** `launchFrom` gives the drawn arrow's head (world) for arrows that have just been shot. */
    update(arrows: readonly Arrow[], launchFrom?: (out: THREE.Vector3) => THREE.Vector3 | undefined): void {
        while (this.views.length < arrows.length) {
            const view = this.template.clone();
            view.visible = true;
            this.scene.add(view);
            this.views.push(view);
        }
        this.views.forEach((view, i) => {
            const a = arrows[i];
            view.visible = a !== undefined;
            if (!a) {
                return;
            }
            // World (x east, y north, z up) to three.js (x, y up, -z north).
            this.head.set(a.x, a.z, -a.y);
            this.direction.set(a.vx, a.vz, -a.vy);
            const speed = this.direction.length();
            this.direction.divideScalar(speed || 1);
            let launch = this.launches.get(a);
            if (!launch && !a.stuck && a.age < JUST_SHOT && launchFrom?.(this.start)) {
                launch = { offset: this.start.clone().sub(this.head), from: a.age * speed };
                this.launches.set(a, launch);
            }
            if (launch && !a.stuck) {
                const left = ARROW_CONVERGE - launch.from;
                const k = left > 0 ? Math.max(0, 1 - (a.age * speed - launch.from) / left) : 0;
                if (k > 0) {
                    this.head.addScaledVector(launch.offset, k);
                    // Moving along the swoop: the flight plus the offset closing at the arrow's speed.
                    this.direction.multiplyScalar(speed).addScaledVector(launch.offset, -speed / left).normalize();
                }
            }
            view.position.copy(this.head).addScaledVector(this.direction, -ARROW_LENGTH);
            view.quaternion.setFromUnitVectors(UP, this.direction);
        });
    }
}

const UP = new THREE.Vector3(0, 1, 0);
/** An arrow younger than this (s) is still leaving the bow. */
const JUST_SHOT = 0.1;
