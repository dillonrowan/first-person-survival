import * as THREE from "three";

import { SPELL_GRAPHICS } from "../world/SpellGfxFormat";
import type { Arrow } from "./Bow";
import { ARROW_LENGTH, createArrow } from "./BowString";
import { BOLT_LENGTH, createBolt } from "./CrossbowRig";
import { SpellGfxObject, type SpellGfxLibrary } from "./SpellGfxView";
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

    /** `spellGfx` draws spells with their OSRS projectile graphic; without it (or until it loads) they are orbs. */
    constructor(
        private readonly scene: THREE.Scene,
        private readonly spellGfx?: SpellGfxLibrary,
    ) {}

    /** The spell's cache projectile, or a coloured orb while that loads or if it was not exported. */
    private createSpell(spell: NonNullable<Arrow["spell"]>): THREE.Object3D {
        const id = spell.id ? SPELL_GRAPHICS[spell.id]?.projectile : undefined;
        const gfx = id !== undefined ? this.spellGfx?.create(id) : undefined;
        if (gfx) {
            return gfx;
        }
        const orb = createSpellOrb(spell.color);
        orb.userData.fallback = id !== undefined && this.spellGfx !== undefined;
        return orb;
    }

    /** `launchFrom` gives the drawn arrow's head (world) for arrows that have just been shot. */
    update(arrows: readonly Arrow[], launchFrom?: (out: THREE.Vector3) => THREE.Vector3 | undefined): void {
        for (let i = 0; i < Math.max(arrows.length, this.views.length); i++) {
            const a = arrows[i];
            let view = this.views[i];
            const kind = a ? (a.spell ? `spell:${a.spell.id ?? a.spell.color}` : a.bolt ? "bolt" : "arrow") : "";
            // An orb drawn while the spell's graphic loaded is replaced once it has.
            const upgrade = !!a?.spell && !!view?.userData.fallback;
            if (a && (!view || this.kinds[i] !== kind || upgrade)) {
                // A new arrow, or a bolt or spell where an arrow was drawn (or any other swap).
                view?.removeFromParent();
                view = a.spell ? this.createSpell(a.spell) : (a.bolt ? this.templates.bolt : this.templates.arrow).clone();
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
                // Hidden for the first instants so it does not fill the screen at the eye it is
                // cast from.
                view.position.set(a.x, a.z, -a.y);
                view.visible = a.age * Math.hypot(a.vx, a.vy, a.vz) > SPELL_HIDDEN_WITHIN;
                if (view instanceof SpellGfxObject) {
                    // The OSRS projectile: its front (local +z) along the flight, animation looping.
                    this.direction.set(a.vx, a.vz, -a.vy).normalize();
                    view.rotation.set(-Math.asin(this.direction.y), Math.atan2(this.direction.x, this.direction.z), 0, "YXZ");
                    view.setTime(a.age, true);
                }
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
/** A spell is not drawn until it is this far (tiles) from the eye it was cast from, so it never fills the view. */
const SPELL_HIDDEN_WITHIN = 0.9;

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
