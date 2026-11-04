import { CacheIndex } from "../../cache/CacheIndex";
import { CacheInfo } from "../../cache/CacheInfo";
import { SeqBaseLoader } from "./SeqBaseLoader";
import { Dat2SeqFrame, SeqFrame } from "./SeqFrame";
import { SeqFrameMap } from "./SeqFrameMap";

export interface SeqFrameLoader {
    load(id: number): SeqFrame | undefined;

    clearCache(): void;
}

export class Dat2SeqFrameLoader implements SeqFrameLoader {
    frameMaps: Map<number, SeqFrameMap> = new Map();

    constructor(
        readonly cacheInfo: CacheInfo,
        readonly animIndex: CacheIndex,
        readonly baseLoader: SeqBaseLoader,
    ) {}

    load(id: number): SeqFrame | undefined {
        const frameMapId = id >> 16;
        const frameId = id & 0xffff;

        let frameMap = this.frameMaps.get(frameMapId);
        if (!frameMap) {
            const archive = this.animIndex.getArchive(frameMapId);

            const frames: SeqFrame[] = new Array(archive.lastFileId);

            for (const file of archive.files) {
                frames[file.id] = Dat2SeqFrame.load(this.cacheInfo, this.baseLoader, file.data);
            }

            frameMap = new SeqFrameMap(frames);
            this.frameMaps.set(frameMapId, frameMap);
        }

        return frameMap.frames[frameId];
    }

    clearCache(): void {
        this.frameMaps.clear();
        this.baseLoader.clearCache();
    }
}
