# OSRS skills spec

The non-combat skills, as built. Combat skills are in
[combat-movement-spec.md](combat-movement-spec.md) 5.2; the paused Dark Messiah skill-tree draft
is kept in [dm-skill-tree-draft.md](dm-skill-tree-draft.md). Values marked **[design]** are this
game's own choices; everything else follows OSRS.

## Skills

Woodcutting, Mining, Fishing, Cooking, Smithing, Crafting, Fletching, Herblore, Runecraft,
Thieving, Hunter, Farming and Slayer. Not built: Agility, Firemaking (logs still burn, see Fires),
Construction, Prayer (bones can be banked, not buried) and Sailing.

## Data sources

| Data | Source | Where |
| --- | --- | --- |
| Loc, NPC and item names, actions, models | OSRS cache (revision 242) | `tools/world-export/rs/` |
| Recipes (level, XP, ticks, materials, tools, facility) | wiki Bucket `recipe` | `data/wiki/recipes.json` |
| Gathering, thieving and hunter loot | wiki Bucket `dropsline` (non-combat rows) | `data/wiki/drops.json` |
| Level, XP, respawn and stun times, success charts | wiki templates `Woodcutting info`, `Mining info`, `Fishing info`, `Thieving info`, `Skilling success chart` | `data/wiki/skill-info.json` |
| Cooking burn charts | `Skilling success chart` on each cooked item's page | `data/wiki/cooking-charts.json` |
| Firemaking (the logs list only), Hunter, Farming rows | `Module:Skill calc/<Skill>` | `data/wiki/calc.json` |
| Fishing spot locations | `ObjectLocLine` rows on each fishing spot page (main map only) | `data/wiki/fishing-spots.json` |
| Slayer tasks and weights | `Module:SlayerConsts/MasterTables` | `data/wiki/slayer-masters.json` |
| Shops | Buckets `infobox_shop`, `storeline` | `data/wiki/shops.json` |
| Runecraft altars and ruins | `<Rune> Altar`, `Mysterious ruins` infoboxes | `data/wiki/altars.json` |
| Farming patch states and growth rates | RuneLite `PatchImplementation.java`, `Produce.java` (BSD-2-Clause) | `data/wiki/farming.json` |

`npm run fetch-wiki-skills` refreshes `data/wiki/`; `npm run export-skills` turns it into
`public/world/skills.json` and `shops.json` and writes a coverage report to
`data/skills-coverage.txt`.

## Formulas

- **Game tick**: 0.6 s (`TickClock`); all skilling, respawn and stall timers count ticks.
- **XP to reach level L**: `floor(sum over l < L of floor(l + 300 * 2^(l/7)) / 4)`; levels 1-99,
  XP capped at 200,000,000.
- **Success chance** at level L (1..99) from a chart's `low`/`high` (out of 256 at levels 1 and 99):
  `(floor(low * (99 - L) / 98 + high * (L - 1) / 98 + 0.5) + 1) / 256`, clamped to 0..1.
- **Loot rolls**: chance-1 rows always come; the rest is one weighted pick when the chances add up
  to at most 1, otherwise each row rolls on its own.
- **Woodcutting**: every attack swing of the wielded axe that lodges in a standing tree (see
  below) rolls the axe's chart series at the player's level, times
  `min(1, seconds since the last axe blow / (4 × 0.6))`. Trees with a despawn time
  fall when their timer (counting down for 4 ticks after each blow, back up otherwise) is spent;
  others fall with 1/8 per log (1/16 for the mature juniper).
- **Mining**: every blow of the wielded pickaxe that lands on a rock rolls the rock's chance times
  `min(1, seconds since the last blow / (interval × 0.6))`, the interval being the pickaxe's
  (bronze 8 ticks down to rune 3; dragon, 3rd age and infernal 3 with 1/6 chance of 2, crystal 3
  with 1/4 of 2, counted as their average); every ore empties the rock. Rune essence never empties
  and gives pure essence from Mining 30.
- **Fishing**: the spot's tool must be wielded. A left click on a spot with one of its tools
  wielded fishes with the spot's option for that tool (one the player can use first, when the tool
  serves two). A full inventory does not stop fishing: the catch falls at the player's feet. With a rod, a cast (a click with the crosshair on
  the spot) lands after 0.7 s; then every 3 s (the OSRS 5-tick roll) catches the player has the level for are
  tried highest level first, and the first success is a bite, which lasts 1.1 s. A click in it
  hooks the fish and starts the reeling minigame; landing it gives the catch, its XP and uses one
  bait. With a net, pot or harpoon there is no line or minigame: each click (or, held, one after
  another) is a 1.4 s scoop or strike through the spot that rolls the catches once, the same way.
- **Cooking**: a failed roll on the item's chart (range series on a range, fire series on a fire)
  burns it. Cache recipes whose output is a burnt item are not offered. **Smithing**: iron bars succeed half the time.
- **Fires**: any log lights at once, for no XP, exactly where the player stands (the player does not
  move); fires last 100-199 ticks times `1 + (L - 1) / 30`, L being the Woodcutting level of the
  tree the logs come from (1 for logs from no tree), and leave ashes.
- **Runecraft**: one action binds all essence: `n * (1 + multiples reached)` runes.
- **Thieving**: a pickpocket takes 2 ticks; failure deals the wiki damage, stuns for its time and
  alerts an attackable NPC (`Npc.becomeAlerted`), which then fights the player. No hand is drawn:
  the first-person view plays Blender-keyed head clips (`tools/blender/pickpocket.py` →
  `src/skills/PickpocketClips.ts`, added through `CameraRig`'s offset): `reach` glances down and
  leans in during the attempt, then `pocket` looks away innocently or `caught` jerks the view back.
  The clips' `stow` channel lowers the held weapon or tool out of view for the attempt and raises
  it as the outcome clip ends (`WeaponView.setLowered`).
- **Hunter**: up to `1 + floor(level / 20)` traps (max 5). Each tick a creature within 3 tiles of
  a set trap is caught with `successChance / 8`.

## [design] values

| Value | Choice |
| --- | --- |
| Named rarities | Common 1/8, Uncommon 1/50, Rare 1/300, Very rare 1/3000, Varies and Unknown 1/128 |
| Fishing block without a chart | chance `{low 48, high 256}` |
| Hunter creature without a chart | chance `{low 40, high 200}` |
| Trap springs empty | 1/200 per tick; an unchecked trap collapses after 100 ticks |
| Caught creature away | 50 ticks |
| Farming weeds | one regrows every 5 real minutes, up to 3; no disease, compost or payment |
| Herb, allotment, hops lives | 3, a harvest loses one with chance 1/3; flowers are picked once |
| Fruit and berries regrow | 1 per 40 minutes (fruit trees, 6 max) or 20 minutes (bushes, 4 max) |
| Grown farm trees | one log, then the patch is empty |
| Slayer task amounts | Turael and Spria 15-50, Mazchna 30-70, Vannaka 40-100, Chaeldar 70-130, Konar 50-120, Nieve and Steve 110-170, Duradel 130-200, Krystilia 50-100 |
| Slayer XP when the wiki has none | the monster's hitpoints |
| NPC respawn | 30 s after the body is gone |
| Shops | an unstocked item sells for 40% of its cache value; stock moves one toward its base every restock time |
| Moving away | a job stops when the player is 0.75 tiles from where it started |
| Woodcutting by swinging | there is no chopping stroke: the axe's attack swings chop. A swing's attack ray stops on a standing tree's trunk (an upright cylinder measured from each placed tree's model when its map square loads: the slice outline nearest the footprint's middle at 0.6-1.4 tiles above the ground, medians of centre and radius; `src/world/TrunkSlice.ts`), on a grown farming tree, or on a rock's box. The blade lodges there: the view holds the swing's pose whose blade tip points along the ray that met the trunk, plays the Blender-made lodge clip (bite, held fast, worked loose, wrenched out; 0.5 s, `tools/blender/axe_lodge.py`) and blends back to the guard; clicks meanwhile become strikes after it. A lodged axe rolls for a log (see Woodcutting); any other weapon only shakes the tree; a swing into a rock gathers nothing |
| Mining by hand | a left click on a rock under the crosshair with a pickaxe wielded is never a weapon attack: farther than 2.5 tiles from the eye it logs "You need to get closer to the rock."; within 2.5 tiles, with no attack under way, starts an overhead pickaxe strike of 1.15 s that lands at 0.55; the blow lands only on that rock, and only if the crosshair is still on it; holding the button, or a click during a strike, chains the next; a strike is never cut short, and a click on another rock meanwhile is ignored; the view blends into and out of the strike over 0.15 s. A pickaxe blow is scaled by its interval |
| Fishing spots | placed by the game at the wiki's tiles with a Blender model (`tools/blender/fishing.py`: ripples and bubbles); the cache's spot NPCs are not used; fishing only within 2 tiles of the spot; nibbles on half the rolls that bring no bite |
| Reeling | zone width `0.16 + 0.22 c` and fish speed `1.1 - 0.6 c` (c = the catch's OSRS success chance); the zone moves at 1.1 bar/s while the button is held and 0.9 bar/s back when let go, reaching that speed within about 0.1 s; the meter starts at 30%, fills 28%/s with the fish in the zone and drains 20%/s otherwise; 25 s limit |
| Fishing tools | rods, nets, harpoons and pots can be wielded (the cache cannot); those the cache does not make wieldable never attack or block; rods are held as a Blender-made rod (`tools/blender/fishing.py`: spinning rod, fly rod), the others as their inventory model; only a rod has a line and bobber |
| Fishing with a full inventory | the fishing goes on and each catch falls to the ground at the player's feet |
| Fire length by logs | the OSRS fire time (100-199 ticks) times `1 + (L - 1) / 30` for logs from a level-L tree |
| Making | the first item of a make job (cooking, smithing…) comes on the next tick, then one per the recipe's ticks |
| Woodcutting with a full inventory | the chopping goes on and each log falls to the ground at the player's feet |
| Fires | the cache fire (loc 26185) with its own animation (sequence 475), baked into its model by `export-skills` and played by `src/world/LocAnimations.ts`; other placed locs with a cache animation play theirs too |
| Tree and rock reactions | Blender-keyed clips (`tools/blender/loc_reactions.py` writes `src/world/LocReactionClips.ts`): a blow shudders a tree or jolts a rock away from the player, the last log topples the tree, the last ore crumbles the rock |
