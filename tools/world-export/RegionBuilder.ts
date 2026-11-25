import { ContourGroundInfo } from "./rs/config/loctype/LocModelLoader";
import { LocModelType } from "./rs/config/loctype/LocModelType";
import type { LocType } from "./rs/config/loctype/LocType";
import { Model } from "./rs/model/Model";
import type { Loc } from "./rs/scene/Loc";
import { Scene } from "./rs/scene/Scene";
import { LocLoadType } from "./rs/scene/SceneBuilder";
import { SceneLoc } from "./rs/scene/SceneLoc";
import { SceneTile } from "./rs/scene/SceneTile";
import { SceneTileModel } from "./rs/scene/SceneTileModel";
import { Entity } from "./rs/scene/entity/Entity";
import { getIdFromTag } from "./rs/scene/entity/EntityTag";
import { LocEntity } from "./rs/scene/entity/LocEntity";
import {
    DoorMesh,
    InteractiveLoc,
    LEVELS,
    REGION_SIZE,
    RS_UNITS_PER_TILE,
    RegionData,
} from "../../src/world/WorldFormat";
import { SURFACE_MAX_MAP_Y } from "./DungeonCandidates";
import { DungeonLinkIndex, toLocLink } from "./DungeonLinks";
import { areGateLeaves, doorStates, gateLeafStates, isBank, isClimbable, placedDoorState } from "./Interactives";
import { MAX_PROP_HEIGHT, propClassFor, propExtent } from "./Props";
import { stripNameTags } from "./NpcSpawns";
import { FaceColors, BRIGHTNESS } from "./FaceColors";
import { MeshBuilder } from "./MeshBuilder";
import { WorldLoaders } from "./WorldLoaders";
import type { OverlayFloorTypeLoader } from "./rs/config/floortype/FloorTypeLoader";
import type { SkillLocIndex } from "./skills/SkillLocIndex";

// Neighbouring tiles are decoded too, so underlay blending, lighting and ground contouring are
// seamless across region edges.
const BORDER_SIZE = 6;
const SCENE_SIZE = REGION_SIZE + BORDER_SIZE * 2;
const BORDER_OFFSET = -BORDER_SIZE * 128;

export { BRIGHTNESS };

/** Used until a door's model has been measured, and for ladders, which have no mesh of their own. */
const DEFAULT_INTERACTIVE_HEIGHT = 2;

// Depth priority per kind of loc, added to each face's own priority (see the shader's bias).
const PRIORITY_FLOOR_DECORATION = 3;
const PRIORITY_WALL = 1;
const PRIORITY_WALL_DECORATION = 2;
const PRIORITY_LOC = 1;

export type RegionStats = { tiles: number; locs: number; triangles: number; buildMs: number; links: number };

/** Doors and ladders found in a region's scene. */
type FoundInteractives = {
    interactives: InteractiveLoc[];
    /** Every straight-wall door in the scene (also on the border), whose collision stays baked. */
    doorWalls: Set<SceneLoc>;
    /** Door wall -> index into doorBuilders, for the doors this region exports. */
    doorByWall: Map<SceneLoc, number>;
    /** Physics prop loc -> index into doorBuilders (props get their own meshes like doors). */
    propByLoc: Map<SceneLoc, number>;
    /** Skill locs whose look can change (trees, rocks, patches), drawn into their own meshes. */
    skillByLoc: Map<SceneLoc, InteractiveLoc>;
    /** Closed trapdoors and manholes: the loc and the id of its open model, drawn into two own meshes. */
    hatchByLoc: Map<SceneLoc, { interactive: InteractiveLoc; openId: number }>;
    /** Ladders and passages, whose height is measured from their model. */
    entranceByLoc: Map<SceneLoc, InteractiveLoc>;
    /** Dungeon links attached to the entrances of this region. */
    linksAttached: number;
    doorBuilders: { opaque: MeshBuilder; transparent: MeshBuilder }[];
};

type Builders = { opaque: MeshBuilder; transparent: MeshBuilder };

type PlacedEntity = {
    entity: Entity;
    sceneLoc: SceneLoc;
    level: number;
    offsetX: number;
    offsetZ: number;
    priority: number;
};

export class RegionBuilder {
    constructor(
        readonly loaders: WorldLoaders,
        private readonly colors: FaceColors = new FaceColors(loaders.textureLoader),
        /** Which locs are skill targets (data/skill-locs.json); none without it. */
        private readonly skillLocs?: SkillLocIndex,
        /** Where entrances lead (data/dungeon-links.json); entrances get no links without it. */
        private readonly dungeonLinks?: DungeonLinkIndex,
    ) {}

    /** Texture ids in texture-array order (layer = index + 1). */
    getTextureIds(): number[] {
        return this.loaders.textureLoader.getTextureIds();
    }

    /** Drops decoded models. Call between regions to keep memory bounded over a full export. */
    clearCaches(): void {
        this.loaders.locModelLoader.clearCache();
    }

    build(mapX: number, mapY: number): { region: RegionData; stats: RegionStats } | undefined {
        const start = performance.now();
        const { sceneBuilder } = this.loaders;
        if (!sceneBuilder.getTerrainData(mapX, mapY)) {
            return undefined;
        }

        const baseX = mapX * REGION_SIZE - BORDER_SIZE;
        const baseY = mapY * REGION_SIZE - BORDER_SIZE;
        const scene = sceneBuilder.buildScene(
            baseX,
            baseY,
            SCENE_SIZE,
            SCENE_SIZE,
            true,
            LocLoadType.MODELS,
        );

        const terrain = new MeshBuilder(16384);
        const opaque = new MeshBuilder(32768);
        const transparent = new MeshBuilder(1024);

        let tiles = 0;
        const placed: PlacedEntity[] = [];
        for (let level = 0; level < LEVELS; level++) {
            for (let x = BORDER_SIZE; x < BORDER_SIZE + REGION_SIZE; x++) {
                for (let y = BORDER_SIZE; y < BORDER_SIZE + REGION_SIZE; y++) {
                    const tile = scene.tiles[level][x][y];
                    if (!tile) {
                        continue;
                    }
                    if (tile.tileModel) {
                        this.addTileModel(terrain, tile.tileModel, level);
                        tiles++;
                    }
                    collectTileLocs(placed, tile, level, x, y);
                }
            }
        }

        const found = this.findInteractives(scene, mapX, mapY);

        let locs = 0;
        for (const p of placed) {
            const hatch = found.hatchByLoc.get(p.sceneLoc);
            if (hatch && this.addHatchMeshes(scene, found, p, hatch.interactive, hatch.openId)) {
                locs++;
                continue;
            }
            const skillLoc = found.skillByLoc.get(p.sceneLoc);
            if (skillLoc) {
                this.addSkillLocMeshes(scene, found, p, skillLoc);
                locs++;
                continue;
            }
            const resolved = this.resolveModel(scene, p);
            if (resolved) {
                const doorIndex = found.doorByWall.get(p.sceneLoc);
                const propIndex = found.propByLoc.get(p.sceneLoc);
                if (propIndex !== undefined) {
                    // A prop gets its own meshes, so the game can move and turn it.
                    const builders = found.doorBuilders[propIndex];
                    this.addModel(
                        { doubleSided: builders.opaque, opaque: builders.opaque, transparent: builders.transparent },
                        resolved.model,
                        p,
                        resolved.height,
                    );
                    const interactive = found.interactives.find((i) => i.prop?.mesh === propIndex)!;
                    const model = resolved.model;
                    const extent = propExtent(
                        model.verticesX,
                        model.verticesY,
                        model.verticesZ,
                        model.verticesCount,
                        RS_UNITS_PER_TILE,
                    );
                    interactive.height = extent.height;
                    interactive.prop!.radius = Math.min(0.5, Math.max(0.15, extent.radius * 0.8));
                    interactive.prop!.z = -resolved.height / RS_UNITS_PER_TILE;
                } else if (doorIndex !== undefined) {
                    // A door gets its own meshes, so the game can swing it around its hinge.
                    const door = found.doorBuilders[doorIndex];
                    this.addModel(
                        { doubleSided: door.opaque, opaque: door.opaque, transparent: door.transparent },
                        resolved.model,
                        p,
                        resolved.height,
                    );
                    const interactive = found.interactives.find((i) => i.door?.mesh === doorIndex)!;
                    interactive.height = Math.max(interactive.height, modelHeight(resolved.model));
                } else {
                    this.addModel(
                        { doubleSided: terrain, opaque, transparent },
                        resolved.model,
                        p,
                        resolved.height,
                    );
                    const entrance = found.entranceByLoc.get(p.sceneLoc);
                    if (entrance) {
                        entrance.height = Math.max(entrance.height, modelHeight(resolved.model));
                    }
                }
                locs++;
            }
        }

        this.makeDoorsPassable(scene, found.doorWalls);

        const meshes = {
            terrain: terrain.build(),
            opaque: opaque.build(),
            transparent: transparent.build(),
        };
        const doorMeshes: DoorMesh[] = found.doorBuilders.map((door) => ({
            opaque: door.opaque.build(),
            transparent: door.transparent.build(),
        }));
        const triangles =
            (meshes.terrain.indices.length +
                meshes.opaque.indices.length +
                meshes.transparent.indices.length +
                doorMeshes.reduce(
                    (sum, door) => sum + door.opaque.indices.length + door.transparent.indices.length,
                    0,
                )) /
            3;

        return {
            region: {
                mapX,
                mapY,
                ...meshes,
                ...extractTerrainData(scene, this.loaders.overlayTypeLoader, mapY > SURFACE_MAX_MAP_Y),
                interactives: found.interactives,
                doorMeshes,
            },
            stats: { tiles, locs, triangles, buildMs: Math.round(performance.now() - start), links: found.linksAttached },
        };
    }

    /**
     * Doors the game cannot open keep no collision: diagonal and corner doors, which are not
     * straight walls that can swing. Straight-wall doors are interactive and keep theirs.
     */
    private makeDoorsPassable(scene: Scene, interactiveDoors: Set<SceneLoc>): void {
        const { locTypeLoader, varManager } = this.loaders;
        for (let level = 0; level < LEVELS; level++) {
            for (let x = 1; x < SCENE_SIZE - 1; x++) {
                for (let y = 1; y < SCENE_SIZE - 1; y++) {
                    const tile = scene.tiles[level][x][y];
                    if (tile?.wall && interactiveDoors.has(tile.wall)) {
                        continue;
                    }
                    const doorTag = tile?.wall?.tag ?? findDiagonalWallTag(tile);
                    if (doorTag === undefined) {
                        continue;
                    }
                    // Collision comes from the base type, the actions from the displayed one.
                    const locType = locTypeLoader.load(getIdFromTag(doorTag));
                    const shown = locType.transforms
                        ? locType.transform(varManager, locTypeLoader)
                        : locType;
                    if (locType.clipType === 0 || !isOpenable((shown ?? locType).actions)) {
                        continue;
                    }
                    // Same level remapping SceneBuilder.decodeLocs applies under bridges.
                    let collisionLevel = level;
                    if ((scene.tileRenderFlags[1][x][y] & 0x2) === 2) {
                        collisionLevel--;
                    }
                    if (collisionLevel < 0) {
                        continue;
                    }
                    const collisionMap = scene.collisionMaps[collisionLevel];
                    const flags = scene.getLocFlags(level, x, y, doorTag);
                    const type: LocModelType = flags & 0x3f;
                    const rotation = (flags >> 6) & 0x3;
                    if (type === LocModelType.WALL_DIAGONAL) {
                        const rotated = rotation === 1 || rotation === 3;
                        collisionMap.removeLoc(
                            x,
                            y,
                            rotated ? locType.sizeY : locType.sizeX,
                            rotated ? locType.sizeX : locType.sizeY,
                            locType.blocksProjectile,
                        );
                    } else {
                        collisionMap.removeWall(x, y, type, rotation, locType.blocksProjectile);
                    }
                }
            }
        }
    }

    /**
     * Finds the doors and ladders of the region. Doors are straight walls with an "Open" or
     * "Close" action; ladders and stairs have a "Climb" action. Doors on the scene border are
     * recorded as doors (so their collision stays) but exported by the neighbouring region.
     */
    private findInteractives(scene: Scene, mapX: number, mapY: number): FoundInteractives {
        const { locTypeLoader, varManager } = this.loaders;
        const found: FoundInteractives = {
            interactives: [],
            doorWalls: new Set(),
            doorByWall: new Map(),
            propByLoc: new Map(),
            skillByLoc: new Map(),
            hatchByLoc: new Map(),
            entranceByLoc: new Map(),
            linksAttached: 0,
            doorBuilders: [],
        };
        const shownType = (id: number) => {
            const locType = locTypeLoader.load(id);
            const shown = locType.transforms ? locType.transform(varManager, locTypeLoader) : locType;
            return { locType, shown: shown ?? locType };
        };

        for (let level = 0; level < LEVELS; level++) {
            for (let x = 1; x < SCENE_SIZE - 1; x++) {
                for (let y = 1; y < SCENE_SIZE - 1; y++) {
                    const tile = scene.tiles[level][x][y];
                    if (!tile) {
                        continue;
                    }
                    const inside =
                        x >= BORDER_SIZE &&
                        x < BORDER_SIZE + REGION_SIZE &&
                        y >= BORDER_SIZE &&
                        y < BORDER_SIZE + REGION_SIZE;
                    const worldX = mapX * REGION_SIZE + x - BORDER_SIZE;
                    const worldY = mapY * REGION_SIZE + y - BORDER_SIZE;

                    const wall = tile.wall;
                    // A wall loc a dungeon link starts at (a Theatre of Blood passage, a tomb door, a
                    // crevice) is a passage, not a swinging door.
                    const wallLinked =
                        !!wall &&
                        (this.dungeonLinks?.linksForLoc(
                            (scene.tileRenderFlags[1][x][y] & 0x2) === 2 ? level - 1 : level,
                            worldX,
                            worldY,
                            getIdFromTag(wall.tag),
                        ).length ?? 0) > 0;
                    if (wall && wallLinked && inside) {
                        const id = getIdFromTag(wall.tag);
                        const { locType, shown } = shownType(id);
                        this.addEntrance(found, scene, {
                            level, x, y, worldX, worldY, sceneLoc: wall, id, locType, shown, rotation: (wall.flags >> 6) & 0x3,
                        });
                    } else if (wall && !wallLinked) {
                        const { locType, shown } = shownType(getIdFromTag(wall.tag));
                        const state = placedDoorState(shown.actions);
                        const flags = scene.getLocFlags(level, x, y, wall.tag);
                        const straight = (flags & 0x3f) === LocModelType.WALL;
                        // A closed door without collision is not worth swinging; an open one often has none.
                        if (state && straight && (locType.clipType !== 0 || state === "open")) {
                            found.doorWalls.add(wall);
                            if (inside) {
                                this.addDoor(found, scene, {
                                    level,
                                    x,
                                    y,
                                    worldX,
                                    worldY,
                                    wall,
                                    id: getIdFromTag(wall.tag),
                                    shown,
                                    flags,
                                    placedOpen: state === "open",
                                    noCollision: locType.clipType === 0,
                                });
                            }
                        }
                    }

                    if (!inside) {
                        continue;
                    }
                    for (const loc of tile.locs) {
                        if (loc.startX !== x || loc.startY !== y) {
                            continue;
                        }
                        const id = getIdFromTag(loc.tag);
                        const { locType, shown } = shownType(id);
                        if (this.addProp(found, scene, { level, x, y, worldX, worldY, loc, id, locType, shown })) {
                            continue;
                        }
                        if (this.addSkillLoc(found, scene, { level, x, y, worldX, worldY, loc, id, locType, shown })) {
                            continue;
                        }
                        this.addEntrance(found, scene, { level, x, y, worldX, worldY, sceneLoc: loc, id, locType, shown, rotation: loc.rotation });
                    }
                    // Trapdoors and cave mouths are often floor or wall decorations rather than normal locs.
                    for (const decoration of [tile.floorDecoration, tile.wallDecoration]) {
                        if (!decoration) {
                            continue;
                        }
                        const id = getIdFromTag(decoration.tag);
                        const { locType, shown } = shownType(id);
                        this.addEntrance(found, scene, {
                            level, x, y, worldX, worldY, sceneLoc: decoration, id, locType, shown, rotation: (decoration.flags >> 6) & 0x3,
                        });
                    }
                }
            }
        }
        this.pairGateLeaves(found.interactives);
        return found;
    }

    /**
     * Records a bank booth, a ladder or stair ("Climb" verbs), or a passage: any other loc that a
     * dungeon link starts at (cave mouth, trapdoor, tunnel). A closed trapdoor with a known open
     * model becomes a hatch, drawn into its own meshes by addHatchMeshes.
     */
    private addEntrance(
        found: FoundInteractives,
        scene: Scene,
        p: {
            level: number;
            x: number;
            y: number;
            worldX: number;
            worldY: number;
            sceneLoc: SceneLoc;
            id: number;
            locType: LocType;
            shown: LocType;
            rotation: number;
        },
    ): void {
        // Same level remapping SceneBuilder.decodeLocs applies under bridges.
        let plane = p.level;
        if ((scene.tileRenderFlags[1][p.x][p.y] & 0x2) === 2) {
            plane--;
        }
        if (plane < 0) {
            return;
        }
        const bank = isBank(p.shown.name, p.shown.actions);
        const links = bank ? [] : (this.dungeonLinks?.linksForLoc(plane, p.worldX, p.worldY, p.id) ?? []);
        const climbable = isClimbable(p.shown.actions);
        if (!bank && !climbable && links.length === 0) {
            return;
        }
        const kind = bank ? "bank" : climbable ? "climb" : "passage";
        const actions = p.shown.actions.filter((action): action is string => !!action);
        const swap = p.rotation === 1 || p.rotation === 3;
        const interactive: InteractiveLoc = {
            kind,
            id: p.id,
            // An unnamed loc a hand link starts at (a gate in Theatre of Blood) goes by the link's name.
            name: p.shown.name === "null" && links.length > 0 ? links[0].name : stripNameTags(p.shown.name),
            actions: kind === "passage" ? [...new Set(links.map((link) => link.action))] : actions,
            plane,
            level: p.level,
            tileX: p.worldX,
            tileY: p.worldY,
            sizeX: swap ? p.locType.sizeY : p.locType.sizeX,
            sizeY: swap ? p.locType.sizeX : p.locType.sizeY,
            rotation: p.rotation,
            height: DEFAULT_INTERACTIVE_HEIGHT,
        };
        if (links.length > 0) {
            interactive.links = links.map(toLocLink);
            found.linksAttached += links.length;
        }
        found.interactives.push(interactive);
        const openId = this.dungeonLinks?.openIdFor(plane, p.worldX, p.worldY, p.id);
        if (kind === "passage" && openId !== undefined && actions.some((action) => /^open$/i.test(action))) {
            found.hatchByLoc.set(p.sceneLoc, { interactive, openId });
        } else {
            found.entranceByLoc.set(p.sceneLoc, interactive);
        }
    }

    /**
     * Draws a closed trapdoor and its open model into two own meshes, so the game can swap them.
     * Returns false, drawing nothing, if either model is missing; the loc then stays a plain passage.
     */
    private addHatchMeshes(
        scene: Scene,
        found: FoundInteractives,
        p: PlacedEntity,
        interactive: InteractiveLoc,
        openId: number,
    ): boolean {
        const closed = this.resolveModel(scene, p);
        if (!closed) {
            return false;
        }
        // Decorations have no start tile; they stand on the tile their position is in.
        const sceneLoc = p.sceneLoc as unknown as Record<string, number>;
        const standsOn = "startX" in sceneLoc ? p.sceneLoc : Object.assign(Object.create(p.sceneLoc), {
            startX: Math.floor(sceneLoc.x / 128),
            startY: Math.floor(sceneLoc.y / 128),
        });
        const openBuilders: Builders = { opaque: new MeshBuilder(256), transparent: new MeshBuilder(64) };
        const openHeight = this.buildLocVariant(scene, { ...p, sceneLoc: standsOn }, this.loaders.locTypeLoader.load(openId), openBuilders);
        if (openHeight === undefined) {
            return false;
        }
        const closedBuilders: Builders = { opaque: new MeshBuilder(256), transparent: new MeshBuilder(64) };
        this.addModel({ doubleSided: closedBuilders.opaque, ...closedBuilders }, closed.model, p, closed.height);
        found.doorBuilders.push(closedBuilders, openBuilders);
        const closedMesh = found.doorBuilders.length - 2;
        interactive.actions = ["Open"];
        interactive.hatch = {
            closedMesh,
            openMesh: closedMesh + 1,
            openActions: this.loaders.locTypeLoader.load(openId).actions.filter((action): action is string => !!action),
            placedOpen: false,
        };
        interactive.height = Math.max(modelHeight(closed.model), openHeight);
        return true;
    }

    /** Links the two leaves of each gate or double door and re-hinges them at their outer ends. */
    private pairGateLeaves(interactives: InteractiveLoc[]): void {
        const doors = interactives.filter((loc) => loc.door);
        const at = new Map(doors.map((loc) => [`${loc.plane}:${loc.tileX}:${loc.tileY}`, loc]));
        for (const low of doors) {
            const alongY = (low.rotation & 1) === 0;
            const high = at.get(
                `${low.plane}:${low.tileX + (alongY ? 0 : 1)}:${low.tileY + (alongY ? 1 : 0)}`,
            );
            const leaf = (loc: InteractiveLoc) => ({
                id: loc.id,
                name: loc.name,
                tileX: loc.tileX,
                tileY: loc.tileY,
                rotation: loc.rotation,
                placedOpen: loc.door!.placedOpen,
                plane: loc.plane,
            });
            if (!high || high.door!.partner !== undefined || !areGateLeaves(leaf(low), leaf(high))) {
                continue;
            }
            for (const [loc, isHigh, other] of [[low, false, high], [high, true, low]] as const) {
                const states = gateLeafStates(loc.tileX, loc.tileY, loc.rotation, isHigh);
                const data = loc.door!;
                loc.door = {
                    ...states,
                    flagsA: data.flagsA.length === 0 ? [] : states.flagsA,
                    mesh: data.mesh,
                    partner: interactives.indexOf(other),
                };
            }
        }
    }

    /**
     * Makes a loc a physics prop (spec 19.1) if its name is in the prop table and it is a static
     * one-tile object no taller than MAX_PROP_HEIGHT. It gets its own meshes and loses its tile
     * collision; the game's prop body replaces it. Returns false, changing nothing, otherwise.
     */
    private addProp(
        found: FoundInteractives,
        scene: Scene,
        p: {
            level: number;
            x: number;
            y: number;
            worldX: number;
            worldY: number;
            loc: Loc;
            id: number;
            locType: LocType;
            shown: LocType;
        },
    ): boolean {
        const type: LocModelType = p.loc.flags & 0x3f;
        if (type !== LocModelType.NORMAL && type !== LocModelType.NORMAL_DIAGIONAL) {
            return false;
        }
        if (p.locType.sizeX !== 1 || p.locType.sizeY !== 1 || p.locType.transforms) {
            return false;
        }
        const propClass = propClassFor(stripNameTags(p.shown.name));
        const model = p.loc.entity;
        if (!propClass || !(model instanceof Model)) {
            return false;
        }
        const extent = propExtent(model.verticesX, model.verticesY, model.verticesZ, model.verticesCount, RS_UNITS_PER_TILE);
        if (extent.height <= 0 || extent.height > MAX_PROP_HEIGHT) {
            return false;
        }
        // Same level remapping SceneBuilder.decodeLocs applies under bridges.
        let plane = p.level;
        if ((scene.tileRenderFlags[1][p.x][p.y] & 0x2) === 2) {
            plane--;
        }
        if (plane < 0) {
            return false;
        }
        if (p.locType.clipType !== 0) {
            scene.collisionMaps[plane].removeLoc(p.x, p.y, 1, 1, p.locType.blocksProjectile);
        }
        const mesh = found.doorBuilders.length;
        found.doorBuilders.push({ opaque: new MeshBuilder(256), transparent: new MeshBuilder(64) });
        found.propByLoc.set(p.loc, mesh);
        found.interactives.push({
            kind: "prop",
            id: p.id,
            name: stripNameTags(p.shown.name),
            actions: [],
            plane,
            level: p.level,
            tileX: p.worldX,
            tileY: p.worldY,
            sizeX: 1,
            sizeY: 1,
            rotation: (p.loc.flags >> 6) & 0x3,
            height: extent.height,
            prop: {
                mesh,
                material: propClass.material,
                mass: propClass.mass,
                x: p.worldX + 0.5,
                y: p.worldY + 0.5,
                z: 0,
                radius: 0.3,
            },
        });
        return true;
    }

    /**
     * Makes a loc a skill target if data/skill-locs.json lists it. It keeps its tile collision.
     * Trees, rocks and patches get their own meshes (built in addSkillLocMeshes), so the
     * game can swap their look; the others stay part of the map. Returns false otherwise.
     */
    private addSkillLoc(
        found: FoundInteractives,
        scene: Scene,
        p: { level: number; x: number; y: number; worldX: number; worldY: number; loc: Loc; id: number; locType: LocType; shown: LocType },
    ): boolean {
        const index = this.skillLocs;
        if (!index) return false;
        const key = String(p.id);
        const ownMesh = key in index.resources || index.patches.includes(p.id);
        if (!ownMesh && !index.statics.includes(p.id)) return false;
        // Same level remapping SceneBuilder.decodeLocs applies under bridges.
        let plane = p.level;
        if ((scene.tileRenderFlags[1][p.x][p.y] & 0x2) === 2) {
            plane--;
        }
        if (plane < 0) return false;
        const swap = p.loc.rotation === 1 || p.loc.rotation === 3;
        const interactive: InteractiveLoc = {
            kind: "skill",
            id: p.id,
            name: stripNameTags(p.shown.name),
            actions: p.shown.actions.filter((action): action is string => !!action),
            plane,
            level: p.level,
            tileX: p.worldX,
            tileY: p.worldY,
            sizeX: swap ? p.locType.sizeY : p.locType.sizeX,
            sizeY: swap ? p.locType.sizeX : p.locType.sizeY,
            rotation: p.loc.rotation,
            height: DEFAULT_INTERACTIVE_HEIGHT,
            skill: {},
        };
        found.interactives.push(interactive);
        if (ownMesh) found.skillByLoc.set(p.loc, interactive);
        return true;
    }

    /** Draws a skill loc into new meshes: as placed, depleted or per patch state. */
    private addSkillLocMeshes(scene: Scene, found: FoundInteractives, p: PlacedEntity, loc: InteractiveLoc): void {
        const { locTypeLoader } = this.loaders;
        const index = this.skillLocs!;
        const skill = loc.skill!;
        let height = 0;
        const newMesh = (): [number, Builders] => {
            const builders = { opaque: new MeshBuilder(256), transparent: new MeshBuilder(64) };
            found.doorBuilders.push(builders);
            return [found.doorBuilders.length - 1, builders];
        };
        const variant = (locType: LocType): number | undefined => {
            const [i, builders] = newMesh();
            const h = this.buildLocVariant(scene, p, locType, builders);
            if (h === undefined) return undefined;
            height = Math.max(height, h);
            return i;
        };
        const key = String(loc.id);
        if (index.patches.includes(loc.id)) {
            const transforms = locTypeLoader.load(loc.id).transforms ?? [];
            const meshOf = new Map<number, number>();
            skill.stateMeshes = transforms.map((t) => {
                if (t < 0) return -1;
                if (!meshOf.has(t)) meshOf.set(t, variant(locTypeLoader.load(t)) ?? -1);
                return meshOf.get(t)!;
            });
            loc.height = Math.max(1, height);
            return;
        }
        const placed = this.resolveModel(scene, p);
        if (placed) {
            const [i, builders] = newMesh();
            this.addModel({ doubleSided: builders.opaque, ...builders }, placed.model, p, placed.height);
            skill.mesh = i;
            height = modelHeight(placed.model);
        }
        const depleted = index.resources[key];
        if (depleted !== undefined) {
            const type = depleted >= 1_000_000 ? plainRock(locTypeLoader.load(depleted - 1_000_000), depleted) : locTypeLoader.load(depleted);
            skill.depletedMesh = variant(type);
        }
        loc.height = Math.max(1, height);
    }

    /**
     * Builds another loc type's model where a placed loc stands (same tile and rotation), centred on
     * its own footprint, into `builders`. Returns the model's height in tiles, or undefined.
     */
    private buildLocVariant(scene: Scene, p: PlacedEntity, locType: LocType, builders: Builders): number | undefined {
        const sceneLoc = p.sceneLoc as Loc;
        const type: LocModelType = sceneLoc.flags & 0x3f;
        const rotation = (sceneLoc.flags >> 6) & 0x3;
        const swap = rotation === 1 || rotation === 3;
        const sizeX = swap ? locType.sizeY : locType.sizeX;
        const sizeY = swap ? locType.sizeX : locType.sizeY;
        const tileX = sceneLoc.startX;
        const tileY = sceneLoc.startY;
        const heightMap = scene.tileHeights[p.level];
        const last = heightMap.length - 1;
        const startX = Math.min((sizeX >> 1) + tileX, last);
        const endX = Math.min(((sizeX + 1) >> 1) + tileX, last);
        const startY = Math.min((sizeY >> 1) + tileY, last);
        const endY = Math.min(((sizeY + 1) >> 1) + tileY, last);
        const centerHeight = (heightMap[endX][endY] + heightMap[startX][endY] + heightMap[startX][startY] + heightMap[endX][startY]) >> 2;
        const centerX = (tileX << 7) + (sizeX << 6);
        const centerZ = (tileY << 7) + (sizeY << 6);
        const model = this.loaders.locModelLoader.getModelStatic(locType, type, rotation, {
            type: locType.contourGroundType,
            param: locType.contourGroundParam,
            heightMap,
            heightMapAbove: p.level < scene.levels - 1 ? scene.tileHeights[p.level + 1] : undefined,
            entityX: centerX,
            entityY: centerHeight,
            entityZ: centerZ,
        });
        if (!model) return undefined;
        this.addModel(
            { doubleSided: builders.opaque, ...builders },
            model,
            { ...p, offsetX: p.offsetX + centerX - sceneLoc.x, offsetZ: p.offsetZ + centerZ - sceneLoc.y },
            centerHeight,
        );
        return modelHeight(model);
    }


    private addDoor(
        found: FoundInteractives,
        scene: Scene,
        door: {
            level: number;
            x: number;
            y: number;
            worldX: number;
            worldY: number;
            wall: SceneLoc;
            id: number;
            shown: { name: string; actions: (string | undefined)[] };
            flags: number;
            placedOpen: boolean;
            noCollision: boolean;
        },
    ): void {
        // Same level remapping SceneBuilder.decodeLocs applies under bridges.
        let plane = door.level;
        if ((scene.tileRenderFlags[1][door.x][door.y] & 0x2) === 2) {
            plane--;
        }
        if (plane < 0) {
            return;
        }
        const rotation = (door.flags >> 6) & 0x3;
        const states = doorStates(door.worldX, door.worldY, rotation, door.placedOpen);
        const mesh = found.doorBuilders.length;
        found.doorBuilders.push({ opaque: new MeshBuilder(256), transparent: new MeshBuilder(64) });
        found.doorByWall.set(door.wall, mesh);
        found.interactives.push({
            kind: "door",
            id: door.id,
            name: stripNameTags(door.shown.name),
            actions: door.shown.actions.filter((action): action is string => !!action),
            plane,
            level: door.level,
            tileX: door.worldX,
            tileY: door.worldY,
            sizeX: 1,
            sizeY: 1,
            rotation,
            height: DEFAULT_INTERACTIVE_HEIGHT,
            door: {
                ...states,
                // An open door that never blocked has no collision to take away when it is used.
                flagsA: door.noCollision ? [] : states.flagsA,
                mesh,
            },
        });
    }

    // Tile faces already carry their lit colors, uvs and texture ids.
    private addTileModel(mesh: MeshBuilder, tileModel: SceneTileModel, level: number): void {
        for (const face of tileModel.faces) {
            const indices = face.vertices.map((vertex) => {
                const layer = this.colors.textureLayer(vertex.textureId);
                return mesh.addVertex(
                    vertex.x + BORDER_OFFSET,
                    vertex.y,
                    vertex.z + BORDER_OFFSET,
                    this.colors.hslToRgba(vertex.hsl, layer, 0xff),
                    vertex.u,
                    vertex.v,
                    layer,
                    0,
                    level,
                );
            });
            mesh.addTriangle(indices[0], indices[1], indices[2]);
        }
    }

    // Static locs were already lit by the scene builder; animated and varbit-transformed ones are
    // deferred as LocEntity and built here.
    private resolveModel(
        scene: Scene,
        placed: PlacedEntity,
    ): { model: Model; height: number } | undefined {
        const { entity, sceneLoc } = placed;
        if (entity instanceof Model) {
            return { model: entity, height: sceneLoc.height };
        }
        if (!(entity instanceof LocEntity)) {
            return undefined;
        }

        const { locTypeLoader, locModelLoader, varManager } = this.loaders;
        let locType = locTypeLoader.load(entity.id);
        let sizeX = locType.sizeX;
        let sizeY = locType.sizeY;
        if (entity.rotation === 1 || entity.rotation === 3) {
            sizeX = locType.sizeY;
            sizeY = locType.sizeX;
        }
        if (locType.transforms) {
            const transformed = locType.transform(varManager, locTypeLoader);
            if (!transformed) {
                return undefined;
            }
            locType = transformed;
        }

        const { tileX, tileY, level } = entity;
        const startX = (sizeX >> 1) + tileX;
        const endX = ((sizeX + 1) >> 1) + tileX;
        const startY = (sizeY >> 1) + tileY;
        const endY = ((sizeY + 1) >> 1) + tileY;

        const heightMap = scene.tileHeights[level];
        const heightMapAbove = level < scene.levels - 1 ? scene.tileHeights[level + 1] : undefined;
        const centerHeight =
            (heightMap[endX][endY] +
                heightMap[startX][endY] +
                heightMap[startX][startY] +
                heightMap[endX][startY]) >>
            2;

        const contourGroundInfo: ContourGroundInfo = {
            type: locType.contourGroundType,
            param: locType.contourGroundParam,
            heightMap,
            heightMapAbove,
            entityX: (tileX << 7) + (sizeX << 6),
            entityY: centerHeight,
            entityZ: (tileY << 7) + (sizeY << 6),
        };

        const model = locModelLoader.getModelStatic(
            locType,
            entity.type,
            entity.rotation,
            contourGroundInfo,
        );
        return model && { model, height: centerHeight };
    }

    // Adds a lit model's visible faces to the region meshes, moved to the loc's position.
    private addModel(
        meshes: { doubleSided: MeshBuilder; opaque: MeshBuilder; transparent: MeshBuilder },
        model: Model,
        placed: PlacedEntity,
        height: number,
    ): void {
        const { textureLoader } = this.loaders;
        const sceneX = placed.sceneLoc.x + placed.offsetX + BORDER_OFFSET;
        const sceneZ = placed.sceneLoc.y + placed.offsetZ + BORDER_OFFSET;

        // The client hides roofs while you are indoors, so they are only modelled from outside.
        // In first person you look at their back faces from inside, so they go double-sided.
        const type: LocModelType = placed.sceneLoc.flags & 0x3f;
        const isRoof =
            type >= LocModelType.ROOF_SLOPED &&
            type <= LocModelType.ROOF_SLOPED_OVERHANG_HARD_OUTER_CORNER;
        const solid = isRoof ? meshes.doubleSided : meshes.opaque;

        const verticesX = model.verticesX;
        const verticesY = model.contourVerticesY ?? model.verticesY;
        const verticesZ = model.verticesZ;
        const uvs = model.uvs;

        for (let f = 0; f < model.faceCount; f++) {
            if (model.faceColors3[f] === -2) {
                continue;
            }

            const textureId = model.faceTextures ? model.faceTextures[f] : -1;
            let alpha = 0xff;
            if (model.faceAlphas && textureId === -1) {
                alpha = 0xff - (model.faceAlphas[f] & 0xff);
            }
            if (alpha === 0 || alpha === 1) {
                continue;
            }

            const isTransparent =
                alpha < 0xff || (textureId !== -1 && textureLoader.isTransparent(textureId));
            const mesh = isTransparent ? meshes.transparent : solid;

            const layer = this.colors.textureLayer(textureId);
            const priority =
                (model.faceRenderPriorities ? model.faceRenderPriorities[f] : 0) +
                1 +
                placed.priority;

            const hslA = model.faceColors1[f];
            let hslB = model.faceColors2[f];
            let hslC = model.faceColors3[f];
            if (hslC === -1) {
                hslC = hslB = hslA;
            }

            const a = model.indices1[f];
            const b = model.indices2[f];
            const c = model.indices3[f];

            const t = f * 6;
            const hasUv = uvs !== undefined && layer !== 0;
            const ia = mesh.addVertex(
                sceneX + verticesX[a],
                height + verticesY[a],
                sceneZ + verticesZ[a],
                this.colors.hslToRgba(hslA, layer, alpha),
                hasUv ? uvs[t] : 0,
                hasUv ? uvs[t + 1] : 0,
                layer,
                priority,
                placed.level,
            );
            const ib = mesh.addVertex(
                sceneX + verticesX[b],
                height + verticesY[b],
                sceneZ + verticesZ[b],
                this.colors.hslToRgba(hslB, layer, alpha),
                hasUv ? uvs[t + 2] : 0,
                hasUv ? uvs[t + 3] : 0,
                layer,
                priority,
                placed.level,
            );
            const ic = mesh.addVertex(
                sceneX + verticesX[c],
                height + verticesY[c],
                sceneZ + verticesZ[c],
                this.colors.hslToRgba(hslC, layer, alpha),
                hasUv ? uvs[t + 4] : 0,
                hasUv ? uvs[t + 5] : 0,
                layer,
                priority,
                placed.level,
            );
            mesh.addTriangle(ia, ib, ic);
        }
    }
}

// Collects everything placed on a tile: floor decoration, wall, wall decoration and locs.
function collectTileLocs(
    out: PlacedEntity[],
    tile: SceneTile,
    level: number,
    tileX: number,
    tileY: number,
): void {
    const push = (
        entity: Entity | undefined,
        sceneLoc: SceneLoc,
        priority: number,
        offsetX = 0,
        offsetZ = 0,
    ) => {
        if (entity) {
            out.push({ entity, sceneLoc, level, offsetX, offsetZ, priority });
        }
    };

    if (tile.floorDecoration) {
        push(tile.floorDecoration.entity, tile.floorDecoration, PRIORITY_FLOOR_DECORATION);
    }
    if (tile.wall) {
        push(tile.wall.entity0, tile.wall, PRIORITY_WALL);
        push(tile.wall.entity1, tile.wall, PRIORITY_WALL);
    }
    if (tile.wallDecoration) {
        const decoration = tile.wallDecoration;
        // Like the client, only the first decoration model is displaced away from the wall.
        push(
            decoration.entity0,
            decoration,
            PRIORITY_WALL_DECORATION,
            decoration.offsetX,
            decoration.offsetY,
        );
        push(decoration.entity1, decoration, PRIORITY_WALL_DECORATION);
    }
    for (const loc of tile.locs) {
        // Large locs are referenced from every tile they cover; emit them once.
        if (loc.startX === tileX && loc.startY === tileY) {
            push(loc.entity, loc, PRIORITY_LOC);
        }
    }
}

/** Collision flags that make a tile unwalkable as a whole (a loc on it, or blocked ground). */
const TILE_BLOCKED = 0x100 | 0x200000;

/**
 * Heights, flags, floors, collision and water of a region. Underground (`dungeon`), a tile with no
 * tile model also counts as floor when it can be walked and a floor decoration covers it (Verzik
 * Vitur's arena is laid that way on level 0), or, on an upper level, when anything stands on it:
 * some lairs (the Wilderness boss chasms) lay their floor as loc models on level 2.
 */
function extractTerrainData(
    scene: Scene,
    overlayTypeLoader: OverlayFloorTypeLoader,
    dungeon: boolean,
): Pick<RegionData, "heights" | "renderFlags" | "floors" | "collision" | "water"> {
    const corners = REGION_SIZE + 1;
    const heights = new Int32Array(LEVELS * corners * corners);
    const renderFlags = new Uint8Array(LEVELS * REGION_SIZE * REGION_SIZE);
    const floors = new Uint8Array(LEVELS * REGION_SIZE * REGION_SIZE);
    const collision = new Int32Array(LEVELS * REGION_SIZE * REGION_SIZE);
    const water = new Uint8Array(LEVELS * REGION_SIZE * REGION_SIZE);

    for (let level = 0; level < LEVELS; level++) {
        for (let x = 0; x < corners; x++) {
            for (let y = 0; y < corners; y++) {
                heights[(level * corners + x) * corners + y] =
                    scene.tileHeights[level][x + BORDER_SIZE][y + BORDER_SIZE];
            }
        }
        const collisionMap = scene.collisionMaps[level];
        for (let x = 0; x < REGION_SIZE; x++) {
            for (let y = 0; y < REGION_SIZE; y++) {
                const i = (level * REGION_SIZE + x) * REGION_SIZE + y;
                renderFlags[i] = scene.tileRenderFlags[level][x + BORDER_SIZE][y + BORDER_SIZE];
                const tileModel = scene.tiles[level][x + BORDER_SIZE][y + BORDER_SIZE]?.tileModel;
                collision[i] = collisionMap.getFlag(x + BORDER_SIZE, y + BORDER_SIZE);
                const sceneTile = scene.tiles[level][x + BORDER_SIZE][y + BORDER_SIZE];
                const locFloor =
                    dungeon &&
                    (collision[i] & TILE_BLOCKED) === 0 &&
                    !!sceneTile &&
                    (!!sceneTile.floorDecoration || (level > 0 && sceneTile.locs.length > 0));
                floors[i] = (tileModel && tileModel.faces.length > 0) || locFloor ? 1 : 0;
                const overlayId = scene.tileOverlays[level][x + BORDER_SIZE][y + BORDER_SIZE] - 1;
                const overlay = overlayId >= 0 ? overlayTypeLoader.load(overlayId) : undefined;
                water[i] = overlay?.name?.toLowerCase().includes("water") ? 1 : 0;
            }
        }
    }

    return { heights, renderFlags, floors, collision, water };
}

function findDiagonalWallTag(tile: SceneTile | undefined): bigint | undefined {
    for (const loc of tile?.locs ?? []) {
        if ((loc.flags & 0x3f) === LocModelType.WALL_DIAGONAL) {
            return loc.tag;
        }
    }
    return undefined;
}

/** Height of a model above its origin in tiles (RS vertices have +y down). */
function modelHeight(model: Model): number {
    let top = 0;
    for (let i = 0; i < model.verticesCount; i++) {
        top = Math.max(top, -model.verticesY[i]);
    }
    return top / RS_UNITS_PER_TILE;
}

/** A rock without its ore colours, as a separate type (its own id keeps the model cache apart). */
function plainRock(rock: LocType, id: number): LocType {
    const copy = Object.assign(Object.create(Object.getPrototypeOf(rock)), rock) as LocType;
    copy.recolorFrom = undefined as never;
    copy.recolorTo = undefined as never;
    (copy as { id: number }).id = id;
    return copy;
}

function isOpenable(actions: (string | undefined)[]): boolean {
    return actions.some((action) => action?.toLowerCase() === "open");
}
