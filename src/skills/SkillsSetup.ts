// Builds the skill engine and its panels from the game's systems (called once from main.ts).

import * as THREE from "three";

import type { LevelUp, PlayerSkills } from "../combat/Skills";
import { tuning } from "../combat/tuning";
import { TickClock } from "../game/TickClock";
import { GroundItems, modelMeshes } from "../items/GroundItems";
import type { ItemDb } from "../items/ItemDb";
import type { ItemIcons } from "../items/ItemIcons";
import type { PlayerItems } from "../items/PlayerItems";
import type { Npc } from "../npc/Npc";
import { MakeMenu } from "../ui/MakeMenu";
import { ShopPanel } from "../ui/ShopPanel";
import { XpDrops } from "../ui/XpDrops";
import { NpcModelData, decodeNpcModel } from "../world/NpcFormat";
import { ShopManifest, SkillsManifest, emptySkillsManifest } from "../world/SkillFormat";
import { FishingBar } from "../ui/FishingBar";
import { FishingSpots } from "../world/FishingSpots";
import { LocReactions } from "../world/LocReactions";
import { SkillLocs } from "../world/SkillLocs";
import type { World } from "../world/World";
import { CollisionFlag } from "../world/WorldFormat";
import { gunzip } from "../world/gunzip";
import type { SkillContext } from "./SkillContext";
import { FishJob } from "./fishing";
import { FishingView } from "./FishingView";
import { SkillSystem } from "./SkillSystem";

/** Collision bits a player cannot stand on. */
const SOLID = CollisionFlag.OBJECT | CollisionFlag.FLOOR | CollisionFlag.FLOOR_DECORATION;
const STORE_KEY = "first-person-survival.skill-state.v1";

async function loadJson<T>(url: string): Promise<T | undefined> {
    try {
        const response = await fetch(url);
        // Vite's dev server answers missing files with index.html, so check the type too.
        if (!response.ok || !(response.headers.get("content-type") ?? "").includes("json")) return undefined;
        return (await response.json()) as T;
    } catch {
        return undefined;
    }
}

export type SkillsDeps = {
    worldUrl: string;
    world: World;
    scene: THREE.Scene;
    materials: { opaque: THREE.Material; transparent: THREE.Material };
    player: { x: number; y: number; plane: number; teleport(x: number, y: number, plane: number): void };
    items: PlayerItems;
    db: ItemDb;
    icons: ItemIcons;
    /** An item's model (public/world/items/), for a caught fish leaping out of the water. */
    loadItemModel(file: string): Promise<NpcModelData>;
    skills: PlayerSkills;
    ground: GroundItems;
    npcs: () => Npc[];
    hurt(amount: number): void;
    /** A game message for the log. */
    log(text: string): void;
    /** Centre-screen message (also logged). */
    message(text: string): void;
    /** Level-ups: refresh panels and the health a Hitpoints level brings. */
    xpGained(ups: LevelUp[]): void;
    openBank(): void;
    /** A skill panel closed: the game takes the mouse back. */
    panelClosed(): void;
    storage: Storage | undefined;
};

/** Saved skill state (patches, Slayer task) in one localStorage entry. */
function createStore(storage: Storage | undefined): SkillContext["store"] {
    let state: Record<string, unknown> = {};
    try {
        state = JSON.parse(storage?.getItem(STORE_KEY) ?? "{}") as Record<string, unknown>;
    } catch {
        // Unreadable save: start fresh.
    }
    return {
        get: <T,>(key: string) => (state[key] ?? undefined) as T | undefined,
        set: (key, value) => {
            state[key] = value;
            try {
                storage?.setItem(STORE_KEY, JSON.stringify(state));
            } catch {
                // Not saved this time.
            }
        },
    };
}

export async function createSkills(deps: SkillsDeps) {
    const data = (await loadJson<SkillsManifest>(`${deps.worldUrl}skills.json`)) ?? emptySkillsManifest();
    const shops = (await loadJson<ShopManifest>(`${deps.worldUrl}shops.json`)) ?? { format: 1, shops: [], values: {} };
    if (data.source === "none") console.warn("No skills.json: skills are off (npm run export-skills)");

    // Fishing tools are held in hand to fish.
    for (const spot of data.fishing) for (const tool of spot.tools) deps.db.makeWieldable(tool);

    const clock = new TickClock();
    const skillLocs = new SkillLocs(deps.world, deps.scene, deps.materials);
    const reactions = new LocReactions((plane, x, y) => deps.world.groundHeight(plane, x, y));
    const xpDrops = new XpDrops(document.getElementById("xp-drops")!, document.getElementById("level-banner")!);
    const makeMenu = new MakeMenu(document.getElementById("make-menu")!, deps.db, deps.icons);
    const shopPanel = new ShopPanel(document.getElementById("shop-panel")!, deps.items, deps.db, deps.icons, shops.values);
    makeMenu.closed = deps.panelClosed;
    shopPanel.closed = deps.panelClosed;
    shopPanel.message = deps.message;

    // Models of the locs the game places (fires, traps): fetched once, new meshes per placement.
    const decoded = new Map<number, Promise<NpcModelData>>();
    const locModel = async (id: number): Promise<THREE.Object3D> => {
        let model = decoded.get(id);
        if (!model) {
            model = fetch(`${deps.worldUrl}skill-models/loc-${id}.bin`).then(async (r) => {
                if (!r.ok) throw new Error(`loc ${id}: HTTP ${r.status}`);
                return decodeNpcModel(await gunzip(await r.arrayBuffer()));
            });
            decoded.set(id, model);
        }
        const group = new THREE.Group();
        group.add(...modelMeshes(await model, 0, deps.materials));
        return group;
    };

    const ctx: SkillContext = {
        data,
        clock,
        skills: deps.skills,
        gainXp: (skill, xp) => {
            if (!(xp > 0)) return;
            xpDrops.add(skill, xp);
            const ups = deps.skills.addXp({ [skill]: xp });
            for (const up of ups) deps.log(xpDrops.levelUp(up.skill, up.level));
            deps.xpGained(ups);
        },
        items: deps.items,
        db: deps.db,
        weapon: () => deps.items.equipment.get("weapon")?.id,
        wield: (item) => {
            const slot = deps.items.inventory.slots.findIndex((s) => s?.id === item);
            return slot < 0 ? "You don't have that." : deps.items.wield(slot);
        },
        drop: (stack, x, y, plane) => deps.ground.add(stack, x, y, plane, { despawnIn: tuning.groundItemDespawn }),
        skillLocs,
        animate: (instance, clip, linger) => reactions.play(instance, clip, deps.player.x, deps.player.y, linger),
        player: deps.player,
        hurt: deps.hurt,
        log: deps.log,
        npcsNear: (plane, x, y, r) =>
            deps.npcs().filter((n) => !n.gone && !n.combatant.dead && n.plane === plane && Math.hypot(n.body.x - x, n.body.y - y) <= r),
        walkable: (plane, x, y) =>
            deps.world.hasFloor(plane, x, y) && !deps.world.isWater(plane, x, y) && (deps.world.collisionFlags(plane, x, y) & SOLID) === 0,
        locModel,
        store: createStore(deps.storage),
    };

    const system = new SkillSystem(ctx, {
        openMake: (title, options, onPick) => makeMenu.open(title, options, onPick),
        openShop: (shop) => shopPanel.open(shop),
        openBank: deps.openBank,
    });
    system.shops = shops.shops;

    // Fishing: the wiki's spots (Blender spot model), the bobber, line and leaping fish, the reel bar.
    const fishingSpots = new FishingSpots(data.fishingSpots, deps.world, deps.scene, (npcId) => system.fishing.actionsOf(npcId));
    const fishingView = new FishingView(deps.scene, deps.materials, deps.loadItemModel, (item) => deps.db.get(item)?.model);
    const fishingBar = new FishingBar(document.getElementById("fishing-bar")!);
    const modelsUrl = deps.worldUrl.replace(/world\/$/, "models/fishing/");
    await Promise.all([fishingSpots.load(`${modelsUrl}spot.glb`), fishingView.load(`${modelsUrl}bobber.glb`)]).catch((e) => console.warn("Fishing models could not be loaded", e));
    system.fishing.onCatch = (spot, item) => fishingView.jump(item, spot.x, spot.y, spot.waterZ);
    skillLocs.look = (i) => system.look(i);
    skillLocs.actionsOf = (i) => system.actionsOf(i);
    clock.onTick((t) => shopPanel.tick(t));

    return {
        data,
        clock,
        skillLocs,
        /** Tree and rock reactions to blows; update every frame. */
        reactions,
        system,
        shopPanel,
        fishingSpots,
        /** Per frame, after the weapon view: spots, bobber and line, leaping fish and the reel bar. */
        updateFishing(dt: number, tip: THREE.Vector3, chest: THREE.Vector3): void {
            fishingSpots.update(dt, deps.player);
            const job = system.active instanceof FishJob ? system.active : undefined;
            fishingView.update(dt, job, tip, chest);
            fishingBar.update(job?.minigame);
        },
        /** Whether a skill panel is open (the click-to-play overlay stays hidden meanwhile). */
        get panelOpen(): boolean {
            return makeMenu.isOpen || shopPanel.isOpen;
        },
    };
}
