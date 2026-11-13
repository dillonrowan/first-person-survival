# First-Person Survival

A browser game prototype set on the Old School RuneScape (OSRS) world map. Exported runtime files
live in `public/world/`; the game loads those files and never needs the source cache.

This is currently a simple web app: you can walk (or fly) through the version-controlled
exported world map in first person, with collision.

## Quick start

Install Git LFS, clone the repository, and hydrate its exported world assets:

```bash
git clone https://github.com/dillonrowan/first-person-survival.git
cd first-person-survival
git lfs pull
npm ci
npm run dev
```

Git LFS must be installed before cloning; GitHub Desktop and recent Git distributions may
prompt you to install it automatically. The OSRS source cache is only needed when regenerating
the exported world.

Open http://localhost:5173 and click to play. To start somewhere else, add tile coordinates,
for example `http://localhost:5173/?x=3213&y=3428` (Varrock square).

For movement, combat, interactions, props, flying, and the HUD, see the
[Player Guide](docs/player-guide.md).

| Key        | Action                                                          |
| ---------- | --------------------------------------------------------------- |
| W A S D    | Move                                                            |
| Mouse      | Look                                                            |
| Left mouse | Attack: tap for quick strikes, hold to charge a power attack    |
| F          | Kick: shoves an enemy back; into a wall or off a ledge it falls |
| Wheel      | Switch weapon (sword, daggers, club, staff)                     |
| Shift      | Sprint, costs stamina (or fly faster)                           |
| Alt        | Walk slowly                                                     |
| C          | Crouch (while flying: sink)                                     |
| Space      | Jump                                                            |
| N          | Toggle flying; Space / C to rise / sink                         |
| E / R      | First / second action on what you aim at (E picks up a prop)    |
| Left mouse | While carrying a prop: throw it (E drops it)                    |
| Esc        | Release the mouse                                               |
| V          | Third-person camera (dev builds only)                           |

A charged attack takes its direction from the movement keys held when you release it:
strafe left or right for side slashes, back for a thrust, forward while looking up or jumping for
an overhead. Charging while sprinting at full stamina gives a lunging rush; attacking while falling
fast gives a plunging strike. Hits fill the adrenaline bar, and when it is full your next charged
attack is a finishing blow. NPCs with an Attack option take damage, flinch, get knocked back and
die. Once hit, an NPC fights: it runs or walks in, zig-zags while you look straight at it, then
holds its ideal distance with short combat steps, and flees when badly hurt. It does not strike
back yet. The numbers and their sources are in
[docs/combat-movement-spec.md](docs/combat-movement-spec.md). Weapon art goes in
`public/models/weapons/`, see [docs/weapon-models.md](docs/weapon-models.md).

Knocked-down and killed NPCs become ragdolls, as in Dark Messiah: their body parts (found from the
OSRS model's vertex labels and animation data, see section 20 of the spec) fall, tumble and come to
rest on the floor and against walls; knocked-down NPCs then get up where they lie. Joints bend only
as far, and only the way, the NPC's own idle and walk animations bend them (a knee never folds
backwards), body parts collide with each other, and a body is still within about a second and a
half. A body flying into another NPC knocks it over too (it gets up again; a body never kills),
and bodies on the ground push each other aside. Corpses stay for 30 s, at most 8 at a time.

Crates, barrels, sacks, chairs, stools and pots are loose physics props, as in Dark Messiah: kick
them, hit them, pick them up and throw them. Thrown props hurt and knock down NPCs, props break
from hard impacts or weapon hits, and props falling on you hurt. Long falls hurt too (Source fall
damage, 60% taken). The values and their sources are in section 19 of the spec.

Turning flying off lands you on the highest floor below you, so you can fly onto a castle
roof or into an upper floor and walk around there.

### Export options

```bash
npm run export-world -- --area all            # surface plus dungeons, minigames, instances
npm run export-world -- --area 44,48,54,56    # only map squares x 44..54, y 48..56
npm run export-world -- --workers 4           # parallel workers (default: by cores and free RAM, max 6)
npm run export-world -- --no-npcs             # skip NPC models and spawns
npm run download-cache -- 238                 # a specific OSRS revision instead of the newest
```

Re-run `export-world` whenever you change the exporter or download a newer cache.

## How the cache becomes a 3D map

`tools/world-export/` reads the cache in Node (decoders in `tools/world-export/rs/`) and turns
each map square into game files:

1. **Cache container.** `main_file_cache.dat2` is a sector file: 520-byte sectors chained
   together, located through the `idx{n}` files (6 bytes per group: size + first sector).
   `idx255` holds a reference table per index (group ids, file ids, name hashes). Every group
   is a container compressed with gzip or bzip2 (rs/cache/).
2. **Configs.** Index 2 holds definition archives: underlays (1) and overlays (4) are the
   ground colors/textures, locs (6) are every placeable object (walls, trees, doors, roofs...)
   with model ids, size, collision and lighting tweaks (rs/config/).
3. **Map squares.** Index 5 holds the map, one 64x64-tile square per group. Since revision 237
   a square is a single group, id `(x << 8) | y`, with file 0 = terrain and file 1 = locs
   (older caches used `m{x}_{y}` / `l{x}_{y}` and XTEA-encrypted loc files).
    - Terrain: per tile and level (4 levels), a height (or a procedural smoothed-noise height),
      underlay id, overlay id + shape + rotation, and render flags (0x1 blocked, 0x2 bridge...).
    - Locs: a delta-encoded list of `(loc id, level, x, y, type, rotation)`.
4. **Scene building** (`SceneBuilder`). For a square plus a 6-tile border it:
    - blends underlay colors over a 5-tile radius (the soft grass/dirt gradients),
    - lights the terrain from a fixed sun direction `(-50, -10, -50)` using height-derived
      normals, minus "light occlusion" cast by nearby walls and objects,
    - turns each tile into a `SceneTileModel`: one of 13 tile shapes (half/corner overlays),
      with per-vertex HSL colors or a texture,
    - places locs: picks the model(s) for the loc type (wall, corner, decoration, roof, floor
      decoration...), rotates/mirrors/recolors/scales them, contours them to the ground, and
      fills the collision map (walls set edge flags on both neighboring tiles),
    - merges normals between adjacent wall/loc models so walls shade seamlessly, then lights
      every model (Gouraud, baked into per-vertex colors).
5. **Models** (index 7) are decoded by `ModelData` (several historic formats), with texture
   coordinates computed from per-face texture-mapping triangles.
6. **Textures** (index 9) reference sprites (index 8): 128x128 palette images, some
   animated (scrolling water, lava).
7. **Export** (`RegionBuilder`). Each map square is written as one region file:
    - its faces are merged into 3 meshes: ground + roofs, other models (back-face culled like
      the client), and transparent faces. No instancing is needed: almost every placed model
      is unique after ground contouring and normal merging,
    - HSL is converted to RGB at export time (brightness 0.8, the client's middle setting), so
      the game shader only multiplies vertex color with the texture,
    - each face keeps its draw priority; the shader offsets depth by it so decals on walls and
      floors don't flicker,
    - collision, heights and floor masks are included, so the game can walk on the map.

### First-person adjustments

- First person looks at things the OSRS camera never sees. Ground + roofs are drawn twice,
  front faces and back faces, so upper floors work as ceilings and roofs show from inside;
  the back-face pass gets extra depth bias so the bottoms of objects standing on an upper
  floor don't poke through the ceiling below.
- One-tile locs named like crates, barrels, sacks, chairs, stools or pots
  (`tools/world-export/Props.ts`) are exported as physics props: their own meshes, a mass and a
  material, and no tile collision (the game's prop body replaces it).
- Doors and gates (locs with an "Open" action) have their collision removed, since nothing
  can open them yet. Animated locs are shown in their base pose; varbit-dependent locs in
  their default state. Ground items are not exported.

### NPCs

The OSRS cache has NPC definitions, models and animations but **not where NPCs stand**; that
is server data. Spawn positions come from `tools/world-export/data/npc-spawns-osrs.json`
(copied from rs-map-viewer, see Credits; it dates from 2023, so spawns whose id or name no
longer match the cache are skipped and counted in the export log).

- The exporter resolves each spawn to the NPC model shown (multi-NPCs are shown with all
  variables at 0, like locs), lights it, and bakes every frame of its idle and walk
  animations into one file per NPC (`npcs/{id}_{displayId}.bin`). The game only copies
  vertex positions per frame; no RuneScape animation code runs in the browser.
- In game, NPCs appear and disappear with their map square, loop their idle animation, and
  wander within 5 tiles of their spawn (walls and objects stop them), like rs-map-viewer.
- Each NPC file also carries a ragdoll skeleton (`tools/world-export/NpcSkeleton.ts`): the model's
  labelled vertex groups that animate together become rigid parts, joined where the animation's
  frame base rotates them.
- NPCs are solid: the player is pushed out of their collision cylinder and slides around them,
  and NPCs wait instead of walking into the player. NPCs with skeletal animations (a
  handful) are shown in their base pose. Deaths and knockdowns are ragdolls.
  Dev builds can draw the collision circles with `?debug=collision`.
- NPC attacks are the cache's own melee animations, baked into each NPC file with the moment the
  blow lands (`tools/world-export/NpcAttackAnims.ts`). The cache does not say which animation an
  NPC attacks with (server data) or name its animations, so the exporter uses Jagex's animation
  names (`data/animation-names-runelite.json`): a creature's attack is the one on its own skeleton
  whose name matches its idle (`ZOMBIE_UPDATE_READY_DRAGGING` → `ZOMBIE_UPDATE_ATTACK_DRAGGING`),
  and NPCs on the player's skeleton fight like players, with their stance's weapon attacks (or
  punches and kicks when they hold nothing). NPCs the cache has no attack for lunge with a generic
  attack made in Blender (`tools/blender/lunge_clip.py`).
- NPCs that use more than melee (dragons breathe fire, archers shoot, mages cast) get one baked
  clip per attack style. The styles come from the OSRS wiki, not the cache:
  `npm run fetch-wiki-attacks` saves them to `tools/world-export/data/npc-attacks-wiki.json`, and
  `data/npc-attack-overrides.ts` holds the rules the wiki does not give (see section 16.8 of
  `docs/combat-movement-spec.md`). `tools/blender/check_attack.py` loads an attack into Blender
  to check its release frame and launch point.
- `npm run export-world -- --no-npcs` skips them; `--npcs-only` re-bakes the NPCs of the exported
  map without exporting it again.

Runtime (`src/`): three.js, one raw shader (`WorldMaterials.ts`), region streaming around the
player (`World.ts`), and a first-person controller with tile collision (`Player.ts`). In dev
builds `window.game` exposes the renderer, scene, world and player for the devtools console,
e.g. `game.player.flying = true`.

## World file format

Defined in `src/world/WorldFormat.ts`, shared by the exporter and the game.

- `public/world/world.json`: manifest (source cache, region list, spawn, texture layers with
  animation speed and alpha cut-off).
- `public/world/textures.png`: texture atlas, 16 cells of 128 px per row. Layer 0 is white
  (used by untextured faces); edit textures here.
- `public/world/regions/{x}_{y}.bin`: one gzip-compressed region per map square containing
  the three meshes (16 bytes per vertex), corner heights per level, render flags, floor
  masks and OSRS collision flags per tile.
- `public/world/npcs.json` and `public/world/npcs/{id}_{displayId}.bin`: NPC spawns, and one
  gzip-compressed model per NPC appearance (lit mesh plus baked idle, walk and attack frames). Defined
  in `src/world/NpcFormat.ts`. Absent when exported with `--no-npcs`.

Coordinates are OSRS world tiles (`x` east, `y` north; Lumbridge is 3222, 3218). In three.js
space, tile `(x, y)` at height `h` is `(x, h, -y)`, one unit per tile.

## Notes

- `cache/` is git-ignored because the downloaded source cache is large and can be recreated
  with `npm run download-cache`. The exported `public/world/` assets are version-controlled so
  the game and tests work without an OSRS cache. The map, models and textures belong to Jagex.
  Using them for a personal prototype is
  one thing; publishing a game built on them would need permission or your own replacement
  assets.
- `vite build` copies `public/world/` into `dist/`, so a production build is ~1.5 GB.

## Credits

The cache decoders in `tools/world-export/rs/` (including the NPC and animation ones) and the
NPC spawn list come from [rs-map-viewer](https://github.com/dennisdev/rs-map-viewer)
(BSD 2-Clause, Copyright (c) 2022-2023 dennisdev). Caches come from the
[OpenRS2 archive](https://archive.openrs2.org/). The animation names in
`tools/world-export/data/animation-names-runelite.json` come from RuneLite's
`net.runelite.api.gameval.AnimationID` ([RuneLite](https://github.com/runelite/runelite),
BSD 2-Clause).
