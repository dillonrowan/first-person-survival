import { SKILL_NAMES, type SkillId } from "../combat/Skills";

const DROP_MS = 1500;
const BANNER_MS = 3000;

/** "+25 Woodcutting" drops floating up at the top right, and the level-up banner. */
export class XpDrops {
    private pending = new Map<SkillId, number>();
    private bannerTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly element: HTMLElement,
        private readonly banner: HTMLElement,
    ) {}

    /** Gains in one frame are merged per skill. */
    add(skill: SkillId, amount: number): void {
        if (this.pending.size === 0) requestAnimationFrame(() => this.flush());
        this.pending.set(skill, (this.pending.get(skill) ?? 0) + amount);
    }

    private flush(): void {
        for (const [skill, amount] of this.pending) {
            const drop = document.createElement("div");
            drop.className = "xp-drop";
            drop.textContent = `+${Math.round(amount * 10) / 10} ${SKILL_NAMES[skill]}`;
            this.element.append(drop);
            setTimeout(() => drop.remove(), DROP_MS);
        }
        this.pending.clear();
    }

    levelUp(skill: SkillId, level: number): string {
        const name = SKILL_NAMES[skill];
        const text = `Congratulations, you just advanced a ${name} level. Your ${name} level is now ${level}.`;
        this.banner.textContent = text;
        this.banner.classList.remove("hidden");
        clearTimeout(this.bannerTimer);
        this.bannerTimer = setTimeout(() => this.banner.classList.add("hidden"), BANNER_MS);
        return text;
    }
}
