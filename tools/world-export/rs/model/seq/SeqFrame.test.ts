import { describe, expect, it } from "vitest";

import { CacheInfo } from "../../cache/CacheInfo";
import { Dat2SeqBase } from "./SeqBase";
import { Dat2SeqFrame } from "./SeqFrame";
import { SeqTransformType } from "./SeqTransformType";

const osrs242: CacheInfo = {
    name: "osrs-242",
    game: "oldschool",
    environment: "live",
    revision: 242,
    timestamp: "2026-11-03T10:00:06.309579Z",
    size: 0,
};

const bytes = (hex: string) => new Int8Array(Buffer.from(hex, "hex"));

// A real skeleton (animation base 2447, cache index 1) and a frame that uses it (index 0,
// group 210, file 4): the smallest such pair in the rev 242 cache.
const BASE = "050003020105010101010100000000000000";
const FRAME = "098f0300000700367f";

describe("animation bases and frames (rev 242)", () => {
    it("decodes a skeleton's transform types and labels", () => {
        const base = Dat2SeqBase.load(osrs242, 2447, bytes(BASE));

        expect(base.id).toBe(2447);
        expect(base.count).toBe(5);
        expect(base.types).toEqual([
            SeqTransformType.ORIGIN,
            SeqTransformType.SCALE,
            SeqTransformType.ROTATE,
            SeqTransformType.TRANSLATE,
            SeqTransformType.ALPHA,
        ]);
        expect(base.labels).toEqual([[0], [0], [0], [0], [0]]);
        // OSRS has no per-group masks: every group is fully enabled.
        expect(Array.from(base.masks)).toEqual(Array(5).fill(0xffff));
    });

    it("decodes a frame against its skeleton", () => {
        const base = Dat2SeqBase.load(osrs242, 2447, bytes(BASE));
        const loader = { load: (id: number) => (id === 2447 ? base : undefined), clearCache() {} };

        const frame = Dat2SeqFrame.load(osrs242, loader, bytes(FRAME));

        expect(frame.base).toBe(base);
        expect(frame.transformCount).toBe(1);
        // Only the ROTATE group (index 2) is animated: x -64, y -10, z 63.
        expect(frame.transformGroups).toEqual([2]);
        expect(frame.transformX).toEqual([-64]);
        expect(frame.transformY).toEqual([-10]);
        expect(frame.transformZ).toEqual([63]);
        expect(frame.resetOriginGroups).toEqual([0]);
        expect(frame.hasAlphaTransform).toBe(false);
        expect(frame.hasColorTransform).toBe(false);
    });

    it("rejects a frame whose skeleton is missing", () => {
        const loader = { load: () => undefined, clearCache() {} };

        expect(() => Dat2SeqFrame.load(osrs242, loader, bytes(FRAME))).toThrow(/Invalid frame base id: 2447/);
    });
});
