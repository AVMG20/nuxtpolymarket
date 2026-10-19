import * as THREE from 'three'
import { DF_PAP_COLORS } from '#shared/utils/dead-front/weapons'
import type { DfAttachmentChoice, DfWeaponId } from '#shared/utils/dead-front/types'
import { dfHash3 } from '#shared/utils/dead-front/voxel'
import { DfVoxModel, mixHex, scaleHex } from '../voxel/model'
import { dfDotTexture, dfOwnedGlowMat, dfPapMat, dfReticleTexture, dfTickPap, dfWeaponMat } from './materials'
import { DF_XRAY_SCHEMES } from './xray'
import type { DfVoxMaterial } from '../voxel/material'

// Voxel 1900s weapons. Each gun is authored on its own voxel grid (k runs from
// the muzzle, k = 0, back to the butt; j up; i across), with moving parts
// (slide, bolt, pump, magazine, pan) as separate models on the same grid.
// Gun space: metres, origin at the right-hand grip, x right, y up, muzzle
// toward -z. Pack-a-Punch recolours the steel with the tier colour and a
// glowing stripe pattern; attachments add voxel parts.

export type DfReloadStyle = 'mag' | 'side' | 'top' | 'stripper' | 'shell' | 'capsule' | 'coil'

export interface DfGunRig {
    id: DfWeaponId
    root: THREE.Group
    muzzle: THREE.Object3D
    /** The rear sight (notch bottom / aperture / scope eyepiece) on the sight line, gun space. ADS puts it on the camera axis. */
    sight: THREE.Vector3
    /** The front sight (post or bead top / scope objective) on the same sight line. */
    sightFront: THREE.Vector3
    /** Metres from the eye to `sight` while aiming. */
    eyeRelief: number
    /** Left (support) hand rest position, gun space. */
    left: THREE.Vector3
    /** Ejection port, gun space. */
    eject: THREE.Vector3
    slide: THREE.Object3D | null
    bolt: THREE.Object3D | null
    pump: THREE.Object3D | null
    mag: THREE.Object3D | null
    pan: THREE.Object3D | null
    /** Glow material pulsed by the viewmodel (X-Ray, wonder weapon). */
    glow: DfVoxMaterial | null
    reload: DfReloadStyle
    /** Feeds from a drum: the reload plays the drum's wind and clatter. */
    drum: boolean
    scoped: boolean
    lens: THREE.Mesh | null
    long: boolean
}

/** One voxel size for every gun, so they all read as the same craft. */
const VOX = 0.011

// ---------------------------------------------------------------- palette
/** Blued steel: a cool blue-black with lighter worn edges. */
const STEEL = 0x434b58
const STEEL_HI = 0x6c7584
/** Parkerised (phosphate) steel, a dull green-grey. */
const PARK = 0x4c5249
const BLACK = 0x2e3036
const WOOD = 0x8a5634
const WOOD_D = 0x6a4128
const WOOD_L = 0xa06c40
const BRASS = 0xc0953f
const COPPER = 0xa65f2c
const IVORY = 0xe6dec6
const LEATHER = 0x4e3220
const BAKELITE = 0x6a2c1c

// Every colour a gun paints with has a finish. The finish drives the per-voxel
// shading (wood grain, blued steel, polished brass), the bevel pass (lit top
// edges, shadowed undersides) and the Pack-a-Punch recolour.
type Finish = 'metal' | 'wood' | 'brass' | 'other'
const FINISH = new Map<number, Finish>()
/** Bevelled colours: +1 a lit top edge, -1 a shadowed underside. */
const EDGE = new Map<number, number>()
for (const h of [STEEL, STEEL_HI, PARK, BLACK]) FINISH.set(h, 'metal')
for (const h of [WOOD, WOOD_D, WOOD_L, BAKELITE]) FINISH.set(h, 'wood')
for (const h of [BRASS, COPPER]) FINISH.set(h, 'brass')
/** The base palette colour a shade was derived from. */
const ROOT = new Map<number, number>()
const finishOf = (hex: number): Finish => FINISH.get(hex) ?? 'other'
/** A derived colour that keeps its source's finish. */
function derive(hex: number, from: number, edge = 0): number {
    if (!FINISH.has(hex)) FINISH.set(hex, finishOf(from))
    if (!ROOT.has(hex) && hex !== from) ROOT.set(hex, ROOT.get(from) ?? from)
    if (edge && !EDGE.has(hex)) EDGE.set(hex, edge)
    return hex
}

type PartName = 'main' | 'slide' | 'bolt' | 'pump' | 'mag' | 'pan'

/** Authoring helper: boxes on the gun grid, centred across i unless told otherwise. */
class Gun {
    readonly models: Record<PartName, DfVoxModel | null> = { main: null, slide: null, bolt: null, pump: null, mag: null, pan: null }
    cur: DfVoxModel
    readonly ci: number
    /** Free cells ahead of the muzzle (k < 0) for cans, launchers and compensators. */
    readonly ko = 14

    /** Grid height in cells, including the `jo` rows below j = 0. */
    readonly H: number

    /**
     * `jo` rows of headroom below j = 0: parts that hang under the gun (extended
     * magazines) author at negative j and still land on the grid.
     */
    constructor(readonly s: number, readonly L: number, h: number, readonly W: number, readonly jo = 0) {
        this.H = h + jo
        this.cur = this.part('main')
        this.ci = Math.floor(W / 2)
    }

    part(name: PartName): DfVoxModel {
        let m = this.models[name]
        if (!m) this.models[name] = m = new DfVoxModel(this.W, this.H, this.L + this.ko)
        this.cur = m
        return m
    }

    /**
     * Fill for a colour by its finish: wood gets long grain streaks that flow
     * along the stock, blued steel a subtle long-grained sheen with rare worn
     * flecks, brass two close polished tones.
     */
    col(hex: number, glow = 0): (i: number, j: number, k: number) => number {
        const m = this.cur
        if (glow) return () => m.c(hex, glow)
        const f = finishOf(hex)
        const sh = (k: number) => m.c(derive(scaleHex(hex, k), hex))
        if (f === 'wood') {
            const pal = [sh(1.13), sh(1), sh(0.87), sh(0.74)]
            const wave = (hex % 7) * 0.9
            return (i, j, k) => {
                // Grain: bands along k that wander up and down a cell, changing tone every few cells.
                const band = j * 2 + Math.round(Math.sin(k * 0.14 + i * 0.8 + wave) * 1.3)
                if (dfHash3(i, j, k, 13) < 0.006) return pal[3]!
                const h = dfHash3(band, 7, k >> 3, 11)
                return h < 0.28 ? pal[0]! : h < 0.74 ? pal[1]! : pal[2]!
            }
        }
        if (f === 'metal') {
            const a = sh(1.08)
            const b = m.c(hex)
            const wear = sh(1.35)
            return (i, j, k) => {
                if (dfHash3(i, j, k, 17) < 0.008) return wear
                return dfHash3(i, j, k >> 2, 5) < 0.3 ? a : b
            }
        }
        if (f === 'brass') {
            const a = sh(1.1)
            const b = m.c(hex)
            return (i, j, k) => (dfHash3(i, j >> 1, k >> 1, 9) < 0.35 ? a : b)
        }
        const v = m.c(hex)
        return () => v
    }

    /** An ellipse section along k: half-widths rx (across) and ry (up) around (cj, ci + di). */
    oval(k0: number, k1: number, cj: number, rx: number, ry: number, hex: number, di = 0, glow = 0): this {
        cj += this.jo
        const f = this.col(hex, glow)
        const cx = this.ci + 0.5 + di
        const cy = cj + 0.5
        for (let j = Math.floor(cy - ry); j <= Math.ceil(cy + ry); j++) {
            for (let i = Math.floor(cx - rx); i <= Math.ceil(cx + rx); i++) {
                const u = (i + 0.5 - cx) / rx
                const v = (j + 0.5 - cy) / ry
                if (u * u + v * v <= 1.02) this.cur.box(i, j, k0 + this.ko, i + 1, j + 1, k1 + this.ko, f)
            }
        }
        return this
    }

    /** A sling swivel: a small steel loop hanging below (j0 is the surface it hangs from). */
    swivel(k: number, j0: number): this {
        this.box(k, k + 1, j0 - 1, j0, 1, STEEL)
        this.box(k - 1, k + 2, j0 - 3, j0 - 2, 1, STEEL_HI)
        this.box(k - 1, k, j0 - 2, j0 - 1, 1, STEEL_HI).box(k + 1, k + 2, j0 - 2, j0 - 1, 1, STEEL_HI)
        return this
    }

    /** Rivet / screw heads: single bright voxels on both flanks at (k, j), just outside a w-wide body. */
    rivets(ks: number[], j: number, w: number, hex = STEEL_HI): this {
        const half = Math.floor((w - 1) / 2)
        for (const k of ks) {
            this.boxI(k, k + 1, j, j + 1, this.ci - half - 1, this.ci - half, hex)
            this.boxI(k, k + 1, j, j + 1, this.ci + half + 1, this.ci + half + 2, hex)
        }
        return this
    }

    /** Box [k0, k1) x [j0, j1), `w` wide centred (plus `di` offset). */
    box(k0: number, k1: number, j0: number, j1: number, w: number, hex: number, di = 0, glow = 0): this {
        const i0 = this.ci - Math.floor((w - 1) / 2) + di
        this.cur.box(i0, j0 + this.jo, k0 + this.ko, i0 + w, j1 + this.jo, k1 + this.ko, this.col(hex, glow))
        return this
    }

    /** Box with explicit i range. */
    boxI(k0: number, k1: number, j0: number, j1: number, i0: number, i1: number, hex: number, glow = 0): this {
        this.cur.box(i0, j0 + this.jo, k0 + this.ko, i1, j1 + this.jo, k1 + this.ko, this.col(hex, glow))
        return this
    }

    /** A round rod along k with radius r (cells) around (cj, ci + di). */
    rod(k0: number, k1: number, cj: number, r: number, hex: number, di = 0, glow = 0): this {
        cj += this.jo
        const f = this.col(hex, glow)
        const cx = this.ci + 0.5 + di
        const cy = cj + 0.5
        for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) {
            for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
                if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= r * r + 0.01) this.cur.box(i, j, k0 + this.ko, i + 1, j + 1, k1 + this.ko, f)
            }
        }
        return this
    }

    /** A ring (disc minus hole) across the bore at k, radius r1 outer, r0 inner. */
    ring(k0: number, k1: number, cj: number, r0: number, r1: number, hex: number, di = 0, glow = 0): this {
        cj += this.jo
        const f = this.col(hex, glow)
        const cx = this.ci + 0.5 + di
        const cy = cj + 0.5
        for (let j = Math.floor(cy - r1); j <= Math.ceil(cy + r1); j++) {
            for (let i = Math.floor(cx - r1); i <= Math.ceil(cx + r1); i++) {
                const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy)
                if (d <= r1 + 0.05 && d >= r0) this.cur.box(i, j, k0 + this.ko, i + 1, j + 1, k1 + this.ko, f)
            }
        }
        return this
    }

    /** Clears a box (all models). */
    cut(k0: number, k1: number, j0: number, j1: number, i0: number, i1: number): this {
        this.cur.box(i0, j0 + this.jo, k0 + this.ko, i1, j1 + this.jo, k1 + this.ko, 0)
        return this
    }

    /** A sloped run: for each k, a column [lo(k), hi(k)) of `w` width. */
    slope(k0: number, k1: number, lo: (k: number) => number, hi: (k: number) => number, w: number, hex: number, di = 0): this {
        for (let k = k0; k < k1; k++) this.box(k, k + 1, Math.round(lo(k)), Math.round(hi(k)), w, hex, di)
        return this
    }
}

interface Spec {
    gun: Gun
    /** Grip (origin) in voxel coordinates: i is the gun's centre line. */
    grip: [number, number]
    bore: number
    /** Rear sight [k, j]: k is used, the height is measured from the voxels at the centre column. */
    sight: [number, number]
    /** Front sight column k (post or bead). */
    front: number
    eyeRelief: number
    left: [number, number, number]
    eject: [number, number]
    reload: DfReloadStyle
    drum?: boolean
    /** Muzzle column k when a fitting moves it (default: 0, or the Maxim can's mouth). */
    muzzle?: number
    long: boolean
    scoped?: { j: number, k0: number, k1: number }
    /** A red dot sight: the window's centre row j, its front glass k0 and the rear edge k1 the eye looks from. */
    dot?: { j: number, k0: number, k1: number }
    /** Rotation axes for the bolt / pan groups (voxel coords j, k) when they turn. */
    boltAxis?: [number, number]
    panAxis?: [number, number]
    glow?: boolean
}

function has(att: DfAttachmentChoice, slot: keyof DfAttachmentChoice, word: string): boolean {
    return (att[slot] ?? '').includes(word)
}

/** A telescopic sight on mounts along [k0, k1) at bore height j. */
function scope(g: Gun, k0: number, k1: number, j: number): void {
    g.rod(k0 + 3, k1 - 3, j, 1.5, BLACK)
    g.rod(k0, k0 + 4, j, 2.2, BLACK)
    g.rod(k1 - 4, k1, j, 2, BLACK)
    g.box(k0 + 2, k0 + 3, j - 1, j + 2, 1, 0x7aa0c8, 0, 0.5)
    for (const k of [k0 + 6, k1 - 7]) g.box(k, k + 2, j - 4, j - 1, 1, STEEL)
}

/**
 * An open reflex red dot on the receiver top (row `jBase`), 5 cells wide: a base
 * plate, two walls that taper toward the eye, a hood over the front glass and
 * a screw on each wall. The window between the walls stays clear so
 * the aimed view is a clean frame with the dot (a lens quad) in the middle.
 */
function redDot(g: Gun, k0: number, k1: number, jBase: number): { j: number, k0: number, k1: number } {
    const h = 4
    g.box(k0, k1, jBase, jBase + 1, 5, BLACK)
    for (let k = k0; k < k1; k++) {
        const top = jBase + 1 + Math.max(2, h - Math.floor((k - k0) / 2))
        g.boxI(k, k + 1, jBase + 1, top, g.ci - 2, g.ci - 1, BLACK)
        g.boxI(k, k + 1, jBase + 1, top, g.ci + 2, g.ci + 3, BLACK)
    }
    // Hood over the front glass, with bright trim on the lens rim.
    g.box(k0, k0 + 1, jBase + h, jBase + h + 1, 5, BLACK)
    g.boxI(k0, k0 + 1, jBase + 1, jBase + h, g.ci - 2, g.ci - 1, STEEL_HI)
    g.boxI(k0, k0 + 1, jBase + 1, jBase + h, g.ci + 2, g.ci + 3, STEEL_HI)
    // A screw on each wall.
    g.boxI(k1 - 3, k1 - 2, jBase + 2, jBase + 3, g.ci - 2, g.ci - 1, STEEL_HI)
    g.boxI(k1 - 3, k1 - 2, jBase + 2, jBase + 3, g.ci + 2, g.ci + 3, STEEL_HI)
    return { j: jBase + h / 2, k0, k1 }
}

/** A Maxim silencer can ahead of the muzzle: returns how many cells it adds. */
function maxim(g: Gun, kMuzzle: number, bore: number): void {
    g.rod(kMuzzle - 12, kMuzzle, bore, 1.6, BLACK)
    g.ring(kMuzzle - 12, kMuzzle - 11, bore, 0, 1.6, STEEL_HI)
}

function cutts(g: Gun, kMuzzle: number, bore: number): void {
    g.box(kMuzzle - 5, kMuzzle, bore - 1, bore + 2, 3, PARK)
    for (const k of [kMuzzle - 4, kMuzzle - 2]) g.box(k, k + 1, bore + 1, bore + 2, 3, BLACK)
}

function build(id: DfWeaponId, att: DfAttachmentChoice): Spec {
    switch (id) {
        case 'm1911': {
            const g = new Gun(VOX, 22, 18, 5, 5)
            const dotSight = has(att, 'optic', 'reddot')
            const ext = has(att, 'magazine', 'extended')
            const grips = has(att, 'stock', 'grips')
            // Frame, trigger guard and a raked grip with walnut panels.
            g.box(2, 18, 8, 9, 3, STEEL)
            g.box(6, 12, 5, 6, 1, STEEL).box(6, 7, 5, 8, 1, STEEL).box(9, 10, 6, 8, 1, BLACK)
            const panel = grips ? WOOD_L : WOOD_D
            const check = derive(scaleHex(panel, 0.84), panel)
            for (let j = 0; j < 8; j++) {
                const k0 = 12 + Math.round((8 - j) * 0.3)
                g.box(k0, k0 + 6, j, j + 1, 3, STEEL)
                // Diamond-checkered walnut panels with a screw near the top and the bottom.
                for (let k = k0 + 1; k < k0 + 5; k++) {
                    const screw = (j === 1 || j === 6) && k === k0 + 3
                    const hex = screw ? STEEL_HI : ((j + k) & 1) ? panel : check
                    g.box(k, k + 1, j, j + 1, 1, hex, -1).box(k, k + 1, j, j + 1, 1, hex, 1)
                }
            }
            // Beavertail tang, spur hammer, thumb safety and slide stop.
            g.box(18, 20, 8, 9, 3, STEEL)
            g.box(18, 19, 9, 11, 1, STEEL).box(19, 20, 10, 12, 1, STEEL_HI)
            g.boxI(15, 17, 9, 10, g.ci - 2, g.ci - 1, STEEL_HI)
            g.boxI(7, 10, 8, 9, g.ci - 2, g.ci - 1, STEEL_HI)
            g.part('slide')
            g.box(0, 19, 9, 12, 3, STEEL)
            for (let k = 14; k < 19; k += 2) g.box(k, k + 1, 11, 12, 3, BLACK)
            g.box(0, 1, 10, 11, 1, BLACK)
            g.box(1, 2, 12, 13, 1, STEEL_HI)
            if (!dotSight) g.box(17, 18, 12, 13, 1, STEEL_HI, -1).box(17, 18, 12, 13, 1, STEEL_HI, 1)
            g.box(10, 13, 10, 11, 1, BLACK, 1)
            g.part('mag')
            g.box(14, 18, ext ? -4 : 0, 8, 1, STEEL)
            g.box(13, 19, ext ? -5 : -1, ext ? -4 : 0, 3, BLACK)
            g.part('main')
            const dot = dotSight ? redDot(g, 9, 18, 12) : undefined
            if (has(att, 'muzzle', 'maxim')) maxim(g, 0, 10)
            if (has(att, 'muzzle', 'cutts')) cutts(g, 0, 10)
            return { gun: g, grip: [15, 4], bore: 10, front: 1, sight: [17, 13], eyeRelief: 0.3, left: [-0.025, -0.02, -0.03], eject: [12, 11], reload: 'mag', long: false, dot }
        }
        case 'c96': {
            const g = new Gun(VOX, 28, 20, 5, 2)
            const box = has(att, 'magazine', 'box')
            const holster = has(att, 'stock', 'holster')
            g.rod(0, 11, 12, 0.6, STEEL)
            g.box(1, 2, 13, 15, 1, STEEL_HI)
            g.box(10, 22, 10, 14, 3, STEEL)
            g.box(10, 16, 6, 10, 3, STEEL)
            for (let k = 11; k < 16; k += 2) g.box(k, k + 1, 7, 9, 1, BLACK, 1)
            g.box(15, 18, 14, 15, 3, STEEL_HI).cut(15, 18, 14, 15, g.ci, g.ci + 1)
            g.box(16, 20, 6, 7, 1, STEEL).box(17, 18, 7, 9, 1, BLACK)
            // Broomhandle grip.
            for (let j = 0; j < 10; j++) {
                const k0 = 19 + Math.round((10 - j) * 0.25)
                g.box(k0, k0 + 5, j, j + 1, 3, (j & 1) ? WOOD : WOOD_D)
            }
            g.box(22, 23, 14, 16, 1, STEEL)
            g.part('bolt')
            g.box(18, 22, 13, 14, 1, STEEL_HI).box(20, 22, 13, 14, 3, STEEL_HI)
            g.part('mag')
            if (box) g.box(10, 16, -1, 6, 3, BLACK)
            else g.box(10, 16, 6, 7, 3, STEEL_HI)
            g.part('main')
            if (holster) g.slope(24, 28, k => 2 + (k - 24) * 0.5, k => 9 - (k - 24) * 0.2, 3, WOOD_L)
            if (has(att, 'muzzle', 'cutts')) cutts(g, 0, 12)
            if (has(att, 'muzzle', 'maxim')) maxim(g, 0, 12)
            const dot = has(att, 'optic', 'reddot') ? redDot(g, 11, 20, 14) : undefined
            return { gun: g, grip: [22, 5], bore: 12, front: 1, sight: [16, 15], eyeRelief: 0.32, left: [-0.025, -0.02, -0.03], eject: [19, 13], reload: box ? 'mag' : 'stripper', long: false, dot }
        }
        case 'm1897': {
            const sawn = has(att, 'stock', 'sawn')
            const tube = has(att, 'magazine', 'tube')
            const dotSight = has(att, 'optic', 'reddot')
            const g = new Gun(VOX, 82, 22, 5)
            const k0 = sawn ? 22 : 0
            g.rod(k0, 50, 13, 1, STEEL)
            g.rod(sawn ? k0 : tube ? 2 : 8, 46, 11, 0.8, STEEL_HI)
            // Bead on a short post, so it rides above the heat shield.
            g.box(k0 + 1, k0 + 2, 14, 16, 1, STEEL).box(k0 + 1, k0 + 2, 16, 17, 1, has(att, 'optic', 'bead') ? IVORY : BRASS)
            // The trench gun's ventilated heat shield over the barrel, clamped at both ends.
            const s0 = Math.max(k0 + 4, 4)
            for (let k = s0; k < 34; k++) {
                for (let j = 13; j < 16; j++) {
                    for (let i = 0; i < g.W; i++) {
                        const d = Math.hypot(i + 0.5 - (g.ci + 0.5), j + 0.5 - 13.5)
                        if (d < 1.3 || d > 2.3) continue
                        const vent = k % 3 === 0 && k > s0 && k < 33 && (j === 15 || (j === 14 && i !== g.ci))
                        if (!vent) g.boxI(k, k + 1, j, j + 1, i, i + 1, k === s0 || k === 33 ? STEEL_HI : STEEL)
                    }
                }
            }
            if (!sawn) g.box(k0 + 3, k0 + 6, 9, 10, 1, STEEL).box(k0 + 3, k0 + 4, 10, 11, 1, STEEL)
            g.box(46, 60, 8, 15, 3, STEEL)
            if (!dotSight) {
                g.box(51, 54, 15, 16, 3, STEEL)
                g.box(52, 53, 16, 17, 1, STEEL_HI)
                g.boxI(52, 53, 16, 18, g.ci - 1, g.ci, STEEL_HI).boxI(52, 53, 16, 18, g.ci + 1, g.ci + 2, STEEL_HI)
            }
            g.box(54, 61, 6, 8, 1, STEEL).box(56, 57, 7, 9, 1, BLACK)
            if (sawn) g.slope(60, 68, k => 1 + (68 - k) * 0.6, () => 10, 3, WOOD)
            else g.slope(60, 82, k => 7 - (k - 60) * 0.3, k => 12 - (k - 60) * 0.08, 3, WOOD).box(81, 82, 0, 11, 3, BLACK).swivel(74, 3)
            g.part('pump')
            g.box(sawn ? 30 : 24, sawn ? 42 : 38, 8, 12, 3, WOOD)
            for (let k = sawn ? 31 : 25; k < (sawn ? 42 : 38); k += 2) g.box(k, k + 1, 8, 9, 3, WOOD_D)
            g.part('main')
            if (has(att, 'muzzle', 'choke')) g.ring(k0 - 2, k0, 13, 0, 1.6, STEEL_HI)
            const dot = dotSight ? redDot(g, 46, 55, 15) : undefined
            return { gun: g, grip: [62, 8], bore: 13, front: k0 + 1, sight: [52, 17], eyeRelief: 0.3, left: [-0.012, 0.0, sawn ? -0.29 : -0.4], eject: [55, 13], reload: 'shell', long: true, dot }
        }
        case 'kar98k': {
            const sc = has(att, 'optic', 'scope')
            const light = has(att, 'stock', 'light')
            const g = new Gun(VOX, 90, 24, 7, 4)
            g.rod(0, 46, 10, 0.8, STEEL)
            g.box(1, 3, 11, 14, 1, STEEL_HI)
            // Front sight ears, nose cap and cleaning rod.
            g.boxI(1, 3, 10, 14, g.ci - 2, g.ci - 1, STEEL).boxI(1, 3, 10, 14, g.ci + 2, g.ci + 3, STEEL)
            g.box(3, 14, 8, 9, 1, STEEL_HI)
            g.box(12, 14, 6, 10, 3, STEEL)
            // Fore-end, handguard and bands.
            g.box(14, 50, 6, 10, 3, WOOD)
            g.box(26, 44, 11, 12, 3, WOOD_D)
            for (const k of [14, 28]) g.ring(k, k + 2, 9, 0, 2.2, STEEL)
            g.box(44, 60, 8, 12, 3, STEEL)
            g.box(40, 43, 12, 14, 3, STEEL_HI).cut(40, 43, 13, 14, 3, 4)
            g.box(50, 57, 5, 7, 1, STEEL).box(54, 55, 6, 8, 1, BLACK)
            // Wrist and stock.
            g.slope(57, 66, k => 4 + (k - 57) * 0.1, () => 10, 3, WOOD)
            g.slope(66, 90, k => 5 - (k - 66) * 0.21, k => 10 - (k - 66) * 0.02, 3, WOOD)
            if (light) {
                for (const k of [72, 79]) g.cut(k, k + 4, 4, 7, 0, 7)
            }
            g.box(89, 90, 0, 10, 3, STEEL)
            g.swivel(30, 6).swivel(76, 3)
            g.rivets([70, 82], 7, 3, STEEL_HI)
            g.part('bolt')
            g.box(48, 60, 11, 13, 1, STEEL_HI)
            g.box(57, 59, 10, 11, 3, STEEL_HI, 1).box(57, 59, 9, 11, 1, STEEL_HI, 3)
            g.box(59, 61, 10, 13, 1, STEEL)
            g.part('mag')
            if (has(att, 'magazine', 'trench')) g.box(48, 56, -3, 6, 3, BLACK)
            else g.box(49, 56, 5, 6, 3, STEEL_HI)
            g.part('main')
            if (sc) scope(g, 42, 64, 16)
            if (has(att, 'muzzle', 'maxim')) maxim(g, 0, 10)
            return {
                gun: g, grip: [62, 7], bore: 10, front: 2, sight: sc ? [56, 16.5] : [41, 14], eyeRelief: sc ? 0.07 : 0.3, left: [-0.02, -0.005, -0.36], eject: [52, 12],
                reload: has(att, 'magazine', 'trench') ? 'mag' : 'stripper', long: true, scoped: sc ? { j: 16, k0: 42, k1: 64 } : undefined, boltAxis: [12, 54]
            }
        }
        case 'thompson': {
            const drum = has(att, 'magazine', 'drum')
            const dotSight = has(att, 'optic', 'reddot')
            const g = new Gun(VOX, 76, 30, drum ? 9 : 5)
            g.rod(0, 28, 16, 1, STEEL)
            for (let k = 4; k < 22; k += 2) g.ring(k, k + 1, 16, 0, 2.1, STEEL)
            g.box(1, 2, 18, 21, 1, STEEL_HI)
            g.box(26, 54, 13, 20, 3, STEEL)
            g.box(27, 53, 16, 17, 3, STEEL_HI).box(28, 52, 16, 17, 1, STEEL)
            g.rivets([30, 50], 18, 3, STEEL_HI)
            if (!dotSight) g.box(46, 47, 20, 22, 3, STEEL_HI).cut(46, 47, 21, 22, g.ci, g.ci + 1)
            // Vertical foregrip, rear grip, stock.
            g.slope(14, 20, k => 6 + (20 - k) * 0.4, () => 14, 3, WOOD)
            g.box(14, 20, 13, 15, 3, STEEL)
            g.slope(44, 51, k => 3 + (51 - k) * 0.4, () => 13, 3, WOOD)
            g.box(41, 48, 10, 12, 1, STEEL).box(44, 45, 11, 13, 1, BLACK)
            g.slope(54, 76, k => 8 - (k - 54) * 0.25, () => 17, 3, WOOD)
            g.box(75, 76, 2, 17, 3, BLACK)
            g.swivel(70, 4)
            g.part('bolt')
            g.box(36, 41, 20, 22, 1, STEEL_HI)
            g.part('mag')
            if (drum) {
                for (let k = 28; k < 44; k++) {
                    for (let j = 0; j < 16; j++) {
                        const d = Math.hypot(k + 0.5 - 36, j + 0.5 - 7)
                        if (d < 8) g.box(k, k + 1, j, j + 1, 7, d > 6.8 ? STEEL_HI : BLACK)
                    }
                }
            } else {
                g.box(32, 37, 2, 13, 3, BLACK)
                for (const j of [4, 7, 10]) g.box(32, 37, j, j + 1, 3, derive(scaleHex(BLACK, 1.3), BLACK))
                g.box(31, 38, 1, 2, 3, STEEL)
            }
            g.part('main')
            if (has(att, 'muzzle', 'cutts')) cutts(g, 0, 16)
            if (has(att, 'muzzle', 'maxim')) maxim(g, 0, 16)
            const dot = dotSight ? redDot(g, 45, 54, 20) : undefined
            if (has(att, 'stock', 'light')) for (const k of [60, 67]) g.cut(k, k + 4, 6, 12, 0, g.W)
            return { gun: g, grip: [47, 9], bore: 16, front: 1, sight: [46, 21], eyeRelief: 0.26, left: [-0.012, -0.04, -0.33], eject: [38, 19], reload: 'mag', drum, long: true, dot }
        }
        case 'mp18': {
            const snail = has(att, 'magazine', 'snail')
            const g = new Gun(VOX, 78, 24, 11)
            g.rod(0, 34, 15, 2, STEEL)
            for (let k = 2; k < 32; k += 3) for (const j of [14, 16]) g.boxI(k, k + 1, j, j + 1, g.ci - 2, g.ci + 3, BLACK)
            g.rod(0, 34, 15, 0.6, STEEL_HI)
            g.box(1, 2, 17, 19, 1, STEEL_HI)
            g.rod(32, 54, 15, 2, STEEL)
            g.box(38, 40, 18, 19, 3, STEEL_HI).cut(38, 40, 18, 19, g.ci, g.ci + 1)
            g.box(28, 46, 10, 13, 3, WOOD)
            g.slope(46, 56, k => 5 + (k - 46) * 0.1, () => 13, 3, WOOD)
            g.slope(56, 78, k => 6 - (k - 56) * 0.22, k => 13 - (k - 56) * 0.04, 3, WOOD)
            g.box(77, 78, 1, 13, 3, STEEL)
            g.swivel(66, 4).rivets([60], 9, 3, STEEL_HI)
            g.box(46, 52, 8, 10, 1, STEEL).box(49, 50, 9, 11, 1, BLACK)
            g.part('bolt')
            g.box(42, 46, 16, 17, 1, STEEL_HI, 3)
            g.part('mag')
            if (snail) {
                for (let k = 30; k < 42; k++) {
                    for (let j = 6; j < 18; j++) {
                        const d = Math.hypot(k + 0.5 - 36, j + 0.5 - 12)
                        if (d < 6) g.boxI(k, k + 1, j, j + 1, 0, 3, d > 4.8 ? STEEL_HI : BLACK)
                    }
                }
                g.boxI(34, 38, 14, 16, 3, g.ci - 1, STEEL)
            } else {
                g.boxI(34, 38, 14, 16, 0, g.ci - 1, BLACK)
            }
            g.part('main')
            if (has(att, 'muzzle', 'maxim')) maxim(g, 0, 15)
            const dot = has(att, 'optic', 'reddot') ? redDot(g, 44, 53, 18) : undefined
            if (has(att, 'stock', 'light')) for (const k of [62, 69]) g.cut(k, k + 4, 6, 10, 0, g.W)
            return { gun: g, grip: [52, 9], bore: 15, front: 1, sight: [38, 19], eyeRelief: 0.31, left: [-0.015, 0.005, -0.27], eject: [44, 16], reload: 'side', long: true, dot }
        }
        case 'ppsh': {
            // PPSh-41: a slotted round jacket ending in a slanted brake with a hooded post, a
            // blued receiver with a hinged top cover, a walnut stock with a straight comb and a
            // deep pistol-grip swell, a ring trigger guard and the 71-round drum underneath.
            const box = has(att, 'magazine', 'box')
            const brake = has(att, 'muzzle', 'brake')
            const dotSight = has(att, 'optic', 'reddot')
            const short = has(att, 'stock', 'light')
            const g = new Gun(VOX, 80, 30, 9, 4)
            const B = 20
            const ci = g.ci
            const SEAM = derive(scaleHex(STEEL, 0.72), STEEL)
            // ---- jacket: a rounded tube, hollow round the barrel. The front is cut on a slant
            // (the brake): the top lip runs furthest forward over the bore exit.
            const front = brake ? -4 : 0
            const nose = (j: number) => front + Math.round((22 - j) * 1.2)
            g.oval(front, 31, B, 2.2, 2.6, STEEL)
            for (let j = 18; j <= 22; j++) g.cut(front, nose(j), j, j + 1, 0, g.W)
            g.cut(nose(19) + 1, 30, 19, 22, ci - 1, ci + 2)
            g.rod(nose(19) + 1, 31, B, 1, BLACK).rod(nose(B) + 1, 31, B, 0.6, STEEL_HI)
            // The slanted brake plate, lit, with the bore's port punched through it.
            for (let j = 18; j <= 22; j++) g.box(nose(j), nose(j) + 1, j, j + 1, j === 18 || j === 22 ? 3 : 5, STEEL_HI)
            g.box(nose(B), nose(B) + 1, B, B + 1, 1, BLACK).box(nose(B + 1), nose(B + 1) + 1, B + 1, B + 2, 1, SEAM)
            // Four big oval cooling slots through both flanks (one more in the long brake): solid
            // steel bands between them and a lip above, so the jacket stays a tube.
            const slots = brake ? [0, 6, 12, 18, 24] : [6, 12, 18, 24]
            for (const k0 of slots) {
                for (const i of [ci - 2, ci + 2]) g.cut(k0, k0 + 4, 19, 21, i, i + 1)
            }
            // A row of small round vents along the top, and the collar into the receiver.
            for (const k of [9, 15, 21, 27]) g.box(k, k + 1, 22, 23, 1, BLACK)
            g.oval(29, 31, B, 2.6, 2.9, STEEL)
            // A sling swivel on the left of the collar.
            g.boxI(28, 31, 19, 20, ci - 4, ci - 3, STEEL_HI).boxI(28, 29, 17, 19, ci - 4, ci - 3, STEEL_HI).boxI(30, 31, 17, 19, ci - 4, ci - 3, STEEL_HI)
            // ---- hooded front post: a ramp on the nose, an arched hood open over the post.
            g.box(front + 1, front + 5, 23, 24, 3, STEEL)
            g.box(front + 3, front + 4, 24, 25, 1, STEEL_HI)
            g.boxI(front + 2, front + 5, 23, 26, ci - 2, ci - 1, STEEL).boxI(front + 2, front + 5, 23, 26, ci + 2, ci + 3, STEEL)
            g.box(front + 2, front + 5, 26, 27, 3, STEEL_HI).cut(front + 3, front + 4, 26, 27, ci, ci + 1)
            // ---- receiver: the lower half, the top cover over a dark seam, rounded on top, its
            // hinge pin at the front and a catch at the back.
            g.box(31, 55, 17, 19, 5, STEEL)
            g.box(31, 55, 19, 20, 5, SEAM)
            g.box(31, 55, 20, 22, 5, STEEL).box(31, 55, 22, 23, 3, STEEL)
            g.box(31, 33, 19, 21, 7, STEEL_HI)
            g.box(53, 54, 22, 23, 1, STEEL_HI).box(54, 55, 21, 22, 5, SEAM)
            g.rivets([36], 18, 5, STEEL_HI)
            // Ejection port on top and the charging-handle slot down the right flank, with its
            // safety notch at the rear.
            g.cut(41, 46, 21, 23, ci - 1, ci + 2)
            g.boxI(40, 53, 20, 21, ci + 2, ci + 3, BLACK).boxI(51, 53, 21, 22, ci + 2, ci + 3, BLACK)
            // Rear sight: a base on the cover and the L-flip leaf, its second leaf folded down.
            if (!dotSight) {
                g.box(33, 39, 23, 24, 3, STEEL)
                g.boxI(34, 35, 24, 25, ci - 1, ci, STEEL_HI).boxI(34, 35, 24, 25, ci + 1, ci + 2, STEEL_HI)
                g.boxI(36, 39, 24, 25, ci - 1, ci, STEEL).boxI(36, 39, 24, 25, ci + 1, ci + 2, STEEL)
            }
            // ---- walnut: the fore-end under the receiver, the pistol-grip swell behind the guard,
            // a straight comb and a tall butt.
            g.slope(28, 55, k => 14 + Math.max(0, (31 - k) * 1.1), () => 17, 5, WOOD)
            g.box(29, 31, 17, 18, 5, WOOD)
            const end = short ? 70 : 80
            const swell = (k: number) => {
                const x = (k + 0.5 - 59.5) / 6.2
                return Math.abs(x) < 1 ? 5.8 * Math.sqrt(1 - x * x) : 0
            }
            const lo = (k: number) => Math.min(k < 63 ? 13.4 : 13.4 - (k - 63) * (5.8 / 16), 14 - swell(k))
            const comb = (k: number) => 22 - (k - 55) * 0.06
            for (let k = 55; k < end; k++) {
                const j0 = Math.round(lo(k))
                const j1 = Math.round(comb(k))
                g.box(k, k + 1, j0, j1, 5, WOOD)
                // The bottom edge rounded off.
                g.cut(k, k + 1, j0, j0 + 1, ci - 2, ci - 1).cut(k, k + 1, j0, j0 + 1, ci + 2, ci + 3)
            }
            g.box(end - 1, end, Math.round(lo(end - 1)), Math.round(comb(end - 1)), 5, STEEL)
            g.box(end - 1, end, Math.round(lo(end - 1)), Math.round(lo(end - 1)) + 1, 5, STEEL_HI)
            g.box(end - 1, end, Math.round(comb(end - 1)) - 1, Math.round(comb(end - 1)), 5, STEEL_HI)
            // The sling slot through the butt.
            const sk = short ? 64 : 71
            g.cut(sk, sk + 3, Math.round(lo(sk)) + 3, Math.round(lo(sk)) + 5, 0, g.W)
            // The stock bolt where wood meets the receiver.
            g.rivets([57], 18, 5, STEEL_HI)
            // ---- ring trigger guard and a curled trigger, under the receiver.
            for (let k = 45; k < 56; k++) {
                for (let j = 8; j < 14; j++) {
                    const d = Math.hypot((k + 0.5 - 50.5) / 3.6, (j + 0.5 - 13) / 4.2)
                    if (d > 0.74 && d <= 1.04) g.box(k, k + 1, j, j + 1, 1, STEEL)
                }
            }
            g.box(50, 51, 11, 14, 1, BLACK).box(51, 52, 10, 12, 1, BLACK)
            // The magazine catch ahead of the guard.
            g.box(44, 46, 13, 14, 3, STEEL_HI)
            // ---- moving parts
            g.part('bolt')
            g.box(39, 48, 21, 22, 3, STEEL_HI)
            g.box(41, 46, 21, 22, 1, SEAM)
            g.boxI(46, 48, 20, 21, ci + 3, ci + 4, STEEL_HI).boxI(46, 48, 19, 22, ci + 4, ci + 5, STEEL_HI)
            g.part('mag')
            g.box(36, 43, 12, 14, 3, STEEL)
            if (box) {
                // The curved 35-round box, sweeping forward as it drops, with a lit spine.
                const RIB = derive(scaleHex(BLACK, 1.3), BLACK)
                for (let j = 0; j < 12; j++) {
                    const k0 = 38 - Math.round((12 - j) * 0.32)
                    g.box(k0, k0 + 5, j, j + 1, 3, j % 4 === 1 ? RIB : BLACK)
                    g.box(k0, k0 + 1, j, j + 1, 3, STEEL)
                }
                g.box(33, 40, -1, 0, 3, STEEL)
            } else {
                // The drum: a fat disc on its side. A lit rim with the body/cover seam, face plates
                // recessed inside it, a raised stamped ring and the winding key on the left.
                const ck = 39.5
                const cj = 4.5
                const R = 8.6
                const RING = derive(scaleHex(STEEL, 1.18), STEEL)
                for (let k = 30; k < 49; k++) {
                    for (let j = -5; j < 14; j++) {
                        const d = Math.hypot(k + 0.5 - ck, j + 0.5 - cj)
                        if (d >= R) continue
                        const rim = d > R - 1.3
                        const ring = d > 4.3 && d < 5.4
                        g.box(k, k + 1, j, j + 1, rim || ring ? 7 : 5, ring && !rim ? RING : STEEL)
                        if (rim) g.boxI(k, k + 1, j, j + 1, ci + 1, ci + 2, SEAM)
                        if (d < 1.9) g.box(k, k + 1, j, j + 1, 9, d < 0.8 ? STEEL : STEEL_HI)
                    }
                }
                // The winding key: a lever across the hub on the left face; a spring latch on top.
                g.boxI(37, 42, 4, 5, 0, 1, STEEL_HI)
                g.boxI(37, 38, 4, 6, 0, 1, STEEL_HI)
                g.box(37, 42, 12, 13, 7, STEEL_HI)
            }
            g.part('main')
            if (has(att, 'muzzle', 'maxim')) {
                g.rod(0, 3, B, 0.6, STEEL)
                maxim(g, 0, B)
            }
            const dot = dotSight ? redDot(g, 32, 41, 23) : undefined
            return {
                gun: g, grip: [57, 12], bore: B, front: front + 3, sight: [34, 25], eyeRelief: 0.3, left: [-0.015, 0.008, -0.32], eject: [43, 22],
                reload: 'mag', drum: !box, muzzle: brake ? -2 : 1, long: true, dot
            }
        }
        case 'bar': {
            const sc = has(att, 'optic', 'scope')
            const cut = has(att, 'stock', 'cut') || has(att, 'stock', 'light')
            const g = new Gun(VOX, 98, 26, 5, 7)
            g.rod(0, 40, 13, 0.8, STEEL)
            g.rod(12, 38, 11, 0.6, STEEL)
            g.box(0, 3, 12, 15, 3, STEEL)
            g.box(2, 3, 15, 17, 1, STEEL_HI)
            g.box(30, 50, 9, 15, 3, WOOD)
            for (const k of [14, 26]) g.ring(k, k + 1, 11, 0, 1.4, STEEL_HI)
            g.swivel(36, 9)
            g.box(48, 66, 8, 15, 3, PARK)
            if (!has(att, 'optic', 'reddot')) g.box(63, 66, 15, 17, 3, STEEL_HI).cut(63, 66, 16, 17, g.ci, g.ci + 1)
            g.box(60, 67, 5, 8, 1, STEEL).box(63, 64, 6, 9, 1, BLACK)
            g.slope(66, 74, k => 6 + (k - 66) * 0.1, () => 13, 3, WOOD)
            if (cut) g.slope(74, 86, k => 7 - (k - 74) * 0.2, () => 13, 3, WOOD).box(85, 86, 4, 13, 3, STEEL)
            else g.slope(74, 98, k => 7 - (k - 74) * 0.2, k => 13 - (k - 74) * 0.02, 3, WOOD).box(97, 98, 2, 13, 3, STEEL)
            g.part('bolt')
            g.box(54, 58, 12, 14, 1, STEEL_HI, 2)
            g.part('mag')
            g.box(52, 58, has(att, 'magazine', '40') ? -6 : 1, 8, 3, BLACK)
            for (const j of [2, 5]) g.box(52, 58, j, j + 1, 3, derive(scaleHex(BLACK, 1.3), BLACK))
            g.part('main')
            if (sc) scope(g, 48, 70, 18)
            if (has(att, 'muzzle', 'cutts')) cutts(g, 0, 13)
            if (has(att, 'muzzle', 'maxim')) maxim(g, 0, 13)
            const dot = has(att, 'optic', 'reddot') ? redDot(g, 52, 61, 15) : undefined
            return {
                gun: g, grip: [68, 9], bore: 13, front: 2, sight: sc ? [62, 18.5] : [64, 17], eyeRelief: sc ? 0.07 : 0.24, left: [-0.02, -0.025, -0.42], eject: [56, 13],
                reload: 'mag', long: true, scoped: sc ? { j: 18, k0: 48, k1: 70 } : undefined, dot
            }
        }
        case 'lewis': {
            const stripped = has(att, 'muzzle', 'stripped')
            const big = has(att, 'magazine', '97')
            const g = new Gun(VOX, 104, 30, 25)
            if (stripped) {
                g.rod(0, 52, 13, 0.8, STEEL)
                for (let k = 30; k < 50; k += 2) g.ring(k, k + 1, 13, 0, 2, STEEL)
            } else {
                g.rod(0, 5, 13, 1.6, BLACK)
                g.rod(5, 52, 13, 4, BLACK)
                for (let k = 8; k < 50; k += 6) g.ring(k, k + 1, 13, 3.5, 4.1, STEEL)
            }
            g.box(4, 5, stripped ? 14 : 17, 21, 1, STEEL_HI)
            g.box(50, 74, 9, 17, 5, PARK)
            g.box(68, 70, 17, 21, 3, STEEL_HI).cut(68, 70, 20, 21, g.ci, g.ci + 1)
            g.slope(70, 77, k => 2 + (77 - k) * 0.5, () => 10, 3, WOOD)
            g.box(66, 72, 6, 8, 1, STEEL).box(69, 70, 7, 9, 1, BLACK)
            g.slope(74, 104, k => 7 - (k - 74) * 0.1, () => 14, 5, WOOD)
            g.box(103, 104, 4, 14, 5, has(att, 'stock', 'padded') ? LEATHER : BLACK)
            if (has(att, 'stock', 'padded')) g.box(100, 103, 4, 14, 5, LEATHER)
            g.part('bolt')
            g.box(56, 62, 9, 11, 1, STEEL_HI, 3)
            // Pan magazine on top, centred on its own axis so it can turn.
            g.part('pan')
            const r = big ? 12 : 10
            for (let k = 58 - r; k < 58 + r; k++) {
                for (let i = 0; i < 25; i++) {
                    const d = Math.hypot(k + 0.5 - 58, i + 0.5 - (g.ci + 0.5))
                    // Hub, rim and the pan's pressed radial ribs.
                    const spoke = d > 2.5 && Math.abs(Math.sin(4 * Math.atan2(k + 0.5 - 58, i + 0.5 - (g.ci + 0.5)))) < 0.16
                    if (d < r) g.boxI(k, k + 1, 17, big ? 20 : 19, i, i + 1, d < 2 ? STEEL_HI : d > r - 1.2 ? STEEL : spoke ? PARK : BLACK)
                }
            }
            g.part('main')
            if (has(att, 'optic', 'ring')) g.ring(5, 6, 22, 2, 3, STEEL_HI)
            return { gun: g, grip: [73, 8], bore: 13, front: 4, sight: [68, 21], eyeRelief: 0.28, left: [-0.03, -0.035, -0.3], eject: [62, 12], reload: 'top', long: true, panAxis: [17, 58] }
        }
        case 'xray': {
            // A 1906 laboratory ray pistol: a flared brass emitter dish with a white-hot needle,
            // a copper barrel under polished cooling fins, a rounded art-deco brass body with a
            // glowing core chamber behind glass windows, two vacuum tubes standing on its
            // shoulders, a raked bakelite grip and a glass charge capsule on the left flank.
            const S = DF_XRAY_SCHEMES[0]
            const g = new Gun(VOX, 30, 23, 11)
            const B = 12
            // Emitter dish, rim to back, the core glowing in its bowl and the needle ahead.
            g.ring(0, 1, B, 4.1, 5.2, BRASS)
            g.ring(1, 2, B, 3.1, 4.6, BRASS)
            g.ring(2, 3, B, 2, 3.8, BRASS)
            g.ring(3, 4, B, 0, 3, COPPER)
            g.rod(1, 3, B, 2, S.core, 0, 0.8)
            g.rod(-2, 3, B, 0.6, S.hot, 0, 1)
            // The front sight: a glowing bead on the rim.
            g.box(0, 1, 18, 19, 1, S.hot, 0, 1)
            // Barrel, cooling fins and a collar.
            g.rod(4, 14, B, 1.5, COPPER)
            for (const k of [5, 7, 9, 11]) g.ring(k, k + 1, B, 1.5, 3.3, BRASS)
            g.ring(13, 14, B, 1.5, 3.6, COPPER)
            // The body: an art-deco teardrop, banded in copper, with a keel fin underneath.
            const prof = [3.1, 3.6, 4, 4.2, 4.2, 4.2, 4.2, 4.2, 4.1, 3.9, 3.6, 3.2, 2.7]
            prof.forEach((r, n) => g.oval(14 + n, 15 + n, B, r * 0.8, r, BRASS))
            g.oval(15, 16, B, 3.6 * 0.8 + 0.4, 3.6 + 0.4, COPPER).oval(24, 25, B, 3.6 * 0.8 + 0.3, 3.6 + 0.3, COPPER)
            g.slope(13, 18, k => 6 + (18 - k) * 0.3, () => 9, 1, BRASS)
            // Core chamber windows on both flanks: glass slots with a hot core streak.
            for (let k = 17; k < 23; k++) {
                for (let j = 11; j < 14; j++) {
                    for (const side of [-1, 1]) {
                        // the outermost filled cell of this row on this side
                        for (let d = 5; d >= 0; d--) {
                            const i = g.ci + side * d
                            if (g.cur.get(i, j + g.jo, k + g.ko)) {
                                const hot = j === 12
                                g.boxI(k, k + 1, j, j + 1, i, i + 1, hot ? S.core : S.glass, hot ? 1 : 0.3)
                                break
                            }
                        }
                    }
                }
            }
            // Vacuum tubes on the shoulders: copper sockets, glass bulbs, glowing filaments.
            for (const di of [-3, 2]) {
                g.boxI(18, 21, 15, 16, g.ci + di, g.ci + di + 2, COPPER)
                g.boxI(18, 20, 16, 20, g.ci + di, g.ci + di + 2, S.glass, 0.45)
                g.boxI(18, 20, 16, 18, g.ci + di, g.ci + di + 2, S.core, 0.9)
                g.boxI(18, 20, 20, 21, g.ci + di, g.ci + di + 2, BRASS)
            }
            // Tail cap with a glowing charge ring, and the rear sight.
            g.oval(27, 28, B, 2.2 * 0.8, 2.2, COPPER)
            g.ring(28, 29, B, 0, 1.5, BRASS).box(28, 29, B, B + 1, 1, S.core, 0, 0.5)
            g.box(29, 30, 12, 13, 1, BRASS)
            g.box(25, 27, 14, 18, 3, BRASS)
            g.boxI(25, 27, 18, 19, g.ci - 1, g.ci, BRASS).boxI(25, 27, 18, 19, g.ci + 1, g.ci + 2, BRASS)
            // Trigger guard and trigger.
            g.box(15, 23, 4, 5, 1, BRASS).box(15, 16, 4, 9, 1, BRASS)
            g.box(19, 20, 5, 8, 1, BLACK)
            // Raked bakelite grip with finger grooves, brass medallions and butt cap.
            const gk = (j: number) => 21 + Math.round((10 - j) * 0.35)
            for (let j = 1; j < 10; j++) {
                g.box(gk(j), gk(j) + 5, j, j + 1, 5, BAKELITE)
                if (j === 3 || j === 6) g.box(gk(j), gk(j) + 1, j, j + 1, 5, derive(scaleHex(BAKELITE, 0.7), BAKELITE))
                if (j === 6) g.rivets([gk(j) + 2], j, 5, BRASS)
            }
            g.box(gk(0), gk(0) + 5, 0, 1, 5, BRASS)
            // The charge capsule (the reload swaps it out to the left).
            g.part('mag')
            g.boxI(15, 22, 6, 9, g.ci - 5, g.ci - 3, S.glass, 0.3)
            g.boxI(15, 22, 7, 8, g.ci - 5, g.ci - 4, S.core, 1)
            for (const k of [14, 18, 22]) g.boxI(k, k + 1, 5, 10, g.ci - 5, g.ci - 2, BRASS)
            g.part('main')
            return { gun: g, grip: [25, 5], bore: B, front: 0, sight: [26, 17], eyeRelief: 0.3, left: [-0.025, -0.02, -0.03], eject: [18, 12], reload: 'capsule', long: false, glow: true }
        }
        case 'wunder': {
            // The Voltigeur: a brass-and-blued-steel rifle with copper Tesla coils that flare
            // toward an electrode fork, glowing capacitor tubes along both flanks of the
            // receiver and a charged cell slung underneath.
            const g = new Gun(VOX, 94, 28, 11)
            const ARC = 0xa8e2ff
            const HOT = 0xeaf8ff
            const COIL = 0xc87436
            // Electrode fork: a brass yoke with two copper prongs, glowing tips and a spark between.
            g.box(3, 6, 8, 17, 3, BRASS)
            g.slope(0, 3, () => 15, () => 17, 1, COPPER).slope(0, 3, () => 8, () => 10, 1, COPPER)
            g.box(0, 1, 15, 17, 1, HOT, 0, 1).box(0, 1, 8, 10, 1, HOT, 0, 1)
            g.rod(1, 3, 12, 0.8, ARC, 0, 1)
            g.box(4, 5, 17, 20, 1, STEEL_HI)
            // Barrel with the glowing core showing between the coils.
            g.rod(5, 36, 12, 1.2, BLACK)
            g.rod(6, 34, 12, 0.6, ARC, 0, 0.9)
            const coils = [8, 13, 18, 23, 28]
            coils.forEach((k, n) => {
                const r = 3.8 - n * 0.25
                g.ring(k, k + 2, 12, r - 1.2, r, COIL)
                g.ring(k + 2, k + 3, 12, 1.2, 1.9, ARC, 0, 0.8)
            })
            g.ring(33, 36, 12, 0, 2.6, IVORY).ring(34, 35, 12, 0, 3.1, BRASS)
            // Receiver: brass over a dark steel belly, steel top plate, notch rear sight.
            g.box(36, 58, 10, 16, 7, BRASS)
            g.box(36, 58, 7, 10, 7, BLACK)
            g.box(36, 58, 15, 16, 5, STEEL)
            for (const k of [38, 56]) g.box(k, k + 1, 7, 16, 7, COPPER)
            // A wide U rear sight: the coils and the fork stay in view through it.
            g.boxI(54, 56, 16, 20, g.ci - 2, g.ci - 1, STEEL_HI).boxI(54, 56, 16, 20, g.ci + 2, g.ci + 3, STEEL_HI)
            // Capacitor tubes along both flanks with brass caps and copper clamps.
            for (const [i0, i1] of [[0, 2], [g.W - 2, g.W]] as const) {
                g.boxI(40, 54, 12, 15, i0, i1, ARC, 1)
                g.boxI(39, 40, 11, 16, i0, i1, BRASS).boxI(54, 55, 12, 15, i0, i1, BRASS)
                for (const k of [44, 49]) g.boxI(k, k + 1, 11, 15, i0, i1, COIL)
            }
            // Trigger guard, raked grip, stock.
            g.box(54, 62, 5, 7, 1, BRASS).box(57, 58, 6, 8, 1, BLACK)
            for (let j = 0; j < 8; j++) {
                const k0 = 58 + Math.round((7 - j) * 0.45)
                g.box(k0, k0 + 5, j, j + 1, 3, WOOD_D)
            }
            g.slope(62, 94, k => 7 - (k - 62) * 0.15, () => 15, 3, WOOD_D)
            g.box(58, 62, 8, 15, 3, BLACK)
            g.box(93, 94, 2, 15, 3, BRASS)
            g.box(70, 72, 9, 15, 3, COPPER)
            // The swappable cell: dark steel with glowing windows on both sides.
            g.part('mag')
            g.box(42, 51, 2, 7, 5, BLACK)
            g.box(43, 50, 3, 6, 7, ARC, 0, 1)
            g.box(42, 51, 2, 3, 5, BRASS)
            g.part('main')
            return { gun: g, grip: [61, 6], bore: 12, front: 4, sight: [54, 20], eyeRelief: 0.3, left: [-0.02, 0.02, -0.33], eject: [44, 15], reload: 'coil', long: true, glow: true }
        }
    }
}

const lum = (hex: number) => 0.3 * ((hex >> 16) & 255) + 0.59 * ((hex >> 8) & 255) + 0.11 * (hex & 255) + 1

/**
 * The finishing pass: lit top edges (bright worn steel, polished brass, sunlit
 * wood) and shadowed undersides, so every part reads as a solid, machined shape.
 */
function bevel(m: DfVoxModel): void {
    m.recolor((c, glow, i, j, k) => {
        if (glow) return null
        const f = finishOf(c)
        if (f === 'other' || EDGE.has(c)) return null
        if (!m.get(i, j + 1, k)) {
            const hi = f === 'metal' ? scaleHex(c, 1.3) : f === 'brass' ? mixHex(scaleHex(c, 1.18), 0xfff2c8, 0.32) : scaleHex(c, 1.1)
            return [derive(hi, c, 1), 0]
        }
        if (!m.get(i, j - 1, k)) return [derive(scaleHex(c, f === 'wood' ? 0.84 : 0.76), c, -1), 0]
        return null
    })
}

/**
 * Pack-a-Punch camo: the steel goes deep and tier-tinted with a wavy
 * damascus pattern and glowing edge trim, the wood turns to dark ebony and the
 * brass takes a warm sheen of the tier colour. The trim and lattice pulse.
 */
function papRecolor(m: DfVoxModel, tier: number, glowToo = false): void {
    const hex = Number.parseInt(DF_PAP_COLORS[Math.max(1, Math.min(3, tier)) - 1]!.slice(1), 16)
    const dark = scaleHex(hex, 0.22)
    const trim = mixHex(hex, 0xffffff, 0.12)
    m.recolor((c, glow, i, j, k) => {
        if (glow) return glowToo ? [mixHex(hex, c, 0.4), glow] : null
        const f = finishOf(c)
        const e = EDGE.get(c) ?? 0
        if (f === 'metal') {
            if (e > 0) return [trim, 0.4]
            // Damascus: wavy folded bands of two tones running down the steel.
            const base = mixHex(scaleHex(c, 0.8), dark, 0.62)
            const band = Math.floor((j * 1.5 + Math.sin(k * 0.45 + i * 0.7) * 1.6 + 64) / 2) & 1
            return [band ? mixHex(base, hex, 0.24) : base, band ? 0.06 : 0]
        }
        if (f === 'wood') return [mixHex(mixHex(c, 0x1a1216, 0.6), hex, e > 0 ? 0.18 : 0.08), 0]
        if (f === 'brass') return [mixHex(c, trim, 0.35), e > 0 ? 0.3 : 0.1]
        return null
    })
}

/** X-Ray Pack-a-Punch: a whole new colour scheme per tier (core, glass, body, trim, grip). */
function xrayRecolor(m: DfVoxModel, tier: number): void {
    const s0 = DF_XRAY_SCHEMES[0]
    const s = DF_XRAY_SCHEMES[Math.max(1, Math.min(3, tier))]!
    const glowMap = new Map([[s0.core, s.core], [s0.hot, s.hot], [s0.glass, s.glass]])
    const solidMap = new Map([[BRASS, s.body], [COPPER, s.trim], [BAKELITE, s.grip]])
    m.recolor((c, glow) => {
        if (glow) {
            const n = glowMap.get(c)
            return n === undefined ? null : [n, glow]
        }
        const root = ROOT.get(c) ?? c
        const to = solidMap.get(root)
        if (to === undefined) return null
        return [scaleHex(to, Math.min(1.6, lum(c) / lum(root))), EDGE.get(c) === 1 && tier === 3 ? 0.12 : 0]
    })
}

function buildRig(id: DfWeaponId, pap: number, attachments: DfAttachmentChoice): DfGunRig {
    const spec = build(id, attachments ?? {})
    const g = spec.gun
    const s = g.s
    const root = new THREE.Group()
    root.name = `df-weapon-${id}`
    const tier = Math.max(0, Math.min(3, Math.floor(pap)))
    const glowMat = spec.glow ? dfOwnedGlowMat() : null
    const mat: THREE.Material = glowMat ?? (tier > 0 ? dfPapMat(tier) : dfWeaponMat())
    const [gk, gj] = spec.grip
    const gi = g.ci + 0.5
    const toGun = (i: number, j: number, k: number, out = new THREE.Vector3()) => out.set((i - gi) * s, (j - gj) * s, (k - gk) * s)
    const ko = g.ko
    // The PaP pistol: a fat launcher barrel under the slide.
    if (id === 'm1911' && tier > 0) {
        g.part('main')
        g.rod(-2, 8, 6, 1.5, STEEL)
        g.ring(-2, -1, 6, 0, 0.8, BLACK)
    }
    const meshOf = (name: PartName, pivot: [number, number, number]): THREE.Mesh | null => {
        const m = g.models[name]
        if (!m || !m.vox.count()) return null
        bevel(m)
        if (tier > 0) {
            if (id === 'xray') xrayRecolor(m, tier)
            else papRecolor(m, tier, id === 'wunder')
        }
        const geo = m.mesh(s, pivot, { aoMin: 0.55 })
        if (!geo) return null
        const me = new THREE.Mesh(geo, mat)
        if (tier > 0 && !glowMat) me.onBeforeRender = dfTickPap
        return me
    }
    const gripPivot: [number, number, number] = [gi, gj + g.jo, gk + ko]
    const main = meshOf('main', gripPivot)
    if (main) root.add(main)
    const sub = (name: PartName, axis?: [number, number]): THREE.Object3D | null => {
        const pivot: [number, number, number] = axis ? [gi, axis[0] + g.jo, axis[1] + ko] : gripPivot
        const me = meshOf(name, pivot)
        if (!me) return null
        const grp = new THREE.Group()
        grp.name = name
        if (axis) toGun(gi, axis[0], axis[1], grp.position)
        grp.add(me)
        if (name === 'mag') {
            // The left hand reaches for the magazine's centre: put the mesh there.
            const box = new THREE.Box3().setFromBufferAttribute(me.geometry.getAttribute('position') as THREE.BufferAttribute)
            const c = box.getCenter(new THREE.Vector3())
            me.geometry.translate(-c.x, -c.y, -c.z)
            me.position.copy(c)
        }
        root.add(grp)
        return grp
    }
    const slide = sub('slide')
    const bolt = sub('bolt', spec.boltAxis)
    const pump = sub('pump')
    const pan = sub('pan', spec.panAxis)
    const mag = pan ?? sub('mag')
    const muzzle = new THREE.Object3D()
    const muzzleK = has(attachments, 'muzzle', 'maxim') ? -12 : spec.muzzle ?? ((id === 'm1911' && tier > 0) || id === 'xray' ? -2 : 0)
    toGun(gi, spec.bore + 0.5, muzzleK, muzzle.position)
    root.add(muzzle)
    let lens: THREE.Mesh | null = null
    if (spec.dot) {
        // The red dot floats in the front glass; it only shows while aiming.
        const dm = new THREE.MeshBasicMaterial({ map: dfDotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
        dm.userData.dfOwned = true
        lens = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.03), dm)
        toGun(gi, spec.dot.j + 0.5, spec.dot.k0 + 0.5, lens.position)
        lens.visible = false
        lens.renderOrder = 5
        root.add(lens)
    } else if (spec.scoped) {
        const lm = new THREE.MeshBasicMaterial({ map: dfReticleTexture(), transparent: true, depthWrite: false, toneMapped: false })
        lm.userData.dfOwned = true
        lens = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), lm)
        toGun(gi, spec.scoped.j + 0.5, spec.scoped.k1 + 0.2, lens.position)
        lens.visible = false
        lens.renderOrder = 5
        root.add(lens)
    }
    // Sight line from the voxels themselves (6 o'clock hold): the front post top
    // level with the tops of the rear sight's ears, the post filling the notch.
    const topAt = (k: number, anyColumn: boolean): number => {
        let top = -1
        for (const m of Object.values(g.models)) {
            if (!m || (m === g.models.mag) || (m === g.models.pan)) continue
            for (let i = anyColumn ? 0 : g.ci; i <= (anyColumn ? g.W - 1 : g.ci); i++) {
                for (let j = m.sy - 1; j > top; j--) {
                    if (m.get(i, j, Math.round(k) + ko)) {
                        top = j
                        break
                    }
                }
            }
        }
        return top + 1 - g.jo
    }
    const rearK = spec.sight[0]
    const opt = spec.scoped ?? spec.dot
    const sightRear = opt ? toGun(gi, opt.j + 0.5, opt.k1) : toGun(gi, topAt(rearK, true), rearK + 0.5)
    const sightFront = opt ? toGun(gi, opt.j + 0.5, opt.k0) : toGun(gi, topAt(spec.front, false), spec.front + 0.5)
    const r: DfGunRig = {
        id,
        root,
        muzzle,
        sight: sightRear,
        sightFront,
        eyeRelief: spec.eyeRelief,
        left: new THREE.Vector3(spec.left[0], spec.left[1], spec.left[2]),
        eject: toGun(gi + 1, spec.eject[1], spec.eject[0]),
        slide,
        bolt,
        pump,
        mag,
        pan,
        glow: glowMat,
        reload: spec.reload,
        drum: !!spec.drum,
        scoped: !!spec.scoped,
        lens,
        long: spec.long
    }
    for (const o of [r.slide, r.bolt, r.pump, r.mag, r.pan]) {
        if (o) o.userData.rest = o.position.clone()
    }
    root.userData.dfSight = sightRear.clone()
    root.userData.dfSightFront = sightFront.clone()
    root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true
    })
    return r
}

export function dfBuildGunRig(id: DfWeaponId, pap = 0, attachments: DfAttachmentChoice = {}): DfGunRig {
    return buildRig(id, pap, attachments)
}

/**
 * World-space model (third-person hands, box float, pedestal, wall chalk,
 * armory preview). 1 unit = 1 metre, muzzle toward -z, origin at the grip.
 * Geometries belong to the group; materials are shared (do not dispose them).
 * Dispose with `disposeDfWeaponModel`.
 */
export function buildDfWeaponModelImpl(id: DfWeaponId, pap = 0, attachments: DfAttachmentChoice = {}): THREE.Group {
    const r = dfBuildGunRig(id, pap, attachments)
    if (r.lens) r.lens.visible = false
    r.root.userData.dfMuzzle = r.muzzle.position.clone()
    const glow = r.glow
    if (glow) {
        // Out of the hands (pedestal, box, armory) the coils breathe on their own.
        const main = r.root.children.find(o => (o as THREE.Mesh).isMesh) as THREE.Mesh | undefined
        const phase = Math.random() * 6
        if (main) main.onBeforeRender = () => {
            const t = performance.now() / 1000 + phase
            glow.userData.uGlow.value = 1.3 + 0.3 * Math.sin(t * 2.2) + (Math.random() < 0.03 ? 0.6 : 0)
        }
    }
    return r.root
}

/** Disposes a model's own geometries (and its few per-model materials); shared materials stay. */
export function disposeDfWeaponModel(group: THREE.Object3D): void {
    const owned = new Set<THREE.Material>()
    group.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        m.geometry.dispose()
        const mat = m.material as THREE.Material
        if (mat.userData.dfOwned) owned.add(mat)
    })
    for (const m of owned) m.dispose()
    group.removeFromParent()
}
