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


def box(name, loc, scale, bevel=0.06, rot=(0, 0, 0)):
    """Boks med myke, avfasede kanter — grunnformen i steinbarnet."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    mod = o.modifiers.new("Bevel", "BEVEL")
    mod.width = bevel
    mod.segments = 3
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38))
    return o


def stone_material(name, tint=(0.72, 0.68, 0.6)):
    """Lys, glatt stein: svak tekstur og normalmap over en varm gråtone."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.85

    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (3.0, 3.0, 3.0)
    uv = nodes.new("ShaderNodeTexCoord")
    links.new(uv.outputs["UV"], mapping.inputs["Vector"])

    diff = nodes.new("ShaderNodeTexImage")
    diff.image = bpy.data.images.load(os.path.join(TEX, "rock_diff.jpg"))
    links.new(mapping.outputs["Vector"], diff.inputs["Vector"])
    # Bleket steintekstur: bland mot lys tone så den blir beige, ikke grå fjellside.
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["Factor"].default_value = 0.6
    links.new(diff.outputs["Color"], mix.inputs["A"])
    mix.inputs["B"].default_value = (*tint, 1)
    links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])

    nor = nodes.new("ShaderNodeTexImage")
    nor.image = bpy.data.images.load(os.path.join(TEX, "rock_nor.jpg"))
    nor.image.colorspace_settings.name = "Non-Color"
    links.new(mapping.outputs["Vector"], nor.inputs["Vector"])
    nmap = nodes.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = 0.45
    links.new(nor.outputs["Color"], nmap.inputs["Color"])
    links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def flat_material(name, rgb, rough=0.7, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    if emission:
        b.inputs["Emission Color"].default_value = (*emission, 1)
        b.inputs["Emission Strength"].default_value = 1.5
    return mat


def build_troll():
    """Steinbarnet fra referansen: sittende, bokset hode med gresstopp,
    segmenterte armer, én hånd rakt frem. Front = -Y."""
    reset()
    random.seed(11)
    stone = stone_material("TrollRock")

    # Kropp og hode — hodet er størst, som på referansen.
    parts = [
        box("head", (0, 0, 1.62), (1.02, 0.88, 0.92), bevel=0.1),
        box("jaw", (0, -0.06, 1.28), (0.94, 0.8, 0.3), bevel=0.08),
        box("torso", (0, 0.02, 0.72), (0.62, 0.52, 0.66), bevel=0.09),
        box("hip", (0, 0, 0.36), (0.56, 0.48, 0.3), bevel=0.08),
        # Bein rett frem langs bakken (sittende).
        box("thighL", (-0.19, -0.44, 0.16), (0.17, 0.4, 0.15), bevel=0.05),
        box("thighR", (0.19, -0.44, 0.16), (0.17, 0.4, 0.15), bevel=0.05),
        box("calfL", (-0.2, -0.82, 0.12), (0.14, 0.32, 0.12), bevel=0.05),
        box("calfR", (0.2, -0.82, 0.12), (0.14, 0.32, 0.12), bevel=0.05),
        box("footL", (-0.2, -1.06, 0.11), (0.15, 0.14, 0.11), bevel=0.04),
        box("footR", (0.2, -1.06, 0.11), (0.15, 0.14, 0.11), bevel=0.04),
        # Venstre arm hviler langs siden.
        box("upperL", (-0.42, 0.04, 0.82), (0.11, 0.11, 0.3), bevel=0.04),
        box("lowerL", (-0.44, -0.05, 0.5), (0.1, 0.1, 0.26), bevel=0.04),
        # Høyre arm rakt frem med åpen hånd (sommerfugl-hånden).
        box("upperR", (0.44, -0.16, 0.86), (0.11, 0.28, 0.1), bevel=0.04,
            rot=(math.radians(-12), 0, math.radians(-8))),
        box("lowerR", (0.5, -0.52, 0.94), (0.1, 0.26, 0.09), bevel=0.04,
            rot=(math.radians(-4), 0, 0)),
        box("palmR", (0.52, -0.78, 0.97), (0.11, 0.12, 0.05), bevel=0.03),
        box("fingR1", (0.47, -0.9, 0.98), (0.03, 0.1, 0.03), bevel=0.012),
        box("fingR2", (0.52, -0.92, 0.98), (0.03, 0.11, 0.03), bevel=0.012),
        box("fingR3", (0.57, -0.9, 0.98), (0.03, 0.1, 0.03), bevel=0.012),
        box("thumbR", (0.61, -0.78, 0.98), (0.08, 0.03, 0.03), bevel=0.012),
    ]
    body = join(parts, "troll")
    smart_uv(body)
    body.data.materials.append(stone)

    extras = []
    # Øyne: to små mørke groper.
    eye_mat = flat_material("TrollEye", (0.04, 0.038, 0.035), rough=0.35)
    for side in (-1, 1):
        e = box(f"eye{side}", (0.15 * side, -0.442, 1.7), (0.055, 0.016, 0.075), bevel=0.008)
        e.data.materials.append(eye_mat)
        extras.append(e)
    # Munnspalte: en tynn mørk fuge i kjevefronten.
    mouth = box("mouth", (0, -0.458, 1.36), (0.55, 0.018, 0.028), bevel=0.006)
    mouth.data.materials.append(eye_mat)
    extras.append(mouth)

    # Gresstopp: moseplate senket ned i hodet + tette, korte strå i to toner.
    moss_mat = flat_material("Moss", (0.4, 0.5, 0.13), rough=0.9)
    grass_mats = [
        flat_material("GrassBlade1", (0.55, 0.68, 0.16), rough=0.8),
        flat_material("GrassBlade2", (0.66, 0.74, 0.2), rough=0.8),
    ]
    cap = box("mosscap", (0, 0.02, 2.06), (0.9, 0.74, 0.06), bevel=0.03)
    cap.data.materials.append(moss_mat)
    extras.append(cap)
    for i in range(90):
        gx = ((hash_i(i * 3 + 1) % 100) - 50) / 125
        gy = ((hash_i(i * 5 + 2) % 100) - 50) / 155
        gh = 0.07 + (hash_i(i * 7 + 3) % 100) / 700
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.028, depth=gh,
                                        location=(gx, gy, 2.09 + gh / 2),
                                        rotation=(((hash_i(i) % 40) - 20) / 45,
                                                  ((hash_i(i + 9) % 40) - 20) / 45, 0))
        blade = bpy.context.object
        blade.data.materials.append(grass_mats[i % 2])
        extras.append(blade)
    # Prestekrage: stilk, hvite kronblad, gul knapp.
    stem_mat = flat_material("Stem", (0.3, 0.46, 0.14))
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.014, depth=0.42,
                                        location=(0.12, 0.1, 2.36),
                                        rotation=(0, math.radians(6), 0))
    stem = bpy.context.object
    stem.data.materials.append(stem_mat)
    extras.append(stem)
    petal_mat = flat_material("Petal", (0.94, 0.94, 0.9), rough=0.5)
    for i in range(8):
        a = i / 8 * math.tau
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.05,
                                             location=(0.145 + math.cos(a) * 0.075, 0.1 + math.sin(a) * 0.075, 2.57))
        p = bpy.context.object
        p.scale = (1, 0.45, 0.18)
        p.rotation_euler = (0, 0, a)
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        p.data.materials.append(petal_mat)
        extras.append(p)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=8, radius=0.045, location=(0.145, 0.1, 2.58))
    center = bpy.context.object
    center.data.materials.append(flat_material("FlowerCenter", (0.92, 0.75, 0.2), emission=(0.9, 0.7, 0.15)))
    extras.append(center)

    export([body] + extras, os.path.join(OUT, "troll.glb"))
    preview([body] + extras, os.path.join(OUT, "troll_preview.png"))


def hash_i(i):
    """Stabil pseudotilfeldighet uten random-tilstand."""
    x = (i * 2654435761) & 0xFFFFFFFF
    x ^= x >> 16
    return x


def preview(objects, path):
    """Rendrer en kontrollbilde-PNG så resultatet kan inspiseres uten Blender-UI."""
    bpy.ops.object.camera_add(location=(1.9, -3.4, 2.1))
    cam = bpy.context.object
    bpy.ops.object.empty_add(location=(0.1, 0, 1.3))
    target = bpy.context.object
    con = cam.constraints.new("TRACK_TO")
    con.target = target
    bpy.context.scene.camera = cam
    bpy.ops.object.light_add(type="SUN", location=(4, -2, 6))
    sun = bpy.context.object
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(35), math.radians(15), math.radians(20))
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.35, 0.4, 0.45, 1)
    bpy.context.scene.world = world
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 560
    scene.render.resolution_y = 700
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


build_golem()
build_troll()
print("ferdig")
