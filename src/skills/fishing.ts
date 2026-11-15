import { TICK_SECONDS } from "../game/TickClock";
import type { Npc } from "../npc/Npc";
import type { FishingSpotDef } from "../world/SkillFormat";
import { Job, SkillContext, giveOrDrop, itemName } from "./SkillContext";
import type { SkillSystem } from "./SkillSystem";
import { roll } from "./success";

/** Ticks a cast takes before the next one can be made; each cast on the spot rolls. [design] */
export const CAST_TICKS = 2;

/** Fishing at NPC spots; spots never move or run out here. */
export class Fishing {
    constructor(
        private readonly ctx: SkillContext,
        private readonly sys: SkillSystem,
    ) {}

    spotFor(npcId: number, action: string): FishingSpotDef | undefined {
        const a = action.toLowerCase();
        return this.ctx.data.fishing.find((f) => f.action.toLowerCase() === a && f.npcIds.includes(npcId));
    }

    /** A spot's action: checks the level, tool, bait and space, then the player casts with the attack button. */
    npcAction(npc: Npc, action: string): boolean {
        const spot = this.spotFor(npc.appearance.id, action);
        if (!spot) return false;
        const ctx = this.ctx;
        const lowest = Math.min(...spot.catches.map((c) => c.level));
        if (ctx.skills.level("fishing") < lowest) {
            ctx.log(`You need a Fishing level of ${lowest} to fish here.`);
            return true;
        }
        if (!spot.tools.some((t) => ctx.items.holds(t))) {
            ctx.log(`You need a ${itemName(ctx, spot.tools[0]).toLowerCase()} to fish here.`);
            return true;
        }
        if (spot.bait !== undefined && ctx.items.count(spot.bait) === 0) {
            ctx.log(`You don't have any ${itemName(ctx, spot.bait).toLowerCase()} left.`);
            return true;
        }
        if (ctx.items.inventory.freeSlots() === 0) {
            ctx.log("You can't carry any more fish.");
            return true;
        }
        ctx.log(/net/i.test(spot.action) ? "Aim at the spot and click to cast your net." : "Aim at the spot and click to cast.");
        this.sys.start(new FishJob(ctx, npc, spot));
        return true;
    }
}

/**
 * Fishing at a spot: each click casts (at most one per CAST_TICKS), and a cast that lands on the
 * spot under the crosshair rolls for a catch.
 */
export class FishJob implements Job {
    readonly skill = "fishing" as const;
    readonly swingTicks = 0;
    /** Game-clock seconds of the last cast. */
    private castAt = -Infinity;

    constructor(
        private readonly ctx: SkillContext,
        readonly target: Npc,
        private readonly spot: FishingSpotDef,
    ) {}

    private get seconds(): number {
        return (this.ctx.clock.tick + this.ctx.clock.tickFraction) * TICK_SECONDS;
    }

    tick(): boolean {
        return true;
    }

    swingPhase(): number | undefined {
        const p = (this.seconds - this.castAt) / (CAST_TICKS * TICK_SECONDS);
        return p >= 0 && p < 1 ? p : undefined;
    }

    click(aimed: unknown): boolean {
        const now = this.seconds;
        if (now - this.castAt < CAST_TICKS * TICK_SECONDS) return true;
        this.castAt = now;
        const ctx = this.ctx;
        if (aimed !== this.target) {
            ctx.log("Your cast misses the fishing spot.");
            return true;
        }
        const level = ctx.skills.level("fishing");
        // Highest level first; the first success is the catch.
        const caught = this.spot.catches.filter((c) => c.level <= level).find((c) => roll(c.chance, level));
        if (!caught) return true;
        giveOrDrop(ctx, caught.item, 1);
        ctx.gainXp("fishing", caught.xp);
        if (this.spot.bait !== undefined) ctx.items.removeItem(this.spot.bait, 1);
        ctx.log(`You catch some ${itemName(ctx, caught.item).replace(/^Raw /i, "").toLowerCase()}.`);
        if (this.spot.bait !== undefined && ctx.items.count(this.spot.bait) === 0) {
            ctx.log(`You don't have any ${itemName(ctx, this.spot.bait).toLowerCase()} left.`);
            return false;
        }
        if (ctx.items.inventory.freeSlots() === 0) {
            ctx.log("You can't carry any more fish.");
            return false;
        }
        return true;
    }
}
