import { ApiType } from "./ApiType";
import { CacheIndex, CacheIndexDat2 } from "./CacheIndex";
import { MemoryStore } from "./store/MemoryStore";

/** The indices of a dat2 (OSRS) cache, read from files already in memory. */
export class CacheSystem<A extends ApiType = ApiType.SYNC> {
    static fromStore(store: MemoryStore): CacheSystem {
        const indices = store.indexFiles.map((indexFile, id) =>
            indexFile ? CacheIndexDat2.fromStore(id, store) : undefined,
        );
        return new CacheSystem(indices);
    }

    constructor(readonly indices: (CacheIndex<A> | undefined)[]) {}

    indexExists(indexId: number): boolean {
        return !!this.indices[indexId];
    }

    getIndex(indexId: number): CacheIndex<A> {
        const index = this.indices[indexId];
        if (!index) {
            throw new Error("Index not found: " + indexId);
        }
        return index;
    }
}
