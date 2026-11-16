import { SHIELDS, ShieldDef } from "../combat/Shields";
import { SKILLS, SKILL_NAMES, type SkillId } from "../combat/Skills";
import type { ItemDb } from "../items/ItemDb";
import type { CacheWeaponInfo } from "../world/CacheWeaponFormat";

/** The item search of the developer menu: click gives one, shift-click a hundred. */
export type ItemCheat = { db: ItemDb; list: HTMLElement; give(id: number, qty: number): void };
/** The Skills tab of the developer menu: every skill's base level, editable. */
export type SkillCheat = { list: HTMLElement; level(id: SkillId): number; setLevel(id: SkillId, level: number): void };

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
        private readonly itemCheat?: ItemCheat,
        private readonly skillCheat?: SkillCheat,
    ) {
        element.querySelector<HTMLButtonElement>("#weapon-menu-close")?.addEventListener("click", () => this.close());
        for (const tab of element.querySelectorAll<HTMLButtonElement>(".weapon-menu-tabs [data-tab]")) {
            tab.addEventListener("click", () => this.showTab(tab.dataset.tab!));
        }
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

    /** Every exported cache weapon. */
    get all(): readonly CacheWeaponInfo[] {
        return this.weapons;
    }

    open(): void {
        this.element.classList.remove("hidden");
        document.exitPointerLock();
        this.renderSkills();
        if (!this.search.closest(".weapon-menu-tab")?.classList.contains("hidden")) {
            this.search.focus();
            this.search.select();
        }
    }

    private showTab(name: string): void {
        for (const tab of this.element.querySelectorAll<HTMLElement>(".weapon-menu-tabs [data-tab]")) {
            tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
        }
        for (const panel of this.element.querySelectorAll<HTMLElement>(".weapon-menu-tab")) {
            panel.classList.toggle("hidden", panel.dataset.tab !== name);
        }
        if (name === "items") this.search.focus();
        if (name === "skills") this.renderSkills();
    }

    /** One level box per skill (1-99), plus a button that maxes them all. Levels are read fresh on each render. */
    private renderSkills(): void {
        const cheat = this.skillCheat;
        if (!cheat) return;
        const maxAll = document.createElement("button");
        maxAll.type = "button";
        maxAll.className = "weapon-menu-row";
        maxAll.textContent = "Set all to 99";
        maxAll.addEventListener("click", () => {
            for (const id of SKILLS) cheat.setLevel(id, 99);
            this.renderSkills();
        });
        const rows = SKILLS.map((id) => {
            const row = document.createElement("label");
            row.className = "weapon-menu-row";
            const name = document.createElement("span");
            name.textContent = SKILL_NAMES[id];
            const input = document.createElement("input");
            input.type = "number";
            input.min = "1";
            input.max = "99";
            input.value = String(cheat.level(id));
            input.addEventListener("change", () => {
                const level = Math.round(Number(input.value));
                if (Number.isFinite(level)) cheat.setLevel(id, Math.min(99, Math.max(1, level)));
                input.value = String(cheat.level(id));
            });
            row.append(name, input);
            return row;
        });
        cheat.list.replaceChildren(...rows, maxAll);
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
        this.renderItems(normalized);
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

    /** The Items section: every cache item matching the search. */
    private renderItems(query: string): void {
        const cheat = this.itemCheat;
        if (!cheat) return;
        const title = document.createElement("div");
        title.className = "weapon-menu-section-title";
        title.textContent = query ? "Items (click: 1, shift-click: 100)" : "Items: type a name to search";
        const rows = cheat.db.search(query, 30).map((info) => {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "weapon-menu-row";
            const name = document.createElement("span");
            name.textContent = info.name;
            const id = document.createElement("span");
            id.textContent = `#${info.id}`;
            row.append(name, id);
            row.addEventListener("click", (e) => cheat.give(info.id, e.shiftKey ? 100 : 1));
            return row;
        });
        cheat.list.replaceChildren(title, ...rows);
    }
}
