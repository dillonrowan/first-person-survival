import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import type { KickController } from "./Kick";
import type { MeleeController } from "./MeleeController";
import { tuning } from "./tuning";
import { createPlaceholderWeapon } from "./PlaceholderWeapons";
import type { WeaponDef } from "./weapons";

/** Position (camera space, tiles) and rotation (YXZ, radians) of the held weapon. */
type Pose = { px: number; py: number; pz: number; rx: number; ry: number; rz: number };

const REST: Pose = { px: 0.24, py: -0.3, pz: -0.42, rx: -0.95, ry: 0, rz: -0.25 };
const CHARGE: Pose = { px: 0.32, py: -0.05, pz: -0.25, rx: 0.2, ry: -0.5, rz: -0.6 };
const SWING_RADIUS = 0.45;
const KICK_ASIDE: Pose = { px: 0.42, py: -0.45, pz: -0.35, rx: -0.6, ry: -0.3, rz: -0.6 };
/** Blade held across the view in the parry stance. [design] */
const PARRY: Pose = { px: 0.05, py: -0.12, pz: -0.4, rx: -0.2, ry: 0, rz: -1.45 };
/** Bow held low, then raised and drawn in front of the eye. [design] */
const BOW_REST: Pose = { px: 0.2, py: -0.35, pz: -0.5, rx: -0.3, ry: 0.3, rz: 0.4 };
const BOW_DRAWN: Pose = { px: 0.02, py: -0.08, pz: -0.55, rx: 0, ry: 0, rz: 0.15 };

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
/** Swing arc drawn on screen; narrower than the hit arc so the blade stays in view. [design] */
const DRAWN_ARC = 1.0;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
function lerpPose(a: Pose, b: Pose, t: number): Pose {
    const s = smooth(Math.min(1, Math.max(0, t)));
    return {
        px: lerp(a.px, b.px, s),
        py: lerp(a.py, b.py, s),
        pz: lerp(a.pz, b.pz, s),
        rx: lerp(a.rx, b.rx, s),
        ry: lerp(a.ry, b.ry, s),
        rz: lerp(a.rz, b.rz, s),
    };
}

/** Blade at angle `a` (positive = left of view) on a horizontal arc in front of the camera. */
function sidePose(a: number, roll: number): Pose {
    return { px: -Math.sin(a) * SWING_RADIUS, py: -0.12, pz: -Math.cos(a) * SWING_RADIUS, rx: -1.45, ry: a, rz: roll };
}

/** Start and end poses of a move's active phase, from its impact direction. */
function strokePoses(impact: { x: number; y: number; z: number }): [Pose, Pose] {
    if (impact.y !== 0) {
        const s = Math.sign(impact.y);
        return [sidePose(-s * DRAWN_ARC, s * 0.5), sidePose(s * DRAWN_ARC, s * 0.5)];
    }
    if (impact.z < 0) {
        return [
            { px: 0.12, py: 0.12, pz: -0.3, rx: 0.5, ry: 0, rz: -0.1 },
            { px: 0.04, py: -0.38, pz: -0.55, rx: -2.0, ry: 0, rz: -0.1 },
        ];
    }
    return [
        { px: 0.16, py: -0.22, pz: -0.2, rx: -1.57, ry: 0, rz: -0.2 },
        { px: 0.04, py: -0.14, pz: -0.8, rx: -1.57, ry: 0, rz: -0.2 },
    ];
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
        this.holder.position.set(pose.px, pose.py, pose.pz);
        this.holder.rotation.set(pose.rx, pose.ry, pose.rz);
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

    private pose(melee: MeleeController): Pose {
        const swing = melee.swing;
        if (!swing) {
            return melee.chargeProgress > 0 ? lerpPose(REST, CHARGE, melee.chargeProgress) : REST;
        }
        const { windup, active, recovery } = swing.timeline;
        const [start, end] = strokePoses(swing.move.hits[0].impact);
        const t = swing.elapsed;
        if (t < windup) {
            return lerpPose(REST, start, t / windup);
        }
        if (t < windup + active) {
            return lerpPose(start, end, (t - windup) / active);
        }
        return lerpPose(end, REST, (t - windup - active) / recovery);
    }
}
