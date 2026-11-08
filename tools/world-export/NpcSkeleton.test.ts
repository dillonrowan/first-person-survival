import { describe, expect, it } from "vitest";

import { decodeNpcModel, encodeNpcModel, NpcModelData } from "../../src/world/NpcFormat";
import { buildSkeleton } from "./NpcSkeleton";
import { SeqTransformType } from "./rs/model/seq/SeqTransformType";

const { ORIGIN, ROTATE } = SeqTransformType;

/**
 * A stick figure of labelled vertex groups (4 vertices each): 0 torso, 1 thigh, 2 shin, 3 head.
 * The frame base turns the whole body around the torso, the leg (thigh + shin) around the hip
 * (label 4, a joint marker), the shin around the knee (label 5) and the head around the neck (6).
 */
function figure() {
    const groups: [number, number, number][][] = [
        [[0, -100, 0], [20, -100, 0], [0, -200, 0], [20, -200, 0]], // torso
        [[0, -50, 0], [10, -50, 0], [0, -100, 0], [10, -100, 0]], // thigh
        [[0, 0, 0], [10, 0, 0], [0, -50, 0], [10, -50, 0]], // shin
        [[0, -200, 0], [10, -200, 0], [0, -240, 0], [10, -240, 0]], // head
        [[5, -100, 0]], // hip marker
        [[5, -50, 0]], // knee marker
        [[5, -200, 0]], // neck marker
    ];
    const vx: number[] = [];
    const vy: number[] = [];
    const vz: number[] = [];
    const labels: number[][] = [];
    for (const group of groups) {
        labels.push(group.map((_, i) => vx.length + i));
        for (const [x, y, z] of group) {
            vx.push(x);
            vy.push(y);
            vz.push(z);
        }
    }
    const base = {
        types: [ORIGIN, ROTATE, ORIGIN, ROTATE, ORIGIN, ROTATE, ORIGIN, ROTATE],
        labels: [[0], [0, 1, 2, 3], [4], [1, 2], [5], [2], [6], [3]],
    };
    return { labels, vx, vy, vz, count: vx.length, base };
}

describe("ragdoll skeleton from labels and a frame base (spec 20.2)", () => {
    it("splits rigid parts, hangs them in a tree and puts joints at the ORIGIN centroids", () => {
        const f = figure();
        const s = buildSkeleton(f.labels, f.vx, f.vy, f.vz, f.count, f.base);

        expect(s.parents.length).toBe(4);
        expect(s.parents[0]).toBe(-1);
        const partOf = (v: number) => s.partOf[v];
        const torso = partOf(0);
        const thigh = partOf(4);
        const shin = partOf(8);
        const head = partOf(12);
        expect(torso).toBe(0);
        expect(s.parents[thigh]).toBe(torso);
        expect(s.parents[shin]).toBe(thigh);
        expect(s.parents[head]).toBe(torso);
        // The knee joint is the knee marker; the hip the hip marker.
        expect(Array.from(s.pivots.slice(shin * 3, shin * 3 + 3))).toEqual([5, -50, 0]);
        expect(Array.from(s.pivots.slice(thigh * 3, thigh * 3 + 3))).toEqual([5, -100, 0]);
    });

    it("is one part without labels or a frame base", () => {
        const f = figure();
        expect(buildSkeleton(undefined, f.vx, f.vy, f.vz, f.count, f.base).parents.length).toBe(1);
        expect(buildSkeleton(f.labels, f.vx, f.vy, f.vz, f.count, undefined).parents.length).toBe(1);
    });

    it("survives the NPC file format", () => {
        const f = figure();
        const skeleton = buildSkeleton(f.labels, f.vx, f.vy, f.vz, f.count, f.base);
        const empty = { positions: new Int16Array(0), colors: new Uint8Array(0), uvs: new Int16Array(0), sources: new Uint16Array(0), indices: new Uint32Array(0) };
        const model: NpcModelData = {
            vertexCount: f.count,
            bounds: new Float32Array(4),
            opaque: empty,
            transparent: empty,
            skeleton,
        };
        const bytes = encodeNpcModel(model);
        const decoded = decodeNpcModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
        expect(Array.from(decoded.skeleton!.parents)).toEqual(Array.from(skeleton.parents));
        expect(Array.from(decoded.skeleton!.pivots)).toEqual(Array.from(skeleton.pivots));
        expect(Array.from(decoded.skeleton!.partOf)).toEqual(Array.from(skeleton.partOf));
    });
});
