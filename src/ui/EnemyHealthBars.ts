import * as THREE from "three";

import type { Npc } from "../npc/Npc";
import type { Npcs } from "../npc/Npcs";

const MAX_DISTANCE = 12;
const BAR_VISIBLE_AFTER_HURT = 5;

export function shouldShowEnemyHealthBar(
    npc: Pick<Npc, "gone" | "body" | "combatant">,
    playerX: number,
    playerY: number,
    playerPlane: number,
): boolean {
    return !npc.gone &&
        !npc.combatant.dead &&
        npc.body.plane === playerPlane &&
        npc.combatant.sinceHurt <= BAR_VISIBLE_AFTER_HURT &&
        Math.hypot(npc.body.x - playerX, npc.body.y - playerY) <= MAX_DISTANCE;
}

export function enemyHealthBarFillFraction(npc: Pick<Npc, "combatant">): number {
    return Math.max(0, Math.min(1, npc.combatant.healthFraction));
}

export class EnemyHealthBars {
    private readonly root: HTMLElement;
    private readonly entries = new Map<Npc, HTMLElement>();
    private readonly anchor = new THREE.Vector3();

    constructor(documentRoot: HTMLElement, private readonly npcs: Npcs, private readonly camera: THREE.PerspectiveCamera) {
        const root = document.createElement("div");
        root.id = "enemy-health-bars";
        documentRoot.appendChild(root);
        this.root = root;
    }

    update(playerX: number, playerY: number, playerPlane: number): void {
        const used = new Set<Npc>();
        this.camera.updateMatrixWorld();

        for (const npc of this.npcs.all()) {
            if (!shouldShowEnemyHealthBar(npc, playerX, playerY, playerPlane)) {
                continue;
            }

            used.add(npc);
            let bar = this.entries.get(npc);
            if (!bar) {
                bar = document.createElement("div");
                bar.className = "enemy-health-bar";
                bar.innerHTML = '<div class="enemy-health-back"></div><div class="enemy-health-fill"></div>';
                this.root.appendChild(bar);
                this.entries.set(npc, bar);
            }

            this.anchor.set(npc.body.x, npc.body.z + npc.body.height + 0.25, -npc.body.y);
            this.anchor.project(this.camera);
            const visible =
                this.anchor.z > -1 &&
                this.anchor.z < 1 &&
                this.anchor.x > -1 &&
                this.anchor.x < 1 &&
                this.anchor.y > -1 &&
                this.anchor.y < 1;
            if (!visible) {
                bar.style.display = "none";
                continue;
            }

            bar.style.display = "";
            bar.style.left = `${(this.anchor.x * 0.5 + 0.5) * window.innerWidth}px`;
            bar.style.top = `${(-this.anchor.y * 0.5 + 0.5) * window.innerHeight}px`;
            const fill = bar.querySelector<HTMLElement>(".enemy-health-fill")!;
            fill.style.width = `${Math.round(enemyHealthBarFillFraction(npc) * 1000) / 10}%`;
        }

        for (const [npc, bar] of this.entries) {
            if (!used.has(npc)) {
                bar.style.display = "none";
            }
        }
    }
}
