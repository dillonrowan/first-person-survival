import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";

import { mat4, quat, vec3 } from "./glm";

// three.js matrices are column-major like gl-matrix, so they check the shim.
const m = (values: number[]) => Float32Array.from(values);
const close = (a: ArrayLike<number>, b: ArrayLike<number>) => Array.from(a).forEach((v, i) => expect(v).toBeCloseTo(b[i], 5));

describe("glm shim", () => {
    const a = m([1, 2, 0, 0, 0, 1, 3, 0, 4, 0, 1, 0, 5, 6, 7, 1]);
    const b = m([2, 0, 0, 0, 0, 3, 0, 0, 1, 1, 1, 0, 0, 0, 2, 1]);

    it("multiplies like three.js", () => {
        close(mat4.mul(mat4.create(), a, b), new Matrix4().fromArray(Array.from(a)).multiply(new Matrix4().fromArray(Array.from(b))).elements);
    });

    it("inverts, and leaves a singular matrix alone", () => {
        close(mat4.mul(mat4.create(), a, mat4.invert(mat4.create(), a)!), mat4.create());
        expect(mat4.invert(mat4.create(), new Float32Array(16))).toBeNull();
    });

    it("builds rotations from axis angles like three.js", () => {
        const q = quat.mul(quat.create(), quat.setAxisAngle(quat.create(), vec3.set(vec3.create(), 0, 1, 0), 0.7), quat.setAxisAngle(quat.create(), vec3.set(vec3.create(), 1, 0, 0), -0.4));
        const t = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.4));
        close(q, [t.x, t.y, t.z, t.w]);
        close(mat4.fromQuat(mat4.create(), q), new Matrix4().makeRotationFromQuaternion(t).elements);
    });

    it("reads translation and scaling", () => {
        const s = mat4.mul(mat4.create(), mat4.fromScaling(mat4.create(), vec3.set(vec3.create(), 2, 3, 4)), mat4.create());
        s[12] = 9;
        close(mat4.getScaling(vec3.create(), s), [2, 3, 4]);
        close(mat4.getTranslation(vec3.create(), s), [9, 0, 0]);
    });
});
