"""
Dead Front weapons (headless Blender).

Builds public/dead-front/models/weapons.glb: every gun in
shared/utils/dead-front/weapons.ts with its moving parts and attachment
variants, plus the viewmodel's glove, knife, casings and muzzle flash and the
stick grenade. Comic look to match the props: chunky bevelled shapes in a few
flat colours per part (walnut, blued steel, brass).

Layout of one gun (read by app/utils/dead-front/weapons/models.ts):

  <id>                         top-level empty, origin at the right-hand grip
    <id>-<part>[@cond]         a group; its origin is the part's pivot
    <id>-m-<marker>[@cond]     an empty: muzzle, sight, front, eject, dot0/1, scope0/1

Parts: main, slide, bolt, pump, mag, pan, barrel, lever. `cond` picks a variant:
terms joined by `&`, each `slot=word` (the attachment in that slot contains the
word), `pap` (Pack-a-Punched) or a negation with `!`. Of several markers with
one name the engine takes the matching one with the most terms.

Guns are authored on the old voxel grid so every sight, pivot and hand position
stays where the animations expect it: k runs from the muzzle (k = 0) back to
the butt, j up, x across, one cell = 11 mm. In glTF space that is x right, y up,
muzzle toward -z. Material names carry the finish (steel*, park, black: metal;
wood*, bakelite, vulcan: wood; brass, copper, coil: brass) for the Pack-a-Punch
recolour.

Run:  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python scripts/dead-front-models/weapons.py
Preview:  ... -- --preview /tmp/gun.png --only kar98k [--with scope,trench] [--az 70] [--el 12]
          (several guns write /tmp/gun-<id>.png each; `--only vm` is the viewmodel bits;
           `--hip` / `--ads` look from the player's eye instead)
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import args, export_pack, mat, render_preview, reset_scene, srgb_to_linear  # noqa: E402

reset_scene()
SCENE = bpy.context.scene
S = 0.011


def gmat(name, rgb, glow):
    """A glowing material whose engine glow (emission's brightest channel) is `glow`."""
    top = max(srgb_to_linear(((rgb >> s) & 255) / 255) for s in (16, 8, 0))
    return mat(name, rgb, glow=glow / max(top, 0.05))


# ---------------------------------------------------------------- palette

STEEL = mat('steel', 0x46505f)
STEEL_HI = mat('steel-hi', 0x7c8696)
STEEL_D = mat('steel-dark', 0x2f353f)
PARK = mat('park', 0x50584c)
BLACK = mat('black', 0x2b2d33)
WOOD = mat('wood', 0x91582f)
WOOD_D = mat('wood-dark', 0x6b3f24)
WOOD_L = mat('wood-light', 0xae7440)
BRASS = mat('brass', 0xc99a3c)
COPPER = mat('copper', 0xae6128)
COIL = mat('coil', 0xcf7632)
IVORY = mat('ivory', 0xe6dec6)
LEATHER = mat('leather', 0x54361f)
BAKELITE = mat('bakelite', 0x6e2c1a)
VULCAN = mat('vulcan', 0x2c2520)
HULL = mat('hull', 0xb0302a)
SLUG = mat('slug', 0x8a8c90)
GAUGE = mat('gauge', 0xd8d0b4)
HOLE = mat('hole', 0x17171a)
KHAKI = mat('khaki', 0x8a8058)
GLOVE = mat('glove', 0x5e4230)
GLOVE_D = mat('glove-dark', 0x452f22)
BLADE = mat('blade', 0xc4c8ce)
OLIVE = mat('olive', 0x4f5539)
PILOT = gmat('pilot', 0xff8a2a, 1.0)
LENS = gmat('lens', 0x7aa0c8, 0.5)
XCORE = gmat('xray-core', 0x2fd855, 0.9)
XHOT = gmat('xray-hot', 0xd8ffe0, 1.0)
XGLASS = gmat('xray-glass', 0x3fae62, 0.35)
ARC = gmat('arc', 0xa8e2ff, 1.0)
ARC_HOT = gmat('arc-hot', 0xeaf8ff, 1.0)
CASE = gmat('case', 0xd6ad52, 0.12)
CASE_D = mat('case-dark', 0x8a6a2a)
CASE_L = gmat('case-light', 0xf0cf78, 0.2)
FLASH_HOT = gmat('flash-hot', 0xffffff, 1.0)
FLASH_WARM = gmat('flash-warm', 0xffc070, 1.0)

# ---------------------------------------------------------------- builder

_slot = [0]


def empty(name, parent=None, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    SCENE.collection.objects.link(e)
    e.parent = parent
    e.location = loc
    return e


def cond(*terms):
    return '&'.join(t for t in terms if t)


class Gun:
    """Authoring helper on the gun grid. Coordinates are cells: k from the muzzle back, j up, x across."""

    def __init__(self, name, grip=(0, 0)):
        self.id = name
        self.gk, self.gj = grip
        self.root = empty(name, None, (_slot[0] * 1.6, 0, 0))
        _slot[0] += 1
        self.groups = {}
        self.pivots = {}
        self.cur = None
        self.part('main')

    def P(self, k, j, x=0.0):
        return Vector((x * S, (self.gk - k) * S, (j - self.gj) * S))

    def pivot(self, part, k, j):
        """The part's turning point (set before its first use)."""
        self.pivots[part] = (k, j)
        return self

    def part(self, name, c=''):
        key = (name, c)
        if key not in self.groups:
            piv = self.P(*self.pivots[name]) if name in self.pivots else Vector((0, 0, 0))
            e = empty(f'{self.id}-{name}' + (f'@{c}' if c else ''), self.root, piv)
            self.groups[key] = (e, piv)
        self.cur = self.groups[key]
        return self

    def mark(self, name, k, j, x=0.0, c=''):
        empty(f'{self.id}-m-{name}' + (f'@{c}' if c else ''), self.root, self.P(k, j, x))
        return self

    # -- mesh plumbing
    def _add(self, bm, material, bev=0.0, seg=1, sharp=35.0):
        grp, piv = self.cur
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for v in bm.verts:
            v.co -= piv
        for f in bm.faces:
            f.smooth = True
        if bev <= 0:
            lim = math.radians(sharp)
            for e in bm.edges:
                if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > lim:
                    e.smooth = False
        me = bpy.data.meshes.new('m')
        bm.to_mesh(me)
        bm.free()
        me.materials.append(material)
        o = bpy.data.objects.new('m', me)
        SCENE.collection.objects.link(o)
        o.parent = grp
        if bev > 0:
            b = o.modifiers.new('bevel', 'BEVEL')
            b.width = bev * S
            b.segments = seg
            b.limit_method = 'ANGLE'
            b.angle_limit = math.radians(28)
            b.harden_normals = True
        return self

    # -- primitives
    def box(self, k0, k1, j0, j1, w, m, x=0.0, bev=0.3, seg=1):
        """A box k0..k1 by j0..j1, `w` wide, centred on x."""
        bev = min(bev, abs(k1 - k0) * 0.45, abs(j1 - j0) * 0.45, w * 0.45)
        bm = bmesh.new()
        vs = [bm.verts.new(self.P(k, j, x + sx * w / 2)) for sx in (-1, 1) for k in (k0, k1) for j in (j0, j1)]
        for a, b, c, d in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
            bm.faces.new((vs[a], vs[b], vs[c], vs[d]))
        return self._add(bm, m, bev, seg)

    def plate(self, pts, w, m, x=0.0, bev=0.35, seg=1):
        """A side profile [(k, j), ...] extruded `w` wide."""
        bm = bmesh.new()
        a = [bm.verts.new(self.P(k, j, x - w / 2)) for k, j in pts]
        b = [bm.verts.new(self.P(k, j, x + w / 2)) for k, j in pts]
        bm.faces.new(a)
        bm.faces.new(list(reversed(b)))
        n = len(pts)
        for i in range(n):
            bm.faces.new((a[i], b[i], b[(i + 1) % n], a[(i + 1) % n]))
        return self._add(bm, m, min(bev, w * 0.45), seg)

    def _rings(self, bm, rings, cap0=True, cap1=True):
        for a, b in zip(rings, rings[1:]):
            n = len(a)
            for i in range(n):
                bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
        if cap0:
            bm.faces.new(list(reversed(rings[0])))
        if cap1:
            bm.faces.new(rings[-1])

    def lathe(self, prof, j, m, x=0.0, seg=10, sx=1.0, slant=0.0):
        """Turned about the bore: prof is [(k, r), ...] front to back. `sx` squashes it across; `slant` rakes the first ring back toward its underside."""
        bm = bmesh.new()
        rings = []
        for n, (k, r) in enumerate(prof):
            ring = []
            for i in range(seg):
                a = (i + 0.5) / seg * math.tau
                dk = (1 - math.sin(a)) * r * slant if n == 0 else 0.0
                ring.append(bm.verts.new(self.P(k + dk, j, x) + Vector((math.cos(a) * r * sx * S, 0, math.sin(a) * r * S))))
            rings.append(ring)
        self._rings(bm, rings, prof[0][1] > 1e-4, prof[-1][1] > 1e-4)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        return self._add(bm, m)

    def rod(self, k0, k1, j, r, m, x=0.0, seg=10, r1=None, sx=1.0, slant=0.0):
        """A round bar along the bore from k0 to k1 (r at the front, r1 at the back)."""
        return self.lathe([(k0, r), (k1, r if r1 is None else r1)], j, m, x, seg, sx, slant)

    def disc(self, k, j, r, w, m, x=0.0, seg=14):
        """A drum on its side: axis across the gun, centred on (k, j)."""
        bm = bmesh.new()
        rings = []
        for sxn in (-1, 1):
            rings.append([bm.verts.new(self.P(k, j, x + sxn * w / 2) + Vector((0, math.cos(i / seg * math.tau) * r * S, math.sin(i / seg * math.tau) * r * S))) for i in range(seg)])
        self._rings(bm, rings)
        return self._add(bm, m)

    def vcyl(self, k, j0, j1, r, m, x=0.0, seg=10, r1=None):
        """An upright cylinder at (k, x) from j0 to j1."""
        bm = bmesh.new()
        rings = []
        for j, rr in ((j0, r), (j1, r if r1 is None else r1)):
            rings.append([bm.verts.new(self.P(k, j, x) + Vector((math.cos(i / seg * math.tau) * rr * S, math.sin(i / seg * math.tau) * rr * S, 0))) for i in range(seg)])
        self._rings(bm, rings)
        return self._add(bm, m)

    def wire(self, pts, r, m, x=0.0, sides=5):
        """A bent rod through [(k, j) or (k, j, x), ...] (trigger guards, loops, hoses)."""
        bm = bmesh.new()
        ps = [self.P(p[0], p[1], p[2] if len(p) > 2 else x) for p in pts]
        rings = []
        prev = None
        for i, p in enumerate(ps):
            d = (ps[min(i + 1, len(ps) - 1)] - ps[max(i - 1, 0)]).normalized()
            if prev is None:
                ref = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 0, 1))
                prev = d.cross(ref).normalized()
            n = (prev - d * prev.dot(d)).normalized()
            prev = n
            b = d.cross(n).normalized()
            rings.append([bm.verts.new(p + (n * math.cos(s / sides * math.tau) + b * math.sin(s / sides * math.tau)) * r * S) for s in range(sides)])
        self._rings(bm, rings)
        return self._add(bm, m, sharp=50)

    def ball(self, k, j, r, m, x=0.0):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r * S)
        c = self.P(k, j, x)
        for v in bm.verts:
            v.co += c
        return self._add(bm, m, sharp=80)

    # -- shared fittings
    def ears(self, k0, k1, j0, j1, m=None, gap=1.1, w=0.9):
        """A rear notch: two ears either side of the sight line."""
        for sx in (-1, 1):
            self.box(k0, k1, j0, j1, w, m or STEEL_HI, x=sx * (gap + w) / 2, bev=0.15)
        return self

    def guard(self, k0, k1, j0, j1, m=None, trigger=None):
        """A trigger guard hanging from j1 with the trigger inside."""
        self.wire([(k0, j1), (k0 + 0.3, j0 + 0.5), (k0 + 1.2, j0), (k1 - 1.2, j0), (k1 - 0.3, j0 + 0.5), (k1, j1)], 0.36, m or STEEL)
        tk = trigger if trigger is not None else (k0 + k1) / 2
        self.plate([(tk, j1), (tk + 0.9, j1), (tk + 0.5, j0 + 1.1), (tk - 0.3, j0 + 0.9)], 0.8, BLACK, bev=0.15)
        return self

    def swivel(self, k, j):
        self.wire([(k - 0.8, j), (k - 1, j - 1.6), (k, j - 2.2), (k + 1, j - 1.6), (k + 0.8, j)], 0.26, STEEL_HI, sides=4)
        return self

    def rivets(self, ks, j, w, m=None, r=0.42):
        for k in ks:
            self.disc(k, j, r, w + 0.35, m or STEEL_HI, seg=6)
        return self

    def bore(self, k, j, r, x=0.0):
        self.rod(k - 0.06, k + 0.3, j, r, HOLE, x, seg=8)
        return self

    def grooves(self, ks, j0, j1, w, m, x=0.0, t=0.45):
        for k in ks:
            self.box(k, k + t, j0, j1, w, m, x, bev=0)
        return self

    def finish(self):
        """Applies the bevels and joins every group into one mesh."""
        bpy.context.view_layer.update()
        for grp, _ in self.groups.values():
            kids = [o for o in grp.children if o.type == 'MESH']
            if not kids:
                continue
            with bpy.context.temp_override(selected_objects=kids, selected_editable_objects=kids, active_object=kids[0], object=kids[0]):
                bpy.ops.object.convert(target='MESH')
                if len(kids) > 1:
                    bpy.ops.object.join()
        return self


def red_dot(g, k0, k1, jb):
    """A slim open reflex sight on the receiver top (row jb): the window stays clear, the dot floats in the front glass."""
    g.part('main', 'optic=reddot')
    g.box(k0, k1, jb, jb + 0.9, 4.4, STEEL_D, bev=0.25)
    for sx in (-1.85, 1.85):
        g.plate([(k0, jb + 0.8), (k0, jb + 4.9), (k0 + 1.4, jb + 4.9), (k0 + 3.4, jb + 2.2), (k1, jb + 1.7), (k1, jb + 0.8)], 0.7, STEEL_D, x=sx, bev=0.2)
        g.disc(k1 - 1.8, jb + 1.2, 0.4, 0.3, STEEL_HI, x=sx * 1.2, seg=6)
    g.box(k0, k0 + 1.3, jb + 4.1, jb + 4.9, 4.4, STEEL_D, bev=0.25)
    g.mark('dot0', k0, jb + 2.5, c='optic=reddot').mark('dot1', k1, jb + 2.5, c='optic=reddot')
    g.part('main')


def scope(g, k0, k1, j):
    """A telescopic sight on two mounts; its axis is the sight line."""
    g.part('main', 'optic=scope')
    g.lathe([(k0, 2.3), (k0 + 4, 2.3), (k0 + 5, 1.5), (k1 - 5, 1.5), (k1 - 4, 2.0), (k1, 2.0)], j, BLACK, seg=12)
    g.rod(k0 - 0.1, k0 + 0.3, j, 1.9, LENS, seg=12)
    g.vcyl((k0 + k1) / 2, j + 1.2, j + 2.4, 0.8, STEEL_HI, seg=8)
    for k in (k0 + 6, k1 - 8):
        g.box(k, k + 2, j - 4.5, j - 0.8, 1.2, STEEL, bev=0.2)
        g.rod(k, k + 2, j, 1.75, STEEL, seg=12)
    g.mark('scope0', k0, j, c='optic=scope').mark('scope1', k1, j, c='optic=scope')
    g.part('main')


def maxim(g, j, k=0.0, part='main', also=''):
    """A Maxim silencer can ahead of the muzzle."""
    c = cond('muzzle=maxim', also)
    g.part(part, c)
    g.lathe([(k - 12, 1.3), (k - 11.4, 1.75), (k - 1, 1.75), (k - 0.4, 1.2), (k + 0.5, 1.2)], j, BLACK, seg=12)
    g.rod(k - 12.3, k - 11.8, j, 1.4, STEEL_HI, seg=12)
    g.bore(k - 12.3, j, 0.6)
    g.mark('muzzle', k - 12, j, c=c)
    g.part('main')


def cutts(g, j, k=0.0, part='main', r=1.5):
    """A Cutts compensator: a short slotted tube screwed onto the muzzle."""
    g.part(part, 'muzzle=cutts')
    g.lathe([(k - 5, r * 0.8), (k - 4.6, r), (k - 0.6, r), (k + 0.4, r * 0.75)], j, STEEL, seg=12)
    g.rod(k - 5.2, k - 4.7, j, r * 1.08, STEEL_HI, seg=12)
    for kk in (k - 4, k - 2.4):
        g.box(kk, kk + 0.9, j + r * 0.86, j + r + 0.02, r * 1.1, HOLE, bev=0)
        for sx in (-1, 1):
            g.box(kk, kk + 0.9, j - r * 0.45, j + r * 0.45, 0.2, HOLE, x=sx * r * 0.93, bev=0)
    g.bore(k - 5.2, j, r * 0.5)
    g.mark('muzzle', k - 5, j, c='muzzle=cutts')
    g.part('main')


def light_cuts(g, slots, w, c='stock=light'):
    """Lightening cuts through a stock, drawn as dark recesses on both flanks."""
    g.part('main', c)
    for k0, k1, j0, j1 in slots:
        g.box(k0, k1, j0, j1, w + 0.2, HOLE, bev=0.5)
    g.part('main')


def stripes(g, pts_fn, js, w, m):
    """Thin bands across a raked grip: pts_fn(j) gives its (k0, k1) at row j."""
    for j in js:
        k0, k1 = pts_fn(j)
        g.box(k0 + 0.2, k1 - 0.2, j, j + 0.4, w, m, bev=0)


# ---------------------------------------------------------------- guns

def m1911():
    g = Gun('m1911', (15, 4))
    B = 10.5
    # Frame, trigger guard, raked grip with walnut panels.
    g.box(2, 19.5, 7.6, 9.1, 3, STEEL, bev=0.4)
    g.guard(6.2, 12.4, 5, 7.8, trigger=9)
    g.plate([(12, 8.4), (18.4, 8.4), (20.8, 0), (14.6, 0)], 3, STEEL, bev=0.5)
    for c, wood in (('!stock=grips', WOOD_D), ('stock=grips', WOOD_L)):
        g.part('main', c)
        g.plate([(13.3, 7.4), (17.5, 7.4), (19.5, 0.9), (15.4, 0.9)], 3.9, wood, bev=0.45)
        if c == 'stock=grips':
            stripes(g, lambda j: (13.5 + (7.4 - j) * 0.31, 17.4 + (7.4 - j) * 0.31), (1.6, 2.6, 3.6, 4.6, 5.6, 6.4), 4.0, WOOD_D)
    g.part('main')
    g.rivets([15.6], 6.2, 3.9).rivets([17.4], 1.8, 3.9)
    # Beavertail, hammer, safety and slide stop.
    g.plate([(18, 9.1), (21.2, 9.1), (21.6, 8.4), (18.6, 7.4)], 2.6, STEEL, bev=0.3)
    g.plate([(19.2, 9), (20.2, 9), (20.9, 11.6), (20, 12), (19.3, 10.6)], 0.9, STEEL_HI, bev=0.2)
    g.box(15, 17.2, 8.9, 9.7, 0.6, STEEL_HI, x=-1.75, bev=0.15)
    g.box(7, 10, 8.2, 8.9, 0.6, STEEL_HI, x=-1.7, bev=0.15)
    g.part('slide')
    g.box(0, 19, 9, 12, 3.3, STEEL, bev=0.55)
    g.grooves([14, 15, 16, 17, 18], 9.5, 11.5, 3.42, STEEL_D)
    g.rod(-0.35, 0.6, B, 0.95, STEEL_HI)
    g.bore(-0.35, B, 0.55)
    g.box(1, 2, 11.8, 13, 0.7, STEEL_HI, bev=0.15)
    g.box(10, 13.2, 10.3, 11.4, 0.4, HOLE, x=1.5, bev=0)
    g.part('slide', '!optic=reddot').ears(17, 18, 11.8, 13)
    g.part('mag', '!magazine=extended')
    g.box(14.4, 17.8, 0, 8, 1.7, STEEL_D, bev=0.2).box(14, 20.6, -0.9, 0.1, 3.1, BLACK, bev=0.3)
    g.part('mag', 'magazine=extended')
    g.box(14.4, 17.8, -4, 8, 1.7, STEEL_D, bev=0.2).box(14.2, 19.4, -4.9, -3.9, 3.1, BLACK, bev=0.3)
    g.box(14.2, 19, -3.9, 0, 2.6, BLACK, bev=0.3)
    # Pack-a-Punched it carries a fat launcher barrel under the slide.
    g.part('main', 'pap')
    g.rod(-2, 8, 6.5, 1.6, STEEL, seg=12).rod(-2.3, -1.4, 6.5, 1.85, STEEL_HI, seg=12).bore(-2.3, 6.5, 1.0)
    g.box(4, 8, 7.2, 8, 2.2, STEEL, bev=0.2)
    g.part('main')
    red_dot(g, 11.5, 18, 12)
    maxim(g, B)
    cutts(g, B, r=1.35)
    g.mark('muzzle', 0, B).mark('muzzle', -2, B, c='pap&!muzzle=maxim')
    g.mark('sight', 17.5, 13).mark('front', 1.5, 13).mark('eject', 12, 11, 1)
    return g.finish()


def c96():
    g = Gun('c96', (22, 5))
    B = 12.5
    g.lathe([(0, 0.8), (8, 0.9), (10, 1.3), (11, 1.4)], B, STEEL)
    g.bore(0, B, 0.45)
    g.box(1, 2.2, 13.1, 15, 0.7, STEEL_HI, bev=0.15)
    g.box(10, 22.4, 10, 14, 3.1, STEEL, bev=0.5)
    g.box(10, 16, 6, 10.4, 3.1, STEEL, bev=0.4)
    g.grooves([11, 12.5, 14], 7, 9.2, 3.25, STEEL_D, t=0.6)
    g.box(15.6, 22.6, 8.4, 10.3, 3.1, STEEL, bev=0.4)
    g.guard(16, 20.4, 5.8, 8.5, trigger=17.4)
    # Broomhandle grip, ringed, with a lanyard loop.
    g.plate([(19.4, 10), (24.2, 10), (25.6, 5.5), (27, 0.4), (26, -0.4), (22.6, -0.4), (21.6, 0.5), (20.6, 5.5)], 3.5, WOOD, bev=1.1, seg=2)
    stripes(g, lambda j: (19.5 + (10 - j) * 0.25, 24.3 + (10 - j) * 0.27), (1.4, 2.8, 4.2, 5.6, 7, 8.4), 3.6, WOOD_D)
    g.swivel(24.4, -0.3)
    g.plate([(22.2, 13.8), (23.2, 13.8), (24, 14.6), (23, 14.9), (22.2, 14.6)], 0.9, STEEL, bev=0.2)
    g.part('main', '!optic=reddot').ears(15, 18, 13.9, 15)
    g.part('bolt')
    g.box(18, 22, 12.9, 14.15, 1.3, STEEL_HI, bev=0.2).box(20.2, 22.7, 12.4, 14.1, 3.6, STEEL_HI, bev=0.3)
    g.grooves([20.6, 21.4, 22.2], 12.6, 13.9, 3.7, STEEL_D, t=0.3)
    g.part('mag', '!magazine=box').box(10.2, 15.8, 5.4, 6.2, 3.2, STEEL_HI, bev=0.25)
    g.part('mag', 'magazine=box')
    g.box(10.2, 15.8, -1, 6.2, 2.9, BLACK, bev=0.4).box(10, 16, -1.6, -0.8, 3.2, STEEL, bev=0.25)
    # The wooden holster clipped to the butt as a stock: a slim hollow paddle, hinged lid at the back.
    g.part('main', 'stock=holster')
    g.box(25.4, 27.6, 0.2, 2.6, 2.0, STEEL, bev=0.3)
    g.plate([(27, 0.4), (27.4, 2.6), (40, 4.2), (44.6, 3.4), (45.4, -3.2), (43.6, -4.6), (38, -3.6)], 2.5, WOOD_L, bev=0.8, seg=2)
    g.plate([(43.4, -4.9), (45.9, -3.4), (45.2, 3.8), (43.8, 4.1)], 2.7, WOOD_D, bev=0.4)
    g.rivets([44.6], -0.4, 2.7, BRASS)
    g.part('main')
    red_dot(g, 13.5, 20, 14)
    maxim(g, B)
    cutts(g, B, r=1.2)
    g.mark('muzzle', 0, B).mark('sight', 16.5, 15).mark('front', 1.5, 15).mark('eject', 19, 13, 1)
    return g.finish()


def m1897():
    g = Gun('m1897', (62, 8))
    B = 13.5
    # Receiver, shared by every variant.
    g.box(46, 60.4, 8, 15, 3.3, STEEL, bev=0.6)
    g.box(54.6, 59.2, 11.4, 13.4, 0.4, HOLE, x=1.55, bev=0)
    g.rivets([48, 58], 9.6, 3.3)
    g.guard(54, 61, 5.8, 8.2, trigger=56.6)
    g.plate([(59.6, 14.6), (60.6, 14.6), (61.6, 15.6), (60.8, 16), (59.8, 15.6)], 0.9, STEEL_HI, bev=0.2)
    g.part('main', '!optic=reddot')
    g.box(51, 54, 14.8, 16, 3, STEEL, bev=0.3).ears(52, 53, 15.8, 18)
    for sawn in (False, True):
        cs = 'stock=sawn' if sawn else '!stock=sawn'
        k0 = 22 if sawn else 0
        g.part('main', cs)
        g.rod(k0, 50, B, 1.2, STEEL, seg=12).bore(k0, B, 0.85)
        g.box(k0 + 1, k0 + 2, 14.3, 16.3, 0.7, STEEL, bev=0.15)
        # The trench gun's ventilated heat shield, clamped at both ends.
        s0 = max(k0 + 4, 4)
        g.rod(s0, 34, B + 0.35, 1.95, STEEL, seg=12)
        for k in (s0, 33):
            g.rod(k - 0.2, k + 1.2, B + 0.35, 2.2, STEEL_HI, seg=12)
        for k in range(int(s0) + 3, 32, 3):
            g.box(k, k + 1.2, 15.6, 15.9, 1.0, HOLE, bev=0)
            for sx in (-1, 1):
                g.box(k, k + 1.2, 13.9, 14.8, 0.3, HOLE, x=sx * 1.86, bev=0)
        g.mark('muzzle', k0, B, c=cs).mark('front', k0 + 1.5, 17, c=cs)
        if sawn:
            g.rod(k0, 46, 11.2, 1.0, STEEL, seg=10).rod(k0 - 0.3, k0 + 0.8, 11.2, 1.15, STEEL_HI, seg=10)
            g.plate([(59.6, 8.4), (59.6, 13.4), (63.5, 13), (67, 9.5), (69.4, 4.8), (68.6, 1.4), (65.6, 1), (64.2, 4.6), (62, 7.4)], 3.4, WOOD, bev=1.0, seg=2)
        else:
            g.box(k0 + 3, k0 + 6, 9.4, 12.4, 1.2, STEEL, bev=0.25)
            g.plate([(59.6, 7.6), (59.6, 13.2), (63, 13.5), (82, 10.8), (82, 0.3), (79.4, 0.3), (66.5, 6), (62.5, 7.2)], 3.4, WOOD, bev=1.0, seg=2)
            g.box(81.5, 82.7, 0.1, 11, 3.5, BLACK, bev=0.4)
            g.swivel(74, 3)
            for tube in (False, True):
                g.part('main', cond(cs, 'magazine=tube' if tube else '!magazine=tube'))
                t0 = 2 if tube else 8
                g.rod(t0, 46, 11.2, 1.0, STEEL, seg=10).rod(t0 - 0.3, t0 + 0.8, 11.2, 1.15, STEEL_HI, seg=10)
        for bead in (False, True):
            g.part('main', cond(cs, 'optic=bead' if bead else '!optic=bead'))
            g.ball(k0 + 1.5, 16.45, 0.6, IVORY if bead else BRASS)
        g.part('main', cond(cs, 'muzzle=choke'))
        g.rod(k0 - 2, k0 + 0.4, B, 1.55, STEEL_HI, seg=12).bore(k0 - 2, B, 0.7)
        # The pump: a ringed walnut sleeve round the magazine tube.
        a, b = (30, 42) if sawn else (24, 38)
        g.part('pump', cs)
        g.rod(a, b, 10.9, 2.3, WOOD, seg=10, sx=0.85)
        for k in range(a + 1, b - 1, 2):
            g.rod(k, k + 0.5, 10.9, 2.42, WOOD_D, seg=10, sx=0.85)
        g.box(b, 46, 10.4, 11.4, 0.5, STEEL_HI, x=1.25, bev=0)
    g.part('main')
    red_dot(g, 46, 55, 15)
    g.mark('sight', 52.5, 18).mark('eject', 55, 13, 1)
    return g.finish()


def kar98k():
    g = Gun('kar98k', (62, 7))
    B = 10.5
    g.rod(0, 46, B, 1.0, STEEL).bore(0, B, 0.5)
    # Hooded front post, nose cap and cleaning rod.
    g.box(1.6, 2.6, 11.2, 14, 0.7, STEEL_HI, bev=0.15)
    for sx in (-1.7, 1.7):
        g.box(1, 3.2, 10.2, 13.6, 0.5, STEEL, x=sx, bev=0.15)
    g.box(1, 3.2, 10.4, 11.4, 3.4, STEEL, bev=0.25)
    g.rod(3, 14, 8.6, 0.38, STEEL_HI, seg=6)
    g.box(12, 14.4, 6.2, 11, 3.5, STEEL, bev=0.4)
    # Fore-end, handguard and bands.
    g.box(14, 50, 6, 10.2, 3.3, WOOD, bev=0.9, seg=2)
    g.box(26, 44, 9.8, 12, 2.7, WOOD_D, bev=0.8, seg=2)
    for k in (15.5, 28):
        g.box(k, k + 2, 5.8, 11.6, 3.7, STEEL, bev=0.4)
    g.box(44, 60, 8, 12, 3, STEEL, bev=0.5)
    g.box(40, 43, 11.8, 13, 3, STEEL_HI, bev=0.25).ears(40, 43, 12.9, 14)
    g.guard(50, 57.4, 4.6, 6.6, trigger=53.6)
    # Wrist and stock.
    g.plate([(49, 6.2), (50, 10.2), (61, 10.4), (66.5, 10), (90, 9.5), (90, 0), (87.4, 0), (71, 4.2), (64, 4.5), (58.5, 3.6), (56.6, 6)], 3.4, WOOD, bev=1.1, seg=2)
    g.box(89.5, 90.6, -0.2, 9.7, 3.5, STEEL, bev=0.35)
    g.swivel(30, 6).swivel(76, 3.4)
    g.rivets([70, 82], 6.6, 3.4)
    light_cuts(g, [(72, 76, 4.4, 7.2), (79, 83, 3.4, 6.6)], 3.4)
    g.pivot('bolt', 54, 12).part('bolt')
    g.rod(48, 60.4, 12, 1.0, STEEL_HI)
    g.wire([(58, 12, 0.6), (58, 11.4, 2.2), (58, 9.9, 3.5)], 0.42, STEEL_HI)
    g.ball(58, 9.6, 0.95, STEEL_HI, x=3.8)
    g.rod(60.4, 62, 12, 0.8, STEEL, seg=8)
    g.part('mag', '!magazine=trench').box(49, 56, 5, 5.9, 3.1, STEEL_HI, bev=0.25)
    g.part('mag', 'magazine=trench')
    g.box(48.4, 56, -3, 6, 2.9, BLACK, bev=0.5).box(48.2, 56.2, -3.6, -2.8, 3.2, STEEL, bev=0.25)
    g.part('main')
    scope(g, 42, 64, 16.5)
    maxim(g, B)
    g.mark('muzzle', 0, B).mark('sight', 41.5, 14).mark('front', 2.1, 14).mark('eject', 52, 12, 1)
    return g.finish()


def thompson():
    g = Gun('thompson', (47, 9))
    B = 16.5
    g.rod(0, 28, B, 1.1, STEEL).bore(0, B, 0.6)
    for k in range(4, 22, 2):
        g.rod(k, k + 0.8, B, 2.15, STEEL, seg=12)
    g.box(1, 2.2, 17.4, 21, 0.8, STEEL_HI, bev=0.15)
    g.rod(0.6, 2.6, B, 1.5, STEEL)
    # Receiver.
    g.box(26, 54, 13, 20, 3.3, STEEL, bev=0.6)
    g.box(27, 53, 16.1, 16.9, 3.45, STEEL_HI, bev=0)
    g.rivets([30, 50], 18.4, 3.3)
    g.box(35, 42, 17.6, 19.2, 0.4, HOLE, x=1.6, bev=0)
    # Vertical foregrip, rear grip, stock.
    g.box(14, 20.6, 13, 15.3, 3.4, STEEL, bev=0.4)
    g.plate([(14.6, 13.6), (20.2, 13.6), (21.2, 6.4), (19.8, 5.4), (17.2, 5.4), (16, 6.4)], 3.3, WOOD, bev=1.0, seg=2)
    stripes(g, lambda j: (16.2 - (j - 6) * 0.2, 21.1 - (j - 6) * 0.13), (7.2, 8.8, 10.4, 12), 3.4, WOOD_D)
    g.plate([(44.4, 13.4), (51.2, 13.4), (53.4, 3.6), (52.4, 2.8), (49.6, 2.8), (48.4, 3.8)], 3.3, WOOD, bev=1.0, seg=2)
    g.guard(40.6, 47.6, 10.2, 13, trigger=43.8)
    g.plate([(54, 8.6), (54, 17.2), (76, 16.8), (76, 2.4), (73.6, 2.4), (58, 7.6)], 3.4, WOOD, bev=1.0, seg=2)
    g.box(75.6, 76.8, 2.2, 17, 3.5, BLACK, bev=0.4)
    g.swivel(70, 4.2)
    light_cuts(g, [(60, 64, 9.4, 13.4), (67, 71, 7.6, 13.4)], 3.4)
    g.part('main', '!optic=reddot').ears(46, 47.2, 19.8, 22)
    g.part('bolt')
    g.box(36, 41, 19.6, 20.9, 1.3, STEEL_HI, bev=0.25)
    for sx in (-0.75, 0.75):
        g.ball(38.5, 21, 0.62, STEEL_HI, x=sx)
    g.part('mag', '!magazine=drum')
    g.box(32, 37, 2, 13.4, 2.7, BLACK, bev=0.4).box(31.6, 37.4, 1.2, 2.2, 3.1, STEEL, bev=0.25)
    for j in (4.4, 7.4, 10.4):
        g.box(32.1, 36.9, j, j + 0.5, 2.85, STEEL_D, bev=0)
    g.part('mag', 'magazine=drum')
    g.disc(36, 7, 7.8, 5.6, BLACK, seg=16)
    g.disc(36, 7, 8.1, 2.2, STEEL_HI, seg=16)
    g.disc(36, 7, 4.6, 6.2, STEEL_D, seg=12).disc(36, 7, 1.5, 7.2, STEEL_HI, seg=8)
    g.box(33.5, 38.5, 6.6, 7.4, 0.5, STEEL_HI, x=-3.7, bev=0.1)
    g.box(33, 39, 13, 14, 3.2, STEEL, bev=0.25)
    g.part('main')
    red_dot(g, 45, 54, 20)
    maxim(g, B)
    cutts(g, B)
    g.mark('muzzle', 0, B).mark('sight', 46.6, 22).mark('front', 1.6, 21).mark('eject', 38, 19, 1)
    return g.finish()


def mp18():
    g = Gun('mp18', (52, 9))
    B = 15.5
    # Perforated jacket and the receiver tube behind it.
    g.rod(0, 33, B, 2.15, STEEL, seg=12)
    g.rod(-0.6, 0.3, B, 0.75, STEEL_HI).bore(-0.6, B, 0.45)
    g.rod(-0.1, 0.9, B, 2.3, STEEL_HI, seg=12)
    for k in range(3, 31, 3):
        g.box(k, k + 1.3, 17.35, 17.7, 1.1, HOLE, bev=0)
        for sx in (-1, 1):
            for j in (14.4, 16):
                g.box(k, k + 1.3, j, j + 0.7, 0.3, HOLE, x=sx * 2.05, bev=0)
    g.box(1, 2.2, 17.3, 19, 0.8, STEEL_HI, bev=0.15)
    g.rod(33, 54, B, 2.25, STEEL, seg=12)
    g.rod(54, 55.4, B, 1.9, STEEL_HI, seg=12)
    g.box(41, 53, 15.2, 16, 0.3, HOLE, x=2.2, bev=0)
    g.box(38, 40, 17.2, 18.1, 3, STEEL_HI, bev=0.2).ears(38, 40, 17.9, 19)
    # One-piece stock.
    g.plate([(28, 10), (28, 13.5), (57, 13.6), (78, 12.4), (78, 1), (75.6, 1), (61.5, 6), (56, 7.2), (53, 9.4), (45, 9.8)], 3.5, WOOD, bev=1.1, seg=2)
    g.box(77.5, 78.7, 0.8, 12.6, 3.6, STEEL, bev=0.35)
    g.swivel(66, 4.6)
    g.rivets([60], 9.4, 3.5)
    g.guard(45.4, 52.6, 7.2, 9.8, trigger=48.6)
    light_cuts(g, [(62, 66, 7, 10.6), (69, 73, 5, 10)], 3.5)
    g.part('bolt')
    g.wire([(43.5, 15.6, 2), (43.5, 15.6, 3.6)], 0.5, STEEL_HI)
    g.ball(43.5, 15.6, 0.9, STEEL_HI, x=4)
    # The magazine housing on the left, with a stick or the snail drum.
    g.part('mag')
    g.box(33.6, 38.4, 14.2, 16.8, 3.4, STEEL, x=-3.4, bev=0.4)
    g.part('mag', '!magazine=snail').box(34.2, 37.8, 14.6, 16.4, 5, BLACK, x=-7, bev=0.4)
    g.part('mag', 'magazine=snail')
    g.box(34.2, 37.8, 14.6, 16.4, 2.4, BLACK, x=-5.8, bev=0.3)
    g.disc(36, 10.6, 5.8, 2.8, BLACK, x=-6.6, seg=16)
    g.disc(36, 10.6, 6.1, 1.0, STEEL_HI, x=-6.6, seg=16)
    g.disc(36, 10.6, 1.4, 3.6, STEEL_HI, x=-6.6, seg=8)
    g.part('main')
    red_dot(g, 44, 53, 17.6)
    maxim(g, B)
    g.mark('muzzle', 0, B).mark('sight', 39, 19).mark('front', 1.6, 19).mark('eject', 44, 16, 1)
    return g.finish()


def ppsh():
    g = Gun('ppsh', (57, 12))
    B = 20.5
    # Receiver: lower half, top cover over a dark seam, hinge at the front.
    g.box(31, 55, 17, 23, 4.7, STEEL, bev=0.9, seg=2)
    g.box(31.2, 54.8, 19.2, 19.6, 4.82, STEEL_D, bev=0)
    g.box(30.6, 33, 18.8, 21.2, 5.3, STEEL_HI, bev=0.4)
    g.box(53, 54.4, 22.6, 23.4, 1.2, STEEL_HI, bev=0.2)
    g.rivets([36], 18, 4.7)
    g.box(41, 46, 22.8, 23.08, 2.6, HOLE, bev=0)
    g.box(40, 53, 20, 21, 0.3, HOLE, x=2.4, bev=0)
    g.rod(29, 31, B, 2.9, STEEL, seg=12, sx=0.85)
    g.wire([(28.6, 19.6, -3.2), (28.6, 17.4, -3.4), (30.6, 17.4, -3.4), (30.6, 19.6, -3.2)], 0.26, STEEL_HI, sides=4)
    for brake in (False, True):
        cb = 'muzzle=brake' if brake else '!muzzle=brake'
        f = -4 if brake else 0
        g.part('main', cb)
        # The slotted jacket, its nose cut on a slant with the top lip furthest forward.
        g.rod(f, 29.5, B, 2.6, STEEL, seg=12, sx=0.85, slant=0.9)
        g.rod(f + 3, f + 4.2, B, 1.0, STEEL_HI, seg=8).bore(f + 3, B, 0.6)
        for k0 in ([0, 6, 12, 18, 24] if brake else [6, 12, 18, 24]):
            for sx in (-1, 1):
                g.box(k0, k0 + 4, 19.5, 21.5, 0.3, HOLE, x=sx * 2.15, bev=0)
        for k in (9, 15, 21, 27):
            g.box(k, k + 1, 22.95, 23.2, 0.9, HOLE, bev=0)
        # Hooded front post on a ramp.
        g.box(f + 1, f + 5.4, 22.7, 23.6, 3.2, STEEL, bev=0.25)
        g.box(f + 3, f + 4, 23.4, 25, 0.7, STEEL_HI, bev=0.15)
        for sx in (-1.75, 1.75):
            g.box(f + 2, f + 5, 23.4, 26.4, 0.55, STEEL, x=sx, bev=0.15)
        for k in (f + 2, f + 4.3):
            g.box(k, k + 0.7, 26.2, 26.9, 4.05, STEEL, bev=0.15)
        g.mark('front', f + 3.5, 25, c=cb)
        g.mark('muzzle', -2 if brake else 1, B, c=cb)
    g.part('main', '!optic=reddot')
    g.box(33, 39, 22.8, 24, 3, STEEL, bev=0.3).ears(34, 35.2, 23.8, 25)
    # Walnut: fore-end under the receiver, the pistol-grip swell, a straight comb and a tall butt.
    for short in (False, True):
        g.part('main', 'stock=light' if short else '!stock=light')
        end = 70 if short else 80
        lo = 13.4 - (end - 63) * 0.3625
        hi = 22 - (end - 55) * 0.06
        g.plate([(28, 17.3), (30.6, 14.2), (53, 14), (55.4, 10.6), (57.8, 8.5), (61, 8.3), (63.4, 10), (65.4, 12.7), (end, lo), (end, hi), (55, 22.2), (55, 17.2)], 4.8, WOOD, bev=1.1, seg=2)
        g.box(end - 0.5, end + 0.7, lo - 0.2, hi + 0.2, 4.9, STEEL, bev=0.35)
        sk = 64 if short else 71
        g.box(sk, sk + 3, 15.4, 17.2, 5.0, HOLE, bev=0.5)
    g.part('main')
    g.rivets([57], 18.6, 4.8)
    g.guard(45.6, 54.6, 9.2, 14, trigger=49.8)
    g.box(44, 46, 13, 14.2, 3, STEEL_HI, bev=0.25)
    g.part('bolt')
    g.box(46, 48, 19.6, 21.4, 1.4, STEEL_HI, x=3, bev=0.25)
    g.box(41.4, 45.6, 22.9, 23.2, 2.2, STEEL_HI, bev=0)
    g.part('mag').box(36, 43, 12, 14.2, 3.2, STEEL, bev=0.3)
    g.part('mag', '!magazine=box')
    # The 71-round drum: a fat disc with a lit rim, a stamped ring and the winding key.
    g.disc(39.5, 4.5, 8.4, 5.6, STEEL, seg=18)
    g.disc(39.5, 4.5, 8.7, 2.0, STEEL_HI, seg=18)
    g.disc(39.5, 4.5, 5.2, 6.3, STEEL_D, seg=14).disc(39.5, 4.5, 4.2, 6.5, STEEL, seg=14)
    g.disc(39.5, 4.5, 1.8, 7.4, STEEL_HI, seg=8)
    g.box(37, 42, 4.1, 4.9, 0.5, STEEL_HI, x=-3.8, bev=0.1)
    g.part('mag', 'magazine=box')
    g.plate([(38, 12.2), (43, 12.2), (41.4, 5), (39.2, 0), (34.2, 0.4), (36.6, 5.6)], 2.8, BLACK, bev=0.4)
    g.plate([(39.6, -0.6), (33.8, -0.2), (34, 0.6), (39.6, 0.3)], 3.1, STEEL, bev=0.2)
    # (a second term, so its muzzle marker outranks the plain jacket's)
    g.part('main', 'muzzle=maxim&!muzzle=brake').rod(0, 3.4, B, 0.7, STEEL)
    red_dot(g, 32, 41, 23)
    maxim(g, B, also='!muzzle=brake')
    g.mark('sight', 34.6, 25).mark('eject', 43, 22, 1)
    return g.finish()


def bar():
    g = Gun('bar', (68, 9))
    B = 13.5
    g.rod(0, 40, B, 1.0, STEEL).bore(0, B, 0.5)
    g.rod(12, 38, 11.4, 0.75, STEEL, seg=8)
    g.box(0.2, 3.2, 12, 15.2, 2.5, STEEL, bev=0.4)
    g.box(2, 3, 15, 17, 0.7, STEEL_HI, bev=0.15)
    for k in (14, 26):
        g.box(k, k + 1.2, 10.4, 14.7, 2.4, STEEL_HI, bev=0.3)
    g.box(30, 50, 9, 15, 3.7, WOOD, bev=1.1, seg=2)
    g.grooves([33, 36, 39, 42, 45], 10.4, 13.6, 3.82, WOOD_D, t=0.5)
    g.swivel(36, 9)
    g.box(48, 66.4, 8, 15, 3.3, PARK, bev=0.6)
    g.box(53, 59, 12, 14, 0.4, HOLE, x=1.6, bev=0)
    g.rivets([50, 64], 9.6, 3.3)
    g.guard(60, 67.4, 5.4, 8.2, trigger=63)
    for cut in (False, True):
        g.part('main', 'stock=light' if cut else '!stock=light')
        e = 86 if cut else 98
        g.plate([(66, 6.2), (66, 13.5), (e, 13 - (e - 74) * 0.02), (e, 7 - (e - 74) * 0.2), (e - 2.4, 7 - (e - 74) * 0.2), (74, 6.8)], 3.4, WOOD, bev=1.0, seg=2)
        g.box(e - 0.5, e + 0.7, 6.8 - (e - 74) * 0.2, 13.2 - (e - 74) * 0.02, 3.5, STEEL, bev=0.35)
    g.part('main', '!optic=reddot')
    g.box(63, 66, 14.8, 16, 3, STEEL_HI, bev=0.25).ears(63, 66, 15.9, 17)
    g.part('bolt')
    g.box(54, 58, 12.3, 13.7, 1.0, STEEL_HI, x=2.1, bev=0.2)
    g.ball(56, 13, 0.85, STEEL_HI, x=2.9)
    for big in (False, True):
        g.part('mag', 'magazine=40' if big else '!magazine=40')
        j0 = -6 if big else 1
        g.box(52, 58, j0, 8.4, 2.9, BLACK, bev=0.45).box(51.8, 58.2, j0 - 0.6, j0 + 0.3, 3.2, STEEL, bev=0.25)
        for j in ((-3, 0, 3, 6) if big else (3, 6)):
            g.box(52.1, 57.9, j, j + 0.5, 3.05, STEEL_D, bev=0)
    g.part('main')
    scope(g, 48, 70, 18.5)
    red_dot(g, 52, 61, 15)
    maxim(g, B)
    cutts(g, B)
    g.mark('muzzle', 0, B).mark('sight', 64.5, 17).mark('front', 2.5, 17).mark('eject', 56, 13, 1)
    return g.finish()


def lewis():
    g = Gun('lewis', (73, 8))
    B = 13.5
    g.part('main', '!muzzle=stripped')
    # The fat cooling shroud.
    g.lathe([(0, 1.7), (4.6, 1.7), (5, 4.1), (52, 4.1)], B, BLACK, seg=14)
    g.bore(0, B, 1.2)
    for k in range(8, 50, 6):
        g.rod(k, k + 1.2, B, 4.35, STEEL, seg=14)
    g.box(4, 5, 17.4, 21, 0.8, STEEL_HI, bev=0.15)
    g.part('main', 'muzzle=stripped')
    g.rod(0, 52, B, 1.0, STEEL).bore(0, B, 0.5)
    for k in range(30, 50, 2):
        g.rod(k, k + 0.8, B, 2.0, STEEL, seg=12)
    g.box(4, 5, 14.2, 21, 0.8, STEEL_HI, bev=0.15)
    g.box(3.4, 5.6, 12.6, 14.6, 2.2, STEEL, bev=0.3)
    g.part('main')
    g.box(50, 74, 9, 17, 4.5, PARK, bev=0.7)
    g.rivets([53, 71], 10.8, 4.5)
    g.box(68, 70, 16.8, 20.1, 3, STEEL_HI, bev=0.25).ears(68, 70, 20, 21)
    g.plate([(70, 10), (77, 10), (79, 2.6), (78, 1.8), (75.4, 1.8), (74.2, 2.8)], 3.2, WOOD, bev=1.0, seg=2)
    g.guard(65.6, 72, 5.6, 9, trigger=68.6)
    g.plate([(74, 7), (74, 14.2), (104, 14.2), (104, 4), (101.6, 4)], 4.5, WOOD, bev=1.1, seg=2)
    g.part('main', '!stock=padded').box(103.5, 104.7, 3.8, 14.4, 4.6, BLACK, bev=0.4)
    g.part('main', 'stock=padded').box(100, 105, 3.6, 14.6, 5, LEATHER, bev=1.1, seg=2)
    g.part('bolt')
    g.box(56, 62, 9.4, 10.8, 1.2, STEEL_HI, x=2.8, bev=0.2)
    g.ball(59, 10.1, 0.9, STEEL_HI, x=3.7)
    # The pan magazine, centred on its own axis so it can turn.
    g.pivot('pan', 58, 17)
    for big in (False, True):
        g.part('pan', 'magazine=97' if big else '!magazine=97')
        r = 12 if big else 10
        top = 20 if big else 19
        g.vcyl(58, 17, top - 0.4, r, BLACK, seg=18)
        g.vcyl(58, 17.3, top - 0.1, r + 0.3, STEEL, seg=18, r1=r - 0.6)
        g.vcyl(58, top - 0.5, top, 2.2, STEEL_HI, seg=8)
        for n in range(8):
            a = n / 8 * math.tau
            bm_r = (r + 2.4) / 2
            g.box(58 + math.sin(a) * bm_r - 0.35, 58 + math.sin(a) * bm_r + 0.35, top - 0.5, top - 0.15, 0.7, PARK, x=math.cos(a) * bm_r, bev=0)
    g.part('main', 'optic=ring')
    # a ring round the post: the target sits inside it
    g.wire([(5.2, 21 + math.sin(i / 10 * math.tau) * 2.4, math.cos(i / 10 * math.tau) * 2.4) for i in range(11)], 0.3, STEEL_HI, sides=4)
    g.part('main')
    g.mark('muzzle', 0, B).mark('sight', 69, 21).mark('front', 4.5, 21).mark('eject', 62, 12, 1)
    return g.finish()


def webley():
    g = Gun('webley', (22, 4))
    B = 13.5
    g.pivot('barrel', 13, 9).pivot('pan', 17, 11.5)
    for long in (False, True):
        cl = 'muzzle=long' if long else '!muzzle=long'
        kb = -6 if long else 0
        g.part('barrel', cl)
        # Slab-sided barrel with its rib and the front blade.
        g.rod(kb, 13.4, B, 1.3, STEEL).bore(kb, B, 0.7)
        g.box(kb, 13.4, 14.2, 15.1, 1.2, STEEL, bev=0.25)
        g.plate([(kb + 0.6, 15), (kb + 1, 17), (kb + 2, 17), (kb + 3.6, 15)], 0.8, STEEL_HI, bev=0.15)
        g.mark('muzzle', kb, B, c=cl).mark('front', kb + 1.5, 17, c=cl)
    g.part('barrel')
    g.box(9, 14.2, 9.6, 12.4, 3, STEEL, bev=0.4).box(12, 14.2, 7.6, 10, 3.4, STEEL, bev=0.4)
    g.rivets([13], 9, 3.4, r=0.6)
    g.box(13, 21.2, 15, 16, 3, STEEL, bev=0.35)
    g.part('barrel', '!optic=reddot').ears(19, 20.2, 15.9, 17)
    # The fluted six-shot cylinder, brass rims showing at the back.
    g.part('pan')
    g.rod(14.2, 20, 11.5, 3.2, STEEL, seg=12)
    g.rod(13.4, 14.2, 11.5, 0.8, STEEL_HI, seg=6)
    for n in range(6):
        a = (n + 0.5) / 6 * math.tau
        g.rod(15, 19, 11.5 + math.sin(a) * 3.05, 0.55, HOLE, x=math.cos(a) * 3.05, seg=6)
        a2 = n / 6 * math.tau
        g.rod(19.9, 20.25, 11.5 + math.sin(a2) * 1.9, 0.7, BRASS, x=math.cos(a2) * 1.9, seg=6)
    # The loader, shown only while reloading.
    g.part('mag', '!magazine=speed')
    g.rod(20.3, 22, 11.5, 2.5, BRASS, seg=12).rod(22, 23, 11.5, 1.4, BLACK, seg=8)
    g.part('mag', 'magazine=speed')
    g.rod(20.3, 21, 11.5, 2.3, BRASS, seg=12).rod(21, 22.4, 11.5, 2.7, STEEL, seg=12).rod(22.4, 25, 11.5, 0.9, STEEL_HI, seg=8)
    g.part('main')
    # Frame, recoil shield, stirrup latch and the hammer.
    g.box(13, 21.4, 5.8, 8, 3.6, STEEL, bev=0.45)
    g.box(20.2, 22.4, 6.6, 15, 4.6, STEEL, bev=0.7)
    g.box(20.2, 22.4, 14.8, 16, 3.2, STEEL_HI, bev=0.3)
    g.plate([(22.2, 12.6), (23.2, 12.6), (25.4, 15.2), (25, 16), (23.4, 15.8), (22.2, 14.6)], 0.9, STEEL_HI, bev=0.2)
    g.rivets([17], 6.9, 3.6)
    g.guard(14, 20.4, 3, 6, trigger=16.8)
    # Bird's-head grip in chequered vulcanite with a lanyard ring.
    g.plate([(20, 7.2), (25.2, 7.2), (27, 3), (28.8, -1), (27.6, -2.3), (24.6, -2.4), (23.2, -1.4), (22, 3)], 3.1, STEEL, bev=0.5)
    g.plate([(21.2, 6.4), (24.6, 6.4), (26.2, 2.8), (27.6, -0.8), (26.9, -1.5), (24.8, -1.5), (23.2, 2.6)], 4.1, VULCAN, bev=0.5)
    g.rivets([23.6], 4.4, 4.1, BRASS)
    g.swivel(25.8, -2.3)
    # Oversized walnut target grips over the vulcanite.
    g.part('main', 'stock=stock')
    g.plate([(20.6, 6.9), (25.2, 6.9), (27, 3), (29.4, -1.2), (28, -3), (24.2, -3), (22.6, -1.4), (21.6, 3)], 4.9, WOOD_L, bev=1.1, seg=2)
    stripes(g, lambda j: (22.4 + (6 - j) * 0.3, 26 + (6 - j) * 0.42), (-0.6, 0.8, 2.2, 3.6), 5.0, WOOD_D)
    g.rivets([23.8], 5, 4.9, BRASS)
    g.part('main')
    red_dot(g, 14.5, 21, 16)
    g.mark('sight', 19.6, 17).mark('eject', 20, 11, 1)
    return g.finish()


def sawnoff():
    g = Gun('sawnoff', (43, 7))
    B = 12.5
    g.pivot('barrel', 30, 8).part('barrel')
    for sx in (-1.75, 1.75):
        g.rod(0, 31, B, 1.75, STEEL, x=sx, seg=12).bore(0, B, 1.25, x=sx)
    g.box(0, 31, 13.6, 15, 1.3, STEEL_HI, bev=0.3)
    g.grooves(range(2, 30, 3), 14.86, 15.06, 1.0, STEEL_D, t=1)
    g.box(0.5, 31, 11.4, 13.4, 1.4, STEEL, bev=0)
    # Splinter fore-end and the lump under the breech.
    g.box(16, 30, 8, 11.4, 4.7, WOOD, bev=1.1, seg=2)
    g.box(15.4, 17, 8.2, 11.2, 4.3, STEEL, bev=0.4)
    g.box(28, 31, 7, 11, 3, STEEL, bev=0.4)
    g.part('barrel', '!optic=bead').ball(1.5, 15.5, 0.58, IVORY)
    g.part('barrel', 'optic=bead').ball(1.5, 15.5, 0.58, BRASS)
    g.part('barrel', 'muzzle=choke')
    for sx in (-1.75, 1.75):
        g.rod(-0.4, 2, B, 2.05, STEEL_HI, x=sx, seg=12).bore(-0.4, B, 1.05, x=sx)
    # Two shells for the reload: paper hulls on brass heads.
    for slugs in (False, True):
        g.part('mag', 'magazine=slugs' if slugs else '!magazine=slugs')
        for sx in (-1.75, 1.75):
            g.rod(23, 29, B, 1.3, SLUG if slugs else HULL, x=sx, seg=8).rod(29, 31, B, 1.5, BRASS, x=sx, seg=8)
    g.part('main')
    # Boxlock action: breech face, top lever, two hammers and a filed rear notch.
    g.box(31, 40.4, 8, 14, 4.9, STEEL, bev=0.8)
    g.box(31, 32.2, 8.6, 14.4, 5.6, STEEL_HI, bev=0.4)
    g.rivets([34, 37], 10, 4.9)
    g.plate([(36, 13.9), (41, 13.9), (42, 14.4), (41.6, 14.9), (36, 14.7)], 1.1, STEEL_HI, bev=0.2)
    for sx in (-2.05, 2.05):
        g.plate([(38, 13.8), (40, 13.8), (41.4, 16.4), (40.6, 17), (39.2, 16.2), (38.2, 15)], 0.8, STEEL_HI, x=sx, bev=0.2)
    g.box(33, 35, 13.8, 15.1, 3, STEEL, bev=0.25).ears(33, 35, 15, 16)
    g.guard(33, 42.4, 3.8, 8.2, trigger=36)
    g.plate([(38.4, 8), (39.3, 8), (38.9, 4.9), (38.1, 4.7)], 0.8, BLACK, bev=0.15)
    g.part('main', 'stock=grip')
    g.plate([(40, 12.4), (40, 7.4), (43, 5.4), (46.6, 0.6), (49.2, 1.4), (48.6, 6.4), (45.4, 10.8)], 3.4, WOOD, bev=1.1, seg=2)
    g.plate([(46.2, 0), (49.8, 1.1), (49.4, 2), (45.9, 0.9)], 3.5, STEEL, bev=0.2)
    g.part('main', '!stock=grip')
    g.plate([(40, 7.8), (40, 13.2), (68, 11.8), (68, 1.3), (65.6, 1.3), (46.4, 6.8)], 3.5, WOOD, bev=1.1, seg=2)
    g.box(67.5, 68.7, 1.1, 12, 3.6, BLACK, bev=0.4)
    g.rivets([60], 6.4, 3.5)
    g.part('main')
    g.mark('muzzle', 0, B).mark('sight', 34, 16).mark('front', 1.5, 16).mark('eject', 32, B, 1)
    return g.finish()


def win1895():
    g = Gun('win1895', (71, 7))
    B = 12.5
    g.rod(0, 54, B, 1.0, STEEL).bore(0, B, 0.5)
    g.box(1, 4, 13.3, 14.1, 1.1, STEEL, bev=0.2).box(2, 3, 14, 15.4, 0.7, STEEL_HI, bev=0.15)
    g.ball(2.5, 15.5, 0.52, BRASS)
    g.box(16, 18.2, 8.8, 13.6, 3.4, STEEL, bev=0.4)
    g.box(18, 52, 9, 12.6, 3.3, WOOD, bev=1.0, seg=2)
    g.box(34, 36, 8.8, 13.6, 3.6, STEEL, bev=0.4)
    g.part('main', '!optic=scope')
    g.box(40, 43, 13.2, 14.2, 3, STEEL, bev=0.25).ears(41, 42.2, 14, 16)
    g.part('main')
    # Tall slab-sided receiver with the box magazine ahead of the lever.
    g.box(52, 68.4, 7, 14, 3.3, STEEL, bev=0.6)
    g.box(53, 67, 9, 9.8, 3.45, STEEL_HI, bev=0)
    g.rivets([56, 64], 11.4, 3.3)
    g.box(52, 61, 2, 7.4, 3.1, STEEL, bev=0.45)
    g.plate([(66.2, 13.6), (67.6, 13.6), (69.4, 14.2), (69, 15), (66.6, 14.9)], 0.9, STEEL_HI, bev=0.2)
    for carb in (False, True):
        g.part('main', 'stock=carbine' if carb else '!stock=carbine')
        e = 88 if carb else 96
        lo = 5.8 - (e - 76) * 0.2
        hi = 12 - (e - 76) * 0.02
        g.plate([(68, 5.2), (68, 12.4), (e, hi), (e, lo), (e - 2.4, lo), (76, 5.6)], 3.4, WOOD, bev=1.0, seg=2)
        g.plate([(e - 0.6, hi + 0.5), (e + 0.7, hi), (e + 0.3, (hi + lo) / 2), (e + 0.7, lo), (e - 0.6, lo - 0.5), (e - 0.2, (hi + lo) / 2)], 3.5, STEEL, bev=0.3)
        if carb:
            g.wire([(70 + math.cos(i / 8 * math.tau) * 1.3, 9 + math.sin(i / 8 * math.tau) * 1.3, 1.9) for i in range(9)], 0.25, STEEL_HI, sides=4)
        else:
            g.swivel(84, 3.4)
    g.part('bolt')
    g.box(54, 67.2, 13.4, 15, 1.5, STEEL_HI, bev=0.3).box(65, 67.2, 13.4, 14.9, 3, STEEL_HI, bev=0.3)
    # The finger lever: a loop under the wrist with the trigger inside it.
    g.pivot('lever', 62, 6).part('lever')
    g.wire([(62, 6.6), (61.5, 1.4), (62.4, 0.5), (70, 0.5), (71, 1.4), (70.8, 3.8), (69, 4.6)], 0.42, STEEL)
    g.plate([(63.2, 5.4), (64.1, 5.4), (63.9, 2.6), (63.2, 2.4)], 0.8, BLACK, bev=0.15)
    g.part('mag', '!magazine=box').box(53, 60, 1.2, 2.1, 3.2, STEEL_HI, bev=0.25)
    g.part('mag', 'magazine=box')
    g.box(52.2, 60.8, -5, 2, 3.0, BLACK, bev=0.5).box(52, 61, -5.6, -4.7, 3.2, STEEL_HI, bev=0.25)
    g.part('main')
    scope(g, 46, 70, 18.5)
    maxim(g, B)
    g.mark('muzzle', 0, B).mark('sight', 41.6, 16).mark('front', 2.5, 16).mark('eject', 60, 14, 1)
    return g.finish()


def chauchat():
    g = Gun('chauchat', (74, 8))
    B = 15.5
    # Conical flash hider, ringed barrel sleeve, tall blade front sight.
    g.lathe([(0, 2.5), (6, 1.3)], B, BLACK, seg=12)
    g.bore(0, B, 1.5)
    g.rod(6, 52, B, 1.95, STEEL, seg=12)
    for k in range(10, 24, 2):
        g.rod(k, k + 0.8, B, 2.55, STEEL_HI, seg=12)
    g.box(6, 52, 12.8, 13.7, 1.0, BLACK, bev=0.2)
    g.plate([(6, 17.2), (6.2, 22), (7.2, 22), (8.4, 17.2)], 0.8, STEEL_HI, bev=0.15)
    g.box(12, 14.2, 12, 14.4, 5, STEEL, bev=0.4)
    g.part('main', '!stock=bipod')
    for sx in (-2.1, 2.1):
        g.rod(12.6, 36, 12.4, 0.42, STEEL_HI, x=sx, seg=6)
    g.part('main', 'stock=bipod')
    for sx in (-1, 1):
        g.wire([(13, 12.6, sx * 2.1), (16.5, 3, sx * 4), (19.6, -6.4, sx * 5.6)], 0.45, STEEL_HI)
        g.box(18.6, 21, -7, -6.2, 1.8, STEEL, x=sx * 5.7, bev=0.2)
    g.part('main')
    # Front handle, slab receiver, pistol grip and the long butt.
    g.box(37, 43, 12.6, 14, 3, STEEL, bev=0.3)
    g.plate([(38, 13), (42, 13), (42.6, 6), (41.6, 5), (38.4, 5), (37.4, 6)], 3.2, WOOD, bev=1.0, seg=2)
    stripes(g, lambda j: (37.6, 42.4), (6.6, 8.2, 9.8, 11.4), 3.3, WOOD_D)
    g.box(52, 74, 10, 19, 4.7, STEEL, bev=0.7)
    g.box(52.2, 73.8, 14.2, 14.7, 4.82, STEEL_D, bev=0)
    g.box(51.6, 54, 9.2, 19.8, 5.2, STEEL_HI, bev=0.5)
    g.rivets([57, 70], 12, 4.7)
    g.plate([(71, 10.2), (77.6, 10.2), (79.8, 2.8), (78.8, 1.8), (76, 1.8), (74.8, 2.8)], 3.2, WOOD, bev=1.0, seg=2)
    g.guard(64.6, 72, 5.6, 10, trigger=67.6)
    g.plate([(74, 8), (74, 18.2), (100, 16.2), (100, 2.8), (97.6, 2.8)], 3.5, WOOD, bev=1.1, seg=2)
    g.box(99.5, 100.7, 2.6, 16.4, 3.6, STEEL, bev=0.35)
    g.swivel(88, 5.4)
    g.part('main', '!optic=reddot')
    g.box(66, 68, 18.8, 21.1, 3, STEEL_HI, bev=0.25).ears(66, 68, 21, 22)
    g.part('bolt')
    g.box(58, 64, 15.2, 16.8, 1.3, STEEL_HI, x=2.9, bev=0.25)
    g.ball(62.6, 16, 0.95, STEEL_HI, x=3.9)
    # The half-moon magazine sweeping forward as it drops, open on the left to show the rounds.
    for deep in (False, True):
        g.part('mag', 'magazine=30' if deep else '!magazine=30')
        r1 = 56 if deep else 52
        bottom = -9 if deep else -5

        def arc(r0, r1, lo, hi, n=7):
            pts = []
            for r, rev in ((r1, False), (r0, True)):
                a0 = math.acos(min(1, (30 - lo) / r))
                a1 = math.acos(min(1, (30 - hi) / r))
                seq = [a0 + (a1 - a0) * i / n for i in range(n + 1)]
                for a in (reversed(seq) if rev else seq):
                    pts.append((14 + r * math.sin(a), 30 - r * math.cos(a)))
            return pts
        g.plate(arc(46, r1, bottom, 10.4), 3, BLACK, bev=0.4)
        g.plate(arc(47.2, r1 - 1.2, bottom + 1.2, 9.6), 0.5, BRASS, x=-1.5, bev=0)
        for i in range(1, 6):
            jj = bottom + 1.2 + (9.6 - bottom - 1.2) * i / 6
            g.plate(arc(47.2, r1 - 1.2, jj, jj + 0.45, n=1), 0.5, STEEL_D, x=-1.62, bev=0)
    g.part('main')
    red_dot(g, 56, 65, 19)
    cutts(g, B)
    g.mark('muzzle', 0, B).mark('sight', 67, 22).mark('front', 6.7, 22).mark('eject', 60, 16, 1)
    return g.finish()


def flammen():
    g = Gun('flammen', (71, 7))
    B = 14.5
    # Brass nozzle with the pilot burner glowing under it.
    g.lathe([(0, 1.2), (0.6, 1.55), (4, 1.55), (4.2, 2.1), (5.2, 2.1)], B, BRASS, seg=12)
    g.bore(0, B, 0.8)
    g.rod(2, 12, 11.5, 0.9, COPPER, seg=8)
    g.ball(1.6, 11.5, 0.75, PILOT)
    g.box(2.6, 3.6, 11.4, 13.4, 0.9, COPPER, bev=0.2)
    # The long lance with heat rings, the fuel line beneath.
    g.rod(5, 60, B, 1.2, STEEL)
    for k in range(10, 56, 8):
        g.rod(k, k + 1, B, 1.95, STEEL_HI, seg=12)
    g.rod(12, 60, 11.5, 0.62, BLACK, seg=6)
    g.plate([(5.2, 15.4), (5.4, 19), (6.2, 19), (7.4, 15.4)], 0.8, STEEL_HI, bev=0.15)
    g.box(27, 33, 12.4, 13.6, 3, STEEL, bev=0.3)
    g.plate([(28, 13), (32, 13), (32.6, 5), (31.6, 4), (28.4, 4), (27.4, 5)], 3.2, WOOD, bev=1.0, seg=2)
    stripes(g, lambda j: (27.6, 32.4), (5.6, 7.2, 8.8, 10.4), 3.3, WOOD_D)
    # Valve block with a gauge on the left and the valve wheel on the right.
    g.box(58, 68, 10, 18, 5, BRASS, bev=0.8)
    for k in (58, 67):
        g.box(k - 0.2, k + 1.2, 9.8, 18.2, 5.3, COPPER, bev=0.4)
    g.ears(59, 60.2, 17.9, 19)
    g.disc(63, 14, 2.6, 1.2, STEEL, x=-3, seg=12).disc(63, 14, 2.1, 0.3, GAUGE, x=-3.65, seg=12)
    g.plate([(62.7, 14), (63.3, 14), (64.4, 15.6)], 0.2, BLACK, x=-3.85, bev=0)
    g.disc(63, 14, 0.5, 2.2, STEEL_HI, x=3.4, seg=6)
    g.wire([(63 + math.cos(i / 10 * math.tau) * 2.4, 14 + math.sin(i / 10 * math.tau) * 2.4, 4.4) for i in range(11)], 0.4, STEEL_HI, sides=4)
    for a in (0.4, 0.4 + math.pi / 2):
        g.wire([(63 - math.cos(a) * 2.4, 14 - math.sin(a) * 2.4, 4.4), (63 + math.cos(a) * 2.4, 14 + math.sin(a) * 2.4, 4.4)], 0.25, STEEL_HI, sides=4)
    # Rear grip, trigger lever, and the armoured hose curling back to the tank.
    g.plate([(68, 10.2), (74.6, 10.2), (76.8, 1.8), (75.8, 0.8), (73, 0.8), (71.8, 1.8)], 3.2, WOOD, bev=1.0, seg=2)
    g.guard(62.6, 68.4, 5.6, 10, trigger=64.8)
    hose = [(67, 13), (71, 12.6), (75, 10.4), (79, 7), (82, 3.4), (84, 0.4)]
    g.wire(hose, 1.35, LEATHER, sides=7)
    for a, b in zip(hose[1:-1], hose[2:]):
        g.wire([a, (a[0] + (b[0] - a[0]) * 0.22, a[1] + (b[1] - a[1]) * 0.22)], 1.55, BLACK, sides=7)
    # The pressure bottle under the lance (the reload swaps it).
    g.part('mag')
    g.lathe([(36, 0.9), (38, 1.2), (38.4, 1.9), (39.4, 2.4), (55, 2.4), (56, 1.8), (56.3, 0.6)], 8.5, PARK, seg=12)
    g.rod(35.6, 36.6, 8.5, 1.25, BRASS, seg=8)
    for k in (42, 52):
        g.rod(k, k + 1, 8.5, 2.65, STEEL_HI, seg=12)
    g.part('main')
    g.mark('muzzle', 0, B).mark('sight', 59.6, 19).mark('front', 5.8, 19).mark('eject', 60, B, 1)
    return g.finish()


def xray():
    g = Gun('xray', (25, 5))
    B = 12.5
    # Flared emitter dish, the core glowing in its bowl and a white-hot needle ahead.
    g.lathe([(3, 0.01), (2.8, 2), (1.6, 3.6), (0.3, 4.7), (0, 5.3), (1.5, 4.7), (3, 3.3), (4, 1.6)], B, BRASS, seg=14)
    g.ball(2.4, B, 1.9, XCORE)
    g.lathe([(-2.4, 0.05), (-1, 0.5), (2, 0.5)], B, XHOT, seg=6)
    g.ball(0.5, 18.4, 0.6, XHOT)
    g.box(0.1, 0.9, 17, 18, 0.5, BRASS, bev=0)
    # Barrel under polished cooling fins.
    g.rod(4, 14, B, 1.5, COPPER)
    for k in (5, 7, 9, 11):
        g.rod(k, k + 0.7, B, 3.3, BRASS, seg=12)
    g.rod(13, 14.2, B, 3.7, COPPER, seg=12)
    # The body: an art-deco teardrop banded in copper, with a keel fin.
    prof = [3.1, 3.6, 4, 4.2, 4.2, 4.2, 4.2, 4.2, 4.1, 3.9, 3.6, 3.2, 2.7, 2.2]
    g.lathe([(14 + n, r) for n, r in enumerate(prof)] + [(28, 1.6)], B, BRASS, seg=14, sx=0.82)
    for k, r in ((15, 4.0), (24, 3.95)):
        g.rod(k, k + 0.9, B, r, COPPER, seg=14, sx=0.84)
    g.plate([(13, 9.4), (18.4, 9), (18, 6), (13, 7.6)], 1.1, BRASS, bev=0.25)
    for sx in (-1, 1):
        g.box(17, 23, 11, 14, 0.5, XGLASS, x=sx * 3.3, bev=0.2)
        g.box(17.4, 22.6, 12.1, 12.9, 0.5, XCORE, x=sx * 3.42, bev=0)
    # Vacuum tubes on the shoulders.
    for sx in (-2.5, 2.5):
        g.vcyl(19, 15, 16.2, 1.15, COPPER, x=sx, seg=8)
        g.vcyl(19, 16.2, 18.2, 0.95, XCORE, x=sx, seg=8)
        g.vcyl(19, 18.2, 20.2, 0.95, XGLASS, x=sx, seg=8, r1=0.7)
        g.vcyl(19, 20.2, 21, 0.75, BRASS, x=sx, seg=8, r1=0.4)
    # Tail cap with a charge ring, and the rear sight.
    g.rod(27.6, 28.3, B, 1.85, XCORE, seg=10)
    g.rod(28.3, 29.4, B, 1.5, BRASS, seg=10)
    g.box(25, 27, 15.4, 18.1, 3, BRASS, bev=0.3).ears(25, 27, 18, 19, BRASS)
    g.guard(15, 23.4, 4, 8.8, BRASS, trigger=18.6)
    # Raked bakelite grip with finger grooves, a brass medallion and butt cap.
    g.plate([(21, 9.8), (26.2, 9.8), (29.4, 1), (24.4, 1)], 4.3, BAKELITE, bev=1.1, seg=2)
    stripes(g, lambda j: (21 + (9.8 - j) * 0.37, 26.2 + (9.8 - j) * 0.37), (3.2, 6.2), 4.4, VULCAN)
    g.rivets([25], 5, 4.3, BRASS, r=0.75)
    g.plate([(24.2, 1.1), (29.6, 1.1), (29.9, 0.1), (24.6, 0.1)], 4.5, BRASS, bev=0.3)
    # The charge capsule on the left flank (the reload swaps it out).
    g.part('mag')
    g.rod(15, 22, 7.5, 1.35, XGLASS, x=-4.6, seg=8)
    g.rod(14.6, 22.4, 7.5, 0.6, XCORE, x=-4.6, seg=6)
    for k in (14.4, 18, 21.8):
        g.box(k, k + 0.9, 5.8, 9.2, 3.6, BRASS, x=-3.9, bev=0.25)
    g.part('main')
    g.mark('muzzle', -2, B).mark('sight', 26, 19).mark('front', 0.5, 19).mark('eject', 18, 12, 1)
    return g.finish()


def granatwerfer():
    g = Gun('granatwerfer', (64, 7))
    B = 18.5
    # A fat rifled tube with a flared muzzle ring.
    g.lathe([(0.8, 3.2), (0, 3.4), (0, 5.4), (3, 5.4), (3.4, 4.4), (52, 4.4)], B, BLACK, seg=16)
    g.rod(0.7, 1.2, B, 3.3, PARK, seg=12)
    g.rod(-0.1, 3.1, B, 5.45, STEEL_HI, seg=16)
    g.rod(-0.16, 0.4, B, 3.5, HOLE, seg=12)
    for k in (12, 26, 40):
        g.rod(k, k + 2, B, 4.9, STEEL, seg=16)
    g.box(50, 60, 13, 24, 8.6, STEEL, bev=1.0)
    g.box(49.6, 51.2, 12.6, 24.4, 9, STEEL_HI, bev=0.5)
    # Front post and the folding ladder sight over the breech.
    g.box(4, 5, 23.4, 25, 0.9, STEEL_HI, bev=0.15)
    g.ears(52, 54, 23.8, 28, gap=2.2, w=0.8)
    g.box(52.2, 53.8, 25, 25.8, 3.8, STEEL_HI, bev=0.15)
    # Cradle, front grip, pistol grip and the padded shoulder stock.
    g.box(18, 50, 12, 14.4, 5, STEEL, bev=0.5)
    g.plate([(26, 12.4), (31.4, 12.4), (32, 3), (31, 2), (26.4, 2), (25.4, 3)], 3.8, WOOD, bev=1.1, seg=2)
    stripes(g, lambda j: (25.6, 31.8), (4, 6, 8, 10), 3.9, WOOD_D)
    g.guard(55.6, 63.6, 5.4, 9.6, trigger=58.8)
    g.plate([(62, 10.4), (68.4, 10.4), (72, 0.8), (71, 0), (66.6, 0), (65.6, 1)], 3.9, WOOD_D, bev=1.1, seg=2)
    g.plate([(60, 10), (60, 20.2), (90, 20.2), (90, 7.6), (87.6, 7.6)], 4.7, WOOD, bev=1.1, seg=2)
    g.box(87.6, 92.4, 6.8, 21.2, 5.7, LEATHER, bev=1.4, seg=2)
    g.box(70, 72, 8.6, 20.4, 4.95, BRASS, bev=0.3)
    # The drum: four fat shells round a steel hub, swapped on the reload.
    g.part('mag')
    g.rod(38, 50, 8.5, 5.2, STEEL_D, seg=14)
    for k in (37.8, 49):
        g.rod(k, k + 1.2, 8.5, 5.5, STEEL_HI, seg=14)
    for sx in (-2.4, 2.4):
        for dj in (-2.4, 2.4):
            g.lathe([(35.8, 0.4), (36.6, 1.5), (38, 1.7)], 8.5 + dj, BRASS, x=sx, seg=8)
    g.part('main')
    g.mark('muzzle', 0, B).mark('sight', 53, 28).mark('front', 4.5, 25).mark('eject', 52, B, 1)
    return g.finish()


def wunder():
    g = Gun('wunder', (61, 6))
    B = 12.5
    # Electrode fork: a brass yoke, two copper prongs with glowing tips and a spark between.
    g.box(3, 6, 7.6, 17.4, 3.2, BRASS, bev=0.6)
    for j0, j1, tip in ((14.6, 17.2, 16), (7.8, 10.4, 9)):
        g.plate([(0, tip - 0.5), (0, tip + 0.5), (3.2, j1), (3.2, j0)], 1.3, COPPER, bev=0.3)
        g.ball(0.1, tip, 0.8, ARC_HOT)
    g.lathe([(0.6, 0.2), (1.6, 0.8), (3, 0.8)], B, ARC, seg=6)
    g.box(4, 5, 17.2, 20, 0.8, STEEL_HI, bev=0.15)
    # Barrel, its core glowing between copper Tesla coils that flare toward the fork.
    g.rod(5, 36, B, 1.25, BLACK)
    for n, k in enumerate((8, 13, 18, 23, 28)):
        r = 3.9 - n * 0.25
        g.lathe([(k, r - 0.5), (k + 0.5, r), (k + 1.5, r), (k + 2, r - 0.5)], B, COIL, seg=12)
        g.rod(k + 2.1, k + 3, B, 1.6, ARC, seg=8)
    g.lathe([(33, 2.2), (33.6, 2.7), (36, 2.7)], B, IVORY, seg=12)
    g.rod(34.2, 35.2, B, 3.2, BRASS, seg=12)
    # Receiver: brass over a dark steel belly, steel top plate, a wide U rear sight.
    g.box(36, 58, 9.6, 16, 6.3, BRASS, bev=0.9)
    g.box(36.4, 57.6, 7, 10, 6, BLACK, bev=0.6)
    g.box(36.6, 57.4, 15.7, 16.4, 4.4, STEEL, bev=0.2)
    for k in (38, 56):
        g.box(k, k + 1, 6.8, 16.2, 6.6, COPPER, bev=0.3)
    g.ears(54, 56, 16.2, 20, gap=3.4, w=0.9)
    # Capacitor tubes along both flanks with brass caps and copper clamps.
    for sx in (-3.9, 3.9):
        g.rod(40, 54, 13.4, 1.45, ARC, x=sx, seg=8)
        g.rod(39, 40.2, 13.4, 1.75, BRASS, x=sx, seg=8).rod(53.8, 55, 13.4, 1.75, BRASS, x=sx, seg=8)
        for k in (44, 49):
            g.rod(k, k + 0.9, 13.4, 1.7, COIL, x=sx, seg=8)
    g.guard(53.6, 61.6, 4.4, 7.4, BRASS, trigger=56.6)
    g.plate([(58, 8.4), (63.4, 8.4), (66.6, 0.8), (65.6, 0), (62, 0), (61, 1)], 3.3, WOOD_D, bev=1.0, seg=2)
    g.box(57.6, 62.4, 8, 15.2, 3.2, BLACK, bev=0.5)
    g.plate([(62, 7), (62, 15.2), (94, 15.2), (94, 2.2), (91.6, 2.2)], 3.4, WOOD_D, bev=1.1, seg=2)
    g.box(93.5, 94.7, 2, 15.4, 3.5, BRASS, bev=0.35)
    g.box(70, 72, 5.4, 15.4, 3.6, COPPER, bev=0.3)
    # The swappable cell: dark steel with glowing windows on both sides.
    g.part('mag')
    g.box(42, 51, 2, 7.2, 5, BLACK, bev=0.6)
    g.box(43.2, 49.8, 3.2, 6, 5.25, ARC, bev=0.3)
    g.box(41.8, 51.2, 1.4, 2.4, 5.2, BRASS, bev=0.3)
    g.part('main')
    g.mark('muzzle', 0, B).mark('sight', 55, 20).mark('front', 4.5, 20).mark('eject', 44, 15, 1)
    return g.finish()


# ---------------------------------------------------------------- viewmodel bits and the grenade

def vm_glove():
    """The one hand: a leather mitt wrapped round the grip with a khaki cuff. Origin at its centre."""
    g = Gun('vm-glove')
    g.box(-3, 3.2, -1.6, 4.2, 5.2, GLOVE, bev=1.5, seg=2)
    for n in range(4):
        j = -1.2 + n * 1.4
        g.rod(-3.9, -1.2, j + 0.6, 0.86, GLOVE, seg=8, sx=3.0)
    g.box(-0.6, 3.4, 2.6, 4.5, 5.4, GLOVE_D, bev=0.8, seg=2)
    g.plate([(-2.6, 3.4), (-0.4, 4.6), (0.6, 3.6), (-1.6, 2.4)], 1.6, GLOVE_D, x=-2.6, bev=0.6, seg=2)
    g.box(-2.7, 3.1, -4.2, -1.4, 5.6, KHAKI, bev=0.7, seg=2)
    g.box(-2.9, 3.3, -2, -1.3, 5.9, GLOVE_D, bev=0.3)
    return g.finish()


def vm_knife():
    """A trench knife, blade up. Origin at the middle of the handle."""
    g = Gun('vm-knife')
    g.plate([(-1, 3.2), (1, 3.2), (1, 12.6), (0.2, 16.4), (-1, 14.6)], 0.55, BLADE, bev=0.22)
    g.plate([(-0.25, 3.6), (0.15, 3.6), (0.15, 12.2), (-0.25, 12.2)], 0.62, STEEL_HI, bev=0)
    g.box(-1.9, 1.9, 2.5, 3.3, 1.3, BRASS, bev=0.3)
    g.vcyl(0, -2.4, 2.5, 1.05, WOOD_D, seg=8, r1=0.95)
    for j in (-1.4, -0.2, 1):
        g.vcyl(0, j, j + 0.4, 1.16, VULCAN, seg=8)
    g.vcyl(0, -2.9, -2.3, 1.2, BRASS, seg=8)
    return g.finish()


def vm_case(name, length, r, neck=0.0, tip=None, body=None, head=None):
    """A spent case standing on its head, centred on the origin. Sizes in millimetres."""
    g = Gun(name)
    c = 1 / 11
    h = length * c / 2
    prof = [(-h, r * c * 1.12), (-h + 0.14, r * c * 1.12), (-h + 0.16, r * c)]
    if neck:
        prof += [(h * 0.45, r * c), (h * 0.62, neck * c), (h, neck * c)]
    else:
        prof += [(h, r * c)]
    rings = []
    bm = bmesh.new()
    seg = 8
    for j, rr in prof:
        rings.append([bm.verts.new(g.P(0, j) + Vector((math.cos(i / seg * math.tau) * rr * S, math.sin(i / seg * math.tau) * rr * S, 0))) for i in range(seg)])
    g._rings(bm, rings)
    g._add(bm, body or CASE)
    g.vcyl(0, -h - 0.02, -h + 0.15, r * c * 1.14, head or CASE_D, seg=seg)
    if tip:
        g.vcyl(0, h - 0.12, h + 0.02, (neck or r) * c * 1.04, tip, seg=seg)
    return g.finish()


def vm_flash():
    """The muzzle flash in three pieces, each about one unit big: a star facing the eye, a tongue ahead (-z) and side prongs."""
    def piece(name, tris_by_mat):
        root = empty(name, None, (_slot[0] * 1.6, 0, 0))
        _slot[0] += 1
        for material, polys in tris_by_mat:
            bm = bmesh.new()
            for poly in polys:
                bm.faces.new([bm.verts.new(Vector((x, -z, y))) for x, y, z in poly])
            me = bpy.data.meshes.new('m')
            bm.to_mesh(me)
            bm.free()
            me.materials.append(material)
            o = bpy.data.objects.new('m', me)
            SCENE.collection.objects.link(o)
            o.parent = root

    def star(n, r_out, r_in, rot=0.0, z=0.0, long=None):
        pts = []
        for i in range(n * 2):
            a = rot + i / (n * 2) * math.tau
            r = r_in if i % 2 else (r_out * (long[(i // 2) % len(long)] if long else 1))
            pts.append((math.cos(a) * r, math.sin(a) * r, z))
        return [[(0, 0, z), pts[i], pts[(i + 1) % len(pts)]] for i in range(len(pts))]

    piece('vm-flash-star', [(FLASH_WARM, star(8, 0.5, 0.17, long=[1, 0.62])), (FLASH_HOT, star(8, 0.27, 0.13, rot=math.tau / 16, z=0.01))])
    # The tongue: a pointed flame, hot at the root.
    tongue = []
    hot = []
    prof = [(0.0, 0.07), (-0.22, 0.3), (-0.5, 0.22), (-1.0, 0.0)]
    seg = 6
    for (z0, r0), (z1, r1) in zip(prof, prof[1:]):
        for i in range(seg):
            a0 = i / seg * math.tau
            a1 = (i + 1) / seg * math.tau
            quad = [(math.cos(a0) * r0, math.sin(a0) * r0, z0), (math.cos(a1) * r0, math.sin(a1) * r0, z0), (math.cos(a1) * r1, math.sin(a1) * r1, z1), (math.cos(a0) * r1, math.sin(a0) * r1, z1)]
            (hot if z0 == 0.0 else tongue).append(quad if r1 > 0 else quad[:3])
    piece('vm-flash-cone', [(FLASH_HOT, hot), (FLASH_WARM, tongue)])
    # Four blades splaying sideways and a little forward.
    blades = []
    for i in range(4):
        a = i / 4 * math.tau
        c, s = math.cos(a), math.sin(a)
        px, py = -s, c
        blades.append([(c * 0.13, s * 0.13, -0.05), (c * 0.3 + px * 0.07, s * 0.3 + py * 0.07, -0.14), (c * 0.5, s * 0.5, -0.24), (c * 0.3 - px * 0.07, s * 0.3 - py * 0.07, -0.14)])
    piece('vm-flash-prongs', [(FLASH_WARM, blades)])


def proj_stick():
    """A stick grenade standing up, origin where the head meets the handle (sized like the old one: 22 by 7 cm)."""
    g = Gun('proj-stick')
    c = 1 / 0.011
    g.vcyl(0, 0, 0.112 * c, 0.036 * c, OLIVE, seg=12)
    g.vcyl(0, 0.104 * c, 0.116 * c, 0.031 * c, BLACK, seg=12)
    g.vcyl(0, -0.014 * c, 0.004 * c, 0.03 * c, BLACK, seg=12)
    g.vcyl(0, -0.18 * c, -0.01 * c, 0.012 * c, WOOD, seg=8)
    g.vcyl(0, -0.196 * c, -0.176 * c, 0.016 * c, BLACK, seg=8)
    return g.finish()


GUNS = [m1911, c96, m1897, kar98k, thompson, mp18, ppsh, bar, lewis, webley, sawnoff, win1895, chauchat, flammen, xray, granatwerfer, wunder]

a = args()
only = a[a.index('--only') + 1].split(',') if '--only' in a else None
for fn in GUNS:
    if only is None or fn.__name__ in only:
        fn()
if only is None or 'vm' in only:
    vm_glove()
    vm_knife()
    vm_case('vm-case-pistol', 26, 5.8)
    vm_case('vm-case-revolver', 23, 7.4, tip=mat('case-lead', 0x8a8e94))
    vm_case('vm-case-rifle', 46, 6.0, neck=4.0, tip=CASE_L)
    vm_case('vm-case-hull', 50, 9.6, body=HULL, head=mat('hull-brass', 0xc9a046))
    vm_flash()
    proj_stick()

# Triangle report per model.
bpy.context.view_layer.update()
total = 0
for o in [o for o in bpy.data.objects if o.parent is None]:
    tris = sum(sum(len(p.vertices) - 2 for p in c.data.polygons) for c in o.children_recursive if c.type == 'MESH')
    total += tris
    print(f'[weapons] {o.name}: {tris} tris')
print(f'[weapons] total {total} tris')

if '--preview' in a:
    # One gun (or a few) from the side, with the chosen attachment words fitted (`--with scope,trench`).
    fitted = set(a[a.index('--with') + 1].split(',')) if '--with' in a else set()

    def holds(term):
        neg = term.startswith('!')
        term = term.lstrip('!')
        on = term == 'pap' and 'pap' in fitted or ('=' in term and term.split('=')[1] in fitted)
        return on != neg

    az = float(a[a.index('--az') + 1]) if '--az' in a else 68
    el = float(a[a.index('--el') + 1]) if '--el' in a else 12
    out = a[a.index('--preview') + 1]
    roots = [o for o in bpy.data.objects if o.parent is None]
    for o in roots:
        for me in o.children_recursive:
            me.hide_render = True
    fp = 'hip' if '--hip' in a else 'ads' if '--ads' in a else None
    for o in roots:
        objs = []
        marks = {}
        for grp in o.children:
            if grp.name.startswith(f'{o.name}-m-'):
                c = grp.name.split('@')[1] if '@' in grp.name else ''
                if not c or all(holds(t) for t in c.split('&')):
                    key = grp.name[len(o.name) + 3:].split('@')[0]
                    if key not in marks or c:
                        marks[key] = grp.matrix_world.translation.copy()
        for grp in o.children:
            c = grp.name.split('@')[1] if '@' in grp.name else ''
            if not c or all(holds(t) for t in c.split('&')):
                objs.extend(me for me in grp.children_recursive if me.type == 'MESH')
        objs.extend(me for me in o.children if me.type == 'MESH')
        for me in objs:
            me.hide_render = False
        name = out if len(roots) == 1 else out.replace('.png', f'-{o.name}.png')
        if fp and 'sight' in marks:
            # The player's eye: at the hip the gun hangs low right, aiming it sits on the sight line.
            rear = marks.get('dot1', marks.get('scope1', marks['sight']))
            front = marks.get('dot0', marks.get('scope0', marks['front']))
            if fp == 'ads':
                eye = rear + (rear - front).normalized() * 0.3
                aim = front - rear
            else:
                at = o.matrix_world.translation
                pistol = (marks['sight'] - marks['front']).length < 0.3
                eye = Vector((at.x - 0.135, at.y - (0.4 if pistol else 0.3), rear.z + (0.062 if pistol else 0.072)))
                aim = Vector((-0.06, 1, 0))
            SCENE.render.engine = 'BLENDER_WORKBENCH'
            SCENE.render.resolution_x, SCENE.render.resolution_y = 1280, 720
            SCENE.display.shading.light = 'STUDIO'
            SCENE.display.shading.color_type = 'MATERIAL'
            SCENE.display.shading.show_cavity = True
            SCENE.display.shading.show_object_outline = True
            cd = bpy.data.cameras.new('fp')
            cd.sensor_fit = 'VERTICAL'
            cd.angle = math.radians(54)
            cd.clip_start = 0.01
            cam = bpy.data.objects.new('fp', cd)
            SCENE.collection.objects.link(cam)
            cam.location = eye
            cam.rotation_euler = aim.to_track_quat('-Z', 'Z').to_euler()
            SCENE.camera = cam
            SCENE.render.filepath = name
            bpy.ops.render.render(write_still=True)
            bpy.data.objects.remove(cam, do_unlink=True)
            for me in objs:
                me.hide_render = True
            continue
        pts = [me.matrix_world @ Vector(c) for me in objs for c in me.bound_box]
        span = max((max(p[i] for p in pts) - min(p[i] for p in pts)) for i in range(3))
        render_preview(name, objects=objs, size=(1400, 700), azimuth=az, elevation=el, distance=span * 1.75)
        for me in objs:
            me.hide_render = True
else:
    export_pack('weapons')
