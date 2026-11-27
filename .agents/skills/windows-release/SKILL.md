---
name: windows-release
description: Use when building or updating the Windows release (`npm run package:win`, launcher/Launcher.cs, scripts/package-windows.mjs, .github/workflows/release.yml, release/, the README download links), and after any game change the launcher must support - a new file type in public/ or the build, a Vite base or outDir change, a new header the page needs (COOP/COEP for SharedArrayBuffer, Range requests for audio or video), a service worker, or a change to how saves rely on the origin (localStorage, IndexedDB). Keeps the exe working for players.
---

# Windows release

`npm run package:win` builds `release/FirstPersonSurvival/`: the Vite build in `game/` and
`FirstPersonSurvival.exe`, compiled from `launcher/Launcher.cs` by `scripts/package-windows.mjs`
with the .NET Framework 4 `csc.exe` that ships with Windows. It then splits that folder into
`release/FirstPersonSurvival-windows-partN.zip` files under GitHub's 2 GiB release-file limit.
Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds them on a Windows runner and
publishes a GitHub Release; the README's "Play on Windows" links point at
`releases/latest/download/<zip name>`. The README's "Windows release" section describes it for
people. This skill is for changing it.

## What the launcher assumes

Check each of these against the change. If one breaks, fix the launcher, not the game.

| Assumption                                                                      | Where                                  | Breaks when                                                                                   |
| ------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| Every file type the page loads has a MIME type                                  | `MimeTypes` in `Launcher.cs`           | A new extension appears in `public/` or the build. Module scripts and `.wasm` fail without the right type; others fall back to `application/octet-stream` |
| The game is served from `/`                                                     | `Url`, `Respond`                       | `base` changes in `vite.config.ts`                                                            |
| Saves stay where they are because the origin is `http://localhost:47613`        | `Port`, browser profile path           | Someone changes the port or the profile folder: players lose their saves                       |
| Plain `200` responses with `Cache-Control: no-store` are enough                 | `Respond`                              | The page needs COOP/COEP (SharedArrayBuffer), Range requests (seeking audio or video), or caching for a service worker |
| Only files under `game/` are served                                             | `Respond` (`StartsWith(root)`)         | Never loosen this                                                                              |
| The build lands in `release/FirstPersonSurvival/game`                           | `package:win` in `package.json`, `package-windows.mjs` | The output folder or exe name changes in only one of them                       |
| Every zip is under 2 GiB and there are exactly as many as the README links      | `PART_BYTES` in `package-windows.mjs`, README "Play on Windows" | The map grows: the script adds a part and warns; add its link to the README (zip names are `FirstPersonSurvival-windows-partN.zip`) |
| Each zip adds an empty `game/part-N-of-TOTAL` marker                            | `package-windows.mjs`, `CheckParts` in `Launcher.cs` | The marker name changes in only one of them: the launcher stops spotting a missing zip |
| The release workflow can build on `windows-latest`                              | `release.yml`                          | The package script starts needing something a GitHub Windows runner lacks                      |

To find new file types, compare the extensions in `public/` with the `MimeTypes` table:

```bash
find public -type f | sed 's/.*\.//' | sort | uniq -c
```

The C# compiler is C# 5: no string interpolation, `?.`, expression-bodied members or `out var`.

## Rebuild and check

Run these from PowerShell. The build takes about 3 minutes and writes ~2.6 GB, and zipping about
5 more minutes and ~2.3 GB, so tell the user before starting it. When only `Launcher.cs` changed, `node scripts/package-windows.mjs --no-zip` rebuilds
just the exe.

1. `npm run package:win`. It typechecks the game only (`tsc --noEmit`), not `tools/`.
2. Start `release\FirstPersonSurvival\FirstPersonSurvival.exe`, then check that the server is up:
   `/__launcher` returns `first-person-survival-launcher`, `/` is `text/html`, the JS in `assets/`
   is `text/javascript`, and `/../package.json` is 404.
3. Load `http://localhost:47613/` in Playwright's Chromium (`--use-angle=swiftshader`), wait
   ~20 s, and collect failed responses and console errors. A 404 for `models/player.glb` is
   expected: the file is optional. Look at a screenshot; don't take screenshots of the user's
   desktop, since the game window may be behind other windows.
4. Run the exe a second time: it should exit at once and open another window. Close the game
   windows: the first launcher should exit and the port should stop answering.
5. When the zips changed, test them as a player in the scratchpad: extract part 1 alone with
   `%WINDIR%\System32\tar.exe -xf` and run the exe (it should refuse and name the missing zip),
   then extract the other parts into the same folder and check the file count and bytes match
   `release/FirstPersonSurvival/`. Delete the copy afterwards; it is 2.6 GB.

Publishing a release (pushing a tag) is public: do it only when the user asks. Update the README's
"Play on Windows" and "Windows release" sections if what players see or need changes.
