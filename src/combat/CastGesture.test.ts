import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { CAST_LENGTH, castFrame, castStrength, castStyle, CastStyle } from "./CastGesture";

/** Where main.ts plays the cast graphic, in the eye frame (CAST_VIEW_AHEAD, CAST_VIEW_BELOW). */
const CAST_GRAPHIC = new THREE.Vector3(0, -0.45, -0.9);
const STYLES: CastStyle[] = ["staff", "palms", "armed"];

/** How far the cast graphic is off the staff's shaft, and how far along it, at `t`. */
function throughShaft(t: number) {
    const f = castFrame("staff", t)!;
    const shaft = new THREE.Vector3(0, 1, 0).applyQuaternion(f.quat!);
    const along = CAST_GRAPHIC.clone().sub(f.grip).dot(shaft);
    return { along, miss: f.grip.clone().addScaledVector(shaft, along).distanceTo(CAST_GRAPHIC) };
}

describe("cast gesture", () => {
    it("drives the staff through the cast graphic at the thrust and while channelling", () => {
        for (const t of [0.06, 0.3]) {
            const { along, miss } = throughShaft(t);
            // Between the grip and the head (0.8 out).
            expect(along).toBeGreaterThan(0.2);
            expect(along).toBeLessThan(0.8);
            expect(miss).toBeLessThan(0.08);
        }
    });

    it("flings the staff head up with the recoil", () => {
        const head = (t: number) => {
            const f = castFrame("staff", t)!;
            return f.grip.clone().addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(f.quat!), 0.8);
        };
        expect(head(0.14).y - head(0.06).y).toBeGreaterThan(0.4);
    });

    it("casts with both hands in every style, the free hand on the staff's shaft", () => {
        for (const style of STYLES) {
            const f = castFrame(style, 0.06)!;
            expect(f.grip.z, style).toBeLessThan(-0.35);
            expect(f.offHand.z, style).toBeLessThan(-0.35);
            expect(f.grip.distanceTo(f.offHand), style).toBeLessThan(0.3);
        }
        for (const t of [0.06, 0.1, 0.2, 0.5]) {
            const f = castFrame("staff", t)!;
            const shaft = new THREE.Vector3(0, 1, 0).applyQuaternion(f.quat!);
            const off = f.offHand.clone().sub(f.grip);
            expect(off.clone().cross(shaft).length()).toBeLessThan(1e-6);
            expect(off.dot(shaft)).toBeGreaterThan(0.1);
        }
    });

    it("fades in from the hands' own pose and back out to it", () => {
        for (const style of STYLES) {
            expect(castFrame(style, 0)!.weight).toBeCloseTo(0);
            expect(castFrame(style, 0.2)!.weight).toBe(1);
            expect(castFrame(style, CAST_LENGTH - 1e-3)!.weight).toBeLessThan(0.01);
            expect(castFrame(style, CAST_LENGTH)).toBeUndefined();
            expect(castFrame(style, Infinity)).toBeUndefined();
        }
    });

    it("kicks the view up with the recoil, harder for bigger spells", () => {
        expect(castFrame("staff", 0)!.viewPitch).toBe(0);
        const strike = castFrame("staff", 0.14, castStrength("fire-strike"))!.viewPitch;
        const surge = castFrame("staff", 0.14, castStrength("fire-surge"))!.viewPitch;
        expect(strike).toBeGreaterThan(0);
        expect(surge).toBeGreaterThan(strike);
        expect(castFrame("staff", 0.5)!.viewPitch).toBeCloseTo(0);
    });

    it("picks the style from what is held", () => {
        expect(castStyle("staff", false)).toBe("staff");
        expect(castStyle("daggers", true)).toBe("palms");
        expect(castStyle("sword", false)).toBe("armed");
    });
});
