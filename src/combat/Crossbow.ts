import { tuning } from "./tuning";

export type CrossbowState = "reloading" | "loaded" | "recoil" | "cycling" | "empty";

export type CrossbowInput = {
    attackDown: boolean;
    /** Right mouse held: the view zooms. */
    aimDown: boolean;
};

/**
 * Reload timeline as shares of the reload: lower the crossbow, span the string onto the latch, lay
 * a bolt on the rail, raise it back to aim. A repeater lowers and raises the same way, filling its
 * magazine in between. [design]
 */
const LOWER_END = 0.2;
const SPAN = [0.18, 0.6] as const;
const SEAT = [0.62, 0.77] as const;
const RAISE_START = 0.78;
/** Repeater refill: the bolts are dropped into the magazine one by one over this share. [design] */
const FILL = [0.2, 0.76] as const;
/**
 * Repeater lever stroke, as shares of the cycle: push the magazine forward until its catch takes the
 * spent string, then pull it back, spanning the string to the latch; near the end of the pull a bolt
 * drops out of the magazine onto the rail. [design]
 */
const PUSH_END = 0.4;
const DROP = [0.7, 0.9] as const;

const smooth = (t: number) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
};

/**
 * A crossbow: no draw to hold. Equipping it, and every shot, starts a reload (span the string, seat
 * a bolt); once loaded, a click shoots at once. The view zooms while the right mouse is held, like
 * the bow's.
 *
 * A repeater (`magazineSize` > 0) carries its bolts in a magazine over the rail: after a shot it
 * works its lever (`cycling`) to span the string and drop the next bolt, and keeps shooting while
 * the button is held. Only when the magazine is empty does it lower to be refilled.
 */
export class CrossbowController {
    state: CrossbowState = "reloading";
    /** Seconds in the current state. */
    elapsed = 0;
    /** Bolts carried, those in a repeater's magazine included. */
    bolts = tuning.boltsStart;
    /** Bolts in a repeater's magazine, the one on the rail included. */
    magazine = 0;
    /** 0..1 zoom amount, eased as the bow's. */
    zoom = 0;
    private size = 0;
    /** Bolts going into the magazine during this refill. */
    private filling = 0;
    private wasDown = false;
    /** The button has to come up after equipping before a repeater shoots on it being held. */
    private needsRelease = false;

    /** Magazine capacity; 0 for a crossbow loaded one bolt at a time. */
    get magazineSize(): number {
        return this.size;
    }

    get repeater(): boolean {
        return this.size > 0;
    }

    /** Sets the held crossbow's magazine (0: none). A different size unloads it and starts over. */
    setMagazine(size: number): void {
        if (size === this.size) return;
        this.size = size;
        this.magazine = 0;
        this.reset();
    }

    /** Starts over with a reload (or, a repeater with bolts in it, a stroke of the lever), as when the crossbow is equipped. */
    reset(): void {
        if (this.repeater && this.magazine > 0) this.enter("cycling");
        else this.startReload();
        this.zoom = 0;
        this.wasDown = true; // a click that equipped it does not also shoot
        this.needsRelease = true;
    }

    private get reloadTime(): number {
        return this.repeater ? tuning.repeaterReloadTime : tuning.crossbowReloadTime;
    }

    private get recoilTime(): number {
        return this.repeater ? tuning.repeaterRecoilTime : tuning.crossbowRecoilTime;
    }

    /** 0..1 through the reload, 1 when loaded. */
    get reloadProgress(): number {
        if (this.state === "reloading") return Math.min(1, this.elapsed / this.reloadTime);
        return this.state === "loaded" ? 1 : 0;
    }

    /** 0..1 through a repeater's lever stroke. */
    get cycleProgress(): number {
        return this.state === "cycling" ? Math.min(1, this.elapsed / tuning.repeaterCycleTime) : 0;
    }

    /** 0..1 how far the crossbow is lowered from the aim to reload it. */
    get lowered(): number {
        if (this.state !== "reloading") return 0;
        const t = this.reloadProgress;
        return t < RAISE_START ? smooth(t / LOWER_END) : 1 - smooth((t - RAISE_START) / (1 - RAISE_START));
    }

    /** 0..1 how far a repeater's magazine is pushed forward along the rail by its lever. */
    get magazineSlide(): number {
        if (this.state !== "cycling") return 0;
        const t = this.cycleProgress;
        return t < PUSH_END ? smooth(t / PUSH_END) : 1 - smooth((t - PUSH_END) / (1 - PUSH_END));
    }

    /** 0..1 how far the string is spanned back to the latch: straight when spent, on the latch when loaded. */
    get cocked(): number {
        if (this.state === "loaded") return 1;
        if (this.state === "cycling") {
            // The magazine's catch takes the string at the front of the stroke and carries it back.
            return this.cycleProgress < PUSH_END ? 0 : 1 - this.magazineSlide;
        }
        if (this.state !== "reloading" || this.repeater) return 0;
        return smooth((this.reloadProgress - SPAN[0]) / (SPAN[1] - SPAN[0]));
    }

    /** 0..1 how far a bolt has been laid onto the rail (0: no bolt). */
    get boltSeat(): number {
        if (this.state === "loaded") return 1;
        if (this.state === "cycling") return smooth((this.cycleProgress - DROP[0]) / (DROP[1] - DROP[0]));
        if (this.state !== "reloading" || this.repeater) return 0;
        return smooth((this.reloadProgress - SEAT[0]) / (SEAT[1] - SEAT[0]));
    }

    /** A repeater's refill: bolts already in, and 0..1 how far the next is into the magazine (0: none going in). */
    get refill(): { done: number; next: number } {
        if (this.state !== "reloading" || !this.repeater || this.filling === 0) return { done: 0, next: 0 };
        const s = ((this.reloadProgress - FILL[0]) / (FILL[1] - FILL[0])) * this.filling;
        const done = Math.min(this.filling, Math.max(0, Math.floor(s)));
        return { done, next: done < this.filling && s > 0 ? s - done : 0 };
    }

    /** Bolts ready to shoot: the magazine (filling as the refill goes), or 1 on a loaded crossbow. */
    get loadedCount(): number {
        if (this.repeater) return this.state === "reloading" ? this.refill.done : this.magazine;
        return this.state === "loaded" ? 1 : 0;
    }

    /** 1 at the moment of a shot, dying away over the recoil. */
    get recoil(): number {
        return this.state === "recoil" ? Math.exp(-this.elapsed / (this.recoilTime * 0.3)) : 0;
    }

    /** Returns true in the update a bolt leaves the crossbow. */
    update(dt: number, input: CrossbowInput): boolean {
        const pressed = input.attackDown && !this.wasDown;
        this.wasDown = input.attackDown;
        if (!input.attackDown) this.needsRelease = false;
        this.elapsed += dt;
        let shot = false;
        switch (this.state) {
            case "reloading":
                if (this.elapsed >= this.reloadTime) {
                    if (this.repeater) {
                        this.magazine = this.filling;
                        this.enter("cycling");
                    } else {
                        this.enter("loaded");
                    }
                }
                break;
            case "cycling":
                if (this.elapsed >= tuning.repeaterCycleTime) this.enter("loaded");
                break;
            case "loaded":
                // A repeater keeps shooting while the button is held, each bolt as soon as it is down.
                if (this.repeater ? input.attackDown && !this.needsRelease : pressed) {
                    this.bolts--;
                    if (this.repeater) this.magazine--;
                    shot = true;
                    this.enter("recoil");
                }
                break;
            case "recoil":
                if (this.elapsed >= this.recoilTime) {
                    if (this.repeater && this.magazine > 0) this.enter("cycling");
                    else this.startReload();
                }
                break;
            case "empty":
                if (this.bolts > 0) this.startReload();
                break;
        }
        this.zoom = input.aimDown ? Math.min(1, this.zoom + dt * 5) : Math.max(0, this.zoom - dt * 1);
        return shot;
    }

    private startReload(): void {
        if (this.bolts <= 0) {
            this.enter("empty");
            return;
        }
        this.filling = this.repeater ? Math.min(this.size, this.bolts) : 0;
        this.enter("reloading");
    }

    private enter(state: CrossbowState): void {
        this.state = state;
        this.elapsed = 0;
    }
}
