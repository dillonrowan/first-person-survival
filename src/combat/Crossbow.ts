import { tuning } from "./tuning";

export type CrossbowState = "reloading" | "loaded" | "recoil" | "empty";

export type CrossbowInput = {
    attackDown: boolean;
    /** Right mouse held: the view zooms. */
    aimDown: boolean;
};

/**
 * Reload timeline as shares of the reload: lower the crossbow, span the string onto the latch, lay
 * a bolt on the rail, raise it back to aim. [design]
 */
const LOWER_END = 0.2;
const SPAN = [0.18, 0.6] as const;
const SEAT = [0.62, 0.77] as const;
const RAISE_START = 0.78;

const smooth = (t: number) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
};

/**
 * A crossbow: no draw to hold. Equipping it, and every shot, starts a reload (span the string, seat
 * a bolt); once loaded, a click shoots at once. The view zooms while the right mouse is held, like
 * the bow's.
 */
export class CrossbowController {
    state: CrossbowState = "reloading";
    /** Seconds in the current state. */
    elapsed = 0;
    bolts = tuning.boltsStart;
    /** 0..1 zoom amount, eased as the bow's. */
    zoom = 0;
    private wasDown = false;

    /** Starts over with a reload, as when the crossbow is equipped. */
    reset(): void {
        this.enter(this.bolts > 0 ? "reloading" : "empty");
        this.zoom = 0;
        this.wasDown = true; // a click that equipped it does not also shoot
    }

    /** 0..1 through the reload, 1 when loaded. */
    get reloadProgress(): number {
        if (this.state === "reloading") return Math.min(1, this.elapsed / tuning.crossbowReloadTime);
        return this.state === "loaded" ? 1 : 0;
    }

    /** 0..1 how far the crossbow is lowered from the aim to reload it. */
    get lowered(): number {
        if (this.state !== "reloading") return 0;
        const t = this.reloadProgress;
        return t < RAISE_START ? smooth(t / LOWER_END) : 1 - smooth((t - RAISE_START) / (1 - RAISE_START));
    }

    /** 0..1 how far the string is spanned back to the latch: straight when spent, on the latch when loaded. */
    get cocked(): number {
        if (this.state === "loaded") return 1;
        if (this.state !== "reloading") return 0;
        return smooth((this.reloadProgress - SPAN[0]) / (SPAN[1] - SPAN[0]));
    }

    /** 0..1 how far a bolt has been laid onto the rail (0: no bolt). */
    get boltSeat(): number {
        if (this.state === "loaded") return 1;
        if (this.state !== "reloading") return 0;
        return smooth((this.reloadProgress - SEAT[0]) / (SEAT[1] - SEAT[0]));
    }

    /** 1 at the moment of a shot, dying away over the recoil. */
    get recoil(): number {
        return this.state === "recoil" ? Math.exp(-this.elapsed / (tuning.crossbowRecoilTime * 0.3)) : 0;
    }

    /** Returns true in the update a bolt leaves the crossbow. */
    update(dt: number, input: CrossbowInput): boolean {
        const pressed = input.attackDown && !this.wasDown;
        this.wasDown = input.attackDown;
        this.elapsed += dt;
        let shot = false;
        switch (this.state) {
            case "reloading":
                if (this.elapsed >= tuning.crossbowReloadTime) this.enter("loaded");
                break;
            case "loaded":
                if (pressed) {
                    this.bolts--;
                    shot = true;
                    this.enter("recoil");
                }
                break;
            case "recoil":
                if (this.elapsed >= tuning.crossbowRecoilTime) this.enter(this.bolts > 0 ? "reloading" : "empty");
                break;
            case "empty":
                if (this.bolts > 0) this.enter("reloading");
                break;
        }
        this.zoom = input.aimDown ? Math.min(1, this.zoom + dt * 5) : Math.max(0, this.zoom - dt * 1);
        return shot;
    }

    private enter(state: CrossbowState): void {
        this.state = state;
        this.elapsed = 0;
    }
}
