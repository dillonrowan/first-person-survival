import { describe, expect, it } from "vitest";

import {
    NpcClip,
    NpcMeshData,
    NpcModelData,
    decodeNpcModel,
    encodeNpcModel,
    npcModelFileName,
} from "./NpcFormat";

function mesh(vertices: number): NpcMeshData {
    return {
        positions: Int16Array.from({ length: vertices * 4 }, (_, i) => i - 3),
        colors: Uint8Array.from({ length: vertices * 4 }, (_, i) => i * 7),
        uvs: Int16Array.from({ length: vertices * 2 }, (_, i) => -i * 100),
        sources: Uint16Array.from({ length: vertices }, (_, i) => vertices - i),
        indices: Uint32Array.from(vertices >= 3 ? [0, 1, 2] : []),
    };
}

function clip(frames: number, vertexCount: number): NpcClip {
    return {
        frameLengths: Uint16Array.from({ length: frames }, (_, i) => i + 1),
        frameStep: frames - 1,
        positions: Int16Array.from({ length: frames * vertexCount * 3 }, (_, i) => i * 3 - 50),
    };
}

function model(overrides: Partial<NpcModelData> = {}): NpcModelData {
    return {
        vertexCount: 5,
        bounds: Float32Array.from([1.5, 2.5, -3.5, 4]),
        opaque: mesh(3),
        transparent: mesh(0),
        ...overrides,
    };
}

/** Decodes from a buffer at offset 0, like the game does after gunzip. */
function roundTrip(data: NpcModelData): NpcModelData {
    const bytes = encodeNpcModel(data);
    return decodeNpcModel(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
}

const plain = (data: NpcModelData) => JSON.parse(JSON.stringify(data, (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as number[]) : v)));

describe("NPC model file", () => {
    it("names files by NPC id and displayed NPC id", () => {
        expect(npcModelFileName(3106, 3106)).toBe("3106_3106.bin");
        expect(npcModelFileName(100, 101)).toBe("100_101.bin");
    });

    it("round-trips meshes and clips, including odd-sized arrays that need padding", () => {
        // 3 mesh vertices (odd, so sources need padding) and 3 frames.
        const data = model({ transparent: mesh(5), idle: clip(3, 5), walk: clip(2, 5) });

        expect(plain(roundTrip(data))).toEqual(plain(data));
    });

    it("round-trips a model with only an idle clip and an empty transparent mesh", () => {
        const data = model({ idle: clip(1, 5) });
        const decoded = roundTrip(data);

        expect(decoded.walk).toBeUndefined();
        expect(decoded.transparent.indices.length).toBe(0);
        expect(plain(decoded)).toEqual(plain(data));
    });

    it("round-trips attack clips with their impact and shove flag", () => {
        const data = model({
            idle: clip(2, 5),
            skeleton: { parents: Int8Array.from([-1, 0]), pivots: Int16Array.from([0, -10, 0, 0, -20, 0]), partOf: Uint8Array.from([0, 0, 1, 1, 1]) },
            attacks: [
                { ...clip(3, 5), frameStep: -1, hitCycle: 4, shove: false, seqId: 80, style: "melee", launch: [0, 0] },
                { ...clip(1, 5), frameStep: -1, hitCycle: 1, shove: true, seqId: 86, style: "dragonfire", launch: [0.5, 1.25] },
                { ...clip(2, 5), frameStep: -1, hitCycle: 2, shove: false, seqId: -1, style: "icebreath", launch: [-0.25, 0] },
            ],
        });

        expect(plain(roundTrip(data))).toEqual(plain(data));
    });

    it("reads a version 3 file's attacks as melee clips with no sequence id or launch point", () => {
        // Version 3 had a 4-byte attack header (hitCycle, flags). Build one from a v4 file with no attacks.
        const base = encodeNpcModel(model({ idle: clip(2, 5) }));
        const body = base.slice(0, base.length - 4); // drop the u32 attackCount (0)
        const attackClip = clip(1, 5);
        const tail = new Uint8Array(4 + 4 + 8 + 4 + 32);
        const v = new DataView(tail.buffer);
        v.setUint32(0, 1, true); // attackCount
        v.setUint16(4, 7, true); // hitCycle
        v.setUint16(6, 1, true); // flags: shove
        v.setUint32(8, 1, true); // frameCount
        v.setInt32(12, -1, true); // frameStep
        v.setUint16(16, attackClip.frameLengths[0], true);
        attackClip.positions.forEach((p, i) => v.setInt16(20 + i * 2, p, true));
        const bytes = new Uint8Array(body.length + tail.length);
        bytes.set(body);
        bytes.set(tail, body.length);
        new DataView(bytes.buffer).setUint32(4, 3, true); // version

        const decoded = decodeNpcModel(bytes.buffer as ArrayBuffer);

        expect(decoded.attacks).toHaveLength(1);
        expect(decoded.attacks![0]).toMatchObject({ hitCycle: 7, shove: true, seqId: -1, style: "melee", launch: [0, 0], frameStep: -1 });
        expect(Array.from(decoded.attacks![0].positions)).toEqual(Array.from(attackClip.positions));
    });

    it("round-trips a model without clips", () => {
        const decoded = roundTrip(model());

        expect(decoded.idle).toBeUndefined();
        expect(decoded.walk).toBeUndefined();
    });

    it("rejects data that is not an NPC file or has another version", () => {
        const bytes = encodeNpcModel(model());
        const wrongMagic = bytes.slice();
        wrongMagic[0] ^= 0xff;
        const wrongVersion = bytes.slice();
        wrongVersion[4] = 99;

        expect(() => decodeNpcModel(wrongMagic.buffer as ArrayBuffer)).toThrow(/Not an NPC model/);
        expect(() => decodeNpcModel(wrongVersion.buffer as ArrayBuffer)).toThrow(/re-run npm run export-world/);
    });
});
