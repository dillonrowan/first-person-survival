import * as THREE from "three";

import type { BreathInfo } from "./AttackStyle";
import type { Npc } from "./Npc";

/** Particles per breath. */
const PARTICLES = 80;
/** Seconds a flame particle lives; it crosses the cone length in this time. */
const LIFE = 0.4;

/** Colours of a flame over its life, as [r, g, b] from the mouth to the tip. */
const FLAME = {
    fire: [
        [1, 0.95, 0.63],
        [1, 0.48, 0.1],
        [0.5, 0.125, 0],
    ],
    ice: [
        [1, 1, 1],
        [0.62, 0.85, 1],
        [0.19, 0.38, 0.63],
    ],
} as const;

type Particle = { age: number; x: number; y: number; z: number; vx: number; vy: number; vz: number };

type Breath = {
    npc: Npc;
    info: BreathInfo;
    /** Seconds since the attack started. */
    time: number;
    /** Seconds after the start that the flame begins. */
    delay: number;
    carry: number;
    particles: Particle[];
    points: THREE.Points;
    positions: Float32Array;
    colors: Float32Array;
};

/**
 * Draws the breath of dragons and wyverns: a cone of additive particles from the mouth along the
 * way the NPC faces, for the duration of the attack. Procedural; no cache graphic is used.
 */
export class BreathView {
    private readonly breaths: Breath[] = [];

    constructor(
        private readonly scene: THREE.Scene,
        private readonly random: () => number = Math.random,
    ) {}

    /** Starts a breath `delay` seconds from now, from `npc`'s mouth. */
    start(npc: Npc, info: BreathInfo, delay: number): void {
        const positions = new Float32Array(PARTICLES * 3);
        const colors = new Float32Array(PARTICLES * 3);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        const material = new THREE.PointsMaterial({
            size: 0.35,
            vertexColors: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const points = new THREE.Points(geometry, material);
        // The particles move through the world; the bounds of the first frame would cull them.
        points.frustumCulled = false;
        this.scene.add(points);
        this.breaths.push({ npc, info, time: 0, delay, carry: 0, particles: [], points, positions, colors });
    }

    update(dt: number): void {
        for (let i = this.breaths.length - 1; i >= 0; i--) {
            const b = this.breaths[i];
            b.time += dt;
            this.spawn(b, dt);
            this.move(b, dt);
            if (b.time > b.delay + b.info.duration + LIFE) {
                b.points.removeFromParent();
                b.points.geometry.dispose();
                (b.points.material as THREE.Material).dispose();
                this.breaths.splice(i, 1);
            }
        }
    }

    get active(): number {
        return this.breaths.length;
    }

    dispose(): void {
        for (const b of this.breaths) {
            b.points.removeFromParent();
            b.points.geometry.dispose();
            (b.points.material as THREE.Material).dispose();
        }
        this.breaths.length = 0;
    }

    private spawn(b: Breath, dt: number): void {
        if (b.time < b.delay || b.time >= b.delay + b.info.duration) {
            return;
        }
        // Enough particles for the cone to stay full: PARTICLES live at once.
        b.carry += (dt * PARTICLES) / LIFE;
        const mouth = b.npc.launchPoint();
        const f = b.npc.forward;
        const facing = Math.atan2(f.y, f.x);
        const speed = b.info.length / LIFE;
        while (b.carry >= 1 && b.particles.length < PARTICLES) {
            b.carry -= 1;
            const angle = facing + (this.random() * 2 - 1) * b.info.halfAngle;
            b.particles.push({
                age: 0,
                x: mouth.x,
                y: mouth.y,
                z: mouth.z,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                vz: (this.random() * 2 - 1) * 0.3,
            });
        }
        b.carry = Math.min(b.carry, 1);
    }

    private move(b: Breath, dt: number): void {
        const stops = FLAME[b.info.element];
        for (let i = b.particles.length - 1; i >= 0; i--) {
            const p = b.particles[i];
            p.age += dt;
            if (p.age >= LIFE) {
                b.particles.splice(i, 1);
                continue;
            }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;
        }
        b.positions.fill(0);
        b.colors.fill(0);
        b.particles.forEach((p, i) => {
            // World (x east, y north, z up) to three.js (x, y up, -z north).
            b.positions[i * 3] = p.x;
            b.positions[i * 3 + 1] = p.z;
            b.positions[i * 3 + 2] = -p.y;
            const t = p.age / LIFE;
            const a = t < 0.5 ? stops[0] : stops[1];
            const c = t < 0.5 ? stops[1] : stops[2];
            const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
            // Black adds nothing, so fading to black fades the flame out.
            const fade = 1 - t * t;
            for (let ch = 0; ch < 3; ch++) {
                b.colors[i * 3 + ch] = (a[ch] + (c[ch] - a[ch]) * k) * fade;
            }
        });
        (b.points.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
        (b.points.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    }
}
