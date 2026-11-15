import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { modelMeshes } from "../items/GroundItems";
import type { NpcModelData } from "../world/NpcFormat";
import { unlit } from "../world/FishingSpots";
import { BITE_WINDOW, CAST_SECONDS, FishJob } from "./fishing";
import { FISHING_CLIPS, FISHING_CLIP_FPS, FishingClip } from "./FishingClips";

/** Seconds a nibble plays (bobberNibble's length). */
const NIBBLE_SECONDS = (FISHING_CLIPS.bobberNibble.length - 1) / FISHING_CLIP_FPS;
const JUMP_SECONDS = (FISHING_CLIPS.fishJump.length - 1) / FISHING_CLIP_FPS;
/** How high the cast arcs above the straight line, tiles. [design] */
const CAST_ARC = 1.2;
const LINE_POINTS = 20;

const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();
const quatB = new THREE.Quaternion();

/** A Blender clip's offset and rotation at `t` seconds (`loop` wraps, otherwise it holds the last frame). */
export function sampleClip(clip: FishingClip, t: number, loop = false): { pos: THREE.Vector3; quat: THREE.Quaternion } {
    const frames = FISHING_CLIPS[clip];
    const last = frames.length - 1;
    let f = t * FISHING_CLIP_FPS;
    f = loop ? ((f % last) + last) % last : Math.min(last, Math.max(0, f));
    const i = Math.min(last - 1, Math.floor(f));
    const a = frames[i];
    const b = frames[i + 1];
    const k = f - i;
    pos.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
    quat.set(a[3], a[4], a[5], a[6]).slerp(quatB.set(b[3], b[4], b[5], b[6]), k);
    return { pos, quat };
}

/** Blender axes (x, y, z up) to scene axes (x, y up, z south). */
const BLENDER_TO_SCENE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

type Jump = { object: THREE.Object3D; from: THREE.Vector3; time: number };

/**
 * What fishing looks like: the bobber (Blender model) flying out on the cast, floating, nibbling
 * and going under its waterline mark on a bite; the line from the rod tip; and a landed fish
 * leaping out of the water into the player's arms.
 */
export class FishingView {
    private bobber: THREE.Object3D | undefined;
    private readonly line: THREE.Line;
    private readonly linePositions = new Float32Array(LINE_POINTS * 3);
    private readonly jumps: Jump[] = [];

    constructor(
        private readonly scene: THREE.Scene,
        private readonly materials: { opaque: THREE.Material; transparent: THREE.Material },
        private readonly loadItemModel: (file: string) => Promise<NpcModelData>,
        private readonly itemModel: (item: number) => string | undefined,
    ) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(this.linePositions, 3));
        this.line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xe8e8e0, transparent: true, opacity: 0.8 }));
        this.line.frustumCulled = false;
        this.line.visible = false;
        scene.add(this.line);
    }

    async load(url: string): Promise<void> {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), "");
        const holder = new THREE.Group();
        unlit(gltf.scene); // the glTF is already y-up, with the waterline mark at its origin
        holder.add(gltf.scene);
        holder.visible = false;
        this.bobber = holder;
        this.scene.add(holder);
    }

    /** A landed fish leaps from the water at (x, y, z tiles) to the player. */
    jump(item: number, x: number, y: number, z: number): void {
        const file = this.itemModel(item);
        if (!file) return;
        void this.loadItemModel(file).then((data) => {
            const object = new THREE.Group();
            object.add(...modelMeshes(data, 0, this.materials));
            this.scene.add(object);
            this.jumps.push({ object, from: new THREE.Vector3(x, z, -y), time: 0 });
        });
    }

    /**
     * Per frame: `job` is the fishing in progress (or undefined), `tip` the rod tip and `chest`
     * where a caught fish lands, both in scene coordinates.
     */
    update(dt: number, job: FishJob | undefined, tip: THREE.Vector3, chest: THREE.Vector3): void {
        this.updateJumps(dt, chest);
        const bobber = this.bobber;
        const out = job && job.phase !== "ready";
        this.line.visible = !!out;
        if (!bobber) return;
        bobber.visible = !!out;
        if (!job || !out) return;
        const landing = new THREE.Vector3(job.bobber.x, job.bobber.z, -job.bobber.y);
        let sag = 0.25;
        if (job.phase === "cast") {
            // Out along an arc from the rod tip, landing on the water.
            const k = Math.min(1, job.phaseTime / CAST_SECONDS);
            bobber.position.lerpVectors(tip, landing, k);
            bobber.position.y += Math.sin(Math.PI * k) * CAST_ARC;
            bobber.quaternion.identity();
            sag = 0.05;
        } else {
            const clip =
                job.phase === "bite" || job.phase === "reel"
                    ? sampleClip("bobberBite", job.phase === "bite" ? job.phaseTime : BITE_WINDOW + job.phaseTime, job.phase === "reel")
                    : job.sinceNibble < NIBBLE_SECONDS
                      ? sampleClip("bobberNibble", job.sinceNibble)
                      : sampleClip("bobberIdle", job.phaseTime, true);
            bobber.position.copy(landing);
            bobber.position.y += clip.pos.z;
            bobber.position.x += clip.pos.x;
            bobber.position.z -= clip.pos.y;
            bobber.quaternion.copy(BLENDER_TO_SCENE).multiply(clip.quat).multiply(BLENDER_TO_SCENE.clone().invert());
            if (job.phase === "reel") {
                // The fish fighting: the float pulled about under the water.
                const t = job.phaseTime;
                bobber.position.x += Math.sin(t * 7.3) * 0.12;
                bobber.position.z += Math.cos(t * 5.1) * 0.12;
                sag = 0;
            }
        }
        this.drawLine(tip, bobber.position, sag);
    }

    private drawLine(from: THREE.Vector3, to: THREE.Vector3, sag: number): void {
        for (let i = 0; i < LINE_POINTS; i++) {
            const k = i / (LINE_POINTS - 1);
            this.linePositions[i * 3] = from.x + (to.x - from.x) * k;
            this.linePositions[i * 3 + 1] = from.y + (to.y - from.y) * k - Math.sin(Math.PI * k) * sag;
            this.linePositions[i * 3 + 2] = from.z + (to.z - from.z) * k;
        }
        this.line.geometry.attributes.position.needsUpdate = true;
    }

    private updateJumps(dt: number, chest: THREE.Vector3): void {
        for (let i = this.jumps.length - 1; i >= 0; i--) {
            const j = this.jumps[i];
            j.time += dt;
            if (j.time >= JUMP_SECONDS) {
                this.scene.remove(j.object);
                this.jumps.splice(i, 1);
                continue;
            }
            const c = sampleClip("fishJump", j.time);
            // Along the way from the water to the player, plus the clip's arc above that line.
            j.object.position.lerpVectors(j.from, chest, c.pos.x);
            j.object.position.y += c.pos.z;
            // Face the way it flies: the clip's +X towards the player.
            const dir = new THREE.Vector3().subVectors(chest, j.from).setY(0).normalize();
            const yaw = Math.atan2(-dir.z, dir.x);
            j.object.quaternion
                .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
                .multiply(BLENDER_TO_SCENE)
                .multiply(c.quat)
                .multiply(BLENDER_TO_SCENE.clone().invert());
        }
    }
}
