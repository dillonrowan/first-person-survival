import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { cacheWeaponFamily } from "../world/CacheWeaponFormat";
import { cacheWeaponOrientation } from "./CacheWeaponModel";
import { cacheWeaponDef, weaponById } from "./weapons";

describe("cache weapons", () => {
    it("picks the family from the name", () => {
        expect(cacheWeaponFamily("Dragon dagger(p++)")).toBe("daggers");
        expect(cacheWeaponFamily("Staff of air")).toBe("staff");
        expect(cacheWeaponFamily("Magic shortbow")).toBe("bow");
        expect(cacheWeaponFamily("Rune crossbow")).toBe("bow");
        expect(cacheWeaponFamily("Abyssal whip")).toBe("sword");
        expect(cacheWeaponFamily("Granite maul")).toBe("sword");
    });

    it("fights like its family's weapon, with its own id and name", () => {
        const def = cacheWeaponDef({ id: "cache-4151", name: "Abyssal whip", family: "sword" });
        expect(def).toEqual({ ...weaponById("sword"), id: "cache-4151", name: "Abyssal whip" });
        expect(cacheWeaponDef({ id: "cache-861", name: "Magic shortbow", family: "bow" }).family).toBe("bow");
    });

    it("turns the blade to +Y and the model's down (its cutting edge) to +Z", () => {
        // RS -z is three.js +z: a blade held forward from the grip, as worn models are.
        const q = cacheWeaponOrientation({ blade: [0, 0, -116], family: "sword" });
        const blade = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
        const down = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
        expect(blade.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-6);
        expect(down.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-6);
    });

    it("turns a bow's curve (the model's up) to +Z, toward the archer", () => {
        const q = cacheWeaponOrientation({ blade: [0, 0, -116], family: "bow" });
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
        expect(up.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-6);
    });

    it("handles a blade hanging straight down", () => {
        const q = cacheWeaponOrientation({ blade: [0, 95, 0], family: "sword" });
        const blade = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
        expect(blade.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-6);
    });
});
