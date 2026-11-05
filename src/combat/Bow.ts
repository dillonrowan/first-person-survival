import type { Body, BodySource } from "../physics/Bodies";
import { segmentHitsBoxes2D } from "../physics/Bodies";
import { Box, FlagsAt, collectTileBoxes } from "../physics/TileColliders";
import { tuning } from "./tuning";

export type BowState = "idle" | "drawing" | "drawn" | "shooting" | "lowering";

export type BowInput = {
    attackDown: boolean;
    /** Player speed, tiles/s (zoom needs standing nearly still). */
    speed: number;
};

/**
 * The bow (docs/combat-movement-spec.md 16.4), with all three bow skills. Holding attack draws an
 * arrow: 2.0 s layer, ready to fire at 1.433 s. Releasing once ready shoots (0.233 s, the arrow
 * leaves at 0.033 s); releasing earlier lowers the bow (0.667 s). Pressing again during or right
 * after a shot chains into the 1.0 s re-draw (ready at 0.933 s). Drawn and almost still, the view
 * zooms; the aim stays steady for 4 s after the draw, then sways.
 */
export class BowController {
    state: BowState = "idle";
    /** Seconds in the current state. */
    elapsed = 0;
    arrows = tuning.arrowsStart;
    /** 0..1 zoom amount, eased (zoom in rate 1/s, out 0.2/s as in mm_player_speed_zoom_in/_out × 5). */
    zoom = 0;
    private readyAt = tuning.bowDrawReady;
    private fired = false;
    private chain = false;
    private wasDown = false;
    private drawnFor = 0;

    /** 0..1 draw progress for the view model. */
    get drawProgress(): number {
        if (this.state === "drawing") {
            return Math.min(1, this.elapsed / this.readyAt);
        }
        return this.state === "drawn" ? 1 : 0;
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
    }

    /** Returns true in the update the arrow leaves the bow. */
    update(dt: number, input: BowInput): boolean {
        const pressed = input.attackDown && !this.wasDown;
        this.wasDown = input.attackDown;
        this.elapsed += dt;
        let shot = false;
        switch (this.state) {
            case "idle":
                if (input.attackDown && this.arrows > 0) {
                    this.startDraw(tuning.bowDrawReady);
                }
                break;
            case "drawing":
                if (!input.attackDown) {
                    this.enter("lowering");
                } else if (this.elapsed >= this.readyAt) {
                    this.enter("drawn");
                    this.drawnFor = 0;
                }
                break;
            case "drawn":
                this.drawnFor += dt;
                if (!input.attackDown) {
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
                        this.startDraw(tuning.bowReloadReady);
                    } else {
                        this.enter("lowering");
                    }
                }
                break;
            case "lowering":
                if (this.elapsed >= tuning.bowLowerTime) {
                    this.enter("idle");
                }
                break;
        }
        const wantZoom = this.state === "drawn" && input.speed < tuning.bowZoomSpeed;
        this.zoom = wantZoom ? Math.min(1, this.zoom + dt * 5) : Math.max(0, this.zoom - dt * 1);
        return shot;
    }

    private startDraw(readyAt: number): void {
        this.readyAt = readyAt;
        this.enter("drawing");
    }

    private enter(state: BowState): void {
        this.state = state;
        this.elapsed = 0;
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
};

/** Where an arrow hit a body. */
export type ArrowHit<T> = { body: Body<T>; arrow: Arrow; dirX: number; dirY: number };

const ARROW_LIFETIME = 10;

/**
 * Launches an arrow along the view (spec 16.4): speed 2100 u/s; pitched up more than 45° the pitch
 * is scaled by 0.985 (mm_arrow_pitch_compensation).
 */
export function launchArrow(eye: { x: number; y: number; z: number; plane: number }, yaw: number, pitch: number): Arrow {
    const start = (-45 * Math.PI) / 180;
    // Our pitch is positive looking up; the game's is positive looking down.
    let p = pitch;
    if (-p < start) {
        p *= (1 - ((start * 180) / Math.PI + 90) / 90) * 1.97;
    }
    const cos = Math.cos(p);
    const s = tuning.arrowSpeed;
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
    };
}

/**
 * Moves arrows under gravity (sv_gravity, [inferred]) and returns the bodies they hit. Walls and
 * the ground stop them; an arrow hits each body at most once and then disappears.
 */
export function stepArrows<T>(
    arrows: Arrow[],
    dt: number,
    bodies: BodySource<T>,
    flagsAt: FlagsAt,
    groundHeight: (plane: number, x: number, y: number) => number,
    exclude?: unknown,
): ArrowHit<T>[] {
    const hits: ArrowHit<T>[] = [];
    const boxes: Box[] = [];
    const found: Body<T>[] = [];
    for (let i = arrows.length - 1; i >= 0; i--) {
        const a = arrows[i];
        a.age += dt;
        if (a.age > ARROW_LIFETIME) {
            arrows.splice(i, 1);
            continue;
        }
        if (a.stuck) {
            continue;
        }
        const x1 = a.x + a.vx * dt;
        const y1 = a.y + a.vy * dt;
        a.vz -= tuning.gravity * dt;
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
        boxes.length = 0;
        collectTileBoxes(flagsAt, a.plane, Math.min(a.x, x1), Math.min(a.y, y1), Math.max(a.x, x1), Math.max(a.y, y1), boxes, "walls");
        const wall = segmentHitsBoxes2D(a.x, a.y, x1, y1, boxes);
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
function segmentCircle(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, r: number): number | undefined {
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
