import type { Body, BodySource } from "../physics/Bodies";
import { segmentHitsBoxes2D } from "../physics/Bodies";
import { Box, FlagsAt, collectTileBoxes } from "../physics/TileColliders";
import type { PlayerAttack } from "./Osrs";
import { tuning } from "./tuning";

/** Seconds to ease the string back to brace after an early release. [design] */
const LET_DOWN_TIME = 0.3;
/** Seconds for the held bow to settle back to rest after a shot or let-down. [design] */
const SETTLE_TIME = 0.3;
/** String twang after a shot: peak pull past brace (fraction of a full draw), Hz, decay s. [design] */
const TWANG = { amplitude: 0.06, frequency: 14, decay: 0.07 };

export type BowState = "idle" | "drawing" | "drawn" | "shooting" | "lowering";

/**
 * How a ranged weapon draws and shoots: seconds until a draw (and the chained re-draw) is ready,
 * the launch speed (tiles/s) and the gravity its shots fall under (tiles/s²). Together they set the
 * range: how far a shot carries, and how long it stays up, before it comes down.
 */
export type RangedProfile = { drawReady: number; redrawReady: number; speed: number; gravity: number };

const LONGBOW: RangedProfile = {
    drawReady: tuning.bowDrawReady,
    redrawReady: tuning.bowReloadReady,
    speed: tuning.arrowSpeed,
    gravity: tuning.gravity * tuning.longbowGravityScale,
};
const SHORTBOW: RangedProfile = {
    drawReady: tuning.shortbowDrawReady,
    redrawReady: tuning.shortbowReloadReady,
    speed: tuning.shortbowArrowSpeed,
    gravity: tuning.gravity,
};

/**
 * A bow named "shortbow" draws fast but its arrows fall short; every other bow is a longbow.
 * Crossbows carry as far as longbows.
 */
export function rangedProfile(weapon: { name: string; family: string }): RangedProfile {
    return weapon.family === "bow" && /shortbow/i.test(weapon.name) ? SHORTBOW : LONGBOW;
}

export type BowInput = {
    attackDown: boolean;
    /** Right mouse held: the view zooms. */
    aimDown: boolean;
};

/**
 * The bow (docs/combat-movement-spec.md 16.4), with all three bow skills. Holding attack draws an
 * arrow: 2.0 s layer, ready to fire at 1.433 s (a shortbow's sooner, see `profile`). Releasing once
 * ready shoots (0.233 s, the arrow leaves at 0.033 s); releasing earlier lowers the bow (0.667 s).
 * Pressing again during or right after a shot chains into the 1.0 s re-draw (ready at 0.933 s). The
 * view zooms while the right mouse is held; the aim stays steady for 4 s after the draw, then sways.
 */
export class BowController {
    state: BowState = "idle";
    /** Seconds in the current state. */
    elapsed = 0;
    arrows = tuning.arrowsStart;
    /** 0..1 zoom amount, eased (zoom in rate 1/s, out 0.2/s as in mm_player_speed_zoom_in/_out × 5). */
    zoom = 0;
    /** The held bow's draw times and arrow speed (rangedProfile). */
    profile: RangedProfile = LONGBOW;
    private readyAt = tuning.bowDrawReady;
    private fired = false;
    private chain = false;
    private wasDown = false;
    private drawnFor = 0;
    /** String pull when the draw was let down early, eased back to brace while lowering. */
    private letDownFrom = 0;
    /** Lowering after a shot: the arrow has left, no new one is nocked yet. */
    private emptyLowering = false;
    /** Held pose (poseProgress) when the draw was released, and seconds since. */
    private releasedPose = 0;
    private sinceRelease = Infinity;

    /** 0..1 draw progress for the view model. */
    get drawProgress(): number {
        if (this.state === "drawing") {
            return Math.min(1, this.elapsed / this.readyAt);
        }
        return this.state === "drawn" ? 1 : 0;
    }

    /**
     * 0..1 how far the bow is raised into its drawn pose, for the view model: it follows the draw,
     * and after a shot or a let-down it settles back to rest over SETTLE_TIME instead of snapping.
     */
    get poseProgress(): number {
        const target = this.drawProgress;
        if (this.sinceRelease >= SETTLE_TIME) {
            return target;
        }
        const t = this.sinceRelease / SETTLE_TIME;
        return Math.max(target, this.releasedPose * (1 - t * t * (3 - 2 * t)));
    }

    /**
     * How far the string is pulled, 1 at full draw: it eases into the anchor while drawing, eases
     * back when the draw is let down, and twangs about brace (going slightly negative) after a shot.
     */
    get stringPull(): number {
        switch (this.state) {
            case "drawing": {
                const p = this.drawProgress;
                return 1 - (1 - p) * (1 - p);
            }
            case "drawn":
                return 1;
            case "shooting": {
                const { amplitude, frequency, decay } = TWANG;
                const t = this.elapsed;
                return -amplitude * Math.exp(-t / decay) * Math.sin(2 * Math.PI * frequency * t);
            }
            case "lowering": {
                const t = Math.min(1, this.elapsed / LET_DOWN_TIME);
                return this.letDownFrom * (1 - t * t * (3 - 2 * t));
            }
            default:
                return 0;
        }
    }

    /** An arrow sits on the string: from nocking until it leaves, and not until the bow is lowered after a shot. */
    get arrowNocked(): boolean {
        if (this.state === "shooting" || (this.state === "lowering" && this.emptyLowering)) {
            return false;
        }
        // The nocked arrow counts until it is shot.
        return this.arrows > 0;
    }

    /** Aim sway in radians (yaw, pitch) right now: none for 4 s after the draw (stability skill). */
    sway(time: number): [number, number] {
        if (this.state !== "drawn" || this.drawnFor < tuning.bowSteadyTime) {
            return [0, 0];
        }
        const a = Math.min(1, (this.drawnFor - tuning.bowSteadyTime) / tuning.bowSteadyTime) * tuning.bowSway;
        return [Math.sin(time * 1.3) * a, Math.sin(time * 1.9 + 1) * a * 0.6];
    }

    cancel(): void {
        this.state = "idle";
        this.elapsed = 0;
        this.zoom = 0;
        this.chain = false;
        this.letDownFrom = 0;
        this.emptyLowering = false;
        this.sinceRelease = Infinity;
    }

    /** Returns true in the update the arrow leaves the bow. */
    update(dt: number, input: BowInput): boolean {
        const pressed = input.attackDown && !this.wasDown;
        this.wasDown = input.attackDown;
        this.elapsed += dt;
        this.sinceRelease += dt;
        let shot = false;
        switch (this.state) {
            case "idle":
                if (input.attackDown && this.arrows > 0) {
                    this.startDraw(this.profile.drawReady);
                }
                break;
            case "drawing":
                if (!input.attackDown) {
                    this.letDown();
                } else if (this.elapsed >= this.readyAt) {
                    this.enter("drawn");
                    this.drawnFor = 0;
                }
                break;
            case "drawn":
                this.drawnFor += dt;
                if (!input.attackDown) {
                    this.release();
                    this.enter("shooting");
                    this.fired = false;
                    this.chain = false;
                }
                break;
            case "shooting":
                if (!this.fired && this.elapsed >= tuning.bowReleaseAt) {
                    this.fired = true;
                    this.arrows--;
                    shot = true;
                }
                this.chain ||= pressed || input.attackDown;
                if (this.elapsed >= tuning.bowShootTime) {
                    if (this.chain && this.arrows > 0) {
                        // Bow reload skill: the fast re-draw.
                        this.startDraw(this.profile.redrawReady);
                    } else {
                        this.enter("lowering");
                        this.emptyLowering = true;
                    }
                }
                break;
            case "lowering":
                if (this.elapsed >= tuning.bowLowerTime) {
                    this.enter("idle");
                }
                break;
        }
        this.zoom = input.aimDown ? Math.min(1, this.zoom + dt * 5) : Math.max(0, this.zoom - dt * 1);
        return shot;
    }

    private startDraw(readyAt: number): void {
        this.readyAt = readyAt;
        this.enter("drawing");
    }

    /** The draw ends: the held pose starts settling back from where it is. */
    private release(): void {
        this.releasedPose = this.poseProgress;
        this.sinceRelease = 0;
    }

    private letDown(): void {
        this.release();
        const pull = this.stringPull;
        this.enter("lowering");
        this.letDownFrom = pull;
    }

    private enter(state: BowState): void {
        this.state = state;
        this.elapsed = 0;
        this.letDownFrom = 0;
        this.emptyLowering = false;
    }
}

/** An arrow in flight. Positions in tiles; z is height. */
export type Arrow = {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    plane: number;
    age: number;
    /** Stuck in a wall or the ground: stays a while, then disappears. */
    stuck: boolean;
    /** Seconds since it stuck. In flight it never disappears: it flies until it hits something. */
    stuckFor?: number;
    /** Gravity it falls under, tiles/s² (sv_gravity unless given at launch). */
    gravity?: number;
    /** A crossbow bolt rather than an arrow (drawn differently, flies the same). */
    bolt?: boolean;
    /** A spell rather than an arrow: drawn with its OSRS graphic (or an orb), no gravity, gone when it meets a wall. */
    spell?: { color: number; id?: string };
    /** The rolls made when it was shot; hits on NPCs with stats use them. */
    attack?: PlayerAttack;
};

/** Where an arrow hit a body. */
export type ArrowHit<T> = { body: Body<T>; arrow: Arrow; dirX: number; dirY: number };

/**
 * Launches an arrow along the view (spec 16.4): speed 2100 u/s under sv_gravity unless a profile
 * says otherwise (rangedProfile); pitched up more than 45° the pitch is scaled by 0.985
 * (mm_arrow_pitch_compensation).
 */
export function launchArrow(
    eye: { x: number; y: number; z: number; plane: number },
    yaw: number,
    pitch: number,
    profile: Pick<RangedProfile, "speed" | "gravity"> = { speed: tuning.arrowSpeed, gravity: tuning.gravity },
): Arrow {
    const start = (-45 * Math.PI) / 180;
    // Our pitch is positive looking up; the game's is positive looking down.
    let p = pitch;
    if (-p < start) {
        p *= (1 - ((start * 180) / Math.PI + 90) / 90) * 1.97;
    }
    const cos = Math.cos(p);
    const s = profile.speed;
    return {
        x: eye.x,
        y: eye.y,
        z: eye.z,
        vx: -Math.sin(yaw) * cos * s,
        vy: Math.cos(yaw) * cos * s,
        vz: Math.sin(p) * s,
        plane: eye.plane,
        age: 0,
        stuck: false,
        gravity: profile.gravity,
    };
}

/** Highest point (tiles, up positive) of whatever stands over a box of tiles, -Infinity if nothing. */
export type ObstacleTop = (minX: number, minY: number, maxX: number, maxY: number) => number;

/**
 * Where a segment first meets a wall, as a fraction t of the way along it, or undefined. A wall
 * stops it only below its top (`obstacleTop`), so it passes over fences and low walls; without
 * `obstacleTop` every wall is infinitely tall.
 */
export function firstWallHit(
    flagsAt: FlagsAt,
    plane: number,
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    obstacleTop?: ObstacleTop,
    boxes: Box[] = [],
): number | undefined {
    boxes.length = 0;
    collectTileBoxes(flagsAt, plane, Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), boxes, "walls");
    let wall: number | undefined;
    for (const box of boxes) {
        const t = segmentHitsBoxes2D(x0, y0, x1, y1, [box]);
        if (t === undefined || (wall !== undefined && t >= wall)) {
            continue;
        }
        // Clear over the top of what stands there (a fence, a low wall): no hit.
        const z = z0 + (z1 - z0) * t;
        if (obstacleTop && z > obstacleTop(box.minX, box.minY, box.maxX, box.maxY)) {
            continue;
        }
        wall = t;
    }
    return wall;
}

/**
 * Moves arrows under gravity (sv_gravity, [inferred]) and returns the bodies they hit. Walls and
 * the ground stop them; an arrow hits each body at most once and then disappears. With
 * `obstacleTop`, a wall stops an arrow only below its top, so arrows fly over fences and low walls;
 * without it every wall is infinitely tall.
 */
export function stepArrows<T>(
    arrows: Arrow[],
    dt: number,
    bodies: BodySource<T>,
    flagsAt: FlagsAt,
    groundHeight: (plane: number, x: number, y: number) => number,
    obstacleTop?: ObstacleTop,
    exclude?: unknown,
): ArrowHit<T>[] {
    const hits: ArrowHit<T>[] = [];
    const boxes: Box[] = [];
    const found: Body<T>[] = [];
    for (let i = arrows.length - 1; i >= 0; i--) {
        const a = arrows[i];
        a.age += dt;
        if (a.stuck) {
            a.stuckFor = (a.stuckFor ?? 0) + dt;
            if (a.stuckFor > tuning.arrowStuckTime) {
                arrows.splice(i, 1);
            }
            continue;
        }
        const x1 = a.x + a.vx * dt;
        const y1 = a.y + a.vy * dt;
        a.vz -= (a.gravity ?? tuning.gravity) * dt;
        const z1 = a.z + a.vz * dt;

        // Bodies first: the nearest cylinder the segment passes through.
        found.length = 0;
        bodies.collectBodies(a.plane, Math.min(a.x, x1) - 2, Math.min(a.y, y1) - 2, Math.max(a.x, x1) + 2, Math.max(a.y, y1) + 2, found);
        let best: { t: number; body: Body<T> } | undefined;
        for (const b of found) {
            if (b.owner === exclude) {
                continue;
            }
            const t = segmentCircle(a.x, a.y, x1, y1, b.x, b.y, b.radius);
            if (t === undefined || (best && t >= best.t)) {
                continue;
            }
            const z = a.z + (z1 - a.z) * t;
            if (z >= b.z && z <= b.z + b.height) {
                best = { t, body: b };
            }
        }
        const wall = firstWallHit(flagsAt, a.plane, a.x, a.y, a.z, x1, y1, z1, obstacleTop, boxes);
        if (best && (wall === undefined || best.t <= wall)) {
            const speed = Math.hypot(a.vx, a.vy) || 1;
            hits.push({ body: best.body, arrow: a, dirX: a.vx / speed, dirY: a.vy / speed });
            arrows.splice(i, 1);
            continue;
        }
        if (wall !== undefined) {
            a.x += (x1 - a.x) * wall;
            a.y += (y1 - a.y) * wall;
            a.z += (z1 - a.z) * wall;
            a.stuck = true;
            continue;
        }
        a.x = x1;
        a.y = y1;
        a.z = z1;
        const ground = groundHeight(a.plane, a.x, a.y);
        if (a.z <= ground) {
            a.z = ground;
            a.stuck = true;
        }
    }
    return hits;
}

/** First fraction t in [0, 1] where the segment enters the circle, or undefined. */
export function segmentCircle(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, r: number): number | undefined {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const fx = x0 - cx;
    const fy = y0 - cy;
    const a = dx * dx + dy * dy;
    const c = fx * fx + fy * fy - r * r;
    if (c <= 0) {
        return 0;
    }
    if (a < 1e-12) {
        return undefined;
    }
    const b = 2 * (fx * dx + fy * dy);
    const disc = b * b - 4 * a * c;
    if (disc < 0) {
        return undefined;
    }
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t >= 0 && t <= 1 ? t : undefined;
}
