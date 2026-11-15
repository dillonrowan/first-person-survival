import * as THREE from "three";

import { CLIENT_CYCLE_SECONDS } from "../npc/NpcAnimation";
import type { NpcMeshData } from "../world/NpcFormat";
import { SpellGfx, SpellGfxManifest, decodeSpellGfx } from "../world/SpellGfxFormat";
import { gunzip } from "../world/gunzip";

type Materials = { opaque: THREE.Material; transparent: THREE.Material };

/** The meshes of every frame of one spot animation, built once per render level. */
type BuiltGfx = { gfx: SpellGfx; frames: THREE.BufferGeometry[][]; duration: number };

/** Frame shown `seconds` into a spot animation (looping, or held on the last frame). */
export function gfxFrameAt(frameLengths: readonly number[], seconds: number, loop: boolean): number {
    const total = frameLengths.reduce((n, l) => n + l, 0);
    let cycles = Math.floor(seconds / CLIENT_CYCLE_SECONDS);
    if (loop && total > 0) {
        cycles %= total;
    }
    for (let f = 0; f < frameLengths.length; f++) {
        cycles -= frameLengths[f];
        if (cycles < 0) {
            return f;
        }
    }
    return frameLengths.length - 1;
}

/**
 * An OSRS spot animation drawn in the world: one mesh pair per frame, swapped as it plays. Its
 * local +z is the model's front (the way a projectile flies).
 */
export class SpellGfxObject extends THREE.Group {
    private shown = -1;
    private readonly opaque: THREE.Mesh;
    private readonly transparent: THREE.Mesh;

    constructor(private readonly built: BuiltGfx, materials: Materials) {
        super();
        this.opaque = new THREE.Mesh(undefined, materials.opaque);
        this.transparent = new THREE.Mesh(undefined, materials.transparent);
        this.opaque.renderOrder = 1;
        this.transparent.renderOrder = 2;
        for (const mesh of [this.opaque, this.transparent]) {
            mesh.frustumCulled = false;
            this.add(mesh);
        }
        this.setTime(0, true);
    }

    /** Seconds the animation lasts when played once. */
    get duration(): number {
        return this.built.duration;
    }

    setTime(seconds: number, loop: boolean): void {
        const frame = gfxFrameAt(this.built.gfx.frameLengths, seconds, loop);
        if (frame === this.shown) {
            return;
        }
        this.shown = frame;
        const [opaque, transparent] = this.built.frames[frame];
        this.opaque.geometry = opaque;
        this.transparent.geometry = transparent;
        this.opaque.visible = opaque.index!.count > 0;
        this.transparent.visible = transparent.index!.count > 0;
    }
}

function geometryOf(part: NpcMeshData, level: number): THREE.BufferGeometry {
    const positions = new Int16Array(part.positions);
    // Depth bias plane bits, see the vertex shader.
    for (let i = 3; i < positions.length; i += 4) positions[i] |= level << 13;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("a_position", new THREE.BufferAttribute(positions, 4));
    geometry.setAttribute("a_color", new THREE.BufferAttribute(part.colors, 4, true));
    geometry.setAttribute("a_uv", new THREE.BufferAttribute(part.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
    return geometry;
}

/**
 * The exported spell graphics (public/spells/, npm run export-spells). Files load in the
 * background on first use; until one has loaded (or when the export is missing) `create` returns
 * undefined and callers draw their fallback.
 */
export class SpellGfxLibrary {
    private readonly loaded = new Map<number, SpellGfx | null>();
    private readonly built = new Map<string, BuiltGfx>();

    private constructor(
        private readonly baseUrl: string,
        private readonly manifest: SpellGfxManifest | undefined,
        private readonly materials: Materials,
    ) {}

    static async load(baseUrl: string, materials: Materials): Promise<SpellGfxLibrary> {
        let manifest: SpellGfxManifest | undefined;
        try {
            const response = await fetch(`${baseUrl}spells/spells.json`);
            if (response.ok && (response.headers.get("content-type") ?? "").includes("json")) {
                manifest = (await response.json()) as SpellGfxManifest;
            } else {
                console.warn("No spell graphics: run npm run export-spells");
            }
        } catch (e) {
            console.warn("Spell graphics could not be loaded", e);
        }
        return new SpellGfxLibrary(baseUrl, manifest, materials);
    }

    /** Starts loading these spot animations so the first cast does not wait. */
    preload(ids: number[]): void {
        for (const id of ids) this.request(id);
    }

    /** A new object showing spot animation `id`, or undefined while it loads or if it is missing. */
    create(id: number, level = 0): SpellGfxObject | undefined {
        const gfx = this.request(id);
        if (!gfx) {
            return undefined;
        }
        const key = `${id}:${level}`;
        let built = this.built.get(key);
        if (!built) {
            built = {
                gfx,
                frames: gfx.frames.map((f) => [geometryOf(f.opaque, level), geometryOf(f.transparent, level)]),
                duration: gfx.frameLengths.reduce((n, l) => n + l, 0) * CLIENT_CYCLE_SECONDS,
            };
            this.built.set(key, built);
        }
        return new SpellGfxObject(built, this.materials);
    }

    private request(id: number): SpellGfx | undefined {
        if (this.loaded.has(id)) {
            return this.loaded.get(id) ?? undefined;
        }
        const file = this.manifest?.files[id];
        if (!file) {
            this.loaded.set(id, null);
            return undefined;
        }
        this.loaded.set(id, null);
        void fetch(`${this.baseUrl}spells/${file}`)
            .then(async (response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                this.loaded.set(id, decodeSpellGfx(await gunzip(await response.arrayBuffer())));
            })
            .catch((e) => console.warn(`Spell graphic ${id} could not be loaded`, e));
        return undefined;
    }
}

/** Where a one-shot graphic is drawn: fixed, or following an NPC or the player. */
export type GfxAnchor = () => { x: number; y: number; z: number; yaw?: number };

/** Cast, impact and splash graphics: each plays its animation once where it was started, then goes. */
export class SpellEffects {
    private readonly playing: { object: SpellGfxObject; anchor: GfxAnchor; height: number; age: number }[] = [];

    constructor(
        private readonly scene: THREE.Scene,
        private readonly library: SpellGfxLibrary,
    ) {}

    /**
     * Plays spot animation `id` at the anchor (world x east, y north, z up, in tiles), `height`
     * tiles above it, turned to the anchor's yaw (the player's facing) if it has one.
     */
    play(id: number, anchor: GfxAnchor, height: number, scale = 1, level = 0): void {
        const object = this.library.create(id, level);
        if (!object) {
            return;
        }
        object.scale.setScalar(scale);
        this.scene.add(object);
        this.playing.push({ object, anchor, height, age: 0 });
        this.place(this.playing[this.playing.length - 1]);
    }

    update(dt: number): void {
        for (let i = this.playing.length - 1; i >= 0; i--) {
            const effect = this.playing[i];
            effect.age += dt;
            if (effect.age >= effect.object.duration) {
                effect.object.removeFromParent();
                this.playing.splice(i, 1);
                continue;
            }
            effect.object.setTime(effect.age, false);
            this.place(effect);
        }
    }

    private place(effect: { object: SpellGfxObject; anchor: GfxAnchor; height: number }): void {
        const at = effect.anchor();
        effect.object.position.set(at.x, at.z + effect.height, -at.y);
        if (at.yaw !== undefined) {
            // The model's front is local +z; the player looks along (-sin yaw, cos yaw) (north +y).
            effect.object.rotation.set(0, at.yaw + Math.PI, 0);
        }
    }
}
