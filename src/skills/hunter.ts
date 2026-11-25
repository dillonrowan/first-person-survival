import { random } from "../game/Random";
import type { Npc } from "../npc/Npc";
import type { HunterDef } from "../world/SkillFormat";
import type { SkillLocInstance } from "../world/SkillLocs";
import { SkillContext, giveOrDrop, rollLoot } from "./SkillContext";
import type { SkillSystem } from "./SkillSystem";
import { roll, successChance } from "./success";

type TrapKind = "bird snare" | "box trap";
type TrapState = "set" | "caught" | "failed";
/** Loc ids of each trap's looks [cache]. */
const TRAP_LOCS: Record<TrapKind, Record<TrapState, number>> = {
    "bird snare": { set: 9345, caught: 9373, failed: 9344 },
    "box trap": { set: 9380, caught: 9382, failed: 9385 },
};
const LAY_TICKS = 3;
const CATCH_TICKS = 3;
/** A creature within this many tiles of a set trap may walk into it. */
const TRAP_REACH = 3;
/** Chance per tick that a set trap springs empty. [design] */
const FAIL_CHANCE = 1 / 200;
/** Ticks before a trap nobody checks falls apart. [design] */
const COLLAPSE_TICKS = 100;
/** Ticks a caught creature stays away. */
const HIDE_TICKS = 50;

type Trap = { kind: TrapKind; state: TrapState; instance?: SkillLocInstance; plane: number; x: number; y: number; setAt: number; caught?: HunterDef };

/** Bird snares, box traps and butterfly nets. */
export class Hunter {
    private readonly traps: Trap[] = [];
    private readonly hidden = new Map<Npc, number>();

    constructor(
        private readonly ctx: SkillContext,
        private readonly sys: SkillSystem,
    ) {
        ctx.clock.onTick((t) => this.onTick(t));
    }

    maxTraps(): number {
        return Math.min(5, 1 + Math.floor(this.ctx.skills.level("hunter") / 20));
    }

    private kindOf(item: number): TrapKind | undefined {
        if (item === this.ctx.data.items["Bird snare"]) return "bird snare";
        if (item === this.ctx.data.items["Box trap"]) return "box trap";
        return undefined;
    }

    /** "Lay" on a bird snare or box trap: sets it on the player's tile. */
    lay(item: number): boolean {
        const kind = this.kindOf(item);
        if (!kind) return false;
        const ctx = this.ctx;
        const max = this.maxTraps();
        if (this.traps.length >= max) {
            ctx.log(`You don't have a high enough Hunter level to set up more than ${max} trap${max > 1 ? "s" : ""}.`);
            return true;
        }
        const x = Math.floor(ctx.player.x);
        const y = Math.floor(ctx.player.y);
        const plane = ctx.player.plane;
        if (ctx.skillLocs.occupies(plane, x, y) || this.traps.some((t) => t.plane === plane && t.x === x && t.y === y)) {
            ctx.log("You can't lay a trap here.");
            return true;
        }
        let ticks = 0;
        ctx.log("You begin setting up the trap.");
        this.sys.start({
            skill: "hunter",
            swingTicks: 0,
            tick: () => {
                if (++ticks < LAY_TICKS) return true;
                if (ctx.items.removeItem(item, 1) === 0) return false;
                const trap: Trap = { kind, state: "set", plane, x, y, setAt: ctx.clock.tick };
                this.traps.push(trap);
                this.show(trap);
                return false;
            },
        });
        return true;
    }

    /** Swaps a trap's model for its current state. */
    private show(trap: Trap): void {
        if (trap.instance) this.ctx.skillLocs.removeRuntime(trap.instance);
        trap.instance = undefined;
        const id = TRAP_LOCS[trap.kind][trap.state];
        const name = trap.kind === "bird snare" ? "Bird snare" : "Box trap";
        const loc = { id, name, actions: [], plane: trap.plane, tileX: trap.x, tileY: trap.y, sizeX: 1, sizeY: 1, height: 0.6 };
        void this.ctx.locModel(id).then((object) => {
            if (!this.traps.includes(trap) || TRAP_LOCS[trap.kind][trap.state] !== id) return;
            trap.instance = this.ctx.skillLocs.addRuntime(loc, object);
        });
    }

    private trapAt(instance: SkillLocInstance): Trap | undefined {
        return this.traps.find((t) => t.instance === instance);
    }

    actionsOf(instance: SkillLocInstance): string[] | undefined {
        const trap = this.trapAt(instance);
        if (!trap) return undefined;
        return trap.state === "caught" ? ["Check"] : ["Dismantle"];
    }

    locAction(instance: SkillLocInstance, action: string): boolean {
        const trap = this.trapAt(instance);
        if (!trap) return false;
        const ctx = this.ctx;
        const item = trap.kind === "bird snare" ? ctx.data.items["Bird snare"] : ctx.data.items["Box trap"];
        if (/^check$/i.test(action) && trap.caught) {
            for (const s of rollLoot(trap.caught.loot)) giveOrDrop(ctx, s.id, s.qty);
            ctx.gainXp("hunter", trap.caught.xp);
            ctx.log(`You've caught a ${trap.caught.creature.toLowerCase()}.`);
        }
        this.remove(trap);
        giveOrDrop(ctx, item, 1);
        return true;
    }

    private remove(trap: Trap): void {
        this.traps.splice(this.traps.indexOf(trap), 1);
        if (trap.instance) this.ctx.skillLocs.removeRuntime(trap.instance);
    }

    /** Creatures this trap kind catches that the player has the level for. */
    private creatures(method: HunterDef["method"]): HunterDef[] {
        const level = this.ctx.skills.level("hunter");
        return this.ctx.data.hunter.filter((h) => h.method === method && h.level <= level);
    }

    private onTick(t: number): void {
        for (const [npc, until] of this.hidden) {
            if (t >= until) {
                npc.group.visible = true;
                this.hidden.delete(npc);
            }
        }
        const ctx = this.ctx;
        for (const trap of [...this.traps]) {
            if (t - trap.setAt >= COLLAPSE_TICKS && trap.state !== "caught") {
                this.remove(trap);
                const item = trap.kind === "bird snare" ? ctx.data.items["Bird snare"] : ctx.data.items["Box trap"];
                ctx.drop({ id: item, qty: 1 }, trap.x, trap.y, trap.plane);
                ctx.log("Your trap has collapsed.");
                continue;
            }
            if (trap.state !== "set") continue;
            if (random() < FAIL_CHANCE) {
                trap.state = "failed";
                this.show(trap);
                continue;
            }
            const level = ctx.skills.level("hunter");
            for (const def of this.creatures(trap.kind)) {
                const npc = ctx.npcsNear(trap.plane, trap.x + 0.5, trap.y + 0.5, TRAP_REACH).find((n) => def.npcIds.includes(n.appearance.id) && !this.hidden.has(n));
                if (npc && random() < successChance(def.chance, level) / 8) {
                    trap.state = "caught";
                    trap.caught = def;
                    this.hide(npc);
                    this.show(trap);
                    break;
                }
            }
        }
    }

    private hide(npc: Npc): void {
        npc.group.visible = false;
        this.hidden.set(npc, this.ctx.clock.tick + HIDE_TICKS);
    }

    /** "Catch" on a butterfly or impling with a net and a jar. */
    npcAction(npc: Npc, action: string): boolean {
        if (!/^catch$/i.test(action)) return false;
        const def = this.ctx.data.hunter.find((h) => h.method === "net" && h.npcIds.includes(npc.appearance.id));
        if (!def) return false;
        const ctx = this.ctx;
        if (this.hidden.has(npc)) return true;
        if (ctx.skills.level("hunter") < def.level) {
            ctx.log(`You need a Hunter level of ${def.level} to catch that.`);
            return true;
        }
        if (!ctx.items.holds(ctx.data.items["Butterfly net"])) {
            ctx.log("You need a butterfly net to catch that.");
            return true;
        }
        const jar = /impling/i.test(def.creature) ? ctx.data.items["Impling jar"] : ctx.data.items["Butterfly jar"];
        if (ctx.items.count(jar) === 0) {
            ctx.log(`You need an empty ${/impling/i.test(def.creature) ? "impling" : "butterfly"} jar.`);
            return true;
        }
        let ticks = 0;
        this.sys.start({
            skill: "hunter",
            swingTicks: 0,
            target: npc,
            tick: () => {
                if (++ticks < CATCH_TICKS) return true;
                if (!roll(def.chance, ctx.skills.level("hunter"))) {
                    ctx.log(`You fail to catch the ${def.creature.toLowerCase()}.`);
                    return false;
                }
                ctx.items.removeItem(jar, 1);
                for (const s of rollLoot(def.loot)) giveOrDrop(ctx, s.id, s.qty);
                ctx.gainXp("hunter", def.xp);
                ctx.log(`You catch the ${def.creature.toLowerCase()}.`);
                this.hide(npc);
                return false;
            },
        });
        return true;
    }
}
