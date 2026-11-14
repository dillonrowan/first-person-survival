import * as THREE from "three";

import { SpellGfxObject, type SpellGfxLibrary } from "../combat/SpellGfxView";
import type { ProjectileKind } from "./AttackStyle";
import type { NpcProjectile } from "./NpcProjectiles";

const UP = new THREE.Vector3(0, 1, 0);

/** An additive glow: black adds nothing, so it needs no sorting against the scene. */
const glow = (color: number) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

/** A model of a projectile of this kind along +Y (the way it flies). */
function createProjectile(kind: ProjectileKind, color: number): THREE.Object3D {
    switch (kind) {
        case "arrow": {
            const shaft = new THREE.Mesh(
                new THREE.CylinderGeometry(0.01, 0.01, 0.5),
                new THREE.MeshBasicMaterial({ color: 0x8a6a3a }),
            );
            const head = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 6), new THREE.MeshBasicMaterial({ color: 0xcccccc }));
            head.position.y = 0.29;
            const group = new THREE.Group();
            group.add(shaft, head);
            return group;
        }
        case "rock":
            return new THREE.Mesh(new THREE.IcosahedronGeometry(0.12), new THREE.MeshLambertMaterial({ color }));
        case "spit":
            return new THREE.Mesh(new THREE.SphereGeometry(0.08), glow(color));
        case "fireball": {
            const group = new THREE.Group();
            group.add(new THREE.Mesh(new THREE.SphereGeometry(0.2), glow(color)));
            const trail = new THREE.Mesh(new THREE.SphereGeometry(0.12), glow(color));
            trail.position.y = -0.3;
            group.add(trail);
            return group;
        }
        case "orb":
        default:
            return new THREE.Mesh(new THREE.SphereGeometry(0.12), glow(color));
    }
}

/** Draws the arrows, spells, rocks, spit and fireballs NPCs have shot at the player. */
export class NpcProjectileView {
    private readonly views: THREE.Object3D[] = [];
    private readonly keys: string[] = [];
    private readonly direction = new THREE.Vector3();

    /** With `spellGfx`, projectiles carrying a spell are drawn with its OSRS projectile graphic. */
    constructor(
        private readonly scene: THREE.Scene,
        private readonly spellGfx?: SpellGfxLibrary,
    ) {}

    update(projectiles: readonly NpcProjectile[]): void {
        for (let i = 0; i < Math.max(projectiles.length, this.views.length); i++) {
            const p = projectiles[i];
            let view = this.views[i];
            const key = p ? `${p.kind}:${p.color}:${p.gfx ? (p.gfx.projectile ?? "none") : ""}` : undefined;
            // A placeholder drawn while the graphic loaded is replaced once it has.
            const upgrade = !!p?.gfx && !!view?.userData.fallback;
            if (p && (!view || this.keys[i] !== key || upgrade)) {
                view?.removeFromParent();
                const id = p.gfx?.projectile;
                // An attack with graphics but no projectile (a god spell, Vet'ion's lightning) flies unseen.
                view =
                    p.gfx && id === undefined
                        ? new THREE.Group()
                        : ((id !== undefined ? this.spellGfx?.create(id) : undefined) ?? createProjectile(p.kind, p.color));
                view.userData.fallback = id !== undefined && !(view instanceof SpellGfxObject) && !!this.spellGfx;
                this.scene.add(view);
                this.views[i] = view;
                this.keys[i] = key!;
            }
            if (!view) {
                continue;
            }
            view.visible = p !== undefined;
            if (!p) {
                continue;
            }
            // World (x east, y north, z up) to three.js (x, y up, -z north).
            view.position.set(p.x, p.z, -p.y);
            this.direction.set(p.vx, p.vz, -p.vy).normalize();
            if (view instanceof SpellGfxObject) {
                // The OSRS projectile: its front (local +z) along the flight, animation looping.
                view.rotation.set(-Math.asin(this.direction.y), Math.atan2(this.direction.x, this.direction.z), 0, "YXZ");
                view.setTime(p.age, true);
            } else {
                view.quaternion.setFromUnitVectors(UP, this.direction);
            }
        }
    }

    dispose(): void {
        for (const view of this.views) {
            view.removeFromParent();
        }
        this.views.length = 0;
        this.keys.length = 0;
    }
}
