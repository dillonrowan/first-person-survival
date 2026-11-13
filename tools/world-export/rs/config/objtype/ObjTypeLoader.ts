import { Archive } from "../../cache/Archive";
import { CacheInfo } from "../../cache/CacheInfo";
import { ArchiveTypeLoader, TypeLoader } from "../TypeLoader";
import { ObjType } from "./ObjType";

export type ObjTypeLoader = TypeLoader<ObjType>;

export class ArchiveObjTypeLoader extends ArchiveTypeLoader<ObjType> implements ObjTypeLoader {
    constructor(cacheInfo: CacheInfo, archive: Archive) {
        super(ObjType, cacheInfo, archive);
    }
}
