"""Leg sanity check for every hit clip (run in Blender after hit_clips.py).

LEG_REPORT: per clip, the least forward a bent knee points (1 = straight ahead), its largest
sideways drift and the closest the two legs come, plus how far IK twists the legs at rest.
"""
import bpy
from mathutils import geometry

rig = bpy.data.objects['GuardRig']
scene = bpy.context.scene


def head(name):
    return rig.pose.bones[name].head.copy()


action = rig.animation_data.action
rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.location = (0, 0, 0)
bpy.context.view_layer.update()
REST_TWIST = max(
    rig.pose.bones[k + s].matrix.to_quaternion().rotation_difference(rig.pose.bones[k + s].bone.matrix_local.to_quaternion()).angle
    for k in ('thigh.', 'shin.') for s in ('R', 'L')
)

LEG_REPORT = {}
for name, clip in CLIPS.items():
    rig.animation_data.action = bpy.data.actions[name]
    worst = {'knee_forward': 1.0, 'knee_side': 0.0, 'leg_gap': 9.0}
    for f in range(clip['length'] + 1):
        scene.frame_set(f)
        for s in ('R', 'L'):
            hip, knee, ankle = head('thigh.' + s), head('shin.' + s), head('foot.' + s)
            closest, _ = geometry.intersect_point_line(knee, hip, ankle)
            off = knee - closest
            if off.length > 0.01:
                worst['knee_forward'] = min(worst['knee_forward'], round(-off.y / off.length, 2))
            worst['knee_side'] = max(worst['knee_side'], round(abs(off.x), 3))
        for a in (('thigh.R', 'shin.R'), ('shin.R', 'foot.R')):
            for b in (('thigh.L', 'shin.L'), ('shin.L', 'foot.L')):
                a0, a1, b0, b1 = head(a[0]), head(a[1]), head(b[0]), head(b[1])
                gap = min((a0.lerp(a1, i / 10) - b0.lerp(b1, j / 10)).length for i in range(11) for j in range(11))
                worst['leg_gap'] = round(min(worst['leg_gap'], gap), 3)
    LEG_REPORT[name] = worst
rig.animation_data.action = action
