// A fake SkillContext for the skill tests: real inventory and clock, scripted everything else.

import * as THREE from "three";

import type { SkillId } from "../combat/SkillId";
import { xpForLevel } from "../combat/Osrs";
import { TickClock } from "../game/TickClock";
import { ItemContainer, Stack } from "../items/ItemContainer";
import type { Npc } from "../npc/Npc";
import type { InteractiveLoc } from "../world/WorldFormat";
import type { SkillsManifest } from "../world/SkillFormat";
import type { SkillLocInstance } from "../world/SkillLocs";
import type { SkillContext } from "./SkillContext";
import { SkillSystem, SkillUi } from "./SkillSystem";

export type TestItem = { id: number; name: string; stackable?: boolean };

export { emptySkillsManifest as emptyManifest } from "../world/SkillFormat";

/** A skill loc instance as a region would give it. */
export function testLoc(id: number, name: string, x = 10, y = 10, skill: InteractiveLoc["skill"] = { mesh: 0, depletedMesh: 1 }): SkillLocInstance {
    const loc: InteractiveLoc = { kind: "skill", id, name, actions: [], plane: 0, level: 0, tileX: x, tileY: y, sizeX: 1, sizeY: 1, rotation: 0, height: 1, skill };
    return { loc, key: `0:${x}:${y}:${id}`, mapX: 0, mapY: 0, geometries: [], meshes: new Map(), shown: -1 };
}

export function testNpc(id: number, name = "Npc", x = 11, y = 10): Npc {
    return {
        appearance: { id, name, actions: [] },
        gone: false,
        combatant: { dead: false },
        group: new THREE.Group(),
        body: { x, y },
        plane: 0,
        faceTowards: () => undefined,
    } as unknown as Npc;
}

export function createTestSkills(data: SkillsManifest, items: TestItem[], levels: Partial<Record<SkillId, number>> = {}) {
    const defs = new Map(items.map((i) => [i.id, i]));
    const db = {
        get: (id: number) => {
            const i = defs.get(id);
            return i && ({ id: i.id, name: i.name, stackable: !!i.stackable } as never);
        },
        byName: (name: string) => {
            const i = items.find((x) => x.name.toLowerCase() === name.toLowerCase());
            return i && ({ id: i.id, name: i.name, stackable: !!i.stackable } as never);
        },
    };
    const inventory = new ItemContainer(28, false, db);
    const worn: number[] = [];
    const xp: Partial<Record<SkillId, number>> = {};
    const logs: string[] = [];
    const ground: (Stack & { x: number; y: number })[] = [];
    const store = new Map<string, unknown>();
    const locs = new Map<string, SkillLocInstance>();
    const runtime: SkillLocInstance[] = [];
    const npcs: Npc[] = [];
    let hurt = 0;
    const player = { x: 10.5, y: 9.5, plane: 0, teleport(x: number, y: number, plane: number) { Object.assign(player, { x, y, plane }); } };
    const ctx: SkillContext = {
        data,
        clock: new TickClock(),
        skills: { level: (id) => levels[id] ?? 1 },
        gainXp: (skill, amount) => (xp[skill] = (xp[skill] ?? 0) + amount),
        items: {
            inventory,
            count: (id) => inventory.count(id),
            holds: (id) => inventory.count(id) > 0 || worn.includes(id),
            canAdd: (id, qty = 1) => (db.get(id) as { stackable?: boolean } | undefined)?.stackable ? inventory.count(id) > 0 || inventory.freeSlots() > 0 : inventory.freeSlots() >= qty,
            addItem: (id, qty) => inventory.add(id, qty),
            removeItem: (id, qty) => inventory.remove(id, qty),
            replaceAt: (slot, id) => {
                const s = inventory.slots[slot];
                if (s) inventory.slots[slot] = { id, qty: s.qty };
            },
        },
        db,
        drop: (stack, x, y) => ground.push({ ...stack, x, y }),
        skillLocs: {
            get: (key) => locs.get(key),
            refresh: () => undefined,
            occupies: (plane, x, y) => [...locs.values(), ...runtime].some((i) => i.loc.plane === plane && i.loc.tileX === x && i.loc.tileY === y),
            near: () => [...locs.values()],
            addRuntime: (loc) => {
                const i = testLoc(loc.id, loc.name, loc.tileX, loc.tileY, {});
                i.loc.actions = loc.actions;
                runtime.push(i);
                locs.set(i.key, i);
                return i;
            },
            removeRuntime: (i) => {
                runtime.splice(runtime.indexOf(i), 1);
                locs.delete(i.key);
            },
        },
        player,
        hurt: (n) => (hurt += n),
        log: (text) => logs.push(text),
        npcsNear: () => npcs,
        walkable: () => true,
        locModel: () => Promise.resolve(new THREE.Group()),
        store: { get: <T,>(k: string) => store.get(k) as T | undefined, set: (k, v) => store.set(k, v) },
    };
    const opened: { make?: Parameters<SkillUi["openMake"]> } = {};
    const ui: SkillUi = {
        openMake: (...args) => (opened.make = args),
        openShop: () => undefined,
        openBank: () => undefined,
        openBuild: () => undefined,
    };
    const sys = new SkillSystem(ctx, ui);
    return {
        ctx,
        sys,
        inventory,
        worn,
        xp,
        logs,
        ground,
        npcs,
        opened,
        player,
        get hurt() {
            return hurt;
        },
        /** Registers a region skill loc. */
        place(i: SkillLocInstance) {
            locs.set(i.key, i);
            return i;
        },
        levelXp: xpForLevel,
    };
}
