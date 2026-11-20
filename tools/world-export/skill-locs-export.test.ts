// Builds Lumbridge's region from the cache and checks the skill locs it exports. Skipped without a
// cache (npm run download-cache) or before the first export-skills run.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { isCacheAvailable, readCacheFiles } from "./cache-files";
import { RegionBuilder } from "./RegionBuilder";
import { loadSkillLocIndex } from "./skills/SkillLocIndex";
import { createWorldLoaders } from "./WorldLoaders";

const CACHE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../cache");
const index = loadSkillLocIndex();

describe.skipIf(!isCacheAvailable(CACHE) || !index)("skill locs in the region export", () => {
    const builder = new RegionBuilder(createWorldLoaders(readCacheFiles(CACHE)), undefined, index);
    const region = builder.build(50, 50)!.region;
    const skill = region.interactives.filter((i) => i.kind === "skill");

    it("gives trees their own mesh and a stump", () => {
        const trees = skill.filter((i) => i.name === "Tree");
        expect(trees.length).toBeGreaterThan(5);
        for (const t of trees) {
            expect(t.skill?.mesh).toBeDefined();
            expect(t.skill?.depletedMesh).toBeDefined();
            expect(region.doorMeshes[t.skill!.mesh!].opaque.indices.length).toBeGreaterThan(0);
            expect(region.doorMeshes[t.skill!.depletedMesh!].opaque.indices.length).toBeGreaterThan(0);
        }
    }, 120_000);

    it("keeps the castle kitchen range as a static skill loc", () => {
        const range = skill.find((i) => /range/i.test(i.name) && Math.abs(i.tileX - 3211) < 6 && Math.abs(i.tileY - 3215) < 6);
        expect(range).toBeDefined();
        expect(range!.skill?.mesh).toBeUndefined();
    });
});
