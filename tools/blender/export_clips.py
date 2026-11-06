"""Bakes every hit clip (IK included) to per-frame joint rotations in three.js model axes.

Run in Blender after hit_clips.py; then `npx tsx tools/blender/gen_hit_clips.ts` writes src/npc/HitClips.ts.
"""
import json
import bpy

OUT = globals().get('CLIPS_OUT') or bpy.path.abspath('//hit_clips.json')
BONES = ['pelvis', 'spine', 'head', 'upperarm.R', 'forearm.R', 'hand.R', 'upperarm.L', 'forearm.L', 'hand.L',
         'thigh.R', 'shin.R', 'foot.R', 'thigh.L', 'shin.L', 'foot.L']
rig = bpy.data.objects['GuardRig']
scene = bpy.context.scene


def three_q(q):
    return [round(q.x, 5), round(q.z, 5), round(-q.y, 5), round(q.w, 5)]


def three_v(v):
    return [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]


clips = {}
worst = 0.0
for name in CLIPS:
    rig.animation_data.action = bpy.data.actions[name]
    frames = []
    for f in range(CLIPS[name]['length'] + 1):
        scene.frame_set(f)
        delta = {b: rig.pose.bones[b].matrix @ rig.pose.bones[b].bone.matrix_local.inverted() for b in BONES}
        rots = []
        for b in BONES:
            pb = rig.pose.bones[b]
            parent = pb.parent.name if pb.parent else None
            local = delta[b] if parent is None else delta[parent].inverted() @ delta[b]
            if parent is not None:
                head = pb.bone.head_local
                worst = max(worst, (local @ head - head).length)
            q = local.to_quaternion()
            if q.w < 0:
                q.negate()
            rots += three_q(q)
        head = rig.pose.bones['pelvis'].bone.head_local
        frames.append({'r': rots, 't': three_v(delta['pelvis'] @ head - head)})
    clips[name] = {'fps': scene.render.fps, 'loop': name == 'stun', 'frames': frames}

# Bone joints in three.js model space, so the game can scale the clips' offsets to each body.
joints = [three_v(rig.pose.bones[b].bone.head_local) for b in BONES]
json.dump({'bones': BONES, 'joints': joints, 'clips': clips}, open(OUT, 'w'))
SUMMARY = {'clips': len(clips), 'joint_drift': worst}
