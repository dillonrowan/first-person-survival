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
import { NpcClip, NpcManifest, encodeNpcModel } from "../../src/world/NpcFormat";
import { LocRole, SKILLS_FORMAT_VERSION, ShopManifest, SkillsManifest } from "../../src/world/SkillFormat";
import { readCacheFiles } from "./cache-files";
import { FaceColors } from "./FaceColors";
import type { Chart } from "./fetch-wiki-skills";
import { buildModelMeshes, computeBounds } from "./NpcModelBuilder";
import { LocModelType } from "./rs/config/loctype/LocModelType";
import { Model } from "./rs/model/Model";
import { createWorldLoaders } from "./WorldLoaders";
import { exportFarming } from "./skills/farming";
import { exportFishing, exportFishingPlaces, exportRocks, exportTools, exportTrees } from "./skills/gathering";
import { exportHunter, exportShops, exportSlayer, exportThieving } from "./skills/npcSkills";
import { exportRunecraft } from "./skills/places";
import { exportFills, exportLogs, exportRecipes, facilityLocs } from "./skills/recipes";
import { createSkillsContext, loadWikiData } from "./skills/SkillContext";
import { SKILL_LOC_INDEX_FILE, SkillLocIndex } from "./skills/SkillLocIndex";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** A loc's animation (non-skeletal) baked into vertex positions per frame, or undefined. */
function bakeLocClip(loaders: ReturnType<typeof createWorldLoaders>, base: Model, seqId: number): NpcClip | undefined {
    if (seqId === -1) return undefined;
    const seq = loaders.seqTypeLoader.load(seqId);
    if (!seq || seq.isSkeletalSeq() || !seq.frameIds || seq.frameIds.length === 0) return undefined;
    const count = base.verticesCount;
    const frameCount = seq.frameIds.length;
    const positions = new Int16Array(frameCount * count * 3);
    const frameLengths = new Uint16Array(frameCount);
    for (let f = 0; f < frameCount; f++) {
        const frame = loaders.seqFrameLoader.load(seq.frameIds[f]);
        let model = base;
        if (frame) {
            model = Model.copyAnimated(base, !frame.hasAlphaTransform, !frame.hasColorTransform);
            model.animate(frame, undefined, seq.op14);
        }
        for (let v = 0; v < count; v++) {
            positions.set([model.verticesX[v], model.verticesY[v], model.verticesZ[v]], (f * count + v) * 3);
        }
        frameLengths[f] = Math.max(1, seq.frameLengths[f] ?? 1);
    }
    return { frameLengths, frameStep: seq.frameStep, positions };
}
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
    const { stalls, pickpockets } = exportThieving(ctx);
    const farming = exportFarming(ctx);
    const runecraft = exportRunecraft(ctx);
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
    for (const [id, facility] of facilityLocs(ctx)) set(id, { role: "facility", facility });
    for (const id of ctx.locsWhere((n, a) => /deposit (box|chest|pot)/i.test(n) && a.includes("Deposit"))) set(id, { role: "deposit" });

    // What export-world turns into skill targets, and their alternate looks.
    const index: SkillLocIndex = { resources: {}, patches: [], statics: [] };
    for (const [id, role] of Object.entries(locs)) {
        if (role.role === "tree") index.resources[id] = trees[role.index].stumpLocId;
        // Rune essence never depletes, so it stays part of the map.
        else if (role.role === "rock" && !rocks[role.index].essence) index.resources[id] = rocks[role.index].depletedLocId;
        else if (role.role === "patch") index.patches.push(Number(id));
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
        fishingSpots: exportFishingPlaces(ctx, fishing),
        recipes,
        logs: exportLogs(ctx),
        fills: exportFills(ctx),
        stalls,
        pickpockets,
        hunter: exportHunter(ctx),
        farming,
        slayer: exportSlayer(ctx),
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
        const type = loaders.locTypeLoader.load(id);
        const model = loaders.locModelLoader.getModelStatic(type, LocModelType.NORMAL, 0);
        if (!model) {
            ctx.log(`models: loc ${id} has no model`);
            continue;
        }
        const meshes = buildModelMeshes(model, faceColors, loaders.textureLoader, 1);
        if (!meshes) continue;
        // A loc that animates (the fire's flames) keeps its cache animation as the idle clip.
        const idle = bakeLocClip(loaders, model, type.seqId);
        const data = encodeNpcModel({ vertexCount: model.verticesCount, bounds: computeBounds(model, [idle]), ...meshes, idle });
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
