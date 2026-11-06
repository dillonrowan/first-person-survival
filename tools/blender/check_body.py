"""Whole-body anatomy check for every hit clip (run in Blender after hit_clips.py).

BODY_REPORT lists, per clip, every problem found:
  - a bone not at rest on the first frame (clips start from the NPC's own pose),
  - a limb twisted about its own length beyond what a human joint allows,
  - an elbow or knee turning off its hinge or bending the wrong way,
  - a bone turned past a human range.
"""
import math

import bpy
from mathutils import Vector

rig = bpy.data.objects['GuardRig']
scene = bpy.context.scene
BONES = ['pelvis', 'spine', 'head', 'upperarm.R', 'forearm.R', 'hand.R', 'upperarm.L', 'forearm.L', 'hand.L',
         'thigh.R', 'shin.R', 'foot.R', 'thigh.L', 'shin.L', 'foot.L']
# Largest total turn (degrees) and twist about the bone's own length a human joint takes in a hit.
RANGE = {'pelvis': 20, 'spine': 45, 'head': 50, 'upperarm': 110, 'forearm': 130, 'hand': 40,
         'thigh': 80, 'shin': 120, 'foot': 50}
TWIST = {'pelvis': 20, 'spine': 25, 'head': 45, 'upperarm': 40, 'forearm': 20, 'hand': 30,
         'thigh': 25, 'shin': 10, 'foot': 25}
HINGES = {'shin': 1, 'forearm': -1}  # flexion sign about the model's side axis (+X): knees back, elbows forward


def local_delta(name):
    """The bone's turn relative to its parent, in model axes."""
    pb = rig.pose.bones[name]
    d = pb.matrix @ pb.bone.matrix_local.inverted()
    if pb.parent:
        pp = pb.parent
        d = (pp.matrix @ pp.bone.matrix_local.inverted()).inverted() @ d
    q = d.to_quaternion()
    return q if q.w >= 0 else -q


def twist_about(q, axis):
    """Signed twist (degrees) of q about a unit axis (swing-twist decomposition)."""
    v = Vector((q.x, q.y, q.z))
    p = axis * v.dot(axis)
    return math.degrees(2 * math.atan2(p.length * (1 if v.dot(axis) >= 0 else -1), q.w))


BODY_REPORT = {}
action = rig.animation_data.action
for name, clip in CLIPS.items():
    rig.animation_data.action = bpy.data.actions[name]
    problems = {}

    def note(key, value):
        problems[key] = max(problems.get(key, 0), round(value, 1))

    for f in range(clip['length'] + 1):
        scene.frame_set(f)
        for b in BONES:
            kind = b.split('.')[0]
            q = local_delta(b)
            angle = math.degrees(q.angle)
            if f == 0 and name != 'stun' and angle > 1:
                note(f'{b} not at rest on frame 0', angle)
            if angle > RANGE[kind]:
                note(f'{b} turned past {RANGE[kind]} deg', angle)
            along = (rig.pose.bones[b].bone.tail_local - rig.pose.bones[b].bone.head_local).normalized()
            twist = abs(twist_about(q, along))
            if twist > TWIST[kind]:
                note(f'{b} twisted past {TWIST[kind]} deg', twist)
            if kind in HINGES and angle > 3:
                flex = twist_about(q, Vector((1, 0, 0)))
                if flex * HINGES[kind] < -3:
                    note(f'{b} bends the wrong way', -flex * HINGES[kind])
                off = math.degrees(Vector((q.x, q.y, q.z)).normalized().angle(Vector((1, 0, 0))))
                off = min(off, 180 - off)
                if off > 25:
                    note(f'{b} off its hinge', off)
    BODY_REPORT[name] = problems
rig.animation_data.action = action
