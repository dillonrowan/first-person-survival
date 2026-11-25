// From rs-map-viewer (BSD-2-Clause, https://github.com/dennisdev/rs-map-viewer), src/rs/model/skeletal.

import { Archive } from "../../cache/Archive";
import { CacheIndex } from "../../cache/CacheIndex";
import { SeqBaseLoader } from "../seq/SeqBaseLoader";
import { SkeletalSeq } from "./SkeletalSeq";

export interface SkeletalSeqLoader {
    load(id: number): SkeletalSeq | undefined;

    /** The id of the base (skeleton) an animation runs on, read from its header without decoding it. */
    baseId(id: number): number | undefined;

    clearCache(): void;
}

export class IndexSkeletalSeqLoader implements SkeletalSeqLoader {
    seqs: Map<number, SkeletalSeq> = new Map();

    archiveCache: Map<number, Archive> = new Map();

    constructor(
        readonly animIndex: CacheIndex,
        readonly baseLoader: SeqBaseLoader,
    ) {}

    baseId(id: number): number | undefined {
        const data = this.animIndex.getArchive(id >> 16).getFile(id & 0xffff)?.data;
        // u8 version, u16 base id.
        return data && data.length >= 3 ? ((data[1] & 0xff) << 8) | (data[2] & 0xff) : undefined;
    }

    load(id: number): SkeletalSeq | undefined {
        const cached = this.seqs.get(id);
        if (cached) {
            return cached;
        }

        const archiveId = id >> 16;
        const fileId = id & 0xffff;

        let archive = this.archiveCache.get(archiveId);
        if (!archive) {
            archive = this.animIndex.getArchive(archiveId);
            this.archiveCache.set(archiveId, archive);
        }

        const file = archive.getFile(fileId);
        if (!file) {
            return undefined;
        }

        const skeletalSeq = SkeletalSeq.load(this.baseLoader, id, file.data);
        this.seqs.set(id, skeletalSeq);
        return skeletalSeq;
    }

    clearCache(): void {
        this.seqs.clear();
        this.archiveCache.clear();
    }
}
