import { Body, BodySource, rayCylinder, segmentHitsBoxes2D } from "../physics/Bodies";
import { Box, FlagsAt, collectTileBoxes } from "../physics/TileColliders";
import { tuning } from "./tuning";

export type KickAttacker = {
    x: number;
    y: number;
    /** Eye height: the first trace starts here. */
    eyeZ: number;
    yaw: number;
    pitch: number;
    plane: number;
};

export type KickTrace<T> = {
    body: Body<T>;
    /** Horizontal unit direction of the kick. */
    dirX: number;
    dirY: number;
    /** Which retry found it (0 = the first trace at eye height). */
    attempt: number;
};

/**
 * The kick's hit test (gh 0x2242e8b0): a trace of `kickReach` from the eyes along the view; on a
 * miss it is retried, each time starting `kickRetryDrop` lower, so low or crouched targets are
 * still found. Walls between the kicker and the hit point stop it.
 */
export function traceKick<T>(attacker: KickAttacker, bodies: BodySource<T>, flagsAt: FlagsAt): KickTrace<T> | undefined {
    const cosPitch = Math.cos(attacker.pitch);
    const dx = -Math.sin(attacker.yaw) * cosPitch;
    const dy = Math.cos(attacker.yaw) * cosPitch;
    const dz = Math.sin(attacker.pitch);
    const reach = tuning.kickReach;
    const found: Body<T>[] = [];
    bodies.collectBodies(
        attacker.plane,
        attacker.x - reach - 1,
        attacker.y - reach - 1,
        attacker.x + reach + 1,
        attacker.y + reach + 1,
        found,
    );
    const boxes: Box[] = [];
    const hx = -Math.sin(attacker.yaw);
    const hy = Math.cos(attacker.yaw);
    for (let attempt = 0; attempt <= tuning.kickRetries; attempt++) {
        const oz = attacker.eyeZ - attempt * tuning.kickRetryDrop;
        let best: Body<T> | undefined;
        let bestT = Infinity;
        for (const body of found) {
            const t = rayCylinder(attacker.x, attacker.y, oz, dx, dy, dz, body, reach);
            if (t !== undefined && t < bestT) {
                bestT = t;
                best = body;
            }
        }
        if (!best) {
            continue;
        }
        const ex = attacker.x + dx * bestT;
        const ey = attacker.y + dy * bestT;
        collectTileBoxes(
            flagsAt,
            attacker.plane,
            Math.min(attacker.x, ex),
            Math.min(attacker.y, ey),
            Math.max(attacker.x, ex),
            Math.max(attacker.y, ey),
            boxes,
            "walls",
        );
        if (segmentHitsBoxes2D(attacker.x, attacker.y, ex, ey, boxes) !== undefined) {
            return undefined; // the kick meets a wall first
        }
        return { body: best, dirX: hx, dirY: hy, attempt };
    }
    return undefined;
}

/** The kick's timeline: low when looking down, medium otherwise. */
export class KickController {
    /** Seconds since the kick started, or undefined when not kicking. */
    elapsed: number | undefined;
    low = false;
    private resolved = false;

    get active(): boolean {
        return this.elapsed !== undefined;
    }

    get hitTime(): number {
        return this.low ? tuning.kickHitTimeLow : tuning.kickHitTimeMedium;
    }

    /** Starts a kick if allowed: enough stamina (3), not already kicking. */
    tryStart(stamina: number, pitch: number): boolean {
        if (this.active || stamina < tuning.kickStaminaNeeded) {
            return false;
        }
        this.elapsed = 0;
        this.low = pitch <= tuning.kickLowPitch;
        this.resolved = false;
        return true;
    }

    /** Advances the kick; returns true in the update its hit event fires. */
    update(dt: number): boolean {
        if (this.elapsed === undefined) {
            return false;
        }
        this.elapsed += dt;
        let fire = false;
        if (!this.resolved && this.elapsed >= this.hitTime) {
            this.resolved = true;
            fire = true;
        }
        if (this.elapsed >= tuning.kickDuration) {
            this.elapsed = undefined;
        }
        return fire;
    }

    cancel(): void {
        this.elapsed = undefined;
    }
}
