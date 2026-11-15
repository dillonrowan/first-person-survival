// Non-combat skill data, written by tools/world-export/export-skills.ts from the OSRS wiki and the
// cache, and read by the game (public/world/skills.json and shops.json). No imports, so tools can use it.

export const SKILLS_FORMAT_VERSION = 1;

export type Chance = { low: number; high: number };
export type ItemQty = { item: number; qty: number };
/** Any one of these item ids. */
export type ToolReq = number[];
/** p = 1 for an item that always comes. */
export type LootEntry = { item: number; min: number; max: number; p: number };
export type Tile = { x: number; y: number; plane: number };

export type AxeTier = "bronze" | "iron" | "steel" | "black" | "mithril" | "adamant" | "rune" | "dragon" | "crystal";
export type AxeDef = { item: number; level: number; tier: AxeTier };
/** `ticks` per roll, with `fastChance` of `ticks - 1` instead (dragon and crystal pickaxes). */
export type PickaxeDef = { item: number; level: number; ticks: number; fastChance: number };

export type TreeDef = {
    name: string;
    locIds: number[];
    level: number;
    xp: number;
    logs: number;
    respawnTicks: number;
    /** Ticks of chopping before the tree falls; null: each log fells it with `depleteChance`. */
    despawnTicks: number | null;
    depleteChance: number;
    chances: Partial<Record<AxeTier, Chance>>;
    stumpLocId: number;
    extraLoot: LootEntry[];
};

export type RockDef = {
    name: string;
    locIds: number[];
    level: number;
    xp: number;
    ore: number;
    respawnTicks: number;
    chance: Chance;
    /** The empty rock's loc, or 1_000_000 + a rock id for the rock without its ore colours. */
    depletedLocId: number;
    /** Rune essence: never depletes; pure essence from `pureLevel`. */
    essence?: { rune: number; pure: number; pureLevel: number };
};

export type FishingSpotDef = {
    npcIds: number[];
    action: string;
    tools: ToolReq;
    bait?: number;
    /** Highest level first: each roll tries them in this order. */
    catches: { item: number; level: number; xp: number; chance: Chance }[];
};

export type Facility =
    | "furnace"
    | "anvil"
    | "range"
    | "fire"
    | "spinning wheel"
    | "potter's wheel"
    | "pottery oven"
    | "loom"
    | "water"
    | "sawmill"
    | "altar";

export type RecipeDef = {
    id: number;
    skill: string;
    level: number;
    xp: number;
    /** More skills the recipe trains or needs (rare). */
    extra?: { skill: string; level: number; xp: number }[];
    ticks: number;
    materials: ItemQty[];
    tools: ToolReq[];
    facility: Facility | null;
    output: ItemQty;
    /** Cooking burns and iron smelting fails: success per chart; `burnt` -1 gives nothing. */
    burn?: { chance: Chance; fireChance?: Chance; burnt: number };
    /** "clean", "smelt", "smith", "string", "cut", "mix": picks the message wording. */
    verb?: string;
};

export type StallDef = { name: string; locIds: number[]; level: number; xp: number; respawnTicks: number; loot: LootEntry[] };
export type PickpocketDef = {
    name: string;
    npcIds: number[];
    level: number;
    xp: number;
    stunTicks: number;
    damage: number;
    chance: Chance;
    loot: LootEntry[];
};

export type HunterMethod = "bird snare" | "box trap" | "net";
export type HunterDef = { method: HunterMethod; creature: string; npcIds: number[]; level: number; xp: number; chance: Chance; loot: LootEntry[] };

export type PatchImpl = "ALLOTMENT" | "HERB" | "FLOWER" | "TREE" | "FRUIT_TREE" | "BUSH" | "HOPS";
export type CropDef = {
    produce: string;
    name: string;
    impl: PatchImpl;
    seed: number;
    seedQty: number;
    level: number;
    plantXp: number;
    /** XP per harvested item. */
    xp: number;
    /** Trees, fruit trees and bushes: XP for checking a grown plant's health. */
    checkXp?: number;
    /** Harvested item; -1 for trees (they become choppable). */
    item: number;
    stageMinutes: number;
    stages: number;
    /** Varbit value shown at each growing stage. */
    growing: number[];
    /** Varbit value once grown (trees, fruit trees and bushes: before the health check). */
    harvestable: number;
    /** Trees: value once health is checked (choppable). */
    checked?: number;
    /** Fruit trees and bushes: value with none left; value + n shows n left, up to `pickMax`. */
    pickBase?: number;
    pickMax?: number;
};
export type FarmingDef = {
    patches: { impl: PatchImpl; locIds: number[] }[];
    crops: CropDef[];
    /** Varbit value for 3, 2, 1 and 0 weeds left, per impl. */
    weeds: Record<string, [number, number, number, number]>;
};

export type SlayerDef = {
    masters: { name: string; npcIds: number[]; min: number; max: number; tasks: { category: string; weight: number; slayerLevel: number }[] }[];
    /** NPC id → slayer data. */
    monsters: Record<string, { level: number; xp: number; categories: string[] }>;
};

export type FurnitureDef = { locId: number; name: string; hotspot: string; level: number; xp: number; materials: ItemQty[] };
export type ConstructionDef = {
    rooms: { name: string; arrival: Tile }[];
    furniture: FurnitureDef[];
    /** Placed hotspot locs: loc id → hotspot name. */
    hotspots: Record<string, string>;
};

export type AltarDef = {
    rune: string;
    runeItem: number;
    level: number;
    xp: number;
    altarLocIds: number[];
    ruinsLocIds: number[];
    ruins: Tile | null;
    talisman: number;
    tiara: number;
    arrival: Tile;
    exitLocIds: number[];
    /** Levels at which each essence makes one more rune. */
    multiples: number[];
    /** Pure essence only. */
    pureOnly: boolean;
};
export type RunecraftDef = {
    altars: AltarDef[];
    essence: { rune: number; pure: number };
    essenceMine: { arrival: Tile; exitLocIds: number[]; returnTo: Tile };
};

export type LocRole =
    | { role: "tree"; index: number }
    | { role: "rock"; index: number }
    | { role: "facility"; facility: Facility }
    | { role: "stall"; index: number }
    | { role: "ruins"; rune: string }
    | { role: "altar"; rune: string }
    | { role: "altar-exit"; rune: string }
    | { role: "essence-exit" }
    | { role: "patch"; impl: PatchImpl }
    | { role: "hotspot"; name: string }
    | { role: "house-portal" }
    | { role: "house-exit" }
    | { role: "deposit" };

export type SkillsManifest = {
    format: number;
    source: string;
    /** Loc id → what it is. */
    locs: Record<string, LocRole>;
    trees: TreeDef[];
    rocks: RockDef[];
    fishing: FishingSpotDef[];
    recipes: RecipeDef[];
    firemaking: { log: number; level: number; xp: number }[];
    /** Vial, bucket and jug filled at water. */
    fills: { from: number; to: number }[];
    stalls: StallDef[];
    pickpockets: PickpocketDef[];
    hunter: HunterDef[];
    farming: FarmingDef;
    slayer: SlayerDef;
    construction: ConstructionDef;
    runecraft: RunecraftDef;
    tools: { axes: AxeDef[]; pickaxes: PickaxeDef[] };
    /** Well-known item ids the game uses by name. */
    items: Record<string, number>;
};

export type ShopItem = { item: number; stock: number; price: number; shopPays: number; restockTicks: number };
export type ShopDef = { name: string; npcIds: number[]; items: ShopItem[] };
export type ShopManifest = { format: number; shops: ShopDef[] };
