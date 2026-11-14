import { CacheInfo } from "../../cache/CacheInfo";
import { ByteBuffer } from "../../io/ByteBuffer";
import { ParamsMap, Type } from "../Type";

/**
 * An item definition (config archive 10), Old School opcodes as of revision 242. Revision 242
 * stores model ids as ints (opcodes 44-55) next to the older short-id opcodes.
 */
export class ObjType extends Type {
    name = "null";
    inventoryModel = -1;
    /** Worn models: what a player holds or wears. */
    maleModel0 = -1;
    maleModel1 = -1;
    maleModel2 = -1;
    /** Y translation of the worn model, RS units. */
    maleOffset = 0;
    /** Equipment slot (3 is the weapon slot), -1 when it cannot be worn. */
    wearPos1 = -1;
    wearPos2 = -1;
    wearPos3 = -1;
    /** Item category (darts, spears, staves...), -1 when none. */
    category = -1;
    recolorFrom?: number[];
    recolorTo?: number[];
    retextureFrom?: number[];
    retextureTo?: number[];
    ambient = 0;
    contrast = 0;
    options: (string | undefined)[] = [undefined, undefined, "Take", undefined, undefined];
    inventoryOptions: (string | undefined)[] = [undefined, undefined, undefined, undefined, "Drop"];
    noteTemplate = -1;
    placeholderTemplate = -1;
    boughtTemplate = -1;
    params?: ParamsMap;
    /** Stacks in the inventory. */
    stackable = false;
    examine = "";
    /** Inventory icon camera: zoom, the three angles (2048 per turn) and the 2D offsets. */
    zoom2d = 2000;
    xan2d = 0;
    yan2d = 0;
    zan2d = 0;
    xOffset2d = 0;
    yOffset2d = 0;
    /** Inventory and ground model scale, 128 = 1. */
    resizeX = 128;
    resizeY = 128;
    resizeZ = 128;
    value = 1;

    constructor(id: number, cacheInfo: CacheInfo) {
        super(id, cacheInfo);
    }

    /** A note, placeholder or bought copy of another item, drawn from a template. */
    get isTemplated(): boolean {
        return this.noteTemplate !== -1 || this.placeholderTemplate !== -1 || this.boughtTemplate !== -1;
    }

    override decodeOpcode(opcode: number, buffer: ByteBuffer): void {
        if (opcode === 1) {
            this.inventoryModel = buffer.readUnsignedShort();
        } else if (opcode === 2) {
            this.name = this.readString(buffer);
        } else if (opcode === 3) {
            this.examine = this.readString(buffer);
        } else if (opcode === 9) {
            // Bank filler name.
            this.readString(buffer);
        } else if (opcode === 4) {
            this.zoom2d = buffer.readUnsignedShort();
        } else if (opcode === 5) {
            this.xan2d = buffer.readUnsignedShort();
        } else if (opcode === 6) {
            this.yan2d = buffer.readUnsignedShort();
        } else if (opcode === 7) {
            const v = buffer.readUnsignedShort();
            this.xOffset2d = v > 32767 ? v - 65536 : v;
        } else if (opcode === 8) {
            const v = buffer.readUnsignedShort();
            this.yOffset2d = v > 32767 ? v - 65536 : v;
        } else if (opcode === 44) {
            this.inventoryModel = buffer.readInt();
        } else if (opcode === 45) {
            this.maleModel0 = buffer.readInt();
            this.maleOffset = buffer.readUnsignedByte();
        } else if (opcode === 46) {
            this.maleModel1 = buffer.readInt();
        } else if (opcode === 47) {
            this.maleModel2 = buffer.readInt();
        } else if (opcode === 48) {
            buffer.readInt();
            buffer.readUnsignedByte();
        } else if (opcode >= 49 && opcode <= 55) {
            // Female worn models and head models with int ids (revision 242+). Sizes inferred
            // from the cache: every obj decodes with no bytes left over.
            buffer.readInt();
        } else if (opcode === 11) {
            this.stackable = true;
        } else if (opcode === 15 || opcode === 16 || opcode === 65 || opcode === 160 ||
            opcode === 161 || opcode === 251) {
            // Flags: members, tradeable and newer ones without a payload.
        } else if (opcode === 12) {
            this.value = buffer.readInt();
        } else if (opcode === 13) {
            this.wearPos1 = buffer.readUnsignedByte();
        } else if (opcode === 14) {
            this.wearPos2 = buffer.readUnsignedByte();
        } else if (opcode === 23) {
            this.maleModel0 = buffer.readUnsignedShort();
            this.maleOffset = buffer.readUnsignedByte();
        } else if (opcode === 24) {
            this.maleModel1 = buffer.readUnsignedShort();
        } else if (opcode === 25) {
            buffer.readUnsignedShort();
            buffer.readUnsignedByte();
        } else if (opcode === 26) {
            buffer.readUnsignedShort();
        } else if (opcode === 27) {
            this.wearPos3 = buffer.readUnsignedByte();
        } else if (opcode >= 30 && opcode < 35) {
            const option = this.readString(buffer);
            this.options[opcode - 30] = option.toLowerCase() === "hidden" ? undefined : option;
        } else if (opcode >= 35 && opcode < 40) {
            this.inventoryOptions[opcode - 35] = this.readString(buffer);
        } else if (opcode === 40) {
            const count = buffer.readUnsignedByte();
            this.recolorFrom = new Array<number>(count);
            this.recolorTo = new Array<number>(count);
            for (let i = 0; i < count; i++) {
                this.recolorFrom[i] = buffer.readUnsignedShort();
                this.recolorTo[i] = buffer.readUnsignedShort();
            }
        } else if (opcode === 41) {
            const count = buffer.readUnsignedByte();
            this.retextureFrom = new Array<number>(count);
            this.retextureTo = new Array<number>(count);
            for (let i = 0; i < count; i++) {
                this.retextureFrom[i] = buffer.readUnsignedShort();
                this.retextureTo[i] = buffer.readUnsignedShort();
            }
        } else if (opcode === 42) {
            buffer.readByte();
        } else if (opcode === 43) {
            // Sub-options of one inventory option, terminated by 0.
            buffer.readUnsignedByte();
            while (buffer.readUnsignedByte() !== 0) {
                this.readString(buffer);
            }
        } else if (opcode === 75) {
            buffer.readShort();
        } else if (opcode === 78) {
            this.maleModel2 = buffer.readUnsignedShort();
        } else if (opcode === 94) {
            this.category = buffer.readUnsignedShort();
        } else if (opcode === 95) {
            this.zan2d = buffer.readUnsignedShort();
        } else if (opcode === 79 || (opcode >= 90 && opcode <= 94)) {
            // Female third model, head models.
            buffer.readUnsignedShort();
        } else if (opcode === 97) {
            buffer.readUnsignedShort();
        } else if (opcode === 98) {
            this.noteTemplate = buffer.readUnsignedShort();
        } else if (opcode >= 100 && opcode < 110) {
            buffer.readUnsignedShort();
            buffer.readUnsignedShort();
        } else if (opcode >= 110 && opcode <= 112) {
            // Ground/inventory model resize; worn models are not resized.
            const v = buffer.readUnsignedShort();
            if (opcode === 110) this.resizeX = v;
            else if (opcode === 111) this.resizeY = v;
            else this.resizeZ = v;
        } else if (opcode === 113) {
            this.ambient = buffer.readByte();
        } else if (opcode === 114) {
            this.contrast = buffer.readByte();
        } else if (opcode === 115) {
            buffer.readUnsignedByte();
        } else if (opcode === 139 || opcode === 148) {
            buffer.readUnsignedShort();
        } else if (opcode === 140) {
            this.boughtTemplate = buffer.readUnsignedShort();
        } else if (opcode === 149) {
            this.placeholderTemplate = buffer.readUnsignedShort();
        } else if (opcode === 249) {
            this.params = Type.readParamsMap(buffer, this.params);
        } else {
            throw new Error(`Unknown obj opcode ${opcode}`);
        }
    }
}
