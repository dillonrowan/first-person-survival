import { random, randInt } from "../game/Random";
import type { Npc } from "../npc/Npc";
import type { SkillContext } from "./SkillContext";

export type SlayerTask = { master: string; category: string; remaining: number; total: number };
const STORE_KEY = "slayer";

/** Slayer tasks from the masters, kill counting and the Slayer level a monster needs. */
export class Slayer {
    task: SlayerTask | undefined;

    constructor(private readonly ctx: SkillContext) {
        this.task = ctx.store.get<SlayerTask>(STORE_KEY);
    }

    private save(): void {
        this.ctx.store.set(STORE_KEY, this.task ?? null);
    }

    npcAction(npc: Npc, action: string): boolean {
        if (!/^(assignment|get-task)$/i.test(action)) return false;
        const master = this.ctx.data.slayer.masters.find((m) => m.npcIds.includes(npc.appearance.id));
        if (!master) return false;
        const ctx = this.ctx;
        if (this.task) {
            ctx.log(`You're still hunting ${this.task.category.toLowerCase()}; you have ${this.task.remaining} to go.`);
            return true;
        }
        const level = ctx.skills.level("slayer");
        const tasks = master.tasks.filter((t) => t.slayerLevel <= level);
        const total = tasks.reduce((sum, t) => sum + t.weight, 0);
        let r = random() * total;
        const pick = tasks.find((t) => (r -= t.weight) < 0) ?? tasks[0];
        if (!pick) {
            ctx.log("I don't have a task for you.");
            return true;
        }
        const amount = randInt(master.min, master.max);
        this.task = { master: master.name, category: pick.category, remaining: amount, total: amount };
        this.save();
        ctx.log(`Your new task is to kill ${amount} ${pick.category.toLowerCase()}.`);
        return true;
    }

    /** A kill: counts toward the task when the monster is of its kind. */
    onKill(npc: Npc): void {
        const task = this.task;
        const monster = this.ctx.data.slayer.monsters[npc.appearance.id];
        if (!task || !monster || !monster.categories.some((c) => c.toLowerCase() === task.category.toLowerCase())) return;
        task.remaining--;
        this.ctx.gainXp("slayer", monster.xp);
        if (task.remaining <= 0) {
            this.ctx.log("You have completed your task! Return to a Slayer master for another assignment.");
            this.task = undefined;
        }
        this.save();
    }

    /** Whether the player's Slayer level is high enough to hurt this NPC. */
    canDamage(npcId: number): boolean {
        const monster = this.ctx.data.slayer.monsters[npcId];
        return !monster || monster.level <= this.ctx.skills.level("slayer");
    }
}
