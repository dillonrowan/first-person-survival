import type { ShopDef } from "../world/SkillFormat";

export const COINS = 995;

export type StockLine = { item: number; stock: number; base: number; price: number; shopPays: number; restockTicks: number };

/** What buying and selling may touch of the player's items. */
export type ShopCustomer = {
    count(id: number): number;
    canAdd(id: number, qty?: number): boolean;
    addItem(id: number, qty: number): number;
    removeItem(id: number, qty: number): number;
};

/**
 * One shop's stock: buying lowers it, selling raises it, and every line moves one toward its base
 * stock each `restockTicks`. Items the shop does not stock can be sold to it; they leave when the
 * shop closes with none left.
 */
export class ShopStock {
    readonly lines: StockLine[];

    constructor(readonly def: ShopDef) {
        this.lines = def.items.map((i) => ({ ...i, base: i.stock }));
    }

    tick(t: number): void {
        for (const line of this.lines) {
            if (t % line.restockTicks === 0 && line.stock !== line.base) line.stock += Math.sign(line.base - line.stock);
        }
        this.prune();
    }

    /** Sold-in lines that are gone again. */
    prune(): void {
        for (let i = this.lines.length - 1; i >= 0; i--) {
            if (this.lines[i].base === 0 && this.lines[i].stock <= 0) this.lines.splice(i, 1);
        }
    }

    /** Buys up to `qty`; returns a message when something stops it. */
    buy(index: number, qty: number, player: ShopCustomer): string | undefined {
        const line = this.lines[index];
        if (!line) return undefined;
        let bought = 0;
        let problem: string | undefined;
        while (bought < qty) {
            if (line.stock <= 0) {
                problem = "The shop has run out of stock.";
                break;
            }
            if (player.count(COINS) < line.price) {
                problem = "You don't have enough coins.";
                break;
            }
            if (!player.canAdd(line.item)) {
                problem = "You don't have enough inventory space.";
                break;
            }
            player.removeItem(COINS, line.price);
            player.addItem(line.item, 1);
            line.stock--;
            bought++;
        }
        return problem;
    }

    /** What the shop pays for an item: its own price, else 40% of `value`. */
    payFor(item: number, value: number): number {
        return this.lines.find((l) => l.item === item)?.shopPays ?? Math.floor(value * 0.4);
    }

    sell(item: number, qty: number, value: number, player: ShopCustomer): string | undefined {
        if (item === COINS) return "You can't sell this item to a shop.";
        const have = Math.min(qty, player.count(item));
        if (have <= 0) return undefined;
        const pays = this.payFor(item, value);
        player.removeItem(item, have);
        if (pays * have > 0) player.addItem(COINS, pays * have);
        const line = this.lines.find((l) => l.item === item);
        if (line) line.stock += have;
        else this.lines.push({ item, stock: have, base: 0, price: Math.max(1, Math.ceil(value)), shopPays: pays, restockTicks: 100 });
        return undefined;
    }
}
