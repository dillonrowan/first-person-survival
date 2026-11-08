import * as THREE from "three";

import { Npc } from "./Npc";
import { NpcModels, SharedNpcModel } from "./NpcModels";
import { NpcAppearanceInfo, NpcManifest, NpcModelData, decodeNpcModel } from "../world/NpcFormat";
import { WorldManifest } from "../world/WorldFormat";
import { gunzip } from "../world/gunzip";
import { createWorldMaterials } from "../world/WorldMaterials";
import { loadWorldTextures } from "../world/WorldTextures";

export interface NpcVisualTestApi {
    ready(): boolean;
    select(id: number): Promise<void>;
    setPose(pose: "idle" | "walk"): void;
    setFrame(frame: number): void;
    setYaw(degrees: number): void;
    advance(cycles: number): void;
    render(): void;
    frame(): number;
}

declare global {
    interface Window {
        __NPC_VISUAL_TEST__?: NpcVisualTestApi;
    }
}

const WORLD_URL = "/world/";
const canvas = document.getElementById("npc-animation") as HTMLCanvasElement;
const status = document.querySelector("[data-npc-visual-status]") as HTMLElement;

async function json<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${url}: HTTP ${response.status}`);
    }
    return response.json();
}

async function main(): Promise<void> {
    try {
        const [worldManifest, npcManifest] = await Promise.all([
            json<WorldManifest>(`${WORLD_URL}world.json`),
            json<NpcManifest>(`${WORLD_URL}npcs.json`),
        ]);
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(1);
        renderer.setSize(640, 640, false);
        renderer.setClearColor(0xb8cce0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        const textures = await loadWorldTextures(WORLD_URL, worldManifest, renderer);
        const materials = createWorldMaterials(textures, {
            color: new THREE.Vector3(0.72, 0.8, 0.88),
            near: 24,
            far: 80,
        });
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xb8cce0);
        const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
        camera.position.set(0, 1.4, 4.2);
        camera.lookAt(0, 0.8, 0);

        scene.add(new THREE.HemisphereLight(0xffffff, 0x8a745f, 1.8));
        const sun = new THREE.DirectionalLight(0xffffff, 2.2);
        sun.position.set(-3, 6, 4);
        scene.add(sun);

        const floor = new THREE.Mesh(
            new THREE.CircleGeometry(3, 64),
            new THREE.MeshStandardMaterial({ color: 0xaab8c7, roughness: 1 }),
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.01;
        scene.add(floor);

        const world = {
            collisionFlags: () => 0,
            groundHeight: () => 0,
            renderLevel: () => 0,
        };
        const models = new NpcModels(async (file) => {
            const response = await fetch(`${WORLD_URL}${file}`);
            if (!response.ok) {
                throw new Error(`${file}: HTTP ${response.status}`);
            }
            return decodeNpcModel(await gunzip(await response.arrayBuffer()));
        });

        let active: Npc | undefined;
        let model: SharedNpcModel | undefined;
        let appearance: NpcAppearanceInfo | undefined;
        let pose: "idle" | "walk" = "idle";
        let frame = 0;

        const ready = () => Boolean(renderer && active && model);
        const render = () => {
            active?.sync();
            renderer.render(scene, camera);
        };

        window.__NPC_VISUAL_TEST__ = {
            ready,
            async select(id) {
                appearance = npcManifest.appearances.find((candidate) => candidate.id === id);
                if (!appearance) {
                    throw new Error(`NPC appearance ${id} not found`);
                }
                if (active) {
                    scene.remove(active.group);
                    active.dispose();
                    models.release(`${appearance.file}`);
                }
                model = await models.acquire(appearance.file);
                active = new Npc(
                    appearance,
                    { appearance: npcManifest.appearances.indexOf(appearance), x: 0, y: 0, plane: 0, orientation: 0 },
                    model,
                    materials,
                    world,
                    () => 0,
                );
                active.group.position.set(0, 0, 0);
                scene.add(active.group);
                pose = model.data.idle ? "idle" : model.data.walk ? "walk" : pose;
                frame = 0;
                active.setVisualAnimation(pose, frame);
                active.sync();
                render();
            },
            setPose(nextPose) {
                pose = nextPose;
                frame = 0;
                active?.setVisualAnimation(nextPose, 0);
                render();
            },
            setFrame(nextFrame) {
                frame = nextFrame;
                active?.setVisualAnimation(pose, nextFrame);
                render();
            },
            setYaw(degrees) {
                active?.setVisualYaw(degrees);
                render();
            },
            advance(cycles) {
                frame = active?.advanceVisualAnimation(cycles) ?? frame;
                render();
            },
            render,
            frame: () => active?.visualAnimationFrame ?? frame,
        };

        status.dataset.npcVisualStatus = "ready";
        status.textContent = "Ready";
        renderer.render(scene, camera);
    } catch (error) {
        status.dataset.npcVisualStatus = "error";
        status.textContent = error instanceof Error ? error.message : String(error);
        throw error;
    }
}

void main();
