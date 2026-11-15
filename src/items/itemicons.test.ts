import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { addShadow, iconMatrix, modelHeightOf } from "./ItemIcons";

describe("iconMatrix", () => {
    it("puts the model origin in front of the camera at the zoom distance", () => {
        const m = iconMatrix({ zoom: 1000, xan: 0, yan: 0, zan: 0, xOffset: 0, yOffset: 0 }, 100);
        const p = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
        expect(p.x).toBeCloseTo(0);
        expect(p.y).toBeCloseTo(-50 / 128);
        expect(p.z).toBeCloseTo(-1000 / 128);
    });

    it("tilts the model by xan: a quarter turn swings the offset around", () => {
        // xan 512 = 90 degrees: the camera offset (0, h/2 + zoom, 0) turns about X into (0, 0, h/2 + zoom).
        const m = iconMatrix({ zoom: 1000, xan: 512, yan: 0, zan: 0, xOffset: 0, yOffset: 0 }, 0);
        const p = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
        expect(p.y).toBeCloseTo(0);
        expect(p.z).toBeCloseTo(-1000 / 128, 5);
    });
});

describe("modelHeightOf", () => {
    it("is the highest vertex above the origin (RS y is down)", () => {
        const part = (ys: number[]) => ({ positions: new Int16Array(ys.flatMap((y) => [0, y, 0, 0])) });
        expect(modelHeightOf({ opaque: part([-40, 10]), transparent: part([-60]) } as never)).toBe(60);
    });
});

describe("addShadow", () => {
    it("shades the transparent pixel down and to the right of an opaque one", () => {
        const pixels = new Uint8ClampedArray(3 * 3 * 4);
        pixels.set([255, 0, 0, 255], 0); // pixel (0, 0)
        addShadow(pixels, 3, 3);
        expect([...pixels.slice(16, 20)]).toEqual([0x30, 0x20, 0x20, 0xff]); // pixel (1, 1)
        expect(pixels[3 * 4 + 3]).toBe(0); // pixel (0, 1) stays clear
    });
});
