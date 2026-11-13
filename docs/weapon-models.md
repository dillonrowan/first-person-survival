# Melee weapons: art contract

Each weapon class has a model at `public/models/weapons/<id>.glb`. When a file is missing, or fails
to load, the game uses a placeholder built in code (`src/combat/PlaceholderWeapons.ts`). Add or
replace a file and it shows up the next time that weapon is drawn, with no code change. Make the
models yourself or commission them. Do not extract them from other games: the combat design
borrows behaviour and numbers only, never assets.

The weapon ids live in `src/combat/weapons.ts`:

| id | Class | Suggested length (tiles) |
| --- | --- | --- |
| `sword` | one-handed sword | 0.75 |
| `daggers` | dagger (drawn in the right hand) | 0.35 |
| `club` | club or mace | 0.6 |
| `staff` | two-handed staff | 1.4 |

## File

- glTF 2.0 binary (`.glb`), exported "+Y Up", transforms applied.
- **Units are tiles.** The game does not rescale weapons; the player's eyes are 1.25 tiles above
  the ground, so a sword of about 0.75 tiles reads right.
- **Origin** at the centre of the grip, where the hand closes.
- **Orientation:** the blade or head points along **+Y**. The cutting edge faces **+Z**, and the
  flat of the blade lies in the YZ plane.
- At most 1,500 triangles and one 512 px texture (or vertex colours), so it sits with the low-poly
  world.

## How the game uses it

- **First person.** The model hangs off the camera and is posed by code from the swing timeline
  (wind-up, strike, recovery) in `src/combat/WeaponView.ts`. It needs no animations, and any
  animations in the file are ignored.
- **Third person.** The model is parented to the character's `socket_hand_r` empty (see
  [player-model.md](player-model.md)), rotated so +Y points along the forearm. The character has no
  attack clips yet, so in third person the weapon is held still.
- Reach, damage and parry come from `src/combat/weapons.ts`, not from the model's size.
- **Bows from the cache** have no string in their models. At load the game strings them and nocks
  an arrow (`src/combat/BowString.ts`): from the nock the string runs to each limb tip along the
  archer side (+Z) of the limb's outline, so it lies over recurves and flared tips instead of
  passing through them, and the arrow passes beside the widest part of the grip. The nock is pulled
  toward +Z as the bow is drawn. Only the model's opaque faces shape the string.
- **Effect faces on cache weapons** (the alpha-blended faces, such as the scrolling sparkle panels
  on the magic shortbow (i)) are drawn with the world's `overlay` material
  (`src/world/WorldMaterials.ts`). It has no depth test or depth write and draws after every other
  transparent object, so the weapon, its string and nearby walls never cut into the effect. Its
  texture scrolls with the world clock, like other animated textures.
- **Crossbows from the cache** are their own family. Their worn models all lie the same way (prod
  toward -Y, limbs along X, stock above the hand), so they are turned a half turn about Z, not by
  their exported blade direction, into a crossbow contract: muzzle +Y, rail on top +Z. Their models
  carry a string already drawn back in a V; at load the game drops those triangles and adds its own
  string and bolt (`src/combat/CrossbowRig.ts`): straight from tip to tip when spent, back on the
  latch (where the model's V met the stock) when cocked, with the bolt in the groove at string
  height, ending short of the prod block or sights. A crossbow model without a drawn string (a pair
  of crossbows, say) gets no string or bolt.
- **Repeating crossbows** (Karil's crossbow, `isRepeaterCrossbow`) carry a magazine box over the
  rail. At load, the parts of the model that stand clear above the drawn string and lie over the
  stock (not out along the prod) are split off as the magazine (`magazineFaces`) and handed to the
  rig (`CrossbowRig.attachMagazine`). The rig adds a fork under the magazine's back end that holds the
  string on the latch, a loading slot on top, and a lever (laid out against Karil's model in
  Blender): two arms pivoted on the stock under the magazine's front, through pins near its back
  end, joined by a handle behind it. In each lever stroke the magazine slides forward until the fork
  reaches the spent string, then back to the latch, and the next bolt drops out of it onto the rail.
