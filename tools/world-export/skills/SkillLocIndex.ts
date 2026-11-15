// Which placed locs the map export turns into skill targets, and the alternate looks it builds for
// them. Written by export-skills to data/skill-locs.json (committed), read by export-world, which
// cannot read public/world/skills.json because it deletes public/world/ first.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SkillLocIndex = {
    /** Tree or rock loc id → its depleted look (stump, empty rock). Ids from 1_000_000 are the rock id + 1_000_000: that rock without its ore colours. */
    resources: Record<string, number>;
    /** Farming patch multiloc ids: each varbit value's look gets a mesh. */
    patches: number[];
    /** Skill targets drawn with the map: facilities, stalls, altars, ruins, portals. */
    statics: number[];
};

export const SKILL_LOC_INDEX_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "skill-locs.json");

/** The index, or undefined before the first export-skills run. */
export function loadSkillLocIndex(file = SKILL_LOC_INDEX_FILE): SkillLocIndex | undefined {
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as SkillLocIndex) : undefined;
}
