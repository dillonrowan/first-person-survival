import { Poison } from "./Poison";
import { tuning } from "./tuning";

/**
 * Hit reaction sizes (docs/combat-movement-spec.md 5.3). They follow Dark Messiah's NPC hit
 * animations: "flinch" is the small hit (does not stop the target acting), "stagger" the medium
 * hit, "push" the long hit, then knockdown (lying on the ground, followed by standing up).
 */
export type Reaction = "none" | "flinch" | "stagger" | "push" | "knockdown";
export type ReactionState = Reaction | "stun" | "standup";

/** Health and hit reactions shared by the player and NPCs. */
export class Combatant {
    health: number;
    /** Seconds left in the current reaction. */
    reactionTime = 0;
    reaction: ReactionState = "none";
    /** Seconds since the last time this combatant was hurt. */
    sinceHurt = Infinity;
    /** Seconds the stand-up after a knockdown takes. */
    standUpTime = tuning.standUpFront;
    /** Hits still cause reactions but take no health. */
    unlimitedHealth = false;
    /** OSRS poison: hits on its own timer while active. */
    readonly poison = new Poison();
    /** Poison damage dealt since the game last read it (for hitsplats); the reader clears it. */
    poisonHits: number[] = [];

    constructor(public maxHealth: number) {
        this.health = maxHealth;
    }

    get dead(): boolean {
        return this.health <= 0;
    }

    /** Lying on the ground (not yet standing up). */
    get knockedDown(): boolean {
        return this.reaction === "knockdown" && this.reactionTime > 0;
    }

    /** True while a reaction stops this combatant from acting (small hits do not). */
    get incapacitated(): boolean {
        return this.dead || (this.reactionTime > 0 && this.reaction !== "flinch");
    }

    get healthFraction(): number {
        return Math.max(0, this.health / this.maxHealth);
    }

    /** Applies damage and starts a reaction; a weaker reaction never cuts a stronger one short. */
    hurt(amount: number, reaction: Reaction, stunned = false, knockdownTime = tuning.knockdownDuration): void {
        if (!this.unlimitedHealth) {
            this.health = Math.max(0, this.health - amount);
        }
        this.sinceHurt = 0;
        if (reaction === "knockdown") {
            this.knockDown(knockdownTime);
            return;
        }
        if (this.knockedDown || this.reaction === "standup") {
            return; // already on the ground or getting up
        }
        const [kind, duration]: [ReactionState, number] = stunned
            ? ["stun", tuning.stunDuration]
            : reaction === "push"
              ? ["push", tuning.longHitTime]
              : reaction === "stagger"
                ? ["stagger", tuning.mediumHitTime]
                : reaction === "flinch"
                  ? ["flinch", tuning.smallHitTime]
                  : ["none", 0];
        if (duration > 0 && (duration >= this.reactionTime || this.reaction === "flinch")) {
            this.reaction = kind;
            this.reactionTime = duration;
        }
    }

    knockDown(duration = tuning.knockdownDuration): void {
        this.reaction = "knockdown";
        this.reactionTime = Math.max(this.knockedDown ? this.reactionTime : 0, duration);
    }

    update(dt: number): void {
        this.sinceHurt += dt;
        if (this.dead) {
            this.poison.cure();
        } else {
            const poison = this.poison.update(dt);
            if (poison > 0) {
                // Poison does not stagger: no reaction, only the damage.
                this.hurt(poison, "none");
                this.poisonHits.push(poison);
            }
        }
        if (this.reactionTime > 0) {
            this.reactionTime = Math.max(0, this.reactionTime - dt);
            if (this.reactionTime === 0) {
                if (this.reaction === "knockdown" && !this.dead) {
                    this.reaction = "standup";
                    this.reactionTime = this.standUpTime;
                } else {
                    this.reaction = "none";
                }
            }
        }
    }

    reset(): void {
        this.poison.cure();
        this.poisonHits = [];
        this.health = this.maxHealth;
        this.reaction = "none";
        this.reactionTime = 0;
        this.sinceHurt = Infinity;
    }
}
