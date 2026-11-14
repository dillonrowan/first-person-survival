import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { ItemInfo } from "../world/ItemFormat";
import { GroundItems, liftFor } from "./GroundItems";
import { ItemDb } from "./ItemDb";

const item = (id: number, name: string): ItemInfo => ({
    id,
    name,
    examine: "",
    stackable: false,
    model: `items/${id}.bin`,
    icon: { zoom: 1, xan: 0, yan: 0, zan: 0, xOffset: 0, yOffset: 0 },
    actions: [],
});
const db = new ItemDb([item(526, "Bones"), item(995, "Coins")]);
const world = { groundHeight: () => 0, renderLevel: () => 0 };
const make = () =>
    new GroundItems(
        new THREE.Scene(),
        { opaque: new THREE.MeshBasicMaterial(), transparent: new THREE.MeshBasicMaterial() },
        db,
        () => new Promise(() => undefined),
        world,
    );
// Looking east from (0.5, 5.5) at head height toward the tile at (5, 5).
const ray = { ox: 0.5, oy: 5.5, oz: 0.15, dx: 1, dy: 0, dz: 0, plane: 0, range: 10 };

describe("GroundItems", () => {
    it("targets the newest item of a pile", () => {
        const items = make();
        items.add({ id: 526, qty: 1 }, 5, 5, 0);
        items.add({ id: 995, qty: 30 }, 5, 5, 0);
        const target = items.targetSource()(ray);
        expect(target).toMatchObject({ kind: "ground-item", label: "Coins (30)", actions: ["Take"] });
    });

    it("removes a taken item and hides a taken world item until it respawns", () => {
        const items = make();
        const dropped = items.add({ id: 526, qty: 1 }, 5, 5, 0, { despawnIn: 180 });
        items.take(dropped);
        expect(items.targetSource()(ray)).toBeUndefined();

        const spawned = items.add({ id: 995, qty: 5 }, 5, 5, 0, { respawnIn: 60 });
        expect(items.take(spawned)).toEqual({ id: 995, qty: 5 });
        expect(items.targetSource()(ray)).toBeUndefined();
        items.update(61, 100, 100, 0);
        expect(items.targetSource()(ray)?.label).toBe("Coins");
    });

    it("takes part of a stack", () => {
        const items = make();
        const coins = items.add({ id: 995, qty: 10 }, 5, 5, 0);
        expect(items.take(coins, 4)).toEqual({ id: 995, qty: 4 });
        expect(items.targetSource()(ray)?.label).toBe("Coins (6)");
    });

    it("despawns dropped items after their time", () => {
        const items = make();
        items.add({ id: 526, qty: 1 }, 5, 5, 0, { despawnIn: 180 });
        items.update(181, 100, 100, 0);
        expect(items.count).toBe(0);
    });
});

describe("liftFor", () => {
    it("lifts a model that dips below the ground", () => {
        const part = (ys: number[]) => ({
            positions: new Int16Array(ys.flatMap((y) => [0, y, 0, 0])),
            colors: new Uint8Array(0),
            uvs: new Int16Array(0),
            sources: new Uint16Array(0),
            indices: new Uint32Array(0),
        });
        const data = { opaque: part([-20, 64]), transparent: part([10]) } as never;
        expect(liftFor(data)).toBeCloseTo(64 / 128);
        expect(liftFor({ opaque: part([-5]), transparent: part([]) } as never)).toBe(0);
    });
});
