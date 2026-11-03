import { CacheInfo } from "./rs/cache/CacheInfo";
import { CacheSystem } from "./rs/cache/CacheSystem";
import { ConfigType } from "./rs/cache/ConfigType";
import { IndexType } from "./rs/cache/IndexType";
import { MemoryStore } from "./rs/cache/store/MemoryStore";
import {
    ArchiveOverlayFloorTypeLoader,
    ArchiveUnderlayFloorTypeLoader,
} from "./rs/config/floortype/FloorTypeLoader";
import { LocModelLoader } from "./rs/config/loctype/LocModelLoader";
import { ArchiveLocTypeLoader, LocTypeLoader } from "./rs/config/loctype/LocTypeLoader";
import { VarManager } from "./rs/config/vartype/VarManager";
import { ArchiveVarBitTypeLoader } from "./rs/config/vartype/bit/VarBitTypeLoader";
import { Dat2MapIndex, ModernMapFileIndex } from "./rs/map/MapFileIndex";
import { MapFileLoader, ModernMapFileLoader } from "./rs/map/MapFileLoader";
import { IndexModelLoader } from "./rs/model/ModelLoader";
import { SceneBuilder } from "./rs/scene/SceneBuilder";
import { SpriteTextureLoader } from "./rs/texture/SpriteTextureLoader";
import { TextureLoader } from "./rs/texture/TextureLoader";

/** Raw OSRS cache files, as written by scripts/download-cache.mjs. */
export type CacheFiles = {
    info: CacheInfo;
    dat2: ArrayBufferLike;
    /** main_file_cache.idx{n} contents, keyed by index id (255 is the meta index). */
    indexFiles: Map<number, ArrayBuffer>;
    /** XTEA keys by map group id. Only caches older than revision 237 need them. */
    xteas: Map<number, number[]>;
};

export type WorldLoaders = {
    info: CacheInfo;
    locTypeLoader: LocTypeLoader;
    textureLoader: TextureLoader;
    locModelLoader: LocModelLoader;
    varManager: VarManager;
    sceneBuilder: SceneBuilder;
};

// Only these indices are needed to build the map, so the others are never decoded.
const REQUIRED_INDICES = [
    IndexType.DAT2.configs,
    IndexType.DAT2.maps,
    IndexType.DAT2.models,
    IndexType.DAT2.sprites,
    IndexType.DAT2.textures,
];

export const REQUIRED_INDEX_FILES = [...REQUIRED_INDICES, 255];

/**
 * Wires up the decoders for an OSRS (dat2) cache, minus everything that is not needed for
 * static map geometry (npcs, objs, animations).
 */
export function createWorldLoaders(files: CacheFiles): WorldLoaders {
    const { info } = files;
    if (info.game !== "oldschool") {
        throw new Error(`Only Old School caches are supported, got "${info.game}"`);
    }

    const indexFiles: (ArrayBuffer | undefined)[] = [];
    for (const id of REQUIRED_INDICES) {
        const data = files.indexFiles.get(id);
        if (!data) {
            throw new Error(`Missing main_file_cache.idx${id}`);
        }
        indexFiles[id] = data;
    }
    const metaFile = files.indexFiles.get(255);
    if (!metaFile) {
        throw new Error("Missing main_file_cache.idx255");
    }

    const store = new MemoryStore(files.dat2, indexFiles, metaFile);
    const cacheSystem = CacheSystem.fromStore(store);

    const configIndex = cacheSystem.getIndex(IndexType.DAT2.configs);
    const underlayTypeLoader = new ArchiveUnderlayFloorTypeLoader(
        info,
        configIndex.getArchive(ConfigType.DAT2.underlays),
    );
    const overlayTypeLoader = new ArchiveOverlayFloorTypeLoader(
        info,
        configIndex.getArchive(ConfigType.DAT2.overlays),
    );
    const varBitTypeLoader = new ArchiveVarBitTypeLoader(
        info,
        configIndex.getArchive(ConfigType.DAT2.varbits),
    );
    const locTypeLoader = new ArchiveLocTypeLoader(
        info,
        configIndex.getArchive(ConfigType.DAT2.locs),
    );

    const modelLoader = new IndexModelLoader(cacheSystem.getIndex(IndexType.DAT2.models));
    const textureLoader = SpriteTextureLoader.load(
        cacheSystem.getIndex(IndexType.DAT2.textures),
        cacheSystem.getIndex(IndexType.DAT2.sprites),
        info.revision >= 233,
    );

    // Revision 237 moved terrain and locs into a single unencrypted group per map square.
    const mapIndex = cacheSystem.getIndex(IndexType.DAT2.maps);
    const mapFileLoader =
        info.revision >= 237
            ? new ModernMapFileLoader(mapIndex, new ModernMapFileIndex(mapIndex))
            : new MapFileLoader(mapIndex, new Dat2MapIndex(mapIndex));

    // All varps/varbits stay 0, so multilocs show their default state.
    const varManager = new VarManager(varBitTypeLoader);
    const locModelLoader = new LocModelLoader(locTypeLoader, modelLoader, textureLoader);

    const sceneBuilder = new SceneBuilder(
        info,
        mapFileLoader,
        underlayTypeLoader,
        overlayTypeLoader,
        locTypeLoader,
        locModelLoader,
        files.xteas,
    );

    return { info, locTypeLoader, textureLoader, locModelLoader, varManager, sceneBuilder };
}
