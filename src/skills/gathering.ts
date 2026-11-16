import { attackRate } from "../combat/Osrs";
import { random } from "../game/Random";
import { TICK_SECONDS } from "../game/TickClock";
import type { AxeDef, PickaxeDef, RockDef, TreeDef } from "../world/SkillFormat";
import type { SkillLocInstance } from "../world/SkillLocs";
import { Job, JobInput, SkillContext, ToolMotion, giveOrDrop, itemName, rollLoot } from "./SkillContext";
import { successChance } from "./success";

/**
 * Ticks between woodcutting rolls [wiki: Woodcutting]. Here every axe blow that lands rolls; a
 * tree counts as being chopped (its despawn timer runs) for this long after a blow.
 */
export const CHOP_TICKS = 4;

/** Seconds of one axe chop, and the point of it (0..1) where the blade bites. [design] */
export const CHOP_STROKE = { seconds: 1.0, impact: 0.5 };
/** Seconds of one overhead pickaxe strike, and the point of it where the pick lands. [design] */
export const MINE_STROKE = { seconds: 1.15, impact: 0.55 };

/**
 * Woodcutting and Mining: trees and rocks that deplete and grow back. Logs and ore come from
 * striking the tree or rock under the crosshair with the wielded axe or pickaxe (a GatherJob):
 * every blow that lands rolls.
 */
export class Gathering {
    /** Depleted tree or rock key → tick it grows back. */
    private readonly depletedUntil = new Map<string, number>();
    /** Trees with a despawn timer: key → ticks of chopping left. */
    private readonly treeLeft = new Map<string, { left: number; full: number }>();
    /** Tree key → tick of the last blow that landed on it. */
    private readonly struckAt = new Map<string, number>();
    /** Seconds (game clock) of the last pickaxe blow. */
    private lastPickAt = -Infinity;

    constructor(private readonly ctx: SkillContext) {
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
        this.struckAt.delete(key);
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
        for (const [key, timer] of this.treeLeft) {
            const struck = this.struckAt.get(key);
            if (struck !== undefined && t - struck <= CHOP_TICKS) timer.left--;
            else if (++timer.left >= timer.full) this.treeLeft.delete(key);
        }
    }

    private get seconds(): number {
        return (this.ctx.clock.tick + this.ctx.clock.tickFraction) * TICK_SECONDS;
    }

    /** The best axe the player has and can use, else undefined. */
    bestAxe(tree?: TreeDef): AxeDef | undefined {
        const level = this.ctx.skills.level("woodcutting");
        const owned = this.ctx.data.tools.axes.filter((a) => this.ctx.items.holds(a.item) && (!tree || tree.chances[a.tier]));
        return [...owned].reverse().find((a) => a.level <= level);
    }

    bestPickaxe(): PickaxeDef | undefined {
        const level = this.ctx.skills.level("mining");
        return [...this.ctx.data.tools.pickaxes].reverse().find((p) => p.level <= level && this.ctx.items.holds(p.item));
    }

    /** Wields `item` unless it is already in hand; false (with the reason logged) when it cannot be. */
    private ready(item: number): boolean {
        if (this.ctx.weapon() === item) return true;
        const problem = this.ctx.wield(item);
        if (problem) this.ctx.log(problem);
        return !problem;
    }

    /** "Chop down": checks the tree can be cut and puts the best axe in hand for the player to swing. */
    chop(instance: SkillLocInstance, index: number): void {
        const tree = this.ctx.data.trees[index];
        const ctx = this.ctx;
        if (this.isDepleted(instance.key)) return ctx.log("This tree has been cut down.");
        if (ctx.skills.level("woodcutting") < tree.level) {
            return ctx.log(`You need a Woodcutting level of ${tree.level} to chop down this tree.`);
        }
        const axe = this.bestAxe(tree);
        if (!axe) return ctx.log("You do not have an axe which you have the Woodcutting level to use.");
        // A full inventory does not stop the chopping: the logs fall to the ground (gotLog).
        if (this.ready(axe.item)) ctx.log("Click the tree to chop it.");
    }

    /** An axe blow (or any other blade) landed on a standing tree: the wielded axe rolls for a log. */
    strikeTree(instance: SkillLocInstance, index: number): void {
        const tree = this.ctx.data.trees[index];
        const ctx = this.ctx;
        if (this.isDepleted(instance.key)) return;
        ctx.animate(instance, "treeHit");
        const axe = ctx.data.tools.axes.find((a) => a.item === ctx.weapon());
        if (!axe) return ctx.log("You need to wield an axe to chop this tree.");
        const level = ctx.skills.level("woodcutting");
        if (level < axe.level) return ctx.log("You do not have the Woodcutting level to use this axe.");
        if (level < tree.level) return ctx.log(`You need a Woodcutting level of ${tree.level} to chop down this tree.`);
        const chance = tree.chances[axe.tier];
        if (!chance) return ctx.log("Your axe is not strong enough to cut this tree.");
        if (tree.despawnTicks !== null && !this.treeLeft.has(instance.key)) {
            this.treeLeft.set(instance.key, { left: tree.despawnTicks, full: tree.despawnTicks });
        }
        this.struckAt.set(instance.key, ctx.clock.tick);
        if (random() < successChance(chance, level)) this.gotLog(instance, tree);
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
            ctx.animate(instance, "treeFall", true);
            this.deplete(instance.key, tree.respawnTicks);
            if (tree.despawnTicks !== null) ctx.log("You have run out of logs.");
        }
        return falls;
    }

    /** "Mine": checks the rock can be mined and puts the best pickaxe in hand for the player to swing. */
    mine(instance: SkillLocInstance, index: number): void {
        const rock = this.ctx.data.rocks[index];
        const ctx = this.ctx;
        if (this.isDepleted(instance.key)) return ctx.log("There is no ore currently available in this rock.");
        if (ctx.skills.level("mining") < rock.level) return ctx.log(`You need a Mining level of ${rock.level} to mine this rock.`);
        const pickaxe = this.bestPickaxe();
        if (!pickaxe) return ctx.log("You need a pickaxe to mine this rock. You do not have a pickaxe which you have the Mining level to use.");
        if (!ctx.items.canAdd(rock.ore)) return ctx.log("Your inventory is too full to hold any more ore.");
        if (this.ready(pickaxe.item)) ctx.log("Click the rock to mine it.");
    }

    /**
     * A blow landed on a rock: with a pickaxe in hand it rolls the rock's chance, scaled by how
     * much of the pickaxe's OSRS interval has passed since the last blow, so a better pickaxe
     * needs fewer blows and hammering fast gives no more ore than OSRS would. [design]
     */
    strikeRock(instance: SkillLocInstance, index: number): void {
        const rock = this.ctx.data.rocks[index];
        const ctx = this.ctx;
        ctx.animate(instance, "rockHit");
        if (this.isDepleted(instance.key)) return ctx.log("There is no ore currently available in this rock.");
        const pickaxe = ctx.data.tools.pickaxes.find((p) => p.item === ctx.weapon());
        if (!pickaxe) return ctx.log("You need to wield a pickaxe to mine this rock.");
        const level = ctx.skills.level("mining");
        if (level < pickaxe.level) return ctx.log("You do not have the Mining level to use this pickaxe.");
        if (level < rock.level) return ctx.log(`You need a Mining level of ${rock.level} to mine this rock.`);
        if (!ctx.items.canAdd(rock.ore)) return ctx.log("Your inventory is too full to hold any more ore.");
        const now = this.seconds;
        const rate = attackRate(now - this.lastPickAt, (pickaxe.ticks - pickaxe.fastChance) * TICK_SECONDS);
        this.lastPickAt = now;
        if (random() < successChance(rock.chance, level) * rate) this.gotOre(instance, rock);
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
        ctx.animate(instance, "rockBreak", true);
        this.deplete(instance.key, rock.respawnTicks);
        return true;
    }
}

/**
 * Chopping or mining by hand: each click (or, held, one after another) on the tree or rock under
 * the crosshair is one stroke of the wielded tool, an axe chop or an overhead pickaxe strike. The
 * blow lands on that tree or rock alone, at the stroke's impact, if the crosshair is still on it;
 * nothing beside it is struck. The job ends when a stroke finishes with the button up or the
 * crosshair elsewhere. [design]
 */
export class GatherJob implements Job {
    readonly swingTicks = 0;
    readonly skill: "woodcutting" | "mining";
    private t = 0;
    private struck = false;

    constructor(
        readonly target: SkillLocInstance,
        private readonly kind: "chop" | "mine",
        /** Lands a blow on the target (SkillSystem.strike); called at the stroke's impact. */
        private readonly strike: (instance: SkillLocInstance) => void,
        /** Whether the target can still be struck (not felled): the next stroke needs it. */
        private readonly standing: () => boolean,
    ) {
        this.skill = kind === "chop" ? "woodcutting" : "mining";
    }

    private get stroke(): { seconds: number; impact: number } {
        return this.kind === "chop" ? CHOP_STROKE : MINE_STROKE;
    }

    tick(): boolean {
        return true;
    }

    toolMotion(): ToolMotion {
        return { kind: this.kind, t: this.t };
    }

    frame(dt: number, input: JobInput): boolean {
        const stroke = this.stroke;
        this.t = Math.min(1, this.t + dt / stroke.seconds);
        if (!this.struck && this.t >= stroke.impact) {
            this.struck = true;
            if (input.aimed === this.target) this.strike(this.target);
        }
        if (this.t < 1) return true;
        if (!input.down || input.aimed !== this.target || !this.standing()) return false;
        this.t = 0;
        this.struck = false;
        return true;
    }
}
