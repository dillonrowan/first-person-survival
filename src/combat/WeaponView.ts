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
const CHARGE = euler(0.32, -0.05, -0.25, 0.2, -0.5, -0.6);
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
function lerpPose(a: Pose, b: Pose, t: number): Pose {
    const s = smooth(Math.min(1, Math.max(0, t)));
    return { pos: a.pos.clone().lerp(b.pos, s), quat: a.quat.clone().slerp(b.quat, s) };
}

/** View-space ray direction (x right, y up, z forward) to camera space (−Z forward). */
const toCamera = (d: ViewDir) => new THREE.Vector3(d.x, d.y, -d.z);

/** Where the hand sits (camera space) when the arm is not extended. [design] */
const HAND = new THREE.Vector3(0.14, -0.3, -0.05);
/** The blade aims at this far point on the attack ray. [design] */
const AIM_DISTANCE = 1.1;

/**
 * The blade on the attack ray (spec 17.2) at progress `t`: the hand moves `radius` out along the
 * ray from its rest spot, and the blade (+Y) points from the hand at the ray's far point, edge (+Z)
 * facing the way the fan sweeps. The drawn tip therefore follows the lines the hit test traces,
 * while the blade stays visible instead of end-on. A thrust's edge faces down.
 */
function rayPose(ray: Ray, sign: number, t: number, radius = SWING_RADIUS): Pose {
    const dir = toCamera(rayDirection(ray, sign, t));
    const hand = HAND.clone().addScaledVector(dir, radius);
    hand.y += GRIP_DROP + 0.12;
    const blade = dir.clone().multiplyScalar(AIM_DISTANCE).sub(hand).normalize();
    const ahead = toCamera(rayDirection(ray, sign, Math.min(1, t + 0.02)));
    const behind = toCamera(rayDirection(ray, sign, Math.max(0, t - 0.02)));
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

/** Wind-up: the blade drawn back to where its first ray starts (a thrust: drawn straight back). */
function windupPose(move: MoveDef, timeline: Timeline): Pose {
    const ray = rayFor(timeline, 0);
    return rayPose(ray, raySign(ray, move.hits[0].impact), 0, WINDUP_RADIUS);
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

    update(
        melee: MeleeController,
        mode: "first" | "third",
        visible: boolean,
        kick?: KickController,
        extra: { bowDraw?: number; blocking?: boolean } = {},
    ): void {
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
     * The weapon follows the move's attack rays (spec 17): from rest (or the charged wind-up) to the
     * start of each ray, along the ray's fan while it traces, then back to rest.
     */
    private pose(melee: MeleeController): Pose {
        const swing = melee.swing;
        if (!swing) {
            const charged = melee.chargedMove;
            if (charged) {
                // The variant is locked: hold the blade drawn back where its swing will start.
                this.windupFrom = this.windupFrom ?? this.lastPose ?? CHARGE;
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
        }
        this.lastPose = this.swingPose(swing);
        return this.lastPose;
    }

    private swingPose(swing: NonNullable<MeleeController["swing"]>): Pose {
        const { move, timeline, elapsed: t } = swing;
        let before = this.swingStart ?? REST;
        let beforeTime = 0;
        for (let i = 0; i < move.hits.length; i++) {
            const ray = rayFor(timeline, i);
            const sign = raySign(ray, move.hits[i].impact);
            const thrust = ray.sweep === 0;
            const start = rayPose(ray, sign, 0, thrust ? WINDUP_RADIUS : SWING_RADIUS);
            if (t < ray.on) {
                return lerpPose(before, start, (t - beforeTime) / Math.max(1e-6, ray.on - beforeTime));
            }
            if (t <= ray.off) {
                const p = (t - ray.on) / Math.max(1e-6, ray.off - ray.on);
                return thrust
                    ? lerpPose(start, rayPose(ray, sign, 0, SWING_RADIUS + 0.25), p)
                    : rayPose(ray, sign, p);
            }
            before = thrust ? rayPose(ray, sign, 0, SWING_RADIUS + 0.25) : rayPose(ray, sign, 1);
            beforeTime = ray.off;
        }
        const end = timeline.windup + timeline.active + timeline.recovery;
        return lerpPose(before, REST, (t - beforeTime) / Math.max(1e-6, end - beforeTime));
    }

    private lastPose: Pose | undefined;
    private swingRef: unknown;
    private swingStart: Pose | undefined;
    private windupFrom: Pose | undefined;
    private windupTime: number | undefined;
}
