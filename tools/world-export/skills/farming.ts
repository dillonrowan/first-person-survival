// Farming patches and crops, from the wiki calculator and RuneLite's varbit tables.

import type { CropDef, FarmingDef, PatchImpl } from "../../../src/world/SkillFormat";
import { evalStage } from "../wiki/farmingSource";
import type { SkillsExportContext } from "./SkillContext";

/** Patch varbits (Falador/Catherby/Ardougne/Morytania style patches) [RuneLite]. */
export const PATCH_VARBITS = new Set([4771, 4772, 4773, 4774]);

const PATCH_NAMES: Record<string, PatchImpl> = {
    allotment: "ALLOTMENT",
    "herb patch": "HERB",
    "flower patch": "FLOWER",
    "tree patch": "TREE",
    "fruit tree patch": "FRUIT_TREE",
    "bush patch": "BUSH",
    "hops patch": "HOPS",
};
const CALC_TYPES: Record<string, PatchImpl> = {
    Allotment: "ALLOTMENT",
    Herb: "HERB",
    Flower: "FLOWER",
    Tree: "TREE",
    "Fruit tree": "FRUIT_TREE",
    Bush: "BUSH",
    Hops: "HOPS",
};

/** The patch type a placed multiloc shows at varbit value 0, if it is a supported patch. */
export function patchImplOf(ctx: SkillsExportContext, locId: number): PatchImpl | undefined {
    const t = ctx.loaders.locTypeLoader.load(locId);
    if (!t.transforms || !PATCH_VARBITS.has(t.transformVarbit)) return undefined;
    const first = t.transforms[0];
    return first === undefined || first < 0 ? undefined : PATCH_NAMES[ctx.locs[first]?.name.toLowerCase() ?? ""];
}

/** "Guam leaf", "Oak (Farming)", "Apple tree", "Redberries" → names RuneLite might use. */
function nameKeys(name: string): string[] {
    const base = name
        .toLowerCase()
        .replace(/\s*\(.*\)$/, "")
        .replace(/ (leaf|weed|tree)$/, "")
        .replace(/\s+/g, "");
    return [base, base.replace(/ies$/, "y"), base.replace(/s$/, "")];
}

export function exportFarming(ctx: SkillsExportContext): FarmingDef {
    const patches = new Map<PatchImpl, number[]>();
    for (let id = 0; id < ctx.locs.length; id++) {
        const impl = patchImplOf(ctx, id);
        if (impl) patches.set(impl, [...(patches.get(impl) ?? []), id]);
    }
    const table = (impl: string) => ctx.wiki.farming.patches.find((p) => p.impl === impl)?.ranges ?? [];
    const weeds: FarmingDef["weeds"] = {};
    for (const impl of Object.values(CALC_TYPES)) {
        const w = table(impl).find((r) => r.produce === "WEEDS" && r.from === 0);
        // The values shown with 3, 2, 1 and 0 weeds left.
        if (w) weeds[impl] = [3, 2, 1, 0].map((left) => [...Array(w.to - w.from + 1).keys()].map((k) => w.from + k).find((v) => evalStage(w.stageExpr, v) === left) ?? 0) as [number, number, number, number];
    }

    const crops: CropDef[] = [];
    for (const row of ctx.wiki.calc.Farming ?? []) {
        const impl = CALC_TYPES[String(row.type ?? "")];
        if (!impl) continue;
        const name = String(row.name);
        const keys = nameKeys(name);
        const produce = ctx.wiki.farming.produce.find((p) => p.impl === impl && keys.includes(p.name.toLowerCase().replace(/\s+/g, "")));
        const material = (row.materials as { name: string; quantity: number }[] | undefined)?.[0];
        const seed = material && ctx.resolveItem(material.name);
        if (!produce || seed === undefined) {
            ctx.log(`farming: skipped ${name} (${!produce ? "no RuneLite produce" : "no seed"})`);
            continue;
        }
        const ranges = table(impl).filter((r) => r.produce === produce.produce);
        const growing: number[] = [];
        for (const r of ranges.filter((x) => x.state === "GROWING")) {
            for (let v = r.from; v <= r.to; v++) growing[evalStage(r.stageExpr, v)] = v;
        }
        const harvest = ranges.filter((x) => x.state === "HARVESTABLE");
        if (growing.length === 0 || harvest.length === 0 || growing.some((v) => v === undefined)) {
            ctx.log(`farming: skipped ${name} (no varbit states)`);
            continue;
        }
        const itemName =
            impl === "HERB" ? `Grimy ${name.toLowerCase()}` : impl === "FRUIT_TREE" ? String(row.outputItem ?? "") : impl === "TREE" ? "" : name;
        const item = itemName ? ctx.resolveItem(itemName) ?? -1 : -1;
        if (impl !== "TREE" && item < 0) {
            ctx.log(`farming: skipped ${name} (no item ${itemName})`);
            continue;
        }
        const crop: CropDef = {
            produce: produce.produce,
            name: impl === "TREE" ? String(row.title ?? name) : name,
            impl,
            seed,
            seedQty: material?.quantity ?? 1,
            level: Number(row.level) || 1,
            plantXp: Number(row.plantXp) || 0,
            xp: impl === "TREE" || impl === "FRUIT_TREE" ? 0 : Number(row.xp) || 0,
            item,
            stageMinutes: produce.tickrate,
            stages: growing.length + 1,
            growing,
            harvestable: harvest[0].from,
        };
        if (impl === "TREE") {
            crop.checkXp = Number(row.xp) || 0;
            crop.checked = harvest[harvest.length - 1].from;
        } else if (impl === "FRUIT_TREE" || impl === "BUSH") {
            const pick = harvest.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));
            crop.checkXp = impl === "FRUIT_TREE" ? Number(row.xp) || 0 : Number(row.healthXp) || 0;
            crop.pickBase = pick.from;
            crop.pickMax = impl === "FRUIT_TREE" ? 6 : 4;
            crop.harvestable = pick.to;
            if (impl === "BUSH") crop.xp = Number(row.xp) || 0;
            if (impl === "FRUIT_TREE") crop.xp = 0;
        }
        crops.push(crop);
    }
    ctx.log(`farming: ${[...patches.keys()].length} patch types, ${crops.length} crops`);
    return { patches: [...patches].map(([impl, locIds]) => ({ impl, locIds })), crops, weeds };
}
