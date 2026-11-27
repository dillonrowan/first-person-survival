import { ADJACENT } from "./AttackStyle";
import { extraMove } from "./BossMoves";
import { type Arena, inArena } from "./Callisto";
import { boltTiles, type GroundStrikes, type StrikeTile } from "./GroundStrikes";
import type { CombatContext, Npc, NpcBehaviour } from "./Npc";
import { CLIENT_CYCLE_SECONDS } from "./NpcAnimation";
import type { NpcAttack } from "./NpcAttacks";
import { VETION_GFX } from "./NpcSpells";

/**
 * Vet'ion, and Calvar'ion, his smaller version in the Skeletal Tomb [OSRS Wiki: Vet'ion, Calvar'ion,
 * their Strategies pages and transcripts; the 2023 Wilderness boss rework]. Both fight the same way:
 *
 * - Lightning, from any distance: "Five bolts of lightning strike various tiles across the arena",
 *   one on or next to the player's tile and four at random. Each hits 3x3 tiles, hardest on its
 *   centre, once its tile has glown (GroundStrikes.ts). He swings his sword to call it, but the swing
 *   deals no melee damage.
 * - Now and then, when the player is next to him, a shield bash: shadows mark "two tiles thick on a
 *   side or diagonal, or one tile thick on every side", and a player still on them takes up to 35
 *   (Calvar'ion 26) and is "unable to attack for the next 4.8 seconds".
 * - At half health, in each form, he calls two skeleton hellhounds (greater ones in the second
 *   form). From half health until they come he takes a tenth of the damage ("90% damage
 *   resistance"), and while they live none.
 * - At 0 health in his first form he does not die: he charges lightning that strikes in a circle
 *   around him (safe under him or far enough away) and rises again in his second form (6612,
 *   11994): full health, orange, attacking every 5 ticks instead of 6. Unless he is killed in it
 *   within five minutes, he goes back to his first form "with the same Hitpoints"; hounds already
 *   killed stay killed.
 * - Aggressive: a player in his chamber is attacked at once.
 *
 * The wiki gives no timings beyond the cache's; the values marked [design] are this game's. His
 * second form's max hit is listed as 44 like the first (the infobox's unlabelled 65 is not used).
 *
 * Deferred until the game has them:
 * - Multiplayer: one bolt per player in the chamber (up to seven), and fewer hounds for groups.
 * - Protection prayers: Protect from Melee against the hounds' bites.
 */

/** His sequences (NPC_VETION_*), first form and second, baked as extra clips (npc-attack-overrides extraSeqs). */
export const VETION_SEQ = {
    lightning: [9969, 9970], // ATTACK_MAGIC: the sword raised to the sky
    bash: [9971, 9972], // ATTACK_MELEE: the shield thrust forward
    rise: 9977, // SPAWN_01: up from a crouch
    enrage: [9978, 9979], // ENRAGE: the sword raised, calling the hounds or the lightning circle
    death: [9980, 9981],
} as const;

export type SkeletalLord = {
    name: string;
    /** First form, second form. */
    forms: readonly [number, number];
    /** The hounds each form calls. */
    hounds: readonly [number, number];
    /** His chamber's floor (cache collision; the Skeletal Tomb is a copy of Vet'ion's Rest). */
    arena: Arena;
    /** Shield bash max hit [wiki: Vet'ion 35, Calvar'ion 26]. */
    bashMax: number;
};

export const VETION: SkeletalLord = {
    name: "Vet'ion",
    forms: [6611, 6612],
    hounds: [6613, 6614],
    arena: { minX: 3287, maxX: 3304, minY: 10195, maxY: 10210, plane: 1 },
    bashMax: 35,
};

export const CALVARION: SkeletalLord = {
    name: "Calvar'ion",
    forms: [11993, 11994],
    hounds: [12107, 12108],
    arena: { minX: 1879, maxX: 1896, minY: 11539, maxY: 11554, plane: 1 },
    bashMax: 26,
};

export const SKELETAL_LORDS: readonly SkeletalLord[] = [VETION, CALVARION];

/** Bolts per lightning attack, solo [wiki]. */
export const BOLTS = 5;
/** Seconds from a tile's glow to its bolt: the 60 client cycles of VFX_SPELLIMPACT_VETION_01. */
export const BOLT_SECONDS = 60 * CLIENT_CYCLE_SECONDS;
/** Seconds the shield bash keeps the player from attacking [wiki: 4.8 s]. */
export const BASH_DISARM_SECONDS = 4.8;
/** Health fraction at which each form calls its hounds [wiki: half]. */
export const HOUNDS_AT = 0.5;
/** Hounds per call [wiki: two, solo]. */
export const HOUNDS = 2;
/** Share of damage he takes from half health until his hounds come [wiki: 90% resistance]. */
export const CALLING_DAMAGE = 0.1;
/** Seconds in his second form before he goes back to the first [wiki: five minutes]. */
export const SECOND_FORM_SECONDS = 300;
/** Bash weight against the lightning's 1 when the player is next to him ("occasionally"). [design: 1 in 3] */
const BASH_WEIGHT = 0.5;
/** Chance a bash covers every side rather than the player's. [design] */
const BASH_AROUND_CHANCE = 0.5;
/** Tiles from his middle tile to the centres of the circle's bolts: they cover 2 to 4 tiles out. */
const CIRCLE_RADIUS = 3;

/** What he says [wiki: Transcript:Vet'ion; Calvar'ion's are the same]. In his second form, in capitals. */
export const VETION_LINES = {
    bash: ["Grrrah!", "Take this!", "Too close!", "Back off, mutt!", "Defend yourself!", "Hands off, wretch!", "You're not blocking this one!"],
    hounds: [
        "Time to feast, hounds!",
        "Gah! Hounds! Get them!",
        "I've had enough of this! Hounds!",
        "Hounds! Get rid of these interlopers!",
        "Go forth, my hounds, and destroy them!",
        "Hounds! Dispose of these tresspassers!",
    ],
    houndsKilled: ["Fine! I'll deal with you myself!", "I'll kill you for killing my pets!", "Must I do everything around here?!", "My hounds! I'll make you pay for that!"],
    rebirth: "Now... DO IT AGAIN!!!",
    death: ["Urk! I... failed...", "I'll... be... back...", "Urgh... not... again...", "My lord... I'm... sorry...", "I'll get you... next... time...", "This isn't... the last... of me..."],
} as const;

/** What the fight needs of the rest of the game. */
export type VetionWorld = {
    strikes: GroundStrikes;
    random(): number;
    /** True if the player could stand on the tile. */
    open(x: number, y: number, plane: number): boolean;
    /** Calls up a hound with its south-west corner at a tile; undefined if it cannot stand there. */
    summon(id: number, x: number, y: number, plane: number): Promise<Npc | undefined>;
    /** Turns him into another form (Npcs.transform); undefined if that failed. */
    transform(npc: Npc, id: number): Promise<Npc | undefined>;
    /** Plays a graphic on him, facing his way. */
    playOn(npc: Npc, gfx: number): void;
    /** Plays a graphic on a tile. */
    playAt(gfx: number, x: number, y: number, plane: number): void;
    say(text: string): void;
};

/**
 * One fight per boss, shared by both forms: the NPC of each form is attached to it as it appears
 * (Npcs.behaviourFor), so the hounds and the five minutes carry over.
 */
export class VetionFight implements NpcBehaviour {
    /** The NPC of the current form. */
    npc: Npc | undefined;
    /** 0 first form, 1 second. */
    form: 0 | 1 = 0;
    fighting = false;
    /** The hounds still alive. */
    readonly hounds = new Set<Npc>();
    /** Each form calls its hounds once a fight. */
    readonly houndsCalled: [boolean, boolean] = [false, false];
    /** Seconds in the second form. */
    secondFormFor = 0;
    /** Half health was passed: the hounds are on their way. */
    private calling = false;
    /** Hounds being summoned whose models are still loading. */
    private pendingHounds = 0;
    /** Between forms: his first form's 0 health, until the second has risen. */
    private changing = false;
    /** Npcs.transform is under way: the next NPC attached is a form of this fight, not a new spawn. */
    private transforming = false;
    /** His first form fell: the charge that ends in the circle of bolts is still to start. */
    private rebirthDue = false;
    private deathSaid = false;
    private lightning!: NpcAttack;
    private bash!: NpcAttack;
    private callHounds!: NpcAttack;
    private rebirth!: NpcAttack;
    private rise!: NpcAttack;

    constructor(
        readonly boss: SkeletalLord,
        private readonly world: VetionWorld,
    ) {}

    /** Takes on the NPC of a form; a fresh spawn starts the fight over. */
    attach(npc: Npc): this {
        this.npc = npc;
        this.form = npc.appearance.id === this.boss.forms[1] ? 1 : 0;
        if (!this.transforming) {
            this.changing = false;
            this.end(false);
        }
        npc.combatant.steadfast = true;
        const f = this.form;
        // The cache's attack speed (6 ticks, 5 in the second form) sets the wait between them.
        const cooldownScale = npc.combatStats.speedTicks / 4;
        const base = { minGap: -Infinity, cooldownScale };
        this.lightning = extraMove(npc, VETION_SEQ.lightning[f], { ...base, id: "lightning", style: "magic", special: "lightning" });
        this.bash = {
            ...extraMove(npc, VETION_SEQ.bash[f], { ...base, id: "bash", style: "melee", special: "bash" }),
            maxGap: ADJACENT,
            weight: BASH_WEIGHT,
        };
        this.callHounds = { ...extraMove(npc, VETION_SEQ.enrage[f], { ...base, id: "hounds", style: "magic", special: "hounds" }), weight: 0 };
        // The circle lands as the charge ends, and he changes then.
        this.rebirth = { ...extraMove(npc, VETION_SEQ.enrage[0], { ...base, id: "rebirth", style: "magic", special: "rebirth" }, 1), weight: 0 };
        this.rise = { ...extraMove(npc, VETION_SEQ.rise, { ...base, id: "rise", style: "magic" }), hitTimes: [], hitPow: [], weight: 0 };
        npc.attacker.extend([this.lightning, this.bash, this.callHounds, this.rebirth, this.rise]);
        const own = new Set([this.lightning, this.bash]);
        npc.attacker.allow = (a) => own.has(a);
        return this;
    }

    get deathSeq(): number {
        return VETION_SEQ.death[this.form];
    }

    /** None while his hounds live or he changes form, a tenth while they come, else all. */
    get damageTaken(): number {
        if (this.changing || this.hounds.size + this.pendingHounds > 0) return 0;
        return this.calling ? CALLING_DAMAGE : 1;
    }

    update(npc: Npc, dt: number, ctx: CombatContext): void {
        if (npc !== this.npc) return; // a form he has left
        for (const h of this.hounds) {
            if (h.combatant.dead || h.gone) {
                this.hounds.delete(h);
                if (this.hounds.size + this.pendingHounds === 0 && !npc.combatant.dead) {
                    this.shout(this.pick(VETION_LINES.houndsKilled));
                }
            }
        }
        const c = npc.combatant;
        const player = ctx.player;
        if (c.dead && (this.form === 1 || !this.fighting)) {
            if (this.fighting && this.form === 1 && !this.deathSaid) {
                this.deathSaid = true;
                this.say(this.pick(VETION_LINES.death));
            }
            if (this.fighting) this.end(false);
            return;
        }
        const inside = !!player && inArena(this.boss.arena, player.x, player.y, player.plane);
        if (!this.fighting) {
            if (inside) {
                npc.becomeAlerted(player.x, player.y);
                this.fighting = true;
            }
            return;
        }
        if (!inside || !npc.alerted) {
            // The player got away: he goes back to his first form, healed, his hounds gone.
            this.end(true);
            return;
        }
        if (c.dead || this.changing) {
            // His first form at 0: it holds on until the second rises.
            c.health = Math.max(c.health, 1);
            if (!this.changing) {
                this.changing = true;
                this.rebirthDue = true;
                this.calling = false;
                npc.attacker.interrupt();
            }
            if (this.rebirthDue && npc.attacker.force(this.rebirth)) this.rebirthDue = false;
            return;
        }
        if (this.form === 1) {
            this.secondFormFor += dt;
            if (this.secondFormFor >= SECOND_FORM_SECONDS && !npc.attacker.current) {
                this.changeForm(npc, 0, c.health);
                return;
            }
        }
        if (!this.houndsCalled[this.form] && c.healthFraction <= HOUNDS_AT) {
            this.houndsCalled[this.form] = true;
            this.calling = true;
        }
        if (this.calling && this.pendingHounds === 0) {
            npc.attacker.force(this.callHounds);
        }
    }

    special(npc: Npc, attack: NpcAttack, when: "start" | "impact", player: { x: number; y: number; plane: number }): void {
        const { plane } = this.boss.arena;
        const middle = { x: Math.floor(npc.body.x), y: Math.floor(npc.body.y) };
        if (attack.special === "lightning" && when === "start") {
            this.world.playOn(npc, VETION_GFX.cast[this.form]);
            const aim = { x: Math.floor(player.x), y: Math.floor(player.y) };
            for (const centre of lightningCentres(this.boss.arena, aim, this.world.random, (x, y) => this.world.open(x, y, plane))) {
                this.bolt(centre, npc.combatStats.maxHit.magic ?? 0, VETION_GFX.bolt[this.form]);
            }
        } else if (attack.special === "bash" && when === "start") {
            this.shout(this.pick(VETION_LINES.bash));
            this.world.playOn(npc, VETION_GFX.bash);
            const size = Math.max(1, npc.appearance.size);
            const sw = { x: middle.x - Math.floor(size / 2), y: middle.y - Math.floor(size / 2) };
            const around = this.world.random() < BASH_AROUND_CHANCE;
            const tiles = bashTiles(sw, size, player.x - npc.body.x, player.y - npc.body.y, around).filter((t) =>
                inArena(this.boss.arena, t.x, t.y, plane),
            );
            this.world.strikes.add({ kind: "bash", tiles, plane, max: this.boss.bashMax }, attack.hitTimes[0] ?? 0);
        } else if (attack.special === "hounds") {
            if (when === "start") this.shout(this.pick(VETION_LINES.hounds));
            else this.summonHounds(player);
        } else if (attack.special === "rebirth") {
            if (when === "start") {
                this.shout(VETION_LINES.rebirth);
                for (const centre of circleCentres(middle)) {
                    this.bolt(centre, npc.combatStats.maxHit.magic ?? 0, VETION_GFX.bolt[1]);
                }
            } else {
                this.changeForm(npc, 1);
            }
        }
    }

    private bolt(centre: StrikeTile, max: number, gfx: number): void {
        const { plane } = this.boss.arena;
        this.world.strikes.add({ kind: "lightning", tiles: boltTiles(centre), centre, plane, max }, BOLT_SECONDS);
        this.world.playAt(gfx, centre.x, centre.y, plane);
    }

    /** Becomes the other form; `health` is kept (going back to the first), else it starts full. */
    private changeForm(npc: Npc, form: 0 | 1, health?: number): void {
        this.changing = true;
        this.transforming = true;
        void this.world.transform(npc, this.boss.forms[form]).then((next) => {
            this.changing = false;
            this.transforming = false;
            if (!next) {
                // No model for the other form: he carries on as he is, healed.
                npc.combatant.health = npc.combatant.maxHealth;
                return;
            }
            this.secondFormFor = 0;
            if (!this.fighting && form === 1) {
                // The player left while he changed: back to his first form for the next one.
                this.changeForm(next, 0);
                return;
            }
            if (health !== undefined) next.combatant.health = Math.min(health, next.combatant.maxHealth);
            const p = npc.alerted ? { x: npc.body.x + npc.forward.x, y: npc.body.y + npc.forward.y } : undefined;
            if (p) next.becomeAlerted(p.x, p.y);
            if (form === 1) next.attacker.force(this.rise);
        });
    }

    private summonHounds(player: { x: number; y: number; plane: number }): void {
        const { arena } = this.boss;
        const id = this.boss.hounds[this.form];
        const spots = houndSpots(arena, player, this.world.random, (x, y) => this.world.open(x, y, arena.plane));
        this.pendingHounds = HOUNDS;
        const next = (placed: number, i: number): void => {
            if (placed >= HOUNDS || i >= spots.length || !this.fighting) {
                this.pendingHounds = 0;
                this.calling = false;
                return;
            }
            void this.world.summon(id, spots[i].x, spots[i].y, arena.plane).then((hound) => {
                if (hound && !this.fighting) {
                    hound.gone = true; // the fight ended meanwhile
                    hound = undefined;
                }
                if (hound) {
                    this.hounds.add(hound);
                    this.pendingHounds--;
                    hound.becomeAlerted(player.x, player.y);
                }
                next(placed + (hound ? 1 : 0), i + 1);
            });
        };
        next(0, 0);
    }

    /** The fight is over; `heal` puts him back in his first form at full health (the player left). */
    private end(heal: boolean): void {
        this.fighting = false;
        this.calling = false;
        this.pendingHounds = 0;
        this.houndsCalled[0] = this.houndsCalled[1] = false;
        this.secondFormFor = 0;
        this.deathSaid = false;
        this.rebirthDue = false;
        for (const h of this.hounds) h.gone = true;
        this.hounds.clear();
        this.world.strikes.clear();
        const npc = this.npc;
        if (!heal || !npc || npc.combatant.dead) return;
        if (this.transforming) return; // the change finishes the reset (changeForm)
        this.changing = false;
        if (this.form === 1) this.changeForm(npc, 0);
        else npc.combatant.health = npc.combatant.maxHealth;
    }

    private pick(lines: readonly string[]): string {
        return lines[Math.floor(this.world.random() * lines.length) % lines.length];
    }

    /** A line of his, in capitals in his second form. */
    private shout(line: string): void {
        this.say(this.form === 1 ? line.toUpperCase() : line);
    }

    private say(line: string): void {
        this.world.say(`${this.boss.name}: ${line}`);
    }
}

/**
 * The centres of a lightning attack's bolts: one on the player's tile or a tile next to it, the
 * others on random open tiles of the chamber, all different.
 */
export function lightningCentres(
    arena: Arena,
    player: StrikeTile,
    random: () => number,
    open: (x: number, y: number) => boolean,
): StrikeTile[] {
    const step = () => Math.floor(random() * 3) - 1;
    const first = { x: player.x + step(), y: player.y + step() };
    const centres = [inArena(arena, first.x, first.y, arena.plane) ? first : player];
    for (let tries = 0; centres.length < BOLTS && tries < BOLTS * 20; tries++) {
        const x = arena.minX + Math.floor(random() * (arena.maxX - arena.minX));
        const y = arena.minY + Math.floor(random() * (arena.maxY - arena.minY));
        if (open(x, y) && !centres.some((c) => c.x === x && c.y === y)) centres.push({ x, y });
    }
    return centres;
}

/**
 * The tiles a shield bash covers, around a body of `size` tiles with its south-west corner at `sw`:
 * `around`, one tile thick on every side and under him; else two tiles thick on the side or
 * diagonal (dx, dy) points to (the player's).
 */
export function bashTiles(sw: StrikeTile, size: number, dx: number, dy: number, around: boolean): StrikeTile[] {
    const tiles: StrikeTile[] = [];
    if (around) {
        for (let x = sw.x - 1; x <= sw.x + size; x++) {
            for (let y = sw.y - 1; y <= sw.y + size; y++) tiles.push({ x, y });
        }
        return tiles;
    }
    const d = Math.hypot(dx, dy) || 1;
    // Within 22.5 degrees of an axis, that side; else the diagonal.
    const sx = Math.abs(dx / d) > 0.383 ? Math.sign(dx) : 0;
    const sy = Math.abs(dy / d) > 0.383 ? Math.sign(dy) : 0;
    const span = (s: number, lo: number): number[] =>
        s > 0 ? [lo + size, lo + size + 1] : s < 0 ? [lo - 2, lo - 1] : Array.from({ length: size }, (_, i) => lo + i);
    for (const x of span(sx, sw.x)) {
        for (const y of span(sy, sw.y)) tiles.push({ x, y });
    }
    return tiles;
}

/** The centres of the circle of bolts around his middle tile when his first form falls. */
export function circleCentres(middle: StrikeTile): StrikeTile[] {
    const r = CIRCLE_RADIUS;
    const centres: StrikeTile[] = [];
    for (const dx of [-r, 0, r]) {
        for (const dy of [-r, 0, r]) {
            if (dx !== 0 || dy !== 0) centres.push({ x: middle.x + dx, y: middle.y + dy });
        }
    }
    return centres;
}

/** South-west corners for the 2x2 hounds: open spots 2 to 3 tiles from the player, shuffled. */
export function houndSpots(
    arena: Arena,
    player: { x: number; y: number },
    random: () => number,
    open: (x: number, y: number) => boolean,
): StrikeTile[] {
    const px = Math.floor(player.x);
    const py = Math.floor(player.y);
    const spots: StrikeTile[] = [];
    for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -3; dy <= 3; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) < 2) continue;
            const x = px + dx;
            const y = py + dy;
            const fits = [0, 1].every((i) => [0, 1].every((j) => inArena(arena, x + i, y + j, arena.plane) && open(x + i, y + j)));
            if (fits) spots.push({ x, y });
        }
    }
    for (let i = spots.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    return spots;
}
