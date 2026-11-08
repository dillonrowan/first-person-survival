import * as THREE from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { MeleeController, MeleeInput } from "./MeleeController";
import { MOVE_SETS, Ray, rayFor } from "./moves";
import { createPlaceholderWeapon } from "./PlaceholderWeapons";
import { WeaponView } from "./WeaponView";
import { weaponById } from "./weapons";

const DT = 1 / 240;
const BLADED = ["sword", "shortsword", "daggers"];

/** The first-person weapon at one update, in camera space (x right, y up, −z ahead). */
type Sample = {
    t: number;
    move?: string;
    /** The ray of the hit being traced, or of the next one. */
    ray?: Ray;
    /** Through that ray's hit window: 0..1 inside it, negative before it, above 1 after it. */
    progress: number;
    grip: THREE.Vector3;
    tip: THREE.Vector3;
};

type Run = { samples: Sample[]; view: WeaponView; melee: MeleeController };

/**
 * Drives the melee controller and the weapon view together for `seconds`, the attack button down
 * whenever `down(t)`, sampling the drawn weapon on every update. `each` runs before each update.
 */
function play(
    weaponId: string,
    down: (t: number) => boolean,
    seconds: number,
    keys: Partial<MeleeInput> = {},
    each?: (t: number, run: Run) => void,
): Run {
    const camera = new THREE.PerspectiveCamera();
    const view = new WeaponView(camera, "/");
    const holder = camera.children.find((c) => c.type === "Group" && c.name !== "kick_boot")!;
    const melee = new MeleeController(weaponById(weaponId));
    const run: Run = { samples: [], view, melee };
    for (let t = 0; t < seconds; t += DT) {
        each?.(t, run);
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
        holder.updateMatrix();
        const swing = melee.swing;
        let ray: Ray | undefined;
        let progress = Number.NaN;
        if (swing) {
            let index = 0;
            while (index < swing.move.hits.length - 1 && swing.elapsed > rayFor(swing.timeline, index).off) {
                index++;
            }
            ray = rayFor(swing.timeline, index);
            progress = (swing.elapsed - ray.on) / Math.max(1e-6, ray.off - ray.on);
        }
        run.samples.push({
            t,
            move: swing?.move.id,
            ray,
            progress,
            grip: holder.position.clone(),
            tip: new THREE.Vector3(0, 0.6, 0).applyMatrix4(holder.matrix),
        });
    }
    return run;
}

/** Short clicks at the given times. */
const clicks = (weaponId: string, times: number[], each?: (t: number, run: Run) => void) =>
    play(weaponId, (t) => times.some((c) => t >= c && t < c + 0.03), Math.max(...times) + 1.5, {}, each);

/** Samples inside their hit window. */
const inWindow = (samples: Sample[]) => samples.filter((s) => s.progress >= 0 && s.progress <= 1);

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

describe("quick strikes (Dark Messiah's swings)", () => {
    it("cut A from left to right and B from right to left while they hit, as they push the target", () => {
        for (const id of [...BLADED, "club", "staff"]) {
            const { samples } = clicks(id, [0, 0.8]);
            const a = inWindow(samples.filter((s) => s.move === "quick_A"));
            const b = inWindow(samples.filter((s) => s.move === "quick_B"));
            expect(a.length, id).toBeGreaterThan(5);
            expect(b.length, id).toBeGreaterThan(5);
            expect(a.at(-1)!.tip.x - a[0].tip.x, `${id} A`).toBeGreaterThan(0.05);
            expect(b.at(-1)!.tip.x - b[0].tip.x, `${id} B`).toBeLessThan(-0.05);
        }
    });

    it("chain A into B and back without the blade jumping", () => {
        for (const id of [...BLADED, "staff"]) {
            const { samples } = play(id, (t) => Math.floor(t / 0.05) % 2 === 0, 3);
            expect(new Set(samples.map((s) => s.move)), id).toEqual(new Set([undefined, "quick_A", "quick_B"]));
            const steps = samples.slice(1).map((s, i) => s.grip.distanceTo(samples[i].grip));
            for (let i = 1; i < steps.length - 1; i++) {
                // A jump: one update moving the hand far more than the updates around it.
                const around = Math.max(steps[i - 1], steps[i + 1], 0.004);
                expect(steps[i], `${id} at ${samples[i + 1].t.toFixed(3)}s`).toBeLessThan(2.5 * around);
            }
            // At 240 updates a second even the fastest motion (the staff's twirl) stays a few centimetres.
            expect(Math.max(...steps), id).toBeLessThan(0.1);
        }
    });

    it("keep the hand out in front, never up against the eye", () => {
        for (const id of BLADED) {
            for (const s of clicks(id, [0, 0.8]).samples) {
                expect(s.grip.z, id).toBeLessThan(-0.1);
            }
        }
    });
});

describe("a landed blow", () => {
    it("stalls the blade for a moment, then lets it catch up with the swing", () => {
        let hitAt = -1;
        const { samples, melee } = clicks("sword", [0], (t, run) => {
            const swing = run.melee.swing;
            if (hitAt < 0 && swing && swing.elapsed >= rayFor(swing.timeline, 0).on + 0.03) {
                hitAt = t;
                run.view.impact(1);
            }
        });
        expect(hitAt).toBeGreaterThan(0);
        const stalled = samples.filter((s) => s.t > hitAt + 0.005 && s.t < hitAt + 0.05);
        const free = samples.filter((s) => s.t > hitAt - 0.05 && s.t < hitAt - 0.005);
        const travel = (list: Sample[]) => list.at(-1)!.tip.distanceTo(list[0].tip) / (list.at(-1)!.t - list[0].t);
        // The tip only judders while stalled; before it was cutting through the air.
        expect(travel(stalled)).toBeLessThan(0.25 * travel(free));
        // It catches up: the swing still finishes back in the stance.
        expect(melee.swing).toBeUndefined();
    });

    it("jolts the view, which settles again", () => {
        const camera = new THREE.PerspectiveCamera();
        const view = new WeaponView(camera, "/");
        const melee = new MeleeController(weaponById("sword"));
        view.impact(1);
        let peak = 0;
        for (let i = 0; i < 240; i++) {
            view.update(melee, "first", true, undefined, { dt: DT });
            peak = Math.max(peak, Math.abs(view.viewOffset.pitch), Math.abs(view.viewOffset.yaw));
        }
        expect(peak).toBeGreaterThan(0.002);
        expect(Math.abs(view.viewOffset.pitch) + Math.abs(view.viewOffset.yaw) + Math.abs(view.viewOffset.roll)).toBeLessThan(1e-4);
    });
});

describe("a charged power attack held", () => {
    it("trembles in the hand", () => {
        const { samples, melee } = play("sword", () => true, 1.5);
        expect(melee.isCharging).toBe(true);
        const held = samples.slice(-60);
        const spread = Math.max(...held.map((s) => s.grip.distanceTo(held[0].grip)));
        expect(spread).toBeGreaterThan(0.001);
        expect(spread).toBeLessThan(0.02);
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
});
