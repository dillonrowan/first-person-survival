import { describe, expect, it } from "vitest";

import { FaceColors } from "./FaceColors";
import { NpcModelBuilder } from "./NpcModelBuilder";
import { NpcAppearanceTask } from "./NpcSpawns";
import { CacheInfo } from "./rs/cache/CacheInfo";
import { NpcType } from "./rs/config/npctype/NpcType";
import { SeqType } from "./rs/config/seqtype/SeqType";
import { Model } from "./rs/model/Model";

const osrs242: CacheInfo = {
    name: "osrs-242",
    game: "oldschool",
    environment: "live",
    revision: 242,
    timestamp: "",
    size: 0,
};

const textureLoader = {
    getTextureIds: () => [10, 20],
    isTransparent: (id: number) => id === 20,
};
const colors = new FaceColors(textureLoader);

/** Four vertices; face 0 opaque, face 1 hidden, face 2 translucent (alpha 127). */
function baseModel(): Model {
    const m = new Model();
    m.verticesCount = 4;
    m.verticesX = Int32Array.from([0, 100, 0, 100]);
    m.verticesY = Int32Array.from([0, 0, -100, -100]);
    m.verticesZ = Int32Array.from([0, 0, 0, 0]);
    m.faceCount = 3;
    m.indices1 = Int32Array.from([0, 0, 1]);
    m.indices2 = Int32Array.from([1, 1, 2]);
    m.indices3 = Int32Array.from([2, 3, 3]);
    m.faceColors1 = Int32Array.from([1000, 1000, 2000]);
    m.faceColors2 = Int32Array.from([1000, 1000, 2000]);
    m.faceColors3 = Int32Array.from([1000, -2, 2000]);
    m.faceAlphas = Int8Array.from([0, 0, 128]);
    return m;
}

function seq(frameLengths: number[], extra: Partial<SeqType> = {}): SeqType {
    const s = new SeqType(1, osrs242);
    s.frameIds = frameLengths.map((_, i) => i);
    s.frameLengths = frameLengths;
    Object.assign(s, extra);
    return s;
}

const task = (idleSeqId: number, walkSeqId = -1): NpcAppearanceTask => ({
    id: 1,
    displayId: 1,
    name: "Thing",
    size: 1,
    combatLevel: 1,
    rotationSpeed: 32,
    file: "npcs/1_1.bin",
    idleSeqId,
    walkSeqId,
});

function builder(opts: { base?: Model | undefined; seqs?: Record<number, SeqType> } = {}) {
    const base = "base" in opts ? opts.base : baseModel();
    const display = new NpcType(1, osrs242);
    const seqs = opts.seqs ?? {};
    return new NpcModelBuilder(
        { load: () => display },
        {
            getModel: (_type, seqId, frame) => {
                if (!base) {
                    return undefined;
                }
                if (seqId === -1) {
                    return base;
                }
                // Each frame moves the whole model right by (frame + 1) * 10.
                const moved = baseModel();
                moved.verticesX = base.verticesX.map((x) => x + (frame + 1) * 10);
                return moved;
            },
        },
        { load: (id: number) => seqs[id] ?? new SeqType(id, osrs242) },
        colors,
        textureLoader,
    );
}

describe("NpcModelBuilder", () => {
    it("splits visible faces into opaque and translucent meshes and skips hidden faces", () => {
        const model = builder().build(task(-1))!;

        expect(model.vertexCount).toBe(4);
        expect(Array.from(model.opaque.sources)).toEqual([0, 1, 2]);
        expect(Array.from(model.opaque.indices)).toEqual([0, 1, 2]);
        expect(Array.from(model.transparent.sources)).toEqual([1, 2, 3]);
        // Alpha is the last colour byte: opaque 255, translucent 255 - 128.
        expect(model.opaque.colors[3]).toBe(255);
        expect(model.transparent.colors[3]).toBe(127);
        // Base pose positions are the model's own.
        expect(Array.from(model.opaque.positions.slice(4, 7))).toEqual([100, 0, 0]);
    });

    it("gives vertices shared between faces one mesh vertex when colour matches", () => {
        const m = baseModel();
        // Face 1 becomes visible and shares all three corners with face 0.
        m.faceColors3[1] = 1000;
        const model = builder({ base: m }).build(task(-1))!;

        expect(model.opaque.sources.length).toBe(4);
        expect(model.opaque.indices.length).toBe(6);
    });

    it("bakes the idle animation with frame positions and lengths", () => {
        const model = builder({ seqs: { 5: seq([3, 0], { frameStep: 1 }) } }).build(task(5))!;

        expect(model.idle).toBeDefined();
        expect(model.walk).toBeUndefined();
        expect(Array.from(model.idle!.frameLengths)).toEqual([3, 1]); // a length of 0 becomes 1
        expect(model.idle!.frameStep).toBe(1);
        const { positions } = model.idle!;
        expect(positions.length).toBe(2 * 4 * 3);
        // Vertex 1 (x = 100) in frame 0 and frame 1.
        expect(Array.from(positions.slice(3, 6))).toEqual([110, 0, 0]);
        expect(Array.from(positions.slice(12 + 3, 12 + 6))).toEqual([120, 0, 0]);
    });

    it("bakes a walk animation next to the idle one", () => {
        const model = builder({ seqs: { 5: seq([2]), 6: seq([1, 1, 1]) } }).build(task(5, 6))!;

        expect(model.idle!.frameLengths.length).toBe(1);
        expect(model.walk!.frameLengths.length).toBe(3);
    });

    it("leaves skeletal and missing animations out", () => {
        const model = builder({ seqs: { 5: seq([2], { skeletalId: 7 }) } }).build(task(5, 99))!;

        expect(model.idle).toBeUndefined();
        expect(model.walk).toBeUndefined();
    });

    it("computes bounds over every frame, in tiles with +y up and north as -z", () => {
        const still = builder().build(task(-1))!;
        const animated = builder({ seqs: { 5: seq([1]) } }).build(task(5))!;

        // Base: x 0..100, y 0..100 (up), so the centre is (50, 50) in RS units.
        expect(still.bounds[0]).toBeCloseTo(50 / 128);
        expect(still.bounds[1]).toBeCloseTo(50 / 128);
        // The frame is shifted by 10 units, so the box grows.
        expect(animated.bounds[3]).toBeGreaterThan(still.bounds[3]);
    });

    it("returns nothing when there is no model or no visible face", () => {
        const empty = baseModel();
        empty.faceColors3.fill(-2);

        expect(builder({ base: undefined }).build(task(-1))).toBeUndefined();
        expect(builder({ base: empty }).build(task(-1))).toBeUndefined();
    });
});

describe("FaceColors", () => {
    it("maps cache texture ids to layers after the white layer 0", () => {
        expect(colors.textureLayer(-1)).toBe(0);
        expect(colors.textureLayer(10)).toBe(1);
        expect(colors.textureLayer(20)).toBe(2);
        expect(colors.textureLayer(999)).toBe(0);
    });

    it("uses the palette for plain faces and grey from lightness for textured ones", () => {
        const plain = colors.hslToRgba(1000, 0, 0xff);
        const textured = colors.hslToRgba(127, 1, 0xff);

        expect(plain & 0xff).toBe(0xff);
        expect(plain >>> 8).not.toBe(0);
        expect(textured).toBe(0xffffffff);
        expect(colors.hslToRgba(0, 1, 0x80)).toBe(0x00000080);
    });
});
