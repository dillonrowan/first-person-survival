"""Builds the humanoid hit-reaction rig in Blender from an exported NPC (tools/blender/export_npc.ts).

Run inside Blender with RIG_SOURCE set to the exported JSON, e.g. a Guard (npcs/4660_4660.bin).
Bones sit on the model's part pivots, so the clips map straight onto the game's body parts.
"""
import math
import json

import bpy
from mathutils import Vector

SOURCE = globals().get('RIG_SOURCE') or bpy.path.abspath('//guard.json')
# Part index of each bone in the standard humanoid layout (parents -1,0,0,0,1,1,1,2,3,5,6,7,8,9,10).
NAMES = {0: 'pelvis', 1: 'spine', 2: 'thigh.R', 3: 'thigh.L', 4: 'head', 5: 'upperarm.R', 6: 'upperarm.L',
         7: 'shin.R', 8: 'shin.L', 9: 'forearm.R', 10: 'forearm.L', 11: 'foot.R', 12: 'foot.L', 13: 'hand.R', 14: 'hand.L'}


def b(x, y, z):
    """three.js model space (Y up, faces +Z) to Blender (Z up, faces -Y)."""
    return Vector((x, -z, y))


g = json.load(open(SOURCE))
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene
scene.render.fps = 30

parents = g['parents']
P = len(parents)
piv = [b(*g['pivots'][p * 3:p * 3 + 3]) for p in range(P)]
n = g['vertexCount']
pos = g['idle0']
verts = [b(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) for i in range(n)]

me = bpy.data.meshes.new('GuardMesh')
faces, fcols = [], []
for mesh in g['meshes']:
    idx = mesh['indices']
    for f in range(0, len(idx), 3):
        tri = (idx[f], idx[f + 1], idx[f + 2])
        if len(set(tri)) == 3:
            faces.append(tri)
            fcols.append(mesh['colors'][f:f + 3])
me.from_pydata(verts, [], faces)
col = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
for poly, c in zip(me.polygons, fcols):
    for li in poly.loop_indices:
        col.data[li].color = (c[0] / 255, c[1] / 255, c[2] / 255, 1)
obj = bpy.data.objects.new('Guard', me)
scene.collection.objects.link(obj)
mat = bpy.data.materials.new('GuardMat')
mat.use_nodes = True
vc = mat.node_tree.nodes.new('ShaderNodeVertexColor')
vc.layer_name = 'Col'
mat.node_tree.links.new(vc.outputs['Color'], mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
me.materials.append(mat)

arm = bpy.data.armatures.new('GuardRig')
rig = bpy.data.objects.new('GuardRig', arm)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
children = {p: [c for c in range(P) if parents[c] == p and c in NAMES] for p in range(P)}
for p, name in NAMES.items():
    eb = arm.edit_bones.new(name)
    # The pelvis turns about the middle of the hips (the game places it there on every body).
    eb.head = (piv[2] + piv[3]) / 2 if p == 0 else piv[p]
    if p == 0:
        tail = piv[1]
    elif p == 1:
        tail = piv[4]
    elif children[p]:
        tail = sum((piv[c] for c in children[p]), Vector()) / len(children[p])
    else:
        vs = [verts[v] for v in range(n) if g['partOf'][v] == p]
        tail = sum(vs, Vector()) / len(vs)
    eb.tail = tail if (tail - eb.head).length >= 0.03 else eb.head + Vector((0, 0, -0.08))
for p, name in NAMES.items():
    if parents[p] >= 0:
        arm.edit_bones[name].parent = arm.edit_bones[NAMES[parents[p]]]
# Leg IK: foot targets and knee poles.
for side in ('R', 'L'):
    ankle = arm.edit_bones['foot.' + side].head.copy()
    knee = arm.edit_bones['shin.' + side].head.copy()
    foot = arm.edit_bones['foot.' + side]
    # The target the foot copies its rotation from rests exactly as the foot does, so a planted foot
    # keeps the model's own foot angle instead of turning to the target's.
    t = arm.edit_bones.new('ik.' + side)
    t.head, t.tail, t.roll, t.use_deform = ankle, ankle + (foot.tail - foot.head), foot.roll, False
    pole = arm.edit_bones.new('pole.' + side)
    pole.head = knee + Vector((0, -0.5, 0))
    pole.tail, pole.use_deform = pole.head + Vector((0, 0, 0.08)), False
bpy.ops.object.mode_set(mode='POSE')
for pb in rig.pose.bones:
    pb.rotation_mode = 'QUATERNION'
for side in ('R', 'L'):
    c = rig.pose.bones['shin.' + side].constraints.new('IK')
    c.target, c.subtarget, c.pole_target, c.pole_subtarget, c.chain_count = rig, 'ik.' + side, rig, 'pole.' + side, 2
    cr = rig.pose.bones['foot.' + side].constraints.new('COPY_ROTATION')
    cr.target, cr.subtarget = rig, 'ik.' + side
# Human knees: the shin is a hinge about the leg's side-to-side axis that only flexes backwards,
# and the thigh does not twist about its length. The legs are nearly straight (and slightly bowed)
# at rest, so a pole target alone cannot pick the bend plane.
bpy.ops.object.mode_set(mode='EDIT')
for side in ('R', 'L'):
    for part in ('thigh.', 'shin.'):
        arm.edit_bones[part + side].align_roll(Vector((0, -1, 0)))  # local Z forward, X sideways
bpy.ops.object.mode_set(mode='POSE')
pelvis = rig.pose.bones['pelvis']
drop = pelvis.bone.matrix_local.to_quaternion().inverted() @ Vector((0, 0, -0.12))


def knee_forward(side):
    """How far forward the knee sits off the hip-ankle line with the pelvis dropped (tiles)."""
    pelvis.location = drop
    bpy.context.view_layer.update()
    hip = rig.pose.bones['thigh.' + side].head
    knee = rig.pose.bones['shin.' + side].head
    ankle = rig.pose.bones['foot.' + side].head
    along = (ankle - hip).normalized()
    off = (knee - hip) - along * (knee - hip).dot(along)
    pelvis.location = (0, 0, 0)
    bpy.context.view_layer.update()
    return -off.y


for side in ('R', 'L'):
    c = rig.pose.bones['shin.' + side].constraints['IK']
    c.pole_target = None
    thigh = rig.pose.bones['thigh.' + side]
    shin = rig.pose.bones['shin.' + side]
    thigh.lock_ik_y = True
    shin.lock_ik_y = shin.lock_ik_z = True
    shin.use_ik_limit_x = True
    # Flexion is one sign of the hinge; keep the one that puts the knee in front.
    for lo, hi in ((-150, 0), (0, 150)):
        shin.ik_min_x, shin.ik_max_x = math.radians(lo), math.radians(hi)
        if knee_forward(side) > 0.02:
            break
    rig.data.bones['pole.' + side].hide = True
bpy.ops.object.mode_set(mode='OBJECT')

groups = {name: obj.vertex_groups.new(name=name) for name in NAMES.values()}
for v in range(n):
    p = g['partOf'][v]
    p = p if p < P else 0
    while p not in NAMES:
        p = parents[p]
    groups[NAMES[p]].add([v], 1.0, 'REPLACE')
obj.parent = rig
obj.modifiers.new('Armature', 'ARMATURE').object = rig
arm.display_type = 'STICK'
rig.show_in_front = True
