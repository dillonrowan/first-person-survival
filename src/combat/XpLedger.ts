import type { XpGains } from "./CombatStyles";

/** The XP an NPC owes the player for the damage dealt to it, paid out when it dies. */
export class XpLedger {
    private totals: XpGains = {};

    add(gains: XpGains): void {
        for (const [key, value] of Object.entries(gains) as [keyof XpGains, number][]) {
            if (value > 0) this.totals[key] = (this.totals[key] ?? 0) + value;
        }
    }

    /** The totals so far; the ledger is cleared. */
    drain(): XpGains {
        const out = this.totals;
        this.totals = {};
        return out;
    }

    get empty(): boolean {
        return Object.keys(this.totals).length === 0;
    }
}
