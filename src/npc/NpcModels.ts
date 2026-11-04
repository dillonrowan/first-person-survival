import * as THREE from "three";

import type { NpcMeshData, NpcModelData } from "../world/NpcFormat";

/** GPU attributes of one mesh that all NPCs with the same appearance share. */
export type SharedNpcMesh = {
    source: NpcMeshData;
    transparent: boolean;
    colors: THREE.BufferAttribute;
    uvs: THREE.BufferAttribute;
    index: THREE.BufferAttribute;
};

export type SharedNpcModel = { data: NpcModelData; meshes: SharedNpcMesh[] };

function createShared(source: NpcMeshData, transparent: boolean): SharedNpcMesh {
    // Never release the CPU arrays: disposing one NPC's geometry frees the buffers of the shared
    // attributes, and the other NPCs upload them again from the arrays on their next draw.
    return {
        source,
        transparent,
        colors: new THREE.BufferAttribute(source.colors, 4, true),
        uvs: new THREE.BufferAttribute(source.uvs, 2),
        index: new THREE.BufferAttribute(source.indices, 1),
    };
}

/** Reference-counted cache of loaded NPC model files. */
export class NpcModels {
    private readonly entries = new Map<
        string,
        { refs: number; promise: Promise<SharedNpcModel> }
    >();

    constructor(private readonly loadModel: (file: string) => Promise<NpcModelData>) {}

    get size(): number {
        return this.entries.size;
    }

    /** Counts a use of the model immediately; release() must be called once per acquire(). */
    acquire(file: string): Promise<SharedNpcModel> {
        let entry = this.entries.get(file);
        if (!entry) {
            entry = {
                refs: 0,
                promise: this.loadModel(file).then((data) => {
                    const meshes: SharedNpcMesh[] = [];
                    if (data.opaque.indices.length > 0) {
                        meshes.push(createShared(data.opaque, false));
                    }
                    if (data.transparent.indices.length > 0) {
                        meshes.push(createShared(data.transparent, true));
                    }
                    return { data, meshes };
                }),
            };
            this.entries.set(file, entry);
        }
        entry.refs++;
        return entry.promise;
    }

    release(file: string): void {
        const entry = this.entries.get(file);
        if (entry && --entry.refs <= 0) {
            this.entries.delete(file);
        }
    }
}
