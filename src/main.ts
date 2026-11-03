import * as THREE from "three";

import { Input } from "./player/Input";
import { Player } from "./player/Player";
import "./style.css";
import { World } from "./world/World";
import { REGION_SIZE, WorldManifest } from "./world/WorldFormat";
import { createWorldMaterials } from "./world/WorldMaterials";
import { loadWorldTextures } from "./world/WorldTextures";

const WORLD_URL = `${import.meta.env.BASE_URL}world/`;

const SKY_COLOR = 0x8cbee6;
const FOG_NEAR = 24;
const FOG_FAR = 80;

const canvas = document.getElementById("game") as HTMLCanvasElement;
const overlay = document.getElementById("overlay")!;
const status = document.getElementById("status")!;
const playButton = document.getElementById("play") as HTMLButtonElement;
const hud = document.getElementById("hud")!;

/** ?x=3222&y=3218&plane=0 starts somewhere else than the manifest's spawn. */
function spawnFromUrl(fallback: WorldManifest["spawn"]): WorldManifest["spawn"] {
    const params = new URLSearchParams(location.search);
    const x = Number(params.get("x"));
    const y = Number(params.get("y"));
    if (!params.has("x") || !params.has("y") || !Number.isFinite(x) || !Number.isFinite(y)) {
        return fallback;
    }
    const plane = Math.min(3, Math.max(0, Number(params.get("plane")) | 0));
    return { x: Math.floor(x), y: Math.floor(y), plane };
}

async function loadManifest(): Promise<WorldManifest> {
    const response = await fetch(`${WORLD_URL}world.json`);
    if (!response.ok) {
        throw new Error(
            "No world map found. Create it once with: npm run download-cache && npm run export-world",
        );
    }
    return response.json();
}

async function main(): Promise<void> {
    const manifest = await loadManifest();

    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.setClearColor(SKY_COLOR);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
        70,
        window.innerWidth / window.innerHeight,
        0.05,
        FOG_FAR + 20,
    );

    status.textContent = "Loading textures...";
    const textures = await loadWorldTextures(WORLD_URL, manifest, renderer);
    const materials = createWorldMaterials(textures, {
        // The shader works in display (sRGB) colors, so pass the hex's raw channels.
        color: new THREE.Vector3(
            ((SKY_COLOR >> 16) & 0xff) / 255,
            ((SKY_COLOR >> 8) & 0xff) / 255,
            (SKY_COLOR & 0xff) / 255,
        ),
        near: FOG_NEAR,
        far: FOG_FAR,
    });

    const world = new World(WORLD_URL, manifest, materials, scene);
    const input = new Input(canvas);
    const player = new Player(world, camera, spawnFromUrl(manifest.spawn));
    if (import.meta.env.DEV) {
        // Handy from the devtools console, e.g. `game.player.x = 3165`.
        Object.assign(window, { game: { renderer, scene, camera, world, player } });
    }

    const play = () => {
        if (player.ready) {
            input.lock();
        }
    };
    playButton.addEventListener("click", play);
    canvas.addEventListener("click", play);
    input.onLockChange = (locked) => overlay.classList.toggle("hidden", locked);

    window.addEventListener("resize", () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight, false);
    });

    let last = performance.now();
    let fps = 0;
    let frames = 0;
    let fpsStart = last;
    renderer.setAnimationLoop((now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        player.update(dt, input);
        input.endFrame();
        world.update(player.x, player.y);
        materials.setTime(now / 1000);
        renderer.render(scene, camera);

        frames++;
        if (now - fpsStart >= 500) {
            fps = Math.round((frames * 1000) / (now - fpsStart));
            frames = 0;
            fpsStart = now;
        }

        if (!player.ready) {
            status.textContent = `Loading map... (${world.pendingCount} regions in flight)`;
        } else if (playButton.disabled) {
            status.textContent = "Ready.";
            playButton.disabled = false;
        }

        const tileX = Math.floor(player.x);
        const tileY = Math.floor(player.y);
        hud.textContent =
            `${fps} fps · ${player.flying ? "flying" : "walking"}\n` +
            `tile ${tileX}, ${tileY} · plane ${player.plane} · region ` +
            `${Math.floor(tileX / REGION_SIZE)},${Math.floor(tileY / REGION_SIZE)}\n` +
            `regions ${world.loadedCount} loaded` +
            (world.pendingCount > 0 ? `, ${world.pendingCount} loading` : "");
    });
}

main().catch((e) => {
    console.error(e);
    status.textContent = e instanceof Error ? e.message : String(e);
    status.classList.add("error");
});
