import type { ItemDb } from "../items/ItemDb";
import type { Stack } from "../items/ItemContainer";
import type { ItemIcons } from "../items/ItemIcons";
import type { PlayerItems } from "../items/PlayerItems";
import type { EquipSlot, ItemInfo } from "../world/ItemFormat";

export type SidePanelTab = "inventory" | "equipment" | "skills" | "spellbook";

export type SidePanelHooks = {
    /** Eat the food in an inventory slot. */
    eat(slot: number): void;
    /** Put the stack on the ground at the player. */
    drop(stack: Stack): void;
    message(text: string): void;
    /** A panel closed: the game takes the mouse back. */
    closed(): void;
};

/** OSRS stack text: as is below 100,000, then "100K", and "10M" from ten million. */
export function formatQuantity(qty: number): string {
    if (qty >= 10_000_000) return `${Math.floor(qty / 1_000_000)}M`;
    if (qty >= 100_000) return `${Math.floor(qty / 1000)}K`;
    return String(qty);
}

/** The inventory slot layout of the Equipment tab (rows of the OSRS equipment screen). */
const EQUIPMENT_LAYOUT: (EquipSlot | null)[][] = [
    [null, "head", null],
    ["cape", "neck", "ammo"],
    ["weapon", "body", "shield"],
    [null, "legs", null],
    ["hands", "feet", "ring"],
];

type MenuEntry = { label: string; run: () => void };

/**
 * The Tab panel: Inventory (4 x 7 grid), Equipment, Skills and Spellbook tabs, and the bank beside
 * the inventory when a booth or banker is used. Left click runs an item's first action, right click
 * opens its menu, dragging swaps slots.
 */
export class SidePanel {
    private tab: SidePanelTab = "inventory";
    private bankOpen = false;
    private bankSearch = "";
    private dragFrom = -1;

    constructor(
        private readonly element: HTMLElement,
        private readonly bankElement: HTMLElement,
        private readonly menuElement: HTMLElement,
        private readonly items: PlayerItems,
        private readonly db: ItemDb,
        private readonly icons: ItemIcons,
        /** Refreshes of the skills and spellbook tabs, called whenever the panel is shown. */
        private readonly tabs: Record<"skills" | "spellbook", { refresh(): void }>,
        private readonly hooks: SidePanelHooks,
    ) {
        element.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) =>
            button.addEventListener("click", () => this.open(button.dataset.tab as SidePanelTab)),
        );
        // Clicking anywhere else closes the item menu.
        window.addEventListener("click", () => this.hideMenu());
        window.addEventListener("keydown", (e) => {
            if (e.code === "Escape" && this.bankOpen) this.closeBank();
        });
    }

    get isOpen(): boolean {
        return !this.element.classList.contains("hidden") || this.bankOpen;
    }

    open(tab: SidePanelTab): void {
        this.tab = tab;
        this.element.classList.remove("hidden");
        document.exitPointerLock();
        this.refresh();
    }

    close(): void {
        this.element.classList.add("hidden");
        this.closeBank(false);
        this.hideMenu();
        this.hooks.closed();
    }

    toggle(tab: SidePanelTab): void {
        if (!this.element.classList.contains("hidden") && this.tab === tab) this.close();
        else this.open(tab);
    }

    openBank(): void {
        this.bankOpen = true;
        this.bankElement.classList.remove("hidden");
        this.open("inventory");
    }

    closeBank(notify = true): void {
        if (!this.bankOpen) return;
        this.bankOpen = false;
        this.bankElement.classList.add("hidden");
        if (notify && this.element.classList.contains("hidden")) this.hooks.closed();
    }

    /** Redraws what is showing. */
    refresh(): void {
        if (this.element.classList.contains("hidden") && !this.bankOpen) return;
        this.element.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === this.tab));
        for (const id of ["inventory", "equipment", "skills", "spellbook"] as const) {
            this.element.querySelector<HTMLElement>(`#tab-${id}`)?.classList.toggle("hidden", id !== this.tab);
        }
        if (this.tab === "inventory") this.renderInventory();
        else if (this.tab === "equipment") this.renderEquipment();
        else this.tabs[this.tab].refresh();
        if (this.bankOpen) this.renderBank();
    }

    // ---------------------------------------------------------------- slots

    private slotElement(stack: Stack | null | undefined, onClick?: () => void, onMenu?: (x: number, y: number) => void): HTMLElement {
        const slot = document.createElement("div");
        slot.className = `slot${stack ? "" : " empty"}`;
        const info = stack && this.db.get(stack.id);
        if (stack && info) {
            slot.title = info.name;
            const img = document.createElement("img");
            img.alt = info.name;
            this.icons.get(info).then((url) => (img.src = url)).catch(() => (img.alt = `${info.name} (no icon)`));
            slot.append(img);
            if (stack.qty > 1) {
                const qty = document.createElement("span");
                qty.className = "qty";
                qty.textContent = formatQuantity(stack.qty);
                if (stack.qty >= 10_000_000) qty.classList.add("million");
                else if (stack.qty >= 100_000) qty.classList.add("thousand");
                slot.append(qty);
            }
            if (onClick) slot.addEventListener("click", (e) => (e.stopPropagation(), onClick()));
            if (onMenu) {
                slot.addEventListener("contextmenu", (e) => {
                    e.preventDefault();
                    onMenu(e.clientX, e.clientY);
                });
            }
        }
        return slot;
    }

    // ---------------------------------------------------------------- inventory

    private actionsOf(info: ItemInfo, slot: number): MenuEntry[] {
        const entries: MenuEntry[] = [];
        for (const action of info.actions) {
            if (action === "Wield" || action === "Wear") {
                entries.push({ label: action, run: () => this.report(this.items.wield(slot)) });
            } else if (action === "Eat") {
                entries.push({ label: action, run: () => this.hooks.eat(slot) });
            } else if (action === "Drop") {
                entries.push({
                    label: action,
                    run: () => {
                        const stack = this.items.drop(slot);
                        if (stack) this.hooks.drop(stack);
                    },
                });
            }
        }
        entries.push({ label: "Examine", run: () => this.hooks.message(info.examine || info.name) });
        return entries;
    }

    private report(message: string | undefined): void {
        if (message) this.hooks.message(message);
    }

    private renderInventory(): void {
        const grid = document.createElement("div");
        grid.className = "grid inventory-grid";
        this.items.inventory.slots.forEach((stack, i) => {
            const info = stack && this.db.get(stack.id);
            const actions = info ? this.actionsOf(info, i) : [];
            const slot = this.slotElement(
                stack,
                () => {
                    if (this.bankOpen && stack) this.items.deposit(i, 1);
                    else actions.find((a) => a.label !== "Examine" && a.label !== "Drop")?.run();
                },
                (x, y) =>
                    this.showMenu(
                        x,
                        y,
                        this.bankOpen && stack
                            ? [1, 5, 10, Infinity].map((n) => ({
                                  label: `Deposit-${n === Infinity ? "All" : n}`,
                                  run: () => this.items.deposit(i, n === Infinity ? stack.qty : n),
                              }))
                            : [...actions.filter((a) => a.label !== "Drop" && a.label !== "Examine"), ...actions.filter((a) => a.label === "Drop"), ...actions.filter((a) => a.label === "Examine")],
                    ),
            );
            slot.draggable = !!stack;
            slot.addEventListener("dragstart", () => (this.dragFrom = i));
            slot.addEventListener("dragover", (e) => e.preventDefault());
            slot.addEventListener("drop", (e) => {
                e.preventDefault();
                if (this.dragFrom >= 0 && this.dragFrom !== i) {
                    this.items.inventory.swap(this.dragFrom, i);
                    this.items.onChange?.();
                }
                this.dragFrom = -1;
            });
            grid.append(slot);
        });
        this.element.querySelector("#tab-inventory")!.replaceChildren(grid);
    }

    // ---------------------------------------------------------------- equipment

    private renderEquipment(): void {
        const wrap = document.createElement("div");
        const layout = document.createElement("div");
        layout.className = "equipment-layout";
        for (const row of EQUIPMENT_LAYOUT) {
            for (const slotName of row) {
                if (!slotName) {
                    layout.append(document.createElement("div"));
                    continue;
                }
                const worn = this.items.equipment.get(slotName);
                const slot = this.slotElement(worn, () => this.report(this.items.unequip(slotName)), (x, y) =>
                    this.showMenu(x, y, [{ label: "Remove", run: () => this.report(this.items.unequip(slotName)) }]),
                );
                if (!worn) slot.dataset.slot = slotName;
                layout.append(slot);
            }
        }
        const b = this.items.bonuses();
        const table = document.createElement("div");
        table.className = "bonus-table";
        const line = (label: string, values: string) => {
            const row = document.createElement("div");
            row.innerHTML = `<span></span><b></b>`;
            row.querySelector("span")!.textContent = label;
            row.querySelector("b")!.textContent = values;
            table.append(row);
        };
        line("Attack stab / slash / crush", `${b.stab} / ${b.slash} / ${b.crush}`);
        line("Attack magic / ranged", `${b.magic} / ${b.ranged}`);
        line("Defence stab / slash / crush", `${b.defStab} / ${b.defSlash} / ${b.defCrush}`);
        line("Defence magic / ranged", `${b.defMagic} / ${b.defRanged}`);
        line("Melee / ranged strength", `${b.strength} / ${b.rangedStrength}`);
        line("Magic damage", `${b.magicDamage}%`);
        wrap.append(layout, table);
        this.element.querySelector("#tab-equipment")!.replaceChildren(wrap);
    }

    // ---------------------------------------------------------------- bank

    private renderBank(): void {
        const heading = document.createElement("div");
        heading.className = "bank-heading";
        const title = document.createElement("strong");
        title.textContent = "Bank";
        const search = document.createElement("input");
        search.type = "search";
        search.placeholder = "Search";
        search.value = this.bankSearch;
        search.addEventListener("input", () => {
            this.bankSearch = search.value;
            this.renderBankGrid(grid);
        });
        const buttons = document.createElement("div");
        const depositAll = document.createElement("button");
        depositAll.textContent = "Deposit inventory";
        depositAll.addEventListener("click", () => this.items.depositAll());
        const depositWorn = document.createElement("button");
        depositWorn.textContent = "Deposit worn items";
        depositWorn.addEventListener("click", () => this.items.depositWorn());
        const close = document.createElement("button");
        close.textContent = "Close";
        close.addEventListener("click", () => this.closeBank());
        buttons.append(depositAll, depositWorn, close);
        heading.append(title, search, buttons);
        const grid = document.createElement("div");
        grid.className = "grid bank-grid";
        this.renderBankGrid(grid);
        this.bankElement.replaceChildren(heading, grid);
    }

    private renderBankGrid(grid: HTMLElement): void {
        const query = this.bankSearch.trim().toLowerCase();
        const slots: HTMLElement[] = [];
        this.items.bank.slots.forEach((stack, i) => {
            const info = stack && this.db.get(stack.id);
            if (!stack || !info || (query && !info.name.toLowerCase().includes(query))) return;
            const room = (n: number) => () => this.report(this.items.withdraw(i, n));
            slots.push(
                this.slotElement(stack, room(1), (x, y) =>
                    this.showMenu(x, y, [
                        { label: "Withdraw-1", run: room(1) },
                        { label: "Withdraw-5", run: room(5) },
                        { label: "Withdraw-10", run: room(10) },
                        { label: "Withdraw-All", run: room(stack.qty) },
                    ]),
                ),
            );
        });
        grid.replaceChildren(...slots);
    }

    // ---------------------------------------------------------------- menu

    private showMenu(x: number, y: number, entries: MenuEntry[]): void {
        this.menuElement.replaceChildren(
            ...[...entries, { label: "Cancel", run: () => undefined }].map((entry) => {
                const row = document.createElement("button");
                row.type = "button";
                row.textContent = entry.label;
                row.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.hideMenu();
                    entry.run();
                });
                return row;
            }),
        );
        this.menuElement.style.left = `${x}px`;
        this.menuElement.style.top = `${y}px`;
        this.menuElement.classList.remove("hidden");
    }

    private hideMenu(): void {
        this.menuElement.classList.add("hidden");
    }
}
