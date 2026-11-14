import * as THREE from "three";

import type { Target, TargetSource } from "../interaction/Interaction";
import { Body, rayCylinder } from "../physics/Bodies";
import type { NpcMeshData, NpcModelData } from "../world/NpcFormat";
import type { GroundItemManifest } from "../world/WorldFormat";
import type { ItemDb } from "./ItemDb";
import type { Stack } from "./ItemContainer";

/** Items further than this from the player have no meshes; beyond DROP they are disposed. */
const SHOW_DISTANCE = 32;
const DROP_DISTANCE = 40;
/** Most items drawn per tile; later ones sit a little higher so each shows. */
const MAX_DRAWN = 3;
const STACK_LIFT = 0.04;
/** The pick-up cylinder around a pile. */
const TARGET_RADIUS = 0.35;
const TARGET_HEIGHT = 0.3;
const RS_UNITS_PER_TILE = 128;

export type GroundEntry = {
    stack: Stack;
    x: number;
    y: number;
    plane: number;
    /** Seconds until it disappears (items dropped by NPCs and the player). */
    despawnIn?: number;
    /** Seconds until a taken world item comes back. */
    respawnIn?: number;
    /** A taken world item waiting to respawn. */
    hidden: boolean;
    /** Seconds since it was added or taken. */
    age: number;
};

type Materials = { opaque: THREE.Material; transparent: THREE.Material };
type Pile = { entries: GroundEntry[]; group?: THREE.Group; drawn?: string };

const keyOf = (plane: number, x: number, y: number) => `${plane}:${x}:${y}`;

/** Items lying in the world: the wiki spawns and what dies and is dropped. Drawn near the player only. */
export class GroundItems {
    private readonly piles = new Map<string, Pile>();
    private readonly models = new Map<string, Promise<NpcModelData>>();
    /** Entries with a timer running (dropped items, taken world items): only these age. */
    private readonly timed = new Set<GroundEntry>();

    constructor(
        private readonly scene: THREE.Scene,
        private readonly materials: Materials,
        private readonly db: ItemDb,
        private readonly loadModel: (file: string) => Promise<NpcModelData>,
        private readonly world: { groundHeight(plane: number, x: number, y: number): number; renderLevel(plane: number, x: number, y: number): number },
    ) {}

    get count(): number {
        let n = 0;
        for (const pile of this.piles.values()) n += pile.entries.length;
        return n;
    }

    /** Loads the spawn list of ground-items.json. */
    addSpawns(manifest: GroundItemManifest): void {
        for (const s of manifest.spawns) {
            this.add({ id: s.item, qty: s.qty }, s.x, s.y, s.plane, { respawnIn: 60 });
        }
    }

    add(stack: Stack, x: number, y: number, plane: number, opts: { despawnIn?: number; respawnIn?: number } = {}): GroundEntry {
        const entry: GroundEntry = { stack: { ...stack }, x, y, plane, hidden: false, age: 0, ...opts };
        const key = keyOf(plane, x, y);
        let pile = this.piles.get(key);
        if (!pile) {
            pile = { entries: [] };
            this.piles.set(key, pile);
        }
        pile.entries.push(entry);
        pile.drawn = undefined;
        if (entry.despawnIn !== undefined) this.timed.add(entry);
        return entry;
    }

    /** Takes `qty` of an entry (all by default); a world item hides until it respawns. */
    take(entry: GroundEntry, qty = entry.stack.qty): Stack {
        const taken = { id: entry.stack.id, qty: Math.min(qty, entry.stack.qty) };
        entry.stack.qty -= taken.qty;
        if (entry.stack.qty <= 0) {
            if (entry.respawnIn !== undefined) {
                entry.hidden = true;
                entry.age = 0;
                this.timed.add(entry);
            } else {
                this.remove(entry);
            }
        }
        const pile = this.piles.get(keyOf(entry.plane, entry.x, entry.y));
        if (pile) pile.drawn = undefined;
        return taken;
    }

    private remove(entry: GroundEntry): void {
        const key = keyOf(entry.plane, entry.x, entry.y);
        this.timed.delete(entry);
        const pile = this.piles.get(key);
        if (!pile) return;
        pile.entries = pile.entries.filter((e) => e !== entry);
        pile.drawn = undefined;
        if (pile.entries.length === 0) {
            this.disposePile(pile);
            this.piles.delete(key);
        }
    }

    /** Ages entries (despawn, respawn) and draws the piles near the player. */
    update(dt: number, playerX: number, playerY: number, plane: number): void {
        for (const entry of [...this.timed]) {
            entry.age += dt;
            if (entry.hidden && entry.respawnIn !== undefined && entry.age >= entry.respawnIn) {
                entry.hidden = false;
                entry.stack.qty = entry.stack.qty > 0 ? entry.stack.qty : 1;
                this.timed.delete(entry);
                const pile = this.piles.get(keyOf(entry.plane, entry.x, entry.y));
                if (pile) pile.drawn = undefined;
            } else if (!entry.hidden && entry.despawnIn !== undefined && entry.age >= entry.despawnIn) {
                this.remove(entry);
            }
        }
        for (const pile of this.piles.values()) {
            const first = pile.entries[0];
            if (!first) continue;
            const distance = Math.hypot(first.x + 0.5 - playerX, first.y + 0.5 - playerY);
            if (first.plane !== plane || distance > DROP_DISTANCE) {
                this.disposePile(pile);
            } else if (distance <= SHOW_DISTANCE) {
                this.drawPile(pile);
            }
        }
    }

    /** Aims at the newest visible item of a pile. */
    targetSource(): TargetSource {
        return (ray) => {
            let best: Target | undefined;
            for (const pile of this.piles.values()) {
                // Cheap rejection first: there are thousands of piles and this runs every frame.
                const first = pile.entries[0];
                if (!first || first.plane !== ray.plane) continue;
                if (Math.hypot(first.x + 0.5 - ray.ox, first.y + 0.5 - ray.oy) > ray.range + 1) continue;
                const visible = pile.entries.filter((e) => !e.hidden);
                const entry = visible[visible.length - 1];
                if (!entry) continue;
                const ground = this.world.groundHeight(entry.plane, entry.x + 0.5, entry.y + 0.5);
                const body: Body<GroundEntry> = {
                    x: entry.x + 0.5,
                    y: entry.y + 0.5,
                    z: ground,
                    radius: TARGET_RADIUS,
                    height: TARGET_HEIGHT,
                    plane: entry.plane,
                    owner: entry,
                };
                const t = rayCylinder(ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, body, ray.range);
                if (t !== undefined && (!best || t < best.distance)) {
                    const info = this.db.get(entry.stack.id);
                    best = {
                        kind: "ground-item",
                        label: `${info?.name ?? "Item"}${entry.stack.qty > 1 ? ` (${entry.stack.qty})` : ""}`,
                        actions: ["Take"],
                        distance: t,
                        ref: entry,
                    };
                }
            }
            return best;
        };
    }

    // ------------------------------------------------------------------ drawing

    private model(file: string): Promise<NpcModelData> {
        let promise = this.models.get(file);
        if (!promise) {
            promise = this.loadModel(file);
            this.models.set(file, promise);
        }
        return promise;
    }

    private drawPile(pile: Pile): void {
        const visible = pile.entries.filter((e) => !e.hidden).slice(-MAX_DRAWN);
        const signature = visible.map((e) => e.stack.id).join(",");
        if (pile.drawn === signature) return;
        pile.drawn = signature;
        this.disposePile(pile, false);
        if (visible.length === 0) return;
        const first = visible[0];
        const group = new THREE.Group();
        const ground = this.world.groundHeight(first.plane, first.x + 0.5, first.y + 0.5);
        group.position.set(first.x + 0.5, ground, -(first.y + 0.5));
        const level = this.world.renderLevel(first.plane, first.x, first.y);
        pile.group = group;
        this.scene.add(group);
        visible.forEach((entry, i) => {
            const info = this.db.get(entry.stack.id);
            if (!info) return;
            void this.model(info.model)
                .then((data) => {
                    // A newer draw replaced this group while the model loaded.
                    if (pile.group !== group) return;
                    const item = new THREE.Group();
                    item.add(...this.meshes(data, level));
                    item.position.y = i * STACK_LIFT + liftFor(data);
                    group.add(item);
                })
                .catch((e) => console.warn(`Item model ${info.model} could not be loaded`, e));
        });
    }

    private meshes(data: NpcModelData, level: number): THREE.Mesh[] {
        const out: THREE.Mesh[] = [];
        for (const [part, transparent] of [[data.opaque, false], [data.transparent, true]] as [NpcMeshData, boolean][]) {
            if (part.indices.length === 0) continue;
            const positions = new Int16Array(part.positions);
            // Depth bias plane bits, see the vertex shader.
            for (let i = 3; i < positions.length; i += 4) positions[i] |= level << 13;
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute("a_position", new THREE.BufferAttribute(positions, 4));
            geometry.setAttribute("a_color", new THREE.BufferAttribute(part.colors, 4, true));
            geometry.setAttribute("a_uv", new THREE.BufferAttribute(part.uvs, 2));
            geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
            const mesh = new THREE.Mesh(geometry, transparent ? this.materials.transparent : this.materials.opaque);
            mesh.renderOrder = transparent ? 2 : 1;
            mesh.frustumCulled = false;
            out.push(mesh);
        }
        return out;
    }

    private disposePile(pile: Pile, forget = true): void {
        if (pile.group) {
            this.scene.remove(pile.group);
            pile.group.traverse((o) => {
                if (o instanceof THREE.Mesh) o.geometry.dispose();
            });
            pile.group = undefined;
        }
        if (forget) pile.drawn = undefined;
    }
}

/** A model that dips below the ground (RS y is down) is lifted so it rests on it. */
export function liftFor(data: NpcModelData): number {
    let lowest = 0;
    for (const part of [data.opaque, data.transparent]) {
        for (let i = 1; i < part.positions.length; i += 4) lowest = Math.max(lowest, part.positions[i]);
    }
    return lowest / RS_UNITS_PER_TILE;
}
