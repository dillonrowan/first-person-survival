import { describe, expect, it } from "vitest";

import { clusterSites } from "./WorldMap";

describe("clusterSites", () => {
    it("joins nearby rocks into one named site and keeps distant ones apart", () => {
        const sites = clusterSites([
            { x: 100, y: 100, tag: "Copper" },
            { x: 102, y: 101, tag: "Tin" },
            { x: 104, y: 99, tag: "Copper" },
            { x: 109, y: 100, tag: "Gold" }, // joined through the copper at 104
            { x: 200, y: 100, tag: "Iron" },
        ]);
        expect(sites).toEqual([
            { label: "Copper, Tin, Gold", x: 104.25, y: 100.5 },
            { label: "Iron", x: 200.5, y: 100.5 },
        ]);
    });
});
