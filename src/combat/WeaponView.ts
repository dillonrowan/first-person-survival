import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { BowString } from "./BowString";
import { DM_CLIPS, DmClip } from "./DmKeyframes";
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
/** Canted clockwise about the grip, below the reticule, so the upper limb clears the aim point. */
const BOW_DRAWN = euler(0.05, -0.08, -0.55, 0, 0, -0.4);

/**
 * The drawn arrow's line crosses the line of sight this far ahead (tiles), so from the eye it points
 * straight into the reticule; a shot arrow closes onto its true flight over the same distance. [design]
 */
export const ARROW_CONVERGE = 8;
/** How long (s) the last nocked arrow's position counts as where a shot leaves the bow. */
const NOCK_MEMORY = 0.15;

/** Crossfade between animation layers, and the slower settle back to the idle pose. */
const BLEND = 0.1;
const BLEND_TO_IDLE = 0.25;
/** Visual freeze of the blade when a strike lands, seconds at full strength. [design] */
const HITSTOP = 0.07;
/** Camera shake on impact, radians at full strength, and how fast it dies out (1/s). [design] */
const IMPACT_SHAKE = 0.012;
const SHAKE_DECAY = 14;
/** Tremble of the blade while a charged power attack is held, tiles. [design] */
const CHARGE_TREMBLE = 0.004;

/** Camera rotation offsets (radians) the swing adds on top of the player's view. */
export type ViewOffset = { pitch: number; yaw: number; roll: number };

/**
 * The Dark Messiah quick strike each game quick strike plays (A cuts left to right, B right to
 * left, moves.ts), and that clip's own contact window as fractions of it (the first-person
 * animations' ray events). The pairs chain: each ends where the other starts.
 */
const QUICK_CLIPS: Record<keyof typeof DM_CLIPS, Record<"A" | "B", { clip: number; on: number; off: number }>> = {
    sword: { A: { clip: 1, on: 0.2 / 0.4, off: 0.333 / 0.4 }, B: { clip: 4, on: 0.2 / 0.367, off: 0.333 / 0.367 } },
    daggers: { A: { clip: 1, on: 0.1 / 0.267, off: 0.233 / 0.267 }, B: { clip: 0, on: 0.067 / 0.233, off: 0.2 / 0.233 } },
    staff: { A: { clip: 2, on: 0.733, off: 0.867 }, B: { clip: 1, on: 0.8, off: 0.967 } },
};

/** Fastest a quick strike's run-up and recovery play (×), so they keep their natural speed. [design] */
const QUICK_PLAY_RATE = 1.3;

/**
 * Time in the clip (seconds, of `length`) at `t` seconds into the game's swing: the clip's contact
 * window [on, off] (fractions of it) plays exactly during the swing's hit window, and the run-up
 * and recovery around it play at about their natural speed, starting partway into the clip's
 * wind-up when the game's is shorter (a long staff wind-up would otherwise race).
 */
function warp(t: number, swing: { on: number; off: number }, clip: { on: number; off: number }, length: number): number {
    const contactOn = clip.on * length;
    const contactOff = clip.off * length;
    if (t <= swing.on) {
        return Math.max(contactOn * (1 - t / Math.max(1e-6, swing.on)), contactOn - (swing.on - t) * QUICK_PLAY_RATE);
    }
    if (t <= swing.off) {
        return contactOn + ((t - swing.on) / Math.max(1e-6, swing.off - swing.on)) * (contactOff - contactOn);
    }
    return Math.min(length, contactOff + (t - swing.off) * QUICK_PLAY_RATE);
}

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

/**
 * Turns the held bow about the nock (the archer's anchor stays put) so the arrow points along the
 * line of sight, crossing it ARROW_CONVERGE tiles ahead; `weight` 0 leaves the pose as it is.
 */
function aimArrow(pose: Pose, bow: BowString, weight: number): Pose {
    if (weight <= 0) {
        return pose;
    }
    const nock = bow.nock.clone().applyQuaternion(pose.quat).add(pose.pos);
    const current = bow.arrowRest.clone().sub(bow.nock).applyQuaternion(pose.quat).normalize();
    const wanted = new THREE.Vector3(0, 0, -ARROW_CONVERGE).sub(nock).normalize();
    const turn = new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(current, wanted), weight);
    return {
        pos: pose.pos.clone().sub(nock).applyQuaternion(turn).add(nock),
        quat: turn.multiply(pose.quat),
    };
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

/**
 * The clip one swing plays at `elapsed` seconds into its timeline: quick strikes play their
 * paired Dark Messiah strike warped onto the hit window, the rest their own layer end to end.
 * Also the Dark Messiah quick strike index (-1 otherwise), for its end layer.
 */
function swingClip(
    family: keyof typeof DM_CLIPS,
    swing: NonNullable<MeleeController["swing"]>,
    elapsed: number,
): { clip: DmClip; time: number; quick: number } {
    const clips = DM_CLIPS[family];
    const { move, timeline } = swing;
    const total = Math.max(1e-6, timeline.windup + timeline.active + timeline.recovery);
    if (move.kind === "quick") {
        const pair = QUICK_CLIPS[family][move.id.endsWith("B") ? "B" : "A"];
        const clip = clips.quick[pair.clip];
        const window = { on: timeline.windup, off: timeline.windup + timeline.active };
        return { clip, time: warp(Math.min(elapsed, total), window, pair, clipLength(clip)), quick: pair.clip };
    }
    const clip = move.kind === "power" ? clips.power[powerDir(move)] : clips[move.kind];
    return { clip, time: (Math.min(elapsed, total) / total) * clipLength(clip), quick: -1 };
}

/** What the weapon is playing this frame: a clip at a time, under a key that changes with the layer. */
type Layer = { key: string; clip: DmClip; time: number; loop?: boolean };

export class WeaponView {
    private readonly holder = new THREE.Group();
    private readonly models = new Map<string, THREE.Object3D>();
    private readonly loading = new Set<string>();
    private current: THREE.Object3D | undefined;
    private currentId = "";
    /** The held bow's string and nocked arrow, when its model has one. */
    private bowString: BowString | undefined;
    private readonly lastArrowHead = new THREE.Vector3();
    private sinceNocked = Infinity;
    private readonly boot = createBoot();
    /** Added to the first-person camera's rotation: the view following the swing and shaking on impact. */
    readonly viewOffset: ViewOffset = { pitch: 0, yaw: 0, roll: 0 };
    /** Seconds the drawn swing runs behind the real one (hit-stop); it catches up at double speed. */
    private lag = 0;
    private freeze = 0;
    private shake = 0;
    private clock = 0;

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
        /** The model of a weapon exported from the cache, undefined for other weapons. */
        private readonly loadCacheModel?: (weaponId: string) => Promise<THREE.Object3D> | undefined,
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
            const cacheModel = this.loadCacheModel?.(weapon.id);
            if (cacheModel) {
                cacheModel
                    .then((loaded) => this.replaceModel(weapon.id, loaded))
                    .catch((e) => console.warn(`Cache weapon ${weapon.id} could not be loaded`, e));
            } else {
                this.tryLoadGltf(weapon);
            }
        }
        return model;
    }

    /** Swaps a weapon's placeholder for its loaded model, on screen too if it is held. */
    private replaceModel(id: string, model: THREE.Object3D): void {
        const old = this.models.get(id);        this.models.set(id, model);
        if (old && old === this.current) {
            this.attach(model);
        }
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
            this.replaceModel(weapon.id, gltf.scene);
        })().catch((e) => console.warn(`Weapon model ${url} could not be loaded`, e));
    }

    private attach(model: THREE.Object3D): void {
        this.current?.removeFromParent();
        this.current = model;
        const bowString = model.getObjectByName("bow_string");
        this.bowString = bowString instanceof BowString ? bowString : undefined;
        this.holder.add(model);
    }

    /**
     * World position of the nocked arrow's head the last time it was drawn on the string, where a
     * shot arrow is seen to leave the bow; undefined when no arrow has been on the string lately.
     */
    arrowHead(out: THREE.Vector3): THREE.Vector3 | undefined {
        return this.sinceNocked <= NOCK_MEMORY ? out.copy(this.lastArrowHead) : undefined;
    }

    private recordArrowHead(nocked: boolean, dt: number): void {
        if (this.bowString && nocked) {
            this.holder.updateWorldMatrix(true, true);
            this.bowString.arrowHead(this.lastArrowHead);
            this.sinceNocked = 0;
        } else {
            this.sinceNocked += dt;
        }
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
        extra: {
            dt?: number;
            /** 0..1 how far into the draw the bow is held (the view pose). */
            bowDraw?: number;
            /** String pull, 1 at full draw (BowController.stringPull). */
            bowString?: number;
            /** An arrow is on the string. */
            arrowNocked?: boolean;
            blocking?: boolean;
        } = {},
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
            this.sinceNocked = Infinity;
            return;
        }
        this.holder.visible = true;
        this.bowString?.update(extra.bowString ?? 0, extra.arrowNocked ?? false);
        if (this.holder.parent !== parent) {
            parent.add(this.holder);
        }
        if (!firstPerson) {
            this.holder.position.set(0, 0, 0);
            this.holder.rotation.set(Math.PI / 2, 0, 0);
            this.recordArrowHead(extra.arrowNocked ?? false, dt);
            return;
        }
        let pose =
            weapon.family === "bow"
                ? lerpPose(BOW_REST, BOW_DRAWN, extra.bowDraw ?? 0)
                : this.animate(dt, weapon.family, melee, extra.blocking ?? false);
        if (this.bowString && extra.arrowNocked) {
            pose = aimArrow(pose, this.bowString, smooth(Math.min(1, Math.max(0, extra.bowDraw ?? 0))));
        }
        if (kick?.active) {
            pose = lerpPose(pose, KICK_ASIDE, Math.min(1, (kick.elapsed ?? 0) / 0.1));
        }
        this.holder.position.copy(pose.pos);
        this.holder.quaternion.copy(pose.quat);
        this.recordArrowHead(extra.arrowNocked ?? false, dt);
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

    /** Plays Dark Messiah's first-person layer for the melee state, crossfading when the layer changes. */
    private animate(dt: number, family: keyof typeof DM_CLIPS, melee: MeleeController, blocking: boolean): Pose {
        this.layerTime += dt;
        const layer = this.layer(family, melee, blocking);
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

    private layer(family: keyof typeof DM_CLIPS, melee: MeleeController, blocking: boolean): Layer {
        const clips = DM_CLIPS[family];
        if (blocking) {
            const enter = clipLength(clips.parryIn);
            return this.layerKey === "parry" && this.layerTime >= enter
                ? { key: "parry", clip: clips.parry, time: this.layerTime - enter, loop: true }
                : { key: "parry", clip: clips.parryIn, time: this.layerKey === "parry" ? this.layerTime : 0 };
        }
        const swing = melee.swing;
        if (swing) {
            if (swing !== this.swingRef) {
                // A new swing: any stall from the last one is dropped.
                this.swingRef = swing;
                this.swingCount++;
                this.lag = this.freeze = 0;
            }
            // The drawn swing runs `lag` behind the real one, so a landed blow stalls the blade
            // (hit tracing is unaffected).
            const { clip, time, quick } = swingClip(family, swing, Math.max(0, swing.elapsed - this.lag));
            this.lastQuick = quick;
            return { key: `swing${this.swingCount}`, clip, time };
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
