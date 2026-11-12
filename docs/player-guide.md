# Player Guide

## Table of Contents

- [Starting the Game](#starting-the-game)
- [Getting Around](#getting-around)
- [Combat](#combat)
- [Weapons and Blocking](#weapons-and-blocking)
- [Health, Stamina, and Adrenaline](#health-stamina-and-adrenaline)
- [NPCs and Interaction](#npcs-and-interaction)
- [Props](#props)
- [Flying](#flying)
- [Camera and Interface](#camera-and-interface)
- [Quick Reference](#quick-reference)

## Starting the Game

Open the game, wait for `Ready`, then click `Click to play`. The browser captures the mouse for
first-person view and movement. Click the game again if mouse capture is released.

Press `Esc` to release the mouse and show the game overlay. Closing the overlay with `Click to
play` resumes control.

You can start at a specific location by adding coordinates to the URL, for example
`http://localhost:5173/?x=3213&y=3428`.

## Getting Around

| Control | Action |
| --- | --- |
| `W` | Move forward |
| `S` | Move backward |
| `A` / `D` | Strafe left / right |
| Mouse | Look around |
| `Shift` | Sprint while moving forward |
| `Alt` | Walk slowly |
| `C` | Crouch while walking |
| `Space` | Jump |

Sprint consumes stamina. Once stamina is empty, sprinting stops until the player recovers enough
stamina. Walking with `Alt` is slower than normal running.

## Combat

While not carrying a prop, use `Mouse 1`:

- Tap briefly for a quick strike.
- Hold until the weapon is fully charged for a power attack, then release.
- Hold during a quick strike to turn it into a charged attack.

Charged attacks can take different directions based on movement and aim. Hold a direction while
charging:

- `A` or `D`: side slash.
- `S`: thrust.
- `W` while looking up or jumping: overhead attack.

Additional charge attacks trigger from movement:

- Charge and release while megasprinting at full stamina for a rushing attack.
- Attack while falling fast for a plunging attack.
- Aim down at a knocked-down target for a trample attack.

### Huge attacks

Successful hits fill the blue adrenaline bar. When the bar reaches full, hold and charge the next
attack, then release `Mouse 1`. The controller spends the full adrenaline bar and performs a huge
attack. The adrenaline bar decays gradually if it is not used.

## Weapons and Blocking

Use the mouse wheel to switch between available weapons.
Press `I` to open the cache weapon menu and equip any listed weapon; type in its search box to
filter the list by name, then click a weapon or press `Enter` to equip the first match. The selected weapon remains active
until another weapon is equipped or selected with the mouse wheel. A weapon whose name contains
"dagger" fights like the daggers, "staff" like the staff and "bow" like the bow; every other weapon
fights like the sword.

- Sword: balanced melee weapon.
- Daggers: fast attacks and close-range stepping attacks.
- Club: heavier melee weapon.
- Staff: longer reach and defensive weapon.
- Bow: ranged attacks where available.

Hold `Mouse 2` to block during melee. Blocking can stop or weaken incoming attacks and can leave
the attacker exposed to a follow-up. Weapon reach, speed, damage, and parry behavior vary by weapon.

To use the bow, aim with the mouse, hold the attack button to draw, then release to shoot while
arrows remain available. With a bow from the weapon menu, an arrow sits on the string and the string pulls back
as you draw; at full draw the arrow points into the reticule, and a shot arrow leaves the bow and
curves into the line of sight within its first 8 tiles. Let go before the bow is fully drawn and it eases back without shooting. Crossbows have
no drawn string.

## Health, Stamina, and Adrenaline

The three bars at the lower-left corner of the screen are:

| Bar | Meaning |
| --- | --- |
| Red | Health. Taking damage reduces it; reaching zero causes death and respawning. |
| Yellow | Stamina. Used by sprinting and actions such as kicking. |
| Blue | Adrenaline. Filled by successful hits; full produces the next huge attack when charged and released. |

When health reaches zero, the player dies and fades back in after the death sequence, with health
reset and stamina restored.

## NPCs and Interaction

Aim at an NPC or interactive object and approach within interaction range. When prompted:

| Control | Action |
| --- | --- |
| `E` | Use the first available action |
| `R` | Use the second available action, when present |

Available actions depend on the target. NPCs can offer actions such as `Talk-to` or `Attack`.
NPCs never start a fight on their own: they leave you alone until you hit, kick or shoot them (or
knock them down with a thrown prop), and only the NPC you attacked fights back. Attacking an NPC
may cause it to react, flee, retreat, or fight depending on its state and health.

Some NPCs provide services or dialogue rather than combat. The exact actions shown in the screen
prompt are authoritative.

## Props

The world contains loose physics props, including crates, barrels, sacks, chairs, stools, and pots.
These objects can be kicked, attacked, picked up, carried, and thrown.

| Control | Action |
| --- | --- |
| `E` while aiming | Pick up a prop |
| `E` while carrying | Drop the prop |
| `Mouse 1` while carrying | Throw the prop |
| `F` | Kick a prop or NPC |

Thrown props can damage and knock down NPCs. Heavy impacts can break props and hurt entities in
the impact area. Kicked targets can wall-slam, fall, and become knocked down. Falling props and
long falls can also hurt the player.

## Flying

Press `N` to toggle flying.

While flying:

| Control | Action |
| --- | --- |
| `W` / `S` | Move forward / backward |
| `A` / `D` | Strafe left / right |
| `Space` | Rise |
| `C` | Sink |
| `Shift` | Fly faster |

Press `N` again to disable flying. The player lands on the highest floor below the current
position, allowing access to roofs and upper levels.

Combat is unavailable while flying. Target interaction is also unavailable in flying mode.

## Camera and Interface

- Mouse: first-person camera.
- `Esc`: release mouse capture and return to the start overlay.
- `V`: toggle third-person camera in development builds.
- On-screen weapon name identifies the selected weapon.
- A charge ring shows attack charge progress.
- Hit markers confirm successful attacks.
- The screen flashes red when the player takes a significant hit.

## Quick Reference

| Control | Action |
| --- | --- |
| `W A S D` | Move |
| Mouse | Look |
| `Mouse 1` | Quick attack; hold and release for charged attack |
| `Mouse 2` | Block |
| `F` | Kick |
| Mouse wheel | Switch weapon |
| `Shift` | Sprint or fly faster |
| `Alt` | Walk slowly |
| `C` | Crouch or descend while flying |
| `Space` | Jump or rise while flying |
| `N` | Toggle flying |
| `E` / `R` | First / second target action |
| `E` | Pick up or drop a held prop |
| `Mouse 1` while carrying | Throw prop |
| `Esc` | Release mouse |
| `V` | Third-person camera in development builds |
