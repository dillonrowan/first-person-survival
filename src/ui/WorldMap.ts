import type { MapManifest } from "../world/MapFormat";
import type { SkillsManifest } from "../world/SkillFormat";

/** Marker colour per rune altar; others use the default. */
const RUNE_COLORS: Record<string, string> = {
    Air: "#e8eef2",
    Mind: "#e39a3b",
    Water: "#3f8fe0",
    Earth: "#9b6b3c",
    Fire: "#e2462f",
    Body: "#5fb6b0",
    Cosmic: "#e6d65a",
    Chaos: "#c9a227",
    Nature: "#4fae4a",
    Law: "#4b5fd1",
    Death: "#d8d8d8",
    Blood: "#a3152a",
    Wrath: "#7c1f2b",
    Astral: "#a7b8e8",
};
const DEFAULT_COLOR = "#c8a2ff";
/** Screen pixels per tile: the limits of the wheel zoom, and the zoom on opening. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 16;
const OPEN_ZOOM = 3;
/** Rocks or fishing spots this many tiles apart or closer are one site on the map. */
const SITE_RADIUS = 6;
/** Zoom (screen pixels per tile) from which site names are drawn. */
const SITE_LABEL_ZOOM = 2;
const MINING_COLOR = "#b9a58c";
const FISHING_COLOR = "#3fc1e0";

type Marker = { label: string; detail: string; x: number; y: number; color: string };
type Position = { x: number; y: number; plane: number };
type SiteKind = "mining" | "fishing";
type Site = { label: string; x: number; y: number };

/**
 * Joins points into sites: two points `radius` tiles apart or closer (on both axes) share a site,
 * so a chain of rocks across a mine is one site. Each site sits at its points' centre, named by
 * their distinct tags in first-seen order.
 */
export function clusterSites(points: { x: number; y: number; tag: string }[], radius = SITE_RADIUS): Site[] {
    const parent = points.map((_, i) => i);
    const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            if (Math.abs(points[i].x - points[j].x) <= radius && Math.abs(points[i].y - points[j].y) <= radius) parent[root(j)] = root(i);
        }
    }
    const groups = new Map<number, { sx: number; sy: number; n: number; tags: string[] }>();
    points.forEach((p, i) => {
        const r = root(i);
        let g = groups.get(r);
        if (!g) groups.set(r, (g = { sx: 0, sy: 0, n: 0, tags: [] }));
        g.sx += p.x;
        g.sy += p.y;
        g.n++;
        if (!g.tags.includes(p.tag)) g.tags.push(p.tag);
    });
    return [...groups.values()].map((g) => ({ label: g.tags.join(", "), x: g.sx / g.n + 0.5, y: g.sy / g.n + 0.5 }));
}

/**
 * The world map (M): the image export-map renders, dragged to pan and wheeled to zoom, with the
 * player, the essence altars (their mysterious ruins), mining sites and fishing spots marked.
 */
export class WorldMap {
    closed?: () => void;

    private readonly canvas: HTMLCanvasElement;
    private readonly status: HTMLElement;
    private readonly markers: Marker[];
    private readonly sites: Record<SiteKind, Site[]> = { mining: [], fishing: [] };
    private readonly shown: Record<SiteKind, boolean> = { mining: true, fishing: true };
    private manifest?: MapManifest;
    private image?: HTMLImageElement;
    private loading?: Promise<void>;
    /** View centre in world tiles, and screen pixels per tile. */
    private cx = 0;
    private cy = 0;
    private zoom = OPEN_ZOOM;
    private drag?: { id: number; x: number; y: number };
    private timer = 0;

    constructor(
        private readonly element: HTMLElement,
        /** Folder holding map.json, ending in "/". */
        private readonly worldUrl: string,
        skills: SkillsManifest,
        private readonly player: () => Position,
    ) {
        this.markers = skills.runecraft.altars
            .filter((a) => a.ruins)
            .map((a) => ({ label: `${a.rune} altar`, detail: `Runecraft ${a.level}`, x: a.ruins!.x + 1.5, y: a.ruins!.y + 1.5, color: RUNE_COLORS[a.rune] ?? DEFAULT_COLOR }));
        // A fishing spot is named by its actions ("Net, Bait"); one spot NPC can have several.
        const actions = (npcId: number) => skills.fishing.filter((f) => f.npcIds.includes(npcId)).map((f) => f.action);
        this.sites.fishing = clusterSites(
            skills.fishingSpots.filter((s) => s.plane === 0).flatMap((s) => actions(s.npcId).map((tag) => ({ x: s.x, y: s.y, tag }))),
        );

        const heading = document.createElement("div");
        heading.className = "choice-heading";
        const title = document.createElement("strong");
        title.textContent = "World map";
        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "Close";
        close.addEventListener("click", () => this.close());
        heading.append(title, close);

        const body = document.createElement("div");
        body.className = "world-map-body";
        this.canvas = document.createElement("canvas");
        this.canvas.setAttribute("aria-label", "Map of the world; drag to pan, scroll to zoom");
        const legend = document.createElement("div");
        legend.className = "world-map-legend";
        legend.append(this.legendButton("You", "#ffe14d", "Centre on yourself", () => this.centreOn(this.player())));
        const altarsHeading = document.createElement("h3");
        altarsHeading.textContent = "Essence altars";
        legend.append(altarsHeading);
        for (const m of this.markers) legend.append(this.legendButton(m.label, m.color, m.detail, () => this.centreOn(m)));
        const layersHeading = document.createElement("h3");
        layersHeading.textContent = "Show";
        legend.append(layersHeading, this.layerToggle("mining", "Mining sites", MINING_COLOR), this.layerToggle("fishing", "Fishing spots", FISHING_COLOR));
        this.status = document.createElement("p");
        this.status.className = "world-map-status";
        legend.append(this.status);
        body.append(this.canvas, legend);
        element.append(heading, body);

        this.canvas.addEventListener("pointerdown", (e) => {
            this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
            this.canvas.setPointerCapture(e.pointerId);
        });
        this.canvas.addEventListener("pointermove", (e) => {
            if (this.drag?.id !== e.pointerId) return;
            this.cx -= (e.clientX - this.drag.x) / this.zoom;
            this.cy += (e.clientY - this.drag.y) / this.zoom;
            this.drag.x = e.clientX;
            this.drag.y = e.clientY;
            this.render();
        });
        const endDrag = (e: PointerEvent) => {
            if (this.drag?.id === e.pointerId) this.drag = undefined;
        };
        this.canvas.addEventListener("pointerup", endDrag);
        this.canvas.addEventListener("pointercancel", endDrag);
        this.canvas.addEventListener(
            "wheel",
            (e) => {
                e.preventDefault();
                // Zoom about the point under the cursor.
                const rect = this.canvas.getBoundingClientRect();
                const ox = e.clientX - rect.left - rect.width / 2;
                const oy = e.clientY - rect.top - rect.height / 2;
                const before = { x: this.cx + ox / this.zoom, y: this.cy - oy / this.zoom };
                this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * Math.exp(-e.deltaY * 0.0015)));
                this.cx = before.x - ox / this.zoom;
                this.cy = before.y + oy / this.zoom;
                this.render();
            },
            { passive: false },
        );
        window.addEventListener("keydown", (e) => {
            if (this.isOpen && e.code === "Escape") this.close();
        });
        window.addEventListener("resize", () => this.isOpen && this.render());
    }

    get isOpen(): boolean {
        return !this.element.classList.contains("hidden");
    }

    toggle(): void {
        if (this.isOpen) this.close();
        else this.open();
    }

    open(): void {
        this.element.classList.remove("hidden");
        document.exitPointerLock();
        this.zoom = OPEN_ZOOM;
        this.centreOn(this.player());
        void this.load().then(() => this.render());
        // The player marker follows the player while the map is open.
        this.timer = window.setInterval(() => this.render(), 500);
    }

    close(): void {
        if (!this.isOpen) return;
        this.element.classList.add("hidden");
        clearInterval(this.timer);
        this.drag = undefined;
        this.closed?.();
    }

    private legendButton(label: string, color: string, title: string, onClick: () => void): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.title = title;
        const dot = document.createElement("span");
        dot.className = "world-map-dot";
        dot.style.background = color;
        button.append(dot, label);
        button.addEventListener("click", onClick);
        return button;
    }

    private layerToggle(kind: SiteKind, label: string, color: string): HTMLLabelElement {
        const row = document.createElement("label");
        row.className = "world-map-toggle";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = this.shown[kind];
        box.addEventListener("change", () => {
            this.shown[kind] = box.checked;
            this.render();
        });
        const dot = document.createElement("span");
        dot.className = "world-map-dot";
        dot.style.background = color;
        row.append(box, dot, label);
        return row;
    }

    private centreOn(p: { x: number; y: number }): void {
        this.cx = p.x;
        this.cy = p.y;
        this.render();
    }

    private load(): Promise<void> {
        this.loading ??= (async () => {
            const response = await fetch(`${this.worldUrl}map.json`);
            if (!response.ok) throw new Error(`map.json: HTTP ${response.status}`);
            const manifest = (await response.json()) as MapManifest;
            const image = new Image();
            image.src = `${this.worldUrl}${manifest.image}`;
            await image.decode();
            this.manifest = manifest;
            this.image = image;
            this.sites.mining = clusterSites((manifest.rocks ?? []).map((r) => ({ x: r.x, y: r.y, tag: r.name.replace(/ rocks?$/i, "") })));
        })().catch((e) => {
            console.warn("The world map could not be loaded", e);
            this.status.textContent = "No map image: run npm run export-map.";
        });
        return this.loading;
    }

    private onMap(p: { x: number; y: number }): boolean {
        const m = this.manifest;
        return !!m && p.x >= m.originX && p.y >= m.originY && p.x < m.originX + m.tilesX && p.y < m.originY + m.tilesY;
    }

    private render(): void {
        if (!this.isOpen) return;
        const canvas = this.canvas;
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
        }
        const g = canvas.getContext("2d")!;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = "#0e161e";
        g.fillRect(0, 0, width, height);
        // Screen point of a world tile position (north up).
        const sx = (x: number) => width / 2 + (x - this.cx) * this.zoom;
        const sy = (y: number) => height / 2 - (y - this.cy) * this.zoom;

        const m = this.manifest;
        if (m && this.image) {
            g.imageSmoothingEnabled = this.zoom < m.scale;
            const left = sx(m.originX);
            const top = sy(m.originY + m.tilesY);
            g.drawImage(this.image, left, top, m.tilesX * this.zoom, m.tilesY * this.zoom);
        }

        g.font = "600 12px system-ui, sans-serif";
        g.textAlign = "center";
        const label = (text: string, x: number, y: number) => {
            g.lineWidth = 3;
            g.strokeStyle = "#111";
            g.strokeText(text, x, y);
            g.fillStyle = "#fff";
            g.fillText(text, x, y);
        };
        // Mining sites as diamonds, fishing spots as rings; named once zoomed in.
        for (const kind of ["mining", "fishing"] as const) {
            if (!this.shown[kind]) continue;
            for (const site of this.sites[kind]) {
                const x = sx(site.x);
                const y = sy(site.y);
                if (x < -100 || y < -20 || x > width + 100 || y > height + 20) continue;
                g.beginPath();
                if (kind === "mining") {
                    g.moveTo(x, y - 5);
                    g.lineTo(x + 5, y);
                    g.lineTo(x, y + 5);
                    g.lineTo(x - 5, y);
                    g.closePath();
                    g.fillStyle = MINING_COLOR;
                    g.strokeStyle = "#111";
                    g.lineWidth = 1.5;
                    g.fill();
                    g.stroke();
                } else {
                    g.arc(x, y, 4, 0, Math.PI * 2);
                    g.strokeStyle = "#111";
                    g.lineWidth = 4;
                    g.stroke();
                    g.strokeStyle = FISHING_COLOR;
                    g.lineWidth = 2;
                    g.stroke();
                }
                if (this.zoom >= SITE_LABEL_ZOOM) label(site.label, x, y - 9);
            }
        }
        for (const marker of this.markers) {
            const x = sx(marker.x);
            const y = sy(marker.y);
            g.beginPath();
            g.arc(x, y, 6, 0, Math.PI * 2);
            g.fillStyle = marker.color;
            g.strokeStyle = "#111";
            g.lineWidth = 2;
            g.fill();
            g.stroke();
            label(marker.label, x, y - 11);
        }

        const p = this.player();
        const here = this.onMap(p);
        if (here) {
            const x = sx(p.x);
            const y = sy(p.y);
            g.beginPath();
            g.arc(x, y, 5, 0, Math.PI * 2);
            g.fillStyle = "#ffe14d";
            g.strokeStyle = "#111";
            g.lineWidth = 2;
            g.fill();
            g.stroke();
        }
        if (m) this.status.textContent = here ? `You are at ${Math.floor(p.x)}, ${Math.floor(p.y)}.` : "You are somewhere the map does not show.";
    }
}
