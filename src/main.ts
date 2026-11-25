import * as THREE from "three";

import { ActionHandler, Interaction } from "./interaction/Interaction";
import { planTransition } from "./interaction/climb";
import { Transition } from "./interaction/Transition";
import { Ambience, isUnderground } from "./world/Ambience";
import { DungeonCeilings } from "./world/DungeonCeilings";
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
import { castStrength } from "./combat/CastGesture";
import { SpellEffects, SpellGfxLibrary } from "./combat/SpellGfxView";
import { CAST_HEIGHT, IMPACT_HEIGHT, SPELL_GRAPHICS, SPLASH_GRAPHIC } from "./world/SpellGfxFormat";
import { Avatar } from "./avatar/Avatar";
import { loadAvatarAsset } from "./avatar/AvatarAsset";
import { createCacheAvatar } from "./avatar/CacheAvatar";
import { kickSample } from "./avatar/KickPose";
import { CameraRig } from "./player/CameraRig";
import { Input } from "./player/Input";
import { Player } from "./player/Player";
import { HitFeel, StunFeel, impactStrength } from "./combat/HitFeel";
import { CombatTarget, PlayerCombat } from "./combat/PlayerCombat";
import { tuning } from "./combat/tuning";
import { WeaponView } from "./combat/WeaponView";
import type { BodySource } from "./physics/Bodies";
import { CombatHud } from "./ui/CombatHud";
import { EnemyHealthBars } from "./ui/EnemyHealthBars";
import { WeaponMenu } from "./ui/WeaponMenu";
import { createCacheWeaponModel, heldItemInfo } from "./combat/CacheWeaponModel";
import { loadRodModel, rodModelFile } from "./combat/HeldRod";
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
import { MessageLog } from "./ui/MessageLog";
import { createSkills } from "./skills/SkillsSetup";
import type { SkillLocInstance } from "./world/SkillLocs";
import type { FishingSpot } from "./world/FishingSpots";
import type { SkillId } from "./combat/SkillId";
import { xpForLevel } from "./combat/Osrs";
import { SpellbookPanel } from "./ui/SpellbookPanel";
import { WorldMap } from "./ui/WorldMap";
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
/** The NPC whose cache model is the player's body when there is no player.glb. */
const PLAYER_BODY_NPC = "Hans";

const SKY_COLOR = 0x8cbee6;
const FOG_NEAR = 24;
const FOG_FAR = 80;
/** How far from the eye a rock can be mined with a click, tiles. [design] */
const GATHER_REACH = 2.5;

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

    let renderer: THREE.WebGLRenderer;
    try {
        renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            powerPreference: "high-performance",
        });
    } catch (e) {
        // The browser has no WebGL 2: usually a stopped or missing GPU driver, or hardware
        // acceleration turned off (Chrome no longer falls back to software WebGL on its own).
        throw new Error(
            "This browser could not start WebGL 2. Check that the graphics driver works and that " +
                "hardware acceleration is on (chrome://gpu shows both).",
            { cause: e },
        );
    }
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
    // The shader works in display (sRGB) colors, so use the hex's raw channels. Every world material
    // shares this vector; Ambience darkens it underground.
    const skyChannels = [((SKY_COLOR >> 16) & 0xff) / 255, ((SKY_COLOR >> 8) & 0xff) / 255, (SKY_COLOR & 0xff) / 255] as const;
    const fogColor = new THREE.Vector3(...skyChannels);
    const materials = createWorldMaterials(textures, {
        color: fogColor,
        near: FOG_NEAR,
        far: FOG_FAR,
    });

    const world = new World(WORLD_URL, manifest, materials, scene);
    // Themed ceilings over the dungeons (OSRS has none; first person would look up into black).
    new DungeonCeilings(
        world,
        scene,
        { color: fogColor, near: FOG_NEAR, far: FOG_FAR },
        `${import.meta.env.BASE_URL}ceilings/ceilings.glb`,
        `${WORLD_URL}map.json`,
    );
    // OSRS spell graphics (cast, projectile, impact, splash), small enough to fetch up front.
    const spellGfx = await SpellGfxLibrary.load(import.meta.env.BASE_URL, materials);
    spellGfx.preload([SPLASH_GRAPHIC, ...Object.values(SPELL_GRAPHICS).flatMap((g) => [g.cast, g.projectile, g.impact])]);
    // NPC arrows, rocks, spit and boss attacks too, in the background, so a first shot is not a placeholder.
    spellGfx.preload(npcGraphicIds());
    const spellEffects = new SpellEffects(scene, spellGfx);
    const npcManifest = await loadNpcManifest(manifest);
    if (npcManifest) {
        // Fishing spots are placed by the game from the wiki's locations (FishingSpots), not as NPCs.
        npcManifest.spawns = npcManifest.spawns.filter((s) => !/fishing spot$/i.test(npcManifest.appearances[s.appearance]?.name ?? ""));
    }
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
    /** NPCs and props: what combat can hit. */
    const solidBodies: BodySource<CombatTarget> = {
        collectBodies: (plane, minX, minY, maxX, maxY, out) => {
            npcs?.collectBodies(plane, minX, minY, maxX, maxY, out as never[]);
            props.collectBodies(plane, minX, minY, maxX, maxY, out);
        },
    };
    /** What the player cannot walk through: the same, less small NPCs it steps over (rats, spiders). */
    const walkBlockers: BodySource<CombatTarget> = {
        collectBodies: (plane, minX, minY, maxX, maxY, out) => {
            npcs?.walkBlockers.collectBodies(plane, minX, minY, maxX, maxY, out as never[]);
            props.collectBodies(plane, minX, minY, maxX, maxY, out);
        },
    };
    const player = new Player(world, spawnFromUrl(manifest.spawn), { bodies: walkBlockers });
    const baseFov = camera.fov;
    const cameraRig = new CameraRig(camera);
    // Only the character is lit by scene lights; the world shaders have their lighting baked in.
    scene.add(new THREE.HemisphereLight(SKY_COLOR, 0x5a4a3a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(-50, 10, 50); // the exporter's sun direction in three.js axes
    scene.add(sun);
    // Without a player.glb the body is Hans of Lumbridge's model from the cache.
    const avatar = new Avatar(
        await loadAvatarAsset(`${import.meta.env.BASE_URL}models/player.glb`, async () => {
            const file = npcManifest?.appearances.find((a) => a.name === PLAYER_BODY_NPC)?.file;
            if (!file) {
                return undefined;
            }
            const response = await fetch(`${WORLD_URL}${file}`);
            if (!response.ok) {
                throw new Error(`${file}: HTTP ${response.status}`);
            }
            return createCacheAvatar(decodeNpcModel(await gunzip(await response.arrayBuffer())));
        }),
    );
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
        // Small and on screen (inventory icons, a held tool): ahead of the region and NPC downloads,
        // which otherwise take every connection while the map streams in.
        const response = await fetch(`${WORLD_URL}${file}`, { priority: "high" } as RequestInit);
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
        avatar.viewFrame,
        (weaponId) => {
            const info = weaponMenu.find(weaponId);
            // An item held without a worn model: a rod is the Blender rod, any other tool (a net,
            // a harpoon) its inventory model in the hand; both take WeaponView's tool poses.
            const item = info ? undefined : itemDb.get(Number(/^cache-(\d+)$/.exec(weaponId)?.[1] ?? NaN));
            const rod = item && rodModelFile(item.name);
            if (rod) {
                return loadRodModel(`${import.meta.env.BASE_URL}models/fishing/${rod}`);
            }
            if (item?.model) {
                return loadItemModel(item.model).then((data) => {
                    const model = createCacheWeaponModel(heldItemInfo(item.id, item.name, item.model, data), data, materials);
                    model.userData.hold = "tool";
                    return model;
                });
            }
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
    // The developer cheat menu (I, dev builds only): any cache weapon, shield or item into the inventory, and any skill level.
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
        {
            list: document.getElementById("weapon-menu-skills")!,
            level: (id) => skills.level(id),
            setLevel: (id, level) => {
                skills.setXp(id, xpForLevel(level));
                skillsChanged();
            },
        },
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
    const stunFeel = new StunFeel();
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
            // A parried blade is caught dead: it stalls and shakes the view hardest of all. A blade
            // taken on a guard does not bite: it stops dead there (PlayerCombat), rattling in the hand.
            if (result.defence === "guard") {
                weaponView.clash(move.kind === "quick" ? 0.6 : 1);
            } else {
                weaponView.impact(result.defence === "parry" ? 2 : move.kind === "quick" ? 0.6 : 1);
            }
            if (result.defence === "parry") {
                // The blade is wrenched aside, jerking the head with it.
                weaponView.clash(1);
                stunFeel.kick(Math.random() < 0.5 ? -1 : 1, 0.35);
            }
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
        // The hands thrust the spell out through the cast graphic (CastGesture), in both views.
        weaponView.cast(castStrength(spell.id));
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
            // A blow (an NPC's strike or its blow back from a parry) taken on the held weapon.
            ui.showMessage("Parried!");
            weaponView.clash(1);
            if (damage > 0) {
                // Some of a blow that would have landed gets through the block.
                combatHud.showDamage(damage, false);
                hitsplats.addPlayer("damage", damage);
            }
        }
    };
    combat.onStunned = () => {
        ui.showMessage("Your blow is parried and you're stunned!");
        combatHud.showDamage(); // the red flash of a blow taken, with no damage to show
        // The blow lands: the world holds on it, the head snaps back, the view punches wide and the
        // weapon rattles in the hand.
        hitFeel.impact(1);
        stunFeel.kick(Math.random() < 0.5 ? -1 : 1);
        weaponView.clash(1);
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
        skillSystem.onNpcDeath(npc);
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
    const messageLog = new MessageLog(document.getElementById("message-log")!);
    const ui = {
        setPrompt: (text: string) => (promptElement.textContent = text),
        showMessage: (text: string) => {
            messageLog.add(text);
            messageElement.textContent = text;
            clearTimeout(messageTimer);
            messageTimer = setTimeout(() => (messageElement.textContent = ""), 2500);
        },
    };
    const interactives = new WorldInteractives(world, scene, materials, {
        bodies: npcs,
        player: () => player.footprint(),
    });
    // Going through an entrance: fade to black, teleport, fade back in (see Transition).
    const fadeElement = document.getElementById("fade")!;
    const transition = new Transition(player, ui.showMessage, (x, y) => world.isFailed(x, y));
    const clearColor = new THREE.Color();
    const ambience = new Ambience(skyChannels, fogColor, (r, g, b) =>
        renderer.setClearColor(clearColor.setRGB(r, g, b, THREE.SRGBColorSpace)),
    );
    /** A skill panel or the side panel closed: take the mouse back, else show "Click to play". */
    const panelClosed = () => {
        if (player.ready) {
            input.lock();
        }
        setTimeout(() => overlay.classList.toggle("hidden", input.locked), 250);
    };
    const skilling = await createSkills({
        worldUrl: WORLD_URL,
        world,
        scene,
        materials,
        player,
        items,
        db: itemDb,
        icons: itemIcons,
        loadItemModel,
        skills,
        ground: groundItems,
        npcs: () => npcs?.all() ?? [],
        hurt: (amount) => {
            if (combat.combatant.dead) return;
            combat.combatant.hurt(amount, "flinch");
            combatHud.showDamage(amount);
            hitsplats.addPlayer("damage", amount);
        },
        log: (text) => messageLog.add(text),
        message: (text) => ui.showMessage(text),
        xpGained: (ups) => xpGained(ups),
        openBank: () => sidePanel.openBank(),
        panelClosed,
        storage: browserStorage(),
    });
    const skillSystem = skilling.system;
    let slayerWarned = -Infinity;
    combat.canDamage = (target) => {
        const id = (target as unknown as Partial<Npc>).appearance?.id;
        if (id === undefined || skillSystem.slayer.canDamage(id)) return true;
        if (performance.now() - slayerWarned > 3000) {
            slayerWarned = performance.now();
            ui.showMessage("You need a higher Slayer level to know how to wound this monster.");
        }
        return false;
    };
    // A weapon swung into a standing tree or rock lodges there (the blade meets the trunk); an axe
    // swung into a tree chops it. Mining is not done by swings but by clicking the rock with the
    // pickaxe (SkillSystem.clickLoc).
    combat.solids = skilling.skillLocs.solidSource((instance) => skillSystem.isSolid(instance));
    combat.onSolidHit = (ref) => {
        weaponView.impact(0.8);
        skillSystem.swingHit(ref as SkillLocInstance);
    };
    skillSystem.onToolImpact = () => weaponView.impact(0.8);
    /** Uses a ladder, stair or passage: where it leads comes from its links, else the climb rules. */
    const goThrough = (loc: InteractiveLoc, action: string) => {
        const from = { x: player.x, y: player.y };
        const plan = planTransition(world, loc, action, from);
        if ("message" in plan) {
            ui.showMessage(plan.message);
            return;
        }
        const entering = !isUnderground(from.y) && isUnderground(plan.y);
        transition.start({
            x: plan.x,
            y: plan.y,
            plane: plan.plane,
            ...(entering && plan.dungeon ? { message: `You climb down into ${plan.dungeon}.` } : {}),
        });
    };
    const handleWorldAction: ActionHandler = (target, action) => {
        if (target.kind === "skill-loc") {
            skillSystem.locAction(target.ref as SkillLocInstance, action);
        } else if (target.kind === "fishing-spot") {
            skillSystem.fishing.spotAction(target.ref as FishingSpot, action);
        } else if (target.kind === "door") {
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
        } else if (target.kind === "hatch") {
            const hatch = target.ref as Parameters<WorldInteractives["setHatchOpen"]>[0];
            if (/^open$/i.test(action)) {
                interactives.setHatchOpen(hatch, true);
            } else if (/^close$/i.test(action)) {
                interactives.setHatchOpen(hatch, false);
            } else {
                goThrough(hatch.loc, action);
            }
        } else if (target.kind === "climb" || target.kind === "passage") {
            goThrough(target.ref as InteractiveLoc, action);
        }
    };
    const interaction = new Interaction(
        (plane, x, y) => world.collisionFlags(plane, x, y),
        [
            ...(npcs ? [npcTargetSource(npcs)] : []),
            interactives.targetSource(),
            props.targetSource(),
            groundItems.targetSource(),
            skilling.skillLocs.targetSource(),
            skilling.fishingSpots.targetSource(),
        ],
        ui,
        createNpcActionHandler(player, ui, handleWorldAction, () => sidePanel.openBank(), (npc, action) => skillSystem.npcAction(npc, action)),
    );
    interaction.onUse = (target, slot) => {
        if (target.kind === "skill-loc") skillSystem.useItemOnLoc(target.ref as SkillLocInstance, slot);
        else if (target.kind === "npc") skillSystem.useItemOnNpc();
        else messageLog.add("Nothing interesting happens.");
    };
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
            // If the mouse could not be taken back, the "Click to play" panel shows again.
            closed: panelClosed,
            action: (slot, action) => skillSystem.itemOption(slot, action),
            use: (slot) => {
                const stack = items.inventory.slots[slot];
                const name = stack ? itemDb.get(stack.id)?.name : undefined;
                interaction.useItem = name ? { slot, name } : undefined;
            },
            useOn: (from, to) => {
                interaction.useItem = undefined;
                skillSystem.useItemOnItem(from, to);
            },
            shop: () => (skilling.shopPanel.isOpen ? skilling.shopPanel : undefined),
        },
    );
    skilling.shopPanel.showMenu = (x, y, entries) => sidePanel.showMenu(x, y, entries);
    const worldMap = new WorldMap(document.getElementById("world-map")!, WORLD_URL, skilling.data, () => player);
    worldMap.closed = panelClosed;
    items.onChange = () => {
        syncWeapon();
        sidePanel.refresh();
    };
    window.addEventListener("keydown", (event) => {
        if (event.repeat || event.target instanceof HTMLInputElement) {
            return;
        }
        if (event.code === "Escape" || event.code === "Tab") {
            interaction.useItem = undefined;
            sidePanel.useFrom = -1;
        }
        if (event.code === "Tab") {
            event.preventDefault();
            sidePanel.toggle("inventory");
        } else if (event.code === "KeyK") {
            sidePanel.toggle("skills");
        } else if (event.code === "KeyB") {
            sidePanel.toggle("spellbook");
        } else if (event.code === "KeyM") {
            worldMap.toggle();
        } else if (event.code === "KeyX" && input.locked) {
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
                renderer, scene, camera, world, player, npcs, props, cameraRig, avatar, interaction, interactives, combat, tuning, worldMap,
                skills, spellbook, items, db: itemDb, itemIcons, groundItems, sidePanel, hitsplats, spellEffects,
                clock: skilling.clock, skillLocs: skilling.skillLocs, fishingSpots: skilling.fishingSpots, skillSystem, skillsData: skilling.data,
                /** game.give("Bronze axe") */
                give: (name: string, qty = 1) => {
                    const item = itemDb.byName(name);
                    if (item) items.give(item.id, qty);
                    return item?.id;
                },
                /** game.setLevel("woodcutting", 60) */
                setLevel: (skill: SkillId, level: number) => {
                    skills.setXp(skill, xpForLevel(level));
                    skillsChanged();
                },
                tp: (x: number, y: number, plane = 0) => player.teleport(x + 0.5, y + 0.5, plane),
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
    input.onLockChange = (locked) => overlay.classList.toggle("hidden", locked || sidePanel.isOpen || skilling.panelOpen || worldMap.isOpen);

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

        // A failed pickpocket stuns, as does an NPC's parry: no moving or fighting, only looking around.
        const stunned = skillSystem.thieving.stunned || combat.stunned;
        if (stunned) player.boundFor = Math.max(player.boundFor, 0.1);
        // No walking off while the screen fades through an entrance.
        if (transition.active) player.boundFor = Math.max(player.boundFor, 0.1);
        player.update(dt, input);
        transition.update(dt);
        fadeElement.style.opacity = String(transition.opacity);
        ambience.update(dt, player.y);
        skilling.clock.update(dt);
        skilling.reactions.update(dt);
        // A left click on a fishing spot with its tool in hand starts fishing there (the same click
        // casts or scoops). Fishing gear never attacks.
        const clicked = input.locked && !props.held && input.wasPressed("Mouse0");
        const gearOnly = skilling.isFishingGear(items.equipment.get("weapon")?.id);
        const aimedSpot = interaction.target?.kind === "fishing-spot" ? (interaction.target.ref as FishingSpot) : undefined;
        const fishClick = clicked && aimedSpot !== undefined && skillSystem.fishing.clickSpot(aimedSpot);
        // A left click on a rock with a pickaxe in hand mines it when in reach and says to come
        // closer when not; it is never a weapon attack, so clicks at the edge of reach do not mix
        // strikes and swings. (An axe is just swung: a blow that lodges in a tree chops it.)
        const aimedLoc = interaction.target?.kind === "skill-loc" ? (interaction.target.ref as SkillLocInstance) : undefined;
        const workAimed = aimedLoc !== undefined && skillSystem.minesWith(aimedLoc);
        // An attack already under way (a swing, a power attack being charged, a blade lodged) plays
        // out: the click goes to it, not to a pick strike.
        const attacking = combat.melee.swing !== undefined || combat.melee.isCharging || combat.melee.lodged !== undefined;
        if (clicked && !fishClick && workAimed && !attacking) skillSystem.clickLoc(aimedLoc!, interaction.target!.distance <= GATHER_REACH);
        // Fishing and mining take the attack button: click to cast and hook, hold to reel or to
        // keep striking.
        const casting = skillSystem.takesClicks;
        if (clicked && gearOnly && !casting && !fishClick) {
            ui.showMessage(aimedSpot ? "You can't fish here with that." : "Aim at a fishing spot to fish.");
        }
        skillSystem.update({
            acted: input.locked && ((input.wasPressed("Mouse0") && !casting) || input.wasPressed("KeyF")),
            panelOpen: sidePanel.isOpen || skilling.panelOpen,
            dead: combat.combatant.dead,
            dt,
            pointer: {
                pressed: input.locked && !props.held && input.wasPressed("Mouse0"),
                down: input.locked && !props.held && input.isDown("Mouse0"),
                aimed: interaction.target?.ref,
            },
        });
        const fighting = input.locked && player.ready && !player.flying && !stunned;
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
        // While carrying or fishing the weapon stays still.
        const armed = !carrying && !casting;
        // A rod, net or cage in hand: no swings or blocks with it.
        const swinging = armed && !gearOnly && !(workAimed && !attacking);
        cameraRig.zoomBy(input.consumeWheel());
        eatCooldown = Math.max(0, eatCooldown - dt);
        const wieldProblem = items.cycleWeapon(armed && input.wasPressed("KeyQ") ? 1 : 0);
        if (wieldProblem) {
            ui.showMessage(wieldProblem);
        }
        combat.update(dt, player, {
            // A tap that went down and up between frames still counts as down for this one.
            attackDown: fighting && swinging && (input.isDown("Mouse0") || input.wasPressed("Mouse0")),
            attackPressed: fighting && swinging && input.wasPressed("Mouse0"),
            blockDown: fighting && swinging && input.isDown("Mouse2"),
            kickPressed: fighting && armed && input.wasPressed("KeyF"),
            castPressed:
                fighting && armed && (input.wasPressed("KeyG") || (combat.holdsCaster && input.wasPressed("Mouse2"))),
            aimPitch: cameraRig.aimPitch(player.pitch),
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
        const fov = baseFov * (1 - zoom * (1 - tuning.bowZoomFov)) * (1 + stunFeel.fov);
        if (Math.abs(camera.fov - fov) > 1e-3) {
            camera.fov = fov;
            camera.updateProjectionMatrix();
        }
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
        const melee = combat.melee;
        avatar.setKick(kickSample(combat.kick.elapsed, combat.kick.low));
        avatar.update(
            dt,
            player,
            cameraRig.mode,
            !!(melee.swing || melee.chargedMove || melee.lodged) || combat.blocking || combat.kick.active || combat.bow.poseProgress > 0,
        );
        weaponView.setSkillSwing(skillSystem.swingPhase());
        // Picking a pocket: the held item is put away, the view glances down and leans in.
        const thiefLook = skilling.updateThieving(dt);
        weaponView.setLowered(thiefLook.stow);
        weaponView.setToolMotion(skillSystem.toolMotion());
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
        {
            // The fishing line leaves the rod tip; a caught fish lands at the body's chest (below
            // where the first-person eye would be, not the camera, which is behind in third person).
            const chest = avatar.viewFrame.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.45, 0));
            const tip = weaponView.tipPoint(new THREE.Vector3()) ?? chest.clone();
            skilling.updateViews(dt, tip, chest);
        }
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
        {
            // The pickpocketing look goes on top of the swing's offset.
            const v = weaponView.viewOffset;
            const look = thiefLook;
            // Knocked about by a parry, then dazed while stunned.
            stunFeel.update(dt, combat.stunned);
            const s = stunFeel.view;
            cameraRig.update(
                player,
                { ...look, pitch: v.pitch + look.pitch + s.pitch, yaw: v.yaw + look.yaw + s.yaw, roll: v.roll + look.roll + s.roll },
                dt,
            );
        }
        {
            // The right hand closes on the held item's grip, the torso turning with it; the arm
            // hangs as animated otherwise. The item is posed in the camera in first person, in the
            // body's own view frame in third.
            const grip = weaponView.gripPoint(new THREE.Vector3());
            if (grip) {
                avatar.reachRightHand(grip, cameraRig.mode === "first" ? camera : avatar.viewFrame);
            }
            // Third person: the free hand guards and counters the swing; either view: it casts.
            const offHand = weaponView.offHandPoint(new THREE.Vector3());
            if (offHand) {
                avatar.reachLeftHand(offHand);
            }
            // Third person: the head looks where the reticule is (the camera's line through the eyes).
            if (cameraRig.mode === "third") {
                avatar.lookAlong(camera.getWorldDirection(new THREE.Vector3()));
            }
        }
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
