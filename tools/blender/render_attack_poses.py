"""Renders the OBJs of tools/blender/attack_poses.ts, one PNG per NPC (rest pose, then each attack at
its hit), with Cycles on the CPU (background Blender has no GPU context for Workbench here):

    blender --background --python tools/blender/render_attack_poses.py -- <outDir>

RW and RH in the environment set the image size (default 1800 x 600).
"""
import bpy, json, os, sys, mathutils
D = sys.argv[sys.argv.index("--") + 1]
index = json.load(open(os.path.join(D, "index.json")))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 8
scene.cycles.use_denoising = False
mat = bpy.data.materials.new("vc"); mat.use_nodes = True
nt = mat.node_tree; bsdf = nt.nodes["Principled BSDF"]
attr = nt.nodes.new("ShaderNodeVertexColor")
nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 4
sun.rotation_euler = (0.9, 0.3, -0.6)
scene.render.resolution_x, scene.render.resolution_y = int(os.environ.get("RW", "1800")), int(os.environ.get("RH", "600"))
scene.world = bpy.data.worlds.new("w"); scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
scene.collection.objects.link(sun)
cam_data = bpy.data.cameras.new("cam"); cam_data.type = "ORTHO"; cam_data.clip_end = 1000
cam = bpy.data.objects.new("cam", cam_data); scene.collection.objects.link(cam); scene.camera = cam
for entry in index:
    for o in [o for o in scene.objects if o.type == "MESH"]:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.wm.obj_import(filepath=os.path.join(D, f"{entry['id']}.obj"), forward_axis="Y", up_axis="Z")
    meshes = [o for o in scene.objects if o.type == "MESH"]
    for o in meshes:
        o.data.materials.clear(); o.data.materials.append(mat)
    pts = [o.matrix_world @ mathutils.Vector(c) for o in meshes for c in o.bound_box]
    mn = mathutils.Vector([min(p[i] for p in pts) for i in range(3)])
    mx = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
    center = (mn + mx) / 2
    d = mathutils.Vector((-0.3, -1.0, 0.35)).normalized()
    cam.location = center + d * 200
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam_data.ortho_scale = max(mx.x - mn.x, (mx.z - mn.z) * 3) * 1.15
    scene.render.filepath = os.path.join(D, f"{entry['id']}.png")
    bpy.ops.render.render(write_still=True)
print("RENDERED", len(index))
