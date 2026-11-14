import type { Body, BodySource } from "../physics/Bodies";
import type { FlagsAt } from "../physics/TileColliders";
import { Combatant } from "./Combatant";
import { DamageResult, applyDamage, applyHit, hitboxMultiplier } from "./Damage";
import { pushDirection, raySign, traceRay } from "./SwingRay";
import { rayFor, timelineFor } from "./moves";
import { KickController, traceKick } from "./Kick";
import { MeleeController, MeleeInput } from "./MeleeController";
import type { MoveDef } from "./moves";
import { tuning } from "./tuning";
import { WEAPONS, WeaponDef } from "./weapons";
import type { AttackStyle } from "../npc/AttackStyle";
import type { ShieldDef } from "./Shields";
import { SHIELDS } from "./Shields";
import type { DefenceType, NpcCombatStats } from "../world/NpcFormat";
import { CombatGear, NO_GEAR } from "./Equipment";
import { MAGIC_STYLE, MELEE_STYLES, XpGains, stylesFor, xpForDamage } from "./CombatStyles";
import type { CombatStyleDef } from "./CombatStyles";
import {
    PlayerAttack,
    TICK_SECONDS,
    attackRate,
    clamp,
    fallbackCombatStats,
    hitChance,
    npcAttackRoll,
    npcDefenceRoll,
    npcMaxHit,
    playerDefenceRoll,
    playerMagicAttack,
    playerMeleeAttack,
    playerRangedAttack,
    stochasticRound,
} from "./Osrs";
import { LevelUp, PlayerSkills } from "./Skills";
import { SPELL_TICKS, SpellDef, Spellbook } from "./Spells";
import type { XpLedger } from "./XpLedger";
import { NPC_POISON_CHANCE, WEAPON_POISON_CHANCE, weaponPoisonSeverity } from "./Poison";
import { isRepeaterCrossbow } from "../world/CacheWeaponFormat";
import { Arrow, BowController, ObstacleTop, launchArrow, rangedProfile, stepArrows } from "./Bow";
import { CrossbowController } from "./Crossbow";
import type { HitEvent } from "./moves";

/** layer_bowattack_shoot (spec 16.4): HitPow 1.5, impact along the arrow, +2 adrenaline. */
const ARROW_HIT: HitEvent = {
    hitPow: tuning.bowHitPow,
    impact: { x: 1, y: 0, z: 0 },
    adrenaline: tuning.bowAdrenaline,
    push: false,
    alwaysPush: 0,
    breaksParry: false,
    stunChance: 0,
    fallChance: 0,
};
const ARROW_MOVE: MoveDef = { id: "arrow", kind: "quick", hits: [ARROW_HIT], lunge: 0 };

/** Something the player can hit: an NPC, as far as combat is concerned. */
export interface CombatTarget {
    readonly combatant: Combatant;
    readonly attackable: boolean;
    /** True once the target is fighting; hits on targets that are not get the unaware bonus. */
    readonly inCombat: boolean;
    /** Stamina a kick on this target costs; NPCs cost stamina_kick_npc (spec 7). */
    readonly kickCost?: number;
    /** Levels, bonuses and max hits; targets without them (props) take the old damage formula. */
    readonly combatStats?: NpcCombatStats;
    /** The XP the player is owed for the damage dealt, paid out when the target dies. */
    readonly xpLedger?: XpLedger;
    /**
     * A hit driving the target along (dirX, dirY). `hitPow` is the move's HitPow: physics props
     * scale their push by it (spec 19), NPCs their shove and how far a killing blow throws them.
     * `height` is where the hit struck the body, 0 (feet) to 1 (top).
     */
    takeHit(dirX: number, dirY: number, push: number, fromX: number, fromY: number, hitPow?: number, height?: number): void;
    /** A kick: the target may dodge it. */
    kick(dirX: number, dirY: number, fromX: number, fromY: number): "dodged" | "hit";
}

/** The player state combat reads and pushes. */
export type CombatPlayer = {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    plane: number;
    eyeHeight: number;
    sprinting: boolean;
    grounded: boolean;
    verticalSpeed: number;
    stamina: { value: number; spend(amount: number): boolean };
    applyImpulse(x: number, y: number, z?: number): void;
};

export type CombatInput = {
    attackDown: boolean;
    /** True in the update the attack button went down, even if it already came up again. */
    attackPressed?: boolean;
    /** Right mouse: parry stance (spec 6, 16.8). */
    blockDown?: boolean;
    /** True in the update the kick key went down. */
    kickPressed?: boolean;
    /** True in the update a cast was asked for (G, or right click with a staff or wand). */
    castPressed?: boolean;
    forward: number;
    strafe: number;
};

export type HitReport = {
    target: CombatTarget;
    result: DamageResult;
    move: MoveDef;
    /** Id of the spell that landed (src/combat/Spells.ts), for its impact or splash graphic. */
    spell?: string;
};
export type KickReport = { target?: CombatTarget; outcome: "dodged" | "hit" | "miss" };
/** An NPC strike that reached the player. */
export type StrikeReport = {
    outcome: "parried" | "hit" | "miss";
    damage: number;
    punch: number;
    style: AttackStyle;
    /** A shield cut the damage (dragonfire against an anti-dragon shield). */
    shielded: boolean;
    /** The strike was rolled and missed: 0 damage, but the player still flinches. */
    missed: boolean;
    /** The strike poisoned the player. */
    poisoned?: boolean;
};

/** What the player needs to know about an incoming NPC strike. */
export type IncomingStrike = {
    fromX: number;
    fromY: number;
    /** Gap between the bodies' edges, tiles. */
    gap: number;
    range: number;
    hitPow: number;
    push: boolean;
    breaksParry: boolean;
    style: AttackStyle;
    /** An arrow, spell or breath tick that already reached the player: no gap or cone test. */
    direct?: boolean;
    /** The attacker levels, bonuses and max hits; a level 1 NPC without any if absent. */
    attacker?: NpcCombatStats;
    /** 0..1: how much of the NPC attack interval had passed since its previous attack. */
    rate?: number;
    /** Share of the style max hit this impact carries (a breath splits its hit over its ticks). */
    share?: number;
};

/**
 * The player's side of melee: owns the weapon and melee controller, sweeps swings against NPCs
 * and applies damage, push, lunge and adrenaline.
 */
export class PlayerCombat {
    readonly combatant: Combatant;
    readonly melee: MeleeController;
    readonly kick = new KickController();
    weaponIndex = 0;
    /** Called for every hit, for hit markers and sounds. */
    onHit?: (report: HitReport) => void;
    /** Called when a kick lands, misses or is dodged. */
    onKick?: (report: KickReport) => void;
    /** Called for every NPC strike that reaches the player. */
    onStruck?: (report: StrikeReport) => void;
    /** True while holding the parry stance. */
    blocking = false;
    /** Seconds since the player last attacked (NPCs go berserk after 2 s, spec 10.1). */
    sinceAttack = Infinity;
    /** Called when a spell is cast, and when one cannot be (level or runes). */
    onCast?: (spell: SpellDef) => void;
    onCastFailed?: (message: string) => void;
    /** XP was granted straight away (a spell that did damage), with any levels it gained. */
    onXp?: (gains: XpGains, levelUps: LevelUp[]) => void;
    /** Index into `styles` of the attack style in use. */
    styleIndex = 0;
    private shieldOverride: ShieldDef | undefined = undefined;
    private time = 0;
    private lastAttackAt = -Infinity;
    private castCooldown = 0;
    private regenTimer = 0;
    private swingAttack: PlayerAttack | undefined = undefined;

    /** The shield worn (the shield slot item) or set directly; tests and dev tools set it. */
    get shield(): ShieldDef | undefined {
        if (this.shieldOverride) {
            return this.shieldOverride;
        }
        const id = this.shieldItemId();
        return id === undefined ? undefined : SHIELDS.find((s) => s.cacheId === id);
    }

    set shield(shield: ShieldDef | undefined) {
        this.shieldOverride = shield;
    }

    readonly bow = new BowController();
    readonly crossbow = new CrossbowController();
    /** Arrows in flight or stuck in the world. */
    readonly arrows: Arrow[] = [];
    /** Ground height for arrows; without it they only stop at walls. */
    groundHeight?: (plane: number, x: number, y: number) => number;
    /** How tall the walls and fences are; without it arrows treat every wall as reaching the sky. */
    obstacleTop?: ObstacleTop;

    private readonly hitThisSwing: Set<Body<CombatTarget>>[] = [];
    private clock = 0;

    constructor(
        private readonly bodies: BodySource<CombatTarget>,
        private readonly flagsAt: FlagsAt,
        private readonly random: () => number = Math.random,
        readonly skills: PlayerSkills = new PlayerSkills(),
        readonly spellbook: Spellbook = new Spellbook(),
        private readonly gear: CombatGear = NO_GEAR,
        private readonly shieldItemId: () => number | undefined = () => undefined,
    ) {
        this.combatant = new Combatant(skills.level("hitpoints"));
        this.melee = new MeleeController(WEAPONS[0]);
    }

    /** The attack styles of the weapon held, and the one in use. */
    get styles(): readonly CombatStyleDef[] {
        return stylesFor(this.weapon.family);
    }

    get style(): CombatStyleDef {
        return this.styles[this.styleIndex % this.styles.length] ?? MELEE_STYLES[0];
    }

    cycleStyle(): void {
        this.styleIndex = (this.styleIndex + 1) % this.styles.length;
    }

    /** A staff or wand is held: right click casts instead of parrying. */
    get holdsCaster(): boolean {
        return this.weapon.family === "staff";
    }

    private get equipmentBonuses() {
        return this.gear.bonuses();
    }

    /** Max health follows the Hitpoints level; a level gained also heals by the same amount. */
    syncMaxHealth(): void {
        const max = this.skills.level("hitpoints");
        if (max > this.combatant.maxHealth) {
            this.combatant.health += max - this.combatant.maxHealth;
        }
        this.combatant.maxHealth = max;
    }

    /** One health per minute [OSRS]. */
    private regen(dt: number): void {
        const c = this.combatant;
        if (c.dead || c.health >= c.maxHealth) {
            this.regenTimer = 0;
            return;
        }
        this.regenTimer += dt;
        if (this.regenTimer >= tuning.playerRegenInterval) {
            this.regenTimer -= tuning.playerRegenInterval;
            c.health = Math.min(c.maxHealth, c.health + 1);
        }
    }

    /**
     * Rolls an attack of the player when it starts: attack roll, max hit and how much of the
     * weapon OSRS interval passed since the previous attack (melee, ranged and magic share one
     * timer, as in OSRS), so quick swings add up to the same damage per second as OSRS.
     */
    private snapshot(kind: "melee" | "ranged" | "magic", spell?: SpellDef): PlayerAttack {
        const style = kind === "magic" ? MAGIC_STYLE : this.style;
        const bonuses = this.equipmentBonuses;
        const ticks = kind === "magic" ? SPELL_TICKS : this.gear.weaponSpeedTicks() - (this.style.rapid ? 1 : 0);
        const rate = attackRate(this.time - this.lastAttackAt, ticks * TICK_SECONDS);
        this.lastAttackAt = this.time;
        const rolls =
            kind === "melee"
                ? playerMeleeAttack(this.skills.level("melee"), style, bonuses)
                : kind === "ranged"
                  ? playerRangedAttack(this.skills.level("ranged"), style, bonuses, this.weapon.family === "crossbow")
                  : playerMagicAttack(this.skills.level("magic"), bonuses, spell ?? this.spellbook.equipped);
        const poisonSeverity =
            kind === "melee"
                ? weaponPoisonSeverity(this.gear.weaponName(), "melee")
                : kind === "ranged"
                  ? weaponPoisonSeverity(this.gear.ammoName(), "ranged")
                  : 0;
        return {
            kind,
            ...rolls,
            rate,
            style,
            ...(spell ? { spellXp: spell.xp } : {}),
            ...(poisonSeverity > 0
                ? { poisonSeverity, poisonChance: kind === "melee" ? WEAPON_POISON_CHANCE.melee : WEAPON_POISON_CHANCE.ranged }
                : {}),
        };
    }

    /**
     * Resolves one player attack against a target with stats: the accuracy roll (a miss deals 0 but
     * the target still flinches), a damage roll from 0 to the max hit (a hit is at least 1), then the
     * swing rate and the move, hit zone and awareness factor (`extra`). The damage dealt goes into
     * the target XP ledger. The random calls are in that order.
     */
    private resolveOsrsHit(target: CombatTarget, attack: PlayerAttack, extra: number, hit: HitEvent): DamageResult {
        const stats = target.combatStats!;
        const success = this.random() < hitChance(attack.attackRoll, npcDefenceRoll(stats, attack.defenceType));
        const base = success ? Math.max(1, Math.floor(this.random() * (attack.maxHit + 1))) : 0;
        const multiplier = clamp(attack.rate * extra, 0, tuning.osrsMaxDamageMultiplier);
        const amount = success ? stochasticRound(base * multiplier, this.random) : 0;
        const before = target.combatant.health;
        const result = applyDamage(target.combatant, amount, hit, this.weapon.stunMultiplier, this.random, {
            minReaction: "flinch",
            missed: !success,
        });
        if (success && base === attack.maxHit && amount > 0) {
            result.maxHit = true;
        }
        // Weapon poison: only a successful hit that deals damage, and not on immune monsters.
        if (
            amount > 0 &&
            attack.poisonSeverity &&
            !stats.poisonImmune &&
            !target.combatant.dead &&
            this.random() < (attack.poisonChance ?? 0) &&
            target.combatant.poison.apply(attack.poisonSeverity)
        ) {
            result.poisoned = true;
        }
        const dealt = Math.min(amount, before);
        if (attack.kind === "magic") {
            // Magic XP comes from the cast as soon as the spell does damage; a splash gives none.
            if (dealt > 0) {
                const gains = xpForDamage(attack.style, dealt, attack.spellXp);
                this.onXp?.(gains, this.skills.addXp(gains));
            }
        } else {
            // Melee and ranged XP is banked on the target and paid when it dies, for the damage dealt.
            target.xpLedger?.add(xpForDamage(attack.style, dealt, attack.spellXp));
        }
        return result;
    }

    /** Casts the equipped spell as a projectile along the view, if the level and runes allow. */
    private tryCast(player: CombatPlayer, input: CombatInput): void {
        if (
            !input.castPressed ||
            this.castCooldown > 0 ||
            this.combatant.incapacitated ||
            this.melee.busy ||
            this.kick.active ||
            this.bow.state === "shooting" ||
            this.crossbow.state === "recoil"
        ) {
            return;
        }
        const spell = this.spellbook.castable(this.skills.level("magic"));
        if (!spell) {
            this.onCastFailed?.("You need a higher Magic level to cast that spell.");
            return;
        }
        if (!this.gear.hasRunes(spell.runes)) {
            this.onCastFailed?.("You do not have enough runes to cast this spell.");
            return;
        }
        this.gear.useRunes(spell.runes);
        this.melee.cancel();
        this.bow.cancel();
        const cast = launchArrow(
            { x: player.x, y: player.y, z: player.z + player.eyeHeight, plane: player.plane },
            player.yaw,
            player.pitch,
            { speed: tuning.spellSpeed, gravity: 0 },
        );
        cast.spell = { color: spell.color, id: spell.id };
        cast.attack = this.snapshot("magic", spell);
        this.arrows.push(cast);
        this.castCooldown = tuning.spellCastCooldown;
        this.sinceAttack = 0;
        this.onCast?.(spell);
    }

    /** The weapon arrows and bolts hit with: the held bow or crossbow, else the plain bow. */
    private get bowWeapon(): WeaponDef {
        return this.ranged ? this.weapon : WEAPONS.find((w) => w.family === "bow")!;
    }

    /** A bow or crossbow is held: no melee, no parry. */
    get ranged(): boolean {
        return this.weapon.family === "bow" || this.weapon.family === "crossbow";
    }

    get weapon(): WeaponDef {
        return this.melee.weapon;
    }

    /** A shield protects only with a free off hand: not with a bow, which takes both. */
    get shieldActive(): boolean {
        return !!this.shield && this.weapon.family !== "bow";
    }

    /** Cycles weapons by `step` (mouse wheel). Drops any swing in progress. */
    switchWeapon(step: number): void {
        if (step === 0) {
            return;
        }
        this.weaponIndex = (((this.weaponIndex + Math.sign(step)) % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
        this.melee.weapon = WEAPONS[this.weaponIndex];
        this.styleIndex = 0;
        this.melee.cancel();
        this.bow.cancel();
        this.bow.profile = rangedProfile(this.weapon);
    }

    equipWeapon(weapon: WeaponDef): void {
        const index = WEAPONS.indexOf(weapon);
        if (index >= 0) {
            this.weaponIndex = index;
        }
        this.melee.weapon = weapon;
        this.styleIndex = 0;
        this.melee.cancel();
        this.bow.cancel();
        this.bow.profile = rangedProfile(weapon);
    }

    /**
     * An NPC strike's impact (spec 16.5, 16.8). It lands if the player is within its range in front
     * of the attacker (`inCone`); a parry stance facing the attacker inside the weapon's parry cone
     * stops it unless it breaks parries. Then OSRS decides: the attacker's attack roll against the
     * player's defence roll for the style (a miss deals 0 but still shoves and flinches), a damage
     * roll from 0 to the attacker's max hit for the style, scaled by how much of its attack
     * interval has passed. The anti-dragon shield cuts the max hit of dragonfire. The hit pushes the
     * player 250 u/s away from the attacker.
     */
    receiveStrike(player: CombatPlayer, strike: IncomingStrike, inCone: boolean): StrikeReport {
        const none = { damage: 0, punch: 0, style: strike.style, shielded: false, missed: false };
        if (this.combatant.dead || (!strike.direct && (strike.gap > strike.range || !inCone))) {
            return { outcome: "miss", ...none };
        }
        const dx = player.x - strike.fromX;
        const dy = player.y - strike.fromY;
        const d = Math.hypot(dx, dy) || 1;
        // Parry angle test (spec 6): the attack must come from the front within acos(parry_cos).
        const facing = (-Math.sin(player.yaw) * -dx + Math.cos(player.yaw) * -dy) / d;
        // Only a melee blow can be parried: arrows, spells and breath fly past a raised weapon.
        if (strike.style === "melee" && this.blocking && !strike.breaksParry && facing >= this.weapon.parryCos) {
            const report: StrikeReport = { ...none, outcome: "parried", punch: tuning.punchParrying };
            this.onStruck?.(report);
            return report;
        }
        const npc = strike.attacker ?? fallbackCombatStats(1);
        // Breath is rolled as magic, against the player's magic defence.
        const accuracy: "melee" | "ranged" | "magic" =
            strike.style === "melee" || strike.style === "ranged" ? strike.style : "magic";
        const defenceType: DefenceType =
            accuracy === "melee" ? npc.meleeType : accuracy === "ranged" ? "standard" : "magic";
        const chance = hitChance(
            npcAttackRoll(npc, accuracy),
            playerDefenceRoll(
                this.skills.level("defence"),
                this.skills.level("magic"),
                this.equipmentBonuses,
                defenceType,
                this.style.defence,
            ),
        );
        const success = this.random() < chance;
        const shielded = strike.style === "dragonfire" && this.shieldActive;
        let max = Math.ceil(npcMaxHit(npc, strike.style) * (strike.share ?? 1));
        if (shielded) {
            max = Math.floor(max * this.shield!.dragonfireFactor);
        }
        const base = success ? Math.floor(this.random() * (max + 1)) : 0;
        const damage = success ? stochasticRound(base * clamp(strike.rate ?? 1, 0, 1), this.random) : 0;
        this.combatant.hurt(damage, "flinch");
        // A poisonous monster can poison with any strike that reaches the player, hit or miss [wiki];
        // breath does not poison.
        const severity = npc.poisonSeverity ?? 0;
        const poisoned =
            severity > 0 &&
            (strike.style === "melee" || strike.style === "ranged" || strike.style === "magic") &&
            this.random() < NPC_POISON_CHANCE &&
            this.combatant.poison.apply(severity);
        // A melee blow shoves hard, an arrow or spell a little, breath not at all.
        const push =
            strike.style === "melee"
                ? tuning.playerPushOnHit
                : strike.style === "ranged" || strike.style === "magic"
                  ? tuning.playerPushOnHit * tuning.npcProjectilePush
                  : 0;
        if (push > 0) {
            player.applyImpulse((dx / d) * push, (dy / d) * push);
        }
        if (this.combatant.reaction !== "flinch") {
            this.melee.cancel();
        }
        const report: StrikeReport = {
            outcome: "hit",
            damage,
            punch: tuning.punch,
            style: strike.style,
            shielded,
            missed: !success,
            ...(poisoned ? { poisoned: true } : {}),
        };
        this.onStruck?.(report);
        return report;
    }

    update(dt: number, player: CombatPlayer, input: CombatInput): HitReport[] {
        // Read every update so it can be switched live (window.game.tuning).
        this.combatant.unlimitedHealth = tuning.playerUnlimitedHealth;
        this.combatant.update(dt);
        this.sinceAttack += dt;
        this.time += dt;
        this.castCooldown = Math.max(0, this.castCooldown - dt);
        this.regen(dt);
        // Arrows and bolts come from the ammo slot.
        this.bow.arrows = this.gear.ammoCount("arrow");
        this.crossbow.bolts = this.gear.ammoCount("bolt");
        const reports: HitReport[] = [];
        if (this.combatant.dead) {
            this.melee.cancel();
            this.kick.cancel();
            this.blocking = false;
            return reports;
        }
        this.tryCast(player, input);
        // Parry stance: only between swings, and never with a bow or a staff or wand (they cast).
        this.blocking =
            !!input.blockDown && !this.melee.busy && !this.kick.active && !this.ranged && !this.holdsCaster;
        if (this.blocking) {
            this.melee.cancel();
            return reports;
        }
        if (this.melee.busy || this.kick.active || this.bow.state === "shooting" || this.crossbow.state === "recoil") {
            this.sinceAttack = 0;
        }
        this.updateArrows(dt, player);
        if (this.weapon.family === "crossbow") {
            this.melee.cancel();
            this.bow.cancel();
            // A repeater (Karil's) shoots from its magazine; any other crossbow loads bolt by bolt.
            this.crossbow.setMagazine(isRepeaterCrossbow(this.weapon.name) ? tuning.repeaterMagazine : 0);
            if (input.kickPressed && player.grounded && this.crossbow.state !== "recoil") {
                this.kick.tryStart(player.stamina.value, player.pitch);
            }
            if (this.kick.active) {
                if (this.kick.update(dt)) {
                    this.resolveKick(player);
                }
                return reports;
            }
            // Right mouse, the melee block, zooms ranged weapons.
            const aimDown = !!input.blockDown;
            if (this.crossbow.update(dt, { attackDown: input.attackDown && !this.combatant.incapacitated, aimDown })) {
                const bolt = launchArrow(
                    { x: player.x, y: player.y, z: player.z + player.eyeHeight, plane: player.plane },
                    player.yaw,
                    player.pitch,
                    rangedProfile(this.weapon),
                );
                bolt.bolt = true;
                bolt.attack = this.snapshot("ranged");
                this.gear.useAmmo();
                this.arrows.push(bolt);
            }
            return reports;
        }
        // Not held: the next time it is, the crossbow starts with a reload.
        this.crossbow.reset();
        if (this.weapon.family === "bow") {
            this.melee.cancel();
            // The bow's kick (layer_bow_kick_*) works like the melee kick (spec 7).
            if (input.kickPressed && player.grounded && this.bow.state === "idle") {
                this.kick.tryStart(player.stamina.value, player.pitch);
            }
            if (this.kick.active) {
                if (this.kick.update(dt)) {
                    this.resolveKick(player);
                }
                return reports;
            }
            const aimDown = !!input.blockDown;
            if (this.bow.update(dt, { attackDown: input.attackDown && !this.combatant.incapacitated, aimDown })) {
                const [swayYaw, swayPitch] = this.bow.sway(this.clock);
                const shot = launchArrow(
                    { x: player.x, y: player.y, z: player.z + player.eyeHeight, plane: player.plane },
                    player.yaw + swayYaw,
                    player.pitch + swayPitch,
                    this.bow.profile,
                );
                shot.attack = this.snapshot("ranged");
                this.gear.useAmmo();
                this.arrows.push(shot);
            }
            return reports;
        }
        this.bow.cancel();
        // F kicks (spec 7): only between swings, on the ground, with enough stamina.
        if (
            input.kickPressed &&
            !this.melee.busy &&
            !this.melee.isCharging &&
            player.grounded &&
            !this.combatant.incapacitated &&
            this.kick.tryStart(player.stamina.value, player.pitch)
        ) {
            this.melee.cancel();
        }
        if (this.kick.active) {
            if (this.kick.update(dt)) {
                this.resolveKick(player);
            }
            return reports;
        }
        const meleeInput: MeleeInput = {
            attackDown: input.attackDown && !this.combatant.incapacitated,
            attackPressed: !!input.attackPressed && !this.combatant.incapacitated,
            forward: input.forward,
            strafe: input.strafe,
            pitch: player.pitch,
            megasprinting: player.sprinting,
            airborne: !player.grounded,
            fallSpeed: Math.max(0, -player.verticalSpeed),
            aimingAtKnockedDown: this.aimingAtKnockedDown(player),
        };
        const events = this.melee.update(dt, meleeInput);
        const swing = this.melee.swing;
        if (events.started) {
            this.swingAttack = this.snapshot("melee");
            this.hitThisSwing.length = 0;
            for (let i = 0; i < events.started.hits.length; i++) {
                this.hitThisSwing.push(new Set());
            }
            if (events.started.lunge > 0) {
                player.applyImpulse(-Math.sin(player.yaw) * events.started.lunge, Math.cos(player.yaw) * events.started.lunge);
            }
        }
        const move = swing?.move ?? events.started;
        if (!move) {
            return reports;
        }
        const attacker = {
            x: player.x,
            y: player.y,
            eyeZ: player.z + player.eyeHeight,
            yaw: player.yaw,
            pitch: player.pitch,
            plane: player.plane,
        };
        const timeline = swing?.timeline ?? timelineFor(move, this.weapon.speed);
        for (const slice of events.active) {
            const hit = move.hits[slice.hitIndex];
            const seen = this.hitThisSwing[slice.hitIndex] ?? new Set();
            // The attack ray (spec 17.2): lines from the eye sweeping the move's 90° fan.
            const ray = rayFor(timeline, slice.hitIndex);
            for (const arcHit of traceRay(
                attacker,
                this.weapon.reach,
                ray,
                raySign(ray, hit.impact),
                slice.from,
                slice.to,
                this.bodies,
                this.flagsAt,
                seen,
            )) {
                const target = arcHit.body.owner;
                if (!target.attackable) {
                    continue;
                }
                const result =
                    target.combatStats && this.swingAttack
                        ? this.resolveOsrsHit(
                              target,
                              this.swingAttack,
                              clamp(hit.hitPow / tuning.osrsQuickHitPow, 0.5, 2) *
                                  hitboxMultiplier(arcHit.height) *
                                  (target.inCombat ? 1 : tuning.unawareMultiplier),
                              hit,
                          )
                        : applyHit(
                              target.combatant,
                              this.weapon,
                              hit,
                              { unaware: !target.inCombat, hitbox: hitboxMultiplier(arcHit.height) },
                              this.random,
                          );
                // Driven the way the blade was moving, not only away from the player.
                const push = pushDirection(arcHit);
                target.takeHit(push.x, push.y, result.push, player.x, player.y, hit.hitPow, arcHit.height);
                this.melee.addAdrenaline(hit.adrenaline);
                const report = { target, result, move };
                reports.push(report);
                this.onHit?.(report);
            }
        }
        return reports;
    }

    /**
     * Arrows in flight (spec 16.4): an arrow hit does (0 + bow WDmg) × HitPow 1.5, ×3 on an unaware
     * target (the same damage path as melee), and gives 2 adrenaline.
     */
    private updateArrows(dt: number, player: CombatPlayer): void {
        this.clock += dt;
        if (this.arrows.length === 0) {
            return;
        }
        const ground = this.groundHeight ?? (() => -Infinity);
        const hits = stepArrows(this.arrows, dt, this.bodies, this.flagsAt, ground, this.obstacleTop);
        // Spells vanish on a wall or the ground instead of sticking.
        for (let i = this.arrows.length - 1; i >= 0; i--) {
            if (this.arrows[i].spell && this.arrows[i].stuck) {
                this.arrows.splice(i, 1);
            }
        }
        for (const hit of hits) {
            const target = hit.body.owner;
            if (!target.attackable) {
                continue;
            }
            const b = hit.body;
            const height = b.height > 0 ? (hit.arrow.z - b.z) / b.height : 0.5;
            const attack = hit.arrow.attack;
            const result =
                attack && target.combatStats
                    ? this.resolveOsrsHit(
                          target,
                          attack,
                          hitboxMultiplier(height) * (target.inCombat ? 1 : tuning.unawareMultiplier),
                          ARROW_HIT,
                      )
                    : applyHit(
                          target.combatant,
                          this.bowWeapon,
                          ARROW_HIT,
                          { unaware: !target.inCombat, hitbox: hitboxMultiplier(height) },
                          this.random,
                      );
            target.takeHit(hit.dirX, hit.dirY, result.push, player.x, player.y, ARROW_HIT.hitPow, height);
            this.melee.addAdrenaline(ARROW_HIT.adrenaline);
            const report: HitReport = { target, result, move: ARROW_MOVE, spell: hit.arrow.spell?.id };
            this.onHit?.(report);
        }
    }

    /** The kick's hit event: trace, then push, dodge or miss; stamina 3 on an NPC, 1 otherwise. */
    private resolveKick(player: CombatPlayer): void {
        const trace = traceKick(
            { x: player.x, y: player.y, eyeZ: player.z + player.eyeHeight, yaw: player.yaw, pitch: player.pitch, plane: player.plane },
            this.bodies,
            this.flagsAt,
        );
        const target = trace?.body.owner;
        if (!trace || !target || !target.attackable) {
            player.stamina.spend(Math.min(player.stamina.value, tuning.kickStaminaOther));
            this.onKick?.({ outcome: "miss" });
            return;
        }
        player.stamina.spend(Math.min(player.stamina.value, target.kickCost ?? tuning.kickStaminaNpc));
        const outcome = target.kick(trace.dirX, trace.dirY, player.x, player.y);
        this.onKick?.({ target, outcome });
    }

    /** True if a knocked-down target lies within reach in front of the player. */
    private aimingAtKnockedDown(player: CombatPlayer): boolean {
        const found: Body<CombatTarget>[] = [];
        const r = this.weapon.reach;
        this.bodies.collectBodies(player.plane, player.x - r - 1, player.y - r - 1, player.x + r + 1, player.y + r + 1, found);
        const fx = -Math.sin(player.yaw);
        const fy = Math.cos(player.yaw);
        return found.some((b) => {
            const dx = b.x - player.x;
            const dy = b.y - player.y;
            const d = Math.hypot(dx, dy);
            return (
                b.owner.combatant.knockedDown &&
                d - b.radius <= r &&
                (d < 1e-6 || (dx * fx + dy * fy) / d > Math.cos(tuning.sideArc / 2))
            );
        });
    }
}
