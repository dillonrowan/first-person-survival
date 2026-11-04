import { Archive } from "../../cache/Archive";
import { CacheInfo } from "../../cache/CacheInfo";
import { ArchiveTypeLoader, TypeLoader } from "../TypeLoader";
import { SeqType } from "./SeqType";

export type SeqTypeLoader = TypeLoader<SeqType>;

export class ArchiveSeqTypeLoader extends ArchiveTypeLoader<SeqType> implements SeqTypeLoader {
    constructor(cacheInfo: CacheInfo, archive: Archive) {
        super(SeqType, cacheInfo, archive);
    }
}
