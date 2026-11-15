import { describe, expect, it } from "vitest";

import { CacheInfo } from "../../cache/CacheInfo";
import { ByteBuffer } from "../../io/ByteBuffer";
import { SpotAnimType } from "./SpotAnimType";

const osrs242: CacheInfo = {
    name: "osrs-242",
    game: "oldschool",
    environment: "live",
    revision: 242,
    timestamp: "2026-11-03T10:00:06.309579Z",
    size: 0,
};

function decode(id: number, bytes: string): SpotAnimType {
    const spot = new SpotAnimType(id, osrs242);
    spot.decode(new ByteBuffer(new Int8Array(Buffer.from(bytes, "hex"))));
    return spot;
}

// Real spot animations from the rev 242 cache (config archive 13).
describe("SpotAnimType (rev 242)", () => {
    it("decodes Wind Strike's projectile (91): int model id, sequence, lighting and recolours", () => {
        const spot = decode(91, "0300000c09020293071e081e2803039ea86f03b3007f2bc0abc000");
        expect(spot.modelId).toBe(3081);
        expect(spot.sequenceId).toBe(659);
        expect(spot.ambient).toBe(30);
        expect(spot.contrast).toBe(30);
        expect(spot.recolorFrom).toEqual([926, 947, 11200]);
        expect(spot.recolorTo).toEqual([43119, 127, 43968]);
        expect(spot.widthScale).toBe(128);
    });

    it("decodes Fire Surge's impact (1466), which sets the data-less opcode 10", () => {
        const spot = decode(1466, "0300000c2c0202b5073c083c0a00");
        expect(spot.modelId).toBe(3116);
        expect(spot.sequenceId).toBe(693);
        expect(spot.flag10).toBe(true);
        expect(spot.recolorFrom).toBeUndefined();
    });
});
