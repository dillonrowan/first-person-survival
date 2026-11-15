import { random } from "../game/Random";
import type { AxeDef, AxeTier, PickaxeDef, RockDef, TreeDef } from "../world/SkillFormat";
import type { SkillLocInstance } from "../world/SkillLocs";
import { Job, SkillContext, giveOrDrop, itemName, rollLoot } from "./SkillContext";
import type { SkillSystem } from "./SkillSystem";
import { roll } from "./success";

/** Ticks between woodcutting rolls [wiki: Woodcutting]. */
export const CHOP_TICKS = 4;

/** Woodcutting and Mining: trees and rocks that deplete and grow back. */
export class Gathering {
    /** Depleted tree or rock key → tick it grows back. */
    private readonly depletedUntil = new Map<string, number>();
    /** Trees with a despawn timer: key → ticks of chopping left. */
    private readonly treeLeft = new Map<string, { left: number; full: number }>();

    constructor(
        private readonly ctx: SkillContext,
        private readonly sys: SkillSystem,
    ) {
        ctx.clock.onTick((t) => this.onTick(t));
    }

    isDepleted(key: string): boolean {
        return this.depletedUntil.has(key);
    }

    look(instance: SkillLocInstance): number | undefined {
        return this.depletedUntil.has(instance.key) ? instance.loc.skill?.depletedMesh : undefined;
    }

    /** Depletes a tree or rock for `ticks`. */
    deplete(key: string, ticks: number): void {
        this.depletedUntil.set(key, this.ctx.clock.tick + ticks);
        this.treeLeft.delete(key);
        this.ctx.skillLocs.refresh(key);
    }

    private onTick(t: number): void {
        for (const [key, until] of this.depletedUntil) {
            if (t >= until) {
                this.depletedUntil.delete(key);
                this.ctx.skillLocs.refresh(key);
            }
        }
        // A tree's timer runs down while it is chopped and back up while it is not.
        const active = this.sys.active;
        const chopped = active instanceof ChopJob ? active.target.key : undefined;
        for (const [key, timer] of this.treeLeft) {
            if (key === chopped) timer.left--;
            else if (++timer.left >= timer.full) this.treeLeft.delete(key);
        }
    }

    /** The best axe the player has and can use, else the best they have; undefined without one. */
    bestAxe(tree?: TreeDef): AxeDef | undefined {
        const level = this.ctx.skills.level("woodcutting");
        const owned = this.ctx.data.tools.axes.filter((a) => this.ctx.items.holds(a.item) && (!tree || tree.chances[a.tier]));
        return [...owned].reverse().find((a) => a.level <= level);
    }

    bestPickaxe(): PickaxeDef | undefined {
        const level = this.ctx.skills.level("mining");
        return [...this.ctx.data.tools.pickaxes].reverse().find((p) => p.level <= level && this.ctx.items.holds(p.item));
    }

    chop(instance: SkillLocInstance, index: number): void {
        const tree = this.ctx.data.trees[index];
        const ctx = this.ctx;
        if (this.isDepleted(instance.key)) return ctx.log("This tree has been cut down.");
        if (ctx.skills.level("woodcutting") < tree.level) {
            return ctx.log(`You need a Woodcutting level of ${tree.level} to chop down this tree.`);
        }
        const axe = this.bestAxe(tree);
        if (!axe) return ctx.log("You do not have an axe which you have the Woodcutting level to use.");
        if (!ctx.items.canAdd(tree.logs)) return ctx.log("Your inventory is too full to hold any more logs.");
        ctx.log("You swing your axe at the tree.");
        if (tree.despawnTicks !== null && !this.treeLeft.has(instance.key)) {
            this.treeLeft.set(instance.key, { left: tree.despawnTicks, full: tree.despawnTicks });
        }
        this.sys.start(new ChopJob(this, ctx, instance, tree));
    }

    /** One successful chop: logs, XP, extra loot, and whether the tree falls. */
    gotLog(instance: SkillLocInstance, tree: TreeDef): boolean {
        const ctx = this.ctx;
        giveOrDrop(ctx, tree.logs, 1);
        ctx.gainXp("woodcutting", tree.xp);
        ctx.log(`You get some ${itemName(ctx, tree.logs).toLowerCase()}.`);
        for (const s of rollLoot(tree.extraLoot)) giveOrDrop(ctx, s.id, s.qty);
        const timer = this.treeLeft.get(instance.key);
        const falls = tree.despawnTicks === null ? random() < tree.depleteChance : (timer?.left ?? 0) <= 0;
        if (falls) {
            this.deplete(instance.key, tree.respawnTicks);
            if (tree.despawnTicks !== null) ctx.log("You have run out of logs.");
        }
        return falls;
    }

    mine(instance: SkillLocInstance, index: number): void {
        const rock = this.ctx.data.rocks[index];
        const ctx = this.ctx;
        if (this.isDepleted(instance.key)) return ctx.log("There is no ore currently available in this rock.");
        if (ctx.skills.level("mining") < rock.level) return ctx.log(`You need a Mining level of ${rock.level} to mine this rock.`);
        const pickaxe = this.bestPickaxe();
        if (!pickaxe) return ctx.log("You need a pickaxe to mine this rock. You do not have a pickaxe which you have the Mining level to use.");
        if (!ctx.items.canAdd(rock.ore)) return ctx.log("Your inventory is too full to hold any more ore.");
        ctx.log("You swing your pick at the rock.");
        this.sys.start(new MineJob(this, ctx, instance, rock, pickaxe));
    }

    /** One successful mine; true when the rock is now empty. */
    gotOre(instance: SkillLocInstance, rock: RockDef): boolean {
        const ctx = this.ctx;
        const essence = rock.essence;
        const ore = essence && ctx.skills.level("mining") >= essence.pureLevel ? essence.pure : rock.ore;
        giveOrDrop(ctx, ore, 1);
        ctx.gainXp("mining", rock.xp);
        ctx.log(`You manage to mine some ${itemName(ctx, ore).replace(/ ore$/i, "").toLowerCase()}.`);
        if (essence) return false;
        this.deplete(instance.key, rock.respawnTicks);
        return true;
    }
}

/** Rolls the best axe's chance every 4 ticks until the tree falls or the inventory is full. */
export class ChopJob implements Job {
    readonly skill = "woodcutting" as const;
    readonly swingTicks = CHOP_TICKS;
    private ticks = 0;

    constructor(
        private readonly gathering: Gathering,
        private readonly ctx: SkillContext,
        readonly target: SkillLocInstance,
        private readonly tree: TreeDef,
    ) {}

    tick(): boolean {
        if (++this.ticks % CHOP_TICKS !== 0) return true;
        const axe = this.gathering.bestAxe(this.tree);
        const chance = axe && this.tree.chances[axe.tier as AxeTier];
        if (!chance) return false;
        if (!roll(chance, this.ctx.skills.level("woodcutting"))) return true;
        if (this.gathering.gotLog(this.target, this.tree)) return false;
        if (!this.ctx.items.canAdd(this.tree.logs)) {
            this.ctx.log("Your inventory is too full to hold any more logs.");
            return false;
        }
        return true;
    }
}

/** Rolls the rock's chance at the pickaxe's interval until the rock is empty. */
export class MineJob implements Job {
    readonly skill = "mining" as const;
    readonly swingTicks: number;
    private wait: number;

    constructor(
        private readonly gathering: Gathering,
        private readonly ctx: SkillContext,
        readonly target: SkillLocInstance,
        private readonly rock: RockDef,
        private readonly pickaxe: PickaxeDef,
    ) {
        this.swingTicks = pickaxe.ticks;
        this.wait = this.interval();
    }

    /** Ticks until the next roll: dragon and crystal pickaxes sometimes take one less. */
    private interval(): number {
        return random() < this.pickaxe.fastChance ? this.pickaxe.ticks - 1 : this.pickaxe.ticks;
    }

    tick(): boolean {
        if (--this.wait > 0) return true;
        this.wait = this.interval();
        if (!roll(this.rock.chance, this.ctx.skills.level("mining"))) return true;
        if (this.gathering.gotOre(this.target, this.rock)) return false;
        return this.ctx.items.canAdd(this.rock.ore);
    }
}
