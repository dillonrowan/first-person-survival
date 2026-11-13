# Combat & movement behaviour spec

This is the only document the implementation reads. It describes behaviour in plain language
(formulas, constants, state machines). It holds no decompiled code and no game assets.

## Tags

Every value carries one of these tags:

| Tag | Meaning |
| --- | --- |
| `[data: file → key]` | Read from a shipped data file (KeyValues inside the game's VPKs). |
| `[cvar: name @ address]` | ConVar default, read from the constructor's arguments in `server.dll` or `client.dll`. The address is the ConVar object. |
| `[ev: id]` | Behaviour read from a REA/Ghidra decompile of `server.dll` (SHA-256 `0d416feb…3273d`). The evidence bundle has the full records. |
| `[gh: address]` | Behaviour read from a Ghidra 12.1.4 headless decompile of the same `server.dll`, at a function Ghidra's auto-analysis had left undefined (reached only through a vtable), created by a script at that address. |
| `[source]` | Standard Source-engine behaviour (SDK 2006) that the cvars plug into. |
| `[inferred]` | Meaning inferred from a cvar or key name plus its value, not from code. |
| `[design]` | Nothing observed covers it: our own choice. |

Evidence IDs used below:

| Short | Full ID | What it shows |
| --- | --- | --- |
| E-STR | `ev_1ee9472337af35d9aecf93f37f73ff0b5cdf7f167ded24bd94661ddf2fc88d72` | bigslash cvar strings |
| E-SPD | `ev_994464cd7408e6b231983f5ce67c4db53e3d3369736b89fa346ee6258a6e61b9` | movement state → speed cvar |
| E-STATE | `ev_0e2cbc7458ee63fd677966ea638b0ba7cf8fa3c84ad985ac0af88e94d1f81d1a` | buttons → movement state, megasprint gate |
| E-STAM | `ev_e3496d8f69633f003d1cf18ac302b05fe0fcd82c8210e872a636f2d4d7a9ff47` | megasprint stamina gate and drain |
| E-MELEE | `ev_08dc0ffdec49e1bba572ab444ec0babe90da121348b268b2133e477e0bb6325e` | quick-strike chain and charge threshold |
| E-BACK | `ev_0e3a4b1536f05e06c2b2d9fa4d8161aedd1c35b0a2f477155989adacf87a7b4d` | backstab / impale state machine |

## 1. Units and simulation

- **Length.** 1 game unit (u) = `1.25 / 61.065` tiles ≈ **0.02047 tiles**, so 1 tile ≈ 48.85 u. This
  maps the player's eye offset `mm_player_view_offset_z = 61.065` `[cvar @ server/client]` onto our
  1.25-tile eye height `[design]`.
- **Time.** Source servers tick at 66.67 Hz (15 ms) by default `[source]`. Our simulation may use the
  frame step. Where a formula below multiplies by frametime, use the actual step.
- **Conversion table** (u → tiles):

| u | tiles | used for |
| --- | --- | --- |
| 30 | 0.61 | duck back speed; air wish-speed cap |
| 40 | 0.82 | NPC red zone (too close) |
| 50 | 1.02 | `sv_stopspeed`; duck speed |
| 60 | 1.23 | back speed |
| 80 | 1.64 | dagger reach; NPC ideal distance |
| 100 | 2.05 | walk speed; sword reach; kick reach |
| 120 | 2.46 | orc-sword reach; NPC max melee distance |
| 180 | 3.68 | run speed (default) |
| 240 | 4.91 | NPC zig-zag minimum distance |
| 270 | 5.53 | megasprint speed |
| 320 | 6.55 | `sv_maxspeed` cap |
| 600 | 12.28 | `sv_gravity` (u/s²) |

## 2. Movement

### 2.1 Ground and air physics `[source]`

Constants:

| Constant | Value |
| --- | --- |
| `sv_friction` | **4** `[cvar @ 0x227f62f8]` |
| `sv_stopspeed` | **50** `[cvar @ 0x227f5f08]` |
| `sv_accelerate` | **10** `[cvar @ 0x227f6100]` |
| `sv_airaccelerate` | **10** `[cvar @ 0x227f6148]` |
| `sv_maxspeed` | **320** `[cvar @ 0x227f60b8]` |
| `sv_gravity` | **600** `[cvar @ 0x227f5ec0]` |
| `sv_stepsize` | **18** `[cvar @ 0x227f63d0]` |

Behaviour each tick:
- **Friction** (on ground only): `drop = max(speed, stopspeed) × friction × dt`;
  `speed' = max(0, speed − drop)`.
- **Accelerate** (on ground): `add = wishspeed − dot(vel, wishdir)`. If `add > 0`, add
  `min(add, accelerate × dt × wishspeed)` along `wishdir`.
- **Air accelerate:** same as Accelerate, but the wish speed in the `add` term is capped at 30 u
  `[source]`, and the step uses the uncapped wish speed. This gives air strafing without large air
  speed gains.
- **Collision:** remove the component of velocity going into the blocking surface (clip velocity).

### 2.2 Speed by movement state

The game folds the walk, sprint and crouch modifiers plus the held direction keys into a movement
state (E-STATE). Each state then reads one speed cvar (E-SPD). The groups are:

| Group | When | Forward | Fwd+side | Side | Back | Back+side |
| --- | --- | --- | --- | --- | --- | --- |
| **Run** (default) | no modifier held | 180 `hl2_sprintspeed` | 180 `hl2_sprintforwardsidespeed` | 180 `hl2_sprintsidespeed` | 60 `hl2_sprintbackspeed` | 80 `hl2_walkforwardsidespeed` |
| **Walk** | walk key held (or forced) | 100 `hl2_walkspeed` | 80 `hl2_walkforwardsidespeed` | 100 `hl2_walksidespeed` | 60 `hl2_sprintbackspeed` | 80 `hl2_walkforwardsidespeed` |
| **Crouch** | ducking (overrides the others) | 50 `hl2_duckspeed` | 60 `hl2_duckforwardsidespeed` | 45 `hl2_ducksidespeed` | 30 `hl2_duckbackspeed` | 60 `hl2_duckbacksidespeed` |
| **Megasprint** | sprint key held and the stamina gate passes (2.3) | 270 `hl2_megasprintspeed` | 180 | 180 | 60 | 80 |

Notes:
- The "Run" group's cvars are named `sprint`, but the code uses it as the default state. That is
  why ordinary running is 180 u and the Shift sprint is 270 u (E-STATE, E-SPD).
- Megasprint applies only straight forward. Diagonals and other directions fall back to the run
  values (E-STATE).
- Being in water or on a ladder (one special move type) returns "no override" (E-SPD).
- `hl2_normspeed = 60` exists but is read elsewhere, by an NPC/companion path `[inferred]`.
- Diagonal forward+side is the same speed as forward while running. While walking it is slower
  (80) — this comes straight from the table above.

In tiles/s: run 3.68, walk 2.05, megasprint 5.53, back 1.23, crouch 1.02.

### 2.3 Megasprint and stamina

Constants:

| Constant | Value |
| --- | --- |
| `mm_player_stamina_megasprint_cost_per_second` | **2** `[cvar @ 0x2282ce80 parent]` |
| `mm_player_stamina_needed_for_kick` | **3.0** `[cvar]` |

Behaviour (E-STAM, E-STATE):
- **Start gate.** Megasprint may start only if stamina is greater than the megasprint animation's
  duration × the cost per second. Stamina must also be at least `stamina_needed_for_kick` (3).
- **Drain.** While megasprinting, stamina drops by `cost × dt`, clamped at 0. At 0 the sprint
  ends.
- **Stamina maximum and regeneration** (superseded by 16.1): `player_basic.qct → skills` sets
  `player_stamina_base_max` **9** (12 with the "double sprint" skill) and regenerates
  `player_stamina_add_value` 0.06 every `player_stamina_add_interval` 0.12 s, i.e. **0.5 per second**
  `[data; parser gh 0x22415830]`.

### 2.4 Jump, crouch, lean

| Item | Value |
| --- | --- |
| Jump | See 16.2: 160 u/s take-off plus a held-button boost for 0.3 s `[gh: 0x223f2fc0]` |
| Crouch eye offset | `arx_player_view_duck_offset_z` **35 u** → 0.72 tiles. Our crouched eye: 0.8 tiles `[design]` |
| Crouch interpolation | `arx_speed_interp_to_crouch` **2.75** `[cvar]` (rate) |
| Lean | `cl_leanangle 15°`, `cl_leanmove 25 u`, `cl_leanspeed 10` `[cvar client]` |
| Step height | 18 u → 0.37 tiles |

### 2.5 View effects (client) `[cvar client]`

| Effect | Values |
| --- | --- |
| Head bob | `cl_bob 0.002`, `cl_bobcycle 0.8`, `cl_bobup 0.5`; Source bob formula `[source]` |
| Roll on ground | `mm_player_coeff_roll_on_ground 0.3` |
| View punch on taking a hit | `mm_player_punch_factor 0.4`; while parrying `0.15` `[cvar server]` |
| Look damping during attacks | the `player_interp_Firstturn*` family. Turn-rate multipliers: yaw 0.707 (idle 0.4, parry 0.8); pitch 0.4 (idle 0, parry 0.8). `player_interp_FirstInterp 20` `[inferred: multipliers on mouse turn while an attack plays]` |

## 3. Melee input

### 3.1 Tap vs hold (E-MELEE)

- **Hold to charge.** Pressing attack records the press time. If the button is still held after
  the charge threshold, the player enters **power-attack charge** (bigslash idle).
- **Charge threshold.**
  - `mm_player_mintime_to_bigslash` is **400** `[cvar]`. Daggers use **200**.
  - The code compares it as `threshold × frametime × 0.06`, which is about **0.36 s** at 66.67 Hz
    (0.18 s for daggers).
  - We use 0.36 s and 0.18 s directly.
- **Releasing the charge** plays the power attack in the chosen direction (3.2).
- **Tap.** Releasing before the threshold plays the next quick strike.
- **Chaining.**
  - While a quick strike plays, a new press is buffered only once the strike's animation passes
    **60%** of its cycle (`mm_player_cycle_fastattack_end 0.6`).
  - A buffered press chains into the next strike.
  - With no buffered press, the attack returns to idle.
- **Strike order.** A combo counter steps 0→1→2→3→4→5→0, and each step plays the next quick
  strike: A, B, C, D, E (sword); A–E (daggers); A–D (staff). The counter wraps around.
- **Walk/run blend.** `mm_player_mintime_to_walkrun 0.2` s `[cvar]` is read by the attack state
  `[inferred]`.

### 3.2 Power-attack direction (superseded by 17.1)

The movement keys held **when the charge starts** pick the variant: left → L, else right → R,
else forward → T, else back → B, else the default `[gh: 0x22449a50 sword, 0x2243f720 daggers,
0x22444c80 staff]`.

### 3.3 Special attacks

- **Rush** (`layer_combo_*_rush`): a power attack released during megasprint `[inferred]`.
  - It has two hit events. Each carries `pushplayercoeff 500`; the second is 200 for daggers. This
    is a forward lunge impulse on the player in u/s `[inferred]`.
  - `alwayspush 1`.
- **Falling** (`layer_combo_*_fall_out`):
  - Triggers when attacking while falling faster than `mm_player_speed_to_active_fall` **125 u/s**
    `[cvar]`.
  - Downward impact (Z −1), `chancetofall 0.6`.
  - `PlayerVerticalAttackHeightToMakeNPCFall 50` `[data: mm_game_settings → ai]`.
- **Trample** (`layer_combo_*_trample`): HitPow 30 and `chancetofall 0.9`, used on a knocked-down NPC
  `[inferred]`.
- **Huge** (`layer_combo_*_huge`):
  - Adrenaline-full power attack: HitPow 30, beheads `[inferred]`.
  - Full adrenaline triggers slow motion. The `slowtime_*` keys are present but commented out in
    the shipped data.

## 4. Hit detection

| Item | Value | Tag |
| --- | --- | --- |
| Weapon reach | `rangeattack` per weapon (table 9) | `[data]` |
| Search hull | `player_search_hull 10 u` | `[cvar]` |
| NPC cone | `player_search_cone_npc 0.05` | `[cvar]`, `[inferred: dot-product slack]` |
| Other-object cone | `player_search_cone_other 0.2` | `[cvar]`, `[inferred]` |
| Bone attack | `mm_player_boneattack_valmin 10`, `valmax 100` | `[inferred: hit pass traces along the weapon]` |

Our implementation `[design]`:
- Sweep an arc over the attack's active window, from the impact direction's side to the opposite
  side, at radius = reach.
- Hit a target if its cylinder intersects the arc segment and no wall lies between the eye and the
  hit point.
- Each target is hit at most once per swing.

## 5. Damage

### 5.1 Inputs

| Input | Source |
| --- | --- |
| Weapon damage | `WDmg` `[data: weapon qct]` |
| Move multiplier | `HitPow` `[data: first_basic.qct per move]` |
| Piercing (armour bypass) | `WPiercing` `[data]` |
| Base armour with no armour worn | `armordefenderbase 0.01` `[data: first_basic → entity_data]` |
| NPC hitbox multipliers | head ×3, chest ×0.5, stomach ×1, limbs ×1.25 `[data: npc_guard.qct → hitboxes_modifier]` |
| Unaware NPC | ×3 damage (`mul_damages_Npc_Not_alerted 3`) `[data: mm_game_settings → ai]` |
| Difficulty | easy NPC damage ×1.2, player ×0.8; hard 0.8 / 1.2; hardcore 0.6 / 1.4 `[data: ai.Difficulty*]` |

NPC health is `npc_health` (guard 200) `[data]`. In this project it scales from `combatLevel`
`[design]`.

### 5.2 Formula

The arithmetic combining these was not found. What the search established:
- The weapon parser stores `WPiercing` at weapon offset `0x11a8` (default 0.25 when missing),
  `rangeattack` at `0x1130` (default 80), `parry_cos` at `0x116c`, `stunmultiplicator` at `0x1148`
  and `speed_attack` at `0x11b4` `[gh: 0x224d7320]`. `WCritHit` defaults to 15.
- The player parser stores `armordefenderbase` at player offset `0x22fc` `[gh: 0x22415830]`.
- The only direct x87 readers of the piercing and armour fields are unused getters. The damage code
  reaches them through virtual calls, which static scanning could not follow.

Our formula `[design]`:

`damage = WDmg × HitPow × strengthScale × hitbox × (1 − armour × (1 − WPiercing)) × awarenessMul × difficultyMul`

We use `strengthScale = 10`, so a long-sword quick strike (3 × 0.7 × 10) does 21 and a power slash
does 45, against a guard's 200 health.

### 5.3 Reaction size

Section 15 adds what each reaction looks like and how long it lasts.

Thresholds on damage as a fraction of maximum health `[cvar/inferred: hit-size thresholds 0.05, 0.2, 0.3, 0.4]`:

| Fraction | Reaction |
| --- | --- |
| below 0.05 | none |
| up to 0.2 | flinch |
| up to 0.3 | stagger |
| up to 0.4 | push, if the move's `push` flag is set |
| above 0.4 | knockdown roll, using the move's `chancetofall` |

Other rules:
- **Stun.** The move's `chancetostun` × `GlobalStunChanceMultiplier 1.5` × weapon
  `stunmultiplicator` gives the stun roll. NPC `stunned_duration` is 4 s `[data]`.
- **Push on the player.** NPC hits push the player at `PlayerPushOnHit 250` u/s (5.1 tiles/s)
  `[data: ai]`.
- **Damage flash.** Red fade for big and huge hits: 1 s time, 0.1 s hold, red 128, alpha 128
  `[cvar: mm_player_damage_*_red_fade_*]`.

## 6. Block and parry

| Item | Value | Tag |
| --- | --- | --- |
| Parry factor | `parry_cos` per weapon: swords 0.5, daggers 0.2, staves 0.7, shields 0.7. The data comment says "1 always parries, 0 never", but the code does the opposite (see below) | `[data]` |
| Breaking the guard | moves with `breakparade 1` break a parry. That is every power attack, trample and huge attack | `[data]` |
| Player parry break skill | `break_parry_chance 0.1` (player vs NPC) | `[data: player]` |
| NPC stamina costs | parry 1, block 3, dodge 4, stun 10 | `[data: ai.Stamina_*]` |
| NPC starting stamina | guard 50 | `[data]` |
| Wounded NPCs | break-parry chance 0.5, block-break 0.8 | `[data: ai.Wounded*]` |
| View punch while parrying | 0.15 instead of 0.4 | `[cvar]` |
| Blur when your parry is broken | `mm_player_blur_time_when_break_parry 2` s | `[cvar]` |

The parry angle check `[gh: 0x223a83a0]`:
- Take the dot product of the defender's forward vector with the incoming attack direction.
- A hit can be parried only if the attack comes from the front (dot < 0) and `|dot| ≥ parry_cos`.
  In other words, the angle between the defender's facing and the attacker is at most
  `acos(parry_cos)`.
- The factor comes from the held weapon first. If there is no weapon, it comes from the shield, and
  failing both, from a default on the character.
- Half-angles of the cone:

  | Weapon | `parry_cos` | Half-angle |
  | --- | --- | --- |
  | Swords | 0.5 | ±60° |
  | Daggers | 0.2 | ±78° |
  | Staves and shields | 0.7 | ±46° |

- So a larger `parry_cos` is a stricter, narrower cone. This passes the angle test only: block
  input, stamina and guard-break rules apply on top.

Our design `[design]`:
- **Parry** = block pressed within 0.25 s before the hit lands. It negates the hit fully and
  staggers the attacker.
- **Block** = holding block. It reduces damage by 80% and costs 1 player stamina per hit.

## 7. Kick

| Item | Value | Tag |
| --- | --- | --- |
| Reach | `mm_player_maxdist_for_kick 100 u` (2.05 tiles) | `[cvar]` |
| Stamina | needs 3.0 (`mm_player_stamina_needed_for_kick`); costs `stamina_kick_npc 3` on an NPC hit, `stamina_kick_all 1` otherwise | `[data: player]` |
| Damage | `kick_damage 1` | `[data]` |
| Knockdown | `KnockedDownTimeKick 2.0` s | `[data: ai]` |
| NPC dodge | first kick 0.2 chance; each later kick adds +0.3 | `[data: npc_guard → dodge_on_kick_*]` |

The kick hit event `[gh: 0x2242e8b0]` works like this:
1. On the kick animation's hit event, trace from the eye along the view direction for
   `maxdist_for_kick` (100 u).
2. **Direct hit.** A hit counts if the hit point is within **40 u** vertically of the player.
   - The target gets kick-type damage (the same damage flag for NPCs and props).
   - It also gets a push force along the view direction. The force is a stored player kick-force
     value scaled by a function of the target's mass. NPCs and physics props use different stored
     values.
   - The "Player_Kick" sound plays.
3. **Miss.** The trace is retried **6 times**, lowering its start by **10 u** each time (down to
   60 u below eye level). This lets a kick connect with crouched or shorter targets.
   - Each target is hit at most once per kick.
4. The mass scaling plausibly uses the `all` section of `mm_game_settings.txt`
   `[inferred]`:
   - force 1000 to 7000
   - weight 1 to 100

Pitch bands `[cvar; mapping inferred]`:
- The minimum angles below the horizon are 30 ("very high"), 40 ("high"), 50 ("medium") and 65
  ("low").
- We use them as bands on the player's pitch to pick the kick height. Higher kicks push more
  horizontally, low kicks push more down.

Push `[design]`. Superseded by section 15.2, which pushes as far as the long hit animation:
- 6 tiles/s horizontally plus 2 tiles/s up for medium and high kicks.
- 4 tiles/s horizontally plus 0 up for low kicks.
- Very high: 7 + 3.

Kicked NPCs:
- **Ledge falls.** NPCs fall from ledges when the void behind them is deeper than
  `HeightConsideredFalling 200 u`. The game probes `DistTestVoidWhilePushNPC 170 u` behind and
  waits `TimeBeforeFalling 0.2` s `[data: ai]`.
- **Wall slams.** A kicked NPC that hits a wall takes `PhysicsMediumDamages 5` `[design: reuse of
  the physics damage table]`.

## 8. Adrenaline

| Item | Value | Tag |
| --- | --- | --- |
| Gain | each move's `adrenalineadd` when it hits (quick 0.5, power 1–3, versus 6, backstab 3) | `[data]` |
| Decay | a timer adds up frame time. Each time it reaches `player_time_to_remove_adrenaline` (20 s), it resets and adrenaline drops by `player_value_remove_from_adrenaline` (1.0), floored at 0. That is **1 point per 20 s**. Whether gaining adrenaline resets this timer was not established | `[gh: 0x22429280, player think]` |
| Maximum | not in the data | `[design]` |
| When full | the next power attack becomes the "huge" variant (HitPow 30, decapitates) | `[inferred from layer names]` |

We use a maximum of 20 `[design]`. The adrenaline unlock is skill-gated in the game
(`adrenaline_control` module); here it is always on `[design]`.

## 9. Player dodge

| Item | Value | Tag |
| --- | --- | --- |
| Push | `mm_player_dodgepushfactor 1200`, `mm_player_dodgepushz 120` | `[cvar]` |
| Friction during dodge | `mm_player_dodgefriction 4` | `[cvar]` |
| Minimum speed | `mm_player_dodgeminspeed 5` | `[cvar]` |
| Trigger window | `mmplayer_time_for_dodge 1` | `[cvar]` |

How the game triggers it isn't known: the trigger cvar is never read through a direct pointer in
`server.dll`. We take 1200 as a force over the ~0.1 s impulse, about 120 u/s → 2.5 tiles/s.

Our design `[design]`:
- Double-tap a direction within 0.25 s (`player_squad_double_tap_time 0.25`) for a 5 tiles/s
  impulse in that direction plus a small hop.
- Costs 2 stamina.

## 10. NPC melee AI

### 10.1 Parameters

| Item | Value | Tag |
| --- | --- | --- |
| Attack rhythm | "cool" mode: 2.0–3.5 s between attacks. "Berserker" mode: 0–1.0 s. The mode switches every 10–15 s, or goes berserker if the player hasn't attacked for 2 s | `[data: npc_guard]` |
| Combat distances | red (too close) 40 u, green (ideal) 80 u, yellow (max) 120 u | `[data: npc_guard]` |
| Zig-zag approach | used beyond 240 u (`ZigZagNPCMinDist`), steering ±35° (`ZigZagNPCSteeringAngle`) while the player's cone is 15°. Below 240 u NPCs don't zig-zag or dodge or block incoming attacks | `[data: ai]` |
| Dodge | base chance 0.5 (`base_dodge_chance`); at most one per `DodgeDelay 15` s; preventive dodge chance 0.2 | `[data]` |
| Breaking the player's block | if the player has been blocking less than `PlayerParryTimeToBreakIt 5` s, NPCs pick attacks that don't break parries; after that they try guard-breaks or dodge-strikes | `[data: ai]` |
| Strike reach | per NPC attack (guard: left 50 u, right 60 u) | `[data: npc_guard → combatmovedatas]` |
| Reaction delays | hearing 1 s, sight 0 s (0.3× when under 500 u) | `[data: ai]` |
| Flee | below 20% health (`life_toflee`); stops at 10% | `[data]` |
| Health regen | 0.25 per second | `[data]` |
| Help calls | `call4helpdist 700 u` | `[data]` |
| Losing the player | after 3 s (`TimeUntilNPCLoosePlayer`) | `[data]` |

### 10.2 State machine `[design, from the parameters above]`

Section 15.3 replaces the movement part with decompiled behaviour.

```
idle ──(hurt | hostile & sees player within sight range)──▶ alert
alert ──▶ approach (zig-zag while > 4.9 tiles)
approach ──(dist ≤ yellow zone)──▶ windup (telegraph 0.4 s) ──▶ strike (active 0.15 s) ──▶ recover
recover ──(rhythm timer)──▶ approach | windup
any ──(player swing incoming & dist < yellow & roll < dodge chance & dodge ready)──▶ dodge
any ──(hit, reaction ≥ stagger)──▶ stunned (0.4–1.0 s) / knocked down (2 s)
any ──(health ≤ 0)──▶ dead
```

## 11. Death and respawn

`mm_player_death_fadeout_duration 4` s `[cvar]`, then respawn (`mm_player_respawn_after_death 1`).

## 12. Per-attack table (sword, no shield) `[data: first_basic.qct]`

| Move | HitPow | Impact (X,Y,Z) | Adrenaline | Push / always | Breaks parry | Stun | Fall | Player lunge |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Quick A, C, E | 0.7 | 0, +1, 0 | 0.5 | 0 / 0 | no | 0 | – | – |
| Quick B, D | 0.7 | 0, −1, 0 | 0.5 | 0 / 0 | no | 0 | – | – |
| Power (default) | 1.5 | 0, +1, 0 | 3 | 1 / 0 | yes | 0.8 | – | – |
| Power L | 1.5 | 0, −1, 0 | 3 | 1 / 0 | yes | 0.8 | – | – |
| Power R | 1.5 | 0, +1, 0 | 1 | 1 / 0 | yes | 0.8 | – | – |
| Power B | 1.5 | +1, 0, 0 | 3 | 1 / 0 | yes | 0.8 | – | 250 |
| Power T | 1.5 | +1, 0, 0 | 3 | 1 / 0 | yes | 0.8 | – | 300 |
| Rush (two hits) | 0.5, then 1.5 | +1, ∓1, 0 | 1 + 1 | 0 / 1 | no | 0.1, then 0.4 | 0 | 500 |
| Falling | 2 | +1, 0, −1 | 1 | 1 / 1 | yes | 0.4 | 0.6 | – |
| Trample | 30 | 0, +1, 0 | 0 | 1 / 1 | yes | 0.1 | 0.9 | – |
| Huge (two hits) | 30, then 30 | +1, ±1, 0 | 0 | – | yes | 0.2, then 0.4 | 0.1, then 0.5 | – |

Daggers: quick strikes A–E all have HitPow 0.7 and `push 1`. Power attacks (two hits) are 1.5 each,
adrenaline 1.5, stun 0.8.

Staff: quick strikes A–D have HitPow 0.7, stun 0.05–0.1 and fall 0.1. Power attacks are 1.5 with
`alwayspush 2` ("huge push"), stun 0.1 and fall 0.2.

## 13. Per-weapon table `[data: weapon qct → entity_data]`

| Class (example file) | WDmg | Reach u (tiles) | Piercing | Parry factor | Speed | Crit |
| --- | --- | --- | --- | --- | --- | --- |
| Sword (`sword_long`) | 3 | 100 (2.05) | 0.1 | 0.5 | 1.0 | 0 |
| Short sword (`sword_short`) | 2 | 100 (2.05) | 0.3 | 0.5 | 1.1 | 0 |
| Heavy sword (`sword_orc`) | 7 | 120 (2.46) | 0.3 | 0.5 | 0.8 | 0 |
| Daggers (`daggers`) | 1 | 80 (1.64) | 0.5 | 0.2 | 1.1 | 0 |
| Staff (`staff_combat`) | 2 | 110 (2.25) | 0.5 | 0.7 | 1.1 | 0 |
| Axe (`axe`) | 2 | 100 (2.05) | 0.2 | – | 0.8 | 0 |
| Club (`club`) | 3 | 100 (2.05) | 0.2 | – | 1.0 | 0 |

"Speed" is `speed_attack`, an animation-rate multiplier; blank means 1.0.

## 14. Side-by-side checks

Measure these in the game and here; they should match:

1. **Stopping from a run.** At 180 u/s with friction 4 and stopspeed 50, speed reaches 0 after
   ≈ 0.57 s:
   - 0.32 s of exponential decay down to 50 u/s
   - then 0.25 s of linear decay
   - ≈ 36 u (0.75 tiles) covered in total, at 15 ms ticks
2. **Ramp-up.** From standstill to 90% of 180 u/s takes ≈ 0.12 s, and full speed ≈ 0.135 s.
3. **Megasprint duration.** From a full bar of 10 stamina at 2 per second, megasprint lasts 5 s
   (10 is our design maximum).
4. **Charge threshold.** Holding attack 0.36 s gives the power-attack wind-up, and a 0.3 s hold
   gives a quick strike.
5. **Kick reach.** A kick connects at up to 100 u (≈ 2 tiles) from the eye.
6. **Guard rhythm.** In "cool" mode, a guard waits 2.0–3.5 s between attacks.

## 15. Hit reactions, NPC movement and the kick (third pass)

Sources for this section:
- `[mdl]`: animation data parsed from the game's models. The models are Source MDL version 44:
  - `npc_guard_combat_animations.mdl`, `npc_orc_animations_combat.mdl`
  - `player_animations.mdl`, `first_animations_*.mdl`
  - Frame counts, fps, event cycles and root-motion distances are read from the files.
- `[gh: address]`: decompiled from `server.dll`.
- Data files and cvars are tagged as before.

### 15.1 What a hit does to an NPC

**Hit animations** `[mdl]` (guard, 24 fps):

| Reaction | Animation | Locked for | Moves the NPC (front / side / back) |
| --- | --- | --- | --- |
| Small hit | `Hit_{head,Body}_{dir}_small`, 14 frames | does not stop it acting | none |
| Medium hit | `ACT_HIT_*_MEDIUM` | 0.50 s (event 2209) | 31 / 35 / 41 u |
| Long hit, push | `ACT_HIT_*_LONG` (pushes reuse these) | about 0.92 s | 88 / 60 / 64 u |
| Stun | `hit_stunned_{dir}`, then `stunned_in` → `stunned_idle` → `stunned_out` | `stunned_duration` | about 60 u |
| Knockdown | physics ragdoll, then `StandUp_front` (51 f) or `StandUp_back` (46 f) | `KnockedDownTime`, then the stand-up | ragdoll |

The orc moves further: about 50 u for a medium hit and 90 u for a long one.

**How the game picks a reaction** `[gh: 0x222aabb0, 0x22407d70]`:
- The target first resolves the hit as blocked, parried, dodged or hit.
- The reaction level starts from the hit size, which is "big" when `HitPow ≥ 2`. The player's move
  type then changes it:
  - a kick gives level 2
  - a rush gives 2
  - a trample gives 3
  - directional push flags give 1, 2 or 3
- A stun raises the level to at least 2.
- A push at a level above 2 knocks the NPC down. Otherwise the NPC plays the reaction animation at
  that level.

**Death** `[gh: 0x222cb600]`:
- The body becomes a ragdoll thrown along the hit by `force_damage_death`: 300 in the shipped
  `mm_game_settings.txt` (6000 is only the parser's fallback). See section 20.
- An impaled NPC uses `force_damage_impale` (150) instead; a beheading uses `force_damage_cut`
  (250).

**Stun** `[gh: 0x222aabb0]`:
- Stun needs `round(nbhittostun × weapon factor)` hits within `delaytostun` seconds, plus a roll
  against the move's `chancetostun`. A damage flag can also force it.
- `nbhittostun` is 20 for the guard and 6 for the orc.

**Implementation** `[design on top of the data]`:

| Damage reaction | Becomes |
| --- | --- |
| flinch | small hit |
| stagger | medium hit |
| push | long hit |
| knockdown | knockdown |

- **Slide.** A medium or long reaction slides the NPC back the animation's distance for the side
  that was hit. The slide is a friction slide whose start speed is `4·d + stopspeed/2`, the inverse
  of the Source friction in 2.1.
- **Pose.**
  - The NPC leans away from the hit.
  - Knocked down or killed, it becomes a ragdoll (section 20) and, after a knockdown, gets up over
    the stand-up animation's length (51 f from the front, 46 f from the back).
- **What is not copied.** OSRS NPCs have no hit animations, so small and medium hits are a
  procedural lean, not clips.

### 15.2 The kick

**Animations** `[mdl]`:
- **Third-person:** `attack_kick_low` and `attack_kick_medium` in `player_animations.mdl`. Both are
  21 frames at 24 fps (0.875 s).
- **Hit event:** event 2117 fires at cycle 0.30 for the low kick (0.25 s) and 0.40 for the medium kick
  (0.333 s).
- **First person:** the layers `layer_*_kick_{low,medium}` have the same length.
- **No other heights exist.** There are no high, very-high, jump or ground kick sequences, although
  `player_basic.qct` lists combat data for those heights.

**Hit test** `[gh: 0x2242e8b0]`:
- Trace 100 u from the eyes along the view.
- On a miss, retry 6 times, each starting 10 u lower.

**Force** `[gh: 0x223b1500, 0x223a7600, FUN_223ded60]`:
- The force is the view direction × the attack's `impactcoeff` (2 for kicks) × the target's mass
  scaling.
- The mass scaling is linear in mass from `MinForce` 1000 at weight 1 to `MaxForce` 7000 at weight
  100, clamped at both ends.

**NPC side** `[gh: 0x222abda0, 0x222a8810]`:
- **Dodging:** the NPC dodges a kick only when it is within `mm_ai_dist_defense` (100 u) and faces the
  kicker (dot > 0.8). It then rolls against its kick-dodge chance. That chance starts at
  `dodge_on_kick_init_chance` (0.2) and grows by `dodge_on_kick_add_chance` with every kick (guard
  +0.3, orc +0.4), up to 1.
- **Stamina:** a kick costs `stamina_kick_npc` (3) on an NPC and `stamina_kick_all` (1) otherwise.

**Wall and ledge** `[gh: 0x222c2410, 0x222e16a0]`:
- **Wall slam.** A kicked NPC that meets a wall is thrown into a ragdoll with `mm_ai_force_fall_wall`
  (5000) / `mm_ai_force_fall_wallz` (2000). It is knocked down for `KnockedDownTimeKick` (2 s).
- **Ledge.** Pushed over a void deeper than `HeightConsideredFallingSmall` (40 u) or
  `HeightConsideredFalling` (200 u), the NPC falls, and is knocked down for `KnockedDownTimeFall`
  (0.5 s).

**Implementation:**
- **Controls and stamina.** F kicks. It needs 3 stamina, and only works between swings and on the
  ground.
- **Height.** Looking down more than 25° gives the low kick `[design]`.
- **Hit test.** The trace above, with walls blocking it.
- **On the NPC.**
  - It takes `kick_damage` (1).
  - It slides back its long-hit distance for the side that was hit. The distance is scaled by
    (mass force ÷ mass) relative to an 80 kg NPC, clamped to 0.2–2×, and NPC mass is 80 × size²
    `[design]`.
  - A dodging NPC side-steps about 40 u (`Dodge_left` / `Dodge_right` `[mdl]`).
- **Wall slam.** It applies when the kicked slide still has 2.5 tiles/s or more when it meets a wall
  `[design]`. It deals 5 damage `[data PhysicsMediumDamages]` and a 2 s knockdown.

### 15.3 NPC combat movement

**Speeds** `[mdl]` (guard, from root motion; u/s):

| Gait | Forward | Back | Sideways | Diagonal |
| --- | --- | --- | --- | --- |
| Walk | 37 | | 27–32 | about 48 |
| Combat walk | 42 | | about 36 | about 55 |
| Run | 165 | 111 | 80 | about 137 |

The orc is faster: walk 60, combat walk 96, run 240.

**Combat steps** `[mdl]`:
- forward and back 15 / 30 / 40 u
- sideways 23 / 47 u
- 16–21 frames each

**Walk or run** `[gh 0x222bc1a0]`: run when the path is longer than `mm_ai_dist_walk_path` (250 u);
otherwise use the walking or combat-walking activity.

**Choosing a step** `[gh FUN_222b0af0]`. Each candidate step gets a weight:
- The base weight is 2.
- A forward or back step is judged by the distance it would end at:
  - beyond Yellow or at/inside Red: ×0.1
  - inside Green: ×2.5
  - between Green and Yellow: ×0.5
- A sideways step gets ×0.5 when outside the Red–Green band.
- The result is that the NPC keeps between the Red and Green distances.
- The guard's zones are Red 40, Green 80 and Yellow 120 u.

**Zig-zag** `[gh FUN_22291820]`: only while chasing. If the NPC is inside the player's 15° view cone
and at least 240 u away, it adds waypoints 50–100 u out at ±35°, alternating sides.

**Implementation** (`src/npc/NpcCombat.ts`, `Npc.fight`):
- **Leaving the grid.** A hit or kick alerts the NPC. It leaves the tile grid and moves freely, with
  walls, floor edges, the player and other NPCs blocking it.
- **Chase.** Beyond Yellow it chases: running if farther than 250 u, combat-walking otherwise, and
  zig-zagging as above.
- **Fight.** Inside Yellow it faces the player and takes weighted combat steps, with 0.15–0.6 s
  pauses `[design]`.
- **Flee.** Below 20% health it runs away for up to 20 s (`life_toflee`, `TimeFleeStop`).
- **Losing the player.** It gives up after 3 s with the player more than 1500 u away or on another
  floor (`TimeUntilNPCLoosePlayer`), then returns to the tile grid.
- **Animation.** The OSRS walk clip plays at a rate matched to the speed. The game blends nine
  directions of walk, combat-walk and run, and the OSRS cache also has walk-back, sidestep, turn
  and run clips. Baking those needs a re-export (`npm run export-world`), which is not done yet.

## 16. Fourth pass: jump, swing timing, bows, enemy damage, aggro

Sources for this section: shipped data files (`[data]`), cvar defaults (`[cvar]`), animation events
and lengths parsed from the MDL v44 models (`[mdl]`), and a Ghidra 12.1.4 headless decompile of the
same `server.dll` (`[gh: address]`). Animation event numbers are decimal.

### 16.1 Stamina and adrenaline (replaces the design values in 2.3 and 8)

| Item | Value | Tag |
| --- | --- | --- |
| Stamina maximum | 9 (12 with "double sprint") | `[data: player_basic → player_stamina_base_max]` |
| Stamina regeneration | 0.06 every 0.12 s = 0.5/s; the data stores no pause after spending | `[data]`; no pause `[inferred]` |
| Adrenaline maximum | 20 (35 with "adrenaline control") | `[data: player_adrenaline_base_max]` |
| Adrenaline for the "huge" attack | 20 | `[data: player_adrenaline_base_needed]` |

### 16.2 Jump `[gh: 0x223f2fc0, the game-movement jump check]`

- **Take-off.** Vertical speed becomes **160 u/s** (a constant; a disabled branch computes
  `sqrt(sv_gravity × 42)` = 158.7, the HL2 21-unit jump). Standing, it is added to the vertical
  speed; ducked, it replaces it.
- **Held boost.** While the jump button stays held, for up to **0.3 s** after take-off, each tick
  adds `160 × jumpmod × dt × 6` (jumpmod **0.7**; 0.35 under stone skin) = **672 u/s²**, against
  gravity 600. A tap peaks at ≈ 21 u; a full hold at ≈ 79 u.
- **Late jump.** Falling but not on the ground, a trace 17 u down (`mm_player_dist_to_allow_jump`)
  that hits ground still allows the jump.
- **Slopes.** No jump when that ground's normal z is between 0.1 and 0.7
  (`mm_player_min/max_angle_remove_jump`).
- No stamina cost. Gravity `sv_gravity` 600 u/s² `[cvar]`.

### 16.3 Swing timelines `[mdl: first_animations_*.mdl, 30 fps]`

The first-person attack layers carry these events `[gh: 0x223d9040, the view-model event switch]`:

| Event | Meaning |
| --- | --- |
| 2186 / 2198 | start the attack ray (hit tracing on); option = blade roll in degrees |
| 2190 | end the attack ray |
| 2102 | the impact event (kicks, disarms, NPC strikes) |
| 2107 | swing start (sound) |
| 2110 | end of the attack (the combo may continue) |
| 2112 / 2113 / 2114 / 2144 | bow: take arrow / nock / release / "can fire" flag |

Seconds from the start of the layer (wind-up = until the ray starts; active = ray on → off):

| Move | Total | Ray on | Ray off |
| --- | --- | --- | --- |
| Sword quick A | 0.300 | 0.100 | 0.233 |
| Sword quick B, C | 0.400 | 0.200 | 0.333 |
| Sword quick D | 0.400 | 0.167 | 0.300 |
| Sword quick E | 0.367 | 0.200 | 0.333 |
| Sword quick-chain end (no follow-up) | 0.500 | – | – |
| Sword power wind-up (`bigslash_*_in`) | 0.500 (B, T: 0.667) | – | – |
| Sword power release default / L / R / B / T | 1.067 / 0.800 / 1.033 / 1.267 / 1.000 | 0.133 / 0.033 / 0.200 / 0.033 / 0.033 | 0.233 / 0.200 / 0.433 / 0.267 / 0.167 |
| Sword rush (24 fps) | 1.958 | 0.166, 0.958 | 0.333, 1.124 |
| Sword falling attack | 1.000 | 0.100 | 0.267 |
| Sword huge (24 fps) | 2.083 | 0.292, 0.833 | 0.458, 1.000 |
| Daggers quick A–E | 0.233 / 0.267 / 0.333 / 0.233 / 0.733 | 0.067 / 0.100 / 0.067 / 0.133 / 0.267 | 0.200 / 0.233 / 0.200 / 0.233 / 0.400 |
| Daggers power release | 1.333 | 0.167, 0.700 | 0.300, 0.833 |
| Staff quick A–D | 0.467 / 1.000 / 1.000 / 1.433 | 0.267 / 0.800 / 0.733 / 0.933 | 0.467 / 0.967 / 0.867 / 1.033 |
| Staff power release (27 fps) | 2.778 | 0.407, 1.409 | 0.556, 1.556 |

`speed_attack` divides these times. Where a layer has no end-ray event the active window ends at
the impact event 2102 `[inferred]`. Section 17 replaces this table with per-ray data.

### 16.4 Bow

**Data** `[data: bow_classic.qct, arrow_classic.qct, first_basic.qct, mm_game_settings.txt]`:
- Bow `WDmg` 2 (long bow 4), `WPiercing` 0.3; 30 arrows when first taken, at most 99.
- Shot move `layer_bowattack_shoot`: `HitPow` **1.5**, adrenaline +2, impact along the arrow.
- `arrow_speed` **2100 u/s** `[cvar; launch gh 0x224f5e20]`: velocity = view forward × 2100 ×
  a per-shot multiplier that is reset to 1 after each shot.
- Aim compensation: pitched up more than 45°, the pitch is scaled by (1 − 45/90) × 1.97 = 0.985
  `[cvar mm_arrow_pitch_compensation*; gh 0x224f5e20]`.
- Arrows fall under gravity `[inferred: sv_gravity 600; the arrow's movetype was not traced]`.
- The guard lists `Arrow_classic` as non-dodgeable; other NPCs roll `ArrowAvoidanceBaseChance` 0.5,
  +0.25 per arrow `[data]`.

**Timeline** `[mdl: first_animations_bow.mdl, 30 fps]`:

| Phase | Layer | Length | Events |
| --- | --- | --- | --- |
| Draw from rest | `layer_bowattack_in` | 2.000 s | take arrow 0.50, nock 1.00, **can fire 1.433** |
| Release | `layer_bowattack_shoot` | 0.233 s | arrow leaves at 0.033 |
| Re-draw after a shot ("bow reload" skill) | `layer_bowattack_fastreload` | 1.000 s | can fire 0.933 |
| Lower without firing | `layer_bowattack_out` / `fastout` | 0.667 / 0.500 s | – |
| Equip / unequip | `layer_bow_draw` / `undraw` | 0.333 s | – |

**Skills** (all unlocked here, the user's choice) `[data: mm_skills_infos → projectile]`:
- Zoom: once drawn and moving slower than `mm_speed_to_bow_zoom` **10 u/s**, the view zooms
  (`mm_player_speed_zoom_in` 1, `_out` 0.2) `[cvar; gh 0x22442060]`.
- Stability: the sway factor is `1 − (now − drawn) / mm_time_bow_stabilisation` (4 s)
  `[gh 0x22435da0]`.
- Reload: a shot chains into the 1.0 s re-draw instead of the 2.0 s draw.

### 16.5 Enemy damage `[gh: 0x224d5840]`

One function builds every melee and arrow hit:

```
base = (attacker.strength + weapon.WDmg) × move.HitPow          ("DmgBase")
crit = 2 if random(0,100) < 2 × attacker.dexterity + weapon.WCritHit, else 1
       (applied only when ai.ShouldNpcCriticalStrike is on; the shipped data has it off)
target is the player: dmg = max(0, base − player.armour × 100) × difficultyMul
target is an NPC:     dmg = base (× 1.5 / × 2 on two NPC state flags) → 0 if blocked or parried
                      → × hitbox modifier (head 3, chest 0.5, limbs 1.25)
then × EasyDifficultyNPCDmgMul / HardDifficultyNPCDmgMul when those cvars are set (normal: off)
```

- `difficultyMul` is 1 unless `mm_dynamic_difficulty` is on `[gh 0x223e0520]`.
- Player armour with none worn: `armordefenderbase` **0.01** → −1 damage per hit.
- NPC strength/dexterity come from the NPC qct `[gh 0x2229beb0]`: guard 7/7, goblin 2/2,
  orc 1/6, necro-guard 2/4, undead 16/4, death knight 13/10, ghoul 11/10, cyclops 10/6.
- The player has no strength at that offset (the "Ring of Might" adds damage), so player hits are
  `WDmg × HitPow` plus bonuses `[gh; inferred]`.
- Guard with a short sword (`WDmg` 2): HitPow 0.7 strikes do **5.3**; `attack_Fast` does 2.6 twice.
- Player health: Source's `CBasePlayer` default 100 `[source]`; "extra health" skill levels add to it.
- NPC hits push the player at 250 u/s `[data PlayerPushOnHit]`.

### 16.6 Guard attacks `[data: npc_guard.qct; mdl: npc_guard_combat_animations.mdl, 24 fps]`

| Attack | HitPow | Range u | Impact at | Length | Root motion u | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| attack_Left | 0.7 | 50 | 0.875 s | 1.500 s | 40 | |
| attack_Right | 0.7 | 60 | 0.750 s | 1.667 s | 50 | |
| attack_Top | 0.7 | 50 | 0.583 s | 1.500 s | 70 | |
| attack_bottom | 0.7 | 50 | 0.708 s | 1.667 s | 40 | |
| attack_Fast (2 hits) | 0.4 + 0.4 | 60 | 0.542, 1.083 s | 1.917 s | 55 | |
| attack_Forward | 0.7 | 60 | 0.708 s | 1.583 s | 120 | lunge |
| attack_Jump | 0.7 | 70 | 0.917 s | 1.667 s | 130 | lunge, push |
| attack_long | 0.7 | 60 | 0.833 s | 2.083 s | 110 | lunge |
| attack_Bash | 0.7 | 40 | 0.459 s | 1.500 s | 30 | always push |
| attack_Kick | 0.7 | 40 | 0.500 s | 1.375 s | 0 | always push |

Event 2152 (weapon swoosh) comes 0.15–0.25 s before the impact; that is the visible tell.

### 16.7 Aggro (perception)

**Sight** `[gh: 0x222ce8a0 view cone, 0x222c74a0 visibility test]`:
- View cone: full angle `fieldofviewquiet` **90°** when calm, `fieldofviewalerted` **160°** once
  alerted; vertical ±`fielofviewheightangle`/2 = **±30°**.
- Range `maxsightdistancequiet/alerted` **1500 u**.
- Visible when inside the cones, with a clear line of sight, `dist ≤ range`, and
  `playerVisibility / (dist / range) > visibilityratio` (guard **1.4**: ≈ 1071 u in full light).
  `playerVisibility` is the light level on the player (0–1).
- While fighting, the player is always visible within `RangeViewToStealthMaxInCombat` **200 u**.
- Stealth (crouching): cone × **0.4**, range × **0.6** (`NPC*OfViewRatioWhenStealth`).
- Reaction delay `[data ai]`: `delaysee` **0 s**; `delaysee_stealth` **8 s** in stealth, ×0.3 under
  500 u, ×0.5 under 700 u, ×1 under 900 u.

**Hearing** `[gh: 0x2228ea70]`:
- Player presence radii `[data ai.SoundPresenceDist_*; mapping from the data's comments]`:
  stealth walk 100, stealth walk on noisy ground 200, walk 300, run 500, sprint 900.
- Heard when the distance is within the radius (×`SoundDistMulWhenCantReach` 2.5 when the NPC
  cannot reach it) and the height difference is ≤ 300 u.
- Reaction delay `delayhear` **1 s**; none above "big" (`NoDelayHearAbovePresence` 3).
- Hearing alerts the NPC and sends it to the sound's position.

**Alert levels and losing the player** `[data ai; cvar]`:
- Calm → aware → very aware → combat. Aware reverts to calm after 10 s, very aware after 5 s.
- Spotting the player inside `mm_ai_dist_surprised` **314 u** plays the "surprised" reaction
  (guard 1.17 s, 78 u back step); inside `mm_ai_dist_not_rush_on_seen` **400 u** it does not run in
  `[cvar; meaning inferred from the names]`.
- Allies within `call4helpdist` **700 u** join, at most 3 (`MaxCall4HelpNPCAgainstPlayer`).
- Out of sight for `TimeUntilNPCLoosePlayer` **3 s** → search around the last known position
  (`SearchRadius` 600 u) for `mm_ai_search_time` **10 s**, then back to calm.
- `mul_damages_Npc_Not_alerted` ×3 applies while the NPC is calm.

### 16.8 What this project does with it `[design]`

- Every NPC with an Attack option uses the guard's perception, strength (7) and short sword
  (`WDmg` 2); the OSRS data has no per-NPC equivalents. NPC health stays combat-level based. A
  strike does `max(0, 9 × hitPow − 1)`: 0.7 (about 5.3 damage) for the primary style, scaled for
  the others by the ratio of the OSRS max hits (clamped to 0.3–2.5), and 2.0 in all for a breath.
- Attack styles: the OSRS wiki lists the styles of every monster (melee, ranged, magic,
  dragonfire, icy breath), which the cache does not. `npm run fetch-wiki-attacks` saves them to
  `tools/world-export/data/npc-attacks-wiki.json`; the exporter turns them into
  `NpcAppearanceInfo.attackStyles` in `npcs.json` (weights, gap ranges, hitPow, projectile or
  breath) with `data/npc-attack-overrides.ts` for what the wiki does not encode (breath only next
  to the player, ranged only when not adjacent, dragons that breathe from range as fireballs).
  NPCs that only melee keep the guard's table or their melee clips.
- No lighting model: `playerVisibility` is 1 (crouching still applies the stealth cone, range and
  8 s delay). Line of sight uses the tile walls; NPCs on another floor cannot see the player.
- Attack choice: at random, weighted, among the attacks whose gap range holds (melee: range + root
  motion; ranged and magic: up to 8 tiles, often only when not adjacent; breath: next to the
  player). A dragon is two parts melee to one part breath. After an attack the cooldown is
  scaled by the wiki attack speed over 4 ticks. A melee strike hits if the player is within the
  attack's range + root motion + both radii, inside a ±60° frontal cone. A breath hits at each of
  its four damage ticks while the player is inside a 30° half-angle cone 3 tiles long. Arrows,
  spells, rocks, spit and fireballs fly in a straight line at where the player was when they were
  shot (8–14 tiles/s, no lead), so they can be sidestepped, and walls and the ground stop them.
  An NPC that only shoots or casts engages from 6 tiles and holds about 5.
- Player block: hold right mouse. A melee hit from inside the weapon's parry cone (6) is parried
  (no damage) unless the attack breaks parries. Arrows, spells and breath cannot be parried.
- Anti-dragon shield (menu key `I`, Shields): dragonfire does a tenth of its damage, but not icy
  breath, and not while a bow takes both hands.
- Death: after 4 s (`mm_player_death_fadeout_duration`) the player respawns with full health.

## 17. Directional swings

### 17.1 Choosing the direction `[gh: 0x22449a50 sword, 0x2243f720 daggers, 0x22444c80 staff]`

- The power-attack variant is fixed **when the wind-up (`layer_bigslash_*_in`) starts**: on the
  press from idle, or when a hold during a quick strike passes the charge threshold (18.1). It reads the movement buttons held at that moment:
  `IN_MOVELEFT` → **L**, else `IN_MOVERIGHT` → **R**, else `IN_FORWARD` → **T**, else `IN_BACK` →
  **B**, else the default. Pitch and being airborne play no part.
- The variant then idles (`*_idle`) until release, which plays the matching `*_out`.
- Pressing a direction during the default wind-up switches variant only with
  `mm_alternate_player_combat 1` (off in the shipped game; that mode aims at the nearest enemy
  instead) `[gh: 0x22434450]`.
- Rush (megasprinting) and the vertical/falling attack (airborne) override the variant as before.

### 17.2 The attack ray `[gh: 0x223d9040 event 2186/2198, 0x222ba1a0 setup, 0x223b39b0 per-tick trace]`

Between the start-ray event (2186 horizontal, 2198 vertical) and the end-ray event (2190), every
tick the game traces **one line from the eye**, `rangeattack` long (sword 100 u), in this direction:

```
t      = (now − rayStart) / rayDuration                     (0 → 1)
angle  = (t − 0.5) × 90° × sign                             (mm_activate_trample_angle 90)
sign   = +1 if the move's impact direction is positive on the swept axis, else −1
         (horizontal: impact Y; vertical: impact X)
dir    = eyeAngles(pitch, yaw, roll = event option) ∘ local(yaw = angle)    for 2186
         eyeAngles(pitch, yaw, roll = event option) ∘ local(pitch = angle)  for 2198
```

So every swing is a 90° fan centred on the crosshair. The event option rolls the fan's plane:
0 is a flat right↔left slash, 90 is vertical, ±45 diagonal, 180 mirrors it. Impact Y +1 sweeps
from the player's right to their left; a vertical sweep with impact X +1 goes top to bottom. The
first entity the line touches is hit (mask 0x46004003). Moves without a start-ray event (sword B
and T thrusts, dagger C) hit at their impact event 2102 `[inferred: a centre trace]`.

Short targets may receive up to three limited downward aim retries from the melee trace.

### 17.3 Ray table `[mdl: first_animations_*.mdl]`

Seconds from the start of the layer; roll in degrees; V = vertical (2198); "thrust" = impact event
only.

| Move | Total | Rays (start–end, roll) |
| --- | --- | --- |
| Sword quick A / B / C / D / E | 0.300 / 0.400 / 0.400 / 0.400 / 0.367 | 0.100–0.233 −10 / 0.200–0.333 0 / 0.200–0.333 25 / 0.167–0.300 −25 / 0.200–0.333 −10 |
| Sword power default / L / R | 1.067 / 0.800 / 1.033 | 0.133–0.233 −45 / 0.033–0.200 0 / 0.200–0.433 45 |
| Sword power B / T | 1.267 / 1.000 | thrust 0.233 / thrust 0.167 |
| Sword rush (24 fps) | 1.958 | 0.166–0.333 0; 0.958–1.124 45 |
| Sword falling | 1.000 | 0.100–0.267 V |
| Sword huge (24 fps) | 2.083 | 0.292–0.458 135; 0.833–1.000 −45 |
| Daggers quick A / B / C / D / E | 0.233 / 0.267 / 0.333 / 0.233 / 0.733 | 0.067–0.200 0 / 0.100–0.233 0 / thrust 0.200 / 0.133–0.233 180 / 0.267–0.400 90 |
| Daggers power default, L, R | 1.333 | 0.167–0.300 0; 0.700–0.833 90 |
| Daggers power B / T | 0.967 / 0.833 | thrust 0.133; 0.267–0.400 −135 / thrust 0.133; 0.300–0.433 135 |
| Daggers rush | 1.767 | 0.868–0.967 0; 1.101–1.200 0 |
| Staff quick A / B / C / D | 0.467 / 1.000 / 1.000 / 1.433 | 0.267–0.467 180 / 0.800–0.967 90 / 0.733–0.867 180 / 0.933–1.033 75 |
| Staff power default (27 fps) | 2.778 | 0.407–0.556 −60; 1.409–1.556 120 |
| Staff power L, R (27 fps) | 2.593 | 0.371–0.555 0; 0.962–1.260 0 |
| Staff power B / T | 1.967 / 2.500 | 0.366–0.533 80; thrust 1.166 / 0.368–0.500 −60; 1.268–1.400 90 |
| Staff rush | 1.667 | 0.067–0.267 0; thrust 1.133 |
| Staff falling | 1.200 | 0.100–0.267 V |

Staff A and C have no end-ray event; their rays end at the layer end and the impact event
respectively `[inferred]`. Trample layers carry no ray events `[design: vertical 0.6–0.9 s]`.

## 18. Normal (quick) attacks

Sources: the player state handlers `[gh: 0x22446a40 sword idle, 0x224473c0 sword power,
0x22446e20 sword quick strikes, 0x2243f180 daggers, 0x22443fa0 staff, 0x22431f90 press time]`,
`first_basic.qct` and `first_animations_*.mdl`. This replaces the tap/hold description in 3.1.

### 18.1 Press, release and hold

- **A press from idle starts the power wind-up at once** (`layer_bigslash_*_in`, direction per 17.1).
- **Releasing before the wind-up layer finishes turns it into a quick strike** (state 0xf7). The
  wind-up lengths are therefore the tap/hold boundary from idle: sword 0.500 s (B and T 0.667 s),
  daggers 0.500 s, staff 1.542 s `[mdl]`.
- Holding until the wind-up finishes charges the power attack; releasing then plays it (or the rush
  while megasprinting).
- **During a quick strike**, a press is buffered at any point of the strike; the next strike starts
  when the current one ends. There is no 60% gate here.
- **Holding during a quick strike** for `mm_player_mintime_to_bigslash` (400 × frametime × 0.06 ≈
  0.36 s; daggers 0.18 s) from the press cancels into the wind-up, direction from the keys held
  then. Releasing during that wind-up starts a new chain at A.

### 18.2 Combo order and endings

| Weapon | Order | "End" layer after the chain stops | Otherwise |
| --- | --- | --- | --- |
| Sword | A B C D E, then B C D E B … (A only opens a chain) | after A or E: 0.500 s | straight to idle |
| Daggers | A B C D E A … | after A–D: 0.500 s each | after E: idle |
| Staff | A B C D A … | after A–C: 0.333 s each | after D: idle |

- A chain stops when a strike ends with nothing buffered; the next chain begins at A.
- **While an end layer plays**, presses before 60% of it (`mm_player_cycle_fastattack_end` 0.6) are
  ignored; later presses start a new chain at A straight away, without a wind-up.
- Past B the chain needs the "chained slash" skill; with all skills unlocked here it always
  continues `[design]`.

### 18.3 Speed and damage

- `speed_attack` (`change_speed 1` in `first_basic.qct`) scales the quick strikes and the power
  releases only; wind-ups, rush, falling, trample and huge attacks keep their own speed `[data]`.
- Hit zones scale damage on NPCs (16.5, `hitboxes_modifier`): head ×3, chest ×0.5, stomach ×1,
  limbs ×1.25 `[data: npc_guard]`. Here the zone comes from where the ray meets the body's height:
  top 15% head, next 25% chest, next 15% stomach, the rest legs `[design]`.

## 19. Physics: props, impacts and falls

Sources: `mm_game_settings.txt`, `propdata.txt` (`[data]`), cvar defaults (`[cvar]`) and Ghidra 12.1.4
decompiles of the same `server.dll` (`[gh: address]`). Masses are kg; impulses are kg·u/s, so an
impulse J changes a body's speed by J / mass.

### 19.1 Which objects are props `[design]`

Dark Messiah's maps place physics props by hand. The OSRS cache has no such list, so the exporter
turns one-tile, static locs with these names into props, gives each its own mesh and removes its
tile collision (`tools/world-export/Props.ts`):

| Name | Material | Mass kg |
| --- | --- | --- |
| Crate / Crates (stack) | wood | 40 / 100 |
| Box, Boxes | wood | 20 |
| Barrel / Barrels | wood | 60 / 150 |
| Cask, Keg | wood | 40 |
| Chair / Stool | wood | 12 / 6 |
| Bucket / Basket | wood | 4 / 3 |
| Sack, Sacks | cloth | 25 |
| Pot, Jug, Vase, Urn / Pots | pottery | 5 / 12 |

Material → propdata class `[data: propdata.txt]`:

| Material | Class | Health | dmg.club | Gibs when broken |
| --- | --- | --- | --- | --- |
| wood | `Wooden.Medium` | 30 | 2.0 | 4 `WoodChunks` |
| cloth | `Cloth.Medium` | 50 | 0.75 | none |
| pottery | `Pottery.Small` | 5, damage table `glass` | 1.25 | none listed; we use 4 shards `[design]` |
| metal | `Metal.Medium` | 0 = unbreakable | 1.0 | – |

### 19.2 Force by mass `[gh: FUN_223ded60; data: mm_game_settings → all]`

`F(m) = MinForce + (m − MinWeight) × (MaxForce − MinForce) / (MaxWeight − MinWeight)`, clamped to
`[MinForce, MaxForce]` = `[1000, 7000]` for `m` in `[1, 100]` kg (settings offsets 0x508–0x514).
Kicks, throws and our weapon hits scale it.

### 19.3 Kicking a prop `[gh: 0x2242e8b0, 0x223b1500]`

The kick trace (section 7) also hits props. The prop gets the impulse `view direction × impactcoeff
(2) × F(m)`. A 40 kg crate gets 6,727 kg·u/s → 168 u/s (3.4 tiles/s); a 5 kg pot gets 2,606 →
521 u/s. The kick costs `stamina_kick_all` (1), not the NPC cost.

### 19.4 Picking up and throwing `[gh: 0x22467290 throw; data: player]`

| Item | Value | Tag |
| --- | --- | --- |
| Reach | `PlayerTakeDist` 130 u (2.66 tiles) | `[data]` |
| Heaviest liftable | `PlayerThrowMassClamp` 100 kg | `[data; use as lift limit inferred]` |
| Held object follows at | `mm_player_take_interp_speed` 12 (1/s) | `[cvar; meaning inferred]` |
| Throw impulse | `F(m) × mm_player_throwforce` (10); ragdolls ×1.5 instead | `[gh; cvar]` |
| Throw direction | eye angles with pitch `+mm_throw_object_angle_minus` (20°); ragdolls −30° | `[gh; cvar]` |
| Spin | random −10…10 per axis × `mm_player_throwforceangular` (2) | `[gh; cvar]` |

Source pitch grows downward, so as decompiled the throw leaves 20° below the crosshair (ragdolls 30°
above). A 40 kg crate leaves at 841 u/s (17 tiles/s); a 5 kg pot at 2,484 u/s.

Telekinesis (not built yet) throws with `((m' − 0.5) × 0.2414 + 0.5) × player_throwforce` (1000),
where `m'` is the mass clamped as the code does (above 15 kg it uses 0) `[gh: 0x224c5b70]`; its cvars
are `MMTelekinesis_*` (max mass 250, pull force 4000, reach `PlayerTelekinesisDist` 850 u).

### 19.5 Impact damage tables `[gh: FUN_2219ee90 → FUN_2219e920; tables at 0x22762c68–0x22762eb0]`

Every physics collision computes damage for each body from a table chosen by name (`player`,
`player_vehicle`, `npc`, `glass`; propdata's `damage_table` picks `glass`):

1. No damage if the other body is lighter than `minMass`, or lighter than `smallMassMax` and slower
   than `sqrt(smallMassMinSpeedSqr)`, or slower than `sqrt(minSpeedSqr)` and not spinning faster than
   `sqrt(minRotSpeedSqr)`.
2. `energy = (Δv_other² × m_other + Δv_self² × m_self) / m_self`, where Δv is each body's loss of
   speed in the collision. Bodies at least `largeMassMin` heavy multiply their part by
   `largeMassScale`, and by `largeMassFallingScale` when falling onto the target.
3. Damage comes from a step lookup (Source's `ReadDamageTable`, not interpolated): walk the entries
   until one's threshold is above `energy` and take the one before it. Spin adds the angular table's
   entry. Bodies lighter than `smallMassMax` never do more than
   `smallMassCap`.

| Table | Linear: speed² threshold → damage | Angular | min speed / min mass / small mass ≤ / small cap / small min speed |
| --- | --- | --- | --- |
| `player` | 150² 5, 250² 10, 450² 20, 550² 50, 700² 100, 1000² 500 | 100² 10, 150² 20, 200² 50, 300² 500 | 24 / 2 / 5 / 5 / 36 |
| `npc` | 25² 1, 75² 2, 100² 3, 150² 5, 250² 10, 350² 50, 500² 100, 1000² 500 | 100² 10, 150² 25, 200² 50, 250² 500 | 24 / 2 / 5 / 5 / 36; large mass 500 kg ×4, falling ×5 |
| `glass` | 25² 10, 50² 20, 100² 50, 200² 75, 500² 100, 250² 500 | 50² 25, 100² 50, 200² 100, 250² 500 | 8 / 2 / 1 / 10 / 8 |

Props use the `npc` table unless their propdata names `glass` `[inferred: the prop's call passes no
name and Source's default for props is the NPC table]`. Examples: a 40 kg crate thrown into a wall
(841 u/s) takes 100 and breaks; a kicked crate hitting a wall (168 u/s) takes 5; a crate dropped two
tiles (≈340 u/s) takes 10.

### 19.6 Props hitting NPCs `[gh: 0x22365530; data: ai]`

- The prop's collision handler skips NPCs while the prop is slower than `PhysicsSpeedToDamageNPCs`
  (70 u/s, 1.43 tiles/s) `[gh]`.
- It tags the hit by the prop's mass: below `PhysicsWeightToDamageNPCsMedium` (10 kg) small, below
  `PhysicsWeightToDamageNPCsBig` (50 kg) medium, otherwise big `[gh]`. A prop the player threw within
  the last 0.6 s also gets the "thrown" flag `[gh]`.
- Damage by tag: `PhysicsSmallDamages` 3, `PhysicsMediumDamages` 5, `PhysicsBigDamages` 8; thrown by
  telekinesis 8 / 15 / 50, with adrenaline 100 / 200 / 300 `[data; mapping from the flags inferred]`.
- Reaction by impact energy: below `PropDamageEnergySmall` (500) a small hit, below
  `PropDamageEnergyMedium` (4000) a normal hit, else a knockdown for `KnockedDownTimePhysics` (2 s)
  `[data comments]`. We take energy as ½·m·v² in joules with 1 u = 2.54 cm `[inferred]`: a kicked
  crate (≈ 360 J) gives a small hit, a thrown one (≈ 9,000 J) a knockdown.
- Props heavier than `PropMassCannotBeBlocked` (100 kg) cannot be parried `[gh]`.
- `PhysicsWeightToCrushNPC` 200 kg with `PhysicsForceToCrushNPC` 500 crushes `[data]` (no prop here
  is that heavy).
- `mm_ai_can_push_props_physics 1`: walking NPCs shove props aside `[cvar]`.

### 19.7 Props hitting the player

The `player` table (19.5) with the player's mass 85 kg `[source: Source's player physics shadow]`,
for props moving faster than `mm_player_damage_propphys_min_speed` (1 u/s) `[gh: 0x2240f520]`.

### 19.8 Falling `[gh: FUN_221d5750 fall damage, FUN_223f3e70 landing, FUN_22173de0 apply]`

| Item | Value |
| --- | --- |
| Safe landing speed | 526.5 u/s (constant at 0x225d5d34) |
| Damage | `(v − 526.5) × 0.2525` (= 100 / (922.5 − 526.5)): stock Source, 100 at 922.5 u/s |
| Scale | × `player_reduce_fall` 60% `[data: player_basic → skills; where it multiplies inferred]` |
| Applied only if | at least `min_damage_to_activate_long_fall` (5) `[cvar; gh]` |
| Landing view punch | above 303 u/s; ×0.85 above 263.25; none below 173 |

With gravity 600 u/s², damage starts after a 231 u (4.7 tiles) drop; 100 raw damage (60 taken) needs
709 u (14.5 tiles).

### 19.9 Breaking `[data: propdata.txt]`

- Weapon hits do their damage × the material's `dmg.club` (Dark Messiah melee is club-type
  `[inferred]`).
- At 0 health the prop breaks into `breakable_count` gibs, which fade after a few seconds `[design]`.
- Metal props (health 0) never break.

### 19.10 Simulation `[design]`

Dark Messiah runs Havok (vphysics). Here a prop is an upright cylinder (radius and height from its
model) that keeps a full 3D orientation for drawing:

- **Motion.** Gravity 600 u/s². On the ground, Coulomb friction μ 0.6 slows sliding (Source's default
  surface friction is 0.8 `[source]`; 0.6 lets kicked crates slide about a tile). Bounces keep 25% of
  the impact speed.
- **Collision.** Tile walls and blocked tiles (the same boxes the player uses), floors, NPC and
  player cylinders, and other props (mass-weighted elastic exchange, restitution 0.25).
- **Spin.** Impacts and throws spin the prop; when it comes to rest it settles on its nearest flat
  side.
- **Pushing.** Moving NPCs and the player shove props they walk into, matching their own speed along
  the contact × min(1, pusher mass / (2 × prop mass)) (NPC 80 × size² kg, player 85 kg): the player
  shoves a 40 kg crate at full speed and a 150 kg stack of barrels at under a third of it.
- **Sleep.** A prop slower than 0.05 tiles/s on the ground for 0.5 s stops simulating until hit.

### 19.11 Damage scale

As with weapon damage (5.2, `strengthScale` 10), prop damage to NPCs is the data value × 10, so a
thrown 40 kg crate does 50 to an NPC. Impact damage to props and to the player uses the data values
unchanged (prop health and the player's 100 health are in the game's own units).

## 20. Ragdolls

Sources: the guard's collision model `npc_guard.phy` (`[data: phy]`), `mm_game_settings.txt`,
cvars, and Ghidra decompiles of `server.dll` (`[gh: address]`).

### 20.1 What Dark Messiah does

| Item | Value | Tag |
| --- | --- | --- |
| When | killed; knocked down (big hit, kick into a wall, fall, prop hit); then `StandUp_front` / `StandUp_back` | `[gh: 0x222aabb0, 0x222c2410]` |
| Death push | normalized hit direction × `force_damage_death` 300 (impaled 150, beheaded 250), an impulse on the body | `[gh: 0x222cb600; data ai]` |
| Starting motion | the animation's current velocity × `mm_ragdollanimation_coeffvelocity` 1 | `[cvar; meaning inferred]` |
| Body | 15 rigid bodies: pelvis, spine, head, upper/lower arms, hands, thighs, shins, ankles; 90 kg in total, mass ∝ volume (pelvis 19 kg, spine 26, head 5, thigh 7.3, shin 5.5) | `[data: phy]` |
| Damping | linear 0, angular 1.5; every solid's inertia ×10 (`inertia 10`), so limbs turn sluggishly and a body stops rolling soon after it lands | `[data: phy]` |
| Joint limits (degrees, x / y / z) | hip ±40 / −20…35 / −50…30; knee 0 / −10…100 / 0 (a hinge); ankle −20…35 / ±20 / ±20; spine −35…40 / ±25 / ±25; shoulder ±40 / −85…60 / −40…90; elbow 0 / −100…20 / 0 (a hinge); wrist ±40 / 0 / −30…50; neck ±60 / −25…35 / ±30 | `[data: phy]` |
| Parts colliding with each other | the guard's .phy names no `collisionrules`, so every pair of solids collides except each solid with the one it is jointed to (`RagdollSetupCollisions`) | `[gh: 0x223715a0, 0x22371ab0]` |
| Limit | at most `g_ragdoll_maxcount` 8 ragdolls; client-side ragdolls do not collide with each other (`cl_ragdoll_collide` 0) | `[cvar]` |
| Blending | an NPC getting up blends out of the ragdoll pose over `mm_ai_ragdoll_blending_time` 0.4 s | `[cvar]` |
| Ragdoll hitting an NPC | a character's flying body: above `mm_ragdoll_vel_to_damage` × 0.25 (75 u/s) the hit counts; above 300 u/s it does 10 damage and is taken as a kick (knockdown), below it does none and pushes; the same body counts once per NPC in 2 s (20.7) | `[gh: 0x22341360, 0x222aabb0]` |

As in the other sections, a 300 kg·u/s impulse moves a 90 kg body only 3 u/s: a killed NPC mostly
collapses and keeps the motion it already had, as when a kick or a power attack slides it.

### 20.2 OSRS bodies as ragdolls `[design on OSRS data]`

OSRS models have no bones, but every vertex has a label, and each animation's frame base lists
transform groups: an ORIGIN sets a pivot (the centroid of its labels' vertices) and the ROTATE
after it turns its labels around that pivot. The exporter (`tools/world-export/NpcSkeleton.ts`)
turns that into a skeleton per NPC:

- Labels turned by exactly the same set of ROTATE groups move together: one rigid part.
- A part whose set contains another part's set hangs from it (the largest such subset is the
  parent); the ROTATE group by which they differ is their joint, at its ORIGIN's centroid.
- Parts under 4 vertices fold into their parent; a tiny root hands over to its largest child; at
  most 32 parts.
- The walk animation's frame base is used (it moves more limbs than the idle).

Lumbridge's NPCs get 15–32 parts each (a man 15: pelvis, torso, head, upper arms, forearms, hands,
thighs, shins, feet; a goblin 23; a cow 29; a giant spider 32). NPCs without labels or animations
fall as one rigid body.

### 20.3 Simulation `[design]`

- **Parts at run time.** Parts whose joint sits within 0.06 tiles of their own centroid, and parts
  under 8 vertices, ride rigidly on their parent (their children keep their own joints). They only
  spin in place on their joint, which shows little and never settles. A man ends up with 10 parts,
  a guard 11, a goblin 15, a cow 15.
- **Particles.** Verlet particles, per part: its centroid, its farthest vertex and one off that line
  (at least 0.08 tiles off, so thin parts keep a stable frame), plus a collision hull of its
  extreme vertices along each of its frame's axes; and one per joint, shared by the two parts it
  joins (a ball joint). All particles of a part are held at their distances, so the part stays
  rigid. A part starts where it is drawn by its best-fit motion over its own vertices (not those
  of the small parts folded into it), and all its particles are placed by that one motion, so it
  starts rigid (20.8). 2 substeps, 8 iterations a frame. Positions are kept relative to a whole-tile origin near
  the body: at map coordinates (around 3200) single floats only resolve 1/4000 tile, noise that
  kept small bodies such as a goblin's twitching.
- **Mass.** The NPC's mass (80 × size² kg; the guard's ragdoll is 90) shared out by the volume of
  each part's box, like the .phy masses.
- **Damping.** Each part's spin (its particles' motion relative to their mean) decays at 1.5 per
  second, the .phy's `rotdamping`; linear motion is barely damped (0.995 a substep).
- **Joints.** Bend and twist limits learned from the NPC's own animations, held at all times
  (20.4).
- **Body parts.** Collide with each other as in Dark Messiah (20.5).
- **Collision.** Particles stay above the floor of their plane (radius 0.04 tiles). Touching it
  stops their fall (Verlet would otherwise turn the push out of the floor into a bounce); sliding
  loses 35% a substep, and a contact sliding slower than 0.6 tiles/s stays where it was at the
  start of the substep (static friction, by position, so small pushes cannot make a body creep).
  Tile walls and blocked tiles stop particles. Before the first step the whole body is lifted,
  without motion, until no particle is in the floor. Drawn vertices still below the floor between
  hull particles (a few hundredths of a tile) are lifted in the drawing only. A body off the edge
  of an upper floor drops to the plane below.
- **Motion.** The ragdoll starts from the pose being drawn, moving at the NPC's velocity (its
  knockback slide or its walk), and on death gets `force_damage_death` along the last hit. Kicks
  and hits on a body already on the ground shove the whole body.
- **Sleep.** See 20.6.
- **Getting up.** When the knockdown ends, the NPC stands where its root part lies (facing where
  that part faces, if it is not lying flat) and blends from the ragdoll pose into its idle animation
  over the stand-up time.
- **Corpses.** A dead body stays for 30 s, and at most 8 lie around at once (oldest first).

### 20.4 Joint limits learned from the animations `[design on OSRS data]`

Dark Messiah's .phy gives every joint its own per-axis limits (20.1): knees and elbows are hinges
that fold one way only. OSRS models carry no such data, but their idle and walk frames show how
each joint really moves, so each joint's limits are learned from them (`RagdollLimits.ts`):

- **Samples.** In every idle and walk frame, each part's rotation from the base pose is the best
  fit over all its vertices (Müller et al. 2016, which also copes with flat and thin parts). A part
  that does not move rigidly in a frame (best-fit misfit over 2% of its size², a merged label
  moving on its own) gives no sample there. A sample is the child's direction from the joint, in
  its parent's frame, and its twist about its own axis (swing-twist decomposition).
- **Bend box.** The directions' mean and main spread axis give two bend angles. A joint the
  animations do not move (less than 6°) gets Dark Messiah's stiff joints: ±30° and ±20°, twist ±25°.
  A joint whose rest pose sits at one end of its range is a hinge: 10° the wrong way, and on to 100°
  (or 25° past the animations) the right way, like the knee's −10…100°. Other joints get 25° past
  what the animations reach each way. Sideways bends get 15° past the animations, at least ±30°
  around rest. The box is centred on its range (at most ±85°), then widened to hold every sample,
  the rest pose (with 5° to spare) and the pose the body starts in.
- **Twist.** The shortest arc of the circle holding every sample's twist (twists near ±180° are
  neighbours), 20° wider each way; limited only for parts with a frame of their own.
- **Holding them.** A joint past its box or twist is turned back by half the excess per pass (at most
  0.08 rad, every other iteration), about the joint: the limb and everything hanging from it one
  way, the rest of the body the other, shared by their inertia about the joint. A side lying on the
  floor stays put and the other side turns alone. Turning whole sides keeps every part rigid, so a
  limit never fights the distance constraints. Positions and previous positions turn together (a
  turn adds no speed, so a body lying on the floor is not flicked into the air); then the two
  sides' spin carrying the joint further out is removed, keeping their angular momentum. A limit
  can only take energy out of the body.
- **Learned once per model.** Every NPC of a model gets a copy of the same limits, widened for its
  own starting pose.

Measured on real exports (rat, goblin, guard, man; 12 shoves each, 3–7 tiles/s in six directions):
in the poses the bodies come to rest in, 0 to 6 of the roughly 120–170 joints per NPC are more than
15° past their limits, all of them limbs forced there by the floor on landing.

### 20.5 Body parts colliding `[gh: 0x223715a0; design]`

As in Dark Messiah when a model names no collision rules, every part collides with every other part
except its parent and its children.

- **Shapes.** Each part is a chain of up to 5 spheres along its longest axis, one per slice about
  1.6 thicknesses long, each reaching 75% of its slice's vertices.
- **Pairs.** Two spheres collide at the sum of their radii, or as close as the model itself brings
  them in its base pose or animations (an arm hanging against the body, legs passing in the walk),
  whichever is less. Spheres the model puts deeper than 30% of that inside each other (armour
  over a body) never collide.
- **Response.** Overlapping spheres push their parts apart (half the overlap per iteration, at most
  0.01 tiles), the lighter part further, moving previous positions too, so the push adds no speed.
  The parts' approach along the contact is then removed by mass (an inelastic stop). At rest, two
  parts both lying on the floor are left as they lie: they cannot sink into each other, and pushing
  them apart would only fight the floor's grip.

Measured in Blender (each fallen pose's part meshes checked triangle by triangle against each
other; jointed pairs and pairs touching at rest are not counted), per fallen pose:

| NPC | Before: part pairs / triangle pairs | Now (mean of 12) | Poses with none |
| --- | --- | --- | --- |
| Giant rat | 13 / 207 | 0.8 / 4 | 7 of 12 |
| Goblin | 20 / 540 | 2.7 / 40 | 3 of 12 |
| Guard | 11 / 315 | 2.8 / 42 | 3 of 12 |
| Man | 6 / 182 | 2.2 / 26 | 0 of 12 |

What is left is mostly legs crossing and forearms against the torso, which the walk brings that
close.

### 20.6 Settling `[data: phy; design]`

Dark Messiah's bodies (inertia ×10, angular damping 1.5) stop rolling soon after they land, and
Havok deactivates bodies at rest. Here:

- A body moving slower than 0.36 tiles/s (mean particle speed) keeps 80% of its velocity per
  substep, so its last wobble dies fast.
- From 0.3 s after its root part first lies on the floor (or the body first leans on a standing
  NPC or another body, 20.7), its damping ramps over 0.5 s from 0.995 to 0.8 per substep, and
  1.5 s after landing it is put to sleep.
- A body slower than 0.12 tiles/s for 0.3 s sleeps sooner; any body sleeps 5 s after it was last
  disturbed.

Measured on the same shoves: asleep and still 0.5–2.0 s after the shove, fall included (medians:
rat 1.2 s, man 1.3 s, guard 1.5 s, goblin 1.8 s; the earlier version needed up to 5 s). A body
being simulated costs 1.2–2.7 ms a frame while awake; learning the limits takes 10–30 ms per model,
once.

### 20.7 Bodies knocking NPCs over `[gh: 0x22341360, 0x222aabb0; design]`

What Dark Messiah does when another character's flying body hits an NPC (0x22341360, a handler
in the NPC's vtable, building a `CTakeDamageInfo` for `CBaseEntity::TakeDamage` 0x223b9820):

| Body speed | Damage | Damage info flags (+0x8c) | Reaction (`ComputeActionFromDamages` 0x222aabb0) |
| --- | --- | --- | --- |
| up to 75 u/s (`mm_ragdoll_vel_to_damage` 300 × 0.25) | none | no hit | none |
| 75–300 u/s | 0 (damage multiplied by 0.0) | `0x40`, reaction level 2 | a push |
| over 300 u/s | 10, type `0x40000` | `1` | handled as `Attack_Move_Kick` at level 3: the NPC is knocked down |

The NPC also remembers which body hit it, and the same body counts again only after 2 s
(`_DAT_22571c90`).

Here (`BodyHits.ts`, `Npcs.collideBodies`):

- **Contact.** Each frame every awake ragdoll's collision spheres (20.5) are tested against the
  body cylinders of the standing NPCs on its floor; the speed that counts is the body's centre of
  mass moving in along the contact, as Dark Messiah reads the striking character's velocity.
- **Knockdown.** Faster than 75 u/s (1.5 tiles/s) the NPC is knocked down, as by a kick, for the
  physics knockdown time (2 s), onto a ragdoll of its own, and then gets up. Dark Messiah only
  pushes between 75 and 300 u/s, but bodies here rarely fly faster than 2–5 tiles/s (a long-hit
  slide starts at about 3.8), so every counting hit knocks the NPC over [design].
- **Momentum.** The two share their momentum along the contact as in an inelastic collision: the
  NPC's ragdoll starts at their common speed, the striking body slows to it (equal masses: half
  each).
- **Damage.** Over 300 u/s, 10 × `strengthScale`; under it none. A body never kills: the hit
  leaves at least 1 health [design].
- **Who.** Only NPCs that can be attacked are knocked over; others stand their ground and the body
  is stopped against them (moved out without gaining speed, its motion into them taken away), as
  is a body too slow to knock anyone over. The NPC hit turns towards the body and becomes alert,
  as with a thrown prop (19.6).
- **Bodies on the ground.** Ragdolls keep out of each other: overlapping spheres of two bodies push
  their parts apart, the lighter further, without adding speed, and stop their motion into each
  other. A sleeping body stays as it lies unless struck faster than 0.3 tiles/s, which wakes it.

Measured with real exports (a guard thrown at 4 tiles/s into a goblin, a man at 4 into a guard, a
goblin at 3 into a man), rendered and checked in Blender: the body reaches its target at
2–3 tiles/s, both go on at about half that, the target falls (its top drops from 1.1–1.5 to
0.45–0.6 tiles above the floor) and both bodies are asleep within 2.5 s. The two meshes touch in at
most 9 triangle pairs at any of the frames checked. A man drifting in at 1.2 tiles/s leaves the
other standing.

### 20.8 Keeping the skin together `[design]`

The skeleton OSRS animations imply need not follow the body. A giant rat's chest (with its neck,
head and front legs) hangs from its tail-and-back part, whose small tail segments are folded into
it (20.3): the chest's joint limits, learned relative to a tail that wags in the walk, are huge, and
nothing joins the chest to the hips although the skin does. Dead, the rat folded its front half
back over its hips and the skin between them stretched across the body (mesh edges 1.27 tiles
longer than in the base pose, against at most 0.17 in its own animations). Two things fix it:

- **Ligaments.** Wherever mesh edges join two parts (jointed or not), up to 3 of those edges,
  spread along the seam, become ligaments: each end is a point carried by its part (a weighted sum
  of 4 of its particles), and the ends may not part further than the edge is long in the base pose
  or any idle or walk frame (the real animated vertices) plus 0.05 tiles. A ligament only pulls
  when stretched past that. It is not widened for the pose the body starts in: where a folded
  segment bends in that pose (a rat's tail curling in its idle), the part after it (the tail tip)
  starts torn off its seam, and the ligament pulls it back.
- **Fitting parts to their own vertices.** A part's motion, both at the start of the ragdoll and in
  each animation frame its limits are learned from, is fitted to its own vertices only; the folded
  segments curl on their own. Fitted to all of them, or to the frame through its farthest vertex
  (the tail tip), the rat's back started wrenched off its chest.

Measured on real exports (12 deaths each, from 3 walk and 3 idle frames, hit from the side and the
front), the worst mesh edge stretch in the pose a body comes to rest in:

| NPC | Before | Now | Its own animations |
| --- | --- | --- | --- |
| Giant rat | 1.27 | 0.18 | 0.17 |
| Goblin | 0.44 | 0.19 | 0.13 |
| Cow | 0.44 | 0.24 | 0.19 |
| Guard, man, giant spider | about 0.1 | about 0.1 | |

Bodies still come to rest within 0.5–1.9 s. In the game, 10 giant rats killed mid-idle from
different sides came to rest within 0.75–1.4 s with no edge more than 0.19 tiles longer than in
the base pose.