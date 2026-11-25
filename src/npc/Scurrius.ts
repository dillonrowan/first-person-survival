import type { NpcAttackClip } from "../world/NpcFormat";
import { CLIENT_CYCLE_SECONDS } from "./NpcAnimation";
import type { CombatContext, Npc, NpcBehaviour } from "./Npc";
import type { NpcAttack } from "./NpcAttacks";
import type { FallingBricks } from "./FallingBricks";

/**
 * Scurrius, the rat king of the Varrock Sewers [OSRS Wiki: Scurrius, Scurrius/Strategies].
 *
 * - Phase one: tail swipes, and now and then a stomp that brings Falling Bricks down.
 * - At 80% he runs to a Food Pile and eats: ten bites, healing on five of them, while he flings fur,
 *   calls lightning, stomps and screeches for giant rats instead of swiping. Then he swipes again
 *   (phase two) until the next time he goes to eat.
 * - At 30% he runs to the middle of the arena, enrages and stays there: fur and lightning only, at
 *   a faster rate, with rubble again and again and up to 12 waves of rats.
 * - He is aggressive: a player walking into the arena starts the fight. He resets when the player
 *   gets away.
 *
 * The wiki gives no tick timings for these, nor how many bricks fall; the values marked [design]
 * are this game's.
 */

/** Scurrius (7222 solo, 7221 group), his giant rats. */
export const SCURRIUS_IDS: ReadonlySet<number> = new Set([7221, 7222]);
export const GIANT_RAT_ID = 7223;

/** His sequences (NPC_RAT_BOSS_*), baked as extra clips (npc-attack-overrides extraSeqs). */
export const SCURRIUS_SEQ = {
    feedingIdle: 10688,
    run: 10691,
    feedingRanged: 10695,
    feedingMagic: 10697,
    stomp: 10698,
    feedingStomp: 10699,
    summon: 10700,
    feedingSummon: 10702,
    enrage: 10704,
    death: 10705,
} as const;

/** The arena (cache collision of map square 51,154): open floor x 3290..3306, y 9860..9875. */
export const ARENA = { minX: 3290, maxX: 3307, minY: 9860, maxY: 9876, plane: 0 } as const;
/** Where he stands in his last phase. */
export const ARENA_CENTRE = { x: 3298.5, y: 9868 } as const;
/**
 * Where he stands to eat at each Food Pile (locs 14205 and 14206: south, north and east of the
 * arena), and the pile he faces.
 */
export const FOOD_PILES: readonly { x: number; y: number; pileX: number; pileY: number }[] = [
    { x: 3299, y: 9861.6, pileX: 3299, pileY: 9859 },
    { x: 3299, y: 9874.4, pileX: 3299, pileY: 9877 },
    { x: 3305.4, y: 9868, pileX: 3308, pileY: 9868 },
];

/** Health fractions at which he goes to eat [wiki: at 80%; the later ones are design]. */
export const EAT_AT: readonly number[] = [0.8, 0.6, 0.4];
/** Health fraction of the last phase [wiki: 30%]. */
export const LAST_PHASE_AT = 0.3;
/** Bites at a pile, and every second one heals [wiki: ten eating animations, five heals]. */
export const BITES = 10;
/** Health one healing bite restores [wiki: "5 or 10"]. */
export const BITE_HEAL: readonly number[] = [5, 10];
/** Rats per summon [wiki: six], and the most waves in the last phase [wiki: 12]. */
export const RATS_PER_WAVE = 6;
export const LAST_PHASE_WAVES = 12;
/** Rubble per stomp: one on the player's tile and these around the arena. [design] */
export const RANDOM_BRICKS = 5;
/** The wait between attacks in the last phase, against the others ("a faster rate"). [design] */
export const LAST_PHASE_PACE = 0.6;
/** Chance he eats at the nearest pile rather than any ("usually one close to him"). [design] */
const NEAREST_PILE_CHANCE = 0.7;
/** Seconds of one bite when the cache has no feeding clip. [design] */
const BITE_SECONDS = 1.2;
/** Rats keep at least this far from the player when they appear, tiles. [design] */
const RAT_CLEARANCE = 2.5;

export type ScurriusMode = "waiting" | "fighting" | "toPile" | "eating" | "toCentre" | "enraged";

/** What the fight needs of the rest of the game. */
export type ScurriusWorld = {
    bricks: FallingBricks;
    /** Calls up a giant rat with its south-west corner at a tile; undefined if it cannot stand there. */
    summonRat(x: number, y: number, plane: number): Promise<Npc | undefined>;
    random(): number;
    /** A message for the player ("Scurrius screeches..."). */
    say?(text: string): void;
};

/** The attacks of his fight, built from his baked clips. */
type Moves = {
    melee: NpcAttack[];
    ranged?: NpcAttack;
    magic?: NpcAttack;
    feedingRanged?: NpcAttack;
    feedingMagic?: NpcAttack;
    stomp: NpcAttack;
    feedingStomp: NpcAttack;
    summon: NpcAttack;
    feedingSummon: NpcAttack;
    enrage: NpcAttack;
};

const clipSeconds = (clip: NpcAttackClip) => clip.frameLengths.reduce((sum, length) => sum + length, 0) * CLIENT_CYCLE_SECONDS;

/**
 * A boss move played from one of his extra clips, timed by it: it lands at the clip's hit cycle (the
 * stomp's landing), or at `at` of its length for a throw or a cast. Without the clip (an older
 * export) it keeps `base`'s own clip and timing, or lands halfway through a plain 1.8 s.
 */
function extraMove(
    npc: Npc,
    seqId: number,
    base: Partial<NpcAttack> & Pick<NpcAttack, "id" | "style">,
    at?: number,
): NpcAttack {
    const move: NpcAttack = {
        hitPow: [0.7],
        hitTimes: [0.9],
        total: 1.8,
        range: 0,
        lunge: 0,
        push: false,
        breaksParry: true,
        weight: 1,
        minGap: 0,
        maxGap: Infinity,
        cooldownScale: 1,
        ...base,
    };
    const index = npc.extraIndex(seqId);
    const clip = npc.extraClip(seqId);
    if (index < 0 || !clip) {
        return move;
    }
    const total = clipSeconds(clip);
    const hit = Math.min(total, at !== undefined ? total * at : clip.hitCycle * CLIENT_CYCLE_SECONDS);
    return { ...move, hitTimes: [hit], total: Math.max(total, hit + CLIENT_CYCLE_SECONDS), extra: index };
}

/** The share of a clip at which a fur ball or a bolt leaves him (as for other casters). */
const RELEASE_AT = 0.6;
/**
 * When his feet touch down after the stomp's jump, and the peak of the summon's screech, as shares
 * of their clips (rendered frame by frame in Blender from the baked NPC_RAT_BOSS_ATTACK_STOMP_01 and
 * _SUMMON_01; the hit cycles the exporter finds land just before touchdown and after the screech).
 */
const STOMP_LANDS_AT = 0.62;
const SCREECH_AT = 0.6;

export class ScurriusFight implements NpcBehaviour {
    mode: ScurriusMode = "waiting";
    goal: NpcBehaviour["goal"];
    idleSeq: number | undefined;
    readonly runSeq = SCURRIUS_SEQ.run;
    readonly deathSeq = SCURRIUS_SEQ.death;
    /** Rat waves called in the last phase. */
    waves = 0;
    /** Bites taken at the current pile. */
    bites = 0;
    /** The rats he has called that are still about. */
    readonly rats = new Set<Npc>();
    private readonly moves: Moves;
    /** Thresholds of EAT_AT already eaten at (re-armed when he heals back above them). */
    private readonly ate = new Set<number>();
    private biteTime = 0;
    private summonedThisMeal = false;
    /** He has eaten this fight: phase two has begun. */
    private fed = false;
    /** The player's tile when a stomp began: one piece of rubble falls there. */
    private aim: { x: number; y: number } | undefined;

    constructor(
        private readonly npc: Npc,
        private readonly world: ScurriusWorld,
    ) {
        npc.combatant.steadfast = true;
        const all = npc.attacker.all;
        const ranged = all.find((a) => a.style === "ranged");
        const magic = all.find((a) => a.style === "magic");
        const seq = SCURRIUS_SEQ;
        this.moves = {
            melee: all.filter((a) => a.style === "melee"),
            ranged,
            magic,
            feedingRanged: ranged && extraMove(npc, seq.feedingRanged, { ...ranged, id: "feeding-ranged" }, RELEASE_AT),
            feedingMagic: magic && extraMove(npc, seq.feedingMagic, { ...magic, id: "feeding-magic" }, RELEASE_AT),
            stomp: extraMove(npc, seq.stomp, { id: "stomp", style: "melee", special: "bricks" }, STOMP_LANDS_AT),
            feedingStomp: extraMove(npc, seq.feedingStomp, { id: "feeding-stomp", style: "melee", special: "bricks" }, STOMP_LANDS_AT),
            summon: extraMove(npc, seq.summon, { id: "summon", style: "melee", special: "summon" }, SCREECH_AT),
            feedingSummon: extraMove(npc, seq.feedingSummon, { id: "feeding-summon", style: "melee", special: "summon" }, SCREECH_AT),
            enrage: { ...extraMove(npc, seq.enrage, { id: "enrage", style: "melee" }), hitTimes: [], hitPow: [] },
        };
        npc.attacker.extend(
            [
                this.moves.feedingRanged,
                this.moves.feedingMagic,
                this.moves.stomp,
                this.moves.feedingStomp,
                this.moves.summon,
                this.moves.feedingSummon,
            ].filter((m): m is NpcAttack => m !== undefined),
        );
        // A stomp now and then among the swipes [wiki: "occasionally"]. [design: about one in six]
        this.moves.stomp.weight = 0.4;
        this.setAllowed();
    }

    /** 1 before 80%, 3 once at 30% or below, 2 between. */
    get phase(): 1 | 2 | 3 {
        const f = this.npc.combatant.healthFraction;
        return f <= LAST_PHASE_AT ? 3 : this.fed || f <= EAT_AT[0] ? 2 : 1;
    }

    update(npc: Npc, dt: number, ctx: CombatContext): void {
        const c = npc.combatant;
        if (c.dead) {
            this.goal = undefined;
            this.idleSeq = undefined;
            return;
        }
        const player = ctx.player;
        if (this.mode === "waiting") {
            if (player && inArena(player.x, player.y, player.plane)) {
                npc.becomeAlerted(player.x, player.y);
                this.mode = "fighting";
            }
            this.setAllowed();
            return;
        }
        if (!npc.alerted) {
            // The player got away: he is ready for the next one, healed, his rats gone.
            this.reset();
            return;
        }

        const f = c.healthFraction;
        // Healed back above a threshold: he will eat there again.
        for (const at of [...this.ate]) {
            if (f > at) this.ate.delete(at);
        }
        if (f <= LAST_PHASE_AT && this.mode !== "toCentre" && this.mode !== "enraged") {
            this.mode = "toCentre";
            this.idleSeq = undefined;
            this.goal = { ...ARENA_CENTRE, run: true };
            npc.attacker.interrupt();
        } else if (this.mode === "fighting") {
            const at = EAT_AT.find((t) => f <= t && !this.ate.has(t));
            if (at !== undefined && f > LAST_PHASE_AT) {
                for (const t of EAT_AT) if (f <= t) this.ate.add(t);
                this.goToPile(npc);
            }
        }

        if (this.mode === "toPile" && npc.atGoal && !npc.attacker.busy) {
            this.mode = "eating";
            this.bites = 0;
            this.biteTime = 0;
            this.summonedThisMeal = false;
            this.idleSeq = SCURRIUS_SEQ.feedingIdle;
        } else if (this.mode === "eating") {
            this.eat(npc, dt);
        } else if (this.mode === "toCentre" && npc.atGoal && !npc.attacker.busy) {
            this.mode = "enraged";
            this.goal = { ...ARENA_CENTRE, run: false };
            npc.attacker.force(this.moves.enrage);
            this.world.say?.("Scurrius flies into a rage!");
        }
        this.setAllowed();
    }

    private goToPile(npc: Npc): void {
        const x = npc.body.x;
        const y = npc.body.y;
        const byDistance = [...FOOD_PILES].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
        const r = this.world.random();
        const pile = r < NEAREST_PILE_CHANCE ? byDistance[0] : byDistance[1 + Math.floor(this.world.random() * (byDistance.length - 1))];
        this.mode = "toPile";
        this.fed = true;
        this.idleSeq = undefined;
        this.goal = { x: pile.x, y: pile.y, run: true, faceX: pile.pileX - pile.x, faceY: pile.pileY - pile.y };
        npc.attacker.interrupt();
        this.world.say?.("Scurrius scurries off to feed!");
    }

    /** One bite per feeding clip; every second one heals. Bites pause while he attacks. */
    private eat(npc: Npc, dt: number): void {
        if (npc.attacker.busy) {
            return;
        }
        const clip = npc.extraClip(SCURRIUS_SEQ.feedingIdle);
        const bite = clip ? clipSeconds(clip) : BITE_SECONDS;
        this.biteTime += dt;
        while (this.biteTime >= bite && this.mode === "eating") {
            this.biteTime -= bite;
            this.bites++;
            if (this.bites % 2 === 0) {
                npc.heal(BITE_HEAL[Math.floor(this.world.random() * BITE_HEAL.length) % BITE_HEAL.length]);
            }
            if (this.bites >= BITES) {
                this.mode = "fighting";
                this.goal = undefined;
                this.idleSeq = undefined;
            }
        }
    }

    /** Which attacks he may start in the current mode (NpcAttacker.allow) and how fast. */
    private setAllowed(): void {
        const m = this.moves;
        const npc = this.npc;
        let allowed: (NpcAttack | undefined)[];
        switch (this.mode) {
            case "fighting":
                allowed = [...m.melee, m.stomp];
                break;
            case "eating":
                allowed = [m.feedingRanged ?? m.ranged, m.feedingMagic ?? m.magic, m.feedingStomp, this.summonedThisMeal ? undefined : m.feedingSummon];
                break;
            case "enraged":
                allowed = [m.ranged, m.magic, m.stomp, this.waves < LAST_PHASE_WAVES ? m.summon : undefined];
                break;
            default:
                allowed = []; // waiting, or on the way somewhere
        }
        const set = new Set(allowed.filter((a): a is NpcAttack => a !== undefined));
        npc.attacker.allow = (a) => set.has(a);
        npc.attacker.pace = this.mode === "enraged" ? LAST_PHASE_PACE : 1;
    }

    special(npc: Npc, attack: NpcAttack, when: "start" | "impact", player: { x: number; y: number; plane: number }): void {
        if (attack.special === "bricks") {
            if (when === "start") {
                this.aim = { x: Math.floor(player.x), y: Math.floor(player.y) };
            } else {
                this.dropBricks(npc.plane, this.aim ?? { x: Math.floor(player.x), y: Math.floor(player.y) });
                this.aim = undefined;
            }
        } else if (attack.special === "summon" && when === "impact") {
            if (this.mode === "eating") this.summonedThisMeal = true;
            if (this.mode === "enraged") this.waves++;
            this.summonRats(npc.plane, player);
        }
    }

    /** One piece on the player's tile, the others on random tiles of the arena. */
    private dropBricks(plane: number, aim: { x: number; y: number }): void {
        const tiles = [aim];
        for (let i = 0; i < RANDOM_BRICKS; i++) {
            tiles.push(this.randomTile(1));
        }
        this.world.bricks.drop(tiles, plane);
    }

    private summonRats(plane: number, player: { x: number; y: number }): void {
        this.world.say?.("Scurrius screeches, calling his rats!");
        for (let i = 0; i < RATS_PER_WAVE; i++) {
            let tile = this.randomTile(2);
            for (let tries = 0; tries < 8 && Math.hypot(tile.x + 1 - player.x, tile.y + 1 - player.y) < RAT_CLEARANCE; tries++) {
                tile = this.randomTile(2);
            }
            void this.world.summonRat(tile.x, tile.y, plane).then((rat) => {
                if (!rat) return;
                this.rats.add(rat);
                // Giant rats are aggressive [OSRS Wiki: Giant rat (Scurrius)].
                rat.becomeAlerted(player.x, player.y);
            });
        }
    }

    /** A random south-west tile for something `size` tiles across, inside the arena. */
    private randomTile(size: number): { x: number; y: number } {
        const r = this.world.random;
        return {
            x: ARENA.minX + Math.floor(r() * (ARENA.maxX - ARENA.minX - size + 1)),
            y: ARENA.minY + Math.floor(r() * (ARENA.maxY - ARENA.minY - size + 1)),
        };
    }

    /** Back to the start: full health, waiting for the next player, no rats, no rubble. */
    reset(): void {
        const c = this.npc.combatant;
        if (!c.dead) c.health = c.maxHealth;
        this.mode = "waiting";
        this.goal = undefined;
        this.idleSeq = undefined;
        this.ate.clear();
        this.fed = false;
        this.waves = 0;
        this.bites = 0;
        this.aim = undefined;
        for (const rat of this.rats) {
            if (!rat.combatant.dead) rat.gone = true;
        }
        this.rats.clear();
        this.world.bricks.clear();
        this.setAllowed();
    }
}

/** True if (x, y) is on the arena floor. */
export function inArena(x: number, y: number, plane: number): boolean {
    return plane === ARENA.plane && x >= ARENA.minX && x < ARENA.maxX && y >= ARENA.minY && y < ARENA.maxY;
}
