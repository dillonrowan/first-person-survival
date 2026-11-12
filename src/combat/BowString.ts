import * as THREE from "three";

/**
 * Bow string and nocked arrow added to a bow model that has none (the cache bows are limbs only).
 * Built in the weapon art contract's space (docs/weapon-models.md): grip at the origin, limbs
 * along ±Y, the archer along +Z. The nock is pulled toward +Z as the bow is drawn. From the nock
 * the string runs to each limb tip along the archer side of the limb's outline, so it lies over
 * recurves and flared tips instead of cutting through them.
 */

/** Nocking point above the grip centre, where the arrow rests on the hand. Tiles. [design] */
const NOCK_HEIGHT = 0.03;
/** Nock to grip at full draw, tiles: kept short of the camera's near plane in the drawn pose. [design] */
const DRAW_LENGTH = 0.4;
/** The arrow rides the bow's left side (right-handed archer), at least this far out. Tiles. [design] */
const ARROW_REST_X = -0.02;
export const ARROW_LENGTH = 0.6;
const STRING_RADIUS = 0.0025;
const SHAFT_RADIUS = 0.0045;
/** Gap kept between the string or arrow and the bow. Tiles. [design] */
const CLEARANCE = 0.004;
/** Half the height of the grip region the braced string and the arrow must clear. Tiles. [design] */
const GRIP_BAND = 0.08;

/** A point of a limb's outline: `u` along the bow away from the nocking point, `z` toward the archer. */
type OutlinePoint = { u: number; z: number };

/**
 * The archer-side outline of one limb (its points `u` > 0): the upper convex hull of (u, z), from
 * the grip to the tip. Any straight string between two of its points, or from a nock behind it,
 * stays clear of the limb.
 */
export function limbOutline(points: readonly OutlinePoint[]): OutlinePoint[] {
    const sorted = points.filter((p) => p.u > 1e-3).sort((a, b) => a.u - b.u || a.z - b.z);
    const hull: OutlinePoint[] = [];
    for (const p of sorted) {
        while (hull.length >= 2) {
            const a = hull[hull.length - 2];
            const b = hull[hull.length - 1];
            if ((b.u - a.u) * (p.z - a.z) - (b.z - a.z) * (p.u - a.u) < 0) break;
            hull.pop();
        }
        hull.push(p);
    }
    return hull;
}

/** Index of the outline point the string from a nock at (0, z) first touches. */
function tangentFrom(z: number, outline: readonly OutlinePoint[]): number {
    let best = 0;
    for (let i = 1; i < outline.length; i++) {
        // Largest slope toward the archer: every other point lies on the bow's side of the string.
        if ((outline[i].z - z) * outline[best].u >= (outline[best].z - z) * outline[i].u) best = i;
    }
    return best;
}

/** A thin cylinder of unit length along +Y, stretched between two points each frame. */
function stretch(mesh: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
    const dir = to.clone().sub(from);
    const length = dir.length();
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, dir.divideScalar(length || 1));
    mesh.scale.set(1, length, 1);
}
const UP = new THREE.Vector3(0, 1, 0);

/** An arrow along +Y with its nock at the origin: shaft, broadhead and three vanes. */
export function createArrow(): THREE.Group {
    const arrow = new THREE.Group();
    arrow.name = "arrow";
    const wood = new THREE.MeshStandardMaterial({ color: 0xb08c5a, roughness: 0.7 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9da3ab, metalness: 0.8, roughness: 0.35 });
    const feather = new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.9, side: THREE.DoubleSide });
    const cock = new THREE.MeshStandardMaterial({ color: 0x9a2a1e, roughness: 0.9, side: THREE.DoubleSide });
    const nock = new THREE.MeshStandardMaterial({ color: 0x2d2a26, roughness: 0.8 });

    const shaftLength = ARROW_LENGTH - 0.05;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, shaftLength, 6), wood);
    shaft.position.y = shaftLength / 2;
    const nockMesh = new THREE.Mesh(new THREE.CylinderGeometry(SHAFT_RADIUS * 0.95, SHAFT_RADIUS * 0.95, 0.018, 6), nock);
    nockMesh.position.y = 0.009;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 4), steel);
    head.position.y = ARROW_LENGTH - 0.025;
    head.scale.z = 0.3; // a flat broadhead
    arrow.add(shaft, nockMesh, head);

    // Vanes: a tapered quad from the shaft outward, 120° apart, the cock feather away from the bow.
    const vane = new THREE.BufferGeometry();
    vane.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([0, 0.03, 0, 0, 0.11, 0, 0.009, 0.095, 0, 0.012, 0.035, 0], 3),
    );
    vane.setIndex([0, 1, 2, 0, 2, 3]);
    vane.computeVertexNormals();
    for (let i = 0; i < 3; i++) {
        const mesh = new THREE.Mesh(vane, i === 0 ? cock : feather);
        mesh.rotation.y = Math.PI + (i * 2 * Math.PI) / 3;
        arrow.add(mesh);
    }
    return arrow;
}

export class BowString extends THREE.Group {
    private readonly limbs: { outline: OutlinePoint[]; sign: 1 | -1 }[];
    private readonly segments: THREE.Mesh[] = [];
    private readonly arrow = createArrow();
    private readonly restNock: THREE.Vector3;
    private readonly drawnNock: THREE.Vector3;
    /** Where the shaft passes the grip, and the nock on the string: the arrow runs from one to the other. */
    readonly arrowRest: THREE.Vector3;
    readonly nock = new THREE.Vector3();
    private readonly from = new THREE.Vector3();
    private readonly to = new THREE.Vector3();

    /** The string for a bow with these vertices, or undefined if they have no limbs above and below the grip. */
    static fit(points: readonly THREE.Vector3[]): BowString | undefined {
        const upper = limbOutline(points.map((p) => ({ u: p.y - NOCK_HEIGHT, z: p.z })));
        const lower = limbOutline(points.map((p) => ({ u: NOCK_HEIGHT - p.y, z: p.z })));
        if (upper.length === 0 || lower.length === 0) {
            return undefined;
        }
        const grip = points.filter((p) => Math.abs(p.y - NOCK_HEIGHT) < GRIP_BAND);
        return new BowString(upper, lower, grip);
    }

    private constructor(upper: OutlinePoint[], lower: OutlinePoint[], grip: readonly THREE.Vector3[]) {
        super();
        this.name = "bow_string";
        this.limbs = [
            { outline: upper, sign: 1 },
            { outline: lower, sign: -1 },
        ];
        // Braced: straight across the limbs' rearmost points (the archer side of the whole bow's
        // outline, where it crosses the nocking height), or just behind the grip if that sticks out
        // further.
        let straight = -Infinity;
        for (const a of upper) {
            for (const b of lower) {
                straight = Math.max(straight, b.z + ((a.z - b.z) * b.u) / (a.u + b.u));
            }
        }
        const behindGrip = Math.max(-Infinity, ...grip.map((p) => p.z)) + CLEARANCE + STRING_RADIUS;
        this.restNock = new THREE.Vector3(0, NOCK_HEIGHT, Math.max(straight, behindGrip));
        this.drawnNock = new THREE.Vector3(0, NOCK_HEIGHT, Math.max(this.restNock.z + 0.1, DRAW_LENGTH));
        // The arrow passes the grip's left side.
        const left = Math.min(Infinity, ...grip.filter((p) => Math.abs(p.z) < GRIP_BAND).map((p) => p.x));
        this.arrowRest = new THREE.Vector3(Math.min(ARROW_REST_X, left - SHAFT_RADIUS - CLEARANCE), NOCK_HEIGHT, 0);

        const material = new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.8 });
        const geometry = new THREE.CylinderGeometry(STRING_RADIUS, STRING_RADIUS, 1, 4);
        for (let i = 0; i < upper.length + lower.length; i++) {
            this.segments.push(new THREE.Mesh(geometry, material));
        }
        this.add(...this.segments, this.arrow);
        this.update(0, true);
    }

    /** World position of the nocked arrow's head (call after the scene's world matrices update). */
    arrowHead(out: THREE.Vector3): THREE.Vector3 {
        return this.arrow.localToWorld(out.set(0, ARROW_LENGTH, 0));
    }

    /**
     * `pull` 1 at full draw. The string never goes in front of brace (the twang after a shot only
     * swings it back), so it cannot pass into the grip.
     */
    update(pull: number, nocked: boolean): void {
        this.nock.lerpVectors(this.restNock, this.drawnNock, Math.max(0, pull));
        let used = 0;
        for (const { outline, sign } of this.limbs) {
            // Nock to where the string meets the limb, then along its outline to the tip.
            this.from.copy(this.nock);
            for (let i = tangentFrom(this.nock.z, outline); i < outline.length; i++) {
                const p = outline[i];
                this.to.set(0, NOCK_HEIGHT + sign * p.u, p.z + STRING_RADIUS + CLEARANCE);
                stretch(this.segments[used++], this.from, this.to);
                this.from.copy(this.to);
            }
        }
        this.segments.forEach((segment, i) => (segment.visible = i < used));
        this.arrow.visible = nocked;
        if (nocked) {
            // Nock on the string, shaft across the arrow rest beside the grip.
            this.arrow.position.copy(this.nock);
            this.arrow.quaternion.setFromUnitVectors(UP, this.arrowRest.clone().sub(this.nock).normalize());
        }
    }
}
