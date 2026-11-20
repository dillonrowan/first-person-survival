import type { Npc } from "../npc/Npc";
import type { PickpocketDef } from "../world/SkillFormat";
import type { SkillLocInstance } from "../world/SkillLocs";
import { Job, SkillContext, article, giveOrDrop, itemName, rollLoot } from "./SkillContext";
import type { SkillSystem } from "./SkillSystem";
import { roll } from "./success";

/** Ticks a pickpocket or stall theft takes. */
const STEAL_TICKS = 2;

/** Pickpocketing NPCs and stealing from stalls. */
export class Thieving {
    /** Tick until which the player is stunned (a failed pickpocket): no input but looking. */
    stunnedUntil = 0;
    /** A pickpocket attempt started (the view's hand reaches in). */
    onAttempt?: () => void;
    /** A pickpocket attempt ended: the hand pulls the loot out, or is slapped away when caught. */
    onOutcome?: (caught: boolean) => void;
    /** Emptied stall key → tick it fills again. */
    private readonly emptyUntil = new Map<string, number>();

    constructor(
        private readonly ctx: SkillContext,
        private readonly sys: SkillSystem,
    ) {}

    get stunned(): boolean {
        return this.ctx.clock.tick < this.stunnedUntil;
    }

    steal(instance: SkillLocInstance, index: number): void {
        const stall = this.ctx.data.stalls[index];
        const ctx = this.ctx;
        if (ctx.skills.level("thieving") < stall.level) return ctx.log(`You need a Thieving level of ${stall.level} to steal from this stall.`);
        if ((this.emptyUntil.get(instance.key) ?? 0) > ctx.clock.tick) return ctx.log("The stall is empty.");
        if (ctx.items.inventory.freeSlots() === 0) return ctx.log("You don't have enough inventory space.");
        let ticks = 0;
        this.sys.start({
            skill: "thieving",
            swingTicks: 0,
            target: instance,
            tick: () => {
                if (++ticks < STEAL_TICKS) return true;
                const loot = rollLoot(stall.loot);
                for (const s of loot) giveOrDrop(ctx, s.id, s.qty);
                ctx.gainXp("thieving", stall.xp);
                const first = loot[0];
                if (first) ctx.log(`You steal ${article(itemName(ctx, first.id))} ${itemName(ctx, first.id).toLowerCase()}.`);
                this.emptyUntil.set(instance.key, ctx.clock.tick + stall.respawnTicks);
                return false;
            },
        });
    }

    npcAction(npc: Npc, action: string): boolean {
        if (!/^pickpocket$/i.test(action)) return false;
        const def = this.ctx.data.pickpockets.find((p) => p.npcIds.includes(npc.appearance.id));
        if (!def) return false;
        const ctx = this.ctx;
        if (this.stunned) return true;
        if (ctx.skills.level("thieving") < def.level) {
            ctx.log(`You need a Thieving level of ${def.level} to pickpocket the ${def.name.toLowerCase()}.`);
            return true;
        }
        if (ctx.items.inventory.freeSlots() === 0) {
            ctx.log("You don't have enough inventory space.");
            return true;
        }
        ctx.log(`You attempt to pick the ${def.name.toLowerCase()}'s pocket.`);
        this.sys.start(new PickpocketJob(this, ctx, npc, def));
        this.onAttempt?.();
        return true;
    }

    /** Caught: damage and a stun, and an NPC that can fight turns on the player. */
    caught(npc: Npc, def: PickpocketDef): void {
        const ctx = this.ctx;
        ctx.log(`You fail to pick the ${def.name.toLowerCase()}'s pocket.`);
        ctx.log(`${def.name}: What do you think you're doing?`);
        npc.faceTowards(ctx.player.x, ctx.player.y);
        if (npc.attackable) npc.becomeAlerted(ctx.player.x, ctx.player.y);
        ctx.hurt(def.damage);
        this.stunnedUntil = ctx.clock.tick + def.stunTicks;
        ctx.log("You've been stunned!");
    }
}

/** One pickpocket attempt: 2 ticks, then the roll. Each key press is one attempt. */
export class PickpocketJob implements Job {
    readonly skill = "thieving" as const;
    readonly swingTicks = 0;
    private ticks = 0;

    constructor(
        private readonly thieving: Thieving,
        private readonly ctx: SkillContext,
        readonly target: Npc,
        private readonly def: PickpocketDef,
    ) {}

    tick(): boolean {
        if (++this.ticks < STEAL_TICKS) return true;
        const ctx = this.ctx;
        if (roll(this.def.chance, ctx.skills.level("thieving"))) {
            for (const s of rollLoot(this.def.loot)) giveOrDrop(ctx, s.id, s.qty);
            ctx.gainXp("thieving", this.def.xp);
            ctx.log(`You pick the ${this.def.name.toLowerCase()}'s pocket.`);
            this.thieving.onOutcome?.(false);
        } else {
            this.thieving.caught(this.target, this.def);
            this.thieving.onOutcome?.(true);
        }
        return false;
    }
}
