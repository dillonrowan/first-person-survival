import type { ItemDb } from "../items/ItemDb";
import type { ItemIcons } from "../items/ItemIcons";
import type { MakeOption } from "../skills/SkillSystem";
import type { RecipeDef } from "../world/SkillFormat";

const QUANTITIES: [string, number][] = [
    ["1", 1],
    ["5", 5],
    ["10", 10],
    ["All", Infinity],
];

/** A bottom-centre panel of choices with item icons: the make-X menu and the build menu share it. */
abstract class ChoicePanel {
    protected onClosed?: () => void;

    constructor(
        protected readonly element: HTMLElement,
        protected readonly db: ItemDb,
        protected readonly icons: ItemIcons,
    ) {
        window.addEventListener("keydown", (e) => {
            if (this.isOpen && e.code === "Escape") this.close();
        });
    }

    get isOpen(): boolean {
        return !this.element.classList.contains("hidden");
    }

    /** Called when the panel closes (the game takes the mouse back). */
    set closed(fn: () => void) {
        this.onClosed = fn;
    }

    close(): void {
        if (!this.isOpen) return;
        this.element.classList.add("hidden");
        this.onClosed?.();
    }

    protected show(title: string, body: HTMLElement[]): void {
        const heading = document.createElement("div");
        heading.className = "choice-heading";
        const name = document.createElement("strong");
        name.textContent = title;
        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "Close";
        close.addEventListener("click", () => this.close());
        heading.append(name, close);
        this.element.replaceChildren(heading, ...body);
        this.element.classList.remove("hidden");
        document.exitPointerLock();
    }

    protected icon(itemId: number): HTMLImageElement {
        const img = document.createElement("img");
        const info = this.db.get(itemId);
        if (info) this.icons.get(info).then((url) => (img.src = url)).catch(() => undefined);
        img.alt = info?.name ?? "";
        return img;
    }
}

/** The OSRS make-X interface: pick an output and how many (1, 5, 10, X or All). */
export class MakeMenu extends ChoicePanel {
    private qty = Infinity;

    constructor(element: HTMLElement, db: ItemDb, icons: ItemIcons) {
        super(element, db, icons);
        window.addEventListener("keydown", (e) => {
            if (!this.isOpen || e.target instanceof HTMLInputElement) return;
            const n = Number(e.key);
            if (n >= 1 && n <= 9) this.element.querySelectorAll<HTMLButtonElement>(".choice-option:not(:disabled)")[n - 1]?.click();
        });
    }

    open(title: string, options: MakeOption[], onPick: (recipe: RecipeDef, qty: number) => void): void {
        const quantities = document.createElement("div");
        quantities.className = "choice-quantities";
        const buttons = QUANTITIES.map(([label, n]) => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = label;
            b.classList.toggle("active", n === this.qty);
            b.addEventListener("click", () => {
                this.qty = n;
                buttons.forEach((x) => x.classList.toggle("active", x === b));
                xInput.value = "";
            });
            return b;
        });
        const xInput = document.createElement("input");
        xInput.type = "number";
        xInput.min = "1";
        xInput.placeholder = "X";
        xInput.addEventListener("input", () => {
            const n = Math.floor(Number(xInput.value));
            if (n > 0) {
                this.qty = n;
                buttons.forEach((x) => x.classList.remove("active"));
            }
        });
        quantities.append(...buttons, xInput);
        const list = document.createElement("div");
        list.className = "choice-options";
        for (const option of options) {
            const r = option.recipe;
            const b = document.createElement("button");
            b.type = "button";
            b.className = "choice-option";
            b.disabled = !option.enabled;
            const label = document.createElement("span");
            label.textContent = `${r.output.qty > 1 ? `${r.output.qty} × ` : ""}${this.db.get(r.output.item)?.name ?? "?"}`;
            b.append(this.icon(r.output.item), label);
            if (!option.enabled) {
                const req = document.createElement("small");
                req.textContent = `Level ${r.level}`;
                b.append(req);
            }
            b.title = r.materials.map((m) => `${m.qty} × ${this.db.get(m.item)?.name ?? "?"}`).join(", ");
            b.addEventListener("click", () => {
                const qty = this.qty;
                this.close();
                onPick(r, qty);
            });
            list.append(b);
        }
        this.show(title, [list, quantities]);
    }
}
