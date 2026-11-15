import type { ItemDb } from "./ItemDb";

export type Stack = { id: number; qty: number };

/** The most of one stack, as in OSRS. */
export const MAX_STACK = 2_147_483_647;

/**
 * A row of item slots: the 28-slot inventory, or the bank (`size` Infinity and `stackAll`, so every
 * item stacks and no slot is ever empty).
 */
export class ItemContainer {
    readonly slots: (Stack | null)[];

    constructor(
        readonly size: number,
        private readonly stackAll: boolean,
        private readonly db: Pick<ItemDb, "get">,
    ) {
        this.slots = Number.isFinite(size) ? Array.from({ length: size }, () => null) : [];
    }

    private stacks(id: number): boolean {
        return this.stackAll || !!this.db.get(id)?.stackable;
    }

    /** Adds `qty` of an item; returns how many did not fit. */
    add(id: number, qty: number): number {
        let left = qty;
        if (this.stacks(id)) {
            const existing = this.slots.find((s) => s?.id === id);
            if (existing) {
                const room = MAX_STACK - existing.qty;
                const moved = Math.min(room, left);
                existing.qty += moved;
                return left - moved;
            }
            const slot = this.firstEmpty();
            if (slot < 0) return left;
            const moved = Math.min(MAX_STACK, left);
            this.place(slot, { id, qty: moved });
            return left - moved;
        }
        while (left > 0) {
            const slot = this.firstEmpty();
            if (slot < 0) break;
            this.place(slot, { id, qty: 1 });
            left--;
        }
        return left;
    }

    /** Removes up to `qty` of an item from any slots; returns how many were removed. */
    remove(id: number, qty: number): number {
        let left = qty;
        for (let i = 0; i < this.slots.length && left > 0; i++) {
            const s = this.slots[i];
            if (s?.id !== id) continue;
            const taken = Math.min(s.qty, left);
            s.qty -= taken;
            left -= taken;
            if (s.qty === 0) this.clearSlot(i);
        }
        return qty - left;
    }

    /** Removes up to `qty` from one slot and returns what was taken. */
    removeAt(slot: number, qty = Infinity): Stack | null {
        const s = this.slots[slot];
        if (!s) return null;
        const taken = Math.min(s.qty, qty);
        s.qty -= taken;
        const out = { id: s.id, qty: taken };
        if (s.qty === 0) this.clearSlot(slot);
        return out;
    }

    count(id: number): number {
        return this.slots.reduce((sum, s) => sum + (s?.id === id ? s.qty : 0), 0);
    }

    freeSlots(): number {
        return Number.isFinite(this.size) ? this.slots.filter((s) => s === null).length : Infinity;
    }

    swap(a: number, b: number): void {
        if (a < 0 || b < 0 || a >= this.slots.length || b >= this.slots.length) return;
        [this.slots[a], this.slots[b]] = [this.slots[b], this.slots[a]];
    }

    clear(): void {
        if (Number.isFinite(this.size)) this.slots.fill(null);
        else this.slots.length = 0;
    }

    private firstEmpty(): number {
        if (!Number.isFinite(this.size)) return this.slots.length;
        return this.slots.findIndex((s) => s === null);
    }

    private place(slot: number, stack: Stack): void {
        this.slots[slot] = stack;
    }

    private clearSlot(slot: number): void {
        if (Number.isFinite(this.size)) this.slots[slot] = null;
        else this.slots.splice(slot, 1);
    }
}
