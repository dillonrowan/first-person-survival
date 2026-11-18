import { afterEach, describe, expect, it } from "vitest";

import { setRandom } from "../game/Random";
import { TickClock } from "../game/TickClock";
import type { TreeDef } from "../world/SkillFormat";
import { rollLoot } from "./SkillContext";
import { CHOP_TICKS } from "./gathering";
import { successChance } from "./success";
import { createTestSkills, emptyManifest, testLoc } from "./testContext";

const LOGS = 1511;
const OAK_LOGS = 1521;
const BRONZE_AXE = 1351;
const DRAGON_AXE = 6739;
const COPPER = 436;
const PICK = 1265;

const tree = (over: Partial<TreeDef>): TreeDef => ({
    name: "Tree",
    locIds: [1276],
    level: 1,
    xp: 25,
    logs: LOGS,
    respawnTicks: 10,
    despawnTicks: null,
    depleteChance: 1 / 8,
    chances: { bronze: { low: 64, high: 200 }, dragon: { low: 120, high: 375 } },
    stumpLocId: 1342,
    extraLoot: [],
    ...over,
});

function setup() {
    const data = emptyManifest();
    data.trees = [tree({}), tree({ name: "Oak tree", locIds: [10820], level: 15, xp: 37.5, logs: OAK_LOGS, despawnTicks: 45, respawnTicks: 14 })];
    data.rocks = [{ name: "Copper rocks", locIds: [10943], level: 1, xp: 17.5, ore: COPPER, respawnTicks: 4, chance: { low: 256, high: 256 }, depletedLocId: 11390 }];
    data.locs = { 1276: { role: "tree", index: 0 }, 10820: { role: "tree", index: 1 }, 10943: { role: "rock", index: 0 } };
    data.tools = {
        axes: [
            { item: BRONZE_AXE, level: 1, tier: "bronze" },
            { item: DRAGON_AXE, level: 61, tier: "dragon" },
        ],
        pickaxes: [{ item: PICK, level: 1, ticks: 8, fastChance: 0 }],
    };
    return createTestSkills(
        data,
        [
            { id: LOGS, name: "Logs" },
            { id: OAK_LOGS, name: "Oak logs" },
            { id: BRONZE_AXE, name: "Bronze axe" },
            { id: DRAGON_AXE, name: "Dragon axe" },
            { id: COPPER, name: "Copper ore" },
            { id: PICK, name: "Bronze pickaxe" },
        ],
        { woodcutting: 61, mining: 1 },
    );
}

afterEach(() => setRandom(Math.random));

describe("success chance", () => {
    it("matches the wiki's monkfish example", () => {
        expect(successChance({ low: 48, high: 90 }, 74)).toBe(0.3125);
    });
});

describe("TickClock", () => {
    it("fires a tick every 0.6 s, at most 5 per update", () => {
        const clock = new TickClock();
        const seen: number[] = [];
        clock.onTick((t) => seen.push(t));
        clock.update(0.5);
        clock.update(0.2);
        expect(seen).toEqual([1]);
        clock.update(10);
        expect(seen.length).toBe(6);
    });
});

describe("woodcutting", () => {
    it("Chop down wields the best axe; each swing that lodges in the tree rolls for a log", () => {
        const t = setup();
        t.inventory.add(BRONZE_AXE, 1);
        const loc = t.place(testLoc(1276, "Tree"));
        t.sys.locAction(loc, "Chop down");
        expect(t.worn[0]).toBe(BRONZE_AXE);
        expect(t.logs.at(-1)).toBe("Swing your axe at the tree to chop it.");
        expect(t.sys.isSolid(loc)).toBe(true);
        setRandom(() => 0.99); // the roll fails
        t.sys.swingHit(loc);
        expect(t.inventory.count(LOGS)).toBe(0);
        t.ctx.clock.advance(CHOP_TICKS);
        setRandom(() => 0.01); // the roll and the 1/8 fall both hit
        t.sys.swingHit(loc);
        expect(t.inventory.count(LOGS)).toBe(1);
        expect(t.sys.gathering.isDepleted(loc.key)).toBe(true);
        expect(t.sys.isSolid(loc)).toBe(false); // a stump does not stop the blade
        expect(t.animations).toEqual(["treeHit@0:10:10:1276", "treeHit@0:10:10:1276", "treeFall@0:10:10:1276"]);
        t.ctx.clock.advance(10);
        expect(t.sys.gathering.isDepleted(loc.key)).toBe(false);
    });

    it("keeps chopping with a full inventory: the logs fall to the ground", () => {
        const t = setup();
        t.inventory.add(BRONZE_AXE, 1);
        const loc = t.place(testLoc(1276, "Tree"));
        t.sys.locAction(loc, "Chop down");
        expect(t.worn[0]).toBe(BRONZE_AXE);
        while (t.inventory.freeSlots() > 0) t.inventory.add(COPPER, 1);
        setRandom(() => 0.5); // the roll hits (61 with a bronze axe), the 1/8 fall does not
        t.sys.swingHit(loc);
        expect(t.inventory.count(LOGS)).toBe(0);
        expect(t.ground).toEqual([{ id: LOGS, qty: 1, x: Math.floor(t.player.x), y: Math.floor(t.player.y) }]);
        expect(t.xp.woodcutting).toBe(25);
    });

    it("scales a blow's chance by how much of the woodcutting interval has passed", () => {
        const t = setup();
        t.worn.push(BRONZE_AXE);
        const loc = t.place(testLoc(1276, "Tree"));
        const full = successChance({ low: 64, high: 200 }, 61);
        // Just under the full chance: a full-interval blow hits, one half an interval later misses.
        setRandom(() => full * 0.9);
        t.sys.swingHit(loc);
        expect(t.inventory.count(LOGS)).toBe(1);
        t.ctx.clock.advance(CHOP_TICKS / 2);
        t.sys.swingHit(loc);
        expect(t.inventory.count(LOGS)).toBe(1);
        setRandom(() => full * 0.4);
        t.ctx.clock.advance(CHOP_TICKS / 2);
        t.sys.swingHit(loc); // half an interval again: half the chance, and 0.4 of it is under that
        expect(t.inventory.count(LOGS)).toBe(2);
    });

    it("has no chopping stroke of its own: an axe click on a tree is an attack", () => {
        const t = setup();
        t.worn.push(BRONZE_AXE);
        const tree = t.place(testLoc(1276, "Tree"));
        expect(t.sys.minesWith(tree)).toBe(false);
        expect(t.sys.clickLoc(tree, true)).toBe(false);
        expect(t.sys.takesClicks).toBe(false);
        expect(t.sys.active).toBeUndefined();
    });

    it("a click with a pickaxe on a tree, or an axe on a rock, gathers nothing", () => {
        const t = setup();
        t.worn.push(PICK);
        expect(t.sys.clickLoc(t.place(testLoc(1276, "Tree")), true)).toBe(false);
        t.worn[0] = BRONZE_AXE;
        expect(t.sys.clickLoc(t.place(testLoc(10943, "Copper rocks", 12, 12)), true)).toBe(false);
        expect(t.sys.active).toBeUndefined();
    });

    it("another blade only shakes the tree", () => {
        const t = setup();
        t.inventory.add(BRONZE_AXE, 1);
        const loc = t.place(testLoc(1276, "Tree"));
        setRandom(() => 0.01);
        t.sys.swingHit(loc);
        expect(t.inventory.count(LOGS)).toBe(0);
        expect(t.animations).toEqual(["treeHit@0:10:10:1276"]);
        expect(t.logs).toEqual([]);
    });

    it("a swing into a rock just stops: mining is the pickaxe's own stroke", () => {
        const t = setup();
        t.worn.push(PICK);
        const rock = t.place(testLoc(10943, "Copper rocks"));
        expect(t.sys.isSolid(rock)).toBe(true);
        setRandom(() => 0.01);
        t.sys.swingHit(rock);
        expect(t.inventory.count(COPPER)).toBe(0);
        expect(t.animations).toEqual([]);
    });

    it("counts an oak's timer down while chopped and back up while not", () => {
        const t = setup();
        t.worn.push(BRONZE_AXE);
        const loc = t.place(testLoc(10820, "Oak tree"));
        setRandom(() => 0.99); // every roll fails: only the timer runs
        for (let i = 0; i < 5; i++) {
            t.sys.swingHit(loc);
            t.ctx.clock.advance(4);
        }
        t.ctx.clock.advance(30);
        setRandom(() => 0.01);
        t.sys.swingHit(loc);
        // The timer refilled, so the first log does not fell it.
        expect(t.inventory.count(OAK_LOGS)).toBe(1);
        expect(t.sys.gathering.isDepleted(loc.key)).toBe(false);
        setRandom(() => 0.99);
        for (let i = 0; i < 12; i++) {
            t.ctx.clock.advance(4);
            t.sys.swingHit(loc);
        }
        t.ctx.clock.advance(4);
        setRandom(() => 0.01);
        t.sys.swingHit(loc);
        expect(t.sys.gathering.isDepleted(loc.key)).toBe(true);
    });

    it("uses the dragon axe at level 61, which beats bronze", () => {
        const t = setup();
        t.inventory.add(BRONZE_AXE, 1);
        t.worn.push(DRAGON_AXE);
        expect(t.sys.gathering.bestAxe(t.ctx.data.trees[0])?.tier).toBe("dragon");
        expect(successChance({ low: 120, high: 375 }, 61)).toBeGreaterThan(successChance({ low: 64, high: 200 }, 61));
    });

    it("needs an axe", () => {
        const t = setup();
        t.sys.locAction(t.place(testLoc(1276, "Tree")), "Chop down");
        expect(t.logs.at(-1)).toBe("You do not have an axe which you have the Woodcutting level to use.");
    });
});

describe("mining", () => {
    it("empties copper after one ore; it is back 4 ticks later", () => {
        const t = setup();
        t.inventory.add(PICK, 1);
        const loc = t.place(testLoc(10943, "Copper rocks"));
        t.sys.locAction(loc, "Mine");
        expect(t.worn[0]).toBe(PICK);
        setRandom(() => 0.5);
        t.sys.strike(loc); // the first blow has the full chance (copper: always)
        expect(t.inventory.count(COPPER)).toBe(1);
        expect(t.logs.at(-1)).toBe("You manage to mine some copper.");
        expect(t.sys.gathering.isDepleted(loc.key)).toBe(true);
        t.ctx.clock.advance(4);
        expect(t.sys.gathering.isDepleted(loc.key)).toBe(false);
    });

    it("scales a blow's chance by how much of the pickaxe interval has passed", () => {
        const t = setup();
        t.worn.push(PICK);
        const loc = t.place(testLoc(10943, "Copper rocks"));
        setRandom(() => 0.6);
        t.sys.strike(loc); // copper never fails a full-chance blow
        t.ctx.clock.advance(4); // the rock is back; 4 of the bronze pickaxe's 8 ticks: half the chance
        t.sys.strike(loc);
        expect(t.inventory.count(COPPER)).toBe(1);
        t.ctx.clock.advance(2);
        setRandom(() => 0.7);
        t.sys.strike(loc); // 2 ticks since the last blow: a quarter
        expect(t.inventory.count(COPPER)).toBe(1);
        t.ctx.clock.advance(6);
        t.sys.strike(loc); // 6 ticks: three quarters
        expect(t.inventory.count(COPPER)).toBe(2);
    });
});

describe("rollLoot", () => {
    it("always gives chance-1 rows and picks one of the rest", () => {
        setRandom(() => 0);
        const loot = rollLoot([
            { item: 1, min: 1, max: 1, p: 1 },
            { item: 2, min: 3, max: 3, p: 0.5 },
            { item: 3, min: 1, max: 1, p: 0.5 },
        ]);
        expect(loot).toEqual([
            { id: 1, qty: 1 },
            { id: 2, qty: 3 },
        ]);
    });
});
