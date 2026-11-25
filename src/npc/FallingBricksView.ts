import * as THREE from "three";

import type { SpellEffects } from "../combat/SpellGfxView";
import { BRICK_FALL_SECONDS, Brick } from "./FallingBricks";

/** VFX_RAT_BOSS_FALLING_DEBRIS: the cache's falling rubble (spot animation 2644). */
export const FALLING_DEBRIS_GFX = 2644;
/** Seconds before landing that the rubble starts to fall into view. [design] */
const DEBRIS_LEAD = 0.6;
const SHADOW_COLOR = 0x050302;
/** Opacity and size of a shadow as it appears and just before its rubble lands. [design] */
const SHADOW_OPACITY: readonly [number, number] = [0.15, 0.65];
const SHADOW_SIZE: readonly [number, number] = [0.45, 1];

type Shadow = { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial };

/**
 * Draws Falling Bricks: a looming shadow on each targeted tile, darkening and growing until the
 * rubble (the cache's debris graphic) drops onto it.
 */
export class FallingBricksView {
    private readonly shadows: Shadow[] = [];
    private readonly geometry = new THREE.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2);
    private readonly dropped = new WeakSet<Brick>();

    constructor(
        private readonly scene: THREE.Scene,
        private readonly effects: SpellEffects,
        private readonly groundHeight: (plane: number, x: number, y: number) => number,
    ) {}

    update(bricks: readonly Brick[]): void {
        while (this.shadows.length < bricks.length) {
            const material = new THREE.MeshBasicMaterial({ color: SHADOW_COLOR, transparent: true, depthWrite: false });
            const mesh = new THREE.Mesh(this.geometry, material);
            mesh.renderOrder = 3;
            this.scene.add(mesh);
            this.shadows.push({ mesh, material });
        }
        this.shadows.forEach((shadow, i) => {
            const brick = bricks[i];
            shadow.mesh.visible = brick !== undefined;
            if (!brick) {
                return;
            }
            const x = brick.x + 0.5;
            const y = brick.y + 0.5;
            const t = Math.min(1, Math.max(0, 1 - brick.left / BRICK_FALL_SECONDS));
            shadow.mesh.position.set(x, this.groundHeight(brick.plane, x, y) + 0.03, -y);
            shadow.mesh.scale.setScalar(SHADOW_SIZE[0] + (SHADOW_SIZE[1] - SHADOW_SIZE[0]) * t);
            shadow.material.opacity = SHADOW_OPACITY[0] + (SHADOW_OPACITY[1] - SHADOW_OPACITY[0]) * t;
            if (brick.left <= DEBRIS_LEAD && !this.dropped.has(brick)) {
                this.dropped.add(brick);
                const z = this.groundHeight(brick.plane, x, y);
                this.effects.play(FALLING_DEBRIS_GFX, () => ({ x, y, z }), 0);
            }
        });
    }
}
