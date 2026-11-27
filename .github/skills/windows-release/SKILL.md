---
name: windows-release
description: Use when building or updating the Windows release (`npm run package:win`, launcher/Launcher.cs, scripts/build-launcher.mjs, release/), and after any game change the launcher must support - a new file type in public/ or the build, a Vite base or outDir change, a new header the page needs (COOP/COEP for SharedArrayBuffer, Range requests for audio or video), a service worker, or a change to how saves rely on the origin (localStorage, IndexedDB). Keeps the exe working for players.
---

# Windows release

`npm run package:win` builds `release/FirstPersonSurvival/`: the Vite build in `game/` and
`FirstPersonSurvival.exe`, compiled from `launcher/Launcher.cs` by `scripts/build-launcher.mjs`
with the .NET Framework 4 `csc.exe` that ships with Windows. The README's "Windows release"
section describes it for people. This skill is for changing it.

## What the launcher assumes

Check each of these against the change. If one breaks, fix the launcher, not the game.

| Assumption                                                                      | Where                                  | Breaks when                                                                                   |
| ------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| Every file type the page loads has a MIME type                                  | `MimeTypes` in `Launcher.cs`           | A new extension appears in `public/` or the build. Module scripts and `.wasm` fail without the right type; others fall back to `application/octet-stream` |
| The game is served from `/`                                                     | `Url`, `Respond`                       | `base` changes in `vite.config.ts`                                                            |
| Saves stay where they are because the origin is `http://localhost:47613`        | `Port`, browser profile path           | Someone changes the port or the profile folder: players lose their saves                       |
| Plain `200` responses with `Cache-Control: no-store` are enough                 | `Respond`                              | The page needs COOP/COEP (SharedArrayBuffer), Range requests (seeking audio or video), or caching for a service worker |
| Only files under `game/` are served                                             | `Respond` (`StartsWith(root)`)         | Never loosen this                                                                              |
| The build lands in `release/FirstPersonSurvival/game`                           | `package:win` in `package.json`, `build-launcher.mjs` | The output folder or exe name changes in only one of them                       |

To find new file types, compare the extensions in `public/` with the `MimeTypes` table:

```bash
find public -type f | sed 's/.*\.//' | sort | uniq -c
```

The C# compiler is C# 5: no string interpolation, `?.`, expression-bodied members or `out var`.

## Rebuild and check

Run these from PowerShell. The build takes about 3 minutes and writes ~2.6 GB, so tell the user
before starting it. When only `Launcher.cs` changed, `node scripts/build-launcher.mjs` rebuilds
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

Update the README's "Windows release" section if what players see or need changes.
