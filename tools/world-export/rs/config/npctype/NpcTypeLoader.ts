import { Archive } from "../../cache/Archive";
import { CacheInfo } from "../../cache/CacheInfo";
import { ArchiveTypeLoader, TypeLoader } from "../TypeLoader";
import { NpcType } from "./NpcType";

export type NpcTypeLoader = TypeLoader<NpcType>;

export class ArchiveNpcTypeLoader extends ArchiveTypeLoader<NpcType> implements NpcTypeLoader {
    constructor(cacheInfo: CacheInfo, archive: Archive) {
        super(NpcType, cacheInfo, archive);
    }
}
