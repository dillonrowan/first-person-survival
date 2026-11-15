import { random } from "../game/Random";
import type { FishingSpotDef } from "../world/SkillFormat";
import { FishingMinigame } from "./FishingMinigame";
import { Job, JobInput, SkillContext, giveOrDrop, itemName } from "./SkillContext";
import type { SkillSystem } from "./SkillSystem";
import { roll, successChance } from "./success";

/** Seconds between bite rolls: the OSRS fishing roll every 5 ticks [wiki: Fishing]. */
export const BITE_ROLL_SECONDS = 3;
/** Seconds the cast takes to land. [design] */
export const CAST_SECONDS = 0.7;
/** Seconds the bobber stays under after a bite: click within it to hook the fish. [design] */
export const BITE_WINDOW = 1.1;
/** Chance a roll that brings no bite shows a nibble instead. [design] */
const NIBBLE_CHANCE = 0.5;

/** A fishing spot as the game places it (src/world/FishingSpots.ts). */
export type FishingSpotTarget = {
    readonly npcId: number;
    readonly x: number;
    readonly y: number;
    readonly plane: number;
    /** Height of the water at the spot. */
    readonly waterZ: number;
};

export type Catch = FishingSpotDef["catches"][number];

/** Fishing: choose a spot's option, then cast, wait for the bite, hook it and reel it in. */
export class Fishing {
    /** A fish was landed at a spot (the view throws it to the player). */
    onCatch?: (spot: FishingSpotTarget, item: number) => void;

    constructor(
        private readonly ctx: SkillContext,
        private readonly sys: SkillSystem,
    ) {}

    spotFor(npcId: number, action: string): FishingSpotDef | undefined {
        const a = action.toLowerCase();
        return this.ctx.data.fishing.find((f) => f.action.toLowerCase() === a && f.npcIds.includes(npcId));
    }

    /** The options a spot offers (Net, Bait, Lure, Cage, Harpoon…). */
    actionsOf(npcId: number): string[] {
        return [...new Set(this.ctx.data.fishing.filter((f) => f.npcIds.includes(npcId)).map((f) => f.action))];
    }

    /**
     * A spot's option: checks the level, tool, bait and space and puts the tool in hand; then the
     * player casts with the attack button.
     */
    spotAction(spot: FishingSpotTarget, action: string): boolean {
        const def = this.spotFor(spot.npcId, action);
        if (!def) return false;
        const ctx = this.ctx;
        const problem = this.problem(def);
        if (problem) {
            ctx.log(problem);
            return true;
        }
        if (!def.tools.includes(ctx.weapon() ?? -1)) {
            const tool = def.tools.find((t) => ctx.items.holds(t))!;
            const refused = ctx.wield(tool);
            if (refused) {
                ctx.log(refused);
                return true;
            }
        }
        ctx.log(/net|cage/i.test(def.action) ? "Aim at the spot and click to cast your net." : "Aim at the spot and click to cast your line.");
        this.sys.start(new FishJob(ctx, this, spot, def));
        return true;
    }

    /** Why the player cannot fish with these options now, or undefined. */
    problem(def: FishingSpotDef): string | undefined {
        const ctx = this.ctx;
        const lowest = Math.min(...def.catches.map((c) => c.level));
        if (ctx.skills.level("fishing") < lowest) return `You need a Fishing level of ${lowest} to fish here.`;
        if (!def.tools.some((t) => ctx.items.holds(t))) return `You need a ${itemName(ctx, def.tools[0]).toLowerCase()} to fish here.`;
        if (def.bait !== undefined && ctx.items.count(def.bait) === 0) return `You don't have any ${itemName(ctx, def.bait).toLowerCase()} left.`;
        if (ctx.items.inventory.freeSlots() === 0) return "You can't carry any more fish.";
        return undefined;
    }
}

export type FishPhase = "ready" | "cast" | "waiting" | "bite" | "reel";

/**
 * Fishing at one spot. A click with the crosshair on the spot casts (ready → cast → waiting).
 * Every BITE_ROLL_SECONDS the OSRS roll runs (catches tried highest level first); a success is a
 * bite: the bobber goes under for BITE_WINDOW, and a click then hooks the fish and starts the
 * reeling minigame. A click while nothing bites reels in empty; a missed bite lets the fish go.
 */
export class FishJob implements Job {
    readonly skill = "fishing" as const;
    readonly swingTicks = 0;
    phase: FishPhase = "ready";
    /** Seconds in the current phase. */
    phaseTime = 0;
    /** Where the bobber lands (tiles; z is the water). */
    readonly bobber: { x: number; y: number; z: number };
    /** Seconds since the last nibble, for the view. */
    sinceNibble = Infinity;
    minigame: FishingMinigame | undefined;
    private nextRoll = 0;
    private hooked: Catch | undefined;

    constructor(
        private readonly ctx: SkillContext,
        private readonly fishing: Fishing,
        readonly spot: FishingSpotTarget,
        readonly def: FishingSpotDef,
    ) {
        this.bobber = { x: spot.x, y: spot.y, z: spot.waterZ };
    }

    tick(): boolean {
        return true;
    }

    private enter(phase: FishPhase): void {
        this.phase = phase;
        this.phaseTime = 0;
    }

    swingPhase(): number | undefined {
        // The cast: the tool flicks forward once.
        return this.phase === "cast" ? Math.min(1, this.phaseTime / CAST_SECONDS) : undefined;
    }

    frame(dt: number, input: JobInput): boolean {
        const ctx = this.ctx;
        if (!this.def.tools.includes(ctx.weapon() ?? -1)) {
            ctx.log("You put your fishing gear away.");
            return false;
        }
        this.phaseTime += dt;
        this.sinceNibble += dt;
        switch (this.phase) {
            case "ready":
                if (!input.pressed) return true;
                if (input.aimed !== this.spot) {
                    ctx.log("Aim at the fishing spot to cast.");
                    return true;
                }
                this.bobber.x = this.spot.x + (random() - 0.5) * 0.6;
                this.bobber.y = this.spot.y + (random() - 0.5) * 0.6;
                this.enter("cast");
                return true;
            case "cast":
                if (this.phaseTime >= CAST_SECONDS) {
                    this.enter("waiting");
                    this.nextRoll = 1 + random() * 2;
                }
                return true;
            case "waiting":
                if (input.pressed) {
                    ctx.log("You reel in too early.");
                    this.enter("ready");
                    return true;
                }
                if (this.phaseTime < this.nextRoll) return true;
                this.nextRoll = this.phaseTime + BITE_ROLL_SECONDS;
                this.hooked = this.rollCatch();
                // No message: the bobber going under its mark is the only sign of a bite.
                if (this.hooked) {
                    this.enter("bite");
                } else if (random() < NIBBLE_CHANCE) {
                    this.sinceNibble = 0;
                }
                return true;
            case "bite":
                if (input.pressed) {
                    const level = ctx.skills.level("fishing");
                    this.minigame = FishingMinigame.forChance(successChance(this.hooked!.chance, level));
                    ctx.log("You hook the fish! Hold to reel, keep it in the zone.");
                    this.enter("reel");
                } else if (this.phaseTime >= BITE_WINDOW) {
                    ctx.log("The fish got away.");
                    this.enter("waiting");
                    this.nextRoll = BITE_ROLL_SECONDS;
                }
                return true;
            case "reel": {
                const game = this.minigame!;
                game.update(dt, input.down);
                if (!game.result) return true;
                this.minigame = undefined;
                this.enter("ready");
                if (game.result === "escaped") {
                    ctx.log("The fish slips off the hook.");
                    return true;
                }
                return this.land(this.hooked!);
            }
        }
    }

    /** The OSRS roll: catches the player has the level for, highest first; the first success bites. */
    private rollCatch(): Catch | undefined {
        const level = this.ctx.skills.level("fishing");
        return this.def.catches.filter((c) => c.level <= level).find((c) => roll(c.chance, level));
    }

    /** The fish is landed: item, XP, bait; false when the player cannot go on. */
    private land(caught: Catch): boolean {
        const ctx = this.ctx;
        giveOrDrop(ctx, caught.item, 1);
        ctx.gainXp("fishing", caught.xp);
        if (this.def.bait !== undefined) ctx.items.removeItem(this.def.bait, 1);
        ctx.log(`You catch some ${itemName(ctx, caught.item).replace(/^Raw /i, "").toLowerCase()}.`);
        this.fishing.onCatch?.(this.spot, caught.item);
        const problem = this.fishing.problem(this.def);
        if (problem) {
            ctx.log(problem);
            return false;
        }
        return true;
    }
}
