import type { Npc } from "../npc/Npc";
import type { AltarDef, LocRole, Tile } from "../world/SkillFormat";
import type { SkillLocInstance } from "../world/SkillLocs";
import { SkillContext, itemName } from "./SkillContext";
import type { SkillSystem } from "./SkillSystem";

/** Map square of the rune essence mine. */
const ESSENCE_MINE = { mapX: 45, mapY: 75 };

/** Altars reached through mysterious ruins with a talisman or tiara; the essence mine via Aubury. */
export class Runecraft {
    constructor(
        private readonly ctx: SkillContext,
        private readonly sys: SkillSystem,
    ) {}

    private altar(rune: string): AltarDef | undefined {
        return this.ctx.data.runecraft.altars.find((a) => a.rune === rune);
    }

    private go(tile: Tile): void {
        const t = this.nearWalkable(tile);
        this.sys.stop();
        this.ctx.player.teleport(t.x + 0.5, t.y + 0.5, t.plane);
    }

    /** The walkable tile nearest `tile` (ruins and portals are solid). */
    private nearWalkable(tile: Tile): Tile {
        for (let r = 0; r <= 4; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dy = -r; dy <= r; dy++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) === r && this.ctx.walkable(tile.plane, tile.x + dx, tile.y + dy)) {
                        return { x: tile.x + dx, y: tile.y + dy, plane: tile.plane };
                    }
                }
            }
        }
        return tile;
    }

    private enter(altar: AltarDef): void {
        const ctx = this.ctx;
        if (ctx.items.count(altar.talisman) === 0 && !ctx.items.holds(altar.tiara)) {
            ctx.log("A mysterious force blocks your way.");
            return;
        }
        ctx.log("You feel a powerful force take hold of you...");
        this.go(altar.arrival);
    }

    locAction(instance: SkillLocInstance, role: LocRole, action: string): void {
        const ctx = this.ctx;
        if (role.role === "essence-exit") return this.go(ctx.data.runecraft.essenceMine.returnTo);
        const altar = "rune" in role ? this.altar(role.rune) : undefined;
        if (!altar) return ctx.log("Nothing interesting happens.");
        if (role.role === "ruins") return this.enter(altar);
        if (role.role === "altar-exit") {
            if (!altar.ruins) return ctx.log("Nothing interesting happens.");
            return this.go(altar.ruins);
        }
        if (role.role === "altar" && /craft-rune/i.test(action)) this.craft(instance, altar);
    }

    useOnRuins(_instance: SkillLocInstance, rune: string, item: number): boolean {
        const altar = this.altar(rune);
        if (!altar || item !== altar.talisman) return false;
        this.enter(altar);
        return true;
    }

    /** Binds all usable essence at once, after one tick. */
    private craft(instance: SkillLocInstance, altar: AltarDef): void {
        const ctx = this.ctx;
        if (ctx.skills.level("runecraft") < altar.level) {
            ctx.log(`You need a Runecraft level of ${altar.level} to infuse these runes.`);
            return;
        }
        const { rune, pure } = ctx.data.runecraft.essence;
        const kinds = altar.pureOnly ? [pure] : [rune, pure];
        if (kinds.every((id) => ctx.items.count(id) === 0)) {
            ctx.log(altar.pureOnly ? "You need pure essence to bind these runes." : "You don't have any rune essence to bind.");
            return;
        }
        this.sys.start({
            skill: "runecraft",
            swingTicks: 0,
            target: instance,
            tick: () => {
                let n = 0;
                for (const id of kinds) n += ctx.items.removeItem(id, ctx.items.count(id));
                const level = ctx.skills.level("runecraft");
                const each = 1 + altar.multiples.filter((m) => m <= level).length;
                ctx.items.addItem(altar.runeItem, n * each);
                ctx.gainXp("runecraft", n * altar.xp);
                ctx.log(`You bind the temple's power into ${itemName(ctx, altar.runeItem).toLowerCase()}s.`);
                return false;
            },
        });
    }

    /** Aubury teleports to the essence mine; the mine's portals (NPCs) lead back. */
    npcAction(npc: Npc, action: string): boolean {
        const ctx = this.ctx;
        const name = npc.appearance.name.toLowerCase();
        if (name === "aubury" && /^teleport$/i.test(action)) {
            ctx.log("Senventior Disthine Molenko!");
            this.go(ctx.data.runecraft.essenceMine.arrival);
            return true;
        }
        const inMine = Math.floor(ctx.player.x / 64) === ESSENCE_MINE.mapX && Math.floor(ctx.player.y / 64) === ESSENCE_MINE.mapY;
        if (name === "portal" && inMine && /^(exit|use|enter)$/i.test(action)) {
            this.go(ctx.data.runecraft.essenceMine.returnTo);
            return true;
        }
        return false;
    }
}
