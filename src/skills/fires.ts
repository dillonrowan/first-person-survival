import { randInt } from "../game/Random";
import type { SkillLocInstance } from "../world/SkillLocs";
import type { SkillContext } from "./SkillContext";

export const FIRE_LOC = 26185;
/** Where the player steps after lighting: west, east, south, north [OSRS]. */
const STEPS: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
];

/**
 * Burning logs into fires that burn for a while, can be cooked on, and leave ashes. There is no
 * Firemaking skill here: any logs light at once, every time, for no XP. [design]
 */
export class Fires {
    private readonly fires = new Map<string, { instance: SkillLocInstance; outAt: number }>();

    constructor(private readonly ctx: SkillContext) {
        ctx.clock.onTick((t) => this.onTick(t));
    }

    /** Tinderbox on logs, or logs on a tinderbox. */
    useItems(a: number, b: number): boolean {
        const tinderbox = this.ctx.data.items.Tinderbox;
        if (a === tinderbox) return this.light(b);
        if (b === tinderbox) return this.light(a);
        return false;
    }

    /** Lights logs on the player's tile; false when the item is not logs. */
    light(log: number): boolean {
        if (!this.ctx.data.logs.includes(log)) return false;
        const ctx = this.ctx;
        if (!ctx.items.holds(ctx.data.items.Tinderbox)) {
            ctx.log("You need a tinderbox to light a fire.");
            return true;
        }
        const x = Math.floor(ctx.player.x);
        const y = Math.floor(ctx.player.y);
        const plane = ctx.player.plane;
        if (ctx.skillLocs.occupies(plane, x, y) || !ctx.walkable(plane, x, y)) {
            ctx.log("You can't light a fire here.");
            return true;
        }
        ctx.items.removeItem(log, 1);
        ctx.log("The fire catches and the logs begin to burn.");
        const loc = { id: FIRE_LOC, name: "Fire", actions: ["Cook"], plane, tileX: x, tileY: y, sizeX: 1, sizeY: 1, height: 1 };
        void ctx.locModel(FIRE_LOC).then((object) => {
            const instance = ctx.skillLocs.addRuntime(loc, object);
            this.fires.set(instance.key, { instance, outAt: ctx.clock.tick + randInt(100, 199) });
        });
        for (const [dx, dy] of STEPS) {
            if (ctx.walkable(plane, x + dx, y + dy)) {
                ctx.player.teleport(x + dx + 0.5, y + dy + 0.5, plane);
                break;
            }
        }
        return true;
    }

    private onTick(t: number): void {
        for (const [key, fire] of this.fires) {
            if (t < fire.outAt) continue;
            this.fires.delete(key);
            this.ctx.skillLocs.removeRuntime(fire.instance);
            const loc = fire.instance.loc;
            const ashes = this.ctx.data.items.Ashes;
            if (ashes !== undefined) this.ctx.drop({ id: ashes, qty: 1 }, loc.tileX, loc.tileY, loc.plane);
        }
    }
}
