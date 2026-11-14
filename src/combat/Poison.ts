import { SERVER_TICK_SECONDS } from "../npc/NpcMovement";

/** Poison hits every 30 game ticks (18 s) [OSRS wiki: Poison]. */
export const POISON_INTERVAL = 30 * SERVER_TICK_SECONDS;

/** Weapon poison severities [OSRS wiki: Poison, Weapon poisoning]: (p), (p+), (p++), karambwan paste. */
const WEAPON_SEVERITY: [RegExp, number][] = [
    [/\(p\+\+\)/i, 30],
    [/\(p\+\)/i, 25],
    [/\(kp\)/i, 30],
    [/\(p\)/i, 20],
];
/** Ranged ammunition poisons 14 severity less [wiki]. */
const RANGED_SEVERITY_DROP = 14;
/** Chance a successful, damaging hit poisons: 1/4 melee, 1/8 ranged [wiki, Mod Ash]. */
export const WEAPON_POISON_CHANCE = { melee: 1 / 4, ranged: 1 / 8 } as const;
/** Chance a poisonous NPC's strike poisons, hit or miss. The wiki gives none. [design] */
export const NPC_POISON_CHANCE = 1 / 4;

/** The severity a poisoned weapon or ammunition applies, 0 for anything else. */
export function weaponPoisonSeverity(itemName: string | undefined, kind: "melee" | "ranged"): number {
    if (!itemName) return 0;
    const found = WEAPON_SEVERITY.find(([pattern]) => pattern.test(itemName));
    if (!found) return 0;
    return kind === "ranged" ? Math.max(0, found[1] - RANGED_SEVERITY_DROP) : found[1];
}

/**
 * OSRS poison: a severity that deals floor((severity + 4) / 5) every 18 s and drops by one per hit,
 * so the damage falls by one every five hits until it wears off at 0. The first hit lands as soon
 * as the poison takes hold. [design: the wiki does not say when the first hit comes]
 */
export class Poison {
    severity = 0;
    private timer = 0;

    get active(): boolean {
        return this.severity > 0;
    }

    /** What the next hit deals. */
    get damage(): number {
        return Math.floor((this.severity + 4) / 5);
    }

    /** Poisons with `severity`; a weaker poison than the current one changes nothing. Returns whether it took. */
    apply(severity: number): boolean {
        if (severity <= 0 || severity < this.severity) return false;
        if (!this.active) this.timer = 0;
        this.severity = severity;
        return true;
    }

    /** Advances the timer; returns the damage of a poison hit that is due, else 0. */
    update(dt: number): number {
        if (!this.active) return 0;
        this.timer -= dt;
        if (this.timer > 0) return 0;
        const damage = this.damage;
        this.severity -= 1;
        this.timer += POISON_INTERVAL;
        return damage;
    }

    cure(): void {
        this.severity = 0;
        this.timer = 0;
    }
}
