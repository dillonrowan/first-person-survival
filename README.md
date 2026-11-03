# First-Person Survival

A browser game prototype set on the Old School RuneScape (OSRS) world map. The map is converted
**once** from the OSRS cache into game files (`public/world/`); the game only loads those
files and never touches the cache.

This is currently a simple web app: you can walk (or fly) through the whole surface of
Gielinor in first person, with collision.

## Quick start

```bash
npm install
```

Download the OSRS cache once (newest live cache from the [OpenRS2 archive](https://archive.openrs2.org/),
about 200 MB, saved to `cache/`):

```bash
npm run download-cache
```

Convert it into the world map once (1,636 map squares, ~1.5 GB written to `public/world/`;
about 5 minutes with 3 workers):

```bash
npm run export-world
```

Run the game:

```bash
npm run dev
```

Open http://localhost:5173 and click to play. To start somewhere else, add tile coordinates,
for example `http://localhost:5173/?x=3213&y=3428` (Varrock square).

| Key     | Action                                  |
| ------- | --------------------------------------- |
| W A S D | Move                                    |
| Mouse   | Look                                    |
| Shift   | Sprint (or fly faster)                  |
| Space   | Jump                                    |
| F       | Toggle flying; Space / C to rise / sink |
| Esc     | Release the mouse                       |

Turning flying off lands you on the highest floor below you, so you can fly onto a castle
roof or into an upper floor and walk around there.

### Export options

```bash
npm run export-world -- --area all            # surface plus dungeons, minigames, instances
npm run export-world -- --area 44,48,54,56    # only map squares x 44..54, y 48..56
npm run export-world -- --workers 4           # parallel workers (default: by cores and free RAM, max 6)
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
- Doors and gates (locs with an "Open" action) have their collision removed, since nothing
  can open them yet. Animated locs are shown in their base pose; varbit-dependent locs in
  their default state. NPCs and ground items are not exported.

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

Coordinates are OSRS world tiles (`x` east, `y` north; Lumbridge is 3222, 3218). In three.js
space, tile `(x, y)` at height `h` is `(x, h, -y)`, one unit per tile.

## Notes

- `cache/` and `public/world/` are git-ignored: they are large and derived from Jagex's game
  data. The map, models and textures belong to Jagex. Using them for a personal prototype is
  one thing; publishing a game built on them would need permission or your own replacement
  assets.
- `vite build` copies `public/world/` into `dist/`, so a production build is ~1.5 GB.
