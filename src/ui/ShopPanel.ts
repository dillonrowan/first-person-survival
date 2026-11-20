import type { ItemDb } from "../items/ItemDb";
import type { ItemIcons } from "../items/ItemIcons";
import type { PlayerItems } from "../items/PlayerItems";
import { ShopStock } from "../shops/Shops";
import type { ShopDef } from "../world/SkillFormat";
import { formatQuantity } from "./SidePanel";

type MenuEntry = { label: string; run: () => void };

/** The shop window: click a line to buy one, right click for more; sell from the inventory. */
export class ShopPanel {
    private readonly stocks = new Map<string, ShopStock>();
    private current?: ShopStock;
    closed?: () => void;
    message?: (text: string) => void;
    /** Opens the item menu (the side panel's) at a point. */
    showMenu?: (x: number, y: number, entries: MenuEntry[]) => void;

    constructor(
        private readonly element: HTMLElement,
        private readonly items: PlayerItems,
        private readonly db: ItemDb,
        private readonly icons: ItemIcons,
        /** Cache value per item id (shops.json). */
        private readonly values: Record<string, number>,
    ) {
        window.addEventListener("keydown", (e) => {
            if (this.isOpen && e.code === "Escape") this.close();
        });
    }

    get isOpen(): boolean {
        return !this.element.classList.contains("hidden");
    }

    /** Restocks every shop opened so far (once per game tick). */
    tick(t: number): void {
        for (const stock of this.stocks.values()) stock.tick(t);
        if (this.isOpen && t % 5 === 0) this.render();
    }

    open(def: ShopDef): void {
        let stock = this.stocks.get(def.name);
        if (!stock) {
            stock = new ShopStock(def);
            this.stocks.set(def.name, stock);
        }
        this.current = stock;
        this.element.classList.remove("hidden");
        document.exitPointerLock();
        this.render();
    }

    close(): void {
        if (!this.isOpen) return;
        this.current?.prune();
        this.element.classList.add("hidden");
        this.closed?.();
    }

    /** Sells from an inventory slot to the open shop. */
    sell(slot: number, qty: number): void {
        const stack = this.items.inventory.slots[slot];
        const shop = this.current;
        if (!stack || !shop) return;
        const problem = shop.sell(stack.id, qty, this.values[stack.id] ?? 1, this.items);
        if (problem) this.message?.(problem);
        this.render();
    }

    /** "Value" text of an inventory item in the open shop. */
    sellText(id: number): string {
        const shop = this.current;
        return shop ? `${this.db.get(id)?.name}: shop will buy for ${shop.payFor(id, this.values[id] ?? 1).toLocaleString()} coins` : "";
    }

    private render(): void {
        const shop = this.current;
        if (!shop) return;
        const heading = document.createElement("div");
        heading.className = "choice-heading";
        const title = document.createElement("strong");
        title.textContent = shop.def.name;
        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "Close";
        close.addEventListener("click", () => this.close());
        heading.append(title, close);
        const grid = document.createElement("div");
        grid.className = "grid bank-grid";
        shop.lines.forEach((line, i) => {
            const info = this.db.get(line.item);
            const slot = document.createElement("div");
            slot.className = `slot${line.stock <= 0 ? " out" : ""}`;
            slot.title = `${info?.name ?? "?"}: ${line.price.toLocaleString()} coins`;
            const img = document.createElement("img");
            if (info) this.icons.get(info).then((url) => (img.src = url)).catch(() => undefined);
            const qty = document.createElement("span");
            qty.className = "qty";
            qty.textContent = formatQuantity(line.stock);
            slot.append(img, qty);
            const buy = (n: number) => () => {
                const problem = shop.buy(i, n, this.items);
                if (problem) this.message?.(problem);
                this.render();
            };
            slot.addEventListener("click", (e) => (e.stopPropagation(), buy(1)()));
            slot.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showMenu?.(e.clientX, e.clientY, [
                    { label: "Value", run: () => this.message?.(`${info?.name}: currently costs ${line.price.toLocaleString()} coins.`) },
                    ...[1, 5, 10, 50].map((n) => ({ label: `Buy-${n}`, run: buy(n) })),
                ]);
            });
            grid.append(slot);
        });
        const hint = document.createElement("p");
        hint.className = "shop-hint";
        hint.textContent = "Click an item to buy one. Click an item in your inventory to sell it.";
        this.element.replaceChildren(heading, grid, hint);
    }
}
