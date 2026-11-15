import { random } from "../game/Random";
import type { CropDef, PatchImpl } from "../world/SkillFormat";
import type { SkillLocInstance } from "../world/SkillLocs";
import { SkillContext, giveOrDrop, itemName } from "./SkillContext";
import type { SkillSystem } from "./SkillSystem";
import { roll } from "./success";

/** Real minutes for one weed to grow back on an empty patch. [design] */
const WEED_MINUTES = 5;
const RAKE_TICKS = 2;
const HARVEST_TICKS = 2;
const RAKE_XP = 4;
/** Herbs, allotments and hops: each harvest loses a life with this chance; 3 lives. [design] */
const LIFE_LOSS = 1 / 3;
const LIVES = 3;
/** Minutes for one fruit (fruit trees) or berry (bushes) to grow back. */
const REGROW_MINUTES: Partial<Record<PatchImpl, number>> = { FRUIT_TREE: 40, BUSH: 20 };
const MINUTE = 60_000;
const STORE_KEY = "farming";

export type PatchSave = {
    produce: string | null;
    /** Date.now() when planted. */
    plantedAt: number;
    weeds: number;
    weedsAt: number;
    lives: number;
    checked: boolean;
    /** Fruit or berries left, and when that count was last set. */
    left: number;
    leftAt: number;
};

/** Patch state from real time: weeds regrow, crops grow (no disease, no compost). */
export class Farming {
    private readonly patches: Record<string, PatchSave>;
    /** Date.now, swappable for tests. */
    now = () => Date.now();

    constructor(
        private readonly ctx: SkillContext,
        private readonly sys: SkillSystem,
    ) {
        this.patches = ctx.store.get<Record<string, PatchSave>>(STORE_KEY) ?? {};
        // Growth is real time: re-show the patches now and then.
        ctx.clock.onTick((t) => {
            if (t % 10 === 0) for (const key of Object.keys(this.patches)) ctx.skillLocs.refresh(key);
        });
    }

    private save(): void {
        this.ctx.store.set(STORE_KEY, this.patches);
    }

    private state(key: string): PatchSave {
        return (this.patches[key] ??= { produce: null, plantedAt: 0, weeds: 3, weedsAt: this.now(), lives: 0, checked: false, left: 0, leftAt: 0 });
    }

    private crop(save: PatchSave): CropDef | undefined {
        return save.produce ? this.ctx.data.farming.crops.find((c) => c.produce === save.produce) : undefined;
    }

    weeds(save: PatchSave): number {
        return Math.min(3, save.weeds + Math.floor((this.now() - save.weedsAt) / (WEED_MINUTES * MINUTE)));
    }

    stage(save: PatchSave, crop: CropDef): number {
        return Math.min(crop.stages - 1, Math.floor((this.now() - save.plantedAt) / (crop.stageMinutes * MINUTE)));
    }

    /** Fruit or berries on a grown fruit tree or bush. */
    private fruitLeft(save: PatchSave, crop: CropDef): number {
        const minutes = REGROW_MINUTES[crop.impl] ?? 40;
        return Math.min(crop.pickMax ?? 0, save.left + Math.floor((this.now() - save.leftAt) / (minutes * MINUTE)));
    }

    private ready(save: PatchSave, crop: CropDef): boolean {
        return this.stage(save, crop) >= crop.stages - 1;
    }

    /** The patch's varbit value, as the client would show it [RuneLite]. */
    value(key: string, impl: PatchImpl): number {
        const save = this.state(key);
        const crop = this.crop(save);
        if (!crop) return this.ctx.data.farming.weeds[impl]?.[3 - this.weeds(save)] ?? 0;
        if (!this.ready(save, crop)) return crop.growing[this.stage(save, crop)];
        if (crop.impl === "TREE") return save.checked && crop.checked !== undefined ? crop.checked : crop.harvestable;
        if (crop.pickBase !== undefined) return save.checked ? crop.pickBase + this.fruitLeft(save, crop) : crop.harvestable;
        return crop.harvestable;
    }

    look(instance: SkillLocInstance): number | undefined {
        const role = this.ctx.data.locs[instance.loc.id];
        const meshes = instance.loc.skill?.stateMeshes;
        if (role?.role !== "patch" || !meshes) return undefined;
        const v = this.value(instance.key, role.impl);
        return meshes[Math.min(v, meshes.length - 1)];
    }

    actionsOf(instance: SkillLocInstance): string[] | undefined {
        if (this.ctx.data.locs[instance.loc.id]?.role !== "patch") return undefined;
        const save = this.state(instance.key);
        const crop = this.crop(save);
        if (!crop) return this.weeds(save) > 0 ? ["Rake", "Inspect"] : ["Inspect"];
        if (!this.ready(save, crop)) return ["Inspect"];
        if (crop.impl === "TREE" || crop.pickBase !== undefined) {
            if (!save.checked) return ["Check-health"];
            return crop.impl === "TREE" ? ["Chop down"] : ["Pick", "Inspect"];
        }
        return ["Harvest", "Inspect"];
    }

    locAction(instance: SkillLocInstance, impl: PatchImpl, action: string): void {
        const ctx = this.ctx;
        const key = instance.key;
        const save = this.state(key);
        const crop = this.crop(save);
        const a = action.toLowerCase();
        if (a === "rake") return this.rake(instance, save);
        if (a === "inspect") {
            if (!crop) return ctx.log(this.weeds(save) > 0 ? "The patch needs weeding." : "The patch has been weeded. It's ready for planting.");
            return ctx.log(this.ready(save, crop) ? `The ${crop.name.toLowerCase()} is fully grown.` : `The ${crop.name.toLowerCase()} is growing.`);
        }
        if (!crop || !this.ready(save, crop)) return ctx.log("Nothing interesting happens.");
        if (a === "check-health") {
            save.checked = true;
            save.left = crop.pickMax ?? 0;
            save.leftAt = this.now();
            ctx.gainXp("farming", crop.checkXp ?? 0);
            ctx.log(`You examine the ${crop.name.toLowerCase()} for signs of disease and find that it's in perfect health.`);
            this.changed(key);
            return;
        }
        if (a === "chop down") return this.chopTree(instance, save, crop);
        if (a === "pick" && crop.pickBase !== undefined) return this.pick(key, save, crop);
        if (a === "harvest" || a === "pick") return this.harvest(instance, save, crop, impl);
        ctx.log("Nothing interesting happens.");
    }

    private changed(key: string): void {
        this.save();
        this.ctx.skillLocs.refresh(key);
    }

    private reset(key: string, save: PatchSave): void {
        Object.assign(save, { produce: null, plantedAt: 0, weeds: 0, weedsAt: this.now(), lives: 0, checked: false, left: 0, leftAt: 0 });
        this.changed(key);
    }

    private rake(instance: SkillLocInstance, save: PatchSave): void {
        const ctx = this.ctx;
        if (!ctx.items.holds(ctx.data.items.Rake)) return ctx.log("You need a rake to weed a farming patch.");
        if (this.crop(save) || this.weeds(save) === 0) return ctx.log("This patch doesn't need weeding.");
        let ticks = 0;
        this.sys.start({
            skill: "farming",
            swingTicks: RAKE_TICKS,
            target: instance,
            tick: () => {
                if (++ticks % RAKE_TICKS !== 0) return true;
                save.weeds = this.weeds(save) - 1;
                save.weedsAt = this.now();
                giveOrDrop(ctx, ctx.data.items.Weeds, 1);
                ctx.gainXp("farming", RAKE_XP);
                this.changed(instance.key);
                return save.weeds > 0;
            },
        });
    }

    /** A seed used on the patch. */
    useOnPatch(instance: SkillLocInstance, impl: PatchImpl, item: number): boolean {
        const crop = this.ctx.data.farming.crops.find((c) => c.seed === item && c.impl === impl);
        if (!crop) return false;
        const ctx = this.ctx;
        const save = this.state(instance.key);
        if (this.crop(save)) return (ctx.log("This patch already has something growing in it."), true);
        if (this.weeds(save) > 0) return (ctx.log("This patch needs weeding first."), true);
        if (ctx.skills.level("farming") < crop.level) return (ctx.log(`You need a Farming level of ${crop.level} to plant that.`), true);
        const spade = crop.impl === "TREE" || crop.impl === "FRUIT_TREE" || crop.impl === "BUSH";
        const tool = spade ? ctx.data.items.Spade : ctx.data.items["Seed dibber"];
        if (!ctx.items.holds(tool)) return (ctx.log(`You need a ${spade ? "spade" : "seed dibber"} to plant that.`), true);
        if (ctx.items.count(item) < crop.seedQty) return (ctx.log(`You need ${crop.seedQty} seeds to plant this patch.`), true);
        ctx.items.removeItem(item, crop.seedQty);
        ctx.gainXp("farming", crop.plantXp);
        Object.assign(save, { produce: crop.produce, plantedAt: this.now(), lives: LIVES, checked: false });
        ctx.log(`You plant ${crop.seedQty} ${itemName(ctx, item).toLowerCase()} in the ${instance.loc.name.toLowerCase()}.`);
        this.changed(instance.key);
        return true;
    }

    private harvest(instance: SkillLocInstance, save: PatchSave, crop: CropDef, impl: PatchImpl): void {
        const ctx = this.ctx;
        if ((impl === "ALLOTMENT" || impl === "HOPS") && !ctx.items.holds(ctx.data.items.Spade)) return ctx.log("You need a spade to harvest this patch.");
        let ticks = 0;
        this.sys.start({
            skill: "farming",
            swingTicks: 0,
            target: instance,
            tick: () => {
                if (++ticks % HARVEST_TICKS !== 0) return true;
                if (!ctx.items.canAdd(crop.item)) {
                    ctx.log("You don't have enough inventory space.");
                    return false;
                }
                giveOrDrop(ctx, crop.item, 1);
                ctx.gainXp("farming", crop.xp);
                if (impl === "FLOWER" || random() < LIFE_LOSS) save.lives--;
                if (save.lives <= 0 || impl === "FLOWER") {
                    ctx.log("The patch is now empty.");
                    this.reset(instance.key, save);
                    return false;
                }
                this.save();
                return true;
            },
        });
    }

    private pick(key: string, save: PatchSave, crop: CropDef): void {
        const ctx = this.ctx;
        const left = this.fruitLeft(save, crop);
        if (left <= 0) return ctx.log("There's nothing left to pick.");
        if (!ctx.items.canAdd(crop.item)) return ctx.log("You don't have enough inventory space.");
        save.left = left - 1;
        save.leftAt = this.now();
        giveOrDrop(ctx, crop.item, 1);
        ctx.gainXp("farming", crop.xp);
        ctx.log(`You pick ${itemName(ctx, crop.item).toLowerCase()}.`);
        this.changed(key);
    }

    /** A grown, checked tree is cut once; the patch is then empty. */
    private chopTree(instance: SkillLocInstance, save: PatchSave, crop: CropDef): void {
        const ctx = this.ctx;
        const tree = ctx.data.trees.find((t) => t.name.toLowerCase() === crop.name.toLowerCase());
        const axe = this.sys.gathering.bestAxe(tree);
        const chance = tree && axe && tree.chances[axe.tier];
        if (!tree || !chance) return ctx.log("You do not have an axe which you have the Woodcutting level to use.");
        if (ctx.skills.level("woodcutting") < tree.level) return ctx.log(`You need a Woodcutting level of ${tree.level} to chop down this tree.`);
        ctx.log("You swing your axe at the tree.");
        let ticks = 0;
        this.sys.start({
            skill: "woodcutting",
            swingTicks: 4,
            target: instance,
            tick: () => {
                if (++ticks % 4 !== 0 || !roll(chance, ctx.skills.level("woodcutting"))) return true;
                giveOrDrop(ctx, tree.logs, 1);
                ctx.gainXp("woodcutting", tree.xp);
                ctx.log(`You get some ${itemName(ctx, tree.logs).toLowerCase()}.`);
                this.reset(instance.key, save);
                return false;
            },
        });
    }
}
