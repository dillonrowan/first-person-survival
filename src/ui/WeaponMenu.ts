import { SHIELDS, ShieldDef } from "../combat/Shields";
import type { CacheWeaponInfo } from "../world/CacheWeaponFormat";

export class WeaponMenu {
    private weapons: CacheWeaponInfo[] = [];
    private selected = new Set<string>();
    private shield: ShieldDef | undefined;
    private readonly search: HTMLInputElement;

    constructor(
        private readonly element: HTMLElement,
        private readonly list: HTMLElement,
        private readonly status: HTMLElement,
        private readonly onEquip: (weapon: CacheWeaponInfo) => void,
        private readonly onClose: () => void,
        private readonly initialId?: string,
        private readonly shieldList?: HTMLElement,
        private readonly onShield?: (shield: ShieldDef | undefined) => void,
    ) {
        element.querySelector<HTMLButtonElement>("#weapon-menu-close")?.addEventListener("click", () => this.close());
        this.search = element.querySelector<HTMLInputElement>("#weapon-menu-search")!;
        this.search.addEventListener("input", () => this.render(this.search.value));
        // Enter equips the top match, as Enter on a focused row does.
        this.search.addEventListener("keydown", (event) => {
            if (event.key === "Enter") this.list.querySelector<HTMLButtonElement>(".weapon-menu-row")?.click();
        });
        this.renderShields();
    }

    /** The shields section: one row per shield that equips or unequips it, whatever is searched. */
    private renderShields(): void {
        const section = this.shieldList;
        if (!section) return;
        section.replaceChildren();
        const title = document.createElement("div");
        title.className = "weapon-menu-section-title";
        title.textContent = "Shields";
        section.append(title);
        for (const shield of SHIELDS) {
            const held = this.shield === shield;
            const row = document.createElement("button");
            row.type = "button";
            row.className = `weapon-menu-row${held ? " selected" : ""}`;
            const name = document.createElement("span");
            name.textContent = shield.name;
            const state = document.createElement("span");
            state.textContent = held ? "Unequip" : "Equip";
            row.append(name, state);
            row.addEventListener("click", () => {
                this.shield = held ? undefined : shield;
                this.onShield?.(this.shield);
                this.renderShields();
            });
            section.append(row);
        }
    }

    async load(): Promise<void> {
        const response = await fetch(`${import.meta.env.BASE_URL}world/cache-weapons.json`);
        if (!response.ok) throw new Error(`Failed loading cache weapons: ${response.status} ${response.statusText}`);
        this.weapons = await response.json();
        if (this.initialId) this.selected.add(this.initialId);
        this.render(this.search.value);
    }

    find(id: string): CacheWeaponInfo | undefined {
        return this.weapons.find((weapon) => weapon.id === id);
    }

    open(): void {
        this.element.classList.remove("hidden");
        document.exitPointerLock();
        this.search.focus();
        this.search.select();
    }

    close(): void {
        this.element.classList.add("hidden");
        this.onClose();
    }

    toggle(): void {
        this.element.classList.contains("hidden") ? this.open() : this.close();
    }

    private render(query: string): void {
        this.list.replaceChildren();
        const normalized = query.trim().toLowerCase();
        const matches = this.weapons.filter((weapon) => weapon.name.toLowerCase().includes(normalized));
        this.status.textContent = `${matches.length} weapons`;
        for (const weapon of matches) {
            const row = document.createElement("button");
            row.type = "button";
            row.className = `weapon-menu-row${this.selected.has(weapon.id) ? " selected" : ""}`;
            const name = document.createElement("span");
            name.textContent = weapon.name;
            const equip = document.createElement("span");
            equip.textContent = this.selected.has(weapon.id) ? "Equipped" : "Equip";
            row.append(name, equip);
            row.addEventListener("click", () => {
                this.selected.clear();
                this.selected.add(weapon.id);
                this.onEquip(weapon);
                this.render(normalized);
            });
            this.list.append(row);
        }
    }
}
