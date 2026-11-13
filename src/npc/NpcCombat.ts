import { tuning } from "../combat/tuning";

/** What the combat brain sees each update. Positions in tiles, yaw like the player's. */
export type CombatSense = {
    x: number;
    y: number;
    playerX: number;
    playerY: number;
    playerYaw: number;
    healthFraction: number;
};

/** The brain's decision: a velocity (tiles/s) and a direction to face. */
export type CombatMove = {
    vx: number;
    vy: number;
    faceX: number;
    faceY: number;
    mode: CombatMode;
};

export type CombatMode = "chase" | "fight" | "flee";

/** The Red, Green and Yellow distances of the combat steps (spec 10), tiles. */
export type Zones = { red: number; green: number; yellow: number };

/** The guard's zones, read live so they can be tuned. */
const defaultZones = (): Zones => ({ red: tuning.zoneRed, green: tuning.zoneGreen, yellow: tuning.zoneYellow });

/** Where an NPC that attacks from a distance engages and the gap it holds, tiles. */
export type Distances = { engage: number; ideal: number };

/** The zones of an NPC that holds `ideal` tiles: it closes in and settles between Red and Green. */
export const zonesFor = ({ engage, ideal }: Distances): Zones => ({ red: ideal - 1, green: ideal + 0.5, yellow: engage });

/** A combat step relative to the player: forward = towards them, side = to the NPC's left. */
export type Step = { forward: number; side: number; length: number };

/** Every combat step the guard has (spec 10): forward/back 15/30/40 u, left/right 23/47 u. */
export function combatSteps(): Step[] {
    const steps: Step[] = [];
    for (const length of tuning.stepLengths) {
        steps.push({ forward: 1, side: 0, length }, { forward: -1, side: 0, length });
    }
    for (const length of tuning.sideStepLengths) {
        steps.push({ forward: 0, side: 1, length }, { forward: 0, side: -1, length });
    }
    return steps;
}

/**
 * Weight of a combat step at distance `d` from the player (gh FUN_222b0af0): base 2; forward and
 * back steps are judged by where they end — beyond Yellow or inside Red ×0.1, inside Green ×2.5,
 * between Green and Yellow ×0.5; sideways steps ×0.5 outside the Red–Green band.
 */
export function stepWeight(step: Step, d: number, zones: Zones = defaultZones()): number {
    let weight = 2;
    if (step.side !== 0) {
        if (d <= zones.red || d > zones.green) {
            weight *= 0.5;
        }
        return weight;
    }
    const end = d - step.forward * step.length;
    if (end > zones.yellow || end <= zones.red) {
        weight *= 0.1;
    } else if (end <= zones.green) {
        weight *= 2.5;
    } else {
        weight *= 0.5;
    }
    return weight;
}

/** Picks a step at random, in proportion to its weight. */
export function chooseStep(d: number, random: () => number, steps = combatSteps(), zones: Zones = defaultZones()): Step {
    const weights = steps.map((s) => stepWeight(s, d, zones));
    let pick = random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < steps.length; i++) {
        pick -= weights[i];
        if (pick <= 0) {
            return steps[i];
        }
    }
    return steps[steps.length - 1];
}

/** True if (x, y) lies inside the player's view cone of half-angle `cone`. */
export function inViewCone(sense: CombatSense, cone: number): boolean {
    const dx = sense.x - sense.playerX;
    const dy = sense.y - sense.playerY;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) {
        return true;
    }
    const fx = -Math.sin(sense.playerYaw);
    const fy = Math.cos(sense.playerYaw);
    return (dx * fx + dy * fy) / d >= Math.cos(cone);
}

/**
 * Dark Messiah-style melee movement for one NPC (spec 10): run in from far away and combat-walk
 * the last stretch, zig-zag while the player looks straight at it, then hold the ideal distance
 * with short combat steps, always facing the player; flee when badly hurt.
 */
export class NpcCombatBrain {
    mode: CombatMode = "chase";
    /** The step in progress and its remaining time, or the pause before the next one. */
    private step: Step | undefined;
    private stepLeft = 0;
    private pause = 0;
    private zigzagSide = 1;
    private zigzagTravel = 0;
    private fleeLeft = 0;
    private fled = false;

    constructor(
        private readonly random: () => number = Math.random,
        distances?: Distances,
    ) {
        this.fixedZones = distances && zonesFor(distances);
    }

    /** The zones of an NPC that keeps its distance; absent for the guard's. */
    private readonly fixedZones: Zones | undefined;

    update(dt: number, sense: CombatSense): CombatMove {
        const zones = this.fixedZones ?? defaultZones();
        const dx = sense.playerX - sense.x;
        const dy = sense.playerY - sense.y;
        const d = Math.hypot(dx, dy);
        const tx = d > 1e-6 ? dx / d : 0;
        const ty = d > 1e-6 ? dy / d : 1;

        if (!this.fled && sense.healthFraction < tuning.fleeHealth) {
            this.fled = true;
            this.fleeLeft = tuning.fleeTime;
        }
        if (this.fleeLeft > 0) {
            this.fleeLeft -= dt;
            this.mode = "flee";
            return { vx: -tx * tuning.npcRunSpeed, vy: -ty * tuning.npcRunSpeed, faceX: -tx, faceY: -ty, mode: "flee" };
        }

        // Hysteresis so the NPC does not flip between chasing and fighting at the Yellow edge.
        if (this.mode !== "fight" && d <= zones.yellow) {
            this.mode = "fight";
            this.step = undefined;
            this.pause = 0;
        } else if (this.mode === "fight" && d > zones.yellow + 0.4) {
            this.mode = "chase";
        } else if (this.mode === "flee") {
            this.mode = "chase";
        }

        if (this.mode === "chase") {
            const speed = d > tuning.npcRunDistance ? tuning.npcRunSpeed : tuning.npcCombatWalkSpeed;
            let mx = tx;
            let my = ty;
            if (d >= tuning.zigzagMinDistance && inViewCone(sense, tuning.zigzagCone)) {
                // Alternate sides about every 75 u travelled (the game's waypoints are 50–100 u out).
                this.zigzagTravel += speed * dt;
                if (this.zigzagTravel > 1.5) {
                    this.zigzagTravel = 0;
                    this.zigzagSide = -this.zigzagSide;
                }
                const a = this.zigzagSide * tuning.zigzagSteer;
                mx = tx * Math.cos(a) - ty * Math.sin(a);
                my = tx * Math.sin(a) + ty * Math.cos(a);
            }
            return { vx: mx * speed, vy: my * speed, faceX: mx, faceY: my, mode: "chase" };
        }

        // Fight: short steps relative to the player, facing them.
        if (this.step) {
            this.stepLeft -= dt;
            if (this.stepLeft <= 0) {
                this.step = undefined;
                this.pause = tuning.stepPauseMin + this.random() * (tuning.stepPauseMax - tuning.stepPauseMin);
            }
        } else {
            this.pause -= dt;
            if (this.pause <= 0) {
                this.step = chooseStep(d, this.random, undefined, zones);
                this.stepLeft = tuning.stepTime;
            }
        }
        if (!this.step) {
            return { vx: 0, vy: 0, faceX: tx, faceY: ty, mode: "fight" };
        }
        const speed = this.step.length / tuning.stepTime;
        // Left of the NPC while it faces the player: (-ty, tx).
        const mx = this.step.forward * tx + this.step.side * -ty;
        const my = this.step.forward * ty + this.step.side * tx;
        return { vx: mx * speed, vy: my * speed, faceX: tx, faceY: ty, mode: "fight" };
    }
}
