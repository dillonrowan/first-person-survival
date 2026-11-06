import type { Body, BodySource } from "../physics/Bodies";
import type { FlagsAt } from "../physics/TileColliders";
import { Combatant } from "./Combatant";
import { DamageResult, applyHit, hitboxMultiplier } from "./Damage";
import { raySign, traceRay } from "./SwingRay";
import { rayFor, timelineFor } from "./moves";
import { KickController, traceKick } from "./Kick";
import { MeleeController, MeleeInput } from "./MeleeController";
import type { MoveDef } from "./moves";
import { tuning } from "./tuning";
import { WEAPONS, WeaponDef } from "./weapons";
import { npcStrikeDamage } from "../npc/NpcAttacks";
import { Arrow, BowController, launchArrow, stepArrows } from "./Bow";
import type { HitEvent } from "./moves";

/** layer_bowattack_shoot (spec 16.4): HitPow 1.5, impact along the arrow, +2 adrenaline. */
const ARROW_HIT: HitEvent = {
    hitPow: tuning.bowHitPow,
    impact: { x: 1, y: 0, z: 0 },
    adrenaline: tuning.bowAdrenaline,
    push: false,
    alwaysPush: 0,
    breaksParry: false,
    stunChance: 0,
    fallChance: 0,
};
const ARROW_MOVE: MoveDef = { id: "arrow", kind: "quick", hits: [ARROW_HIT], lunge: 0 };

/** Something the player can hit: an NPC, as far as combat is concerned. */
export interface CombatTarget {
    readonly combatant: Combatant;
    readonly attackable: boolean;
    /** True once the target is fighting; hits on targets that are not get the unaware bonus. */
    readonly inCombat: boolean;
    /** Stamina a kick on this target costs; NPCs cost stamina_kick_npc (spec 7). */
    readonly kickCost?: number;
    /** `hitPow` is the move's HitPow; physics props scale their push by it (spec 19). */
    takeHit(dirX: number, dirY: number, push: number, fromX: number, fromY: number, hitPow?: number): void;
    /** A kick: the target may dodge it. */
    kick(dirX: number, dirY: number, fromX: number, fromY: number): "dodged" | "hit";
}

/** The player state combat reads and pushes. */
export type CombatPlayer = {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    plane: number;
    eyeHeight: number;
    sprinting: boolean;
    grounded: boolean;
    /** Actual horizontal velocity, tiles/s (the bow zooms when nearly still). */
    velocityX?: number;
    velocityY?: number;
    verticalSpeed: number;
    stamina: { value: number; spend(amount: number): boolean };
    applyImpulse(x: number, y: number, z?: number): void;
};

export type CombatInput = {
    attackDown: boolean;
    /** True in the update the attack button went down, even if it already came up again. */
    attackPressed?: boolean;
    /** Right mouse: parry stance (spec 6, 16.8). */
    blockDown?: boolean;
    /** True in the update the kick key went down. */
    kickPressed?: boolean;
    forward: number;
    strafe: number;
};

export type HitReport = { target: CombatTarget; result: DamageResult; move: MoveDef };
export type KickReport = { target?: CombatTarget; outcome: "dodged" | "hit" | "miss" };
/** An NPC strike that reached the player. */
export type StrikeReport = { outcome: "parried" | "hit" | "miss"; damage: number; punch: number };

/** What the player needs to know about an incoming NPC strike. */
export type IncomingStrike = {
    fromX: number;
    fromY: number;
    /** Gap between the bodies' edges, tiles. */
    gap: number;
    range: number;
    hitPow: number;
    push: boolean;
    breaksParry: boolean;
};

/**
 * The player's side of melee: owns the weapon and melee controller, sweeps swings against NPCs
 * and applies damage, push, lunge and adrenaline.
 */
export class PlayerCombat {
    readonly combatant = new Combatant(tuning.playerMaxHealth);
    readonly melee: MeleeController;
    readonly kick = new KickController();
    weaponIndex = 0;
    /** Called for every hit, for hit markers and sounds. */
    onHit?: (report: HitReport) => void;
    /** Called when a kick lands, misses or is dodged. */
    onKick?: (report: KickReport) => void;
    /** Called for every NPC strike that reaches the player. */
    onStruck?: (report: StrikeReport) => void;
    /** True while holding the parry stance. */
    blocking = false;
    /** Seconds since the player last attacked (NPCs go berserk after 2 s, spec 10.1). */
    sinceAttack = Infinity;

    readonly bow = new BowController();
    /** Arrows in flight or stuck in the world. */
    readonly arrows: Arrow[] = [];
    /** Ground height for arrows; without it they only stop at walls. */
    groundHeight?: (plane: number, x: number, y: number) => number;

    private readonly hitThisSwing: Set<Body<CombatTarget>>[] = [];
    private clock = 0;

    constructor(
        private readonly bodies: BodySource<CombatTarget>,
        private readonly flagsAt: FlagsAt,
        private readonly random: () => number = Math.random,
    ) {
        this.melee = new MeleeController(WEAPONS[0]);
    }

    private get bowWeapon(): WeaponDef {
        return this.weapon.family === "bow" ? this.weapon : WEAPONS.find((w) => w.family === "bow")!;
    }

    get weapon(): WeaponDef {
        return this.melee.weapon;
    }

    /** Cycles weapons by `step` (mouse wheel). Drops any swing in progress. */
    switchWeapon(step: number): void {
        if (step === 0) {
            return;
        }
        this.weaponIndex = (((this.weaponIndex + Math.sign(step)) % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
        this.melee.weapon = WEAPONS[this.weaponIndex];
        this.melee.cancel();
        this.bow.cancel();
    }

    /**
     * An NPC strike's impact (spec 16.5, 16.8). It lands if the player is within its range in front
     * of the attacker (`inCone`); a parry stance facing the attacker inside the weapon's parry cone
     * stops it unless it breaks parries. Damage: max(0, (7 + 2) × HitPow − 1); the hit pushes the
     * player 250 u/s away from the attacker.
     */
    receiveStrike(player: CombatPlayer, strike: IncomingStrike, inCone: boolean): StrikeReport {
        if (this.combatant.dead || strike.gap > strike.range || !inCone) {
            return { outcome: "miss", damage: 0, punch: 0 };
        }
        const dx = player.x - strike.fromX;
        const dy = player.y - strike.fromY;
        const d = Math.hypot(dx, dy) || 1;
        // Parry angle test (spec 6): the attack must come from the front within acos(parry_cos).
        const facing = (-Math.sin(player.yaw) * -dx + Math.cos(player.yaw) * -dy) / d;
        if (this.blocking && !strike.breaksParry && facing >= this.weapon.parryCos) {
            const report: StrikeReport = { outcome: "parried", damage: 0, punch: tuning.punchParrying };
            this.onStruck?.(report);
            return report;
        }
        const damage = npcStrikeDamage(strike.hitPow);
        this.combatant.hurt(damage, "flinch");
        const push = tuning.playerPushOnHit;
        player.applyImpulse((dx / d) * push, (dy / d) * push);
        if (this.combatant.reaction !== "flinch") {
            this.melee.cancel();
        }
        const report: StrikeReport = { outcome: "hit", damage, punch: tuning.punch };
        this.onStruck?.(report);
        return report;
    }

    update(dt: number, player: CombatPlayer, input: CombatInput): HitReport[] {
        this.combatant.update(dt);
        this.sinceAttack += dt;
        const reports: HitReport[] = [];
        if (this.combatant.dead) {
            this.melee.cancel();
            this.kick.cancel();
            this.blocking = false;
            return reports;
        }
        // Parry stance: only between swings, and never with the bow.
        this.blocking =
            !!input.blockDown && !this.melee.busy && !this.kick.active && this.weapon.family !== "bow";
        if (this.blocking) {
            this.melee.cancel();
            return reports;
        }
        if (this.melee.busy || this.kick.active || this.bow.state === "shooting") {
            this.sinceAttack = 0;
        }
        this.updateArrows(dt, player);
        if (this.weapon.family === "bow") {
            this.melee.cancel();
            // The bow's kick (layer_bow_kick_*) works like the melee kick (spec 7).
            if (input.kickPressed && player.grounded && this.bow.state === "idle") {
                this.kick.tryStart(player.stamina.value, player.pitch);
            }
            if (this.kick.active) {
                if (this.kick.update(dt)) {
                    this.resolveKick(player);
                }
                return reports;
            }
            const speed = Math.hypot(player.velocityX ?? 0, player.velocityY ?? 0);
            if (this.bow.update(dt, { attackDown: input.attackDown && !this.combatant.incapacitated, speed })) {
                const [swayYaw, swayPitch] = this.bow.sway(this.clock);
                this.arrows.push(
                    launchArrow(
                        { x: player.x, y: player.y, z: player.z + player.eyeHeight, plane: player.plane },
                        player.yaw + swayYaw,
                        player.pitch + swayPitch,
                    ),
                );
            }
            return reports;
        }
        this.bow.cancel();
        // F kicks (spec 7): only between swings, on the ground, with enough stamina.
        if (
            input.kickPressed &&
            !this.melee.busy &&
            !this.melee.isCharging &&
            player.grounded &&
            !this.combatant.incapacitated &&
            this.kick.tryStart(player.stamina.value, player.pitch)
        ) {
            this.melee.cancel();
        }
        if (this.kick.active) {
            if (this.kick.update(dt)) {
                this.resolveKick(player);
            }
            return reports;
        }
        const meleeInput: MeleeInput = {
            attackDown: input.attackDown && !this.combatant.incapacitated,
            attackPressed: !!input.attackPressed && !this.combatant.incapacitated,
            forward: input.forward,
            strafe: input.strafe,
            pitch: player.pitch,
            megasprinting: player.sprinting,
            airborne: !player.grounded,
            fallSpeed: Math.max(0, -player.verticalSpeed),
            aimingAtKnockedDown: this.aimingAtKnockedDown(player),
        };
        const events = this.melee.update(dt, meleeInput);
        const swing = this.melee.swing;
        if (events.started) {
            this.hitThisSwing.length = 0;
            for (let i = 0; i < events.started.hits.length; i++) {
                this.hitThisSwing.push(new Set());
            }
            if (events.started.lunge > 0) {
                player.applyImpulse(-Math.sin(player.yaw) * events.started.lunge, Math.cos(player.yaw) * events.started.lunge);
            }
        }
        const move = swing?.move ?? events.started;
        if (!move) {
            return reports;
        }
        const attacker = {
            x: player.x,
            y: player.y,
            eyeZ: player.z + player.eyeHeight,
            yaw: player.yaw,
            pitch: player.pitch,
            plane: player.plane,
        };
        const timeline = swing?.timeline ?? timelineFor(move, this.weapon.speed);
        for (const slice of events.active) {
            const hit = move.hits[slice.hitIndex];
            const seen = this.hitThisSwing[slice.hitIndex] ?? new Set();
            // The attack ray (spec 17.2): lines from the eye sweeping the move's 90° fan.
            const ray = rayFor(timeline, slice.hitIndex);
            for (const arcHit of traceRay(
                attacker,
                this.weapon.reach,
                ray,
                raySign(ray, hit.impact),
                slice.from,
                slice.to,
                this.bodies,
                this.flagsAt,
                seen,
            )) {
                const target = arcHit.body.owner;
                if (!target.attackable) {
                    continue;
                }
                const result = applyHit(
                    target.combatant,
                    this.weapon,
                    hit,
                    { unaware: !target.inCombat, hitbox: hitboxMultiplier(arcHit.height) },
                    this.random,
                );
                target.takeHit(arcHit.dirX, arcHit.dirY, result.push, player.x, player.y, hit.hitPow);
                this.melee.addAdrenaline(hit.adrenaline);
                const report = { target, result, move };
                reports.push(report);
                this.onHit?.(report);
            }
        }
        return reports;
    }

    /**
     * Arrows in flight (spec 16.4): an arrow hit does (0 + bow WDmg) × HitPow 1.5, ×3 on an unaware
     * target (the same damage path as melee), and gives 2 adrenaline.
     */
    private updateArrows(dt: number, player: CombatPlayer): void {
        this.clock += dt;
        if (this.arrows.length === 0) {
            return;
        }
        const ground = this.groundHeight ?? (() => -Infinity);
        for (const hit of stepArrows(this.arrows, dt, this.bodies, this.flagsAt, ground)) {
            const target = hit.body.owner;
            if (!target.attackable) {
                continue;
            }
            const b = hit.body;
            const height = b.height > 0 ? (hit.arrow.z - b.z) / b.height : 0.5;
            const result = applyHit(
                target.combatant,
                this.bowWeapon,
                ARROW_HIT,
                { unaware: !target.inCombat, hitbox: hitboxMultiplier(height) },
                this.random,
            );
            target.takeHit(hit.dirX, hit.dirY, result.push, player.x, player.y, ARROW_HIT.hitPow);
            this.melee.addAdrenaline(ARROW_HIT.adrenaline);
            const report = { target, result, move: ARROW_MOVE };
            this.onHit?.(report);
        }
    }

    /** The kick's hit event: trace, then push, dodge or miss; stamina 3 on an NPC, 1 otherwise. */
    private resolveKick(player: CombatPlayer): void {
        const trace = traceKick(
            { x: player.x, y: player.y, eyeZ: player.z + player.eyeHeight, yaw: player.yaw, pitch: player.pitch, plane: player.plane },
            this.bodies,
            this.flagsAt,
        );
        const target = trace?.body.owner;
        if (!trace || !target || !target.attackable) {
            player.stamina.spend(Math.min(player.stamina.value, tuning.kickStaminaOther));
            this.onKick?.({ outcome: "miss" });
            return;
        }
        player.stamina.spend(Math.min(player.stamina.value, target.kickCost ?? tuning.kickStaminaNpc));
        const outcome = target.kick(trace.dirX, trace.dirY, player.x, player.y);
        this.onKick?.({ target, outcome });
    }

    /** True if a knocked-down target lies within reach in front of the player. */
    private aimingAtKnockedDown(player: CombatPlayer): boolean {
        const found: Body<CombatTarget>[] = [];
        const r = this.weapon.reach;
        this.bodies.collectBodies(player.plane, player.x - r - 1, player.y - r - 1, player.x + r + 1, player.y + r + 1, found);
        const fx = -Math.sin(player.yaw);
        const fy = Math.cos(player.yaw);
        return found.some((b) => {
            const dx = b.x - player.x;
            const dy = b.y - player.y;
            const d = Math.hypot(dx, dy);
            return (
                b.owner.combatant.knockedDown &&
                d - b.radius <= r &&
                (d < 1e-6 || (dx * fx + dy * fy) / d > Math.cos(tuning.sideArc / 2))
            );
        });
    }
}
