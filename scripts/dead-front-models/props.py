"""
Dead Front props and lamp fixtures (headless Blender).

Builds public/dead-front/models/props.glb: the map props (DfPropKind in
shared/utils/dead-front/map-world.ts, sized to DF_PROP_DEFS) and the lamp
fixtures used by app/utils/dead-front/world/lights.ts. Comic look: chunky,
bevelled, slightly exaggerated shapes in a few flat colours per object.

Conventions (glTF/three space): origin at the bottom centre, +x along the
prop's width, +z its depth (Blender -Y). Variants are `<kind>-<n>`.

Run:  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python scripts/dead-front-models/props.py [-- --preview /tmp/props.png]
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import args, export_pack, mat, render_preview, reset_scene, shade_smooth  # noqa: E402

reset_scene()
SCENE = bpy.context.scene

# ---------------------------------------------------------------- palette

WOOD = mat('wood', 0x8a6640)
WOOD_D = mat('wood-dark', 0x4e3521)
WOOD_L = mat('wood-light', 0xa98250)
WOOD_GREY = mat('wood-grey', 0x7d766a)
OLIVE = mat('olive', 0x5b6240)
OLIVE_D = mat('olive-dark', 0x3a3f29)
STENCIL = mat('stencil', 0xd8cfa8)
INK = mat('ink', 0x231c16)
IRON = mat('iron', 0x2f3034)
IRON_L = mat('iron-light', 0x4a4c52)
RUST = mat('rust', 0x7a3e24)
SACK = mat('sack', 0xa89a6c)
SACK_D = mat('sack-dark', 0x8a7c54)
SACK_L = mat('sack-light', 0xbcae80)
STRAW = mat('straw', 0xd2ad5a)
STRAW_D = mat('straw-dark', 0xa8823c)
TWINE = mat('twine', 0x6e4f26)
STONE = mat('stone', 0x8f8b82)
STONE_D = mat('stone-dark', 0x6c6961)
STONE_L = mat('stone-light', 0xa7a398)
CARVE = mat('carve', 0x45433e)
MOSS = mat('moss', 0x5a6b3a)
PAINT = mat('paint-white', 0xd8d1bf)
BRICK = mat('brick', 0x9a4e36)
DIRT = mat('dirt', 0x4b3a2a)
BARK = mat('bark', 0x4d3b2b)
BARK_D = mat('bark-dead', 0x5a4d40)
LEAF_D = mat('leaf-dark', 0x2c4723)
LEAF = mat('leaf', 0x3f6430)
LEAF_L = mat('leaf-light', 0x5a8240)
BARREL_RED = mat('barrel-red', 0x7a3a22)
GLASS = mat('lamp-glass', 0xffc27a, glow=1.0)
BULB = mat('lamp-bulb', 0xffe2b0, glow=1.0)
LENS = mat('lamp-lens', 0xdbe8ff, glow=1.0)
EMBER = mat('ember', 0xff6a20, glow=1.0)
FLAME = mat('flame', 0xffa64d, glow=1.0)
WAX = mat('wax', 0xe2d8bc)
SHADE_GREEN = mat('shade-green', 0x2f4a33)

# ---------------------------------------------------------------- helpers

_slot = [0]


def root(name):
    """A model's top-level empty. Models are laid out in a row so previews don't overlap."""
    e = bpy.data.objects.new(name, None)
    SCENE.collection.objects.link(e)
    e.location = (_slot[0] * 7.0, 0, 0)
    _slot[0] += 1
    return e


def t3(x, y, z):
    """three.js coordinates (y up, +z towards the viewer) to Blender."""
    return Vector((x, -z, y))


def _finish(name, bm, material, parent, loc, rot, smooth=35, bevel=0.0, seg=2, subsurf=0):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if isinstance(material, list):
        for m in material:
            me.materials.append(m)
    else:
        me.materials.append(material)
    o = bpy.data.objects.new(name, me)
    SCENE.collection.objects.link(o)
    o.parent = parent
    o.location = loc
    o.rotation_euler = Euler(rot)
    if bevel > 0:
        b = o.modifiers.new('bevel', 'BEVEL')
        b.width = bevel
        b.segments = seg
        b.limit_method = 'ANGLE'
        b.angle_limit = math.radians(40)
    if subsurf:
        s = o.modifiers.new('subsurf', 'SUBSURF')
        s.levels = subsurf
        s.render_levels = subsurf
    if smooth:
        shade_smooth(o, smooth)
    return o


def box(parent, size, loc, material, rot=(0, 0, 0), bevel=0.02, seg=2, taper=None):
    """A bevelled box (Blender axes: size = (x, y, z), loc is the centre)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
        if taper and v.co.z > 0:
            v.co.x *= taper[0]
            v.co.y *= taper[1]
    return _finish('box', bm, material, parent, loc, rot, bevel=bevel, seg=seg)


def lathe(parent, profile, loc, material, seg=16, rot=(0, 0, 0), smooth=50, cap_top=True, cap_bottom=True):
    """A surface of revolution about Blender Z: profile is [(radius, z), ...] bottom to top."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring = []
        for i in range(seg):
            a = i / seg * math.tau
            ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap_bottom and profile[0][0] > 1e-4:
        bm.faces.new(list(reversed(rings[0])))
    if cap_top and profile[-1][0] > 1e-4:
        bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish('lathe', bm, material, parent, loc, rot, smooth=smooth)


def cyl(parent, r, h, loc, material, rot=(0, 0, 0), seg=12, r2=None, smooth=50, bevel=0.0):
    """A cylinder centred on loc, axis along local Z."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    return _finish('cyl', bm, material, parent, loc, rot, smooth=smooth, bevel=bevel)


def pillow(parent, size, loc, material, rot=(0, 0, 0), e=0.3, seg=12, rings=8, sag=0.0, rnd=None, bulge=0.0):
    """A superellipsoid (a soft box: bags, bales, rocks). size = full extents."""
    bm = bmesh.new()
    rnd = rnd or random.Random(1)
    rows = []
    for j in range(1, rings):
        t = j / rings * math.pi - math.pi / 2
        row = []
        for i in range(seg):
            a = i / seg * math.tau
            ct, st = math.cos(t), math.sin(t)
            ca, sa = math.cos(a), math.sin(a)
            sp = lambda w, p: math.copysign(abs(w) ** p, w)  # noqa: E731
            x = sp(ct, e) * sp(ca, e)
            y = sp(ct, e) * sp(sa, e)
            z = sp(st, e)
            # Sag: the top dips in the middle, bulging the sides.
            if sag and z > 0:
                z -= sag * (1 - x * x) * z
            if bulge:
                k = 1 + bulge * (1 - z * z)
                x *= k
                y *= k
            jit = 1 + (rnd.random() - 0.5) * 0.06
            row.append(bm.verts.new((x * size[0] / 2 * jit, y * size[1] / 2 * jit, z * size[2] / 2)))
        rows.append(row)
    bot = bm.verts.new((0, 0, -size[2] / 2))
    top = bm.verts.new((0, 0, size[2] / 2 * (1 - sag)))
    for a, b in zip(rows, rows[1:]):
        for i in range(seg):
            k = (i + 1) % seg
            bm.faces.new((a[i], a[k], b[k], b[i]))
    for i in range(seg):
        k = (i + 1) % seg
        bm.faces.new((rows[0][k], rows[0][i], bot))
        bm.faces.new((rows[-1][i], rows[-1][k], top))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish('pillow', bm, material, parent, loc, rot, smooth=70)


def blob(parent, radii, loc, material, rnd, subdiv=2, noise=0.18, rot=(0, 0, 0), flat_bottom=None):
    """A lumpy icosphere (foliage clumps, rocks)."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    # Low-frequency lumps: a few random bumps, not per-vertex noise.
    bumps = [(Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))).normalized(), rnd.uniform(0.5, 1.0)) for _ in range(7)]
    for v in bm.verts:
        n = v.co.normalized()
        d = 1.0
        for b, w in bumps:
            d += noise * w * max(0.0, n.dot(b)) ** 3
        d -= noise * 0.35
        v.co = n * d
        v.co.x *= radii[0]
        v.co.y *= radii[1]
        v.co.z *= radii[2]
        if flat_bottom is not None and v.co.z < flat_bottom:
            v.co.z = flat_bottom
    return _finish('blob', bm, material, parent, loc, rot, smooth=80)


def tube(parent, pts, radii, material, sides=6, smooth=60, cap=True):
    """A tapered tube through Blender-space points (branches, wire, shafts)."""
    bm = bmesh.new()
    pts = [Vector(p) for p in pts]
    rings = []
    prev_n = None
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if prev_n is None:
            ref = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
            prev_n = d.cross(ref).normalized()
        n = (prev_n - d * prev_n.dot(d)).normalized()
        prev_n = n
        b = d.cross(n).normalized()
        ring = []
        for s in range(sides):
            a = s / sides * math.tau
            ring.append(bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * radii[i]))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for s in range(sides):
            k = (s + 1) % sides
            bm.faces.new((a[s], a[k], b[k], b[s]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        tip = bm.verts.new(pts[-1] + (pts[-1] - pts[-2]).normalized() * radii[-1] * 0.8)
        for s in range(sides):
            k = (s + 1) % sides
            bm.faces.new((rings[-1][s], rings[-1][k], tip))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish('tube', bm, material, parent, (0, 0, 0), (0, 0, 0), smooth=smooth)


def wheel(parent, centre, radius, width, axis, rim_mat, spoke_mat, spokes=10):
    """A spoked cart/gun wheel. axis 'x' or 'y' (Blender) is the axle."""
    rot = (0, math.pi / 2, 0) if axis == 'x' else (math.pi / 2, 0, 0)
    c = Vector(centre)
    # Rim: a lathe ring section (a flat torus) built on Z then rotated.
    bm = bmesh.new()
    seg = 28
    prof = [(radius - 0.07, -width / 2), (radius, -width / 2), (radius + 0.015, 0), (radius, width / 2), (radius - 0.07, width / 2), (radius - 0.08, 0)]
    rings = []
    for r, z in prof:
        rings.append([bm.verts.new((math.cos(i / seg * math.tau) * r, math.sin(i / seg * math.tau) * r, z)) for i in range(seg)])
    for k in range(len(rings)):
        a, b = rings[k], rings[(k + 1) % len(rings)]
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _finish('rim', bm, rim_mat, parent, c, rot, smooth=50)
    cyl(parent, radius * 0.17, width * 1.5, c, spoke_mat, rot=rot, seg=10, bevel=0.01)
    for s in range(spokes):
        a = s / spokes * math.tau
        if axis == 'x':
            d = Vector((0, math.cos(a), math.sin(a)))
        else:
            d = Vector((math.cos(a), 0, math.sin(a)))
        p0 = c + d * radius * 0.15
        p1 = c + d * (radius - 0.06)
        tube(parent, [p0, p1], [0.032, 0.022], spoke_mat, sides=5, cap=False)


# ---------------------------------------------------------------- props


def crate(n):
    r = root(f'crate-{n}')
    rnd = random.Random(10 + n)
    if n == 0:
        # Plank crate: a dark frame on every edge, a diagonal brace, a stencil.
        box(r, (0.94, 0.94, 0.94), (0, 0, 0.47), WOOD, bevel=0.015)
        f = 0.11
        for sx in (-1, 1):
            for sy in (-1, 1):
                box(r, (f, f, 1.0), (sx * (0.5 - f / 2), sy * (0.5 - f / 2), 0.5), WOOD_D, bevel=0.025)
                box(r, (1.0, f, f), (0, sy * (0.5 - f / 2), 0.5 + sx * (0.5 - f / 2)), WOOD_D, bevel=0.025)
                box(r, (f, 1.0, f), (sx * (0.5 - f / 2), 0, 0.5 + sy * (0.5 - f / 2)), WOOD_D, bevel=0.025)
        for side, rot in ((0, (0, 0, 0)), (1, (0, 0, math.pi / 2))):
            d = 0.49
            loc = (0, -d, 0.5) if side == 0 else (d, 0, 0.5)
            box(r, (1.08, 0.05, 0.1), loc, WOOD_D, rot=(rot[0], 0.78 if side == 0 else 0, rot[2]) if side == 0 else (0.78, 0, math.pi / 2), bevel=0.015)
        # plank grooves
        for z in (0.32, 0.64):
            box(r, (0.8, 0.96, 0.025), (0, 0, z), INK, bevel=0.0)
            box(r, (0.96, 0.8, 0.025), (0, 0, z), INK, bevel=0.0)
        box(r, (0.24, 0.02, 0.14), (0.16, -0.505, 0.72), STENCIL, bevel=0.0, rot=(0, 0.1, 0))
    else:
        # Olive army crate: painted slab, rope handles, stencilled lid.
        box(r, (0.98, 0.98, 0.86), (0, 0, 0.43), OLIVE, bevel=0.05, seg=3)
        box(r, (1.0, 1.0, 0.16), (0, 0, 0.92), OLIVE_D, bevel=0.05, seg=3)
        for z in (0.2, 0.62):
            box(r, (1.02, 1.02, 0.07), (0, 0, z), OLIVE_D, bevel=0.02)
        for sx in (-1, 1):
            tube(r, [(sx * 0.5, -0.14, 0.52), (sx * 0.54, -0.1, 0.46), (sx * 0.54, 0.1, 0.46), (sx * 0.5, 0.14, 0.52)], [0.022] * 4, TWINE, sides=5)
        box(r, (0.5, 0.02, 0.16), (0, -0.505, 0.42), STENCIL, bevel=0.0)
        box(r, (0.3, 0.02, 0.06), (0, -0.505, 0.29), STENCIL, bevel=0.0)


def sandbags():
    r = root('sandbags')
    rnd = random.Random(3)
    cols = [SACK, SACK_D, SACK_L]
    # Headers: 0.5 wide (x), 0.78 deep (y), ~0.27 tall, four courses, the top set back.
    courses = [(0.0, 4, 0.0, 0.78), (0.25, 4, 0.0, 0.78), (0.0, 4, 0.0, 0.74), (0.25, 3, 0.16, 0.44)]
    z = 0.0
    for c, (off, count, back, depth) in enumerate(courses):
        h = 0.27 if c < 3 else 0.26
        w = 2.0 / 4
        for b in range(count):
            x = -1.0 + w / 2 + b * w + (off if c % 2 else 0)
            width = w * 1.06
            if x + width / 2 > 1.0:
                x -= (x + width / 2 - 1.0)
            if c == 3:
                x = -0.75 + b * 0.75
                width = 0.72
            loc = (x + rnd.uniform(-0.02, 0.02), back + rnd.uniform(-0.02, 0.02), z + h / 2 - 0.02)
            pillow(r, (width, depth, h + 0.04), loc, cols[rnd.randrange(3)], rot=(rnd.uniform(-0.04, 0.04), rnd.uniform(-0.05, 0.05), rnd.uniform(-0.06, 0.06)), e=0.35, sag=0.25, bulge=0.05, rnd=rnd)
        z += h - 0.03


def barrel():
    r = root('barrel')
    prof = [(0.25, 0.0), (0.27, 0.06), (0.3, 0.25), (0.31, 0.45), (0.3, 0.65), (0.27, 0.84), (0.25, 0.9)]
    lathe(r, prof, (0, 0, 0), BARREL_RED, seg=18)
    for z, rad in ((0.12, 0.29), (0.78, 0.29)):
        lathe(r, [(rad, z - 0.035), (rad + 0.012, z), (rad, z + 0.035)], (0, 0, 0), IRON, seg=18, cap_top=False, cap_bottom=False, smooth=70)
    lathe(r, [(0.215, 0.88), (0.215, 0.905), (0.0, 0.905)], (0, 0, 0), INK, seg=18)
    cyl(r, 0.035, 0.03, (0.12, -0.08, 0.9), IRON_L, seg=8)


def cart():
    r = root('cart')
    # Bed: x from -0.95 to 1.5 (three +x), the shafts run out to -1.5.
    box(r, (2.45, 1.45, 0.1), (0.27, 0, 0.72), WOOD, bevel=0.02)
    for y in (-0.7, 0.7):
        box(r, (2.45, 0.08, 0.42), (0.27, y, 0.96), WOOD_L if y < 0 else WOOD, bevel=0.025)
        for x in (-0.85, 0.15, 1.1):
            box(r, (0.1, 0.12, 0.5), (x, y, 0.95), WOOD_D, bevel=0.02)
    box(r, (0.08, 1.45, 0.42), (1.47, 0, 0.96), WOOD, bevel=0.025)
    # broken board on the far side
    box(r, (0.7, 0.07, 0.12), (0.6, 0.72, 1.14), WOOD_D, rot=(0, 0.35, 0), bevel=0.02)
    # sacks in the bed
    pillow(r, (0.7, 0.45, 0.32), (0.85, -0.2, 0.9), SACK, rot=(0, 0.1, 0.5), e=0.35, sag=0.2)
    pillow(r, (0.62, 0.42, 0.3), (1.0, 0.3, 0.88), SACK_D, rot=(0.1, 0, -0.3), e=0.35, sag=0.2)
    # frame and shafts down to the ground
    for y in (-0.42, 0.42):
        tube(r, [(1.45, y, 0.62), (-0.9, y, 0.62), (-1.48, y * 0.85, 0.06)], [0.05, 0.05, 0.04], WOOD_D, sides=6)
    box(r, (0.1, 1.45, 0.1), (-0.95, 0, 0.62), WOOD_D, bevel=0.02)
    # axle and wheels
    cyl(r, 0.05, 1.76, (0.35, 0, 0.62), IRON, rot=(math.pi / 2, 0, 0), seg=8)
    for y in (-0.82, 0.82):
        wheel(r, (0.35, y, 0.62), 0.62, 0.09, 'y', IRON, WOOD_D)


def gravestone(n):
    r = root(f'gravestone-{n}')
    lean = (0.05, 0.0, 0.04) if n == 0 else (-0.07, 0.0, -0.05)
    holder = bpy.data.objects.new(f'gravestone-{n}-lean', None)
    SCENE.collection.objects.link(holder)
    holder.parent = r
    holder.rotation_euler = Euler(lean)
    if n == 0:
        # Round-topped headstone with a carved cross.
        box(holder, (0.74, 0.24, 0.66), (0, 0, 0.35), STONE, bevel=0.035, seg=3)
        cyl(holder, 0.37, 0.24, (0, 0, 0.66), STONE, rot=(math.pi / 2, 0, 0), seg=24, smooth=40)
        box(holder, (0.07, 0.03, 0.42), (0, -0.115, 0.58), CARVE, bevel=0.0)
        box(holder, (0.26, 0.03, 0.07), (0, -0.115, 0.68), CARVE, bevel=0.0)
        box(holder, (0.4, 0.03, 0.04), (0, -0.115, 0.26), CARVE, bevel=0.0)
        box(holder, (0.3, 0.03, 0.03), (0, -0.115, 0.19), CARVE, bevel=0.0)
        box(holder, (0.8, 0.3, 0.12), (0, 0, 0.05), STONE_D, bevel=0.03)
        blob(holder, (0.18, 0.06, 0.08), (-0.26, -0.13, 0.12), MOSS, random.Random(4), subdiv=1, noise=0.3)
        blob(holder, (0.12, 0.05, 0.1), (0.3, -0.12, 0.62), MOSS, random.Random(5), subdiv=1, noise=0.3)
    else:
        # Gothic stone: pointed arch top, a chipped corner, plinth.
        bm = bmesh.new()
        pts = [(-0.34, 0.0), (0.34, 0.0), (0.34, 0.68)]
        for i in range(1, 7):
            a = i / 7
            pts.append((0.34 * (1 - a) ** 1.2 * (1 if i < 7 else 0), 0.68 + 0.3 * math.sin(a * math.pi / 2)))
        pts.append((0.0, 0.98))
        for i in range(6, 0, -1):
            a = i / 7
            pts.append((-0.34 * (1 - a) ** 1.2, 0.68 + 0.3 * math.sin(a * math.pi / 2)))
        pts.append((-0.34, 0.68))
        front = [bm.verts.new((x, -0.11, z)) for x, z in pts]
        back = [bm.verts.new((x, 0.11, z)) for x, z in pts]
        bm.faces.new(front)
        bm.faces.new(list(reversed(back)))
        for i in range(len(pts)):
            k = (i + 1) % len(pts)
            bm.faces.new((front[i], back[i], back[k], front[k]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
        _finish('stone', bm, STONE_L, holder, (0, 0, 0.1), (0, 0, 0), smooth=35, bevel=0.03, seg=2)
        box(holder, (0.06, 0.03, 0.3), (0, -0.115, 0.72), CARVE, bevel=0.0)
        box(holder, (0.2, 0.03, 0.06), (0, -0.115, 0.8), CARVE, bevel=0.0)
        box(holder, (0.36, 0.03, 0.035), (0, -0.115, 0.42), CARVE, bevel=0.0)
        box(holder, (0.8, 0.3, 0.12), (0, 0, 0.05), STONE_D, bevel=0.03)
        blob(holder, (0.2, 0.08, 0.06), (0.2, -0.14, 0.13), MOSS, random.Random(6), subdiv=1, noise=0.3)


def cross(n):
    r = root(f'cross-{n}')
    holder = bpy.data.objects.new(f'cross-{n}-lean', None)
    SCENE.collection.objects.link(holder)
    holder.parent = r
    holder.rotation_euler = Euler((0.06, 0, 0.09) if n == 0 else (-0.05, 0, -0.11))
    paint = PAINT if n == 0 else WOOD_GREY
    box(holder, (0.13, 0.11, 1.38), (0, 0, 0.66), paint, bevel=0.025)
    box(holder, (0.72, 0.1, 0.12), (0, 0, 0.98), paint, bevel=0.025, rot=(0, 0.04 if n == 0 else -0.06, 0))
    box(holder, (0.18, 0.03, 0.1), (0, -0.065, 0.82), INK if n == 0 else CARVE, bevel=0.005)
    if n == 1:
        # A soldier's helmet hung on the cross.
        lathe(holder, [(0.0, 0.11), (0.08, 0.1), (0.13, 0.06), (0.15, 0.02), (0.2, 0.0), (0.2, -0.015), (0.0, -0.01)], (0.0, -0.08, 1.02), OLIVE, seg=16, rot=(0.25, 0, 0))
    # A mound of earth at the foot.
    blob(r, (0.34, 0.2, 0.09), (0, 0, 0.0), DIRT, random.Random(7 + n), subdiv=2, noise=0.25, flat_bottom=0.0)


def tree(n):
    r = root(f'tree-{n}')
    rnd = random.Random(20 + n)
    # Trunk: a tapered, slightly bent tube with flared roots, 0.8 m collision.
    lean = 0.12 if n == 0 else -0.18
    trunk = [(0, 0, -0.05), (0.02, 0.0, 0.8), (lean * 0.5, 0.05, 1.8), (lean, 0.02, 2.8), (lean * 1.4, 0.0, 3.8)]
    tube(r, trunk, [0.36, 0.28, 0.24, 0.2, 0.14], BARK, sides=9)
    for a in range(5):
        ang = a / 5 * math.tau + rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(ang), math.sin(ang), 0))
        tube(r, [d * 0.1 + Vector((0, 0, 0.45)), d * 0.45 + Vector((0, 0, 0.06)), d * 0.62 + Vector((0, 0, -0.05))], [0.15, 0.09, 0.04], BARK, sides=6)
    # Limbs into the canopy.
    for ang, z, ln in ((0.4, 2.3, 1.1), (2.6, 2.6, 1.0), (4.4, 2.9, 0.9)):
        d = Vector((math.cos(ang), math.sin(ang), 0))
        b0 = Vector((lean * 0.8, 0, z))
        tube(r, [b0, b0 + d * ln * 0.5 + Vector((0, 0, 0.35)), b0 + d * ln + Vector((0, 0, 0.8))], [0.12, 0.08, 0.05], BARK, sides=6)
    # Canopy: clumped lumpy blobs, dark below, light on top.
    if n == 0:
        clumps = [((0.1, 0, 4.4), (1.55, 1.55, 1.2), LEAF), ((-1.05, 0.35, 3.75), (1.0, 1.0, 0.85), LEAF_D), ((1.0, -0.45, 3.85), (1.05, 1.0, 0.85), LEAF_D),
                  ((0.35, 0.95, 3.9), (0.95, 0.9, 0.8), LEAF_D), ((-0.25, -0.9, 4.1), (0.95, 0.9, 0.8), LEAF), ((0.2, 0.15, 5.45), (1.05, 1.0, 0.85), LEAF_L),
                  ((-0.75, -0.2, 4.95), (0.8, 0.8, 0.7), LEAF_L), ((0.9, 0.5, 4.85), (0.75, 0.75, 0.65), LEAF_L)]
    else:
        clumps = [((-0.2, 0, 4.2), (1.35, 1.3, 1.25), LEAF), ((0.95, 0.4, 3.6), (0.9, 0.85, 0.75), LEAF_D), ((-1.2, -0.3, 3.85), (0.85, 0.85, 0.75), LEAF_D),
                  ((-0.4, 0.9, 4.0), (0.9, 0.8, 0.75), LEAF), ((-0.35, 0.0, 5.35), (1.0, 0.95, 0.95), LEAF_L), ((0.6, -0.7, 4.7), (0.8, 0.75, 0.7), LEAF_L)]
    for c, rad, m in clumps:
        blob(r, rad, c, m, rnd, subdiv=3, noise=0.32)


def dead_tree(n):
    r = root(f'dead-tree-{n}')
    rnd = random.Random(40 + n)
    lean = Vector((0.12, -0.06, 0)) if n == 0 else Vector((-0.1, 0.1, 0))

    def branch(p, d, length, rad, depth):
        pts = [p]
        radii = [rad]
        steps = 4
        cur = Vector(p)
        dd = Vector(d).normalized()
        for s in range(steps):
            dd = (dd + Vector((rnd.uniform(-0.35, 0.35), rnd.uniform(-0.35, 0.35), rnd.uniform(-0.1, 0.25)))).normalized()
            cur = cur + dd * length / steps
            pts.append(cur.copy())
            radii.append(rad * (1 - (s + 1) / steps * 0.8))
        tube(r, pts, radii, BARK_D, sides=6 if rad > 0.05 else 5)
        if depth > 0:
            for k in range(2 if depth > 1 else rnd.choice((1, 2))):
                i = rnd.randint(2, steps)
                side = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(0.2, 0.9))).normalized()
                branch(pts[i], (dd + side * 1.2).normalized(), length * 0.55, radii[i] * 0.85, depth - 1)

    # Trunk: snapped top, gnarled bends.
    trunk = [Vector((0, 0, -0.05)), Vector((0.05, 0.0, 0.9)) + lean, Vector((-0.08, 0.06, 1.9)) + lean * 2, Vector((0.1, -0.04, 2.9)) + lean * 3, Vector((0.02, 0.0, 3.6)) + lean * 3.5]
    tube(r, trunk, [0.3, 0.22, 0.18, 0.13, 0.07], BARK_D, sides=8)
    for a in range(4):
        ang = a / 4 * math.tau + 0.4
        d = Vector((math.cos(ang), math.sin(ang), 0))
        tube(r, [d * 0.08 + Vector((0, 0, 0.4)), d * 0.38 + Vector((0, 0, 0.05)), d * 0.55 + Vector((0, 0, -0.05))], [0.12, 0.07, 0.03], BARK_D, sides=5)
    for i, (ang, up) in enumerate(((0.3, 0.5), (2.3, 0.7), (4.0, 0.45), (5.4, 0.9))):
        p = trunk[1 + i % 3].lerp(trunk[2 + i % 3], 0.5)
        d = Vector((math.cos(ang + n), math.sin(ang + n), up))
        branch(p, d, 1.5 - i * 0.1, 0.1, 2 if i < 2 else 1)


def lamppost():
    r = root('lamppost')
    lathe(r, [(0.2, 0.0), (0.2, 0.08), (0.15, 0.12), (0.13, 0.32), (0.08, 0.38), (0.06, 0.45)], (0, 0, 0), IRON, seg=12)
    lathe(r, [(0.055, 0.45), (0.045, 2.55), (0.06, 2.6), (0.06, 2.66), (0.04, 2.7)], (0, 0, 0), IRON, seg=10)
    # Collar with curly brackets under the head.
    for a in range(4):
        ang = a / 4 * math.tau + math.pi / 4
        d = Vector((math.cos(ang), math.sin(ang), 0))
        tube(r, [Vector((0, 0, 2.42)) + d * 0.04, Vector((0, 0, 2.5)) + d * 0.15, Vector((0, 0, 2.7)) + d * 0.15], [0.02, 0.018, 0.016], IRON, sides=5)
    # Lantern head: flared glass, iron frame, pyramid cap and finial.
    box(r, (0.3, 0.3, 0.05), (0, 0, 2.73), IRON, bevel=0.012)
    box(r, (0.3, 0.3, 0.42), (0, 0, 2.97), GLASS, bevel=0.0, taper=(1.33, 1.33))
    for sx in (-1, 1):
        for sy in (-1, 1):
            tube(r, [(sx * 0.15, sy * 0.15, 2.74), (sx * 0.2, sy * 0.2, 3.19)], [0.018, 0.018], IRON, sides=5, cap=False)
    box(r, (0.46, 0.46, 0.05), (0, 0, 3.2), IRON, bevel=0.012)
    box(r, (0.42, 0.42, 0.2), (0, 0, 3.33), IRON, bevel=0.01, taper=(0.2, 0.2))
    cyl(r, 0.03, 0.12, (0, 0, 3.47), IRON, seg=8)
    lathe(r, [(0.0, 3.52), (0.035, 3.55), (0.0, 3.6)], (0, 0, 0), IRON, seg=8)


def fence():
    r = root('fence')
    rnd = random.Random(8)
    for i, x in enumerate((-0.94, 0.0, 0.94)):
        h = 1.1 - (0.12 if i == 1 else 0)
        box(r, (0.12, 0.1, h - 0.1), (x, 0, (h - 0.1) / 2), WOOD_GREY if i != 1 else WOOD, rot=(0, (rnd.random() - 0.5) * 0.12, 0), bevel=0.02)
        box(r, (0.12, 0.1, 0.12), (x, 0, h - 0.07), WOOD_GREY if i != 1 else WOOD, rot=(0, 0, math.pi / 4), bevel=0.0, taper=(0.1, 0.1))
    box(r, (2.0, 0.05, 0.12), (0, -0.07, 0.42), WOOD, rot=(0, 0.02, 0), bevel=0.02)
    box(r, (1.15, 0.05, 0.12), (-0.43, -0.07, 0.8), WOOD_GREY, rot=(0, -0.02, 0), bevel=0.02)
    # A broken rail hanging off the right post.
    box(r, (0.85, 0.05, 0.11), (0.52, -0.07, 0.63), WOOD, rot=(0, 0.42, 0), bevel=0.02)


def hay():
    r = root('hay')
    pillow(r, (1.25, 0.8, 0.78), (0, 0, 0.39), STRAW, e=0.22, seg=16, rings=10, rnd=random.Random(2))
    for x in (-0.32, 0.32):
        pillow(r, (0.05, 0.84, 0.82), (x, 0, 0.39), TWINE, e=0.22, seg=12, rings=8)
    # Loose straw on top.
    rnd = random.Random(9)
    for i in range(7):
        x, y = rnd.uniform(-0.5, 0.5), rnd.uniform(-0.3, 0.3)
        a = rnd.uniform(0, math.tau)
        d = Vector((math.cos(a), math.sin(a), 0.1)) * 0.2
        tube(r, [(x, y, 0.77), (x + d.x, y + d.y, 0.8)], [0.015, 0.01], STRAW_D, sides=4)


def pew():
    r = root('pew')
    # Long axis along three z (Blender Y), backrest at three +x.
    box(r, (0.55, 2.9, 0.07), (-0.05, 0, 0.45), WOOD, bevel=0.02)
    box(r, (0.08, 2.9, 0.55), (0.29, 0, 0.67), WOOD, rot=(0, 0.1, 0), bevel=0.02)
    box(r, (0.1, 2.94, 0.06), (0.31, 0, 0.95), WOOD_D, bevel=0.02)
    for y in (-1.46, 1.46):
        bm = bmesh.new()
        prof = [(-0.33, 0.0), (0.35, 0.0), (0.35, 0.92), (0.26, 0.98), (0.18, 0.94), (0.14, 0.62), (-0.2, 0.6), (-0.33, 0.52)]
        f = [bm.verts.new((x, -0.04, z)) for x, z in prof]
        b = [bm.verts.new((x, 0.04, z)) for x, z in prof]
        bm.faces.new(f)
        bm.faces.new(list(reversed(b)))
        for i in range(len(prof)):
            k = (i + 1) % len(prof)
            bm.faces.new((f[i], b[i], b[k], f[k]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.triangulate(bm, faces=[x for x in bm.faces if len(x.verts) > 4])
        _finish('end', bm, WOOD_D, r, (0, y, 0), (0, 0, 0), smooth=30, bevel=0.02)
    box(r, (0.06, 2.85, 0.06), (0.2, 0, 0.12), WOOD_D, bevel=0.01)
    box(r, (0.4, 2.8, 0.03), (-0.05, 0, 0.3), WOOD_D, rot=(0, 0, 0), bevel=0.0)


def fieldgun():
    r = root('fieldgun')
    # Wheels on the x = +-1.08 planes, barrel to three -z (Blender +Y), trail to +z.
    for x in (-1.06, 1.06):
        wheel(r, (x, 0, 0.68), 0.68, 0.12, 'x', IRON, OLIVE_D, spokes=12)
    cyl(r, 0.06, 2.1, (0, 0, 0.68), IRON, rot=(0, math.pi / 2, 0), seg=10)
    # Shield: a bent plate with a cut-out for the barrel.
    box(r, (1.75, 0.05, 0.9), (0, 0.18, 1.08), OLIVE, rot=(-0.12, 0, 0), bevel=0.02)
    box(r, (1.75, 0.05, 0.42), (0, 0.13, 0.48), OLIVE, rot=(0.05, 0, 0), bevel=0.02)
    box(r, (0.6, 0.05, 0.12), (0, 0.24, 1.56), OLIVE_D, rot=(-0.25, 0, 0), bevel=0.02)
    # Cradle, recoil cylinder and barrel.
    box(r, (0.34, 1.1, 0.26), (0, -0.05, 0.9), OLIVE_D, bevel=0.04, seg=3)
    cyl(r, 0.13, 1.25, (0, 0.2, 1.08), OLIVE, rot=(math.pi / 2, 0, 0), seg=14, bevel=0.01)
    lathe(r, [(0.1, 0.0), (0.085, 0.4), (0.07, 1.25), (0.08, 1.3), (0.08, 1.38), (0.05, 1.4)], (0, 0.3, 1.0), IRON_L, seg=14, rot=(-math.pi / 2, 0, 0))
    # Trail sloping back to the spade.
    tube(r, [(0, -0.25, 0.85), (0, -1.0, 0.5), (0, -1.6, 0.1)], [0.13, 0.11, 0.09], OLIVE, sides=6)
    box(r, (0.5, 0.08, 0.35), (0, -1.62, 0.16), OLIVE_D, rot=(0.3, 0, 0), bevel=0.02)
    box(r, (0.08, 0.5, 0.06), (0.2, -1.2, 0.42), IRON, rot=(0.6, 0, 0), bevel=0.01)
    # Seat
    box(r, (0.24, 0.18, 0.04), (0.38, -0.3, 0.86), IRON, bevel=0.01)


def wire():
    r = root('wire')
    rnd = random.Random(11)
    # Crossed stakes at both ends.
    for x in (-0.96, 0.96):
        for s in (-1, 1):
            tube(r, [(x, s * 0.3, 0.0), (x, -s * 0.22, 0.72)], [0.035, 0.03], WOOD_D, sides=5)
    # A sagging coil of barbed wire along x.
    pts = []
    radii = []
    turns = 9
    steps = turns * 10
    for i in range(steps + 1):
        t = i / steps
        a = t * turns * math.tau
        x = -0.95 + t * 1.9
        sag = 0.06 * math.sin(t * math.pi)
        pts.append((x + math.sin(a) * 0.04, math.cos(a) * 0.3, 0.34 + math.sin(a) * 0.3 - sag))
        radii.append(0.012)
    tube(r, pts, radii, IRON_L, sides=4, cap=False)
    # Top strand and barbs.
    tube(r, [(-0.96, 0.0, 0.68), (0, 0.02, 0.6), (0.96, 0.0, 0.68)], [0.01] * 3, IRON_L, sides=4, cap=False)
    for i in range(0, steps, 4):
        p = Vector(pts[i])
        d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))).normalized() * 0.04
        tube(r, [p - d, p + d], [0.008, 0.008], RUST, sides=3, cap=False)


def rubble():
    r = root('rubble')
    rnd = random.Random(12)
    mats = [STONE, STONE_D, STONE_L, BRICK]
    for i in range(9):
        a = rnd.uniform(0, math.tau)
        d = rnd.uniform(0, 0.5) if i else 0
        size = rnd.uniform(0.18, 0.3) * (1.6 if i == 0 else 1)
        loc = (math.cos(a) * d, math.sin(a) * d, 0)
        m = mats[i % 4]
        if m is BRICK:
            box(r, (0.28, 0.13, 0.09), (loc[0], loc[1], 0.05 + rnd.uniform(0, 0.05)), m, rot=(rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), a), bevel=0.02)
        else:
            blob(r, (size, size * 0.9, size * 0.7), (loc[0], loc[1], size * 0.15), m, rnd, subdiv=1, noise=0.35, rot=(0, 0, a), flat_bottom=-size * 0.2)
    box(r, (0.6, 0.14, 0.1), (0.15, -0.1, 0.32), WOOD_D, rot=(0.1, -0.35, 0.6), bevel=0.02)


# ---------------------------------------------------------------- lamp fixtures (lights.ts)


def lamp_lantern():
    r = root('lamp-lantern')
    # 0.25 x 0.38 centred on the origin; the hook sits at the top.
    box(r, (0.24, 0.24, 0.05), (0, 0, -0.165), IRON, bevel=0.01)
    lathe(r, [(0.09, -0.14), (0.11, -0.05), (0.11, 0.05), (0.08, 0.13)], (0, 0, 0), GLASS, seg=12)
    for a in range(4):
        ang = a / 4 * math.tau + math.pi / 4
        d = Vector((math.cos(ang), math.sin(ang), 0)) * 0.12
        tube(r, [(d.x * 0.9, d.y * 0.9, -0.15), (d.x * 1.02, d.y * 1.02, 0.0), (d.x * 0.8, d.y * 0.8, 0.14)], [0.012] * 3, IRON, sides=4, cap=False)
    lathe(r, [(0.13, 0.13), (0.13, 0.15), (0.05, 0.19), (0.02, 0.2)], (0, 0, 0), IRON, seg=12)
    lathe(r, [(0.045, 0.21), (0.05, 0.24), (0.035, 0.26)], (0, 0, 0), IRON, seg=8, smooth=80)


def lamp_candles():
    r = root('lamp-candles')
    # Tops match the flame points in lights.ts (three x, flame base y, three z).
    pts = [(-0.09, 0.09, -0.03), (0.03, 0.22, 0.03), (0.16, 0.035, -0.09), (-0.03, 0.15, 0.16)]
    for i, (x, top, z) in enumerate(pts):
        rad = 0.028 if i != 2 else 0.035
        lathe(r, [(rad + 0.012, 0.0), (rad, 0.02), (rad, top - 0.01), (rad * 0.7, top), (0.0, top)], t3(x, 0, z), WAX, seg=10)
        tube(r, [t3(x, top - 0.005, z), t3(x, top + 0.025, z)], [0.005, 0.004], INK, sides=3)
    blob(r, (0.2, 0.18, 0.025), t3(0.03, 0.0, 0.03), WAX, random.Random(3), subdiv=2, noise=0.3, flat_bottom=0.0)


def lamp_brazier():
    r = root('lamp-brazier')
    # 0.5 wide, its rim at the origin, down to -0.375.
    lathe(r, [(0.0, -0.24), (0.12, -0.24), (0.22, -0.16), (0.26, -0.03), (0.27, 0.0), (0.24, 0.0), (0.2, -0.12), (0.0, -0.14)], (0, 0, 0), IRON, seg=16, smooth=40)
    blob(r, (0.2, 0.2, 0.06), (0, 0, -0.06), EMBER, random.Random(5), subdiv=2, noise=0.5)
    lathe(r, [(0.27, -0.03), (0.285, -0.015), (0.27, 0.005)], (0, 0, 0), RUST, seg=16, cap_top=False, cap_bottom=False)
    for a in range(3):
        ang = a / 3 * math.tau
        d = Vector((math.cos(ang), math.sin(ang), 0))
        tube(r, [d * 0.13 + Vector((0, 0, -0.2)), d * 0.22 + Vector((0, 0, -0.3)), d * 0.25 + Vector((0, 0, -0.375))], [0.02, 0.018, 0.02], IRON, sides=5)


def lamp_bulb():
    r = root('lamp-bulb')
    # Enamel shade over a bare bulb: y -0.06 .. 0.19.
    lathe(r, [(0.19, 0.07), (0.16, 0.1), (0.08, 0.16), (0.03, 0.19), (0.0, 0.19)], (0, 0, 0), SHADE_GREEN, seg=16, cap_bottom=False)
    lathe(r, [(0.18, 0.075), (0.15, 0.1), (0.075, 0.15), (0.0, 0.16)], (0, 0, 0), STENCIL, seg=16, cap_bottom=False)
    lathe(r, [(0.0, -0.06), (0.04, -0.05), (0.055, -0.01), (0.04, 0.03), (0.025, 0.06), (0.025, 0.09)], (0, 0, 0), BULB, seg=12)


def lamp_arc():
    r = root('lamp-arc')
    # A drum arc lamp facing down: y -0.19 .. 0.25.
    lathe(r, [(0.2, -0.13), (0.24, -0.12), (0.24, 0.12), (0.18, 0.2), (0.06, 0.22), (0.05, 0.25), (0.0, 0.25)], (0, 0, 0), IRON_L, seg=18, cap_bottom=False)
    lathe(r, [(0.0, -0.19), (0.12, -0.17), (0.2, -0.13), (0.0, -0.11)], (0, 0, 0), LENS, seg=18)
    for z in (-0.06, 0.05):
        lathe(r, [(0.245, z - 0.015), (0.255, z), (0.245, z + 0.015)], (0, 0, 0), IRON, seg=18, cap_top=False, cap_bottom=False)


def lamp_flame():
    r = root('lamp-flame')
    # Unit teardrop, base at 0, 1 tall, 1 wide (scaled per flame).
    lathe(r, [(0.0, 0.0), (0.35, 0.08), (0.5, 0.25), (0.42, 0.45), (0.22, 0.72), (0.0, 1.0)], (0, 0, 0), FLAME, seg=8, smooth=80)


# ---------------------------------------------------------------- ground scatter (decor.ts)

GRASS = [mat('grass-0', 0x4f6a32), mat('grass-1', 0x62803c), mat('grass-2', 0x3f5628), mat('grass-3', 0x78924a)]
POPPY = mat('poppy', 0xc8281c, glow=0.12)
CAMPION = mat('campion', 0xece6d2)
YELLOW = mat('buttercup', 0xe0c860)
PEBBLE = [mat('pebble-0', 0x7d786e), mat('pebble-1', 0x66615a), mat('pebble-2', 0x908a7e)]


def clump(r, rnd, count, height, spread, base=0.03, cols=GRASS):
    """A brushy tuft: curved, tapered blades leaning out from one root."""
    tips = []
    for i in range(count):
        a = i / count * math.tau + rnd.uniform(-0.4, 0.4)
        d = Vector((math.cos(a), math.sin(a), 0))
        h = height * rnd.uniform(0.6, 1.0)
        out = spread * rnd.uniform(0.5, 1.0)
        p0 = d * 0.02
        p1 = d * out * 0.35 + Vector((0, 0, h * 0.55))
        p2 = d * out + Vector((0, 0, h))
        tube(r, [p0, p1, p2], [base, base * 0.6, base * 0.15], cols[i % len(cols)], sides=3, smooth=80)
        tips.append(p2)
    return tips


def decor_tuft(n):
    r = root(f'decor-tuft-{n}')
    rnd = random.Random(60 + n)
    count, h, spread = ((8, 0.3, 0.2), (7, 0.36, 0.15), (6, 0.24, 0.18))[n]
    tips = clump(r, rnd, count, h, spread, base=0.035)
    if n == 2:
        for t in tips[:2]:
            blob(r, (0.025, 0.025, 0.02), t, YELLOW, rnd, subdiv=1, noise=0.1)


def decor_flowers(name, bloom, seed):
    r = root(f'decor-{name}')
    rnd = random.Random(seed)
    clump(r, rnd, 4, 0.14, 0.09, base=0.02)
    for x, y, h in ((-0.06, -0.05, 0.2), (0.06, 0.0, 0.26), (-0.01, 0.08, 0.18)):
        top = Vector((x * 1.4, y * 1.4, h))
        tube(r, [(x * 0.3, y * 0.3, 0), (x, y, h * 0.6), top], [0.007, 0.006, 0.005], GRASS[0], sides=3, cap=False)
        blob(r, (0.04, 0.04, 0.018), top, bloom, rnd, subdiv=1, noise=0.2)


def decor_pebbles(n):
    r = root(f'decor-pebbles-{n}')
    rnd = random.Random(70 + n)
    pts = ((0.0, 0.0, 0.07), (0.13, 0.08, 0.045), (-0.1, 0.1, 0.04), (0.05, -0.12, 0.05)) if n == 0 else ((0.0, 0.0, 0.06), (-0.14, -0.04, 0.05), (0.1, 0.1, 0.035))
    for i, (x, y, rad) in enumerate(pts):
        blob(r, (rad, rad * 0.85, rad * 0.6), (x, y, rad * 0.2), PEBBLE[i % 3], rnd, subdiv=1, noise=0.3, flat_bottom=-rad * 0.2)


def decor_bricks(n):
    r = root(f'decor-bricks-{n}')
    rnd = random.Random(80 + n)
    for i in range(3 if n == 0 else 4):
        x, y = rnd.uniform(-0.2, 0.2), rnd.uniform(-0.18, 0.18)
        m = BRICK if i % 3 != 2 else STONE_L
        sz = (0.22, 0.11, 0.07) if m is BRICK else (0.09, 0.08, 0.05)
        z = 0.035 if i < 3 else 0.1
        box(r, sz, (x, y, z), m, rot=(rnd.uniform(-0.15, 0.15), rnd.uniform(-0.15, 0.15), rnd.uniform(0, math.pi)), bevel=0.015, seg=1)


# ---------------------------------------------------------------- set dressing (map story pieces)

CANVAS = mat('canvas', 0xc9bd96)
CANVAS_D = mat('canvas-dark', 0xa4986f)
CROSS_RED = mat('cross-red', 0xb3302a)
BRONZE = mat('bronze', 0x9a7838)
BRONZE_D = mat('bronze-dark', 0x6b5224)
WOOL = mat('wool', 0x5d6850)
SHEET = mat('sheet', 0xd8d2bf)
DOPE_BLUE = mat('roundel-blue', 0x2f4f93)
STAIN = mat('stain', 0x6d2a24)
SOOT = mat('soot', 0x1d1814)
MUD_R = mat('mud-ring', 0x5a4632)
MUD_RD = mat('mud-ring-dark', 0x3f3226)
OLIVE_L = mat('olive-light', 0x6e7550)
CHALK = mat('chalk', 0xe6e0cc)
SIGN_RED = mat('sign-red', 0x9c3a2c)
SIGN_BLUE = mat('sign-blue', 0x35557e)
SIGN_GREEN = mat('sign-green', 0x4b6a3a)


def plate(parent, pts, thick, loc, material, rot=(0, 0, 0), bevel=0.015):
    """A flat plate: polygon pts in the (Blender x, z) plane, extruded `thick` along Blender y."""
    bm = bmesh.new()
    f = [bm.verts.new((x, -thick / 2, z)) for x, z in pts]
    b = [bm.verts.new((x, thick / 2, z)) for x, z in pts]
    bm.faces.new(list(reversed(f)))
    bm.faces.new(b)
    for i in range(len(pts)):
        k = (i + 1) % len(pts)
        bm.faces.new((f[i], f[k], b[k], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=[x for x in bm.faces if len(x.verts) > 4])
    return _finish('plate', bm, material, parent, loc, rot, smooth=30, bevel=bevel, seg=1)


def biplane():
    """A crashed biplane lying on its belly, nose to +x; one lower wing stub, the upper wing fallen against the fuselage."""
    r = root('biplane')
    rnd = random.Random(31)
    # Soot scar under the wreck.
    blob(r, (2.5, 1.5, 0.03), (-0.1, 0.0, 0.0), SOOT, rnd, subdiv=2, noise=0.25, flat_bottom=-0.0)
    # Fuselage: canvas skin over a wooden frame, torn open behind the cockpit.
    pillow(r, (3.7, 0.86, 0.84), (-0.2, 0, 0.55), CANVAS, e=0.42, seg=14, rings=8, rnd=rnd)
    for x in (-1.5, -1.0, -0.5, 0.0, 0.5):
        box(r, (0.05, 0.8, 0.05), (x, 0, 0.93), WOOD_D, bevel=0.01)
    box(r, (1.0, 0.5, 0.14), (-0.15, 0, 0.93), INK, bevel=0.0)  # cockpit
    box(r, (0.4, 0.5, 0.18), (0.45, 0, 1.0), WOOD_D, rot=(0, -0.3, 0), bevel=0.01)  # broken windscreen frame
    # Radial engine: cowling ring, exposed cylinders, a hub, one snapped blade up and a stub.
    cyl(r, 0.46, 0.5, (1.95, 0, 0.58), IRON_L, rot=(0, math.pi / 2, 0), seg=16, bevel=0.02)
    for a in range(7):
        ang = a / 7 * math.tau
        d = Vector((0, math.cos(ang), math.sin(ang)))
        cyl(r, 0.07, 0.2, Vector((2.18, 0, 0.58)) + d * 0.4, IRON, rot=(0, math.pi / 2, 0), seg=8)
    cyl(r, 0.12, 0.2, (2.32, 0, 0.58), BRONZE, rot=(0, math.pi / 2, 0), seg=10)
    box(r, (0.06, 0.17, 1.15), (2.38, 0.05, 1.18), WOOD, rot=(0.0, 0.0, 0.12), bevel=0.015, taper=(0.7, 1.0))
    box(r, (0.06, 0.17, 0.32), (2.38, 0.0, 0.32), WOOD, rot=(0.0, 0.0, -0.1), bevel=0.015)
    blob(r, (0.13, 0.13, 0.1), (2.5, 0.0, 0.5), EMBER, rnd, subdiv=1, noise=0.4)
    # Tail boom, fin and a one-armed tailplane.
    tube(r, [(-1.9, 0, 0.55), (-2.6, 0, 0.58), (-3.3, 0, 0.7)], [0.3, 0.18, 0.1], CANVAS, sides=8)
    plate(r, [(-0.35, 0), (0.35, 0), (0.1, 0.8)], 0.05, (-3.15, 0, 0.7), CANVAS, rot=(0, 0, 0))
    box(r, (0.55, 1.4, 0.04), (-3.15, 0.0, 0.62), CANVAS, rot=(-0.25, 0, 0), bevel=0.01)
    # Lower wing stub on +y (the tip digs in), exposed ribs, fabric over the root half, roundel.
    for sgn, ln, tilt in ((1, 2.0, -0.2), (-1, 0.7, 0.2)):
        c = sgn * (0.4 + ln / 2)
        for x in (-0.65, 0.65):
            box(r, (0.06, ln, 0.06), (x, c, 0.5 - sgn * 0.0), WOOD_D, rot=(tilt, 0, 0), bevel=0.01)
        for i in range(0, int(ln / 0.4) + 1):
            y = sgn * (0.4 + i * 0.4)
            box(r, (1.4, 0.03, 0.04), (0.0, y, 0.5 + math.tan(tilt) * (y)), WOOD, bevel=0.008)
        box(r, (1.4, min(ln, 1.2), 0.04), (0.0, sgn * (0.4 + min(ln, 1.2) / 2), 0.5 + math.tan(tilt) * sgn * 0.7), CANVAS, rot=(tilt, 0, 0), bevel=0.008)
    cyl(r, 0.28, 0.05, (0.0, 1.0, 0.5 - 0.2 * 1.0 + 0.14), DOPE_BLUE, rot=(-0.2, 0, 0), seg=16)
    cyl(r, 0.18, 0.06, (0.0, 1.0, 0.5 - 0.2 * 1.0 + 0.145), CROSS_RED, rot=(-0.2, 0, 0), seg=16)
    # Upper wing: fallen from the struts, leaning across the fuselage to the -y ground.
    for x in (-0.65, 0.65):
        box(r, (0.06, 2.6, 0.06), (x, -1.3, 0.92), WOOD_D, rot=(0.5, 0, 0), bevel=0.01)
    box(r, (1.4, 2.5, 0.04), (0.0, -1.25, 0.95), CANVAS, rot=(0.5, 0, 0), bevel=0.01)
    box(r, (1.4, 0.9, 0.05), (0.0, -2.0, 0.55), CANVAS_D, rot=(0.5, 0, 0), bevel=0.01)
    cyl(r, 0.3, 0.05, (0.0, -1.0, 1.0), DOPE_BLUE, rot=(0.5, 0, 0), seg=16)
    cyl(r, 0.19, 0.06, (0.0, -1.0, 1.0), CROSS_RED, rot=(0.5, 0, 0), seg=16)
    # Landing gear: one wheel still on a bent strut, rubber tyre.
    tube(r, [(0.7, 0.3, 0.55), (0.9, 0.55, 0.35), (0.95, 0.7, 0.28)], [0.04, 0.04, 0.04], WOOD_D, sides=5, cap=False)
    wheel(r, (0.95, 0.75, 0.3), 0.3, 0.09, 'y', INK, WOOD_D, spokes=8)
    # Wires hanging off the broken struts.
    tube(r, [(0.45, -0.3, 0.9), (0.55, -0.6, 0.7), (0.4, -0.9, 0.35)], [0.008] * 3, IRON_L, sides=3, cap=False)


def tent():
    """A field hospital ridge tent, red cross on the gable, door flaps tied back."""
    r = root('tent')
    hw, hl, wall, ridge = 1.7, 2.1, 1.05, 2.35
    prof = [(-hw, 0.0), (hw, 0.0), (hw, wall), (0.0, ridge), (-hw, wall)]
    bm = bmesh.new()
    front = [bm.verts.new((x, -hl, z)) for x, z in prof]
    back = [bm.verts.new((x, hl, z)) for x, z in prof]
    bm.faces.new(list(reversed(front)))
    bm.faces.new(back)
    for i in range(len(prof)):
        k = (i + 1) % len(prof)
        bm.faces.new((front[i], front[k], back[k], back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _finish('canvas', bm, CANVAS, r, (0, 0, 0), (0, 0, 0), smooth=0, bevel=0.03, seg=2)
    box(r, (0.06, hl * 2 + 0.5, 0.06), (0, 0, ridge + 0.02), WOOD_D, bevel=0.01)
    # Door: dark opening, flaps swept aside, poles.
    plate(r, [(-0.5, 0), (0.5, 0), (0.5, 0.95), (0.0, 1.55), (-0.5, 0.95)], 0.03, (0, -hl - 0.012, 0.0), INK, bevel=0.0)
    for s in (-1, 1):
        plate(r, [(0, 0), (0.45, 0), (0.45, 1.0), (0.12, 1.5), (0, 1.5)], 0.04, (s * 0.52 + (0.0 if s > 0 else -0.45), -hl - 0.03, 0.0), CANVAS, rot=(0, 0, s * 0.18))
        tube(r, [(s * 0.55, -hl - 0.35, 0.0), (s * 0.5, -hl - 0.3, 1.5)], [0.035, 0.03], WOOD_D, sides=5, cap=False)
    # Red cross on a white disc over the door, and on both long sides.
    cyl(r, 0.4, 0.02, (0, -hl - 0.03, 1.72), SHEET, rot=(math.pi / 2, 0, 0), seg=18)
    box(r, (0.54, 0.02, 0.15), (0, -hl - 0.045, 1.72), CROSS_RED, bevel=0.0)
    box(r, (0.15, 0.02, 0.54), (0, -hl - 0.045, 1.72), CROSS_RED, bevel=0.0)
    for s in (-1, 1):
        cyl(r, 0.4, 0.02, (s * (hw + 0.03), 0.0, 0.62), SHEET, rot=(0, math.pi / 2, 0), seg=18)
        box(r, (0.02, 0.54, 0.15), (s * (hw + 0.045), 0.0, 0.62), CROSS_RED, bevel=0.0)
        box(r, (0.02, 0.15, 0.54), (s * (hw + 0.045), 0.0, 0.62), CROSS_RED, bevel=0.0)
    # Guy ropes and pegs.
    for sx in (-1, 1):
        for sy in (-1, 1):
            tube(r, [(sx * hw, sy * (hl - 0.1), wall), (sx * (hw + 0.55), sy * (hl + 0.35), 0.5), (sx * (hw + 1.0), sy * (hl + 0.7), 0.05)], [0.012] * 3, TWINE, sides=3, cap=False)
            cyl(r, 0.03, 0.22, (sx * (hw + 1.0), sy * (hl + 0.7), 0.1), WOOD_D, seg=5)


def hedgehog():
    """A czech hedgehog: three angle-iron beams riveted at the middle."""
    r = root('hedgehog')
    base = Matrix.Rotation(0.62, 3, 'X') @ Matrix.Rotation(0.62, 3, 'Y')
    c = Vector((0, 0, 0.5))
    for i, axis in enumerate(((1, 0, 0), (0, 1, 0), (0, 0, 1))):
        d = base @ Vector(axis)
        tube(r, [c - d * 0.62, c, c + d * 0.62], [0.045, 0.05, 0.045], IRON_L if i != 1 else RUST, sides=4, cap=True)
        tube(r, [c - d * 0.55, c + d * 0.55], [0.07, 0.07], IRON, sides=4, cap=False)
    cyl(r, 0.09, 0.1, c, IRON, seg=8)
    # A twist of wire caught on it.
    tube(r, [c + Vector((0.3, 0.2, 0.0)), c + Vector((0.1, 0.4, 0.2)), c + Vector((-0.3, 0.2, 0.1)), c + Vector((-0.4, -0.2, 0.0))], [0.008] * 4, IRON_L, sides=3, cap=False)


def bell():
    """A church bell fallen on its side with the beam that held it."""
    r = root('bell')
    holder = bpy.data.objects.new('bell-lean', None)
    SCENE.collection.objects.link(holder)
    holder.parent = r
    holder.location = (0.0, 0.0, 0.58)
    holder.rotation_euler = Euler((1.3, 0.0, 0.5))
    prof = [(0.64, -0.5), (0.58, -0.42), (0.47, -0.25), (0.4, 0.05), (0.3, 0.4), (0.2, 0.56), (0.1, 0.62), (0.0, 0.64)]
    lathe(holder, prof, (0, 0, 0), BRONZE, seg=18, cap_bottom=False, smooth=60)
    lathe(holder, [(0.64, -0.5), (0.7, -0.5), (0.7, -0.44), (0.62, -0.42)], (0, 0, 0), BRONZE_D, seg=18, cap_bottom=False, cap_top=False, smooth=40)
    lathe(holder, [(0.52, -0.44), (0.4, 0.2), (0.0, 0.3)], (0, 0, 0), INK, seg=18, cap_bottom=False, smooth=60)
    for z in (0.12, -0.12):
        lathe(holder, [(0.38 + (0.05 if z > 0 else 0.1) * 0.0 + (0.4 - z) * 0.0, z - 0.02), (0.55 - z * 0.7 + 0.01, z), (0.38, z + 0.02)], (0, 0, 0), BRONZE_D, seg=18, cap_top=False, cap_bottom=False, smooth=60)
    # Clapper hanging out of the mouth.
    tube(holder, [(0, 0, 0.3), (0, 0, -0.3), (0.05, 0.0, -0.62)], [0.025, 0.03, 0.05], IRON, sides=6)
    # Headstock beam, splintered, and a few stones.
    box(r, (1.9, 0.22, 0.2), (-0.1, 0.45, 0.14), WOOD_D, rot=(0, 0, 0.35), bevel=0.03)
    box(r, (0.7, 0.2, 0.18), (0.9, -0.6, 0.12), WOOD_D, rot=(0, 0.1, -0.7), bevel=0.03)
    rnd = random.Random(14)
    for i in range(4):
        a = rnd.uniform(0, math.tau)
        blob(r, (0.22, 0.18, 0.14), (math.cos(a) * 0.95, math.sin(a) * 0.9, 0.06), STONE if i % 2 else STONE_D, rnd, subdiv=1, noise=0.3, flat_bottom=-0.03)


def angel():
    """A weeping angel on a plinth: bowed head, folded arms, one wing snapped off."""
    r = root('angel')
    rnd = random.Random(17)
    box(r, (1.15, 1.15, 0.25), (0, 0, 0.125), STONE_D, bevel=0.03)
    box(r, (0.92, 0.92, 0.75), (0, 0, 0.62), STONE, bevel=0.04)
    box(r, (1.0, 1.0, 0.14), (0, 0, 1.07), STONE_L, bevel=0.03)
    box(r, (0.78, 0.78, 0.12), (0, 0, 1.2), STONE, bevel=0.03)
    # Inscription slab on the front.
    box(r, (0.5, 0.03, 0.3), (0, -0.47, 0.65), CARVE, bevel=0.0)
    for z in (0.7, 0.62, 0.55):
        box(r, (0.36, 0.035, 0.025), (0, -0.485, z), STONE_L, bevel=0.0)
    # Robe, shoulders, bowed head.
    lathe(r, [(0.34, 1.26), (0.36, 1.4), (0.27, 1.95), (0.23, 2.35), (0.2, 2.55), (0.12, 2.68)], (0, 0, 0), STONE_L, seg=14)
    for s in (-1, 1):
        blob(r, (0.1, 0.1, 0.11), (s * 0.2, 0.0, 2.52), STONE_L, rnd, subdiv=1, noise=0.05)
        tube(r, [(s * 0.2, 0.0, 2.5), (s * 0.27, -0.12, 2.25), (s * 0.06, -0.24, 2.1)], [0.07, 0.065, 0.055], STONE_L, sides=6)
    blob(r, (0.125, 0.14, 0.16), (0, -0.06, 2.78), STONE_L, rnd, subdiv=2, noise=0.05)
    box(r, (0.3, 0.12, 0.04), (0, -0.18, 2.62), STONE, rot=(0.5, 0, 0), bevel=0.01)  # veil
    # Wings: the left whole, the right snapped at the root.
    pillow(r, (0.09, 0.55, 1.55), (-0.3, 0.3, 2.6), STONE_L, rot=(0.42, 0.0, 0.22), e=0.3, seg=10, rings=7)
    for i in range(5):
        box(r, (0.02, 0.04, 1.1 - i * 0.12), (-0.34, 0.37 + i * 0.015, 2.65 - i * 0.04), STONE, rot=(0.42, 0.0, 0.22), bevel=0.0)
    pillow(r, (0.09, 0.4, 0.6), (0.3, 0.12, 2.28), STONE_L, rot=(0.4, 0.0, -0.3), e=0.3, seg=8, rings=5)
    # The fallen wing at the base, moss and chips.
    pillow(r, (0.12, 0.5, 1.0), (0.65, -0.4, 0.07), STONE_L, rot=(0.0, math.pi / 2 - 0.1, 0.9), e=0.3, seg=8, rings=5)
    blob(r, (0.22, 0.1, 0.08), (-0.35, -0.5, 0.06), MOSS, rnd, subdiv=1, noise=0.3)
    blob(r, (0.18, 0.1, 0.07), (0.3, -0.46, 1.27), MOSS, rnd, subdiv=1, noise=0.3)
    # A wreath and a rusted helmet left on the plinth step.
    lathe(r, [(0.2, 1.26), (0.2, 1.3), (0.15, 1.3), (0.15, 1.26)], (0.0, -0.3, 0.0), SHADE_GREEN, seg=14, smooth=40)
    lathe(r, [(0.0, 0.11), (0.08, 0.1), (0.13, 0.06), (0.15, 0.02), (0.2, 0.0), (0.2, -0.015), (0.0, -0.01)], (0.28, -0.2, 1.27), OLIVE, seg=14, rot=(0.0, 0, 0))


def signpost():
    """A crossroads signpost: three arrow boards, painted in zone colours, one hanging by a nail."""
    r = root('signpost')
    cyl(r, 0.065, 2.8, (0, 0, 1.4), WOOD_D, seg=8, bevel=0.0)
    box(r, (0.22, 0.22, 0.12), (0, 0, 0.06), STONE_D, bevel=0.02)
    cyl(r, 0.1, 0.12, (0, 0, 2.84), WOOD_D, seg=8)
    arrow = [(0.0, -0.13), (0.95, -0.13), (1.22, 0.0), (0.95, 0.13), (0.0, 0.13)]
    # (heading, height, material, stripe, droop)
    for h, z, m, droop in ((0.0, 2.55, SIGN_RED, 0.0), (2.2, 2.2, SIGN_BLUE, 0.0), (-2.1, 1.85, SIGN_GREEN, 0.28)):
        plate(r, arrow, 0.04, (math.cos(h) * 0.06, math.sin(h) * 0.06, z), m, rot=(0, droop, h), bevel=0.01)
        for k, ln in enumerate((0.6, 0.45)):
            plate(r, [(0.18, -0.025 + k * 0.0), (0.18 + ln, -0.025), (0.18 + ln, 0.012), (0.18, 0.012)], 0.045, (math.cos(h) * 0.06, math.sin(h) * 0.06, z + (0.04 if k == 0 else -0.04)), CHALK, rot=(0, droop, h), bevel=0.0)
    # Bullet holes and a splinter.
    box(r, (0.03, 0.03, 0.03), (0.4, -0.03, 2.58), INK, bevel=0.0)


def sails():
    """Windmill sails, axle along +x: four lattice arms, one snapped, cloth on some."""
    r = root('sails')
    cyl(r, 0.28, 0.5, (0.1, 0, 0), WOOD_D, rot=(0, math.pi / 2, 0), seg=10, bevel=0.03)
    cyl(r, 0.12, 0.9, (0.25, 0, 0), IRON, rot=(0, math.pi / 2, 0), seg=8)
    for k in range(4):
        holder = bpy.data.objects.new(f'sail-{k}', None)
        SCENE.collection.objects.link(holder)
        holder.parent = r
        holder.location = (0.28, 0, 0)
        holder.rotation_euler = Euler((k * math.pi / 2 + 0.28, 0, 0))
        L = 5.4 if k != 2 else 3.0
        box(holder, (0.12, 0.12, L), (0, 0, L / 2), WOOD_D, bevel=0.02)
        top = L - 0.2
        for y in (0.08, 1.12):
            box(holder, (0.07, 0.07, top - 0.9), (0.0, y, 0.9 + (top - 0.9) / 2), WOOD, bevel=0.01)
        z = 0.95
        while z < top:
            box(holder, (0.05, 1.1, 0.05), (0.0, 0.6, z), WOOD, bevel=0.008)
            z += 0.42
        if k != 2:
            for z0 in ((1.1, 3.3) if k == 0 else (2.2,) if k == 1 else (1.4, 3.8)):
                box(holder, (0.02, 1.0, 1.0), (0.04, 0.6, z0 + 0.5), CANVAS if k != 3 else CANVAS_D, bevel=0.0)
        else:
            tube(holder, [(0, 0, L), (0.05, 0.1, L + 0.5), (0.0, 0.5, L + 0.7)], [0.05, 0.04, 0.03], WOOD_D, sides=5)


def cot(n):
    """A field cot, long axis along three z: bare with a rumpled blanket, or sheeted."""
    r = root(f'cot-{n}')
    rnd = random.Random(50 + n)
    for x in (-0.33, 0.33):
        for y in (-0.92, 0.92):
            box(r, (0.04, 0.04, 0.36), (x, y, 0.18), IRON, bevel=0.005)
        box(r, (0.035, 1.92, 0.04), (x, 0, 0.36), IRON_L, bevel=0.005)
    for y in (-0.92, 0.92):
        box(r, (0.7, 0.04, 0.04), (0, y, 0.36), IRON_L, bevel=0.005)
    pillow(r, (0.66, 1.85, 0.07), (0, 0, 0.39), CANVAS_D, e=0.3, seg=8, rings=5)
    if n == 0:
        pillow(r, (0.6, 1.2, 0.13), (0, 0.25, 0.47), WOOL, rot=(0, 0, 0.05), e=0.35, sag=0.2, rnd=rnd)
        pillow(r, (0.45, 0.4, 0.1), (0.0, -0.68, 0.48), SHEET, e=0.4, sag=0.3, rnd=rnd)
    else:
        pillow(r, (0.52, 1.55, 0.2), (0, 0.1, 0.5), SHEET, e=0.4, sag=0.15, rnd=rnd)
        blob(r, (0.16, 0.18, 0.14), (0, -0.62, 0.58), SHEET, rnd, subdiv=2, noise=0.1)
        blob(r, (0.2, 0.2, 0.03), (0.08, 0.15, 0.6), STAIN, rnd, subdiv=1, noise=0.3)


def crater(n):
    """The raised rim of a shell crater (the hole is painted in the ground): lumpy earth, stones, splintered beams, a bent stake."""
    r = root(f'crater-{n}')
    rnd = random.Random(70 + n)
    R, cnt = (1.6, 14) if n == 0 else (2.4, 21)
    for i in range(cnt):
        a = i / cnt * math.tau + rnd.uniform(-0.1, 0.1)
        rad = R + rnd.uniform(-0.15, 0.2)
        sz = rnd.uniform(0.3, 0.46)
        blob(r, (sz * 1.5, sz, sz * 0.5), (math.cos(a) * rad, math.sin(a) * rad, 0.02), MUD_R if i % 3 else MUD_RD, rnd, subdiv=1, noise=0.3, rot=(0, 0, a + math.pi / 2), flat_bottom=-0.02)
    for i in range(3):
        a = rnd.uniform(0, math.tau)
        rad = R + rnd.uniform(-0.2, 0.3)
        blob(r, (0.2, 0.17, 0.13), (math.cos(a) * rad, math.sin(a) * rad, 0.1), STONE if i % 2 else STONE_D, rnd, subdiv=1, noise=0.3, flat_bottom=-0.03)
    for i in range(2):
        a = rnd.uniform(0, math.tau)
        rad = R * rnd.uniform(0.7, 1.0)
        box(r, (0.9, 0.09, 0.09), (math.cos(a) * rad, math.sin(a) * rad, 0.14), WOOD_D, rot=(rnd.uniform(-0.2, 0.2), rnd.uniform(-0.3, 0.3), a + 1.2), bevel=0.015)
    a = rnd.uniform(0, math.tau)
    tube(r, [(math.cos(a) * R, math.sin(a) * R, 0.0), (math.cos(a) * (R + 0.1), math.sin(a) * (R + 0.1), 0.5), (math.cos(a) * (R - 0.3), math.sin(a) * (R - 0.3), 0.75)], [0.03, 0.025, 0.018], IRON, sides=5)


def tank():
    """A Mark IV tank wreck: rhomboid tracks, a split sponson, the cupola blown off."""
    r = root('tank')
    track = [(-2.9, 0.12), (2.3, 0.12), (3.7, 1.55), (2.3, 2.85), (-2.6, 2.85), (-4.1, 1.45)]
    for s in (-1, 1):
        y = s * 1.35
        plate(r, track, 0.55, (0, y, 0), IRON, bevel=0.03)
        inner = [(x * 0.92, 0.12 + (z - 0.12) * 0.88 + 0.05) for x, z in track]
        plate(r, inner, 0.1, (0, y + s * 0.3, 0.0), RUST, bevel=0.01)
        for i in range(24):
            t = i / 24
            # track plates around the rhomboid: short ribs on the outer face
            x = -2.9 + 5.2 * t if t < 0.5 else 2.3
            box(r, (0.1, 0.57, 0.3), (-2.8 + 5.1 * t, y, 0.18), IRON_L, bevel=0.01)
            box(r, (0.1, 0.57, 0.3), (-2.4 + 4.8 * t, y, 2.85 - 0.12), IRON_L, bevel=0.01)
        for x in (-1.9, -0.6, 0.7, 1.9):
            cyl(r, 0.2, 0.1, (x, y + s * 0.3, 0.45), OLIVE_D, rot=(math.pi / 2, 0, 0), seg=10)
    box(r, (5.4, 2.3, 1.45), (0, 0, 1.55), OLIVE, bevel=0.05, seg=3)
    box(r, (5.5, 2.35, 0.1), (0, 0, 0.8), OLIVE_D, bevel=0.03)
    # Sponsons with gun stubs, the right one split open.
    for s in (-1, 1):
        box(r, (1.55, 0.95, 1.3), (0.7, s * 1.85, 1.1), OLIVE_L, bevel=0.06, seg=3)
        cyl(r, 0.07, 1.05, (0.9, s * 2.28, 1.1), IRON, rot=(math.pi / 2, 0, 0), seg=8)
    box(r, (0.6, 0.06, 0.8), (0.95, 2.35, 1.1), INK, bevel=0.0)
    # Cab on top, roof torn.
    box(r, (1.5, 1.35, 0.75), (-0.5, 0, 2.5), OLIVE_L, bevel=0.05, seg=3)
    box(r, (1.2, 1.0, 0.12), (-0.6, 0.1, 2.9), OLIVE_D, rot=(0.2, -0.15, 0.1), bevel=0.02)
    # Shell holes and a hatch left open.
    for x, y, z in ((1.4, 1.17, 1.8), (-1.6, -1.17, 1.9)):
        cyl(r, 0.16, 0.06, (x, y, z), INK, rot=(math.pi / 2, 0, 0), seg=10)
    # Unditching beam strapped across the top, and a broken tail wheel frame.
    box(r, (4.8, 0.32, 0.22), (0.0, 0.5, 3.1), WOOD_D, rot=(0, 0.0, 0.05), bevel=0.04)
    tube(r, [(-3.5, 0.5, 1.2), (-4.7, 0.5, 0.6), (-4.8, 0.5, 0.15)], [0.08, 0.07, 0.06], IRON, sides=5)
    cyl(r, 0.4, 0.14, (-4.8, 0.5, 0.4), IRON_L, rot=(math.pi / 2, 0, 0), seg=14)


# ---------------------------------------------------------------- build

for n in (0, 1):
    crate(n)
    gravestone(n)
    cross(n)
    tree(n)
    dead_tree(n)
    cot(n)
    crater(n)
sandbags()
barrel()
cart()
lamppost()
fence()
hay()
pew()
fieldgun()
wire()
rubble()
biplane()
tent()
hedgehog()
bell()
angel()
signpost()
sails()
tank()
lamp_lantern()
lamp_candles()
lamp_brazier()
lamp_bulb()
lamp_arc()
lamp_flame()
for n in (0, 1, 2):
    decor_tuft(n)
decor_flowers('poppies', POPPY, 90)
decor_flowers('campion', CAMPION, 91)
for n in (0, 1):
    decor_pebbles(n)
    decor_bricks(n)

# Triangle report per model.
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
for o in [o for o in bpy.data.objects if o.parent is None]:
    tris = 0
    stack = list(o.children)
    while stack:
        c = stack.pop()
        stack.extend(c.children)
        if c.type == 'MESH':
            me = c.evaluated_get(dg).to_mesh()
            tris += sum(len(p.vertices) - 2 for p in me.polygons)
            c.evaluated_get(dg).to_mesh_clear()
    print(f'[props] {o.name}: {tris} tris')

a = args()
if '--preview' in a:
    # Preview a subset (`--only crate,tree`) laid out in a grid.
    roots = [o for o in bpy.data.objects if o.parent is None]
    if '--only' in a:
        keep = a[a.index('--only') + 1].split(',')
        for o in roots:
            if not any(o.name.startswith(k) for k in keep):
                for c in o.children_recursive:
                    c.hide_render = True
        roots = [o for o in roots if any(o.name.startswith(k) for k in keep)]
    gap = float(a[a.index('--gap') + 1]) if '--gap' in a else 4.5
    cols = max(1, math.ceil(math.sqrt(len(roots) * 1.6)))
    for i, o in enumerate(roots):
        o.location = ((i % cols) * gap, (i // cols) * gap, 0)
    bpy.context.view_layer.update()
    objs = []
    for o in roots:
        objs.extend(c for c in o.children_recursive if c.type == 'MESH')
    render_preview(a[a.index('--preview') + 1], objects=objs, azimuth=20, elevation=14)
else:
    export_pack('props')
