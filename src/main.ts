import * as THREE from "three";

import { ActionHandler, Interaction } from "./interaction/Interaction";
import { climbDirection, planClimb } from "./interaction/climb";
import { createNpcActionHandler, npcTargetSource } from "./interaction/targets";
import { CollisionDebug } from "./physics/CollisionDebug";
import { Npcs } from "./npc/Npcs";
import type { Npc } from "./npc/Npc";
import type { NpcAttack, StrikeEvent } from "./npc/NpcAttacks";
import { BreathView } from "./npc/BreathView";
import { inBreathCone } from "./npc/Breath";
import { NpcProjectileView } from "./npc/NpcProjectileView";
import { NPC_EFFECTS, npcGraphicIds, pickNpcSpell } from "./npc/NpcSpells";
import { applyDrain, curseMessage, runHitEffects } from "./npc/NpcHitEffects";
import { NpcProjectile, ProjectileTarget, launchNpcProjectile, stepNpcProjectiles } from "./npc/NpcProjectiles";
import { presenceFor } from "./npc/NpcSenses";
import { ArrowView } from "./combat/ArrowView";
import { SpellEffects, SpellGfxLibrary } from "./combat/SpellGfxView";
import { CAST_HEIGHT, IMPACT_HEIGHT, SPELL_GRAPHICS, SPLASH_GRAPHIC } from "./world/SpellGfxFormat";
import { Avatar } from "./avatar/Avatar";
import { loadAvatarAsset } from "./avatar/AvatarAsset";
import { CameraRig } from "./player/CameraRig";
import { Input } from "./player/Input";
import { Player } from "./player/Player";
import { HitFeel, impactStrength } from "./combat/HitFeel";
import { CombatTarget, PlayerCombat } from "./combat/PlayerCombat";
import { tuning } from "./combat/tuning";
import { WeaponView } from "./combat/WeaponView";
import type { BodySource } from "./physics/Bodies";
import { CombatHud } from "./ui/CombatHud";
import { EnemyHealthBars } from "./ui/EnemyHealthBars";
import { WeaponMenu } from "./ui/WeaponMenu";
import { createCacheWeaponModel } from "./combat/CacheWeaponModel";
import { environmentDamage } from "./combat/Osrs";
import { LevelUp, PlayerSkills, SKILL_NAMES } from "./combat/Skills";
import { Spellbook } from "./combat/Spells";
import { GroundItems, GroundEntry } from "./items/GroundItems";
import { rollDrops } from "./items/Drops";
import { ItemDb } from "./items/ItemDb";
import { ItemIcons } from "./items/ItemIcons";
import { PlayerItems } from "./items/PlayerItems";
import { weaponDefFor } from "./items/weaponDef";
import { SidePanel } from "./ui/SidePanel";
import { HitsplatLayer, loadHitsplatArt, splatKind } from "./ui/Hitsplats";
import { SkillsPanel } from "./ui/SkillsPanel";
import { SpellbookPanel } from "./ui/SpellbookPanel";
import "./style.css";
import { NpcManifest, decodeNpcModel } from "./world/NpcFormat";
import { WorldInteractives } from "./world/Interactives";
import { PropInstance, WorldProps } from "./world/Props";
import { fallDamage } from "./physics/ImpactDamage";
import { World } from "./world/World";
import { GroundItemManifest, InteractiveLoc, REGION_SIZE, WorldManifest } from "./world/WorldFormat";
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

/** The ground item spawn list, or undefined if the world was exported without item data. */
/** Where the first-person cast graphic plays: tiles ahead of the eye, below it, and its scale. [design] */
const CAST_VIEW_AHEAD = 0.9;
const CAST_VIEW_BELOW = 0.45;
const CAST_VIEW_SCALE = 0.45;

async function loadGroundItems(manifest: WorldManifest): Promise<GroundItemManifest | undefined> {
    if (!manifest.groundItems) {
        return undefined;
    }
    try {
        const response = await fetch(`${WORLD_URL}${manifest.groundItems.file}`);
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || !contentType.includes("json")) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (e) {
        console.warn("Ground items could not be loaded, continuing without them", e);
        return undefined;
    }
}

/** localStorage, or undefined where it is blocked (private windows, previews). */
function browserStorage(): Storage | undefined {
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}

async function main(): Promise<void> {
    const manifest = await loadManifest();
    const itemDb = await ItemDb.load(`${WORLD_URL}items.json`);
    const groundItemManifest = await loadGroundItems(manifest);

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
    // OSRS spell graphics (cast, projectile, impact, splash), small enough to fetch up front.
    const spellGfx = await SpellGfxLibrary.load(import.meta.env.BASE_URL, materials);
    spellGfx.preload([SPLASH_GRAPHIC, ...Object.values(SPELL_GRAPHICS).flatMap((g) => [g.cast, g.projectile, g.impact])]);
    // NPC arrows, rocks, spit and boss attacks too, in the background, so a first shot is not a placeholder.
    spellGfx.preload(npcGraphicIds());
    const spellEffects = new SpellEffects(scene, spellGfx);
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
    // Physics props (spec 19): crates, barrels and sacks exported as loose objects.
    const props = new WorldProps(
        {
            flagsAt: (plane, x, y) => world.collisionFlags(plane, x, y),
            groundHeight: (plane, x, y) => world.groundHeight(plane, x, y),
            hasFloor: (plane, x, y) => world.hasFloor(plane, x, y),
            addRegionListener: (listener) => world.addRegionListener(listener),
            regionInteractives: (mapX, mapY) => world.regionInteractives(mapX, mapY),
        },
        scene,
        materials,
    );
    /** NPCs and props: what the player cannot walk through and what combat can hit. */
    const solidBodies: BodySource<CombatTarget> = {
        collectBodies: (plane, minX, minY, maxX, maxY, out) => {
            npcs?.collectBodies(plane, minX, minY, maxX, maxY, out as never[]);
            props.collectBodies(plane, minX, minY, maxX, maxY, out);
        },
    };
    const player = new Player(world, spawnFromUrl(manifest.spawn), { bodies: solidBodies });
    const baseFov = camera.fov;
    const cameraRig = new CameraRig(camera, import.meta.env.DEV);
    // Only the character is lit by scene lights; the world shaders have their lighting baked in.
    scene.add(new THREE.HemisphereLight(SKY_COLOR, 0x5a4a3a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(-50, 10, 50); // the exporter's sun direction in three.js axes
    scene.add(sun);
    const avatar = new Avatar(await loadAvatarAsset(`${import.meta.env.BASE_URL}models/player.glb`));
    scene.add(avatar.root);
    const skills = new PlayerSkills(browserStorage());
    const spellbook = new Spellbook(browserStorage());
    const items = new PlayerItems(itemDb, skills, browserStorage());
    const combat = new PlayerCombat(
        solidBodies,
        (plane, x, y) => world.collisionFlags(plane, x, y),
        Math.random,
        skills,
        spellbook,
        items,
        () => items.equipment.get("shield")?.id,
    );
    const loadItemModel = async (file: string) => {
        const response = await fetch(`${WORLD_URL}${file}`);
        if (!response.ok) {
            throw new Error(`${file}: HTTP ${response.status}`);
        }
        return decodeNpcModel(await gunzip(await response.arrayBuffer()));
    };
    const groundItems = new GroundItems(scene, materials, itemDb, loadItemModel, world);
    if (groundItemManifest) {
        groundItems.addSpawns(groundItemManifest);
    }
    const itemIcons = new ItemIcons(renderer, materials, loadItemModel);
    const weaponView = new WeaponView(
        camera,
        import.meta.env.BASE_URL,
        avatar.root.getObjectByName("socket_hand_r") ?? undefined,
        (weaponId) => {
            const info = weaponMenu.find(weaponId);
            return info && (async () => {
                const response = await fetch(`${WORLD_URL}${info.file}`);
                if (!response.ok) {
                    throw new Error(`${info.file}: HTTP ${response.status}`);
                }
                const data = decodeNpcModel(await gunzip(await response.arrayBuffer()));
                return createCacheWeaponModel(info, data, materials);
            })();
        },
    );
    const weaponMenuElement = document.getElementById("weapon-menu")!;
    /** Wields the first inventory slot holding this item, or says where it went. */
    const wieldItem = (id: number) => {
        const slot = items.inventory.slots.findIndex((stack) => stack?.id === id);
        if (slot < 0) {
            ui.showMessage("Added to your bank.");
            return;
        }
        const problem = items.wield(slot);
        if (problem) {
            ui.showMessage(problem);
        }
    };
    // The developer cheat menu (I, dev builds only): any cache weapon, shield or item into the inventory.
    const weaponMenu = new WeaponMenu(
        weaponMenuElement,
        document.getElementById("weapon-menu-list")!,
        document.getElementById("weapon-menu-status")!,
        (weapon) => {
            items.give(weapon.cacheId, 1);
            wieldItem(weapon.cacheId);
        },
        () => undefined,
        undefined,
        document.getElementById("weapon-menu-shields")!,
        (shield) => {
            if (shield) {
                items.give(shield.cacheId, 1);
                wieldItem(shield.cacheId);
            } else {
                items.unequip("shield");
            }
        },
        { db: itemDb, list: document.getElementById("weapon-menu-items")!, give: (id, qty) => items.give(id, qty) },
    );
    /** The weapon of the weapon slot is the weapon in hand. */
    const syncWeapon = () => {
        const def = weaponDefFor(items.equipment.get("weapon"), itemDb, weaponMenu.all);
        if (combat.weapon.id !== def.id) {
            combat.equipWeapon(def);
        }
    };
    await weaponMenu.load().catch((error) => {
        document.getElementById("weapon-menu-status")!.textContent =
            error instanceof Error ? error.message : String(error);
    });
    syncWeapon();
    const combatHud = new CombatHud(document.body);
    const hitsplats = new HitsplatLayer(document.body, camera, await loadHitsplatArt(import.meta.env.BASE_URL));
    const enemyHealthBars = npcs ? new EnemyHealthBars(document.body, npcs, camera) : undefined;
    combat.groundHeight = (plane, x, y) => world.groundHeight(plane, x, y);
    combat.obstacleTop = (minX, minY, maxX, maxY) => world.obstacleTop(minX, minY, maxX, maxY);
    const hitFeel = new HitFeel();
    combat.onHit = ({ result, move, target, spell }) => {
        // A splashed spell shows only the splash graphic, no hitsplat, as in OSRS.
        if (target.combatStats && !(spell && result.missed)) {
            hitsplats.addNpc(target as unknown as Npc, splatKind(result), result.amount);
        }
        const graphics = spell ? SPELL_GRAPHICS[spell] : undefined;
        const body = (target as unknown as Partial<Npc>).body;
        if (graphics && body) {
            // The spell's impact on the target, or the blue splash when it missed, as in OSRS.
            spellEffects.play(result.missed ? SPLASH_GRAPHIC : graphics.impact, () => body, IMPACT_HEIGHT / 128);
        }
        combatHud.showHit(!result.missed && result.reaction !== "none" && result.reaction !== "flinch");
        if (combat.melee.swing?.move === move) {
            // A melee blow (not an arrow): power and finishing strikes land heavier. The blade
            // stalls and the view jolts; the struck bodies hold for a moment.
            weaponView.impact(move.kind === "quick" ? 0.6 : 1);
            hitFeel.impact(impactStrength(result));
        }
    };
    combat.onCastFailed = (message) => ui.showMessage(message);
    /** Where the player's hands are in first person: ahead of and below the eye, turned with the view. */
    const atHands = () => ({
        x: player.x - Math.sin(player.yaw) * CAST_VIEW_AHEAD,
        y: player.y + Math.cos(player.yaw) * CAST_VIEW_AHEAD,
        z: player.z + player.eyeHeight - CAST_VIEW_BELOW,
        yaw: player.yaw,
    });
    combat.onCast = (spell) => {
        const graphics = SPELL_GRAPHICS[spell.id];
        if (graphics) {
            // OSRS draws the cast graphic round the caster's hands. Seen from the
            // eye that would fill the view, so it plays smaller where the hands are: ahead of and
            // below the eye, turned with the view. [design]
            spellEffects.play(graphics.cast, atHands, 0, CAST_VIEW_SCALE);
        }
    };
    combat.onStruck = ({ outcome, style, shielded, damage, missed, poisoned, spell }) => {
        if (outcome === "hit") {
            combatHud.showDamage(damage, missed);
            // A curse does no damage, and a splashed spell shows only its splash: no hitsplat (OSRS).
            if (spell !== "curse" && !(spell && missed)) {
                hitsplats.addPlayer(splatKind({ missed, amount: damage }), damage);
            }
            if (poisoned) {
                ui.showMessage("You have been poisoned!");
            }
            if (style === "dragonfire") {
                ui.showMessage(shielded ? "You manage to resist some of the dragon fire!" : "You're horribly burnt by the dragon fire!");
            }
        } else if (outcome === "parried") {
            ui.showMessage("Parried!");
        }
    };
    // Fall damage (spec 19.8).
    player.onLanded = (speed) => {
        const damage = fallDamage(speed);
        if (damage > 0 && !combat.combatant.dead) {
            const hurt = environmentDamage(damage, combat.combatant.maxHealth);
            combat.combatant.hurt(hurt, "flinch");
            combatHud.showDamage(hurt);
            hitsplats.addPlayer("damage", hurt);
        }
    };
    const arrowView = new ArrowView(scene, spellGfx);
    /** Arrows, spells, rocks, spit and fireballs NPCs have shot, and the flames they breathe. */
    const npcProjectiles: NpcProjectile[] = [];
    const projectileView = new NpcProjectileView(scene, spellGfx);
    const breathView = new BreathView(scene);
    const spawn = spawnFromUrl(manifest.spawn);
    let deadFor = 0;
    /** The player as a projectile sees them, or undefined while dead or flying. */
    const playerTarget = (): ProjectileTarget | undefined => {
        const b = player.footprint();
        return b && { x: b.x, y: b.y, z: b.z, radius: b.radius, height: b.height, plane: b.plane };
    };
    /**
     * An NPC strike's impact (spec 16.8). A melee blow lands if the player is in reach and in front
     * of the NPC; breath hits if the player is inside its cone; an arrow or spell flies from the NPC.
     */
    const strike = (npc: Npc, event: StrikeEvent) => {
        const body = player.footprint();
        if (!body) {
            return;
        }
        const gap = Math.hypot(body.x - npc.body.x, body.y - npc.body.y) - body.radius - npc.body.radius;
        const a = event.attack;
        const hitPow = a.hitPow[event.hitIndex];
        if (a.style === "melee") {
            const struck = combat.receiveStrike(
                player,
                {
                    fromX: npc.body.x,
                    fromY: npc.body.y,
                    gap,
                    range: a.range,
                    hitPow,
                    push: a.push,
                    breaksParry: a.breaksParry,
                    style: "melee",
                    attacker: npc.combatStats,
                    rate: event.rate,
                    share: 1 / a.hitTimes.length,
                },
                npc.facingCos(body.x, body.y) >= Math.cos(tuning.npcStrikeCone),
            );
            if (struck.outcome === "hit") {
                npcHitEffects(npc, struck);
            }
        } else if (a.breath) {
            const f = npc.forward;
            if (inBreathCone(npc.body.x, npc.body.y, f.x, f.y, body.x, body.y, gap, a.breath)) {
                combat.receiveStrike(
                    player,
                    {
                        fromX: npc.body.x,
                        fromY: npc.body.y,
                        gap,
                        range: a.range,
                        hitPow,
                        push: false,
                        breaksParry: true,
                        style: a.style,
                        direct: true,
                        attacker: npc.combatStats,
                        rate: event.rate,
                        share: 1 / a.hitTimes.length,
                    },
                    true,
                );
            }
        } else if (a.projectile) {
            const target = playerTarget();
            if (target) {
                const projectile = launchNpcProjectile(
                    { ...npc.launchPoint(), plane: npc.plane },
                    target,
                    a.projectile,
                    a.style,
                    hitPow,
                    npc.combatStats,
                    event.rate,
                    1 / a.hitTimes.length,
                );
                // Its OSRS look: a caster with a spell list casts one of its spells; arrows, rocks and
                // boss attacks use their graphics from NPC_EFFECTS.
                const effects = NPC_EFFECTS[npc.appearance.id];
                const spell =
                    a.style === "magic" ? pickNpcSpell(npc.appearance.id, Math.random, (s) => skills.drained(s)) : undefined;
                const gfx = spell ? spell.gfx : a.style === "ranged" ? effects?.ranged : undefined;
                projectile.shooter = npc;
                if (spell) projectile.npcSpell = spell;
                if (gfx) {
                    projectile.gfx = gfx;
                    if (gfx.cast !== undefined) {
                        const f = npc.forward;
                        spellEffects.play(
                            gfx.cast,
                            () => ({ x: npc.body.x, y: npc.body.y, z: npc.body.z, yaw: Math.atan2(-f.x, f.y) }),
                            CAST_HEIGHT / 128,
                        );
                    }
                }
                npcProjectiles.push(projectile);
            }
        }
    };
    /** NPCs whose once-a-fight effect (the Mourner's vial) has fired. */
    const usedOnce = new WeakSet<Npc>();
    /** The head-slot item's name: earmuffs and nose pegs block some drains. */
    const headItem = () => {
        const head = items.equipment.get("head");
        return head ? itemDb.get(head.id)?.name : undefined;
    };
    /** An NPC strike reached the player: its on-hit drains [wiki: Temporary skill drain]. */
    const npcHitEffects = (npc: Npc, struck: { missed: boolean; damage: number }) => {
        const effects = NPC_EFFECTS[npc.appearance.id]?.onHit;
        if (!effects) return;
        const { messages, firedOnce } = runHitEffects(effects, struck, skills, Math.random, headItem(), usedOnce.has(npc));
        if (firedOnce) usedOnce.add(npc);
        for (const message of messages) ui.showMessage(message);
        skillsChanged();
    };
    /** An NPC began an attack: breath starts its flame, timed to the first damage tick. */
    const attackStarted = (npc: Npc, a: NpcAttack) => {
        if (a.breath) {
            breathView.start(npc, a.breath, a.hitTimes[0]);
        }
    };
    /** An NPC died: pay out the XP of the damage the player dealt it and drop what it carried. */
    /** XP was granted: level-up messages, the health a Hitpoints level brings, and the panels. */
    const xpGained = (ups: LevelUp[]) => {
        if (ups.length > 0) {
            combat.syncMaxHealth();
            ui.showMessage(
                ups.map((u) => `Congratulations, your ${SKILL_NAMES[u.skill]} level is now ${u.level}.`).join(" "),
            );
        }
        skillsPanel.refresh();
        spellbookPanel.refresh();
    };
    combat.onXp = (_gains, ups) => xpGained(ups);
    /** A drain or its restore changed current levels: redraw the skills and spellbook. */
    const skillsChanged = () => {
        skillsPanel.refresh();
        spellbookPanel.refresh();
    };
    const killed = (npc: Npc) => {
        xpGained(skills.addXp(npc.xpLedger.drain()));
        for (const stack of rollDrops(npc.appearance.drops ?? [], Math.random)) {
            groundItems.add(stack, Math.floor(npc.body.x), Math.floor(npc.body.y), npc.plane, {
                despawnIn: tuning.groundItemDespawn,
            });
        }
    };
    combat.onKick = ({ outcome }) => {
        if (outcome === "hit") {
            combatHud.showHit(true);
            hitFeel.impact(0.85);
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
        } else if (target.kind === "bank") {
            sidePanel.openBank();
        } else if (target.kind === "ground-item") {
            const entry = target.ref as GroundEntry;
            const want = entry.stack.qty;
            const left = items.pickUp(entry.stack.id, want);
            if (left === want) {
                ui.showMessage("You don't have enough inventory space.");
            } else {
                groundItems.take(entry, want - left);
            }
        } else if (target.kind === "prop") {
            props.pickUp(target.ref as PropInstance);
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
        [...(npcs ? [npcTargetSource(npcs)] : []), interactives.targetSource(), props.targetSource(), groundItems.targetSource()],
        ui,
        createNpcActionHandler(player, ui, handleWorldAction, () => sidePanel.openBank()),
    );
    let eatCooldown = 0;
    const skillsPanel = new SkillsPanel(document.getElementById("tab-skills")!, skills);
    const spellbookPanel = new SpellbookPanel(document.getElementById("tab-spellbook")!, spellbook, skills, (spell) =>
        ui.showMessage(`Spell equipped: ${spell.name}`),
    );
    const sidePanel = new SidePanel(
        document.getElementById("side-panel")!,
        document.getElementById("bank-panel")!,
        document.getElementById("item-menu")!,
        items,
        itemDb,
        itemIcons,
        { skills: skillsPanel, spellbook: spellbookPanel },
        {
            eat: (slot) => {
                if (eatCooldown > 0 || combat.combatant.dead) {
                    return;
                }
                const message = items.eat(slot, combat.combatant);
                if (message) {
                    eatCooldown = tuning.eatDelay;
                    ui.showMessage(message);
                }
            },
            drop: (stack) =>
                groundItems.add(stack, Math.floor(player.x), Math.floor(player.y), player.plane, {
                    despawnIn: tuning.groundItemDespawn,
                }),
            message: (text) => ui.showMessage(text),
            closed: () => {
                if (player.ready) {
                    input.lock();
                }
                // If the mouse could not be taken back, show the "Click to play" panel again.
                setTimeout(() => overlay.classList.toggle("hidden", input.locked), 250);
            },
        },
    );
    items.onChange = () => {
        syncWeapon();
        sidePanel.refresh();
    };
    window.addEventListener("keydown", (event) => {
        if (event.repeat || event.target instanceof HTMLInputElement) {
            return;
        }
        if (event.code === "Tab") {
            event.preventDefault();
            sidePanel.toggle("inventory");
        } else if (event.code === "KeyK") {
            sidePanel.toggle("skills");
        } else if (event.code === "KeyB") {
            sidePanel.toggle("spellbook");
        } else if (event.code === "KeyQ" && input.locked) {
            combat.cycleStyle();
            ui.showMessage(`Attack style: ${combat.style.name}`);
        } else if (import.meta.env.DEV && event.code === "KeyI") {
            // Opening focuses the search box; keep this "i" from being typed into it.
            event.preventDefault();
            weaponMenu.toggle();
        }
    });
    const collisionDebug =
        import.meta.env.DEV && npcs && new URLSearchParams(location.search).get("debug") === "collision"
            ? new CollisionDebug(scene)
            : undefined;
    if (import.meta.env.DEV) {
        // Handy from the devtools console, e.g. `game.player.x = 3165`.
        Object.assign(window, {
            game: {
                renderer, scene, camera, world, player, npcs, props, cameraRig, avatar, interaction, interactives, combat, tuning,
                skills, spellbook, items, db: itemDb, groundItems, sidePanel, hitsplats, spellEffects,
            },
        });
    }

    const play = () => {
        if (player.ready) {
            input.lock();
        }
    };
    playButton.addEventListener("click", play);
    canvas.addEventListener("click", play);
    input.onLockChange = (locked) => overlay.classList.toggle("hidden", locked || sidePanel.isOpen);

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
        // A landed blow briefly holds the struck bodies; the player and the swing carry on.
        const npcDt = hitFeel.worldDt(dt);

        player.update(dt, input);
        const fighting = input.locked && player.ready && !player.flying;
        // Carrying a prop (spec 19.4): left mouse throws it, E drops it; no fighting meanwhile.
        let propHandled = false;
        if (props.held) {
            if (!fighting || combat.combatant.dead) {
                props.drop();
            } else if (input.wasPressed("Mouse0")) {
                props.throwHeld(player.yaw, player.pitch);
                combat.sinceAttack = 0;
                propHandled = true;
            } else if (input.wasPressed("KeyE")) {
                props.drop();
                propHandled = true;
            }
        }
        const carrying = props.held !== undefined || propHandled;
        const wheel = input.consumeWheel();
        eatCooldown = Math.max(0, eatCooldown - dt);
        const wheelProblem = items.cycleWeapon(carrying ? 0 : wheel);
        if (wheelProblem) {
            ui.showMessage(wheelProblem);
        }
        combat.update(dt, player, {
            // A tap that went down and up between frames still counts as down for this one.
            attackDown: fighting && !carrying && (input.isDown("Mouse0") || input.wasPressed("Mouse0")),
            attackPressed: fighting && !carrying && input.wasPressed("Mouse0"),
            blockDown: fighting && !carrying && input.isDown("Mouse2"),
            kickPressed: fighting && !carrying && input.wasPressed("KeyF"),
            castPressed:
                fighting && !carrying && (input.wasPressed("KeyG") || (combat.holdsCaster && input.wasPressed("Mouse2"))),
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
                npcProjectiles.length = 0;
                combat.combatant.reset();
                player.stamina.value = player.stamina.max;
                player.teleport(spawn.x + 0.5, spawn.y + 0.5, spawn.plane);
            }
        }
        // Bow and crossbow zoom: narrow the view while the right mouse is held.
        const zoom = Math.max(combat.bow.zoom, combat.crossbow.zoom);
        const fov = baseFov * (1 - zoom * (1 - tuning.bowZoomFov));
        if (Math.abs(camera.fov - fov) > 1e-3) {
            camera.fov = fov;
            camera.updateProjectionMatrix();
        }
        cameraRig.handleInput(input);
        if (carrying) {
            interaction.showPrompt(props.held ? `[LMB] Throw ${props.held.loc.name}   [E] Drop` : "");
        } else {
            interaction.update(player, input);
        }
        input.endFrame();
        world.update(player.x, player.y);
        interactives.update(dt);
        const alive = !combat.combatant.dead;
        npcs?.update(npcDt, alive ? player.footprint() : undefined, player.yaw, {
            stealth: player.crouching,
            presence: presenceFor({ ...player, speed: player.speed }),
            sincePlayerAttack: combat.sinceAttack,
            strike,
            attackStarted,
            killed,
        });
        // Arrows and spells in flight hit the player at the moment they arrive.
        for (const p of stepNpcProjectiles(
            npcProjectiles,
            npcDt,
            alive ? playerTarget() : undefined,
            (plane, x, y) => world.collisionFlags(plane, x, y),
            (plane, x, y) => world.groundHeight(plane, x, y),
            (minX, minY, maxX, maxY) => world.obstacleTop(minX, minY, maxX, maxY),
        )) {
            const struck = combat.receiveStrike(
                player,
                {
                    ...(p.npcSpell ? { spell: p.npcSpell.damaging ? ("damaging" as const) : ("curse" as const) } : {}),
                    fromX: p.fromX,
                    fromY: p.fromY,
                    gap: 0,
                    range: 0,
                    hitPow: p.hitPow,
                    push: false,
                    breaksParry: true,
                    style: p.style,
                    direct: true,
                    ...(p.attacker ? { attacker: p.attacker } : {}),
                    rate: p.rate,
                    share: p.share,
                },
                true,
            );
            if (struck.outcome === "hit") {
                // The impact on the player (a missed spell: the splash), drawn where the hands are so
                // it shows in first person, like the player's own cast graphic.
                const impact = struck.missed ? (p.npcSpell ? SPLASH_GRAPHIC : undefined) : p.gfx?.impact;
                if (impact !== undefined) {
                    spellEffects.play(impact, atHands, 0, CAST_VIEW_SCALE);
                }
                const spell = p.npcSpell;
                if (spell && !struck.missed) {
                    // A landed curse drains or binds [wiki: Temporary skill drain].
                    const taken = spell.drain ? applyDrain(skills, spell.drain) : {};
                    if (spell.bind) player.boundFor = Math.max(player.boundFor, spell.bind);
                    if (Object.keys(taken).length > 0 || spell.bind) {
                        ui.showMessage(curseMessage(spell));
                        skillsChanged();
                    }
                }
                if (p.shooter) {
                    npcHitEffects(p.shooter as Npc, struck);
                }
            }
        }
        projectileView.update(npcProjectiles);
        breathView.update(npcDt);
        const playerBody = alive ? player.footprint() : undefined;
        props.update(dt, {
            player: playerBody && {
                body: playerBody,
                intentX: player.intentX,
                intentY: player.intentY,
                eyeZ: player.z + player.eyeHeight,
                yaw: player.yaw,
                pitch: player.pitch,
            },
            npcs: npcs?.all() ?? [],
            onNpcHit: (npc, damage, reaction) => {
                combatHud.showHit(reaction !== "flinch");
                hitsplats.addNpc(npc as unknown as Npc, "damage", Math.round(damage));
            },
            onPlayerHit: (damage) => {
                const hurt = environmentDamage(damage, combat.combatant.maxHealth);
                combat.combatant.hurt(hurt, "flinch");
                combatHud.showDamage(hurt);
                hitsplats.addPlayer("damage", hurt);
            },
        });
        groundItems.update(dt, player.x, player.y, player.plane);
        arrowView.update(combat.arrows, (out) => weaponView.launchPoint(out));
        avatar.update(dt, player, cameraRig.mode);
        weaponView.update(combat.melee, cameraRig.mode, player.ready && !player.flying, combat.kick, {
            dt,
            bowDraw: combat.bow.poseProgress,
            bowString: combat.bow.stringPull,
            arrowNocked: combat.bow.arrowNocked,
            crossbow: {
                lowered: combat.crossbow.lowered,
                cocked: combat.crossbow.cocked,
                boltSeat: combat.crossbow.boltSeat,
                recoil: combat.crossbow.recoil,
                slide: combat.crossbow.magazineSlide,
                loading: combat.crossbow.refill.next,
            },
            blocking: combat.blocking,
        });
        combatHud.update(dt, {
            health: combat.combatant.healthFraction,
            stamina: player.stamina.fraction,
            adrenaline: combat.melee.adrenaline / tuning.adrenalineMax,
            // A crossbow has no charge: it reloads on its own.
            charge:
                combat.weapon.family === "bow"
                    ? combat.bow.drawProgress
                    : combat.weapon.family === "crossbow"
                      ? 0
                      : combat.melee.chargeProgress,
            shieldName: combat.shield?.name,
            shieldActive: combat.shieldActive,
            healthText: `${Math.ceil(combat.combatant.health)} / ${combat.combatant.maxHealth}`,
            poisoned: combat.combatant.poison.active,
            styleName: `Style: ${combat.style.name}`,
            spellName: `Spell: ${spellbook.equipped.name}${spellbook.castable(skills.current("magic")) ? "" : " (locked)"}`,
            weaponName:
                combat.weapon.family === "bow"
                    ? `${combat.weapon.name} (${combat.bow.arrows})`
                    : combat.weapon.family === "crossbow"
                      ? combat.crossbow.repeater
                          ? `${combat.weapon.name} (${combat.crossbow.loadedCount}/${combat.crossbow.magazineSize} · ${combat.crossbow.bolts})`
                          : `${combat.weapon.name} (${combat.crossbow.bolts})`
                      : combat.weapon.name,
        });
        cameraRig.update(player, weaponView.viewOffset);
        if (collisionDebug && npcs) {
            collisionDebug.update(npcs, player.footprint(), player.plane, player.x, player.y);
        }
        materials.setTime(now / 1000);
        enemyHealthBars?.update(player.x, player.y, player.plane);
        // Poison hits land on their own timers: show them as green hitsplats.
        for (const damage of combat.combatant.poisonHits) {
            hitsplats.addPlayer("poison", damage);
        }
        combat.combatant.poisonHits = [];
        for (const npc of npcs?.all() ?? []) {
            if (npc.combatant.poisonHits.length > 0) {
                for (const damage of npc.combatant.poisonHits) {
                    hitsplats.addNpc(npc, "poison", damage);
                }
                npc.combatant.poisonHits = [];
            }
        }
        hitsplats.update(dt);
        // Drained levels come back one a minute.
        if (skills.update(dt)) {
            skillsChanged();
        }
        spellEffects.update(dt);
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
            (npcs ? ` · npcs ${npcs.count}` : "") +
            ` · props ${props.count}`;
    });
}

main().catch((e) => {
    console.error(e);
    status.textContent = e instanceof Error ? e.message : String(e);
    status.classList.add("error");
});
