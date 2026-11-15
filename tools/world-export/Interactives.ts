import type { DoorData, FlagEntry } from "../../src/world/WorldFormat";
import { LocModelType } from "./rs/config/loctype/LocModelType";
import { CollisionMap } from "./rs/scene/CollisionMap";

/** Whether a door stands closed ("Open" action) or open ("Close" action) as placed in the cache. */
export function placedDoorState(actions: (string | undefined)[]): "closed" | "open" | undefined {
    const lower = actions.map((action) => action?.toLowerCase());
    if (lower.includes("open")) {
        return "closed";
    }
    return lower.includes("close") ? "open" : undefined;
}

/** Ladders and stairs: "Climb", "Climb-up" and "Climb-down" (not "Climb-over", which is a stile). */
/** Whether a loc is a bank booth or chest: a "Bank" action, or a bank chest that is used. */
export function isBank(name: string, actions: (string | undefined)[]): boolean {
    return (
        actions.some((a) => /^bank$/i.test(a ?? "")) ||
        (/^bank chest/i.test(name) && actions.some((a) => /^use$/i.test(a ?? "")))
    );
}

export function isClimbable(actions: (string | undefined)[]): boolean {
    return actions.some((action) => /^climb(-(up|down))?$/i.test(action ?? ""));
}

/** The corner shared by the edges of rotation r and r + 1 (0 west, 1 north, 2 east, 3 south). */
export function hingeCorner(tileX: number, tileY: number, rotation: number): [number, number] {
    return [
        [tileX, tileY + 1],
        [tileX + 1, tileY + 1],
        [tileX + 1, tileY],
        [tileX, tileY],
    ][rotation & 3] as [number, number];
}

const SCRATCH_SIZE = 9;
const SCRATCH_CENTER = 4;
const MOVEMENT_BITS = 0xff;

/** Movement flags a straight wall of the given rotation sets, as world-tile entries. */
export function wallFlags(tileX: number, tileY: number, rotation: number): FlagEntry[] {
    const map = new CollisionMap(SCRATCH_SIZE, SCRATCH_SIZE);
    map.addWall(SCRATCH_CENTER, SCRATCH_CENTER, LocModelType.WALL, rotation & 3, false);
    const entries: FlagEntry[] = [];
    for (let x = 0; x < SCRATCH_SIZE; x++) {
        for (let y = 0; y < SCRATCH_SIZE; y++) {
            const flags = map.getFlag(x, y) & MOVEMENT_BITS;
            if (flags !== 0) {
                entries.push([tileX + x - SCRATCH_CENTER, tileY + y - SCRATCH_CENTER, flags]);
            }
        }
    }
    return entries;
}

/** Door leaves of a double door or gate: one wall, two neighbouring tiles. */
export type LeafInfo = { id: number; name: string; tileX: number; tileY: number; rotation: number; placedOpen: boolean; plane: number };

/** Whether `low` and `high` are the two leaves of one double door or gate, `high` further along the wall. */
export function areGateLeaves(low: LeafInfo, high: LeafInfo): boolean {
    const r = low.rotation & 3;
    const alongY = (r & 1) === 0; // west and east edges run north-south
    return (
        low.plane === high.plane &&
        r === (high.rotation & 3) &&
        low.name === high.name &&
        low.id !== high.id &&
        !low.placedOpen &&
        !high.placedOpen &&
        (alongY
            ? low.tileX === high.tileX && high.tileY === low.tileY + 1
            : low.tileY === high.tileY && high.tileX === low.tileX + 1)
    );
}

/**
 * States of a gate leaf. A single door hinges at the corner its edge shares with the next edge,
 * which is the far end of the wall for west and north edges and the near end for east and south
 * edges. The leaf at the other end of a gate hinges at its own outer end instead and swings the
 * opposite way, so the two leaves open away from each other onto the same side.
 */
export function gateLeafStates(
    tileX: number,
    tileY: number,
    rotation: number,
    isHighLeaf: boolean,
): Omit<DoorData, "mesh"> {
    const r = rotation & 3;
    const standardIsHigh = r <= 1;
    if (isHighLeaf === standardIsHigh) {
        return doorStates(tileX, tileY, r, false);
    }
    return { ...doorStates(tileX, tileY, r, true), placedOpen: false };
}

/**
 * How a door on the edge `rotation` of a tile swings to its other state.
 *
 * A closed door swings counter-clockwise (seen from above) around the corner it shares with the
 * next edge, ending up on that edge. An open door is assumed to have swung that way from the
 * previous edge, so it swings clockwise around the corner it shares with the previous one. The
 * cache does not say which way an open door closes, so that case is a guess.
 */
export function doorStates(
    tileX: number,
    tileY: number,
    rotation: number,
    placedOpen: boolean,
): Omit<DoorData, "mesh"> {
    const r = rotation & 3;
    const closedRotation = placedOpen ? (r + 3) & 3 : r;
    const otherRotation = placedOpen ? closedRotation : (r + 1) & 3;
    return {
        placedOpen,
        hinge: hingeCorner(tileX, tileY, closedRotation),
        swing: placedOpen ? -1 : 1,
        rotationB: otherRotation,
        flagsA: wallFlags(tileX, tileY, r),
        flagsB: wallFlags(tileX, tileY, otherRotation),
    };
}
