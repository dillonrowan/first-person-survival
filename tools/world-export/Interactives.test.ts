import { describe, expect, it } from "vitest";

import { areGateLeaves, doorStates, gateLeafStates, hingeCorner, isBank, isClimbable, placedDoorState, wallFlags } from "./Interactives";

describe("door classification", () => {
    it("tells closed and open doors apart by their action", () => {
        expect(placedDoorState(["Open", undefined, "Examine"])).toBe("closed");
        expect(placedDoorState([undefined, "Close"])).toBe("open");
        expect(placedDoorState(["Talk-to"])).toBeUndefined();
    });

    it("accepts ladder and stair actions but not stiles", () => {
        expect(isClimbable(["Climb-up"])).toBe(true);
        expect(isClimbable([undefined, "Climb-down"])).toBe(true);
        expect(isClimbable(["Climb"])).toBe(true);
        expect(isClimbable(["Climb-over"])).toBe(false);
        expect(isClimbable(["Open"])).toBe(false);
    });
});

describe("wallFlags", () => {
    it("sets the edge flag on both tiles that share the edge", () => {
        // West edge of (10, 20): WEST on the tile, EAST on its western neighbour.
        expect(wallFlags(10, 20, 0)).toEqual(
            expect.arrayContaining([
                [10, 20, 0x80],
                [9, 20, 0x08],
            ]),
        );
        expect(wallFlags(10, 20, 0)).toHaveLength(2);
        // North edge: NORTH on the tile, SOUTH on the tile above.
        expect(wallFlags(10, 20, 1)).toEqual(
            expect.arrayContaining([
                [10, 20, 0x02],
                [10, 21, 0x20],
            ]),
        );
        // East and south edges.
        expect(wallFlags(10, 20, 2)).toEqual(
            expect.arrayContaining([
                [10, 20, 0x08],
                [11, 20, 0x80],
            ]),
        );
        expect(wallFlags(10, 20, 3)).toEqual(
            expect.arrayContaining([
                [10, 20, 0x20],
                [10, 19, 0x02],
            ]),
        );
    });
});

describe("doorStates", () => {
    it("hinges at the corner shared with the next edge", () => {
        expect(hingeCorner(10, 20, 0)).toEqual([10, 21]); // NW
        expect(hingeCorner(10, 20, 1)).toEqual([11, 21]); // NE
        expect(hingeCorner(10, 20, 2)).toEqual([11, 20]); // SE
        expect(hingeCorner(10, 20, 3)).toEqual([10, 20]); // SW
    });

    it("swings a closed door onto the next edge, counter-clockwise", () => {
        const door = doorStates(10, 20, 0, false);

        expect(door.hinge).toEqual([10, 21]);
        expect(door.swing).toBe(1);
        expect(door.rotationB).toBe(1);
        expect(door.flagsA).toEqual(wallFlags(10, 20, 0));
        expect(door.flagsB).toEqual(wallFlags(10, 20, 1));
    });

    it("works for every rotation, wrapping the last edge to the first", () => {
        for (let r = 0; r < 4; r++) {
            const door = doorStates(5, 5, r, false);
            expect(door.rotationB).toBe((r + 1) & 3);
            expect(door.hinge).toEqual(hingeCorner(5, 5, r));
        }
    });

    it("treats an open door as having swung clockwise from the previous edge", () => {
        const door = doorStates(10, 20, 1, true); // leaf lies on the north edge

        expect(door.placedOpen).toBe(true);
        expect(door.swing).toBe(-1);
        expect(door.rotationB).toBe(0); // closed on the west edge
        expect(door.hinge).toEqual(hingeCorner(10, 20, 0));
        expect(door.flagsA).toEqual(wallFlags(10, 20, 1));
        expect(door.flagsB).toEqual(wallFlags(10, 20, 0));
    });
});

describe("gates", () => {
    const leaf = (id: number, tileX: number, tileY: number, rotation = 0) => ({
        id, name: "Gate", tileX, tileY, rotation, placedOpen: false, plane: 0,
    });

    it("pairs two neighbouring leaves of one wall that have different ids", () => {
        expect(areGateLeaves(leaf(1558, 10, 20), leaf(1560, 10, 21))).toBe(true);
        expect(areGateLeaves(leaf(1558, 10, 20, 1), leaf(1560, 11, 20, 1))).toBe(true);
        expect(areGateLeaves(leaf(1558, 10, 20), leaf(1558, 10, 21))).toBe(false); // same id: two cell doors
        expect(areGateLeaves(leaf(1558, 10, 20), leaf(1560, 11, 20))).toBe(false); // not along the wall
        expect(areGateLeaves(leaf(1558, 10, 20), leaf(1560, 10, 21, 2))).toBe(false); // other rotation
    });

    it("hinges each leaf at the outer end of a west-edge gate and swings them to the same side", () => {
        const low = gateLeafStates(10, 20, 0, false);
        const high = gateLeafStates(10, 21, 0, true);

        expect(low.hinge).toEqual([10, 20]); // south end
        expect(high.hinge).toEqual([10, 22]); // north end
        expect(low.swing).toBe(-1);
        expect(high.swing).toBe(1);
        expect(low.rotationB).toBe(3); // south edge
        expect(high.rotationB).toBe(1); // north edge
        expect(low.placedOpen).toBe(false);
        expect(low.flagsA).toEqual(wallFlags(10, 20, 0));
        expect(low.flagsB).toEqual(wallFlags(10, 20, 3));
    });

    it("puts the hinges at the outer ends for every rotation", () => {
        // [rotation, low leaf tile, high leaf tile, expected outer ends]
        const cases: [number, [number, number], [number, number], [number, number], [number, number]][] = [
            [0, [10, 20], [10, 21], [10, 20], [10, 22]],
            [2, [10, 20], [10, 21], [11, 20], [11, 22]],
            [1, [10, 20], [11, 20], [10, 21], [12, 21]],
            [3, [10, 20], [11, 20], [10, 20], [12, 20]],
        ];
        for (const [rotation, lowTile, highTile, lowEnd, highEnd] of cases) {
            expect(gateLeafStates(...lowTile, rotation, false).hinge).toEqual(lowEnd);
            expect(gateLeafStates(...highTile, rotation, true).hinge).toEqual(highEnd);
        }
    });
});

describe("isBank", () => {
    it("finds bank booths and chests but not deposit boxes", () => {
        expect(isBank("Bank booth", ["Bank", undefined, "Collect"])).toBe(true);
        expect(isBank("Bank chest", ["Use"])).toBe(true);
        expect(isBank("Bank deposit box", ["Deposit"])).toBe(false);
        expect(isBank("Door", ["Open"])).toBe(false);
    });
});
