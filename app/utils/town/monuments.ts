// Polytown — the monuments. Each one is authored once, whole, as eight build
// phases, and a stage draws every phase up to its own: stage 0 is a staked-out
// site, stage 8 the finished wonder. Until the last stage a crane and a stack
// of materials stand in a back corner, so a half-built monument reads as a
// building site rather than a ruin.
//
// A monument covers several tiles. Its model is authored in the same units as
// every other building (one tile = 1), centred on the middle of its footprint,
// with the front facing +Z.

import { TOWN_MONUMENT_STAGES, type TownMonumentId } from '#shared/utils/gamelogic/town-monuments'
import { C, ball, box, cone, crate, cyl, dome, flag, type ModelSpec, type Part } from './kit'

type Phase = Part[]

const SANDSTONE = 0xdcc38a
const SANDSTONE_DARK = 0xc2a66a
const LIMESTONE = 0xf1e6c8
const TRAVERTINE = 0xe3d3b0
const TRAVERTINE_DARK = 0xb9a582
const MARBLE = 0xf4f1ea
const IRON_BROWN = 0x6e5139
const IRON_LIGHT = 0x8a6a4a
const CRANE = 0xf2b632
const ARCH_SHADOW = 0x4a3b2c
const FLAME = 0xffb347
const FLAME_GLOW = 0xff8a1a
const TRICOLOUR = [0x2f5aa0, 0xfbf8f1, 0xd4382c] as const

/** Paving that covers the whole footprint edge to edge. */
function paving(size: number, color = C.paving): Part {
    return box(0, 0, 0, size, 0.03, size, color, { flat: true })
}

/**
 * A straight member from `a` to `b`, `w` thick: a girder, a leg, a mast. The
 * box is tilted so its long axis runs along the member, whichever way it leans.
 */
function beam(a: [number, number, number], b: [number, number, number], w: number, color: number, d = w): Part {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const dz = b[2] - a[2]
    const len = Math.hypot(dx, dy, dz)
    const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
    return box(mid[0], mid[1] - len / 2, mid[2], w, len, d, color, {
        rotX: Math.atan2(dz, dy),
        rotZ: Math.atan2(-dx, Math.hypot(dy, dz))
    })
}

/** A tower crane and a pile of materials in the back-left corner: the site is still working. */
function buildingSite(size: number, height: number, stage: number): Part[] {
    const x = -size / 2 + 0.16
    const z = -size / 2 + 0.16
    // The crane climbs with the work, and always clears it.
    const mast = Math.max(0.9 + stage * 0.1, height + 0.35)
    return [
        box(x, 0.03, z, 0.14, 0.05, 0.14, C.stoneDark),
        box(x, 0.08, z, 0.07, mast, 0.07, CRANE),
        box(x + 0.35, 0.08 + mast, z + 0.35, 0.05, 0.05, 1.05, CRANE, { rotY: Math.PI / 4 }),
        box(x - 0.12, 0.08 + mast - 0.08, z - 0.12, 0.14, 0.1, 0.14, C.stoneDark),
        box(x + 0.6, 0.08 + mast * 0.55, z + 0.6, 0.03, mast * 0.45, 0.03, C.iron),
        ...crate(-size / 2 + 0.2, 0.03, size / 2 - 0.45),
        ...crate(-size / 2 + 0.36, 0.03, size / 2 - 0.3, 0.1, C.stone)
    ]
}

/** Survey stakes at the corners of what will be built: stage 0. */
function stakes(half: number): Part[] {
    const out: Part[] = []
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(box(sx * half, 0.03, sz * half, 0.03, 0.14, 0.03, C.woodLight))
    // The surveyor's line along the front, where the entrance will be.
    out.push(box(0, 0.1, half, half * 2, 0.012, 0.012, C.bloomWhite))
    // And the board that says what is coming.
    out.push(box(half - 0.25, 0.03, half + 0.05, 0.03, 0.22, 0.03, C.woodDark), box(half - 0.25, 0.17, half + 0.07, 0.24, 0.14, 0.02, C.cream))
    return out
}

// ─── Great Pyramid ───────────────────────────────────────────────────────────
// Seven courses of stepped stone, then the smooth casing and a gilded capstone.

function pyramidPhases(): Phase[] {
    const phases: Phase[] = []
    const course = 0.22
    const casing = 2.78
    const height = 1.72
    for (let i = 0; i < 7; i++) {
        // Each course sits just inside the casing that will cover it at the
        // last stage, so the smooth faces hide the steps instead of the steps
        // poking through them.
        const w = casing * (1 - ((i + 1) * course) / height) - 0.02
        const y = 0.03 + i * course
        phases.push([
            box(0, y, 0, w, course, w, i % 2 ? SANDSTONE : SANDSTONE_DARK),
            // A ramp up the front face while it is being raised.
            ...(i < 6 ? [] : [box(0, y + course, w / 2 - 0.1, 0.14, 0.02, 0.1, C.stoneDark)])
        ])
    }
    phases.push([
        { shape: 'pyramid', x: 0, y: 0.03, z: 0, w: casing, h: height, d: casing, color: LIMESTONE },
        { shape: 'pyramid', x: 0, y: 1.53, z: 0, w: 0.34, h: 0.23, d: 0.34, color: C.gold },
        // Obelisks guard the front corners, with a torch lit between them.
        ...[-1, 1].flatMap(sx => [
            box(sx * 1.3, 0.03, 1.32, 0.12, 0.08, 0.12, SANDSTONE_DARK),
            box(sx * 1.3, 0.11, 1.32, 0.08, 0.52, 0.08, SANDSTONE),
            { shape: 'pyramid' as const, x: sx * 1.3, y: 0.63, z: 1.32, w: 0.08, h: 0.09, d: 0.08, color: C.gold },
            cyl(sx * 0.35, 0.03, 1.38, 0.05, 0.16, C.stoneDark, { seg: 6 }),
            cone(sx * 0.35, 0.19, 1.38, 0.08, 0.1, FLAME, { emissive: FLAME_GLOW })
        ])
    ])
    return phases
}

// ─── Colosseum ───────────────────────────────────────────────────────────────
// An oval of arcades, raised a storey at a time, then the seating, the lights
// of a night's games and the sailcloth awning over the top.

const RING_SEGMENTS = 20

/** One storey of the outer wall: a ring of wall panels, each with an arch cut into its face. */
function arcade(rx: number, rz: number, y: number, h: number, wall: number, arch: number, lit = false): Part[] {
    const parts: Part[] = []
    for (let i = 0; i < RING_SEGMENTS; i++) {
        const a0 = (i / RING_SEGMENTS) * Math.PI * 2
        const a1 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2
        const x0 = rx * Math.cos(a0), z0 = rz * Math.sin(a0)
        const x1 = rx * Math.cos(a1), z1 = rz * Math.sin(a1)
        const dx = x1 - x0, dz = z1 - z0
        const len = Math.hypot(dx, dz)
        const rotY = Math.atan2(-dz, dx)
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2
        const nx = dz / len, nz = -dx / len
        parts.push(box(mx, y, mz, len + 0.03, h, 0.16, wall, { rotY }))
        if (arch !== 0) {
            parts.push(box(mx + nx * 0.085, y + h * 0.12, mz + nz * 0.085, len * 0.5, h * 0.66, 0.02, arch, lit ? { rotY, emissive: C.litGlow } : { rotY }))
        }
    }
    return parts
}

/** Rows of seats inside the wall, stepping down to the arena floor. */
function seating(rx: number, rz: number): Part[] {
    const parts: Part[] = []
    for (let row = 0; row < 3; row++) {
        const f = 0.86 - row * 0.12
        parts.push(...arcade(rx * f, rz * f, 0.05 + (2 - row) * 0.2, 0.2, row % 2 ? TRAVERTINE : TRAVERTINE_DARK, 0))
    }
    return parts
}

function colosseumPhases(): Phase[] {
    const rx = 1.36
    const rz = 1.16
    const storey = 0.3
    const base = 0.05
    return [
        [
            cyl(0, 0.03, 0, rx * 1.7, 0.02, 0xe7cf98, { seg: 24, d: rz * 1.7 }),
            ...arcade(rx, rz, 0.03, 0.08, TRAVERTINE_DARK, 0)
        ],
        arcade(rx, rz, base + 0.06, storey, TRAVERTINE, ARCH_SHADOW),
        arcade(rx, rz, base + 0.06 + storey, storey, TRAVERTINE, ARCH_SHADOW),
        arcade(rx, rz, base + 0.06 + storey * 2, storey, TRAVERTINE, ARCH_SHADOW),
        // The attic: a solid band with small square windows.
        arcade(rx, rz, base + 0.06 + storey * 3, storey * 0.7, TRAVERTINE_DARK, ARCH_SHADOW),
        seating(rx, rz),
        // The lamps are lit for the games, and statues fill the second-storey arches.
        [
            ...arcade(rx + 0.012, rz + 0.012, base + 0.06, storey, TRAVERTINE, C.lit, true).filter((_, i) => i % 2 === 1),
            ...Array.from({ length: 6 }, (_, i) => {
                const a = (i / 6) * Math.PI * 2 + 0.3
                return box((rx + 0.1) * Math.cos(a), base + 0.06 + storey + 0.05, (rz + 0.1) * Math.sin(a), 0.06, 0.16, 0.06, MARBLE)
            })
        ],
        // The velarium: masts on the rim and a ring of striped sailcloth over the stands.
        [
            ...Array.from({ length: 10 }, (_, i) => {
                const a = (i / 10) * Math.PI * 2
                return cyl(rx * Math.cos(a), base + 0.06 + storey * 3.7, rz * Math.sin(a), 0.03, 0.2, C.woodDark, { seg: 5 })
            }),
            ...Array.from({ length: RING_SEGMENTS }, (_, i) => {
                const a = ((i + 0.5) / RING_SEGMENTS) * Math.PI * 2
                const f = 0.8
                return box(rx * f * Math.cos(a), base + 0.06 + storey * 3.7 + 0.12, rz * f * Math.sin(a), 0.36, 0.025, 0.42, i % 2 ? C.roofRed : C.cream, { rotY: -a })
            }),
            ...flag(0, base + 0.06 + storey * 3.7, rz + 0.02, C.roofRed, 0.3)
        ]
    ]
}

// ─── Lighthouse of Alexandria ────────────────────────────────────────────────
// A square tower on a podium, then an octagon, then a round lantern with a fire
// that burns through the night.

function lighthousePhases(): Phase[] {
    const podium = 0.18
    const low = 0.1 + podium
    return [
        [
            box(0, 0.03, 0, 1.84, podium - 0.03, 1.84, LIMESTONE),
            box(0, 0.03, 0.97, 0.5, 0.08, 0.1, C.stoneLight),
            ...[-1, 1].flatMap(sx => [-1, 1].map(sz => box(sx * 0.82, podium, sz * 0.82, 0.12, 0.1, 0.12, C.stoneLight)))
        ],
        [box(0, podium, 0, 1.1, 0.5, 1.1, MARBLE)],
        [
            box(0, podium + 0.5, 0, 1.06, 0.5, 1.06, MARBLE),
            ...[0.3, 0.7].flatMap(y => [-0.22, 0.22].map(x => box(x, podium + y, 0.555, 0.08, 0.12, 0.02, C.glass)))
        ],
        [
            box(0, low + 0.9, 0, 1.2, 0.07, 1.2, C.stoneLight),
            ...[-1, 1].flatMap(sx => [-1, 1].map(sz => box(sx * 0.5, low + 0.97, sz * 0.5, 0.09, 0.16, 0.09, C.gold)))
        ],
        [
            cyl(0, low + 0.97, 0, 0.78, 0.55, MARBLE, { seg: 8 }),
            cyl(0, low + 1.52, 0, 0.86, 0.05, C.stoneLight, { seg: 8 })
        ],
        [
            // An open colonnade, so the fire it will hold can be seen from the town.
            cyl(0, low + 1.57, 0, 0.58, 0.03, C.stoneLight, { seg: 12 }),
            ...Array.from({ length: 8 }, (_, i) => {
                const a = (i / 8) * Math.PI * 2
                return cyl(0.25 * Math.cos(a), low + 1.6, 0.25 * Math.sin(a), 0.05, 0.31, C.white, { seg: 6 })
            })
        ],
        [
            cyl(0, low + 1.91, 0, 0.62, 0.04, C.stoneLight, { seg: 12 }),
            dome(0, low + 1.95, 0, 0.5, 0.2, C.accent, { seg: 12 }),
            cyl(0, low + 2.13, 0, 0.04, 0.12, C.gold, { seg: 5 }),
            ball(0, low + 2.24, 0, 0.1, 0.12, C.gold, { seg: 6 })
        ],
        [
            // The fire in the lantern, and the bronze mirror that threw it out to sea.
            cone(0, low + 1.6, 0, 0.26, 0.24, FLAME, { emissive: FLAME_GLOW, seg: 8 }),
            ball(0, low + 1.62, 0, 0.16, 0.1, C.fire, { emissive: FLAME_GLOW, seg: 6 }),
            box(0, low + 1.62, -0.17, 0.22, 0.2, 0.03, C.gold),
            ...[-1, 1].map(sx => box(sx * 0.53, low + 0.1, 0.56, 0.05, 0.08, 0.02, C.lit, { emissive: C.litGlow }))
        ]
    ]
}

// ─── Arc de Triomphe ─────────────────────────────────────────────────────────
// Two great piers, the vault between them, the entablature and attic, then
// the reliefs, the flags on top and the flame beneath.

function arcPhases(): Phase[] {
    const pierX = 0.53
    const pierW = 0.56
    const depth = 0.9
    /** Where the piers, and the vault between them, top out. */
    const top = 1.04
    return [
        [
            box(0, 0.03, 0, 1.84, 0.06, 1.3, C.stoneLight),
            box(0, 0.03, 0.8, 0.5, 0.03, 0.34, C.cobble, { flat: true })
        ],
        [-1, 1].map(sx => box(sx * pierX, 0.09, 0, pierW, 0.45, depth, LIMESTONE)),
        [-1, 1].flatMap(sx => [
            box(sx * pierX, 0.54, 0, pierW, top - 0.54, depth, LIMESTONE),
            // The small arch through each pier, seen from the side.
            box(sx * (pierX + pierW / 2 + 0.005), 0.12, 0, 0.02, 0.5, 0.34, ARCH_SHADOW)
        ]),
        [
            box(0, 0.8, 0, 0.52, top - 0.8, depth, LIMESTONE),
            box(0, 0.78, 0, 0.5, 0.02, depth - 0.1, TRAVERTINE_DARK)
        ],
        [
            box(0, top, 0, 1.7, 0.08, depth + 0.06, C.stoneLight),
            box(0, top + 0.08, 0, 1.64, 0.1, depth, LIMESTONE),
            box(0, top + 0.18, 0, 1.72, 0.05, depth + 0.08, C.stoneLight)
        ],
        [box(0, top + 0.23, 0, 1.62, 0.26, depth - 0.02, LIMESTONE)],
        [
            // Reliefs on the front and back of each pier, and shields along the attic.
            ...[-1, 1].flatMap(sx => [-1, 1].map(sz => box(sx * pierX, 0.42, sz * (depth / 2 + 0.01), 0.36, 0.42, 0.02, TRAVERTINE_DARK))),
            ...Array.from({ length: 6 }, (_, i) => box(-0.65 + i * 0.26, top + 0.31, depth / 2 + 0.01, 0.1, 0.1, 0.02, C.gold))
        ],
        [
            cyl(-0.12, top + 0.49, 0, 0.018, 0.4, C.gold, { seg: 5 }),
            ...TRICOLOUR.map((color, i) => box(-0.07 + i * 0.08, top + 0.71, 0, 0.08, 0.16, 0.012, color)),
            // The eternal flame under the vault.
            cyl(0, 0.09, 0, 0.14, 0.03, C.stoneDark, { seg: 8 }),
            cone(0, 0.12, 0, 0.1, 0.14, FLAME, { emissive: FLAME_GLOW, seg: 6 }),
            ...[-1, 1].flatMap(sx => [-1, 1].map(sz => ball(sx * 0.76, top + 0.49, sz * 0.38, 0.07, 0.07, C.gold, { seg: 5 })))
        ]
    ]
}

// ─── Eiffel Tower ────────────────────────────────────────────────────────────
// Four piers, legs that lean in to the first platform, the second, the spire,
// and the beacon on top. Every member is at least 0.035 thick so the lattice
// holds together on a 1:1 screen instead of breaking into dots.

const GIRDER = 0.035

type Point = [number, number, number]

/** The four legs between two heights, each running from corner offset `a` to `b`. */
function legs(y0: number, y1: number, a: number, b: number, w: number, from = 0, to = 1): Part[] {
    const parts: Part[] = []
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            const at = (t: number): Point => [sx * (a + (b - a) * t), y0 + (y1 - y0) * t, sz * (a + (b - a) * t)]
            parts.push(beam(at(from), at(to), w, IRON_BROWN))
        }
    }
    return parts
}

/** Cross-bracing on the four faces between two heights: the lattice that makes it the tower. */
function bracing(y0: number, y1: number, a: number, b: number): Part[] {
    const parts: Part[] = []
    const corner = (sx: number, sz: number, t: number): Point => [sx * (a + (b - a) * t), y0 + (y1 - y0) * t, sz * (a + (b - a) * t)]
    const faces: [[number, number], [number, number]][] = [[[-1, 1], [1, 1]], [[1, 1], [1, -1]], [[1, -1], [-1, -1]], [[-1, -1], [-1, 1]]]
    for (const [[ax, az], [bx, bz]] of faces) {
        parts.push(beam(corner(ax, az, 0), corner(bx, bz, 1), GIRDER, IRON_LIGHT))
        parts.push(beam(corner(bx, bz, 0), corner(ax, az, 1), GIRDER, IRON_LIGHT))
        parts.push(beam(corner(ax, az, 0.5), corner(bx, bz, 0.5), GIRDER, IRON_LIGHT))
    }
    return parts
}

function eiffelPhases(): Phase[] {
    const first = 0.7
    const second = 1.4
    const top = 2.35
    return [
        [
            ...[-1, 1].flatMap(sx => [-1, 1].map(sz => box(sx * 0.78, 0.03, sz * 0.78, 0.26, 0.1, 0.26, C.stoneLight))),
            box(0, 0.03, 0, 0.9, 0.02, 0.9, 0x8fbf5a, { flat: true })
        ],
        legs(0.13, first, 0.78, 0.38, 0.13, 0, 0.5),
        [
            ...legs(0.13, first, 0.78, 0.38, 0.13, 0.5, 1),
            ...bracing(0.13, first, 0.78, 0.38),
            box(0, first, 0, 1.0, 0.07, 1.0, IRON_BROWN),
            // The great arches between the legs.
            ...[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map(r => box(Math.sin(r) * 0.52, first - 0.16, Math.cos(r) * 0.52, 0.9, 0.05, GIRDER, IRON_LIGHT, { rotY: r }))
        ],
        [
            ...legs(first + 0.07, second, 0.34, 0.2, 0.09, 0, 0.5),
            ...[-1, 1].map(sz => box(0, first + 0.07, sz * 0.46, 0.8, 0.07, 0.04, IRON_LIGHT))
        ],
        [
            ...legs(first + 0.07, second, 0.34, 0.2, 0.09, 0.5, 1),
            ...bracing(first + 0.07, second, 0.34, 0.2),
            box(0, second, 0, 0.5, 0.06, 0.5, IRON_BROWN)
        ],
        [
            ...legs(second + 0.06, top, 0.17, 0.05, 0.06, 0, 0.5),
            ...bracing(second + 0.06, (second + 0.06 + top) / 2, 0.17, 0.11)
        ],
        [
            ...legs(second + 0.06, top, 0.17, 0.05, 0.06, 0.5, 1),
            ...bracing((second + 0.06 + top) / 2, top, 0.11, 0.05),
            box(0, top, 0, 0.16, 0.1, 0.16, IRON_LIGHT)
        ],
        [
            cyl(0, top + 0.1, 0, 0.04, 0.3, IRON_BROWN, { seg: 5 }),
            ball(0, top + 0.4, 0, 0.08, 0.08, C.lit, { emissive: FLAME_GLOW, seg: 6 }),
            // Lights along both platforms after dark.
            ...[-1, 1].flatMap(s => [
                box(s * 0.5, first + 0.07, 0, 0.04, 0.035, 0.9, C.lit, { emissive: C.litGlow }),
                box(0, second + 0.06, s * 0.25, 0.44, 0.035, 0.04, C.lit, { emissive: C.litGlow })
            ]),
            ...flag(0.05, top + 0.1, 0, TRICOLOUR[0], 0.18)
        ]
    ]
}

const MONUMENTS: Record<TownMonumentId, { size: number, phases: () => Phase[] }> = {
    pyramid: { size: 3, phases: pyramidPhases },
    colosseum: { size: 3, phases: colosseumPhases },
    lighthouse: { size: 2, phases: lighthousePhases },
    arc: { size: 2, phases: arcPhases },
    eiffel: { size: 2, phases: eiffelPhases }
}

const phaseCache = new Map<TownMonumentId, Phase[]>()

function tallest(parts: Part[]): number {
    return parts.reduce((h, p) => Math.max(h, p.y + p.h), 0)
}

/** The monument at `stage` (0 = the staked site, TOWN_MONUMENT_STAGES = finished). */
export function monumentModel(id: TownMonumentId, stage: number): ModelSpec {
    const def = MONUMENTS[id]
    let phases = phaseCache.get(id)
    if (!phases) phaseCache.set(id, phases = def.phases())
    const built = Math.max(0, Math.min(TOWN_MONUMENT_STAGES, Math.floor(stage)))
    const parts: Part[] = [paving(def.size), ...phases.slice(0, built).flat()]
    if (built === 0) parts.push(...stakes(def.size / 2 - 0.2))
    if (built < TOWN_MONUMENT_STAGES) parts.push(...buildingSite(def.size, tallest(parts), built))
    return { parts }
}

export const MONUMENT_MODELS: Record<TownMonumentId, (stage: number, variant: number) => ModelSpec> = {
    pyramid: stage => monumentModel('pyramid', stage),
    colosseum: stage => monumentModel('colosseum', stage),
    lighthouse: stage => monumentModel('lighthouse', stage),
    arc: stage => monumentModel('arc', stage),
    eiffel: stage => monumentModel('eiffel', stage)
}
