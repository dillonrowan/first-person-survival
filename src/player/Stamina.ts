/**
 * The player's stamina pool (docs/combat-movement-spec.md 2.3, 16.1). Megasprint drains it at
 * 2 per second; it may start only with at least the kick threshold left, and then runs until empty.
 * Maximum 9 and regeneration 0.06 per 0.12 s come from player_basic.qct.
 */
export class Stamina {
    value: number;

    private sinceUse = Infinity;

    constructor(
        readonly max = 9, // player_stamina_base_max
        private readonly drainPerSecond = 2, // mm_player_stamina_megasprint_cost_per_second
        private readonly regenPerSecond = 0.06 / 0.12, // player_stamina_add_value / _interval
        private readonly regenDelay = 0, // no pause is stored in the data [inferred]
        /** Megasprint start gate: mm_player_stamina_needed_for_kick. */
        readonly startThreshold = 3,
    ) {
        this.value = max;
    }

    /** True if megasprint may begin now. */
    get canStartSprint(): boolean {
        return this.value >= this.startThreshold;
    }

    /** True if a megasprint already running may continue. */
    get canContinueSprint(): boolean {
        return this.value > 0;
    }

    get fraction(): number {
        return this.value / this.max;
    }

    /** Spends a one-off cost (kick, dodge); false and no change if there is not enough. */
    spend(amount: number): boolean {
        if (this.value < amount) {
            return false;
        }
        this.value -= amount;
        this.sinceUse = 0;
        return true;
    }

    update(dt: number, sprinting: boolean): void {
        if (sprinting && this.value > 0) {
            this.value = Math.max(0, this.value - this.drainPerSecond * dt);
            this.sinceUse = 0;
            return;
        }
        this.sinceUse += dt;
        if (this.sinceUse >= this.regenDelay) {
            this.value = Math.min(this.max, this.value + this.regenPerSecond * dt);
        }
    }
}
