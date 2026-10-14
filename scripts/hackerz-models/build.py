"""
HACKERZ model kit — builds every enemy and turret as low-poly hard-surface
geometry and exports one GLB per model into public/hackerz/models.

Run headless:  bun run models:hackerz
          or:  blender --background --factory-startup --python scripts/hackerz-models/build.py

Conventions the engine relies on (app/utils/hackerz-engine/models.ts):

- Every model faces Blender -Y (glTF +Z), stands on z = 0 and is normalised to
  its gameplay height at load time, so the absolute scale here is free.
- Two materials: "Body" (dark plating, lit by the engine's rim shader) and
  "Glow" (emissive, tinted with the enemy's colour). "Hot" is a white-hot glow
  for cores and muzzles.
- Animated parts are named, and their origin is the pivot:
    legA* / legB*   swing about X in opposite phase (walk cycle)
    roll*           spin about X (wheels, the rolling bomb)
    spin*           spin about Z (halos, rotors, shard rings)
    yaw             turret head, turned toward the target about Z
    barrel          recoils along its local +Y (toward the back)
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'hackerz', 'models')


# ─── Scene plumbing ─────────────────────────────────────────────────────────

def reset_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)


MATERIALS = {}


def material(name):
    if name in MATERIALS and MATERIALS[name].name in bpy.data.materials:
        return MATERIALS[name]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = {
        'Body': (0.03, 0.04, 0.06, 1.0),
        'Glow': (0.3, 0.9, 1.0, 1.0),
        'Hot': (1.0, 1.0, 1.0, 1.0)
    }[name]
    MATERIALS[name] = mat
    return mat


def make_object(name, bm, parent=None, pivot=(0, 0, 0), mat='Body'):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material(mat))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = pivot
    if parent is not None:
        obj.parent = parent
    return obj


def empty(name, parent=None, pivot=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = pivot
    if parent is not None:
        obj.parent = parent
    return obj


def transformed(bm, size=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0)):
    """Scales, rotates (XYZ euler, degrees) then moves every vertex of `bm`."""
    m = (Matrix.Translation(loc)
         @ Matrix.Rotation(math.radians(rot[2]), 4, 'Z')
         @ Matrix.Rotation(math.radians(rot[1]), 4, 'Y')
         @ Matrix.Rotation(math.radians(rot[0]), 4, 'X')
         @ Matrix.Diagonal(Vector((size[0], size[1], size[2], 1))))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bm


def bm_box(size=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    return transformed(bm, size, loc, rot)


def bm_cyl(radius=0.5, depth=1.0, segments=8, loc=(0, 0, 0), rot=(0, 0, 0), radius2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius,
                          radius2=radius if radius2 is None else radius2, depth=depth)
    return transformed(bm, (1, 1, 1), loc, rot)


def bm_ico(radius=0.5, loc=(0, 0, 0), subdiv=1, size=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    return transformed(bm, size, loc)


def bm_octa(size=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0)):
    bm = bmesh.new()
    pts = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
    v = [bm.verts.new(p) for p in pts]
    for a, b, c in [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]:
        bm.faces.new((v[a], v[b], v[c]))
    return transformed(bm, size, loc, rot)


def bm_torus(major=1.0, minor=0.08, segments=16, sides=4, loc=(0, 0, 0), rot=(0, 0, 0)):
    """A square-section ring — reads as a hard neon band rather than a tube."""
    bm = bmesh.new()
    rings = []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        ring = []
        for j in range(sides):
            b = 2 * math.pi * j / sides + math.pi / 4
            r = major + minor * math.cos(b)
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), minor * math.sin(b))))
        rings.append(ring)
    for i in range(segments):
        for j in range(sides):
            a, b = rings[i], rings[(i + 1) % segments]
            bm.faces.new((a[j], b[j], b[(j + 1) % sides], a[(j + 1) % sides]))
    return transformed(bm, (1, 1, 1), loc, rot)


def bm_prism(points, height=1.0, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Extrudes a 2D outline (x, y pairs, CCW) along Z, centred on z = 0."""
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, -height / 2)) for x, y in points]
    top = [bm.verts.new((x, y, height / 2)) for x, y in points]
    bm.faces.new(list(reversed(bottom)))
    bm.faces.new(top)
    n = len(points)
    for i in range(n):
        bm.faces.new((bottom[i], bottom[(i + 1) % n], top[(i + 1) % n], top[i]))
    return transformed(bm, (1, 1, 1), loc, rot)


def bm_frustum(bottom=(1, 1), top=(0.6, 0.6), height=1.0, loc=(0, 0, 0), rot=(0, 0, 0)):
    """A tapered box — the basic plate of every armoured body here."""
    bm = bmesh.new()
    bx, by = bottom[0] / 2, bottom[1] / 2
    tx, ty = top[0] / 2, top[1] / 2
    h = height / 2
    v = [bm.verts.new(p) for p in [
        (-bx, -by, -h), (bx, -by, -h), (bx, by, -h), (-bx, by, -h),
        (-tx, -ty, h), (tx, -ty, h), (tx, ty, h), (-tx, ty, h)]]
    for f in [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]:
        bm.faces.new([v[i] for i in f])
    return transformed(bm, (1, 1, 1), loc, rot)


def part(name, bm, parent, pivot=(0, 0, 0), mat='Body'):
    return make_object(name, bm, parent, pivot, mat)


def mirrored(name, builder, parent, x, mat='Body', pivot=None):
    """Builds a left/right pair from one builder taking the side sign (-1/+1)."""
    out = []
    for side, tag in ((-1, 'L'), (1, 'R')):
        p = None if pivot is None else (pivot[0] * side, pivot[1], pivot[2])
        obj = make_object(f'{name}{tag}', builder(side), parent, p or (0, 0, 0), mat)
        out.append(obj)
    return out


def export(name):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{name}.glb')
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
    print(f'[hackerz-models] {name}.glb  {size / 1024:.1f} KiB')


# ─── Enemies ────────────────────────────────────────────────────────────────
# Each builder makes a root empty and hangs its parts off it, facing -Y.

def crawler():
    """A light cycle: one long low wedge between two glowing wheels."""
    root = empty('root')
    part('body', bm_prism([(-0.9, 0.0), (1.1, 0.0), (1.25, 0.32), (0.4, 0.62), (-0.7, 0.5), (-1.15, 0.22)],
                          0.34, rot=(90, 0, 90), loc=(0, 0, 0.36)), root)
    part('canopy', bm_prism([(-0.1, 0.42), (0.55, 0.58), (0.25, 0.66), (-0.3, 0.58)], 0.22,
                            rot=(90, 0, 90), loc=(0, 0, 0.36)), root, mat='Glow')
    part('stripe', bm_box((0.36, 1.9, 0.05), loc=(0, 0.05, 0.36)), root, mat='Glow')
    for tag, y in (('F', -0.92), ('B', 0.95)):
        wheel = empty(f'roll{tag}', root, (0, y, 0.36))
        part(f'tyre{tag}', bm_cyl(0.36, 0.3, 12, rot=(0, 90, 0)), wheel)
        part(f'rim{tag}', bm_torus(0.3, 0.05, 12, rot=(0, 90, 0)), wheel, mat='Glow')
        part(f'hub{tag}', bm_cyl(0.1, 0.34, 6, rot=(0, 90, 0)), wheel, mat='Hot')


def grunt():
    """A Daemon: an angular program on two legs, its identity disc on its back."""
    root = empty('root')
    hips = 1.0
    for tag, side in (('A', -1), ('B', 1)):
        leg = empty(f'leg{tag}', root, (0.2 * side, 0, hips))
        part(f'thigh{tag}', bm_frustum((0.22, 0.26), (0.16, 0.2), 0.55, loc=(0, 0, -0.3)), leg)
        part(f'shin{tag}', bm_frustum((0.2, 0.34), (0.2, 0.22), 0.5, loc=(0, -0.04, -0.75)), leg)
        part(f'knee{tag}', bm_box((0.24, 0.06, 0.06), loc=(0, -0.16, -0.55)), leg, mat='Glow')
    part('pelvis', bm_frustum((0.5, 0.3), (0.62, 0.34), 0.2, loc=(0, 0, hips + 0.05)), root)
    part('torso', bm_frustum((0.5, 0.32), (0.86, 0.42), 0.62, loc=(0, 0, hips + 0.48)), root)
    part('chest', bm_box((0.06, 0.04, 0.5), loc=(0, -0.22, hips + 0.48)), root, mat='Glow')
    part('collar', bm_box((0.9, 0.04, 0.05), loc=(0, -0.22, hips + 0.76)), root, mat='Glow')
    part('head', bm_frustum((0.24, 0.26), (0.3, 0.3), 0.26, loc=(0, -0.02, hips + 0.94)), root)
    part('visor', bm_box((0.26, 0.05, 0.06), loc=(0, -0.16, hips + 0.96)), root, mat='Hot')
    part('disc', bm_torus(0.26, 0.05, 16, rot=(90, 0, 0), loc=(0, 0.26, hips + 0.5)), root, mat='Glow')
    part('discCore', bm_cyl(0.18, 0.04, 16, rot=(90, 0, 0), loc=(0, 0.26, hips + 0.5)), root)
    for tag, side in (('L', -1), ('R', 1)):
        part(f'arm{tag}', bm_frustum((0.16, 0.16), (0.12, 0.14), 0.7,
                                     loc=(0.52 * side, 0, hips + 0.38), rot=(0, 12 * side, 0)), root)
        part(f'shoulder{tag}', bm_frustum((0.3, 0.32), (0.2, 0.24), 0.16,
                                          loc=(0.5 * side, 0, hips + 0.78)), root)


def sapper():
    """A logic bomb: a white-hot core in a spiked cage, rolling at the wall."""
    root = empty('root')
    ball = empty('rollBall', root, (0, 0, 0.6))
    part('core', bm_ico(0.32, subdiv=1), ball, mat='Hot')
    cage = bm_ico(0.5, subdiv=1)
    bmesh.ops.wireframe(cage, faces=cage.faces, thickness=0.06, use_replace=True)
    part('cage', cage, ball, mat='Glow')
    for i, (x, y, z) in enumerate([(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]):
        d = Vector((x, y, z))
        rot = d.to_track_quat('Z', 'Y').to_euler()
        spike = bm_cyl(0.12, 0.3, 4, radius2=0.0, loc=(0, 0, 0.62))
        bmesh.ops.transform(spike, matrix=rot.to_matrix().to_4x4(), verts=spike.verts)
        part(f'spike{i}', spike, ball)


def drone():
    """A Wisp: a split diamond inside a spinning halo."""
    root = empty('root')
    part('upper', bm_octa((0.42, 0.42, 0.5), loc=(0, 0, 0.62)), root)
    part('lower', bm_octa((0.3, 0.3, 0.42), loc=(0, 0, 0.34)), root, mat='Glow')
    part('eye', bm_box((0.18, 0.06, 0.06), loc=(0, -0.38, 0.62)), root, mat='Hot')
    halo = empty('spinHalo', root, (0, 0, 0.62))
    part('halo', bm_torus(0.72, 0.04, 20), halo, mat='Glow')
    for i in range(3):
        a = i * 2 * math.pi / 3
        part(f'fin{i}', bm_box((0.32, 0.05, 0.1), loc=(math.cos(a) * 0.55, math.sin(a) * 0.55, 0),
                               rot=(0, 0, math.degrees(a))), halo)


def brute():
    """A Bulwark: a hexagonal shield plate walked forward on four stub legs."""
    root = empty('root')
    hips = 0.62
    for tag, (x, y) in (('A', (-0.5, -0.4)), ('B', (0.5, -0.4)), ('B2', (-0.5, 0.45)), ('A2', (0.5, 0.45))):
        leg = empty(f'leg{tag}', root, (x, y, hips))
        part(f'leg{tag}m', bm_frustum((0.3, 0.36), (0.22, 0.26), 0.62, loc=(0, 0, -0.3)), leg)
        part(f'foot{tag}', bm_box((0.4, 0.46, 0.08), loc=(0, 0, -0.6)), leg)
    part('hull', bm_frustum((1.3, 1.2), (1.0, 0.9), 0.6, loc=(0, 0.05, hips + 0.3)), root)
    hexagon = [(math.cos(i * math.pi / 3) * 0.9, math.sin(i * math.pi / 3) * 0.9) for i in range(6)]
    part('shield', bm_prism(hexagon, 0.16, rot=(90, 0, 0), loc=(0, -0.72, hips + 0.42)), root)
    # A hexagonal ring rather than a filled plate: a big glowing face blooms into a blob.
    part('shieldGlow', bm_torus(0.68, 0.045, 6, rot=(90, 0, 0), loc=(0, -0.81, hips + 0.42)), root, mat='Glow')
    part('shieldCore', bm_torus(0.3, 0.035, 6, rot=(90, 0, 0), loc=(0, -0.81, hips + 0.42)), root, mat='Glow')
    part('slit', bm_box((0.7, 0.04, 0.07), loc=(0, -0.84, hips + 0.72)), root, mat='Hot')
    part('spine', bm_box((0.12, 0.9, 0.1), loc=(0, 0.1, hips + 0.64)), root, mat='Glow')


def spitter():
    """A Lancer: a tripod carrying a coil lance it lobs plasma from."""
    root = empty('root')
    body_z = 1.05
    for i, (tag, a) in enumerate((('A', -90), ('B', 30), ('A2', 150))):
        rad = math.radians(a)
        leg = empty(f'leg{tag}', root, (math.cos(rad) * 0.18, math.sin(rad) * 0.18, body_z))
        part(f'strut{i}', bm_frustum((0.12, 0.12), (0.08, 0.08), 1.15,
                                     loc=(math.cos(rad) * 0.28, math.sin(rad) * 0.28, -0.52),
                                     rot=(-math.sin(rad) * 28, math.cos(rad) * 28, 0)), leg)
    part('pod', bm_octa((0.42, 0.5, 0.32), loc=(0, 0, body_z + 0.08)), root)
    part('podGlow', bm_box((0.5, 0.06, 0.06), loc=(0, -0.3, body_z + 0.08)), root, mat='Glow')
    lance = empty('lance', root, (0, 0, body_z + 0.3))
    part('lanceBody', bm_cyl(0.07, 1.6, 6, rot=(90, 0, 0), loc=(0, -0.3, 0.15)), lance)
    for k in range(4):
        part(f'coil{k}', bm_torus(0.13, 0.03, 10, rot=(90, 0, 0), loc=(0, -0.55 - k * 0.22, 0.15)), lance, mat='Glow')
    part('tip', bm_octa((0.1, 0.16, 0.1), loc=(0, -1.15, 0.15)), lance, mat='Hot')


def warden():
    """A Warden: a tall plated knight behind a tower shield."""
    root = empty('root')
    hips = 1.05
    for tag, side in (('A', -1), ('B', 1)):
        leg = empty(f'leg{tag}', root, (0.22 * side, 0, hips))
        part(f'greave{tag}', bm_frustum((0.26, 0.3), (0.3, 0.34), 1.0, loc=(0, 0, -0.52)), leg)
        part(f'kneeGlow{tag}', bm_box((0.2, 0.05, 0.05), loc=(0, -0.18, -0.5)), leg, mat='Glow')
    part('skirt', bm_frustum((0.8, 0.5), (0.6, 0.4), 0.3, loc=(0, 0, hips)), root)
    part('torso', bm_frustum((0.6, 0.42), (0.92, 0.5), 0.8, loc=(0, 0, hips + 0.55)), root)
    part('helm', bm_frustum((0.32, 0.36), (0.22, 0.3), 0.42, loc=(0, 0, hips + 1.18)), root)
    part('visorH', bm_box((0.3, 0.05, 0.05), loc=(0, -0.19, hips + 1.2)), root, mat='Hot')
    part('visorV', bm_box((0.05, 0.05, 0.22), loc=(0, -0.19, hips + 1.1)), root, mat='Hot')
    part('crest', bm_box((0.04, 0.3, 0.16), loc=(0, 0.02, hips + 1.44)), root, mat='Glow')
    shield = [(-0.42, -0.95), (0.42, -0.95), (0.48, 0.7), (0.0, 0.95), (-0.48, 0.7)]
    part('towerShield', bm_prism(shield, 0.12, rot=(90, 0, 0), loc=(-0.25, -0.5, hips + 0.4)), root)
    # The trim is the shield's outline as thin bars, never a filled glowing face.
    trim = [(x * 0.82, y * 0.86) for x, y in shield]
    for i, (ax, ay) in enumerate(trim):
        bx, by = trim[(i + 1) % len(trim)]
        length = math.hypot(bx - ax, by - ay)
        angle = math.degrees(math.atan2(by - ay, bx - ax))
        part(f'shieldTrim{i}', bm_box((length, 0.04, 0.05), loc=(-0.25 + (ax + bx) / 2, -0.57, hips + 0.4 + (ay + by) / 2),
                                       rot=(0, -angle, 0)), root, mat='Glow')
    part('shieldCrest', bm_box((0.05, 0.04, 1.2), loc=(-0.25, -0.57, hips + 0.4)), root, mat='Glow')
    part('blade', bm_box((0.08, 0.06, 1.3), loc=(0.6, -0.2, hips + 0.4), rot=(15, 0, 0)), root, mat='Glow')


def tank():
    """A Siege Tank: a low wedge hull on two glowing treads, one long gun."""
    root = empty('root')
    for side in (-1, 1):
        part(f'tread{side}', bm_frustum((0.42, 2.1), (0.42, 1.9), 0.46, loc=(0.78 * side, 0, 0.25)), root)
        part(f'treadGlow{side}', bm_box((0.05, 1.9, 0.07), loc=(1.0 * side, 0, 0.28)), root, mat='Glow')
    part('hull', bm_frustum((1.4, 2.0), (1.1, 1.4), 0.5, loc=(0, 0.05, 0.62)), root)
    part('nose', bm_box((1.0, 0.05, 0.06), loc=(0, -0.98, 0.62)), root, mat='Glow')
    part('turret', bm_frustum((0.9, 1.0), (0.7, 0.7), 0.36, loc=(0, 0.15, 1.05)), root)
    part('gun', bm_box((0.16, 1.6, 0.16), loc=(0, -0.95, 1.08)), root)
    part('muzzle', bm_box((0.22, 0.12, 0.22), loc=(0, -1.78, 1.08)), root, mat='Hot')
    part('hatch', bm_box((0.4, 0.4, 0.05), loc=(0, 0.3, 1.25)), root, mat='Glow')


def artillery():
    """A Howitzer: tracked chassis, glowing breech, a barrel cranked skyward."""
    root = empty('root')
    for side in (-1, 1):
        part(f'track{side}', bm_frustum((0.36, 1.7), (0.36, 1.5), 0.4, loc=(0.62 * side, 0, 0.22)), root)
        part(f'trackGlow{side}', bm_box((0.05, 1.5, 0.06), loc=(0.82 * side, 0, 0.24)), root, mat='Glow')
    part('deck', bm_box((1.1, 1.6, 0.3), loc=(0, 0, 0.55)), root)
    part('breech', bm_box((0.6, 0.6, 0.5), loc=(0, 0.25, 0.95)), root)
    part('breechGlow', bm_box((0.64, 0.1, 0.3), loc=(0, 0.6, 0.95)), root, mat='Glow')
    barrel = empty('cannon', root, (0, 0.1, 1.05))
    part('cannonTube', bm_cyl(0.13, 2.0, 8, loc=(0, -1.0, 0), rot=(90, 0, 0)), barrel)
    part('cannonRing', bm_torus(0.17, 0.04, 8, loc=(0, -1.7, 0), rot=(90, 0, 0)), barrel, mat='Glow')
    part('cannonMouth', bm_cyl(0.11, 0.1, 8, loc=(0, -2.0, 0), rot=(90, 0, 0)), barrel, mat='Hot')
    barrel.rotation_euler = (math.radians(38), 0, 0)
    for side in (-1, 1):
        part(f'spade{side}', bm_box((0.1, 0.5, 0.4), loc=(0.4 * side, 0.95, 0.3), rot=(-30, 0, 0)), root)


def gunship():
    """A Gunship: a hovering arch — two pylons, a crossbeam and a cockpit slung below."""
    root = empty('root')
    for side in (-1, 1):
        part(f'pylon{side}', bm_frustum((0.36, 1.2), (0.22, 0.9), 1.1, loc=(1.1 * side, 0, 0.55)), root)
        part(f'pylonGlow{side}', bm_box((0.05, 1.0, 0.06), loc=(1.1 * side, 0, 0.06)), root, mat='Glow')
    part('beam', bm_frustum((2.6, 1.0), (2.2, 0.8), 0.32, loc=(0, 0, 1.2)), root)
    part('beamGlow', bm_box((2.3, 0.06, 0.06), loc=(0, -0.48, 1.2)), root, mat='Glow')
    part('cockpit', bm_octa((0.36, 0.5, 0.3), loc=(0, -0.1, 0.78)), root)
    part('eye', bm_box((0.3, 0.05, 0.08), loc=(0, -0.58, 0.78)), root, mat='Hot')
    for side in (-1, 1):
        part(f'gun{side}', bm_box((0.08, 0.7, 0.08), loc=(0.4 * side, -0.5, 0.62)), root)


def titan():
    """ROOTKIT: a six-legged spider mech with a cluster of red eyes."""
    root = empty('root')
    body_z = 1.1
    part('abdomen', bm_frustum((1.4, 1.6), (0.9, 1.1), 0.7, loc=(0, 0.55, body_z + 0.1)), root)
    part('thorax', bm_frustum((1.1, 1.0), (0.8, 0.7), 0.6, loc=(0, -0.5, body_z)), root)
    part('abdomenGlow', bm_box((0.1, 1.3, 0.06), loc=(0, 0.55, body_z + 0.47)), root, mat='Glow')
    for i, (x, z) in enumerate([(-0.18, 0.1), (0.18, 0.1), (-0.3, -0.06), (0.3, -0.06), (0, 0.2)]):
        part(f'eye{i}', bm_box((0.1, 0.05, 0.08), loc=(x, -1.0, body_z + z)), root, mat='Hot')
    for i, y in enumerate((-0.6, 0.0, 0.6)):
        for side, tag in ((-1, 'L'), (1, 'R')):
            phase = 'A' if (i + (side > 0)) % 2 == 0 else 'B'
            leg = empty(f'leg{phase}{i}{tag}', root, (0.45 * side, y - 0.2, body_z))
            part(f'femur{i}{tag}', bm_box((0.95, 0.14, 0.14), loc=(0.42 * side, 0, 0.32), rot=(0, 34 * side, 0)), leg)
            part(f'tibia{i}{tag}', bm_frustum((0.12, 0.12), (0.06, 0.06), 1.35,
                                             loc=(1.0 * side, 0, -0.18), rot=(0, -18 * side, 0)), leg)
            part(f'joint{i}{tag}', bm_box((0.18, 0.18, 0.18), loc=(0.82 * side, 0, 0.6)), leg, mat='Glow')


def leviathan():
    """BLACK ICE: a colossus of black crystal with a ring of shards in orbit."""
    root = empty('root')
    hips = 1.3
    for tag, side in (('A', -1), ('B', 1)):
        leg = empty(f'leg{tag}', root, (0.42 * side, 0, hips))
        part(f'pillar{tag}', bm_octa((0.3, 0.3, 0.75), loc=(0, 0, -0.62)), leg)
        part(f'pillarGlow{tag}', bm_box((0.06, 0.06, 0.9), loc=(0, -0.2, -0.62)), leg, mat='Glow')
    part('core', bm_octa((0.85, 0.6, 1.1), loc=(0, 0, hips + 0.9)), root)
    part('heart', bm_octa((0.22, 0.12, 0.3), loc=(0, -0.42, hips + 0.95)), root, mat='Hot')
    for side in (-1, 1):
        part(f'crystal{side}', bm_octa((0.3, 0.3, 0.95), loc=(0.9 * side, 0.1, hips + 1.25), rot=(0, 24 * side, 0)), root)
        part(f'crystalGlow{side}', bm_octa((0.12, 0.12, 0.5), loc=(0.9 * side, -0.12, hips + 1.25),
                                          rot=(0, 24 * side, 0)), root, mat='Glow')
    part('crown', bm_octa((0.3, 0.3, 0.6), loc=(0, 0.05, hips + 2.15)), root, mat='Glow')
    ring = empty('spinShards', root, (0, 0, hips + 0.9))
    for i in range(8):
        a = i * math.pi / 4
        part(f'shard{i}', bm_octa((0.1, 0.1, 0.28), loc=(math.cos(a) * 1.5, math.sin(a) * 1.5, math.sin(a * 2) * 0.2)),
             ring, mat='Glow')


def phantom():
    """A Phantom: a cloaked wraith of a program — a tall hood, one eye, shards circling."""
    root = empty('root')
    part('cloak', bm_frustum((0.9, 0.6), (0.35, 0.3), 1.5, loc=(0, 0.05, 0.85)), root)
    part('hem', bm_torus(0.42, 0.03, 6, loc=(0, 0.05, 0.12)), root, mat='Glow')
    part('hood', bm_octa((0.3, 0.32, 0.36), loc=(0, 0, 1.75)), root)
    part('eye', bm_box((0.22, 0.05, 0.04), loc=(0, -0.24, 1.75)), root, mat='Hot')
    part('seam', bm_box((0.04, 0.04, 1.2), loc=(0, -0.24, 0.85)), root, mat='Glow')
    halo = empty('spinShards', root, (0, 0, 1.2))
    for i in range(5):
        a = i * 2 * math.pi / 5
        part(f'shard{i}', bm_octa((0.07, 0.07, 0.18), loc=(math.cos(a) * 0.65, math.sin(a) * 0.65, math.sin(a * 3) * 0.12)),
             halo, mat='Glow')


def zeroday():
    """ZERO DAY: a compact, glitch-sliced colossus — its torso is offset slabs, its heart exposed."""
    root = empty('root')
    hips = 0.9
    for tag, side in (('A', -1), ('B', 1)):
        leg = empty(f'leg{tag}', root, (0.3 * side, 0, hips))
        part(f'thigh{tag}', bm_box((0.26, 0.3, 0.5), loc=(0, 0, -0.25)), leg)
        part(f'shin{tag}', bm_box((0.3, 0.38, 0.46), loc=(0.04 * side, -0.04, -0.68)), leg)
        part(f'knee{tag}', bm_box((0.2, 0.05, 0.05), loc=(0, -0.2, -0.5)), leg, mat='Glow')
    # The torso is three slabs knocked out of line, like a frame that failed to render.
    for i, (dx, w) in enumerate(((0.06, 0.9), (-0.1, 1.05), (0.12, 0.8))):
        part(f'slab{i}', bm_box((w, 0.5, 0.24), loc=(dx, 0, hips + 0.16 + i * 0.26)), root)
        part(f'slabGlow{i}', bm_box((w * 0.9, 0.04, 0.04), loc=(dx, -0.26, hips + 0.16 + i * 0.26 + 0.1)), root, mat='Glow')
    part('heart', bm_octa((0.14, 0.1, 0.18), loc=(0, -0.3, hips + 0.42)), root, mat='Hot')
    part('head', bm_box((0.38, 0.4, 0.3), loc=(-0.05, 0, hips + 1.0)), root)
    part('visor', bm_box((0.3, 0.05, 0.06), loc=(-0.05, -0.21, hips + 1.02)), root, mat='Hot')
    for side in (-1, 1):
        part(f'arm{side}', bm_box((0.2, 0.24, 0.7), loc=(0.62 * side, 0, hips + 0.42)), root)
        part(f'claw{side}', bm_box((0.05, 0.3, 0.05), loc=(0.62 * side, -0.14, hips + 0.04)), root, mat='Glow')


# ─── Turrets ────────────────────────────────────────────────────────────────
# Turrets face -Y like everything else; the engine turns `yaw` toward a target.

def turret_base(root, radius=0.5):
    part('plinth', bm_cyl(radius, 0.3, 8, loc=(0, 0, 0.15), radius2=radius * 0.8), root)
    part('plinthGlow', bm_torus(radius * 0.86, 0.035, 8, loc=(0, 0, 0.3)), root, mat='Glow')


def turret_gun():
    root = empty('root')
    turret_base(root)
    yaw = empty('yaw', root, (0, 0, 0.42))
    part('head', bm_frustum((0.6, 0.7), (0.45, 0.5), 0.34, loc=(0, 0.05, 0.12)), yaw)
    part('eye', bm_box((0.3, 0.05, 0.06), loc=(0, -0.3, 0.18)), yaw, mat='Glow')
    barrel = empty('barrel', yaw, (0, -0.2, 0.12))
    part('tube', bm_box((0.12, 0.8, 0.12), loc=(0, -0.4, 0)), barrel)
    part('tip', bm_box((0.16, 0.08, 0.16), loc=(0, -0.82, 0)), barrel, mat='Hot')


def turret_needler():
    root = empty('root')
    turret_base(root)
    yaw = empty('yaw', root, (0, 0, 0.42))
    part('head', bm_cyl(0.32, 0.36, 6, loc=(0, 0.05, 0.12), rot=(90, 0, 0)), yaw)
    barrel = empty('barrel', yaw, (0, -0.15, 0.12))
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        part(f'needle{i}', bm_box((0.06, 0.9, 0.06), loc=(math.cos(a) * 0.12, -0.45, math.sin(a) * 0.12)), barrel)
    part('collar', bm_torus(0.18, 0.04, 8, loc=(0, -0.7, 0), rot=(90, 0, 0)), barrel, mat='Glow')


def turret_warhead():
    root = empty('root')
    turret_base(root, 0.55)
    yaw = empty('yaw', root, (0, 0, 0.45))
    part('arm', bm_box((0.2, 0.3, 0.4), loc=(0, 0.1, 0.12)), yaw)
    barrel = empty('barrel', yaw, (0, 0, 0.42))
    part('pod', bm_box((0.8, 0.7, 0.5), loc=(0, 0, 0)), barrel)
    for row in range(2):
        for col in range(3):
            part(f'tube{row}{col}', bm_box((0.14, 0.05, 0.14),
                                           loc=(-0.24 + col * 0.24, -0.36, -0.1 + row * 0.22)), barrel, mat='Glow')


def turret_lance():
    root = empty('root')
    turret_base(root, 0.55)
    yaw = empty('yaw', root, (0, 0, 0.45))
    part('cradle', bm_frustum((0.6, 0.6), (0.4, 0.4), 0.3, loc=(0, 0.1, 0.1)), yaw)
    barrel = empty('barrel', yaw, (0, -0.1, 0.3))
    for side in (-1, 1):
        part(f'prong{side}', bm_box((0.08, 1.6, 0.16), loc=(0.14 * side, -0.7, 0)), barrel)
        part(f'prongGlow{side}', bm_box((0.03, 1.4, 0.05), loc=(0.09 * side, -0.72, 0)), barrel, mat='Glow')
    for k in range(3):
        part(f'coil{k}', bm_torus(0.2, 0.03, 8, loc=(0, -0.3 - k * 0.45, 0), rot=(90, 0, 0)), barrel, mat='Glow')


def turret_rail():
    """The player's own cannon: bigger than any mount, centre of the wall."""
    root = empty('root')
    turret_base(root, 0.9)
    yaw = empty('yaw', root, (0, 0, 0.5))
    part('housing', bm_frustum((1.1, 1.3), (0.8, 0.9), 0.55, loc=(0, 0.15, 0.2)), yaw)
    part('housingGlow', bm_box((0.9, 0.05, 0.06), loc=(0, -0.5, 0.38)), yaw, mat='Glow')
    barrel = empty('barrel', yaw, (0, -0.3, 0.25))
    for side in (-1, 1):
        part(f'rail{side}', bm_box((0.1, 1.9, 0.22), loc=(0.17 * side, -0.9, 0)), barrel)
        part(f'railGlow{side}', bm_box((0.03, 1.7, 0.08), loc=(0.11 * side, -0.92, 0)), barrel, mat='Glow')
    part('chamber', bm_box((0.2, 0.3, 0.2), loc=(0, -0.05, 0)), barrel, mat='Hot')


MODELS = {
    'crawler': crawler, 'grunt': grunt, 'sapper': sapper, 'drone': drone, 'brute': brute,
    'spitter': spitter, 'warden': warden, 'tank': tank, 'artillery': artillery, 'gunship': gunship,
    'titan': titan, 'leviathan': leviathan, 'phantom': phantom, 'zeroday': zeroday,
    'turret-gun': turret_gun, 'turret-needler': turret_needler, 'turret-warhead': turret_warhead,
    'turret-lance': turret_lance, 'turret-rail': turret_rail
}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    names = argv or list(MODELS)
    for name in names:
        reset_scene()
        MATERIALS.clear()
        MODELS[name]()
        export(name)


main()
