import type { NpcSkeleton } from "../../src/world/NpcFormat";
import { SeqTransformType } from "./rs/model/seq/SeqTransformType";

/** The parts of a frame base (SeqBase) this needs: transform types and the labels each moves. */
export type FrameBase = { types: readonly number[]; labels: readonly (readonly number[])[] };

/** Parts with fewer vertices are folded into their parent. */
const MIN_PART_VERTICES = 4;
/** The ragdoll (and the u8 partOf) handles at most this many parts. */
const MAX_PARTS = 32;

type Part = { key: string; members: Set<number>; vertices: number[]; parent: number };

/**
 * Derives a ragdoll skeleton from an OSRS model's vertex labels and an animation frame base
 * (spec 20.2). OSRS animates labelled vertex groups: an ORIGIN transform sets a pivot (the centroid
 * of its labels' vertices) and the ROTATE transform after it turns its labels around that pivot.
 * Labels turned by exactly the same set of ROTATE groups move as one rigid part; a part whose set
 * contains another part's set hangs from it, and the ROTATE group they differ by is their joint.
 *
 * Without labels or a frame base the whole model is one part (it falls as a single rigid body).
 */
export function buildSkeleton(
    vertexLabels: readonly ArrayLike<number>[] | undefined,
    vx: ArrayLike<number>,
    vy: ArrayLike<number>,
    vz: ArrayLike<number>,
    count: number,
    base: FrameBase | undefined,
): NpcSkeleton {
    const centroid = (vertices: ArrayLike<number>): [number, number, number] => {
        let x = 0;
        let y = 0;
        let z = 0;
        for (let i = 0; i < vertices.length; i++) {
            x += vx[vertices[i]];
            y += vy[vertices[i]];
            z += vz[vertices[i]];
        }
        const n = Math.max(1, vertices.length);
        return [x / n, y / n, z / n];
    };
    const all = Array.from({ length: count }, (_, i) => i);
    const single = (): NpcSkeleton => ({
        partOf: new Uint8Array(count),
        parents: Int8Array.from([-1]),
        pivots: Int16Array.from(centroid(all).map(Math.round)),
    });
    if (!vertexLabels || !base || count === 0) {
        return single();
    }

    // ROTATE groups, each with the labels of the ORIGIN that precedes it.
    const rotates: { labels: Set<number>; origin: readonly number[] }[] = [];
    let origin: readonly number[] = [];
    for (let g = 0; g < base.types.length; g++) {
        if (base.types[g] === SeqTransformType.ORIGIN) {
            origin = base.labels[g];
        } else if (base.types[g] === SeqTransformType.ROTATE) {
            rotates.push({ labels: new Set(base.labels[g]), origin });
        }
    }

    // Labels with the same ROTATE membership form one part.
    const byKey = new Map<string, Part>();
    const assigned = new Uint8Array(count);
    for (let label = 0; label < vertexLabels.length; label++) {
        const vertices = vertexLabels[label];
        if (!vertices || vertices.length === 0) {
            continue;
        }
        const members = new Set<number>();
        rotates.forEach((r, i) => r.labels.has(label) && members.add(i));
        const key = [...members].sort((a, b) => a - b).join(",");
        let part = byKey.get(key);
        if (!part) {
            part = { key, members, vertices: [], parent: -1 };
            byKey.set(key, part);
        }
        for (let i = 0; i < vertices.length; i++) {
            if (!assigned[vertices[i]]) {
                assigned[vertices[i]] = 1;
                part.vertices.push(vertices[i]);
            }
        }
    }
    const parts = [...byKey.values()];
    if (parts.length <= 1) {
        return single();
    }
    // Unlabelled vertices ride with the largest part.
    const largest = parts.reduce((a, b) => (b.vertices.length > a.vertices.length ? b : a));
    for (let v = 0; v < count; v++) {
        if (!assigned[v]) {
            largest.vertices.push(v);
        }
    }

    // Parent: the part whose membership is the largest proper subset of this one's.
    const isSubset = (a: Set<number>, b: Set<number>) => a.size < b.size && [...a].every((m) => b.has(m));
    parts.forEach((part, i) => {
        let best = -1;
        parts.forEach((other, j) => {
            if (j !== i && isSubset(other.members, part.members) && (best < 0 || other.members.size > parts[best].members.size)) {
                best = j;
            }
        });
        part.parent = best;
    });
    // One root: the largest part without a parent; other parentless parts hang from it.
    const roots = parts.map((p, i) => (p.parent < 0 ? i : -1)).filter((i) => i >= 0);
    const firstRoot = roots.reduce((a, b) => (parts[b].vertices.length > parts[a].vertices.length ? b : a));
    for (const r of roots) {
        if (r !== firstRoot) {
            parts[r].parent = firstRoot;
        }
    }

    // Fold tiny parts into their parents (deepest first), then cap the count.
    const depth = (i: number): number => (parts[i].parent < 0 ? 0 : 1 + depth(parts[i].parent));
    const removed = new Set<number>();
    // A root of a few vertices (often a lone "base" label) is no frame to hang a body from: its
    // largest child becomes the root and takes its vertices.
    let root = firstRoot;
    while (parts[root].vertices.length < MIN_PART_VERTICES) {
        const children = parts.map((p, i) => (p.parent === root ? i : -1)).filter((i) => i >= 0);
        if (children.length === 0) {
            break;
        }
        const heir = children.reduce((a, b) => (parts[b].vertices.length > parts[a].vertices.length ? b : a));
        parts[heir].vertices.push(...parts[root].vertices);
        parts[heir].parent = -1;
        for (const c of children) {
            if (c !== heir) {
                parts[c].parent = heir;
            }
        }
        removed.add(root);
        root = heir;
    }
    const fold = (i: number) => {
        const parent = parts[i].parent;
        parts[parent].vertices.push(...parts[i].vertices);
        parts.forEach((p) => p.parent === i && (p.parent = parent));
        removed.add(i);
    };
    const order = parts.map((_, i) => i).sort((a, b) => depth(b) - depth(a));
    for (const i of order) {
        if (i !== root && !removed.has(i) && parts[i].parent >= 0 && parts[i].vertices.length < MIN_PART_VERTICES) {
            fold(i);
        }
    }
    while (parts.length - removed.size > MAX_PARTS) {
        const smallest = parts
            .map((_, i) => i)
            .filter((i) => i !== root && !removed.has(i))
            .reduce((a, b) => (parts[b].vertices.length < parts[a].vertices.length ? b : a));
        fold(smallest);
    }

    // Number the parts breadth-first from the root, so parents come before their children.
    const index = new Map<number, number>([[root, 0]]);
    const queue = [root];
    for (let q = 0; q < queue.length; q++) {
        parts.forEach((p, i) => {
            if (!removed.has(i) && p.parent === queue[q] && !index.has(i)) {
                index.set(i, index.size);
                queue.push(i);
            }
        });
    }

    const partOf = new Uint8Array(count).fill(255);
    const parents = new Int8Array(queue.length);
    const pivots = new Int16Array(queue.length * 3);
    queue.forEach((i, n) => {
        const part = parts[i];
        for (const v of part.vertices) {
            partOf[v] = n;
        }
        parents[n] = part.parent < 0 ? -1 : index.get(part.parent)!;
        let pivot: [number, number, number] | undefined;
        if (part.parent >= 0) {
            // The joint is the ROTATE group this part has and its parent lacks.
            const parentMembers = parts[part.parent].members;
            for (const m of part.members) {
                if (parentMembers.has(m)) {
                    continue;
                }
                const originVertices: number[] = [];
                for (const label of rotates[m].origin) {
                    const vs = vertexLabels[label];
                    for (let k = 0; vs && k < vs.length; k++) {
                        originVertices.push(vs[k]);
                    }
                }
                if (originVertices.length > 0) {
                    pivot = centroid(originVertices);
                    break;
                }
            }
            // No usable origin: the part's vertex nearest to its parent.
            if (!pivot) {
                const [px, py, pz] = centroid(parts[part.parent].vertices);
                let best = part.vertices[0];
                let bestD = Infinity;
                for (const v of part.vertices) {
                    const d = (vx[v] - px) ** 2 + (vy[v] - py) ** 2 + (vz[v] - pz) ** 2;
                    if (d < bestD) {
                        bestD = d;
                        best = v;
                    }
                }
                pivot = [vx[best], vy[best], vz[best]];
            }
        } else {
            pivot = centroid(part.vertices);
        }
        pivots.set(pivot.map(Math.round), n * 3);
    });
    return { partOf, parents, pivots };
}
