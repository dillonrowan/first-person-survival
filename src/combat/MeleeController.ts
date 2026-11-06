import { COMBOS, MOVE_SETS, MoveDef, PowerDirection, Timeline, rayFor, timelineFor } from "./moves";
import { tuning } from "./tuning";
import type { WeaponDef } from "./weapons";

/** What the melee state machine reads each update. */
export type MeleeInput = {
    attackDown: boolean;
    /**
     * True in the update the button went down, even if it also came up (or came up and went down
     * again) since the last update. Without it, presses are read from `attackDown` changing.
     */
    attackPressed?: boolean;
    /** -1..1, forward positive. */
    forward: number;
    /** -1..1, right positive. */
    strafe: number;
    pitch: number;
    megasprinting: boolean;
    airborne: boolean;
    /** Downward speed in tiles per second (positive when falling). */
    fallSpeed: number;
    /** True if the crosshair is on a knocked-down target within reach. */
    aimingAtKnockedDown: boolean;
};

/** Part of one hit event's active window covered by this update, as fractions 0..1 of that window. */
export type ActiveSlice = { hitIndex: number; from: number; to: number };

export type SwingState = {
    move: MoveDef;
    timeline: Timeline;
    elapsed: number;
};

export type MeleeEvents = {
    /** Set when a swing started this update. */
    started?: MoveDef;
    /** Active-window slices this update; sweep the arc over each. */
    active: ActiveSlice[];
};

/** Where the melee input is (spec 18.1). */
export type MeleePhase = "idle" | "windup" | "charged" | "swing" | "end";

/**
 * The player's melee input as Dark Messiah's state machine runs it (docs/combat-movement-spec.md
 * 18): a press from idle starts the power wind-up at once (direction from the movement keys,
 * 17.1); releasing before the wind-up layer ends makes it a quick strike, holding past it charges
 * the power attack. Quick strikes alternate left-to-right and right-to-left [design]; each press
 * during a strike queues one more, which cuts into the strike's recovery, and holding during a
 * strike cancels into the wind-up. How fast strikes swing comes from the weapon's weight. A chain
 * that stops may play an "end" layer (none of the current families has one), during whose first
 * 60% presses are ignored. Plus rush, falling, trample and adrenaline "huge" attacks.
 */
export class MeleeController {
    adrenaline = 0;
    swing: SwingState | undefined;
    phase: MeleePhase = "idle";

    /** Seconds the attack button has been held since its last press, or undefined when up. */
    private pressHeld: number | undefined;
    /** Power-attack variant locked when the wind-up started (spec 17.1). */
    private lockedDirection: PowerDirection | undefined;
    private windupTime = 0;
    private windupLength = 0;
    private endTime = 0;
    private endLength = 0;
    /** Presses waiting to become quick strikes (up to tuning.quickQueue). */
    private queued = 0;
    private wasDown = false;
    /** Index of the last quick strike in the current chain, or -1 before the first. */
    private comboIndex = -1;
    /** Seconds since a quick strike was last swinging; past quickChainReset the next opens with A. */
    private sinceQuick = Infinity;
    private decayTimer = 0;

    constructor(public weapon: WeaponDef) {}

    get moves() {
        return MOVE_SETS[this.weapon.family];
    }

    private get combo() {
        return COMBOS[this.weapon.family];
    }

    /** True while holding a fully charged power attack. */
    get isCharging(): boolean {
        return this.phase === "charged";
    }

    /** 0..1 through the wind-up while the button is held, for the HUD; 1 once charged. */
    get chargeProgress(): number {
        if (this.phase === "charged") {
            return 1;
        }
        return this.phase === "windup" ? Math.min(1, this.windupTime / this.windupLength) : 0;
    }

    get busy(): boolean {
        return this.swing !== undefined;
    }

    /** The power attack being wound up or charged (its direction is locked), for the view. */
    get chargedMove(): MoveDef | undefined {
        return (this.phase === "windup" || this.phase === "charged") && this.lockedDirection
            ? this.moves.power[this.lockedDirection]
            : undefined;
    }

    addAdrenaline(amount: number): void {
        this.adrenaline = Math.min(tuning.adrenalineMax, this.adrenaline + amount);
    }

    /** Drops any press, charge or swing (weapon switch, block, getting knocked down). */
    cancel(): void {
        this.swing = undefined;
        this.phase = "idle";
        this.pressHeld = undefined;
        this.lockedDirection = undefined;
        this.queued = 0;
        this.comboIndex = -1;
    }

    update(dt: number, input: MeleeInput): MeleeEvents {
        const events: MeleeEvents = { active: [] };
        const pressed = !!input.attackPressed || (input.attackDown && !this.wasDown);
        this.wasDown = input.attackDown;
        this.pressHeld = input.attackDown ? (pressed ? 0 : (this.pressHeld ?? 0) + dt) : undefined;
        this.sinceQuick += dt;
        this.decayAdrenaline(dt);

        switch (this.phase) {
            case "swing":
                this.updateSwing(dt, input, pressed, events);
                break;
            case "end":
                this.endTime += dt;
                if (this.holdingToCharge()) {
                    this.startWindup(input);
                } else if (pressed && this.endTime >= tuning.chainWindowStart * this.endLength) {
                    // mm_player_cycle_fastattack_end: the next strike, without a wind-up.
                    this.startQuick(events);
                } else if (this.endTime >= this.endLength) {
                    this.phase = "idle";
                }
                break;
            case "windup":
                // A press here means the button came up and went down again since the last update.
                if (!input.attackDown || pressed) {
                    // Released before the wind-up layer ended: a quick strike, the other way from the last.
                    this.startQuick(events);
                    if (pressed) {
                        this.queue();
                    }
                } else {
                    this.windupTime += dt;
                    if (this.windupTime >= this.windupLength) {
                        // Clicks from before the charge are spent on it.
                        this.phase = "charged";
                        this.queued = 0;
                    }
                }
                break;
            case "charged":
                if (!input.attackDown || pressed) {
                    this.start(this.chooseCharged(input), events);
                    if (pressed) {
                        this.queue();
                    }
                }
                break;
            case "idle":
                if (pressed && input.airborne && input.fallSpeed >= tuning.fallAttackSpeed) {
                    this.start(this.moves.fall, events);
                } else if (input.attackDown) {
                    this.startWindup(input);
                } else if (pressed) {
                    // Pressed and released since the last update: a whole click.
                    this.startQuick(events);
                }
                break;
        }
        return events;
    }

    /**
     * A strike or attack in progress. Every press during it queues one quick strike (one strike per
     * click, after power attacks too), which cuts into the attack's recovery; holding during a
     * quick strike cancels it into a wind-up instead.
     */
    private updateSwing(dt: number, input: MeleeInput, pressed: boolean, events: MeleeEvents): void {
        const quick = this.swing!.move.kind === "quick";
        this.advanceSwing(dt, events);
        if (pressed) {
            this.queue();
        }
        if (quick) {
            this.sinceQuick = 0;
            if (this.swing && this.holdingToCharge()) {
                // The held press becomes the wind-up rather than a queued strike.
                this.queued = Math.max(0, this.queued - 1);
                this.swing = undefined;
                this.startWindup(input);
                return;
            }
        }
        if (this.queued > 0 && (!this.swing || this.pastRecoveryCut(this.swing))) {
            this.queued--;
            this.startQuick(events);
            return;
        }
        if (this.swing) {
            return;
        }
        if (!quick) {
            this.phase = "idle";
            return;
        }
        // The strike ended with nothing queued.
        const end = this.combo.endAfter[this.comboIndex];
        if (end) {
            this.phase = "end";
            this.endTime = 0;
            this.endLength = end;
        } else {
            this.phase = "idle";
        }
    }

    /** Held long enough since the press to turn into a power wind-up (mm_player_mintime_to_bigslash). */
    private holdingToCharge(): boolean {
        return this.pressHeld !== undefined && this.pressHeld >= this.combo.holdToCharge;
    }

    private startWindup(input: MeleeInput): void {
        this.phase = "windup";
        this.lockedDirection = powerDirection(input);
        this.windupTime = 0;
        this.windupLength = this.combo.windup[this.lockedDirection];
    }

    /** One more click waiting to become a quick strike. */
    private queue(): void {
        this.queued = Math.min(tuning.quickQueue, this.queued + 1);
    }

    /** Which power move a released charge becomes. */
    chooseCharged(input: MeleeInput): MoveDef {
        const set = this.moves;
        if (this.adrenaline >= tuning.adrenalineMax) {
            this.adrenaline = 0;
            return set.huge;
        }
        if (input.aimingAtKnockedDown && input.pitch <= tuning.tramplePitch) {
            return set.trample;
        }
        if (input.megasprinting) {
            return set.rush;
        }
        return set.power[this.lockedDirection ?? powerDirection(input)];
    }

    /**
     * The next quick strike in the weapon's combo order (spec 18.2): the other side from the last
     * one. A chain opens with A (left to right) after a power attack or once the weapon has rested.
     */
    private startQuick(events: MeleeEvents): void {
        const quick = this.moves.quick;
        if (this.sinceQuick > tuning.quickChainReset) {
            this.comboIndex = -1;
        }
        this.comboIndex = this.comboIndex < 0 ? 0 : this.combo.next(this.comboIndex) % quick.length;
        this.start(quick[this.comboIndex], events);
    }

    private start(move: MoveDef, events: MeleeEvents): void {
        this.swing = { move, timeline: timelineFor(move, this.weapon.speed), elapsed: 0 };
        this.phase = "swing";
        this.lockedDirection = undefined;
        if (move.kind === "quick") {
            this.sinceQuick = 0;
        } else {
            this.comboIndex = -1;
        }
        events.started = move;
    }

    /** Hit windows done and enough of the recovery played for a queued strike to cut in. */
    private pastRecoveryCut(swing: SwingState): boolean {
        const t = swing.timeline;
        return swing.elapsed >= t.windup + t.active + tuning.quickRecoveryCut * t.recovery;
    }

    private total(t: Timeline): number {
        return t.windup + t.active + t.recovery;
    }

    private advanceSwing(dt: number, events: MeleeEvents): void {
        const swing = this.swing!;
        const t0 = swing.elapsed;
        const t1 = t0 + dt;
        swing.elapsed = t1;
        // Each hit traces during its own ray window (spec 17.3).
        for (let i = 0; i < swing.move.hits.length; i++) {
            const { on, off } = rayFor(swing.timeline, i);
            const from = Math.max(t0, on);
            const to = Math.min(t1, off);
            if (to > from || (t0 <= on && t1 >= off)) {
                const length = Math.max(off - on, 1e-6);
                events.active.push({ hitIndex: i, from: (from - on) / length, to: Math.min(1, (to - on) / length) });
            }
        }
        if (t1 >= this.total(swing.timeline)) {
            this.swing = undefined;
        }
    }

    private decayAdrenaline(dt: number): void {
        this.decayTimer += dt;
        if (this.decayTimer >= tuning.adrenalineDecayInterval) {
            this.decayTimer = 0;
            this.adrenaline = Math.max(0, this.adrenaline - tuning.adrenalineDecayAmount);
        }
    }
}

/**
 * Power-attack variant from the movement keys held when the charge starts (spec 17.1, gh
 * 0x22449a50): left → L, else right → R, else forward → T, else back → B, else the default.
 */
export function powerDirection(input: Pick<MeleeInput, "forward" | "strafe">): PowerDirection {
    if (input.strafe < 0) {
        return "L";
    }
    if (input.strafe > 0) {
        return "R";
    }
    if (input.forward > 0) {
        return "T";
    }
    if (input.forward < 0) {
        return "B";
    }
    return "default";
}
