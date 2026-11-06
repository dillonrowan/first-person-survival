import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { DM_CLIPS, DmClip, DmClipSet } from "./DmKeyframes";
import type { KickController } from "./Kick";
import type { MeleeController } from "./MeleeController";
import type { MoveDef, PowerDirection } from "./moves";
import { createPlaceholderWeapon } from "./PlaceholderWeapons";
import { tuning } from "./tuning";
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

const KICK_ASIDE = euler(0.42, -0.45, -0.35, -0.6, -0.3, -0.6);
const BOW_REST = euler(0.2, -0.35, -0.5, -0.3, 0.3, 0.4);
const BOW_DRAWN = euler(0.02, -0.08, -0.55, 0, 0, 0.15);

/** Crossfade between animation layers, and the slower settle back to the idle pose. */
const BLEND = 0.1;
const BLEND_TO_IDLE = 0.25;

/** Placeholder boot for the first-person kick. */
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

const clipLength = (clip: DmClip) => (clip.frames - 1) / clip.fps;

/** The clip's pose at `time` seconds, held at the ends or looped. */
function sample(clip: DmClip, time: number, loop = false): Pose {
    const last = clip.frames - 1;
    let f = time * clip.fps;
    f = loop && last > 0 ? ((f % last) + last) % last : Math.min(last, Math.max(0, f));
    const i = Math.min(Math.floor(f), Math.max(0, last - 1));
    const j = Math.min(i + 1, last);
    const k = f - i;
    const d = clip.data;
    const a = i * 7;
    const b = j * 7;
    const pos = new THREE.Vector3(d[a], d[a + 1], d[a + 2]).lerp(new THREE.Vector3(d[b], d[b + 1], d[b + 2]), k);
    const quat = new THREE.Quaternion(d[a + 3], d[a + 4], d[a + 5], d[a + 6]).slerp(
        new THREE.Quaternion(d[b + 3], d[b + 4], d[b + 5], d[b + 6]),
        k,
    );
    return { pos, quat };
}

const powerDir = (move: MoveDef): PowerDirection => (move.id.split("_")[1] as PowerDirection | undefined) ?? "default";

/** The clip one swing plays, and the quick-strike index it belongs to (-1 otherwise). */
function swingClip(clips: DmClipSet, move: MoveDef): [DmClip, number] {
    switch (move.kind) {
        case "quick": {
            const index = "ABCDE".indexOf(move.id.slice(-1));
            return [clips.quick[index], index];
        }
        case "power":
            return [clips.power[powerDir(move)], -1];
        default:
            return [clips[move.kind], -1];
    }
}

/** What the weapon is playing this frame: a clip at a time, under a key that changes with the layer. */
type Layer = { key: string; clip: DmClip; time: number; loop?: boolean };

export class WeaponView {
    private readonly holder = new THREE.Group();
    private readonly models = new Map<string, THREE.Object3D>();
    private readonly loading = new Set<string>();
    private current: THREE.Object3D | undefined;
    private currentId = "";
    private readonly boot = createBoot();

    private pose: Pose | undefined;
    private layerKey = "";
    /** Seconds since the current layer started. */
    private layerTime = 0;
    private blendFrom: Pose | undefined;
    private blendTime = 0;
    private blendLength = BLEND;
    private swingRef: unknown;
    private swingCount = 0;
    /** The quick strike that last played, to pick the combo end layer. */
    private lastQuick = -1;

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
        dt: number,
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
            this.holder.position.set(0, 0, 0);
            this.holder.rotation.set(Math.PI / 2, 0, 0);
            return;
        }
        let pose =
            weapon.family === "bow"
                ? lerpPose(BOW_REST, BOW_DRAWN, extra.bowDraw ?? 0)
                : this.animate(dt, DM_CLIPS[weapon.family], melee, extra.blocking ?? false);
        if (kick?.active) {
            pose = lerpPose(pose, KICK_ASIDE, Math.min(1, (kick.elapsed ?? 0) / 0.1));
        }
        this.holder.position.copy(pose.pos);
        this.holder.quaternion.copy(pose.quat);
    }

    /** Plays Dark Messiah's first-person layer for the melee state, crossfading when the layer changes. */
    private animate(dt: number, clips: DmClipSet, melee: MeleeController, blocking: boolean): Pose {
        this.layerTime += dt;
        const layer = this.layer(clips, melee, blocking);
        if (layer.key !== this.layerKey) {
            this.layerKey = layer.key;
            this.layerTime = 0;
            if (this.pose) {
                this.blendFrom = this.pose;
                this.blendTime = 0;
                this.blendLength = layer.key === "idle" ? BLEND_TO_IDLE : BLEND;
            }
            if (layer.key.startsWith("charged") || layer.key === "end" || layer.key === "parry") {
                layer.time = 0;
            }
        }
        let pose = sample(layer.clip, layer.time, layer.loop);
        if (this.blendFrom) {
            this.blendTime += dt;
            if (this.blendTime >= this.blendLength) {
                this.blendFrom = undefined;
            } else {
                pose = lerpPose(this.blendFrom, pose, this.blendTime / this.blendLength);
            }
        }
        this.pose = pose;
        return pose;
    }

    private layer(clips: DmClipSet, melee: MeleeController, blocking: boolean): Layer {
        if (blocking) {
            const enter = clipLength(clips.parryIn);
            return this.layerKey === "parry" && this.layerTime >= enter
                ? { key: "parry", clip: clips.parry, time: this.layerTime - enter, loop: true }
                : { key: "parry", clip: clips.parryIn, time: this.layerKey === "parry" ? this.layerTime : 0 };
        }
        const swing = melee.swing;
        if (swing) {
            if (swing !== this.swingRef) {
                this.swingRef = swing;
                this.swingCount++;
            }
            const [clip, quick] = swingClip(clips, swing.move);
            this.lastQuick = quick;
            const { windup, active, recovery } = swing.timeline;
            const progress = swing.elapsed / Math.max(1e-6, windup + active + recovery);
            return { key: `swing${this.swingCount}`, clip, time: progress * clipLength(clip) };
        }
        const charging = melee.chargedMove;
        if (charging) {
            const dir = powerDir(charging);
            if (melee.phase === "charged") {
                return { key: `charged_${dir}`, clip: clips.charged[dir], time: this.layerTime, loop: true };
            }
            const clip = clips.windup[dir];
            return { key: `windup_${dir}`, clip, time: melee.chargeProgress * clipLength(clip) };
        }
        const end = melee.phase === "end" ? clips.end[this.lastQuick] : undefined;
        if (end) {
            return { key: "end", clip: end, time: this.layerTime };
        }
        return { key: "idle", clip: clips.idle, time: 0 };
    }

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
}
