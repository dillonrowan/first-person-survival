import type { LocRole, Tile } from "../world/SkillFormat";
import type { SkillLocInstance } from "../world/SkillLocs";
import { SkillContext, itemName } from "./SkillContext";
import type { SkillSystem } from "./SkillSystem";

const BUILD_TICKS = 4;
const STORE_KEY = "furniture";
/** Where the house exit leads when the player came some other way: Rimmington's portal. */
const DEFAULT_RETURN: Tile = { x: 2953, y: 3224, plane: 0 };

/** The player's house: a fixed set of template rooms whose hotspots take furniture. */
export class Construction {
    buildMode = false;
    private returnTo: Tile = DEFAULT_RETURN;
    private room = 0;
    /** Hotspot key → built furniture loc id. */
    private readonly furniture: Record<string, number>;

    constructor(
        private readonly ctx: SkillContext,
        private readonly sys: SkillSystem,
    ) {
        this.furniture = ctx.store.get<Record<string, number>>(STORE_KEY) ?? {};
    }

    private role(instance: SkillLocInstance): LocRole | undefined {
        return this.ctx.data.locs[instance.loc.id];
    }

    private isDoor(instance: SkillLocInstance): boolean {
        return /door/i.test(instance.loc.name);
    }

    look(instance: SkillLocInstance): number | undefined {
        if (this.role(instance)?.role !== "hotspot" || this.isDoor(instance)) return undefined;
        const built = this.furniture[instance.key];
        if (built !== undefined) return instance.loc.skill?.furnitureMeshes?.[built] ?? -1;
        return this.buildMode ? instance.loc.skill?.mesh : -1;
    }

    actionsOf(instance: SkillLocInstance): string[] | undefined {
        const role = this.role(instance)?.role;
        if (role === "house-portal") return ["Home", "Build mode"];
        if (role === "house-exit") return ["Exit"];
        if (role !== "hotspot") return undefined;
        if (this.isDoor(instance)) return ["Enter"];
        if (!this.buildMode) return [];
        return this.furniture[instance.key] !== undefined ? ["Remove"] : ["Build"];
    }

    private refreshAll(): void {
        for (const instance of this.ctx.skillLocs.near(this.ctx.player.plane, this.ctx.player.x, this.ctx.player.y, 200)) {
            if (this.role(instance)?.role === "hotspot") this.ctx.skillLocs.refresh(instance.key);
        }
    }

    private goToRoom(index: number): void {
        const rooms = this.ctx.data.construction.rooms;
        if (rooms.length === 0) return;
        this.room = index % rooms.length;
        const t = rooms[this.room].arrival;
        this.sys.stop();
        this.ctx.player.teleport(t.x + 0.5, t.y + 0.5, t.plane);
    }

    locAction(instance: SkillLocInstance, role: LocRole, action: string): void {
        const ctx = this.ctx;
        if (role.role === "house-portal") {
            this.returnTo = { x: Math.floor(ctx.player.x), y: Math.floor(ctx.player.y), plane: ctx.player.plane };
            this.buildMode = /build/i.test(action);
            this.goToRoom(0);
            this.refreshAll();
            ctx.log(this.buildMode ? "You enter your house in building mode." : "You enter your house.");
            return;
        }
        if (role.role === "house-exit") {
            this.sys.stop();
            ctx.player.teleport(this.returnTo.x + 0.5, this.returnTo.y + 0.5, this.returnTo.plane);
            return;
        }
        if (role.role !== "hotspot") return;
        if (this.isDoor(instance)) return this.goToRoom(this.room + 1);
        if (/^remove$/i.test(action)) {
            delete this.furniture[instance.key];
            this.changed(instance.key);
            return;
        }
        if (/^build$/i.test(action)) this.openBuild(instance, role.name);
    }

    private changed(key: string): void {
        this.ctx.store.set(STORE_KEY, this.furniture);
        this.ctx.skillLocs.refresh(key);
    }

    private openBuild(instance: SkillLocInstance, hotspot: string): void {
        const ctx = this.ctx;
        const level = ctx.skills.level("construction");
        const tools = ctx.items.holds(ctx.data.items.Hammer) && ctx.items.holds(ctx.data.items.Saw);
        const options = ctx.data.construction.furniture
            .filter((f) => f.hotspot.toLowerCase() === hotspot.toLowerCase() && instance.loc.skill?.furnitureMeshes?.[f.locId] !== undefined)
            .map((f) => ({
                locId: f.locId,
                name: f.name,
                level: f.level,
                materials: f.materials,
                enabled: tools && level >= f.level && f.materials.every((m) => ctx.items.count(m.item) >= m.qty),
            }));
        if (options.length === 0) return ctx.log("Nothing can be built here.");
        this.sys.ui.openBuild(hotspot, options, (locId) => this.build(instance, locId));
    }

    private build(instance: SkillLocInstance, locId: number): void {
        const ctx = this.ctx;
        const f = ctx.data.construction.furniture.find((x) => x.locId === locId);
        if (!f) return;
        if (!ctx.items.holds(ctx.data.items.Hammer) || !ctx.items.holds(ctx.data.items.Saw)) return ctx.log("You need a hammer and a saw to build furniture.");
        if (ctx.skills.level("construction") < f.level) return ctx.log(`You need a Construction level of ${f.level} to build that.`);
        const missing = f.materials.find((m) => ctx.items.count(m.item) < m.qty);
        if (missing) return ctx.log(`You need ${missing.qty} ${itemName(ctx, missing.item).toLowerCase()} to build that.`);
        let ticks = 0;
        this.sys.start({
            skill: "construction",
            swingTicks: 2,
            target: instance,
            tick: () => {
                if (++ticks < BUILD_TICKS) return true;
                if (f.materials.some((m) => ctx.items.count(m.item) < m.qty)) return false;
                for (const m of f.materials) ctx.items.removeItem(m.item, m.qty);
                ctx.gainXp("construction", f.xp);
                this.furniture[instance.key] = f.locId;
                this.changed(instance.key);
                ctx.log(`You build the ${f.name.toLowerCase()}.`);
                return false;
            },
        });
    }
}
