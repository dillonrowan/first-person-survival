// Builds the non-combat skill data from the OSRS wiki (data/wiki, npm run fetch-wiki-skills) and
// the cache:
//
//   npm run export-skills
//
// Writes public/world/skills.json, public/world/shops.json, the models of locs the game places
// itself (fires, hunter traps) in public/world/skill-models/, and a coverage report to
// data/skills-coverage.txt. Reads public/world/items.json and npcs.json, so run export-items and
// export-world first. Deletes nothing else.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { gzipSync } from "fflate";

import type { ItemManifest } from "../../src/world/ItemFormat";
import { NpcManifest, encodeNpcModel } from "../../src/world/NpcFormat";
import { LocRole, SKILLS_FORMAT_VERSION, ShopManifest, SkillsManifest } from "../../src/world/SkillFormat";
import { readCacheFiles } from "./cache-files";
import { FaceColors } from "./FaceColors";
import type { Chart } from "./fetch-wiki-skills";
import { buildModelMeshes, computeBounds } from "./NpcModelBuilder";
import { LocModelType } from "./rs/config/loctype/LocModelType";
import { createWorldLoaders } from "./WorldLoaders";
import { exportFarming } from "./skills/farming";
import { exportFishing, exportRocks, exportTools, exportTrees } from "./skills/gathering";
import { exportHunter, exportShops, exportSlayer, exportThieving } from "./skills/npcSkills";
import { exportConstruction, exportRunecraft } from "./skills/places";
import { exportFills, exportFiremaking, exportRecipes, facilityLocs, sawmillRecipes } from "./skills/recipes";
import { createSkillsContext, loadWikiData } from "./skills/SkillContext";
import { SKILL_LOC_INDEX_FILE, SkillLocIndex } from "./skills/SkillLocIndex";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const WORLD = path.join(ROOT, "public", "world");
const WIKI = path.join(HERE, "data", "wiki");

/** Locs the game places at runtime: the fire, and bird snare and box trap states. */
export const RUNTIME_LOCS = [26185, 9344, 9345, 9373, 9380, 9382, 9385];
/** Items the game refers to by name. */
const NAMED_ITEMS = [
    "Coins", "Tinderbox", "Ashes", "Rake", "Seed dibber", "Spade", "Weeds", "Hammer", "Saw", "Knife",
    "Butterfly net", "Butterfly jar", "Impling jar", "Bird snare", "Box trap", "Feather", "Fishing bait",
];

function main(): void {
    const items = (JSON.parse(fs.readFileSync(path.join(WORLD, "items.json"), "utf8")) as ItemManifest).items;
    const npcFile = path.join(WORLD, "npcs.json");
    const npcs = fs.existsSync(npcFile) ? (JSON.parse(fs.readFileSync(npcFile, "utf8")) as NpcManifest) : undefined;
    const cache = readCacheFiles(path.join(ROOT, "cache"));
    const loaders = createWorldLoaders(cache);
    const wiki = loadWikiData(WIKI);
    const ctx = createSkillsContext(wiki, loaders, items, npcs);
    const cookingCharts = JSON.parse(fs.readFileSync(path.join(WIKI, "cooking-charts.json"), "utf8")) as Record<string, Chart[]>;

    const trees = exportTrees(ctx);
    const rocks = exportRocks(ctx);
    const fishing = exportFishing(ctx);
    const catches = new Set(fishing.flatMap((f) => f.catches.map((c) => c.item)));
    const recipes = exportRecipes(ctx, cookingCharts, catches);
    recipes.push(...sawmillRecipes(ctx, recipes.length));
    const { stalls, pickpockets } = exportThieving(ctx);
    const farming = exportFarming(ctx);
    const runecraft = exportRunecraft(ctx);
    const construction = exportConstruction(ctx);
    if (!runecraft) throw new Error("No rune or pure essence item");

    const locs: Record<string, LocRole> = {};
    const set = (id: number, role: LocRole) => {
        if (!(id in locs)) locs[id] = role;
    };
    trees.forEach((t, index) => t.locIds.forEach((id) => set(id, { role: "tree", index })));
    rocks.forEach((r, index) => r.locIds.forEach((id) => set(id, { role: "rock", index })));
    stalls.forEach((s, index) => s.locIds.forEach((id) => set(id, { role: "stall", index })));
    for (const a of runecraft.altars) {
        a.ruinsLocIds.forEach((id) => set(id, { role: "ruins", rune: a.rune }));
        a.altarLocIds.forEach((id) => set(id, { role: "altar", rune: a.rune }));
        a.exitLocIds.forEach((id) => set(id, { role: "altar-exit", rune: a.rune }));
    }
    runecraft.essenceMine.exitLocIds.forEach((id) => set(id, { role: "essence-exit" }));
    farming.patches.forEach((p) => p.locIds.forEach((id) => set(id, { role: "patch", impl: p.impl })));
    for (const [id, name] of Object.entries(construction.hotspots)) set(Number(id), { role: "hotspot", name });
    for (const id of ctx.locsWhere((n, a) => n === "Portal" && a.includes("Home"))) set(id, { role: "house-portal" });
    for (const [id, facility] of facilityLocs(ctx)) set(id, { role: "facility", facility });
    for (const id of ctx.locsWhere((n, a) => /deposit (box|chest|pot)/i.test(n) && a.includes("Deposit"))) set(id, { role: "deposit" });

    // What export-world turns into skill targets, and their alternate looks.
    const index: SkillLocIndex = { resources: {}, patches: [], hotspots: {}, statics: [] };
    for (const [id, role] of Object.entries(locs)) {
        if (role.role === "tree") index.resources[id] = trees[role.index].stumpLocId;
        // Rune essence never depletes, so it stays part of the map.
        else if (role.role === "rock" && !rocks[role.index].essence) index.resources[id] = rocks[role.index].depletedLocId;
        else if (role.role === "patch") index.patches.push(Number(id));
        else if (role.role === "hotspot") index.hotspots[id] = construction.furniture.filter((f) => f.hotspot.toLowerCase() === role.name.toLowerCase()).map((f) => f.locId);
        else index.statics.push(Number(id));
    }
    fs.writeFileSync(SKILL_LOC_INDEX_FILE, JSON.stringify(index) + "\n");

    const named: Record<string, number> = {};
    for (const name of NAMED_ITEMS) {
        const id = ctx.resolveItem(name);
        if (id !== undefined) named[name] = id;
    }

    const manifest: SkillsManifest = {
        format: SKILLS_FORMAT_VERSION,
        source: `OSRS wiki (CC BY-NC-SA 3.0); RuneLite farming tables (BSD-2-Clause); cache revision ${cache.download.revision}`,
        locs,
        trees,
        rocks,
        fishing,
        recipes,
        firemaking: exportFiremaking(ctx),
        fills: exportFills(ctx),
        stalls,
        pickpockets,
        hunter: exportHunter(ctx),
        farming,
        slayer: exportSlayer(ctx),
        construction,
        runecraft,
        tools: exportTools(ctx),
        items: named,
    };
    const values: Record<string, number> = {};
    for (const item of items) values[item.id] = loaders.objTypeLoader.load(item.id).value;
    const shops: ShopManifest = { format: SKILLS_FORMAT_VERSION, shops: exportShops(ctx), values };
    fs.writeFileSync(path.join(WORLD, "skills.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(WORLD, "shops.json"), JSON.stringify(shops));

    // Models of the locs the game places itself, lit like any loc.
    const modelDir = path.join(WORLD, "skill-models");
    fs.rmSync(modelDir, { recursive: true, force: true });
    fs.mkdirSync(modelDir, { recursive: true });
    const faceColors = new FaceColors(loaders.textureLoader);
    for (const id of RUNTIME_LOCS) {
        const model = loaders.locModelLoader.getModelStatic(loaders.locTypeLoader.load(id), LocModelType.NORMAL, 0);
        if (!model) {
            ctx.log(`models: loc ${id} has no model`);
            continue;
        }
        const meshes = buildModelMeshes(model, faceColors, loaders.textureLoader, 1);
        if (!meshes) continue;
        const data = encodeNpcModel({ vertexCount: model.verticesCount, bounds: computeBounds(model, []), ...meshes });
        fs.writeFileSync(path.join(modelDir, `loc-${id}.bin`), gzipSync(data, { level: 6, mtime: 0 }));
    }

    const unresolved = [...ctx.unresolved].sort((a, b) => b[1] - a[1]);
    const lines = [
        `Skills export coverage (cache revision ${cache.download.revision})`,
        "",
        `trees ${trees.length}, rocks ${rocks.length}, fishing blocks ${fishing.length}, recipes ${recipes.length}, stalls ${stalls.length}, pickpockets ${pickpockets.length}`,
        `locs with a role ${Object.keys(locs).length}, shops ${shops.shops.length}`,
        "",
        ...ctx.report,
        "",
        `unresolved item names (${unresolved.length}):`,
        ...unresolved.map(([name, n]) => `  ${name} (${n})`),
    ];
    fs.writeFileSync(path.join(HERE, "data", "skills-coverage.txt"), lines.join("\n") + "\n");
    console.log(lines.slice(0, 40).join("\n"));
}

main();
