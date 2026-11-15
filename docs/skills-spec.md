# OSRS skills spec

The non-combat skills, as built. Combat skills are in
[combat-movement-spec.md](combat-movement-spec.md) 5.2; the paused Dark Messiah skill-tree draft
is kept in [dm-skill-tree-draft.md](dm-skill-tree-draft.md). Values marked **[design]** are this
game's own choices; everything else follows OSRS.

## Skills

Woodcutting, Mining, Fishing, Cooking, Firemaking, Smithing, Crafting, Fletching, Herblore,
Runecraft, Thieving, Hunter, Farming, Slayer and Construction. Not built: Agility, Prayer (bones
can be banked, not buried) and Sailing.

## Data sources

| Data | Source | Where |
| --- | --- | --- |
| Loc, NPC and item names, actions, models | OSRS cache (revision 242) | `tools/world-export/rs/` |
| Recipes (level, XP, ticks, materials, tools, facility) | wiki Bucket `recipe` | `data/wiki/recipes.json` |
| Gathering, thieving and hunter loot | wiki Bucket `dropsline` (non-combat rows) | `data/wiki/drops.json` |
| Level, XP, respawn and stun times, success charts | wiki templates `Woodcutting info`, `Mining info`, `Fishing info`, `Thieving info`, `Infobox Construction`, `Skilling success chart` | `data/wiki/skill-info.json` |
| Cooking burn charts | `Skilling success chart` on each cooked item's page | `data/wiki/cooking-charts.json` |
| Firemaking, Hunter, Farming rows | `Module:Skill calc/<Skill>` | `data/wiki/calc.json` |
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
- **Woodcutting**: a roll every 4 ticks with the best usable axe's chart series. Trees with a
  despawn time fall when their timer (counting down while chopped, back up while not) is spent;
  others fall with 1/8 per log (1/16 for the mature juniper).
- **Mining**: a roll per pickaxe interval (bronze 8 ticks down to rune 3; dragon, 3rd age and
  infernal 3 with 1/6 chance of 2; crystal 3 with 1/4 of 2); every ore empties the rock. Rune
  essence never empties and gives pure essence from Mining 30.
- **Fishing**: a roll every 5 ticks; catches the player has the level for are tried highest level
  first, the first success is the catch; one bait per catch.
- **Cooking**: a failed roll on the item's chart (range series on a range, fire series on a fire)
  burns it. **Smithing**: iron bars succeed half the time.
- **Firemaking**: a roll every 4 ticks with the Logs chart (65, 513) for every log; fires last
  100-199 ticks and leave ashes.
- **Runecraft**: one action binds all essence: `n * (1 + multiples reached)` runes.
- **Thieving**: a pickpocket takes 2 ticks; failure deals the wiki damage and stuns for its time.
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
| House | fixed template rooms of square (29,110): Garden, Parlour, Kitchen, Dining room, Workshop, Bedroom; any hotspot offers Next room, the garden centrepiece is the exit |
| Sawmill planks | Logs + 100, Oak + 250, Teak + 500, Mahogany + 1,500 coins; instant, no XP |
| Shops | an unstocked item sells for 40% of its cache value; stock moves one toward its base every restock time |
| Moving away | a job stops when the player is 0.75 tiles from where it started |
