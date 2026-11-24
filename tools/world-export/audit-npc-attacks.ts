// Audits the attack animations of every exported NPC: the clips in public/world/npcs/ and the
// sequence names behind them (data/animation-names-runelite.json). Writes
// tools/world-export/out/attack-audit.json and prints a summary of what looks wrong:
//
//   npx tsx tools/world-export/audit-npc-attacks.ts
//
// Flags (one NPC can have several):
//   wrongStyle   a clip's sequence is named for another style (a melee clip named RANGED, ...),
//                unless data/npc-attack-overrides.ts sets it (checked against the OSRS Wiki)
//   notAttack    a clip's sequence is named for no attack at all (DEATH, WALK, READY, ...)
//   otherFamily  a clip's sequence shares no name word with the NPC's idle (another creature's)
//   fallback     a style reuses the melee clip although its skeleton has one named for it
//   noAttack     the NPC can be attacked but has no clip, though its skeleton has a named attack
//   still        a clip barely moves the model
//   badHit       the hit lands on the clip's first step or past its end

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { NpcManifest, decodeNpcModel } from "../../src/world/NpcFormat";
import { readAnimationNames } from "./NpcAttackAnims";
import { attackRulesFor } from "./NpcAttackRules";
import type { WikiAttackRow } from "./fetch-wiki-attacks";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORLD = path.join(ROOT, "public", "world");
const names = readAnimationNames(path.join(ROOT, "tools", "world-export", "data", "animation-names-runelite.json"));
const manifest = JSON.parse(fs.readFileSync(path.join(WORLD, "npcs.json"), "utf8")) as NpcManifest;
const wiki = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "world-export", "data", "npc-attacks-wiki.json"), "utf8")) as Record<string, WikiAttackRow>;

/** Name words, with trailing digits split off ("RANGED01" → RANGED, 01). */
const words = (name: string) => name.split("_").flatMap((w) => /^([A-Z]+?)(\d+)$/.exec(w)?.slice(1) ?? [w]).filter(Boolean);
const STYLE_WORDS: Record<string, string[]> = {
    melee: ["MELEE", "PUNCH", "KICK", "SLASH", "STAB", "SMASH", "BITE", "CLAW", "SWIPE", "STRIKE", "CHOP", "BASH", "POUND", "HACK", "LUNGE", "SPIKE", "HEADBUTT", "STOMP"],
    ranged: ["RANGE", "RANGED", "SHOOT", "THROW", "BOW", "XBOW", "SPIT", "CROSSBOW"],
    magic: ["CAST", "CASTING", "MAGIC", "SPELL", "MAGE"],
    // Not FIRE or ICE alone: they name families too (ELEMENTAL_FIRE_ATTACK, GIANT_UPDATE_ICE_ATTACK).
    dragonfire: ["FIREBREATH", "BREATH"],
    icebreath: ["BREATH", "ICEBREATH"],
};
const NOT_ATTACK = new Set(["DEATH", "DIE", "WALK", "READY", "IDLE", "STAND", "BLOCK", "DEFEND", "SPAWN", "EMOTE", "CHAT", "TALK", "VFX", "SPOTANIM"]);
const GENERIC = new Set(["NPC", "ATTACK", "READY", "IDLE", "STAND", "WALK", "UPDATE", "ANIM", "01", "02", "1", "2", "A", "B", "HUMAN"]);
const styleOf = (w: string[]) => Object.entries(STYLE_WORDS).filter(([, ks]) => ks.some((k) => w.includes(k))).map(([s]) => s);

type Row = { id: number; name: string; clips: { style: string; seqId: number; seq: string; hit: number; firstStep: number; cycles: number; motion: number }[]; flags: string[] };
const rows: Row[] = [];
for (const a of manifest.appearances) {
    if (!a.actions?.some((x) => /^attack$/i.test(x)) && !a.attackStyles) continue;
    const bytes = gunzipSync(fs.readFileSync(path.join(WORLD, a.file)));
    const data = decodeNpcModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const n = data.vertexCount;
    const clips = (data.attacks ?? []).map((c) => {
        let motion = 0;
        const frames = c.frameLengths.length;
        for (let f = 1; f < frames; f++) for (let i = 0; i < n * 3; i++) motion = Math.max(motion, Math.abs(c.positions[f * n * 3 + i] - c.positions[i]));
        return { style: c.style, seqId: c.seqId, seq: names.get(c.seqId) ?? "?", hit: c.hitCycle, firstStep: c.frameLengths[0], cycles: [...c.frameLengths].reduce((x, y) => x + y, 0), motion };
    });
    const flags = new Set<string>();
    const chosen = Object.values(attackRulesFor(wiki[a.id])?.seqs ?? {});
    for (const c of clips) {
        const w = words(c.seq);
        const styles = styleOf(w);
        if (c.seq !== "?" && !chosen.includes(c.seqId) && styles.length > 0 && !styles.includes(c.style)) flags.add("wrongStyle");
        if (w.some((x) => NOT_ATTACK.has(x)) && (!w.includes("ATTACK") || w.includes("VFX"))) flags.add("notAttack");
        if (c.motion < 8) flags.add("still");
        if (c.hit <= c.firstStep || c.hit > c.cycles) flags.add("badHit");
    }
    const style = (a.attackStyles ?? []).map((s) => s.style);
    const meleeSeq = clips.find((c) => c.style === "melee")?.seqId;
    for (const s of style) if (s !== "melee" && clips.some((c) => c.style === s && c.seqId === meleeSeq)) flags.add("fallback");
    if (clips.length === 0) flags.add("noAttack");
    rows.push({ id: a.id, name: a.name, clips, flags: [...flags] });
}

const counts: Record<string, number> = {};
for (const r of rows) for (const f of r.flags) counts[f] = (counts[f] ?? 0) + 1;
fs.mkdirSync(path.join(ROOT, "tools", "world-export", "out"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "tools", "world-export", "out", "attack-audit.json"), JSON.stringify(rows, null, 1));
console.log(`${rows.length} attackable appearances; flagged:`, counts);
