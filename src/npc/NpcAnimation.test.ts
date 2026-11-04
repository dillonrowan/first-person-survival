import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
    CLIENT_CYCLE_SECONDS,
    ClipPlayback,
    advanceClip,
    orientationToYaw,
    writeFramePositions,
} from "./NpcAnimation";

function framesShown(clip: { frameLengths: number[]; frameStep: number }, cycles: number) {
    const playback: ClipPlayback = { frame: 0, cycle: 0 };
    const shown: number[] = [];
    for (let i = 0; i < cycles; i++) {
        advanceClip(playback, { ...clip, frameLengths: Uint16Array.from(clip.frameLengths) }, 1);
        shown.push(playback.frame);
    }
    return shown;
}

describe("advanceClip", () => {
    it("shows each frame for its length in client cycles, then restarts", () => {
        expect(framesShown({ frameLengths: [2, 3], frameStep: -1 }, 7)).toEqual([0, 0, 1, 1, 1, 0, 0]);
    });

    it("steps back by frameStep after the last frame", () => {
        // With a step of 1 the last frame repeats instead of restarting.
        expect(framesShown({ frameLengths: [1, 1, 1], frameStep: 1 }, 6)).toEqual([0, 1, 2, 2, 2, 2]);
    });

    it("restarts at frame 0 when the step goes out of range", () => {
        expect(framesShown({ frameLengths: [1, 1], frameStep: 5 }, 4)).toEqual([0, 1, 0, 1]);
    });

    it("reports whether the frame changed and handles several cycles at once", () => {
        const clip = { frameLengths: Uint16Array.from([2, 2]), frameStep: -1 };
        const playback: ClipPlayback = { frame: 0, cycle: 0 };

        expect(advanceClip(playback, clip, 1)).toBe(false);
        expect(advanceClip(playback, clip, 2)).toBe(true);
        expect(playback).toEqual({ frame: 1, cycle: 1 });
        expect(advanceClip(playback, clip, 4)).toBe(false); // a full loop of 4 cycles
    });

    it("uses 20 ms client cycles", () => {
        expect(CLIENT_CYCLE_SECONDS).toBe(0.02);
    });
});

describe("writeFramePositions", () => {
    it("copies each mesh vertex's source position from the frame and leaves info alone", () => {
        // Two model vertices, two frames.
        const framePositions = Int16Array.from([1, 2, 3, 4, 5, 6, /* frame 1 */ 7, 8, 9, 10, 11, 12]);
        const sources = Uint16Array.from([1, 0, 1]);
        const target = Int16Array.from([0, 0, 0, 111, 0, 0, 0, 222, 0, 0, 0, 333]);

        writeFramePositions(target, sources, framePositions, 1, 2);

        expect(Array.from(target)).toEqual([10, 11, 12, 111, 7, 8, 9, 222, 10, 11, 12, 333]);
    });
});

describe("orientationToYaw", () => {
    // The model faces +z (south) at orientation 0; rotate its front vector with three.js.
    const facing = (orientation: number) => {
        const front = new THREE.Vector3(0, 0, 1).applyEuler(
            new THREE.Euler(0, orientationToYaw(orientation), 0),
        );
        // + 0 turns -0 into 0.
        return [Math.round(front.x) + 0, Math.round(front.z) + 0];
    };

    it("turns the model to face south, west, north and east", () => {
        expect(facing(0)).toEqual([0, 1]); // south is +z
        expect(facing(512)).toEqual([-1, 0]); // west is -x
        expect(facing(1024)).toEqual([0, -1]); // north is -z
        expect(facing(1536)).toEqual([1, 0]); // east is +x
    });
});
