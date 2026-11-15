import * as THREE from "three";

import { LOC_REACTION_CLIPS, LOC_REACTION_FPS, LocReaction } from "./LocReactionClips";
import type { SkillLocInstance } from "./SkillLocs";

type Playing = {
    instance: SkillLocInstance;
    group: THREE.Object3D;
    frames: readonly (readonly number[])[];
    time: number;
    /** Pivot on the ground → reaction axes (x right, y away from the player, z up) and back. */
    toPivot: THREE.Matrix4;
    fromPivot: THREE.Matrix4;
    /** The group's own matrix, put back when the clip ends. */
    base: THREE.Matrix4;
    /** Keep this look on show to the end even after the loc changed look (a tree falling over its stump). */
    linger: boolean;
};

const pos = new THREE.Vector3();
const posB = new THREE.Vector3();
const quat = new THREE.Quaternion();
const quatB = new THREE.Quaternion();
const scale = new THREE.Vector3();
const scaleB = new THREE.Vector3();
const clipMatrix = new THREE.Matrix4();

/**
 * Plays the Blender-made reactions (LocReactionClips.ts) on trees and rocks: the look on show
 * moves about the middle of its footprint on the ground, turned so the blow pushes it away from
 * where it came from.
 */
export class LocReactions {
    private readonly playing = new Map<THREE.Object3D, Playing>();

    constructor(private readonly groundHeight: (plane: number, x: number, y: number) => number) {}

    /** Plays `clip` on the instance's look on show, struck from (fromX, fromY) in tiles. */
    play(instance: SkillLocInstance, clip: LocReaction, fromX: number, fromY: number, linger = false): void {
        const group = instance.object ?? instance.meshes.get(instance.shown);
        if (!group) return;
        const loc = instance.loc;
        const cx = loc.tileX + loc.sizeX / 2;
        const cy = loc.tileY + loc.sizeY / 2;
        let ax = cx - fromX;
        let ay = cy - fromY;
        const length = Math.hypot(ax, ay);
        if (length < 1e-6) [ax, ay] = [0, 1];
        else [ax, ay] = [ax / length, ay / length];
        // Scene axes: x east, y up, z south.
        const away = new THREE.Vector3(ax, 0, -ay);
        const up = new THREE.Vector3(0, 1, 0);
        const right = away.clone().cross(up);
        const pivot = new THREE.Vector3(cx, this.groundHeight(loc.plane, cx, cy), -cy);
        const basis = new THREE.Matrix4().makeBasis(right, away, up);
        const toPivot = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z).multiply(basis);
        const fromPivot = toPivot.clone().invert();
        const current = this.playing.get(group);
        if (!current) {
            group.updateMatrix();
            group.matrixAutoUpdate = false;
        }
        const base = current?.base ?? group.matrix.clone();
        this.playing.set(group, { instance, group, frames: LOC_REACTION_CLIPS[clip], time: 0, toPivot, fromPivot, base, linger: linger || !!current?.linger });
    }

    update(dt: number): void {
        for (const p of this.playing.values()) {
            p.time += dt;
            const f = p.time * LOC_REACTION_FPS;
            const last = p.frames.length - 1;
            if (f >= last) {
                this.finish(p);
                continue;
            }
            const i = Math.floor(f);
            const a = p.frames[i];
            const b = p.frames[i + 1];
            const t = f - i;
            pos.set(a[0], a[1], a[2]).lerp(posB.set(b[0], b[1], b[2]), t);
            quat.set(a[3], a[4], a[5], a[6]).slerp(quatB.set(b[3], b[4], b[5], b[6]), t);
            scale.set(a[7], a[8], a[9]).lerp(scaleB.set(b[7], b[8], b[9]), t);
            clipMatrix.compose(pos, quat, scale);
            p.group.matrix.copy(p.toPivot).multiply(clipMatrix).multiply(p.fromPivot).multiply(p.base);
            p.group.matrixWorldNeedsUpdate = true;
            if (p.linger) p.group.visible = true;
        }
    }

    private finish(p: Playing): void {
        this.playing.delete(p.group);
        p.group.matrix.copy(p.base);
        p.group.matrix.decompose(p.group.position, p.group.quaternion, p.group.scale);
        p.group.matrixAutoUpdate = true;
        p.group.matrixWorldNeedsUpdate = true;
        // The look the loc wants now (a lingering tree that has become a stump hides).
        const instance = p.instance;
        if (p.linger) p.group.visible = p.group === instance.object || instance.meshes.get(instance.shown) === p.group;
    }
}
