import { describe, expect, it } from "vitest";

import { CacheInfo } from "../../cache/CacheInfo";
import { ByteBuffer } from "../../io/ByteBuffer";
import { SeqType } from "./SeqType";

const osrs242: CacheInfo = {
    name: "osrs-242",
    game: "oldschool",
    environment: "live",
    revision: 242,
    timestamp: "2026-11-03T10:00:06.309579Z",
    size: 0,
};

function decode(id: number, bytes: string) {
    const buffer = new ByteBuffer(new Int8Array(Buffer.from(bytes, "hex")));
    const seq = new SeqType(id, osrs242);
    seq.decode(buffer);
    return { seq, buffer };
}

// Real sequences from the rev 242 cache (config archive 12): Man idle and walk.
const MAN_IDLE =
    "100801000c001500150015001500150015001500150015001500150015000100020003000400050006000700080009000a000b000c0c740c740c740c740c740c740c740c740c740c740c740c7400";
const MAN_WALK =
    "100801000800060006000600060006000600060006000100020003000400050006000700082ae92ae92ae92ae92ae92ae92ae92ae900";

describe("SeqType (rev 242)", () => {
    it("decodes the frame list of Man's idle animation (seq 808)", () => {
        const { seq, buffer } = decode(808, MAN_IDLE);

        expect(seq.frameLengths).toEqual(Array(12).fill(21));
        // Frame ids are (frame group << 16) | file: group 3188, files 1..12.
        expect(seq.frameIds).toEqual(Array.from({ length: 12 }, (_, i) => (3188 << 16) | (i + 1)));
        expect(seq.frameStep).toBe(-1);
        expect(seq.isSkeletalSeq()).toBe(false);
        expect(buffer.offset).toBe(buffer._data.length);
    });

    it("decodes Man's walk animation (seq 819)", () => {
        const { seq, buffer } = decode(819, MAN_WALK);

        expect(seq.frameLengths).toEqual(Array(8).fill(6));
        expect(seq.frameIds.map((id) => id >> 16)).toEqual(Array(8).fill(10985));
        expect(seq.frameIds.map((id) => id & 0xffff)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(buffer.offset).toBe(buffer._data.length);
    });
});
