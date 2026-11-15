import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { ArrowView } from "./ArrowView";
import type { Arrow } from "./Bow";
import { ARROW_LENGTH } from "./BowString";
import { ARROW_CONVERGE } from "./WeaponView";

/** The drawn head of an arrow view, in three.js axes. */
const headOf = (view: THREE.Object3D) => view.localToWorld(new THREE.Vector3(0, ARROW_LENGTH, 0));

describe("ArrowView", () => {
    // Shot north from the eye at (0, 0, 1.25) at 40 tiles/s; three.js: north is -z, up is +y.
    const shoot = (): Arrow => ({ x: 0, y: 0, z: 1.25, vx: 0, vy: 40, vz: 0, plane: 0, age: 0, stuck: false });
    const fly = (a: Arrow, t: number) => {
        a.age = t;
        a.y = 40 * t;
    };

    it("leaves from the drawn arrow's head and swoops onto the flight path", () => {
        const scene = new THREE.Scene();
        const view = new ArrowView(scene);
        const arrow = shoot();
        // The nocked arrow's head: right of and below the eye, a little ahead.
        const bowHead = new THREE.Vector3(0.1, 1.15, -0.4);
        view.update([arrow], (out) => out.copy(bowHead));
        const shown = scene.children[0];
        shown.updateMatrixWorld();
        expect(headOf(shown).distanceTo(bowHead)).toBeLessThan(1e-6);

        // Halfway to the convergence point it is halfway off the path...
        fly(arrow, ARROW_CONVERGE / 2 / 40);
        view.update([arrow], () => undefined);
        shown.updateMatrixWorld();
        const half = headOf(shown);
        expect(half.x).toBeCloseTo(0.05, 6);
        expect(half.y).toBeCloseTo(1.2, 6);
        // ...pointing along its swoop, toward the line of sight, not off at an angle.
        const along = new THREE.Vector3(0, 1, 0).applyQuaternion(shown.quaternion);
        expect(along.z).toBeLessThan(-0.99);
        expect(along.x).toBeLessThan(0);
        expect(along.y).toBeGreaterThan(0);

        // ...and past it, exactly on the true flight.
        fly(arrow, (ARROW_CONVERGE + 1) / 40);
        view.update([arrow], () => undefined);
        shown.updateMatrixWorld();
        expect(headOf(shown).distanceTo(new THREE.Vector3(0, 1.25, -(ARROW_CONVERGE + 1)))).toBeLessThan(1e-6);
    });

    it("draws an arrow with no bow to leave from on its flight path", () => {
        const scene = new THREE.Scene();
        const view = new ArrowView(scene);
        const arrow = shoot();
        view.update([arrow]);
        const shown = scene.children[0];
        shown.updateMatrixWorld();
        expect(headOf(shown).distanceTo(new THREE.Vector3(0, 1.25, 0))).toBeLessThan(1e-6);
    });

    it("draws a spell as an orb at its position, hidden for the first instants", () => {
        const scene = new THREE.Scene();
        const view = new ArrowView(scene);
        const spell: Arrow = {
            x: 2, y: 3, z: 1.2, vx: 0, vy: 18, vz: 0, plane: 0, age: 0.01, stuck: false, gravity: 0, spell: { color: 0xff7a1a },
        };
        view.update([spell]);
        expect(scene.children[0].visible).toBe(false);
        spell.age = 0.1;
        view.update([spell]);
        expect(scene.children[0].visible).toBe(true);
        expect(scene.children[0].position.toArray()).toEqual([2, 1.2, -3]);
    });
});
