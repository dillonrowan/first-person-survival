import * as THREE from "three";

import { Combatant, Reaction } from "../combat/Combatant";
import type { CombatTarget } from "../combat/PlayerCombat";
import { tuning } from "../combat/tuning";
import type { Target, TargetSource } from "../interaction/Interaction";
import { massForce } from "../npc/NpcPhysics";
import { Body, BodySource, rayCylinder } from "../physics/Bodies";
import { IMPACT_TABLES, ImpactTable, impactDamage, kineticJoules } from "../physics/ImpactDamage";
import { PropBody, PropWorld, WorldImpact, collideBodies } from "../physics/PropBody";
import type { Box } from "../physics/TileColliders";
import { units } from "../player/MoveMath";
import type { DoorGeometry } from "./World";
import { InteractiveLoc, PropMaterial, REGION_SIZE, RegionListener } from "./WorldFormat";

/** propdata classes of the materials (spec 19.1, data propdata.txt). */
export const PROP_MATERIALS: Record<
    PropMaterial,
    { health: number; club: number; gibs: number; table: ImpactTable; color: number }
> = {
    wood: { health: 30, club: 2.0, gibs: 4, table: IMPACT_TABLES.npc, color: 0x8a6a42 },
    cloth: { health: 50, club: 0.75, gibs: 0, table: IMPACT_TABLES.npc, color: 0xb8a888 },
    pottery: { health: 5, club: 1.25, gibs: 4, table: IMPACT_TABLES.glass, color: 0xa0603a },
    metal: { health: 0, club: 1.0, gibs: 0, table: IMPACT_TABLES.npc, color: 0x777777 },
};

/** Lift given to kicks and weapon hits, as a fraction of the horizontal impulse. [design] */
const HIT_LIFT = 0.2;
/** Seconds before the same prop can hurt the same body again. [design] */
const HIT_COOLDOWN = 0.5;

/** A prop's health in the game's own units; weapon damage arrives in this project's Ã—10 units. */
class PropCombatant extends Combatant {
    constructor(
        health: number,
        private readonly club: number,
    ) {
        super(health > 0 ? health : 1);
        this.breakable = health > 0;
    }

    readonly breakable: boolean;

    /** Weapon damage (spec 19.9): back to the game's units, Ã— the material's dmg.club. */
    override hurt(amount: number): void {
        this.damage((amount / tuning.strengthScale) * this.club);
    }

    /** Damage in the game's units (impacts). */
    damage(amount: number): void {
        if (this.breakable && amount > 0) {
            this.health = Math.max(0, this.health - amount);
            this.sinceHurt = 0;
        }
    }
}

/** One prop in the scene. Combat treats it like an NPC it can hit, kick and break. */
export class PropInstance implements CombatTarget {
    readonly combatant: PropCombatant;
    readonly body: PropBody;
    readonly cylinder: Body<CombatTarget>;
    readonly pivot = new THREE.Group();
    readonly inCombat = true;
    readonly kickCost = tuning.kickStaminaOther;
    held = false;
    broken = false;
    /** Clock time of the last throw by the player. */
    thrownAt = -Infinity;
    /** What it rests on, so it falls when that moves away. */
    restingOn?: PropInstance;
    /** Clock time of the last hit on each NPC or the player. */
    readonly lastHit = new Map<unknown, number>();
    /** Frame in which this prop last tested its neighbours for collisions. */
    pairFrame = -1;

    constructor(
        readonly loc: InteractiveLoc,
        readonly key: string,
        readonly mapX: number,
        readonly mapY: number,
    ) {
        const p = loc.prop!;
        const material = PROP_MATERIALS[p.material];
        this.combatant = new PropCombatant(material.health, material.club);
        this.body = new PropBody(p.x, p.y, p.z, loc.plane, p.radius, Math.max(0.1, loc.height), p.mass);
        this.cylinder = { x: p.x, y: p.y, z: p.z, radius: p.radius, height: this.body.height, plane: loc.plane, owner: this };
    }

    get attackable(): boolean {
        return !this.broken && !this.held;
    }

    get material() {
        return PROP_MATERIALS[this.loc.prop!.material];
    }

    get liftable(): boolean {
        return this.body.mass <= tuning.liftMassMax;
    }

    /** A weapon hit (spec 19.9 damage via combat; impulse F(m) Ã— HitPow along the hit [design]). */
    takeHit(dirX: number, dirY: number, _push: number, _fromX: number, _fromY: number, hitPow = 1): void {
        const j = units(massForce(this.body.mass) * hitPow);
        this.body.applyImpulse(dirX * j, dirY * j, j * HIT_LIFT);
    }

    /** A kick (spec 19.3): impactcoeff 2 Ã— F(m) along the kick. */
    kick(dirX: number, dirY: number): "hit" {
        const j = units(massForce(this.body.mass) * tuning.kickImpactCoeff);
        this.body.applyImpulse(dirX * j, dirY * j, j * HIT_LIFT);
        return "hit";
    }

    syncCylinder(): void {
        const c = this.cylinder;
        c.x = this.body.x;
        c.y = this.body.y;
        c.z = this.body.z;
        c.plane = this.body.plane;
    }

    /** Places the drawn model on the body: the pivot sits at the cylinder's centre. */
    syncPivot(): void {
        const b = this.body;
        this.pivot.position.set(b.x, b.z + b.height / 2, -b.y);
        this.pivot.quaternion.copy(b.orientation);
    }
}

/** What WorldProps needs from the world. */
export type PropsWorld = PropWorld & {
    addRegionListener(listener: RegionListener): void;
    regionInteractives(mapX: number, mapY: number): { locs: InteractiveLoc[]; doorGeometries: DoorGeometry[] } | undefined;
};

/** An NPC as far as props are concerned. */
export type PropNpc = {
    readonly body: Body;
    readonly mass: number;
    readonly attackable: boolean;
    readonly combatant: Combatant;
    takeHit(dirX: number, dirY: number, push: number, fromX: number, fromY: number): void;
};

/** The player as far as props are concerned. */
export type PropPlayer = {
    body: Body;
    /** Velocity the player is trying to move at, tiles/s (pushes props it is blocked by). */
    intentX: number;
    intentY: number;
    eyeZ: number;
    yaw: number;
    pitch: number;
};

export type PropsContext = {
    player?: PropPlayer;
    npcs: readonly PropNpc[];
    /** A prop hit an NPC for this much damage. */
    onNpcHit?(npc: PropNpc, damage: number, reaction: Reaction): void;
    /** A prop hit the player for this much damage (the caller applies it). */
    onPlayerHit?(damage: number): void;
};

type SavedState = { x: number; y: number; z: number; plane: number; orientation: THREE.Quaternion };

type Gib = { mesh: THREE.Mesh; body: PropBody; age: number };

const regionKey = (mapX: number, mapY: number) => (mapX << 8) | mapY;
const propKey = (loc: InteractiveLoc) => `${loc.plane}:${loc.tileX}:${loc.tileY}:${loc.id}`;
/**
 * Grid cell of a tile as a small integer (fast Map key). x wraps every 4096 tiles and y every
 * 16384, which only merges cells that far apart; every query checks real distances anyway.
 */
const cellKey = (plane: number, x: number, y: number) => ((plane & 3) << 26) | ((x & 0xfff) << 14) | (y & 0x3fff);
/** Largest prop radius in tiles (the exporter caps it). */
const MAX_PROP_RADIUS = 0.5;

/**
 * Physics props of the loaded map squares (spec 19): crates, barrels, sacks and the like that can be
 * kicked, hit, picked up, thrown and broken. They hurt NPCs and the player they hit, take impact
 * damage themselves and are shoved by whoever walks into them.
 */
export class WorldProps implements BodySource<CombatTarget> {
    private readonly regions = new Map<number, PropInstance[]>();
    /** Moved props keep their place when their square streams out and back in. */
    private readonly saved = new Map<string, SavedState>();
    private readonly brokenKeys = new Set<string>();
    private readonly gibs: Gib[] = [];
    private readonly gibGeometry = new THREE.BoxGeometry(0.16, 0.08, 0.28);
    private readonly gibMaterials = new Map<number, THREE.MeshLambertMaterial>();
    private readonly boxes: Box[] = [];
    private readonly impacts: WorldImpact[] = [];
    private readonly lastNpcPositions = new Map<Body, { x: number; y: number; frame: number }>();
    /** Props by one-tile cell, rebuilt each update (see rebuildGrid). */
    private readonly grid = new Map<number, PropInstance[]>();
    private readonly cellPool: PropInstance[][] = [];
    private readonly near: PropInstance[] = [];
    private clock = 0;
    private frame = 0;
    /** The prop the player carries. */
    held?: PropInstance;

    constructor(
        private readonly world: PropsWorld,
        private readonly scene: THREE.Scene,
        private readonly materials: { opaque: THREE.Material; transparent: THREE.Material },
        private readonly random: () => number = Math.random,
    ) {
        world.addRegionListener({
            loaded: (mapX, mapY) => this.regionLoaded(mapX, mapY),
            unloaded: (mapX, mapY) => this.regionUnloaded(mapX, mapY),
        });
    }

    get count(): number {
        let total = 0;
        for (const props of this.regions.values()) {
            total += props.length;
        }
        return total;
    }

    all(): PropInstance[] {
        return [...this.regions.values()].flat();
    }

    collectBodies(plane: number, minX: number, minY: number, maxX: number, maxY: number, out: Body<CombatTarget>[]): void {
        for (const props of this.regions.values()) {
            for (const prop of props) {
                const b = prop.cylinder;
                if (prop.held || prop.broken || b.plane !== plane) {
                    continue;
                }
                const dx = b.x - Math.min(Math.max(b.x, minX), maxX);
                const dy = b.y - Math.min(Math.max(b.y, minY), maxY);
                if (dx * dx + dy * dy < b.radius * b.radius) {
                    out.push(b);
                }
            }
        }
    }

    /** Aims at the nearest liftable prop within pick-up reach (spec 19.4). */
    targetSource(): TargetSource {
        return (ray) => {
            if (this.held) {
                return undefined;
            }
            const range = Math.min(ray.range, tuning.takeReach);
            let best: Target | undefined;
            for (const props of this.regions.values()) {
                for (const prop of props) {
                    if (prop.broken || prop.cylinder.plane !== ray.plane || !prop.liftable) {
                        continue;
                    }
                    const t = rayCylinder(ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, prop.cylinder, range);
                    if (t !== undefined && (!best || t < best.distance)) {
                        best = { kind: "prop", label: prop.loc.name, actions: ["Pick up"], distance: t, ref: prop };
                    }
                }
            }
            return best;
        };
    }

    pickUp(prop: PropInstance): boolean {
        if (this.held || prop.broken || !prop.liftable) {
            return false;
        }
        this.held = prop;
        prop.held = true;
        prop.restingOn = undefined;
        prop.body.support = -Infinity;
        prop.body.wake();
        return true;
    }

    drop(): void {
        if (this.held) {
            this.held.held = false;
            this.held.body.wake();
            this.held = undefined;
        }
    }

    /**
     * Throws the carried prop (spec 19.4): impulse F(m) Ã— throwforce along the view lowered by 20Â°,
     * with a little random spin.
     */
    throwHeld(yaw: number, pitch: number): PropInstance | undefined {
        const prop = this.held;
        if (!prop) {
            return undefined;
        }
        this.drop();
        const p = pitch - tuning.throwPitchDown;
        const cos = Math.cos(p);
        const j = units(massForce(prop.body.mass) * tuning.throwForce);
        prop.body.vx = prop.body.vy = prop.body.vz = 0;
        prop.body.applyImpulse(-Math.sin(yaw) * cos * j, Math.cos(yaw) * cos * j, Math.sin(p) * j);
        const spin = (tuning.throwSpin * Math.PI) / 180;
        prop.body.spin.set((this.random() - 0.5) * 2 * spin, (this.random() - 0.5) * 2 * spin, (this.random() - 0.5) * 2 * spin);
        prop.thrownAt = this.clock;
        return prop;
    }

    update(dt: number, ctx: PropsContext): void {
        this.clock += dt;
        this.frame++;
        const props = this.all();
        if (this.held) {
            if (ctx.player) {
                this.carry(this.held, dt, ctx.player);
            } else {
                this.drop();
            }
        }
        this.rebuildGrid(props);
        this.updateSupport(props);
        this.pushByPlayer(ctx.player);
        this.pushByNpcs(ctx, dt);

        for (const prop of props) {
            if (prop.held || prop.body.asleep) {
                continue;
            }
            this.impacts.length = 0;
            prop.body.step(dt, this.world, this.boxes, this.impacts, this.random);
            for (const impact of this.impacts) {
                // Walls and floors: static, only the prop's own loss of speed counts.
                prop.combatant.damage(
                    impactDamage(
                        prop.material.table,
                        { mass: prop.body.mass, speed: impact.speed, speedLoss: impact.speedLoss },
                        { mass: Infinity, speed: 0, speedLoss: 0, isStatic: true },
                        { allowStatic: true },
                    ),
                );
            }
        }
        this.rebuildGrid(props);
        this.collideProps(props);
        this.hitPlayer(ctx);

        for (const prop of props) {
            if (prop.combatant.dead && !prop.broken) {
                this.breakProp(prop);
            }
            prop.syncCylinder();
            prop.syncPivot();
        }
        this.updateGibs(dt);
    }

    /** The carried prop follows a point in front of the eyes, stopped by walls. */
    private carry(prop: PropInstance, dt: number, player: PropPlayer): void {
        const b = prop.body;
        const pitch = Math.max(-0.8, Math.min(0.8, player.pitch));
        const reach = player.body.radius + b.radius + 0.35;
        const cos = Math.cos(pitch);
        const tx = player.body.x - Math.sin(player.yaw) * cos * reach;
        const ty = player.body.y + Math.cos(player.yaw) * cos * reach;
        const tz = player.eyeZ - 0.35 + Math.sin(pitch) * reach - b.height / 2;
        const k = Math.min(1, tuning.holdFollowRate * dt);
        b.plane = player.body.plane;
        b.vx = (tx - b.x) * k / Math.max(dt, 1e-6);
        b.vy = (ty - b.y) * k / Math.max(dt, 1e-6);
        b.vz = (tz - b.z) * k / Math.max(dt, 1e-6);
        b.moveAxis(this.world, true, (tx - b.x) * k, this.boxes);
        b.moveAxis(this.world, false, (ty - b.y) * k, this.boxes);
        b.z = Math.max(b.z + (tz - b.z) * k, this.world.groundHeight(b.plane, b.x, b.y));
        b.spin.set(0, 0, 0);
        // Face the same way relative to the player while carried.
        const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
        b.orientation.slerp(yaw, k);
        if (Math.hypot(tx - b.x, ty - b.y, tz - b.z) > tuning.holdDropDistance) {
            this.drop();
        }
    }

    /** Sorts the props that take part in collisions into one-tile cells, for the queries below. */
    private rebuildGrid(props: PropInstance[]): void {
        for (const cell of this.grid.values()) {
            cell.length = 0;
            this.cellPool.push(cell);
        }
        this.grid.clear();
        for (const prop of props) {
            if (prop.held || prop.broken) {
                continue;
            }
            const key = cellKey(prop.body.plane, Math.floor(prop.body.x), Math.floor(prop.body.y));
            let cell = this.grid.get(key);
            if (!cell) {
                cell = this.cellPool.pop() ?? [];
                this.grid.set(key, cell);
            }
            cell.push(prop);
        }
    }

    /**
     * Props on `plane` whose centre may lie within `reach` tiles of (x, y), counting a prop's
     * radius on top. Reuses one array.
     */
    private propsNear(plane: number, x: number, y: number, reach: number): PropInstance[] {
        const out = this.near;
        out.length = 0;
        const r = reach + MAX_PROP_RADIUS;
        const x1 = Math.floor(x + r);
        const y0 = Math.floor(y - r);
        const y1 = Math.floor(y + r);
        for (let cx = Math.floor(x - r); cx <= x1; cx++) {
            for (let cy = y0; cy <= y1; cy++) {
                const cell = this.grid.get(cellKey(plane, cx, cy));
                if (cell) {
                    for (const prop of cell) {
                        out.push(prop);
                    }
                }
            }
        }
        return out;
    }

    /** Props rest on the props under them; a prop whose support moved away falls. */
    private updateSupport(props: PropInstance[]): void {
        for (const a of props) {
            if (a.held) {
                continue;
            }
            const old = a.restingOn;
            if (old && (old.broken || old.held || !old.body.asleep)) {
                a.body.wake();
            }
            if (a.body.asleep) {
                continue;
            }
            let support = -Infinity;
            let on: PropInstance | undefined;
            for (const b of this.propsNear(a.body.plane, a.body.x, a.body.y, a.body.radius)) {
                if (b === a) {
                    continue;
                }
                const top = b.body.top;
                if (top > a.body.z + 0.15 || top < support) {
                    continue;
                }
                if (Math.hypot(a.body.x - b.body.x, a.body.y - b.body.y) < (a.body.radius + b.body.radius) * 0.7) {
                    support = top;
                    on = b;
                }
            }
            a.body.support = support;
            a.restingOn = on;
        }
    }

    /** The player shoves the props it walks into (spec 19.10). */
    private pushByPlayer(player: PropPlayer | undefined): void {
        if (!player) {
            return;
        }
        const p = player.body;
        for (const prop of this.propsNear(p.plane, p.x, p.y, p.radius + 0.05)) {
            this.shove(prop, p, tuning.playerMass, player.intentX, player.intentY, false);
        }
    }

    /**
     * Walking NPCs shove props aside (cvar mm_ai_can_push_props_physics), and props flying into an
     * NPC hurt it (spec 19.6).
     */
    private pushByNpcs(ctx: PropsContext, dt: number): void {
        for (const npc of ctx.npcs) {
            const b = npc.body;
            let last = this.lastNpcPositions.get(b);
            if (!last) {
                last = { x: b.x, y: b.y, frame: this.frame };
                this.lastNpcPositions.set(b, last);
            }
            // Velocity from last frame's position; none for an NPC not seen last frame.
            const tracked = last.frame === this.frame - 1 && dt > 0;
            const vx = tracked ? (b.x - last.x) / dt : 0;
            const vy = tracked ? (b.y - last.y) / dt : 0;
            last.x = b.x;
            last.y = b.y;
            last.frame = this.frame;
            if (npc.combatant.dead) {
                continue;
            }
            for (const prop of this.propsNear(b.plane, b.x, b.y, b.radius + 0.05)) {
                this.hitNpc(prop, npc, vx, vy, ctx);
                this.shove(prop, b, npc.mass, vx, vy, true);
            }
        }
        if (this.frame % 300 === 0) {
            for (const [body, last] of this.lastNpcPositions) {
                if (last.frame < this.frame - 1) {
                    this.lastNpcPositions.delete(body);
                }
            }
        }
    }

    /**
     * A pusher moving at (vx, vy) and touching the prop moves it at its speed along the contact Ã—
     * min(1, pusher mass / (2 Ã— prop mass)). `separate` also moves the prop out of the pusher (NPCs
     * do not get pushed out of props; the player does, by its own collision).
     */
    private shove(prop: PropInstance, pusher: Body, pusherMass: number, vx: number, vy: number, separate: boolean): void {
        const b = prop.body;
        if (!(b.z < pusher.z + pusher.height && pusher.z < b.top)) {
            return;
        }
        const dx = b.x - pusher.x;
        const dy = b.y - pusher.y;
        const reach = b.radius + pusher.radius + 0.02;
        const d = Math.hypot(dx, dy);
        if (d >= reach) {
            return;
        }
        const nx = d > 1e-6 ? dx / d : 1;
        const ny = d > 1e-6 ? dy / d : 0;
        if (separate && d < reach - 0.02) {
            b.moveAxis(this.world, true, nx * (reach - 0.02 - d), this.boxes);
            b.moveAxis(this.world, false, ny * (reach - 0.02 - d), this.boxes);
            b.wake();
        }
        const along = vx * nx + vy * ny;
        if (along <= 0) {
            return;
        }
        const target = along * Math.min(1, pusherMass / (tuning.pushMassFactor * b.mass));
        const current = b.vx * nx + b.vy * ny;
        if (current < target) {
            b.vx += (target - current) * nx;
            b.vy += (target - current) * ny;
            b.wake();
        }
    }

    /** A prop moving fast enough into an NPC hurts it by the prop's mass class (spec 19.6). */
    private hitNpc(prop: PropInstance, npc: PropNpc, npcVx: number, npcVy: number, ctx: PropsContext): void {
        const b = prop.body;
        const n = npc.body;
        if (b.asleep || !npc.attackable || !(b.z < n.z + n.height && n.z < b.top)) {
            return;
        }
        const dx = n.x - b.x;
        const dy = n.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d >= b.radius + n.radius + 0.05 || d < 1e-6) {
            return;
        }
        const nx = dx / d;
        const ny = dy / d;
        // The prop's own speed and direction count, not the NPC's (gh 0x22365530 reads the prop's
        // velocity): an NPC walking into a prop does not hurt itself.
        const closing = b.vx * nx + b.vy * ny;
        const speed = b.speed;
        if (closing <= 0 || speed < tuning.propSpeedToDamageNpc) {
            return;
        }
        const last = prop.lastHit.get(npc) ?? -Infinity;
        if (this.clock - last < HIT_COOLDOWN) {
            return;
        }
        prop.lastHit.set(npc, this.clock);

        const m = b.mass;
        const base = m < tuning.propMediumMass ? tuning.propDamageSmall : m < tuning.propBigMass ? tuning.propDamageMedium : tuning.propDamageBig;
        const damage = base * tuning.strengthScale;
        const energy = kineticJoules(m, speed);
        const reaction: Reaction = energy < tuning.propEnergySmall ? "flinch" : energy < tuning.propEnergyMedium ? "stagger" : "knockdown";
        npc.combatant.hurt(damage, reaction, false, tuning.knockdownPhysics);
        npc.takeHit(nx, ny, reaction === "knockdown" ? 2 : reaction === "stagger" ? 1 : 0, b.x, b.y);
        ctx.onNpcHit?.(npc, damage, reaction);

        // The prop bounces off the (much heavier, kinematic) NPC and is damaged by the stop.
        const before = b.speed;
        b.vx -= (1 + tuning.propRestitution) * closing * nx;
        b.vy -= (1 + tuning.propRestitution) * closing * ny;
        prop.combatant.damage(
            impactDamage(
                prop.material.table,
                { mass: m, speed: before, speedLoss: before - b.speed },
                { mass: npc.mass, speed: Math.hypot(npcVx, npcVy), speedLoss: 0 },
                { allowStatic: true },
            ),
        );
    }

    /** Props hit each other: elastic exchange, impact damage to both (spec 19.5). */
    private collideProps(props: PropInstance[]): void {
        const separate = (body: PropBody, dx: number, dy: number) => {
            body.moveAxis(this.world, true, dx, this.boxes);
            body.moveAxis(this.world, false, dy, this.boxes);
        };
        for (const a of props) {
            if (a.held || a.broken || a.body.asleep) {
                continue;
            }
            // Each awake prop tests its neighbours; a pair of awake props is tested once.
            a.pairFrame = this.frame;
            for (const b of this.propsNear(a.body.plane, a.body.x, a.body.y, a.body.radius)) {
                if (b === a || (!b.body.asleep && b.pairFrame === this.frame)) {
                    continue;
                }
                const speedA = a.body.speed;
                const speedB = b.body.speed;
                const result = collideBodies(a.body, b.body, tuning.propRestitution, separate);
                if (!result) {
                    continue;
                }
                const bodyA = { mass: a.body.mass, speed: speedA, speedLoss: result.lossA };
                const bodyB = { mass: b.body.mass, speed: speedB, speedLoss: result.lossB };
                a.combatant.damage(impactDamage(a.material.table, bodyA, bodyB, { allowStatic: true }));
                b.combatant.damage(impactDamage(b.material.table, bodyB, bodyA, { allowStatic: true }));
            }
        }
    }

    /** Props flying into the player hurt it by the `player` impact table (spec 19.7). */
    private hitPlayer(ctx: PropsContext): void {
        const player = ctx.player;
        if (!player) {
            return;
        }
        const p = player.body;
        for (const prop of this.propsNear(p.plane, p.x, p.y, p.radius + 0.05)) {
            const b = prop.body;
            if (b.asleep || this.clock - prop.thrownAt < tuning.thrownWindow) {
                continue;
            }
            if (!(b.z < p.z + p.height && p.z < b.top)) {
                continue;
            }
            const dx = p.x - b.x;
            const dy = p.y - b.y;
            const d = Math.hypot(dx, dy);
            if (d >= b.radius + p.radius + 0.05 || d < 1e-6) {
                continue;
            }
            const nx = dx / d;
            const ny = dy / d;
            const closing = b.vx * nx + b.vy * ny;
            if (closing <= units(1) || this.clock - (prop.lastHit.get(p) ?? -Infinity) < HIT_COOLDOWN) {
                continue;
            }
            prop.lastHit.set(p, this.clock);
            const speed = b.speed;
            b.vx -= (1 + tuning.propRestitution) * closing * nx;
            b.vy -= (1 + tuning.propRestitution) * closing * ny;
            const damage = impactDamage(
                IMPACT_TABLES.player,
                { mass: tuning.playerMass, speed: 0, speedLoss: 0 },
                { mass: b.mass, speed, speedLoss: speed - b.speed, falling: b.vz < 0 },
            );
            if (damage > 0) {
                ctx.onPlayerHit?.(damage);
            }
        }
    }

    /** Spec 19.9: the prop disappears into its material's gibs. */
    private breakProp(prop: PropInstance): void {
        prop.broken = true;
        if (this.held === prop) {
            this.drop();
        }
        this.brokenKeys.add(prop.key);
        this.scene.remove(prop.pivot);
        const material = prop.material;
        let gibMaterial = this.gibMaterials.get(material.color);
        if (!gibMaterial) {
            gibMaterial = new THREE.MeshLambertMaterial({ color: material.color });
            this.gibMaterials.set(material.color, gibMaterial);
        }
        const b = prop.body;
        for (let i = 0; i < material.gibs; i++) {
            const gib = new PropBody(b.x, b.y, b.z + b.height * (0.3 + 0.4 * this.random()), b.plane, 0.06, 0.08, 1);
            const a = this.random() * Math.PI * 2;
            const s = 1 + this.random() * 2;
            gib.vx = b.vx * 0.5 + Math.cos(a) * s;
            gib.vy = b.vy * 0.5 + Math.sin(a) * s;
            gib.vz = 1 + this.random() * 2;
            gib.spin.set(this.random() * 10 - 5, this.random() * 10 - 5, this.random() * 10 - 5);
            gib.wake();
            const mesh = new THREE.Mesh(this.gibGeometry, gibMaterial);
            this.scene.add(mesh);
            this.gibs.push({ mesh, body: gib, age: 0 });
        }
        for (const [key, region] of this.regions) {
            const index = region.indexOf(prop);
            if (index >= 0) {
                region.splice(index, 1);
                this.regions.set(key, region);
            }
        }
    }

    private updateGibs(dt: number): void {
        const scratch: WorldImpact[] = [];
        for (let i = this.gibs.length - 1; i >= 0; i--) {
            const gib = this.gibs[i];
            gib.age += dt;
            scratch.length = 0;
            gib.body.step(dt, this.world, this.boxes, scratch, this.random);
            gib.mesh.position.set(gib.body.x, gib.body.z + 0.04, -gib.body.y);
            gib.mesh.quaternion.copy(gib.body.orientation);
            // Shrink away over the last second.
            gib.mesh.scale.setScalar(Math.min(1, Math.max(0, tuning.gibLifetime - gib.age)));
            if (gib.age >= tuning.gibLifetime) {
                this.scene.remove(gib.mesh);
                this.gibs.splice(i, 1);
            }
        }
    }

    private regionLoaded(mapX: number, mapY: number): void {
        const key = regionKey(mapX, mapY);
        const data = this.world.regionInteractives(mapX, mapY);
        if (!data || this.regions.has(key)) {
            return;
        }
        const props: PropInstance[] = [];
        for (const loc of data.locs) {
            if (loc.kind !== "prop" || !loc.prop) {
                continue;
            }
            const k = propKey(loc);
            if (this.brokenKeys.has(k)) {
                continue;
            }
            const prop = new PropInstance(loc, k, mapX, mapY);
            this.attachMeshes(prop, mapX, mapY, data.doorGeometries[loc.prop.mesh]);
            const saved = this.saved.get(k);
            if (saved) {
                Object.assign(prop.body, { x: saved.x, y: saved.y, z: saved.z, plane: saved.plane });
                prop.body.orientation.copy(saved.orientation);
            }
            prop.syncCylinder();
            prop.syncPivot();
            this.scene.add(prop.pivot);
            props.push(prop);
        }
        this.regions.set(key, props);
    }

    /** The meshes are in region-local units at the placed position; offset them onto the pivot. */
    private attachMeshes(prop: PropInstance, mapX: number, mapY: number, geometry: DoorGeometry | undefined): void {
        const p = prop.loc.prop!;
        const parts: [THREE.BufferGeometry | undefined, THREE.Material, number][] = [
            [geometry?.opaque, this.materials.opaque, 1],
            [geometry?.transparent, this.materials.transparent, 2],
        ];
        for (const [part, material, renderOrder] of parts) {
            if (part) {
                const mesh = new THREE.Mesh(part, material);
                mesh.position.set(mapX * REGION_SIZE - p.x, -(p.z + prop.body.height / 2), -mapY * REGION_SIZE + p.y);
                mesh.renderOrder = renderOrder;
                prop.pivot.add(mesh);
            }
        }
    }

    private regionUnloaded(mapX: number, mapY: number): void {
        const key = regionKey(mapX, mapY);
        const props = this.regions.get(key);
        if (!props) {
            return;
        }
        for (const prop of props) {
            if (this.held === prop) {
                this.drop();
            }
            const b = prop.body;
            const p = prop.loc.prop!;
            const moved = b.x !== p.x || b.y !== p.y || b.z !== p.z || b.plane !== prop.loc.plane;
            if (moved) {
                this.saved.set(prop.key, { x: b.x, y: b.y, z: b.z, plane: b.plane, orientation: b.orientation.clone() });
            }
            // The geometry belongs to the World, which frees it.
            this.scene.remove(prop.pivot);
        }
        this.regions.delete(key);
    }
}
