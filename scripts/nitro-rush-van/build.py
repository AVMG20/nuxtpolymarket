"""Nitro Rush's van, modelled in Blender.

Run inside an open Blender (the Blender MCP socket, or Blender's own text editor). It builds the van in its own
scene, `NitroRushVan`, and leaves every other scene alone. `export.py` then writes the mesh the game loads.

Metres; +Y is forward, +Z up and +X the van's right. The game fits every car to the same hitbox (1.9 x 4.5),
so the model is drawn at that size and only its height is its own.
"""
import math

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

SCENE = 'NitroRushVan'
P = 'NV_'
LIVERY = bpy.app.driver_namespace.get('nv_livery', '')

HW = 0.885
SILL = 0.27
BELT = 1.08
ROOF = 1.745
BUMPER = 0.62
TUMBLE = 0.085
CROWN = 0.018
WHEEL_R = 0.36
WHEEL_W = 0.27
ARCH_R = 0.44
ARCH_SEGS = 20
AX_F = 1.42
AX_R = -1.36
HALF_TRACK = 0.735
BEVEL_STEPS = 6
# How far the nose's face leans back, for what sits on it.
NOSE_TILT = 0.25
LIFT = 0.008

# The livery atlas (2048 square): where each face of the van lands, in pixels.
ATLAS = 2048
SIDE_W, SIDE_H, SIDE_PPM = 1800, 703, 400
REAR_W, REAR_H = 694, 642
TOP_X, TOP_Y, TOP_L, TOP_W = 694, 1406, 1350, 570
FRONT_X, FRONT_W, FRONT_H, FRONT_PPM = 1800, 247, 229, 130


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def taper(y):
    """How much the body narrows in plan: rounded front corners, a touch at the tail."""
    if y > 1.5:
        return 0.13 * min(1.0, (y - 1.5) / 0.75) ** 2.2
    if y < -1.9:
        return 0.035 * min(1.0, (-1.9 - y) / 0.35) ** 2
    return 0.0


def lean(z):
    """Tumblehome above the belt, sills tucked in under the bumper line; linear, so the flanks stay flat panels."""
    k = 1.0
    if z > BELT:
        k -= TUMBLE * (z - BELT) / (ROOF - BELT)
    if z < BUMPER:
        k -= 0.03 * (BUMPER - z) / 0.35
    return k


def width_k(y, z):
    return lean(z) * (1 - taper(y))


def flank_x(y, z):
    return HW * width_k(y, z)


def bevel_r(z):
    """The shoulder's radius: tight on the sills, generous along the roof."""
    return 0.04 + 0.08 * smooth(0.6, 1.6, z)


def arch_angles():
    t0 = math.asin((SILL - WHEEL_R) / ARCH_R)
    return [t0 + (math.pi - 2 * t0) * i / ARCH_SEGS for i in range(ARCH_SEGS + 1)]


def arch(cy):
    return [(cy + ARCH_R * math.cos(t), WHEEL_R + ARCH_R * math.sin(t)) for t in arch_angles()]


# The side profile, clockwise from the rear bumper over the roof to the nose.
TOP = [
    (-2.25, 0.36), (-2.25, BUMPER), (-2.238, 1.20), (-2.205, 1.58), (-2.185, 1.65), (-2.14, 1.705), (-2.06, 1.738),
    (-1.0, 1.745), (0.2, 1.742), (0.76, 1.728), (0.89, 1.695), (0.98, 1.63), (1.47, 1.12), (1.54, 1.085), (1.64, 1.07),
    (2.04, 1.0), (2.15, 0.955), (2.215, 0.88), (2.245, 0.76), (2.25, BUMPER), (2.25, 0.36)
]
SCREEN_A = Vector((0.98, 1.63))
SCREEN_B = Vector((1.47, 1.12))
PROFILE = TOP + [(2.215, SILL)] + arch(AX_F) + arch(AX_R) + [(-2.215, SILL)]
FIRST_UNDER = len(TOP) - 1


def roof_z(x):
    """Height of the roof panel across the van, crown included."""
    return 1.743 + CROWN * (1 - abs(x) / 0.765)


def nose_y(z):
    """Where the nose's face sits at height z."""
    return 2.245 - (z - 0.76) * 0.25


# ─── Scene ───────────────────────────────────────────────────────────────────

scene = bpy.data.scenes.get(SCENE) or bpy.data.scenes.new(SCENE)
for o in list(scene.collection.all_objects):
    bpy.data.objects.remove(o, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.cameras, bpy.data.lights):
    for d in list(coll):
        if d.name.startswith(P) and d.users == 0:
            coll.remove(d)


def material(slot, color, rough=0.5, metal=0.0, emit=None, strength=0.0, two_sided=False):
    name = P + slot
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    # The game draws most slots one-sided, so the preview does too: a face wound the wrong way shows up as a hole.
    m.use_backface_culling = not two_sided
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1)
        bsdf.inputs['Emission Strength'].default_value = strength
    return m


# Named after the game's material slots; the colours here are only for the preview renders.
MATS = {
    'skin': material('skin', (0.24, 0.62, 0.86), 0.3),
    'paint': material('paint', (0.55, 0.01, 0.03), 0.3, 0.2),
    'glass': material('glass', (0.004, 0.005, 0.007), 0.06, 0.1),
    'trim': material('trim', (0.012, 0.012, 0.014), 0.55, 0.2),
    'chrome': material('chrome', (0.7, 0.72, 0.76), 0.1, 1.0),
    'rim': material('rim', (0.03, 0.032, 0.036), 0.3, 0.9, two_sided=True),
    'head': material('head', (0.75, 0.8, 0.86), 0.1, 0.0, (1.0, 0.95, 0.85), 2.4),
    'tail': material('tail', (0.25, 0.0, 0.005), 0.2, 0.0, (1.0, 0.03, 0.03), 3.2),
    'lens': material('lens', (0.3, 0.0, 0.01), 0.05),
    'caliper': material('caliper', (0.8, 0.3, 0.02), 0.3, 0.0, (1.0, 0.45, 0.05), 1.6),
    'tire': material('tire', (0.012, 0.012, 0.013), 0.9, two_sided=True),
    'steel': material('steel', (0.02, 0.021, 0.024), 0.45, 0.7, two_sided=True)
}
if LIVERY:
    nt = MATS['skin'].node_tree
    tex = nt.nodes.new('ShaderNodeTexImage')
    img = bpy.data.images.get(P + 'livery')
    if img:
        img.filepath = LIVERY
        img.reload()
    else:
        img = bpy.data.images.load(LIVERY)
        img.name = P + 'livery'
    tex.image = img
    nt.links.new(tex.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])


def livery_uv(n, co):
    """Box projection onto the atlas, by which way the face looks."""
    ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
    if ax >= ay and ax >= az:
        # Each flank reads left to right for someone standing beside the van.
        u = (co.y + 2.25) / 4.5 if n.x > 0 else (2.25 - co.y) / 4.5
        px = u * SIDE_W
        py = (0 if n.x > 0 else SIDE_H) + SIDE_H - co.z * SIDE_PPM
    elif az >= ay:
        # Roof and bonnet, upright to someone standing ahead of the van.
        px = TOP_X + (co.y + 2.25) / 4.5 * TOP_L
        py = TOP_Y + (0.95 - co.x) / 1.9 * TOP_W
    elif n.y < 0:
        px = (co.x + 0.95) / 1.9 * REAR_W
        py = TOP_Y + REAR_H - co.z * (REAR_W / 1.9)
    else:
        px = FRONT_X + (0.95 - co.x) / 1.9 * FRONT_W
        py = FRONT_H - co.z * FRONT_PPM
    return (px / ATLAS, 1 - py / ATLAS)


def placed(at, rot=(0, 0, 0)):
    return Matrix.Translation(at) @ Euler(rot).to_matrix().to_4x4()


class Parts:
    """One mesh of many pieces, each face in the material slot it is named for."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.slots = []

    def index(self, slot):
        if slot not in self.slots:
            self.slots.append(slot)
        return self.slots.index(slot)

    def merge(self, tmp, slot):
        """Takes a piece built on its own, so shaping it never touches the pieces already here."""
        idx = self.index(slot)
        verts = {v: self.bm.verts.new(v.co) for v in tmp.verts}
        for f in tmp.faces:
            self.bm.faces.new([verts[v] for v in f.verts]).material_index = idx
        tmp.free()

    def box(self, slot, size, at, rot=(0, 0, 0), r=0.0, segs=1):
        """A block, its edges chamfered by `r`, or rounded with more `segs`."""
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0, matrix=placed(at, rot) @ Matrix.Diagonal((*size, 1)))
        if r > 0:
            bmesh.ops.bevel(tmp, geom=tmp.edges[:], offset=min(r, min(size) * 0.45), offset_type='OFFSET', segments=segs, profile=0.5, affect='EDGES')
        self.merge(tmp, slot)

    def beam(self, slot, a, b, w, t):
        """A strut from one point to another."""
        a, b = Vector(a), Vector(b)
        turn = Vector((0, 1, 0)).rotation_difference((b - a).normalized()).to_matrix().to_4x4()
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0, matrix=Matrix.Translation((a + b) / 2) @ turn @ Matrix.Diagonal((w, (b - a).length, t, 1)))
        self.merge(tmp, slot)

    def poly(self, slot, pts, out):
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        f.normal_update()
        if f.normal.dot(Vector(out)) < 0:
            f.normal_flip()
        f.material_index = self.index(slot)
        return f

    def lathe(self, slot, profile, at=(0, 0, 0), rot=(0, 0, 0), segs=20, shell=False):
        """Spins (radius, depth) points about an axis that leaves `at` along the local +Y.

        A `shell` is a nearly closed skin and gets its faces turned outward as a whole; anything else is a cap
        or collar whose faces look along the axis or away from it.
        """
        m = placed(at, rot)
        tmp = bmesh.new()
        rings = []
        for rad, depth in profile:
            if rad < 1e-6:
                rings.append([tmp.verts.new(m @ Vector((0, depth, 0)))] * segs)
            else:
                rings.append([tmp.verts.new(m @ Vector((rad * math.cos(t), depth, rad * math.sin(t)))) for t in (i / segs * math.tau for i in range(segs))])
        for a, b in zip(rings, rings[1:]):
            for i in range(segs):
                j = (i + 1) % segs
                verts = []
                for v in (a[i], b[i], b[j], a[j]):
                    if v not in verts:
                        verts.append(v)
                if len(verts) >= 3:
                    tmp.faces.new(verts)
        if shell:
            bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
        else:
            axis = (m.to_3x3() @ Vector((0, 1, 0))).normalized()
            origin = Vector(at)
            for f in tmp.faces:
                f.normal_update()
                c = f.calc_center_median() - origin
                radial = c - axis * c.dot(axis)
                ref = axis + (radial.normalized() if radial.length > 1e-6 else Vector())
                if f.normal.dot(ref) < 0:
                    f.normal_flip()
        self.merge(tmp, slot)

    def finish(self, sharp=50.0):
        bm = self.bm
        bm.normal_update()
        if 'skin' in self.slots:
            skin = self.index('skin')
            uv = bm.loops.layers.uv.new('UVMap')
            for f in bm.faces:
                if f.material_index == skin:
                    for loop in f.loops:
                        loop[uv].uv = livery_uv(f.normal, loop.vert.co)
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            e.smooth = not (len(e.link_faces) == 2 and e.calc_face_angle() > math.radians(sharp))
        mesh = bpy.data.meshes.new(P + self.name)
        bm.to_mesh(mesh)
        bm.free()
        for slot in self.slots:
            mesh.materials.append(MATS[slot])
        obj = bpy.data.objects.new(P + self.name, mesh)
        scene.collection.objects.link(obj)
        # Big flat faces keep their own normal, so only the rounded edges shade as curves.
        mod = obj.modifiers.new('normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
        mod.weight = 60
        return obj


# ─── Body ────────────────────────────────────────────────────────────────────

def build_body():
    parts = Parts('body')
    bm = parts.bm
    skin = parts.index('skin')
    trim = parts.index('trim')
    n = len(PROFILE)
    # Outward normal at each profile point, and how far a constant inset has to travel along it.
    normals = []
    for i in range(n):
        a = Vector(PROFILE[i - 1])
        b = Vector(PROFILE[i])
        c = Vector(PROFILE[(i + 1) % n])
        n0 = Vector((-(b - a).y, (b - a).x)).normalized()
        n1 = Vector((-(c - b).y, (c - b).x)).normalized()
        avg = (n0 + n1).normalized()
        normals.append((avg, min(1.6, 1 / max(0.2, avg.dot(n0)))))

    k = BEVEL_STEPS
    rows = []
    for i, (y, z) in enumerate(PROFILE):
        nrm, miter = normals[i]
        r = bevel_r(z)
        row = []
        for side in (-1, 1):
            steps = range(k, -1, -1) if side < 0 else range(k + 1)
            for j in steps:
                a = j / k * math.pi / 2
                d = r * (1 - math.cos(a)) * miter
                row.append(bm.verts.new((side * (HW - r + r * math.sin(a)), y - nrm.x * d, z - nrm.y * d)))
            if side < 0:
                # The spine, lifted a little so the roof and bonnet carry a crown.
                row.append(bm.verts.new((0, y, z + CROWN * max(nrm.y, 0))))
        rows.append(row)
    cols = len(rows[0])
    for i in range(n):
        a = rows[i]
        b = rows[(i + 1) % n]
        for c in range(cols - 1):
            f = bm.faces.new((a[c], a[c + 1], b[c + 1], b[c]))
            f.material_index = trim if i >= FIRST_UNDER else skin
    for c in (0, cols - 1):
        bm.faces.new([row[c] for row in rows]).material_index = skin
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    # Cut the flat panels where the body bends, so they follow it once the plan taper and tumblehome go on.
    cuts = [((0, 0, z), (0, 0, 1)) for z in (BELT, BUMPER)]
    cuts += [((0, y, 0), (0, 1, 0)) for y in (1.55, 1.70, 1.86, 2.0, 2.1, 2.18, -1.8, -1.9, -2.02, -2.14)]
    for co, no in cuts:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no, dist=1e-4)
    for v in bm.verts:
        v.co.x *= width_k(v.co.y, v.co.z)
    # Black bumpers, wrapping round the corners as far as the wheel arches.
    for f in bm.faces:
        c = f.calc_center_median()
        if c.z < BUMPER and (c.y > 1.86 or c.y < -1.8):
            f.material_index = trim
    return parts.finish(40)


# ─── Glass ───────────────────────────────────────────────────────────────────

SLOPE = SCREEN_B - SCREEN_A
SCREEN_OUT = Vector((-SLOPE.y, SLOPE.x)).normalized()
if SCREEN_OUT.y < 0:
    SCREEN_OUT = -SCREEN_OUT


def screen_edge(t):
    p = SCREEN_A + SLOPE * t
    return (HW - bevel_r(p.y)) * width_k(p.x, p.y)


def screen(x, t, lift=LIFT):
    """A point on the windscreen: `x` across, `t` from its top edge (0) down to the scuttle (1)."""
    p = SCREEN_A + SLOPE * t
    crown = CROWN * SCREEN_OUT.y * (1 - abs(x) / screen_edge(t))
    return (x, p.x + SCREEN_OUT.x * lift, p.y + crown + SCREEN_OUT.y * lift)


def build_glass():
    parts = Parts('glass')
    out = (0, SCREEN_OUT.x, SCREEN_OUT.y)

    def pane(slot, t0, t1, inset, lift):
        for side in (-1, 1):
            w0, w1 = screen_edge(t0) - inset, screen_edge(t1) - inset
            parts.poly(slot, [
                screen(0, t0, lift), screen(side * (w0 - 0.07), t0, lift), screen(side * w0, t0 + 0.09, lift),
                screen(side * w1, t1 - 0.07, lift), screen(side * (w1 - 0.06), t1, lift), screen(0, t1, lift)
            ], out)

    # The black band the screen is bonded on, then the glass inside it.
    pane('trim', 0.025, 0.975, 0.012, LIFT * 0.5)
    pane('glass', 0.06, 0.94, 0.045, LIFT)
    # Wipers parked along the scuttle.
    for x0, x1 in ((0.66, 0.1), (0.02, -0.54)):
        parts.beam('trim', screen(x0, 0.925, 0.02), screen(x1, 0.875, 0.02), 0.022, 0.012)
        parts.beam('trim', screen(x0, 0.955, 0.016), screen(x0 - 0.2, 0.9, 0.024), 0.014, 0.012)

    for side in (-1, 1):
        # The cab's door glass in its rubber, the front edge raked with the screen pillar.
        seal = [(0.42, 1.12), (1.29, 1.12), (1.345, 1.165), (0.935, 1.59), (0.865, 1.62), (0.46, 1.62), (0.42, 1.58)]
        window = [(0.445, 1.145), (1.275, 1.145), (1.305, 1.17), (0.915, 1.572), (0.86, 1.595), (0.475, 1.595), (0.445, 1.565)]
        parts.poly('trim', [(side * (flank_x(y, z) + LIFT * 0.5), y, z) for y, z in seal], (side, 0, 0))
        parts.poly('glass', [(side * (flank_x(y, z) + LIFT), y, z) for y, z in window], (side, 0, 0))
    return parts.finish()


# ─── Details ─────────────────────────────────────────────────────────────────

def arch_flare(parts, cy, side):
    """A black lip around a wheel arch."""
    x_in = side * 0.8
    x_out = side * 0.906
    r_in = ARCH_R - 0.005
    r_out = ARCH_R + 0.055
    tmp = bmesh.new()
    ring = []
    for t in arch_angles():
        cs, sn = math.cos(t), math.sin(t)
        ring.append([tmp.verts.new((x, cy + r * cs, WHEEL_R + r * sn)) for x, r in ((x_in, r_in), (x_out, r_in), (x_out, r_out), (x_in, r_out + 0.02))])
    for a, b in zip(ring, ring[1:]):
        for j in range(4):
            tmp.faces.new((a[j], a[(j + 1) % 4], b[(j + 1) % 4], b[j]))
    for end in (ring[0], ring[-1]):
        tmp.faces.new(end)
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
    parts.merge(tmp, 'trim')


def lamp(parts, at, r, rot=(0, 0, 0)):
    """A round lamp: a lit lens in a bright ring."""
    parts.lathe('head', [(0, 0.004), (r * 0.6, 0.006), (r, 0)], at, rot, 16)
    parts.lathe('chrome', [(r, 0), (r * 1.1, 0.008), (r * 1.26, 0.004), (r * 1.26, -0.02)], at, rot, 16)


def build_details():
    parts = Parts('details')
    tilt = (NOSE_TILT, 0, 0)
    for side in (-1, 1):
        for cy in (AX_F, AX_R):
            arch_flare(parts, cy, side)
            # Mud flap behind the wheel.
            parts.box('trim', (0.25, 0.018, 0.2), (side * 0.745, cy - 0.455, 0.2))

        # Headlamp: a dark housing on the nose holding two round lamps over an amber strip.
        parts.box('trim', (0.35, 0.05, 0.2), (side * 0.54, nose_y(0.81) - 0.022, 0.81), tilt, 0.02, 2)
        for x in (0.465, 0.605):
            lamp(parts, (side * x, nose_y(0.83) + 0.004, 0.83), 0.05, tilt)
        parts.box('caliper', (0.27, 0.02, 0.024), (side * 0.535, nose_y(0.745) + 0.002, 0.745), tilt, 0.006)
        # Fog lamp low in the bumper, and the repeater on the wing.
        lamp(parts, (side * 0.62, 2.252, 0.44), 0.036)
        parts.box('caliper', (0.014, 0.075, 0.026), (side * flank_x(1.25, 0.98), 1.25, 0.98), r=0.005)

        # Tail lamp: a tall dark lens on the corner with the lit segments standing proud of it.
        turn = (-0.03, 0, -side * 0.12)
        cluster = placed((side * 0.765, -2.213, 1.2), turn)
        parts.box('lens', (0.135, 0.06, 0.52), cluster.translation, turn, 0.015, 2)
        for slot, dz, h in (('tail', 0.135, 0.2), ('caliper', -0.03, 0.085), ('tail', -0.15, 0.11)):
            parts.box(slot, (0.085, 0.02, h), cluster @ Vector((0, -0.032, dz)), turn, 0.006)

        # Mirror: arm, housing and the glass on its back.
        housing = placed((side * 0.915, 1.375, 1.25), (0, 0, side * 0.15))
        parts.box('trim', (0.07, 0.05, 0.035), (side * 0.88, 1.365, 1.185), r=0.01)
        parts.box('trim', (0.07, 0.11, 0.2), housing.translation, (0, 0, side * 0.15), 0.022, 2)
        parts.box('chrome', (0.05, 0.004, 0.16), housing @ Vector((0, -0.056, 0)), (0, 0, side * 0.15))

        # Door handles, and the step under the doors.
        for y in (0.56, 0.28):
            parts.box('trim', (0.03, 0.16, 0.036), (side * flank_x(y, 1.0), y, 1.0), r=0.01)
        parts.box('trim', (0.075, 2.0, 0.05), (side * 0.858, 0.03, 0.285), r=0.012)

        # Roof bar on three feet.
        parts.box('trim', (0.042, 2.7, 0.03), (side * 0.6, -0.66, 1.822), r=0.01)
        for y in (-1.9, -0.66, 0.58):
            parts.box('trim', (0.056, 0.13, 0.075), (side * 0.6, y, 1.78), r=0.012)
        # Hinges down the outer edge of each rear door, and a reflector in the bumper.
        for z in (0.78, 1.1, 1.5):
            parts.box('trim', (0.03, 0.022, 0.075), (side * 0.655, -2.245 + (z - 0.62) * 0.03, z), r=0.006)
        parts.box('lens', (0.15, 0.016, 0.035), (side * 0.6, -2.256, 0.45), r=0.006)

    # Pressed ribs along the roof; they take the wrap like the panel under them.
    for x in (-0.36, -0.12, 0.12, 0.36):
        parts.box('skin', (0.1, 2.25, 0.024), (x, -0.72, roof_z(x) + 0.001), r=0.011)

    # Grille between the lamps: dark slats on a black backing, and a plain round badge.
    parts.box('trim', (0.74, 0.04, 0.18), (0, nose_y(0.81) - 0.018, 0.81), tilt, 0.015)
    for z in (0.755, 0.79, 0.83, 0.865):
        for side in (-1, 1):
            parts.box('rim', (0.26, 0.014, 0.016), (side * 0.215, nose_y(z) + 0.004, z), tilt)
    parts.lathe('chrome', [(0.046, 0.006), (0.054, 0.012), (0.064, 0.006), (0.064, -0.01)], (0, nose_y(0.81) + 0.004, 0.81), tilt, 20)
    parts.lathe('trim', [(0, 0.006), (0.046, 0.006)], (0, nose_y(0.81) + 0.004, 0.81), tilt, 20)
    # Lower intake in the bumper.
    for z in (0.385, 0.42, 0.455):
        parts.box('rim', (0.66, 0.014, 0.014), (0, 2.254, z))

    # Rear: the handle bar over the plate, the plate's backing, the bumper's step and a high brake light.
    parts.box('trim', (0.6, 0.034, 0.05), (0, -2.25, 1.0), r=0.012)
    parts.box('trim', (0.58, 0.02, 0.16), (0, -2.252, 0.8), r=0.006)
    parts.box('trim', (1.5, 0.05, 0.05), (0, -2.25, 0.6), r=0.012)
    for x in (-0.36, -0.18, 0, 0.18, 0.36):
        parts.box('rim', (0.13, 0.012, 0.012), (x, -2.266, 0.626))
    parts.box('lens', (0.34, 0.03, 0.03), (0, -2.176, 1.668), (-0.9, 0, 0), 0.008)
    parts.box('tail', (0.3, 0.012, 0.014), (0, -2.189, 1.659), (-0.9, 0, 0))

    # A stubby aerial at the front of the roof.
    parts.lathe('trim', [(0.016, 0), (0.016, 0.02), (0.006, 0.03), (0.005, 0.26), (0, 0.262)], (0, 0.62, roof_z(0) - 0.004), (math.radians(118), 0, 0), 8)

    # One fat tailpipe, low on the left: hollow, with a rolled lip and a dark throat.
    parts.lathe('chrome', [(0.05, -0.28), (0.05, 0), (0.046, 0.008), (0.04, 0.004), (0.04, -0.2)], (-0.48, -1.99, 0.25), (0, 0, math.pi), 16, True)
    parts.lathe('trim', [(0.04, -0.2), (0, -0.2)], (-0.48, -1.99, 0.25), (0, 0, math.pi), 16)
    return parts.finish()


# ─── Wheel ───────────────────────────────────────────────────────────────────

def build_wheel():
    """A black steel wheel on a chunky van tyre; about its axle, the outer face looking along +X."""
    parts = Parts('wheel')
    r, hw = WHEEL_R, WHEEL_W / 2
    rim = r * 0.63
    out = (0, 0, -math.pi / 2)
    g = r - 0.009
    parts.lathe('tire', [
        (rim * 0.98, -hw + 0.012), (r * 0.82, -hw), (r * 0.95, -hw + 0.02), (r, -hw + 0.058),
        (r, -0.05), (g, -0.046), (g, -0.034), (r, -0.03), (r, -0.008), (g, -0.004), (g, 0.004), (r, 0.008),
        (r, 0.03), (g, 0.034), (g, 0.046), (r, 0.05),
        (r, hw - 0.058), (r * 0.95, hw - 0.02), (r * 0.82, hw), (rim * 0.98, hw - 0.012)
    ], rot=out, segs=40, shell=True)
    # Raised hub, a dished face for the vents, a rolled lip, then the barrel and the back.
    parts.lathe('steel', [
        (rim * 0.2, hw - 0.018), (rim * 0.42, hw - 0.028), (rim * 0.5, hw - 0.055), (rim * 0.78, hw - 0.07),
        (rim * 0.9, hw - 0.052), (rim * 0.96, hw - 0.022), (rim, hw - 0.008), (rim, -hw + 0.012), (0, -hw + 0.03)
    ], rot=out, segs=40, shell=True)
    parts.lathe('paint', [(0, hw - 0.002), (rim * 0.14, hw - 0.006), (rim * 0.2, hw - 0.018)], rot=out, segs=20)
    for i in range(8):
        t = (i + 0.5) / 8 * math.tau
        # Vent holes in the dish, drawn as dark ovals lying on it.
        hole = placed((hw - 0.0605, rim * 0.64 * math.cos(t), rim * 0.64 * math.sin(t)), (t, 0, 0))
        parts.poly('trim', [hole @ Vector((0, rim * 0.085 * math.cos(a), rim * 0.12 * math.sin(a))) for a in (j / 10 * math.tau for j in range(10))], (1, 0, 0))
    for i in range(5):
        t = i / 5 * math.tau
        parts.lathe('chrome', [(0, 0.014), (0.009, 0.014), (0.011, 0)], (hw - 0.027, rim * 0.31 * math.cos(t), rim * 0.31 * math.sin(t)), out, 6)
    src = parts.finish(35)
    src.hide_render = True
    src.hide_viewport = True
    for y in (AX_F, AX_R):
        for side in (-1, 1):
            w = bpy.data.objects.new(f'{P}wheel_{"F" if y > 0 else "R"}{"R" if side > 0 else "L"}', src.data)
            w.location = (side * HALF_TRACK, y, WHEEL_R)
            if side < 0:
                w.rotation_euler = (0, 0, math.pi)
            scene.collection.objects.link(w)
    return src


body = build_body()
glass = build_glass()
details = build_details()
wheel = build_wheel()

scene.view_layers[0].update()
dg = scene.view_layers[0].depsgraph
tris = 0
for o in (body, glass, details, wheel):
    me = o.data
    me.calc_loop_triangles()
    tris += len(me.loop_triangles)
    print(o.name, 'tris', len(me.loop_triangles), 'dims', tuple(round(d, 3) for d in o.dimensions))
print('unique tris', tris)
