import * as THREE from "three";

import type { Strike } from "./GroundStrikes";

const SHADOW_COLOR = 0x050302;
/** Opacity of a bash's shadow as it appears and as it lands, and the seconds between. [design] */
const SHADOW_OPACITY: readonly [number, number] = [0.2, 0.6];
const SHADOW_GROWS = 1;

/**
 * Draws the shadows that warn of Vet'ion's shield bash [wiki: "shadows will appear forewarning the
 * AoE"], one square per tile, darkening until it lands. His lightning needs none here: its graphic
 * (VETION_GFX.bolt) glows on the tile before the bolt strikes.
 */
export class GroundStrikesView {
    private readonly squares: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial }[] = [];
    private readonly geometry = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);

    constructor(
        private readonly scene: THREE.Scene,
        private readonly groundHeight: (plane: number, x: number, y: number) => number,
    ) {}

    update(strikes: readonly Strike[]): void {
        const tiles = strikes.flatMap((s) => (s.kind === "bash" ? s.tiles.map((t) => ({ ...t, strike: s })) : []));
        while (this.squares.length < tiles.length) {
            const material = new THREE.MeshBasicMaterial({ color: SHADOW_COLOR, transparent: true, depthWrite: false });
            const mesh = new THREE.Mesh(this.geometry, material);
            mesh.renderOrder = 3;
            this.scene.add(mesh);
            this.squares.push({ mesh, material });
        }
        this.squares.forEach((square, i) => {
            const tile = tiles[i];
            square.mesh.visible = tile !== undefined;
            if (!tile) return;
            const x = tile.x + 0.5;
            const y = tile.y + 0.5;
            const t = Math.min(1, Math.max(0, 1 - tile.strike.left / SHADOW_GROWS));
            square.mesh.position.set(x, this.groundHeight(tile.strike.plane, x, y) + 0.03, -y);
            square.material.opacity = SHADOW_OPACITY[0] + (SHADOW_OPACITY[1] - SHADOW_OPACITY[0]) * t;
        });
    }
}
