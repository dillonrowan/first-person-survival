import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { CameraRig } from "./CameraRig";

describe("CameraRig aim", () => {
    const target = { x: 3, y: 4, z: 0, yaw: 0.7, pitch: 0.2 };

    it("aims along the view in first person", () => {
        const rig = new CameraRig(new THREE.PerspectiveCamera());
        expect(rig.aimPitch(0.2)).toBe(0.2);
    });

    it("aims along the reticule's line through the eyes in third person", () => {
        const camera = new THREE.PerspectiveCamera();
        const rig = new CameraRig(camera);
        for (const notches of [1, 3]) {
            rig.zoomBy(notches);
            // Long enough for the zoom to settle.
            for (let i = 0; i < 60; i++) rig.update(target, undefined, 0.1);
            camera.updateMatrixWorld(true);
            const look = camera.getWorldDirection(new THREE.Vector3());
            expect(rig.aimPitch(target.pitch)).toBeCloseTo(Math.asin(look.y), 4);
            expect(rig.aimPitch(target.pitch)).toBeLessThan(target.pitch);
        }
    });
});
