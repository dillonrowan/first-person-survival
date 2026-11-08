import fs from "node:fs";
import path from "node:path";

import { CacheInfo } from "./rs/cache/CacheInfo";
import { CacheFiles, REQUIRED_INDEX_FILES } from "./WorldLoaders";

/** info.json written by scripts/download-cache.mjs. */
export type DownloadedCacheInfo = {
    id: number;
    game: CacheInfo["game"];
    environment: string;
    revision: number;
    timestamp: string;
};

export type LoadedCache = CacheFiles & { download: DownloadedCacheInfo };

function isGitLfsPointer(file: string): boolean {
    if (!fs.existsSync(file)) {
        return false;
    }
    const sample = fs.readFileSync(file);
    return sample.subarray(0, 200).toString("utf8")
        .startsWith("version https://git-lfs.github.com/spec/v1");
}

export function isCacheAvailable(cacheDir: string): boolean {
    const infoFile = path.join(cacheDir, "info.json");
    const datFile = path.join(cacheDir, "main_file_cache.dat2");
    if (!fs.existsSync(infoFile) || !fs.existsSync(datFile)
        || isGitLfsPointer(infoFile) || isGitLfsPointer(datFile)) {
        return false;
    }

    try {
        const download = JSON.parse(fs.readFileSync(infoFile, "utf8")) as DownloadedCacheInfo;
        if (!Number.isInteger(download.revision)) {
            return false;
        }
    } catch {
        return false;
    }

    return REQUIRED_INDEX_FILES.every((id) => {
        const indexFile = path.join(cacheDir, `main_file_cache.idx${id}`);
        return fs.existsSync(indexFile) && !isGitLfsPointer(indexFile);
    });
}

function readArrayBuffer(file: string): ArrayBuffer {
    const buf = fs.readFileSync(file);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * Reads the cache files needed for the map. The 240 MB data file goes into a SharedArrayBuffer
 * so every export worker can read the same copy.
 */
export function readCacheFiles(cacheDir: string): LoadedCache {
    const infoFile = path.join(cacheDir, "info.json");
    if (!isCacheAvailable(cacheDir)) {
        throw new Error(
            `No complete cache found in ${cacheDir}. Run "npm run download-cache" or install and fetch Git LFS.`,
        );
    }
    const download: DownloadedCacheInfo = JSON.parse(fs.readFileSync(infoFile, "utf8"));

    const datFile = path.join(cacheDir, "main_file_cache.dat2");
    const dat2 = new SharedArrayBuffer(fs.statSync(datFile).size);
    const fd = fs.openSync(datFile, "r");
    try {
        fs.readSync(fd, new Uint8Array(dat2), 0, dat2.byteLength, 0);
    } finally {
        fs.closeSync(fd);
    }

    const indexFiles = new Map<number, ArrayBuffer>();
    for (const id of REQUIRED_INDEX_FILES) {
        indexFiles.set(id, readArrayBuffer(path.join(cacheDir, `main_file_cache.idx${id}`)));
    }

    const xteas = new Map<number, number[]>();
    const keysFile = path.join(cacheDir, "keys.json");
    if (fs.existsSync(keysFile) && !isGitLfsPointer(keysFile)) {
        for (const [group, key] of Object.entries(JSON.parse(fs.readFileSync(keysFile, "utf8")))) {
            xteas.set(Number(group), key as number[]);
        }
    }

    const info: CacheInfo = {
        name: `osrs-${download.revision}`,
        game: download.game,
        environment: download.environment,
        revision: download.revision,
        timestamp: download.timestamp,
        size: dat2.byteLength,
    };

    return { info, dat2, indexFiles, xteas, download };
}
