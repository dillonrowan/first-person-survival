import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { BowString, limbOutline } from "./BowString";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A recurve: limbs bow toward the target, then curl back toward the archer past the string line. */
function recurve(): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    for (const sign of [1, -1]) {
        for (let i = 0; i <= 20; i++) {
            const y = (i / 20) * 0.6;
            // Belly toward the target mid-limb, a curl 0.08 behind the tip line near the end.
            const z = -0.1 * Math.sin((Math.PI * y) / 0.6) + (y > 0.45 ? 0.08 * Math.sin(((y - 0.45) / 0.15) * Math.PI) : 0);
            points.push(v(-0.01, sign * y, z), v(0.01, sign * y, z));
        }
    }
    points.push(v(-0.05, 0.02, 0.03), v(0.05, 0.02, 0.03)); // a thick grip
    return points;
}

/** Height of the drawn string toward the archer at bow height `y`, from its visible segments. */
function stringZ(bow: BowString, y: number): number {
    for (const seg of bow.children) {
        if (!(seg instanceof THREE.Mesh) || !seg.visible || seg.parent !== bow) continue;
        const dir = new THREE.Vector3(0, 0.5 * seg.scale.y, 0).applyQuaternion(seg.quaternion);
        const a = seg.position.clone().sub(dir);
        const b = seg.position.clone().add(dir);
        if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) {
            return a.z + ((b.z - a.z) * (y - a.y)) / (b.y - a.y);
        }
    }
    return NaN;
}

describe("bow string", () => {
    it("outlines the archer side of a limb", () => {
        const outline = limbOutline([
            { u: 0.1, z: 0 },
            { u: 0.3, z: -0.1 },
            { u: 0.5, z: 0.05 },
            { u: 0.6, z: 0 },
        ]);
        expect(outline).toEqual([
            { u: 0.1, z: 0 },
            { u: 0.5, z: 0.05 },
            { u: 0.6, z: 0 },
        ]);
    });

    it("never passes through the limbs, braced or drawn", () => {
        const points = recurve();
        const bow = BowString.fit(points)!;
        for (const pull of [0, 0.5, 1]) {
            bow.update(pull, true);
            for (const p of points) {
                const z = stringZ(bow, p.y);
                if (!Number.isNaN(z)) expect(z).toBeGreaterThanOrEqual(p.z);
            }
        }
    });

    it("pulls the nock toward the archer and keeps the arrow beside the grip", () => {
        const bow = BowString.fit(recurve())!;
        const arrow = bow.getObjectByName("arrow")!;
        const restZ = arrow.position.z;
        bow.update(1, true);
        expect(arrow.position.z).toBeGreaterThan(restZ + 0.2);
        // The shaft passes the grip (z = 0) left of its widest point.
        const along = new THREE.Vector3(0, 1, 0).applyQuaternion(arrow.quaternion);
        const atGrip = arrow.position.clone().addScaledVector(along, -arrow.position.z / along.z);
        expect(atGrip.x).toBeLessThan(-0.05);
        bow.update(-0.5, true); // the twang never pushes the string in front of brace
        expect(arrow.position.z).toBeCloseTo(restZ);
        bow.update(0, false);
        expect(arrow.visible).toBe(false);
    });

});
