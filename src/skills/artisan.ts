import type { SkillId } from "../combat/SkillId";
import { random } from "../game/Random";
import type { Facility, RecipeDef } from "../world/SkillFormat";
import type { SkillLocInstance } from "../world/SkillLocs";
import { Job, SkillContext, article, giveOrDrop, itemName } from "./SkillContext";
import type { SkillSystem } from "./SkillSystem";
import { successChance } from "./success";

/** Facility actions that open the make menu with everything the facility makes. */
const FACILITY_ACTIONS = /^(smelt|smith|cook|spin|use|form|fire|weave)$/i;

/** Cooking, Smithing, Crafting, Fletching and Herblore: recipes made at a facility or by hand. */
export class Artisan {
    constructor(
        private readonly ctx: SkillContext,
        private readonly sys: SkillSystem,
    ) {}

    private recipes(facility: Facility | null): RecipeDef[] {
        // A range recipe can be cooked on a fire and the other way round, as in OSRS.
        const cooking = facility === "range" || facility === "fire";
        return this.ctx.data.recipes.filter((r) => r.facility === facility || (cooking && (r.facility === "range" || r.facility === "fire")));
    }

    private canMake(r: RecipeDef): boolean {
        const level = (s: string) => this.ctx.skills.level(s as SkillId);
        return level(r.skill) >= r.level && (r.extra ?? []).every((e) => level(e.skill) >= e.level);
    }

    /** Opens the make menu for these recipes; "All" makes as many as the materials allow. */
    private offer(title: string, recipes: RecipeDef[], facility?: SkillLocInstance): void {
        if (recipes.length === 0) {
            this.ctx.log("Nothing interesting happens.");
            return;
        }
        // Alternatives for one output (range or fire, other materials): the one the player can make.
        const held = (r: RecipeDef) => r.materials.every((m) => this.ctx.items.count(m.item) >= m.qty);
        recipes = dedupe([...recipes].sort((a, b) => Number(held(b)) - Number(held(a))));
        this.sys.ui.openMake(
            title,
            recipes.map((recipe) => ({ recipe, enabled: this.canMake(recipe) })),
            (recipe, qty) => this.make(recipe, qty, facility),
        );
    }

    make(recipe: RecipeDef, qty: number, facility?: SkillLocInstance): void {
        if (!this.canMake(recipe)) {
            this.ctx.log(`You need a ${capital(recipe.skill)} level of ${recipe.level} to make that.`);
            return;
        }
        const onFire = facility ? this.ctx.data.locs[facility.loc.id]?.role === "facility" && (this.ctx.data.locs[facility.loc.id] as { facility: Facility }).facility === "fire" : false;
        this.sys.start(new RecipeJob(this.ctx, recipe, qty, facility, onFire));
    }

    facilityAction(instance: SkillLocInstance, facility: Facility, action: string): void {
        if (facility === "water") {
            this.ctx.log("Use a vial, bucket or jug on it to fill it.");
            return;
        }
        if (!FACILITY_ACTIONS.test(action)) {
            this.ctx.log("Nothing interesting happens.");
            return;
        }
        const held = this.recipes(facility).filter((r) => r.materials.some((m) => this.ctx.items.count(m.item) > 0));
        if (held.length === 0) {
            this.ctx.log("You don't have anything to use here.");
            return;
        }
        this.offer(instance.loc.name, held, instance);
    }

    useOnFacility(instance: SkillLocInstance, facility: Facility, item: number): boolean {
        if (facility === "water") return this.fill(instance, item);
        const recipes = this.recipes(facility).filter((r) => r.materials.some((m) => m.item === item));
        if (recipes.length === 0) return false;
        this.offer(instance.loc.name, recipes, instance);
        return true;
    }

    /** Item on item: hand recipes that use both as materials or tools. */
    useItems(a: number, b: number): boolean {
        const uses = (r: RecipeDef, id: number) => r.materials.some((m) => m.item === id) || r.tools.some((t) => t.includes(id));
        const recipes = this.recipes(null).filter((r) => uses(r, a) && uses(r, b));
        if (recipes.length === 0) return false;
        this.offer("What would you like to make?", recipes);
        return true;
    }

    /** "Clean" on a grimy herb cleans them all, without the menu. */
    clean(item: number): boolean {
        const recipe = this.ctx.data.recipes.find((r) => r.verb === "clean" && r.materials[0]?.item === item);
        if (!recipe) return false;
        this.make(recipe, Infinity);
        return true;
    }

    /** A potion dose: (4) becomes (3)… and (1) an empty vial. Potions have no effects here. */
    drink(slot: number, item: number): boolean {
        const name = itemName(this.ctx, item);
        const m = /^(.*)\((\d)\)$/.exec(name);
        if (!m) return false;
        const doses = Number(m[2]);
        const next = doses > 1 ? this.ctx.db.byName(`${m[1]}(${doses - 1})`) : this.ctx.db.byName("Vial");
        if (next) this.ctx.items.replaceAt(slot, next.id);
        else this.ctx.items.removeItem(item, 1);
        this.ctx.log(`You drink some of your ${m[1].trim().toLowerCase()}.`);
        return true;
    }

    /** Fills every vial, bucket or jug of this kind at a water source, one a tick. */
    private fill(instance: SkillLocInstance, item: number): boolean {
        const fill = this.ctx.data.fills.find((f) => f.from === item);
        if (!fill) return false;
        const ctx = this.ctx;
        this.sys.start({
            skill: "cooking",
            swingTicks: 0,
            target: instance,
            tick: () => {
                if (ctx.items.removeItem(fill.from, 1) === 0) return false;
                ctx.items.addItem(fill.to, 1);
                ctx.log(`You fill the ${itemName(ctx, fill.from).toLowerCase()}.`);
                return ctx.items.count(fill.from) > 0;
            },
        });
        return true;
    }
}

/** Makes one recipe every `recipe.ticks` until `remaining` are made or something runs out. */
export class RecipeJob implements Job {
    readonly skill: SkillId;
    readonly swingTicks = 0;
    private ticks = 0;

    constructor(
        private readonly ctx: SkillContext,
        private readonly recipe: RecipeDef,
        private remaining: number,
        readonly target: SkillLocInstance | undefined,
        private readonly onFire: boolean,
    ) {
        this.skill = recipe.skill as SkillId;
    }

    tick(): boolean {
        if (++this.ticks % this.recipe.ticks !== 0) return true;
        const ctx = this.ctx;
        const r = this.recipe;
        const missingTool = r.tools.find((alts) => !alts.some((id) => ctx.items.holds(id)));
        if (missingTool) {
            ctx.log(`You need ${article(itemName(ctx, missingTool[0]))} ${itemName(ctx, missingTool[0]).toLowerCase()} to do that.`);
            return false;
        }
        const missing = r.materials.find((m) => ctx.items.count(m.item) < m.qty);
        if (missing) {
            ctx.log(`You don't have enough ${itemName(ctx, missing.item).toLowerCase()}.`);
            return false;
        }
        for (const m of r.materials) ctx.items.removeItem(m.item, m.qty);
        const burn = r.burn;
        const chance = burn && (this.onFire && burn.fireChance ? burn.fireChance : burn.chance);
        if (chance && random() >= successChance(chance, ctx.skills.level(r.skill as SkillId))) {
            if (burn!.burnt >= 0) giveOrDrop(ctx, burn!.burnt, 1);
            ctx.log(r.verb === "smelt" ? "The ore is too impure and you fail to refine it." : `You accidentally burn the ${itemName(ctx, r.output.item).toLowerCase()}.`);
        } else {
            giveOrDrop(ctx, r.output.item, r.output.qty);
            if (r.xp > 0) ctx.gainXp(r.skill as SkillId, r.xp);
            for (const e of r.extra ?? []) if (e.xp > 0) ctx.gainXp(e.skill as SkillId, e.xp);
            ctx.log(madeMessage(ctx, r));
        }
        return --this.remaining > 0 && r.materials.every((m) => ctx.items.count(m.item) >= m.qty);
    }
}

/** The OSRS wording of a made item. */
export function madeMessage(ctx: Pick<SkillContext, "db">, r: RecipeDef): string {
    const out = itemName(ctx, r.output.item);
    const lower = out.toLowerCase();
    const material = (i: number) => itemName(ctx, r.materials[i]?.item ?? -1).toLowerCase();
    switch (r.verb) {
        case "smelt":
            return `You retrieve a bar of ${lower.replace(/ bar$/, "")}.`;
        case "smith":
            return `You hammer the ${material(0).replace(/ bar$/, "")} and make ${article(out)} ${lower}.`;
        case "cut":
            return `You carefully cut the ${material(0)} into ${article(out)} ${lower}.`;
        case "string":
            return "You add a string to the bow.";
        case "clean":
            return `You clean the dirt from the ${lower}.`;
        case "mix":
            return `You mix the ${material(r.materials.length - 1)} into your potion.`;
        case "cook":
            return `You successfully cook ${article(out)} ${lower}.`;
    }
    if (r.skill === "fletching") return `You make ${r.output.qty} ${lower}.`;
    return `You make ${article(out)} ${lower}.`;
}

function capital(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/** One option per output (range and fire versions of a dish, or alternative materials). */
function dedupe(recipes: RecipeDef[]): RecipeDef[] {
    const seen = new Set<number>();
    return recipes.filter((r) => !seen.has(r.output.item) && seen.add(r.output.item));
}
