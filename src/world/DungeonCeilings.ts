// Ceilings over dungeons. OSRS draws no ceiling underground (the camera looks down from above), so
// in first person the dungeons would open onto black. Each floor tile of an underground region gets
// a ceiling piece at the height of the cave walls around it, in a set that fits the dungeon (rock,
// ice, lava rock, sewer brick, crypt stone, sandstone, masonry). The pieces are modelled in Blender
// (tools/ceilings/ceilings.blend) and exported to public/ceilings/ceilings.glb.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { type DungeonMap, dungeonNameAt } from "./MapFormat";
import { REGION_SIZE, type RegionListener } from "./WorldFormat";
import { isUnderground } from "./Ambience";

export type CeilingTheme = "cave" | "ice" | "lava" | "sewer" | "crypt" | "sandstone" | "masonry";

/** Name patterns of dungeons, first match wins; anything else is a cave. */
const THEMES: [RegExp, CeilingTheme | null][] = [
    // Not underground at all: open sky, other planes, minigame arenas.
    [/zanaris|abyss|puro-puro|tears of guthix|fisher realm|clan wars|lobby|hunter area|ungael|lithkren|isle of stone|harmony|tutorial|mos le'harmless|miscellania|jatizso|weiss|charred island|killerwatt/i, null],
    [/ice|frozen|trollweiss|glacier|snow/i, "ice"],
    [/lava|volcan|fire|king black dragon|mor ul rek|smoke|dragon forge|karamja/i, "lava"],
    [/sewer|pipe|drain/i, "sewer"],
    [/pyramid|amascut|sophanem|nardah|uzer|jaldraocht|jalsavrah|kalphite|scabaras|enakhra|desert|pollnivneach|menaphos/i, "sandstone"],
    [/crypt|tomb|catacomb|grave|rest|barrows|skeletal|necro|stronghold of security|ecto|slayer tower|mausoleum|theatre of blood|meyerditch|darkmeyer|haunted/i, "crypt"],
    [/castle|basement|cellar|guild|tower|clock|manor|keldagrim|dorgesh|prifddinas|chambers of xeric|archive|hideout|vault|temple/i, "masonry"],
];

/** The ceiling set of a dungeon by its name, or null for places with open sky. */
export function ceilingTheme(name: string): CeilingTheme | null {
    for (const [pattern, theme] of THEMES) if (pattern.test(name)) return theme;
    return "cave";
}

/** Height of the ceiling above the floor, tiles, where no cave walls give one. */
const DEFAULT_HEIGHT = 3;
const MIN_HEIGHT = 2.2;
const MAX_HEIGHT = 5;
/** Share of tiles that get the detailed piece (stalactites, ribs, beams). */
const DETAIL_SHARE = 0.3;

/** What the ceilings need of the world. */
export type CeilingWorld = {
    addRegionListener(listener: RegionListener): void;
    /** 1 where a level has a floor tile, (level * 64 + x) * 64 + y; undefined while unloaded. */
    regionFloors(mapX: number, mapY: number): Uint8Array | undefined;
    /** Floor height (tiles, up positive) of a tile on a drawn level. */
    levelHeight(level: number, x: number, y: number): number;
    /** Top of the loc models over a tile, tiles, or -Infinity. */
    obstacleTop(minX: number, minY: number, maxX: number, maxY: number): number;
};

const vertexShader = /* glsl */ `
varying vec3 vColor;
varying float vDistance;
void main() {
    vColor = vec3(color);
    vec4 view = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vDistance = length(view.xyz);
    gl_Position = projectionMatrix * view;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 u_fogColor;
uniform float u_fogNear;
uniform float u_fogFar;
varying vec3 vColor;
varying float vDistance;
void main() {
    // The vertex colours arrive linear; the world shader works in display colours.
    vec3 color = pow(vColor, vec3(1.0 / 2.2)) * 0.8;
    float fog = smoothstep(u_fogNear, u_fogFar, vDistance);
    gl_FragColor = vec4(mix(color, u_fogColor, fog), 1.0);
}`;

/** A small, stable hash of a tile, 0..1. */
function tileHash(x: number, y: number, salt: number): number {
    let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The floored tiles of a region: for each, its top level, or -1. */
export function topLevels(floors: Uint8Array, levels = 4): Int8Array {
    const out = new Int8Array(REGION_SIZE * REGION_SIZE).fill(-1);
    for (let level = 0; level < levels; level++) {
        for (let i = 0; i < REGION_SIZE * REGION_SIZE; i++) {
            if (floors[level * REGION_SIZE * REGION_SIZE + i]) out[i] = level;
        }
    }
    return out;
}

export class DungeonCeilings {
    private readonly pieces = new Map<string, THREE.BufferGeometry>();
    private readonly material: THREE.ShaderMaterial;
    private readonly regions = new Map<number, THREE.InstancedMesh[]>();
    private dungeons: Pick<DungeonMap, "name" | "squares" | "names" | "exits">[] = [];
    private ready = false;
    private readonly waiting: [number, number][] = [];

    constructor(
        private readonly world: CeilingWorld,
        private readonly scene: THREE.Scene,
        fog: { color: THREE.Vector3; near: number; far: number },
        assetUrl: string,
        mapUrl: string,
    ) {
        this.material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            vertexColors: true,
            side: THREE.DoubleSide,
            uniforms: { u_fogColor: { value: fog.color }, u_fogNear: { value: fog.near }, u_fogFar: { value: fog.far } },
        });
        world.addRegionListener({
            loaded: (mapX, mapY) => (this.ready ? this.build(mapX, mapY) : this.waiting.push([mapX, mapY])),
            unloaded: (mapX, mapY) => this.remove(mapX, mapY),
        });
        void Promise.all([
            new GLTFLoader().loadAsync(assetUrl).then((gltf) =>
                gltf.scene.traverse((node) => {
                    if (node instanceof THREE.Mesh) this.pieces.set(node.name, node.geometry);
                }),
            ),
            fetch(mapUrl)
                .then((r) => (r.ok ? r.json() : undefined))
                .then((map) => (this.dungeons = map?.dungeons ?? [])),
        ])
            .then(() => {
                this.ready = true;
                for (const [x, y] of this.waiting.splice(0)) this.build(x, y);
            })
            .catch((e) => console.warn("Dungeon ceilings could not be loaded", e));
    }

    /** The ceiling set over a map square, or null for none. */
    private themeAt(mapX: number, mapY: number): CeilingTheme | null {
        const area = this.dungeons.find((d) => d.squares.some(([x, y]) => x === mapX && y === mapY));
        // An area no dungeon link leads in or out of (a runecraft altar, an instance) is left open.
        if (!area || area.exits.length === 0) return null;
        return ceilingTheme(dungeonNameAt(area, mapX * REGION_SIZE, mapY * REGION_SIZE));
    }

    private build(mapX: number, mapY: number): void {
        const key = (mapX << 8) | mapY;
        if (this.regions.has(key) || !isUnderground(mapY * REGION_SIZE)) return;
        const floors = this.world.regionFloors(mapX, mapY);
        const theme = this.themeAt(mapX, mapY);
        const plain = theme && this.pieces.get(`${theme}_a`);
        const detail = theme && this.pieces.get(`${theme}_b`);
        if (!floors || !plain || !detail) return;

        const top = topLevels(floors);
        const baseX = mapX * REGION_SIZE;
        const baseY = mapY * REGION_SIZE;
        const height = this.wallHeight(top, baseX, baseY);
        const tiles: { x: number; y: number; level: number; detail: boolean }[] = [];
        for (let lx = 0; lx < REGION_SIZE; lx++) {
            for (let ly = 0; ly < REGION_SIZE; ly++) {
                const level = top[lx * REGION_SIZE + ly];
                if (level < 0) continue;
                const x = baseX + lx;
                const y = baseY + ly;
                tiles.push({ x, y, level, detail: tileHash(x, y, 1) < DETAIL_SHARE });
            }
        }
        const meshes: THREE.InstancedMesh[] = [];
        const matrix = new THREE.Matrix4();
        const rotation = new THREE.Matrix4();
        for (const [geometry, wanted] of [[plain, false], [detail, true]] as const) {
            const list = tiles.filter((t) => t.detail === wanted);
            if (list.length === 0) continue;
            const mesh = new THREE.InstancedMesh(geometry, this.material, list.length);
            list.forEach((t, i) => {
                const floor = this.world.levelHeight(t.level, t.x + 0.5, t.y + 0.5);
                rotation.makeRotationY(Math.floor(tileHash(t.x, t.y, 2) * 4) * (Math.PI / 2));
                matrix.makeTranslation(t.x + 0.5, floor + height, -(t.y + 0.5)).multiply(rotation);
                mesh.setMatrixAt(i, matrix);
            });
            mesh.instanceMatrix.needsUpdate = true;
            mesh.computeBoundingSphere();
            mesh.matrixAutoUpdate = false;
            this.scene.add(mesh);
            meshes.push(mesh);
        }
        this.regions.set(key, meshes);
    }

    /**
     * How high the walls of a region stand above the floor beside them (the median over its wall
     * tiles), so the ceiling meets their tops. Clamped; the default where nothing stands.
     */
    private wallHeight(top: Int8Array, baseX: number, baseY: number): number {
        const samples: number[] = [];
        for (let lx = 1; lx < REGION_SIZE - 1; lx += 2) {
            for (let ly = 1; ly < REGION_SIZE - 1; ly += 2) {
                if (top[lx * REGION_SIZE + ly] >= 0) continue;
                const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => top[(lx + dx) * REGION_SIZE + ly + dy] >= 0);
                if (!beside) continue;
                const nx = baseX + lx + beside[0];
                const ny = baseY + ly + beside[1];
                const wall = this.world.obstacleTop(baseX + lx, baseY + ly, baseX + lx, baseY + ly);
                if (!Number.isFinite(wall)) continue;
                samples.push(wall - this.world.levelHeight(top[(lx + beside[0]) * REGION_SIZE + ly + beside[1]], nx + 0.5, ny + 0.5));
            }
        }
        if (samples.length < 8) return DEFAULT_HEIGHT;
        samples.sort((a, b) => a - b);
        return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, samples[samples.length >> 1]));
    }

    private remove(mapX: number, mapY: number): void {
        const key = (mapX << 8) | mapY;
        for (const mesh of this.regions.get(key) ?? []) {
            this.scene.remove(mesh);
            mesh.dispose();
        }
        this.regions.delete(key);
    }
}
