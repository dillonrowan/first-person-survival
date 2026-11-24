// The few gl-matrix (MIT) functions the skeletal animation code uses, with gl-matrix's semantics:
// column-major 4x4 matrices in Float32Arrays, quaternions as [x, y, z, w].

export type mat4 = Float32Array;
export type ReadonlyMat4 = Readonly<Float32Array>;
export type vec3 = Float32Array;
export type quat = Float32Array;
export type vec2 = Float32Array;

export const vec3 = {
    create(): vec3 {
        return new Float32Array(3);
    },
    set(out: vec3, x: number, y: number, z: number): vec3 {
        out[0] = x;
        out[1] = y;
        out[2] = z;
        return out;
    },
};

export const quat = {
    create(): quat {
        return Float32Array.of(0, 0, 0, 1);
    },
    identity(out: quat): quat {
        out.set([0, 0, 0, 1]);
        return out;
    },
    setAxisAngle(out: quat, axis: vec3, rad: number): quat {
        const s = Math.sin(rad / 2);
        out[0] = s * axis[0];
        out[1] = s * axis[1];
        out[2] = s * axis[2];
        out[3] = Math.cos(rad / 2);
        return out;
    },
    /** out = a * b. */
    mul(out: quat, a: quat, b: quat): quat {
        const [ax, ay, az, aw] = a;
        const [bx, by, bz, bw] = b;
        out[0] = ax * bw + aw * bx + ay * bz - az * by;
        out[1] = ay * bw + aw * by + az * bx - ax * bz;
        out[2] = az * bw + aw * bz + ax * by - ay * bx;
        out[3] = aw * bw - ax * bx - ay * by - az * bz;
        return out;
    },
};

export const mat4 = {
    create(): mat4 {
        return mat4.identity(new Float32Array(16));
    },
    identity(out: mat4): mat4 {
        out.fill(0);
        out[0] = out[5] = out[10] = out[15] = 1;
        return out;
    },
    copy(out: mat4, a: ReadonlyMat4): mat4 {
        out.set(a);
        return out;
    },
    add(out: mat4, a: ReadonlyMat4, b: ReadonlyMat4): mat4 {
        for (let i = 0; i < 16; i++) out[i] = a[i] + b[i];
        return out;
    },
    /** out = a * b. */
    mul(out: mat4, a: ReadonlyMat4, b: ReadonlyMat4): mat4 {
        const r = new Float32Array(16);
        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                let sum = 0;
                for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
                r[col * 4 + row] = sum;
            }
        }
        out.set(r);
        return out;
    },
    fromScaling(out: mat4, v: vec3): mat4 {
        mat4.identity(out);
        out[0] = v[0];
        out[5] = v[1];
        out[10] = v[2];
        return out;
    },
    fromQuat(out: mat4, q: quat): mat4 {
        const [x, y, z, w] = q;
        const x2 = x + x;
        const y2 = y + y;
        const z2 = z + z;
        const xx = x * x2;
        const yx = y * x2;
        const yy = y * y2;
        const zx = z * x2;
        const zy = z * y2;
        const zz = z * z2;
        const wx = w * x2;
        const wy = w * y2;
        const wz = w * z2;
        out.set([1 - yy - zz, yx + wz, zx - wy, 0, yx - wz, 1 - xx - zz, zy + wx, 0, zx + wy, zy - wx, 1 - xx - yy, 0, 0, 0, 0, 1]);
        return out;
    },
    getTranslation(out: vec3, m: ReadonlyMat4): vec3 {
        return vec3.set(out, m[12], m[13], m[14]);
    },
    getScaling(out: vec3, m: ReadonlyMat4): vec3 {
        return vec3.set(out, Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));
    },
    /** The inverse of a, or null (out untouched) when it is singular. */
    invert(out: mat4, a: ReadonlyMat4): mat4 | null {
        const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a;
        const b00 = a00 * a11 - a01 * a10;
        const b01 = a00 * a12 - a02 * a10;
        const b02 = a00 * a13 - a03 * a10;
        const b03 = a01 * a12 - a02 * a11;
        const b04 = a01 * a13 - a03 * a11;
        const b05 = a02 * a13 - a03 * a12;
        const b06 = a20 * a31 - a21 * a30;
        const b07 = a20 * a32 - a22 * a30;
        const b08 = a20 * a33 - a23 * a30;
        const b09 = a21 * a32 - a22 * a31;
        const b10 = a21 * a33 - a23 * a31;
        const b11 = a22 * a33 - a23 * a32;
        let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
        if (!det) return null;
        det = 1 / det;
        out.set([
            (a11 * b11 - a12 * b10 + a13 * b09) * det,
            (a02 * b10 - a01 * b11 - a03 * b09) * det,
            (a31 * b05 - a32 * b04 + a33 * b03) * det,
            (a22 * b04 - a21 * b05 - a23 * b03) * det,
            (a12 * b08 - a10 * b11 - a13 * b07) * det,
            (a00 * b11 - a02 * b08 + a03 * b07) * det,
            (a32 * b02 - a30 * b05 - a33 * b01) * det,
            (a20 * b05 - a22 * b02 + a23 * b01) * det,
            (a10 * b10 - a11 * b08 + a13 * b06) * det,
            (a01 * b08 - a00 * b10 - a03 * b06) * det,
            (a30 * b04 - a31 * b02 + a33 * b00) * det,
            (a21 * b02 - a20 * b04 - a23 * b00) * det,
            (a11 * b07 - a10 * b09 - a12 * b06) * det,
            (a00 * b09 - a01 * b07 + a02 * b06) * det,
            (a31 * b01 - a30 * b03 - a32 * b00) * det,
            (a20 * b03 - a21 * b01 + a22 * b00) * det,
        ]);
        return out;
    },
};

export const vec2 = {
    fromValues(x: number, y: number): Float32Array {
        return Float32Array.of(x, y);
    },
};
