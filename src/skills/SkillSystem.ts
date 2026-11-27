import type { Npc } from "../npc/Npc";
import type { RecipeDef, ShopDef } from "../world/SkillFormat";
import type { SkillLocInstance } from "../world/SkillLocs";
import { Artisan } from "./artisan";
import { BossChests } from "./chests";
import { Farming } from "./farming";
import { Fires } from "./fires";
import { Fishing } from "./fishing";
import { GatherJob, Gathering } from "./gathering";
import { Hunter } from "./hunter";
import { Runecraft } from "./runecraft";
import type { Job, JobInput, SkillContext, ToolMotion } from "./SkillContext";
import { Slayer } from "./slayer";
import { Thieving } from "./thieving";

/** How far the player may move from where a job started before it stops. */
const MOVE_CANCEL = 0.75;

export type MakeOption = { recipe: RecipeDef; enabled: boolean };

/** The panels skills open. */
export type SkillUi = {
    openMake(title: string, options: MakeOption[], onPick: (recipe: RecipeDef, qty: number) => void): void;
    openShop(shop: ShopDef): void;
    openBank(): void;
};

/** Per frame: things that stop a job, and the attack button for a job that takes it. */
export type FrameInput = { acted: boolean; panelOpen: boolean; dead: boolean; dt: number; pointer: JobInput };

/**
 * Runs skilling: one job at a time, ticked by the game clock, stopped by moving away, attacking,
 * opening a panel or dying. Routes loc, NPC and item actions to the skill that handles them.
 */
export class SkillSystem {
    private job?: Job;
    private startX = 0;
    private startY = 0;
    private startPlane = 0;

    readonly gathering: Gathering;
    readonly fishing: Fishing;
    readonly artisan: Artisan;
    readonly fires: Fires;
    readonly thieving: Thieving;
    readonly hunter: Hunter;
    readonly farming: Farming;
    readonly slayer: Slayer;
    readonly runecraft: Runecraft;
    readonly chests: BossChests;

    constructor(
        readonly ctx: SkillContext,
        readonly ui: SkillUi,
    ) {
        this.gathering = new Gathering(ctx);
        this.fishing = new Fishing(ctx, this);
        this.artisan = new Artisan(ctx, this);
        this.fires = new Fires(ctx);
        this.thieving = new Thieving(ctx, this);
        this.hunter = new Hunter(ctx, this);
        this.farming = new Farming(ctx, this);
        this.slayer = new Slayer(ctx);
        this.runecraft = new Runecraft(ctx, this);
        this.chests = new BossChests(ctx);
        ctx.clock.onTick((t) => this.tick(t));
    }

    get active(): Job | undefined {
        return this.job;
    }

    /** Starts a job, stopping the current one; it stops if the player moves away from here. */
    start(job: Job): void {
        this.stop();
        this.job = job;
        this.startX = this.ctx.player.x;
        this.startY = this.ctx.player.y;
        this.startPlane = this.ctx.player.plane;
    }

    stop(): void {
        const job = this.job;
        this.job = undefined;
        job?.stop?.();
    }

    /** Per frame: the cancel rules, then the job's own frame (fishing). */
    update(input: FrameInput): void {
        const job = this.job;
        if (!job) return;
        const p = this.ctx.player;
        const moved = p.plane !== this.startPlane || Math.hypot(p.x - this.startX, p.y - this.startY) > MOVE_CANCEL;
        if (moved || input.acted || input.panelOpen || input.dead || this.targetGone(job)) return this.stop();
        if (job.frame && !job.frame(input.dt, input.pointer) && this.job === job) this.stop();
    }

    /** 0..1 through the current tool swing, or undefined when nothing swings. */
    swingPhase(): number | undefined {
        const job = this.job;
        if (!job || job.swingTicks <= 0) return undefined;
        const clock = this.ctx.clock;
        return ((clock.tick + clock.tickFraction) % job.swingTicks) / job.swingTicks;
    }

    /** What the held fishing tool is doing, or undefined. */
    toolMotion(): ToolMotion | undefined {
        return this.job?.toolMotion?.();
    }

    /** Whether the current job takes the attack button instead of the weapon (fishing, mining). */
    get takesClicks(): boolean {
        return !!this.job?.frame;
    }

    /**
     * Whether a swung blade stops on this loc: standing trees (grown farming trees too) and rocks.
     * A blade that does lodges there (swingHit).
     */
    isSolid(instance: SkillLocInstance): boolean {
        const role = this.ctx.data.locs[instance.loc.id]?.role;
        if (role === "patch") return this.farming.choppable(instance);
        return role === "rock" || (role === "tree" && !this.gathering.isDepleted(instance.key));
    }

    /**
     * A swung weapon lodged in a solid loc (isSolid). That is woodcutting: an axe in a tree rolls
     * for a log, any other blade only shakes it. A rock is mined with the pickaxe's own stroke
     * (clickLoc), so a swing into one just stops.
     */
    swingHit(instance: SkillLocInstance): void {
        const role = this.ctx.data.locs[instance.loc.id];
        if (role?.role === "tree") this.gathering.strikeTree(instance, role.index);
        else if (role?.role === "patch") this.farming.strikeTree(instance);
    }

    /** A pickaxe blow landed on a rock. */
    strike(instance: SkillLocInstance): void {
        const role = this.ctx.data.locs[instance.loc.id];
        if (role?.role !== "rock") return;
        this.gathering.strikeRock(instance, role.index);
        this.onToolImpact?.();
    }

    /** A pick blow landed (the view jolts). */
    onToolImpact?: () => void;

    /** Whether the wielded tool mines this loc with its own stroke: a pickaxe and a rock. */
    minesWith(instance: SkillLocInstance): boolean {
        const role = this.ctx.data.locs[instance.loc.id]?.role;
        const weapon = this.ctx.weapon();
        return role === "rock" && this.ctx.data.tools.pickaxes.some((p) => p.item === weapon);
    }

    /**
     * A left click on a rock with a pickaxe in hand (minesWith): in reach, it starts a GatherJob
     * (the same click is its first stroke); out of reach, the player is told to come closer. Either
     * way the click is not a weapon attack, so clicks at the edge of reach do not mix strikes and
     * swings. False when the tool does not mine this loc; a stroke already under way takes the
     * click and is never cut short by one on another rock.
     */
    clickLoc(instance: SkillLocInstance, inReach: boolean): boolean {
        if (!this.minesWith(instance)) return false;
        if (this.job instanceof GatherJob) return true;
        if (!inReach) {
            this.ctx.log("You need to get closer to the rock.");
            return true;
        }
        this.start(new GatherJob(instance, (i) => this.strike(i), () => this.isSolid(instance)));
        return true;
    }

    private tick(t: number): void {
        const job = this.job;
        if (!job) return;
        if (this.targetGone(job) || !job.tick(t)) {
            if (this.job === job) this.stop();
        }
    }

    private targetGone(job: Job): boolean {
        const target = job.target;
        if (!target) return false;
        if ("key" in target) return this.ctx.skillLocs.get(target.key) !== target;
        return target.gone || target.combatant.dead;
    }

    /** The look of a skill loc: depleted or patch state. */
    look(instance: SkillLocInstance): number | undefined {
        return this.gathering.look(instance) ?? this.farming.look(instance) ?? this.chests.look(instance);
    }

    /** The actions shown for a skill loc; none for a loc no skill uses (house hotspots of old exports). */
    actionsOf(instance: SkillLocInstance): string[] | undefined {
        if (!instance.object && !this.ctx.data.locs[instance.loc.id]) return [];
        return this.hunter.actionsOf(instance) ?? this.farming.actionsOf(instance);
    }

    /** A skill loc's action was chosen (E, R or T). */
    locAction(instance: SkillLocInstance, action: string): void {
        const role = this.ctx.data.locs[instance.loc.id];
        if (this.hunter.locAction(instance, action)) return;
        switch (role?.role) {
            case "tree":
                return this.gathering.chop(instance, role.index);
            case "rock":
                return this.gathering.mine(instance, role.index);
            case "stall":
                return this.thieving.steal(instance, role.index);
            case "chest":
                return this.chests.open(instance, role.index);
            case "facility":
                return this.artisan.facilityAction(instance, role.facility, action);
            case "ruins":
            case "altar":
            case "altar-exit":
            case "essence-exit":
                return this.runecraft.locAction(instance, role, action);
            case "patch":
                return this.farming.locAction(instance, role.impl, action);
            case "deposit":
                return this.ui.openBank();
        }
        this.ctx.log("Nothing interesting happens.");
    }

    /** An NPC action; true when a skill handled it (else the NPC just faces the player). */
    npcAction(npc: Npc, action: string): boolean {
        return (
            this.thieving.npcAction(npc, action) ||
            this.hunter.npcAction(npc, action) ||
            this.slayer.npcAction(npc, action) ||
            this.runecraft.npcAction(npc, action) ||
            this.shopAction(npc, action)
        );
    }

    private shopAction(npc: Npc, action: string): boolean {
        if (!/^trade$/i.test(action)) return false;
        const shop = this.shops.find((s) => s.npcIds.includes(npc.appearance.id));
        if (!shop) return false;
        this.ui.openShop(shop);
        return true;
    }

    /** Shops from shops.json; set by main.ts. */
    shops: ShopDef[] = [];

    /** Used one inventory item on another. */
    useItemOnItem(a: number, b: number): void {
        const ia = this.ctx.items.inventory.slots[a]?.id;
        const ib = this.ctx.items.inventory.slots[b]?.id;
        if (ia === undefined || ib === undefined) return;
        if (this.fires.useItems(ia, ib)) return;
        if (this.artisan.useItems(ia, ib)) return;
        this.ctx.log("Nothing interesting happens.");
    }

    /** Used an inventory item on a skill loc. */
    useItemOnLoc(instance: SkillLocInstance, slot: number): void {
        const item = this.ctx.items.inventory.slots[slot]?.id;
        if (item === undefined) return;
        const role = this.ctx.data.locs[instance.loc.id];
        if (role?.role === "facility" && this.artisan.useOnFacility(instance, role.facility, item)) return;
        if (role?.role === "patch" && this.farming.useOnPatch(instance, role.impl, item)) return;
        if (role?.role === "ruins" && this.runecraft.useOnRuins(instance, role.rune, item)) return;
        this.ctx.log("Nothing interesting happens.");
    }

    useItemOnNpc(): void {
        this.ctx.log("Nothing interesting happens.");
    }

    /** An inventory option other than wield, eat, drop and examine; true when a skill handled it. */
    itemOption(slot: number, action: string): boolean {
        const item = this.ctx.items.inventory.slots[slot]?.id;
        if (item === undefined) return false;
        if (/^light$/i.test(action)) return this.fires.light(item);
        if (/^lay$/i.test(action)) return this.hunter.lay(item);
        if (/^clean$/i.test(action)) return this.artisan.clean(item);
        if (/^bury$/i.test(action)) {
            this.ctx.log("Prayer isn't available in this game yet.");
            return true;
        }
        if (/^drink$/i.test(action)) return this.artisan.drink(slot, item);
        return false;
    }

    /** An attackable NPC died. */
    onNpcDeath(npc: Npc): void {
        this.slayer.onKill(npc);
        this.chests.onNpcDeath(npc);
    }
}
