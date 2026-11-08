import * as THREE from "three";

import type { Arrow } from "./Bow";

const LENGTH = 0.6;

/** Draws arrows in flight or stuck in the world as thin shafts along their velocity. */
export class ArrowView {
    private readonly meshes: THREE.Mesh[] = [];
    private readonly geometry = new THREE.BoxGeometry(0.02, 0.02, LENGTH);
    private readonly material = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.8 });
    private readonly direction = new THREE.Vector3();

    constructor(private readonly scene: THREE.Scene) {}

    update(arrows: readonly Arrow[]): void {
        while (this.meshes.length < arrows.length) {
            const mesh = new THREE.Mesh(this.geometry, this.material);
            this.scene.add(mesh);
            this.meshes.push(mesh);
        }
        this.meshes.forEach((mesh, i) => {
            const a = arrows[i];
            mesh.visible = a !== undefined;
            if (!a) {
                return;
            }
            // World (x east, y north, z up) to three.js (x, y up, -z north).
            this.direction.set(a.vx, a.vz, -a.vy).normalize();
            mesh.position.set(a.x - this.direction.x * LENGTH * 0.5, a.z - this.direction.y * LENGTH * 0.5, -a.y - this.direction.z * LENGTH * 0.5);
            mesh.lookAt(mesh.position.x + this.direction.x, mesh.position.y + this.direction.y, mesh.position.z + this.direction.z);
        });
    }
}
