# Dungeon links: findings

Which overworld entrances lead into which dungeons, how that was worked out, and what is still
unknown. Verified against OSRS revision 242 (OpenRS2 cache #2757). The result is the committed
`tools/world-export/data/dungeon-links.json`; this page explains it.

## What the cache contains, and what it does not

Placed locs (type, rotation, tile, id) and loc definitions (name, actions, multiloc states) are all
there, so the cache gives every **entrance**: 7,205 placed locs have a transition verb ("Climb-down",
"Enter", "Squeeze-through"...) or a trapdoor-like name in some state, 3,037 of them on the surface
(map rows y <= 65) and 4,168 underground.

It does **not** say where an entrance leads. In OSRS that is server-side data. Of the plan's
assumptions, two did not hold:

- **`mapFunctionId` is -1 on every surface loc** in this cache. The map-icon completeness check
  (every loc with the dungeon icon is linked) could not be done. The substitute below is a coverage
  count over entrances with dungeon-like names.
- The hand-check coordinates in the plan were right: all nine entrances exist in the cache at the
  listed tile (Stronghold of Security one tile south, 3081,3420).

## Methods

`npm run find-dungeon-links` (`tools/world-export/find-dungeon-links.ts`) does three things.

1. **Inventory** (`DungeonInventory.ts`, `DungeonCandidates.ts`). Every placed loc of every type
   (0-22) in all 2,949 map squares, with each multiloc state's name and actions, the collision
   plane (bridges remapped), size and rotation. The raw list goes to `tools/world-export/out/`
   (ignored by git).
2. **Cache pairs.** A surface entrance with a "down" verb is paired with an "up" candidate within 8
   tiles of the same spot 6,400 tiles north (the dungeon copy of the surface). One partner, or one
   clearly nearest, makes a link (`source: "cache-pair"`) and the way back out as well; the arrival
   tile is the one the partner faces. A same-spot plane change (a building staircase) needs no link,
   because the runtime's climb rules handle it.
3. **External transports.** The object transports of RuneLite's Shortest Path plugin
   ([Skretzo/shortest-path](https://github.com/Skretzo/shortest-path), BSD 2-Clause), downloaded from
   a pinned commit (`e56f8ff`, November 2026) into a fresh temporary directory and only parsed, never run. Four
   files are read: `transports.tsv`, `teleportation_levers.tsv` (the King Black Dragon lever),
   `teleportation_portals.tsv` (the Stronghold of Security portals) and `agility_shortcuts.tsv`.
   Each file orders its requirement columns differently; they are read by the header's names. Any
   row option counts except the ones that do not move the player (Open, Close, Talk-to, Check-Fee,
   Peek...): doors swing open in the game instead. A loc whose objects appear in these rows is a
   candidate even without a transition verb (levers "Pull", portals "Use"). A two-way loc (a pipe,
   a gap) keeps one link per side, and the game takes the one leading away from the player. A row
   becomes a link when its object id is one of a candidate's states and its standing tile is within
   one tile of the loc's footprint; for a big cave with one row per standing tile, the row nearest
   the loc's own tile wins. `source: "shortest-path@e56f8ff"`. Quest, item, skill and varbit
   requirements are copied into `requires` and not enforced.

Trapdoors and manholes start closed ("Open"). Their open model is found, in order, from a multiloc
state, from a loc of the same name with an id 1 to 3 away that has "Climb-down" or "Close", or from
the object id of the external row at that tile. Each link records `openId` and the method
(`openMethod`).

Dungeon names are the section headings of the transport file (cleaned of notes and parentheticals),
taken from the nearest row that starts underground within 80 tiles of the arrival. They are
approximate: the Lumbridge cellar is "Lumbridge". The OSRS Wiki was **not** used in this pass (see
limitations).

## Hand-made links

`data/dungeon-links-overrides.json` holds links no data source gives, with `source: "hand (cache
locs, OSRS Wiki descriptions)"`. The OSRS Wiki pages describe these places but list no
coordinates, so the tiles come from the cache: the entrance and exit locs, matched by layout.

| Place | Entrance | Inside | Way out |
| --- | --- | --- | --- |
| Escape Caves | four caves 47175 (3260,3832; 3320,3830; 3282,3774; 3284,3807) | exits 47148, 47148, 47147, 47149 | back beside each cave |
| Callisto's Den | Cave Entrance 47140, 3291,3849 | exit 47122, 3358,10315 | Escape Caves (OSRS: one of three at random) |
| Vet'ion's Rest | Crevice 46995, 3221,3787 | exit 46925, 3294,10190 plane 1 | Escape Caves |
| Silk Chasm (Venenatis) | Cave Entrance 47077, 3321,3794 | exit 47000, 3422,10183 plane 2 | Escape Caves |
| Hunter's End (Artio) | Cave Entrance 47141, 3115,3676 | exit 47122, 1758,11531 | beside the entrance |
| Skeletal Tomb (Calvar'ion) | Memorial 46996, 3180,3683 | exit 46925, 1886,11534 plane 1 | beside the entrance |
| Web Chasm (Spindel) | Cave Entrance 47078, 3183,3744 | exit 47000, 1630,11527 plane 2 | beside the entrance |
| Tombs of Amascut | Entry 46089 (lobby) | Nexus; four paths, each puzzle room then boss room; tablet 46228 to the Wardens | Exit locs back to the Nexus, the Nexus exit to the lobby |
| Theatre of Blood | Theatre of Blood 32653, 3678,3216 | Maiden, then each Formidable passage (33113) to the next room; Xarpus's door to Verzik; the gate 32691 at the end of Verzik's entry corridor to the treasure room (OSRS spawns the real exit on the kill) | treasure room stairs |
| Chambers of Xeric | Chambers of Xeric 29777, 1232,3573 | the room templates (x 3264..3359, y 5120..5407) in a fixed order, sorted by row then column: every passage, hole or steps in a room leads to the next room's centre, the last room's to the Olm's chamber | the ropes 29995, 29996, 32543 |

OSRS builds a Chambers of Xeric raid from these templates at random; here they stand in one order.

**Entrances paired by loc id.** Of the entrances no data source covers, 25 have an exit loc whose id
is within a few of their own (2543 and 2542, 30177 and 30178...). Those whose place is known are
named (Kraken Cove, the Isle of Souls Dungeon, the Mourner Tunnels, the West Ardougne sewers, the
Ape Atoll Dungeon, the Wolf Den, the Lunar Isle mine, the Volcanic Mine); the others are pairs by id
and layout only, not checked one by one. Each leads in beside its exit and back out beside it. The scratch
generator is `tools/world-export/out/gen-overrides.cjs`.

Player-owned house portals are excluded: the house is an instance. The NPC spawn list has the
Wilderness bosses where they stood before the 2023 rework; `data/npc-spawn-overrides.json` moves
Callisto, Vet'ion and Venenatis into their lairs and adds Artio, Calvar'ion, Spindel and the Great Olm.

Wall locs (the Theatre of Blood passages, tomb doors, many crevices) that a link starts at are
exported as passages, not swinging doors; a passage on an unnamed loc takes its link's name.
Underground, a walkable tile without a tile model counts as floor when a floor decoration covers it
(Verzik Vitur's arena and the treasure room are laid that way) or, on an upper level, when any loc
stands on it: the chasm arenas lay their floor as loc models on level 2.

Hand names of map squares, where the transport file's headings name them badly ("Burthorpe" for
the King Black Dragon Lair), are in `data/dungeon-names.json`; they name the links into those
squares and the world map's dungeon views.

## Results

| | Count |
| --- | --- |
| Links | 1,885 |
| from the external transports | 1,520 |
| from cache pairs (entrance and exit) | 220 |
| by hand (`dungeon-links-overrides.json`) | 155 (some replace a pair or row) |
| Surface entrances (surface to underground) | 427 |
| Distinct dungeon names | 151 |
| Links with requirements recorded | 338 |
| Surface staircases and ladders left to the runtime's same-spot rule | 859 |
| Surface agility shortcuts and portals that lead to another surface spot (not dungeons) | 98 |
| Surface "down" candidates left unresolved | 171 |

**Hand checks.** All nine entrances of the plan are linked. Arrival tiles are the standing tile
from the transports; the in-game check is still to be done (see "Verification").

| Entrance | Surface tile | Arrival | Dungeon |
| --- | --- | --- | --- |
| Lumbridge castle cellar trapdoor | 3209,3216 | 3210,9616 | Lumbridge |
| Edgeville Dungeon trapdoor (closed, open id 1581) | 3097,3468 | 3096,9867 | Edgeville |
| Varrock Sewers manhole (closed, open id 882) | 3237,3458 | 3237,9858 | Varrock |
| Taverley Dungeon ladder | 2884,3397 | 2884,9798 | Taverley Dungeon |
| Lumbridge Swamp Caves | 3169,3172 | 3169,9571 | Lumbridge swamp |
| Asgarnian Ice Dungeon | 3008,3150 | 3009,9550 | Asgarnia Ice Dungeon |
| Dwarven Mine | 3019,3450 | 3018,9850 | Dwarven Mine |
| Stronghold of Security | 3081,3420 | **1859,5243** | Stronghold of Security (not +6400) |
| Kalphite Lair | 3227,3108 | **3483,9510 plane 2** | Kalphite Lair (not +6400) |

**Coverage.** Among surface entrances with a dungeon-like name (cave, trapdoor, manhole, hole,
tunnel, crevice, sewer entrance, entrance...) and a down/in verb, excluding plain ladders, about 75%
are linked and the rest are unresolved. The plan's 80% gate was defined over map-icon entrances,
which cannot be measured here (above), so the work continued; the unresolved list is the open work.

**Cross-check.** Of 75 entrances with both a cache pair and an external row, 64 (85%) agree within 5
tiles. That is the measure of how far the cache-only method can be trusted. The 11 that disagree
(the external tile wins by default, being in-game tested; the cache pair is kept for the record):

| Loc id, tile | External arrival | Cache pair | Probable reason (not verified) |
| --- | --- | --- | --- |
| 48722 1191,3411 | 1187,9763 | 1185,9808 | pair 45 tiles off: a different exit of the same cave |
| 4624 2899,3566 | 2205,4933 plane 1 | 2906,9969 | entrance does not follow +6400 (the pair is wrong) |
| 3757 2903,3644 | 2907,10019 | 2905,10036 | 17 tiles: neighbouring exit |
| 24249 3053,3383 | 3065,9951 | 3059,9778 | pair is wrong |
| 18987 / 18989 (Wilderness) | 3069,10255 / 3016,10249 | 3018,10249 / 3070,10256 | the two entrances' exits are swapped |
| 57908 3120,2489 | 3125,8880 | 3123,8881 plane 1 | plane differs only |
| 9728 3111,3126 | 3111,9525 | 3110,9531 | 6 tiles |
| 2616 3115,3357 | 3077,9771 | 3116,9754 | pair is wrong |
| 6481 3233,2888 | 3233,9313 | 3232,9294 | 19 tiles |
| 6497 3233,2897 | 2913,4954 plane 3 | 3232,9294 | entrance does not follow +6400 |

**Way back out.** 354 of 359 entrances have an exit within 100 tiles of their arrival. These five do
not and are listed here: two Observatory stairs (2438,3164 and 2458,3186) and three Wilderness
caverns (3231,3936, 3241,3949, 3231,3951).

## Unresolved

171 surface "down" candidates have no link and lead nowhere in the game: 166 with no exit near +6400
and no transport row, 5 ambiguous (2 to 4 exits close together). Candidates a hand link resolves, and
those whose transport row leads to another surface spot (agility shortcuts, minigame portals), are
not counted. The commonest: unnamed locs (38: mostly runecraft altar ruins, which the game's runecraft
code handles), rifts (24, one cluster at 3306..3315,3449..3454), lizardman lairs (18, all in the Lizardman
Settlement), ladders (14), trapdoors (7). Most of the rest are instance, minigame or quest
entrances (Death's Domain, clan halls, Mage Training Arena). The full list with ids and tiles is in
`tools/world-export/out/report.json` after a run.

**Trapdoors without an open model:** 29 closed hatches (19 of them on the surface) have no open
model that the cache or the transports identify. Those that have a link are exported as a plain
passage that climbs straight down; the rest have no link.

## Export size

The flood fill from the links' arrival squares, through neighbouring non-surface squares, would take
980 squares if any neighbour counted, which is past the guard (900). Requiring walkable ground on
both sides of the shared edge gives **360 squares** (largest area 154 squares around x 36..61,
y 146..160; about 330 MB at the surface's average of 0.9 MB per square). Minigames and instances
that the fill still reaches go into `excludeSquares` in `dungeon-links-overrides.json`.

## Limitations

- **Destinations come from external data.** 80% of the links are from Shortest Path, not the cache;
  the cache supplies the entrance, not the destination.
- **The OSRS Wiki was not consulted.** The cache and the transports resolved what they could; the
  unresolved entrances above would need the wiki's dungeon pages (names and coordinates). When it
  is used, credit it (CC BY-NC-SA, facts only) and record `source: "wiki:<Page title>"`.
- **Dungeon names are section headings**, some of them poor ("Lumbridge" for the castle cellar,
  "Varrock" for the sewers). `data/dungeon-links-overrides.json` is where to fix them.
- **Requirements are recorded, not enforced.** Every entrance works.
- **Arrival tiles are standing tiles**, not checked against the exported collision; the game places
  the player on the nearest walkable tile with a floor.

## Reproducing

```bash
npm run find-dungeon-links          # downloads transports.tsv (one request), writes data/dungeon-links.json
npm run find-dungeon-links -- --offline   # cache pairs only
```

The script is deterministic for a given cache and pinned commit. Hand fixes (exclusions, extra links,
excluded squares) live in `tools/world-export/data/dungeon-links-overrides.json`, which the script
reads and never overwrites.

## Verification

Done: `npm run typecheck`, `npm test` (unit tests for parsing, matching, pairing, hatches, link
validation, square selection, `planTransition`, the transition, the underground look, arrival, and
passages and hatches in `WorldInteractives`); gated tests that build real map squares from the
cache and check the Lumbridge, Edgeville and Stronghold entrances.

Not done: `npm run export-world` with the new default and the in-game walk through each entrance
(fade, arrival tile, dark fog, NPCs, the way back out). The export clears `public/world/` and takes a
long time, so it was left for the person who owns that data to run.
