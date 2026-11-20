import type { FishingMinigame } from "../skills/FishingMinigame";

/**
 * The reeling minigame's bar: the catch zone, the darting fish and the catch meter under them.
 * Hidden while no fish is on the line.
 */
export class FishingBar {
    private readonly zone: HTMLElement;
    private readonly fish: HTMLElement;
    private readonly meter: HTMLElement;

    constructor(private readonly root: HTMLElement) {
        root.classList.add("hidden");
        root.innerHTML = `<div class="fishing-title">Hold to reel: keep the fish in the zone</div>
<div class="fishing-track"><div class="fishing-zone"></div><div class="fishing-fish">&#x1F41F;</div></div>
<div class="fishing-meter"><div class="fishing-meter-fill"></div></div>`;
        this.zone = root.querySelector(".fishing-zone")!;
        this.fish = root.querySelector(".fishing-fish")!;
        this.meter = root.querySelector(".fishing-meter-fill")!;
    }

    update(game: FishingMinigame | undefined): void {
        this.root.classList.toggle("hidden", !game);
        if (!game) return;
        this.zone.style.left = `${game.zoneAt * 100}%`;
        this.zone.style.width = `${game.zone * 100}%`;
        this.zone.classList.toggle("on-fish", game.fishInZone);
        this.fish.style.left = `${game.fishAt * 100}%`;
        this.meter.style.width = `${game.progress * 100}%`;
    }
}
