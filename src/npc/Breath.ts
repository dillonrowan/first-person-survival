import type { BreathInfo } from "./AttackStyle";

/**
 * True if the player is inside the breath cone: no further than `breath.length` from the NPC's
 * edge (`gap`) and within `breath.halfAngle` of the way it faces. (faceX, faceY) need not be unit.
 */
export function inBreathCone(
    npcX: number,
    npcY: number,
    faceX: number,
    faceY: number,
    playerX: number,
    playerY: number,
    gap: number,
    breath: Pick<BreathInfo, "length" | "halfAngle">,
): boolean {
    if (gap > breath.length) {
        return false;
    }
    const dx = playerX - npcX;
    const dy = playerY - npcY;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) {
        return true;
    }
    const cos = (dx * faceX + dy * faceY) / (d * (Math.hypot(faceX, faceY) || 1));
    return cos >= Math.cos(breath.halfAngle);
}
