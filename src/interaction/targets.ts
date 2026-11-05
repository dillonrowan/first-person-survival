import { Body, BodySource, rayCylinder } from "../physics/Bodies";
import type { Npc } from "../npc/Npc";
import type { ActionHandler, InteractionUi, Target, TargetSource } from "./Interaction";

/** Ticks (600 ms each) an NPC stands still and faces the player after being talked to. */
export const NPC_HOLD_TICKS = 8;

/** Names in the cache can carry colour markup such as <col=00ffff>. */
export function cleanName(name: string): string {
    return name.replace(/<[^>]*>/g, "").trim();
}

/** Targets the NPC under the crosshair. */
export function npcTargetSource(npcs: BodySource<Npc>): TargetSource {
    const bodies: Body<Npc>[] = [];
    return (ray) => {
        const x1 = ray.ox + ray.dx * ray.range;
        const y1 = ray.oy + ray.dy * ray.range;
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
            const t = rayCylinder(ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, body, ray.range);
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
): ActionHandler {
    return (target, action, index) => {
        if (target.kind !== "npc") {
            next?.(target, action, index);
            return;
        }
        const npc = target.ref as Npc;
        npc.faceTowards(player.x, player.y);
        npc.hold(NPC_HOLD_TICKS);
        ui.showMessage(`${action} ${target.label}`);
    };
}
