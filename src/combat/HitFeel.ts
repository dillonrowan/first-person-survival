import type { DamageResult } from "./Damage";

/** Shortest and added longest hold (seconds), and how fast struck bodies move during it. [design] */
const STOP_MIN = 0.035;
const STOP_RANGE = 0.075;
const STOP_TIME_SCALE = 0.05;

/** How hard a hit lands, 0..1, from what it did to the target. */
export function impactStrength(result: Pick<DamageResult, "reaction" | "killed" | "knockedDown">): number {
    if (result.killed || result.knockedDown) {
        return 1;
    }
    return { none: 0.3, flinch: 0.4, stagger: 0.65, push: 0.85, knockdown: 1 }[result.reaction];
}

/**
 * The weight of a landed blow on the struck: the NPCs nearly freeze for a moment, longer for a
 * heavier blow. The blade's own stall and the view's jolt are WeaponView's.
 */
export class HitFeel {
    private stop = 0;

    /** A blow of `strength` (0..1) landed. */
    impact(strength: number): void {
        const s = Math.min(1, Math.max(0, strength));
        this.stop = Math.max(this.stop, STOP_MIN + STOP_RANGE * s);
    }

    /** True during a hold. */
    get stopped(): boolean {
        return this.stop > 0;
    }

    /** Time step for the NPCs this frame: almost nothing during a hold. */
    worldDt(dt: number): number {
        if (this.stop <= 0) {
            return dt;
        }
        this.stop = Math.max(0, this.stop - dt);
        return dt * STOP_TIME_SCALE;
    }
}
