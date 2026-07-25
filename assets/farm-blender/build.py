# Bygger farm-skapningene i Blender (headless) og eksporterer GLB til
# public/farm/. Kjøres med:
#   blender -b -P assets/farm-blender/build.py
#
# Pipeline per skapning: primitiver → join → voxel-remesh (smelter delene til
# én organisk kropp) → displace (steinstøy) → decimate → smart-UV →
# vertex-farger (mose/fargetone) → PBR-materiale med rock-teksturene →
# GLB med innpakkede teksturer.
import bpy
import math
import os
import random
from mathutils import Vector, noise

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(ROOT, "..", "..", "public", "farm"))
TEX = OUT  # rock_diff/rock_nor ligger allerede der


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def ico(name, r, loc, scale, subdiv=3):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=r, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return o


def cone(name, r, depth, loc, rot, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=r, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return o


def join(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    return obj


def sculpt(obj, voxel=0.07, displace=0.07, noise_scale=0.55, target_faces=16000):
    """Voxel-remesh smelter delene sammen; displace gir steinoverflate."""
    bpy.context.view_layer.objects.active = obj
    obj.data.remesh_voxel_size = voxel
    bpy.ops.object.voxel_remesh()

    tex = bpy.data.textures.new(f"{obj.name}-rock", type="CLOUDS")
    tex.noise_scale = noise_scale
    mod = obj.modifiers.new("Displace", "DISPLACE")
    mod.texture = tex
    mod.strength = displace
    bpy.ops.object.modifier_apply(modifier=mod.name)

    dec = obj.modifiers.new("Decimate", "DECIMATE")
    ratio = target_faces / max(1, len(obj.data.polygons))
    dec.ratio = min(1.0, ratio)
    bpy.ops.object.modifier_apply(modifier=dec.name)
    bpy.ops.object.shade_smooth()


def smart_uv(obj):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")


def vertex_moss(obj, base_rgb, moss_rgb, threshold=0.25, moss_bias=0.45):
    """Mose der flatene peker opp + støy; ellers grunnfarge med toneskift."""
    mesh = obj.data
    attr = mesh.color_attributes.new(name="Col", type="BYTE_COLOR", domain="CORNER")
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            vi = mesh.loops[li].vertex_index
            v = mesh.vertices[vi]
            n = noise.noise(v.co * 2.1)
            up = v.normal.z
            shade = 0.86 + noise.noise(v.co * 5.0) * 0.14
            if up > threshold and n > (1 - moss_bias * 2):
                col = moss_rgb
            else:
                col = base_rgb
            attr.data[li].color = (col[0] * shade, col[1] * shade, col[2] * shade, 1.0)


def rock_material(name, tint=(1, 1, 1, 1), tex_scale=1.6, emissive=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.93
    bsdf.inputs["Base Color"].default_value = tint

    if emissive:
        bsdf.inputs["Emission Color"].default_value = emissive
        bsdf.inputs["Emission Strength"].default_value = 4.0
        return mat

    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (tex_scale, tex_scale, tex_scale)
    uv = nodes.new("ShaderNodeTexCoord")
    links.new(uv.outputs["UV"], mapping.inputs["Vector"])

    diff = nodes.new("ShaderNodeTexImage")
    diff.image = bpy.data.images.load(os.path.join(TEX, "rock_diff.jpg"))
    links.new(mapping.outputs["Vector"], diff.inputs["Vector"])
    links.new(diff.outputs["Color"], bsdf.inputs["Base Color"])

    nor = nodes.new("ShaderNodeTexImage")
    nor.image = bpy.data.images.load(os.path.join(TEX, "rock_nor.jpg"))
    nor.image.colorspace_settings.name = "Non-Color"
    links.new(mapping.outputs["Vector"], nor.inputs["Vector"])
    nmap = nodes.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = 0.9
    links.new(nor.outputs["Color"], nmap.inputs["Color"])
    links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def export(objects, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        use_selection=True,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
    )
    print("skrev", path)


def build_golem():
    """Blå steingolem: massiv kropp, horn, glødende øyne, hoggtenner, never."""
    reset()
    random.seed(7)
    parts = [
        ico("torso", 0.85, (0, 0, 1.05), (1.15, 0.8, 1.05)),
        ico("head", 0.62, (0, -0.06, 2.08), (1.25, 0.85, 0.95)),
        ico("hornL", 0.2, (-0.46, 0, 2.62), (1, 0.8, 1.9)),
        ico("hornR", 0.2, (0.46, 0, 2.62), (1, 0.8, 1.9)),
        ico("shoulderL", 0.34, (-0.98, 0, 1.5), (1, 0.9, 1)),
        ico("shoulderR", 0.34, (0.98, 0, 1.5), (1, 0.9, 1)),
        ico("forearmL", 0.28, (-1.08, -0.04, 0.9), (0.9, 0.9, 1.15)),
        ico("forearmR", 0.28, (1.08, -0.04, 0.9), (0.9, 0.9, 1.15)),
        ico("fistL", 0.38, (-1.06, -0.08, 0.4), (1, 1, 1.1)),
        ico("fistR", 0.38, (1.06, -0.08, 0.4), (1, 1, 1.1)),
        ico("legL", 0.3, (-0.42, 0, 0.2), (1, 1, 0.75)),
        ico("legR", 0.3, (0.42, 0, 0.2), (1, 1, 0.75)),
    ]
    body = join(parts, "golem")
    sculpt(body, voxel=0.065, displace=0.09, noise_scale=0.5, target_faces=18000)
    smart_uv(body)
    vertex_moss(body, (0.30, 0.41, 0.50), (0.44, 0.50, 0.24), threshold=0.15, moss_bias=0.4)
    body.data.materials.append(rock_material("GolemRock", tex_scale=1.8))

    extras = []
    eye_mat = rock_material("GolemEye", emissive=(1.0, 0.64, 0.25, 1.0))
    for side in (-1, 1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=12, radius=0.085,
                                             location=(0.25 * side, -0.52, 2.12))
        eye = bpy.context.object
        eye.name = f"eye{side}"
        eye.data.materials.append(eye_mat)
        extras.append(eye)

    tooth_mat = bpy.data.materials.new("Tooth")
    tooth_mat.use_nodes = True
    tooth_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.91, 0.89, 0.84, 1)
    tooth_mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.45
    for side in (-1, 1):
        t = cone(f"tooth{side}", 0.055, 0.17, (0.21 * side, -0.52, 1.8), (math.radians(-8), 0, 0))
        t.data.materials.append(tooth_mat)
        extras.append(t)

    export([body] + extras, os.path.join(OUT, "golem.glb"))


def build_troll():
    """Mosetroll: avrundet stein med mosetopp, blanke øyne, spire på hodet."""
    reset()
    random.seed(3)
    parts = [
        ico("body", 0.62, (0, 0, 0.95), (1, 0.88, 1.45)),
        ico("head", 0.4, (0, -0.02, 1.75), (1.05, 0.9, 0.95)),
        ico("earL", 0.12, (-0.4, 0, 1.95), (1, 0.7, 1.6)),
        ico("earR", 0.12, (0.4, 0, 1.95), (1, 0.7, 1.6)),
        ico("armL", 0.14, (-0.62, 0.02, 0.85), (0.9, 0.9, 1.5)),
        ico("armR", 0.14, (0.62, 0.02, 0.85), (0.9, 0.9, 1.5)),
        ico("footL", 0.16, (-0.24, -0.06, 0.12), (1.1, 1.2, 0.7)),
        ico("footR", 0.16, (0.24, -0.06, 0.12), (1.1, 1.2, 0.7)),
        ico("nose", 0.09, (0, -0.4, 1.68), (1, 1.2, 0.9)),
    ]
    body = join(parts, "troll")
    sculpt(body, voxel=0.055, displace=0.05, noise_scale=0.7, target_faces=14000)
    smart_uv(body)
    vertex_moss(body, (0.78, 0.79, 0.77), (0.42, 0.55, 0.22), threshold=0.35, moss_bias=0.5)
    body.data.materials.append(rock_material("TrollRock", tex_scale=2.4))

    extras = []
    eye_mat = bpy.data.materials.new("TrollEye")
    eye_mat.use_nodes = True
    b = eye_mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.05, 0.045, 0.04, 1)
    b.inputs["Roughness"].default_value = 0.1
    for side in (-1, 1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=10, radius=0.055,
                                             location=(0.16 * side, -0.36, 1.82))
        eye = bpy.context.object
        eye.name = f"eye{side}"
        eye.data.materials.append(eye_mat)
        extras.append(eye)

    # Spire på hodet.
    stem_mat = bpy.data.materials.new("Stem")
    stem_mat.use_nodes = True
    stem_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.24, 0.42, 0.16, 1)
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.016, depth=0.28, location=(0.06, 0, 2.32))
    stem = bpy.context.object
    stem.rotation_euler = (0, math.radians(-8), 0)
    stem.data.materials.append(stem_mat)
    extras.append(stem)
    for side in (-1, 1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=8, radius=0.06,
                                             location=(0.06 + 0.06 * side, 0, 2.44))
        leaf = bpy.context.object
        leaf.scale = (1, 0.5, 0.35)
        bpy.ops.object.transform_apply(scale=True)
        leaf.data.materials.append(stem_mat)
        extras.append(leaf)

    export([body] + extras, os.path.join(OUT, "troll.glb"))


build_golem()
build_troll()
print("ferdig")
