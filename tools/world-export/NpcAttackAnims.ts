import fs from "node:fs";

import { HIT_BONES } from "../../src/npc/HitClips";
import { BodyRig } from "../../src/npc/HitPose";
import type { AttackStyle } from "../../src/npc/AttackStyle";
import type { NpcSkeleton } from "../../src/world/NpcFormat";
import { RS_UNITS_PER_TILE } from "../../src/world/WorldFormat";

/**
 * Picks an NPC's melee attack animations from the cache. The cache has the sequences but neither
 * their names nor which one an NPC attacks with (server data), so this uses Jagex's sequence names
 * (data/animation-names-runelite.json, from RuneLite's gameval AnimationID) and the rule the names
 * follow: a creature's attack shares its skeleton (frame base) and its name with its idle
 * ("ZOMBIE_UPDATE_READY_DRAGGING" → "ZOMBIE_UPDATE_ATTACK_DRAGGING"). NPCs on the player's
 * skeleton fight like players: with their weapon stance's attacks, or fists.
 */

export type AnimationNames = Map<number, string>;

export function readAnimationNames(file: string): AnimationNames {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
    return new Map(Object.entries(data).map(([id, name]) => [Number(id), name]));
}

/** The player's skeleton (frame base 0): every human-kit NPC uses it. */
export const PLAYER_FRAME_BASE = 0;

export const HUMAN_ATTACKS = {
    sword: [390, 386], // HUMAN_SWORD_SLASH, HUMAN_SWORD_STAB
    unarmed: [422, 423], // HUMAN_UNARMEDPUNCH, HUMAN_UNARMEDKICK
    staff: [413, 412], // HUMAN_STAFF_POUND, HUMAN_STAFF_SPIKE
    twoHanded: [406, 407], // HUMAN_DHSWORD_CHOP, HUMAN_DHSWORD_SLASH
} as const;

/** Words of a sequence name; run-together ones ("LEECHATTACK") are split off their verb. */
function words(name: string): string[] {
    return name
        .split("_")
        .flatMap((w) => {
            const m = /^([A-Z]{3,})(ATTACK|READY|WALK|DEATH|BLOCK)$/.exec(w);
            return m ? [m[1], m[2]] : [w];
        })
        .filter((w) => w);
}

const MELEE = new Set(["ATTACK", "PUNCH", "KICK", "SLASH", "STAB", "SMASH", "BITE", "CLAW", "SWIPE", "STRIKE", "CHOP", "BASH", "POUND", "HACK", "LUNGE", "SPIKE"]);
/** Not a plain melee attack, or a variant of one shown elsewhere (pets, thralls, transparency). */
const EXCLUDED = new Set([
    "DEATH", "DIE", "BLOCK", "DEF", "DEFEND", "PARRY", "SPELL", "CAST", "RANGE", "RANGED", "MAGIC", "THROW", "SPEC", "SPECIAL",
    "WALK", "READY", "TRANSPARENT", "THRALL", "MERGE", "FIRE", "FIREBREATH", "BREATH", "CROSSBOW", "BOW", "XBOW", "XBOWS",
    "SURPRISE", "TRANS", "STATUE", "CHAT", "EMOTE", "INTO", "OUTOF", "SPAWN", "TELEPORT", "DIG", "RISE", "SPIT", "SHOOT", "MAGE",
]);
/** Name words every family shares, which say nothing about which family a sequence belongs to. */
const GENERIC = new Set(["READY", "ATTACK", "UPDATE", "IDLE", "STAND", "WALK", "ANIM", "NPC", "REWORK", "NEW", "OLD", "JUST", "01", "1", "2", "A", "B"]);
/** Words naming a weapon or a body size: an attack with one the idle lacks is another variant's. */
const VARIANT = new Set(["SPEAR", "SWORD", "AXE", "MACE", "STAFF", "SHIELD", "SCIMITAR", "DAGGER", "SMALL", "BIG", "LARGE", "GIANT", "CUB", "BABY", "GREATER", "LESSER", "TAIL"]);
/** Kicks and bashes shove the player (Dark Messiah's alwayspush); names run them together ("UNARMEDKICK"). */
const SHOVES = /KICK|BASH|SMASH|POUND|SHIELD/;

const parts = (name: string) => new Set(words(name).filter((p) => !GENERIC.has(p)));

/**
 * How well an attack's name matches the idle's: shared words, less a little for each extra one and
 * more for a weapon or size the idle does not have.
 */
function nameScore(idle: Set<string>, attack: string): number {
    const own = parts(attack);
    let score = 0;
    for (const p of own) {
        score += idle.has(p) ? 1 : VARIANT.has(p) ? -0.3 : -0.1;
    }
    return score;
}

export function isShove(names: AnimationNames, seqId: number): boolean {
    return SHOVES.test(names.get(seqId) ?? "");
}

const isMelee = (name: string) => {
    const w = words(name);
    return w.some((x) => MELEE.has(x)) && !w.some((x) => EXCLUDED.has(x));
};

/** How far past its wrist a hand that holds a weapon reaches, tiles. [design] */
const WEAPON_REACH = 0.22;

/**
 * True if a humanoid model holds something in its right hand: the hand reaches well past the
 * wrist (a sword or club), where an empty fist stays within a hand's length.
 */
export function holdsWeapon(
    vertexCount: number,
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    z: ArrayLike<number>,
    skeleton: NpcSkeleton | undefined,
): boolean {
    if (!skeleton || skeleton.parents.length === 0) {
        return false;
    }
    const base = new Float32Array(vertexCount * 3);
    for (let v = 0; v < vertexCount; v++) {
        base[v * 3] = x[v] / RS_UNITS_PER_TILE;
        base[v * 3 + 1] = -y[v] / RS_UNITS_PER_TILE;
        base[v * 3 + 2] = -z[v] / RS_UNITS_PER_TILE;
    }
    const h = new BodyRig({ vertexCount, skeleton }, base).humanoid;
    if (!h) {
        return false;
    }
    const hand = HIT_BONES.indexOf("hand.R");
    const [jx, jy, jz] = [h.joints[hand * 3], h.joints[hand * 3 + 1], h.joints[hand * 3 + 2]];
    let reach = 0;
    const partOf = skeleton.partOf;
    for (let v = 0; v < vertexCount; v++) {
        const p = partOf[v] >= skeleton.parents.length ? 0 : partOf[v];
        if (h.boneOfPart[p] === hand) {
            reach = Math.max(reach, Math.hypot(base[v * 3] - jx, base[v * 3 + 1] - jy, base[v * 3 + 2] - jz));
        }
    }
    return reach > WEAPON_REACH;
}

/** Named sequences by frame base, built once and shared with the export workers. */
export type AttackIndex = { names: [number, string][]; byBase: [number, number[]][] };

export type ChosenAttack = { seqId: number; shove: boolean };

/** Chooses attack sequences from an AttackIndex. */
export class NpcAttackPicker {
    private readonly names: AnimationNames;
    private readonly byBase: Map<number, number[]>;

    constructor(index: AttackIndex) {
        this.names = new Map(index.names);
        this.byBase = new Map(index.byBase);
    }

    choose(idleSeqId: number, frameBase: number, armed: boolean): ChosenAttack[] {
        const { seqIds } = chooseAttacks(this.names, idleSeqId, frameBase, this.byBase.get(frameBase) ?? [], armed);
        return seqIds.map((seqId) => ({ seqId, shove: isShove(this.names, seqId) }));
    }

    /** The attacks for an NPC with several styles: its melee clips, then one clip per other style. */
    chooseStyled(
        idleSeqId: number,
        frameBase: number,
        armed: boolean,
        styles: readonly AttackStyle[],
        seqs: Partial<Record<AttackStyle, number>>,
    ): StyledChoice[] {
        return chooseStyledAttacks(this.names, idleSeqId, frameBase, this.byBase.get(frameBase) ?? [], armed, styles, seqs);
    }
}

/** Indexes every named, frame-animated sequence by its frame base. */
export function buildAttackIndex(names: AnimationNames, frameBaseOf: (seqId: number) => number | undefined): AttackIndex {
    const byBase = new Map<number, number[]>();
    for (const id of names.keys()) {
        let base: number | undefined;
        try {
            base = frameBaseOf(id);
        } catch {
            continue; // sequences whose frames are missing from this cache
        }
        if (base !== undefined) {
            (byBase.get(base) ?? byBase.set(base, []).get(base)!).push(id);
        }
    }
    return { names: [...names], byBase: [...byBase] };
}

export type AttackChoice = {
    /** Sequence ids, best first (at most two, for variety). */
    seqIds: number[];
    /** Why they were chosen, for the export log. */
    reason: string;
};

/**
 * The attacks for an NPC with idle sequence `idleSeqId` on frame base `frameBase`, given every
 * named sequence on that frame base. `armed` says whether a human-kit NPC holds a weapon.
 */
export function chooseAttacks(
    names: AnimationNames,
    idleSeqId: number,
    frameBase: number,
    sameBase: readonly number[],
    armed: boolean,
): AttackChoice {
    const idleName = names.get(idleSeqId) ?? "";
    const idle = parts(idleName);
    const scored = sameBase
        .map((id) => ({ id, name: names.get(id) ?? "" }))
        .filter((s) => isMelee(s.name))
        .map((s) => ({ ...s, score: nameScore(idle, s.name) }))
        .sort((a, b) => b.score - a.score || a.id - b.id);

    if (frameBase === PLAYER_FRAME_BASE) {
        // A named stance of its own (a Barrows brother) keeps its own attacks; otherwise the
        // stance says the weapon, as the player's does.
        const specific = scored.filter((s) => s.score >= 1 && ![...parts(s.name)].every((p) => p === "HUMAN"));
        const best = specific.filter((s) => s.score === specific[0]?.score);
        if (best.length > 0 && !idleName.startsWith("HUMAN_")) {
            return { seqIds: best.slice(0, 2).map((s) => s.id), reason: `stance ${idleName}` };
        }
        if (/STAFF/.test(idleName)) {
            return { seqIds: [...HUMAN_ATTACKS.staff], reason: "staff stance" };
        }
        if (/_DH_|DHSWORD|2H/.test(idleName)) {
            return { seqIds: [...HUMAN_ATTACKS.twoHanded], reason: "two-handed stance" };
        }
        return armed
            ? { seqIds: [...HUMAN_ATTACKS.sword], reason: "holds a weapon" }
            : { seqIds: [...HUMAN_ATTACKS.unarmed], reason: "unarmed" };
    }
    const matching = scored.filter((s) => s.score > 0);
    if (matching.length === 0) {
        return { seqIds: [], reason: `no named attack on the skeleton of ${idleName || idleSeqId}` };
    }
    const top = matching[0].score;
    return { seqIds: matching.filter((s) => s.score >= top - 0.05).slice(0, 2).map((s) => s.id), reason: `matches ${idleName}` };
}

export type StyledChoice = { seqId: number; style: AttackStyle; shove: boolean; fallback: boolean };

/** Name words that say a sequence is an attack of that style. */
const STYLE_KEYWORDS: Partial<Record<AttackStyle, string[]>> = {
    magic: ["CAST", "CASTING", "MAGIC", "SPELL", "MAGE", "DISCORD"],
    ranged: ["RANGE", "RANGED", "SHOOT", "THROW", "BOW", "XBOW", "SPIT"],
    dragonfire: ["FIREBREATH", "BREATH", "FIRE"],
    icebreath: ["BREATH", "ICE", "FIREBREATH"],
};
/** Sequences of an effect, a reaction or a pose, never the attack itself. */
const NOT_AN_ATTACK = new Set([
    "DEATH", "DIE", "BLOCK", "DEF", "DEFEND", "WALK", "READY", "SPOTANIM", "SPOT", "TRAVEL", "IMPACT", "PROJANIM", "CHATHEAD", "TALK",
]);

/** Player-skeleton sequences of a cast and a bow shot. */
const HUMAN_CAST = 711; // HUMAN_CASTSTRIKE
const HUMAN_CAST_STAFF = 1162; // HUMAN_CASTSTRIKE_STAFF
const HUMAN_BOW = 426; // HUMAN_BOW

/** The best sequence on `sameBase` for a style: named for it, then an "ATTACK", then like the idle. */
function chooseStyleSequence(
    names: AnimationNames,
    idleSeqId: number,
    sameBase: readonly number[],
    style: AttackStyle,
): number | undefined {
    const keywords = STYLE_KEYWORDS[style];
    if (!keywords) {
        return undefined;
    }
    const idle = parts(names.get(idleSeqId) ?? "");
    const candidates = sameBase
        .map((id) => ({ id, name: names.get(id) ?? "" }))
        .filter(({ name }) => {
            const w = words(name);
            if (w.some((x) => NOT_AN_ATTACK.has(x))) {
                return false;
            }
            return keywords.some((k) => w.includes(k) || (k.length >= 5 && name.includes(k)));
        })
        .map((s) => ({ ...s, attack: words(s.name).includes("ATTACK") ? 1 : 0, score: nameScore(idle, s.name) }))
        .sort((a, b) => b.attack - a.attack || b.score - a.score || a.id - b.id);
    return candidates[0]?.id;
}

/**
 * The attacks of an NPC with several styles, in `styles` order. Melee is what chooseAttacks picks;
 * every other style gets one sequence: an explicit one from the overrides, a player cast or bow shot
 * on the player's skeleton, or the best one named for it on the creature's skeleton. A style with
 * none reuses the first melee sequence (`fallback`), so the attack still works with that animation.
 */
export function chooseStyledAttacks(
    names: AnimationNames,
    idleSeqId: number,
    frameBase: number,
    sameBase: readonly number[],
    armed: boolean,
    styles: readonly AttackStyle[],
    seqs: Partial<Record<AttackStyle, number>>,
): StyledChoice[] {
    const melee = chooseAttacks(names, idleSeqId, frameBase, sameBase, armed).seqIds;
    const idleName = names.get(idleSeqId) ?? "";
    const out: StyledChoice[] = [];
    for (const style of styles) {
        const explicit = seqs[style];
        if (explicit !== undefined) {
            out.push({ seqId: explicit, style, shove: false, fallback: false });
            continue;
        }
        if (style === "melee") {
            for (const seqId of melee) {
                out.push({ seqId, style, shove: isShove(names, seqId), fallback: false });
            }
            continue;
        }
        let seqId: number | undefined;
        if (frameBase === PLAYER_FRAME_BASE) {
            const human = style === "magic" ? (/STAFF/.test(idleName) ? HUMAN_CAST_STAFF : HUMAN_CAST) : style === "ranged" ? HUMAN_BOW : undefined;
            seqId = human !== undefined && sameBase.includes(human) ? human : undefined;
        } else {
            seqId = chooseStyleSequence(names, idleSeqId, sameBase, style);
        }
        if (seqId !== undefined) {
            out.push({ seqId, style, shove: false, fallback: false });
        } else if (melee.length > 0) {
            out.push({ seqId: melee[0], style, shove: false, fallback: true });
        }
    }
    return out;
}
