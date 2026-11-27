import type * as THREE from "three";

import type { SpellEffects, SpellGfxLibrary, SpellGfxObject } from "../combat/SpellGfxView";
import type { BearTrap } from "./BearTraps";
import { BEAR_TRAP_GFX } from "./NpcSpells";

type Shown = { object: SpellGfxObject | undefined; idle: boolean; age: number };

/**
 * Draws Callisto's and Artio's bear traps with the cache's trap: it springs up from the ground
 * (BEAR_TRAP_GFX.spawn), waits with its idle sequence, and snaps shut where it catches the player
 * (BEAR_TRAP_GFX.spring, played by `spring`). An expired trap just goes.
 */
export class BearTrapsView {
    private readonly shown = new Map<BearTrap, Shown>();

    constructor(
        private readonly scene: THREE.Scene,
        private readonly library: SpellGfxLibrary,
        private readonly effects: SpellEffects,
        private readonly groundHeight: (plane: number, x: number, y: number) => number,
    ) {}

    update(dt: number, traps: readonly BearTrap[]): void {
        for (const [trap, s] of this.shown) {
            if (!traps.includes(trap)) {
                s.object?.removeFromParent();
                this.shown.delete(trap);
            }
        }
        for (const trap of traps) {
            let s = this.shown.get(trap);
            if (!s) {
                s = { object: undefined, idle: false, age: 0 };
                this.shown.set(trap, s);
            } else {
                s.age += dt;
            }
            // The spawn plays once, then the idle loops (each made once its graphic has loaded).
            const idle = !!s.object && s.age >= s.object.duration;
            if (!s.object || (idle && !s.idle)) {
                const object = this.library.create(idle ? BEAR_TRAP_GFX.idle : BEAR_TRAP_GFX.spawn, trap.plane);
                if (!object) continue;
                s.object?.removeFromParent();
                s.object = object;
                s.idle = idle;
                if (idle) s.age = 0;
                const x = trap.x + 0.5;
                const y = trap.y + 0.5;
                object.position.set(x, this.groundHeight(trap.plane, x, y), -y);
                this.scene.add(object);
            }
            s.object.setTime(s.age, s.idle);
        }
    }

    /** The trap snaps shut on the player. */
    spring(trap: BearTrap): void {
        const x = trap.x + 0.5;
        const y = trap.y + 0.5;
        const z = this.groundHeight(trap.plane, x, y);
        this.effects.play(BEAR_TRAP_GFX.spring, () => ({ x, y, z }), 0, 1, trap.plane);
    }
}
