import { xpForLevel } from "../combat/Osrs";
import { SKILLS, SKILL_NAMES, type PlayerSkills } from "../combat/Skills";

/** One row per skill (level, XP, XP to the next level) and the combat level. */
export class SkillsPanel {
    constructor(
        private readonly element: HTMLElement,
        private readonly skills: PlayerSkills,
    ) {
        this.refresh();
    }

    refresh(): void {
        const rows = SKILLS.map((id) => {
            const level = this.skills.level(id);
            const xp = this.skills.xp(id);
            const next = level >= 99 ? "max" : `${(xpForLevel(level + 1) - Math.floor(xp)).toLocaleString()} to next`;
            const row = document.createElement("div");
            row.className = "skill-row";
            const name = document.createElement("span");
            name.textContent = SKILL_NAMES[id];
            const lvl = document.createElement("strong");
            lvl.textContent = String(level);
            const detail = document.createElement("small");
            detail.textContent = `${Math.floor(xp).toLocaleString()} xp · ${next}`;
            row.append(name, lvl, detail);
            return row;
        });
        const combat = document.createElement("div");
        combat.className = "skill-combat";
        combat.textContent = `Combat level ${this.skills.combatLevel()}`;
        this.element.replaceChildren(...rows, combat);
    }
}
