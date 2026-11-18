import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { LocReactions } from "./LocReactions";
import type { SkillLocInstance } from "./SkillLocs";

function tree(): { instance: SkillLocInstance; group: THREE.Group; stump: THREE.Group } {
    const group = new THREE.Group();
    const stump = new THREE.Group();
    group.position.set(64, 0, -64); // region-local meshes sit at the region's corner
    const instance = {
        loc: { kind: "skill", id: 1276, name: "Tree", actions: [], plane: 0, level: 0, tileX: 70, tileY: 80, sizeX: 1, sizeY: 1, rotation: 0, height: 3 },
        key: "0:70:80:1276",
        mapX: 1,
        mapY: 1,
        geometries: [],
        meshes: new Map([
            [0, group],
            [1, stump],
        ]),
        shown: 0,
        trunks: new Map(),
    } as SkillLocInstance;
    return { instance, group, stump };
}

describe("LocReactions", () => {
    it("tips a struck tree away from the player about its base, then puts it back", () => {
        const { instance, group } = tree();
        const reactions = new LocReactions(() => 2);
        reactions.play(instance, "treeFall", 70.5, 78.5); // the player stands south of it
        reactions.update(0.9);
        // The top of the tree (3 tiles above its base) has fallen north: scene −z.
        const top = new THREE.Vector3(70.5 - 64, 5, -80.5 + 64).applyMatrix4(group.matrix);
        expect(top.z).toBeLessThan(-80.5 - 2);
        expect(top.y).toBeLessThan(3);
        // The base stays put.
        const base = new THREE.Vector3(70.5 - 64, 2, -80.5 + 64).applyMatrix4(group.matrix);
        expect(base.distanceTo(new THREE.Vector3(70.5, 2, -80.5))).toBeLessThan(0.2);
        reactions.update(5);
        expect(group.matrixAutoUpdate).toBe(true);
        expect(group.position.toArray()).toEqual([64, 0, -64]);
    });

    it("keeps a felled tree on show over its stump until it has fallen", () => {
        const { instance, group } = tree();
        const reactions = new LocReactions(() => 0);
        reactions.play(instance, "treeFall", 70.5, 78.5, true);
        instance.shown = 1; // the stump now
        group.visible = false;
        reactions.update(0.5);
        expect(group.visible).toBe(true);
        reactions.update(5);
        expect(group.visible).toBe(false);
    });
});
