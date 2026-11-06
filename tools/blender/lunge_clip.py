"""Generic lunge attack for NPCs the cache has no attack for (run inside Blender).

One body-root curve: gather back, lunge forward and down into the blow, recover. Keyed on an
empty with Blender's easing, then sampled per frame. The game turns the whole body by `pitch`
(radians, + leans forward) about its root and moves it `forward` and `lift` (shares of the body's
height), time-warped so IMPACT_FRAME lands on the strike's impact.
"""
import json
import math

import bpy

FPS = 30
IMPACT_FRAME = 11
LENGTH = 24
OUT = globals().get('LUNGE_OUT') or bpy.path.abspath('//lunge_clip.json')

# (frame, pitch degrees, forward, lift): anticipation, strike, follow-through, recovery.
KEYS = [
    (0, 0, 0, 0),
    (6, -9, -0.035, 0.01),
    (8, -10, -0.04, 0.012),
    (IMPACT_FRAME, 16, 0.11, -0.03),
    (14, 13, 0.1, -0.025),
    (19, 2, 0.02, 0),
    (LENGTH, 0, 0, 0),
]

empty = bpy.data.objects.get('LungeRoot') or bpy.data.objects.new('LungeRoot', None)
if empty.name not in bpy.context.scene.collection.objects:
    bpy.context.scene.collection.objects.link(empty)
empty.animation_data_clear()
for f, pitch, forward, lift in KEYS:
    empty.rotation_euler = (math.radians(pitch), 0, 0)
    empty.location = (0, forward, lift)
    empty.keyframe_insert('rotation_euler', frame=f, index=0)
    empty.keyframe_insert('location', frame=f, index=1)
    empty.keyframe_insert('location', frame=f, index=2)

frames = []
for f in range(LENGTH + 1):
    bpy.context.scene.frame_set(f)
    frames.append([round(empty.rotation_euler.x, 4), round(empty.location.y, 4), round(empty.location.z, 4)])
json.dump({'fps': FPS, 'impactFrame': IMPACT_FRAME, 'frames': frames}, open(OUT, 'w'))
LUNGE_SUMMARY = {'frames': len(frames), 'peak_pitch_deg': round(math.degrees(max(p for p, _, _ in frames)), 1)}
