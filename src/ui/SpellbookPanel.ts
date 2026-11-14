import type { PlayerSkills } from "../combat/Skills";
import { ALL_RUNES, SPELLS, SpellDef, Spellbook } from "../combat/Spells";

export type SpellRow = {
    id: string;
    name: string;
    level: number;
    maxHit: number;
    color: number;
    locked: boolean;
    selected: boolean;
    cost: string;
};

const RUNE_NAMES: Record<number, string> = Object.fromEntries(
    ALL_RUNES.map((id, i) => [id, ["Air", "Water", "Earth", "Fire", "Mind", "Chaos", "Death", "Blood", "Wrath", "Body", "Cosmic", "Nature", "Law", "Soul", "Astral"][i]]),
);

/** "3 Air · 4 Fire · 1 Chaos" */
export function costText(spell: SpellDef): string {
    return spell.runes.map((r) => `${r.count} ${RUNE_NAMES[r.item] ?? r.item}`).join(" · ");
}

/** What the spellbook lists at this Magic level; the panel renders from this alone. */
export function spellRows(spellbook: Spellbook, magicLevel: number): SpellRow[] {
    return SPELLS.map((s) => ({
        id: s.id,
        name: s.name,
        level: s.level,
        maxHit: s.maxHit,
        color: s.color,
        locked: !spellbook.unlocked(s, magicLevel),
        selected: spellbook.equipped.id === s.id,
        cost: costText(s),
    }));
}

/** The spellbook tab: click an unlocked spell to equip it (one at a time). */
export class SpellbookPanel {
    constructor(
        private readonly element: HTMLElement,
        private readonly spellbook: Spellbook,
        private readonly skills: PlayerSkills,
        private readonly onEquip: (spell: SpellDef) => void,
    ) {
        this.refresh();
    }

    refresh(): void {
        const buttons = spellRows(this.spellbook, this.skills.level("magic")).map((row) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `spell-row${row.locked ? " locked" : ""}${row.selected ? " selected" : ""}`;
            button.disabled = row.locked;
            const dot = document.createElement("i");
            dot.style.background = `#${row.color.toString(16).padStart(6, "0")}`;
            const name = document.createElement("span");
            name.textContent = row.name;
            const detail = document.createElement("small");
            detail.textContent = `Lvl ${row.level} · max ${row.maxHit} · ${row.cost}`;
            button.append(dot, name, detail);
            button.addEventListener("click", () => {
                if (this.spellbook.equip(row.id, this.skills.level("magic"))) {
                    this.refresh();
                    this.onEquip(this.spellbook.equipped);
                }
            });
            return button;
        });
        this.element.replaceChildren(...buttons);
    }
}
