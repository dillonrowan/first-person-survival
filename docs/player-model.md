# Player character: art contract

The player's body is a rigged glTF character at `public/models/player.glb`. If the file is missing
or breaks the contract below, the game logs why and uses Hans of Lumbridge's model from the
exported cache (`public/world/npcs/3105_3105.bin`, chosen by name with `PLAYER_BODY_NPC` in
`src/main.ts`), and failing that a built-in placeholder.

The cache body (`src/avatar/CacheAvatar.ts`) is skinned to the rig below, fitted to the model's
body parts the same way as the NPC hit reactions (`fitHumanoid` in `src/npc/HitPose.ts`). Each
vertex follows one bone, it is drawn unlit in its baked vertex colours like the NPCs, and it plays
the placeholder's procedural idle, walk, run and airborne clips.

Everything below is checked at load time by `src/avatar/AvatarContract.ts`. Names live in
`src/avatar/avatarConfig.ts`, so you can change them to match your rig.

## File

- glTF 2.0 binary (`.glb`), exported "+Y Up", facing +Z (Blender's front view), transforms applied.
- Origin between the feet at height 0. Any size works: the loader scales the model so the eye
  socket lands at the game's eye height (`EYE_HEIGHT`, 1.25 tiles).
- At most 8,000 triangles, at most 2 textures of 1024 px or less (or vertex colours). A low-poly,
  flat-shaded look sits best next to the baked-lit world.

## Rig

- One armature with these bones (names are exact): `hips spine chest neck head upperarm_l
  upperarm_r forearm_l forearm_r hand_l hand_r thigh_l thigh_r shin_l shin_r foot_l foot_r`.
  The character's left side is +X.
- At most 4 weights per vertex.
- Empties parented to bones: `socket_eye` on the head between the eyes (required),
  `socket_hand_r` and `socket_hand_l` (optional, for held items later).

## First person

The body is drawn in first person; only the head is hidden. Meshes for the head, hair and headwear
are separate objects whose names start with `head_` (for example `head_skull`, `head_hair`).
Without any, the head bone is shrunk instead (a warning; the cache body works this way).

So the view never starts inside the body, in first person the neck is held `FP_NECK_BACK` behind
the eyes along the body's facing, the torso does not lean with the view, and the body sinks with
the eyes when crouching (there is no crouch clip).

The right arm is bent by two-bone IK (`Avatar.reachRightHand`) so `socket_hand_r` lands on the
held item's grip (the weapon contract's origin, see [weapon-models.md](weapon-models.md)). Put
`socket_hand_r` in the middle of the closed fist. When the grip is out of the arm's reach the
shoulder comes forward by up to `FP_SHOULDER_REACH`.

## Third person and swings

The mouse wheel zooms out to a camera behind the player and back into first person. First person
plays the view-model clips; third person (and so what other players will see) plays the body's own
holds and swings from `src/combat/BodySwings.ts`, posed in `Avatar.viewFrame` (where the
first-person camera would be relative to the neck, turned with the view):

- Idle, the weapon is held ready in front of the right hip, blade up; after `RELAX_AFTER` seconds
  without fighting it is lowered to hang at the side, blade down.
- A strike follows its own attack ray: during the hit window the blade points along the ray as it
  sweeps, so what is seen to hit is what the hit trace tests. Before the window the arc runs back
  into a wind-up with the blade raised behind the shoulder, after it on into a follow-through, the
  arm bent at both ends and straight at contact. Combos wind up from where the last strike ended;
  a finished swing eases back to the guard. Charging holds the power attack's wind-up; blocking
  holds the blade across in front of the face.
- Holds stay at the body whatever the player looks at; strikes tilt with most of the view's pitch.
- The right arm reaches the grip and the left hand (`Avatar.reachLeftHand`) guards the chest,
  pulled the opposite way to the weapon. The torso turns with the swing (the grip's bearing from
  straight ahead times `SWING_TWIST_FACTOR`, at most `SWING_TWIST_MAX`), and while fighting the
  body squares up to the view at once.

Fishing tools and mining strokes reuse their first-person poses, moved down from the eyes to the
hands and tilted with the view about the shoulder (`heldToolPose`), so the shaft stays clear of the
body when looking down at the water. Bows and crossbows keep their first-person poses.

## Kick

The kick is posed on the body itself, so first and third person show the same leg
(`src/avatar/KickPose.ts`, applied by `Avatar.setKick`). The keys were authored and previewed in
Blender on the placeholder rig, at the kick animation's 24 fps: the knee chambers, the hips thrust
forward and the torso leans back as the leg extends heel first, then the knee re-chambers and the
foot is set down. Looking ahead gives a push kick at stomach height (fully out at frame 8, the
medium kick's hit event); looking down gives a front kick at knee height (frame 6). The ankle
target is in leg lengths from the hip, so the keys fit any rig; the kicking leg is bent by two-bone
IK with the knee towards a keyed direction, the foot turned by a keyed angle, and the standing foot
held where it was. In first person the view dips with the kick (the key's `look`) so the boot comes
up into view under the crosshair.

## Material roles

Name materials by role so customisation can recolour them later: `skin hair top bottom shoes
accessory`.

## Animations

In place, no root motion (hip x/z movement is stripped on load). Required: `idle`, `walk`, `run`,
`airborne`. Optional: `walk_back`. Set the ground speed each locomotion clip was authored for in
`CLIP_SPEEDS` (model units per second); playback is scaled to the player's real speed so feet do not
slide. Because the game walks faster than a realistic gait, walking clips play faster than authored
unless you author them for the game's speeds.

## Checking a model

```bash
npm run dev      # the console prints contract errors and falls back to the placeholder
```

Scroll the mouse wheel down in game to see the whole body from behind.
