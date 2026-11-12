import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { cacheWeaponFamily } from "../world/CacheWeaponFormat";
import { CrossbowController } from "./Crossbow";
import { CrossbowRig, stringFaces } from "./CrossbowRig";
import { cacheWeaponDef } from "./weapons";
import { tuning } from "./tuning";

const run = (crossbow: CrossbowController, seconds: number, attackDown: boolean, aimDown = false): number => {
    let shots = 0;
    for (let t = 0; t < seconds - 1e-9; t += 0.01) {
        if (crossbow.update(0.01, { attackDown, aimDown })) shots++;
    }
    return shots;
};

describe("CrossbowController", () => {
    it("reloads when equipped, then shoots at once on a click with no draw to hold", () => {
        const crossbow = new CrossbowController();
        crossbow.reset();
        expect(crossbow.state).toBe("reloading");
        // Clicking during the reload does nothing.
        expect(run(crossbow, 0.5, true)).toBe(0);
        run(crossbow, tuning.crossbowReloadTime, false);
        expect(crossbow.state).toBe("loaded");
        expect(run(crossbow, 0.01, true)).toBe(1);
        expect(crossbow.bolts).toBe(tuning.boltsStart - 1);
    });

    it("recoils after a shot, then reloads on its own", () => {
        const crossbow = new CrossbowController();
        run(crossbow, tuning.crossbowReloadTime + 0.05, false);
        run(crossbow, 0.01, true);
        expect(crossbow.state).toBe("recoil");
        expect(crossbow.recoil).toBeGreaterThan(0.8);
        expect(crossbow.cocked).toBe(0); // the string snapped straight
        expect(crossbow.boltSeat).toBe(0);
        run(crossbow, tuning.crossbowRecoilTime, true); // held: still one shot
        expect(crossbow.state).toBe("reloading");
        run(crossbow, tuning.crossbowReloadTime, false);
        expect(crossbow.state).toBe("loaded");
    });

    it("lowers, spans the string, seats a bolt, then raises it during the reload", () => {
        const crossbow = new CrossbowController();
        const at = (share: number) => {
            crossbow.reset();
            run(crossbow, share * tuning.crossbowReloadTime, false);
            return { lowered: crossbow.lowered, cocked: crossbow.cocked, seat: crossbow.boltSeat };
        };
        expect(at(0.05)).toMatchObject({ cocked: 0, seat: 0 });
        const spanning = at(0.4);
        expect(spanning.lowered).toBe(1);
        expect(spanning.cocked).toBeGreaterThan(0.2);
        expect(spanning.cocked).toBeLessThan(0.9);
        expect(spanning.seat).toBe(0);
        const seating = at(0.7);
        expect(seating.cocked).toBe(1);
        expect(seating.seat).toBeGreaterThan(0);
        expect(seating.seat).toBeLessThan(1);
        const raising = at(0.9);
        expect(raising.seat).toBe(1);
        expect(raising.lowered).toBeLessThan(0.8);
    });

    it("zooms only while the right mouse is held, loaded or not", () => {
        const crossbow = new CrossbowController();
        run(crossbow, tuning.crossbowReloadTime + 0.5, false);
        expect(crossbow.state).toBe("loaded");
        expect(crossbow.zoom).toBe(0);
        run(crossbow, 0.5, false, true);
        expect(crossbow.zoom).toBeGreaterThan(0.9);
        crossbow.reset();
        run(crossbow, 0.5, false, true); // still zooms while reloading
        expect(crossbow.zoom).toBeGreaterThan(0.9);
        run(crossbow, 1.5, false);
        expect(crossbow.zoom).toBe(0);
    });

    it("is its own family that hits like the bow", () => {
        expect(cacheWeaponFamily("Rune crossbow")).toBe("crossbow");
        expect(cacheWeaponFamily("Magic shortbow")).toBe("bow");
        const def = cacheWeaponDef({ id: "cache-9185", name: "Rune crossbow", family: "crossbow" });
        expect(def.family).toBe("crossbow");
        expect(def.damage).toBe(cacheWeaponDef({ id: "x", name: "Bow", family: "bow" }).damage);
    });
});

describe("CrossbowRig", () => {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    // Contract space: muzzle +Y, rail +Z. A stock along Y, a prod across X at y 0.1, and a drawn
    // string from the tips (±0.25, 0.1) back to the latch at (0, -0.05) on the rail (z 0.06).
    const stock = [v(0.02, -0.25, 0.05), v(-0.02, -0.25, 0.05), v(0.02, 0.2, 0.05), v(-0.02, 0.2, 0.05)];
    const prodBlock = [v(0.02, 0.12, 0.1), v(-0.02, 0.14, 0.1)];
    const string = [v(-0.25, 0.1, 0.06), v(0.25, 0.1, 0.06), v(0.01, -0.05, 0.06), v(-0.01, -0.05, 0.06)];

    it("finds a drawn string's slivers but not the stock", () => {
        const points = [...stock, ...string];
        // Two strand slivers, then a stock quad.
        const indices = [4, 6, 7, 5, 7, 6, 0, 1, 2];
        expect([...stringFaces(points, indices)].sort()).toEqual([0, 1]);
    });

    it("straightens the spent string, pulls it to the latch when cocked and lays the bolt in the groove", () => {
        const rig = CrossbowRig.fit([...stock, ...prodBlock], string)!;
        const strands = rig.children.filter((c) => c instanceof THREE.Mesh) as THREE.Mesh[];
        const middle = () => strands[0].position.clone().addScaledVector(new THREE.Vector3(0, 0.5 * strands[0].scale.y, 0).applyQuaternion(strands[0].quaternion), 1);
        rig.update(0, 0);
        expect(middle().y).toBeCloseTo(0.1, 6);
        expect(rig.getObjectByName("bolt")!.visible).toBe(false);
        rig.update(1, 1);
        expect(middle().y).toBeCloseTo(-0.05, 6);
        expect(rig.getObjectByName("bolt")!.visible).toBe(true);
        // At string height, ending short of the prod block that stands above it.
        expect(rig.boltNock.z).toBeGreaterThan(0.06);
        expect(rig.boltFront.y).toBeLessThan(0.12);
        expect(rig.boltFront.y - rig.boltNock.y).toBeGreaterThanOrEqual(0.14 - 1e-9);
    });

    it("gives no rig to a model without a drawn string", () => {
        expect(CrossbowRig.fit(stock, [])).toBeUndefined();
    });
});
