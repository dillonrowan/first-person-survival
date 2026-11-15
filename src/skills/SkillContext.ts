import type { SkillId } from "../combat/SkillId";
import type { TickClock } from "../game/TickClock";
import { random, randInt } from "../game/Random";
import type { ItemDb } from "../items/ItemDb";
import type { Stack } from "../items/ItemContainer";
import type { PlayerItems } from "../items/PlayerItems";
import type { Npc } from "../npc/Npc";
import type { LootEntry, SkillsManifest } from "../world/SkillFormat";
import type { SkillLocInstance, SkillLocs } from "../world/SkillLocs";

/** What the skills need of the player. */
export type SkillPlayer = {
    x: number;
    y: number;
    plane: number;
    teleport(x: number, y: number, plane: number): void;
};

/** Everything a skill module works with. Built once in main.ts; tests pass a fake. */
export type SkillContext = {
    data: SkillsManifest;
    clock: TickClock;
    skills: { level(id: SkillId): number };
    gainXp(skill: SkillId, xp: number): void;
    items: Pick<PlayerItems, "count" | "holds" | "canAdd" | "addItem" | "removeItem" | "replaceAt" | "inventory">;
    db: Pick<ItemDb, "get" | "byName">;
    /** Puts a stack on the ground (despawns like any dropped item). */
    drop(stack: Stack, x: number, y: number, plane: number): void;
    skillLocs: Pick<SkillLocs, "get" | "refresh" | "occupies" | "near" | "addRuntime" | "removeRuntime">;
    player: SkillPlayer;
    /** Damages the player (a failed pickpocket). */
    hurt(amount: number): void;
    /** A game message for the log, e.g. "You get some logs." */
    log(text: string): void;
    /** Living NPCs within `r` tiles of a point. */
    npcsNear(plane: number, x: number, y: number, r: number): Npc[];
    /** Whether the player can stand on a tile. */
    walkable(plane: number, x: number, y: number): boolean;
    /** A runtime-placed loc's model (fires, traps), or undefined before it has loaded. */
    locModel(id: number): Promise<import("three").Object3D>;
    /** Saved state of the skills that keep some (farming, construction, slayer). */
    store: { get<T>(key: string): T | undefined; set(key: string, value: unknown): void };
};

/** A repeating skilling activity, run once per game tick. */
export interface Job {
    readonly skill: SkillId;
    /** Tool swing cycle in ticks for the view (0: no swing). */
    readonly swingTicks: number;
    /** The loc or NPC it works on: the job stops when it is gone. */
    readonly target?: SkillLocInstance | Npc;
    /** Called every tick while active; return false to stop. */
    tick(tick: number): boolean;
    stop?(): void;
}

/** "a" or "an" by the first letter, "some" for names ending in s. */
export function article(name: string): string {
    const n = name.toLowerCase();
    if (n.endsWith("s")) return "some";
    return /^[aeiou]/.test(n) ? "an" : "a";
}

export function itemName(ctx: Pick<SkillContext, "db">, id: number): string {
    return ctx.db.get(id)?.name ?? "item";
}

/** Adds items to the inventory; what does not fit goes on the ground at the player. */
export function giveOrDrop(ctx: SkillContext, item: number, qty: number): void {
    const left = ctx.items.addItem(item, qty);
    if (left > 0) {
        ctx.drop({ id: item, qty: left }, Math.floor(ctx.player.x), Math.floor(ctx.player.y), ctx.player.plane);
        ctx.log("Your inventory is too full, so it falls to the ground.");
    }
}

/**
 * Rolls a loot table: chance-1 rows always come; the others are one weighted pick when their
 * chances add up to at most 1 (as OSRS tables do), each on its own otherwise.
 */
export function rollLoot(entries: readonly LootEntry[]): Stack[] {
    const out: Stack[] = [];
    const add = (e: LootEntry) => {
        const qty = randInt(e.min, e.max);
        const same = out.find((s) => s.id === e.item);
        if (same) same.qty += qty;
        else out.push({ id: e.item, qty });
    };
    const rest = entries.filter((e) => e.p < 1);
    entries.filter((e) => e.p >= 1).forEach(add);
    const total = rest.reduce((sum, e) => sum + e.p, 0);
    if (total <= 1.0001) {
        let r = random();
        for (const e of rest) {
            r -= e.p;
            if (r < 0) {
                add(e);
                break;
            }
        }
    } else {
        for (const e of rest) if (random() < e.p) add(e);
    }
    return out;
}
