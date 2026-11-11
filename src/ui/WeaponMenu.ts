import type { CacheWeaponInfo } from "../world/CacheWeaponFormat";

export class WeaponMenu {
    private weapons: CacheWeaponInfo[] = [];
    private selected = new Set<string>();

    constructor(
        private readonly element: HTMLElement,
        private readonly list: HTMLElement,
        private readonly status: HTMLElement,
        private readonly onEquip: (weapon: CacheWeaponInfo) => void,
        private readonly onClose: () => void,
        private readonly initialId?: string,
    ) {
        element.querySelector<HTMLButtonElement>("#weapon-menu-close")?.addEventListener("click", () => this.close());
    }

    async load(): Promise<void> {
        const response = await fetch(`${import.meta.env.BASE_URL}world/cache-weapons.json`);
        if (!response.ok) throw new Error(`Failed loading cache weapons: ${response.status} ${response.statusText}`);
        this.weapons = await response.json();
        if (this.initialId) this.selected.add(this.initialId);
        this.render("");
    }

    find(id: string): CacheWeaponInfo | undefined {
        return this.weapons.find((weapon) => weapon.id === id);
    }

    open(): void {
        this.element.classList.remove("hidden");
        document.exitPointerLock();
        this.list.querySelector<HTMLButtonElement>("button")?.focus();
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
