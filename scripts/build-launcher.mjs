// Compiles launcher/Launcher.cs into release/FirstPersonSurvival/FirstPersonSurvival.exe with the
// C# compiler from .NET Framework 4, which ships with Windows. Run through `npm run package:win`,
// which builds the game into release/FirstPersonSurvival/game first.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const outDir = join("release", "FirstPersonSurvival");
const windir = process.env.WINDIR ?? "C:\\Windows";
const csc = [
    join(windir, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    join(windir, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
].find((path) => existsSync(path));

if (process.platform !== "win32" || !csc) {
    console.error("build-launcher: needs Windows with .NET Framework 4 (csc.exe not found).");
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
        `/out:${join(outDir, "FirstPersonSurvival.exe")}`,
        join("launcher", "Launcher.cs"),
    ],
    { stdio: "inherit" },
);
console.log(`Built ${join(outDir, "FirstPersonSurvival.exe")}`);
