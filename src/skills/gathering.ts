import { attackRate } from "../combat/Osrs";
import { random } from "../game/Random";
import { TICK_SECONDS } from "../game/TickClock";
import type { AxeDef, PickaxeDef, RockDef, TreeDef } from "../world/SkillFormat";
import type { SkillLocInstance } from "../world/SkillLocs";
import { Job, JobInput, SkillContext, ToolMotion, giveOrDrop, itemName, rollLoot } from "./SkillContext";
import { successChance } from "./success";

/**
 * Ticks between woodcutting rolls [wiki: Woodcutting]. Here every axe blow that lodges in a tree
 * rolls, its chance scaled by how much of this interval has passed since the last blow (so swinging
 * fast gives no more logs than OSRS would); a tree counts as being chopped (its despawn timer runs)
 * for this long after a blow.
 */
export const CHOP_TICKS = 4;

/** Seconds of one overhead pickaxe strike, and the point of it where the pick lands. [design] */
export const MINE_STROKE = { seconds: 1.15, impact: 0.55 };

/**
 * Woodcutting and Mining: trees and rocks that deplete and grow back. Logs come from swinging the
 * wielded axe into a tree like any attack (the blade lodges in the trunk, SkillSystem.swingHit);
 * ore from striking the rock under the crosshair with the wielded pickaxe (a GatherJob). Every blow
 * that lands rolls.
 */
export class Gathering {
    /** Depleted tree or rock key → tick it grows back. */
    private readonly depletedUntil = new Map<string, number>();
    /** Trees with a despawn timer: key → ticks of chopping left. */
    private readonly treeLeft = new Map<string, { left: number; full: number }>();
    /** Tree key → tick of the last blow that landed on it. */
    private readonly struckAt = new Map<string, number>();
    /** Seconds (game clock) of the last pickaxe blow, and of the last axe blow. */
    private lastPickAt = -Infinity;
    private lastChopAt = -Infinity;

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
    ready(item: number): boolean {
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
        if (this.ready(axe.item)) ctx.log("Swing your axe at the tree to chop it.");
    }

    /**
     * Whether the wielded axe's blow on `tree` gets a log: the tree's chance for the axe, scaled
     * by the share of CHOP_TICKS since the last axe blow. Undefined when it cannot cut the tree
     * (the reason logged), or silently when the weapon is not an axe.
     */
    chopRoll(tree: TreeDef): boolean | undefined {
        const ctx = this.ctx;
        const axe = ctx.data.tools.axes.find((a) => a.item === ctx.weapon());
        if (!axe) return undefined;
        const level = ctx.skills.level("woodcutting");
        if (level < axe.level) return void ctx.log("You do not have the Woodcutting level to use this axe.");
        if (level < tree.level) return void ctx.log(`You need a Woodcutting level of ${tree.level} to chop down this tree.`);
        const chance = tree.chances[axe.tier];
        if (!chance) return void ctx.log("Your axe is not strong enough to cut this tree.");
        const now = this.seconds;
        const rate = attackRate(now - this.lastChopAt, CHOP_TICKS * TICK_SECONDS);
        this.lastChopAt = now;
        return random() < successChance(chance, level) * rate;
    }

    /** A swung blade lodged in a standing tree: it shudders, and an axe chops it. */
    strikeTree(instance: SkillLocInstance, index: number): void {
        const tree = this.ctx.data.trees[index];
        const ctx = this.ctx;
        if (this.isDepleted(instance.key)) return;
        ctx.animate(instance, "treeHit");
        const got = this.chopRoll(tree);
        if (got === undefined) return;
        if (tree.despawnTicks !== null && !this.treeLeft.has(instance.key)) {
            this.treeLeft.set(instance.key, { left: tree.despawnTicks, full: tree.despawnTicks });
        }
        this.struckAt.set(instance.key, ctx.clock.tick);
        if (got) this.gotLog(instance, tree);
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
 * Mining by hand: each click (or, held, one after another) on the rock under the crosshair is one
 * overhead stroke of the wielded pickaxe. The blow lands on that rock alone, at the stroke's
 * impact, if the crosshair is still on it; nothing beside it is struck. A click during a stroke
 * queues the next one (spam-clicking mines steadily, like holding); a stroke is never cut short.
 * The job ends when a stroke finishes with no next one wanted, or the crosshair elsewhere. [design]
 */
export class GatherJob implements Job {
    readonly swingTicks = 0;
    readonly skill = "mining" as const;
    private t = 0;
    private struck = false;
    /** The button was clicked during this stroke: strike again after it. */
    private again = false;

    constructor(
        readonly target: SkillLocInstance,
        /** Lands a blow on the target (SkillSystem.strike); called at the stroke's impact. */
        private readonly strike: (instance: SkillLocInstance) => void,
        /** Whether the target can still be struck: the next stroke needs it. */
        private readonly standing: () => boolean,
    ) {}

    tick(): boolean {
        return true;
    }

    toolMotion(): ToolMotion {
        return { kind: "mine", t: this.t };
    }

    frame(dt: number, input: JobInput): boolean {
        const stroke = MINE_STROKE;
        // The click that started this stroke is not a second one.
        if (input.pressed && this.t > 0) this.again = true;
        this.t = Math.min(1, this.t + dt / stroke.seconds);
        if (!this.struck && this.t >= stroke.impact) {
            this.struck = true;
            if (input.aimed === this.target) this.strike(this.target);
        }
        if (this.t < 1) return true;
        if (!(input.down || this.again) || input.aimed !== this.target || !this.standing()) return false;
        this.t = 0;
        this.struck = false;
        this.again = false;
        return true;
    }
}
