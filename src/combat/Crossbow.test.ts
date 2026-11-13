/// <reference types="node" />
// Node for reading Karil's crossbow from the exported cache.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { cacheWeaponFamily, isRepeaterCrossbow, type CacheWeaponInfo } from "../world/CacheWeaponFormat";
import { decodeNpcModel } from "../world/NpcFormat";
import { createCacheWeaponModel } from "./CacheWeaponModel";
import { CrossbowController } from "./Crossbow";
import { CrossbowRig, magazineFaces, stringFaces } from "./CrossbowRig";
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

describe("repeating crossbow", () => {
    const repeater = () => {
        const crossbow = new CrossbowController();
        crossbow.setMagazine(tuning.repeaterMagazine);
        run(crossbow, tuning.repeaterReloadTime + tuning.repeaterCycleTime + 0.05, false);
        return crossbow;
    };
    const shotTime = tuning.repeaterRecoilTime + tuning.repeaterCycleTime;

    it("is Karil's crossbow, in every state of repair", () => {
        expect(isRepeaterCrossbow("Karil's crossbow")).toBe(true);
        expect(isRepeaterCrossbow("Karil's crossbow 25")).toBe(true);
        expect(isRepeaterCrossbow("Rune crossbow")).toBe(false);
    });

    it("fills its magazine of 7, then shoots all 7 while the button is held before it reloads", () => {
        const crossbow = repeater();
        expect(crossbow.state).toBe("loaded");
        expect(crossbow.magazine).toBe(7);
        // Holding the button empties the magazine, a bolt per lever stroke.
        expect(run(crossbow, 7 * shotTime + 0.05, true)).toBe(7);
        expect(crossbow.magazine).toBe(0);
        expect(crossbow.bolts).toBe(tuning.boltsStart - 7);
        expect(crossbow.state).toBe("reloading");
        // No more until it is refilled.
        expect(run(crossbow, tuning.repeaterReloadTime - 0.2, true)).toBe(0);
        run(crossbow, 0.2 + tuning.repeaterCycleTime + 0.02, false);
        expect(crossbow.state).toBe("loaded");
        expect(crossbow.magazine).toBe(7);
    });

    it("shoots several times as fast as a crossbow loaded bolt by bolt", () => {
        expect(shotTime * 4).toBeLessThan(tuning.crossbowRecoilTime + tuning.crossbowReloadTime);
    });

    it("needs the button let go after equipping before it shoots on a hold", () => {
        const crossbow = repeater();
        crossbow.reset();
        expect(run(crossbow, 1, true)).toBe(0);
        expect(run(crossbow, 0.05, false)).toBe(0);
        expect(run(crossbow, 0.05, true)).toBe(1);
    });

    it("pushes the magazine forward onto the spent string, then hauls it back to the latch and drops a bolt", () => {
        const crossbow = repeater();
        run(crossbow, 0.01, true);
        run(crossbow, tuning.repeaterRecoilTime + 0.02, false);
        expect(crossbow.state).toBe("cycling");
        const at = (share: number) => {
            const c = new CrossbowController();
            c.setMagazine(7);
            c.magazine = 3;
            c.reset();
            run(c, share * tuning.repeaterCycleTime, false);
            return { slide: c.magazineSlide, cocked: c.cocked, seat: c.boltSeat };
        };
        expect(at(0.2)).toMatchObject({ cocked: 0, seat: 0 });
        expect(at(0.2).slide).toBeGreaterThan(0.2);
        expect(at(0.4).slide).toBeCloseTo(1, 1);
        const pulling = at(0.6);
        expect(pulling.cocked).toBeCloseTo(1 - pulling.slide, 6); // the string rides the catch back
        expect(pulling.cocked).toBeGreaterThan(0.2);
        expect(pulling.seat).toBe(0);
        const dropping = at(0.8);
        expect(dropping.seat).toBeGreaterThan(0);
        expect(dropping.seat).toBeLessThan(1);
        expect(crossbow.lowered).toBe(0); // worked at the shoulder, not lowered
    });

    it("drops the bolts into the magazine one by one while it is lowered", () => {
        const crossbow = new CrossbowController();
        crossbow.setMagazine(7);
        run(crossbow, 0.5 * tuning.repeaterReloadTime, false);
        expect(crossbow.lowered).toBe(1);
        const { done, next } = crossbow.refill;
        expect(done).toBeGreaterThan(0);
        expect(done).toBeLessThan(7);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(crossbow.loadedCount).toBe(done);
    });

    it("loads only the bolts left when fewer than a magazine remain", () => {
        const crossbow = new CrossbowController();
        crossbow.bolts = 3;
        crossbow.setMagazine(7);
        run(crossbow, tuning.repeaterReloadTime + tuning.repeaterCycleTime + 0.05, false);
        expect(crossbow.magazine).toBe(3);
        expect(run(crossbow, 4 * shotTime, true)).toBe(3);
        expect(crossbow.state).toBe("empty");
    });

    it("splits Karil's magazine from the model and works it with a lever", () => {
        const info = (
            JSON.parse(readFileSync("public/world/cache-weapons.json", "utf8")) as CacheWeaponInfo[]
        ).find((w) => w.cacheId === 4734)!;
        const raw = readFileSync(`public/world/${info.file}`);
        const data = decodeNpcModel(new Uint8Array(gunzipSync(raw)).buffer);
        const material = new THREE.MeshBasicMaterial();
        const weapon = createCacheWeaponModel(info, data, {
            opaque: material,
            transparent: material,
        });
        const rig = weapon.getObjectByName("crossbow_rig") as CrossbowRig;
        expect(rig.isRepeater).toBe(true);
        const magazine = rig.getObjectByName("crossbow_magazine")!;
        const handle = (slide: number) => {
            rig.update(slide === 0 ? 1 : 0, 0, slide);
            return { y: magazine.position.y, handle: rig.leverHandle(new THREE.Vector3())! };
        };
        const back = handle(0);
        const forward = handle(1);
        expect(back.y).toBe(0);
        // Forward by the string's travel from the latch to slack.
        expect(forward.y).toBeGreaterThan(0.1);
        // The handle, behind the magazine, swings forward and up.
        expect(back.handle.y).toBeLessThan(0);
        expect(forward.handle.y).toBeGreaterThan(back.handle.y);
        expect(forward.handle.z).toBeGreaterThan(back.handle.z);
    });

    it("finds a box standing over the string, but not the prod or stock", () => {
        const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
        const points = [
            // A box face over the rail.
            v(-0.04, 0, 0.11),
            v(0.04, 0, 0.11),
            v(0.04, 0.2, 0.27),
            // A limb running out from the stock, touching the same height at its top.
            v(0, 0.1, 0.04),
            v(0.3, 0.2, 0.11),
            v(0.3, 0.1, 0.11),
        ];
        expect([...magazineFaces(points, [0, 1, 2, 3, 4, 5], 0.078)]).toEqual([0]);
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
