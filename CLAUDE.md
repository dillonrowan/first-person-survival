# Notes for Claude

## Planned systems: multiplayer, protection prayers, freezes

The game will eventually get multiplayer, protection prayers and freeze spells (Bind, Entangle,
Ice Barrage and so on). Until then, OSRS boss rules that depend on them are deferred, not
dropped. Each boss file lists what it deferred in its top doc comment under "Deferred until the
game has them". Don't build hooks for these systems ahead of time.

When porting a new boss, add any rule it skips for these reasons to that doc comment and to the
list below.

### When multiplayer lands

Revisit these bosses:

- **Callisto and Artio** (`src/npc/Callisto.ts`): the swipe and the knockback splash onto
  players around the target.
- **Vet'ion and Calvar'ion** (`src/npc/Vetion.ts`): one lightning bolt per player in the chamber,
  up to seven, instead of the fixed 5; fewer hounds for groups. Check the wiki for the numbers.

These are single-player assumptions in the code:

- NPC fight hooks get one player: `NpcBehaviour.special(npc, attack, when, player)` in
  `src/npc/Npc.ts`, and each fight's `update` aggros on and targets that one player.
- Area attacks are resolved against one player: `GroundStrikes.update(dt, player)` and
  `FallingBricks.update(dt, player)`. They need to hit every player on the tiles.
- `src/main.ts` wires each boss to the local player: arena checks, the strike loop (damage,
  disarm, messages), and respawn clearing `groundStrikes`.
- An NPC's `xpLedger` (carried over by `Npcs.transform`) credits damage to the one player. Kill
  credit, drops and boss chests need a rule for who gets them.
- A boss fight resets when "the player" leaves its arena. With a group, it should reset only
  when everyone has left.

### When protection prayers land

- **Callisto and Artio**: Protect from Magic negates the knockback (a slow, dodgeable orb stands
  in for praying), Protect from Missiles blocks the crescents, and Protect from Melee halves the
  swipe.
- **Vet'ion and Calvar'ion**: Protect from Melee against the hounds' bites.
- **King Black Dragon** (`src/npc/KingBlackDragon.ts`): prayer against his melee and dragonfire.
  Check the wiki for how prayer combines with the anti-dragon shield and antifire.
- **Obor** (`src/npc/Obor.ts`): his club or throw odds come from the wiki's figures *with*
  Protect from Missiles on. Give the odds without prayer, or switch on the player's prayer.

### When freezes land

- **Callisto and Artio**: the roar breaks the boss free, and the first freeze on him always lands.
