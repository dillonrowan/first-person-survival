import { afterEach, describe, expect, it } from "vitest";

import { setRandom } from "../game/Random";
import { BITE_WINDOW, CAST_SECONDS, FishJob } from "./fishing";
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
        const spot = { npcId: 1530, x: 11.5, y: 12.5, plane: 0, waterZ: 0 };
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
        t.job().minigame!.fishAt = t.job().minigame!.zoneAt + 0.01;
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
        t.job().minigame!.fishAt = t.job().minigame!.zoneAt + 0.01;
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
        expect(t.player.x).toBe(9.5); // stepped west
        t.ctx.clock.advance(99);
        expect(t.ground).toEqual([]);
        t.ctx.clock.advance(1);
        expect(t.ground).toEqual([{ id: 592, qty: 1, x: 10, y: 9 }]);
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
});

describe("thieving", () => {
    it("stuns and hurts on a failed pickpocket", () => {
        const data = emptyManifest();
        data.pickpockets = [{ name: "Man", npcIds: [3106], level: 1, xp: 8, stunTicks: 8, damage: 1, chance: { low: 180, high: 240 }, loot: [{ item: 995, min: 3, max: 3, p: 1 }] }];
        const t = createTestSkills(data, [{ id: 995, name: "Coins", stackable: true }]);
        setRandom(() => 0.99);
        t.sys.npcAction(testNpc(3106, "Man"), "Pickpocket");
        t.ctx.clock.advance(2);
        expect(t.hurt).toBe(1);
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
