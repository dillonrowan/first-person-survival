import type { PropMaterial } from "../../src/world/WorldFormat";

/** What a movable loc becomes: its propdata material and mass in kg. */
export type PropClass = { material: PropMaterial; mass: number };

/**
 * OSRS locs that become physics props, by their displayed name (docs/combat-movement-spec.md 19.1).
 * Dark Messiah sets a prop's mass in its collision model and its health by propdata class; the
 * OSRS cache has neither, so both come from this table [design]. A plural name ("Crates") is a
 * stack modelled as one object, so it weighs more.
 */
const PROP_CLASSES: [RegExp, PropClass][] = [
    [/^crate$/i, { material: "wood", mass: 40 }],
    [/^crates$/i, { material: "wood", mass: 100 }],
    [/^boxe?s?$/i, { material: "wood", mass: 20 }],
    [/^barrel$/i, { material: "wood", mass: 60 }],
    [/^barrels$/i, { material: "wood", mass: 150 }],
    [/^(cask|keg)$/i, { material: "wood", mass: 40 }],
    [/^chair$/i, { material: "wood", mass: 12 }],
    [/^stool$/i, { material: "wood", mass: 6 }],
    [/^bucket$/i, { material: "wood", mass: 4 }],
    [/^basket$/i, { material: "wood", mass: 3 }],
    [/^sacks?$/i, { material: "cloth", mass: 25 }],
    [/^(pot|jug|vase|urn)$/i, { material: "pottery", mass: 5 }],
    [/^pots$/i, { material: "pottery", mass: 12 }],
];

/** Props must fit one tile and be no taller than this many tiles. */
export const MAX_PROP_HEIGHT = 2.5;

/** The prop class of a loc with this displayed name, or undefined if it is not a movable prop. */
export function propClassFor(name: string): PropClass | undefined {
    const trimmed = name.trim();
    return PROP_CLASSES.find(([pattern]) => pattern.test(trimmed))?.[1];
}

/**
 * Size of a model around its origin in tiles: horizontal radius (largest distance of a vertex from
 * the vertical axis) and height above its lowest vertex. RS units, +y down.
 */
export function propExtent(
    verticesX: ArrayLike<number>,
    verticesY: ArrayLike<number>,
    verticesZ: ArrayLike<number>,
    count: number,
    unitsPerTile: number,
): { radius: number; height: number; bottom: number } {
    let radius2 = 0;
    let top = Infinity;
    let bottom = -Infinity;
    for (let i = 0; i < count; i++) {
        radius2 = Math.max(radius2, verticesX[i] * verticesX[i] + verticesZ[i] * verticesZ[i]);
        top = Math.min(top, verticesY[i]);
        bottom = Math.max(bottom, verticesY[i]);
    }
    if (count === 0) {
        return { radius: 0, height: 0, bottom: 0 };
    }
    return {
        radius: Math.sqrt(radius2) / unitsPerTile,
        height: (bottom - top) / unitsPerTile,
        bottom: -bottom / unitsPerTile,
    };
}
