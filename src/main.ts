import * as THREE from "three";

import { ActionHandler, Interaction } from "./interaction/Interaction";
import { climbDirection, planClimb } from "./interaction/climb";
import { createNpcActionHandler, npcTargetSource } from "./interaction/targets";
import { CollisionDebug } from "./physics/CollisionDebug";
import { Npcs } from "./npc/Npcs";
import type { Npc } from "./npc/Npc";
import type { StrikeEvent } from "./npc/NpcAttacks";
import { presenceFor } from "./npc/NpcSenses";
import { ArrowView } from "./combat/ArrowView";
import { Avatar } from "./avatar/Avatar";
import { loadAvatarAsset } from "./avatar/AvatarAsset";
import { CameraRig } from "./player/CameraRig";
import { Input } from "./player/Input";
import { Player } from "./player/Player";
import { CombatTarget, PlayerCombat } from "./combat/PlayerCombat";
import { tuning } from "./combat/tuning";
import { WeaponView } from "./combat/WeaponView";
import type { BodySource } from "./physics/Bodies";
import { CombatHud } from "./ui/CombatHud";
import "./style.css";
import { NpcManifest, decodeNpcModel } from "./world/NpcFormat";
import { WorldInteractives } from "./world/Interactives";
import { World } from "./world/World";
import { InteractiveLoc, REGION_SIZE, WorldManifest } from "./world/WorldFormat";
import { gunzip } from "./world/gunzip";
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
const promptElement = document.getElementById("prompt")!;
const messageElement = document.getElementById("message")!;

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
    // Vite's dev server answers missing files with index.html (status 200), so check the type too.
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("json")) {
        throw new Error(
            "No world map found. Create it once with: npm run download-cache && npm run export-world",
        );
    }
    return response.json();
}

/** The NPC spawn list, or undefined if the world was exported without NPCs. */
async function loadNpcManifest(manifest: WorldManifest): Promise<NpcManifest | undefined> {
    if (!manifest.npcs) {
        return undefined;
    }
    try {
        const response = await fetch(`${WORLD_URL}${manifest.npcs.file}`);
        // Vite's dev server answers missing files with index.html (status 200), so check the type.
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || !contentType.includes("json")) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (e) {
        console.warn("NPCs could not be loaded, continuing without them", e);
        return undefined;
    }
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
    // The camera carries the first-person weapon, so it must be part of the scene graph.
    scene.add(camera);

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
    const npcManifest = await loadNpcManifest(manifest);
    const npcs = npcManifest
        ? new Npcs(npcManifest, world, scene, materials, async (file) => {
              const response = await fetch(`${WORLD_URL}${file}`);
              if (!response.ok) {
                  throw new Error(`${file}: HTTP ${response.status}`);
              }
              return decodeNpcModel(await gunzip(await response.arrayBuffer()));
          })
        : undefined;
    const input = new Input(canvas);
    const player = new Player(world, spawnFromUrl(manifest.spawn), { bodies: npcs });
    const baseFov = camera.fov;
    const cameraRig = new CameraRig(camera, import.meta.env.DEV);
    // Only the character is lit by scene lights; the world shaders have their lighting baked in.
    scene.add(new THREE.HemisphereLight(SKY_COLOR, 0x5a4a3a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(-50, 10, 50); // the exporter's sun direction in three.js axes
    scene.add(sun);
    const avatar = new Avatar(await loadAvatarAsset(`${import.meta.env.BASE_URL}models/player.glb`));
    scene.add(avatar.root);
    const noBodies: BodySource<CombatTarget> = { collectBodies: () => {} };
    const combat = new PlayerCombat(npcs ?? noBodies, (plane, x, y) => world.collisionFlags(plane, x, y));
    const weaponView = new WeaponView(
        camera,
        import.meta.env.BASE_URL,
        avatar.root.getObjectByName("socket_hand_r") ?? undefined,
    );
    const combatHud = new CombatHud(document.body);
    combat.groundHeight = (plane, x, y) => world.groundHeight(plane, x, y);
    combat.onHit = ({ result }) => combatHud.showHit(result.reaction !== "none" && result.reaction !== "flinch");
    combat.onStruck = ({ outcome }) => {
        if (outcome === "hit") {
            combatHud.showDamage();
        } else if (outcome === "parried") {
            ui.showMessage("Parried!");
        }
    };
    const arrowView = new ArrowView(scene);
    const spawn = spawnFromUrl(manifest.spawn);
    let deadFor = 0;
    /** An NPC strike's impact: it lands if the player is in reach and in front of the NPC (spec 16.8). */
    const strike = (npc: Npc, event: StrikeEvent) => {
        const body = player.footprint();
        if (!body) {
            return;
        }
        const gap = Math.hypot(body.x - npc.body.x, body.y - npc.body.y) - body.radius - npc.body.radius;
        const a = event.attack;
        combat.receiveStrike(
            player,
            {
                fromX: npc.body.x,
                fromY: npc.body.y,
                gap,
                range: a.range,
                hitPow: a.hitPow[event.hitIndex],
                push: a.push,
                breaksParry: a.breaksParry,
            },
            npc.facingCos(body.x, body.y) >= Math.cos(tuning.npcStrikeCone),
        );
    };
    combat.onKick = ({ outcome }) => {
        if (outcome === "hit") {
            combatHud.showHit(true);
        } else if (outcome === "dodged") {
            ui.showMessage("Dodged!");
        }
    };
    let messageTimer: ReturnType<typeof setTimeout> | undefined;
    const ui = {
        setPrompt: (text: string) => (promptElement.textContent = text),
        showMessage: (text: string) => {
            messageElement.textContent = text;
            clearTimeout(messageTimer);
            messageTimer = setTimeout(() => (messageElement.textContent = ""), 2500);
        },
    };
    const interactives = new WorldInteractives(world, scene, materials, {
        bodies: npcs,
        player: () => player.footprint(),
    });
    const handleWorldAction: ActionHandler = (target, action) => {
        if (target.kind === "door") {
            const door = target.ref as Parameters<WorldInteractives["toggle"]>[0];
            if (!interactives.toggle(door)) {
                ui.showMessage("Something is in the way.");
            }
        } else if (target.kind === "climb") {
            const loc = target.ref as InteractiveLoc;
            const from = { x: player.x, y: player.y };
            const plan = planClimb(world, loc, climbDirection(action, world, loc, from), from);
            if ("message" in plan) {
                ui.showMessage(plan.message);
            } else {
                player.teleport(plan.x, plan.y, plan.plane);
            }
        }
    };
    const interaction = new Interaction(
        (plane, x, y) => world.collisionFlags(plane, x, y),
        [...(npcs ? [npcTargetSource(npcs)] : []), interactives.targetSource()],
        ui,
        createNpcActionHandler(player, ui, handleWorldAction),
    );
    const collisionDebug =
        import.meta.env.DEV && npcs && new URLSearchParams(location.search).get("debug") === "collision"
            ? new CollisionDebug(scene)
            : undefined;
    if (import.meta.env.DEV) {
        // Handy from the devtools console, e.g. `game.player.x = 3165`.
        Object.assign(window, {
            game: { renderer, scene, camera, world, player, npcs, cameraRig, avatar, interaction, interactives, combat, tuning },
        });
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
        const fighting = input.locked && player.ready && !player.flying;
        combat.switchWeapon(input.consumeWheel());
        combat.update(dt, player, {
            attackDown: fighting && input.isDown("Mouse0"),
            blockDown: fighting && input.isDown("Mouse2"),
            kickPressed: fighting && input.wasPressed("KeyF"),
            forward: input.axis("KeyW", "KeyS"),
            strafe: input.axis("KeyD", "KeyA"),
        });
        // Death (spec 11): fade for 4 s, then respawn at the start with full health.
        if (combat.combatant.dead) {
            if (deadFor === 0) {
                ui.showMessage("You died.");
            }
            deadFor += dt;
            if (deadFor >= tuning.deathFade) {
                deadFor = 0;
                combat.combatant.reset();
                player.stamina.value = player.stamina.max;
                player.teleport(spawn.x + 0.5, spawn.y + 0.5, spawn.plane);
            }
        }
        // Bow zoom (spec 16.4): narrow the view while drawn and nearly still.
        const fov = baseFov * (1 - combat.bow.zoom * (1 - tuning.bowZoomFov));
        if (Math.abs(camera.fov - fov) > 1e-3) {
            camera.fov = fov;
            camera.updateProjectionMatrix();
        }
        cameraRig.handleInput(input);
        interaction.update(player, input);
        input.endFrame();
        world.update(player.x, player.y);
        interactives.update(dt);
        const alive = !combat.combatant.dead;
        npcs?.update(dt, alive ? player.footprint() : undefined, player.yaw, {
            stealth: player.crouching,
            presence: presenceFor({ ...player, speed: player.speed }),
            sincePlayerAttack: combat.sinceAttack,
            strike,
        });
        arrowView.update(combat.arrows);
        avatar.update(dt, player, cameraRig.mode);
        weaponView.update(combat.melee, cameraRig.mode, player.ready && !player.flying, combat.kick, {
            bowDraw: combat.bow.drawProgress,
            blocking: combat.blocking,
        });
        combatHud.update(dt, {
            health: combat.combatant.healthFraction,
            stamina: player.stamina.fraction,
            adrenaline: combat.melee.adrenaline / tuning.adrenalineMax,
            charge: combat.weapon.family === "bow" ? combat.bow.drawProgress : combat.melee.chargeProgress,
            weaponName: combat.weapon.family === "bow" ? `${combat.weapon.name} (${combat.bow.arrows})` : combat.weapon.name,
        });
        cameraRig.update(player);
        if (collisionDebug && npcs) {
            collisionDebug.update(npcs, player.footprint(), player.plane, player.x, player.y);
        }
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
            (world.pendingCount > 0 ? `, ${world.pendingCount} loading` : "") +
            (npcs ? ` · npcs ${npcs.count}` : "");
    });
}

main().catch((e) => {
    console.error(e);
    status.textContent = e instanceof Error ? e.message : String(e);
    status.classList.add("error");
});
