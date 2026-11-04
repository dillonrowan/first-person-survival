import { describe, expect, it } from "vitest";

import { CacheInfo } from "../../cache/CacheInfo";
import { ByteBuffer } from "../../io/ByteBuffer";
import { LocType } from "./LocType";

const osrs242: CacheInfo = {
    name: "osrs-242",
    game: "oldschool",
    environment: "live",
    revision: 242,
    timestamp: "2026-11-03T10:00:06.309579Z",
    size: 0,
};

const rs3: CacheInfo = { ...osrs242, name: "rs3-947", game: "runescape", revision: 947 };

function hex(bytes: string): ByteBuffer {
    return new ByteBuffer(new Int8Array(Buffer.from(bytes.replace(/\s/g, ""), "hex")));
}

function decode(id: number, bytes: string, info: CacheInfo = osrs242) {
    const buffer = hex(bytes);
    const loc = new LocType(id, info);
    loc.decode(buffer);
    return { loc, buffer };
}

describe("LocType transform opcodes (rev 242 24-bit loc ids)", () => {
    // The byte strings below are real loc definitions from the rev 242 cache. Before the fix,
    // opcodes 97 and 98 were treated as flags without data, so the decoder read their payload
    // as opcodes and threw "Opcode 255 not implemented" / "Buffer overflow".

    it("opcode 97 reads varbit, varp and a list of 24-bit ids (loc 0)", () => {
        // 19 01 | 97: varbit ffff, varp 0000, count 3, then 4 ids | end
        const { loc, buffer } = decode(0, "13 01 61 ffff 0000 03 ffffff ffffff ffffff 003cec 00");

        expect(loc.transformVarbit).toBe(-1);
        expect(loc.transformVarp).toBe(0);
        // 0xffffff means "no loc"; the last slot is the (absent) default.
        expect(loc.transforms).toEqual([-1, -1, -1, 0x3cec, -1]);
        expect(buffer.offset).toBe(buffer._data.length);
    });

    it("opcode 98 reads a 24-bit default id before the list (loc 2854)", () => {
        // 19 00 | 98: varbit 3985, varp ffff, default 00b5e5, count 1, 2 ids | end
        const { loc, buffer } = decode(2854, "13 00 62 3985 ffff 00b5e5 01 00b5e5 00b5e6 00");

        expect(loc.transformVarbit).toBe(0x3985);
        expect(loc.transformVarp).toBe(-1);
        expect(loc.transforms).toEqual([0xb5e5, 0xb5e6, 0xb5e5]);
        expect(buffer.offset).toBe(buffer._data.length);
    });

    it("keeps decoding the opcodes before and after a 97 block (loc 66)", () => {
        // 14 02 | 15 02 | 21 | 23 | 27 | 19 01 | 18 | 97: varbit 15fd, varp ffff, 4 ids | end
        const { loc, buffer } = decode(
            66,
            "0e02 0f02 15 17 1b 1301 12 61 15fd ffff 03 0075f7 0075f8 0075f8 0075f8 00",
        );

        expect(loc.sizeX).toBe(2);
        expect(loc.sizeY).toBe(2);
        expect(loc.transformVarbit).toBe(0x15fd);
        expect(loc.transforms).toEqual([0x75f7, 0x75f8, 0x75f8, 0x75f8, -1]);
        expect(buffer.offset).toBe(buffer._data.length);
    });

    it("handles large transform tables (loc 2005 had 100+ entries)", () => {
        // These used to fail with "Buffer overflow": the ids were read as opcodes.
        const count = 100;
        const ids = Array.from({ length: count }, (_, i) => 0x889500 + i);
        const body = ids.map((id) => id.toString(16).padStart(6, "0")).join("");

        const { loc, buffer } = decode(
            2005,
            `1301 62 2338 ffff 004400 ${(count - 1).toString(16).padStart(2, "0")} ${body} 00`,
        );

        expect(loc.transformVarbit).toBe(0x2338);
        expect(loc.transforms).toHaveLength(count + 1);
        expect(loc.transforms?.slice(0, count)).toEqual(ids);
        expect(loc.transforms?.[count]).toBe(0x4400);
        expect(buffer.offset).toBe(buffer._data.length);
    });
});

describe("LocType transform opcodes (existing behaviour)", () => {
    it("opcode 77 still reads 16-bit ids with no default", () => {
        const { loc, buffer } = decode(1, "4d 1234 ffff 01 0010 ffff 00");

        expect(loc.transformVarbit).toBe(0x1234);
        expect(loc.transformVarp).toBe(-1);
        expect(loc.transforms).toEqual([0x10, -1, -1]);
        expect(buffer.offset).toBe(buffer._data.length);
    });

    it("opcode 92 still reads a 16-bit default id", () => {
        const { loc } = decode(2, "5c ffff 0007 0020 01 0010 0011 00");

        expect(loc.transformVarbit).toBe(-1);
        expect(loc.transformVarp).toBe(7);
        expect(loc.transforms).toEqual([0x10, 0x11, 0x20]);
    });

    it("97 and 98 stay data-less flags for non-Old-School caches", () => {
        // In RS3 these are plain flags, so nothing after them may be consumed.
        const { loc, buffer } = decode(3, "61 62 00", rs3);

        expect(loc.transforms).toBeUndefined();
        expect(buffer.offset).toBe(3);
    });
});
