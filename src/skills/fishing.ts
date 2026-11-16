import { random } from "../game/Random";
import type { FishingSpotDef } from "../world/SkillFormat";
import { FishingMinigame } from "./FishingMinigame";
import { Job, JobInput, SkillContext, ToolMotion, giveOrDrop, itemName } from "./SkillContext";
import type { SkillSystem } from "./SkillSystem";
import { roll, successChance } from "./success";

/** Seconds between bite rolls: the OSRS fishing roll every 5 ticks [wiki: Fishing]. */
export const BITE_ROLL_SECONDS = 3;
/** Seconds the cast takes to land. [design] */
export const CAST_SECONDS = 0.7;
/** Seconds the bobber stays under after a bite: click within it to hook the fish. [design] */
export const BITE_WINDOW = 1.1;
/**
 * How close the player must stand to fish a spot: within this many tiles of it across the ground
 * (the shore next to it, diagonals too). [design]
 */
export const FISH_REACH = 2;
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

/**
 * Fishing: left click a spot with its tool in hand (or choose a spot's option), then cast, wait for
 * the bite, hook it and reel it in.
 */
export class Fishing {
    /** A fish was landed at a spot (the view throws it to the player). */
    onCatch?: (spot: FishingSpotTarget, item: number) => void;
    /** A net, pot or harpoon went into the water at a spot. */
    onSplash?: (spot: FishingSpotTarget) => void;

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
     * A left click on a spot with a fishing tool in hand: fishes with the spot's option for that
     * tool (the same click then casts or scoops). False when the click is not for this: no tool of
     * the spot in hand, or a job at this spot (or one mid-catch) already takes the click.
     */
    clickSpot(spot: FishingSpotTarget): boolean {
        const active = this.sys.active;
        if (active instanceof FishJob && (active.spot === spot || active.phase !== "ready")) return false;
        const weapon = this.ctx.weapon();
        const defs = this.ctx.data.fishing.filter((f) => f.npcIds.includes(spot.npcId) && f.tools.includes(weapon ?? -1));
        // One tool can serve two options (a rod: Bait, or Lure with feathers): the one the player can use.
        const def = defs.find((f) => !this.problem(f)) ?? defs[0];
        return def ? this.begin(spot, def, false) : false;
    }

    /**
     * A spot's option: checks the level, tool and bait and puts the tool in hand; then the player
     * casts with the attack button.
     */
    spotAction(spot: FishingSpotTarget, action: string): boolean {
        const def = this.spotFor(spot.npcId, action);
        return def ? this.begin(spot, def, true) : false;
    }

    private begin(spot: FishingSpotTarget, def: FishingSpotDef, hint: boolean): boolean {
        const ctx = this.ctx;
        if (spot.plane !== ctx.player.plane || Math.hypot(spot.x - ctx.player.x, spot.y - ctx.player.y) > FISH_REACH) {
            ctx.log("You need to get closer to the fishing spot.");
            return true;
        }
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
        const job = new FishJob(ctx, this, spot, def);
        if (hint) ctx.log(
            job.stroke === "line"
                ? "Aim at the spot and click to cast your line."
                : `Aim at the spot and click (or hold) to ${job.stroke === "stab" ? "strike with your harpoon" : "scoop with your " + itemName(ctx, ctx.weapon()!).toLowerCase()}.`,
        );
        this.sys.start(job);
        return true;
    }

    /** Why the player cannot fish with these options now, or undefined. */
    problem(def: FishingSpotDef): string | undefined {
        const ctx = this.ctx;
        const lowest = Math.min(...def.catches.map((c) => c.level));
        if (ctx.skills.level("fishing") < lowest) return `You need a Fishing level of ${lowest} to fish here.`;
        if (!def.tools.some((t) => ctx.items.holds(t))) return `You need a ${itemName(ctx, def.tools[0]).toLowerCase()} to fish here.`;
        if (def.bait !== undefined && ctx.items.count(def.bait) === 0) return `You don't have any ${itemName(ctx, def.bait).toLowerCase()} left.`;
        // A full inventory does not stop fishing: the catch falls to the ground (land). [design]
        return undefined;
    }
}

export type FishPhase = "ready" | "cast" | "waiting" | "bite" | "reel" | "scoop";

/** Seconds one scoop of a net or pot (or a harpoon strike) takes. [design] */
export const SCOOP_SECONDS = 1.4;
/** Fraction of the way through a scoop where the tool goes into the water. [design] */
export const SCOOP_SPLASH = 0.4;

/**
 * Fishing at one spot, in one of two ways by the tool in hand.
 *
 * With a rod (`stroke` "line"): a click with the crosshair on the spot casts (ready → cast →
 * waiting). Every BITE_ROLL_SECONDS the OSRS roll runs (catches tried highest level first); a
 * success is a bite: the bobber goes under for BITE_WINDOW, and a click then hooks the fish and
 * starts the reeling minigame. A click while nothing bites reels in empty; a missed bite lets the
 * fish go.
 *
 * With a net, pot or harpoon ("scoop" or "stab"): each click (or, held, one after another) is a
 * scoop through the spot that rolls the OSRS chance once; the player keeps scooping until a fish
 * comes up. [design]
 */
export class FishJob implements Job {
    readonly skill = "fishing" as const;
    readonly swingTicks = 0;
    readonly stroke: "line" | "scoop" | "stab";
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
    /** The reel button is held (for the view). */
    private reeling = false;
    /** The current scoop has gone into the water. */
    private splashed = false;

    constructor(
        private readonly ctx: SkillContext,
        private readonly fishing: Fishing,
        readonly spot: FishingSpotTarget,
        readonly def: FishingSpotDef,
    ) {
        this.bobber = { x: spot.x, y: spot.y, z: spot.waterZ };
        const tool = itemName(ctx, ctx.weapon() ?? -1);
        this.stroke = /\brod\b/i.test(tool) ? "line" : /harpoon/i.test(tool) ? "stab" : "scoop";
    }

    tick(): boolean {
        return true;
    }

    private enter(phase: FishPhase): void {
        this.phase = phase;
        this.phaseTime = 0;
    }

    toolMotion(): ToolMotion | undefined {
        switch (this.phase) {
            case "ready":
                return undefined;
            case "scoop":
                return { kind: this.stroke === "stab" ? "stab" : "scoop", t: Math.min(1, this.phaseTime / SCOOP_SECONDS) };
            case "cast":
                return { kind: "cast", t: Math.min(1, this.phaseTime / CAST_SECONDS) };
            case "waiting":
                return { kind: "wait", t: this.phaseTime };
            case "bite":
                return { kind: "bite", t: this.phaseTime };
            case "reel":
                return { kind: "reel", t: this.phaseTime, holding: this.reeling };
        }
    }

    frame(dt: number, input: JobInput): boolean {
        const ctx = this.ctx;
        if (!this.def.tools.includes(ctx.weapon() ?? -1)) {
            ctx.log("You put your fishing gear away.");
            return false;
        }
        this.phaseTime += dt;
        this.sinceNibble += dt;
        if (this.stroke !== "line") return this.scoopFrame(input);
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
                this.reeling = input.down;
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
            case "scoop":
                return true;
        }
    }

    /** A net, pot or harpoon: scoop through the spot while the button is clicked or held. */
    private scoopFrame(input: JobInput): boolean {
        if (this.phase === "ready") {
            if (!input.pressed && !input.down) return true;
            if (input.aimed !== this.spot) {
                if (input.pressed) this.ctx.log("Aim at the fishing spot.");
                return true;
            }
            this.splashed = false;
            this.enter("scoop");
            return true;
        }
        const t = this.phaseTime / SCOOP_SECONDS;
        if (!this.splashed && t >= SCOOP_SPLASH) {
            this.splashed = true;
            this.fishing.onSplash?.(this.spot);
        }
        if (t < 1) return true;
        this.enter("ready");
        const caught = this.rollCatch();
        return caught ? this.land(caught) : true;
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
