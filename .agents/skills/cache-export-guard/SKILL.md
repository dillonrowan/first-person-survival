---
name: cache-export-guard
description: Required before running `npm run download-cache`, `export-world`, `export-items` or `export-cache-weapons` (or the scripts behind them, scripts/download-cache.mjs and tools/world-export/export-*.ts), and before suggesting to the user that they run one. These take a long time, use a lot of CPU, RAM and disk, and the exports delete what is already in public/world/. Check whether the existing cache and export already cover the request, and ask the user before running anything.
---

# Cache download and export guard

Downloading the OSRS cache and exporting it take a long time and use a lot of the machine:

| Command                        | Cost                                                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run download-cache`       | Downloads ~240 MB from OpenRS2, then **deletes and rewrites `cache/`**                                                                                                                       |
| `npm run export-world`         | Uses up to 16 GB of heap and every CPU core, writes ~1.5 GB, and **runs `rm -rf public/world/` first**, which also deletes `items.json`, `items/`, `cache-weapons.json` and `cache-weapons/` |
| `npm run export-items`         | Uses up to 8 GB of heap; deletes and rewrites `public/world/items/` and `items.json`                                                                                                         |
| `npm run export-cache-weapons` | Deletes and rewrites `public/world/cache-weapons/` and `cache-weapons.json`                                                                                                                  |

**Never run any of these without the user's explicit yes in the current conversation.** That
applies even if you were asked to "re-export", if a plan file lists the step, or if the user
agreed to a different run earlier. One yes covers one run. Do not start them in the background
to get around this. When a test, plan or doc says "re-export", treat that as a reason to come
here, not as permission.

## Step 1: Work out what the request actually needs

Before checking anything, write down which exported data the task depends on:

- **Map** (terrain, objects, collision, textures): `world.json`, `regions/X_Y.bin`, `textures.png`
- **NPCs** (models, spawns, attacks, stats, drops): `npcs.json`, `npcs/`, the `npcs` field of `world.json`
- **Ground items**: `ground-items.json`, the `groundItems` field of `world.json`
- **Items** (inventory icons, item info, food): `items.json`, `items/`
- **Weapon menu models**: `cache-weapons.json`, `cache-weapons/`
- **Only the cache** (e.g. tests in `tools/world-export/*.test.ts` that decode it, `list-npc-seqs.ts`): `cache/`

Many tasks need none of these. Game code, UI, tests that mock data, and docs work on the
existing files. Pure exporter code changes can be checked with the unit tests first.

## Step 2: Check what is already there

Run the status script from the repository root:

```sh
node .claude/skills/cache-export-guard/check-world.mjs
```

(The same script is in `.agents/skills/` and `.github/skills/`.) It can take up to a minute
when `public/world/` has many rewritten files, since git must hash them. It reports, with no
side effects:

- whether `cache/` is complete and which revision and OpenRS2 id it holds
- `world.json`'s format against `WORLD_FORMAT_VERSION`, its source revision, region count and bounds, NPC and ground item counts
- `npcs.json`'s format against `NPC_FORMAT_VERSION`
- whether `items.json` and `cache-weapons.json` exist and how many entries they hold
- uncommitted changes to `public/world/` (it is tracked in git)
- any export or download that is already running

Then, for the data from step 1, decide whether it is satisfied:

1. **Files present and formats current.** If a format number is behind the code, that part
   needs a re-export. If it matches, the files can be used.
2. **Area covered.** For map or NPC work in a specific place, check that its map squares are
   in `world.json`'s `regions` (map square = `floor(tileX / 64), floor(tileY / 64)`). The default
   export is the surface (y < 66). Dungeons need `--area all` or an `--area` that covers them.
3. **Exporter changes.** A re-export is needed only when the task changes what the exporter
   writes (files under `tools/world-export/`, or the `encode*` side of `src/world/*Format.ts`)
   **and** the task needs to see that change in the game. Compare against the last export
   commit (`git log -1 --format=%h%x20%s -- public/world/world.json public/world/npcs.json`)
   and look at `git log <that commit>..HEAD -- tools/world-export src/world` plus the working
   tree diff. Exporter changes that do not touch the data the task needs do not count.
4. **Cache.** Only download if `cache/` is missing or incomplete, or the task specifically
   needs a different revision. An older revision than the newest one online is not a reason
   to download.
5. **Damaged working tree.** If `public/world/` shows deleted or modified files and no export
   is running, an earlier export may have been interrupted. The committed export can usually
   be restored with `git restore public/world` (or `git checkout -- public/world`) in seconds
   instead of re-exporting. Restoring discards those working tree changes, so it also needs the
   user's yes. Offer it as the first option.
6. **Already running.** If the script shows an export or download in progress, do not start
   another. Tell the user and wait for it.

If the existing data satisfies the request, **do not ask about running anything**. Go ahead
with the task and say in one line that the existing export already covers it (e.g. "Using the
existing export: world format 3, NPC format 4, revision 242, 1636 regions.").

## Step 3: Pick the smallest run that would work

If something really is missing, choose the cheapest command that fixes it:

| Need                                                        | Command                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| NPC data only (models, attacks, stats, drops, ground items) | `npm run export-world -- --npcs-only` (keeps the map, needs a `world.json`)                                                    |
| NPC stats, poison and drops only (no models)                | `npm run export-world -- --npc-data-only` (seconds; rewrites only `npcs.json`)                                                 |
| Hitsplat sprites                                            | `npm run export-hitsplats` (seconds; writes `public/ui/hitsplats.*`, deletes nothing)                                          |
| Map of one area for a quick check                           | `npm run export-world -- --area x1,y1,x2,y2` (still wipes everything else in `public/world/`; say so)                          |
| Items only                                                  | `npm run export-items`                                                                                                         |
| Weapon menu only                                            | `npm run export-cache-weapons`                                                                                                 |
| Whole map                                                   | `npm run export-world`, then `npm run export-cache-weapons` and `npm run export-items`, because the first deletes their output |
| Interrupted export                                          | `git restore public/world`                                                                                                     |
| No cache                                                    | `npm run download-cache` (then the export(s) above)                                                                            |

The wiki fetches (`fetch-wiki-attacks`, `fetch-wiki-items`) are quick network calls, not part
of this guard, but run them only if the task needs new wiki data.

## Step 4: Ask

Use AskUserQuestion (or, if it is not available, ask in plain text and stop). Make the question
stand on its own, since the user may only see the dialog:

- what the task needs and what the check found to be missing or stale (one or two lines, with the numbers)
- the exact command(s), in order
- what each one deletes (`public/world/` entirely for `export-world`, `cache/` for `download-cache`)
- that it is slow and uses most of the machine's CPU and memory while it runs

Options, cheapest first, for example: "Restore from git (Recommended)", "Run
`export-world -- --npcs-only`", "Run the full export", "Skip it: I'll run it myself". If the user
says no or picks skip, carry on with everything that does not need the export, and list at the
end what still needs the export and the command for it.

## Step 5: If approved

- Run exactly the approved command(s), in the foreground or with `run_in_background` and wait
  for the notification. Do not poll, and do not run other heavy work (builds, e2e tests) at the
  same time.
- If a run fails partway through, `public/world/` is incomplete. Report the error and ask again
  before retrying or restoring.
- When it is done, run `check-world.mjs` again and report the new numbers.
