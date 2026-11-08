import { tuning } from "../combat/tuning";

/** What an NPC can sense of the player this update. Positions in tiles, heights in tiles. */
export type SenseInput = {
    /** NPC position, eye height, unit facing vector. */
    x: number;
    y: number;
    eyeZ: number;
    facingX: number;
    facingY: number;
    /** Alerted NPCs use the wide cone. */
    alerted: boolean;
    playerX: number;
    playerY: number;
    playerZ: number;
    playerHeight: number;
    /** Crouching: the stealth cone, range and reaction delay apply. */
    stealth: boolean;
    /** Light on the player, 0..1 (no lighting model: 1). */
    visibility: number;
    /** Radius of the noise the player makes this update, tiles (0 when still). */
    presence: number;
    /** Nothing blocks the line from the NPC to the player. */
    lineOfSight: boolean;
};

/**
 * Sight test (spec 16.7, gh 0x222ce8a0 / 0x222c74a0): inside the horizontal cone (90° calm, 160°
 * alerted, ×0.4 in stealth), the vertical ±30°, within range (1500 u, ×0.6 in stealth), with a
 * clear line, and visibility / (dist / range) > visibilityratio. Fighting NPCs always see the
 * player within 200 u.
 */
export function canSee(s: SenseInput): boolean {
    const dx = s.playerX - s.x;
    const dy = s.playerY - s.y;
    const d = Math.hypot(dx, dy);
    if (!s.lineOfSight) {
        return false;
    }
    if (s.alerted && d <= tuning.sightInCombat) {
        return true;
    }
    const range = tuning.sightRange * (s.stealth ? tuning.stealthRangeScale : 1);
    if (d > range) {
        return false;
    }
    if (d > 1e-6) {
        const fov = (s.alerted ? tuning.fovAlerted : tuning.fovCalm) * (s.stealth ? tuning.stealthFovScale : 1);
        if ((dx * s.facingX + dy * s.facingY) / d < Math.cos(fov / 2)) {
            return false;
        }
        // Vertical cone: the player's head or feet within ±30° of level.
        const limit = Math.tan(tuning.fovVertical) * d;
        const low = s.playerZ - s.eyeZ;
        const high = s.playerZ + s.playerHeight - s.eyeZ;
        if (low > limit || high < -limit) {
            return false;
        }
    }
    return s.visibility / Math.max(d / range, 1e-6) > tuning.visibilityRatio;
}

/** Seconds between first seeing the player and reacting (delaysee / delaysee_stealth). */
export function sightDelay(distance: number, stealth: boolean): number {
    if (!stealth) {
        return 0;
    }
    for (const [within, scale] of tuning.stealthDelayBands) {
        if (distance < within) {
            return tuning.stealthSightDelay * scale;
        }
    }
    return tuning.stealthSightDelay;
}

/** True if the player's noise reaches the NPC (spec 16.7 hearing). */
export function canHear(s: SenseInput, heightDiff: number): boolean {
    if (s.presence <= 0 || Math.abs(heightDiff) > tuning.hearingHeightClip) {
        return false;
    }
    return Math.hypot(s.playerX - s.x, s.playerY - s.y) <= s.presence;
}

/** Hearing reaction delay: 1 s, none for sprint-level noise (above "big"). */
export function hearingDelay(presence: number): number {
    return presence > tuning.presenceRun ? 0 : tuning.hearingDelay;
}

/** Noise radius of the player's movement (SoundPresenceDist_*; mapping from the data's comments). */
export function presenceFor(state: { speed: number; crouching: boolean; walking: boolean; sprinting: boolean }): number {
    if (state.speed < 0.3) {
        return 0;
    }
    if (state.crouching) {
        return tuning.presenceCrouch;
    }
    if (state.sprinting) {
        return tuning.presenceSprint;
    }
    return state.walking ? tuning.presenceWalk : tuning.presenceRun;
}
