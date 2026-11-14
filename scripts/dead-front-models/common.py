"""
Shared plumbing for the Dead Front model packs (headless Blender).

Each pack script (zombies.py, weapons.py, props.py, machines.py, avatars.py,
fx.py) builds its models and calls `export_pack('<pack>')`, which writes
public/dead-front/models/<pack>.glb. The engine loads every pack before a match
(app/utils/dead-front/models/index.ts) and flattens nodes into the toon
material's format, so:

- Every model is ONE top-level object (an empty or a mesh) named as the engine
  looks it up, e.g. 'crate', 'zombie-shambler-0-head'. Its origin is the pivot.
  Children (meshes, or named moving parts) hang under it.
- Colour comes from the material's Base Color (flat, no textures) times an
  optional vertex colour layer. Emission (colour x strength, 0..1) becomes glow.
  Use `mat(name, rgb, glow=0)`, which sets up both for the exporter.
- Blender is Z up; the exporter writes glTF Y up (Blender -Y becomes glTF +Z,
  Blender +X stays +X). Units are metres.
- Keep shapes smooth (bevels, subdivision, shade smooth with auto smooth by
  angle) but light: the whole pack should stay under ~3 MB.

Run:  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/dead-front-models/<pack>.py
Preview a pack:  add `-- --preview /tmp/out.png` and call `render_preview()`.
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'dead-front', 'models')


def args():
    """Arguments after `--` on the Blender command line."""
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


_MATS = {}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def mat(name, rgb, glow=0.0):
    """A flat material. `rgb` is an sRGB hex int (0x6b4a2e) or a linear (r, g, b) tuple."""
    if name in _MATS and _MATS[name].name in bpy.data.materials:
        return _MATS[name]
    if isinstance(rgb, int):
        lin = tuple(srgb_to_linear(((rgb >> s) & 255) / 255) for s in (16, 8, 0))
    else:
        lin = tuple(rgb)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*lin, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.8
    if glow > 0:
        bsdf.inputs['Emission Color'].default_value = (*lin, 1.0)
        bsdf.inputs['Emission Strength'].default_value = float(glow)
    m.diffuse_color = (*lin, 1.0)
    _MATS[name] = m
    return m


def shade_smooth(obj, angle=40):
    """Smooth shading with sharp edges kept above `angle` degrees."""
    if obj.type != 'MESH':
        return
    with bpy.context.temp_override(selected_editable_objects=[obj], object=obj, active_object=obj):
        try:
            bpy.ops.object.shade_auto_smooth(angle=math.radians(angle))
        except Exception:
            bpy.ops.object.shade_smooth()


def export_pack(pack):
    """Writes every top-level object in the scene (and its children) to public/dead-front/models/<pack>.glb."""
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{pack}.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_texcoords=False,
        export_materials='EXPORT',
        export_animations=False,
        export_extras=False
    )
    size = os.path.getsize(path)
    roots = [o.name for o in bpy.data.objects if o.parent is None]
    print(f'[dead-front] wrote {path} ({size / 1024:.0f} KB, {len(roots)} models)')
    return path


def render_preview(path, objects=None, size=(1024, 768), azimuth=35, elevation=18, distance=None):
    """A quick Workbench render of `objects` (default: everything) to a PNG, for checking shapes."""
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_cavity = True
    scene.display.shading.show_object_outline = True
    objs = objects or [o for o in bpy.data.objects if o.type == 'MESH']
    from mathutils import Vector
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    centre = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.05)
    d = distance or radius * 2.8
    az, el = math.radians(azimuth), math.radians(elevation)
    cam_data = bpy.data.cameras.new('preview-cam')
    cam_data.lens = 50
    cam = bpy.data.objects.new('preview-cam', cam_data)
    scene.collection.objects.link(cam)
    cam.location = centre + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * d
    direction = centre - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    print(f'[dead-front] preview {path}')
