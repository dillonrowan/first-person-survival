import type { DamageResult } from "./Damage";

/** Shortest and added longest hold (seconds), and how fast struck bodies move during it. [design] */
const STOP_MIN = 0.035;
const STOP_RANGE = 0.075;
const STOP_TIME_SCALE = 0.05;

/** How hard a hit lands, 0..1, from what it did to the target. */
export function impactStrength(result: Pick<DamageResult, "reaction" | "killed" | "knockedDown" | "defence">): number {
    if (result.killed || result.knockedDown) {
        return 1;
    }
    if (result.defence === "parry") {
        return 0; // the parrying NPC does not freeze: its blow back is timed to the stun
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

/** View kick when a parry's blow lands: radians the head snaps up and rolls, and how fast that dies (1/s). [design] */
const STUN_KICK_PITCH = 0.3;
const STUN_KICK_ROLL = 0.18;
const STUN_KICK_DECAY = 4.5;
/** Dazed sway while stunned, radians, and how fast it fades in and out (1/s). [design] */
const DAZE_PITCH = 0.035;
const DAZE_YAW = 0.05;
const DAZE_ROLL = 0.08;
const DAZE_FADE = 3;

/** The player's view knocked about by a parry's blow, then swaying while stunned. */
export class StunFeel {
    /** Rotation (radians) to add to the view this frame. */
    readonly view = { pitch: 0, yaw: 0, roll: 0 };
    private kickLeft = 0;
    private side = 1;
    private daze = 0;
    private clock = 0;

    /** A blow snapped the head back; `side` (±1) is the way it rolls. */
    kick(side: number): void {
        this.kickLeft = 1;
        this.side = side < 0 ? -1 : 1;
    }

    update(dt: number, stunned: boolean): void {
        this.clock += dt;
        this.kickLeft *= Math.exp(-STUN_KICK_DECAY * dt);
        this.daze = Math.min(1, Math.max(0, this.daze + (stunned ? 1 : -1) * DAZE_FADE * dt));
        const t = this.clock;
        this.view.pitch = STUN_KICK_PITCH * this.kickLeft + DAZE_PITCH * this.daze * Math.sin(t * 2.3);
        this.view.yaw = DAZE_YAW * this.daze * Math.sin(t * 1.7 + 0.8);
        this.view.roll = STUN_KICK_ROLL * this.side * this.kickLeft + DAZE_ROLL * this.daze * Math.sin(t * 1.3 + 2.1);
    }
}
