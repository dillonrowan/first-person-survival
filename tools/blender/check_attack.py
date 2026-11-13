"""Loads one attack of an exported NPC into Blender to check where it releases and launches from.

Export the NPC with tools/blender/export_npc.ts <npcs/ID_ID.bin> <out.json> <attackIndex>, then run
this inside Blender with ATTACK_SOURCE set to the JSON (execute_blender_code can do this):

    ATTACK_SOURCE = 'C:/path/to/out.json'
    exec(open('C:/path/to/tools/blender/check_attack.py').read())

It builds the NPC mesh with one shape key per frame of the attack, and a sphere at the clip launch
point (where a projectile or breath leaves the body at the release frame). show_frame(n) displays
frame n; the release frame is RELEASE_FRAME. Only the mesh is built (no rig, no .blend is saved).
"""
import json

import bpy
from mathutils import Vector

SOURCE = globals().get('ATTACK_SOURCE')
if not SOURCE:
    raise RuntimeError('Set ATTACK_SOURCE to the JSON written by export_npc.ts')


def b(x, y, z):
    """three.js model space (Y up, faces +Z) to Blender (Z up, faces -Y)."""
    return Vector((x, -z, y))


g = json.load(open(SOURCE))
attack = g.get('attack')
if not attack:
    raise RuntimeError('The JSON has no attack: pass the attack index to export_npc.ts')

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene

n = g['vertexCount']
base = g['base']
verts = [b(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]) for i in range(n)]
me = bpy.data.meshes.new('NpcMesh')
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
obj = bpy.data.objects.new('Npc', me)
scene.collection.objects.link(obj)
mat = bpy.data.materials.new('NpcMat')
mat.use_nodes = True
vc = mat.node_tree.nodes.new('ShaderNodeVertexColor')
vc.layer_name = 'Col'
mat.node_tree.links.new(vc.outputs['Color'], mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
me.materials.append(mat)

obj.shape_key_add(name='Basis')
for f, frame in enumerate(attack['frames']):
    key = obj.shape_key_add(name='f%d' % f)
    for i in range(n):
        key.data[i].co = b(frame[i * 3], frame[i * 3 + 1], frame[i * 3 + 2])

forward, up = attack['launch']
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.08, location=(0, -forward, up))
marker = bpy.context.active_object
marker.name = 'LaunchPoint'
marker_mat = bpy.data.materials.new('LaunchMat')
marker_mat.diffuse_color = (1, 0.1, 0.1, 1)
marker.data.materials.append(marker_mat)

RELEASE_FRAME = attack['releaseFrame']


def show_frame(frame):
    """Shows one frame of the attack (the shape key f<frame>)."""
    for key in obj.data.shape_keys.key_blocks:
        key.value = 1.0 if key.name == 'f%d' % frame else 0.0


show_frame(RELEASE_FRAME)
print('style', attack['style'], 'seq', attack['seqId'], 'frames', len(attack['frames']),
      'release frame', RELEASE_FRAME, 'launch (forward, up)', attack['launch'])
