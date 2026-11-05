import { tuning } from "../combat/tuning";
import { SOURCE_UNIT } from "../player/MoveMath";

/**
 * Damage the player takes landing at `landingSpeed` tiles/s (spec 19.8): stock Source fall damage
 * above 526.5 u/s, × player_reduce_fall 60%, ignored below 5.
 */
export function fallDamage(landingSpeed: number): number {
    const over = (landingSpeed - tuning.fallSafeSpeed) / SOURCE_UNIT;
    if (over <= 0) {
        return 0;
    }
    const damage = over * tuning.fallDamagePerUnit * tuning.fallDamageScale;
    return damage >= tuning.fallMinDamage ? damage : 0;
}

/**
 * Source's physics impact damage tables, as shipped in Dark Messiah's server.dll (spec 19.5,
 * gh FUN_2219e920, data at 0x22762c68). Speeds are Source units per second, masses kg.
 */
export type ImpactTable = {
    /** [speed² threshold, damage], ascending. */
    linear: [number, number][];
    angular: [number, number][];
    minSpeedSqr: number;
    minRotSpeedSqr: number;
    minMass: number;
    smallMassMax: number;
    smallMassCap: number;
    smallMassMinSpeedSqr: number;
    largeMassMin: number;
    largeMassScale: number;
    largeMassFallingScale: number;
    myMinVelocity: number;
};

const sq = (v: number) => v * v;

export const IMPACT_TABLES: Record<"player" | "npc" | "glass", ImpactTable> = {
    player: {
        linear: [[sq(150), 5], [sq(250), 10], [sq(450), 20], [sq(550), 50], [sq(700), 100], [sq(1000), 500]],
        angular: [[sq(100), 10], [sq(150), 20], [sq(200), 50], [sq(300), 500]],
        minSpeedSqr: sq(24),
        minRotSpeedSqr: sq(360),
        minMass: 2,
        smallMassMax: 5,
        smallMassCap: 5,
        smallMassMinSpeedSqr: sq(36),
        largeMassMin: 0,
        largeMassScale: 1,
        largeMassFallingScale: 2,
        myMinVelocity: 320,
    },
    npc: {
        linear: [
            [sq(25), 1], [sq(75), 2], [sq(100), 3], [sq(150), 5],
            [sq(250), 10], [sq(350), 50], [sq(500), 100], [sq(1000), 500],
        ],
        angular: [[sq(100), 10], [sq(150), 25], [sq(200), 50], [sq(250), 500]],
        minSpeedSqr: sq(24),
        minRotSpeedSqr: sq(360),
        minMass: 2,
        smallMassMax: 5,
        smallMassCap: 5,
        smallMassMinSpeedSqr: sq(36),
        largeMassMin: 500,
        largeMassScale: 4,
        largeMassFallingScale: 5,
        myMinVelocity: 0,
    },
    glass: {
        // Shipped out of order: the 500² entry precedes 250², so 500 damage needs more than 500².
        linear: [[sq(25), 10], [sq(50), 20], [sq(100), 50], [sq(200), 75], [sq(500), 100], [sq(250), 500]],
        angular: [[sq(50), 25], [sq(100), 50], [sq(200), 100], [sq(250), 500]],
        minSpeedSqr: sq(8),
        minRotSpeedSqr: sq(360),
        minMass: 2,
        smallMassMax: 1,
        smallMassCap: 10,
        smallMassMinSpeedSqr: sq(8),
        largeMassMin: 50,
        largeMassScale: 4,
        largeMassFallingScale: 0,
        myMinVelocity: 0,
    },
};

/**
 * Source's ReadDamageTable: walks the entries until one's threshold is above the energy and returns
 * the entry before it (so an out-of-order entry ends the walk early).
 */
export function readDamageTable(table: [number, number][], energy: number): number {
    let i = 0;
    while (i < table.length && energy >= table[i][0]) {
        i++;
    }
    return i > 0 ? table[i - 1][1] : 0;
}

/** One side of a collision, in tiles per second as the simulation uses. */
export type ImpactBody = {
    mass: number;
    /** Speed before the collision. */
    speed: number;
    /** Loss of speed in the collision (|v before| − |v after|). */
    speedLoss: number;
    /** Spin, radians per second. */
    spin?: number;
    /** Static world geometry: walls and floors. */
    isStatic?: boolean;
    /** Moving downward onto the other body. */
    falling?: boolean;
};

const toUnits = (tilesPerSecond: number) => tilesPerSecond / SOURCE_UNIT;

/**
 * Damage `self` takes from colliding with `other` (spec 19.5). `allowStatic` skips the gate on the
 * other body's mass and speed: props always pass it (gh 0x22365530), so a thrown crate breaks on a
 * resting barrel or a wall; the player does not.
 */
export function impactDamage(
    table: ImpactTable,
    self: ImpactBody,
    other: ImpactBody,
    options: { allowStatic?: boolean; energyScale?: number } = {},
): number {
    const energyScale = options.energyScale ?? 1;
    const otherSpeedSqr = sq(toUnits(other.speed));
    const otherSpinSqr = sq(((other.spin ?? 0) * 180) / Math.PI);
    if (!options.allowStatic) {
        const heavyEnough = other.mass >= table.minMass && (other.mass >= table.smallMassMax || otherSpeedSqr >= table.smallMassMinSpeedSqr);
        const fastEnough = otherSpeedSqr >= table.minSpeedSqr || otherSpinSqr >= table.minRotSpeedSqr;
        if (!heavyEnough || !fastEnough) {
            return 0;
        }
    }
    let angular = 0;
    if (otherSpinSqr > table.minRotSpeedSqr) {
        angular = readDamageTable(table.angular, otherSpinSqr * energyScale);
    }
    let selfLoss = toUnits(Math.max(0, self.speedLoss));
    if (selfLoss > 0 && selfLoss < table.myMinVelocity) {
        selfLoss = 0;
    }
    const otherLoss = toUnits(Math.max(0, other.speedLoss));
    let otherEnergy = other.isStatic ? 0 : sq(otherLoss) * other.mass;
    if (!other.isStatic && table.largeMassMin > 0 && other.mass >= table.largeMassMin) {
        otherEnergy *= other.falling ? table.largeMassFallingScale : table.largeMassScale;
    }
    const energy = ((otherEnergy + self.mass * sq(selfLoss)) / self.mass) * energyScale;
    let damage = readDamageTable(table.linear, energy) + angular;
    if (!other.isStatic && other.mass < table.smallMassMax && table.smallMassCap > 0) {
        damage = Math.min(damage, table.smallMassCap);
    }
    return damage;
}

/** Kinetic energy in joules of `mass` kg at `tilesPerSecond`, with 1 Source unit = 2.54 cm. */
export function kineticJoules(mass: number, tilesPerSecond: number): number {
    const metresPerSecond = toUnits(tilesPerSecond) * 0.0254;
    return 0.5 * mass * metresPerSecond * metresPerSecond;
}
