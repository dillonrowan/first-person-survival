import * as THREE from "three";

/**
 * The string and bolt of a crossbow, added to a cache crossbow model. The worn models carry a string
 * already drawn back in a V; `stringFaces` finds those triangles so the model can drop them, and the
 * rig draws its own: straight from tip to tip when the crossbow is spent, pulled back to the latch
 * when it is cocked, with a bolt on the rail when it is loaded.
 *
 * Crossbow contract space (tiles, grip at the origin): the muzzle along +Y, the rail on top along
 * +Z, the prod's limbs along ±X.
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
     * rail), the bolt being lowered into place in between.
     */
    update(cocked: number, seat: number): void {
        this.centre.lerpVectors(this.slack, this.latch, Math.min(1, Math.max(0, cocked)));
        stretch(this.strands[0], this.left, this.centre);
        stretch(this.strands[1], this.centre, this.right);
        this.bolt.visible = seat > 0;
        this.bolt.position.copy(this.boltNock).addScaledVector(BOLT_DROP, 1 - Math.min(1, seat));
    }

    /** World position of the loaded bolt's head (call after world matrices update). */
    boltHead(out: THREE.Vector3): THREE.Vector3 {
        return this.bolt.localToWorld(out.set(0, BOLT_LENGTH, 0)); // the bolt's own scale shortens it
    }
}
