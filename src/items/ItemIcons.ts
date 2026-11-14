import * as THREE from "three";

import type { ItemIcon, ItemInfo } from "../world/ItemFormat";
import type { NpcMeshData, NpcModelData } from "../world/NpcFormat";

/** The OSRS inventory sprite: 36 x 32 pixels, camera focal length 512, centre at pixel (16, 16). */
export const ICON_WIDTH = 36;
export const ICON_HEIGHT = 32;
const FOCAL = 512;
const RS_UNITS_PER_TILE = 128;
const TURN = 2048;
/** The drop shadow colour of an inventory sprite. */
const SHADOW = [0x30, 0x20, 0x20, 0xff];

const angle = (a: number) => (a * 2 * Math.PI) / TURN;

/**
 * The transform of an item model into the icon camera (camera at the origin looking down -Z), in
 * the model space of the world shader (tiles, three.js axes). In RS units (y down) it is: turn by
 * zan about Z, by yan about Y, move by (xOffset, height / 2 + zoom sin(xan) + yOffset,
 * zoom cos(xan) + yOffset), then turn by xan about X (the OSRS client's item sprite code).
 */
export function iconMatrix(icon: ItemIcon, modelHeight: number): THREE.Matrix4 {
    const rz = new THREE.Matrix4();
    const ry = new THREE.Matrix4();
    const rx = new THREE.Matrix4();
    const t = new THREE.Matrix4();
    const z = angle(icon.zan);
    const y = angle(icon.yan);
    const x = angle(icon.xan);
    // RS rotations: z: x' = x cos + y sin, y' = -x sin + y cos; y: x' = x cos + z sin, z' = -x sin + z cos;
    // x: y' = y cos - z sin, z' = y sin + z cos.
    rz.set(Math.cos(z), Math.sin(z), 0, 0, -Math.sin(z), Math.cos(z), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    ry.set(Math.cos(y), 0, Math.sin(y), 0, 0, 1, 0, 0, -Math.sin(y), 0, Math.cos(y), 0, 0, 0, 0, 1);
    rx.set(1, 0, 0, 0, 0, Math.cos(x), -Math.sin(x), 0, 0, Math.sin(x), Math.cos(x), 0, 0, 0, 0, 1);
    t.makeTranslation(
        icon.xOffset,
        modelHeight / 2 + icon.zoom * Math.sin(x) + icon.yOffset,
        icon.zoom * Math.cos(x) + icon.yOffset,
    );
    const rs = new THREE.Matrix4().multiplyMatrices(rx, new THREE.Matrix4().multiplyMatrices(t, new THREE.Matrix4().multiplyMatrices(ry, rz)));
    // The world shader maps RS (x, y, z) to three (x, -y, -z) / 128.
    const s = new THREE.Matrix4().makeScale(1 / RS_UNITS_PER_TILE, -1 / RS_UNITS_PER_TILE, -1 / RS_UNITS_PER_TILE);
    const sInverse = s.clone().invert();
    return new THREE.Matrix4().multiplyMatrices(s, new THREE.Matrix4().multiplyMatrices(rs, sInverse));
}

/** Height of a model above its origin, RS units: the highest vertex (y is down). */
export function modelHeightOf(data: Pick<NpcModelData, "opaque" | "transparent">): number {
    let top = 0;
    for (const part of [data.opaque, data.transparent]) {
        for (let i = 1; i < part.positions.length; i += 4) top = Math.max(top, -part.positions[i]);
    }
    return top;
}

/** Every transparent pixel whose up-left neighbour is opaque becomes the sprite drop shadow. RGBA, top row first. */
export function addShadow(pixels: Uint8ClampedArray, width: number, height: number): void {
    const opaque = (x: number, y: number) => x >= 0 && y >= 0 && pixels[(y * width + x) * 4 + 3] > 0;
    const shadows: number[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!opaque(x, y) && opaque(x - 1, y - 1)) shadows.push((y * width + x) * 4);
        }
    }
    for (const i of shadows) pixels.set(SHADOW, i);
}

type Materials = { opaque: THREE.Material; transparent: THREE.Material };

/** Renders each item once into a 36 x 32 PNG data URL, as the OSRS client draws its inventory icons. */
export class ItemIcons {
    private readonly cache = new Map<string, Promise<string>>();
    private queue: Promise<unknown> = Promise.resolve();
    private readonly target = new THREE.WebGLRenderTarget(ICON_WIDTH, ICON_HEIGHT);
    private readonly camera = new THREE.PerspectiveCamera((2 * Math.atan(16 / FOCAL) * 180) / Math.PI, 1, 0.01, 1000);

    constructor(
        private readonly renderer: THREE.WebGLRenderer,
        private readonly materials: Materials,
        private readonly loadModel: (file: string) => Promise<NpcModelData>,
    ) {
        // A 32 x 32 projection centred on the sprite pixel (16, 16), seen through the 36 x 32 window.
        this.camera.setViewOffset(32, 32, 0, 0, ICON_WIDTH, ICON_HEIGHT);
    }

    get(info: ItemInfo): Promise<string> {
        const key = `${info.model}|${JSON.stringify(info.icon)}`;
        let icon = this.cache.get(key);
        if (!icon) {
            icon = this.loadModel(info.model).then((data) => {
                const next = this.queue.then(() => this.render(data, info.icon));
                this.queue = next.catch(() => undefined);
                return next;
            });
            this.cache.set(key, icon);
        }
        return icon;
    }

    private render(data: NpcModelData, icon: ItemIcon): string {
        const scene = new THREE.Scene();
        const holder = new THREE.Group();
        holder.matrixAutoUpdate = false;
        holder.matrix.copy(iconMatrix(icon, modelHeightOf(data)));
        for (const [part, transparent] of [[data.opaque, false], [data.transparent, true]] as [NpcMeshData, boolean][]) {
            if (part.indices.length === 0) continue;
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute("a_position", new THREE.BufferAttribute(new Int16Array(part.positions), 4));
            geometry.setAttribute("a_color", new THREE.BufferAttribute(part.colors, 4, true));
            geometry.setAttribute("a_uv", new THREE.BufferAttribute(part.uvs, 2));
            geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
            const mesh = new THREE.Mesh(geometry, transparent ? this.materials.transparent : this.materials.opaque);
            mesh.renderOrder = transparent ? 2 : 1;
            mesh.frustumCulled = false;
            holder.add(mesh);
        }
        scene.add(holder);

        const previousColor = new THREE.Color();
        this.renderer.getClearColor(previousColor);
        const previousAlpha = this.renderer.getClearAlpha();
        const previousTarget = this.renderer.getRenderTarget();
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.setRenderTarget(this.target);
        this.renderer.clear();
        this.renderer.render(scene, this.camera);
        const raw = new Uint8Array(ICON_WIDTH * ICON_HEIGHT * 4);
        this.renderer.readRenderTargetPixels(this.target, 0, 0, ICON_WIDTH, ICON_HEIGHT, raw);
        this.renderer.setRenderTarget(previousTarget);
        this.renderer.setClearColor(previousColor, previousAlpha);
        holder.traverse((o) => {
            if (o instanceof THREE.Mesh) o.geometry.dispose();
        });

        // The target's first row is the bottom: flip into top-first image rows.
        const pixels = new Uint8ClampedArray(raw.length);
        for (let y = 0; y < ICON_HEIGHT; y++) {
            pixels.set(raw.subarray((ICON_HEIGHT - 1 - y) * ICON_WIDTH * 4, (ICON_HEIGHT - y) * ICON_WIDTH * 4), y * ICON_WIDTH * 4);
        }
        addShadow(pixels, ICON_WIDTH, ICON_HEIGHT);
        const canvas = document.createElement("canvas");
        canvas.width = ICON_WIDTH;
        canvas.height = ICON_HEIGHT;
        canvas.getContext("2d")!.putImageData(new ImageData(pixels, ICON_WIDTH, ICON_HEIGHT), 0, 0);
        return canvas.toDataURL();
    }
}
