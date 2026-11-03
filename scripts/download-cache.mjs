// Downloads an Old School RuneScape cache from the OpenRS2 archive into cache/.
// Afterwards run "npm run export-world" to convert it into the game's world map.
//
// Usage:
//   npm run download-cache            -> newest live OSRS cache
//   npm run download-cache -- 238     -> newest cache for revision 238
//   npm run download-cache -- id=2599 -> a specific OpenRS2 cache id

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const ARCHIVE_URL = "https://archive.openrs2.org";
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cache");

function formatBytes(bytes) {
    const units = ["B", "KiB", "MiB", "GiB"];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${bytes.toFixed(1)} ${units[i]}`;
}

async function fetchJson(url) {
    const resp = await fetch(url);
    if (!resp.ok) {
        throw new Error(`GET ${url} failed: ${resp.status}`);
    }
    return resp.json();
}

async function fetchWithProgress(url, label) {
    const resp = await fetch(url);
    if (!resp.ok || !resp.body) {
        throw new Error(`GET ${url} failed: ${resp.status}`);
    }
    const total = Number(resp.headers.get("Content-Length") || 0);
    const parts = [];
    let received = 0;
    let lastLog = 0;
    for await (const chunk of resp.body) {
        parts.push(chunk);
        received += chunk.byteLength;
        const now = Date.now();
        if (now - lastLog > 2000) {
            lastLog = now;
            const pct = total ? ` (${((received / total) * 100).toFixed(0)}%)` : "";
            console.log(`  ${label}: ${formatBytes(received)}${pct}`);
        }
    }
    const out = new Uint8Array(received);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.byteLength;
    }
    return out;
}

function isComplete(cache) {
    return cache.valid_indexes === cache.indexes && cache.valid_groups / cache.groups >= 0.9;
}

function pickCache(caches, arg) {
    const osrs = caches.filter(
        (c) =>
            c.scope === "runescape" &&
            c.game === "oldschool" &&
            c.environment === "live" &&
            c.language === "en" &&
            c.builds.length > 0 &&
            c.timestamp &&
            isComplete(c),
    );
    osrs.sort(
        (a, b) =>
            b.builds[0].major - a.builds[0].major ||
            Date.parse(b.timestamp) - Date.parse(a.timestamp),
    );
    if (!arg) {
        return osrs[0];
    }
    if (arg.startsWith("id=")) {
        const id = Number(arg.slice(3));
        return osrs.find((c) => c.id === id);
    }
    const revision = Number(arg);
    return osrs.find((c) => c.builds[0].major === revision);
}

async function main() {
    const arg = process.argv[2];
    const caches = await fetchJson(`${ARCHIVE_URL}/caches.json`);
    const cache = pickCache(caches, arg);
    if (!cache) {
        throw new Error(`No complete OSRS cache found for "${arg ?? "latest"}"`);
    }
    const revision = cache.builds[0].major;
    console.log(
        `Cache #${cache.id}: OSRS revision ${revision}, ${cache.timestamp}, ~${formatBytes(cache.size)}`,
    );

    const zip = await fetchWithProgress(
        `${ARCHIVE_URL}/caches/${cache.scope}/${cache.id}/disk.zip`,
        "disk.zip",
    );

    console.log("Extracting...");
    const files = unzipSync(zip, { filter: (file) => file.name.startsWith("cache/") });

    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const [name, data] of Object.entries(files)) {
        const fileName = name.slice("cache/".length);
        if (!fileName || name.endsWith("/")) {
            continue;
        }
        fs.writeFileSync(path.join(OUT_DIR, fileName), data);
    }

    // XTEA keys only matter for revisions before 237, when loc files were still encrypted.
    const keys = await fetchJson(`${ARCHIVE_URL}/caches/${cache.scope}/${cache.id}/keys.json`);
    const xteas = {};
    for (const entry of keys) {
        xteas[entry.group.toString()] = entry.key;
    }
    fs.writeFileSync(path.join(OUT_DIR, "keys.json"), JSON.stringify(xteas));

    const info = {
        id: cache.id,
        game: cache.game,
        environment: cache.environment,
        revision,
        timestamp: cache.timestamp,
        indexFiles: fs
            .readdirSync(OUT_DIR)
            .filter((f) => /^main_file_cache\.idx\d+$/.test(f))
            .map((f) => Number(f.slice("main_file_cache.idx".length)))
            .sort((a, b) => a - b),
    };
    fs.writeFileSync(path.join(OUT_DIR, "info.json"), JSON.stringify(info, null, 2));

    console.log(`Done. Wrote ${Object.keys(files).length} files to ${OUT_DIR}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
