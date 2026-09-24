// Holdfast — geometry for every model in the game, in a clean low-poly
// "stylised realism" look: coursed stone, half-timbering, tiled and slated
// roofs with overhangs, props, and natural foliage. Everything is assembled
// from simple primitives with baked vertex colours (plus a little tonal
// variation and a darkening where walls meet the ground) and merged into one
// BufferGeometry per model so the renderer can instance it. Team-coloured parts
// (tabards, hoods, emblems, flags, siege cloth) are baked WHITE and kept as
// separate geometries so `instanceColor` can tint them per instance.
//
// Conventions: 1 unit = 1 tile, Y up, ground at y = 0. Every part is
// non-indexed with `position`, `normal` and `color` (linear) and no `uv`, so
// merges never fail. Geometries are cached and returned by reference. All
// variation is seeded, so a model always rebuilds identically.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { BUILDINGS } from '#shared/utils/holdfast/config'
import type { BuildingKind } from '#shared/utils/holdfast/config'

// ─── Palette (sRGB hex; THREE.Color converts to linear) ─────────────────────

const P = {
    white: 0xffffff,
    offWhite: 0xd4d4d4,
    shade: 0xc4c4c4,
    dark: 0x221d1a,
    glass: 0x2d333d,
    glassLit: 0xd9a04e,
    lantern: 0xf2c46a,
    ember: 0xe07a3a,
    cream: 0xe8e0cf,

    stoneLight: 0xd4cab8,
    stone: 0xc2b8a5,
    stoneMid: 0xafa493,
    stoneDark: 0x958b7c,
    stoneDeep: 0x756c61,
    paving: 0xa9a192,
    pavingLight: 0xbab2a3,
    pavingDark: 0x8d8578,
    fort: 0xaeacae,
    fortLight: 0xc0bec0,
    fortDark: 0x8e8c91,
    walkway: 0xc9bca4,
    fortTrim: 0x5a5470,

    plaster: 0xe4d9c2,
    beam: 0x4d3828,
    woodLight: 0xa27d56,
    wood: 0x876441,
    woodDark: 0x664b34,
    woodDeep: 0x47352a,
    plank: 0xab8a61,
    cut: 0xd5b68b,
    rope: 0xc2aa7d,
    cloth: 0xd6c9a8,
    canvas: 0xc8b995,
    quiver: 0x8c6c4e,

    tile: 0xa85e43,
    tileDark: 0x8c4b36,
    tileLight: 0xba6e50,
    slate: 0x5e6776,
    slateDark: 0x4c5463,
    slateLight: 0x6f7989,
    teamRoof: 0x506889,
    teamRoofDark: 0x405574,
    teamRoofLight: 0x5e789a,
    shingle: 0x74614d,
    shingleDark: 0x5f4f3f,
    shingleLight: 0x87735b,
    thatch: 0xbba368,
    thatchDark: 0x9e8651,
    thatchLight: 0xcbb379,

    banner: 0x40608f,
    ochre: 0xc79c48,

    gold: 0xe8ba48,
    goldDeep: 0xc19030,
    steel: 0xb0b7c0,
    steelDark: 0x7f8691,
    iron: 0x404349,
    brass: 0xb4914c,

    dirt: 0x9a7f60,
    dirtLight: 0xab9171,
    dirtDark: 0x7e674c,
    sand: 0xbfa87f,
    crystalGround: 0x5e5a6c,

    skin: 0xdcae8e,
    skinShade: 0xc99a7a,
    hair: 0x4a3526,
    boot: 0x3b2c21,
    hose: 0x574b3f,
    belt: 0x4e3424,
    leather: 0x70503a,
    glove: 0x5b412e,
    mail: 0x9ca2aa,
    bowString: 0xe6dcc6,
    fletch: 0xe8e1d2,

    leafA: 0x5a7c35,
    leafB: 0x4a6a2e,
    leafC: 0x6b8b3f,
    leafD: 0x809a48,
    leafE: 0x97963f,
    pineA: 0x34513a,
    pineB: 0x3e6041,
    pineC: 0x4b6f48,
    trunk: 0x5e4633,
    trunkDark: 0x47362a,
    birch: 0xd9d3c4,
    grass: 0x6a8c3c,
    grassDark: 0x557435,
    grassLight: 0x85a24b,
    fern: 0x4f7a37,
    stem: 0x557a3a,
    petal: 0xffffff,
    petalCore: 0xe6bf4a,
    mushCap: 0xa8493a,
    mushStem: 0xe3d9c3,
    moss: 0x62793a,

    rock: 0x918e88,
    rockLight: 0xa8a59e,
    rockDark: 0x77746e,
    rockWarm: 0x9c9080,
    rockWarm2: 0x84796b,

    crystalCyan: 0x5fe0f5,
    crystalViolet: 0xa47ef0,
    crystalPink: 0xe890d8,
    crystalRock: 0x57526b,
    crystalRockDark: 0x454157,
    rune: 0x7ae6ff,

    straw: 0xcdb26c,
    strawDark: 0xaf9450,
    targetRed: 0x9e3c31,
    targetWhite: 0xe6dcc6,

    // Legacy wall/gate colours (walls and gates are drawn by wall-kit.ts).
    roofRed: 0xa85e43,
    roofSlate: 0x5e6776
} as const

type Tones = readonly [number, number, number]

const STONE: Tones = [P.stone, P.stoneMid, P.stoneLight]
const FORT: Tones = [P.fort, P.fortDark, P.fortLight]
const TILE: Tones = [P.tile, P.tileDark, P.tileLight]
const SLATE: Tones = [P.slate, P.slateDark, P.slateLight]
const TEAM_ROOF: Tones = [P.teamRoof, P.teamRoofDark, P.teamRoofLight]
const SHINGLE: Tones = [P.shingle, P.shingleDark, P.shingleLight]
const THATCH: Tones = [P.thatch, P.thatchDark, P.thatchLight]
const LOGS: Tones = [P.wood, P.woodDark, P.woodLight]
const PINES: Tones = [P.pineA, P.pineB, P.pineC]
const GRASS: Tones = [P.grass, P.grassDark, P.grassLight]

const SIGNS = [-1, 1] as const
const TAU = Math.PI * 2

// ─── Seeded randomness (geometry only; never gameplay) ──────────────────────

let seed = 1

function rand(): number {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const jit = (a: number): number => (rand() * 2 - 1) * a

// ─── Low-level geometry helpers ─────────────────────────────────────────────

type Vec = THREE.Vector3
type Tri3 = [Vec, Vec, Vec]
type Quad4 = [Vec, Vec, Vec, Vec]
type Scale3 = readonly [number, number, number]
type Pt = readonly [number, number]
type V3 = readonly [number, number, number]

const v3 = (x: number, y: number, z: number): Vec => new THREE.Vector3(x, y, z)

function pick<T>(arr: readonly [T, ...T[]], i: number): T {
    return arr[Math.min(Math.max(Math.round(i), 0), arr.length - 1)] ?? arr[0]
}

/** Cyclic lookup. */
function at<T>(arr: readonly T[], i: number): T {
    const v = arr[((Math.round(i) % arr.length) + arr.length) % arr.length]
    if (v === undefined) throw new Error('holdfast models: empty list')
    return v
}

/** Loose triangles with explicit normals; winding is flipped to face outward. */
class Tris {
    private readonly pos: number[] = []
    private readonly nor: number[] = []

    /** `n` are per-vertex normals; without them the flat face normal is used, oriented along `hint`. */
    tri(a: Vec, b: Vec, c: Vec, n?: Tri3, hint?: Vec): void {
        const face = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
        const ref = hint ?? (n ? n[0].clone().add(n[1]).add(n[2]) : face)
        if (face.dot(ref) < 0) {
            face.negate()
            this.push(a, c, b, n ? [n[0], n[2], n[1]] : undefined, face)
        } else {
            this.push(a, b, c, n, face)
        }
    }

    quad(a: Vec, b: Vec, c: Vec, d: Vec, n?: Quad4, hint?: Vec): void {
        this.tri(a, b, c, n ? [n[0], n[1], n[2]] : undefined, hint)
        this.tri(a, c, d, n ? [n[0], n[2], n[3]] : undefined, hint)
    }

    geometry(): THREE.BufferGeometry {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
        g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
        return g
    }

    private push(a: Vec, b: Vec, c: Vec, n: Tri3 | undefined, face: Vec): void {
        const f = face.lengthSq() > 0 ? face.clone().normalize() : v3(0, 1, 0)
        this.vertex(a, n ? n[0] : f)
        this.vertex(b, n ? n[1] : f)
        this.vertex(c, n ? n[2] : f)
    }

    private vertex(p: Vec, n: Vec): void {
        this.pos.push(p.x, p.y, p.z)
        this.nor.push(n.x, n.y, n.z)
    }
}

function vecAxes(a: number, va: number, b: number, vb: number, c: number, vc: number): Vec {
    const v = new THREE.Vector3()
    v.setComponent(a, va)
    v.setComponent(b, vb)
    v.setComponent(c, vc)
    return v
}

/**
 * A soft box: a box with one chamfer ring whose normals blend between the
 * neighbouring faces, so it shades like a rounded box at 44 triangles instead
 * of RoundedBoxGeometry's 108. `open` drops the (hidden) bottom and runs the
 * sides straight down to the base, for parts that sit on something.
 */
function softBox(w: number, h: number, d: number, r: number, open: boolean): THREE.BufferGeometry {
    const half = v3(w / 2, h / 2, d / 2)
    const b = Math.min(r, w * 0.45, h * 0.45, d * 0.45)
    const inner = half.clone().subScalar(b)
    const hc = (i: number) => half.getComponent(i)
    const ic = (i: number, s: number) => (open && i === 1 && s < 0 ? -hc(1) : s * inner.getComponent(i))
    const normal = (i: number, s: number) => vecAxes(i, s, (i + 1) % 3, 0, (i + 2) % 3, 0)
    const isBottom = (i: number, s: number) => open && i === 1 && s < 0
    const t = new Tris()

    for (let a = 0; a < 3; a++) {
        const u = (a + 1) % 3
        const w2 = (a + 2) % 3
        for (const s of SIGNS) {
            if (isBottom(a, s)) continue
            const n = normal(a, s)
            const p = (su: number, sw: number) => vecAxes(a, s * hc(a), u, ic(u, su), w2, ic(w2, sw))
            t.quad(p(-1, -1), p(1, -1), p(1, 1), p(-1, 1), [n, n, n, n])
        }
    }
    for (let a = 0; a < 3; a++) {
        for (let c = a + 1; c < 3; c++) {
            const e = 3 - a - c
            for (const sa of SIGNS) {
                for (const sc of SIGNS) {
                    if (isBottom(a, sa) || isBottom(c, sc)) continue
                    const na = normal(a, sa)
                    const nc = normal(c, sc)
                    const p1 = (se: number) => vecAxes(a, sa * hc(a), c, ic(c, sc), e, ic(e, se))
                    const p2 = (se: number) => vecAxes(a, ic(a, sa), c, sc * hc(c), e, ic(e, se))
                    t.quad(p1(-1), p1(1), p2(1), p2(-1), [na, na, nc, nc])
                }
            }
        }
    }
    for (const sx of SIGNS) {
        for (const sy of SIGNS) {
            if (open && sy < 0) continue
            for (const sz of SIGNS) {
                const s = v3(sx, sy, sz)
                const corner = (a: number) => {
                    const p = v3(ic(0, sx), ic(1, sy), ic(2, sz))
                    p.setComponent(a, s.getComponent(a) * hc(a))
                    return p
                }
                t.tri(corner(0), corner(1), corner(2), [normal(0, sx), normal(1, sy), normal(2, sz)])
            }
        }
    }
    return t.geometry()
}

/** Prism over an XZ outline (convex or star-shaped around its centroid), from y0 to y1. */
function prismXZ(pts: readonly Pt[], y0: number, y1: number, bottom = false): THREE.BufferGeometry {
    const t = new Tris()
    let cx = 0
    let cz = 0
    for (const [x, z] of pts) {
        cx += x
        cz += z
    }
    cx /= pts.length
    cz /= pts.length
    for (let i = 0; i < pts.length; i++) {
        const [ax, az] = at(pts, i)
        const [bx, bz] = at(pts, i + 1)
        t.tri(v3(cx, y1, cz), v3(ax, y1, az), v3(bx, y1, bz), undefined, v3(0, 1, 0))
        if (bottom) t.tri(v3(cx, y0, cz), v3(ax, y0, az), v3(bx, y0, bz), undefined, v3(0, -1, 0))
        const out = v3((ax + bx) / 2 - cx, 0, (az + bz) / 2 - cz)
        t.quad(v3(ax, y0, az), v3(bx, y0, bz), v3(bx, y1, bz), v3(ax, y1, az), undefined, out)
    }
    return t.geometry()
}

/** Prism over an XY outline (a flat plate facing +Z), from z0 to z1. */
function prismXY(pts: readonly Pt[], z0: number, z1: number): THREE.BufferGeometry {
    return prismXZ(pts.map(([x, y]) => [x, -y] as const), z0, z1, true).rotateX(Math.PI / 2)
}

/** Box whose top face is smaller than its bottom (a battered plinth), from y = 0 to h. */
function frustumBox(wb: number, db: number, wt: number, dt: number, h: number): THREE.BufferGeometry {
    const t = new Tris()
    const b = [v3(-wb / 2, 0, -db / 2), v3(wb / 2, 0, -db / 2), v3(wb / 2, 0, db / 2), v3(-wb / 2, 0, db / 2)]
    const u = [v3(-wt / 2, h, -dt / 2), v3(wt / 2, h, -dt / 2), v3(wt / 2, h, dt / 2), v3(-wt / 2, h, dt / 2)]
    for (let i = 0; i < 4; i++) {
        const hint = at(b, i).clone().add(at(b, i + 1)).setY(0)
        t.quad(at(b, i), at(b, i + 1), at(u, i + 1), at(u, i), undefined, hint)
    }
    t.quad(at(u, 0), at(u, 1), at(u, 2), at(u, 3), undefined, v3(0, 1, 0))
    return t.geometry()
}

/** Flat-shaded ring wall (a round parapet) from y = 0 to h. */
function ringWall(rIn: number, rOut: number, h: number, seg: number): THREE.BufferGeometry {
    const t = new Tris()
    const p = (r: number, a: number, y: number) => v3(Math.sin(a) * r, y, Math.cos(a) * r)
    for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * TAU
        const a1 = ((i + 1) / seg) * TAU
        const out = v3(Math.sin((a0 + a1) / 2), 0, Math.cos((a0 + a1) / 2))
        t.quad(p(rOut, a0, 0), p(rOut, a1, 0), p(rOut, a1, h), p(rOut, a0, h), undefined, out)
        t.quad(p(rIn, a0, 0), p(rIn, a1, 0), p(rIn, a1, h), p(rIn, a0, h), undefined, out.clone().negate())
        t.quad(p(rIn, a0, h), p(rIn, a1, h), p(rOut, a1, h), p(rOut, a0, h), undefined, v3(0, 1, 0))
    }
    return t.geometry()
}

/** Upper half disc facing +Z (an arch head), centred on its flat edge. */
function halfDisc(r: number, t: number, seg = 8): THREE.BufferGeometry {
    return new THREE.CylinderGeometry(r, r, t, seg, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2)
}

/** Non-indexed with per-face normals. */
function flatNormals(geo: THREE.BufferGeometry): THREE.BufferGeometry {
    const g = geo.index ? geo.toNonIndexed() : geo
    if (g !== geo) geo.dispose()
    g.deleteAttribute('normal')
    g.computeVertexNormals()
    return g
}

/** Pushes every corner by a seeded random offset (shared corners move together) and flat-shades it: a natural rock. */
function roughen(geo: THREE.BufferGeometry, amount: number): THREE.BufferGeometry {
    const g = geo.index ? geo.toNonIndexed() : geo
    if (g !== geo) geo.dispose()
    const pos = g.getAttribute('position')
    const moved = new Map<string, V3>()
    for (let i = 0; i < pos.count; i++) {
        const key = `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`
        let d = moved.get(key)
        if (!d) {
            d = [jit(amount), jit(amount), jit(amount)]
            moved.set(key, d)
        }
        pos.setXYZ(i, pos.getX(i) + d[0], pos.getY(i) + d[1], pos.getZ(i) + d[2])
    }
    return flatNormals(g)
}

/** Bakes a colour; `tone` varies the whole part's brightness, `facet` every triangle's. */
function paint(g: THREE.BufferGeometry, hex: number, tone = 0, facet = 0): void {
    const c = new THREE.Color(hex)
    const count = g.getAttribute('position').count
    const arr = new Float32Array(count * 3)
    const base = tone > 0 ? 1 + jit(tone) : 1
    let f = base
    for (let i = 0; i < count; i++) {
        if (facet > 0 && i % 3 === 0) f = base * (1 + jit(facet))
        arr[i * 3] = c.r * f
        arr[i * 3 + 1] = c.g * f
        arr[i * 3 + 2] = c.b * f
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
}

/** Colours a cylinder's end caps differently from its side (cut log ends). */
function paintCaps(g: THREE.BufferGeometry, side: number, cap: number): void {
    const n = g.getAttribute('normal')
    const cs = new THREE.Color(side)
    const cc = new THREE.Color(cap)
    const arr = new Float32Array(n.count * 3)
    for (let i = 0; i < n.count; i++) {
        const c = Math.abs(n.getY(i)) > 0.99 ? cc : cs
        arr[i * 3] = c.r
        arr[i * 3 + 1] = c.g
        arr[i * 3 + 2] = c.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
}

interface Shade {
    /** Height over which walls brighten back to full. */
    h: number
    /** Darkening at the foot of a wall (0..1). */
    s: number
    /** Height where the darkening starts. */
    y0?: number
}

/** Darkens vertical faces near the ground, a cheap baked contact shadow. Flat tops stay clean. */
function groundShade(g: THREE.BufferGeometry, sh: Shade): void {
    const p = g.getAttribute('position')
    const n = g.getAttribute('normal')
    const c = g.getAttribute('color')
    for (let i = 0; i < p.count; i++) {
        const t = Math.min(1, Math.max(0, (p.getY(i) - (sh.y0 ?? 0)) / sh.h))
        const up = Math.max(0, n.getY(i))
        const f = 1 - sh.s * (1 - t * t * (3 - 2 * t)) * (1 - up * 0.85)
        c.setXYZ(i, c.getX(i) * f, c.getY(i) * f, c.getZ(i) * f)
    }
}

/** Triangular pennant from the pole (x = 0) out along +X, with a little wave. */
function pennantGeometry(len: number, hh: number, thick: number): THREE.BufferGeometry {
    const t = new Tris()
    const n = 4
    const col = (i: number) => {
        const f = i / n
        const x = f * len
        return { x, h: hh * (1 - f), z: Math.sin(f * Math.PI * 1.6) * len * 0.07, y: -hh * 0.25 * f }
    }
    const pt = (i: number, top: number, side: number) => {
        const c = col(i)
        return v3(c.x, c.y + top * c.h, c.z + side * thick / 2)
    }
    for (let i = 0; i < n; i++) {
        for (const side of SIGNS) {
            t.quad(pt(i, 1, side), pt(i, -1, side), pt(i + 1, -1, side), pt(i + 1, 1, side), undefined, v3(0, 0, side))
        }
        for (const top of SIGNS) {
            t.quad(pt(i, top, 1), pt(i + 1, top, 1), pt(i + 1, top, -1), pt(i, top, -1), undefined, v3(0, top, 0))
        }
    }
    t.quad(pt(0, 1, 1), pt(0, 1, -1), pt(0, -1, -1), pt(0, -1, 1), undefined, v3(-1, 0, 0))
    return t.geometry()
}

// ─── Kit: collects coloured parts and merges them ───────────────────────────

interface Rot { rx?: number, ry?: number, rz?: number }
interface BoxOpts extends Rot {
    /** Chamfer radius; 0 = plain 12-triangle box. Default 0.04. */
    r?: number
    /** Skip the hidden bottom. */
    open?: boolean
}
interface CylOpts extends Rot { seg?: number, open?: boolean, cap?: number }
interface BallOpts extends Rot { detail?: number, s?: Scale3 }
interface RoofOpts {
    ry?: number
    t?: number
    gable?: number
    gableInset?: number
    ridge?: number
}

const _euler = new THREE.Euler()
const _mat = new THREE.Matrix4()
const _quat = new THREE.Quaternion()
const Y_UP = new THREE.Vector3(0, 1, 0)

class Kit {
    private readonly parts: THREE.BufferGeometry[] = []
    /** Brightness variation per part for parts added from now on. */
    tone = 0
    /** Brightness variation per triangle for parts added from now on. */
    facet = 0

    /** Adds a geometry: scale, then rotate (Euler YXZ, i.e. yaw last) about its origin, then translate. */
    add(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, o: Rot = {}, s?: Scale3): this {
        const g = geo.index ? geo.toNonIndexed() : geo
        if (g !== geo) geo.dispose()
        g.deleteAttribute('uv')
        g.clearGroups()
        if (!g.hasAttribute('normal')) g.computeVertexNormals()
        if (!g.hasAttribute('color')) paint(g, color, this.tone, this.facet)
        if (s) g.scale(s[0], s[1], s[2])
        if (o.rx || o.ry || o.rz) g.applyMatrix4(_mat.makeRotationFromEuler(_euler.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YXZ')))
        g.translate(x, y, z)
        this.parts.push(g)
        return this
    }

    /** Builds a sub-model at the origin and places it as one piece. */
    group(fn: (k: Kit) => void, x = 0, y = 0, z = 0, o: Rot = {}, s?: Scale3): this {
        const sub = new Kit()
        sub.tone = this.tone
        sub.facet = this.facet
        fn(sub)
        return this.add(sub.build(), P.white, x, y, z, o, s)
    }

    /** Runs `fn` with a different colour variation. */
    with(tone: number, facet: number, fn: () => void): this {
        const t = this.tone
        const f = this.facet
        this.tone = tone
        this.facet = facet
        fn()
        this.tone = t
        this.facet = f
        return this
    }

    /** Box standing on y (rotation is about its centre). */
    box(x: number, y: number, z: number, w: number, h: number, d: number, color: number, o: BoxOpts = {}): this {
        const r = o.r ?? 0.04
        const g = r > 0 ? softBox(w, h, d, r, o.open ?? false) : new THREE.BoxGeometry(w, h, d)
        return this.add(g, color, x, y + h / 2, z, o)
    }

    /** Cylinder standing on y (rotation is about its centre). */
    cyl(x: number, y: number, z: number, rTop: number, rBot: number, h: number, color: number, o: CylOpts = {}): this {
        const g = new THREE.CylinderGeometry(rTop, rBot, h, o.seg ?? 8, 1, o.open ?? false)
        if (o.cap !== undefined) paintCaps(g, color, o.cap)
        return this.add(g, color, x, y + h / 2, z, o)
    }

    cone(x: number, y: number, z: number, r: number, h: number, color: number, o: CylOpts = {}): this {
        return this.cyl(x, y, z, 0, r, h, color, o)
    }

    /** Horizontal log centred on (x, y, z), lying along X or Z. */
    log(x: number, y: number, z: number, r: number, len: number, axis: 'x' | 'z', color: number, o: CylOpts = {}): this {
        const g = new THREE.CylinderGeometry(r, r, len, o.seg ?? 8, 1, o.open ?? false)
        if (o.cap !== undefined) paintCaps(g, color, o.cap)
        return this.add(g, color, x, y, z, axis === 'x' ? { rz: Math.PI / 2, ry: o.ry } : { rx: Math.PI / 2, ry: o.ry })
    }

    /** Icosahedron blob centred on (x, y, z). Detail 1 is round, 0 is faceted. */
    ball(x: number, y: number, z: number, r: number, color: number, o: BallOpts = {}): this {
        return this.add(new THREE.IcosahedronGeometry(r, o.detail ?? 1), color, x, y, z, o, o.s)
    }

    /** Faceted dodecahedron boulder centred on (x, y, z). */
    rock(x: number, y: number, z: number, r: number, color: number, o: BallOpts = {}): this {
        return this.add(new THREE.DodecahedronGeometry(r, 0), color, x, y, z, o, o.s)
    }

    /** An irregular, flat-shaded rock centred on (x, y, z). */
    crag(x: number, y: number, z: number, r: number, color: number, o: BallOpts & { rough?: number } = {}): this {
        const base = o.detail === 1 ? new THREE.IcosahedronGeometry(r, 1) : new THREE.DodecahedronGeometry(r, 0)
        return this.add(roughen(base, r * (o.rough ?? 0.13)), color, x, y, z, o, o.s)
    }

    /** Elongated octahedron crystal centred on (x, y, z). */
    gem(x: number, y: number, z: number, r: number, h: number, color: number, o: Rot = {}): this {
        return this.add(new THREE.OctahedronGeometry(1, 0), color, x, y, z, o, [r, h / 2, r])
    }

    /** Cylinder from `a` (radius ra) to `b` (radius rb). */
    seg(a: Vec, b: Vec, ra: number, rb: number, color: number, o: CylOpts = {}): this {
        const dir = b.clone().sub(a)
        const len = dir.length()
        const g = new THREE.CylinderGeometry(rb, ra, len, o.seg ?? 6, 1, o.open ?? false)
        if (o.cap !== undefined) paintCaps(g, color, o.cap)
        g.translate(0, len / 2, 0)
        g.applyQuaternion(_quat.setFromUnitVectors(Y_UP, dir.normalize()))
        return this.add(g, color, a.x, a.y, a.z)
    }

    /** Square-section timber from `a` to `b`, `w` wide and `t` thick. */
    beam(a: Vec, b: Vec, w: number, t: number, color: number): this {
        const dir = b.clone().sub(a)
        const len = dir.length()
        const g = new THREE.BoxGeometry(w, len, t)
        g.applyQuaternion(_quat.setFromUnitVectors(Y_UP, dir.normalize()))
        return this.add(g, color, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
    }

    /** Simple gabled roof of two slabs (legacy; used by the fallback gate). */
    roof(x: number, y: number, z: number, len: number, span: number, h: number, color: number, o: RoofOpts = {}): this {
        const t = o.t ?? 0.07
        const halfSpan = span / 2
        const slope = Math.hypot(halfSpan, h)
        const ang = Math.atan2(h, halfSpan)
        const ry = o.ry ?? 0
        const sin = Math.sin(ry)
        const cos = Math.cos(ry)
        for (const s of SIGNS) {
            const cy = h / 2 + Math.cos(ang) * t / 2
            const cz = s * halfSpan / 2 + s * Math.sin(ang) * t / 2
            this.add(softBox(len, t, slope + t * 0.7, Math.min(0.03, t * 0.4), false), color, x + cz * sin, y + cy, z + cz * cos, { rx: s * ang, ry })
        }
        if (o.gable !== undefined) {
            const tri = new Tris()
            const gx = len / 2 - (o.gableInset ?? 0.06)
            for (const s of SIGNS) {
                tri.tri(v3(s * gx, 0, -halfSpan + 0.03), v3(s * gx, 0, halfSpan - 0.03), v3(s * gx, h - 0.02, 0), undefined, v3(s, 0, 0))
            }
            this.add(tri.geometry(), o.gable, x, y, z, { ry })
        }
        if (o.ridge !== undefined) {
            this.add(softBox(len, 0.07, 0.1, 0.025, false), o.ridge, x, y + h + t * 0.75, z, { ry })
        }
        return this
    }

    build(): THREE.BufferGeometry {
        const merged = mergeGeometries(this.parts, false)
        for (const p of this.parts) p.dispose()
        this.parts.length = 0
        if (!merged) throw new Error('holdfast models: merge failed')
        merged.computeBoundingBox()
        merged.computeBoundingSphere()
        return merged
    }
}

function make(fn: (k: Kit) => void, shade?: Shade): THREE.BufferGeometry {
    seed = 0x2f6b1d
    const k = new Kit()
    fn(k)
    const g = k.build()
    if (shade) groundShade(g, shade)
    return g
}

function cached<K>(cache: Map<K, THREE.BufferGeometry>, key: K, fn: (k: Kit) => void, shade?: Shade): THREE.BufferGeometry {
    let geo = cache.get(key)
    if (!geo) {
        geo = make(fn, shade)
        cache.set(key, geo)
    }
    return geo
}

// ─── Architecture kit ───────────────────────────────────────────────────────

/** Top of a building's ground pad. */
const G = 0.045

const BUILDING_SHADE: Shade = { h: 0.55, s: 0.24, y0: 0.02 }

/** A point on a rounded-square outline. */
function squirclePoint(hx: number, hz: number, a: number): [number, number] {
    const c = Math.cos(a)
    const s = Math.sin(a)
    return [Math.sign(c) * Math.abs(c) ** 0.3 * hx, Math.sign(s) * Math.abs(s) ** 0.3 * hz]
}

function squircle(hx: number, hz: number, n: number, rough: number): Pt[] {
    const pts: Pt[] = []
    for (let i = 0; i < n; i++) {
        const [x, z] = squirclePoint(hx, hz, (i / n) * TAU + 0.12)
        const r = 1 - rand() * rough
        pts.push([x * r, z * r])
    }
    return pts
}

/** Grass blades leaning out of one spot. */
function tuft(k: Kit, x: number, y: number, z: number, s: number, tones: Tones = GRASS, blades = 4): void {
    for (let i = 0; i < blades; i++) {
        const a = i * 2.4 + jit(0.5)
        const lean = 0.2 + rand() * 0.35
        const h = (0.09 + rand() * 0.07) * s
        k.cyl(x + Math.sin(a) * 0.018 * s, y, z + Math.cos(a) * 0.018 * s, 0, 0.016 * s, h, at(tones, i), { seg: 3, open: true, rx: Math.cos(a) * lean, rz: -Math.sin(a) * lean })
    }
}

/** The ground pad under a building: a worn fringe, the pad itself and a few grass tufts on the rim. */
function yard(k: Kit, half: number, top: number, edge: number, tufts = 6): void {
    k.add(prismXZ(squircle(half, half, 24, 0.015), 0, 0.02), edge)
    k.add(prismXZ(squircle(half - 0.06, half - 0.06, 20, 0.03), 0, G), top)
    for (let i = 0; i < tufts; i++) {
        const [x, z] = squirclePoint(half - 0.05, half - 0.05, (i / tufts) * TAU + 0.4 + jit(0.25))
        tuft(k, x, 0.01, z, 0.8 + rand() * 0.4)
    }
}

/** Coursed masonry standing on y: stacked courses with varied tone and a hairline step; optional corner quoins. */
function masonry(k: Kit, x: number, y: number, z: number, w: number, h: number, d: number, o: { course?: number, tones?: Tones, quoin?: number } = {}): void {
    const tones = o.tones ?? STONE
    const order = [tones[0], tones[1], tones[0], tones[2], tones[1]] as const
    const n = Math.max(1, Math.round(h / (o.course ?? 0.2)))
    const ch = h / n
    for (let i = 0; i < n; i++) {
        const inset = i % 2 ? 0.007 : 0
        k.box(x, y + i * ch, z, w - inset * 2, ch, d - inset * 2, at(order, i), { r: 0 })
    }
    if (o.quoin === undefined) return
    const p = 0.012
    for (const sx of SIGNS) {
        for (const sz of SIGNS) {
            for (let i = 0; i < n; i++) {
                const long = (i + (sx * sz > 0 ? 0 : 1)) % 2 === 0
                const qx = long ? 0.2 : 0.12
                const qz = long ? 0.12 : 0.2
                k.box(x + sx * (w / 2 + p - qx / 2), y + i * ch + 0.006, z + sz * (d / 2 + p - qz / 2), qx, ch - 0.012, qz, o.quoin, { r: 0 })
            }
        }
    }
}

/** Round coursed masonry (a tower shaft), tapering from rBot to rTop. */
function roundMasonry(k: Kit, x: number, y: number, z: number, rBot: number, rTop: number, h: number, o: { course?: number, tones?: Tones, seg?: number } = {}): void {
    const tones = o.tones ?? STONE
    const order = [tones[0], tones[1], tones[0], tones[2], tones[1]] as const
    const n = Math.max(1, Math.round(h / (o.course ?? 0.22)))
    for (let i = 0; i < n; i++) {
        const r0 = rBot + (rTop - rBot) * (i / n)
        const r1 = rBot + (rTop - rBot) * ((i + 1) / n)
        const inset = i % 2 ? 0.006 : 0
        k.cyl(x, y + (i / n) * h, z, r1 - inset, r0 - inset, h / n, at(order, i), { seg: o.seg ?? 12, open: true })
    }
}

/** Plastered box with a dark timber frame proud of every face: sill, plate, corner posts, studs, a rail and braces. */
function halfTimber(k: Kit, x: number, y: number, z: number, w: number, h: number, d: number, o: { studs?: number, rail?: number, plaster?: number } = {}): void {
    const beam = P.beam
    k.box(x, y, z, w, h, d, o.plaster ?? P.plaster, { r: 0 })
    k.box(x, y, z, w + 0.024, 0.045, d + 0.024, beam, { r: 0 })
    k.box(x, y + h - 0.04, z, w + 0.024, 0.04, d + 0.024, beam, { r: 0 })
    for (const sx of SIGNS) {
        for (const sz of SIGNS) k.box(x + sx * (w / 2 - 0.008), y, z + sz * (d / 2 - 0.008), 0.042, h, 0.042, beam, { r: 0 })
    }
    const faces: readonly (readonly [number, number, number])[] = [[0, w, d], [Math.PI, w, d], [Math.PI / 2, d, w], [-Math.PI / 2, d, w]]
    for (const [ry, fw, fd] of faces) {
        k.group((f) => {
            const n = Math.max(2, Math.round(fw / (o.studs ?? 0.34)))
            const bay = fw / n
            const rail = h * (o.rail ?? 0.4)
            f.box(0, rail - 0.017, 0, fw, 0.034, 0.024, beam, { r: 0 })
            for (let i = 1; i < n; i++) f.box(-fw / 2 + i * bay, 0.04, 0, 0.032, h - 0.08, 0.024, beam, { r: 0 })
            for (const s of SIGNS) f.beam(v3(s * (fw / 2 - 0.02), 0.045, 0), v3(s * (fw / 2 - bay + 0.02), rail - 0.01, 0), 0.03, 0.024, beam)
        }, x + Math.sin(ry) * fd / 2, y, z + Math.cos(ry) * fd / 2, { ry })
    }
}

/** Centres of the bays between studs on a half-timbered face `fw` wide. */
function bays(fw: number, studs = 0.34): number[] {
    const n = Math.max(2, Math.round(fw / studs))
    return Array.from({ length: n }, (_, i) => -fw / 2 + (i + 0.5) * (fw / n))
}

interface GableOpts {
    ry?: number
    /** Eave overhang measured along the slope. */
    overhang?: number
    /** Overhang past the gable ends. */
    endOverhang?: number
    /** Gable-end infill colour. */
    gable?: number
    gableInset?: number
    /** Beams on the gable ends (king post, collar, braces). */
    timber?: number
    ridge?: number
    /** Bargeboards along the gable edges. */
    barge?: number
    /** Width of one tile/shingle course. */
    course?: number
}

/**
 * Gabled roof with the ridge along X (before `ry`): an underlay per side with
 * overlapping courses on top (each tilted a touch flatter so its lower edge
 * lifts, which reads as rows of tiles or shingles), a ridge cap, bargeboards
 * and optional gable infill. Eaves at y, ridge at y + h.
 */
function gableRoof(k: Kit, x: number, y: number, z: number, len: number, span: number, h: number, tones: Tones, o: GableOpts = {}): void {
    k.group((r) => {
        const oh = o.overhang ?? 0.1
        const eo = o.endOverhang ?? 0.07
        const L = len + eo * 2
        const half = span / 2
        const ang = Math.atan2(h, half)
        const slope = Math.hypot(half, h) + oh
        const n = Math.max(3, Math.round(slope / (o.course ?? 0.12)))
        const step = slope / n
        const t = 0.03
        const tc = 0.022
        const order = [tones[0], tones[1], tones[0], tones[2]] as const
        for (const s of SIGNS) {
            const nrm = v3(0, Math.cos(ang), s * Math.sin(ang))
            const up = v3(0, Math.sin(ang), -s * Math.cos(ang))
            const eave = v3(0, 0, s * half).addScaledVector(up, -oh)
            const on = (along: number, lift: number): Vec => eave.clone().addScaledVector(up, along).addScaledVector(nrm, lift)
            const u = on(slope / 2, t / 2)
            r.add(new THREE.BoxGeometry(L, t, slope), tones[1], u.x, u.y, u.z, { rx: s * ang })
            for (let i = 0; i < n; i++) {
                const c = on((i + 0.5) * step, t + tc / 2 + 0.002)
                r.add(new THREE.BoxGeometry(L + (i % 2) * 0.008, tc, step * 1.32), at(order, i + (s > 0 ? 0 : 1)), c.x, c.y, c.z, { rx: s * (ang - 0.09) })
            }
            if (o.barge !== undefined) {
                const b = on(slope / 2 - 0.01, t + tc / 2)
                for (const e of SIGNS) r.add(new THREE.BoxGeometry(0.026, 0.07, slope + 0.02), o.barge, e * (L / 2 + 0.004), b.y, b.z, { rx: s * ang })
            }
        }
        const top = h + (t + tc + 0.004) / Math.cos(ang)
        r.add(new THREE.BoxGeometry(L + 0.02, 0.055, 0.055), o.ridge ?? tones[1], 0, top - 0.008, 0, { rx: Math.PI / 4 })
        if (o.gable !== undefined) {
            const gx = len / 2 - (o.gableInset ?? 0.02)
            const tri = new Tris()
            for (const e of SIGNS) tri.tri(v3(e * gx, 0, -half), v3(e * gx, 0, half), v3(e * gx, h, 0), undefined, v3(e, 0, 0))
            r.add(tri.geometry(), o.gable)
            if (o.timber !== undefined) {
                for (const e of SIGNS) {
                    const fx = e * (gx + 0.006)
                    r.add(new THREE.BoxGeometry(0.014, h * 0.9, 0.034), o.timber, fx, h * 0.45, 0)
                    r.add(new THREE.BoxGeometry(0.014, 0.03, span * 0.5), o.timber, fx, h * 0.45, 0)
                    for (const s of SIGNS) r.beam(v3(fx, 0.03, s * half * 0.62), v3(fx, h * 0.44, s * 0.04), 0.014, 0.026, o.timber)
                }
            }
        }
    }, x, y, z, { ry: o.ry })
}

/**
 * Hipped/pyramid roof in overlapping courses (square frusta stepping in),
 * `w` x `d` at the eaves on y, apex at y + h.
 */
function tieredRoof(k: Kit, x: number, y: number, z: number, w: number, d: number, h: number, tones: Tones, o: { courses?: number, ry?: number, finial?: number } = {}): void {
    const n = o.courses ?? 4
    const order = [tones[0], tones[1], tones[0], tones[2]] as const
    for (let i = 0; i < n; i++) {
        const f0 = i / n
        const f1 = (i + 1) / n
        const rb = 1 - f0 + (i === 0 ? 0 : 0.05)
        const rt = i === n - 1 ? 0 : 1 - f1
        const y0 = h * f0 - (i === 0 ? 0.03 : 0.012)
        const g = new THREE.CylinderGeometry(rt * Math.SQRT2, rb * Math.SQRT2, h * f1 - y0, 4, 1, true, Math.PI / 4)
        g.translate(0, (h * f1 + y0) / 2, 0)
        g.scale(w / 2, 1, d / 2)
        k.add(flatNormals(g), at(order, i), x, y, z, { ry: o.ry })
    }
    if (o.finial !== undefined) {
        k.cyl(x, y + h - 0.03, z, 0, 0.025, 0.14, o.finial, { seg: 4 })
        k.ball(x, y + h + 0.01, z, 0.028, o.finial, { detail: 0 })
    }
}

/** Round conical roof in overlapping courses with a slight bell curve; eave radius r on y. */
function tieredCone(k: Kit, x: number, y: number, z: number, r: number, h: number, tones: Tones, o: { courses?: number, seg?: number, finial?: number } = {}): void {
    const n = o.courses ?? 4
    const order = [tones[0], tones[1], tones[0], tones[2]] as const
    const rad = (f: number) => r * (1 - f) ** 1.2
    for (let i = 0; i < n; i++) {
        const f0 = i / n
        const f1 = (i + 1) / n
        const rb = rad(f0) + (i === 0 ? 0 : 0.03)
        const rt = i === n - 1 ? 0 : rad(f1)
        const y0 = h * f0 - (i === 0 ? 0.03 : 0.012)
        k.cyl(x, y + y0, z, rt, rb, h * f1 - y0, at(order, i), { seg: o.seg ?? 12, open: true })
    }
    if (o.finial !== undefined) {
        k.cyl(x, y + h - 0.03, z, 0, 0.02, 0.16, o.finial, { seg: 4 })
        k.ball(x, y + h + 0.02, z, 0.026, o.finial, { detail: 0 })
    }
}

interface WinOpts {
    w?: number
    h?: number
    frame?: number
    shutter?: number
    lit?: boolean
    sill?: number
    lintel?: number
    arch?: boolean
    cross?: boolean
}

/** A framed window on a wall face; (x, y, z) is the opening centre on the face, facing out along `ry` (0 = +Z). */
function windowAt(k: Kit, x: number, y: number, z: number, ry: number, o: WinOpts = {}): void {
    const w = o.w ?? 0.13
    const h = o.h ?? 0.18
    k.group((g) => {
        const frame = o.frame ?? P.beam
        const pane = o.lit ? P.glassLit : P.glass
        g.add(new THREE.BoxGeometry(w + 0.04, h + 0.04, 0.024), frame, 0, 0, 0.004)
        g.add(new THREE.BoxGeometry(w, h, 0.02), pane, 0, 0, 0.01)
        if (o.arch) {
            g.add(halfDisc(w / 2 + 0.02, 0.024), frame, 0, h / 2, 0.004)
            g.add(halfDisc(w / 2, 0.02), pane, 0, h / 2, 0.01)
        }
        if (o.cross !== false) {
            g.add(new THREE.BoxGeometry(0.014, h, 0.012), frame, 0, 0, 0.022)
            g.add(new THREE.BoxGeometry(w, 0.014, 0.012), frame, 0, h * 0.1, 0.022)
        }
        if (o.sill !== undefined) g.add(new THREE.BoxGeometry(w + 0.07, 0.024, 0.045), o.sill, 0, -h / 2 - 0.026, 0.016)
        if (o.lintel !== undefined) g.add(new THREE.BoxGeometry(w + 0.08, 0.034, 0.03), o.lintel, 0, h / 2 + 0.036, 0.008)
        if (o.shutter !== undefined) {
            for (const s of SIGNS) g.add(new THREE.BoxGeometry(w * 0.5, h + 0.01, 0.012), o.shutter, s * (w * 0.75 + 0.028), 0, 0.008)
        }
    }, x, y, z, { ry })
}

interface DoorOpts {
    w?: number
    h?: number
    arch?: boolean
    /** Frame or stone surround colour. */
    surround?: number
    /** Step stone in front. */
    step?: number
    straps?: number
}

/** A boarded door standing on y in a wall face at (x, z), facing out along `ry`. */
function doorAt(k: Kit, x: number, y: number, z: number, ry: number, o: DoorOpts = {}): void {
    const w = o.w ?? 0.22
    const h = o.h ?? 0.34
    k.group((g) => {
        const surround = o.surround ?? P.beam
        g.add(new THREE.BoxGeometry(w + 0.07, h + 0.035, 0.028), surround, 0, (h + 0.035) / 2, 0.004)
        if (o.arch) {
            g.add(halfDisc(w / 2 + 0.035, 0.028), surround, 0, h, 0.004)
            g.add(halfDisc(w / 2, 0.02), P.woodDark, 0, h, 0.014)
        }
        for (let i = 0; i < 3; i++) g.add(new THREE.BoxGeometry(w / 3 - 0.004, h, 0.02), i % 2 ? P.wood : P.woodDark, -w / 2 + (i + 0.5) * (w / 3), h / 2, 0.014)
        for (const sy of [0.24, 0.72]) g.add(new THREE.BoxGeometry(w * 0.86, 0.018, 0.008), o.straps ?? P.iron, 0, h * sy, 0.026)
        g.add(new THREE.BoxGeometry(0.02, 0.02, 0.012), P.brass, w * 0.28, h * 0.48, 0.028)
        if (o.step !== undefined) g.add(new THREE.BoxGeometry(w + 0.12, 0.035, 0.09), o.step, 0, 0.0175, 0.05)
    }, x, y, z, { ry })
}

/** A narrow arrow slit with a pale stone frame on a round wall of radius r around (cx, cz). */
function slit(k: Kit, cx: number, cz: number, a: number, r: number, y: number, h = 0.16, frame: number = P.stoneLight): void {
    k.group((g) => {
        g.box(0, -0.02, 0, 0.07, h + 0.04, 0.03, frame, { r: 0 })
        g.box(0, 0, 0.008, 0.028, h, 0.03, P.dark, { r: 0 })
    }, cx + Math.sin(a) * r, y, cz + Math.cos(a) * r, { ry: a })
}

function chimney(k: Kit, x: number, y: number, z: number, h: number, w = 0.15): void {
    masonry(k, x, y, z, w, h, w, { course: 0.1, tones: [P.stoneMid, P.stoneDark, P.stone] })
    k.box(x, y + h, z, w + 0.04, 0.035, w + 0.04, P.stoneLight, { r: 0 })
    k.box(x, y + h + 0.035, z, w - 0.05, 0.02, w - 0.05, P.dark, { r: 0 })
}

function lantern(k: Kit, x: number, y: number, z: number): void {
    k.box(x, y, z, 0.05, 0.065, 0.05, P.lantern, { r: 0.008 })
    k.cone(x, y + 0.065, z, 0.042, 0.035, P.iron, { seg: 4 })
}

/** Wall lantern on a bracket, on a face at z = 0 (local). */
function wallLantern(k: Kit, x: number, y: number, z: number, ry: number): void {
    k.group((g) => {
        g.box(0, 0.06, 0.03, 0.014, 0.014, 0.06, P.iron, { r: 0 })
        lantern(g, 0, -0.02, 0.065)
    }, x, y, z, { ry })
}

function barrel(k: Kit, x: number, y: number, z: number, s = 1): void {
    const r = 0.062 * s
    const R = 0.074 * s
    const h = 0.085 * s
    k.cyl(x, y, z, R, r, h, P.wood, { seg: 8, open: true })
    k.cyl(x, y + h, z, r, R, h, P.wood, { seg: 8, cap: P.woodDark })
    for (const f of [0.28, 1.72]) k.cyl(x, y + h * f - 0.006 * s, z, r + (R - r) * 0.5 + 0.004, r + (R - r) * 0.5 + 0.004, 0.012 * s, P.iron, { seg: 8, open: true })
}

function crate(k: Kit, x: number, y: number, z: number, s: number, ry = 0): void {
    k.box(x, y, z, s, s, s, P.woodLight, { r: 0.008, ry })
    for (const f of [0, 0.86]) k.box(x, y + s * f, z, s + 0.01, s * 0.14, s + 0.01, P.woodDark, { r: 0, ry })
}

function sack(k: Kit, x: number, y: number, z: number, ry = 0): void {
    k.ball(x, y + 0.05, z, 0.062, P.canvas, { detail: 0, s: [1, 0.85, 0.8], ry })
    k.cyl(x, y + 0.09, z, 0.012, 0.024, 0.04, P.canvas, { seg: 5 })
}

/** Split-rail fence through the given points. */
function fence(k: Kit, pts: readonly Pt[], y: number, h = 0.2): void {
    pts.forEach(([x, z], i) => {
        k.box(x, y, z, 0.034, h + 0.03, 0.034, P.woodDark, { r: 0, ry: i * 0.4 })
        const next = pts[i + 1]
        if (!next) return
        for (const f of [0.45, 0.85]) k.beam(v3(x, y + h * f, z), v3(next[0], y + h * f + jit(0.01), next[1]), 0.02, 0.016, P.wood)
    })
}

/** A path of flat stepping stones from (x0, z0) to (x1, z1). */
function pavers(k: Kit, x0: number, z0: number, x1: number, z1: number, n: number, y = G): void {
    for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n
        k.box(x0 + (x1 - x0) * t + jit(0.02), y - 0.006, z0 + (z1 - z0) * t, 0.13 + jit(0.02), 0.014, 0.1 + jit(0.015), at([P.pavingLight, P.paving, P.stoneMid], i), { r: 0, ry: jit(0.35) })
    }
}

function nuggets(k: Kit, x: number, y: number, z: number, big = false): void {
    const r = big ? 0.07 : 0.058
    k.with(0, 0.12, () => {
        k.ball(x - r, y + r * 0.7, z, r, P.gold, { detail: 0 })
        k.ball(x + r, y + r * 0.7, z + r * 0.3, r * 0.95, P.goldDeep, { detail: 0 })
        k.ball(x, y + r * 0.7, z - r * 1.1, r * 0.9, P.gold, { detail: 0 })
        k.ball(x, y + r * 1.9, z - r * 0.2, r, P.gold, { detail: 0, ry: 0.6 })
    })
}

const BANNER: readonly Pt[] = [[-0.15, -0.015], [0.15, -0.015], [0.15, -0.74], [0, -0.62], [-0.15, -0.74]]

/** Swallowtailed team banner hanging down from y = 0 in front of a wall whose face is at z = 0. */
function bannerPiece(k: Kit, rich: boolean): void {
    k.log(0, 0, 0.045, 0.016, 0.38, 'x', P.woodDark, { seg: 6, cap: rich ? P.ochre : P.woodDark })
    k.add(prismXY(BANNER, 0.026, 0.042), P.banner)
    const trim = rich ? P.ochre : P.cloth
    for (const s of SIGNS) k.box(s * 0.115, -0.6, 0.044, 0.022, 0.58, 0.006, trim, { r: 0 })
    k.box(0, -0.38, 0.044, 0.08, 0.08, 0.006, trim, { r: 0, rz: Math.PI / 4 })
}

/** Flag pole standing on y with a baked pennant (for props; the keep flag is `flagGeometry`). */
function flagPole(k: Kit, x: number, y: number, z: number, h: number, cloth: number, ry = 0): void {
    k.cyl(x, y, z, 0.018, 0.024, h, P.woodDark, { seg: 6, open: true })
    k.ball(x, y + h + 0.02, z, 0.03, P.ochre, { detail: 0 })
    k.add(pennantGeometry(0.32, 0.085, 0.016), cloth, x, y + h - 0.1, z, { ry })
}

/** Tall pole with a crossbar and a hanging team banner. */
function bannerPole(k: Kit, x: number, y: number, z: number, h: number, ry = 0): void {
    k.cyl(x, y, z, 0.02, 0.026, h, P.woodDark, { seg: 6, open: true })
    k.ball(x, y + h + 0.02, z, 0.032, P.ochre, { detail: 0 })
    k.group(b => bannerPiece(b, false), x, y + h - 0.06, z, { ry }, [0.85, 0.85, 0.85])
}

function pickaxe(k: Kit, x: number, y: number, z: number, ry: number): void {
    k.group((g) => {
        g.beam(v3(0, 0, 0), v3(0, 0.3, 0.06), 0.018, 0.018, P.woodLight)
        g.beam(v3(-0.09, 0.3, 0.07), v3(0.09, 0.3, 0.05), 0.02, 0.022, P.iron)
    }, x, y, z, { ry })
}

// ─── Buildings ──────────────────────────────────────────────────────────────

/** Top of the keep's flag pole per level; the renderer hangs the flag 0.12 below (KEEP_FLAG_Y = [4.44, 4.99, 5.55]). */
const KEEP_POLE_TOP = [4.56, 5.11, 5.67] as const

function buildKeep(k: Kit, lv: number): void {
    yard(k, 1.94, P.paving, P.pavingDark, 10)
    const fort = lv >= 3
    const base = 0.3
    const bodyH = pick([1.2, 1.45, 1.55], lv - 1)
    const top = base + bodyH

    // Battered plinth, coursed curtain and a string course.
    k.add(frustumBox(3.28, 3.28, 3.02, 3.02, base - 0.04), P.stoneDark)
    k.box(0, base - 0.04, 0, 3.06, 0.05, 3.06, P.stoneMid, { r: 0 })
    masonry(k, 0, base, 0, 2.9, bodyH, 2.9, { course: 0.22 })
    k.box(0, base + bodyH * 0.46, 0, 2.95, 0.04, 2.95, P.stoneLight, { r: 0 })

    // Corbel table, projecting wall walk and crenellated parapet on every face.
    for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        k.group((g) => {
            for (let i = 0; i < 7; i++) g.box(-0.78 + i * 0.26, -0.12, 1.485, 0.07, 0.12, 0.07, P.stoneMid, { r: 0 })
            g.box(0, 0.1, 1.47, 1.98, 0.12, 0.1, P.stone, { r: 0 })
            for (const t of [-0.72, -0.36, 0, 0.36, 0.72]) g.box(t, 0.22, 1.47, 0.18, 0.15, 0.11, P.stoneLight, { r: 0 })
        }, 0, top, 0, { ry })
    }
    k.box(0, top, 0, 3.06, 0.1, 3.06, P.stoneLight, { r: 0 })
    const deck = top + 0.1
    k.box(0, deck, 0, 2.84, 0.008, 2.84, P.paving, { r: 0 })

    // Corner towers with blue-grey slate cones.
    const towerTop = top + pick([0.55, 0.7, 0.85], lv - 1)
    const coneH = pick([0.8, 0.9, 1.0], lv - 1)
    for (const sx of SIGNS) {
        for (const sz of SIGNS) {
            const tx = sx * 1.38
            const tz = sz * 1.38
            const a = Math.atan2(sx, sz)
            k.cyl(tx, 0, tz, 0.5, 0.54, base, P.stoneDark, { seg: 12, open: true })
            roundMasonry(k, tx, base, tz, 0.47, 0.45, towerTop - base - 0.12)
            k.cyl(tx, towerTop - 0.12, tz, 0.52, 0.45, 0.12, P.stoneMid, { seg: 12, open: true })
            k.cyl(tx, towerTop, tz, 0.52, 0.52, 0.09, P.stoneLight, { seg: 12, open: true })
            if (fort) k.cyl(tx, towerTop - 0.19, tz, 0.462, 0.462, 0.035, P.ochre, { seg: 12, open: true })
            tieredCone(k, tx, towerTop + 0.09, tz, 0.56, coneH, TEAM_ROOF, { finial: fort ? P.ochre : P.iron })
            for (const da of [-0.5, 0.5]) slit(k, tx, tz, a + da, 0.462, base + bodyH * 0.32)
            slit(k, tx, tz, a, 0.455, base + bodyH * 0.78)
            if (lv >= 2) windowAt(k, tx + Math.sin(a) * 0.45, towerTop - 0.36, tz + Math.cos(a) * 0.45, a, { w: 0.08, h: 0.13, frame: P.stoneLight, arch: true, lit: true, cross: false })
        }
    }

    // Donjon (plus an extra storey at level 3) under a tiled pyramid roof.
    const cH = pick([1.05, 1.35, 1.2], lv - 1)
    masonry(k, 0, deck, 0, 1.3, cH, 1.3, { course: 0.2, quoin: P.stoneLight })
    for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2
        windowAt(k, Math.sin(a) * 0.65, deck + cH * 0.56, Math.cos(a) * 0.65, a, { w: 0.13, h: 0.2, frame: P.stoneLight, arch: true, lit: lv >= 2 && i % 2 === 0, cross: false, sill: P.stoneLight })
        if (lv >= 2) slit(k, 0, 0, a + 0.02, 0.662, deck + cH * 0.18, 0.12)
    }
    let roofBase = deck + cH
    for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        k.group((g) => {
            for (let i = 0; i < 5; i++) g.box(-0.48 + i * 0.24, -0.1, 0.685, 0.06, 0.1, 0.07, P.stoneMid, { r: 0 })
        }, 0, roofBase, 0, { ry })
    }
    k.box(0, roofBase, 0, 1.42, 0.09, 1.42, P.stoneLight, { r: 0 })
    roofBase += 0.09
    if (fort) {
        masonry(k, 0, roofBase, 0, 0.95, 0.72, 0.95, { course: 0.18, quoin: P.stoneLight })
        for (let i = 0; i < 4; i++) {
            const a = (i * Math.PI) / 2
            windowAt(k, Math.sin(a) * 0.475, roofBase + 0.36, Math.cos(a) * 0.475, a, { w: 0.11, h: 0.17, frame: P.stoneLight, arch: true, lit: true, cross: false })
        }
        roofBase += 0.72
        k.box(0, roofBase - 0.09, 0, 0.975, 0.035, 0.975, P.ochre, { r: 0 })
        k.box(0, roofBase, 0, 1.05, 0.08, 1.05, P.stoneLight, { r: 0 })
        roofBase += 0.08
    }
    const roofW = fort ? 1.25 : 1.6
    const roofH = roofW * 0.62
    tieredRoof(k, 0, roofBase, 0, roofW, roofW, roofH, TILE, { courses: 6 })
    const cxz = fort ? 0.3 : 0.38
    chimney(k, -cxz, roofBase, -cxz, roofH * 0.62, 0.14)
    const apex = roofBase + roofH
    // Flag pole: the renderer hangs the team flag near its top (KEEP_FLAG_Y).
    const poleTop = at(KEEP_POLE_TOP, lv - 1)
    k.cyl(0, apex - 0.12, 0, 0.022, 0.028, poleTop - apex + 0.12, P.woodDark, { seg: 6, open: true })
    k.ball(0, poleTop + 0.025, 0, 0.045, P.ochre, { detail: 0 })

    // Great door on +Z with stairs up the plinth and a lantern either side.
    const fz = 1.45
    doorAt(k, 0, base, fz, 0, { w: 0.46, h: 0.54, arch: true, surround: P.stoneLight, straps: fort ? P.ochre : P.iron })
    for (let i = 0; i < 3; i++) k.box(0, 0, 1.56 + i * 0.1, 0.74 - i * 0.04, base - i * 0.1, 0.1, at(STONE, i), { r: 0 })
    for (const s of SIGNS) wallLantern(k, s * 0.42, base + 0.5, fz, 0)

    // Level 2+: team banners on every face.
    if (lv >= 2) {
        const spots: readonly (readonly [number, number, number])[] = [
            [0.66, fz + 0.01, 0], [-0.66, fz + 0.01, 0], [fz + 0.01, 0, Math.PI / 2], [-fz - 0.01, 0, -Math.PI / 2], [0, -fz - 0.01, Math.PI]
        ]
        for (const [x, z, ry] of spots) k.group(b => bannerPiece(b, fort), x, top - 0.03, z, { ry })
    }

    // Supplies by the door.
    barrel(k, 0.72, G, 1.74)
    barrel(k, 0.86, G, 1.6, 0.9)
    crate(k, -0.74, G, 1.72, 0.15, 0.3)
    sack(k, -0.9, G, 1.6, 0.5)
}

function buildGoldmine(k: Kit, lv: number): void {
    yard(k, 0.94, P.dirt, P.dirtDark)
    // Rocky outcrop the adit is cut into, with veins of gold and moss on top.
    k.with(0.04, 0.07, () => {
        k.crag(-0.15, 0.17, -0.47, 0.5, P.rockWarm, { s: [1.28, 1, 0.82] })
        k.crag(0.47, 0.1, -0.5, 0.35, P.rockWarm2, { ry: 0.6 })
        k.crag(-0.66, 0.06, -0.14, 0.25, P.rockWarm2, { ry: 0.5 })
        k.crag(0.66, 0.04, -0.12, 0.19, P.rockWarm, { ry: 1.3 })
        k.ball(-0.28, 0.6, -0.55, 0.14, P.moss, { detail: 0, s: [1.4, 0.35, 1] })
        k.ball(0.5, 0.42, -0.58, 0.1, P.moss, { detail: 0, s: [1.3, 0.35, 1] })
    })
    for (const [x, y, z, ry] of [[-0.52, 0.42, -0.36, 0.4], [0.18, 0.5, -0.62, -0.3], [0.62, 0.3, -0.32, 0.9], [-0.3, 0.3, -0.12, 0.2]] as const) {
        k.gem(x, y, z, 0.035, 0.1, P.gold, { rz: 0.9, ry })
    }

    // Adit facing +Z: timber sets (a stone portal from level 4) under a shingle hood.
    const ez = 0
    k.box(0, G, ez - 0.12, 0.4, 0.46, 0.16, P.dark, { r: 0 })
    if (lv < 4) {
        for (const fz of [ez - 0.1, ez + 0.03]) {
            const col = fz > ez ? P.wood : P.woodDark
            for (const s of SIGNS) k.beam(v3(s * 0.24, G, fz), v3(s * 0.2, G + 0.52, fz), 0.07, 0.07, col)
            k.log(0, G + 0.54, fz, 0.042, 0.6, 'x', col, { seg: 6, cap: P.cut })
        }
        for (const s of SIGNS) k.beam(v3(s * 0.21, G + 0.36, ez + 0.03), v3(s * 0.07, G + 0.51, ez + 0.03), 0.035, 0.035, P.woodDark)
    } else {
        for (const s of SIGNS) masonry(k, s * 0.3, G, ez - 0.03, 0.16, 0.62, 0.22, { course: 0.155 })
        masonry(k, 0, G + 0.5, ez - 0.03, 0.76, 0.14, 0.22, { course: 0.14, tones: [P.stoneLight, P.stone, P.stoneLight] })
        k.box(0, G + 0.47, ez + 0.08, 0.1, 0.17, 0.02, P.stoneLight, { r: 0 })
        // Retaining walls either side.
        for (const s of SIGNS) masonry(k, s * 0.56, G, ez + 0.04, 0.3, 0.22, 0.14, { course: 0.11 })
    }
    gableRoof(k, 0, G + (lv >= 4 ? 0.64 : 0.58), ez - 0.02, 0.34, 0.74, 0.22, SHINGLE, { ry: Math.PI / 2, gable: P.woodDark, overhang: 0.06, endOverhang: 0.05, course: 0.1 })

    // Rails and a cart of ore.
    for (const s of SIGNS) k.box(s * 0.1, G, 0.46, 0.022, 0.022, 0.8, P.iron, { r: 0 })
    for (let i = 0; i < 6; i++) k.box(0, G - 0.004, 0.1 + i * 0.145, 0.3, 0.02, 0.05, i % 2 ? P.woodDark : P.wood, { r: 0 })
    k.group((c) => {
        for (const sx of SIGNS) {
            for (const sz of SIGNS) c.log(sx * 0.125, 0.05, sz * 0.08, 0.048, 0.03, 'x', P.iron, { seg: 8, cap: P.steelDark })
        }
        c.add(frustumBox(0.22, 0.17, 0.28, 0.23, 0.15), P.woodDark, 0, 0.06, 0)
        for (const s of SIGNS) {
            c.box(0, 0.2, s * 0.113, 0.29, 0.022, 0.018, P.iron, { r: 0 })
            c.box(s * 0.138, 0.2, 0, 0.018, 0.022, 0.23, P.iron, { r: 0 })
        }
        c.box(0, 0.2, 0, 0.26, 0.012, 0.21, P.rockWarm2, { r: 0 })
    }, 0, G + 0.02, 0.58)
    k.with(0, 0.12, () => {
        k.ball(-0.06, G + 0.25, 0.56, 0.055, P.gold, { detail: 0 })
        k.ball(0.06, G + 0.25, 0.6, 0.05, P.goldDeep, { detail: 0 })
        k.ball(0, G + 0.29, 0.58, 0.048, P.gold, { detail: 0, ry: 0.5 })
    })

    // Yard props.
    barrel(k, -0.62, G, 0.8)
    pickaxe(k, -0.5, G, 0.74, 0.8)
    crate(k, -0.4, G, 0.36, 0.14, 0.4)
    if (lv < 5) {
        // Spoil heap.
        k.with(0.05, 0.1, () => {
            k.crag(0.6, G + 0.02, 0.5, 0.14, P.rockWarm2, { s: [1.2, 0.7, 1] })
            k.crag(0.72, G, 0.66, 0.1, P.rockWarm, { ry: 1 })
            k.crag(0.5, G, 0.72, 0.08, P.rockWarm2, { ry: 2 })
        })
    }
    if (lv >= 2) {
        nuggets(k, 0.36, G, 0.3)
        // Lantern post at the adit.
        k.box(0.34, G, 0.08, 0.05, 0.62, 0.05, P.woodDark, { r: 0 })
        k.box(0.29, G + 0.58, 0.08, 0.14, 0.035, 0.035, P.woodDark, { r: 0 })
        lantern(k, 0.24, G + 0.47, 0.08)
    }
    if (lv >= 3) {
        // Hoist swinging a bucket of ore.
        k.box(-0.72, G, 0.52, 0.07, 1.1, 0.07, P.wood, { r: 0 })
        k.beam(v3(-0.72, G + 1.06, 0.52), v3(-0.3, G + 1.06, 0.52), 0.06, 0.06, P.woodDark)
        k.beam(v3(-0.72, G + 0.7, 0.52), v3(-0.5, G + 1.04, 0.52), 0.04, 0.04, P.woodDark)
        k.log(-0.32, G + 1.0, 0.52, 0.035, 0.03, 'z', P.iron, { seg: 8 })
        k.box(-0.32, G + 0.44, 0.52, 0.012, 0.56, 0.012, P.rope, { r: 0 })
        k.cyl(-0.32, G + 0.3, 0.52, 0.075, 0.06, 0.14, P.woodDark, { seg: 8, cap: P.woodDeep })
        k.ball(-0.32, G + 0.45, 0.52, 0.05, P.gold, { detail: 0 })
    }
    if (lv >= 5) {
        // Assay hut, gold bars and a pennant.
        halfTimber(k, 0.58, G, 0.52, 0.44, 0.36, 0.36, { studs: 0.22 })
        doorAt(k, 0.64, G, 0.7, 0, { w: 0.13, h: 0.26 })
        gableRoof(k, 0.58, G + 0.36, 0.52, 0.44, 0.36, 0.24, TILE, { overhang: 0.07, endOverhang: 0.04, gable: P.plaster, barge: P.beam, course: 0.1 })
        for (const [x, y, c] of [[0.3, G, P.gold], [0.42, G, P.goldDeep], [0.36, G + 0.05, P.gold]] as const) k.box(x, y, 0.08, 0.1, 0.05, 0.06, c, { r: 0.01 })
        nuggets(k, -0.22, G, 0.28, true)
        flagPole(k, 0.84, G, -0.22, 1.1, P.banner, Math.PI)
    }
}

function buildLumbercamp(k: Kit, lv: number): void {
    yard(k, 0.94, P.dirtLight, P.dirtDark)
    // Log cabin with notched corners, shingle roof and (level 3+) a stone chimney.
    const cx = -0.3
    const cz = -0.3
    const w = 0.86
    const d = 0.74
    let y0 = G
    if (lv >= 4) {
        masonry(k, cx, G, cz, w + 0.1, 0.1, d + 0.1, { course: 0.1 })
        y0 += 0.1
    }
    const r = 0.047
    const n = lv >= 3 ? 6 : 5
    const step = 0.088
    k.box(cx, y0, cz, w - 0.05, n * step + 0.02, d - 0.05, P.woodDeep, { r: 0 })
    for (let i = 0; i < n; i++) {
        const ya = y0 + r + i * step
        for (const s of SIGNS) {
            k.log(cx, ya, cz + s * d / 2, r, w + 0.14, 'x', at(LOGS, i + (s > 0 ? 0 : 1)), { seg: 6, cap: P.cut })
            k.log(cx + s * w / 2, ya + step / 2, cz, r, d + 0.14, 'z', at(LOGS, i + (s > 0 ? 1 : 2)), { seg: 6, cap: P.cut })
        }
    }
    const wallTop = y0 + (n - 0.5) * step + r * 2 - 0.02
    const front = cz + d / 2 + r
    doorAt(k, cx + 0.2, y0, front - 0.004, 0, { w: 0.18, h: 0.32 })
    windowAt(k, cx - 0.18, y0 + 0.25, front - 0.006, 0, { w: 0.12, h: 0.12, shutter: 0x5f6b4d })
    if (lv >= 3) windowAt(k, cx + w / 2 + r, y0 + 0.27, cz, Math.PI / 2, { w: 0.11, h: 0.11 })
    gableRoof(k, cx, wallTop, cz, w + 0.14, d + 0.1, 0.4, SHINGLE, { gable: P.woodLight, gableInset: 0.07, barge: P.woodDark, endOverhang: 0.05 })
    if (lv >= 3) chimney(k, cx - w / 2 - 0.08, G, cz - 0.1, wallTop + 0.52 - G, 0.15)

    // Felled trunks along the back right: a 3-2-1 pile, a braced square stack from level 4.
    const lx = [0.38, 0.56, 0.74]
    const rows: readonly (readonly number[])[] = lv >= 4 ? [lx, lx, lx] : [lx, [0.47, 0.65], [0.56]]
    rows.forEach((row, ri) => {
        const ry = G + 0.085 + ri * (lv >= 4 ? 0.17 : 0.148)
        for (const x of row) k.log(x, ry, -0.47, 0.085, 0.62, 'z', at(LOGS, ri + Math.round(x * 10)), { seg: 7, cap: P.cut })
    })
    if (lv >= 4) {
        for (const x of [0.27, 0.86]) {
            for (const z of [-0.24, -0.7]) k.box(x, G, z, 0.045, 0.6, 0.045, P.woodDeep, { r: 0 })
        }
    }

    // Saw horse with a log being cut, and sawdust.
    k.ball(0.5, G - 0.02, 0.46, 0.16, P.cut, { detail: 0, s: [1.4, 0.2, 1] })
    for (const x of [0.32, 0.68]) {
        for (const s of SIGNS) k.beam(v3(x, G, 0.46 + s * 0.12), v3(x, G + 0.36, 0.46 - s * 0.03), 0.035, 0.035, P.woodDark)
    }
    k.log(0.5, G + 0.4, 0.46, 0.085, 0.6, 'x', P.wood, { seg: 7, cap: P.cut })
    k.box(0.56, G + 0.3, 0.46, 0.012, 0.16, 0.26, P.steel, { r: 0 })
    k.box(0.56, G + 0.46, 0.64, 0.03, 0.08, 0.07, P.woodDark, { r: 0 })
    // Old stumps.
    k.cyl(0.8, G, 0.1, 0.08, 0.1, 0.1, P.trunk, { seg: 7, cap: P.cut })
    k.cyl(0.15, G, 0.8, 0.07, 0.09, 0.08, P.trunk, { seg: 7, cap: P.cut })

    if (lv >= 2) {
        // Chopping block with an axe, and a stack of split firewood.
        k.cyl(-0.64, G, 0.62, 0.11, 0.13, 0.17, P.wood, { seg: 8, cap: P.cut })
        k.beam(v3(-0.62, G + 0.17, 0.62), v3(-0.5, G + 0.4, 0.62), 0.025, 0.025, P.woodLight)
        k.box(-0.63, G + 0.14, 0.62, 0.1, 0.07, 0.018, lv >= 5 ? P.ochre : P.steel, { r: 0, rz: -0.5 })
        for (let row = 0; row < 3; row++) {
            for (let i = 0; i < 4 - row; i++) k.log(-0.3 + i * 0.075 + row * 0.037, G + 0.035 + row * 0.064, 0.66, 0.034, 0.26, 'z', at(LOGS, i + row), { seg: 5, cap: P.cut })
        }
    }
    if (lv >= 5) {
        flagPole(k, 0.86, G, 0.26, 1.05, P.banner, Math.PI)
        k.box(0.6, G, 0.12, 0.04, 0.5, 0.04, P.woodDark, { r: 0 })
        lantern(k, 0.6, G + 0.5, 0.12)
    }
}

function buildStonemason(k: Kit, lv: number): void {
    yard(k, 0.94, P.paving, P.pavingDark)
    const wx = -0.3
    const wz = -0.42
    const w = 1.06
    const d = 0.66
    // Workshop: coursed back and side walls, open front on posts, slate roof.
    masonry(k, wx, G, wz - d / 2 + 0.06, w, 0.6, 0.12, { course: 0.15 })
    masonry(k, wx - w / 2 + 0.06, G, wz, 0.12, 0.6, d, { course: 0.15 })
    for (const [x, z] of [[wx + w / 2 - 0.04, wz + d / 2 - 0.04], [wx + 0.05, wz + d / 2 - 0.04], [wx + w / 2 - 0.04, wz - d / 2 + 0.04]] as const) k.box(x, G, z, 0.07, 0.6, 0.07, P.wood, { r: 0 })
    k.box(wx, G + 0.56, wz + d / 2 - 0.04, w, 0.06, 0.07, P.beam, { r: 0 })
    k.box(wx + w / 2 - 0.04, G + 0.56, wz, 0.07, 0.06, d, P.beam, { r: 0 })
    for (const s of SIGNS) k.beam(v3(wx + 0.05 + s * 0.02, G + 0.4, wz + d / 2 - 0.04), v3(wx + 0.05 + s * 0.16, G + 0.56, wz + d / 2 - 0.04), 0.03, 0.03, P.beam)
    gableRoof(k, wx, G + 0.6, wz, w, d + 0.04, 0.36, SLATE, { gable: P.plaster, timber: P.beam, barge: P.beam, overhang: 0.08, endOverhang: 0.05 })
    // Workbench with a block being dressed, mallet and chisel.
    k.box(wx + 0.1, G, wz + 0.02, 0.5, 0.26, 0.24, P.woodDark, { r: 0.01, open: true })
    k.box(wx + 0.1, G + 0.26, wz + 0.02, 0.54, 0.03, 0.27, P.plank, { r: 0 })
    k.box(wx + 0.02, G + 0.29, wz + 0.02, 0.18, 0.14, 0.16, P.stoneLight, { r: 0.01 })
    k.box(wx + 0.22, G + 0.29, wz + 0.06, 0.1, 0.05, 0.05, P.woodLight, { r: 0.01, ry: 0.5 })
    k.box(wx + 0.2, G + 0.29, wz - 0.04, 0.012, 0.012, 0.12, P.steelDark, { r: 0, ry: 0.3 })
    // Finished blocks stacked inside.
    for (let i = 0; i < 3; i++) k.box(wx - 0.32, G + i * 0.12, wz - 0.12 + (i % 2) * 0.02, 0.18, 0.12, 0.24, at(STONE, i), { r: 0 })

    // Pallet of cut blocks out front.
    k.box(0.55, G, 0.5, 0.44, 0.04, 0.4, P.plank, { r: 0 })
    for (const sx of SIGNS) {
        for (const sz of SIGNS) k.box(0.55 + sx * 0.105, G + 0.04, 0.5 + sz * 0.095, 0.2, 0.16, 0.18, at(STONE, sx + sz * 2 + 3), { r: 0.008 })
    }
    k.box(0.55, G + 0.2, 0.5, 0.2, 0.16, 0.18, P.stoneLight, { r: 0.008, ry: 0.15 })
    // A raw boulder waiting for the chisel, and chips.
    k.with(0.03, 0.08, () => k.crag(0.6, 0.2, -0.5, 0.28, P.rock, { s: [1, 0.85, 1] }))
    for (let i = 0; i < 7; i++) k.box(0.2 + jit(0.25), G, 0.1 + jit(0.3), 0.04, 0.025, 0.035, at(STONE, i), { r: 0, ry: rand() * 3 })

    if (lv >= 2) {
        k.box(-0.5, G, 0.55, 0.5, 0.04, 0.42, P.plank, { r: 0 })
        for (const sx of SIGNS) {
            for (const sz of SIGNS) k.box(-0.5 + sx * 0.115, G + 0.04, 0.55 + sz * 0.1, 0.22, 0.17, 0.19, at(STONE, sx - sz + 4), { r: 0.008 })
        }
        if (lv >= 3) {
            k.box(-0.56, G + 0.21, 0.55, 0.22, 0.17, 0.19, P.stoneLight, { r: 0.008, ry: 0.1 })
            k.box(-0.36, G + 0.21, 0.56, 0.18, 0.17, 0.18, P.stoneMid, { r: 0.008, ry: -0.2 })
        }
    }
    if (lv >= 3) {
        // Shear-leg crane lifting a block, and the forge chimney.
        const apex = v3(0.62, G + 1.0, 0.04)
        for (const [dx, dz] of [[0.24, 0.2], [-0.2, 0.2], [0.02, -0.3]] as const) k.beam(v3(0.62 + dx, G, 0.04 + dz), apex, 0.045, 0.045, P.wood)
        k.log(0.62, G + 0.97, 0.04, 0.035, 0.03, 'x', P.iron, { seg: 8 })
        k.box(0.62, G + 0.46, 0.04, 0.012, 0.5, 0.012, P.rope, { r: 0 })
        k.box(0.62, G + 0.28, 0.04, 0.18, 0.16, 0.16, P.stoneLight, { r: 0.008 })
        chimney(k, wx - w / 2 + 0.08, G, wz - d / 2 + 0.08, 1.35, 0.2)
        k.box(wx - w / 2 + 0.08, G + 1.4, wz - d / 2 + 0.08, 0.1, 0.02, 0.1, P.ember, { r: 0 })
    }
    if (lv >= 4) {
        // A finished column with a gilded capital.
        k.box(0.1, G, 0.64, 0.24, 0.1, 0.24, P.stoneMid, { r: 0.01 })
        k.cyl(0.1, G + 0.1, 0.64, 0.065, 0.075, 0.42, P.stoneLight, { seg: 10, open: true })
        k.box(0.1, G + 0.52, 0.64, 0.2, 0.06, 0.2, P.ochre, { r: 0.01 })
    }
}

/** Crystal spikes: angle, distance, height, radius, outward tilt, colour. */
const CRYSTAL_SPIKES: readonly (readonly [number, number, number, number, number, number])[] = [
    [0.3, 0.45, 0.55, 0.1, 0.35, P.crystalCyan],
    [2.4, 0.5, 0.48, 0.09, 0.4, P.crystalViolet],
    [4.3, 0.48, 0.5, 0.09, 0.38, P.crystalCyan],
    [5.6, 0.42, 0.42, 0.08, 0.3, P.crystalViolet],
    [1.3, 0.62, 0.4, 0.08, 0.5, P.crystalPink],
    [3.4, 0.6, 0.45, 0.09, 0.45, P.crystalCyan],
    [0.9, 0.44, 0.36, 0.07, 0.25, P.crystalViolet],
    [5.0, 0.66, 0.36, 0.07, 0.55, P.crystalCyan],
    [1.9, 0.72, 0.3, 0.06, 0.6, P.crystalViolet],
    [3.9, 0.72, 0.32, 0.06, 0.6, P.crystalPink]
]

function buildCrystalmine(k: Kit, lv: number): void {
    yard(k, 0.94, P.crystalGround, P.crystalRockDark, 4)
    k.with(0.04, 0.08, () => {
        k.crag(0, 0.04, 0, 0.6, P.crystalRock, { s: [1.22, 0.55, 1.18] })
        k.crag(-0.58, 0.05, 0.52, 0.22, P.crystalRockDark, { ry: 0.4 })
        k.crag(0.58, 0.05, 0.52, 0.2, P.crystalRockDark)
        k.crag(0.56, 0.07, -0.58, 0.26, P.crystalRock, { ry: 1.1 })
        k.crag(-0.6, 0.05, -0.54, 0.2, P.crystalRock, { ry: 2 })
    })
    // Carved pedestal the floating crystal hovers over, runes glowing.
    k.cyl(0, 0.28, 0, 0.3, 0.36, 0.14, P.stoneDark, { seg: 8 })
    k.cyl(0, 0.42, 0, 0.24, 0.28, 0.1, P.stoneMid, { seg: 8 })
    k.cyl(0, 0.52, 0, 0.2, 0.2, 0.02, P.rune, { seg: 8 })
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + Math.PI / 8
        k.box(Math.sin(a) * 0.33, 0.32, Math.cos(a) * 0.33, 0.05, 0.06, 0.015, P.rune, { r: 0, ry: a, rx: 0.16 })
    }
    if (lv >= 2) {
        // Standing stones carved with runes.
        const count = lv >= 3 ? 4 : 2
        for (let i = 0; i < count; i++) {
            const a = Math.PI / 4 + (i * TAU) / count + (lv >= 3 ? 0 : Math.PI / 2)
            const x = Math.sin(a) * 0.72
            const z = Math.cos(a) * 0.72
            k.with(0.05, 0.06, () => k.box(x, 0.02, z, 0.12, 0.52, 0.09, P.crystalRock, { r: 0.03, ry: a, rx: -0.08 }))
            k.box(x + Math.sin(a) * 0.046, 0.18, z + Math.cos(a) * 0.046, 0.03, 0.26, 0.01, P.rune, { r: 0, ry: a, rx: -0.08 })
        }
    }
    if (lv >= 4) {
        k.cyl(0, 0.4, 0, 0.37, 0.37, 0.04, P.ochre, { seg: 8, open: true })
        for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2 + Math.PI / 4
            k.ball(Math.sin(a) * 0.35, 0.54, Math.cos(a) * 0.35, 0.035, P.ochre, { detail: 0 })
        }
    }
    const count = pick([4, 6, 8, 10], lv - 1)
    for (let i = 0; i < count; i++) {
        const spike = CRYSTAL_SPIKES[i]
        if (!spike) continue
        const [a, d, h, r, tilt, color] = spike
        const ground = 0.04 + 0.33 * Math.sqrt(Math.max(0, 1 - (d / 0.74) ** 2))
        k.gem(Math.sin(a) * d, ground + h * 0.36, Math.cos(a) * d, r * 1.05, h * 1.1, color, { rx: tilt * 0.6, ry: a })
    }
}

function buildBarracks(k: Kit): void {
    yard(k, 1.44, P.dirt, P.dirtDark, 8)
    const hz = -0.5
    const w = 2.4
    const d = 1.14
    const wy = G + 0.2
    const wh = 0.64
    masonry(k, 0, G, hz, w + 0.06, 0.2, d + 0.06, { course: 0.1 })
    halfTimber(k, 0, wy, hz, w, wh, d)
    gableRoof(k, 0, wy + wh, hz, w, d, 0.62, TILE, { overhang: 0.12, endOverhang: 0.08, gable: P.plaster, timber: P.beam, barge: P.beam })
    chimney(k, 0.74, wy + wh - 0.1, hz - 0.3, 0.7, 0.16)

    const front = hz + d / 2 + 0.012
    const winFront: WinOpts = { w: 0.14, h: 0.18, shutter: P.teamRoofDark, frame: P.beam }
    for (const bx of bays(w)) {
        if (Math.abs(bx) < 0.1) continue
        if (Math.abs(bx) > 0.5) windowAt(k, bx, wy + wh * 0.64, front, 0, winFront)
        if (Math.abs(bx) > 0.5) windowAt(k, bx, wy + wh * 0.64, hz - d / 2 - 0.012, Math.PI, { w: 0.12, h: 0.16 })
    }
    for (const s of SIGNS) windowAt(k, s * (w / 2 + 0.012), wy + wh * 0.64, hz, s * Math.PI / 2, winFront)
    // Door with a little porch roof and steps.
    doorAt(k, 0, wy, front, 0, { w: 0.26, h: 0.42 })
    k.box(0, wy + 0.5, front + 0.1, 0.46, 0.028, 0.24, P.tileDark, { r: 0, rx: 0.35 })
    for (const s of SIGNS) k.beam(v3(s * 0.2, wy + 0.3, front), v3(s * 0.2, wy + 0.5, front + 0.17), 0.028, 0.028, P.beam)
    k.box(0, G, front + 0.1, 0.36, 0.13, 0.14, P.stoneMid, { r: 0 })
    k.box(0, G, front + 0.2, 0.36, 0.065, 0.1, P.stone, { r: 0 })
    pavers(k, 0, front + 0.3, 0, 1.36, 6)
    for (const s of SIGNS) wallLantern(k, s * 0.3, wy + 0.44, front, 0)

    // Fenced training yard.
    const fy = G - 0.01
    fence(k, [[-1.34, 0.28], [-1.34, 0.8], [-1.34, 1.34], [-0.9, 1.34], [-0.45, 1.34]], fy)
    fence(k, [[1.34, 0.28], [1.34, 0.8], [1.34, 1.34], [0.9, 1.34], [0.45, 1.34]], fy)
    bannerPole(k, -0.34, G, 1.3, 1.3)
    bannerPole(k, 0.34, G, 1.3, 1.3)

    // Weapon rack with spears and kite shields.
    for (const px of [-1.12, -0.6]) k.box(px, G, 0.72, 0.05, 0.5, 0.05, P.woodDark, { r: 0 })
    k.box(-0.86, G + 0.4, 0.72, 0.62, 0.045, 0.045, P.wood, { r: 0 })
    for (const sx of [-1.02, -0.9, -0.78, -0.66]) {
        k.beam(v3(sx, G, 0.66), v3(sx + 0.02, G + 0.66, 0.73), 0.018, 0.018, P.woodLight)
        k.cone(sx + 0.02, G + 0.64, 0.73, 0.022, 0.09, P.steel, { seg: 4 })
    }
    for (const [x, ry] of [[-1.0, 0.1], [-0.74, -0.15]] as const) {
        k.group((s) => {
            s.add(plate(KITE, 1.25, -0.012, 0.006, 0), P.cloth)
            s.add(plate(KITE, 1.1, 0.006, 0.012, 0), P.banner)
        }, x, G + 0.19, 0.8, { rx: -0.25, ry })
    }

    // Training pell with a straw dummy.
    k.cyl(0.8, G, 0.8, 0.03, 0.035, 0.7, P.woodDark, { seg: 6, open: true })
    k.cyl(0.8, G + 0.3, 0.8, 0.1, 0.08, 0.3, P.straw, { seg: 8 })
    k.ball(0.8, G + 0.66, 0.8, 0.075, P.canvas, { detail: 1, s: [1, 1.1, 1] })
    k.box(0.8, G + 0.5, 0.8, 0.44, 0.04, 0.04, P.woodDark, { r: 0 })
    for (const s of SIGNS) k.box(0.8 + s * 0.08, G + 0.34, 0.8, 0.02, 0.24, 0.195, P.rope, { r: 0 })
    k.box(1.1, G, 0.62, 0.05, 0.02, 0.36, P.woodLight, { r: 0, ry: 0.4 })
    // Supplies.
    barrel(k, 1.08, G, 0.2)
    barrel(k, 1.2, G, 0.34, 0.9)
    crate(k, -1.12, G, 0.24, 0.16, 0.2)
    crate(k, -1.12, G + 0.16, 0.24, 0.12, 0.6)
    sack(k, -0.94, G, 0.2)
}

const TARGET_RINGS = [P.targetRed, P.targetWhite, P.targetRed, P.ochre] as const

function buildTarget(k: Kit): void {
    // Discs stacked along local +Y; the caller tilts them to face the archers.
    TARGET_RINGS.forEach((c, i) => k.cyl(0, i ? 0.028 + i * 0.01 : 0, 0, 0.26 - i * 0.065, 0.26 - i * 0.065, i ? 0.01 : 0.038, c, { seg: 12 }))
    k.cyl(0.08, 0.05, 0.05, 0.008, 0.008, 0.2, P.woodLight, { seg: 4, open: true, rz: 0.25 })
    k.box(0.1, 0.19, 0.05, 0.01, 0.05, 0.06, P.fletch, { r: 0, rz: 0.25 })
}

function buildBow(k: Kit): void {
    const curve = new THREE.QuadraticBezierCurve3(v3(0, -0.26, -0.035), v3(0, 0, 0.06), v3(0, 0.26, -0.035))
    k.add(new THREE.TubeGeometry(curve, 10, 0.011, 4, false), P.woodDark)
    k.box(0, -0.26, -0.035, 0.007, 0.52, 0.007, P.bowString, { r: 0 })
    k.cyl(0, -0.035, 0.012, 0.016, 0.016, 0.07, P.leather, { seg: 6, open: true })
}

function buildRange(k: Kit): void {
    yard(k, 1.44, P.sand, P.dirt, 8)
    // Straw-bale butts with targets on easels.
    for (const tx of [-0.85, 0, 0.85]) {
        for (const s of SIGNS) {
            k.box(tx + s * 0.16, G, -1.1, 0.3, 0.2, 0.22, P.straw, { r: 0.04, open: true, ry: s * 0.04 })
            for (const f of [-0.08, 0.08]) k.box(tx + s * 0.16 + f, G, -1.1, 0.014, 0.205, 0.225, P.strawDark, { r: 0, ry: s * 0.04 })
        }
        k.box(tx, G + 0.2, -1.1, 0.32, 0.2, 0.22, P.straw, { r: 0.04, ry: 0.06 })
        for (const s of SIGNS) k.beam(v3(tx + s * 0.2, G, -0.78), v3(tx + s * 0.08, G + 0.62, -0.9), 0.03, 0.03, P.woodDark)
        k.group(buildTarget, tx, G + 0.44, -0.86, { rx: Math.PI / 2 - 0.3 })
    }
    // Shooting line.
    fence(k, [[-1.3, 0.28], [-0.75, 0.28], [-0.2, 0.28], [0.35, 0.28]], G - 0.01, 0.26)
    // Fletcher's shed with a thatched roof.
    halfTimber(k, 0.92, G, 0.92, 0.66, 0.42, 0.44, { studs: 0.3 })
    doorAt(k, 0.92, G, 0.92 + 0.232, 0, { w: 0.18, h: 0.3 })
    windowAt(k, 0.92 + 0.342, G + 0.26, 0.92, Math.PI / 2, { w: 0.1, h: 0.1, shutter: P.teamRoofDark })
    gableRoof(k, 0.92, G + 0.42, 0.92, 0.66, 0.44, 0.34, THATCH, { overhang: 0.09, endOverhang: 0.05, gable: P.plaster, timber: P.beam, course: 0.09 })
    // Bow rack.
    for (const px of [-1.2, -0.6]) k.box(px, G, 0.95, 0.05, 0.56, 0.05, P.woodDark, { r: 0 })
    k.box(-0.9, G + 0.5, 0.95, 0.66, 0.045, 0.045, P.wood, { r: 0 })
    for (const bx of [-1.06, -0.9, -0.74]) k.group(buildBow, bx, G + 0.28, 0.92, { ry: Math.PI / 2 })
    // Arrow barrel.
    barrel(k, 0.18, G, 0.95)
    for (const [ax, az] of [[0.15, 0.92], [0.21, 0.97], [0.17, 1.0], [0.21, 0.91]] as const) {
        k.cyl(ax, G + 0.15, az, 0.007, 0.007, 0.2, P.woodLight, { seg: 4, open: true })
        k.box(ax, G + 0.31, az, 0.012, 0.05, 0.04, P.fletch, { r: 0 })
    }
    // Hay bales and a bench.
    k.box(-0.22, G, 0.98, 0.36, 0.2, 0.24, P.straw, { r: 0.04, open: true, ry: 0.2 })
    k.box(0.5, G, 0.62, 0.4, 0.03, 0.12, P.plank, { r: 0 })
    for (const s of SIGNS) k.box(0.5 + s * 0.16, G, 0.62, 0.03, 0.14, 0.1, P.woodDark, { r: 0 })
    sack(k, 0.48, G + 0.17, 0.62)
    bannerPole(k, 1.3, G, -0.3, 1.2, -Math.PI / 2)
}

function buildTower(k: Kit, lv: number): void {
    yard(k, 0.94, P.dirt, P.dirtDark)
    if (lv <= 1) buildWatchtower(k)
    else buildStoneTower(k, lv >= 3)
}

/** Level 1: a braced timber watchtower on a stone footing with a shingled roof. */
function buildWatchtower(k: Kit): void {
    masonry(k, 0, 0, 0, 1.12, 0.34, 1.12, { course: 0.12, quoin: P.stoneLight })
    const y0 = 0.34
    const y1 = 2.3
    const post = (sx: number, sz: number, y: number): Vec => {
        const o = 0.47 - 0.07 * ((y - y0) / (y1 - y0))
        return v3(sx * o, y, sz * o)
    }
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const
    for (const [sx, sz] of corners) k.beam(post(sx, sz, y0), post(sx, sz, y1 + 0.02), 0.09, 0.09, P.wood)
    const levels = [y0 + 0.03, 1.0, 1.66, y1 - 0.04]
    for (let c = 0; c < 4; c++) {
        const [ax, az] = at(corners, c)
        const [bx, bz] = at(corners, c + 1)
        for (const y of [1.0, 1.66]) k.beam(post(ax, az, y), post(bx, bz, y), 0.06, 0.06, P.woodDark)
        for (let j = 0; j < 3; j++) {
            const lo = at(levels, j)
            const hi = at(levels, j + 1)
            k.beam(post(ax, az, lo), post(bx, bz, hi), 0.045, 0.045, P.woodDark)
            k.beam(post(bx, bz, lo), post(ax, az, hi), 0.045, 0.045, P.woodDark)
        }
    }
    // Platform with plank breastworks.
    for (const s of SIGNS) k.box(0, y1 - 0.06, s * 0.3, 1.42, 0.06, 0.07, P.woodDark, { r: 0 })
    k.box(0, y1, 0, 1.36, 0.07, 1.36, P.plank, { r: 0 })
    const fy = y1 + 0.07
    for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        k.group((g) => {
            for (let i = 0; i < 7; i++) {
                const bh = 0.28 + (i % 3 === 1 ? 0.03 : 0) + jit(0.015)
                g.box(-0.58 + i * 0.194, 0, 0.66, 0.18, bh, 0.04, i % 2 ? P.plank : P.woodLight, { r: 0 })
            }
            g.box(0, 0.12, 0.69, 1.36, 0.04, 0.025, P.woodDark, { r: 0 })
        }, 0, fy, 0, { ry })
    }
    // Roof on four corner posts.
    for (const [sx, sz] of corners) k.box(sx * 0.63, fy, sz * 0.63, 0.07, 0.6, 0.07, P.woodDark, { r: 0 })
    tieredRoof(k, 0, fy + 0.6, 0, 1.6, 1.6, 0.62, SHINGLE, { courses: 4 })
    flagPole(k, 0, fy + 1.15, 0, 0.36, P.banner)
    lantern(k, 0.3, fy + 0.4, 0.62)
    // Arrow bundles and a barrel at the foot.
    crate(k, 0.66, 0, 0.66, 0.16, 0.3)
    barrel(k, -0.7, 0, 0.64)
}

/** Levels 2-3: a round stone tower; fortified adds grey stone, gilt bands, a turret and a banner. */
function buildStoneTower(k: Kit, fort: boolean): void {
    const tones = fort ? FORT : STONE
    const dark = fort ? P.fortDark : P.stoneDark
    const light = fort ? P.fortLight : P.stoneLight
    const shaftTop = fort ? 2.34 : 2.26
    const rBot = 0.62
    const rTop = 0.56
    const s0 = 0.4
    const rAt = (y: number) => rBot + (rTop - rBot) * ((y - s0) / (shaftTop - 0.14 - s0))
    k.cyl(0, 0, 0, 0.665, 0.74, 0.36, dark, { seg: 12, open: true })
    k.cyl(0, 0.36, 0, 0.665, 0.665, 0.04, light, { seg: 12 })
    roundMasonry(k, 0, s0, 0, rBot, rTop, shaftTop - 0.14 - s0, { tones })
    k.cyl(0, 1.32, 0, rAt(1.32) + 0.02, rAt(1.32) + 0.02, 0.045, light, { seg: 12, open: true })
    if (fort) k.cyl(0, 1.28, 0, rAt(1.28) + 0.012, rAt(1.28) + 0.012, 0.03, P.ochre, { seg: 12, open: true })
    // Door with steps, arrow slits.
    doorAt(k, 0, s0, rAt(0.6) - 0.01, 0, { w: 0.26, h: 0.4, arch: true, surround: light })
    k.box(0, 0, 0.77, 0.36, 0.26, 0.1, P.stoneMid, { r: 0 })
    k.box(0, 0, 0.86, 0.36, 0.13, 0.1, P.stone, { r: 0 })
    for (const y of [0.95, 1.7]) {
        for (let i = 0; i < 4; i++) slit(k, 0, 0, Math.PI / 4 + i * Math.PI / 2, rAt(y + 0.08) - 0.005, y, 0.18, light)
    }
    // Corbels, platform, crenellated parapet.
    const cy = shaftTop - 0.14
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU
        k.box(Math.sin(a) * (rTop + 0.02), cy, Math.cos(a) * (rTop + 0.02), 0.08, 0.14, 0.09, P.stoneMid, { r: 0, ry: a })
    }
    k.cyl(0, shaftTop, 0, 0.72, 0.72, 0.1, light, { seg: 12, cap: P.paving })
    const floorY = shaftTop + 0.1
    k.add(ringWall(0.6, 0.72, 0.14, 12), tones[0], 0, floorY, 0)
    for (let i = 0; i < 8; i++) {
        const a = ((i + 0.5) / 8) * TAU
        k.box(Math.sin(a) * 0.66, floorY + 0.14, Math.cos(a) * 0.66, 0.24, 0.17, 0.12, at(tones, i), { r: 0, ry: a })
    }
    if (fort) {
        k.cyl(0, shaftTop - 0.02, 0, 0.73, 0.73, 0.03, P.ochre, { seg: 12, open: true })
        roundMasonry(k, -0.22, floorY, -0.22, 0.2, 0.19, 0.5, { tones, seg: 10, course: 0.17 })
        k.cyl(-0.22, floorY + 0.5, -0.22, 0.23, 0.23, 0.05, light, { seg: 10, open: true })
        tieredCone(k, -0.22, floorY + 0.55, -0.22, 0.28, 0.55, TEAM_ROOF, { seg: 10, courses: 3 })
        flagPole(k, -0.22, floorY + 1.05, -0.22, 0.34, P.banner)
        k.group(b => bannerPiece(b, true), 0, cy - 0.02, rAt(cy - 0.3) + 0.012, { ry: 0 })
    }
    barrel(k, 0.62, G, 0.6)
    crate(k, -0.62, G, 0.64, 0.15, 0.5)
}

const BUILDING_BUILDERS: Record<Exclude<BuildingKind, 'wall' | 'gate'>, (k: Kit, lv: number) => void> = {
    keep: buildKeep,
    goldmine: buildGoldmine,
    lumbercamp: buildLumbercamp,
    stonemason: buildStonemason,
    crystalmine: buildCrystalmine,
    barracks: buildBarracks,
    range: buildRange,
    tower: buildTower
}

const buildingCache = new Map<string, THREE.BufferGeometry>()

/** Static building geometry for kind+level. Origin at the footprint centre on the ground. Not for 'wall' or 'gate'. */
export function buildingGeometry(kind: BuildingKind, level: number): THREE.BufferGeometry {
    if (kind === 'wall') return wallGeometry(level)
    if (kind === 'gate') return gateGeometry(level)
    const levels = BUILDINGS[kind].hp.length
    const lv = Math.min(Math.max(Math.round(level) || 1, 1), levels)
    const builder = BUILDING_BUILDERS[kind]
    return cached(buildingCache, `${kind}:${lv}`, k => builder(k, lv), BUILDING_SHADE)
}

// ─── Walls and gates (fallbacks; the renderer draws these with wall-kit.ts) ─

/** Height units stand at on top of a wall (every tier). */
const WALK_Y = 1.05

const clampTier = (tier: number) => Math.min(Math.max(Math.round(tier) || 1, 1), 3)

const wallCache = new Map<number, THREE.BufferGeometry>()

/**
 * Wall segment for a tier (1 wood, 2 stone, 3 fortified), filling x,z in
 * [-0.5, 0.5]. The inner half is a walkway at y = 1.05 where archers stand;
 * the parapet runs along the outer (+Z) edge.
 */
export function wallGeometry(tier: number): THREE.BufferGeometry {
    const t = clampTier(tier)
    return cached(wallCache, t, (k) => {
        if (t === 1) {
            k.box(0, 0, -0.17, 1, 0.97, 0.66, P.woodDark, { r: 0 })
            k.box(0, 0.97, -0.17, 1, WALK_Y - 0.97, 0.66, P.plank, { r: 0 })
            for (const x of [-0.34, 0, 0.34]) {
                k.cyl(x, 0, 0.33, 0.17, 0.17, 1.34, x === 0 ? P.woodLight : P.wood, { seg: 6, open: true })
                k.cone(x, 1.34, 0.33, 0.17, 0.2, P.cut, { seg: 6, open: true })
            }
            k.log(0, 0.72, 0.13, 0.06, 1, 'x', P.woodDeep, { seg: 6, open: true })
        } else if (t === 2) {
            k.box(0, 0, 0, 1, 0.36, 1, P.stoneMid, { r: 0 })
            k.box(0, 0.36, 0, 1, 0.61, 1, P.stone, { r: 0 })
            k.box(0, 0.97, -0.1, 1, WALK_Y - 0.97, 0.8, P.walkway, { r: 0 })
            k.box(0, 0.97, 0.4, 1, 0.27, 0.2, P.stone, { r: 0 })
            for (const x of [-0.25, 0.25]) k.box(x, 1.24, 0.4, 0.28, 0.18, 0.2, P.stoneLight, { r: 0 })
        } else {
            k.box(0, 0, 0, 1, 0.42, 1, P.fortDark, { r: 0 })
            k.box(0, 0.42, 0, 1, 0.48, 1, P.fort, { r: 0 })
            k.box(0, 0.9, 0, 1, 0.07, 1, P.fortTrim, { r: 0 })
            k.box(0, 0.97, -0.11, 1, WALK_Y - 0.97, 0.78, P.walkway, { r: 0 })
            k.box(0, 0.97, 0.39, 1, 0.34, 0.22, P.fort, { r: 0 })
            for (const x of [-0.33, 0, 0.33]) k.box(x, 1.31, 0.39, 0.2, 0.2, 0.22, P.fortDark, { r: 0 })
            k.box(0, 0.5, 0.505 - 0.01, 0.08, 0.28, 0.02, P.dark, { r: 0 })
        }
    })
}

const gateCache = new Map<number, THREE.BufferGeometry>()

/** Gate for a tier: posts at x = ±0.41, raised portcullis between them, passage along Z. */
export function gateGeometry(tier: number): THREE.BufferGeometry {
    const t = clampTier(tier)
    return cached(gateCache, t, (k) => {
        const postH = pick([1.3, 1.38, 1.5], t - 1)
        const post = pick([P.woodDark, P.stoneMid, P.fort], t - 1)
        const lintel = pick([P.wood, P.stone, P.fortDark], t - 1)
        const roof = pick([P.roofRed, P.roofSlate, P.fortTrim], t - 1)
        const bar = t === 1 ? P.woodDeep : P.iron
        for (const sx of SIGNS) k.box(sx * 0.41, 0, 0, 0.18, postH, 1, post, { r: 0.04, open: true })
        k.box(0, 1.02, 0, 0.66, 0.2, 0.6, lintel, { r: 0.03 })
        if (t === 3) k.box(0, 1.2, 0, 0.68, 0.04, 0.62, P.gold, { r: 0.01 })
        k.roof(0, postH, 0, 1, 0.72, 0.26, roof, { gable: lintel, ridge: t === 3 ? P.gold : undefined })
        for (const bx of [-0.22, -0.075, 0.075, 0.22]) {
            k.box(bx, 0.8, 0, 0.04, 0.24, 0.04, bar, { r: 0 })
            k.cone(bx, 0.72, 0, 0.03, 0.08, t === 3 ? P.gold : bar, { seg: 4, rx: Math.PI })
        }
        for (const by of [0.84, 0.97]) k.box(0, by, 0, 0.62, 0.04, 0.04, bar, { r: 0 })
        for (const sx of SIGNS) {
            for (const sz of SIGNS) {
                const x = sx * 0.41
                const z = sz * 0.42
                if (t === 1) {
                    k.cone(x, postH, z, 0.08, 0.16, P.cut, { seg: 6, open: true })
                } else {
                    k.box(x, postH, z, 0.18, 0.16, 0.16, post, { open: true })
                    if (t === 3) k.ball(x, postH + 0.22, z, 0.05, P.gold, { detail: 0 })
                }
            }
        }
    })
}

// ─── Nature ─────────────────────────────────────────────────────────────────

const TREE_SHADE: Shade = { h: 1.3, s: 0.38 }

/** A broadleaf crown: rounded clumps with per-facet variation. */
function crown(k: Kit, clumps: readonly (readonly [number, number, number, number, number, number])[]): void {
    k.with(0.04, 0.07, () => {
        for (const [x, y, z, r, color, detail] of clumps) k.ball(x, y, z, r, color, { detail, s: [1.08, 0.86, 1.04], ry: x * 7 })
    })
}

const TREE_BUILDERS: readonly ((k: Kit) => void)[] = [
    // Oak: short stout trunk, two limbs, a wide crown.
    (k) => {
        k.cone(0, 0, 0, 0.13, 0.12, P.trunkDark, { seg: 6, open: true })
        k.seg(v3(0, 0, 0), v3(0.03, 0.6, 0), 0.08, 0.055, P.trunk, { seg: 6, open: true })
        k.seg(v3(0.02, 0.44, 0), v3(0.2, 0.68, 0.06), 0.04, 0.022, P.trunk, { seg: 5, open: true })
        k.seg(v3(0.02, 0.5, 0), v3(-0.17, 0.72, -0.07), 0.035, 0.02, P.trunk, { seg: 5, open: true })
        crown(k, [[0, 0.86, 0, 0.3, P.leafB, 1], [0.2, 0.8, 0.09, 0.21, P.leafA, 1], [-0.18, 0.84, -0.07, 0.21, P.leafC, 1], [0.03, 1.07, -0.02, 0.18, P.leafA, 0], [-0.05, 0.72, 0.2, 0.15, P.leafB, 0]])
    },
    // Tall broadleaf.
    (k) => {
        k.cone(0, 0, 0, 0.11, 0.1, P.trunkDark, { seg: 6, open: true })
        k.seg(v3(0, 0, 0), v3(-0.02, 0.82, 0.02), 0.07, 0.045, P.trunk, { seg: 6, open: true })
        k.seg(v3(-0.01, 0.6, 0.01), v3(0.14, 0.86, -0.05), 0.03, 0.018, P.trunk, { seg: 5, open: true })
        crown(k, [[0, 0.98, 0, 0.26, P.leafA, 1], [0.04, 1.24, 0.02, 0.21, P.leafC, 1], [-0.15, 1.06, 0.1, 0.17, P.leafB, 0], [0.16, 1.02, -0.08, 0.17, P.leafB, 1], [0.02, 1.44, -0.02, 0.12, P.leafC, 0]])
    },
    // Birch: pale trunk with dark marks, light airy crown.
    (k) => {
        k.seg(v3(0, 0, 0), v3(0.06, 0.7, 0), 0.05, 0.032, P.birch, { seg: 6, open: true })
        k.seg(v3(0.06, 0.7, 0), v3(0.04, 1.0, 0.02), 0.032, 0.018, P.birch, { seg: 5, open: true })
        for (const [y, ry] of [[0.18, 0.3], [0.36, 2.1], [0.55, 4.0], [0.28, 5.2]] as const) k.box(0.014 + y * 0.085, y, 0, 0.1, 0.018, 0.1, P.trunkDark, { r: 0, ry })
        crown(k, [[0.05, 0.88, 0, 0.2, P.leafD, 1], [0.12, 1.08, 0.04, 0.15, P.leafE, 0], [-0.08, 1.0, -0.05, 0.15, P.leafD, 0], [0.06, 1.22, -0.02, 0.12, P.leafC, 0], [-0.04, 0.76, 0.12, 0.12, P.leafE, 0]])
    },
    // Fir: layered skirts.
    (k) => {
        k.cyl(0, 0, 0, 0.045, 0.065, 0.3, P.trunk, { seg: 6, open: true })
        k.with(0.03, 0.08, () => {
            for (let i = 0; i < 5; i++) {
                const r = 0.44 - i * 0.075
                const y = 0.2 + i * 0.2
                k.cyl(jit(0.02), y, jit(0.02), r * 0.22, r, 0.3 - i * 0.015, at(PINES, i), { seg: 8, open: true, ry: i * 0.5 })
            }
            k.cone(0, 1.18, 0, 0.1, 0.24, P.pineC, { seg: 6, open: true })
        })
    },
    // Tall spruce.
    (k) => {
        k.cyl(0, 0, 0, 0.04, 0.06, 0.34, P.trunk, { seg: 6, open: true })
        k.with(0.03, 0.08, () => {
            for (let i = 0; i < 6; i++) {
                const r = 0.34 - i * 0.045
                const y = 0.24 + i * 0.2
                k.cyl(jit(0.015), y, jit(0.015), r * 0.2, r, 0.3, at(PINES, i + 1), { seg: 7, open: true, ry: i * 0.9 })
            }
            k.cone(0, 1.42, 0, 0.08, 0.26, P.pineC, { seg: 6, open: true })
        })
    },
    // Pine: tall bare trunk under a flat, dark crown.
    (k) => {
        k.seg(v3(0, 0, 0), v3(0.05, 0.55, 0.02), 0.055, 0.042, P.trunk, { seg: 6, open: true })
        k.seg(v3(0.05, 0.55, 0.02), v3(0.02, 1.02, 0), 0.042, 0.026, P.trunk, { seg: 6, open: true })
        k.seg(v3(0.04, 0.8, 0.01), v3(0.2, 0.96, 0.04), 0.022, 0.014, P.trunk, { seg: 4, open: true })
        k.with(0.04, 0.08, () => {
            k.ball(0.02, 1.08, 0, 0.26, P.pineB, { s: [1.2, 0.5, 1.15] })
            k.ball(0.2, 1.0, 0.05, 0.16, P.pineA, { s: [1.2, 0.55, 1.1] })
            k.ball(-0.1, 1.2, -0.04, 0.17, P.pineC, { s: [1.2, 0.55, 1.1] })
            k.ball(-0.16, 1.0, 0.1, 0.12, P.pineA, { detail: 0, s: [1.2, 0.6, 1.1] })
        })
    }
]

export const TREE_VARIANTS: number = TREE_BUILDERS.length

const treeCache = new Map<number, THREE.BufferGeometry>()

/** Tree variants 0..TREE_VARIANTS-1 (0-2 broadleaf, 3-4 fir/spruce, the last a pine). Fits within one tile. */
export function treeGeometry(variant: number): THREE.BufferGeometry {
    const v = ((Math.round(variant) % TREE_VARIANTS) + TREE_VARIANTS) % TREE_VARIANTS
    return cached(treeCache, v, k => TREE_BUILDERS[v]?.(k), TREE_SHADE)
}

const ROCK_BUILDERS: readonly ((k: Kit) => void)[] = [
    (k) => {
        k.with(0.03, 0.09, () => {
            k.crag(0, 0.16, 0, 0.34, P.rock, { s: [1.15, 0.72, 1] })
            k.crag(0.3, 0.05, 0.18, 0.13, P.rockDark, { ry: 0.7 })
        })
        k.ball(-0.04, 0.38, -0.03, 0.14, P.moss, { detail: 0, s: [1.5, 0.3, 1.2] })
        tuft(k, -0.28, 0, 0.18, 0.9)
    },
    (k) => {
        k.with(0.03, 0.09, () => {
            k.crag(0, 0.26, 0, 0.32, P.rockLight, { s: [0.85, 1.15, 0.8], ry: 0.4 })
            k.crag(0.26, 0.06, -0.2, 0.16, P.rock, { ry: 1 })
            k.crag(-0.24, 0.04, 0.22, 0.11, P.rockDark, { ry: 1.2 })
        })
        tuft(k, 0.2, 0, 0.22, 0.8)
    },
    (k) => {
        k.with(0.03, 0.09, () => {
            k.crag(-0.14, 0.12, 0, 0.27, P.rockDark, { s: [1.1, 0.7, 1] })
            k.crag(0.2, 0.1, -0.12, 0.2, P.rock, { ry: 0.5 })
            k.crag(0.1, 0.05, 0.24, 0.14, P.rockWarm, { ry: 1.1 })
        })
    },
    (k) => {
        k.with(0.03, 0.09, () => {
            k.crag(0, 0.06, 0, 0.36, P.rockWarm, { s: [1.1, 0.32, 0.95], ry: 0.3 })
            k.crag(0.2, 0.14, -0.06, 0.14, P.rockWarm2, { ry: 2 })
        })
        k.ball(-0.12, 0.17, 0.05, 0.12, P.moss, { detail: 0, s: [1.6, 0.25, 1.2] })
        tuft(k, 0.26, 0, 0.2, 0.9)
        tuft(k, -0.3, 0, -0.14, 0.7)
    }
]

export const ROCK_VARIANTS: number = ROCK_BUILDERS.length

const rockCache = new Map<number, THREE.BufferGeometry>()

/** Rock variants 0..ROCK_VARIANTS-1: irregular flat-shaded boulders within one tile. */
export function rockGeometry(variant: number): THREE.BufferGeometry {
    const v = ((Math.round(variant) % ROCK_VARIANTS) + ROCK_VARIANTS) % ROCK_VARIANTS
    return cached(rockCache, v, k => ROCK_BUILDERS[v]?.(k), { h: 0.3, s: 0.28 })
}

const DECOR_BUILDERS: readonly ((k: Kit) => void)[] = [
    // Grass clump.
    (k) => {
        tuft(k, 0, 0, 0, 1.3, GRASS, 5)
        tuft(k, 0.07, 0, 0.04, 0.9, [P.grassLight, P.grass, P.grassDark], 3)
    },
    // Flowers: white petals so the renderer can tint them.
    (k) => {
        for (const [x, z, h] of [[0, 0, 0.17], [0.05, 0.03, 0.12]] as const) {
            k.seg(v3(x, 0, z), v3(x + 0.01, h, z), 0.008, 0.006, P.stem, { seg: 4, open: true })
            k.ball(x + 0.01, h + 0.01, z, 0.04, P.petal, { detail: 0, s: [1, 0.55, 1] })
            k.ball(x + 0.01, h + 0.028, z, 0.016, P.petalCore, { detail: 0 })
        }
        k.ball(0.02, 0.02, 0.01, 0.04, P.stem, { detail: 0, s: [1.4, 0.35, 1] })
        tuft(k, -0.04, 0, -0.02, 0.6, GRASS, 3)
    },
    // Pebbles.
    (k) => {
        k.with(0.04, 0.1, () => {
            k.crag(0, 0.015, 0, 0.075, P.rock, { s: [1.2, 0.55, 1] })
            k.crag(0.09, 0.008, 0.05, 0.04, P.rockDark, { s: [1, 0.6, 1] })
            k.crag(-0.06, 0.006, 0.07, 0.035, P.rockWarm, { s: [1, 0.6, 1] })
        })
    },
    // Ferns with two little mushrooms.
    (k) => {
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * TAU + 0.3
            k.beam(v3(0, 0.01, 0), v3(Math.sin(a) * 0.15, 0.1, Math.cos(a) * 0.15), 0.045, 0.008, at([P.fern, P.leafB, P.leafA], i))
        }
        for (const [x, z, s] of [[0.1, 0.06, 1], [0.14, -0.02, 0.7]] as const) {
            k.cyl(x, 0, z, 0.018 * s, 0.022 * s, 0.07 * s, P.mushStem, { seg: 6, open: true })
            k.add(new THREE.SphereGeometry(0.05 * s, 8, 3, 0, TAU, 0, Math.PI / 2), P.mushCap, x, 0.062 * s, z, {}, [1, 0.8, 1])
        }
    }
]

export const DECOR_VARIANTS: number = DECOR_BUILDERS.length

const decorCache = new Map<number, THREE.BufferGeometry>()

/** Tiny ground decor: 0 grass clump, 1 flowers (white petals, tint them), 2 pebbles, 3 ferns and mushrooms. */
export function decorGeometry(variant: number): THREE.BufferGeometry {
    const v = ((Math.round(variant) % DECOR_VARIANTS) + DECOR_VARIANTS) % DECOR_VARIANTS
    return cached(decorCache, v, k => DECOR_BUILDERS[v]?.(k))
}

// ─── Units ──────────────────────────────────────────────────────────────────
//
// Soldiers are ~0.64 tall in feet-origin space (the renderer scales them by
// 1.3), with a head about a fifth of their height. `body` is the team-tinted
// tabard/tunic; `bodyTrim` (legs, boots, belt, gloves) is shared by warriors and
// archers; `helmet` adds a nasal helm and mail for warriors; `hood` a hood,
// cowl and quiver for archers.

interface Arm { shoulder: V3, elbow: V3, wrist: V3 }

/** Where the renderer attaches pivoted parts on an idle soldier (feet-origin space, facing +Z; right hand is -X). */
export const UNIT_ANCHORS: { rightHand: [number, number, number], leftHand: [number, number, number], headTop: number } = {
    rightHand: [-0.125, 0.29, 0.07],
    leftHand: [0.125, 0.29, 0.07],
    headTop: 0.64
}

/** Knight anchors (same conventions as UNIT_ANCHORS; knights are ~0.7 tall). */
export const KNIGHT_ANCHORS: { rightHand: [number, number, number], leftHand: [number, number, number], headTop: number } = {
    rightHand: [-0.135, 0.31, 0.075],
    leftHand: [0.135, 0.31, 0.075],
    headTop: 0.7
}

/** Left arm joints of an idle soldier; mirror X for the right arm. */
const ARM: Arm = { shoulder: [0.098, 0.445, -0.005], elbow: [0.118, 0.35, -0.02], wrist: [0.125, 0.3, 0.052] }
const KNIGHT_ARM: Arm = { shoulder: [0.108, 0.475, -0.005], elbow: [0.13, 0.372, -0.02], wrist: [0.135, 0.322, 0.054] }

function joint(p: V3, sx: number): Vec {
    return v3(p[0] * sx, p[1], p[2])
}

function arm(k: Kit, sx: number, j: Arm, rUpper: number, rFore: number, color: number): void {
    const sh = joint(j.shoulder, sx)
    const el = joint(j.elbow, sx)
    const wr = joint(j.wrist, sx)
    k.seg(sh, el.clone().lerp(sh, -0.12), rUpper, rUpper * 0.88, color, { seg: 6, open: true })
    k.seg(el, wr, rFore, rFore * 0.85, color, { seg: 6, open: true })
}

const KITE: readonly Pt[] = [
    [0, 0.135], [0.06, 0.128], [0.086, 0.1], [0.082, 0.03], [0.064, -0.05], [0.036, -0.115],
    [0, -0.165], [-0.036, -0.115], [-0.064, -0.05], [-0.082, 0.03], [-0.086, 0.1], [-0.06, 0.128]
]

const HEATER: readonly Pt[] = [
    [0, 0.125], [0.1, 0.12], [0.1, 0.04], [0.09, -0.03], [0.068, -0.085], [0.036, -0.125],
    [0, -0.145], [-0.036, -0.125], [-0.068, -0.085], [-0.09, -0.03], [-0.1, 0.04], [-0.1, 0.12]
]

/** A shield-shaped plate facing +Z, scaled by `s`, bent back at the sides by `bend`. */
function plate(outline: readonly Pt[], s: number, z0: number, z1: number, bend: number): THREE.BufferGeometry {
    const g = prismXY(outline.map(([x, y]) => [x * s, y * s] as const), z0, z1)
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - bend * p.getX(i) ** 2)
    return flatNormals(g)
}

const UNIT_PART_NAMES = [
    'body', 'bodyTrim', 'head', 'helmet', 'hood', 'sword', 'shield', 'shieldEmblem', 'bow',
    'knightBody', 'knightTrim', 'knightHelm', 'knightSword', 'knightShield', 'knightEmblem'
] as const

type UnitPartName = typeof UNIT_PART_NAMES[number]

const UNIT_BUILDERS: Record<UnitPartName, (k: Kit) => void> = {
    body: (k) => {
        k.add(new THREE.CylinderGeometry(0.071, 0.086, 0.12, 8, 1, true), P.offWhite, 0, 0.245, 0, {}, [1, 1, 0.78])
        k.add(new THREE.CylinderGeometry(0.092, 0.07, 0.15, 8, 1, true), P.offWhite, 0, 0.375, 0, {}, [1, 1, 0.7])
        k.add(new THREE.SphereGeometry(0.094, 8, 4), P.offWhite, 0, 0.445, 0, {}, [1.02, 0.36, 0.7])
        // Tabard panels front and back.
        for (const s of SIGNS) k.add(new THREE.BoxGeometry(0.106, 0.28, 0.012), P.white, 0, 0.32, s * 0.07)
        for (const s of SIGNS) arm(k, s, ARM, 0.027, 0.023, P.shade)
    },
    bodyTrim: (k) => {
        for (const s of SIGNS) {
            k.add(softBox(0.05, 0.06, 0.088, 0.018, true), P.boot, s * 0.04, 0.03, 0.012)
            k.seg(v3(s * 0.04, 0.055, 0), v3(s * 0.042, 0.27, -0.004), 0.023, 0.027, P.hose, { seg: 6, open: true })
            k.ball(s * UNIT_ANCHORS.leftHand[0], UNIT_ANCHORS.leftHand[1], UNIT_ANCHORS.leftHand[2], 0.022, P.glove, { detail: 0 })
        }
        k.add(new THREE.CylinderGeometry(0.075, 0.075, 0.024, 8, 1, true), P.belt, 0, 0.29, 0, {}, [1, 1, 0.8])
        k.box(-0.072, 0.21, 0.02, 0.03, 0.05, 0.04, P.leather, { r: 0 })
    },
    head: (k) => {
        k.cyl(0, 0.45, 0, 0.02, 0.022, 0.06, P.skin, { seg: 6, open: true })
        k.ball(0, 0.548, 0.002, 0.056, P.skin, { s: [0.92, 1.05, 0.98] })
        k.add(new THREE.SphereGeometry(0.059, 8, 3, 0, TAU, 0, Math.PI * 0.55), P.hair, 0, 0.552, -0.006, { rx: -0.5 }, [0.95, 1.02, 1])
        k.box(0, 0.516, 0.054, 0.014, 0.022, 0.014, P.skinShade, { r: 0 })
    },
    helmet: (k) => {
        k.cyl(0, 0.566, 0.003, 0, 0.064, 0.085, P.steel, { seg: 8, open: true })
        k.cyl(0, 0.556, 0.003, 0.066, 0.066, 0.018, P.steelDark, { seg: 8, open: true })
        k.box(0, 0.51, 0.064, 0.012, 0.05, 0.008, P.steelDark, { r: 0 })
        // Mail aventail (open at the face), mantle, sleeves and hem under the tabard.
        k.add(new THREE.CylinderGeometry(0.062, 0.08, 0.1, 8, 1, true, 0.95, TAU - 1.9), P.mail, 0, 0.515, 0)
        k.add(new THREE.CylinderGeometry(0.066, 0.104, 0.05, 8, 1, true), P.mail, 0, 0.45, 0, {}, [1, 1, 0.76])
        for (const s of SIGNS) arm(k, s, ARM, 0.031, 0.027, P.mail)
        k.add(new THREE.CylinderGeometry(0.087, 0.091, 0.045, 8, 1, true), P.mail, 0, 0.1725, 0, {}, [1, 1, 0.8])
    },
    hood: (k) => {
        k.add(new THREE.SphereGeometry(0.067, 8, 4, 0, TAU, 0, Math.PI * 0.62), P.white, 0, 0.553, -0.006, { rx: -0.55 }, [0.98, 1.04, 1.02])
        k.add(new THREE.ConeGeometry(0.022, 0.1, 5, 1, true).translate(0, 0.05, 0), P.white, 0, 0.575, -0.05, { rx: -Math.PI / 2 - 0.5 })
        k.add(new THREE.CylinderGeometry(0.058, 0.106, 0.075, 8, 1, true), P.white, 0, 0.445, 0, {}, [1, 1, 0.8])
        // Quiver on the back, strap across the chest.
        k.seg(v3(0.045, 0.27, -0.078), v3(-0.035, 0.49, -0.09), 0.026, 0.028, P.quiver, { seg: 6, cap: P.dark })
        for (let i = 0; i < 3; i++) k.box(-0.05 + i * 0.016, 0.49, -0.09 + (i - 1) * 0.008, 0.01, 0.05, 0.024, P.fletch, { r: 0, rz: 0.35 })
        k.beam(v3(0.07, 0.3, 0.083), v3(-0.075, 0.45, 0.07), 0.016, 0.008, P.leather)
    },
    sword: (k) => {
        k.ball(0, -0.046, 0, 0.015, P.brass, { detail: 0 })
        k.cyl(0, -0.036, 0, 0.01, 0.011, 0.062, P.leather, { seg: 6, open: true })
        k.box(0, 0.024, 0, 0.078, 0.013, 0.016, P.steelDark, { r: 0 })
        k.box(0, 0.037, 0, 0.03, 0.19, 0.008, P.steel, { r: 0 })
        k.add(new THREE.ConeGeometry(0.0212, 0.035, 4).rotateY(Math.PI / 4), P.steel, 0, 0.2445, 0, {}, [1, 1, 0.27])
    },
    shield: (k) => {
        k.add(plate(KITE, 1.07, -0.014, 0.004, 3), P.iron)
        k.add(plate(KITE, 1, -0.01, 0.009, 3), P.cloth)
        k.ball(0, 0.03, 0.021, 0.02, P.brass, { detail: 0, s: [1, 1, 0.7] })
    },
    shieldEmblem: (k) => {
        k.add(plate(KITE, 0.86, 0.006, 0.013, 3), P.white)
    },
    bow: buildBow,
    knightBody: (k) => {
        k.add(new THREE.CylinderGeometry(0.08, 0.1, 0.2, 8, 1, true), P.offWhite, 0, 0.23, 0, {}, [1, 1, 0.8])
        k.add(new THREE.CylinderGeometry(0.1, 0.078, 0.16, 8, 1, true), P.offWhite, 0, 0.405, 0, {}, [1, 1, 0.72])
        k.add(new THREE.SphereGeometry(0.1, 8, 4), P.offWhite, 0, 0.478, 0, {}, [1.02, 0.34, 0.72])
        for (const s of SIGNS) k.add(new THREE.BoxGeometry(0.124, 0.33, 0.012), P.white, 0, 0.295, s * 0.079)
    },
    knightTrim: (k) => {
        for (const s of SIGNS) {
            k.box(s * 0.045, 0, 0.018, 0.054, 0.05, 0.1, P.steelDark, { r: 0 })
            k.seg(v3(s * 0.045, 0.045, 0), v3(s * 0.047, 0.2, -0.004), 0.027, 0.03, P.steel, { seg: 6, open: true })
            k.ball(s * 0.047, 0.2, 0.018, 0.026, P.steel, { detail: 0 })
            const sh = joint(KNIGHT_ARM.shoulder, s)
            const el = joint(KNIGHT_ARM.elbow, s)
            k.add(new THREE.SphereGeometry(0.046, 6, 3, 0, TAU, 0, Math.PI / 2), P.steel, sh.x + s * 0.01, sh.y - 0.012, sh.z, { rz: -s * 0.35 }, [1.1, 0.85, 1.1])
            arm(k, s, KNIGHT_ARM, 0.028, 0.025, P.steel)
            k.ball(el.x, el.y, el.z, 0.026, P.steelDark, { detail: 0 })
            k.box(s * KNIGHT_ANCHORS.leftHand[0], KNIGHT_ANCHORS.leftHand[1] - 0.025, KNIGHT_ANCHORS.leftHand[2], 0.042, 0.05, 0.05, P.steelDark, { r: 0 })
        }
        k.cyl(0, 0.485, 0, 0.045, 0.058, 0.05, P.steel, { seg: 8, open: true })
        k.add(new THREE.CylinderGeometry(0.1, 0.1, 0.026, 8, 1, true), P.belt, 0, 0.33, 0, {}, [1, 1, 0.86])
        k.box(0, 0.318, 0.086, 0.03, 0.026, 0.01, P.brass, { r: 0 })
        k.seg(v3(0.085, 0.31, 0.02), v3(0.11, 0.08, -0.1), 0.014, 0.012, P.leather, { seg: 6 })
    },
    knightHelm: (k) => {
        k.cyl(0, 0.515, 0.004, 0.064, 0.066, 0.13, P.steel, { seg: 10, open: true })
        k.cyl(0, 0.645, 0.004, 0.048, 0.064, 0.028, P.steel, { seg: 10, cap: P.steelDark })
        for (const s of SIGNS) k.box(s * 0.027, 0.594, 0.066, 0.04, 0.011, 0.01, P.dark, { r: 0 })
        k.box(0, 0.53, 0.068, 0.014, 0.058, 0.008, P.brass, { r: 0 })
        k.box(0, 0.606, 0.068, 0.12, 0.014, 0.008, P.steelDark, { r: 0, rx: 0, ry: 0 })
        // Crest: a wreath and a fan (cream, takes the helmet tint).
        k.cyl(0, 0.664, 0.004, 0.05, 0.052, 0.014, P.cream, { seg: 8, open: true })
        k.add(prismXY([[-0.055, 0], [-0.058, 0.03], [-0.035, 0.055], [0, 0.064], [0.035, 0.054], [0.055, 0.028], [0.05, 0]], -0.008, 0.008), P.cream, 0, 0.668, 0.004, { ry: Math.PI / 2 })
    },
    knightSword: (k) => {
        k.add(new THREE.CylinderGeometry(0.019, 0.019, 0.012, 8), P.brass, 0, -0.078, 0, { rx: Math.PI / 2 })
        k.cyl(0, -0.068, 0, 0.011, 0.012, 0.098, P.leather, { seg: 6, open: true })
        k.box(0, 0.03, 0, 0.1, 0.013, 0.018, P.steelDark, { r: 0 })
        k.box(0, 0.043, 0, 0.034, 0.29, 0.009, P.steel, { r: 0 })
        k.add(new THREE.ConeGeometry(0.024, 0.04, 4).rotateY(Math.PI / 4), P.steel, 0, 0.353, 0, {}, [1, 1, 0.27])
    },
    knightShield: (k) => {
        k.add(plate(HEATER, 1.06, -0.014, 0.004, 1.6), P.iron)
        k.add(plate(HEATER, 1, -0.01, 0.009, 1.6), P.cloth)
        for (const s of SIGNS) k.add(new THREE.BoxGeometry(0.012, 0.012, 0.012), P.brass, s * 0.08, 0.1, 0.012)
    },
    knightEmblem: (k) => {
        k.add(plate(HEATER, 0.87, 0.006, 0.013, 1.6), P.white)
    }
}

const unitCache = new Map<UnitPartName, THREE.BufferGeometry>()

const unitPart = (name: UnitPartName) => cached(unitCache, name, UNIT_BUILDERS[name])

/**
 * Unit parts in feet-origin space facing +Z; weapons and shields are pivoted
 * (sword at the grip, shield at its centre, bow at the grip; see
 * UNIT_ANCHORS / KNIGHT_ANCHORS). WHITE parts are for team tinting: body,
 * hood, shieldEmblem, knightBody, knightEmblem. Built lazily.
 */
export const UNIT_PARTS: Record<UnitPartName, THREE.BufferGeometry> = Object.defineProperties({} as Record<UnitPartName, THREE.BufferGeometry>, Object.fromEntries(
    UNIT_PART_NAMES.map(name => [name, { get: () => unitPart(name), enumerable: true }])
))

// ─── Siege engines ──────────────────────────────────────────────────────────

const WHEEL_SEAMS = [-0.045, 0.045] as const

/** Plank wheels with iron tyres and hubs, axis along X. */
function wheel(k: Kit, x: number, y: number, z: number, r: number, t: number, sx: number): void {
    k.log(x, y, z, r, t, 'x', P.iron, { seg: 12, cap: P.wood })
    k.log(x + sx * 0.012, y, z, r * 0.3, t + 0.03, 'x', P.woodDark, { seg: 8, cap: P.iron })
    for (const dz of WHEEL_SEAMS) k.box(x + sx * (t / 2 + 0.001), y - r * 0.9, z + dz * r / 0.15, 0.004, r * 1.8, 0.008, P.woodDark, { r: 0 })
}

/** Pivot of the catapult arm (world space, catapult origin on the ground, facing +Z). */
const CATAPULT_PIVOT: [number, number, number] = [0, 0.27, -0.08]

/** Catapult pieces: rotate `arm` about +X at `armPivot` to throw (about +1.9 rad from rest meets the padded crossbar). */
export interface CatapultParts {
    frame: THREE.BufferGeometry
    arm: THREE.BufferGeometry
    wheels: THREE.BufferGeometry
    /** WHITE, team tinted: the crossbar pad and the pennant. */
    cloth: THREE.BufferGeometry
    armPivot: [number, number, number]
    /** Bucket centre relative to `armPivot` in the rest pose (where a boulder sits). */
    bucket: [number, number, number]
}

function buildCatapultFrame(k: Kit): void {
    const [, py, pz] = CATAPULT_PIVOT
    for (const s of SIGNS) k.box(s * 0.29, 0.13, 0, 0.08, 0.08, 1.1, P.wood, { r: 0.012 })
    for (const z of [-0.5, -0.08, 0.3, 0.5]) k.box(0, 0.135, z, 0.54, 0.07, 0.07, P.woodDark, { r: 0.01 })
    for (const z of [-0.36, 0.36]) k.log(0, 0.15, z, 0.022, 0.8, 'x', P.woodDeep, { seg: 6 })
    // Torsion skein through the rails, iron washers outside.
    k.log(0, py, pz, 0.05, 0.72, 'x', P.rope, { seg: 8 })
    for (const s of SIGNS) {
        k.log(s * 0.35, py, pz, 0.068, 0.03, 'x', P.iron, { seg: 8 })
        k.box(s * 0.35, py - 0.012, pz, 0.036, 0.024, 0.2, P.woodDeep, { r: 0 })
    }
    // Stop frame: uprights, braces and the crossbar the arm slams into.
    for (const s of SIGNS) {
        k.beam(v3(s * 0.28, 0.2, 0.12), v3(s * 0.28, 0.7, 0.12), 0.07, 0.07, P.wood)
        k.beam(v3(s * 0.28, 0.6, 0.12), v3(s * 0.29, 0.21, 0.46), 0.05, 0.05, P.woodDark)
        k.beam(v3(s * 0.28, 0.44, 0.12), v3(s * 0.29, 0.21, -0.04), 0.045, 0.045, P.woodDark)
    }
    k.box(0, 0.63, 0.12, 0.64, 0.07, 0.07, P.woodDark, { r: 0.01 })
    // Windlass at the back.
    k.log(0, 0.17, -0.44, 0.032, 0.5, 'x', P.woodLight, { seg: 8, cap: P.cut })
    for (const s of SIGNS) {
        k.box(s * 0.34, 0.1, -0.44, 0.02, 0.14, 0.03, P.woodDark, { r: 0 })
        k.box(s * 0.34, 0.155, -0.44, 0.02, 0.03, 0.14, P.woodDark, { r: 0 })
    }
    // Ammunition crate at the front.
    k.box(0, 0.17, 0.43, 0.3, 0.07, 0.14, P.woodDark, { r: 0.01 })
    k.with(0.04, 0.1, () => {
        for (const x of [-0.08, 0, 0.08]) k.crag(x, 0.27, 0.43 + x * 0.2, 0.045, P.rock)
    })
    // Pennant pole at the rear corner (its cloth is part of `cloth`).
    k.cyl(0.29, 0.21, -0.52, 0.014, 0.018, 0.62, P.woodDark, { seg: 6, open: true })
    k.ball(0.29, 0.845, -0.52, 0.022, P.ochre, { detail: 0 })
}

function buildCatapultArm(k: Kit): void {
    k.log(0, 0, 0, 0.056, 0.12, 'x', P.woodDark, { seg: 8, cap: P.cut })
    k.beam(v3(0, 0, 0.06), v3(0, -0.015, -0.41), 0.055, 0.06, P.wood)
    for (const z of [-0.14, -0.3]) k.add(new THREE.BoxGeometry(0.065, 0.07, 0.022), P.iron, 0, z * 0.032, z)
    k.cyl(0, -0.045, -0.44, 0.075, 0.058, 0.07, P.woodDark, { seg: 8, cap: P.woodDeep })
    k.cyl(0, 0.015, -0.44, 0.078, 0.078, 0.014, P.iron, { seg: 8, open: true })
}

function buildCatapultWheels(k: Kit): void {
    for (const sx of SIGNS) {
        for (const sz of SIGNS) wheel(k, sx * 0.4, 0.15, sz * 0.36, 0.15, 0.045, sx)
    }
}

function buildCatapultCloth(k: Kit): void {
    k.box(0, 0.625, 0.045, 0.32, 0.085, 0.07, P.white, { r: 0.02 })
    k.add(pennantGeometry(0.3, 0.08, 0.015), P.white, 0.29, 0.75, -0.52, { ry: Math.PI / 2 })
}

/** Catapult (mangonel) ~1.1 long (Z, front +Z), 0.9 wide, ~0.7 tall; origin on the ground at its centre. */
export function catapultGeometry(): CatapultParts {
    return {
        frame: cached(miscCache, 'catapult:frame', buildCatapultFrame),
        arm: cached(miscCache, 'catapult:arm', buildCatapultArm),
        wheels: cached(miscCache, 'catapult:wheels', buildCatapultWheels),
        cloth: catapultCloth(),
        armPivot: [...CATAPULT_PIVOT],
        bucket: [0, 0.03, -0.44]
    }
}

/** WHITE team cloth for the catapult (crossbar pad and pennant), catapult space. */
export function catapultCloth(): THREE.BufferGeometry {
    return cached(miscCache, 'catapult:cloth', buildCatapultCloth)
}

/** Pivot the ram's log hangs from (ram space; the log geometry is relative to it). */
const RAM_PIVOT: [number, number, number] = [0, 0.62, -0.05]

export interface RamParts {
    body: THREE.BufferGeometry
    /** Relative to `logPivot`: swing it by translating along Z or rotating a little about +X at the pivot. */
    log: THREE.BufferGeometry
    logPivot: [number, number, number]
    /** WHITE, team tinted: hides over the roof and a rear banner. */
    cloth: THREE.BufferGeometry
}

function buildRamBody(k: Kit): void {
    for (const s of SIGNS) k.box(s * 0.3, 0.12, 0, 0.07, 0.08, 1.36, P.wood, { r: 0.01 })
    for (const z of [-0.64, -0.22, 0.22, 0.64]) k.box(0, 0.13, z, 0.56, 0.06, 0.06, P.woodDark, { r: 0 })
    for (const z of [-0.45, 0, 0.45]) {
        k.log(0, 0.12, z, 0.02, 0.76, 'x', P.woodDeep, { seg: 6 })
        for (const sx of SIGNS) wheel(k, sx * 0.36, 0.12, z, 0.12, 0.05, sx)
    }
    // Posts and plank skirts along the sides.
    for (const s of SIGNS) {
        for (const z of [-0.64, -0.22, 0.22, 0.64]) k.box(s * 0.3, 0.2, z, 0.06, 0.36, 0.06, P.woodDark, { r: 0 })
        for (let i = 0; i < 2; i++) k.box(s * 0.315, 0.22 + i * 0.1, 0, 0.025, 0.09, 1.34, i % 2 ? P.plank : P.woodLight, { r: 0 })
        k.box(s * 0.3, 0.54, 0, 0.07, 0.05, 1.36, P.wood, { r: 0 })
    }
    // Ridge beam the log hangs from, on two A-frames.
    k.box(0, RAM_PIVOT[1], 0, 0.06, 0.06, 1.3, P.woodDark, { r: 0 })
    for (const z of [-0.6, 0.6]) {
        for (const s of SIGNS) k.beam(v3(s * 0.3, 0.56, z), v3(0, 0.66, z), 0.04, 0.04, P.woodDark)
    }
    // Plank roof (the hides lie on top of it).
    gableRoof(k, 0, 0.58, 0, 1.36, 0.62, 0.2, SHINGLE, { ry: Math.PI / 2, overhang: 0.08, endOverhang: 0.04, course: 0.1 })
    // Front shield boards either side of the log.
    for (const s of SIGNS) k.box(s * 0.19, 0.2, 0.69, 0.18, 0.34, 0.03, P.woodLight, { r: 0 })
    k.box(0, 0.42, 0.69, 0.56, 0.1, 0.03, P.woodDark, { r: 0 })
}

function buildRamLog(k: Kit): void {
    const ly = -0.28
    k.log(0, ly, 0.12, 0.07, 1.36, 'z', P.wood, { seg: 8, cap: P.cut })
    // Iron head and bands.
    k.log(0, ly, 0.82, 0.082, 0.07, 'z', P.iron, { seg: 8 })
    k.add(new THREE.CylinderGeometry(0.03, 0.082, 0.1, 8), P.iron, 0, ly, 0.9, { rx: Math.PI / 2 })
    for (const z of [0.4, -0.2]) k.log(0, ly, z, 0.075, 0.03, 'z', P.iron, { seg: 8 })
    // Chains up to the pivot.
    for (const z of [-0.3, 0.3]) k.box(0, ly, z, 0.016, -ly, 0.016, P.steelDark, { r: 0 })
}

function buildRamCloth(k: Kit): void {
    const roofY = 0.58
    const half = 0.31
    const ang = Math.atan2(0.2, half)
    for (const s of SIGNS) {
        for (const [z, len] of [[-0.42, 0.44], [0.06, 0.42], [0.48, 0.34]] as const) {
            k.add(new THREE.BoxGeometry(0.4, 0.016, len), P.white, s * (half / 2 + 0.03), roofY + 0.1 + 0.05, z, { rz: -s * ang, rx: jit(0.04) })
        }
    }
    k.group(b => bannerPiece(b, false), 0, 0.52, -0.7, { ry: Math.PI }, [0.7, 0.55, 0.7])
}

/** Covered battering ram ~1.4 long (Z, front +Z), 0.8 wide, 0.8 tall; origin on the ground at its centre. */
export function ramGeometry(): RamParts {
    return {
        body: cached(miscCache, 'ram:body', buildRamBody),
        log: cached(miscCache, 'ram:log', buildRamLog),
        logPivot: [...RAM_PIVOT],
        cloth: cached(miscCache, 'ram:cloth', buildRamCloth)
    }
}

/** Siege tower drawbridge hinge (tower space). */
const TOWER_BRIDGE_PIVOT: [number, number, number] = [0, 1.4, 0.4]

export interface SiegeTowerParts {
    body: THREE.BufferGeometry
    /** Built standing (closed) relative to `bridgePivot`; rotate +PI/2 about +X to lower it forward. */
    bridge: THREE.BufferGeometry
    bridgePivot: [number, number, number]
    /** WHITE, team tinted: wet hides on the walls and a banner. */
    cloth: THREE.BufferGeometry
}

function buildSiegeTowerBody(k: Kit): void {
    // Chassis and wheels.
    for (const s of SIGNS) k.box(s * 0.36, 0.1, 0, 0.07, 0.08, 0.86, P.wood, { r: 0.01 })
    for (const s of SIGNS) {
        k.log(0, 0.13, s * 0.3, 0.022, 0.84, 'x', P.woodDeep, { seg: 6 })
        for (const sx of SIGNS) wheel(k, sx * 0.4, 0.13, s * 0.3, 0.13, 0.05, sx)
    }
    // Tapering plank body in courses.
    const y0 = 0.18
    const y1 = 1.55
    const n = 7
    for (let i = 0; i < n; i++) {
        const f0 = i / n
        const f1 = (i + 1) / n
        const wb = 0.82 - 0.14 * f0 - (i % 2) * 0.012
        const wt = 0.82 - 0.14 * f1 - (i % 2) * 0.012
        k.add(frustumBox(wb, wb, wt, wt, (y1 - y0) / n), at([P.plank, P.woodLight, P.plank, P.wood], i), 0, y0 + f0 * (y1 - y0), 0)
    }
    // Corner posts and cross braces.
    const post = (sx: number, sz: number, y: number): Vec => {
        const o = 0.42 - 0.07 * ((y - y0) / (y1 - y0))
        return v3(sx * o, y, sz * o)
    }
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const
    for (const [sx, sz] of corners) k.beam(post(sx, sz, y0), post(sx, sz, y1 + 0.05), 0.06, 0.06, P.woodDark)
    for (let c = 0; c < 4; c++) {
        const [ax, az] = at(corners, c)
        const [bx, bz] = at(corners, c + 1)
        if (c === 2) continue
        k.beam(post(ax, az, 0.3), post(bx, bz, 0.9), 0.04, 0.035, P.woodDark)
        k.beam(post(bx, bz, 0.3), post(ax, az, 0.9), 0.04, 0.035, P.woodDark)
    }
    // Arrow slits and the dark opening behind the drawbridge.
    for (const ry of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
        k.group(g => g.box(0, 0, 0, 0.03, 0.16, 0.02, P.dark, { r: 0 }), Math.sin(ry) * 0.375, 1.05, Math.cos(ry) * 0.375, { ry })
    }
    k.box(0, TOWER_BRIDGE_PIVOT[1], TOWER_BRIDGE_PIVOT[2] - 0.035, 0.46, 0.5, 0.02, P.dark, { r: 0 })
    // Top platform with a crenellated plank parapet.
    const top = y1
    k.box(0, top, 0, 0.8, 0.06, 0.8, P.woodDark, { r: 0 })
    for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        k.group((g) => {
            g.box(0, 0, 0.38, 0.8, 0.14, 0.04, P.plank, { r: 0 })
            for (const t of [-0.3, 0, 0.3]) g.box(t, 0.14, 0.38, 0.14, 0.12, 0.045, P.woodLight, { r: 0 })
        }, 0, top + 0.06, 0, { ry })
    }
    k.cyl(-0.3, top + 0.06, -0.3, 0.016, 0.02, 0.62, P.woodDark, { seg: 6, open: true })
    k.ball(-0.3, top + 0.7, -0.3, 0.024, P.ochre, { detail: 0 })
}

function buildSiegeTowerBridge(k: Kit): void {
    const w = 0.44
    const len = 0.56
    for (const s of SIGNS) k.box(s * (w / 2 - 0.03), 0, 0.01, 0.05, len, 0.035, P.woodDark, { r: 0 })
    for (let i = 0; i < 6; i++) k.box(0, 0.01 + i * (len / 6), 0.03, w, len / 6 - 0.008, 0.022, i % 2 ? P.plank : P.woodLight, { r: 0 })
    for (const s of SIGNS) k.box(s * 0.12, 0, 0.044, 0.03, len * 0.9, 0.008, P.iron, { r: 0 })
    k.log(0, 0, 0, 0.02, w + 0.04, 'x', P.iron, { seg: 6 })
}

function buildSiegeTowerCloth(k: Kit): void {
    // Hides hung down the front and sides.
    for (const [ry, dx] of [[0, -0.2], [0, 0.22], [Math.PI / 2, 0], [-Math.PI / 2, 0.05]] as const) {
        k.group(g => g.box(0, 0, 0, 0.3, 0.5, 0.012, P.white, { r: 0 }), Math.sin(ry) * 0.402 + Math.cos(ry) * dx, 0.42, Math.cos(ry) * 0.402 - Math.sin(ry) * dx, { ry, rx: 0.05 })
    }
    k.add(pennantGeometry(0.34, 0.09, 0.016), P.white, -0.3, 1.55 + 0.6, -0.3, { ry: Math.PI / 2 })
}

/** Wheeled siege tower ~0.9 x 0.9, ~2.2 tall, top platform at 1.55; drawbridge on +Z hinged at the wall walkway height. */
export function siegeTowerGeometry(): SiegeTowerParts {
    return {
        body: cached(miscCache, 'tower:body', buildSiegeTowerBody),
        bridge: cached(miscCache, 'tower:bridge', buildSiegeTowerBridge),
        bridgePivot: [...TOWER_BRIDGE_PIVOT],
        cloth: cached(miscCache, 'tower:cloth', buildSiegeTowerCloth)
    }
}

// ─── Effects and props ──────────────────────────────────────────────────────

const miscCache = new Map<string, THREE.BufferGeometry>()

/** Arrow along +Z from the nock (z = 0) to the tip (z = 1). */
export function arrowGeometry(): THREE.BufferGeometry {
    return cached(miscCache, 'arrow', (k) => {
        k.box(0, -0.025, 0.43, 0.05, 0.05, 0.86, P.woodLight, { r: 0 })
        k.add(new THREE.ConeGeometry(0.075, 0.16, 4), P.iron, 0, 0, 0.92, { rx: Math.PI / 2 })
        k.box(0, -0.07, 0.14, 0.012, 0.14, 0.2, P.fletch, { r: 0 })
        k.box(0, -0.006, 0.14, 0.14, 0.012, 0.2, P.fletch, { r: 0 })
    })
}

/** Heavy ballista bolt along +Z from the tail (z = 0) to the tip (z = 1). */
export function boltGeometry(): THREE.BufferGeometry {
    return cached(miscCache, 'bolt', (k) => {
        k.box(0, -0.035, 0.44, 0.07, 0.07, 0.8, P.wood, { r: 0 })
        k.box(0, -0.042, 0.83, 0.084, 0.084, 0.05, P.iron, { r: 0 })
        k.add(new THREE.ConeGeometry(0.11, 0.2, 4).rotateY(Math.PI / 4), P.iron, 0, 0, 0.9, { rx: Math.PI / 2 })
        for (let i = 0; i < 3; i++) k.add(new THREE.BoxGeometry(0.014, 0.12, 0.26).translate(0, 0.07, 0), P.cloth, 0, 0, 0.13, { rz: (i / 3) * TAU })
    })
}

/** Rough boulder of radius ~1 (scale it), flat-shaded. */
export function boulderGeometry(): THREE.BufferGeometry {
    return cached(miscCache, 'boulder', (k) => {
        k.with(0.02, 0.1, () => k.crag(0, 0, 0, 1, P.rock, { detail: 1, rough: 0.1 }))
    })
}

/** Flat ground ring (XZ plane, normal +Y), inner radius 0.78, outer 1. White. */
export function ringGeometry(): THREE.BufferGeometry {
    return cached(miscCache, 'ring', (k) => {
        k.add(new THREE.RingGeometry(0.78, 1, 32, 1), P.white, 0, 0, 0, { rx: -Math.PI / 2 })
    })
}

/** Flat 16-segment disc of radius 1 in the XZ plane, for blob shadows. White. */
export function blobGeometry(): THREE.BufferGeometry {
    return cached(miscCache, 'blob', (k) => {
        k.add(new THREE.CircleGeometry(1, 16), P.white, 0, 0, 0, { rx: -Math.PI / 2 })
    })
}

/** Triangular pennant (white, team tinted): pivot at the pole attachment, extends along +X ~0.5. */
export function flagGeometry(): THREE.BufferGeometry {
    return cached(miscCache, 'flag', (k) => {
        k.add(pennantGeometry(0.5, 0.14, 0.025), P.white)
    })
}

/** Floating crystal cluster (~0.5 tall), pivot at its centre. */
export function crystalGeometry(): THREE.BufferGeometry {
    return cached(miscCache, 'crystal', (k) => {
        k.gem(0, 0, 0, 0.12, 0.52, P.crystalCyan, { ry: 0.3 })
        k.gem(0.12, -0.07, 0.03, 0.07, 0.3, P.crystalViolet, { rz: -0.45 })
        k.gem(-0.11, -0.06, -0.04, 0.08, 0.32, P.crystalViolet, { rz: 0.45, rx: 0.2 })
        k.gem(0.02, -0.1, 0.11, 0.05, 0.2, P.crystalPink, { rx: 0.5 })
    })
}

/** Unit-size bevelled cube, white, for debris and particles. */
export function debrisGeometry(): THREE.BufferGeometry {
    return cached(miscCache, 'debris', (k) => {
        k.add(softBox(1, 1, 1, 0.14, false), P.white)
    })
}

/** Disposes and forgets every cached geometry; later calls rebuild on demand. */
export function disposeHoldfastModels(): void {
    const caches: { values(): Iterable<THREE.BufferGeometry>, clear(): void }[] = [buildingCache, wallCache, gateCache, treeCache, rockCache, decorCache, unitCache, miscCache]
    for (const cache of caches) {
        for (const geo of cache.values()) geo.dispose()
        cache.clear()
    }
}
