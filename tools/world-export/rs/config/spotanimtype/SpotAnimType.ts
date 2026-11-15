import { Archive } from "../../cache/Archive";
import { CacheInfo } from "../../cache/CacheInfo";
import { ByteBuffer } from "../../io/ByteBuffer";
import { Type } from "../Type";
import { ArchiveTypeLoader, TypeLoader } from "../TypeLoader";

/**
 * A spot animation ("graphic"): a model with its own animation, drawn on a tile, on an actor
 * (spell casts and impacts) or as a projectile. Config archive 13.
 */
export class SpotAnimType extends Type {
    modelId = -1;
    sequenceId = -1;
    widthScale = 128;
    heightScale = 128;
    /** Rotation about the vertical axis in 2048ths of a turn (the client uses 90, 180 or 270 degrees). */
    orientation = 0;
    ambient = 0;
    contrast = 0;
    flag10 = false;
    recolorFrom?: number[];
    recolorTo?: number[];
    retextureFrom?: number[];
    retextureTo?: number[];

    override decodeOpcode(opcode: number, buffer: ByteBuffer): void {
        if (opcode === 1) {
            this.modelId = buffer.readUnsignedShort();
        } else if (opcode === 3) {
            // Newer caches: the model id as an int (ids past 65535).
            this.modelId = buffer.readInt();
        } else if (opcode === 2) {
            this.sequenceId = buffer.readUnsignedShort();
        } else if (opcode === 4) {
            this.widthScale = buffer.readUnsignedShort();
        } else if (opcode === 5) {
            this.heightScale = buffer.readUnsignedShort();
        } else if (opcode === 6) {
            this.orientation = buffer.readUnsignedShort();
        } else if (opcode === 7) {
            this.ambient = buffer.readUnsignedByte();
        } else if (opcode === 8) {
            this.contrast = buffer.readUnsignedByte();
        } else if (opcode === 10) {
            // A flag with no data (rev 242 Surge impacts set it); its meaning is not needed here.
            this.flag10 = true;
        } else if (opcode === 40 || opcode === 41) {
            const count = buffer.readUnsignedByte();
            const from: number[] = [];
            const to: number[] = [];
            for (let i = 0; i < count; i++) {
                from.push(buffer.readUnsignedShort());
                to.push(buffer.readUnsignedShort());
            }
            if (opcode === 40) {
                this.recolorFrom = from;
                this.recolorTo = to;
            } else {
                this.retextureFrom = from;
                this.retextureTo = to;
            }
        } else {
            throw new Error(`Unknown spotanim opcode ${opcode}`);
        }
    }
}

export type SpotAnimTypeLoader = TypeLoader<SpotAnimType>;

export class ArchiveSpotAnimTypeLoader extends ArchiveTypeLoader<SpotAnimType> implements SpotAnimTypeLoader {
    constructor(cacheInfo: CacheInfo, archive: Archive) {
        super(SpotAnimType, cacheInfo, archive);
    }
}
