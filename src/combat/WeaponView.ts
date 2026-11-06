import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import type { KickController } from "./Kick";
import type { MeleeController } from "./MeleeController";
import { MoveDef, Ray, Timeline, rayFor, timelineFor } from "./moves";
import { ViewDir, rayDirection, raySign } from "./SwingRay";
import { tuning } from "./tuning";
import { createPlaceholderWeapon } from "./PlaceholderWeapons";
import type { WeaponDef } from "./weapons";

/** Position (camera space, tiles) and orientation of the held weapon. */
type Pose = { pos: THREE.Vector3; quat: THREE.Quaternion };

/** A pose from a position and YXZ Euler angles (radians). */
function euler(px: number, py: number, pz: number, rx: number, ry: number, rz: number): Pose {
    return {
        pos: new THREE.Vector3(px, py, pz),
        quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "YXZ")),
    };
}

const REST = euler(0.24, -0.3, -0.42, -0.95, 0, -0.25);
const CHARGE = euler(0.32, -0.05, -0.32, 0.2, -0.5, -0.6);
/** Distance of the grip from the eye along the attack ray while it sweeps. [design] */
const SWING_RADIUS = 0.45;
/** Pulled back along the ray while winding up or before a thrust. [design] */
const WINDUP_RADIUS = 0.22;
/** The weapon sits a little below the eye so the blade stays in view. [design] */
const GRIP_DROP = -0.12;
const KICK_ASIDE = euler(0.42, -0.45, -0.35, -0.6, -0.3, -0.6);
/** Blade held across the view in the parry stance. [design] */
const PARRY = euler(0.05, -0.12, -0.4, -0.2, 0, -1.45);
/** Bow held low, then raised and drawn in front of the eye. [design] */
const BOW_REST = euler(0.2, -0.35, -0.5, -0.3, 0.3, 0.4);
const BOW_DRAWN = euler(0.02, -0.08, -0.55, 0, 0, 0.15);

/** Placeholder boot for the first-person kick: shin, foot and sole, toes pointing -Z. */
function createBoot(): THREE.Group {
    const boot = new THREE.Group();
    const leather = new THREE.MeshStandardMaterial({ color: 0x3b2618, roughness: 0.9 });
    const sole = new THREE.MeshStandardMaterial({ color: 0x1c140e, roughness: 1 });
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.4, 0.13), leather);
    shin.position.set(0, 0.2, 0.05);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.3), leather);
    foot.position.set(0, 0.0, -0.08);
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.31), sole);
    bottom.position.set(0, -0.07, -0.08);
    boot.add(shin, foot, bottom);
    boot.name = "kick_boot";
    return boot;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Accelerating from rest: the last stretch of a wind-up, speeding into the strike. */
const easeIn = (t: number) => t * t;
/** Decelerating to rest: a follow-through bleeding off the strike's speed. */
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
function lerpPose(a: Pose, b: Pose, t: number, ease: (t: number) => number = smooth): Pose {
    const s = ease(clamp01(t));
    return { pos: a.pos.clone().lerp(b.pos, s), quat: a.quat.clone().slerp(b.quat, s) };
}

/** Wind-ups draw the blade this far (fraction of the fan) back past where its ray starts. [design] */
const ANTICIPATION = 0.15;
/** Part of a wind-up spent drawing back; the rest accelerates forward into the ray's start. [design] */
const COCK_SHARE = 0.7;
/** The blade carries on this far (fraction of the fan) past the ray's end before returning. [design] */
const FOLLOW_THROUGH = 0.18;
/** Longest follow-through, seconds; it takes at most 40% of the gap to the next ray or rest. [design] */
const FOLLOW_TIME = 0.12;
/** Time after a ray needed for the full follow-through; with less, it carries on less far. [design] */
const FOLLOW_ROOM = 0.3;
/** The arm extends through the middle of a sweep and bends at its ends (grip travel, tiles). [design] */
const ARC_BULGE = 0.14;
/** The tip trails the hand early in a sweep and whips ahead of it late (fraction of the fan). [design] */
const WRIST_WHIP = 0.08;
/** How much of the sweep's even speed is reshaped into accelerate-then-decelerate. [design] */
const SWEEP_EASE = 0.4;
/** Visual freeze of the blade when a strike lands, seconds at full strength. [design] */
const HITSTOP = 0.07;
/** Camera turn towards the blade and lean into its travel at mid-sweep, radians. [design] */
const VIEW_FOLLOW = 0.035;
const VIEW_LEAN = 0.03;
/** Camera shake on impact, radians at full strength, and how fast it dies out (1/s). [design] */
const IMPACT_SHAKE = 0.012;
const SHAKE_DECAY = 14;
/** Tremble of the blade while a charged power attack is held, tiles. [design] */
const CHARGE_TREMBLE = 0.004;

/** Camera rotation offsets (radians) the swing adds on top of the player's view. */
export type ViewOffset = { pitch: number; yaw: number; roll: number };

/** View-space ray direction (x right, y up, z forward) to camera space (−Z forward). */
const toCamera = (d: ViewDir) => new THREE.Vector3(d.x, d.y, -d.z);

/** Where the hand sits (camera space) when the arm is not extended. [design] */
const HAND = new THREE.Vector3(0.14, -0.3, -0.05);
/** The blade aims at this far point on the attack ray. [design] */
const AIM_DISTANCE = 1.1;
/** The hand is never closer to the eye than this along the view (tiles). [design] */
const MIN_REACH = 0.3;

/**
 * The blade on the attack ray (spec 17.2) at progress `t`: the hand moves `radius` out along the
 * ray from its rest spot, and the blade (+Y) points from the hand at the ray's far point, edge (+Z)
 * facing the way the fan sweeps. The drawn tip therefore follows the lines the hit test traces,
 * while the blade stays visible instead of end-on. A thrust's edge faces down.
 */
function rayPose(ray: Ray, sign: number, t: number, radius = SWING_RADIUS, aimT = t): Pose {
    const dir = toCamera(rayDirection(ray, sign, t));
    const hand = HAND.clone().addScaledVector(dir, radius);
    hand.y += GRIP_DROP + 0.12;
    // Reaching across the body (rays starting on the left), the hand still stays out in front.
    hand.z = Math.min(hand.z, -MIN_REACH);
    const aim = aimT === t ? dir : toCamera(rayDirection(ray, sign, aimT));
    // A thrust aims well past the outstretched hand, so the point drives straight ahead.
    const aimDistance = ray.sweep === 0 ? radius + AIM_DISTANCE : AIM_DISTANCE;
    const blade = aim.clone().multiplyScalar(aimDistance).sub(hand).normalize();
    // `t` may run past the fan (anticipation, follow-through); the sweep direction stays the same.
    const ahead = toCamera(rayDirection(ray, sign, t + 0.02));
    const behind = toCamera(rayDirection(ray, sign, t - 0.02));
    let edge = ahead.sub(behind);
    edge.addScaledVector(blade, -edge.dot(blade));
    if (ray.sweep === 0 || edge.lengthSq() < 1e-8) {
        edge = new THREE.Vector3(0, -1, 0).addScaledVector(blade, blade.y);
    }
    edge.normalize();
    const side = new THREE.Vector3().crossVectors(blade, edge);
    const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, blade, edge));
    return { pos: hand, quat };
}

/** The grip's distance along the ray at sweep progress `p`: arm bent at the ends, extended mid-sweep. */
const arcRadius = (p: number) => SWING_RADIUS - ARC_BULGE / 2 + ARC_BULGE * Math.sin(Math.PI * clamp01(p));

/** Even sweep progress reshaped so the blade speeds up into the middle of the fan and slows after. */
const sweepEase = (p: number) => lerp(p, smooth(p), SWEEP_EASE);

/** A sweep at progress `p`, with the arm's arc and the wrist's lag-then-whip. */
function sweepPose(ray: Ray, sign: number, p: number): Pose {
    return rayPose(ray, sign, p, arcRadius(p), p + WRIST_WHIP * (2 * p - 1));
}

/** A thrust at progress `p`: driven out from the cocked grip to full extension. */
function thrustPose(ray: Ray, sign: number, p: number): Pose {
    return rayPose(ray, sign, 0, lerp(WINDUP_RADIUS, SWING_RADIUS + 0.25, easeOut(clamp01(p))));
}

/** Cocked: drawn back past the ray's start, arm bent (a thrust: pulled straight back, close in). */
function cockedPose(ray: Ray, sign: number): Pose {
    return ray.sweep === 0 ? rayPose(ray, sign, 0, WINDUP_RADIUS - 0.1) : rayPose(ray, sign, -ANTICIPATION, WINDUP_RADIUS);
}

/**
 * Past the ray's end: the blade carried on by its momentum, arm folding back in. `amount` (0..1)
 * shortens it when little time is left, so a quick strike's short recovery does not snap back.
 */
function followPose(ray: Ray, sign: number, amount: number): Pose {
    const over = FOLLOW_THROUGH * amount;
    return ray.sweep === 0
        ? rayPose(ray, sign, 0, SWING_RADIUS + 0.25 - 0.1 * amount)
        : rayPose(ray, sign, 1 + over, arcRadius(1) - 0.05 * amount, 1 + over + WRIST_WHIP);
}

/** Wind-up: the blade drawn back past where its first ray starts (a thrust: drawn straight back). */
function windupPose(move: MoveDef, timeline: Timeline): Pose {
    const ray = rayFor(timeline, 0);
    return cockedPose(ray, raySign(ray, move.hits[0].impact));
}

/**
 * The weapon in the player's hand. In first person it hangs off the camera and is posed from the
 * melee timeline; in third person it sits in the avatar's right-hand socket. A glTF at
 * models/weapons/<id>.glb replaces the placeholder when it exists.
 */
export class WeaponView {
    private readonly holder = new THREE.Group();
    private readonly models = new Map<string, THREE.Object3D>();
    private readonly loading = new Set<string>();
    private current: THREE.Object3D | undefined;
    private currentId = "";
    private readonly boot = createBoot();
    /** Added to the first-person camera's rotation: the view following the swing and shaking on impact. */
    readonly viewOffset: ViewOffset = { pitch: 0, yaw: 0, roll: 0 };
    /** Seconds the drawn swing runs behind the real one (hit-stop); it catches up at double speed. */
    private lag = 0;
    private freeze = 0;
    private shake = 0;
    private clock = 0;

    constructor(
        private readonly camera: THREE.Camera,
        private readonly baseUrl: string,
        private readonly handSocket?: THREE.Object3D,
    ) {
        this.holder.rotation.order = "YXZ";
        camera.add(this.holder);
        this.boot.visible = false;
        camera.add(this.boot);
    }

    private modelFor(weapon: WeaponDef): THREE.Object3D {
        let model = this.models.get(weapon.id);
        if (!model) {
            model = createPlaceholderWeapon(weapon);
            this.models.set(weapon.id, model);
            this.tryLoadGltf(weapon);
        }
        return model;
    }

    private tryLoadGltf(weapon: WeaponDef): void {
        if (this.loading.has(weapon.id)) {
            return;
        }
        this.loading.add(weapon.id);
        const url = `${this.baseUrl}models/weapons/${weapon.id}.glb`;
        void (async () => {
            const response = await fetch(url);
            const type = response.headers.get("content-type") ?? "";
            // Vite answers missing files with index.html, so check the type as well.
            if (!response.ok || type.includes("text/html")) {
                return;
            }
            const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), "");
            const old = this.models.get(weapon.id);
            this.models.set(weapon.id, gltf.scene);
            if (old && old === this.current) {
                this.attach(gltf.scene);
            }
        })().catch((e) => console.warn(`Weapon model ${url} could not be loaded`, e));
    }

    private attach(model: THREE.Object3D): void {
        this.current?.removeFromParent();
        this.current = model;
        this.holder.add(model);
    }

    /** A melee strike landed: the blade stalls in the target for a moment and the view jolts. 0..1. */
    impact(strength: number): void {
        this.freeze = Math.max(this.freeze, HITSTOP * strength);
        this.shake = Math.max(this.shake, strength);
    }

    update(
        melee: MeleeController,
        mode: "first" | "third",
        visible: boolean,
        kick?: KickController,
        extra: { dt?: number; bowDraw?: number; blocking?: boolean } = {},
    ): void {
        const dt = extra.dt ?? 0;
        this.clock += dt;
        if (this.freeze > 0) {
            this.freeze = Math.max(0, this.freeze - dt);
            this.lag += dt;
        } else {
            this.lag = Math.max(0, this.lag - dt);
        }
        this.viewOffset.pitch = this.viewOffset.yaw = this.viewOffset.roll = 0;
        this.updateBoot(mode === "first" && visible ? kick : undefined);
        const weapon = melee.weapon;
        if (weapon.id !== this.currentId) {
            this.currentId = weapon.id;
            this.attach(this.modelFor(weapon));
        }
        const firstPerson = mode === "first";
        const parent = firstPerson ? this.camera : this.handSocket;
        if (!parent || !visible) {
            this.holder.visible = false;
            return;
        }
        this.holder.visible = true;
        if (this.holder.parent !== parent) {
            parent.add(this.holder);
        }
        if (!firstPerson) {
            // The avatar has no attack clips: hold the weapon still in the hand.
            this.holder.position.set(0, 0, 0);
            this.holder.rotation.set(Math.PI / 2, 0, 0);
            return;
        }
        let pose =
            weapon.family === "bow"
                ? lerpPose(BOW_REST, BOW_DRAWN, extra.bowDraw ?? 0)
                : extra.blocking
                  ? PARRY
                  : this.pose(melee);
        if (kick?.active) {
            // Pull the weapon aside while kicking.
            pose = lerpPose(pose, KICK_ASIDE, Math.min(1, (kick.elapsed ?? 0) / 0.1));
        }
        this.holder.position.copy(pose.pos);
        this.holder.quaternion.copy(pose.quat);
        if (this.freeze > 0) {
            // Stuck in the target: a fine judder rather than a dead stop.
            this.holder.position.x += Math.sin(this.clock * 190) * 0.004;
            this.holder.position.y += Math.cos(this.clock * 170) * 0.004;
        } else if (melee.isCharging) {
            // Muscles straining against the held power attack.
            this.holder.position.x += Math.sin(this.clock * 31) * CHARGE_TREMBLE;
            this.holder.position.y += Math.sin(this.clock * 23 + 1) * CHARGE_TREMBLE;
        }
        // Impact jolt: a quick decaying shudder of the view.
        if (this.shake > 1e-3) {
            const a = this.shake * IMPACT_SHAKE;
            this.viewOffset.pitch += Math.sin(this.clock * 70) * a;
            this.viewOffset.yaw += Math.cos(this.clock * 55) * a * 0.6;
            this.viewOffset.roll += Math.sin(this.clock * 45) * a * 0.5;
            this.shake *= Math.exp(-SHAKE_DECAY * dt);
        } else {
            this.shake = 0;
        }
    }

    /** The boot rises from below into a forward stamp at the hit event, then drops away. */
    private updateBoot(kick: KickController | undefined): void {
        if (!kick?.active || kick.elapsed === undefined) {
            this.boot.visible = false;
            return;
        }
        this.boot.visible = true;
        const t = kick.elapsed;
        const hit = kick.hitTime;
        const out = t < hit ? t / hit : Math.max(0, 1 - (t - hit) / (tuning.kickDuration - hit));
        const s = smooth(Math.min(1, out));
        const lowY = kick.low ? -0.75 : -0.55;
        this.boot.position.set(0.12, lerp(-1.1, lowY, s), lerp(-0.2, -0.85, s));
        this.boot.rotation.set(lerp(0.6, -0.15, s), 0, 0);
    }

    /**
     * The weapon follows the move's attack rays (spec 17): from rest (or the charged wind-up) back
     * past the start of each ray, along the ray's fan while it traces, on past its end, then back
     * to rest.
     */
    private pose(melee: MeleeController): Pose {
        const swing = melee.swing;
        if (!swing) {
            const charged = melee.chargedMove;
            if (charged) {
                // The variant is locked: hold the blade drawn back where its swing will start.
                this.windupFrom = this.windupFrom ?? this.lastPose ?? REST;
                this.windupTime = Math.min(1, (this.windupTime ?? 0) + 1 / 12);
                return (this.lastPose = lerpPose(this.windupFrom, windupPose(charged, timelineFor(charged, melee.weapon.speed)), this.windupTime));
            }
            this.windupFrom = this.windupTime = undefined;
            return (this.lastPose = melee.chargeProgress > 0 ? lerpPose(REST, CHARGE, melee.chargeProgress) : REST);
        }
        this.windupFrom = this.windupTime = undefined;
        if (swing !== this.swingRef) {
            // A new swing starts from wherever the weapon was (rest, or a charged wind-up).
            this.swingRef = swing;
            this.swingStart = this.lastPose ?? REST;
            this.lag = this.freeze = 0;
        }
        this.lastPose = this.swingPose(swing);
        return this.lastPose;
    }

    /**
     * Each ray is struck like a real blow: drawn back past its start (anticipation), accelerated
     * into the fan, swept on an arm that extends mid-arc with the wrist whipping the tip through,
     * carried on past the end (follow-through), then brought back. The drawn swing runs `lag` behind
     * the real one so a landed strike can stall the blade; hit tracing is unaffected.
     */
    private swingPose(swing: NonNullable<MeleeController["swing"]>): Pose {
        const { move, timeline } = swing;
        const t = Math.max(0, swing.elapsed - this.lag);
        const end = timeline.windup + timeline.active + timeline.recovery;
        let before = this.swingStart ?? REST;
        let beforeTime = 0;
        for (let i = 0; i < move.hits.length; i++) {
            const ray = rayFor(timeline, i);
            const sign = raySign(ray, move.hits[i].impact);
            const thrust = ray.sweep === 0;
            const start = thrust ? thrustPose(ray, sign, 0) : sweepPose(ray, sign, 0);
            if (t < ray.on) {
                const u = (t - beforeTime) / Math.max(1e-6, ray.on - beforeTime);
                const cocked = cockedPose(ray, sign);
                return u < COCK_SHARE
                    ? lerpPose(before, cocked, u / COCK_SHARE, easeOut)
                    : lerpPose(cocked, start, (u - COCK_SHARE) / (1 - COCK_SHARE), easeIn);
            }
            if (t <= ray.off) {
                const p = (t - ray.on) / Math.max(1e-6, ray.off - ray.on);
                this.followView(ray, sign, p);
                return thrust ? thrustPose(ray, sign, p) : sweepPose(ray, sign, sweepEase(p));
            }
            const swept = thrust ? thrustPose(ray, sign, 1) : sweepPose(ray, sign, 1);
            const next = i + 1 < move.hits.length ? rayFor(timeline, i + 1).on : end;
            const gap = next - ray.off;
            const follow = Math.min(FOLLOW_TIME, 0.4 * gap);
            const carried = followPose(ray, sign, Math.min(1, gap / FOLLOW_ROOM));
            if (t < ray.off + follow) {
                return lerpPose(swept, carried, (t - ray.off) / Math.max(1e-6, follow), easeOut);
            }
            before = carried;
            beforeTime = ray.off + follow;
        }
        return lerpPose(before, REST, (t - beforeTime) / Math.max(1e-6, end - beforeTime));
    }

    /** The view turns a little towards the blade and leans into its travel, strongest mid-sweep. */
    private followView(ray: Ray, sign: number, p: number): void {
        const envelope = Math.sin(Math.PI * p);
        const dir = rayDirection(ray, sign, p);
        const ahead = rayDirection(ray, sign, p + 0.05);
        const vx = ahead.x - dir.x;
        const speed = Math.hypot(vx, ahead.y - dir.y) || 1;
        // three.js camera: +yaw turns left, +pitch looks up, +roll banks left.
        this.viewOffset.yaw += -dir.x * VIEW_FOLLOW * envelope;
        this.viewOffset.pitch += dir.y * VIEW_FOLLOW * envelope;
        this.viewOffset.roll += (-vx / speed) * VIEW_LEAN * envelope;
        if (ray.sweep === 0) {
            // A thrust drives the head forward and down a touch.
            this.viewOffset.pitch -= VIEW_LEAN * envelope;
        }
    }

    private lastPose: Pose | undefined;
    private swingRef: unknown;
    private swingStart: Pose | undefined;
    private windupFrom: Pose | undefined;
    private windupTime: number | undefined;
}
