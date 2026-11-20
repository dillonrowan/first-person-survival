# Player Guide

## Table of Contents

- [Starting the Game](#starting-the-game)
- [Getting Around](#getting-around)
- [Combat](#combat)
- [Weapons and Blocking](#weapons-and-blocking)
- [Skills, Spells, and Attack Styles](#skills-spells-and-attack-styles)
- [Inventory, Equipment, and Bank](#inventory-equipment-and-bank)
- [Gathering and Making](#gathering-and-making)
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

Press `Q` to wield the next weapon in your inventory. You fight with the item in your
weapon slot (fists with none): wield one from the inventory (see below). A weapon whose name
contains "dagger" fights like the daggers, "staff" or "wand" like the staff, "crossbow" like a
crossbow and "bow" like the bow; every other weapon fights like the sword. The anti-dragon shield
cuts dragonfire's damage to a tenth, but not icy breath's, and stops protecting while you hold a
bow, which takes both hands. In development builds `I` opens a cheat menu that gives any cache
weapon, shield or item (click for one, shift-click for a hundred); its Skills tab sets any skill
to any level from 1 to 99.

- Sword: balanced melee weapon.
- Daggers: fast attacks and close-range stepping attacks.
- Club: heavier melee weapon.
- Staff: longer reach and defensive weapon.
- Bow: ranged attacks where available. A bow whose name contains "shortbow" draws faster, but its
  arrows fly slower and drop sooner; every other bow is a longbow: a slower draw, and arrows that fly
  further and stay in the air longer.
- Crossbow: ranged attacks with no draw to hold; it reloads between shots and reaches as far as a
  longbow.

Hold `Mouse 2` to block during melee. Blocking can stop or weaken incoming melee attacks and can
leave the attacker exposed to a follow-up. A blocked blow that would have hit you still deals about
a third of its damage (at least 1); one that would have done 0 does nothing. Weapon reach, speed, damage, and parry behavior vary by
weapon. Arrows, spells and dragon breath cannot be blocked. A staff or wand cannot parry: `Mouse 2`
casts with it instead.


To use the bow, aim with the mouse, hold the attack button to draw, then release to shoot while
arrows remain available. With a bow wielded, an arrow sits on the string and the string pulls back
as you draw; at full draw the arrow points into the reticule, and a shot arrow leaves the bow and
curves into the line of sight within its first 8 tiles. Let go before the bow is fully drawn and it eases back without shooting. With a bow or crossbow,
hold `Mouse 2` to zoom the view; let go and it zooms back out. Arrows and bolts fly in an arc and clear fences, low
walls and anything else lower than their path; they stick only in what they actually reach. They never vanish in flight; one that has stuck
disappears after 10 seconds.

Each shot uses one arrow or bolt from the ammunition slot. A crossbow has no charge. When you equip it, and after every shot, it plays a reload: it is lowered,
the string is spanned back onto the latch and a bolt is laid on the rail, then it is raised to the
aim. Once it is back at the aim it is loaded, and a click shoots at once. The string is straight
while the crossbow is spent and drawn back while it is loaded; the shot kicks the crossbow up and
back. The weapon name shows the bolts left.

Karil's crossbow is a repeater: a magazine on top holds 7 bolts. After each shot its lever pushes
the magazine forward to catch the string, hauls it back to the latch and drops the next bolt onto
the rail, all at the shoulder, so it shoots about twice a second. Hold the attack button and it
keeps shooting until the magazine is empty; it is then lowered and the bolts are dropped into the
magazine one by one before it is raised again. The weapon name shows the bolts in the magazine,
then the bolts left in all (for example `(5/7 · 23)`).

## Skills, Spells, and Attack Styles

Damage follows the Old School RuneScape rules. The combat skills are **Melee** (Attack and Strength
in one), **Defence**, **Ranged**, **Magic** and **Hitpoints**; the OSRS non-combat skills except
Agility, Firemaking and Construction (Mining, Smithing, Herblore, Fishing, Thieving, Cooking,
Crafting, Fletching, Woodcutting, Runecraft, Slayer, Farming and Hunter) are trained as described in
[Gathering and Making](#gathering-and-making). Every skill starts at level 1 except Hitpoints at
10, which is your maximum health. Press `K` for the skills tab (level, XP and XP to the next level,
and your combat level). XP gains float up at the top right, and a banner announces each new level.
Skills are saved in the browser.

- Every attack rolls to hit against the target's defence for that style and then rolls its damage
  from 0 up to your max hit. Hits show as OSRS hitsplats over the NPC that was hit (up to four at
  once): red with the damage, blue 0 for a miss (the target takes it on its guard:
  a person raises their shield, weapon or forearms, a beast hunkers down; a person may instead parry
  a melee blow that does 0, more often the higher their Defence is against your Melee and the more
  blows you have just landed on them in quick succession, flinging
  your blade aside and bashing you where you stand, dazed and stunned, unless you raise your
  parry stance in time; a stunned person never parries), the trimmed max hit
  splat when you roll your max hit, and green for poison. Hits on you show the same splats near the
  bottom centre of the screen.
- Your max hit and accuracy come from your skill and the bonuses of everything you wear. Swinging
  faster than the weapon's OSRS speed does not add damage per second: a swing made sooner than that
  speed hits for proportionally less.
- Melee and ranged XP is earned when the NPC you damaged dies, for the damage you dealt it: 4 per
  damage to the skill of your attack style and 1.33 to Hitpoints. Magic XP comes straight away when
  a spell does damage: the spell's base XP plus 2 Magic and 1.33 Hitpoints per damage (a spell that
  splashes for 0 gives none). A level-up shows a message and gives the extra health.
- Press `X` to cycle your attack style: melee accurate, aggressive or defensive; ranged accurate,
  rapid (a tick faster) or longrange (half the XP to Defence).
- Health comes back by eating food (below) and by one point a minute.
- **Poison.** Some monsters are poisonous (the OSRS wiki's list, for example tribesmen) and can poison
  you with any attack, hit or miss: the message "You have been poisoned!" shows and the health bar
  turns green. Poison hits every 18 seconds, starting at the monster's poison damage and dropping
  by one every five hits until it wears off. Weapons and ammunition with (p), (p+) or (p++) in the
  name poison what they hit: a melee hit that deals damage poisons 1 time in 4 (starting at 4, 5
  or 6), an arrow or bolt 1 time in 8 (starting at 2, 3 or 4). Some monsters are immune.

**Spells.** Press `B` for the spellbook: the 20 combat spells from Wind Strike to Fire Surge, locked
ones greyed out with their level. Click an unlocked spell to equip it; one is equipped at a time and
is saved. Press `G` to cast it with any weapon, or `Mouse 2` while holding a staff or wand. Spells
look as they do in OSRS (the models and animations come from the game cache): the cast swirl plays
at your hands, the spell flies straight and stops at walls, and on a hit its impact bursts on the
target. A spell that misses splashes: a blue-grey cloud, and no hitsplat. Dark wizards cast their
OSRS spells at you the same way: the level 7 ones Water Strike and Confuse, the level 20 ones Earth
Strike and Weaken. Every ranged and magic monster fires its OSRS projectile: archers' arrows, guards'
crossbow bolts, trolls' rocks, lizardmen's spit, and the bosses' own attacks.

**Stat drains.** Some attacks lower your stats for a while, as in OSRS: Confuse and Weaken lower
Melee, Curse and Vulnerability lower Defence (they do no damage), and some monsters drain on every
hit: aberrant spectres (wear a nose peg), banshees (wear earmuffs), leeches, Loar shades, feral
vampyres and the Mourner's vial. A drained skill shows as current/base in red in the Skills tab
(`K`), and your attacks and spells use the drained level. Each drained skill comes back one level a
minute, also after a reload. A chaos druid's Bind holds you in place for a moment. Each cast uses its runes from the inventory (shown on the spell),
except the runes an elemental staff or wand supplies for free (a Staff of air never uses air runes).
You start with 999 of every rune.

## Inventory, Equipment, and Bank

Press `Tab` for the side panel: **Inventory** (28 slots; items that stack, such as runes, arrows,
coins, rune essence and pure essence, take one slot), **Equipment** (head, cape, neck, ammunition,
weapon, body, shield, legs, hands, feet and ring, with the total bonuses), **Skills** and **Spellbook**.

- Left click an item to use its first action (Wield, Wear, Eat, Light, Clean…); right click for the
  menu (its options, Use, Drop, Examine). Drag items to move them. Click a worn item to take it off.
- **Use**: pick Use on an item, then click another item (tinderbox on logs, knife on logs, herb on
  a potion) or close the panel, aim at something (a range, a furnace, a patch, ruins) and press `E`.
  `Esc` or `Tab` cancels.
- Items have skill requirements (a message says what is missing), and a two-handed weapon takes the
  shield off. Only weapons are drawn on the player; armour counts for its bonuses only.
- Food heals its OSRS amount; you can eat again after 1.8 seconds.
- You start with the runes, a bronze sword wielded, arrows in the ammunition slot, and a few spare
  weapons. Items you drop lie on the ground for 3 minutes. Killed NPCs drop what their OSRS drop
  table says. Items also lie around the world and come back a minute after you take them.
- Press `E` on an item on the ground to take it. Press `E` on a bank booth or chest, or use a banker's
  Bank option, to open the bank: click an item to move one, right click for 5, 10 or all, search by
  name, or deposit everything you carry or wear. The bank has no slot limit and stacks everything.
- Inventory, bank and equipment are saved in the browser and kept when you die.
- **Shops**: use a shopkeeper's Trade option. Click an item to buy one (right click for 5, 10, 50
  or its price); while the shop is open, click an inventory item to sell one. Stock runs down when
  you buy and slowly comes back.

## Gathering and Making

Aim at the thing and press `E` (or `R`/`T` for its other options). Woodcutting, Mining and Fishing
are done by hand (below); other skilling repeats on the 0.6 s OSRS game tick until you stop: moving
away, attacking, kicking, opening a panel or dying stops it.
Messages go to the log at the bottom left. Success chances, XP and times are the OSRS ones.

- **Woodcutting**: with an axe wielded, attack a tree: the axe's ordinary swing chops it. A swing
  that meets the trunk stops where it touches the bark and sticks there for a moment, then you
  twist it loose and pull it free before you can swing again (clicks meanwhile are kept). Every
  blow that sticks rolls for a log with your Woodcutting level and the axe's chance, scaled by how
  much of the OSRS 4-tick woodcutting interval has passed since your last blow, so swinging fast
  gets no more logs; the tree shudders. Chop down (`E`) wields the best axe you carry. Trees
  topple when their last log comes and leave a stump that grows back. A sword swing sticks in a
  tree the same way but gets no logs. With a full inventory you keep chopping and the logs fall to
  the ground at your feet. Grown farming trees are chopped the same way, once their health is
  checked.
- **Mining**: with a pickaxe wielded, aim at a rock within reach and left click (`Mouse 1`): the
  pick goes up overhead and comes down on it (Mine wields the best one). Hold the button (or keep
  clicking) to keep striking; a strike always finishes. Clicking a rock that is too far away tells
  you to get closer, and an attack already under way plays out first. A blow
  rolls the rock's chance, scaled by how much of the pickaxe's OSRS interval has passed since your
  last blow, so a better pickaxe needs fewer blows and hammering fast gives no more ore. The rock
  crumbles when it empties and refills. Aubury in Varrock teleports you to the rune essence mine.
- **Fishing**: fishing spots ripple and bubble on the water where the OSRS wiki places them. With a
  fishing tool wielded, left click a spot from at most 2 tiles away (stand on the shore next to it; farther, you are told
  to get closer): you fish with the spot's option
  for that tool, and the same click casts or scoops. Or use a spot's option (Net, Bait, Lure, Cage,
  Harpoon), which puts the right tool in your hand (it must stay wielded). You need the tool and
  any bait. Rods, nets, cages and the plain harpoon cannot attack. With a full inventory the catch
  falls to the ground at your feet and you keep fishing.
  With a rod, aim at the spot and click to cast. The bobber floats with its black waterline mark just above the water; nibbles
  only touch the water, but a bite pulls it under, past the mark. Click while it is under (about a
  second) to hook the fish; a click before then reels in empty, and a missed bite gets away. Then
  reel: hold the mouse button to push the zone right and let go to let it drift back, keeping the
  fish in the zone until the meter fills (the zone answers the button at once). Fish you are more
  likely to catch get a wider zone and swim calmer. A landed fish leaps out of the water to you;
  cast again for the next. A net, cage or harpoon has no line: aim at the spot and click (or hold
  the button) to scoop the net or pot through the water, or strike with the harpoon, again and
  again; each scoop has a chance to bring up a fish.
- **Cooking**: Cook on a range or fire, or use raw food on it; food can burn. The first item is
  done on the next tick.
- **Fires**: use a tinderbox on logs (or Light them). There is no Firemaking skill: the logs always
  catch at once. The fire burns right where you stand (you do not move) and you can cook on it
  until it burns out and leaves ashes. Better logs burn longer: plain logs about 1-2 minutes, yew
  three times as long, redwood four times.
- **Smithing, Crafting**: Smelt at a furnace, Smith at an anvil with a hammer, Spin at a spinning
  wheel, and so on; the make menu at the bottom lets you pick the item and how many (1, 5, 10, X or
  All, or keys 1-9). Iron ore fails half the time.
- **Fletching, Herblore**: use a knife on logs, a bowstring on a bow, a herb on a vial of water;
  Clean grimy herbs. Fill vials, buckets and jugs at fountains, wells and sinks.
- **Runecraft**: Enter mysterious ruins with the rune's talisman or tiara (without one, a message
  names the talisman you need), then Craft-rune at the altar; the portal leads back. The world map
  (`M`) marks every essence altar's ruins.
- **Thieving**: Pickpocket people and Steal-from stalls. You lower whatever you hold, glance
  down and lean in while you work the pocket, and raise it again after; getting caught jerks you back, hurts and stuns you for a few seconds, and
  anyone who can fight turns on you.
- **Hunter**: Lay a bird snare or box trap and Check it once something walks in; Catch butterflies
  and implings with a butterfly net and a jar.
- **Farming**: Rake a patch, use a seed on it (seed dibber, or a spade for trees and bushes), and
  come back later: crops grow in real time, even while the game is closed.
- **Slayer**: ask a Slayer master for an Assignment; kills of that kind count down. Some monsters
  need a Slayer level before you can hurt them.
- Killed NPCs come back at their spawn 30 seconds after their body is gone.

## Health, Stamina, and Adrenaline

The three bars at the lower-left corner of the screen are:

| Bar | Meaning |
| --- | --- |
| Red | Health (the number is shown above the bar). Taking damage reduces it; reaching zero causes death and respawning. |
| Yellow | Stamina. Used by sprinting and actions such as kicking. |
| Blue | Adrenaline. Filled by successful hits; full produces the next huge attack when charged and released. |

When health reaches zero, the player dies and fades back in after the death sequence, with health
reset and stamina restored. Items and skills are kept.

## NPCs and Interaction

Aim at an NPC or interactive object and approach within interaction range. When prompted:

| Control | Action |
| --- | --- |
| `E` | Use the first available action |
| `R` | Use the second available action, when present |
| `T` | Use the third available action, when present |

Available actions depend on the target. NPCs can offer actions such as `Talk-to` or `Attack`.
NPCs never start a fight on their own: they leave you alone until you hit, kick or shoot them (or
knock them down with a thrown prop), and only the NPC you attacked fights back. Attacking an NPC
makes it fight you to the end: NPCs never flee, and they move faster once they are fighting you.
Bigger and taller NPCs are heavier: blows push them, and knock them flying, less far. An NPC may
sidestep a kick, ducking out of the way.

Some NPCs fight in more than one way. Dragons sometimes breathe fire in a cone in front of them
when you stand next to them, so step out of the cone or behind them (or wear the anti-dragon
shield). Archers and mages keep their distance and shoot arrows or cast spells at where you were
standing, so strafing out of the way or putting a wall between you works.

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

- Mouse: look.
- `Esc`: release mouse capture and return to the start overlay.
- Mouse wheel: zoom out of first person into a third-person view behind the player, further with each
  notch; scroll back in to return to first person. Your character swings, blocks and aims the same
  in both views.
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
| `Mouse 2` | Block; with a bow or crossbow, hold to zoom; with a staff or wand, cast |
| `F` | Kick |
| `G` | Cast the equipped spell |
| `Q` | Wield the next weapon in the inventory |
| `X` | Cycle attack style |
| `Tab` / `K` / `B` | Inventory and equipment / skills / spellbook |
| `M` | World map: drag to pan, wheel to zoom; marks you, the essence altars, mining sites and fishing spots |
| Mouse wheel | Zoom between first and third person |
| `Shift` | Sprint or fly faster |
| `Alt` | Walk slowly |
| `C` | Crouch or descend while flying |
| `Space` | Jump or rise while flying |
| `N` | Toggle flying |
| `E` / `R` / `T` | First / second / third target action |
| `E` | Pick up or drop a held prop; take an item from the ground; use a bank |
| `Mouse 1` while carrying | Throw prop |
| `Esc` | Release mouse |
