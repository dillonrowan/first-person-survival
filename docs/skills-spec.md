# Skill tree & XP spec (draft, paused)

Started, then paused so physics could come first. Same tags as
[combat-movement-spec.md](combat-movement-spec.md). Nothing here is implemented yet. This project
does not use Dark Messiah's skill tree: its skills are the OSRS-style Melee, Defence, Ranged, Magic
and Hitpoints described in combat-movement-spec.md 5.2.

## Tree `[data: mm/scripts/mm_skills_infos.txt]`

Each skill has levels; buying a level costs the listed points and unlocks its modules.
`requires` lists skills of which **any one** must be owned (`a|b`). Level 0 modules are free.

| Skill | Requires | Level costs | Modules |
| --- | --- | --- | --- |
| combat | – | L0 0, L1 1, L2 2, L3 4 | L0 huge slash, fatality, parry, big slash; L1 chained slash, rush attack; L2 disarm, shield; L3 passthrough, trample, vertical (falling) attack |
| projectile | – | 1, 2, 4 | bow zoom; stability; bow reload |
| stamina | – | 1 | double sprint |
| focus | – | 1 | detect secret |
| critical_hit | combat \| projectile | 6, 8 | – |
| extra_damage | combat \| projectile | 6, 8, 10 | – |
| adrenaline | critical_hit \| extra_damage | 12 | adrenaline control |
| extra_health | stamina | 4, 7, 10 | – |
| poison_recovery | stamina | 6 | poison resistance |
| fast_metabolism | extra_health | 12 | fast metabolism |
| extra_mana | focus | 2, 5, 10 | – |
| mana_regeneration | extra_mana | 12 | mana recovery |
| stealth | focus | 2, 4, 10 | silent step; backstab; hide in shadow |
| backstab | stealth | 12 | backstab |
| mechanism | focus | 8 | lockpick, detect trap |
| magic_0 | – | 0 | wizard eye |
| magic_3 | magic_0 | 1 | flame arrow |
| magic_12 | magic_0 | 1 | telekinesis |
| magic_1 | magic_3 | 2 | fire trap |
| magic_5 | magic_3 | 3 | freeze |
| magic_6 | magic_5 \| magic_1 | 7 | fireball |
| magic_7 | magic_5 \| magic_1 | 7 | lightning bolt |
| magic_8 | magic_6 \| magic_7 | 10 | inferno |
| magic_9 | magic_12 | 3 | cure wounds |
| magic_11 | magic_12 | 3 | charm |
| magic_13 | magic_11 \| magic_9 | 7 | magic reflection |
| magic_15 | magic_13 | 10 | shrink |

`magic_2` (stone skin), `magic_4` (poison spray), `magic_10` (summon spider) and `magic_14` (drain)
are commented out in the shipped file.

## Stats per skill level `[data: player_basic.qct → skills; gh: 0x22415830 parser, 0x224191e0 apply]`

The parser reads `player_{strength,intelligence,dexterity,constitution}_{0..4}`:

| Index | 0 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| strength (extra_damage) | 0 | 0 | 2 | 3 | 6 |
| intelligence (extra_mana) | 0 | 2 | 4 | 7 | 10 |
| constitution (extra_health) | 0 | 5 | 6 | 7 | 8 |
| dexterity (critical_hit) | 0 | 1 | 3 | 6 | 10 |

- The apply function reads table index **skill level + 1** (the level getter returns −1 when the
  skill is not owned) `[gh 0x224191e0; index arithmetic inferred from field offsets]`.
- Max health = `max(base, constitution × 10)`; max mana = `max(base, intelligence × 10)` (constant
  10.0 at `0x2256ea44`). The base getters were not traced `[gh; unknown]`.
- Double sprint switches stamina max 9 → 12 and air 15 → 30 `[gh]`.
- Other knobs: `player_high_critical` 10 (crit chance bonus), `player_reduce_fall` 60 (% of fall
  damage taken), metabolism 0 / module 0.25 (health per second with fast metabolism), mana
  recovery 0.1 / module 0.7 per second, casting recovery 1.0 / module 0.5, adrenaline max 20 / 35,
  adrenaline gain ×1 / ×1.5 `[data]`.

## Points and XP

- Skill points come from map logic: the `GiveSkillPoints` input and the `mm_player_add_skillpoints`
  command add to the player's points (`player+0x2b3c`), play `xp_earned` and show
  "N skillpoints_earned" `[gh: 0x22458670]`. No kill-XP path was found.
- `xp_data` in `player_basic.qct` has an XP curve (level 1 at 300 … level 20 at 17,100) and points
  per level (3, 3, 4, 4, 5 … 12). Whether the shipped code reads it was not checked `[unknown]`.
- `skill_cost_1..4` = 1, 2, 4, 8 `[data]`; the tree's own costs above are what the menu uses
  `[inferred]`.
- Class presets (`inventory_data → l_fpp → warrior/wizard/assassin`) list starting skill levels.
