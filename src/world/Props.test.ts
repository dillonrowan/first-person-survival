import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { Combatant } from "../combat/Combatant";
import { tuning } from "../combat/tuning";
import type { Body } from "../physics/Bodies";
import { PropNpc, PropsWorld, WorldProps } from "./Props";
import type { InteractiveLoc, RegionListener } from "./WorldFormat";

function crate(x: number, y: number, mass = 40, id = 1): InteractiveLoc {
    return {
        kind: "prop",
        id,
        name: "Crate",
        actions: [],
        plane: 0,
        level: 0,
        tileX: Math.floor(x),
        tileY: Math.floor(y),
        sizeX: 1,
        sizeY: 1,
        rotation: 0,
        height: 0.8,
        prop: { mesh: 0, material: "wood", mass, x, y, z: 0, radius: 0.35 },
    };
}

function setup(locs: InteractiveLoc[]) {
    let listener: RegionListener | undefined;
    const world: PropsWorld = {
        flagsAt: () => 0,
        groundHeight: () => 0,
        hasFloor: () => true,
        addRegionListener: (l) => (listener = l),
        regionInteractives: () => ({ locs, doorGeometries: [{}] }),
    };
    const material = new THREE.MeshBasicMaterial();
    const props = new WorldProps(world, new THREE.Scene(), { opaque: material, transparent: material }, () => 0.5);
    listener!.loaded(50, 50);
    return props;
}

function npcAt(x: number, y: number): PropNpc & { hits: number[] } {
    const hits: number[] = [];
    const body: Body = { x, y, z: 0, radius: 0.4, height: 1.5, plane: 0, owner: undefined };
    return {
        body,
        mass: 80,
        attackable: true,
        combatant: new Combatant(200),
        hits,
        takeHit(_dx, _dy, push) {
            hits.push(push);
        },
    };
}

function step(props: WorldProps, seconds: number, ctx: Parameters<WorldProps["update"]>[1] = { npcs: [] }) {
    for (let t = 0; t < seconds; t += 1 / 60) {
        props.update(1 / 60, ctx);
    }
}

describe("world props (spec 19)", () => {
    it("loads props from region data as combat bodies", () => {
        const props = setup([crate(3200.5, 3200.5)]);
        expect(props.count).toBe(1);
        const found: Body[] = [];
        props.collectBodies(0, 3200, 3200, 3201, 3201, found as never[]);
        expect(found).toHaveLength(1);
    });

    it("slides a kicked crate a little under a tile", () => {
        const props = setup([crate(3200.5, 3200.5)]);
        const [prop] = props.all();
        prop.kick(0, 1);
        step(props, 2);
        // 168 u/s ≈ 3.4 tiles/s; friction stops it after about 0.8 tiles.
        expect(prop.body.y - 3200.5).toBeGreaterThan(0.5);
        expect(prop.body.y - 3200.5).toBeLessThan(1.3);
        expect(prop.combatant.dead).toBe(false);
    });

    it("throws a carried crate fast enough to knock an NPC down", () => {
        const props = setup([crate(3200.5, 3200.5)]);
        const [prop] = props.all();
        const npc = npcAt(3200.5, 3204);
        expect(props.pickUp(prop)).toBe(true);
        expect(props.held).toBe(prop);
        // Throw straight north, level (the throw itself drops 20° below the view).
        props.throwHeld(0, tuning.throwPitchDown);
        expect(props.held).toBeUndefined();
        step(props, 0.5, { npcs: [npc] });
        expect(npc.combatant.health).toBe(200 - tuning.propDamageMedium * tuning.strengthScale);
        expect(npc.combatant.reaction).toBe("knockdown");
        expect(npc.hits).toEqual([2]);
    });

    it("breaks a crate thrown hard into a resting heavy stack", () => {
        const props = setup([crate(3200.5, 3200.5, 40, 1), crate(3200.5, 3203.5, 150, 2)]);
        const [light, heavy] = props.all();
        light.body.applyImpulse(0, light.body.mass * 20);
        step(props, 0.5);
        expect(light.broken).toBe(true);
        // The stack takes the crate's lost energy: 963² u²/s² × 40 kg / 150 kg ≈ 247k → 50 damage.
        expect(heavy.combatant.health).toBeLessThan(30);
        expect(props.count).toBe(0);
    });

    it("shoves a crate the player walks into, slower for heavier props", () => {
        const props = setup([crate(3200.5, 3201.1, 40, 1), crate(3210.5, 3211.1, 150, 2)]);
        const [light, heavy] = props.all();
        const push = (x: number, y: number) => {
            const body: Body = { x, y, z: 0, radius: 0.3, height: 1.4, plane: 0, owner: undefined };
            return { body, intentX: 0, intentY: 3.68, eyeZ: 1.25, yaw: 0, pitch: 0 };
        };
        props.update(1 / 60, { npcs: [], player: push(3200.5, 3200.5) });
        props.update(1 / 60, { npcs: [], player: push(3210.5, 3210.5) });
        expect(light.body.vy).toBeGreaterThan(heavy.body.vy * 2);
        expect(heavy.body.vy).toBeGreaterThan(0);
    });

    it("lets weapon damage break a crate in proportion to dmg.club", () => {
        const props = setup([crate(3200.5, 3200.5)]);
        const [prop] = props.all();
        // A power slash (45 in this project's units) is 4.5 in the game's, ×2 for wood: 9 of 30.
        prop.combatant.hurt(45);
        expect(prop.combatant.health).toBeCloseTo(30 - 9, 5);
    });
});
