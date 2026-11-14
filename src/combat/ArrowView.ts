import * as THREE from "three";

import type { Arrow } from "./Bow";
import { ARROW_LENGTH, createArrow } from "./BowString";
import { BOLT_LENGTH, createBolt } from "./CrossbowRig";
import { ARROW_CONVERGE } from "./WeaponView";

/**
 * A shot arrow seen leaving the bow: where its head was drawn on the string, closing onto the true
 * flight (which starts at the eye) over its first ARROW_CONVERGE tiles.
 */
type Launch = { offset: THREE.Vector3; from: number };

/**
 * Draws arrows and crossbow bolts in flight or stuck in the world, with the models they had on the
 * weapon. A new one starts at the head of the arrow on the bow (or the bolt on the crossbow) and
 * swoops into the line of sight, so it flies into what the reticule was on.
 */
export class ArrowView {
    private readonly views: THREE.Object3D[] = [];
    private readonly kinds: string[] = [];
    private readonly templates = { arrow: createArrow(), bolt: createBolt() };
    private readonly launches = new WeakMap<Arrow, Launch>();
    private readonly direction = new THREE.Vector3();
    private readonly head = new THREE.Vector3();
    private readonly start = new THREE.Vector3();

    constructor(private readonly scene: THREE.Scene) {}

    /** `launchFrom` gives the drawn arrow's head (world) for arrows that have just been shot. */
    update(arrows: readonly Arrow[], launchFrom?: (out: THREE.Vector3) => THREE.Vector3 | undefined): void {
        for (let i = 0; i < Math.max(arrows.length, this.views.length); i++) {
            const a = arrows[i];
            let view = this.views[i];
            const kind = a ? (a.spell ? `spell:${a.spell.color}` : a.bolt ? "bolt" : "arrow") : "";
            if (a && (!view || this.kinds[i] !== kind)) {
                // A new arrow, or a bolt or spell where an arrow was drawn (or any other swap).
                view?.removeFromParent();
                view = a.spell
                    ? createSpellOrb(a.spell.color)
                    : (a.bolt ? this.templates.bolt : this.templates.arrow).clone();
                view.visible = true;
                this.scene.add(view);
                this.views[i] = view;
                this.kinds[i] = kind;
            }
            if (!view) {
                continue;
            }
            view.visible = a !== undefined;
            if (!a) {
                continue;
            }
            if (a.spell) {
                // An orb: no model direction, and hidden for the first instants so it does not
                // fill the screen at the eye it is cast from.
                view.position.set(a.x, a.z, -a.y);
                view.visible = a.age > SPELL_HIDDEN_FOR;
                continue;
            }
            const length = a.bolt ? BOLT_LENGTH : ARROW_LENGTH;
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
            view.position.copy(this.head).addScaledVector(this.direction, -length);
            view.quaternion.setFromUnitVectors(UP, this.direction);
        }
    }
}

const UP = new THREE.Vector3(0, 1, 0);
/** An arrow younger than this (s) is still leaving the bow. */
const JUST_SHOT = 0.1;
/** A spell younger than this (s) is not drawn yet. */
const SPELL_HIDDEN_FOR = 0.03;

/** A glowing orb of the spell colour. */
export function createSpellOrb(color: number): THREE.Object3D {
    const orb = new THREE.Group();
    const glow = (c: number, radius: number, opacity: number) =>
        new THREE.Mesh(
            new THREE.SphereGeometry(radius, 12, 8),
            new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }),
        );
    orb.add(glow(color, 0.1, 1), glow(color, 0.18, 0.35));
    return orb;
}
