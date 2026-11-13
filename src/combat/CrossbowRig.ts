import * as THREE from "three";

/**
 * The string and bolt of a crossbow, added to a cache crossbow model. The worn models carry a string
 * already drawn back in a V; `stringFaces` finds those triangles so the model can drop them, and the
 * rig draws its own: straight from tip to tip when the crossbow is spent, pulled back to the latch
 * when it is cocked, with a bolt on the rail when it is loaded.
 *
 * Crossbow contract space (tiles, grip at the origin): the muzzle along +Y, the rail on top along
 * +Z, the prod's limbs along ±X.
 *
 * A repeater (a Chu-ko-nu, such as Karil's crossbow) also has its magazine box split from the model
 * (`magazineFaces`) and handed to `attachMagazine`: the box slides along the rail, a fork under its
 * back end catches the string, and a lever pivoted at the front of the stock works it.
 */

export const BOLT_LENGTH = 0.28;
/** Shortest bolt laid on a rail, however close the prod block stands. */
const MIN_BOLT_LENGTH = 0.14;
const BOLT_RADIUS = 0.006;
const STRING_RADIUS = 0.0025;
/** Gap kept between the string or bolt and the stock. Tiles. [design] */
const CLEARANCE = 0.003;
/** How far behind the limb tips the latch holds the string when no drawn string shows it. [design] */
const DEFAULT_STROKE = 0.12;
/** Half the stock's width: points this close to the centre line are the rail the string and bolt ride. */
const RAIL_HALF_WIDTH = 0.03;
/** A string strand starts beyond this share of the prod's half span and ends within CENTRE of the stock. */
const TIP_SHARE = 0.6;
const CENTRE = 0.08;
/** Where a loaded bolt is lowered onto the rail from (relative to its seat): above and behind. [design] */
const BOLT_DROP = new THREE.Vector3(0, -0.05, 0.1);
/** A repeater's magazine stands at least this far above the drawn string. Tiles. */
const MAGAZINE_ABOVE_STRING = 0.02;
/** Parts reaching further than this from the centre line are the prod, not the magazine. Tiles. */
const MAGAZINE_HALF_WIDTH = 0.1;
/**
 * Repeater lever (Chu-ko-nu), laid out against Karil's crossbow in Blender: a pair of arms pivoted
 * on the stock under the magazine's front, through pins on the magazine's flanks near its back end
 * (riding in slots in the arms), joined behind the magazine by the handle. Tiles. [design]
 */
const LEVER = {
    /** Pivot: behind the magazine's front, below the latch. */
    pivotBack: 0.02,
    pivotDrop: 0.01,
    /** Pins: ahead of the magazine's back end, above its bottom. */
    pinForward: 0.06,
    pinRise: 0.045,
    /** Pivot to handle: at rest the handle sits just behind the magazine, clear of the line of sight. */
    length: 0.36,
    /** The arms stand this far off the magazine's flanks. */
    side: 0.012,
    armWidth: 0.01,
    armDepth: 0.016,
    handleRadius: 0.009,
};
/** A bolt dropped into the magazine comes down from this far above its slot, and sinks this far in. Tiles. [design] */
const LOAD_FROM = 0.2;
const LOAD_INTO = 0.04;

/**
 * Triangles (by index of the triangle) of a model's drawn string: long slivers that run from near a
 * limb tip to the stock's centre line. `points` are the vertices, `indices` three per triangle.
 */
export function stringFaces(points: readonly THREE.Vector3[], indices: ArrayLike<number>): Set<number> {
    let span = 0;
    for (const p of points) span = Math.max(span, Math.abs(p.x));
    const faces = new Set<number>();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    for (let t = 0; t * 3 + 2 < indices.length; t++) {
        const tri = [points[indices[t * 3]], points[indices[t * 3 + 1]], points[indices[t * 3 + 2]]];
        const length = Math.max(tri[0].distanceTo(tri[1]), tri[1].distanceTo(tri[2]), tri[2].distanceTo(tri[0]));
        if (length < 0.15) continue;
        ab.subVectors(tri[1], tri[0]);
        ac.subVectors(tri[2], tri[0]);
        const width = ab.cross(ac).length() / length;
        const xs = tri.map((p) => Math.abs(p.x));
        if (width < 0.02 && Math.max(...xs) > TIP_SHARE * span && Math.min(...xs) < CENTRE) {
            faces.add(t);
        }
    }
    return faces;
}

/**
 * Triangles of a repeater's magazine: whole parts of the model (joined by shared corners) that stand
 * clear above `stringTop`, the highest point of the drawn string, and lie over the stock rather than
 * out along the prod.
 */
export function magazineFaces(points: readonly THREE.Vector3[], indices: ArrayLike<number>, stringTop: number): Set<number> {
    // Union-find over the vertices, joining a triangle's corners and vertices at the same spot.
    const parent = points.map((_, i) => i);
    const find = (i: number): number => {
        while (parent[i] !== i) i = parent[i] = parent[parent[i]];
        return i;
    };
    const join = (a: number, b: number) => {
        parent[find(a)] = find(b);
    };
    const at = new Map<string, number>();
    points.forEach((p, i) => {
        const key = `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`;
        const other = at.get(key);
        if (other === undefined) at.set(key, i);
        else join(i, other);
    });
    for (let t = 0; t * 3 + 2 < indices.length; t++) {
        join(indices[t * 3], indices[t * 3 + 1]);
        join(indices[t * 3], indices[t * 3 + 2]);
    }
    const low = new Map<number, number>();
    const wide = new Map<number, number>();
    for (let i = 0; i < indices.length; i++) {
        const p = points[indices[i]];
        const root = find(indices[i]);
        low.set(root, Math.min(low.get(root) ?? Infinity, p.z));
        wide.set(root, Math.max(wide.get(root) ?? 0, Math.abs(p.x)));
    }
    const faces = new Set<number>();
    for (let t = 0; t * 3 + 2 < indices.length; t++) {
        const root = find(indices[t * 3]);
        if (low.get(root)! > stringTop + MAGAZINE_ABOVE_STRING && wide.get(root)! < MAGAZINE_HALF_WIDTH) faces.add(t);
    }
    return faces;
}

/** A crossbow bolt along +Y with its nock at the origin: a thick shaft, a bodkin head, three short vanes. */
export function createBolt(): THREE.Group {
    const bolt = new THREE.Group();
    bolt.name = "bolt";
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.7 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9da3ab, metalness: 0.8, roughness: 0.35 });
    const vaneMaterial = new THREE.MeshStandardMaterial({ color: 0x3a2e26, roughness: 0.9, side: THREE.DoubleSide });
    const shaftLength = BOLT_LENGTH - 0.035;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(BOLT_RADIUS, BOLT_RADIUS * 0.85, shaftLength, 6), wood);
    shaft.position.y = shaftLength / 2;
    const head = new THREE.Mesh(new THREE.ConeGeometry(BOLT_RADIUS * 1.5, 0.04, 4), steel);
    head.position.y = BOLT_LENGTH - 0.02;
    bolt.add(shaft, head);
    const vane = new THREE.BufferGeometry();
    vane.setAttribute("position", new THREE.Float32BufferAttribute([0, 0.01, 0, 0, 0.07, 0, 0.011, 0.055, 0, 0.012, 0.015, 0], 3));
    vane.setIndex([0, 1, 2, 0, 2, 3]);
    vane.computeVertexNormals();
    for (let i = 0; i < 3; i++) {
        const mesh = new THREE.Mesh(vane, vaneMaterial);
        mesh.rotation.y = Math.PI / 2 + (i * 2 * Math.PI) / 3;
        bolt.add(mesh);
    }
    return bolt;
}

const UP = new THREE.Vector3(0, 1, 0);

const smooth = (t: number) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
};

function box(width: number, length: number, depth: number, material: THREE.Material): THREE.Mesh {
    return new THREE.Mesh(new THREE.BoxGeometry(width, length, depth), material);
}

/** A rod across the crossbow (along X). */
function rod(radius: number, width: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 8), material);
    mesh.rotation.z = Math.PI / 2;
    return mesh;
}

/** A repeater's moving parts (CrossbowRig.attachMagazine). */
type Repeater = {
    /** Slides along the rail, carrying the model's magazine, its catch, slot and pins. */
    magazine: THREE.Group;
    /** At the pivot, turned about X so that its +Y runs along the arms. */
    lever: THREE.Group;
    pivot: THREE.Vector3;
    /** The pins with the magazine back, and its travel from the latch forward to the spent string. */
    pin: THREE.Vector3;
    stroke: number;
    /** A bolt being dropped into the magazine's loading slot. */
    loading: THREE.Group;
    slotTop: number;
};

function stretch(mesh: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
    const dir = to.clone().sub(from);
    const length = dir.length();
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, dir.divideScalar(length || 1));
    mesh.scale.set(1, length, 1);
}

export class CrossbowRig extends THREE.Group {
    private readonly strands: [THREE.Mesh, THREE.Mesh];
    private readonly bolt = createBolt();
    private readonly left: THREE.Vector3;
    private readonly right: THREE.Vector3;
    /** String centre spent (straight between the tips) and cocked (on the latch). */
    private readonly slack: THREE.Vector3;
    private readonly latch: THREE.Vector3;
    /** The seated bolt runs from its nock on the latch to its head, along the rail. */
    readonly boltNock: THREE.Vector3;
    readonly boltFront: THREE.Vector3;
    /** Length of the bolt laid on this crossbow's rail, tiles. */
    readonly boltLength: number;
    private readonly centre = new THREE.Vector3();
    /** Where a bolt being loaded onto the rail comes down from, relative to its seat. */
    private boltDrop = BOLT_DROP;
    private repeater: Repeater | undefined;

    /**
     * The rig for a crossbow with these vertices; `string` are the vertices of its drawn string
     * (empty if it has none), which give the limb tips and the latch.
     */
    static fit(points: readonly THREE.Vector3[], string: readonly THREE.Vector3[]): CrossbowRig | undefined {
        let left: THREE.Vector3 | undefined;
        let right: THREE.Vector3 | undefined;
        for (const p of string) {
            if (!left || p.x < left.x) left = p;
            if (!right || p.x > right.x) right = p;
        }
        if (string.length === 0 || !left || !right || right.x - left.x < 0.1) {
            // No drawn string (a pair of crossbows, say): nothing to span or load.
            return undefined;
        }
        const middle = left.clone().lerp(right, 0.5);
        const centre = string.filter((p) => Math.abs(p.x) < CENTRE);
        const latch =
            centre.length > 0
                ? centre.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(centre.length)
                : middle.clone().add(new THREE.Vector3(0, -DEFAULT_STROKE, 0));
        // A drawn string that ends ahead of its own tips is no latch: span it the default stroke back.
        if (latch.y > middle.y - 0.03) {
            latch.copy(middle).add(new THREE.Vector3(0, -DEFAULT_STROKE, 0));
        }
        return new CrossbowRig(points, left.clone(), right.clone(), middle, latch.setX(0));
    }

    private constructor(points: readonly THREE.Vector3[], left: THREE.Vector3, right: THREE.Vector3, middle: THREE.Vector3, latch: THREE.Vector3) {
        super();
        this.name = "crossbow_rig";
        this.left = left;
        this.right = right;
        // The rail's top between two points along the stock: the string and bolt ride just above it.
        const rail = points.filter((p) => Math.abs(p.x) < RAIL_HALF_WIDTH);
        const railTop = (y0: number, y1: number) =>
            Math.max(-Infinity, ...rail.filter((p) => p.y >= Math.min(y0, y1) && p.y <= Math.max(y0, y1)).map((p) => p.z));
        this.slack = new THREE.Vector3(0, middle.y, Math.max(middle.z, railTop(middle.y - 0.02, middle.y + 0.02) + STRING_RADIUS + CLEARANCE));
        // The bolt lies in the groove at the drawn string's height (the models put the string on the
        // rail) and ends short of the first thing ahead that stands above it: the prod's block, a sight.
        const boltZ = latch.z + BOLT_RADIUS;
        const blocked = rail
            .filter((p) => p.y > latch.y + 0.02 && p.y < latch.y + BOLT_LENGTH && p.z > boltZ - BOLT_RADIUS)
            .reduce((nearest, p) => Math.min(nearest, p.y - latch.y), Infinity);
        const length = Math.max(MIN_BOLT_LENGTH, Math.min(BOLT_LENGTH, blocked - CLEARANCE));
        this.boltLength = length;
        this.latch = new THREE.Vector3(0, latch.y, boltZ);
        this.boltNock = this.latch.clone();
        this.boltFront = this.latch.clone().add(new THREE.Vector3(0, length, 0));

        const material = new THREE.MeshStandardMaterial({ color: 0xd8d0b8, roughness: 0.8 });
        const geometry = new THREE.CylinderGeometry(STRING_RADIUS, STRING_RADIUS, 1, 4);
        this.strands = [new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material)];
        this.bolt.scale.y = length / BOLT_LENGTH;
        this.add(...this.strands, this.bolt);
        this.update(0, 0);
    }

    /**
     * `cocked` 0 (string straight, spent) to 1 (on the latch); `seat` 0 (no bolt) to 1 (bolt on the
     * rail), the bolt being lowered into place in between. A repeater's magazine is pushed forward
     * by `slide` 0..1 (all the way: its catch reaches the spent string), the lever turning to keep
     * the pins in its slots; `loading` 0..1 drops a bolt into the magazine.
     */
    update(cocked: number, seat: number, slide = 0, loading = 0): void {
        this.centre.lerpVectors(this.slack, this.latch, Math.min(1, Math.max(0, cocked)));
        stretch(this.strands[0], this.left, this.centre);
        stretch(this.strands[1], this.centre, this.right);
        this.bolt.visible = seat > 0;
        this.bolt.position.copy(this.boltNock).addScaledVector(this.boltDrop, 1 - Math.min(1, seat));
        const r = this.repeater;
        if (r) {
            const travel = Math.min(1, Math.max(0, slide)) * r.stroke;
            r.magazine.position.y = travel;
            const arm = new THREE.Vector3(0, r.pin.y + travel - r.pivot.y, r.pin.z - r.pivot.z).normalize();
            r.lever.quaternion.setFromUnitVectors(UP, arm);
            const sink = smooth(loading);
            r.loading.visible = loading > 0 && loading < 1;
            r.loading.position.z = r.slotTop + LOAD_FROM * (1 - sink) - LOAD_INTO * sink;
        }
    }

    /** True once a magazine is attached. */
    get isRepeater(): boolean {
        return this.repeater !== undefined;
    }

    /** The lever's handle (contract space) at its current turn; undefined without a lever. */
    leverHandle(out: THREE.Vector3): THREE.Vector3 | undefined {
        const r = this.repeater;
        return r && out.set(0, LEVER.length, 0).applyQuaternion(r.lever.quaternion).add(r.pivot);
    }

    /**
     * Makes this a repeater: `magazine` (contract space) is the model's magazine box and `bounds` its
     * extent. The box slides along the rail with a fork under its back end that holds the string on
     * the latch, worked by a lever, and drops the next bolt onto the rail.
     */
    attachMagazine(magazine: THREE.Object3D, bounds: THREE.Box3): void {
        const dark = new THREE.MeshStandardMaterial({ color: 0x3b3a22, roughness: 0.75, metalness: 0.2 });
        const iron = new THREE.MeshStandardMaterial({ color: 0x55574f, roughness: 0.45, metalness: 0.7 });
        const hole = new THREE.MeshStandardMaterial({ color: 0x0c0c08, roughness: 1 });
        const cx = (bounds.min.x + bounds.max.x) / 2;
        const width = bounds.max.x - bounds.min.x + 2 * LEVER.side;

        const group = new THREE.Group();
        group.name = "crossbow_magazine";
        group.add(magazine);
        // The catch: a fork straddling the groove, down from the magazine to just past the string.
        const catchTop = bounds.min.z + 0.004;
        const catchBottom = this.latch.z - BOLT_RADIUS - STRING_RADIUS;
        for (const side of [-1, 1]) {
            const prong = box(0.006, 0.012, catchTop - catchBottom, iron);
            prong.position.set(side * (BOLT_RADIUS + 0.006), this.latch.y + STRING_RADIUS + 0.006, (catchTop + catchBottom) / 2);
            group.add(prong);
        }
        // The loading slot along the top, and the pins the lever arms ride on.
        const slotLength = Math.min(this.boltLength + 0.02, bounds.max.y - bounds.min.y - 0.04);
        const slotY = (bounds.min.y + bounds.max.y) / 2;
        const slot = box(0.022, slotLength, 0.003, hole);
        slot.position.set(cx, slotY, bounds.max.z + 0.0015);
        const pin = new THREE.Vector3(cx, bounds.min.y + LEVER.pinForward, bounds.min.z + LEVER.pinRise);
        const pins = rod(0.006, width + 0.016, iron);
        pins.position.copy(pin);
        group.add(slot, pins);

        // The lever: two arms from the pivot out past the pins, joined by the handle.
        const pivot = new THREE.Vector3(cx, bounds.max.y - LEVER.pivotBack, this.latch.z - LEVER.pivotDrop);
        const lever = new THREE.Group();
        lever.name = "crossbow_lever";
        lever.position.copy(pivot);
        for (const side of [-1, 1]) {
            const arm = box(LEVER.armWidth, LEVER.length, LEVER.armDepth, dark);
            arm.position.set((side * width) / 2, LEVER.length / 2, 0);
            lever.add(arm);
        }
        const handle = rod(LEVER.handleRadius, width + 0.03, dark);
        handle.position.y = LEVER.length;
        lever.add(handle, rod(0.008, width + 0.02, iron));

        // A bolt lying along the rail, dropped into the slot during a refill.
        const loading = new THREE.Group();
        loading.name = "loading_bolt";
        const bolt = createBolt();
        bolt.scale.y = this.boltLength / BOLT_LENGTH;
        bolt.position.set(cx, slotY - this.boltLength / 2, 0);
        loading.add(bolt);
        loading.visible = false;
        group.add(loading);

        this.add(group, lever);
        // The next bolt drops straight down out of the magazine onto the rail.
        this.boltDrop = new THREE.Vector3(0, 0, Math.max(0.01, bounds.min.z - this.latch.z));
        this.repeater = { magazine: group, lever, pivot, pin, stroke: this.slack.y - this.latch.y, loading, slotTop: bounds.max.z };
        this.update(0, 0);
    }

    /** World position of the loaded bolt's head (call after world matrices update). */
    boltHead(out: THREE.Vector3): THREE.Vector3 {
        return this.bolt.localToWorld(out.set(0, BOLT_LENGTH, 0)); // the bolt's own scale shortens it
    }
}
