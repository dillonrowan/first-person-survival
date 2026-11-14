/** Damage flash timing (mm_player_damage_big_red_fade_*: hold 0.1 s, fade 1 s, alpha 128/255). */
const FLASH_HOLD = 0.1;
const FLASH_FADE = 1;
const FLASH_ALPHA = 128 / 255;
const HIT_MARKER_TIME = 0.18;
/** Seconds a hitsplat stays up. */
const SPLAT_TIME = 0.8;

export type CombatHudState = {
    health: number;
    stamina: number;
    adrenaline: number;
    /** 0..1 while the attack button is held; 1 once charged. */
    charge: number;
    weaponName: string;
    /** The shield held, if any. */
    shieldName?: string;
    /** False while the shield does not protect (a bow takes both hands). */
    shieldActive?: boolean;
    /** "7 / 10" */
    healthText?: string;
    /** "Style: Accurate" */
    styleName?: string;
    /** "Spell: Wind Strike" */
    spellName?: string;
};

/** Health, stamina and adrenaline bars, the charge ring, hit markers and the red damage flash. */
export class CombatHud {
    private readonly bars: Record<"health" | "stamina" | "adrenaline", HTMLElement>;
    private readonly charge: HTMLElement;
    private readonly hitMarker: HTMLElement;
    private readonly flash: HTMLElement;
    private readonly weapon: HTMLElement;
    private readonly shield: HTMLElement;
    private readonly healthText: HTMLElement;
    private readonly style: HTMLElement;
    private readonly spell: HTMLElement;
    private readonly hitSplat: HTMLElement;
    private readonly damageSplat: HTMLElement;
    private flashTime = Infinity;
    private hitTime = Infinity;
    private hitSplatTime = Infinity;
    private damageSplatTime = Infinity;

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
        this.shield = el("shield-name");
        this.healthText = el("health-text");
        this.style = el("combat-style");
        this.spell = el("spell-name");
        this.hitSplat = el("hit-splat");
        this.damageSplat = el("damage-splat");
    }

    /** The damage the player dealt, red; a missed attack is a blue 0. */
    showSplat(amount: number, missed: boolean): void {
        this.hitSplatTime = 0;
        this.hitSplat.textContent = String(missed ? 0 : amount);
        this.hitSplat.classList.toggle("miss", missed || amount <= 0);
    }

    /** Shows a hit marker; `heavy` hits make it larger. */
    showHit(heavy: boolean): void {
        this.hitTime = 0;
        this.hitMarker.classList.toggle("heavy", heavy);
    }

    /**
     * Starts the red flash for a hit taken. With an amount it also shows the hitsplat next to the
     * health bar; a missed hit (0) flashes nothing.
     */
    showDamage(amount?: number, missed = false): void {
        if (amount !== undefined) {
            this.damageSplatTime = 0;
            this.damageSplat.textContent = String(missed ? 0 : amount);
            this.damageSplat.classList.toggle("miss", missed || amount <= 0);
        }
        if (!missed && (amount === undefined || amount > 0)) {
            this.flashTime = 0;
        }
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
        this.shield.textContent = state.shieldName ? `Shield: ${state.shieldName}` : "";
        this.shield.classList.toggle("inactive", state.shieldActive === false);
        this.healthText.textContent = state.healthText ?? "";
        this.style.textContent = state.styleName ?? "";
        this.spell.textContent = state.spellName ?? "";

        this.hitSplatTime += dt;
        this.hitSplat.style.opacity = this.hitSplatTime < SPLAT_TIME ? "1" : "0";
        this.damageSplatTime += dt;
        this.damageSplat.style.opacity = this.damageSplatTime < SPLAT_TIME ? "1" : "0";

        this.hitTime += dt;
        this.hitMarker.style.opacity = this.hitTime < HIT_MARKER_TIME ? "1" : "0";

        this.flashTime += dt;
        const t = this.flashTime;
        const alpha = t < FLASH_HOLD ? FLASH_ALPHA : Math.max(0, FLASH_ALPHA * (1 - (t - FLASH_HOLD) / FLASH_FADE));
        this.flash.style.opacity = String(alpha);
    }
}
