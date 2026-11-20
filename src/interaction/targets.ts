import { Body, BodySource, rayCylinder } from "../physics/Bodies";
import type { Npc } from "../npc/Npc";
import type { ActionHandler, InteractionUi, Target, TargetSource } from "./Interaction";

/** Ticks (600 ms each) an NPC stands still and faces the player after being talked to. */
export const NPC_HOLD_TICKS = 8;
/** Fishing spots stand on water, so they can be used from further away. */
export const FISHING_RANGE = 4;

/** Names in the cache can carry colour markup such as <col=00ffff>. */
export function cleanName(name: string): string {
    return name.replace(/<[^>]*>/g, "").trim();
}

/** Targets the NPC under the crosshair. */
export function npcTargetSource(npcs: BodySource<Npc>): TargetSource {
    const bodies: Body<Npc>[] = [];
    return (ray) => {
        const reach = Math.max(ray.range, FISHING_RANGE);
        const x1 = ray.ox + ray.dx * reach;
        const y1 = ray.oy + ray.dy * reach;
        bodies.length = 0;
        npcs.collectBodies(
            ray.plane,
            Math.min(ray.ox, x1) - 0.5,
            Math.min(ray.oy, y1) - 0.5,
            Math.max(ray.ox, x1) + 0.5,
            Math.max(ray.oy, y1) + 0.5,
            bodies,
        );
        let best: Target | undefined;
        for (const body of bodies) {
            const range = /fishing spot/i.test(body.owner.appearance.name) ? FISHING_RANGE : ray.range;
            const t = rayCylinder(ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, body, range);
            if (t !== undefined && (!best || t < best.distance)) {
                const npc = body.owner;
                best = {
                    kind: "npc",
                    label: cleanName(npc.appearance.name),
                    actions: npc.appearance.actions?.length ? npc.appearance.actions : ["Interact"],
                    distance: t,
                    ref: npc,
                };
            }
        }
        return best;
    };
}

/**
 * Default NPC reaction: turn to face the player and stand still for a few seconds. Replace it to
 * add dialogue or combat.
 */
export function createNpcActionHandler(
    player: { x: number; y: number },
    ui: InteractionUi,
    next?: ActionHandler,
    /** Called for a "Bank" option (bankers). */
    onBank?: () => void,
    /** Skill actions (fish, pickpocket, trade…); true when handled, which skips the default reaction. */
    npcSkill?: (npc: Npc, action: string) => boolean,
): ActionHandler {
    return (target, action, index) => {
        if (target.kind !== "npc") {
            next?.(target, action, index);
            return;
        }
        if (/^bank$/i.test(action)) {
            onBank?.();
            return;
        }
        const npc = target.ref as Npc;
        if (npcSkill?.(npc, action)) return;
        npc.faceTowards(player.x, player.y);
        npc.hold(NPC_HOLD_TICKS);
        ui.showMessage(`${action} ${target.label}`);
    };
}
