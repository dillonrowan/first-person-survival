import * as THREE from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { MeleeController, MeleeInput } from "./MeleeController";
import { MOVE_SETS, Ray, rayFor } from "./moves";
import { createPlaceholderWeapon } from "./PlaceholderWeapons";
import { WeaponView } from "./WeaponView";
import { weaponById } from "./weapons";

const DT = 1 / 240;
const BLADED = ["sword", "shortsword", "daggers"];
const FORWARD = new THREE.Vector3(0, 0, -1);

/** The first-person weapon at one update of a swing, in camera space (x right, y up, −z ahead). */
type Sample = {
    move: string;
    /** The ray of the hit being traced, or of the next one. */
    ray: Ray;
    /** Through that ray's hit window: 0..1 inside it, negative before it, above 1 after it. */
    progress: number;
    grip: THREE.Vector3;
    tip: THREE.Vector3;
    /** The weapon's +Z: the way the cutting edge faces. */
    edge: THREE.Vector3;
    /** The weapon's +Y: from grip to point. */
    blade: THREE.Vector3;
    /** The weapon's +X: the way the flat of the blade faces. */
    flat: THREE.Vector3;
};

/**
 * Drives the melee controller and the weapon view together for `seconds`, the attack button down
 * whenever `down(t)`, sampling the drawn weapon on every update that a swing is playing.
 */
function play(weaponId: string, down: (t: number) => boolean, seconds: number, keys: Partial<MeleeInput> = {}): Sample[] {
    const camera = new THREE.PerspectiveCamera();
    const view = new WeaponView(camera, "/");
    const holder = camera.children.find((c) => c.type === "Group" && c.name !== "kick_boot")!;
    const melee = new MeleeController(weaponById(weaponId));
    const samples: Sample[] = [];
    for (let t = 0; t < seconds; t += DT) {
        melee.update(DT, {
            attackDown: down(t),
            forward: 0,
            strafe: 0,
            pitch: 0,
            megasprinting: false,
            airborne: false,
            fallSpeed: 0,
            aimingAtKnockedDown: false,
            ...keys,
        });
        view.update(melee, "first", true, undefined, { dt: DT });
        const swing = melee.swing;
        if (!swing) {
            continue;
        }
        let index = 0;
        while (index < swing.move.hits.length - 1 && swing.elapsed > rayFor(swing.timeline, index).off) {
            index++;
        }
        const ray = rayFor(swing.timeline, index);
        holder.updateMatrix();
        const axis = (i: number) => new THREE.Vector3().setFromMatrixColumn(holder.matrix, i).normalize();
        samples.push({
            move: swing.move.id,
            ray,
            progress: (swing.elapsed - ray.on) / Math.max(1e-6, ray.off - ray.on),
            grip: holder.position.clone(),
            tip: new THREE.Vector3(0, 0.6, 0).applyMatrix4(holder.matrix),
            edge: axis(2),
            blade: axis(1),
            flat: axis(0),
        });
    }
    return samples;
}

/** Short clicks at the given times. */
const clicks = (weaponId: string, times: number[]) =>
    play(weaponId, (t) => times.some((c) => t >= c && t < c + 0.03), Math.max(...times) + 2);

/** A press held `hold` seconds with movement `keys` (a charged power attack past the wind-up). */
const charge = (weaponId: string, hold: number, keys: Partial<MeleeInput>) => play(weaponId, (t) => t < hold, hold + 3, keys);

/** Samples in the middle of their hit window (at the very ends the swing turns around). */
const midSwing = (samples: Sample[]) => samples.filter((s) => s.progress > 0.15 && s.progress < 0.85);

/** Which way the tip travels between consecutive samples of the same hit. */
function tipMotion(samples: Sample[]): { at: Sample; dir: THREE.Vector3 }[] {
    const out: { at: Sample; dir: THREE.Vector3 }[] = [];
    for (let i = 1; i < samples.length; i++) {
        const d = samples[i].tip.clone().sub(samples[i - 1].tip);
        if (samples[i].ray === samples[i - 1].ray && d.lengthSq() > 1e-10) {
            out.push({ at: samples[i], dir: d.normalize() });
        }
    }
    return out;
}

/** Every mid-swing step: the edge faces where the tip is going and the flat faces sideways. */
function expectEdgeLeads(samples: Sample[], label: string): void {
    const motion = tipMotion(midSwing(samples));
    expect(motion.length, label).toBeGreaterThan(5);
    for (const { at, dir } of motion) {
        const where = `${label} ${at.move} at ${at.progress.toFixed(2)}`;
        expect(at.edge.dot(dir), where).toBeGreaterThan(0.8);
        expect(Math.abs(at.flat.dot(dir)), where).toBeLessThan(0.5);
    }
}

beforeAll(() => {
    // No weapon models in tests: every fetch misses and the placeholders stay.
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
});

describe("weapon models", () => {
    it("have bladed weapons' blades along +Y, thin across X, with the edge facing +Z (docs/weapon-models.md)", () => {
        for (const id of BLADED) {
            const blade = createPlaceholderWeapon(weaponById(id)).getObjectByName("blade") as THREE.Mesh;
            const { width, height, depth } = (blade.geometry as THREE.BoxGeometry).parameters;
            expect(height, id).toBeGreaterThan(depth);
            expect(depth, id).toBeGreaterThanOrEqual(4 * width);
        }
    });
});

describe("swinging a blade", () => {
    it("leads with the edge, not the flat, through both quick strikes of every bladed weapon", () => {
        for (const id of BLADED) {
            const samples = clicks(id, [0, 0.8]);
            expect(new Set(samples.map((s) => s.move))).toEqual(new Set(["quick_A", "quick_B"]));
            expectEdgeLeads(samples, id);
        }
    });

    it("leads with the edge through the sword's slashing power attacks", () => {
        for (const strafe of [-1, 0, 1]) {
            expectEdgeLeads(charge("sword", 0.6, { strafe }), `strafe ${strafe}`);
        }
    });

    it("sweeps quick A from left to right and quick B from right to left with every weapon", () => {
        for (const id of [...BLADED, "club", "staff"]) {
            const samples = midSwing(clicks(id, [0, 0.8]));
            const a = samples.filter((s) => s.move === "quick_A");
            const b = samples.filter((s) => s.move === "quick_B");
            expect(a.at(-1)!.tip.x - a[0].tip.x, `${id} A`).toBeGreaterThan(0.3);
            expect(b.at(-1)!.tip.x - b[0].tip.x, `${id} B`).toBeLessThan(-0.3);
        }
    });

    it("keeps the hand out in front, never up against the eye", () => {
        for (const id of BLADED) {
            for (const s of clicks(id, [0, 0.8])) {
                expect(s.grip.z, id).toBeLessThanOrEqual(-0.3 + 1e-9);
            }
        }
    });
});

describe("dagger power attacks stepping back or forward", () => {
    it("are two stabs: each hit traces only the centre line", () => {
        for (const dir of ["B", "T"] as const) {
            const rays = MOVE_SETS.daggers.power[dir].time!.rays;
            expect(rays).toHaveLength(2);
            for (const ray of rays) {
                expect(ray.sweep, dir).toBe(0);
            }
        }
    });

    it("drive the point straight ahead, pull back, and drive it ahead again", () => {
        for (const forward of [-1, 1]) {
            const samples = charge("daggers", 0.6, { forward });
            expect(samples[0].move).toBe(forward > 0 ? "power_T" : "power_B");
            const rays = [...new Set(samples.map((s) => s.ray))];
            expect(rays).toHaveLength(2);
            const reached: number[] = [];
            for (const ray of rays) {
                const before = samples.filter((s) => s.ray === ray && s.progress < 0);
                const during = samples.filter((s) => s.ray === ray && s.progress >= 0 && s.progress <= 1);
                expect(during.length).toBeGreaterThan(0);
                for (const s of during) {
                    // Point first: the blade lies along the view.
                    expect(s.blade.dot(FORWARD)).toBeGreaterThan(0.85);
                }
                // Driven out: the hand ends the stab well ahead of where it was drawn back to.
                const drawnBack = Math.max(...before.map((s) => s.grip.z));
                expect(during.at(-1)!.grip.z).toBeLessThan(drawnBack - 0.2);
                reached.push(during.at(-1)!.grip.z);
            }
            // Drawn back between the stabs.
            const between = samples.filter((s) => s.ray === rays[1] && s.progress < 0);
            expect(Math.max(...between.map((s) => s.grip.z))).toBeGreaterThan(reached[0] + 0.2);
        }
    });
});
