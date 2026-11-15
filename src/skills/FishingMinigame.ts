import { random } from "../game/Random";

/** Seconds the reeling may last before the fish tires the line out and escapes. [design] */
export const REEL_TIME_LIMIT = 25;

/**
 * The reeling minigame after a fish is hooked (in the manner of Palworld's fishing): a fish darts
 * along a bar and the player keeps a catch zone over it, holding the attack button to push the
 * zone right and letting go to let it drift back left. While the fish is in the zone the catch
 * meter fills, otherwise it drains; full lands the fish, empty loses it. Positions run 0..1.
 *
 * `zone` (its width) and `speed` (how far and fast the fish darts) come from the catch: a fish the
 * player has a good OSRS chance at gets a wide zone and a calm fish. [design]
 */
export class FishingMinigame {
    /** Left edge of the catch zone. */
    zoneAt = 0;
    private zoneSpeed = 0;
    fishAt = 0.5;
    private fishTarget = 0.5;
    private fishPause = 0;
    progress = 0.3;
    time = 0;
    result: "caught" | "escaped" | undefined;

    constructor(
        readonly zone: number,
        private readonly speed: number,
    ) {
        this.zoneAt = (1 - zone) / 2;
    }

    /** From the OSRS success chance (0..1) of the catch at the player's level. */
    static forChance(chance: number): FishingMinigame {
        const c = Math.min(1, Math.max(0, chance));
        return new FishingMinigame(0.16 + 0.22 * c, 1.1 - 0.6 * c);
    }

    get fishInZone(): boolean {
        return this.fishAt >= this.zoneAt && this.fishAt <= this.zoneAt + this.zone;
    }

    update(dt: number, holding: boolean): void {
        if (this.result) return;
        this.time += dt;
        // The zone: pushed right while held, falling back left otherwise, bouncing off the ends.
        this.zoneSpeed += (holding ? 2.4 : -2.0) * dt;
        this.zoneSpeed = Math.max(-1.2, Math.min(1.2, this.zoneSpeed));
        this.zoneAt += this.zoneSpeed * dt;
        if (this.zoneAt < 0) [this.zoneAt, this.zoneSpeed] = [0, Math.max(0, -this.zoneSpeed * 0.3)];
        if (this.zoneAt > 1 - this.zone) [this.zoneAt, this.zoneSpeed] = [1 - this.zone, Math.min(0, -this.zoneSpeed * 0.3)];
        // The fish: darts to a new spot, rests, darts again.
        if (this.fishPause > 0) {
            this.fishPause -= dt;
        } else {
            const step = this.speed * dt * (0.6 + Math.abs(this.fishTarget - this.fishAt) * 2);
            const d = this.fishTarget - this.fishAt;
            if (Math.abs(d) <= step) {
                this.fishAt = this.fishTarget;
                this.fishTarget = 0.05 + random() * 0.9;
                this.fishPause = random() * (1.2 - this.speed * 0.6);
            } else {
                this.fishAt += Math.sign(d) * step;
            }
        }
        this.progress += (this.fishInZone ? 0.28 : -0.2) * dt;
        if (this.progress >= 1) [this.progress, this.result] = [1, "caught"];
        else if (this.progress <= 0 || this.time >= REEL_TIME_LIMIT) [this.progress, this.result] = [Math.max(0, this.progress), "escaped"];
    }
}
