/** A tree's trunk as a swung blade meets it: an upright cylinder, in world tiles. */
export type Trunk = { x: number; y: number; radius: number };

/** Heights above the ground where the trunk is measured: where an eye-level swing crosses it. [design] */
export const TRUNK_SLICES = [0.6, 0.8, 1.0, 1.2, 1.4];

/**
 * Measures a model's trunk: at each height in `slices` the model is cut horizontally, the cut
 * outline whose centre is nearest (`nearX`, `nearY`) is the trunk, and its radius is the furthest
 * outline point from that centre. The medians over the cuts are returned, so a cut through a low
 * branch or the canopy does not count; undefined when no cut meets the model. `vertex(i)` gives
 * model vertex i as [east, north, up] in tiles. (Checked against the oak in Blender.)
 */
export function measureTrunk(
    vertex: (i: number) => [number, number, number],
    indices: ArrayLike<number>,
    nearX: number,
    nearY: number,
    slices: number[],
): Trunk | undefined {
    const rings = slices.map((h) => ring(vertex, indices, nearX, nearY, h)).filter((r) => r !== undefined);
    if (rings.length === 0) return undefined;
    return { x: median(rings.map((r) => r.x)), y: median(rings.map((r) => r.y)), radius: median(rings.map((r) => r.radius)) };
}

function median(xs: number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
}

function ring(vertex: (i: number) => [number, number, number], indices: ArrayLike<number>, nearX: number, nearY: number, h: number): Trunk | undefined {
    // Each triangle crossing the plane gives a segment; segments meeting at a point form an
    // outline. Points are welded by position, as the models repeat vertices per face.
    const parent = new Map<string, string>();
    const point = new Map<string, [number, number]>();
    const find = (k: string): string => {
        let r = k;
        while (parent.get(r) !== r) r = parent.get(r)!;
        parent.set(k, r);
        return r;
    };
    const add = (x: number, y: number): string => {
        const k = `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
        if (!parent.has(k)) {
            parent.set(k, k);
            point.set(k, [x, y]);
        }
        return find(k);
    };
    for (let t = 0; t + 2 < indices.length; t += 3) {
        const c = [vertex(indices[t]), vertex(indices[t + 1]), vertex(indices[t + 2])];
        const cut: string[] = [];
        for (let i = 0; i < 3; i++) {
            const a = c[i];
            const b = c[(i + 1) % 3];
            if ((a[2] - h) * (b[2] - h) >= 0) continue;
            const k = (h - a[2]) / (b[2] - a[2]);
            cut.push(add(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k));
        }
        if (cut.length === 2) {
            const a = find(cut[0]);
            const b = find(cut[1]);
            if (a !== b) parent.set(a, b);
        }
    }
    const outlines = new Map<string, [number, number][]>();
    for (const k of parent.keys()) {
        const r = find(k);
        const list = outlines.get(r) ?? [];
        list.push(point.get(k)!);
        outlines.set(r, list);
    }
    let best: (Trunk & { d: number }) | undefined;
    for (const pts of outlines.values()) {
        if (pts.length < 3) continue;
        const x = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        const y = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        const d = Math.hypot(x - nearX, y - nearY);
        if (!best || d < best.d) best = { x, y, d, radius: Math.max(...pts.map((p) => Math.hypot(p[0] - x, p[1] - y))) };
    }
    return best && { x: best.x, y: best.y, radius: best.radius };
}
