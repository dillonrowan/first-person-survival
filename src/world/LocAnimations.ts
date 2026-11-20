import * as THREE from "three";

import { CLIENT_CYCLE_SECONDS, ClipPlayback, advanceClip, writeFramePositions } from "../npc/NpcAnimation";
import type { NpcClip, NpcMeshData, NpcModelData } from "./NpcFormat";

type Playing = { clip: NpcClip; vertexCount: number; parts: { mesh: THREE.Mesh; sources: Uint16Array }[]; playback: ClipPlayback; time: number };

/**
 * Plays the cache animation of locs the game places (the fire's flames): the baked frames of the
 * model's idle clip, copied into its meshes as the OSRS client shows them. Each loc starts at a
 * random frame so neighbours do not move in step; a loc taken out of the scene stops.
 */
export class LocAnimations {
    private readonly playing = new Map<THREE.Object3D, Playing>();

    /**
     * Animates `object`, whose `meshes` were built from `data` by modelMeshes (opaque, then
     * transparent, empty parts skipped). Does nothing for a model without an idle clip.
     */
    add(object: THREE.Object3D, data: NpcModelData, meshes: THREE.Mesh[]): void {
        const clip = data.idle;
        if (!clip || clip.frameLengths.length === 0) return;
        const used = [data.opaque, data.transparent].filter((p: NpcMeshData) => p.indices.length > 0);
        const parts = meshes.map((mesh, i) => ({ mesh, sources: used[i].sources }));
        const frame = Math.floor(Math.random() * clip.frameLengths.length);
        const playing: Playing = { clip, vertexCount: data.vertexCount, parts, playback: { frame, cycle: 0 }, time: 0 };
        this.write(playing);
        this.playing.set(object, playing);
    }

    update(dt: number): void {
        for (const [object, p] of this.playing) {
            if (!object.parent) {
                this.playing.delete(object);
                continue;
            }
            p.time += dt;
            const cycles = Math.floor(p.time / CLIENT_CYCLE_SECONDS);
            if (cycles === 0) continue;
            p.time -= cycles * CLIENT_CYCLE_SECONDS;
            if (advanceClip(p.playback, p.clip, cycles)) this.write(p);
        }
    }

    private write(p: Playing): void {
        for (const { mesh, sources } of p.parts) {
            const attribute = mesh.geometry.getAttribute("a_position") as THREE.BufferAttribute;
            writeFramePositions(attribute.array as Int16Array, sources, p.clip.positions, p.playback.frame, p.vertexCount);
            attribute.needsUpdate = true;
        }
    }
}
