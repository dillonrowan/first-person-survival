import * as THREE from "three";

import type { Body, BodySource } from "./Bodies";

const MAX_CIRCLES = 64;
const SEGMENTS = 16;

/** Dev overlay (?debug=collision): draws the collision circles of bodies near the player. */
export class CollisionDebug {
    readonly lines: THREE.LineSegments;
    private readonly positions = new Float32Array(MAX_CIRCLES * SEGMENTS * 2 * 3);
    private readonly bodies: Body[] = [];

    constructor(scene: THREE.Scene) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
        geometry.setDrawRange(0, 0);
        this.lines = new THREE.LineSegments(
            geometry,
            new THREE.LineBasicMaterial({ color: 0xff3355, depthTest: false }),
        );
        this.lines.frustumCulled = false;
        this.lines.renderOrder = 100;
        scene.add(this.lines);
    }

    update(source: BodySource, player: Body | undefined, plane: number, x: number, y: number): void {
        this.bodies.length = 0;
        source.collectBodies(plane, x - 12, y - 12, x + 12, y + 12, this.bodies);
        if (player) {
            this.bodies.push(player);
        }
        let vertex = 0;
        const count = Math.min(this.bodies.length, MAX_CIRCLES);
        for (let i = 0; i < count; i++) {
            const b = this.bodies[i];
            for (let s = 0; s < SEGMENTS; s++) {
                for (const k of [s, s + 1]) {
                    const angle = (k / SEGMENTS) * Math.PI * 2;
                    // Tile space (x, y, z up) to three.js (x, z, -y).
                    this.positions[vertex++] = b.x + Math.cos(angle) * b.radius;
                    this.positions[vertex++] = b.z + 0.05;
                    this.positions[vertex++] = -(b.y + Math.sin(angle) * b.radius);
                }
            }
        }
        const attribute = this.lines.geometry.getAttribute("position") as THREE.BufferAttribute;
        attribute.needsUpdate = true;
        this.lines.geometry.setDrawRange(0, count * SEGMENTS * 2);
    }
}
