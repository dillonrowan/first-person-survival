import { describe, expect, it } from "vitest";

import { formatQuantity } from "./SidePanel";

describe("formatQuantity", () => {
    it("shows the number below 100,000, then K and M like OSRS", () => {
        expect(formatQuantity(1)).toBe("1");
        expect(formatQuantity(99_999)).toBe("99999");
        expect(formatQuantity(100_000)).toBe("100K");
        expect(formatQuantity(9_999_999)).toBe("9999K");
        expect(formatQuantity(10_000_000)).toBe("10M");
    });
});
