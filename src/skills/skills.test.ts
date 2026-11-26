import { afterEach, describe, expect, it, vi } from "vitest";

import { setRandom } from "../game/Random";
import { burnTicks } from "./fires";
import { BITE_WINDOW, CAST_SECONDS, FishJob, SCOOP_SECONDS } from "./fishing";
import { FishingMinigame } from "./FishingMinigame";
import { createTestSkills, emptyManifest, testLoc, testNpc } from "./testContext";

afterEach(() => setRandom(Math.random));

describe("fishing", () => {
    const ROD = 307;
    const BAIT = 313;
    function setup(level: number) {
        const data = emptyManifest();
        data.fishing = [
            {
                npcIds: [1530],
                action: "Bait",
                tools: [ROD],
                bait: BAIT,
                catches: [
                    { item: 345, level: 10, xp: 30, chance: { low: 256, high: 256 } },
                    { item: 327, level: 5, xp: 20, chance: { low: 256, high: 256 } },
                ],
            },
        ];
        const t = createTestSkills(data, [
            { id: ROD, name: "Fishing rod" },
            { id: BAIT, name: "Fishing bait", stackable: true },
            { id: 345, name: "Raw herring" },
            { id: 327, name: "Raw sardine" },
        ], { fishing: level });
        const spot = { npcId: 1530, x: 11.5, y: 10.5, plane: 0, waterZ: 0 };
        const frame = (dt: number, pressed = false, down = pressed, aimed: unknown = spot) =>
            t.sys.update({ acted: false, panelOpen: false, dead: false, dt, pointer: { pressed, down, aimed } });
        const job = () => t.sys.active as FishJob;
        return { ...t, spot, frame, job };
    }

    /** Casts, waits for the first roll (a bite with these chances) and hooks it. */
    function hook(t: ReturnType<typeof setup>) {
        t.frame(0.016, true); // cast
        t.frame(CAST_SECONDS); // lands
        t.frame(3.1); // the first roll comes within 3 s: a bite
        expect(t.job().phase).toBe("bite");
        t.frame(0.016, true); // hooked
        expect(t.job().phase).toBe("reel");
    }

    it("needs the rod and wields it; then a cast, a bite, a hook and the reel land the highest catch", () => {
        const t = setup(10);
        t.inventory.add(ROD, 1);
        t.inventory.add(BAIT, 2);
        expect(t.sys.fishing.spotAction(t.spot, "Bait")).toBe(true);
        expect(t.worn[0]).toBe(ROD);
        expect(t.sys.takesClicks).toBe(true);
        setRandom(() => 0.5);
        hook(t);
        t.job().minigame!.progress = 0.999;
        t.job().minigame!.fishAt = t.job().minigame!.zoneAt + t.job().minigame!.zone / 2;
        t.frame(0.1, false, true);
        expect(t.inventory.count(345)).toBe(1);
        expect(t.inventory.count(BAIT)).toBe(1);
        expect(t.logs.at(-1)).toBe("You catch some herring.");
        expect(t.job().phase).toBe("ready"); // cast again for the next
    });

    it("skips catches above the player's level", () => {
        const t = setup(5);
        t.inventory.add(ROD, 1);
        t.inventory.add(BAIT, 5);
        t.sys.fishing.spotAction(t.spot, "Bait");
        setRandom(() => 0.5);
        hook(t);
        t.job().minigame!.progress = 0.999;
        t.job().minigame!.fishAt = t.job().minigame!.zoneAt + t.job().minigame!.zone / 2;
        t.frame(0.1, false, true);
        expect(t.inventory.count(327)).toBe(1);
    });

    it("needs bait, and a cast off the spot or a click before a bite catches nothing", () => {
        const t = setup(10);
        t.inventory.add(ROD, 1);
        t.sys.fishing.spotAction(t.spot, "Bait");
        expect(t.logs.at(-1)).toBe("You don't have any fishing bait left.");
        t.inventory.add(BAIT, 5);
        t.sys.fishing.spotAction(t.spot, "Bait");
        t.frame(0.016, true, true, null);
        expect(t.logs.at(-1)).toBe("Aim at the fishing spot to cast.");
        t.frame(0.016, true);
        t.frame(CAST_SECONDS);
        t.frame(0.1, true); // nothing bit yet
        expect(t.logs.at(-1)).toBe("You reel in too early.");
        expect(t.job().phase).toBe("ready");
    });

    it("lets a bite go when the player does not click in time", () => {
        const t = setup(10);
        t.inventory.add(ROD, 1);
        t.inventory.add(BAIT, 5);
        t.sys.fishing.spotAction(t.spot, "Bait");
        setRandom(() => 0.5);
        t.frame(0.016, true);
        t.frame(CAST_SECONDS);
        t.frame(3.1);
        t.frame(BITE_WINDOW + 0.01);
        expect(t.logs.at(-1)).toBe("The fish got away.");
        expect(t.job().phase).toBe("waiting");
    });

    it("scoops with a net instead of casting: each scoop rolls until a fish comes up", () => {
        const NET = 303;
        const data = emptyManifest();
        data.fishing = [{ npcIds: [1530], action: "Net", tools: [NET], catches: [{ item: 317, level: 1, xp: 10, chance: { low: 48, high: 256 } }] }];
        const t = createTestSkills(data, [
            { id: NET, name: "Small fishing net" },
            { id: 317, name: "Raw shrimps" },
        ], { fishing: 1 });
        const spot = { npcId: 1530, x: 11.5, y: 10.5, plane: 0, waterZ: 0 };
        const frame = (dt: number, pressed = false, down = pressed) =>
            t.sys.update({ acted: false, panelOpen: false, dead: false, dt, pointer: { pressed, down, aimed: spot } });
        t.inventory.add(NET, 1);
        const splashes: unknown[] = [];
        t.sys.fishing.onSplash = (s) => splashes.push(s);
        t.sys.fishing.spotAction(spot, "Net");
        const job = t.sys.active as FishJob;
        expect(job.stroke).toBe("scoop");
        setRandom(() => 0.99); // the first scoop comes up empty
        frame(0.016, true);
        expect(job.phase).toBe("scoop");
        expect(t.sys.toolMotion()).toEqual({ kind: "scoop", t: expect.any(Number) });
        frame(SCOOP_SECONDS);
        expect(splashes).toEqual([spot]);
        expect(job.phase).toBe("ready");
        expect(t.inventory.count(317)).toBe(0);
        setRandom(() => 0.01); // held down: the next scoop starts by itself and catches
        frame(0.016, false, true);
        frame(SCOOP_SECONDS);
        expect(t.inventory.count(317)).toBe(1);
        expect(t.logs.at(-1)).toBe("You catch some shrimps.");
    });

    it("a left click on the spot with the rod in hand fishes and casts; the job goes on after a catch", () => {
        const t = setup(10);
        t.worn.push(ROD);
        t.inventory.add(BAIT, 5);
        setRandom(() => 0.5);
        expect(t.sys.fishing.clickSpot(t.spot)).toBe(true);
        t.frame(0.016, true); // the same click casts
        expect(t.job().phase).toBe("cast");
        expect(t.sys.fishing.clickSpot(t.spot)).toBe(false); // the job takes later clicks
        for (let n = 1; n <= 2; n++) {
            if (n > 1) t.frame(0.016, true);
            t.frame(CAST_SECONDS);
            t.frame(3.1);
            t.frame(0.016, true);
            t.job().minigame!.progress = 0.999;
            t.job().minigame!.fishAt = t.job().minigame!.zoneAt + t.job().minigame!.zone / 2;
            t.frame(0.1, false, true);
            expect(t.inventory.count(345)).toBe(n);
        }
    });

    it("tells the player to come closer to a spot out of reach", () => {
        const t = setup(10);
        t.worn.push(ROD);
        t.inventory.add(BAIT, 5);
        const far = { ...t.spot, y: t.player.y + 5 };
        expect(t.sys.fishing.clickSpot(far)).toBe(true);
        expect(t.logs.at(-1)).toBe("You need to get closer to the fishing spot.");
        expect(t.sys.active).toBeUndefined();
    });

    it("drops the catch at the player's feet when the inventory is full, and goes on", () => {
        const t = setup(10);
        t.inventory.add(ROD, 1);
        t.inventory.add(BAIT, 5);
        t.sys.fishing.spotAction(t.spot, "Bait");
        while (t.inventory.freeSlots() > 0) t.inventory.add(ROD, 1);
        setRandom(() => 0.5);
        hook(t);
        t.job().minigame!.progress = 0.999;
        t.job().minigame!.fishAt = t.job().minigame!.zoneAt + t.job().minigame!.zone / 2;
        t.frame(0.1, false, true);
        expect(t.ground).toEqual([{ id: 345, qty: 1, x: Math.floor(t.player.x), y: Math.floor(t.player.y) }]);
        expect(t.job().phase).toBe("ready");
    });

    it("stops when the rod is put away", () => {
        const t = setup(10);
        t.inventory.add(ROD, 1);
        t.inventory.add(BAIT, 5);
        t.sys.fishing.spotAction(t.spot, "Bait");
        t.worn.length = 0;
        t.frame(0.016);
        expect(t.sys.active).toBeUndefined();
    });
});

describe("the reeling minigame", () => {
    it("fills while the fish is in the zone and lands it; drains to an escape otherwise", () => {
        setRandom(() => 0.5); // the fish rests at the middle
        const easy = FishingMinigame.forChance(1);
        for (let i = 0; i < 400 && !easy.result; i++) easy.update(0.05, easy.zoneAt + easy.zone / 2 < easy.fishAt);
        expect(easy.result).toBe("caught");
        const lost = FishingMinigame.forChance(0);
        for (let i = 0; i < 400 && !lost.result; i++) lost.update(0.05, true); // pinned right, away from the fish
        expect(lost.result).toBe("escaped");
    });

    it("gives a wider zone and a calmer fish for a likelier catch", () => {
        expect(FishingMinigame.forChance(0.9).zone).toBeGreaterThan(FishingMinigame.forChance(0.1).zone);
    });
});

describe("cooking and smithing", () => {
    function setup() {
        const data = emptyManifest();
        data.recipes = [
            { id: 0, skill: "cooking", level: 1, xp: 30, ticks: 4, materials: [{ item: 317, qty: 1 }], tools: [], facility: "range", output: { item: 315, qty: 1 }, burn: { chance: { low: 128, high: 512 }, burnt: 323 }, verb: "cook" },
            { id: 1, skill: "smithing", level: 15, xp: 12.5, ticks: 5, materials: [{ item: 440, qty: 1 }], tools: [], facility: "furnace", output: { item: 2351, qty: 1 }, burn: { chance: { low: 128, high: 128 }, burnt: -1 }, verb: "smelt" },
        ];
        data.locs = { 114: { role: "facility", facility: "range" }, 16469: { role: "facility", facility: "furnace" } };
        return createTestSkills(data, [
            { id: 317, name: "Raw shrimps" },
            { id: 315, name: "Shrimps" },
            { id: 323, name: "Burnt shrimp" },
            { id: 440, name: "Iron ore" },
            { id: 2351, name: "Iron bar" },
        ], { cooking: 1, smithing: 15 });
    }

    it("burns on a failed roll: burnt item, no XP", () => {
        const t = setup();
        t.inventory.add(317, 1);
        const range = t.place(testLoc(114, "Range", 10, 10, {}));
        t.sys.useItemOnLoc(range, 0);
        const [, options, pick] = t.opened.make!;
        expect(options.map((o) => o.recipe.id)).toEqual([0]);
        setRandom(() => 0.99);
        pick(options[0].recipe, Infinity);
        t.ctx.clock.advance(4);
        expect(t.inventory.count(323)).toBe(1);
        expect(t.xp.cooking).toBeUndefined();
        expect(t.logs.at(-1)).toBe("You accidentally burn the shrimps.");
    });

    it("smelts iron half the time", () => {
        const t = setup();
        t.inventory.add(440, 2);
        const furnace = t.place(testLoc(16469, "Furnace", 10, 10, {}));
        t.sys.locAction(furnace, "Smelt");
        const [, options, pick] = t.opened.make!;
        let r = 0.6;
        setRandom(() => (r = r === 0.6 ? 0.3 : 0.6));
        pick(options[0].recipe, Infinity);
        t.ctx.clock.advance(10);
        expect(t.inventory.count(440)).toBe(0);
        expect(t.inventory.count(2351)).toBe(1);
        expect(t.logs).toContain("The ore is too impure and you fail to refine it.");
        expect(t.logs).toContain("You retrieve a bar of iron.");
    });
});

describe("fires", () => {
    it("lights at once for no XP and leaves a fire for 100-199 ticks, then ashes", async () => {
        const data = emptyManifest();
        data.logs = [1511];
        data.items = { Tinderbox: 590, Ashes: 592 };
        const t = createTestSkills(data, [
            { id: 1511, name: "Logs" },
            { id: 590, name: "Tinderbox" },
            { id: 592, name: "Ashes" },
        ]);
        t.inventory.add(590, 1);
        t.inventory.add(1511, 1);
        setRandom(() => 0);
        t.sys.useItemOnItem(0, 1);
        await Promise.resolve();
        expect(t.inventory.count(1511)).toBe(0);
        expect(t.xp).toEqual({});
        expect(t.player.x).toBe(10.5); // stays where the fire is lit
        t.ctx.clock.advance(99);
        expect(t.ground).toEqual([]);
        t.ctx.clock.advance(1);
        expect(t.ground).toEqual([{ id: 592, qty: 1, x: 10, y: 9 }]);
    });

    it("burns better logs for longer, by their tree's Woodcutting level", () => {
        const data = emptyManifest();
        data.trees = [{ name: "Yew tree", locIds: [10822], level: 61, xp: 175, logs: 1515, respawnTicks: 100, despawnTicks: 190, depleteChance: 0, chances: {}, stumpLocId: 1342, extraLoot: [] }];
        setRandom(() => 0);
        expect(burnTicks({ data }, 1511)).toBe(100);
        expect(burnTicks({ data }, 1515)).toBe(300);
    });
});

describe("runecraft", () => {
    it("makes more runes per essence at the air multiples", () => {
        const data = emptyManifest();
        data.runecraft.altars = [
            { rune: "Air", runeItem: 556, level: 1, xp: 5, altarLocIds: [34760], ruinsLocIds: [], ruins: null, talisman: 1438, tiara: 5527, arrival: { x: 0, y: 0, plane: 0 }, exitLocIds: [], multiples: [11, 22], pureOnly: false },
        ];
        data.locs = { 34760: { role: "altar", rune: "Air" } };
        const t = createTestSkills(data, [
            { id: 1436, name: "Rune essence" },
            { id: 556, name: "Air rune", stackable: true },
        ], { runecraft: 22 });
        t.inventory.add(1436, 10);
        t.sys.locAction(t.place(testLoc(34760, "Altar", 10, 10, {})), "Craft-rune");
        t.ctx.clock.advance(1);
        expect(t.inventory.count(556)).toBe(30);
        expect(t.xp.runecraft).toBe(50);
    });

    it("places the ruins, names the missing talisman and teleports with it", () => {
        const data = emptyManifest();
        data.runecraft.altars = [
            { rune: "Air", runeItem: 556, level: 1, xp: 5, altarLocIds: [34760], ruinsLocIds: [28914], ruins: { x: 20, y: 20, plane: 0 }, talisman: 1438, tiara: 5527, arrival: { x: 40, y: 40, plane: 0 }, exitLocIds: [], multiples: [], pureOnly: false },
        ];
        data.locs = { 28914: { role: "ruins", rune: "Air" } };
        const t = createTestSkills(data, [{ id: 1438, name: "Air talisman" }]);
        const ruins = t.ctx.skillLocs.get("0:20:20:28914")!;
        expect(ruins.loc.actions).toEqual(["Enter"]);
        t.sys.locAction(ruins, "Enter");
        expect(t.logs.at(-1)).toBe("You need an air talisman to enter these ruins.");
        t.inventory.add(1438, 1);
        t.sys.locAction(ruins, "Enter");
        expect([t.player.x, t.player.y]).toEqual([40.5, 40.5]);
    });
});

describe("thieving", () => {
    it("stuns, hurts and turns the NPC hostile on a failed pickpocket", () => {
        const data = emptyManifest();
        data.pickpockets = [{ name: "Man", npcIds: [3106], level: 1, xp: 8, stunTicks: 8, damage: 1, chance: { low: 180, high: 240 }, loot: [{ item: 995, min: 3, max: 3, p: 1 }] }];
        const t = createTestSkills(data, [{ id: 995, name: "Coins", stackable: true }]);
        setRandom(() => 0.99);
        const man = Object.assign(testNpc(3106, "Man"), { attackable: true, becomeAlerted: vi.fn() });
        t.sys.npcAction(man, "Pickpocket");
        t.ctx.clock.advance(2);
        expect(t.hurt).toBe(1);
        expect(man.becomeAlerted).toHaveBeenCalledWith(t.ctx.player.x, t.ctx.player.y);
        expect(t.sys.thieving.stunned).toBe(true);
        t.ctx.clock.advance(8);
        expect(t.sys.thieving.stunned).toBe(false);
        setRandom(() => 0);
        t.sys.npcAction(testNpc(3106, "Man"), "Pickpocket");
        t.ctx.clock.advance(2);
        expect(t.inventory.count(995)).toBe(3);
    });
});

describe("hunter", () => {
    it("allows one more trap every 20 levels, up to 5", () => {
        for (const [level, max] of [[1, 1], [20, 2], [79, 4], [99, 5]]) {
            expect(createTestSkills(emptyManifest(), [], { hunter: level }).sys.hunter.maxTraps()).toBe(max);
        }
    });
});

describe("farming", () => {
    it("shows weeds, then each growth stage from the time planted", () => {
        const data = emptyManifest();
        data.farming = {
            patches: [{ impl: "HERB", locIds: [8150] }],
            crops: [{ produce: "GUAM", name: "Guam leaf", impl: "HERB", seed: 5291, seedQty: 1, level: 9, plantXp: 11, xp: 12.5, item: 199, stageMinutes: 20, stages: 5, growing: [4, 5, 6, 7], harvestable: 8 }],
            weeds: { HERB: [0, 1, 2, 3] },
        };
        data.locs = { 8150: { role: "patch", impl: "HERB" } };
        data.items = { "Seed dibber": 5343 };
        const t = createTestSkills(data, [{ id: 5291, name: "Guam seed", stackable: true }, { id: 5343, name: "Seed dibber" }, { id: 199, name: "Grimy guam leaf" }], { farming: 9 });
        let now = 0;
        t.sys.farming.now = () => now;
        const patch = t.place(testLoc(8150, "Herb patch", 10, 10, { stateMeshes: [] }));
        expect(t.sys.farming.value(patch.key, "HERB")).toBe(0); // 3 weeds
        // Weed it by hand (no rake in this test) and plant.
        (t.sys.farming as unknown as { state(k: string): { weeds: number } }).state(patch.key).weeds = 0;
        t.inventory.add(5343, 1);
        t.inventory.add(5291, 1);
        expect(t.sys.farming.useOnPatch(patch, "HERB", 5291)).toBe(true);
        expect(t.sys.farming.value(patch.key, "HERB")).toBe(4);
        now = 45 * 60_000;
        expect(t.sys.farming.value(patch.key, "HERB")).toBe(6);
        now = 80 * 60_000;
        expect(t.sys.farming.value(patch.key, "HERB")).toBe(8);
    });

    it("a grown tree stops the blade; checked, a swung axe chops it and empties the patch", () => {
        const data = emptyManifest();
        data.farming = {
            patches: [{ impl: "TREE", locIds: [8389] }],
            crops: [{ produce: "OAK", name: "Oak tree", impl: "TREE", seed: 5370, seedQty: 1, level: 15, plantXp: 14, xp: 0, item: -1, stageMinutes: 40, stages: 5, growing: [8, 9, 10, 11], harvestable: 12, checked: 13, checkXp: 467 }],
            weeds: { TREE: [0, 1, 2, 3] },
        };
        data.trees = [{ name: "Oak tree", locIds: [], level: 15, xp: 37.5, logs: 1521, respawnTicks: 14, despawnTicks: 45, depleteChance: 0, chances: { bronze: { low: 64, high: 200 } }, stumpLocId: 0, extraLoot: [] }];
        data.tools = { axes: [{ item: 1351, level: 1, tier: "bronze" }], pickaxes: [] };
        data.locs = { 8389: { role: "patch", impl: "TREE" } };
        const t = createTestSkills(data, [{ id: 1351, name: "Bronze axe" }, { id: 1521, name: "Oak logs" }], { farming: 15, woodcutting: 15 });
        let now = 0;
        t.sys.farming.now = () => now;
        const patch = t.place(testLoc(8389, "Tree patch", 10, 10, { stateMeshes: [] }));
        const save = (t.sys.farming as unknown as { state(k: string): { weeds: number; produce: string | null; plantedAt: number } }).state(patch.key);
        Object.assign(save, { weeds: 0, produce: "OAK", plantedAt: 0 });
        expect(t.sys.isSolid(patch)).toBe(false); // a sapling does not stop the blade
        now = 200 * 60_000;
        expect(t.sys.isSolid(patch)).toBe(true);
        t.worn.push(1351);
        setRandom(() => 0.01);
        t.sys.swingHit(patch);
        expect(t.inventory.count(1521)).toBe(0);
        expect(t.logs.at(-1)).toBe("You should check the health of the tree before chopping it down.");
        t.sys.locAction(patch, "Check-health");
        t.sys.swingHit(patch);
        expect(t.inventory.count(1521)).toBe(1);
        expect(t.sys.isSolid(patch)).toBe(false); // cut down: the patch is empty
    });
});

describe("slayer", () => {
    function setup(level: number) {
        const data = emptyManifest();
        data.slayer = {
            masters: [{ name: "Turael", npcIds: [401], min: 15, max: 15, tasks: [{ category: "Goblins", weight: 7, slayerLevel: 1 }, { category: "Banshees", weight: 8, slayerLevel: 15 }] }],
            monsters: { 3028: { level: 0, xp: 5, categories: ["Goblins"] }, 414: { level: 15, xp: 22, categories: ["Banshees"] } },
        };
        return createTestSkills(data, [], { slayer: level });
    }

    it("picks only tasks the player has the level for, and counts kills", () => {
        const t = setup(1);
        setRandom(() => 0.99);
        t.sys.npcAction(testNpc(401, "Turael"), "Assignment");
        expect(t.sys.slayer.task).toMatchObject({ category: "Goblins", remaining: 15 });
        t.sys.onNpcDeath(testNpc(3028, "Goblin"));
        expect(t.sys.slayer.task!.remaining).toBe(14);
        expect(t.xp.slayer).toBe(5);
    });

    it("gates monsters above the player's Slayer level", () => {
        expect(setup(1).sys.slayer.canDamage(414)).toBe(false);
        expect(setup(15).sys.slayer.canDamage(414)).toBe(true);
        expect(setup(1).sys.slayer.canDamage(3028)).toBe(true);
    });
});

describe("boss chests", () => {
    const GIANT_KEY = 20754;
    function setup() {
        const data = emptyManifest();
        data.chests = [
            {
                name: "Chest (Obor's lair)",
                boss: "Obor",
                locIds: [56380],
                npcIds: [7416],
                key: GIANT_KEY,
                loot: [{ item: 995, min: 10000, max: 10000, p: 6 / 118 }, { item: 563, min: 50, max: 50, p: 12 / 118 }],
                tertiary: [{ item: GIANT_KEY, min: 1, max: 1, p: 1 / 16 }],
            },
        ];
        data.locs["56380"] = { role: "chest", index: 0 };
        const t = createTestSkills(data, [
            { id: 995, name: "Coins", stackable: true },
            { id: 563, name: "Law rune", stackable: true },
            { id: GIANT_KEY, name: "Giant key" },
        ]);
        return { t, chest: testLoc(56380, "Chest", 3085, 9797) };
    }

    it("opens once per kill of its boss, with the key, and drops the loot on the ground", () => {
        const { t, chest } = setup();
        t.sys.locAction(chest, "Open");
        expect(t.logs.at(-1)).toBe("You need to defeat Obor before you can open the chest.");

        t.sys.onNpcDeath(testNpc(7416, "Obor"));
        t.sys.locAction(chest, "Open");
        expect(t.logs.at(-1)).toBe("You need a giant key to open this chest.");

        t.inventory.add(GIANT_KEY, 1);
        setRandom(() => 0);
        t.sys.locAction(chest, "Open");
        expect(t.inventory.count(GIANT_KEY)).toBe(0);
        // The first row of the main table, and the tertiary key.
        expect(t.ground.map((s) => [s.id, s.qty])).toEqual([[995, 10000], [GIANT_KEY, 1]]);
        expect(t.sys.look(chest)).toBe(1);

        // Looted: the next opening needs another kill.
        t.inventory.add(GIANT_KEY, 1);
        t.sys.locAction(chest, "Open");
        expect(t.logs.at(-1)).toBe("You need to defeat Obor before you can open the chest.");
        expect(t.inventory.count(GIANT_KEY)).toBe(1);
        // It shows closed again a few ticks later.
        t.ctx.clock.advance(5);
        expect(t.sys.look(chest)).toBeUndefined();
    });
});
