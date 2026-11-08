import * as THREE from "three";

import type { NpcAppearanceInfo, NpcClip, NpcSpawnInfo } from "../world/NpcFormat";
import { CollisionFlag, RS_UNITS_PER_TILE } from "../world/WorldFormat";
import {
    CLIENT_CYCLE_SECONDS,
    ClipPlayback,
    advanceClip,
    frameAtCycle,
    orientationToYaw,
    writeFramePositions,
} from "./NpcAnimation";
import {
    FlagLookup,
    MAX_QUEUED_STEPS,
    Tile,
    WANDER_CHANCE,
    canStep,
    faceOrientation,
    findWanderPath,
    rotateTowards,
    stepOrientation,
    constrainMovementToEnvironment,
} from "./NpcMovement";
import { Body, computePush } from "../physics/Bodies";
import { sweepAxis } from "../physics/Sweep";
import { NpcCombatBrain } from "./NpcCombat";
import type { Box } from "../physics/TileColliders";
import { Combatant } from "../combat/Combatant";
import { tuning } from "../combat/tuning";
import { Knockback, deathLaunch, findSnapTile, massForce, slideSpeedForDistance, stepKnockback } from "./NpcPhysics";
import type { SharedNpcModel } from "./NpcModels";
import { NpcAttacker, StrikeEvent, attacksFromClips } from "./NpcAttacks";
import { canHear, canSee, hearingDelay, sightDelay } from "./NpcSenses";
import { Ragdoll, RagdollWorld, singlePartSkeleton } from "./Ragdoll";
import type { BodyHit } from "./BodyHits";
import { HitKind, HitReactions, bodyRig, movePoint } from "./HitPose";

/** Asks whether an NPC may move to a point (tiles); true means something is in the way. */
export type MoveBlocker = (npc: Npc, x: number, y: number) => boolean;

/** The parts of World an NPC needs. */
export type NpcWorld = {
    collisionFlags(plane: number, tileX: number, tileY: number): number;
    groundHeight(plane: number, x: number, y: number): number;
    renderLevel(plane: number, x: number, y: number): number;
    /** Used to drop knocked-back NPCs off upper floors; without it NPCs keep their plane. */
    hasFloor?(plane: number, x: number, y: number): boolean;
    isWater?(plane: number, x: number, y: number): boolean;
};

/** Fall damage when knocked off the edge of a floor. [data ai.DamageOnTriggerFall] */
const LEDGE_FALL_DAMAGE = 20;
/** Lean of the hit reactions (radians) and how fast poses ease (per second). [design] */
const LEAN = { flinch: 0.15, stagger: 0.3, push: 0.45, stun: 0.2 };
const POSE_RATE = 10;
/** Below this speed (tiles/s) a moving NPC plays its idle clip. */
const MOVING_SPEED = 0.15;
/** Sideways dodge distance (Dodge_left / Dodge_right move about 40 u). [data] */
const units40 = 40 * (1.25 / 61.065);

/** What an NPC sees of the player, and of the bodies around it. */
export type CombatContext = {
    player?: Body & {
        yaw: number;
        /** Crouching: NPCs use the stealth cone, range and delay (spec 16.7). */
        stealth?: boolean;
        /** Noise radius this update, tiles. */
        presence?: number;
        /** Seconds since the player last swung or shot (berserker trigger). */
        sincePlayerAttack?: number;
    };
    /** Appends bodies near a box (other NPCs, the player). */
    collect?: (plane: number, minX: number, minY: number, maxX: number, maxY: number, out: Body[]) => void;
    /** True if no wall blocks the segment on that plane. Without it, sight is never blocked. */
    lineOfSight?: (plane: number, x0: number, y0: number, x1: number, y1: number) => boolean;
    /** An NPC strike's impact event: the player decides whether it lands. */
    strike?: (npc: Npc, event: StrikeEvent) => void;
};

/** Which side of the NPC a hit came from. */
export type HitSide = "front" | "side" | "back";

/** Outcome of a kick on an NPC. */
export type KickOutcome = "dodged" | "hit";

/** Which tiles are covered by NPCs, so two NPCs never share a tile. */
export class Occupancy {
    private readonly counts = new Map<number, number>();

    private key(plane: number, x: number, y: number): number {
        return (plane * 8192 + x) * 16384 + y;
    }

    private forEachTile(x: number, y: number, size: number, fn: (x: number, y: number) => void) {
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                fn(x + i, y + j);
            }
        }
    }

    add(plane: number, x: number, y: number, size: number): void {
        this.forEachTile(x, y, size, (tx, ty) => {
            const key = this.key(plane, tx, ty);
            this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
        });
    }

    remove(plane: number, x: number, y: number, size: number): void {
        this.forEachTile(x, y, size, (tx, ty) => {
            const key = this.key(plane, tx, ty);
            const count = (this.counts.get(key) ?? 0) - 1;
            if (count > 0) {
                this.counts.set(key, count);
            } else {
                this.counts.delete(key);
            }
        });
    }

    isFree(plane: number, x: number, y: number, size: number): boolean {
        let free = true;
        this.forEachTile(x, y, size, (tx, ty) => {
            free &&= !this.counts.has(this.key(plane, tx, ty));
        });
        return free;
    }

    get size(): number {
        return this.counts.size;
    }
}

type NpcMesh = { mesh: THREE.Mesh; positions: THREE.BufferAttribute; sources: Uint16Array };

const DEFAULT_ROTATION_SPEED = 32;

/** One NPC in the world: a mesh whose vertices are animated by copying baked frames. */
export class Npc {
    readonly group = new THREE.Group();
    /** South-west tile on the server's grid. */
    tileX: number;
    tileY: number;
    /** Smooth client position in RS units (128 per tile) of the NPC's centre. */
    fineX: number;
    fineY: number;
    rotation: number;
    orientation: number;
    /** Collision cylinder, kept in sync with the drawn position. */
    readonly body: Body<Npc>;
    /** Current floor; starts at the spawn plane and changes when knocked off an edge. */
    plane: number;
    readonly combatant: Combatant;
    /** Set while knocked back: the NPC moves freely instead of along the tile grid. */
    knockback: Knockback | undefined;
    /** True once a dead NPC has sunk away; it no longer takes part in the world. */
    gone = false;
    /** True once hurt: the NPC fights (moves freely, off the tile grid) until it loses the player. */
    alerted = false;
    /** Current speed of free movement in tiles/s, for animation. */
    moveSpeed = 0;
    /** The body's ragdoll while knocked down or dead (spec 20). */
    ragdoll: Ragdoll | undefined;
    /** Seconds since death. */
    deadFor = 0;
    /** Ragdoll origin the meshes are drawn relative to (three.js world space). */
    private readonly ragdollAnchor = new THREE.Vector3();
    /** World position of every model vertex, from the ragdoll. */
    private ragdollPositions?: Float32Array;
    /** Blending from the ragdoll back into the animation after a knockdown: seconds so far. */
    private standingUp: { t: number; from: Float32Array } | undefined;
    private ragdollDrawn = false;
    /** Direction of the last hit taken, world tiles. */
    private lastHitX = 0;
    private lastHitY = 0;
    /** HitPow of the last hit taken: a killing blow's sets how far the body is thrown. */
    private lastHitPow = 1;
    /**
     * Knocked down by a kick, or by a body a kick sent flying, and not yet up: the body knocks
     * over the NPCs it flies into without hurting them.
     */
    kickedDown = false;
    /** Kicked since the last ragdoll started: the next one gets kickLift. */
    private kickLaunch = false;
    /** Position at the last update, for the velocity a ragdoll starts with. */
    private lastX = Number.NaN;
    private lastY = Number.NaN;
    private velocityX = 0;
    private velocityY = 0;

    private readonly spawn: Tile;
    private readonly environment: "water" | "land" | undefined;
    private readonly size: number;
    private readonly rotationSpeed: number;
    private readonly meshes: NpcMesh[] = [];
    private readonly steps: Tile[] = [];
    private serverPath: Tile[] = [];
    private readonly playback: ClipPlayback = { frame: 0, cycle: 0 };
    private walking = false;
    /** True while the last client cycle was blocked by the player. */
    private stalled = false;
    private holdTicks = 0;
    private clip: NpcClip | undefined;
    private dirty = true;
    private pitch = 0;
    private roll = 0;
    /** Lean direction of the current reaction: +1 back / -1 forward (pitch), ±1 sideways (roll). */
    private leanPitch = 0;
    private leanRoll = 0;
    /** Pose while lying: -π/2 on the back, +π/2 on the front. */
    private lyingPitch = -Math.PI / 2;
    private reactionClock = 0;
    private animCarry = 0;
    private loseTimer = 0;
    private kickDodgeChance = -1;
    private sinceKick = Infinity;
    private readonly brain: NpcCombatBrain;
    /** Melee attacks on the player (spec 16.6). */
    readonly attacker: NpcAttacker;
    /** Set for one update when this NPC turned hostile, so allies can be called (spec 16.7). */
    justAlerted = false;
    /** Seconds until a noticed player is reacted to, or -1 when nothing is noticed. */
    private noticeTimer = -1;
    private noticeBySight = false;
    /** Last place the player was seen or heard, and how long the NPC has been searching there. */
    private lastSeen: { x: number; y: number } | undefined;
    private searching = -1;
    private surprisedFor = 0;
    private sinceHit = Infinity;
    private readonly nearby: Body[] = [];
    private readonly push = { x: 0, y: 0 };
    /** Plane of the tiles this NPC holds in the occupancy map, or -1 for none. */
    private occupiedPlane: number;
    private readonly boxes: Box[] = [];
    /** Hit reactions drawn over the animation (absent for models without a skeleton). */
    private readonly reactions: HitReactions | undefined;
    private readonly partMotion: { q: Float32Array; t: Float32Array } | undefined;
    /** Where on the body (0 feet .. 1 head) the hit being taken struck. */
    private hitHeight = 0.5;

    constructor(
        readonly appearance: NpcAppearanceInfo,
        readonly info: NpcSpawnInfo,
        private readonly model: SharedNpcModel,
        materials: { opaque: THREE.Material; transparent: THREE.Material },
        private readonly world: NpcWorld,
        private readonly random: () => number,
    ) {
        this.size = Math.max(1, appearance.size);
        this.rotationSpeed = appearance.rotationSpeed ?? DEFAULT_ROTATION_SPEED;
        this.spawn = { x: info.x, y: info.y };
        this.environment = info.environment;
        this.tileX = info.x;
        this.tileY = info.y;
        this.fineX = info.x * RS_UNITS_PER_TILE + this.size * (RS_UNITS_PER_TILE / 2);
        this.fineY = info.y * RS_UNITS_PER_TILE + this.size * (RS_UNITS_PER_TILE / 2);
        this.rotation = this.orientation = info.orientation;
        this.plane = this.occupiedPlane = info.plane;
        this.combatant = new Combatant(
            Math.max(tuning.npcMinHealth, appearance.combatLevel * tuning.npcHealthPerLevel),
        );
        this.group.rotation.order = "YXZ";
        this.brain = new NpcCombatBrain(random);
        const attacks = model.data.attacks;
        this.attacker = new NpcAttacker(random, attacks ? attacksFromClips(attacks, model.height) : undefined);
        this.body = {
            x: this.fineX / RS_UNITS_PER_TILE,
            y: this.fineY / RS_UNITS_PER_TILE,
            z: 0,
            radius: this.size * 0.5 - 0.15,
            height: model.height,
            plane: info.plane,
            owner: this,
        };

        const level = world.renderLevel(info.plane, info.x, info.y);
        for (const shared of model.meshes) {
            const positions = new THREE.BufferAttribute(new Int16Array(shared.source.positions), 4);
            positions.setUsage(THREE.DynamicDrawUsage);
            // Depth bias plane bits, see the vertex shader.
            for (let i = 3; i < positions.array.length; i += 4) {
                positions.array[i] |= level << 13;
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute("a_position", positions);
            geometry.setAttribute("a_color", shared.colors);
            geometry.setAttribute("a_uv", shared.uvs);
            geometry.setIndex(shared.index);
            // There is no `position` attribute for three.js to measure, so supply culling bounds.
            const [cx, cy, cz, radius] = model.data.bounds;
            geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), radius);
            geometry.boundingBox = new THREE.Box3(
                new THREE.Vector3(cx - radius, cy - radius, cz - radius),
                new THREE.Vector3(cx + radius, cy + radius, cz + radius),
            );

            const mesh = new THREE.Mesh(
                geometry,
                shared.transparent ? materials.transparent : materials.opaque,
            );
            mesh.renderOrder = shared.transparent ? 2 : 1;
            this.group.add(mesh);
            this.meshes.push({ mesh, positions, sources: shared.source.sources });
        }
        const rig = bodyRig(model.data, () => this.basePositions());
        this.reactions = rig && new HitReactions(rig, random);
        this.partMotion = rig && { q: new Float32Array(rig.partCount * 4), t: new Float32Array(rig.partCount * 3) };

        this.clip = model.data.idle;
        if (this.clip && this.clip.frameLengths.length > 0) {
            // Start at a random point so NPCs of one kind are not in sync.
            this.playback.frame = Math.floor(random() * this.clip.frameLengths.length);
            this.playback.cycle = Math.floor(random() * this.clip.frameLengths[this.playback.frame]);
        }
    }

    /** True if the NPC offers an Attack option and is alive. */
    get attackable(): boolean {
        return !this.combatant.dead && (this.appearance.actions ?? []).some((a) => /^attack$/i.test(a));
    }

    /** True while the NPC is fighting (it has been attacked and still knows where the player is). */
    get inCombat(): boolean {
        return this.alerted;
    }

    /** Selects an animation clip and frame without running gameplay AI. */
    setVisualAnimation(pose: "idle" | "walk", frame = 0): void {
        const clip = pose === "walk" ? this.model.data.walk : this.model.data.idle;
        if (!clip || clip.frameLengths.length === 0) {
            throw new Error(`NPC ${this.appearance.id} has no ${pose} animation`);
        }
        this.clip = clip;
        this.playback.frame = Math.min(frame, clip.frameLengths.length - 1);
        this.playback.cycle = 0;
        this.animCarry = 0;
        this.dirty = true;
    }

    /** Advances the selected clip by client cycles without running NPC movement. */
    advanceVisualAnimation(cycles: number): number {
        if (!this.clip || !Number.isInteger(cycles) || cycles < 0) {
            return this.playback.frame;
        }
        advanceClip(this.playback, this.clip, cycles);
        this.dirty = true;
        return this.playback.frame;
    }

    get visualAnimationFrame(): number {
        return this.playback.frame;
    }

    setVisualYaw(degrees: number): void {
        this.orientation = ((degrees / 360) * 2048 + 2048) % 2048;
        this.rotation = this.orientation;
    }

    /** Mass for kicks: 80 for a one-tile NPC, growing with its footprint. [design] */
    get mass(): number {
        return tuning.npcBaseMass * this.size * this.size;
    }

    /** Unit vector the NPC faces, in world tiles (orientation 0 faces south). */
    private get forward(): { x: number; y: number } {
        const a = (this.rotation * Math.PI) / 1024;
        return { x: -Math.sin(a), y: -Math.cos(a) };
    }

    /** Cosine of the angle between where the NPC faces and the direction to (x, y). */
    facingCos(x: number, y: number): number {
        const f = this.forward;
        const dx = x - this.body.x;
        const dy = y - this.body.y;
        const d = Math.hypot(dx, dy) || 1;
        return (f.x * dx + f.y * dy) / d;
    }

    /** Which side a hit travelling along (dirX, dirY) strikes, relative to where the NPC faces. */
    hitSide(dirX: number, dirY: number): HitSide {
        const f = this.forward;
        // The hit travels away from the attacker: a frontal hit travels against the facing.
        const along = -(dirX * f.x + dirY * f.y);
        return along > 0.5 ? "front" : along < -0.5 ? "back" : "side";
    }

    private startFreeMove(occupancy?: Occupancy): void {
        if (occupancy) {
            this.releaseOccupancy(occupancy);
        }
        this.serverPath = [];
        this.steps.length = 0;
    }

    /** Slides the NPC along (dirX, dirY) far enough to travel `distance` tiles under friction. */
    private slide(dirX: number, dirY: number, distance: number, kicked = false): void {
        const speed = slideSpeedForDistance(distance);
        if (this.ragdoll) {
            // A body on the ground is shoved as a whole instead.
            this.ragdoll.addVelocity(dirX * speed, 0, -dirY * speed);
            return;
        }
        const k = this.knockback ?? { x: this.body.x, y: this.body.y, vx: 0, vy: 0, plane: this.plane };
        k.vx = dirX * speed;
        k.vy = dirY * speed;
        k.kicked = kicked || (k.kicked ?? false);
        this.knockback = k;
    }

    /** Sets the lean of a reaction from the side the hit came from. */
    private lean(dirX: number, dirY: number): void {
        this.lastHitX = dirX;
        this.lastHitY = dirY;
        const f = this.forward;
        const along = dirX * f.x + dirY * f.y; // > 0: pushed forward (hit from behind)
        const left = dirX * -f.y + dirY * f.x; // > 0: pushed to the NPC's left
        this.leanPitch = -along;
        this.leanRoll = left;
        this.lyingPitch = along > 0 ? Math.PI / 2 : -Math.PI / 2;
        this.combatant.standUpTime = along > 0 ? tuning.standUpFront : tuning.standUpBack;
        this.reactionClock = 0;
        const c = this.combatant;
        if (this.reactions && !c.dead && !c.knockedDown && c.reaction !== "standup") {
            // Every blow shows; the size follows the reaction the damage started (or kept).
            const kind: HitKind = c.reaction === "stagger" || c.reaction === "push" || c.reaction === "stun" ? c.reaction : "flinch";
            this.reactions.hit(kind, along, left, this.hitHeight);
        }
    }

    /**
     * Reacts to a hit travelling along (dirX, dirY) from an attacker at (fromX, fromY). `push` is the
     * damage result's push level (0 none, 1 medium, 2 long, 3 huge): the NPC slides as far as its
     * medium or long hit animation moves it (spec 5.3); a hit too light to push still shoves it a
     * little along (dirX, dirY), by `hitPow`. `height` is where the hit struck, 0 (feet) to 1 (top
     * of the head).
     */
    takeHit(dirX: number, dirY: number, push: number, fromX: number, fromY: number, hitPow = 1, height = 0.5): void {
        this.hitHeight = height;
        this.becomeAlerted(fromX, fromY);
        this.sinceHit = 0;
        this.lastHitPow = hitPow;
        if (this.combatant.dead) {
            this.kickedDown = false;
        }
        if (this.combatant.incapacitated || push > 0) {
            this.attacker.interrupt();
        }
        if (!this.combatant.dead) {
            this.faceTowards(fromX, fromY);
            this.rotation = this.orientation;
        }
        this.lean(dirX, dirY);
        if (push > 0) {
            const side = this.hitSide(dirX, dirY);
            const table = push >= 2 ? tuning.longHitDistance : tuning.mediumHitDistance;
            const distance = (table[side] * (push >= 3 ? 1.5 : 1)) / this.size;
            this.slide(dirX, dirY, distance);
        } else if (!this.combatant.dead) {
            // Killing blows are thrown by deathLaunch instead.
            this.slide(dirX, dirY, (tuning.hitNudge * Math.min(2, hitPow)) / this.size);
        }
    }

    /** True while the NPC blends from its ragdoll back into its animation. */
    get gettingUp(): boolean {
        return this.standingUp !== undefined;
    }

    /**
     * Knocked over by another NPC's flying body coming from (fromX, fromY) (spec 20.7): the NPC
     * falls onto a ragdoll of its own, moving on as the hit sent it, and gets up afterwards. The
     * hit never kills: it leaves at least 1 health. A body sent flying by a kick (`kicked`) does
     * no damage at all, and this NPC's body then passes that on to any it knocks over in turn.
     */
    hitByBody(hit: BodyHit, fromX: number, fromY: number, kicked = false): void {
        const c = this.combatant;
        const damage = kicked ? 0 : Math.min(hit.damage, Math.max(0, c.health - 1));
        c.hurt(damage, "knockdown", false, tuning.knockdownPhysics);
        this.takeHit(hit.dirX, hit.dirY, 0, fromX, fromY);
        this.kickedDown = kicked;
        const k = this.knockback ?? { x: this.body.x, y: this.body.y, vx: 0, vy: 0, plane: this.plane };
        k.vx = hit.dirX * hit.speed;
        k.vy = hit.dirY * hit.speed;
        this.knockback = k;
    }

    /**
     * A kick from (fromX, fromY) along (dirX, dirY) (spec 7). An NPC facing the kicker may dodge it
     * sideways; its chance starts at 0.2 and grows 0.3 with every kick. Otherwise it is knocked
     * down onto its ragdoll without damage [design], sent off as far as a long hit would push it
     * (scaled by mass), and gets up after knockdownKick. Its flying body knocks over the NPCs it
     * meets, harmlessly too.
     */
    kick(dirX: number, dirY: number, fromX: number, fromY: number): KickOutcome {
        const c = this.combatant;
        this.becomeAlerted(fromX, fromY);
        if (this.sinceKick > tuning.kickDodgeReset || this.kickDodgeChance < 0) {
            this.kickDodgeChance = tuning.kickDodgeInit;
        }
        this.sinceKick = 0;
        const chance = this.kickDodgeChance;
        this.kickDodgeChance = Math.min(1, this.kickDodgeChance + tuning.kickDodgeAdd);

        const f = this.forward;
        const tx = fromX - this.body.x;
        const ty = fromY - this.body.y;
        const d = Math.hypot(tx, ty) || 1;
        const facing = (f.x * tx + f.y * ty) / d;
        if (!c.incapacitated && facing > tuning.kickDodgeFacing && this.random() < chance) {
            // Dodge_left / Dodge_right: about 40 u sideways.
            const s = this.random() < 0.5 ? 1 : -1;
            this.slide((-ty / d) * s, (tx / d) * s, units40);
            this.faceTowards(fromX, fromY);
            return "dodged";
        }

        c.hurt(0, "knockdown", false, tuning.knockdownKick);
        this.attacker.interrupt();
        this.hitHeight = 0.55;
        this.lean(dirX, dirY);
        this.lastHitPow = 1;
        this.kickedDown = true;
        // A body already on the ground is shoved by the slide below instead.
        this.kickLaunch = !this.ragdoll;
        const reference = massForce(tuning.npcBaseMass) / tuning.npcBaseMass;
        const scale = Math.min(2, Math.max(0.2, massForce(this.mass) / this.mass / reference));
        this.slide(dirX, dirY, tuning.longHitDistance[this.hitSide(dirX, dirY)] * scale, true);
        return "hit";
    }

    /**
     * Every frame: hit reactions, knockback, combat movement, settling back onto the tile grid
     * and sinking away after death.
     */
    /**
     * Turns hostile towards the player at (x, y): leaves the tile grid and fights (spec 16.7).
     * Returns false if it already was.
     */
    becomeAlerted(x: number, y: number): boolean {
        this.lastSeen = { x, y };
        this.loseTimer = 0;
        this.searching = -1;
        this.noticeTimer = -1;
        if (this.alerted) {
            return false;
        }
        this.startFreeMove();
        this.alerted = true;
        this.justAlerted = true;
        return true;
    }

    /** Eye height in tiles above the ground. */
    private get eyeZ(): number {
        return this.body.z + this.body.height * 0.9;
    }

    /** Sight and hearing while calm (spec 16.7): noticing starts a reaction delay, then the NPC fights. */
    private perceive(dt: number, ctx: CombatContext): void {
        const player = ctx.player;
        if (!player || player.plane !== this.plane || !this.attackable || this.combatant.incapacitated) {
            this.noticeTimer = -1;
            return;
        }
        const x = this.body.x;
        const y = this.body.y;
        const d = Math.hypot(player.x - x, player.y - y);
        if (d > tuning.sightRange + 1) {
            this.noticeTimer = -1;
            return;
        }
        const f = this.forward;
        const sense = {
            x,
            y,
            eyeZ: this.eyeZ,
            facingX: f.x,
            facingY: f.y,
            alerted: false,
            playerX: player.x,
            playerY: player.y,
            playerZ: player.z,
            playerHeight: player.height,
            stealth: player.stealth ?? false,
            visibility: 1,
            presence: player.presence ?? 0,
            lineOfSight: ctx.lineOfSight?.(this.plane, x, y, player.x, player.y) ?? true,
        };
        const seen = canSee(sense);
        const heard = !seen && canHear(sense, player.z - this.body.z);
        if (this.noticeTimer < 0) {
            if (seen) {
                this.noticeTimer = sightDelay(d, sense.stealth);
                this.noticeBySight = true;
            } else if (heard) {
                this.noticeTimer = hearingDelay(sense.presence);
                this.noticeBySight = false;
            }
        }
        if (this.noticeTimer < 0) {
            return;
        }
        this.faceTowards(player.x, player.y);
        this.noticeTimer -= dt;
        if (this.noticeTimer > 0) {
            return;
        }
        // Heard only: turn hostile only once it can also see the player; until then it faces the noise.
        if (!seen && this.noticeBySight) {
            this.noticeTimer = -1;
            return;
        }
        this.becomeAlerted(player.x, player.y);
        if (seen && d < tuning.surprisedDistance) {
            // The "surprised" reaction: a step back, then the fight (mm_ai_dist_surprised).
            this.surprisedFor = tuning.surprisedTime;
            const back = d > 1e-6 ? { x: (x - player.x) / d, y: (y - player.y) / d } : { x: -f.x, y: -f.y };
            this.slide(back.x, back.y, tuning.surprisedStep);
        }
    }

    updateCombat(dt: number, occupancy: Occupancy, ctx: CombatContext = {}): void {
        const c = this.combatant;
        c.update(dt);
        if (this.reactions && !this.ragdoll) {
            this.reactions.setStunned(c.reaction === "stun");
            this.reactions.update(dt);
        }
        this.sinceKick += dt;
        this.sinceHit += dt;
        this.surprisedFor = Math.max(0, this.surprisedFor - dt);
        this.reactionClock += dt;
        if (!this.alerted && !c.dead && !this.knockback && !this.ragdoll) {
            this.perceive(dt, ctx);
        }
        const x = this.fineX / RS_UNITS_PER_TILE;
        const y = this.fineY / RS_UNITS_PER_TILE;
        if (dt > 0 && !Number.isNaN(this.lastX)) {
            this.velocityX = (x - this.lastX) / dt;
            this.velocityY = (y - this.lastY) / dt;
        }
        this.lastX = x;
        this.lastY = y;
        if (c.dead && !this.gone) {
            this.deadFor += dt;
            if (this.deadFor >= tuning.corpseTime) {
                this.removeCorpse(occupancy);
            }
        }
        if (this.alerted || this.knockback || this.ragdoll) {
            this.releaseOccupancy(occupancy);
        }

        // Knocked down or dead: the body is a ragdoll (spec 20).
        if ((c.dead || c.knockedDown) && !this.ragdoll && !this.gone) {
            this.startRagdoll();
        }
        if (this.ragdoll) {
            this.updateRagdoll(dt, occupancy);
            this.updatePose(dt);
            return;
        }

        this.moveSpeed = 0;
        const k = this.knockback;
        if (k) {
            const planeBefore = k.plane;
            const moving = stepKnockback(
                k,
                dt,
                this.body.radius,
                {
                    flagsAt: (plane, x, y) => this.world.collisionFlags(plane, x, y),
                    hasFloor: this.world.hasFloor?.bind(this.world),
                },
                this.boxes,
            );
            this.fineX = k.x * RS_UNITS_PER_TILE;
            this.fineY = k.y * RS_UNITS_PER_TILE;
            this.plane = k.plane;
            if (!c.dead && k.plane < planeBefore) {
                c.hurt(LEDGE_FALL_DAMAGE, "knockdown", false, tuning.knockdownFall);
            } else if (!c.dead && k.kicked && (k.impact ?? 0) >= tuning.wallSlamSpeed) {
                // Kicked into a wall: the game switches to a ragdoll and knocks the NPC down.
                c.hurt(tuning.wallSlamDamage, "knockdown", false, tuning.knockdownKick);
                k.vx = k.vy = 0;
            }
            if (!moving && !c.knockedDown) {
                this.knockback = undefined;
                if (!c.dead && !this.alerted) {
                    this.settle(occupancy);
                }
            }
        } else if (this.alerted && !c.dead) {
            this.fight(dt, occupancy, ctx);
        }
        if (this.reactions && !this.model.data.attacks) {
            // No attack animation in the cache: strikes play the generic lunge from Blender.
            const a = this.attacker.current;
            this.reactions.setLunge(a && { time: this.attacker.elapsed, hitTime: a.hitTimes[0], total: a.total });
        }

        this.updatePose(dt);
    }

    /** Free movement while fighting: the combat brain picks a velocity, walls and bodies stop it. */
    private fight(dt: number, occupancy: Occupancy, ctx: CombatContext): void {
        const player = ctx.player;
        const x = this.fineX / RS_UNITS_PER_TILE;
        const y = this.fineY / RS_UNITS_PER_TILE;
        // Spec 16.7: out of sight for 3 s → search the last known place for 10 s → calm again.
        const samePlane = !!player && player.plane === this.plane;
        const d = player ? Math.hypot(player.x - x, player.y - y) : Infinity;
        const f = this.forward;
        const sees =
            samePlane &&
            d <= tuning.loseDistance &&
            canSee({
                x,
                y,
                eyeZ: this.eyeZ,
                facingX: f.x,
                facingY: f.y,
                alerted: true,
                playerX: player!.x,
                playerY: player!.y,
                playerZ: player!.z,
                playerHeight: player!.height,
                stealth: player!.stealth ?? false,
                visibility: 1,
                presence: 0,
                lineOfSight: ctx.lineOfSight?.(this.plane, x, y, player!.x, player!.y) ?? true,
            });
        if (sees) {
            this.loseTimer = 0;
            this.searching = -1;
            this.lastSeen = { x: player!.x, y: player!.y };
        } else {
            this.loseTimer += dt;
        }
        if (this.loseTimer >= tuning.loseTime && this.searching < 0) {
            this.searching = 0;
            this.attacker.interrupt();
        }
        if (this.searching >= 0) {
            this.searching += dt;
            if (this.searching >= tuning.searchTime || !samePlane) {
                this.alerted = false;
                this.searching = -1;
                this.settle(occupancy);
                return;
            }
        }
        if (!player || !samePlane || this.combatant.incapacitated || this.surprisedFor > 0) {
            return;
        }
        // While searching, head for the last known position; otherwise for the player.
        const target = this.searching >= 0 && this.lastSeen ? this.lastSeen : player;
        const move = this.brain.update(dt, {
            x,
            y,
            playerX: target.x,
            playerY: target.y,
            playerYaw: player.yaw,
            healthFraction: this.combatant.healthFraction,
        });
        if (this.searching >= 0 && Math.hypot(target.x - x, target.y - y) < 0.5) {
            move.vx = move.vy = 0;
        }

        // Strikes (spec 16.6): only while fighting in sight; the lunge replaces the combat step.
        const gap = d - this.body.radius - player.radius;
        const strikes = this.attacker.update(
            dt,
            gap,
            player.sincePlayerAttack ?? 0,
            sees && move.mode === "fight" && this.sinceHit >= 1,
        );
        for (const event of strikes) {
            ctx.strike?.(this, event);
        }
        if (this.attacker.busy) {
            const tx = d > 1e-6 ? (player.x - x) / d : f.x;
            const ty = d > 1e-6 ? (player.y - y) / d : f.y;
            const lunge = gap > 0.05 ? this.attacker.lungeSpeed : 0;
            move.vx = tx * lunge;
            move.vy = ty * lunge;
            move.faceX = tx;
            move.faceY = ty;
        }
        this.orientation = faceOrientation(move.faceX, move.faceY);

        const flags = (plane: number, tx: number, ty: number) => this.world.collisionFlags(plane, tx, ty);
        const r = this.body.radius;
        let nx = sweepAxis(flags, this.plane, x, y, r, true, move.vx * dt, this.boxes);
        let ny = sweepAxis(flags, this.plane, nx, y, r, false, move.vy * dt, this.boxes);
        ({ x: nx, y: ny } = constrainMovementToEnvironment(x, y, nx, ny, (tx, ty) => this.matchesEnvironment(tx, ty)));
        // Never walk off the edge of an upper floor on purpose.
        if (this.plane > 0 && this.world.hasFloor && !this.world.hasFloor(this.plane, nx, ny)) {
            nx = x;
            ny = y;
        }
        // Keep out of the player and other NPCs.
        if (ctx.collect) {
            this.nearby.length = 0;
            ctx.collect(this.plane, nx - r - 1, ny - r - 1, nx + r + 1, ny + r + 1, this.nearby);
            const others = this.nearby.filter((b) => b !== this.body);
            if (computePush(nx, ny, this.body.z, r, this.body.height, others, -move.vx, -move.vy, this.push)) {
                nx = sweepAxis(flags, this.plane, nx, ny, r, true, this.push.x, this.boxes);
                ny = sweepAxis(flags, this.plane, nx, ny, r, false, this.push.y, this.boxes);
                ({ x: nx, y: ny } = constrainMovementToEnvironment(x, y, nx, ny, (tx, ty) => this.matchesEnvironment(tx, ty)));
            }
        }
        this.moveSpeed = dt > 0 ? Math.hypot(nx - x, ny - y) / dt : 0;
        this.fineX = nx * RS_UNITS_PER_TILE;
        this.fineY = ny * RS_UNITS_PER_TILE;
    }

    /** Eases the body towards the pose of the current reaction. */
    private updatePose(dt: number): void {
        const c = this.combatant;
        let pitch = 0;
        let roll = 0;
        if (c.dead || c.knockedDown) {
            pitch = this.lyingPitch;
        } else if (c.reaction === "standup") {
            pitch = this.lyingPitch * Math.max(0, c.reactionTime / c.standUpTime);
        } else if (c.reaction === "stun" && !this.reactions?.humanoid) {
            pitch = Math.sin(this.reactionClock * 3) * LEAN.stun * 0.5;
            roll = Math.sin(this.reactionClock * 2.1) * LEAN.stun;
        } else if (!this.reactions && (c.reaction === "flinch" || c.reaction === "stagger" || c.reaction === "push")) {
            // Bodies without parts can only lean as a whole.
            // Snap into the lean, then recover over the reaction.
            const amount = LEAN[c.reaction] * Math.min(1, this.reactionClock * 12) * Math.max(0, 1 - this.reactionClock / (c.reactionTime + this.reactionClock));
            pitch = this.leanPitch * amount;
            roll = this.leanRoll * amount;
        }
        const t = Math.min(1, dt * POSE_RATE);
        this.pitch += (pitch - this.pitch) * t;
        this.roll += (roll - this.roll) * t;
    }

    /** Physics world of the ragdoll. */
    private readonly ragdollWorld: RagdollWorld = {
        flagsAt: (plane, x, y) => this.world.collisionFlags(plane, x, y),
        groundHeight: (plane, x, y) => this.world.groundHeight(plane, x, y),
        hasFloor: (plane, x, y) => this.world.hasFloor?.(plane, x, y) ?? true,
    };

    /** Base-pose position of every model vertex: model space in three.js axes, tiles. */
    private basePositions(): Float32Array {
        const out = new Float32Array(this.model.data.vertexCount * 3);
        for (const shared of this.model.meshes) {
            const { positions, sources } = shared.source;
            for (let i = 0; i < sources.length; i++) {
                const v = sources[i];
                out[v * 3] = positions[i * 4] / RS_UNITS_PER_TILE;
                out[v * 3 + 1] = -positions[i * 4 + 1] / RS_UNITS_PER_TILE;
                out[v * 3 + 2] = -positions[i * 4 + 2] / RS_UNITS_PER_TILE;
            }
        }
        return out;
    }

    /**
     * World position (three.js) of every model vertex in the current animation frame, placed at
     * (px, py, pz) turned by `yaw` (or, without a position, where the group is drawn now).
     */
    private animatedWorldPositions(base: Float32Array, out: Float32Array, place?: { x: number; y: number; z: number; yaw: number }, posed = false): void {
        const count = this.model.data.vertexCount;
        const frame = this.clip ? this.clip.positions : undefined;
        const offset = this.clip ? this.playback.frame * count * 3 : 0;
        const motion = posed && this.reactions?.active ? this.reactionMotion() : undefined;
        let e: ArrayLike<number>;
        if (place) {
            const cos = Math.cos(place.yaw);
            const sin = Math.sin(place.yaw);
            e = [cos, 0, -sin, 0, 0, 1, 0, 0, sin, 0, cos, 0, place.x, place.y, place.z, 1];
        } else {
            this.group.updateMatrix();
            e = this.group.matrix.elements;
        }
        for (let v = 0; v < count; v++) {
            let x = frame ? frame[offset + v * 3] / RS_UNITS_PER_TILE : base[v * 3];
            let y = frame ? -frame[offset + v * 3 + 1] / RS_UNITS_PER_TILE : base[v * 3 + 1];
            let z = frame ? -frame[offset + v * 3 + 2] / RS_UNITS_PER_TILE : base[v * 3 + 2];
            if (motion) {
                [x, y, z] = movePoint(motion.q, motion.t, this.reactions!.rig.partOf[v], [x, y, z]);
            }
            out[v * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
            out[v * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
            out[v * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        }
    }

    /**
     * Knocked down or killed: the body becomes a ragdoll from its current pose, moving as the NPC
     * moved (mm_ragdollanimation_coeffvelocity 1) plus, on death, force_damage_death along the
     * killing blow (spec 20.1) and a launch along it sized by the blow (deathLaunch). The ragdoll
     * itself is untouched: only the velocity it starts with changes.
     */
    private startRagdoll(): void {
        const data = this.model.data;
        const base = this.basePositions();
        const current = new Float32Array(data.vertexCount * 3);
        // The body falls from the pose the hit threw it into.
        this.animatedWorldPositions(base, current, undefined, true);
        this.reactions?.clear();
        const skeleton = data.skeleton ?? singlePartSkeleton(base, data.vertexCount);
        const ragdoll = new Ragdoll(skeleton, base, current, this.mass, this.plane, [data.idle, data.walk], [data.opaque, data.transparent]);
        ragdoll.settleOnFloor(this.ragdollWorld);
        const k = this.knockback;
        const vx = k ? k.vx : this.velocityX;
        const vy = k ? k.vy : this.velocityY;
        ragdoll.setVelocity(vx, this.kickLaunch ? tuning.kickLift : 0, -vy);
        this.kickLaunch = false;
        if (this.combatant.dead) {
            ragdoll.applyImpulse(this.lastHitX * tuning.deathForce, 0, -this.lastHitY * tuning.deathForce);
            const launch = deathLaunch(this.lastHitX, this.lastHitY, this.lastHitPow, this.mass);
            ragdoll.addVelocity(launch.vx, launch.up, -launch.vy);
        }
        this.knockback = undefined;
        this.ragdoll = ragdoll;
        this.ragdollPositions = new Float32Array(data.vertexCount * 3);
        const [ax, ay, az] = ragdoll.rootPosition();
        this.ragdollAnchor.set(Math.round(ax), Math.round(ay), Math.round(az));
        this.ragdollDrawn = false;
        this.standingUp = undefined;
        this.pitch = this.roll = 0;
        for (const { mesh } of this.meshes) {
            // The vertices leave the model's culling sphere.
            mesh.frustumCulled = false;
        }
    }

    /** Steps the ragdoll; when a knockdown ends, the NPC gets up where its body lies. */
    private updateRagdoll(dt: number, occupancy: Occupancy): void {
        const ragdoll = this.ragdoll!;
        const c = this.combatant;
        if (this.standingUp) {
            this.standingUp.t += dt;
            if (c.dead) {
                this.standingUp = undefined;
                ragdoll.wake();
            } else if (c.reaction !== "standup") {
                this.endRagdoll(occupancy);
            }
            return;
        }
        ragdoll.step(dt, this.ragdollWorld);
        const [rx, , rz] = ragdoll.rootPosition();
        this.fineX = rx * RS_UNITS_PER_TILE;
        this.fineY = -rz * RS_UNITS_PER_TILE;
        this.plane = ragdoll.plane;
        if (!c.dead && !c.knockedDown) {
            // Stand up where the body lies, facing where its root part faces.
            const yaw = ragdoll.rootYaw();
            if (yaw !== undefined) {
                this.rotation = this.orientation = ((Math.round((-yaw * 1024) / Math.PI) % 2048) + 2048) % 2048;
            }
            ragdoll.computeWorld(this.ragdollWorld, this.ragdollPositions!);
            this.standingUp = { t: 0, from: Float32Array.from(this.ragdollPositions!) };
            if (c.reaction !== "standup") {
                this.endRagdoll(occupancy);
            }
        }
    }

    private endRagdoll(occupancy: Occupancy): void {
        this.ragdoll = undefined;
        this.standingUp = undefined;
        this.knockback = undefined;
        this.kickedDown = false;
        this.dirty = true;
        for (const { mesh } of this.meshes) {
            mesh.frustumCulled = true;
        }
        if (!this.alerted) {
            this.settle(occupancy);
        }
    }

    /** Removes a corpse from the world (after corpseTime, or to keep at most ragdollMax). */
    removeCorpse(occupancy: Occupancy): void {
        this.gone = true;
        this.group.visible = false;
        this.ragdoll = undefined;
        this.releaseOccupancy(occupancy);
    }

    /** Draws the ragdoll (or the blend from it into the animation while standing up). */
    private drawRagdoll(): void {
        const ragdoll = this.ragdoll!;
        const positions = this.ragdollPositions!;
        if (ragdoll.asleep && this.ragdollDrawn && !this.standingUp) {
            return;
        }
        if (this.standingUp) {
            const x = this.fineX / RS_UNITS_PER_TILE;
            const y = this.fineY / RS_UNITS_PER_TILE;
            const target = new Float32Array(positions.length);
            this.animatedWorldPositions(this.basePositions(), target, {
                x,
                y: this.world.groundHeight(this.plane, x, y),
                z: -y,
                yaw: orientationToYaw(this.rotation),
            });
            const a = Math.min(1, this.standingUp.t / Math.max(0.01, this.combatant.standUpTime));
            const s = a * a * (3 - 2 * a);
            const from = this.standingUp.from;
            for (let i = 0; i < positions.length; i++) {
                positions[i] = from[i] + (target[i] - from[i]) * s;
            }
        } else {
            ragdoll.computeWorld(this.ragdollWorld, positions);
        }
        const a = this.ragdollAnchor;
        for (const { positions: attribute, sources } of this.meshes) {
            const array = attribute.array as Int16Array;
            for (let i = 0; i < sources.length; i++) {
                const v = sources[i] * 3;
                array[i * 4] = Math.round((positions[v] - a.x) * RS_UNITS_PER_TILE);
                array[i * 4 + 1] = Math.round(-(positions[v + 1] - a.y) * RS_UNITS_PER_TILE);
                array[i * 4 + 2] = Math.round(-(positions[v + 2] - a.z) * RS_UNITS_PER_TILE);
            }
            attribute.needsUpdate = true;
        }
        this.ragdollDrawn = true;
    }

    /** Takes the nearest free tile after free movement and walks onto its centre. */
    private settle(occupancy: Occupancy): void {
        this.releaseOccupancy(occupancy);
        const tile = findSnapTile(
            this.fineX / RS_UNITS_PER_TILE,
            this.fineY / RS_UNITS_PER_TILE,
            this.size,
            this.plane,
            (plane, tx, ty) => this.world.collisionFlags(plane, tx, ty),
            (plane, tx, ty, size) => occupancy.isFree(plane, tx, ty, size),
        );
        this.tileX = tile.x;
        this.tileY = tile.y;
        this.occupiedPlane = this.plane;
        occupancy.add(this.plane, tile.x, tile.y, this.size);
        this.steps.length = 0;
        this.steps.push({ x: tile.x, y: tile.y });
    }

    /** Removes this NPC from the occupancy map (death, unload). Safe to call twice. */
    releaseOccupancy(occupancy: Occupancy): void {
        if (this.occupiedPlane >= 0) {
            occupancy.remove(this.occupiedPlane, this.tileX, this.tileY, this.size);
            this.occupiedPlane = -1;
        }
    }

    /** True if this NPC can wander (has a walk animation). */
    get canWalk(): boolean {
        return this.model.data.walk !== undefined;
    }

    private matchesEnvironment(x: number, y: number): boolean {
        if (!this.environment || !this.world.isWater) {
            return true;
        }
        const isWater = this.world.isWater(this.plane, x, y);
        return this.environment === "water" ? isWater : !isWater;
    }

    /** Once per server tick (600 ms): maybe pick a wander target, then take one step. */
    serverTick(
        occupancy: Occupancy,
        random: () => number,
    ): void {
        if (this.gone || this.combatant.dead || this.knockback || this.alerted || this.combatant.incapacitated) {
            return;
        }
        if (this.holdTicks > 0) {
            this.holdTicks--;
            return;
        }
        if (this.stalled) {
            return;
        }
        const plane = this.plane;
        const flags: FlagLookup = (x, y) => this.world.collisionFlags(plane, x, y);

        if (
            this.canWalk &&
            random() < WANDER_CHANCE
        ) {
            const target = {
                x: this.spawn.x + Math.round(random() * 10 - 5),
                y: this.spawn.y + Math.round(random() * 10 - 5),
            };
            this.serverPath = findWanderPath(
                flags,
                { x: this.tileX, y: this.tileY },
                target,
                this.size,
                this.spawn,
                (tile) => this.matchesEnvironment(tile.x, tile.y),
            );
        }

        const next = this.serverPath.shift();
        if (!next) {
            return;
        }
        const dx = Math.sign(next.x - this.tileX);
        const dy = Math.sign(next.y - this.tileY);
        occupancy.remove(plane, this.tileX, this.tileY, this.size);
        if (
            this.steps.length < MAX_QUEUED_STEPS &&
            canStep(flags, this.tileX, this.tileY, dx, dy, this.size) &&
            this.matchesEnvironment(next.x, next.y) &&
            occupancy.isFree(plane, next.x, next.y, this.size)
        ) {
            this.tileX = next.x;
            this.tileY = next.y;
            this.steps.push({ x: next.x, y: next.y });
        } else {
            this.serverPath = [];
        }
        occupancy.add(plane, this.tileX, this.tileY, this.size);
    }

    /** Stops wandering for a number of server ticks (an NPC that is being talked to). */
    hold(ticks: number): void {
        this.serverPath = [];
        this.holdTicks = ticks;
    }

    /** Turns to look at a point in world tiles. */
    faceTowards(x: number, y: number): void {
        this.orientation = faceOrientation(
            x - this.fineX / RS_UNITS_PER_TILE,
            y - this.fineY / RS_UNITS_PER_TILE,
        );
    }

    /** Client cycle while moving freely: turn, and play the walk clip at a speed-matched rate. */
    private freeCycle(): void {
        this.rotation = rotateTowards(this.rotation, this.orientation, this.rotationSpeed);
        // A strike shows its own animation, frame for frame with the attack's clock, so the blow
        // lands on the clip's impact frame.
        const attack = this.attacker.current;
        const attackClip = attack?.clip !== undefined ? this.model.data.attacks?.[attack.clip] : undefined;
        if (attackClip) {
            const frame = frameAtCycle(attackClip, this.attacker.elapsed / CLIENT_CYCLE_SECONDS);
            if (attackClip !== this.clip || frame !== this.playback.frame) {
                this.clip = attackClip;
                this.playback.frame = frame;
                this.playback.cycle = 0;
                this.animCarry = 0;
                this.dirty = true;
            }
            return;
        }
        const walk = this.model.data.walk;
        const moving = !this.knockback && this.moveSpeed > MOVING_SPEED && walk !== undefined;
        const clip = moving ? walk : this.model.data.idle;
        if (clip !== this.clip) {
            this.clip = clip;
            this.playback.frame = 0;
            this.playback.cycle = 0;
            this.animCarry = 0;
            this.dirty = true;
        }
        const rate = moving ? Math.min(2.5, Math.max(0.4, this.moveSpeed / tuning.clipWalkSpeed)) : 1;
        this.animCarry += rate;
        const cycles = Math.floor(this.animCarry);
        this.animCarry -= cycles;
        if (this.clip && cycles > 0 && advanceClip(this.playback, this.clip, cycles)) {
            this.dirty = true;
        }
    }

    /** Once per 20 ms client cycle: move towards queued steps, turn, animate. */
    clientCycle(blocker?: MoveBlocker): void {
        const half = this.size * (RS_UNITS_PER_TILE / 2);
        const wasWalking = this.walking;
        if (this.alerted || this.knockback) {
            this.freeCycle();
            return;
        }
        const frozen = this.combatant.incapacitated;
        const hasSteps = this.steps.length > 0 && !frozen;
        this.stalled = false;

        if (hasSteps) {
            const next = this.steps[0];
            const nextX = next.x * RS_UNITS_PER_TILE + half;
            const nextY = next.y * RS_UNITS_PER_TILE + half;
            this.orientation = stepOrientation(
                Math.sign(nextX - this.fineX),
                Math.sign(nextY - this.fineY),
            );

            let newX = nextX;
            let newY = nextY;
            if (Math.abs(nextX - this.fineX) <= 256 && Math.abs(nextY - this.fineY) <= 256) {
                let speed = 4;
                if (this.rotation !== this.orientation && this.rotationSpeed !== 0) {
                    speed = 2;
                }
                if (this.steps.length > 2) {
                    speed = 6;
                }
                if (this.steps.length > 3) {
                    speed = 8;
                }
                newX = this.fineX + Math.sign(nextX - this.fineX) * Math.min(speed, Math.abs(nextX - this.fineX));
                newY = this.fineY + Math.sign(nextY - this.fineY) * Math.min(speed, Math.abs(nextY - this.fineY));
            }
            // else: too far behind (a long frame), catch up.

            if (blocker?.(this, newX / RS_UNITS_PER_TILE, newY / RS_UNITS_PER_TILE)) {
                this.stalled = true;
            } else {
                this.fineX = newX;
                this.fineY = newY;
                if (this.fineX === nextX && this.fineY === nextY) {
                    this.steps.shift();
                }
            }
        }
        this.walking = hasSteps && !this.stalled;

        this.rotation = rotateTowards(this.rotation, this.orientation, this.rotationSpeed);

        const walk = this.model.data.walk;
        const clip = this.walking && walk ? walk : this.model.data.idle;
        if (clip !== this.clip || wasWalking !== this.walking) {
            if (clip !== this.clip) {
                this.playback.frame = 0;
                this.playback.cycle = 0;
            }
            this.clip = clip;
            this.dirty = true;
        }
        if (this.clip && advanceClip(this.playback, this.clip, 1)) {
            this.dirty = true;
        }
    }

    /** Applies the current position, rotation and animation frame to the meshes. */
    sync(): void {
        const x = this.fineX / RS_UNITS_PER_TILE;
        const y = this.fineY / RS_UNITS_PER_TILE;
        const ground = this.world.groundHeight(this.plane, x, y);
        this.body.x = x;
        this.body.y = y;
        this.body.z = ground;
        this.body.plane = this.plane;
        if (this.ragdoll) {
            // Vertices are written in world space relative to the anchor.
            this.group.position.copy(this.ragdollAnchor);
            this.group.rotation.set(0, 0, 0);
            this.drawRagdoll();
            this.dirty = true;
            return;
        }
        this.group.position.set(x, ground, -y);
        this.group.rotation.y = orientationToYaw(this.rotation);
        this.group.rotation.x = this.pitch;
        this.group.rotation.z = this.roll;

        const reacting = this.reactions?.active ?? false;
        if ((this.dirty || reacting) && this.clip) {
            const motion = reacting ? this.reactionMotion() : undefined;
            const partOf = this.reactions?.rig.partOf;
            for (const { positions, sources } of this.meshes) {
                const array = positions.array as Int16Array;
                writeFramePositions(array, sources, this.clip.positions, this.playback.frame, this.model.data.vertexCount);
                if (motion && partOf) {
                    for (let i = 0; i < sources.length; i++) {
                        const o = i * 4;
                        const [x, y, z] = movePoint(motion.q, motion.t, partOf[sources[i]], [
                            array[o] / RS_UNITS_PER_TILE,
                            -array[o + 1] / RS_UNITS_PER_TILE,
                            -array[o + 2] / RS_UNITS_PER_TILE,
                        ]);
                        array[o] = Math.round(x * RS_UNITS_PER_TILE);
                        array[o + 1] = Math.round(-y * RS_UNITS_PER_TILE);
                        array[o + 2] = Math.round(-z * RS_UNITS_PER_TILE);
                    }
                }
                positions.needsUpdate = true;
            }
        }
        this.dirty = false;
    }

    /** Each body part's motion for the hit reaction now, about its joints in the drawn frame. */
    private reactionMotion(): { q: Float32Array; t: Float32Array } {
        this.reactions!.motion(this.clip, this.playback.frame, this.partMotion!);
        return this.partMotion!;
    }

    dispose(): void {
        for (const { mesh } of this.meshes) {
            mesh.geometry.dispose();
        }
        this.group.removeFromParent();
    }
}
