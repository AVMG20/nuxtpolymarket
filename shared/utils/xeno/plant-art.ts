import { getPlant } from './plants'
import { isHybrid, parseHybridResources } from './hybrids'

/**
 * ─── Plant art ───────────────────────────────────────────────────────────────
 *
 * Every Xeno plant is drawn from a small deterministic "genome" instead of a
 * sprite sheet, so all species share one hand and one light source and scale
 * crisply at any size. The pipeline is pure:
 *
 *   typeId ──plantGenome()──▶ PlantGenome ──buildPlantArt(stage)──▶ PlantArt
 *
 * - A gene is one species' look: an archetype (bud, bloom, cap, crystal, orb,
 *   frond, spire), a body / highlight / accent colour and a count (petals,
 *   leaflets or shards). Colours are muted at build time so every plant reads
 *   on white and on charcoal. Void plants swap to a dusky violet palette.
 * - Hybrids carry one gene per resource and grow one stem per gene, tied with a
 *   twine band.
 * - Tier adds detail, never size: a rim line and a curl from III, berries on the
 *   leaf tips from IV, leafy sepals and a side bloom from V, pollen from VII and
 *   a leaf wreath at IX. Everything is flat and matte: no glow, no halos.
 * - Small id-seeded variation (a hash of the typeId, never Math.random) leans
 *   the stem, tilts the head and jitters the leaves so neighbours differ.
 *
 * The art is a list of SVG paths in a 0..100 viewBox, split into a static
 * `ground` (the soil never moves), the `plant` (stem, leaves and heads, which
 * may sway around PLANT_PIVOT) and static `air` (pollen and void spores).
 * Consecutive paths with the same paint are merged to keep the DOM small.
 */

export type PlantStage = 'seedling' | 'growing' | 'ready'
export const PLANT_STAGES: readonly PlantStage[] = ['seedling', 'growing', 'ready']

export type PlantArchetype = 'bud' | 'bloom' | 'cap' | 'crystal' | 'orb' | 'frond' | 'spire'
const ARCHETYPES: readonly PlantArchetype[] = ['bud', 'bloom', 'cap', 'crystal', 'orb', 'frond', 'spire']

export interface PlantGene {
    id: string
    tier: number
    archetype: PlantArchetype
    /** Main body colour. */
    body: string
    /** Highlight colour (inner petals, facets, veins). */
    light: string
    /** Accent colour (centres, gills, pollen). */
    accent: string
    /** Petals (bloom), leaflets (frond) or shards (crystal). */
    count: number
    void: boolean
    leaf: string
    stem: string
    /** Outline colour from tier III (and on every void plant), else null. */
    rim: string | null
}

export interface PlantGenome {
    id: string
    genes: PlantGene[]
    /** Highest tier among the genes: drives the tier details. */
    tier: number
    void: boolean
    hybrid: boolean
    /** Stem lean, -1..1. */
    lean: number
    /** Head tilt in degrees. */
    tilt: number
    /** Mirrors the curl, side shoot and leaf order. */
    flip: boolean
    /** Per-leaf scale jitter. */
    leafJitter: number[]
    /** Petal / ray rotation phase, 0..1. */
    phase: number
    /** Sway timing so a garden doesn't move in unison (seconds). */
    swayDuration: number
    swayDelay: number
}

export interface PlantPath {
    d: string
    fill?: string
    stroke?: string
    width?: number
    opacity?: number
    strokeOpacity?: number
}

export interface PlantArt {
    /** Static soil. */
    ground: PlantPath[]
    /** Stem, leaves and heads: the only layer that may move. */
    plant: PlantPath[]
    /** Static pollen and spores. */
    air: PlantPath[]
}

/** Point (viewBox units) where the stem meets the soil: the sway pivot. */
export const PLANT_PIVOT: readonly [number, number] = [50, 90]

// ─── Species looks ───────────────────────────────────────────────────────────
// [archetype, body, highlight?, accent?, count?]. Void plants take the void
// palette, so they only need an archetype. A species missing here (a future
// plant) still gets a look derived from its id and its tier colour.

type Look = [PlantArchetype, string?, string?, string?, number?]

const LOOKS: Record<string, Look> = {
    'sprout': ['bud', '#86efac', '#dcfce7', '#22c55e'],
    'tendril': ['frond', '#6ee7b7', '#d1fae5', undefined, 5],
    'dustbloom': ['bloom', '#fde68a', '#fef9c3', '#b45309', 8],
    'glowshroom': ['cap', '#67e8f9', '#ecfeff', '#0e7490'],
    'bloom': ['bloom', '#f9a8d4', '#fce7f3', '#facc15', 6],
    'creeper': ['frond', '#84cc16', '#ecfccb', undefined, 6],
    'fernite': ['frond', '#a3e635', '#f7fee7', undefined, 7],
    'ashvine': ['bud', '#fca5a5', '#fee2e2', '#b91c1c'],
    'crystal-bud': ['crystal', '#7dd3fc', '#e0f2fe', undefined, 3],
    'crystal-vine': ['crystal', '#a78bfa', '#ede9fe', undefined, 5],
    'phantom-leaf': ['frond', '#c4b5fd', '#f5f3ff', undefined, 6],
    'voidbloom': ['bloom', '#4338ca', '#a5b4fc', '#e0e7ff', 7],
    'emberfern': ['frond', '#fb7185', '#fed7aa', undefined, 7],
    'xenoform': ['orb', '#2dd4bf', '#f0abfc', '#fde68a'],
    'deepfrond': ['frond', '#14b8a6', '#99f6e4', undefined, 9],
    'swiftcane': ['spire', '#bef264', '#fef08a'],
    'crystalmoss': ['crystal', '#22d3ee', '#cffafe', undefined, 6],
    'voidfern': ['frond', '#6366f1', '#c7d2fe', undefined, 8],
    'abyssform': ['bloom', '#2563eb', '#93c5fd', '#e0f2fe', 10],
    'starweave': ['spire', '#fda4af', '#fde68a'],
    'voidpulse': ['orb', '#8b5cf6', '#f0abfc', '#c4b5fd'],
    'cosmosbloom': ['bloom', '#fb923c', '#fed7aa', '#fef3c7', 9],
    'etherform': ['bloom', undefined, undefined, undefined, 6],
    'dawnrift': ['spire', '#fb923c', '#fef3c7'],
    'voidlattice': ['crystal', '#818cf8', '#e0e7ff', undefined, 6],
    'nexusbloom': ['bloom', '#2dd4bf', '#ccfbf1', '#f0abfc', 12],
    'stellarfrond': ['frond', '#f472b6', '#fce7f3', undefined, 9],
    'aetherix': ['orb'],
    'tempest-spike': ['spire', '#67e8f9', '#f0f9ff'],
    'abyssal-frond': ['frond', '#0891b2', '#a5f3fc', undefined, 10],
    'quantum-bloom': ['crystal', '#93c5fd', '#eff6ff', undefined, 7],
    'starcore': ['orb', '#fbbf24', '#fef3c7', '#f472b6'],
    'singularity': ['spire'],
    'solar-needle': ['spire', '#facc15', '#fef9c3'],
    'nebula-root': ['bud', '#c084fc', '#f5d0fe', '#7e22ce'],
    'eventide-bloom': ['bloom', '#6366f1', '#fbcfe8', '#fde68a', 11],
    'gravity-vine': ['orb', '#f59e0b', '#fde68a', '#92400e'],
    'void-orchid': ['bloom', undefined, undefined, undefined, 5],
    'chronofrond': ['frond', '#eab308', '#fef3c7', undefined, 11],
    'darkmatter-pod': ['cap', '#64748b', '#cbd5e1', '#1e293b'],
    'galaxy-bloom': ['bloom', '#7c3aed', '#c4b5fd', '#fbcfe8', 12],
    'reality-thorn': ['spire', '#f43f5e', '#fecdd3'],
    'omega-core': ['orb']
}

/** Tailwind 400 shades for the tier colour keys, for species without a look. */
const TIER_COLOURS: Record<string, string> = {
    slate: '#94a3b8', sky: '#38bdf8', violet: '#a78bfa', orange: '#fb923c', rose: '#fb7185',
    fuchsia: '#e879f9', amber: '#fbbf24', cyan: '#22d3ee', primary: '#4ade80'
}

const VOID = { body: '#55448a', light: '#9a88c8', accent: '#e3d8f2', leaf: '#5d5682', stem: '#6d6590', rim: '#c3b4e2' }
const LEAF = '#5f8f4e'
const STEM = '#46703f'
const VEIN = '#b7cf98'
const SHINE = '#f1ead8'
const TWINE = '#d6b98c'
const TWINE_LINE = '#a8875a'
const WREATH = '#b89c5a'
const SPORE = '#b3a4d0'

// ─── Deterministic hashing ───────────────────────────────────────────────────

function hashString(s: string): number {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return h >>> 0
}

/** mulberry32: a tiny seeded PRNG for cosmetic variation only. */
function seeded(seed: number): () => number {
    let a = seed
    return () => {
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// ─── Colour ──────────────────────────────────────────────────────────────────

function parseHex(hex: string): [number, number, number] {
    const h = hex.replace('#', '')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function toHex(rgb: number[]): string {
    return '#' + rgb.map(c => Math.max(0, Math.min(255, Math.trunc(c))).toString(16).padStart(2, '0')).join('')
}

/** Pull a colour toward a mossy grey and darken it a touch: matte, not neon. */
function mute(hex: string, amount: number, dark: number): string {
    const tone = [118, 132, 104]
    return toHex(parseHex(hex).map((c, i) => (c * (1 - amount) + tone[i]! * amount) * dark))
}

function mix(hex: string, with_: string, t: number): string {
    const a = parseHex(hex)
    const b = parseHex(with_)
    return toHex(a.map((c, i) => c + (b[i]! - c) * t))
}

// ─── Genome ──────────────────────────────────────────────────────────────────

const geneCache = new Map<string, PlantGene | null>()

/** The look of one species, or null when the id isn't a known plant. */
export function plantGene(id: string): PlantGene | null {
    if (geneCache.has(id)) return geneCache.get(id)!
    const plant = getPlant(id)
    let gene: PlantGene | null = null
    if (plant) {
        const rand = seeded(hashString(id))
        const look: Look = LOOKS[id] ?? (() => {
            const base = TIER_COLOURS[plant.color] ?? '#86efac'
            const archetype = ARCHETYPES[Math.floor(rand() * ARCHETYPES.length)]!
            return [archetype, base, mix(base, '#ffffff', 0.7), mix(base, '#000000', 0.45), 5 + Math.floor(rand() * 5)] as Look
        })()
        const [archetype, body = '#86efac', light = '#ffffff', accent, count] = look
        const isVoid = !!plant.voidPlant
        const defaults = { bloom: 6, frond: 7, crystal: 4 } as Record<string, number>
        gene = isVoid
            ? {
                    id, tier: plant.tier, archetype, ...VOID, void: true,
                    count: count ?? defaults[archetype] ?? 0
                }
            : {
                    id,
                    tier: plant.tier,
                    archetype,
                    body: mute(body, 0.3, 0.88),
                    light: mute(light, 0.22, 0.95),
                    accent: mute(accent ?? light, 0.22, 0.95),
                    count: count ?? defaults[archetype] ?? 0,
                    void: false,
                    leaf: LEAF,
                    stem: STEM,
                    rim: plant.tier >= 3 ? mute(light, 0.22, 0.95) : null
                }
    }
    geneCache.set(id, gene)
    return gene
}

/**
 * Derive the genome for a plant type id (or hybrid typeId). Returns null when
 * nothing in it is a known plant, so callers can show a fallback.
 */
export function plantGenome(id: string | null | undefined): PlantGenome | null {
    if (!id) return null
    const hit = genomeCache.get(id)
    if (hit !== undefined) return hit
    const genome = deriveGenome(id)
    if (genomeCache.size >= CACHE_LIMIT) genomeCache.clear()
    genomeCache.set(id, genome)
    return genome
}

const genomeCache = new Map<string, PlantGenome | null>()
const CACHE_LIMIT = 600

function deriveGenome(id: string): PlantGenome | null {
    const hybrid = isHybrid(id)
    const ids = hybrid ? parseHybridResources(id).map(r => r.id) : [id]
    const genes = ids.map(plantGene).filter((g): g is PlantGene => !!g).slice(0, 4)
    if (!genes.length) return null
    const rand = seeded(hashString(id))
    return {
        id,
        genes,
        tier: Math.max(...genes.map(g => g.tier)),
        void: genes.some(g => g.void),
        hybrid,
        lean: rand() * 2 - 1,
        tilt: (rand() * 2 - 1) * 7,
        flip: rand() < 0.5,
        leafJitter: [0, 1, 2, 3].map(() => 0.92 + rand() * 0.16),
        phase: rand(),
        swayDuration: 3.6 + rand() * 1.8,
        swayDelay: -rand() * 4
    }
}

// ─── Geometry: affine transforms over absolute M/L/C/Q/Z paths ───────────────

type Mat = readonly [number, number, number, number, number, number]
const ID: Mat = [1, 0, 0, 1, 0, 0]

function mul(m: Mat, n: Mat): Mat {
    return [
        m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
    ]
}

/** Compose like an SVG transform list: the first matrix is the outermost. */
function chain(...ms: Mat[]): Mat {
    return ms.reduce(mul, ID)
}

const tr = (x: number, y: number): Mat => [1, 0, 0, 1, x, y]
const sc = (x: number, y = x): Mat => [x, 0, 0, y, 0, 0]
function rot(deg: number): Mat {
    const r = deg * Math.PI / 180
    return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]
}

interface Seg { c: 'L' | 'C' | 'Q', p: number[] }
interface Sub { s: [number, number], segs: Seg[], z: boolean }

const ARITY = { L: 2, C: 6, Q: 4 } as const

/** Parse a path of absolute M, L, C, Q and Z commands. */
function parse(d: string): Sub[] {
    const tokens = d.match(/[MLCQZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []
    const subs: Sub[] = []
    let cmd = ''
    let i = 0
    while (i < tokens.length) {
        const t = tokens[i]!
        if (/[A-Z]/i.test(t)) {
            cmd = t.toUpperCase()
            i++
            if (cmd === 'Z') subs[subs.length - 1]!.z = true
            continue
        }
        if (cmd === 'M') {
            subs.push({ s: [+t, +tokens[i + 1]!], segs: [], z: false })
            i += 2
            cmd = 'L'
            continue
        }
        const n = ARITY[cmd as keyof typeof ARITY]
        subs[subs.length - 1]!.segs.push({ c: cmd as Seg['c'], p: tokens.slice(i, i + n).map(Number) })
        i += n
    }
    return subs
}

function apply(m: Mat, x: number, y: number): [number, number] {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

function transform(sub: Sub, m: Mat): Sub {
    return {
        s: apply(m, sub.s[0], sub.s[1]),
        z: sub.z,
        segs: sub.segs.map((seg) => {
            const p: number[] = []
            for (let i = 0; i < seg.p.length; i += 2) p.push(...apply(m, seg.p[i]!, seg.p[i + 1]!))
            return { c: seg.c, p }
        })
    }
}

/** Signed area over the control polygon: enough to tell the winding apart. */
function winding(sub: Sub): number {
    const pts = [sub.s, ...sub.segs.flatMap((seg) => {
        const out: [number, number][] = []
        for (let i = 0; i < seg.p.length; i += 2) out.push([seg.p[i]!, seg.p[i + 1]!])
        return out
    })]
    let a = 0
    for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i]!
        const [x2, y2] = pts[(i + 1) % pts.length]!
        a += x1 * y2 - x2 * y1
    }
    return a
}

function reverse(sub: Sub): Sub {
    const segs = [...sub.segs]
    const end = (seg: Seg): [number, number] => [seg.p[seg.p.length - 2]!, seg.p[seg.p.length - 1]!]
    const last = segs.length ? end(segs[segs.length - 1]!) : sub.s
    if (sub.z && (last[0] !== sub.s[0] || last[1] !== sub.s[1])) segs.push({ c: 'L', p: [...sub.s] })
    const starts: [number, number][] = segs.map((_, i) => (i === 0 ? sub.s : end(segs[i - 1]!)))
    const out: Seg[] = []
    for (let i = segs.length - 1; i >= 0; i--) {
        const seg = segs[i]!
        const [sx, sy] = starts[i]!
        if (seg.c === 'C') out.push({ c: 'C', p: [seg.p[2]!, seg.p[3]!, seg.p[0]!, seg.p[1]!, sx, sy] })
        else if (seg.c === 'Q') out.push({ c: 'Q', p: [seg.p[0]!, seg.p[1]!, sx, sy] })
        else out.push({ c: 'L', p: [sx, sy] })
    }
    return { s: segs.length ? end(segs[segs.length - 1]!) : sub.s, segs: out, z: sub.z }
}

function num(v: number): string {
    return String(Math.round(v * 10) / 10 || 0)
}

function format(sub: Sub): string {
    let d = `M${num(sub.s[0])} ${num(sub.s[1])}`
    let prev = ''
    for (const seg of sub.segs) {
        d += (seg.c === prev ? ' ' : seg.c) + seg.p.map(num).join(' ')
        prev = seg.c
    }
    return sub.z ? d + 'Z' : d
}

const parsed = new Map<string, Sub[]>()

/** Transform a path; filled paths are normalised to one winding so merged subpaths union instead of punching holes. */
function path(m: Mat, d: string, filled: boolean): string {
    let subs = parsed.get(d)
    if (!subs) {
        subs = parse(d)
        parsed.set(d, subs)
    }
    return subs.map((sub) => {
        let t = transform(sub, m)
        if (filled && winding(t) < 0) t = reverse(t)
        return format(t)
    }).join('')
}

const K = 0.5523

function ellipseD(cx: number, cy: number, rx: number, ry: number): string {
    const kx = rx * K
    const ky = ry * K
    return `M${cx + rx} ${cy} C${cx + rx} ${cy + ky} ${cx + kx} ${cy + ry} ${cx} ${cy + ry} C${cx - kx} ${cy + ry} ${cx - rx} ${cy + ky} ${cx - rx} ${cy} C${cx - rx} ${cy - ky} ${cx - kx} ${cy - ry} ${cx} ${cy - ry} C${cx + kx} ${cy - ry} ${cx + rx} ${cy - ky} ${cx + rx} ${cy}Z`
}

function scaleOf(m: Mat): number {
    return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
}

/** A head outline; `width` is absolute so every petal of a head shares one path. */
interface Rim { color: string, width: number }

/** Collects paths and merges consecutive ones with the same paint. */
class Pen {
    out: PlantPath[] = []

    private push(p: PlantPath) {
        const last = this.out[this.out.length - 1]
        if (last && last.fill === p.fill && last.stroke === p.stroke && last.width === p.width
            && last.opacity === p.opacity && last.strokeOpacity === p.strokeOpacity) {
            last.d += p.d
            return
        }
        this.out.push(p)
    }

    fill(m: Mat, d: string, color: string, opacity?: number, rim?: Rim | null) {
        const p: PlantPath = { d: path(m, d, true), fill: color }
        if (opacity != null && opacity < 1) p.opacity = opacity
        if (rim) {
            p.stroke = rim.color
            p.width = rim.width
            p.strokeOpacity = 0.55
        }
        this.push(p)
    }

    /** Stroke a path; `width` is in the path's local units unless `absolute`. */
    stroke(m: Mat, d: string, color: string, width: number, opacity?: number, absolute = false) {
        const w = absolute ? width : width * scaleOf(m)
        const p: PlantPath = { d: path(m, d, false), stroke: color, width: Math.round(w * 20) / 20 }
        if (opacity != null && opacity < 1) p.opacity = opacity
        this.push(p)
    }

    ellipse(m: Mat, cx: number, cy: number, rx: number, ry: number, color: string, opacity?: number, rim?: Rim | null) {
        this.fill(m, ellipseD(cx, cy, rx, ry), color, opacity, rim)
    }

    circle(m: Mat, cx: number, cy: number, r: number, color: string, opacity?: number) {
        this.fill(m, ellipseD(cx, cy, r, r), color, opacity)
    }
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

function rimOf(g: PlantGene, m: Mat): Rim | null {
    if (!g.rim) return null
    return { color: g.rim, width: Math.round((g.void ? 1.1 : 0.8) * scaleOf(m) * 20) / 20 }
}

const BUD = 'M0 -18 C 11 -8 10 6 0 9 C -10 6 -11 -8 0 -18Z'

/** One flower head in local units (about ±24), centred on the origin. */
function drawHead(pen: Pen, m: Mat, g: PlantGene, open: boolean, phase: number) {
    const rim = rimOf(g, m)
    const { body, light, accent } = g
    switch (g.archetype) {
        case 'bud':
            pen.fill(m, BUD, body, 1, rim)
            pen.fill(m, 'M0 -18 C 4 -9 4 3 0 9 C -1 2 -1 -9 0 -18Z', light, 0.6)
            pen.fill(m, 'M-9 4 C -4 9 4 9 9 4 L 6 10 L-6 10Z', accent)
            break
        case 'bloom': {
            const p = Math.max(3, g.count)
            const pw = p <= 6 ? 5.5 : p <= 9 ? 4.3 : 3.4
            const ry = open ? 12 : 8
            const step = 360 / p
            for (let i = 0; i < p; i++) {
                pen.ellipse(mul(m, rot(i * step + phase * step)), 0, -ry + 1, pw, ry, body, 1, rim)
            }
            for (let i = 0; i < p; i++) {
                pen.ellipse(mul(m, rot(i * step + step / 2 + phase * step)), 0, -6, pw * 0.7, 7, light, 0.85)
            }
            pen.circle(m, 0, 0, 5.5, accent)
            pen.circle(m, -1.6, -1.6, 1.8, SHINE, 0.3)
            break
        }
        case 'cap':
            pen.fill(m, 'M-20 3 C -20 -14 -9 -20 0 -20 C 9 -20 20 -14 20 3 C 10 7 -10 7 -20 3Z', body, 1, rim)
            pen.stroke(m, 'M-15 4 C -5 8 5 8 15 4', accent, 2)
            for (const [x, y, r] of [[-8, -9, 3], [5, -13, 2.5], [11, -4, 2], [-2, -3, 1.8], [-14, -2, 1.6]] as const) {
                pen.circle(m, x, y, r, light)
            }
            break
        case 'crystal': {
            const n = Math.max(2, g.count)
            const mats: Mat[] = []
            for (let i = 0; i < n; i++) {
                const a = -42 + 84 * i / (n - 1)
                mats.push(chain(m, rot(a), sc(1, 0.7 + 0.42 * (1 - Math.abs(a) / 42))))
            }
            for (const mm of mats) pen.fill(mm, 'M0 6 L-5.5 -5 L0 -22 L5.5 -5Z', body, 1, rim)
            for (const mm of mats) pen.fill(mm, 'M0 6 L0 -22 L5.5 -5Z', light, 0.55)
            break
        }
        case 'orb':
            if (g.tier >= 5) {
                // Leafy sepals cradle the orb from tier V.
                for (const a of [-70, -35, 0, 35, 70]) {
                    pen.fill(chain(m, rot(a + 180), tr(0, -6)), 'M0 8 C -5 2 -4 -8 0 -16 C 4 -8 5 2 0 8Z', g.leaf, 0.95)
                }
            }
            pen.ellipse(m, 0, 0, 13, 13, body, 1, rim)
            pen.circle(m, 2, 2, 9, light, 0.35)
            if (g.void) {
                for (const [x, y] of [[-4, -3], [3, 4], [5, -5], [-2, 6], [-7, 3]] as const) pen.circle(m, x, y, 0.9, VOID.accent, 0.6)
            }
            pen.circle(m, -5, -5, 3, SHINE, 0.3)
            break
        case 'frond': {
            const n = Math.max(3, g.count)
            const mats: Mat[] = []
            for (let i = 0; i < n; i++) {
                const a = -62 + 124 * i / (n - 1)
                mats.push(chain(m, rot(a), sc(0.62 + 0.45 * (1 - Math.abs(a) / 62))))
            }
            for (const mm of mats) pen.fill(mm, 'M0 8 C -6 -4 -4 -18 0 -26 C 4 -18 6 -4 0 8Z', body, 1, rim)
            const vein = 0.85 * scaleOf(m)
            for (const mm of mats) pen.stroke(mm, 'M0 6 L0 -22', light, vein, 0.8, true)
            break
        }
        case 'spire':
            for (let i = 0; i < 10; i++) {
                pen.fill(chain(m, rot(i * 36 + phase * 36), sc(1, i % 2 === 0 ? 1 : 0.55)), 'M-3.2 0 L0 -24 L3.2 0Z', body, 1, rim)
            }
            pen.circle(m, 0, 0, 6.5, light)
            pen.circle(m, 0, 0, 2.6, SHINE, 0.6)
            break
    }
}

interface LeafSpec { x: number, y: number, s: number, side: 1 | -1, color: string, berry: string | null }

const LEAF_D = 'M0 0 C 4 -10 17 -11 22 -3 C 16 4 6 5 0 0Z'

/** Leaves batched by paint: all blades, then veins, then berries. */
function drawLeaves(pen: Pen, leaves: LeafSpec[]) {
    const mats = leaves.map(l => chain(tr(l.x, l.y), l.side < 0 ? sc(-1, 1) : ID, rot(-32), sc(l.s)))
    leaves.forEach((l, i) => pen.fill(mats[i]!, LEAF_D, l.color))
    leaves.forEach((_, i) => pen.stroke(mats[i]!, 'M1 -0.5 C 8 -4 14 -4 20 -3', VEIN, 0.8, 0.7, true))
    leaves.forEach((l, i) => l.berry && pen.circle(mats[i]!, 23, -3, 2.1, l.berry))
    leaves.forEach((l, i) => l.berry && pen.circle(mats[i]!, 22.4, -3.7, 0.7, SHINE, 0.35))
}

/** Point on a quadratic Bezier. */
function quad(p0: [number, number], p1: [number, number], p2: [number, number], t: number): [number, number] {
    const u = 1 - t
    return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]
}

const STAGE_FORM: Record<PlantStage, { hy: number, hs: number }> = {
    seedling: { hy: 70, hs: 0.36 },
    growing: { hy: 54, hs: 0.64 },
    ready: { hy: 38, hs: 1.35 }
}

const HYBRID_HEADS: Record<number, [number, number][]> = {
    2: [[33, 46], [67, 40]],
    3: [[28, 50], [50, 30], [72, 48]],
    4: [[25, 54], [41, 32], [60, 28], [76, 52]]
}

function drawGround(pen: Pen) {
    pen.fill(ID, 'M20 97 C 28 86 72 86 80 97Z', '#3a3024')
    pen.stroke(ID, 'M30 90 C 40 86 60 86 70 90', '#54453a', 2)
    pen.circle(ID, 36, 93, 1.4, '#2e2018')
    pen.circle(ID, 62, 94, 1.2, '#2e2018')
}

function twine(pen: Pen, x: number, y: number) {
    pen.fill(ID, `M${num(x - 4.5)} ${num(y)} L${num(x + 4.5)} ${num(y)} L${num(x + 4.5)} ${num(y + 4)} L${num(x - 4.5)} ${num(y + 4)}Z`, TWINE)
    pen.stroke(ID, `M${num(x - 4)} ${num(y + 2)} L${num(x + 4)} ${num(y + 2)}`, TWINE_LINE, 0.8)
}

/** Turn a genome into SVG paths for one growth stage. Pure and deterministic. */
export function buildPlantArt(genome: PlantGenome, stage: PlantStage): PlantArt {
    const ground = new Pen()
    const plant = new Pen()
    const air = new Pen()
    drawGround(ground)

    const { genes, tier } = genome
    const g0 = genes[0]!
    const ready = stage === 'ready'
    const { hy, hs } = STAGE_FORM[stage]
    const sx = genome.flip ? -1 : 1
    const sw = 2.6 + tier * 0.18
    const multi = genes.length > 1
    const berryOf = (i: number) => (tier >= 4 && ready ? genes[i % genes.length]!.light : null)
    let headX = 50
    let headY = hy

    if (!multi) {
        // One stem from the soil to the head, leaning by the genome.
        const rise = (94 - hy) / 58
        const p0: [number, number] = [50, 94]
        const p1: [number, number] = [50 - 4 * sx, (94 + hy) / 2 + 4]
        const p2: [number, number] = [50 + genome.lean * 3 * rise, hy + 8 * hs]
        headX = p2[0]
        plant.stroke(ID, `M50 94 Q${num(p1[0])} ${num(p1[1])} ${num(p2[0])} ${num(p2[1])}`, g0.stem, sw)

        const at = (t: number) => quad(p0, p1, p2, t)
        const leaves: LeafSpec[] = []
        if (stage === 'seedling') {
            const [x, y] = at(0.9)
            leaves.push({ x, y: y + 2, s: 0.55, side: 1, color: g0.leaf, berry: null })
            leaves.push({ x, y: y + 2, s: 0.55, side: -1, color: g0.leaf, berry: null })
        } else {
            let n = tier <= 2 ? 2 : tier <= 4 ? 3 : 4
            if (!ready) n = Math.max(2, n - 1)
            for (let i = 0; i < n; i++) {
                const t = 0.18 + i * (0.5 / Math.max(1, n - 1))
                const [x, y] = at(t)
                const side = ((i % 2 === 0 ? 1 : -1) * sx) as 1 | -1
                leaves.push({ x, y, s: (0.92 - i * 0.08) * (ready ? 1 : 0.85) * genome.leafJitter[i]!, side, color: g0.leaf, berry: berryOf(i) })
            }
        }
        drawLeaves(plant, leaves)

        if (tier >= 3 && stage !== 'seedling') {
            // A curled tendril from tier III.
            const [cx, cy] = at(0.45)
            plant.stroke(chain(tr(cx, cy), sc(sx, 1)), 'M0 0 C 10 -3 13 -11 7 -13 C 3 -14 2 -9 5.5 -8.5', g0.stem, 1.6)
        }
        if (tier >= 5 && ready) {
            // A smaller second bloom on a side shoot from tier V.
            const [bx, by] = at(0.42)
            const tipX = 50 + 20 * sx
            plant.stroke(ID, `M${num(bx)} ${num(by)} C${num(50 + 12 * sx)} ${num(94 - (94 - hy) * 0.5)} ${num(50 + 18 * sx)} ${num(hy + 20)} ${num(tipX)} ${num(hy + 12)}`, g0.stem, sw * 0.7)
            drawHead(plant, chain(tr(tipX, hy + 10), rot(-genome.tilt), sc(hs * 0.42)), g0, true, genome.phase)
        }
        if (genome.hybrid) twine(plant, at(0.3)[0], at(0.3)[1] - 2)

        const m = chain(tr(headX, hy), rot(genome.tilt), sc(hs))
        if (stage === 'seedling') plant.fill(m, BUD, g0.body)
        else drawHead(plant, m, g0, ready, genome.phase)
    } else {
        // Hybrids: one stem per gene, a pair of shared leaves and a twine band.
        const heads = HYBRID_HEADS[genes.length]!.map(([x, y], i) => {
            const y2 = ready ? y : hy + (y - 36)
            return { g: genes[i]!, x, y: y2, s: hs * 0.6 }
        })
        for (const h of heads) {
            plant.stroke(ID, `M50 94 Q50 ${num(h.y + 22)} ${num(h.x)} ${num(h.y + 6)}`, h.g.stem, sw * 0.8)
        }
        drawLeaves(plant, [
            { x: 50, y: 84, s: stage === 'seedling' ? 0.55 : 0.8, side: sx as 1 | -1, color: genes[0]!.leaf, berry: berryOf(0) },
            { x: 50, y: 80, s: stage === 'seedling' ? 0.5 : 0.7, side: -sx as 1 | -1, color: genes[1]!.leaf, berry: berryOf(1) }
        ])
        twine(plant, 50, 74)
        heads.forEach((h, i) => {
            const m = chain(tr(h.x, h.y), rot(genome.tilt * (i % 2 ? -1 : 1)), sc(h.s))
            if (stage === 'seedling') plant.fill(m, BUD, h.g.body)
            else drawHead(plant, m, h.g, ready, genome.phase)
        })
        headY = Math.min(...heads.map(h => h.y))
    }

    if (ready && tier >= 9) {
        // A leaf wreath arching over the head at tier IX.
        const cy = headY + 4
        for (let i = 0; i < 9; i++) {
            const a = -150 + i * 15
            const x = headX + 36 * Math.cos(a * Math.PI / 180)
            const y = cy + 30 * Math.sin(a * Math.PI / 180)
            plant.ellipse(chain(tr(x, y), rot(a + 90)), 0, 0, 3.4, 1.5, WREATH, 0.75)
        }
    }

    const rand = seeded(hashString(genome.id + ':air'))
    const jitter = () => (rand() * 2 - 1) * 3
    if (ready && tier >= 7) {
        const pollen = genome.void ? VOID.accent : g0.accent
        for (const [x, y, r] of [[24, 30, 1.8], [76, 22, 1.5], [78, 50, 1.6], [30, 12, 1.3], [64, 8, 1.2]] as const) {
            air.circle(ID, x + jitter(), y + jitter(), r, pollen, 0.5)
        }
    }
    if (genome.void && stage !== 'seedling') {
        for (const [x, y, r] of [[22, 30, 1.6], [78, 24, 1.3], [70, 60, 1.5], [30, 62, 1.2], [60, 12, 1.1]] as const) {
            air.circle(ID, x + jitter(), y + jitter(), r, SPORE, 0.45)
        }
    }

    return { ground: ground.out, plant: plant.out, air: air.out }
}

/** A single-colour version of the art (currentColor) for undiscovered species. */
export function silhouetteArt(art: PlantArt): PlantArt {
    const flatten = (paths: PlantPath[], opacity?: number): PlantPath[] => {
        const fills = paths.filter(p => p.fill && (p.opacity ?? 1) >= 0.6).map(p => p.d).join('')
        const strokes = new Map<number, string>()
        for (const p of paths) {
            if (p.fill || !p.stroke || (p.opacity ?? 1) < 0.9) continue
            strokes.set(p.width ?? 1, (strokes.get(p.width ?? 1) ?? '') + p.d)
        }
        const out: PlantPath[] = []
        for (const [width, d] of strokes) out.push({ d, stroke: 'currentColor', width, ...(opacity ? { opacity } : {}) })
        if (fills) out.push({ d: fills, fill: 'currentColor', ...(opacity ? { opacity } : {}) })
        return out
    }
    return {
        ground: flatten(art.ground.filter(p => p.fill), 0.5),
        plant: flatten(art.plant),
        air: []
    }
}

// ─── Memoised access ─────────────────────────────────────────────────────────

const artCache = new Map<string, PlantArt | null>()

/**
 * The art for a plant type id at a stage, memoised per (id, stage, silhouette)
 * so long lists don't regenerate geometry. Null for unknown ids.
 */
export function getPlantArt(id: string | null | undefined, stage: PlantStage = 'ready', silhouette = false): PlantArt | null {
    if (!id) return null
    const key = `${id}|${stage}|${silhouette ? 1 : 0}`
    const hit = artCache.get(key)
    if (hit !== undefined) return hit
    const genome = plantGenome(id)
    let art = genome ? buildPlantArt(genome, stage) : null
    if (art && silhouette) art = silhouetteArt(getPlantArt(id, stage) ?? art)
    if (artCache.size >= CACHE_LIMIT) artCache.clear()
    artCache.set(key, art)
    return art
}

/** Growth stage for an overall growth progress (0..1). */
export function plantStageForProgress(progress: number): PlantStage {
    if (progress >= 1) return 'ready'
    return progress < 0.2 ? 'seedling' : 'growing'
}

/**
 * How large the plant layer is drawn for a stage at an overall growth
 * progress (0..1), so it grows smoothly between the stage geometries. Without
 * a progress the stage is shown at full size.
 */
export function plantGrowScale(stage: PlantStage, progress?: number | null): number {
    if (progress == null || !Number.isFinite(progress) || stage === 'ready') return 1
    const p = Math.max(0, Math.min(1, progress))
    if (stage === 'seedling') return 0.55 + 0.45 * Math.min(1, p / 0.2)
    return 0.72 + 0.28 * Math.max(0, Math.min(1, (p - 0.2) / 0.8))
}
