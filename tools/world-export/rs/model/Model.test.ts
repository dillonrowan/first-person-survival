import { describe, expect, it } from "vitest";

import { Model } from "./Model";
import { SeqBase } from "./seq/SeqBase";
import { SeqFrame } from "./seq/SeqFrame";
import { SeqTransformType } from "./seq/SeqTransformType";

const T = SeqTransformType;

function base(types: SeqTransformType[], labels: number[][]): SeqBase {
    return new SeqBase(
        1,
        types.length,
        types,
        types.map(() => true),
        // Masks must be fully set, otherwise transform() skips the group.
        new Uint16Array(types.length).fill(0xffff),
        labels,
    );
}

function frame(
    seqBase: SeqBase,
    transforms: { group: number; x: number; y: number; z: number }[],
): SeqFrame {
    return new SeqFrame(
        0,
        seqBase,
        transforms.length,
        transforms.map((t) => t.group),
        transforms.map((t) => t.x),
        transforms.map((t) => t.y),
        transforms.map((t) => t.z),
        transforms.map(() => -1),
        false,
    );
}

/** A model with vertices at the given positions, all in vertex label group 0. */
function model(vertices: [number, number, number][], labels: number[][] = [[...vertices.keys()]]) {
    const m = new Model();
    m.verticesCount = vertices.length;
    m.verticesX = Int32Array.from(vertices.map((v) => v[0]));
    m.verticesY = Int32Array.from(vertices.map((v) => v[1]));
    m.verticesZ = Int32Array.from(vertices.map((v) => v[2]));
    m.vertexLabels = labels.map((l) => Int32Array.from(l));
    return m;
}

const positions = (m: Model) =>
    Array.from({ length: m.verticesCount }, (_, i) => [m.verticesX[i], m.verticesY[i], m.verticesZ[i]]);

describe("Model.animate", () => {
    it("translates only the vertices of the labelled group", () => {
        const m = model(
            [
                [0, 0, 0],
                [10, 10, 10],
            ],
            [[0], [1]],
        );
        const b = base([T.TRANSLATE], [[1]]);

        m.animate(frame(b, [{ group: 0, x: 5, y: -3, z: 2 }]), undefined, false);

        expect(positions(m)).toEqual([
            [0, 0, 0],
            [15, 7, 12],
        ]);
    });

    it("ignores labels the model does not have", () => {
        const m = model([[1, 2, 3]]);
        const b = base([T.TRANSLATE], [[7]]);

        m.animate(frame(b, [{ group: 0, x: 5, y: 5, z: 5 }]), undefined, false);

        expect(positions(m)).toEqual([[1, 2, 3]]);
    });

    it("rotates around the centre of the ORIGIN group (64 = a quarter turn about y)", () => {
        const m = model([
            [0, 0, 0],
            [200, 0, 0],
        ]);
        const b = base([T.ORIGIN, T.ROTATE], [[0], [0]]);

        m.animate(
            frame(b, [
                { group: 0, x: 0, y: 0, z: 0 },
                { group: 1, x: 0, y: 64, z: 0 },
            ]),
            undefined,
            false,
        );

        // The centre is (100, 0, 0); (x, z) offsets (-100, 0) and (100, 0) become (0, 100) and (0, -100).
        expect(positions(m)).toEqual([
            [100, 0, 100],
            [100, 0, -100],
        ]);
    });

    it("rotates half a turn", () => {
        const m = model([
            [10, 0, 30],
            [30, 0, 10],
        ]);
        const b = base([T.ORIGIN, T.ROTATE], [[0], [0]]);

        m.animate(
            frame(b, [
                { group: 0, x: 0, y: 0, z: 0 },
                { group: 1, x: 0, y: 128, z: 0 },
            ]),
            undefined,
            false,
        );

        expect(positions(m)).toEqual([
            [30, 0, 10],
            [10, 0, 30],
        ]);
    });

    it("scales relative to the origin (128 = unchanged)", () => {
        const m = model([
            [0, 0, 0],
            [200, 0, 0],
        ]);
        const b = base([T.ORIGIN, T.SCALE], [[0], [0]]);

        m.animate(
            frame(b, [
                { group: 0, x: 0, y: 0, z: 0 },
                { group: 1, x: 256, y: 128, z: 128 },
            ]),
            undefined,
            false,
        );

        expect(positions(m)).toEqual([
            [-100, 0, 0],
            [300, 0, 0],
        ]);
    });

    it("adds 8 per unit to face alpha and clamps it", () => {
        const m = model([[0, 0, 0]]);
        m.faceCount = 2;
        m.faceLabels = [Int32Array.from([0, 1])];
        m.faceAlphas = Int8Array.from([100, -6]); // 100 and 250
        const b = base([T.ALPHA], [[0]]);

        m.animate(frame(b, [{ group: 0, x: 2, y: 0, z: 0 }]), undefined, false);

        expect(Array.from(m.faceAlphas, (a) => a & 0xff)).toEqual([116, 255]);
    });

    it("does nothing for a model without animation labels", () => {
        const m = model([[1, 2, 3]]);
        m.vertexLabels = undefined as never;
        const b = base([T.TRANSLATE], [[0]]);

        m.animate(frame(b, [{ group: 0, x: 5, y: 5, z: 5 }]), undefined, false);

        expect(positions(m)).toEqual([[1, 2, 3]]);
    });
});
