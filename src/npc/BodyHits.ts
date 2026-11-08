/**
 * Bodies knocking NPCs over (spec 20.7). In Dark Messiah an NPC hit by another character's flying
 * body takes it like a kick: above `mm_ragdoll_vel_to_damage` × 0.25 the hit counts, above the
 * cvar itself it also does 10 damage and knocks the NPC down (gh 0x22341360 builds the damage,
 * 0x222aabb0 turns it into the kick reaction), and the same body cannot do it again within 2 s.
 * Here every counting hit knocks the NPC down, onto a ragdoll of its own, and none is lethal:
 * the NPC always gets up again.
 */
import { tuning } from "../combat/tuning";
import type { Body } from "../physics/Bodies";
import type { Ragdoll } from "./Ragdoll";

/** A knockdown by a body: direction the hit travels (tile space), the NPC's starting speed, damage. */
export type BodyHit = { dirX: number; dirY: number; speed: number; damage: number };

/**
 * A ragdoll meeting a standing NPC's body. If it comes in fast enough and `canKnockDown`, the
 * two share their momentum along the contact as in an inelastic collision (the body slows, the
 * NPC is sent on at their common speed) and the hit is returned for the NPC to fall. Otherwise
 * the NPC stands its ground and the body is pushed out of it.
 */
export function strikeBody(ragdoll: Ragdoll, body: Body, targetMass: number, canKnockDown: boolean): BodyHit | undefined {
    // Tile space (x, y) is three.js (x, −z).
    const x = body.x;
    const z = -body.y;
    const contact = ragdoll.touchCylinder(x, z, body.z, body.z + body.height, body.radius);
    if (!contact) {
        return undefined;
    }
    if (canKnockDown && contact.closing >= tuning.ragdollHitSpeed) {
        const m = ragdoll.mass;
        const common = (contact.closing * m) / (m + targetMass);
        // The contact normal points from the NPC out to the body: the body loses its motion into
        // the NPC down to the common speed.
        const loss = contact.closing - common;
        ragdoll.addSpeed(contact.nx * loss, 0, contact.nz * loss);
        const hurt = contact.closing >= tuning.ragdollHurtSpeed;
        return {
            dirX: -contact.nx,
            dirY: contact.nz,
            speed: common,
            damage: hurt ? tuning.ragdollHitDamage * tuning.strengthScale : 0,
        };
    }
    ragdoll.pushOutOfCylinder(x, z, body.z, body.z + body.height, body.radius);
    return undefined;
}
