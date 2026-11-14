import * as THREE from "three";

import type { HitsplatAtlas, HitsplatKind } from "./HitsplatFormat";

/** Seconds a hitsplat stays up: 50 client cycles of 20 ms (the cache's display cycles). */
export const HITSPLAT_SECONDS = 1.0;
/** On-screen size of one sprite pixel; OSRS draws hitsplats at a fixed pixel size. */
const SCALE = 2;
/** Where on the screen the player's own hitsplats show (fractions of width and height). */
const PLAYER_ANCHOR = { x: 0.5, y: 0.66 };

/**
 * The OSRS layout of the up to four hitsplats on one character, in sprite pixels from its centre:
 * the first in the middle, the second above it, the third and fourth to the upper left and right.
 */
export const SLOT_OFFSETS: readonly [number, number][] = [
    [0, 0],
    [0, -20],
    [-15, -10],
    [15, -10],
];

/** The hitsplat of one hit: a miss or a 0 is the blue block splat, a max hit has its own. */
export function splatKind(hit: { missed: boolean; amount: number; maxHit?: boolean }): HitsplatKind {
    if (hit.missed || hit.amount <= 0) return "block";
    return hit.maxHit ? "max" : "damage";
}

/**
 * The slot for a new hitsplat among `ends` (when each slot's splat ends, -Infinity when free): the
 * first free slot, or else the one that ends soonest, as the OSRS client replaces the oldest.
 */
export function pickSlot(ends: readonly number[], now: number): number {
    const free = ends.findIndex((end) => end <= now);
    if (free >= 0) return free;
    let oldest = 0;
    for (let i = 1; i < ends.length; i++) {
        if (ends[i] < ends[oldest]) oldest = i;
    }
    return oldest;
}

/** Left edge of each digit of `amount` in a splat cell, centring the number. */
export function digitPositions(amount: number, atlas: Pick<HitsplatAtlas, "cell" | "glyphs">): { digit: number; x: number }[] {
    const digits = String(Math.max(0, Math.floor(amount))).split("").map(Number);
    const ink = digits.reduce((sum, d) => sum + atlas.glyphs.digits[d].advance, 0) - 1;
    let x = Math.floor((atlas.cell - ink) / 2);
    return digits.map((digit) => {
        const glyph = atlas.glyphs.digits[digit];
        const at = { digit, x: x - glyph.left };
        x += glyph.advance;
        return at;
    });
}

export type HitsplatArt = { image: CanvasImageSource; atlas: HitsplatAtlas };

/** Loads the atlas exported from the cache; undefined (simple fallback splats) when it is missing. */
export async function loadHitsplatArt(baseUrl: string): Promise<HitsplatArt | undefined> {
    try {
        const response = await fetch(`${baseUrl}ui/hitsplats.json`);
        if (!response.ok || !(response.headers.get("content-type") ?? "").includes("json")) return undefined;
        const atlas = (await response.json()) as HitsplatAtlas;
        const image = new Image();
        image.src = `${baseUrl}ui/${atlas.image}`;
        await image.decode();
        return { image, atlas };
    } catch {
        return undefined;
    }
}

const FALLBACK_COLORS: Record<HitsplatKind, string> = {
    damage: "#b00000",
    block: "#2020d0",
    poison: "#00a000",
    max: "#e04000",
    venom: "#207060",
};

/** Draws one hitsplat: the sprite, then the number, white over a black shadow one pixel down-right. */
export function drawHitsplat(art: HitsplatArt | undefined, kind: HitsplatKind, amount: number): HTMLCanvasElement {
    const cell = art?.atlas.cell ?? 25;
    const canvas = document.createElement("canvas");
    canvas.width = cell;
    canvas.height = cell;
    const g = canvas.getContext("2d")!;
    if (!art) {
        g.fillStyle = FALLBACK_COLORS[kind];
        g.beginPath();
        g.arc(cell / 2, cell / 2, cell / 2 - 1, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#fff";
        g.font = "bold 11px sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(String(amount), cell / 2, cell / 2 + 1);
        return canvas;
    }
    const { atlas, image } = art;
    const splat = atlas.splats[kind];
    g.drawImage(image, splat.x, splat.y, cell, cell, 0, 0, cell, cell);
    const { glyphs } = atlas;
    const top = Math.floor((cell - glyphs.height) / 2) + splat.textOffsetY;
    for (const { digit, x } of digitPositions(amount, atlas)) {
        const sx = glyphs.digits[digit].x;
        g.drawImage(image, sx, glyphs.blackY, glyphs.width, glyphs.height, x + 1, top + 1, glyphs.width, glyphs.height);
        g.drawImage(image, sx, glyphs.whiteY, glyphs.width, glyphs.height, x, top, glyphs.width, glyphs.height);
    }
    return canvas;
}

/** Something hitsplats can stand on: an NPC body (tiles, z up). */
export type SplatOwner = { body: { x: number; y: number; z: number; height: number } };

type Splat = { owner: SplatOwner | "player"; slot: number; end: number; element: HTMLCanvasElement };

/**
 * OSRS hitsplats: over the NPC that was hit (projected every frame, fixed pixel size, up to four
 * at once in the OSRS layout), and for the player, who is not on screen in first person, near the
 * bottom centre of the view.
 */
export class HitsplatLayer {
    private readonly root: HTMLElement;
    private readonly splats: Splat[] = [];
    private readonly slots = new Map<SplatOwner | "player", number[]>();
    private readonly anchor = new THREE.Vector3();
    private time = 0;

    constructor(
        documentRoot: HTMLElement,
        private readonly camera: THREE.Camera,
        private readonly art: HitsplatArt | undefined,
    ) {
        this.root = document.createElement("div");
        this.root.id = "hitsplats";
        documentRoot.appendChild(this.root);
    }

    addNpc(owner: SplatOwner, kind: HitsplatKind, amount: number): void {
        this.add(owner, kind, amount);
    }

    addPlayer(kind: HitsplatKind, amount: number): void {
        this.add("player", kind, amount);
    }

    get count(): number {
        return this.splats.length;
    }

    private add(owner: SplatOwner | "player", kind: HitsplatKind, amount: number): void {
        let ends = this.slots.get(owner);
        if (!ends) {
            ends = SLOT_OFFSETS.map(() => -Infinity);
            this.slots.set(owner, ends);
        }
        const slot = pickSlot(ends, this.time);
        // A splat replaced before its time goes at once.
        const replaced = this.splats.findIndex((s) => s.owner === owner && s.slot === slot);
        if (replaced >= 0) {
            this.splats[replaced].element.remove();
            this.splats.splice(replaced, 1);
        }
        ends[slot] = this.time + HITSPLAT_SECONDS;
        const element = drawHitsplat(this.art, kind, amount);
        element.className = `hitsplat hitsplat-${kind}`;
        element.style.width = `${element.width * SCALE}px`;
        element.style.height = `${element.height * SCALE}px`;
        this.root.appendChild(element);
        this.splats.push({ owner, slot, end: this.time + HITSPLAT_SECONDS, element });
    }

    update(dt: number): void {
        this.time += dt;
        this.camera.updateMatrixWorld();
        for (let i = this.splats.length - 1; i >= 0; i--) {
            const s = this.splats[i];
            if (this.time >= s.end) {
                s.element.remove();
                this.splats.splice(i, 1);
                continue;
            }
            let x: number;
            let y: number;
            if (s.owner === "player") {
                x = PLAYER_ANCHOR.x * window.innerWidth;
                y = PLAYER_ANCHOR.y * window.innerHeight;
            } else {
                // OSRS puts the splats halfway up the character.
                const b = s.owner.body;
                this.anchor.set(b.x, b.z + b.height * 0.5, -b.y).project(this.camera);
                if (this.anchor.z < -1 || this.anchor.z > 1 || Math.abs(this.anchor.x) > 1.2 || Math.abs(this.anchor.y) > 1.2) {
                    s.element.style.display = "none";
                    continue;
                }
                x = (this.anchor.x * 0.5 + 0.5) * window.innerWidth;
                y = (-this.anchor.y * 0.5 + 0.5) * window.innerHeight;
            }
            const [dx, dy] = SLOT_OFFSETS[s.slot];
            s.element.style.display = "";
            s.element.style.left = `${x + dx * SCALE}px`;
            s.element.style.top = `${y + dy * SCALE}px`;
        }
        for (const [owner, ends] of this.slots) {
            if (ends.every((end) => end <= this.time)) this.slots.delete(owner);
        }
    }
}
