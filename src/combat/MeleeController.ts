import { MOVE_SETS, MoveDef, PowerDirection, Timeline, timelineFor } from "./moves";
import { tuning } from "./tuning";
import type { WeaponDef } from "./weapons";

/** What the melee state machine reads each update. */
export type MeleeInput = {
    attackDown: boolean;
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

/** Seconds after a swing before the quick-strike combo starts again from A. [design] */
const COMBO_RESET = 1;

/**
 * The player's melee input (docs/combat-movement-spec.md 3): tap for quick strikes that chain
 * A→E, hold past the charge threshold for a power attack whose variant comes from the movement
 * keys, plus rush, falling, trample and adrenaline "huge" attacks.
 */
export class MeleeController {
    adrenaline = 0;
    swing: SwingState | undefined;

    private pressHeld: number | undefined;
    private charging = false;
    private buffered: { held: number; released: boolean } | undefined;
    private wasDown = false;
    private comboIndex = -1;
    private sinceSwing = Infinity;
    private decayTimer = 0;

    constructor(public weapon: WeaponDef) {}

    get moves() {
        return MOVE_SETS[this.weapon.family];
    }

    /** True while holding a charged power attack. */
    get isCharging(): boolean {
        return this.charging;
    }

    /** 0..1 progress towards a charge while the button is held, for the HUD. */
    get chargeProgress(): number {
        if (this.charging) {
            return 1;
        }
        return this.pressHeld === undefined ? 0 : Math.min(1, this.pressHeld / this.chargeThreshold);
    }

    get busy(): boolean {
        return this.swing !== undefined;
    }

    private get chargeThreshold(): number {
        return this.weapon.family === "daggers" ? tuning.chargeThresholdDaggers : tuning.chargeThreshold;
    }

    addAdrenaline(amount: number): void {
        this.adrenaline = Math.min(tuning.adrenalineMax, this.adrenaline + amount);
    }

    /** Drops any press, charge or swing (weapon switch, block, getting knocked down). */
    cancel(): void {
        this.swing = undefined;
        this.pressHeld = undefined;
        this.charging = false;
        this.buffered = undefined;
    }

    update(dt: number, input: MeleeInput): MeleeEvents {
        const events: MeleeEvents = { active: [] };
        const pressed = input.attackDown && !this.wasDown;
        const released = !input.attackDown && this.wasDown;
        this.wasDown = input.attackDown;

        this.decayAdrenaline(dt);

        if (this.swing) {
            this.sinceSwing = 0;
            this.advanceSwing(dt, events);
            if (this.swing && this.swing.move.kind === "quick") {
                const total = this.total(this.swing.timeline);
                if (this.buffered) {
                    this.buffered.held += dt;
                    this.buffered.released ||= released;
                } else if (pressed && this.swing.elapsed >= tuning.chainWindowStart * total) {
                    this.buffered = { held: 0, released: false };
                }
            }
            if (this.swing) {
                return events;
            }
            // The swing ended this update: a buffered press continues as a fresh press.
            if (this.buffered) {
                if (this.buffered.released) {
                    this.startQuick(input, events);
                } else {
                    this.pressHeld = this.buffered.held;
                }
                this.buffered = undefined;
            }
            return events;
        }
        this.sinceSwing += dt;

        if (pressed && input.airborne && input.fallSpeed >= tuning.fallAttackSpeed) {
            this.start(this.moves.fall, events);
            return events;
        }
        if (pressed) {
            this.pressHeld = 0;
        }
        if (this.pressHeld !== undefined) {
            if (input.attackDown) {
                this.pressHeld += dt;
                if (this.pressHeld >= this.chargeThreshold) {
                    this.charging = true;
                }
            } else {
                const charged = this.charging;
                this.pressHeld = undefined;
                this.charging = false;
                if (charged) {
                    this.start(this.chooseCharged(input), events);
                } else {
                    this.startQuick(input, events);
                }
            }
        }
        return events;
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
        return set.power[powerDirection(input)];
    }

    private startQuick(_input: MeleeInput, events: MeleeEvents): void {
        const quick = this.moves.quick;
        if (this.sinceSwing > COMBO_RESET) {
            this.comboIndex = -1;
        }
        this.comboIndex = (this.comboIndex + 1) % quick.length;
        this.start(quick[this.comboIndex], events);
    }

    private start(move: MoveDef, events: MeleeEvents): void {
        this.swing = { move, timeline: timelineFor(move, this.weapon.speed), elapsed: 0 };
        this.pressHeld = undefined;
        this.charging = false;
        events.started = move;
    }

    private total(t: Timeline): number {
        return t.windup + t.active + t.recovery;
    }

    private advanceSwing(dt: number, events: MeleeEvents): void {
        const swing = this.swing!;
        const { windup, active } = swing.timeline;
        const t0 = swing.elapsed;
        const t1 = t0 + dt;
        swing.elapsed = t1;
        const hits = swing.move.hits.length;
        const slot = active / hits;
        for (let i = 0; i < hits; i++) {
            const start = windup + i * slot;
            const end = start + slot;
            const from = Math.max(t0, start);
            const to = Math.min(t1, end);
            if (to > from) {
                events.active.push({ hitIndex: i, from: (from - start) / slot, to: (to - start) / slot });
            }
        }
        if (t1 >= this.total(swing.timeline)) {
            this.swing = undefined;
            this.sinceSwing = 0;
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

/** Power-attack variant from the held movement keys (spec 3.2). */
export function powerDirection(input: Pick<MeleeInput, "forward" | "strafe" | "pitch" | "airborne">): PowerDirection {
    if (input.strafe < 0) {
        return "L";
    }
    if (input.strafe > 0) {
        return "R";
    }
    if (input.forward < 0) {
        return "B";
    }
    if (input.forward > 0 && (input.airborne || input.pitch >= tuning.overheadPitch)) {
        return "T";
    }
    return "default";
}
