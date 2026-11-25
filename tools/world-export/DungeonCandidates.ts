// Which placed locs can move the player between the surface and a dungeon (or between dungeon
// levels), and in which direction. Pure logic: the cache scan lives in find-dungeon-links.ts.

/** Verbs that move the player somewhere else. "Open" and "Close" only count for the names below. */
export const TRANSITION_VERBS = [
    "Climb", "Climb-up", "Climb-down", "Enter", "Exit", "Leave", "Go-down", "Go-up", "Walk-down", "Walk-up",
    "Descend", "Ascend", "Squeeze-through", "Crawl-through", "Climb-into", "Climb-through", "Jump-in",
    "Jump-down", "Go-through", "Pass", "Pass-through", "Slide-down",
];

/** Names of locs that tend to lead underground. */
export const TRANSITION_NAME = /cave|cavern|tunnel|hole|trap ?door|manhole|ladder|stair|steps|rope|crevice|entrance|exit|passage|grate|grill|pipe|chasm|gap/i;

export type Direction = "down" | "up";

const VERB_SET = new Set(TRANSITION_VERBS.map((verb) => verb.toLowerCase()));

/** The verbs of `actions` that are transition verbs, in their original case. */
export function transitionVerbs(actions: (string | undefined)[]): string[] {
    return actions.filter((a): a is string => !!a && VERB_SET.has(a.toLowerCase()));
}

/** Whether a loc state (name and actions) is a transition candidate. */
export function isCandidateState(name: string, actions: (string | undefined)[]): boolean {
    if (transitionVerbs(actions).length > 0) {
        return true;
    }
    const lower = actions.map((a) => a?.toLowerCase());
    return TRANSITION_NAME.test(name) && (lower.includes("open") || lower.includes("close"));
}

/** Which way a verb leads: down/in, up/out, or undefined when it depends on where it stands. */
export function verbDirection(verb: string): Direction | undefined {
    const v = verb.toLowerCase();
    if (/^(climb-down|go-down|walk-down|descend|slide-down|jump-in|jump-down|climb-into|enter)$/.test(v)) {
        return "down";
    }
    if (/^(climb-up|go-up|walk-up|ascend|exit|leave)$/.test(v)) {
        return "up";
    }
    return undefined;
}

/** Surface map squares have mapY <= 65; everything north of that is a dungeon, minigame or instance. */
export const SURFACE_MAX_MAP_Y = 65;

export function isSurfaceTile(y: number): boolean {
    return y >> 6 <= SURFACE_MAX_MAP_Y;
}

/** The loc states of a multiloc, or just the loc itself. */
export type StateInfo = { id: number; name: string; actions: string[] };

export type Candidate = {
    id: number;
    states: StateInfo[];
    x: number;
    y: number;
    /** Plane the loc is drawn on. */
    level: number;
    /** Plane its collision lives on (bridges remapped). */
    plane: number;
    type: number;
    rotation: number;
    sizeX: number;
    sizeY: number;
    mapFunctionId: number;
    surface: boolean;
};

/** Footprint in world tiles after rotation. */
export function footprint(c: Pick<Candidate, "x" | "y" | "sizeX" | "sizeY" | "rotation">): { x1: number; y1: number; x2: number; y2: number } {
    const swap = (c.rotation & 1) === 1;
    const w = swap ? c.sizeY : c.sizeX;
    const h = swap ? c.sizeX : c.sizeY;
    return { x1: c.x, y1: c.y, x2: c.x + w - 1, y2: c.y + h - 1 };
}
