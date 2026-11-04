import { describe, expect, it } from "vitest";

import { CacheInfo } from "../../cache/CacheInfo";
import { ByteBuffer } from "../../io/ByteBuffer";
import { NpcType } from "./NpcType";

const osrs242: CacheInfo = {
    name: "osrs-242",
    game: "oldschool",
    environment: "live",
    revision: 242,
    timestamp: "2026-11-03T10:00:06.309579Z",
    size: 0,
};

function decode(id: number, bytes: string) {
    const buffer = new ByteBuffer(new Int8Array(Buffer.from(bytes.replace(/\s/g, ""), "hex")));
    const npc = new NpcType(id, osrs242);
    npc.decode(buffer);
    return { npc, buffer };
}

// The byte strings are real NPC definitions from the rev 242 cache (config archive 9).
const BLACK_DEMON =
    "0c030e003f0d00424a00914b00984c00944d009d1f41747461636b001201137c01cb5f00ac2806038e038203900004079200080716000c069a00100000145602426c61636b2064656d6f6e003d05000043df000043ef000043e8000043f7000043eef9040000001a0000000100000008fffffff60000002e000064ac000000320000001e00";
const MAN =
    "0c011103330334033503360d03284a00014b00014c00014d00071f41747461636b00205069636b706f636b6574001e54616c6b2d746f0012010a5f000228041a8e13182225a8986296191e12120008024d616e003d08000000d7000000f600006f630000014600006808000000b100002f6a000000b53e0100000035f90500000005ffffffeb00000006ffffffeb00000007ffffffeb00000008ffffffeb0000001a0000000200";
const MULTI_NPC =
    "0e00db0d00de635f00006a015affff0affffffffffffffffffffffffffffffffffffffff001700";

describe("NpcType (rev 242)", () => {
    it("reads opcode 124 as a 16-bit height (Black demon, id 240)", () => {
        // Before the fix this threw "Opcode 124 not implemented" for 43 NPC definitions.
        const { npc, buffer } = decode(240, BLACK_DEMON);

        expect(npc.name).toBe("Black demon");
        expect(npc.height).toBe(459);
        expect(npc.size).toBe(3);
        expect(npc.idleSeqId).toBe(66);
        expect(npc.walkSeqId).toBe(63);
        expect(npc.combatLevel).toBe(172);
        expect(npc.modelIds).toEqual([17375, 17391, 17384, 17399, 17390]);
        expect(npc.actions[1]).toBe("Attack");
        expect(buffer.offset).toBe(buffer._data.length);
    });

    it("reads a regular NPC with recolors and four walk animations (Man, id 3106)", () => {
        const { npc, buffer } = decode(3106, MAN);

        expect(npc.name).toBe("Man");
        expect(npc.size).toBe(1);
        expect(npc.idleSeqId).toBe(808);
        expect([npc.walkSeqId, npc.walkBackSeqId, npc.walkLeftSeqId, npc.walkRightSeqId]).toEqual([
            819, 820, 821, 822,
        ]);
        expect(npc.combatLevel).toBe(2);
        expect(npc.actions.slice(0, 3)).toEqual(["Talk-to", "Attack", "Pickpocket"]);
        expect(npc.modelIds).toEqual([215, 246, 28515, 326, 26632, 177, 12138, 181]);
        expect(npc.recolorFrom).toEqual([6798, 8741, 25238, 4626]);
        expect(npc.recolorTo).toEqual([4888, 43160, 6430, 8]);
        expect(npc.height).toBe(-1);
        expect(buffer.offset).toBe(buffer._data.length);
    });

    it("defaults rotation speed and spawn direction", () => {
        const { npc } = decode(3106, MAN);

        expect(npc.rotationSpeed).toBe(32);
        expect(npc.spawnDirection).toBe(6);
    });

    it("reads multi-NPC transforms (id 25, varbit 346)", () => {
        const { npc, buffer } = decode(25, MULTI_NPC);

        expect(npc.transformVarbit).toBe(346);
        expect(npc.transformVarp).toBe(-1);
        expect(npc.transforms).toEqual([-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 23, -1]);
        expect(buffer.offset).toBe(buffer._data.length);
    });

    it("resolves a transform from the varbit value, or undefined when it is -1", () => {
        const { npc } = decode(25, MULTI_NPC);
        const loaded: number[] = [];
        const loader = {
            load: (id: number) => {
                loaded.push(id);
                return new NpcType(id, osrs242);
            },
            getCount: () => 0,
            clearCache: () => {},
        };
        const vars = (value: number) => ({ getVarbit: () => value, getVarp: () => 0 });

        expect(npc.transform(vars(10), loader)?.id).toBe(23);
        expect(npc.transform(vars(0), loader)).toBeUndefined();
        // Out of range uses the last entry (the default), which is -1 here.
        expect(npc.transform(vars(999), loader)).toBeUndefined();
        expect(loaded).toEqual([23]);
    });
});
