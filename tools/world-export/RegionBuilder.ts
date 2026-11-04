import { ContourGroundInfo } from "./rs/config/loctype/LocModelLoader";
import { LocModelType } from "./rs/config/loctype/LocModelType";
import { Model } from "./rs/model/Model";
import { Scene } from "./rs/scene/Scene";
import { LocLoadType } from "./rs/scene/SceneBuilder";
import { SceneLoc } from "./rs/scene/SceneLoc";
import { SceneTile } from "./rs/scene/SceneTile";
import { SceneTileModel } from "./rs/scene/SceneTileModel";
import { Entity } from "./rs/scene/entity/Entity";
import { getIdFromTag } from "./rs/scene/entity/EntityTag";
import { LocEntity } from "./rs/scene/entity/LocEntity";
import { LEVELS, REGION_SIZE, RegionData } from "../../src/world/WorldFormat";
import { FaceColors, BRIGHTNESS } from "./FaceColors";
import { MeshBuilder } from "./MeshBuilder";
import { WorldLoaders } from "./WorldLoaders";

// Neighbouring tiles are decoded too, so underlay blending, lighting and ground contouring are
// seamless across region edges.
const BORDER_SIZE = 6;
const SCENE_SIZE = REGION_SIZE + BORDER_SIZE * 2;
const BORDER_OFFSET = -BORDER_SIZE * 128;

export { BRIGHTNESS };

// Depth priority per kind of loc, added to each face's own priority (see the shader's bias).
const PRIORITY_FLOOR_DECORATION = 3;
const PRIORITY_WALL = 1;
const PRIORITY_WALL_DECORATION = 2;
const PRIORITY_LOC = 1;

export type RegionStats = { tiles: number; locs: number; triangles: number; buildMs: number };

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

        let locs = 0;
        for (const p of placed) {
            const resolved = this.resolveModel(scene, p);
            if (resolved) {
                this.addModel(
                    { doubleSided: terrain, opaque, transparent },
                    resolved.model,
                    p,
                    resolved.height,
                );
                locs++;
            }
        }

        this.makeDoorsPassable(scene);

        const meshes = {
            terrain: terrain.build(),
            opaque: opaque.build(),
            transparent: transparent.build(),
        };
        const triangles =
            (meshes.terrain.indices.length +
                meshes.opaque.indices.length +
                meshes.transparent.indices.length) /
            3;

        return {
            region: { mapX, mapY, ...meshes, ...extractTerrainData(scene) },
            stats: { tiles, locs, triangles, buildMs: Math.round(performance.now() - start) },
        };
    }

    // Nothing can open doors or gates in this demo, so their collision is removed instead.
    private makeDoorsPassable(scene: Scene): void {
        const { locTypeLoader, varManager } = this.loaders;
        for (let level = 0; level < LEVELS; level++) {
            for (let x = 1; x < SCENE_SIZE - 1; x++) {
                for (let y = 1; y < SCENE_SIZE - 1; y++) {
                    const tile = scene.tiles[level][x][y];
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

function extractTerrainData(
    scene: Scene,
): Pick<RegionData, "heights" | "renderFlags" | "floors" | "collision"> {
    const corners = REGION_SIZE + 1;
    const heights = new Int32Array(LEVELS * corners * corners);
    const renderFlags = new Uint8Array(LEVELS * REGION_SIZE * REGION_SIZE);
    const floors = new Uint8Array(LEVELS * REGION_SIZE * REGION_SIZE);
    const collision = new Int32Array(LEVELS * REGION_SIZE * REGION_SIZE);

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
                floors[i] = tileModel && tileModel.faces.length > 0 ? 1 : 0;
                collision[i] = collisionMap.getFlag(x + BORDER_SIZE, y + BORDER_SIZE);
            }
        }
    }

    return { heights, renderFlags, floors, collision };
}

function findDiagonalWallTag(tile: SceneTile | undefined): bigint | undefined {
    for (const loc of tile?.locs ?? []) {
        if ((loc.flags & 0x3f) === LocModelType.WALL_DIAGONAL) {
            return loc.tag;
        }
    }
    return undefined;
}

function isOpenable(actions: (string | undefined)[]): boolean {
    return actions.some((action) => action?.toLowerCase() === "open");
}
