import type { NpcAttackClip } from "../world/NpcFormat";
import { CLIENT_CYCLE_SECONDS } from "./NpcAnimation";
import type { Npc } from "./Npc";
import type { NpcAttack } from "./NpcAttacks";

/** Moves of a boss fight (Scurrius.ts, Bryophyta.ts) built from the boss's baked clips. */

/** Seconds a clip lasts. */
export const clipSeconds = (clip: NpcAttackClip) => clip.frameLengths.reduce((sum, length) => sum + length, 0) * CLIENT_CYCLE_SECONDS;

/**
 * A boss move played from one of a boss's extra clips (NpcModelData.extras), timed by it: it lands at the clip's hit cycle (the
 * stomp's landing), or at `at` of its length for a throw or a cast. Without the clip (an older
 * export) it keeps `base`'s own clip and timing, or lands halfway through a plain 1.8 s.
 */
export function extraMove(
    npc: Npc,
    seqId: number,
    base: Partial<NpcAttack> & Pick<NpcAttack, "id" | "style">,
    at?: number,
): NpcAttack {
    const move: NpcAttack = {
        hitPow: [0.7],
        hitTimes: [0.9],
        total: 1.8,
        range: 0,
        lunge: 0,
        push: false,
        breaksParry: true,
        weight: 1,
        minGap: 0,
        maxGap: Infinity,
        cooldownScale: 1,
        ...base,
    };
    const index = npc.extraIndex(seqId);
    const clip = npc.extraClip(seqId);
    if (index < 0 || !clip) {
        return move;
    }
    const total = clipSeconds(clip);
    const hit = Math.min(total, at !== undefined ? total * at : clip.hitCycle * CLIENT_CYCLE_SECONDS);
    return { ...move, hitTimes: [hit], total: Math.max(total, hit + CLIENT_CYCLE_SECONDS), extra: index };
}
