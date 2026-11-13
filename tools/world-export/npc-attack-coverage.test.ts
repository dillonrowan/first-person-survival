// Checks that every NPC the OSRS wiki gives more than melee has those attacks in the export:
// listed in npcs.json and baked into its model file. Skipped without the exported world.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { AttackStyle } from "../../src/npc/AttackStyle";
import { NpcManifest, decodeNpcModel } from "../../src/world/NpcFormat";
import type { WikiAttackRow } from "./fetch-wiki-attacks";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORLD_DIR = path.join(ROOT, "public", "world");
const WIKI_FILE = path.join(ROOT, "tools", "world-export", "data", "npc-attacks-wiki.json");
const hasWorld = fs.existsSync(path.join(WORLD_DIR, "npcs.json")) && fs.existsSync(WIKI_FILE);

/** The exported attackable NPCs with 2+ styles in the wiki (one id of each group is enough to name it). */
const MULTI_STYLE_IDS = [
    ...[260, 261, 262, 263, 264], // Green dragon
    253, // Black dragon
    6593, // Lava dragon
    6609, // Callisto
    6610, // Venenatis
    6611, // Vet'ion
    2054, // Chaos Elemental
    6618, // Crazy archaeologist
    7806, // Deranged archaeologist
    ...[6766, 6767], // Lizardman shaman
    ...[6914, 6915, 6916, 6917, 8563, 6918, 6919, 8564], // Lizardman, brute
    6076, // Tortoise (with riders)
    ...[787, 788, 789, 790, 791, 792, 793], // Suqah
    3258, // Druid
    520, // Chaos druid
    ...[528, 8401, 3485, 8400, 3484, 3486], // Monk of Zamorak
    1025, // Necromancer
    511, // Invrigar the Necromancer
    ...[5969, 6094, 6095, 6096, 5968, 5970], // Gnome
];

describe.skipIf(!hasWorld)("NPC attack styles in the export", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(WORLD_DIR, "npcs.json"), "utf8")) as NpcManifest;
    const wiki = JSON.parse(fs.readFileSync(WIKI_FILE, "utf8")) as Record<string, WikiAttackRow>;
    const styleSet = (styles: { style: AttackStyle }[]) => [...new Set(styles.map((s) => s.style))].sort();

    it("lists every wiki style beyond melee-only for each NPC", () => {
        let checked = 0;
        for (const a of manifest.appearances) {
            const row = wiki[a.id];
            if (!row || row.styles.length === 0 || (row.styles.length === 1 && row.styles[0].style === "melee")) {
                expect(a.attackStyles, `${a.name} (${a.id}) melee-only`).toBeUndefined();
                continue;
            }
            expect(a.attackStyles, `${a.name} (${a.id})`).toBeDefined();
            expect(styleSet(a.attackStyles!), `${a.name} (${a.id})`).toEqual(styleSet(row.styles));
            checked++;
        }
        expect(checked).toBeGreaterThan(50);
    });

    it("covers every exported NPC with 2+ wiki styles", () => {
        for (const id of MULTI_STYLE_IDS) {
            const a = manifest.appearances.find((x) => x.id === id);
            expect(a, `NPC ${id} is exported`).toBeDefined();
            expect(a!.attackStyles?.length, `${a!.name} (${id}) has 2+ styles`).toBeGreaterThanOrEqual(2);
        }
    });

    it("bakes a clip for every non-melee style, except for NPCs with skeletal animations", () => {
        // Callisto and Vet'ion animate with skeletons, which the exporter cannot bake (no frame
        // base): they have no clips and attack with the plain timed attack of the runtime.
        const skeletal = new Set([6609, 6611]);
        const unbaked: number[] = [];
        for (const a of manifest.appearances.filter((x) => x.attackStyles)) {
            const bytes = gunzipSync(fs.readFileSync(path.join(WORLD_DIR, a.file)));
            const data = decodeNpcModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
            if ((data.attacks ?? []).length === 0) {
                unbaked.push(a.id);
                continue;
            }
            const baked = new Set(data.attacks!.map((c) => c.style));
            for (const s of a.attackStyles!.filter((x) => x.style !== "melee")) {
                expect(baked.has(s.style), `${a.name} (${a.id}) bakes ${s.style}`).toBe(true);
            }
        }
        expect(new Set(unbaked.filter((id) => !skeletal.has(id)))).toEqual(new Set());
    });

    it("gives dragons their own breath animation, not the melee one", () => {
        for (const id of [260, 253, 6593]) {
            const a = manifest.appearances.find((x) => x.id === id)!;
            const bytes = gunzipSync(fs.readFileSync(path.join(WORLD_DIR, a.file)));
            const data = decodeNpcModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
            const melee = data.attacks!.find((c) => c.style === "melee")!;
            const fire = data.attacks!.find((c) => c.style === "dragonfire")!;
            expect(fire.seqId, `${a.name} breathes with its own sequence`).not.toBe(melee.seqId);
        }
    });
});
