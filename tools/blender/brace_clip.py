"""Generic brace against a blow that does nothing, for NPCs without a human body (run inside Blender).

One body-root curve, like lunge_clip.py: the body flinches back from the blow and hunkers down
behind its front, takes the jolt when the blow lands (frame IMPACT_FRAME), holds, then recovers.
The game turns the whole body by `pitch` (radians, + leans forward) about its root and moves it
`forward` and `lift` (shares of the body's height). Keyed on the empty BraceRoot in the scene
SCENE (default: the hit-reaction scene) with Blender's easing, then sampled from its curves, so the
window's scene is never touched.
"""
import json
import math

import bpy
from bpy_extras import anim_utils

FPS = 30
IMPACT_FRAME = 4
LENGTH = 24
OUT = globals().get('BRACE_OUT') or bpy.path.abspath('//brace_clip.json')
scene = bpy.data.scenes[globals().get('SCENE', 'HitReactions')]

# (frame, pitch degrees, forward, lift): shy back and hunker, jolt, hold, recover.
KEYS = [
    (0, 0, 0, 0),
    (2, -10, -0.04, -0.03),
    (IMPACT_FRAME, -16, -0.08, -0.05),
    (6, -13, -0.07, -0.045),
    (11, -11, -0.05, -0.04),
    (LENGTH, 0, 0, 0),
]

empty = bpy.data.objects.get('BraceRoot') or bpy.data.objects.new('BraceRoot', None)
if empty.name not in scene.collection.objects:
    scene.collection.objects.link(empty)
empty.animation_data_clear()
old = bpy.data.actions.get('BraceRootAction')
if old:
    bpy.data.actions.remove(old)
for f, pitch, forward, lift in KEYS:
    empty.rotation_euler = (math.radians(pitch), 0, 0)
    empty.location = (0, forward, lift)
    empty.keyframe_insert('rotation_euler', frame=f, index=0)
    empty.keyframe_insert('location', frame=f, index=1)
    empty.keyframe_insert('location', frame=f, index=2)
action = empty.animation_data.action
action.name = 'BraceRootAction'
bag = anim_utils.action_get_channelbag_for_slot(action, empty.animation_data.action_slot)
curve = {(fc.data_path, fc.array_index): fc for fc in bag.fcurves}

frames = []
for f in range(LENGTH + 1):
    frames.append([
        round(curve[('rotation_euler', 0)].evaluate(f), 4),
        round(curve[('location', 1)].evaluate(f), 4),
        round(curve[('location', 2)].evaluate(f), 4),
    ])
json.dump({'fps': FPS, 'impactFrame': IMPACT_FRAME, 'frames': frames}, open(OUT, 'w'))
BRACE_SUMMARY = {'frames': len(frames), 'deepest_pitch_deg': round(math.degrees(min(p for p, _, _ in frames)), 1)}
