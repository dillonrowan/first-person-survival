import { ADJACENT } from "./AttackStyle";
import { extraMove } from "./BossMoves";
import type { CombatContext, Npc, NpcBehaviour } from "./Npc";
import type { NpcAttack } from "./NpcAttacks";

/**
 * Bryophyta, the moss giantess of the Varrock Sewers [OSRS Wiki: Bryophyta, Growthling].
 *
 * - She stands her ground: she does not walk to the player, and clubs only a player next to her
 *   ("won't move towards players and won't use melee attacks if they are out of her reach"); she
 *   casts at anyone further.
 * - Once she has lost about 25% of her health, each of her attacks has a 1 in 5 chance to be a
 *   summon instead: three growthlings, one batch at a time, about 20 ticks apart. While any is alive
 *   she takes no damage. (In OSRS they must be finished with an axe or secateurs; here any weapon
 *   kills them.)
 * - She is aggressive: a player walking into her chamber starts the fight. She resets when the
 *   player gets away.
 */

export const BRYOPHYTA_ID = 8195;
export const GROWTHLING_ID = 8194;

/** Her sequences on the giant skeleton, baked as extra clips (npc-attack-overrides extraSeqs). */
export const BRYOPHYTA_SEQ = {
    /** GIANT_BASIC_STAMP: she stamps and the growthlings come up. */
    summon: 7183,
    death: 4659, // GIANT_UPDATE_MOSS_DEATH
} as const;

/** Her chamber (cache collision of map square 50,155): floor x 3214..3228, y 9928..9941. */
export const CHAMBER = { minX: 3214, maxX: 3229, minY: 9928, maxY: 9942, plane: 0 } as const;

/** Share of her health she must lose before she summons [wiki: "lost ~25% of her HP"]. */
export const SUMMON_BELOW = 0.75;
/** Chance an attack of hers is a summon [wiki: 1/5 per attack]. */
export const SUMMON_CHANCE = 0.2;
/** Growthlings per summon [wiki: three], and seconds between batches [wiki: "around 20 ticks"]. */
export const GROWTHLINGS = 3;
export const SUMMON_COOLDOWN = 20 * 0.6;
/** Seconds since the player last attacked within which she may summon [wiki: only while attacked]. [design] */
const ATTACKED_WITHIN = 8;

export type BryophytaMode = "waiting" | "fighting";

export type BryophytaWorld = {
    /** Calls up a growthling with its south-west corner at a tile; undefined if it cannot stand there. */
    summonGrowthling(x: number, y: number, plane: number): Promise<Npc | undefined>;
    random(): number;
    say?(text: string): void;
};

/** True if (x, y) is on her chamber's floor. */
export function inChamber(x: number, y: number, plane: number): boolean {
    return plane === CHAMBER.plane && x >= CHAMBER.minX && x < CHAMBER.maxX && y >= CHAMBER.minY && y < CHAMBER.maxY;
}

export class BryophytaFight implements NpcBehaviour {
    mode: BryophytaMode = "waiting";
    goal: NpcBehaviour["goal"];
    readonly deathSeq = BRYOPHYTA_SEQ.death;
    /** The growthlings of her current batch that are still alive. */
    readonly growthlings = new Set<Npc>();
    private readonly summon: NpcAttack;
    private readonly others: NpcAttack[];
    private readonly home: { x: number; y: number };
    /** Seconds since her last batch came up. */
    private sinceSummon = Infinity;
    /** Growthlings called up whose models are still loading: they count as there. */
    private pending = 0;

    constructor(
        private readonly npc: Npc,
        private readonly world: BryophytaWorld,
    ) {
        npc.combatant.steadfast = true;
        this.home = { x: npc.body.x, y: npc.body.y };
        // She clubs only a player next to her, without stepping in.
        for (const a of npc.attacker.all) {
            if (a.style === "melee") {
                a.lunge = 0;
                a.maxGap = ADJACENT;
            }
        }
        this.others = [...npc.attacker.all];
        this.summon = extraMove(npc, BRYOPHYTA_SEQ.summon, { id: "summon", style: "melee", special: "summon" });
        npc.attacker.extend([this.summon]);
        this.setAllowed(false);
    }

    /** While a growthling lives she takes no damage [wiki]. */
    get invulnerable(): boolean {
        return this.growthlings.size + this.pending > 0;
    }

    update(npc: Npc, dt: number, ctx: CombatContext): void {
        for (const g of this.growthlings) {
            if (g.combatant.dead || g.gone) this.growthlings.delete(g);
        }
        if (npc.combatant.dead) {
            this.goal = undefined;
            return;
        }
        this.sinceSummon += dt;
        const player = ctx.player;
        if (this.mode === "waiting") {
            npc.hold(2); // she does not wander about her chamber
            if (player && inChamber(player.x, player.y, player.plane)) {
                npc.becomeAlerted(player.x, player.y);
                this.mode = "fighting";
            }
        } else if (!npc.alerted) {
            this.reset();
            return;
        }
        // She stands where she is and turns to the player.
        this.goal = {
            ...this.home,
            run: false,
            ...(player ? { faceX: player.x - npc.body.x, faceY: player.y - npc.body.y } : {}),
        };
        const canSummon =
            this.mode === "fighting" &&
            npc.combatant.healthFraction <= SUMMON_BELOW &&
            this.growthlings.size + this.pending === 0 &&
            this.sinceSummon >= SUMMON_COOLDOWN &&
            (player?.sincePlayerAttack ?? Infinity) <= ATTACKED_WITHIN;
        this.setAllowed(canSummon);
        if (canSummon && player) {
            // One attack in five: the summon weighs a quarter of the attacks she could make from here.
            const gap = Math.hypot(player.x - npc.body.x, player.y - npc.body.y) - npc.body.radius - player.radius;
            const inReach = this.others.filter((a) => gap >= a.minGap && gap <= a.maxGap);
            const weight = inReach.reduce((sum, a) => sum + a.weight, 0);
            this.summon.weight = (weight * SUMMON_CHANCE) / (1 - SUMMON_CHANCE);
        }
    }

    private setAllowed(summon: boolean): void {
        const allowed = new Set(this.mode === "fighting" ? (summon ? [...this.others, this.summon] : this.others) : []);
        this.npc.attacker.allow = (a) => allowed.has(a);
    }

    special(npc: Npc, attack: NpcAttack, when: "start" | "impact", player: { x: number; y: number; plane: number }): void {
        if (attack.special !== "summon" || when !== "impact") return;
        this.sinceSummon = 0;
        this.world.say?.("Bryophyta calls up her growthlings!");
        // Around her, on the side of the player when there is room.
        const cx = Math.floor(npc.body.x);
        const cy = Math.floor(npc.body.y);
        const ring: [number, number][] = [];
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) ring.push([cx + dx, cy + dy]);
            }
        }
        ring.sort((a, b) => Math.hypot(a[0] - player.x, a[1] - player.y) - Math.hypot(b[0] - player.x, b[1] - player.y));
        const picked = ring.filter(([x, y]) => inChamber(x + 0.5, y + 0.5, npc.plane)).slice(0, GROWTHLINGS * 2);
        // Shuffle the nearer half so they do not always come up in the same places.
        for (let i = picked.length - 1; i > 0; i--) {
            const j = Math.floor(this.world.random() * (i + 1));
            [picked[i], picked[j]] = [picked[j], picked[i]];
        }
        let placed = 0;
        for (const [x, y] of picked) {
            if (placed >= GROWTHLINGS) break;
            placed++;
            this.pending++;
            void this.world.summonGrowthling(x, y, npc.plane).then((g) => {
                this.pending--;
                if (!g || this.mode === "waiting") {
                    if (g) g.gone = true; // the fight was reset meanwhile
                    return;
                }
                this.growthlings.add(g);
                // Growthlings are aggressive [OSRS Wiki: Growthling].
                g.becomeAlerted(player.x, player.y);
            });
        }
    }

    /** Back to the start: full health, waiting for the next player, her growthlings gone. */
    reset(): void {
        const c = this.npc.combatant;
        if (!c.dead) c.health = c.maxHealth;
        this.mode = "waiting";
        this.sinceSummon = Infinity;
        for (const g of this.growthlings) {
            if (!g.combatant.dead) g.gone = true;
        }
        this.growthlings.clear();
        this.setAllowed(false);
    }
}
