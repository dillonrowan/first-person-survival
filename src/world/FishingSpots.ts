import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import type { Target, TargetSource } from "../interaction/Interaction";
import type { FishingSpotTarget } from "../skills/fishing";
import type { FishingSpotPlace } from "./SkillFormat";

/**
 * How far away a spot can be aimed at, tiles. Farther than FISH_REACH it can be aimed at but not
 * fished: the player is told to come closer. [design]
 */
const AIM_RANGE = 10;
/** Spots within this many tiles of the player are drawn and animated. */
const SHOW_RADIUS = 40;
/** Radius of the cylinder a spot is aimed at, tiles. */
const AIM_RADIUS = 0.7;
const AIM_HEIGHT = 0.6;

export type FishingSpot = FishingSpotTarget & { readonly key: string; waterZ: number };

/** Unlit copies of the glTF materials, so the spot looks the same as the baked-light world. */
export function unlit(root: THREE.Object3D): void {
    root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const src = o.material as THREE.MeshStandardMaterial;
        o.material = new THREE.MeshBasicMaterial({
            color: src.color,
            transparent: src.transparent,
            opacity: src.opacity,
            depthWrite: !src.transparent,
            side: THREE.DoubleSide,
        });
    });
}

type Shown = { object: THREE.Object3D; mixer: THREE.AnimationMixer; rings: THREE.Mesh[] };

/**
 * The fishing spots at the wiki's locations (skills.json `fishingSpots`), drawn with the
 * Blender-made spot model (tools/blender/fishing.py): ripple rings that spread and fade, and
 * bubbles that pop. Only spots near the player are drawn; all of them can be aimed at.
 */
export class FishingSpots {
    readonly spots: FishingSpot[];
    private readonly shown = new Map<FishingSpot, Shown>();
    private template: { scene: THREE.Object3D; clip?: THREE.AnimationClip } | undefined;

    constructor(
        places: readonly FishingSpotPlace[],
        private readonly world: { groundHeight(plane: number, x: number, y: number): number },
        private readonly scene: THREE.Scene,
        /** The spot's options (Net, Bait…), from the fishing data. */
        private readonly actionsOf: (npcId: number) => string[],
    ) {
        this.spots = places.map((p) => ({ npcId: p.npcId, x: p.x + 0.5, y: p.y + 0.5, plane: p.plane, waterZ: 0, key: `${p.plane}:${p.x}:${p.y}` }));
    }

    async load(url: string): Promise<void> {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), "");
        this.template = { scene: gltf.scene, clip: gltf.animations[0] };
    }

    update(dt: number, player: { x: number; y: number; plane: number }): void {
        for (const spot of this.spots) {
            const near = spot.plane === player.plane && Math.hypot(spot.x - player.x, spot.y - player.y) <= SHOW_RADIUS;
            const shown = this.shown.get(spot);
            if (near && !shown && this.template) this.show(spot);
            else if (!near && shown) {
                this.scene.remove(shown.object);
                this.shown.delete(spot);
            }
        }
        for (const [spot, s] of this.shown) {
            spot.waterZ = this.world.groundHeight(spot.plane, spot.x, spot.y);
            s.object.position.set(spot.x, spot.waterZ, -spot.y);
            s.mixer.update(dt);
            // Rings fade as they spread (the clip grows them from 0.3 to 1.6).
            for (const ring of s.rings) {
                (ring.material as THREE.MeshBasicMaterial).opacity = 0.7 * Math.min(1, Math.max(0, (1.6 - ring.scale.x) / 1.1));
            }
        }
    }

    private show(spot: FishingSpot): void {
        const object = this.template!.scene.clone(true);
        unlit(object);
        const rings: THREE.Mesh[] = [];
        object.traverse((o) => o instanceof THREE.Mesh && o.name.startsWith("spot_ring") && rings.push(o));
        const mixer = new THREE.AnimationMixer(object);
        if (this.template!.clip) {
            const action = mixer.clipAction(this.template!.clip);
            action.play();
            // Spots out of step with each other.
            mixer.setTime(Math.random() * this.template!.clip.duration);
        }
        this.scene.add(object);
        this.shown.set(spot, { object, mixer, rings });
    }

    /** Spots under the crosshair within AIM_RANGE. */
    targetSource(): TargetSource {
        return (ray) => {
            let best: Target | undefined;
            for (const spot of this.spots) {
                if (spot.plane !== ray.plane || Math.hypot(spot.x - ray.ox, spot.y - ray.oy) > AIM_RANGE) continue;
                const t = rayCylinder(ray, spot, AIM_RANGE);
                if (t === undefined || (best && t >= best.distance)) continue;
                const actions = this.actionsOf(spot.npcId);
                if (actions.length > 0) best = { kind: "fishing-spot", label: "Fishing spot", actions, distance: t, ref: spot };
            }
            return best;
        };
    }
}

/** Distance along the ray to a spot's aim cylinder (around the water at the spot), or undefined. */
function rayCylinder(
    ray: { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number },
    spot: FishingSpot,
    range: number,
): number | undefined {
    // Horizontal circle entry, then check the height there.
    const fx = ray.ox - spot.x;
    const fy = ray.oy - spot.y;
    const a = ray.dx * ray.dx + ray.dy * ray.dy;
    if (a < 1e-9) return undefined;
    const b = 2 * (fx * ray.dx + fy * ray.dy);
    const c = fx * fx + fy * fy - AIM_RADIUS * AIM_RADIUS;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return undefined;
    const root = Math.sqrt(disc);
    for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
        if (t < 0 || t > range) continue;
        const z = ray.oz + ray.dz * t;
        if (z >= spot.waterZ - 0.2 && z <= spot.waterZ + AIM_HEIGHT) return t;
    }
    // Looking down onto the water inside the circle.
    if (ray.dz < 0) {
        const t = (spot.waterZ - ray.oz) / ray.dz;
        if (t >= 0 && t <= range && Math.hypot(ray.ox + ray.dx * t - spot.x, ray.oy + ray.dy * t - spot.y) <= AIM_RADIUS) return t;
    }
    return undefined;
}
