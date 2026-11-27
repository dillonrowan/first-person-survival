import type { Npc } from "../npc/Npc";
import type { SkillLocInstance } from "../world/SkillLocs";
import { SkillContext, itemName, rollLoot } from "./SkillContext";

/** Ticks a chest shows its open look after it was looted. [design] */
const OPEN_TICKS = 5;

/**
 * Boss chests (Obor's, Bryophyta's): a kill of the boss unlocks its chest for one opening, which
 * takes the key and puts the loot on the ground by the player [OSRS Wiki: Chest (Obor's lair),
 * Chest (Bryophyta's lair): "can be opened with a [key] after defeating [the boss], once per kill";
 * "Opening the chest places loot directly on the ground"].
 */
export class BossChests {
    /** Chests (by index) with a kill not yet looted. */
    private readonly unlocked = new Set<number>();
    /** Opened chest key → tick it shows closed again. */
    private readonly openUntil = new Map<string, number>();

    constructor(private readonly ctx: SkillContext) {
        ctx.clock.onTick((t) => {
            for (const [key, until] of this.openUntil) {
                if (t >= until) {
                    this.openUntil.delete(key);
                    ctx.skillLocs.refresh(key);
                }
            }
        });
    }

    /** True while the chest of `index` has a kill to loot. */
    isUnlocked(index: number): boolean {
        return this.unlocked.has(index);
    }

    look(instance: SkillLocInstance): number | undefined {
        return this.openUntil.has(instance.key) ? instance.loc.skill?.depletedMesh : undefined;
    }

    onNpcDeath(npc: Npc): void {
        (this.ctx.data.chests ?? []).forEach((chest, index) => {
            if (chest.npcIds.includes(npc.appearance.id)) this.unlocked.add(index);
        });
    }

    open(instance: SkillLocInstance, index: number): void {
        const ctx = this.ctx;
        const chest = ctx.data.chests?.[index];
        if (!chest) return ctx.log("Nothing interesting happens.");
        if (!this.unlocked.has(index)) return ctx.log(`You need to defeat ${chest.boss} before you can open the chest.`);
        const key = itemName(ctx, chest.key).toLowerCase();
        if (ctx.items.count(chest.key) === 0) return ctx.log(`You need a ${key} to open this chest.`);
        ctx.items.removeItem(chest.key, 1);
        this.unlocked.delete(index);
        ctx.log(`You unlock the chest with your ${key}.`);
        const { x, y, plane } = ctx.player;
        for (const s of [...rollLoot(chest.loot), ...chest.tertiary.flatMap((t) => rollLoot([t]))]) {
            ctx.drop(s, Math.floor(x), Math.floor(y), plane);
        }
        this.openUntil.set(instance.key, ctx.clock.tick + OPEN_TICKS);
        ctx.skillLocs.refresh(instance.key);
    }
}
