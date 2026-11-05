/**
 * Source-style ground and air movement as pure functions. Velocities are 2D in tiles per second.
 * Constants are Source-engine cvar defaults converted to tiles; see SOURCE_UNIT.
 */

/** Tiles per Source unit: the eye offset (61.065 units) maps onto the 1.25 tile eye height. */
export const SOURCE_UNIT = 1.25 / 61.065;
export const units = (sourceUnits: number): number => sourceUnits * SOURCE_UNIT;

export const FRICTION = 4; // sv_friction
export const STOP_SPEED = units(50); // sv_stopspeed
export const ACCELERATE = 10; // sv_accelerate
export const AIR_ACCELERATE = 10; // sv_airaccelerate
/** Cap on the wish speed used for air acceleration (Source: 30 units). */
export const AIR_SPEED_CAP = units(30);

export type Vec2 = { x: number; y: number };

/** Source's friction: bleeds speed, faster below stopspeed. Mutates and returns `velocity`. */
export function friction(velocity: Vec2, dt: number, friction = FRICTION, stopSpeed = STOP_SPEED): Vec2 {
    const speed = Math.hypot(velocity.x, velocity.y);
    if (speed < 1e-6) {
        velocity.x = velocity.y = 0;
        return velocity;
    }
    const control = Math.max(speed, stopSpeed);
    const newSpeed = Math.max(0, speed - control * friction * dt);
    const scale = newSpeed / speed;
    velocity.x *= scale;
    velocity.y *= scale;
    return velocity;
}

/** Source's Accelerate: adds speed along `wishDir` only up to `wishSpeed`. Mutates `velocity`. */
export function accelerate(
    velocity: Vec2,
    wishDir: Vec2,
    wishSpeed: number,
    dt: number,
    accel = ACCELERATE,
): Vec2 {
    const current = velocity.x * wishDir.x + velocity.y * wishDir.y;
    const addSpeed = wishSpeed - current;
    if (addSpeed <= 0) {
        return velocity;
    }
    const accelSpeed = Math.min(addSpeed, accel * dt * wishSpeed);
    velocity.x += accelSpeed * wishDir.x;
    velocity.y += accelSpeed * wishDir.y;
    return velocity;
}

/** Source's AirAccelerate: like accelerate, but the wish speed is capped (air strafing). */
export function airAccelerate(
    velocity: Vec2,
    wishDir: Vec2,
    wishSpeed: number,
    dt: number,
    accel = AIR_ACCELERATE,
    cap = AIR_SPEED_CAP,
): Vec2 {
    const capped = Math.min(wishSpeed, cap);
    const current = velocity.x * wishDir.x + velocity.y * wishDir.y;
    const addSpeed = capped - current;
    if (addSpeed <= 0) {
        return velocity;
    }
    const accelSpeed = Math.min(addSpeed, accel * dt * wishSpeed);
    velocity.x += accelSpeed * wishDir.x;
    velocity.y += accelSpeed * wishDir.y;
    return velocity;
}

/** Removes the part of `velocity` pointing into a surface with unit normal (nx, ny). */
export function clipVelocity(velocity: Vec2, nx: number, ny: number, overbounce = 1): Vec2 {
    const into = velocity.x * nx + velocity.y * ny;
    if (into < 0) {
        velocity.x -= nx * into * overbounce;
        velocity.y -= ny * into * overbounce;
    }
    return velocity;
}

export type MoveMode = "run" | "walk" | "sprint" | "crouch";

type Direction = "forward" | "forwardSide" | "side" | "back" | "backSide";

/**
 * Wish speed in Source units by movement mode and input direction (docs/combat-movement-spec.md 2.2).
 * "run" is the default state; "sprint" (megasprint) only differs straight ahead.
 */
const SPEED_TABLE: Record<MoveMode, Record<Direction, number>> = {
    run: { forward: 180, forwardSide: 180, side: 180, back: 60, backSide: 80 },
    walk: { forward: 100, forwardSide: 80, side: 100, back: 60, backSide: 80 },
    crouch: { forward: 50, forwardSide: 60, side: 45, back: 30, backSide: 60 },
    sprint: { forward: 270, forwardSide: 180, side: 180, back: 60, backSide: 80 },
};

function direction(forward: number, strafe: number): Direction {
    if (strafe === 0) {
        return forward < 0 ? "back" : "forward";
    }
    return forward > 0 ? "forwardSide" : forward < 0 ? "backSide" : "side";
}

/** Straight-ahead speed of a mode in tiles per second. */
export const speedFor = (mode: MoveMode): number => units(SPEED_TABLE[mode].forward);

/** Wish speed in tiles per second for local input (forward/strafe in -1..1). */
export function wishSpeed(mode: MoveMode, forward: number, strafe: number): number {
    if (forward === 0 && strafe === 0) {
        return 0;
    }
    return units(SPEED_TABLE[mode][direction(forward, strafe)]);
}
