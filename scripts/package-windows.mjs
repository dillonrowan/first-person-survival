// The last step of `npm run package:win`, after the game is built into
// release/FirstPersonSurvival/game: compiles launcher/Launcher.cs into
// release/FirstPersonSurvival/FirstPersonSurvival.exe and zips the folder for players.
//
// GitHub release files must be under 2 GiB and the game is bigger, so it is split into
// FirstPersonSurvival-windows-part1.zip, -part2.zip, ... Every zip holds the same
// FirstPersonSurvival folder: extracting them all into one place puts the game back together.
// Part 1 has the exe and everything but map regions; the regions fill the parts in order. Empty
// marker files (game/part-1-of-2, ...) let the launcher tell players which zip they missed.
//
// Both tools ship with Windows: the C# compiler from .NET Framework 4, and tar.exe (libarchive),
// called by full path because Git's GNU tar cannot write zips.
// `--no-zip` skips the zips, for rebuilding just the exe.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const releaseDir = "release";
const folder = "FirstPersonSurvival";
const outDir = join(releaseDir, folder);
const gameDir = join(outDir, "game");
const windir = process.env.WINDIR ?? "C:\\Windows";
const csc = [
    join(windir, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    join(windir, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
].find((path) => existsSync(path));
const tar = join(windir, "System32", "tar.exe");

/** GitHub's limit for one release file. */
const MAX_ZIP_BYTES = 2 ** 31 - 1;
/**
 * Uncompressed bytes per part. The map regions barely compress (a zip is ~88% of the files), so
 * this keeps each zip well under the limit.
 */
const PART_BYTES = 1.6 * 2 ** 30;

if (process.platform !== "win32" || !csc) {
    console.error("package-windows: needs Windows with .NET Framework 4 (csc.exe not found).");
    process.exit(1);
}

mkdirSync(outDir, { recursive: true });
execFileSync(
    csc,
    [
        "/nologo",
        "/target:winexe",
        "/optimize+",
        "/reference:System.Windows.Forms.dll",
        `/out:${join(outDir, `${folder}.exe`)}`,
        join("launcher", "Launcher.cs"),
    ],
    { stdio: "inherit" },
);
console.log(`Built ${join(outDir, `${folder}.exe`)}`);

if (process.argv.includes("--no-zip")) process.exit(0);
if (!existsSync(join(gameDir, "index.html"))) {
    console.error(`package-windows: ${gameDir} is missing; run npm run package:win.`);
    process.exit(1);
}

// Old zips and part markers, in case the number of parts changed.
for (const name of readdirSync(releaseDir)) {
    if (/^FirstPersonSurvival-windows.*\.zip$/.test(name)) rmSync(join(releaseDir, name));
}
for (const name of readdirSync(gameDir)) {
    if (/^part-\d+-of-\d+$/.test(name)) rmSync(join(gameDir, name));
}

/** Files under release/, as zip paths (relative to release/, forward slashes) with sizes. */
function walk(dir, prefix) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = `${prefix}/${entry.name}`;
        return entry.isDirectory() ? walk(join(dir, entry.name), path) : [{ path, size: statSync(join(dir, entry.name)).size }];
    });
}
const files = walk(outDir, folder);
const regionsPrefix = `${folder}/game/world/regions/`;
const regions = files.filter((f) => f.path.startsWith(regionsPrefix)).sort((a, b) => a.path.localeCompare(b.path));
const rest = files.filter((f) => !f.path.startsWith(regionsPrefix));
const total = files.reduce((sum, f) => sum + f.size, 0);
const count = Math.ceil(total / PART_BYTES);

const parts = Array.from({ length: count }, () => ({ files: [], size: 0 }));
parts[0].files.push(...rest.map((f) => f.path));
parts[0].size = rest.reduce((sum, f) => sum + f.size, 0);
let index = 0;
for (const region of regions) {
    if (parts[index].size + region.size > total / count && index < count - 1) index++;
    parts[index].files.push(region.path);
    parts[index].size += region.size;
}

const listDir = join(tmpdir(), "first-person-survival-package");
mkdirSync(listDir, { recursive: true });
for (const [i, part] of parts.entries()) {
    const marker = `part-${i + 1}-of-${count}`;
    writeFileSync(join(gameDir, marker), "");
    part.files.push(`${folder}/game/${marker}`);

    const list = join(listDir, `part${i + 1}.txt`);
    writeFileSync(list, part.files.join("\n") + "\n");
    const zip = join(releaseDir, `${folder}-windows-part${i + 1}.zip`);
    // -a picks the format from the .zip extension; -T reads the paths, relative to -C, from the list.
    execFileSync(tar, ["-a", "-c", "-f", zip, "-C", releaseDir, "-T", list], { stdio: "inherit" });
    const size = statSync(zip).size;
    console.log(`Zipped ${zip} (${(size / 2 ** 30).toFixed(2)} GB, ${part.files.length} files)`);
    if (size > MAX_ZIP_BYTES) {
        console.error(`package-windows: ${zip} is over GitHub's 2 GiB limit; lower PART_BYTES.`);
        process.exit(1);
    }
}
rmSync(listDir, { recursive: true, force: true });
if (count !== 2) {
    console.warn(`package-windows: the game now needs ${count} zips; update the download links in README.md.`);
}
