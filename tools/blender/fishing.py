"""Fishing assets (run inside Blender): the bobber and fishing spot models, and the bobber and fish clips.

Builds a "Fishing" scene and writes
  public/models/fishing/bobber.glb  the float: red cap, white body, a black waterline mark at its origin
  public/models/fishing/spot.glb    a fishing spot: ripple rings and bubbles, one looping animation "spot"
  public/models/fishing/splash.glb  a net or harpoon going in: droplets and a ring, one animation "splash"
  public/models/fishing/rod.glb     the held fishing rod (spinning reel), along +Y from the hand
  public/models/fishing/fly_rod.glb the held fly fishing rod (fly reel at the butt)
  src/skills/FishingClips.ts        per-frame bobber and fish-jump motion, sampled at 30 fps

1 Blender unit = 1 tile; +Z up. The bobber's origin is its waterline mark, so a bobber at z > 0 shows the
mark above the water and a bite pulls it under (z < 0). Fish-jump axes: +X from the spot towards the
player as a fraction of the way (0..1), +Z height in tiles above the straight line from water to chest.
The open scene is left as it was. Set REPO before exec'ing this file, or run from the repository root.
"""
import math
import os

import bpy

REPO = globals().get("REPO") or os.getcwd()
MODELS = os.path.join(REPO, "public", "models", "fishing")
CLIPS_OUT = os.path.join(REPO, "src", "skills", "FishingClips.ts")
FPS = 30
D = math.radians


def material(name, rgba):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = 0.6
    if rgba[3] < 1:
        bsdf.inputs["Alpha"].default_value = rgba[3]
        if hasattr(m, "surface_render_method"):
            m.surface_render_method = "BLENDED"
    return m


def fcurves_of(obj):
    """The object's F-curves (Blender 4.4+ keeps them in the action's slot channelbag)."""
    ad = obj.animation_data
    if hasattr(ad.action, "fcurves"):
        return ad.action.fcurves
    from bpy_extras import anim_utils

    return anim_utils.action_get_channelbag_for_slot(ad.action, ad.action_slot).fcurves


def fresh(name, data, scene):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    return obj


def mesh_from_bmesh(name, build, materials):
    """A mesh from a bmesh builder; materials go on first (clearing them later resets face indices)."""
    import bmesh

    me = bpy.data.meshes.get(name) or bpy.data.meshes.new(name)
    me.materials.clear()
    for m in materials:
        me.materials.append(m)
    bm = bmesh.new()
    build(bm)
    bm.to_mesh(me)
    bm.free()
    return me


def build_bobber(scene):
    import bmesh

    red = material("bobber_red", (0.85, 0.08, 0.05, 1))
    white = material("bobber_white", (0.92, 0.92, 0.88, 1))
    black = material("bobber_mark", (0.02, 0.02, 0.02, 1))

    def body(bm):
        # Sphere of radius 0.07 centred 0.01 below the mark: white under the mark, red cap above.
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.07)
        for v in bm.verts:
            v.co.z -= 0.01
        for f in bm.faces:
            z = sum(v.co.z for v in f.verts) / len(f.verts)
            f.material_index = 0 if z > 0.006 else (2 if z > -0.006 else 1)
        # The antenna: a thin stick on top.
        bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.008, radius2=0.004, depth=0.09,
                              matrix=__import__("mathutils").Matrix.Translation((0, 0, 0.1)))
        for f in bm.faces:
            if f.calc_center_median().z > 0.055:
                f.material_index = 0

    me = mesh_from_bmesh("bobber", body, (red, white, black))
    return fresh("bobber", me, scene)


def build_spot(scene):
    import bmesh
    from mathutils import Matrix

    foam = material("spot_foam", (0.95, 0.97, 1.0, 0.7))
    root = fresh("spot", None, scene)
    parts = []
    for i in range(3):
        def ring(bm):
            bmesh.ops.create_circle(bm, cap_ends=False, segments=24, radius=0.5)
            # Give the ring width: extrude outwards a little.
            edges = list(bm.edges)
            res = bmesh.ops.extrude_edge_only(bm, edges=edges)
            verts = [e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)]
            bmesh.ops.scale(bm, vec=(1.12, 1.12, 1), verts=verts)
        me = mesh_from_bmesh(f"spot_ring{i}", ring, (foam,))
        obj = fresh(f"spot_ring{i}", me, scene)
        obj.parent = root
        obj.location = (0, 0, 0.02)
        parts.append(("ring", i, obj))
    for i in range(5):
        def bubble(bm):
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.035)
        me = mesh_from_bmesh(f"spot_bubble{i}", bubble, (foam,))
        obj = fresh(f"spot_bubble{i}", me, scene)
        obj.parent = root
        a = i * 2.4
        obj.location = (math.cos(a) * 0.25 * (1 + i % 2), math.sin(a) * 0.25 * (1 + i % 2), 0)
        parts.append(("bubble", i, obj))

    # One 60-frame loop: rings grow from 0.3 to 1.6 one after another; bubbles pop up and burst.
    length = 60
    for kind, i, obj in parts:
        obj.animation_data_clear()
        if kind == "ring":
            start = i * 20
            for f, s in ((0, 0.3), (60, 1.6)):
                frame = start + f
                obj.scale = (s, s, 1)
                obj.keyframe_insert("scale", frame=frame)
            # Wrap the cycle so the loop is seamless: the curve repeats every 60 frames.
            for fc in fcurves_of(obj):
                fc.modifiers.new("CYCLES")
                for k in fc.keyframe_points:
                    k.interpolation = "LINEAR"
        else:
            start = (i * 13) % length
            x, y, _ = obj.location
            for f, z, s in ((0, -0.04, 0.2), (6, 0.03, 1.0), (14, 0.05, 1.3), (16, 0.05, 0.01), (60, -0.04, 0.01)):
                obj.location = (x, y, z)
                obj.scale = (s, s, s)
                obj.keyframe_insert("location", frame=start + f)
                obj.keyframe_insert("scale", frame=start + f)
            for fc in fcurves_of(obj):
                fc.modifiers.new("CYCLES")
        obj.animation_data.action.name = f"spot_{obj.name}"
    return root, [p[2] for p in parts], length


def build_rod(scene, name, fly):
    """A held rod along +Z from the hand (origin): cork grips, reel seat, tapered blank, guides and reel.

    The guides and reel hang on the -Y side (the glTF's +Z, the weapon contract's edge side), which the
    game's rod pose turns downward. A spinning rod has its reel in front of the hand; a fly rod has a
    fly reel at the butt, below the hand.
    """
    import bmesh
    from mathutils import Matrix

    length = 1.85 if fly else 1.6
    cork = material("rod_cork", (0.72, 0.53, 0.32, 1))
    blank = material("rod_fly_blank" if fly else "rod_blank", (0.55, 0.33, 0.12, 1) if fly else (0.04, 0.16, 0.1, 1))
    metal = material("rod_metal", (0.62, 0.64, 0.68, 1))
    dark = material("rod_dark", (0.05, 0.05, 0.06, 1))
    thread = material("rod_thread", (0.55, 0.05, 0.05, 1) if not fly else (0.1, 0.25, 0.12, 1))
    mats = (cork, blank, metal, dark, thread)
    CORK, BLANK, METAL, DARK, THREAD = range(5)

    def tube(bm, z0, z1, r0, r1, mat, segs=12, y=0.0):
        before = set(bm.faces)
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r0, radius2=r1, depth=z1 - z0,
                              matrix=Matrix.Translation((0, y, (z0 + z1) / 2)))
        for f in set(bm.faces) - before:
            f.material_index = mat

    def blank_r(z):
        t = (z - 0.2) / (length - 0.2)
        return 0.011 * (1 - t) + 0.0025 * t

    def ring(bm, z, r, mat, offset):
        before = set(bm.faces)
        bmesh.ops.create_cone(bm, cap_ends=False, segments=10, radius1=r, radius2=r, depth=0.004,
                              matrix=Matrix.Translation((0, -offset, z)))
        for f in set(bm.faces) - before:
            f.material_index = mat

    def build(bm):
        # Butt cap and rear grip.
        tube(bm, -0.3, -0.28, 0.02, 0.022, DARK)
        tube(bm, -0.28, -0.02 if not fly else 0.18, 0.022, 0.02, CORK)
        if fly:
            # Fly reel seat at the butt, the grip above it.
            tube(bm, -0.27, -0.12, 0.016, 0.016, METAL)
        else:
            tube(bm, -0.02, 0.09, 0.017, 0.017, METAL)
            tube(bm, 0.09, 0.2, 0.019, 0.014, CORK)
        tube(bm, 0.18 if fly else 0.2, length, blank_r(0.2), blank_r(length), BLANK, segs=8)
        tube(bm, 0.2, 0.215, 0.015, 0.014, THREAD)
        # Guides: wrapped feet and rings stepping down towards the tip.
        guides = [0.45, 0.72, 0.96, 1.18, 1.36, 1.5] if not fly else [0.5, 0.78, 1.02, 1.24, 1.44, 1.62, 1.76]
        for i, z in enumerate(guides):
            r = 0.026 * (1 - i / len(guides)) + 0.006
            tube(bm, z - 0.012, z + 0.012, blank_r(z) + 0.0015, blank_r(z) + 0.0015, THREAD, segs=8)
            ring(bm, z, r, METAL, blank_r(z) + r + 0.006)
            # The stem from the blank to the ring.
            before = set(bm.faces)
            bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation((0, -(blank_r(z) + 0.003), z)) @ Matrix.Diagonal((0.003, 0.012, 0.01, 1)))
            for f in set(bm.faces) - before:
                f.material_index = METAL
        tube(bm, length - 0.006, length + 0.004, 0.004, 0.004, METAL, segs=8)
        if fly:
            # Fly reel: a wide disc, its axle across the rod (X), below the seat.
            before = set(bm.faces)
            bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=0.05, radius2=0.05, depth=0.028,
                                  matrix=Matrix.Translation((0, -0.065, -0.2)) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
            for f in set(bm.faces) - before:
                f.material_index = DARK
            before = set(bm.faces)
            bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.006, radius2=0.006, depth=0.02,
                                  matrix=Matrix.Translation((0.024, -0.095, -0.2)) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
            bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation((0, -0.017, -0.2)) @ Matrix.Diagonal((0.008, 0.012, 0.05, 1)))
            for f in set(bm.faces) - before:
                f.material_index = METAL
        else:
            # Spinning reel: a foot down from the seat, the body, the spool along the rod and a crank.
            before = set(bm.faces)
            bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation((0, -0.04, 0.035)) @ Matrix.Diagonal((0.008, 0.05, 0.03, 1)))
            for f in set(bm.faces) - before:
                f.material_index = METAL
            before = set(bm.faces)
            bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.03,
                                      matrix=Matrix.Translation((0, -0.075, 0.02)) @ Matrix.Diagonal((0.9, 1, 1.2, 1)))
            for f in set(bm.faces) - before:
                f.material_index = DARK
            tube(bm, 0.045, 0.085, 0.032, 0.028, METAL, y=-0.075)
            before = set(bm.faces)
            bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation((0.045, -0.075, 0.02)) @ Matrix.Diagonal((0.04, 0.006, 0.008, 1)))
            bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.008, radius2=0.007, depth=0.022,
                                  matrix=Matrix.Translation((0.065, -0.09, 0.02)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
            for f in set(bm.faces) - before:
                f.material_index = DARK

    me = mesh_from_bmesh(name, build, mats)
    for p in me.polygons:
        p.use_smooth = True
    return fresh(name, me, scene)


def build_splash(scene):
    """A splash where a net or harpoon goes in: a crown of droplets and a spreading ring. One shot, 24 frames."""
    import bmesh

    foam = material("spot_foam", (0.95, 0.97, 1.0, 0.7))
    root = fresh("splash", None, scene)
    parts = []

    def ring(bm):
        bmesh.ops.create_circle(bm, cap_ends=False, segments=24, radius=0.3)
        res = bmesh.ops.extrude_edge_only(bm, edges=list(bm.edges))
        verts = [e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)]
        bmesh.ops.scale(bm, vec=(1.2, 1.2, 1), verts=verts)

    o = fresh("splash_ring", mesh_from_bmesh("splash_ring", ring, (foam,)), scene)
    o.parent = root
    for f, s in ((0, 0.2), (8, 1.0), (24, 1.8)):
        o.scale = (s, s, 1)
        o.location = (0, 0, 0.02)
        o.keyframe_insert("scale", frame=f)
    parts.append(o)
    for i in range(9):
        o = fresh(f"splash_drop{i}", mesh_from_bmesh(f"splash_drop{i}", lambda bm: bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.03), (foam,)), scene)
        o.parent = root
        a = i * 2 * math.pi / 9 + (0.3 if i % 2 else 0)
        out = 0.35 + 0.1 * (i % 3)
        up = 0.45 + 0.15 * ((i * 5) % 3)
        for f in range(0, 25, 3):
            t = f / 24
            z = up * 4 * t * (1 - t) - (0.1 if t > 0.9 else 0)
            o.location = (math.cos(a) * out * t, math.sin(a) * out * t, z)
            s = 1.0 if t < 0.85 else 0.01
            o.scale = (s, s, s * 1.4)
            o.keyframe_insert("location", frame=f)
            o.keyframe_insert("scale", frame=f)
        parts.append(o)
    for o in parts:
        o.animation_data.action.name = f"splash_{o.name}"
    return root, parts, 24


# Clip -> (frames, {channel: [(frame, value)]}); loc.* in tiles, rot.* in degrees.
CLIPS = {
    # Floating: the mark rides just above the water.
    "bobberIdle": (60, {"loc.z": [(0, 0.02), (15, 0.012), (30, 0.022), (45, 0.014), (60, 0.02)],
                        "rot.x": [(0, 0), (20, 4), (40, -3), (60, 0)]}),
    # A nibble: quick small dips that touch the water at the mark but do not take it under.
    "bobberNibble": (18, {"loc.z": [(0, 0.02), (3, 0.002), (6, 0.018), (9, 0.004), (13, 0.02), (18, 0.02)],
                          "rot.y": [(0, 0), (3, 10), (9, -8), (18, 0)]}),
    # A bite: the float is pulled down past the mark and held under, twitching.
    "bobberBite": (30, {"loc.z": [(0, 0.02), (3, -0.07), (8, -0.06), (14, -0.08), (22, -0.065), (30, -0.075)],
                        "rot.x": [(0, 0), (3, 25), (10, 15), (18, 28), (30, 18)]}),
    # A caught fish: bursts out of the water, arcs over and drops into the player's arms.
    "fishJump": (27, {"loc.x": [(0, 0), (4, 0.08), (16, 0.6), (27, 1.0)],
                      "loc.z": [(0, -0.1), (4, 0.4), (13, 1.1), (21, 0.6), (27, 0)],
                      "rot.y": [(0, -60), (8, 0), (16, 80), (27, 140)],
                      "rot.z": [(0, 0), (3, 25), (6, -25), (9, 20), (12, -15), (27, 0)]}),
}
PATHS = {"loc": "location", "rot": "rotation_euler", "scale": "scale"}
AXES = {"x": 0, "y": 1, "z": 2}


def build_clips(scene):
    objects = {}
    for name, (length, channels) in CLIPS.items():
        obj = fresh("clip_" + name, None, scene)
        obj.empty_display_type = "SINGLE_ARROW"
        for channel, keys in channels.items():
            kind, axis = channel.split(".")
            for frame, value in keys:
                getattr(obj, PATHS[kind])[AXES[axis]] = D(value) if kind == "rot" else value
                obj.keyframe_insert(data_path=PATHS[kind], index=AXES[axis], frame=frame)
        obj.animation_data.action.name = name
        objects[name] = obj
    return objects


def sample(scene, objects):
    out = {}
    for name, obj in objects.items():
        frames = []
        for f in range(CLIPS[name][0] + 1):
            scene.frame_set(f)
            m = obj.matrix_basis
            loc, q = m.to_translation(), m.to_quaternion()
            frames.append([round(loc.x, 4), round(loc.y, 4), round(loc.z, 4), round(q.x, 5), round(q.y, 5), round(q.z, 5), round(q.w, 5)])
        out[name] = frames
    return out


def write_clips(clips):
    lines = [
        "// Generated by tools/blender/fishing.py (run in Blender); do not edit.",
        "//",
        "// Per frame at FISHING_CLIP_FPS: offset x, y, z (tiles) and rotation quaternion x, y, z, w. Bobber",
        "// clips: z of the waterline mark above the water. fishJump: x the fraction of the way from the spot",
        "// to the player, z the height above the straight line from the water to the player's chest.",
        "",
        f"export const FISHING_CLIP_FPS = {FPS};",
        "",
        "export const FISHING_CLIPS = {",
    ]
    for name, frames in clips.items():
        lines.append(f"    {name}: [")
        lines += ["        [" + ", ".join(repr(v) for v in fr) + "]," for fr in frames]
        lines.append("    ],")
    lines += ["} as const satisfies Record<string, readonly (readonly number[])[]>;", "",
              "export type FishingClip = keyof typeof FISHING_CLIPS;", ""]
    with open(CLIPS_OUT, "w", newline="\n") as f:
        f.write("\n".join(lines))


def export_glb(path, objects, scene):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, use_active_scene=True, export_yup=True,
                              export_apply=True, export_animations=bool(scene.get("animate")),
                              export_animation_mode="NLA_TRACKS" if scene.get("nla") else "ACTIONS",
                              export_materials="EXPORT")


window = bpy.context.window
previous = window.scene if window else bpy.context.scene
scene = bpy.data.scenes.get("Fishing") or bpy.data.scenes.new("Fishing")
scene.render.fps = FPS
if window:
    window.scene = scene
os.makedirs(MODELS, exist_ok=True)
try:
    bobber = build_bobber(scene)
    bobber.location = (-2, 0, 0)
    spot, spot_parts, spot_len = build_spot(scene)
    clips = build_clips(scene)
    scene.frame_start, scene.frame_end = 0, spot_len - 1
    write_clips(sample(scene, clips))
    bobber.location = (0, 0, 0)
    scene["animate"] = False
    export_glb(os.path.join(MODELS, "bobber.glb"), [bobber], scene)
    # The spot's parts each carry their own looping action; push them onto one NLA track named
    # "spot" per object so the exporter merges them into a single animation.
    for o in spot_parts:
        ad = o.animation_data
        track = ad.nla_tracks.new()
        track.name = "spot"
        strip = track.strips.new("spot", 0, ad.action)
        strip.action_frame_end = spot_len
        ad.action = None
    scene["animate"] = True
    scene["nla"] = True
    scene.frame_end = spot_len
    export_glb(os.path.join(MODELS, "spot.glb"), [spot] + spot_parts, scene)
    splash, splash_parts, splash_len = build_splash(scene)
    for o in splash_parts:
        ad = o.animation_data
        track = ad.nla_tracks.new()
        track.name = "splash"
        strip = track.strips.new("splash", 0, ad.action)
        strip.action_frame_end = splash_len
        ad.action = None
    scene.frame_end = splash_len
    export_glb(os.path.join(MODELS, "splash.glb"), [splash] + splash_parts, scene)
    scene["animate"] = False
    scene["nla"] = False
    for name, fly in (("rod", False), ("fly_rod", True)):
        rod = build_rod(scene, name, fly)
        export_glb(os.path.join(MODELS, f"{name}.glb"), [rod], scene)
        rod.location = (2 + fly * 0.3, 0, 0)
    splash.location = (0, 2, 0)
    bobber.location = (-2, 0, 0)
finally:
    scene.frame_set(0)
    if window:
        window.scene = previous

result = {"models": sorted(os.listdir(MODELS)), "clips": {k: v[0] + 1 for k, v in CLIPS.items()}}
