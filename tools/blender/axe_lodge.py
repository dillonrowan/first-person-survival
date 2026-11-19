"""A blade stopped dead where it met something, as offset clips (run inside Blender).

Builds an "AxeLodge" scene with an empty for the held weapon's grip and a stand-in axe parented to
it, keyframes each clip as its own action, samples every frame at 30 fps and writes
src/combat/LodgeClip.ts. Each clip is an offset from the pose the swing had at contact (WeaponView).

"lodge": the blade bites into a tree and is worked free.
  frames 0-1   the swing's momentum drives the bit a little deeper, then it rebounds and settles
  frames 2-8   stuck fast: nothing moves but the hand's judder (WeaponView adds that)
  frames 8-12  the handle is twisted side to side to work the bit loose
  frames 12-15 it is wrenched back out towards the player, ready to go back to the guard

"blocked": the blade is met by an enemy's guard (a blow that does 0) and does not bite.
  frames 0-1   stopped dead, then knocked back off the guard, against the edge and towards the player
  frames 1-5   the jar shudders through the handle, dying away
  frames 5-10  drawn back towards the player, ready to go back to the guard

Axes are the weapon model's (docs/weapon-models.md), so Blender X/Y/Z read straight across: the
grip at the origin, the blade along +Y, the edge facing +Z. Rotation is about the grip in those
axes (rot.x > 0 tips the head the way the edge faces, deeper into the cut; rot.y twists the
handle). Offsets (loc.*) are in camera space, tiles: +x right, +y up, +z back towards the eye.
The open scene is left as it was; the AxeLodge scene stays in the file for a look, with one action
per clip (kept with a fake user; the last one built is assigned to the grip).

Run from the repository root's Blender session, or set REPO before exec'ing this file.
"""
import math
import os

import bpy

REPO = globals().get("REPO") or os.getcwd()
OUT = os.path.join(REPO, "src", "combat", "LodgeClip.ts")
FPS = 30
D = math.radians

# clip -> (length in frames, channel -> [(frame, value)]); rot.* in degrees, loc.* in tiles.
CLIPS = {
    "lodge": (15, {
        "rot.x": [(0, 0), (1, 3), (3, 1.4), (5, 2), (8, 2), (12, 0.5), (14, -9), (15, -10)],
        "rot.y": [(0, 0), (8, 0), (9, 7), (10, -6), (11, 4), (12, -1), (15, 0)],
        "loc.y": [(0, 0), (12, 0), (15, 0.03)],
        "loc.z": [(0, 0), (1, -0.012), (3, 0), (12, 0), (14, 0.06), (15, 0.07)],
    }),
    "blocked": (10, {
        "rot.x": [(0, 0), (1, -7), (2, -5), (3, -6), (5, -5), (8, -9), (10, -10)],
        "rot.y": [(0, 0), (1, 5), (2, -4), (3, 3), (4, -1.5), (5, 0), (10, 0)],
        "loc.x": [(0, 0), (1, 0.008), (2, -0.005), (3, 0.002), (5, 0), (10, 0)],
        "loc.y": [(0, 0), (5, 0), (10, 0.03)],
        "loc.z": [(0, 0), (1, 0.03), (3, 0.022), (5, 0.025), (8, 0.06), (10, 0.07)],
    }),
}

# What each clip is called in LodgeClip.ts, with its doc comments.
EXPORTS = {
    "lodge": ("LODGE_CLIP", "A blade lodged in a tree and worked free.",
              "LODGE_SECONDS", "Seconds the blade stays lodged and is worked free."),
    "blocked": ("BLOCKED_CLIP", "A blade stopped by an enemy's guard, knocked back and drawn in.",
                "BLOCKED_SECONDS", "Seconds a blade stopped by a guard takes to recover."),
}

PATHS = {"loc": "location", "rot": "rotation_euler"}
AXES = {"x": 0, "y": 1, "z": 2}


def stand_in_axe(scene, grip):
    """A haft along +Y and a head at its top with the bit towards +Z, to watch the clip by."""
    for name, size, at in (("haft", (0.03, 0.75, 0.03), (0, 0.375, 0)), ("head", (0.02, 0.12, 0.2), (0, 0.7, 0.07))):
        obj = bpy.data.objects.get("axe_" + name)
        if obj is None:
            mesh = bpy.data.meshes.new("axe_" + name)
            obj = bpy.data.objects.new("axe_" + name, mesh)
            import bmesh

            bm = bmesh.new()
            bmesh.ops.create_cube(bm, size=1)
            bm.to_mesh(mesh)
            bm.free()
        if obj.name not in scene.collection.objects:
            scene.collection.objects.link(obj)
        obj.parent = grip
        obj.scale = size
        obj.location = at


def build(scene, name, channels):
    """Keys `channels` onto the grip empty as a fresh action called `name`."""
    grip = bpy.data.objects.get("lodge_grip") or bpy.data.objects.new("lodge_grip", None)
    if grip.name not in scene.collection.objects:
        scene.collection.objects.link(grip)
    grip.empty_display_type = "ARROWS"
    grip.animation_data_clear()
    old = bpy.data.actions.get(name)
    if old is not None:
        bpy.data.actions.remove(old)
    grip.rotation_mode = "XYZ"
    grip.location = (0, 0, 0)
    grip.rotation_euler = (0, 0, 0)
    for channel, keys in channels.items():
        kind, axis = channel.split(".")
        path, index = PATHS[kind], AXES[axis]
        for frame, value in keys:
            getattr(grip, path)[index] = D(value) if kind == "rot" else value
            grip.keyframe_insert(data_path=path, index=index, frame=frame)
        getattr(grip, path)[index] = 0
    grip.animation_data.action.name = name
    grip.animation_data.action.use_fake_user = True
    stand_in_axe(scene, grip)
    return grip


def sample(scene, grip, length):
    frames = []
    for f in range(length + 1):
        scene.frame_set(f)
        loc = grip.matrix_basis.to_translation()
        q = grip.matrix_basis.to_quaternion()
        frames.append([round(loc.x, 4), round(loc.y, 4), round(loc.z, 4), round(q.x, 5), round(q.y, 5), round(q.z, 5), round(q.w, 5)])
    return frames


def write(sampled):
    lines = [
        "// Generated by tools/blender/axe_lodge.py (run in Blender); do not edit.",
        "//",
        "// A blade stopped where it met something, per frame at LODGE_FPS: offset x, y, z (camera space,",
        "// tiles) and rotation quaternion x, y, z, w about the grip (weapon model axes: blade +Y, edge",
        "// +Z), applied to the pose the swing had at contact.",
        "",
        f"export const LODGE_FPS = {FPS};",
    ]
    for name, frames in sampled.items():
        const, doc, seconds, seconds_doc = EXPORTS[name]
        lines += ["", f"/** {doc} */", f"export const {const}: readonly (readonly number[])[] = ["]
        lines += ["    [" + ", ".join(repr(v) for v in fr) + "]," for fr in frames]
        lines += ["];", "", f"/** {seconds_doc} */", f"export const {seconds} = ({const}.length - 1) / LODGE_FPS;"]
    lines.append("")
    with open(OUT, "w", newline="\n") as f:
        f.write("\n".join(lines))


window = bpy.context.window
previous = window.scene if window else bpy.context.scene
scene = bpy.data.scenes.get("AxeLodge") or bpy.data.scenes.new("AxeLodge")
scene.render.fps = FPS
scene.frame_start = 0
if window:
    window.scene = scene
sampled = {}
try:
    for name, (length, channels) in CLIPS.items():
        scene.frame_end = length
        sampled[name] = sample(scene, build(scene, name, channels), length)
    write(sampled)
finally:
    scene.frame_set(0)
    if window:
        window.scene = previous

result = {"written": OUT, "frames": {name: len(frames) for name, frames in sampled.items()}}
