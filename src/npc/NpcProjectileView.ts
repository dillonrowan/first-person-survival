import * as THREE from "three";

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

    constructor(private readonly scene: THREE.Scene) {}

    update(projectiles: readonly NpcProjectile[]): void {
        for (let i = 0; i < Math.max(projectiles.length, this.views.length); i++) {
            const p = projectiles[i];
            let view = this.views[i];
            const key = p ? `${p.kind}:${p.color}` : undefined;
            if (p && (!view || this.keys[i] !== key)) {
                view?.removeFromParent();
                view = createProjectile(p.kind, p.color);
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
            view.quaternion.setFromUnitVectors(UP, this.direction);
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
