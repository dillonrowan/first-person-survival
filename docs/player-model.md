# Player character: art contract

The player's body is a rigged glTF character at `public/models/player.glb`. If the file is missing
or breaks the contract below, the game logs why and uses a built-in placeholder, so you can build
and test everything before the art exists. Make the character yourself or commission one; do not
extract Jagex's models.

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

Meshes for the head, hair and headwear are separate objects whose names start with `head_`
(for example `head_skull`, `head_hair`). They are hidden in first person. Without any, the head
bone is shrunk instead (a warning).

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

Press `V` in a dev build to see the whole body from behind.
