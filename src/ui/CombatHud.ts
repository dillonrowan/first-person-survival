/** Damage flash timing (mm_player_damage_big_red_fade_*: hold 0.1 s, fade 1 s, alpha 128/255). */
const FLASH_HOLD = 0.1;
const FLASH_FADE = 1;
const FLASH_ALPHA = 128 / 255;
const HIT_MARKER_TIME = 0.18;

export type CombatHudState = {
    health: number;
    stamina: number;
    adrenaline: number;
    /** 0..1 while the attack button is held; 1 once charged. */
    charge: number;
    weaponName: string;
};

/** Health, stamina and adrenaline bars, the charge ring, hit markers and the red damage flash. */
export class CombatHud {
    private readonly bars: Record<"health" | "stamina" | "adrenaline", HTMLElement>;
    private readonly charge: HTMLElement;
    private readonly hitMarker: HTMLElement;
    private readonly flash: HTMLElement;
    private readonly weapon: HTMLElement;
    private flashTime = Infinity;
    private hitTime = Infinity;

    constructor(root: HTMLElement) {
        const el = (id: string) => {
            const found = root.querySelector<HTMLElement>(`#${id}`);
            if (!found) {
                throw new Error(`Missing #${id} in index.html`);
            }
            return found;
        };
        this.bars = {
            health: el("bar-health"),
            stamina: el("bar-stamina"),
            adrenaline: el("bar-adrenaline"),
        };
        this.charge = el("charge-ring");
        this.hitMarker = el("hit-marker");
        this.flash = el("damage-flash");
        this.weapon = el("weapon-name");
    }

    /** Shows a hit marker; `heavy` hits make it larger. */
    showHit(heavy: boolean): void {
        this.hitTime = 0;
        this.hitMarker.classList.toggle("heavy", heavy);
    }

    /** Starts the red flash for a big hit taken. */
    showDamage(): void {
        this.flashTime = 0;
    }

    update(dt: number, state: CombatHudState): void {
        const width = (bar: HTMLElement, f: number) => {
            bar.style.width = `${Math.round(Math.min(1, Math.max(0, f)) * 1000) / 10}%`;
        };
        width(this.bars.health, state.health);
        width(this.bars.stamina, state.stamina);
        width(this.bars.adrenaline, state.adrenaline);
        this.bars.adrenaline.classList.toggle("full", state.adrenaline >= 1);

        this.charge.style.opacity = state.charge > 0 ? "1" : "0";
        this.charge.style.setProperty("--charge", `${Math.round(state.charge * 360)}deg`);
        this.charge.classList.toggle("charged", state.charge >= 1);
        this.weapon.textContent = state.weaponName;

        this.hitTime += dt;
        this.hitMarker.style.opacity = this.hitTime < HIT_MARKER_TIME ? "1" : "0";

        this.flashTime += dt;
        const t = this.flashTime;
        const alpha = t < FLASH_HOLD ? FLASH_ALPHA : Math.max(0, FLASH_ALPHA * (1 - (t - FLASH_HOLD) / FLASH_FADE));
        this.flash.style.opacity = String(alpha);
    }
}
