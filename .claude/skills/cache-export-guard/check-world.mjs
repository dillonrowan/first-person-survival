// Read-only status of the OSRS cache and the exported world, for the cache-export-guard skill.
//
//   node .claude/skills/cache-export-guard/check-world.mjs
//
// It only reads manifests (never region or model files), git status and the process list, and
// never downloads, exports or deletes anything. Usually a few seconds; up to a minute when many
// files in public/world/ were rewritten, because git has to hash them.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CACHE = path.join(ROOT, "cache");
const WORLD = path.join(ROOT, "public", "world");

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return undefined;
    }
}

/** The number in `export const NAME = <n>;` in a source file, or undefined. */
function codeConstant(file, name) {
    try {
        const match = fs
            .readFileSync(path.join(ROOT, file), "utf8")
            .match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)`));
        return match ? Number(match[1]) : undefined;
    } catch {
        return undefined;
    }
}

function versionNote(actual, expected) {
    if (actual === undefined) return "missing";
    if (expected === undefined) return String(actual);
    return actual === expected
        ? `${actual} (current)`
        : `${actual} -- code expects ${expected}: STALE`;
}

function run(command) {
    try {
        return execSync(command, {
            cwd: ROOT,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
    } catch {
        return "";
    }
}

const lines = [];
const say = (s = "") => lines.push(s);

// Cache
say("CACHE (cache/)");
const info = readJson(path.join(CACHE, "info.json"));
if (!info) {
    say("  missing: no cache/info.json -> a download would be needed for any export");
} else {
    const missing = (info.indexFiles ?? [])
        .map((i) => `main_file_cache.idx${i}`)
        .concat(["main_file_cache.dat2", "main_file_cache.idx255", "keys.json"])
        .filter((f) => !fs.existsSync(path.join(CACHE, f)));
    say(`  revision ${info.revision}, OpenRS2 id ${info.id}, ${info.timestamp}`);
    say(missing.length ? `  INCOMPLETE: missing ${missing.join(", ")}` : "  complete");
}

// World
const worldVersion = codeConstant("src/world/WorldFormat.ts", "WORLD_FORMAT_VERSION");
const npcVersion = codeConstant("src/world/NpcFormat.ts", "NPC_FORMAT_VERSION");
say();
say("EXPORT (public/world/)");
const world = readJson(path.join(WORLD, "world.json"));
if (!world) {
    say("  world.json: missing (map, NPCs and ground items not exported)");
} else {
    const regions = world.regions ?? [];
    const xs = regions.map((r) => r[0]);
    const ys = regions.map((r) => r[1]);
    say(`  world.json format: ${versionNote(world.format, worldVersion)}`);
    say(`  source: revision ${world.source?.revision}, OpenRS2 id ${world.source?.cacheId}`);
    if (info && world.source?.cacheId !== info.id) {
        say(`  note: exported from a different cache than cache/ holds (id ${info.id})`);
    }
    if (regions.length) {
        say(
            `  regions: ${regions.length}, map squares x ${Math.min(...xs)}..${Math.max(...xs)}, ` +
                `y ${Math.min(...ys)}..${Math.max(...ys)}` +
                (Math.max(...ys) < 66 ? " (surface only)" : " (includes underground)"),
        );
    }
    const regionDir = path.join(WORLD, "regions");
    const files = fs.existsSync(regionDir) ? fs.readdirSync(regionDir).length : 0;
    if (files !== regions.length)
        say(`  WARNING: ${files} files in regions/, manifest lists ${regions.length}`);
    say(
        `  textures.png: ${fs.existsSync(path.join(WORLD, "textures.png")) ? "present" : "MISSING"}`,
    );
    say(
        world.npcs
            ? `  npcs: ${world.npcs.spawns} spawns, ${world.npcs.appearances} appearances`
            : "  npcs: not exported (--no-npcs?)",
    );
    say(
        world.groundItems
            ? `  ground items: ${world.groundItems.spawns} spawns`
            : "  ground items: not exported",
    );
}
const npcs = readJson(path.join(WORLD, "npcs.json"));
say(`  npcs.json format: ${npcs ? versionNote(npcs.format, npcVersion) : "missing"}`);
const items = readJson(path.join(WORLD, "items.json"));
say(
    `  items.json: ${items ? `${items.items?.length ?? 0} items (format ${items.format})` : "missing"}`,
);
const weapons = readJson(path.join(WORLD, "cache-weapons.json"));
say(
    `  cache-weapons.json: ${weapons ? `${Array.isArray(weapons) ? weapons.length : "?"} weapons` : "missing"}`,
);

// Git state of the tracked export
say();
say("GIT (public/world/ is tracked)");
const status = run("git status --porcelain -- public/world");
if (!status.trim()) {
    say("  clean: matches the last commit");
} else {
    const counts = {};
    for (const line of status.split("\n").filter(Boolean)) {
        const code = line.slice(0, 2).trim() || "?";
        counts[code] = (counts[code] ?? 0) + 1;
    }
    say(
        `  working tree differs: ${Object.entries(counts)
            .map(([k, v]) => `${v} ${k}`)
            .join(", ")}`,
    );
    say(
        "  (D = deleted, M = modified, ?? = untracked; `git restore public/world` brings back the committed export)",
    );
}
const last = run(
    'git log -1 --format="%h %ad %s" --date=short -- public/world/world.json public/world/npcs.json',
).trim();
if (last) {
    say(`  last export commit: ${last}`);
    const hash = last.split(" ")[0];
    const since = run(`git log --oneline ${hash}..HEAD -- tools/world-export src/world`).trim();
    const dirty = run("git status --porcelain -- tools/world-export src/world").trimEnd();
    say(`  exporter commits since then: ${since ? since.split("\n").length : 0}`);
    if (since) for (const l of since.split("\n").slice(0, 10)) say(`    ${l}`);
    if (dirty)
        say(
            `  uncommitted exporter changes:\n${dirty
                .split("\n")
                .map((l) => `    ${l}`)
                .join("\n")}`,
        );
}

// Running jobs
say();
say("RUNNING");
const procs =
    process.platform === "win32"
        ? run(
              'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | ForEach-Object { $_.CommandLine }"',
          )
        : run("ps -eo args");
const jobs = procs
    .split(/\r?\n/)
    .filter((l) =>
        /download-cache|export-world|export-worker|export-items|export-cache-weapons/.test(l),
    );
say(
    jobs.length
        ? jobs.map((j) => `  IN PROGRESS: ${j.trim().slice(0, 160)}`).join("\n")
        : "  no download or export running",
);

console.log(lines.join("\n"));
