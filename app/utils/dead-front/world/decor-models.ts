import { dfHash3 } from '#shared/utils/dead-front/voxel'
import type { DfMeshOpts } from '../voxel/mesher'
import { DfVoxModel, scaleHex } from '../voxel/model'

// Hand-made voxel set dressing for Sainte-Croix: church furnishings, farm
// clutter, trench stores, graveside offerings and the small ground scatter
// (grass tufts, pebbles, wild flowers, brick chips). Every model is authored
// facing +z with its back against k = 0, so wall pieces sit flush on a wall.

export interface DfDecorModel {
    model: DfVoxModel
    /** Metres per voxel. */
    cell: number
    /** Pivot in voxel units (ends up at the placement point). */
    pivot: [number, number, number]
    /** Casts shadows (tall pieces only). */
    shadow: boolean
    /** Mesher options (scatter skips undersides and AO so blades merge into single quads). */
    opts?: Partial<DfMeshOpts>
}

const SCATTER: Partial<DfMeshOpts> = { skipFloorUnderside: true, aoMin: 1 }

const S = 0.0625

const WOOD_D = 0x4a3220
const IRON = 0x2b2c2f
const BRASS = 0xa98838
const CLOTH_RED = 0x7a1f1c
const GOLD = 0xc9a24a
const FLAME = 0xffc46a

function floor(m: DfVoxModel, cell = S, shadow = true): DfDecorModel {
    return { model: m, cell, pivot: [m.sx / 2, 0, m.sz / 2], shadow }
}

function wall(m: DfVoxModel, cell = S, shadow = false): DfDecorModel {
    return { model: m, cell, pivot: [m.sx / 2, 0, 0], shadow }
}

/** A church banner: red cloth with a gold border and cross on an iron rod, frayed hem. */
function banner(): DfDecorModel {
    const m = new DfVoxModel(12, 40, 1)
    const red = m.shade(CLOTH_RED, 0.06, 3)
    const gold = m.c(GOLD)
    m.box(1, 3, 0, 11, 38, 1, red)
    m.box(1, 3, 0, 2, 38, 1, gold).box(10, 3, 0, 11, 38, 1, gold).box(1, 36, 0, 11, 37, 1, gold)
    m.box(5, 14, 0, 7, 32, 1, gold).box(2, 25, 0, 10, 27, 1, gold)
    // Swallowtail hem.
    for (let i = 1; i < 11; i++) {
        const d = Math.abs(i - 5.5)
        m.box(i, 3, 0, i + 1, 3 + Math.round(5 - d), 1, 0)
        m.set(i, 3 + Math.round(5 - d), 0, (i === 1 || i === 10) ? gold : red(i, 0, 0))
    }
    m.box(0, 38, 0, 12, 39, 1, m.c(IRON)).box(5, 39, 0, 7, 40, 1, m.c(IRON))
    return wall(m)
}

/** A faded recruiting poster with a torn corner. */
function poster(seed: number): DfDecorModel {
    const m = new DfVoxModel(12, 16, 1)
    const paper = m.shade(seed ? 0xcdbf98 : 0xd6c9a4, 0.04, seed)
    m.box(0, 0, 0, 12, 16, 1, paper)
    if (seed) {
        // Tricolour band, a silhouette and lines of print.
        m.box(1, 11, 0, 4, 15, 1, m.c(0x34507a)).box(4, 11, 0, 8, 15, 1, m.c(0xd8d0bc)).box(8, 11, 0, 11, 15, 1, m.c(0x8e2a24))
        m.box(5, 4, 0, 7, 9, 1, m.c(0x3a3328)).box(5, 9, 0, 7, 10, 1, m.c(0x5a4a33))
        for (const y of [2, 3]) m.box(2, y, 0, 10, y + 1, 1, m.c(0x6a5e48))
    } else {
        m.box(1, 12, 0, 11, 15, 1, m.c(0x8e2a24))
        m.box(2, 5, 0, 10, 11, 1, m.c(0x4f5a3c)).box(4, 7, 0, 8, 10, 1, m.c(0xb9a985))
        for (const y of [2, 3]) m.box(1, y, 0, 11, y + 1, 1, m.c(0x6a5e48))
    }
    m.set(11, 15, 0, 0).set(10, 15, 0, 0).set(11, 14, 0, 0).set(0, 0, 0, 0)
    return wall(m)
}

/** A hanging café sign on an iron bracket. */
function sign(): DfDecorModel {
    const m = new DfVoxModel(2, 12, 16)
    const iron = m.c(IRON)
    m.box(0, 11, 0, 2, 12, 15, iron).box(0, 6, 0, 2, 12, 1, iron)
    for (let k = 0; k < 6; k++) m.set(0, 6 + k, k + 1, iron)
    const board = m.shade(0x5b3a22, 0.06, 4)
    m.box(0, 0, 4, 2, 9, 15, board)
    m.box(0, 1, 5, 2, 8, 6, m.c(GOLD)).box(0, 1, 13, 2, 8, 14, m.c(GOLD))
    m.box(0, 3, 7, 2, 6, 12, m.c(0xe2d2a0))
    m.set(0, 10, 6, iron).set(0, 10, 13, iron).set(0, 9, 6, iron).set(0, 9, 13, iron)
    return { model: m, cell: S, pivot: [1, 0, 0], shadow: false }
}

/** The tall wooden rood behind the altar. */
function rood(): DfDecorModel {
    const m = new DfVoxModel(20, 56, 4)
    const wood = m.shade(0x5a3b22, 0.05, 6)
    m.box(8, 0, 0, 12, 56, 4, wood).box(0, 38, 0, 20, 42, 4, wood)
    m.box(7, 0, 0, 13, 3, 4, m.c(WOOD_D))
    // A gilded halo plate behind the crossing.
    const g = m.c(GOLD, 0.15)
    for (let j = 0; j < 12; j++) {
        for (let i = 0; i < 12; i++) {
            const d = Math.hypot(i + 0.5 - 6, j + 0.5 - 6)
            if (d < 6 && d > 4.6) m.set(4 + i, 34 + j, 0, g)
        }
    }
    return { model: m, cell: S, pivot: [10, 0, 2], shadow: true }
}

/** Altar cloth: white linen with a red runner and gold fringe, draped over a 1 x 3 m altar top. */
function altarCloth(): DfDecorModel {
    const m = new DfVoxModel(18, 5, 50)
    const linen = m.shade(0xe4dccb, 0.03, 7)
    const red = m.c(CLOTH_RED)
    const gold = m.c(GOLD)
    m.box(0, 4, 0, 18, 5, 50, linen)
    m.box(0, 0, 0, 1, 4, 50, linen).box(17, 0, 0, 18, 4, 50, linen)
    m.box(6, 4, 0, 12, 5, 50, red).box(6, 0, 0, 12, 4, 1, red).box(6, 0, 49, 12, 4, 50, red)
    m.box(0, 0, 0, 1, 1, 50, gold).box(17, 0, 0, 18, 1, 50, gold)
    // Two candlesticks and a small gilt cross on the cloth.
    const brass = m.c(BRASS)
    const wax = m.c(0xe8e0c8)
    const flame = m.c(FLAME, 1)
    for (const z of [13, 43]) {
        m.box(8, 5, z, 10, 6, z + 2, brass)
        m.box(8, 6, z, 10, 0 + 9, z + 2, wax)
        m.set(8, 9, z, flame).set(9, 9, z + 1, flame)
    }
    return { model: m, cell: S, pivot: [9, 0, 25], shadow: false }
}

/** A floor candelabra: three tall candles on a brass stand. */
function candelabra(): DfDecorModel {
    const m = new DfVoxModel(9, 24, 3)
    const brass = m.c(BRASS)
    const wax = m.c(0xe8e0c8)
    const flame = m.c(FLAME, 1)
    m.box(2, 0, 0, 7, 1, 3, brass).box(4, 1, 1, 5, 16, 2, brass).box(0, 16, 1, 9, 17, 2, brass)
    for (const x of [0, 4, 8]) {
        const h = x === 4 ? 6 : 4
        m.box(x, 17, 1, x + 1, 17 + h, 2, wax)
        m.set(x, 17 + h, 1, flame)
    }
    return floor(m)
}

/** A splintered roof beam lying on the floor. */
function brokenBeam(): DfDecorModel {
    const m = new DfVoxModel(4, 4, 40)
    const wood = m.shade(0x4b3521, 0.08, 5)
    m.box(0, 0, 0, 4, 4, 40, wood)
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            const a = Math.floor(dfHash3(i, j, 0, 3) * 4)
            const b = Math.floor(dfHash3(i, j, 1, 3) * 4)
            m.box(i, j, 0, i + 1, j + 1, a, 0).box(i, j, 40 - b, i + 1, j + 1, 40, 0)
        }
    }
    m.box(0, 3, 12, 4, 4, 13, m.c(0x2a2a2c))
    return floor(m)
}

/** A carpenter's bench against a wall, with a vice, a saw and a mallet. */
function workbench(): DfDecorModel {
    const m = new DfVoxModel(30, 15, 10)
    const top = m.shade(0x7a5735, 0.06, 2)
    const leg = m.c(WOOD_D)
    m.box(0, 12, 0, 30, 14, 10, top)
    for (const x of [1, 27]) for (const z of [1, 7]) m.box(x, 0, z, x + 2, 12, z + 2, leg)
    m.box(1, 3, 1, 29, 4, 9, m.shade(0x6a4a2c, 0.06, 3))
    m.box(25, 14, 7, 29, 15, 10, m.c(IRON))
    // Saw and mallet on the top, a pot of nails.
    m.box(4, 14, 3, 13, 15, 5, m.c(0x8a8c90)).box(13, 14, 3, 16, 15, 5, m.c(0x7a5532))
    m.box(18, 14, 2, 20, 15, 7, m.c(0x6b4a2c)).box(17, 14, 6, 21, 15, 8, m.c(0x9a7a4a))
    m.box(22, 14, 2, 24, 16, 4, m.c(0x4a4a4e))
    return { model: m, cell: S, pivot: [15, 0, 0], shadow: true }
}

/** Tools hung on a wall: a pitchfork, a scythe and a coil of rope. */
function toolRack(): DfDecorModel {
    const m = new DfVoxModel(24, 34, 2)
    const handle = m.c(0x8a6a42)
    const iron = m.c(0x5a5c60)
    m.box(0, 26, 0, 24, 27, 1, m.c(WOOD_D))
    m.box(3, 2, 1, 4, 30, 2, handle)
    for (const x of [1, 3, 5]) m.box(x, 30, 1, x + 1, 34, 2, iron)
    m.box(1, 29, 1, 6, 30, 2, iron)
    m.box(12, 4, 1, 13, 32, 2, handle)
    for (let t = 0; t < 9; t++) m.set(13 + t, 31 - Math.floor(t * t / 14), 1, iron)
    const rope = m.c(0xb39a6a)
    for (let j = 0; j < 8; j++) {
        for (let i = 0; i < 6; i++) {
            const d = Math.hypot(i + 0.5 - 3, j + 0.5 - 4)
            if (d < 3.2 && d > 1.6) m.set(17 + i, 16 + j, 1, rope)
        }
    }
    return wall(m)
}

/** A heap of grain sacks. */
function sacks(): DfDecorModel {
    const m = new DfVoxModel(16, 9, 10)
    const sack = (x: number, y: number, z: number, w: number, d: number, s: number) => {
        const col = m.shade(dfHash3(x, y, z, 2) < 0.5 ? 0xb09a6c : 0xa08a5e, 0.05, s)
        m.vox.ellipsoid(x + w / 2, y + 2, z + d / 2, w / 2, 2.4, d / 2, col)
        m.set(Math.floor(x + w / 2), y + 4, Math.floor(z + d / 2), m.c(0x6a5a3a))
    }
    sack(0, 0, 0, 8, 5, 1)
    sack(7, 0, 1, 8, 5, 2)
    sack(2, 0, 5, 8, 5, 3)
    sack(4, 4, 2, 8, 5, 4)
    return floor(m)
}

/** A ladder, authored upright (placements lean it). */
function ladder(): DfDecorModel {
    const m = new DfVoxModel(8, 48, 1)
    const wood = m.shade(0x8a6a42, 0.06, 9)
    m.box(0, 0, 0, 1, 48, 1, wood).box(7, 0, 0, 8, 48, 1, wood)
    for (let j = 3; j < 47; j += 5) m.box(1, j, 0, 7, j + 1, 1, wood)
    m.box(1, 23, 0, 7, 24, 1, 0)
    return { model: m, cell: S, pivot: [4, 0, 0.5], shadow: true }
}

/** A plank bench. */
function bench(): DfDecorModel {
    const m = new DfVoxModel(24, 7, 6)
    const wood = m.shade(0x6f4f31, 0.06, 4)
    m.box(0, 5, 0, 24, 7, 6, wood)
    for (const x of [2, 20]) m.box(x, 0, 1, x + 2, 5, 5, m.c(WOOD_D))
    m.box(4, 2, 2, 20, 3, 4, m.c(WOOD_D))
    return floor(m)
}

/** A window box of geraniums. */
function flowerBox(): DfDecorModel {
    const m = new DfVoxModel(16, 6, 4)
    m.box(0, 0, 0, 16, 3, 4, m.shade(0x5e4a30, 0.05, 2))
    const leaf = m.c(0x3f5a2c)
    const reds = [m.c(0xc23a2e, 0.08), m.c(0xe0d6c0), m.c(0xd06a2a, 0.06)]
    for (let i = 1; i < 15; i++) {
        m.set(i, 3, 1, leaf).set(i, 3, 2, leaf)
        if (i % 2) m.set(i, 4, 1 + (i % 3 === 0 ? 1 : 0), leaf)
        if (dfHash3(i, 4, 1, 6) < 0.5) m.set(i, 5 - (i % 2), 1 + (i % 2), reds[i % 3]!)
    }
    return wall(m, S, false)
}

/** A stack of split logs. */
function woodpile(): DfDecorModel {
    const m = new DfVoxModel(16, 12, 8)
    const bark = m.c(0x4a3624)
    const end = m.shade(0xb08a5a, 0.08, 4)
    const ring = m.c(0x8a6a42)
    for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 2 : 0
        for (let n = 0; n < 4; n++) {
            const cx = off + n * 4 + 2
            if (cx > 15 || (row === 3 && (n === 0 || n === 3))) continue
            for (let j = 0; j < 3; j++) {
                for (let i = -2; i < 2; i++) {
                    const x = cx + i
                    if (x < 0 || x > 15) continue
                    const d = Math.hypot(i + 0.5, j - 1)
                    if (d > 2) continue
                    m.box(x, row * 3 + j, 0, x + 1, row * 3 + j + 1, 8, bark)
                    m.set(x, row * 3 + j, 7, d < 1 ? ring : end(x, j, 7))
                }
            }
        }
    }
    return { model: m, cell: S, pivot: [8, 0, 0], shadow: true }
}

/** A chopping block with an axe bitten into it. */
function chopBlock(): DfDecorModel {
    const m = new DfVoxModel(10, 14, 8)
    const wood = m.shade(0x6a4e32, 0.07, 5)
    m.vox.cylinder(4, 4, 3.5, 0, 6, wood)
    m.vox.cylinder(4, 4, 2.6, 5, 6, m.c(0xb08a5a))
    m.box(4, 6, 3, 9, 7, 5, m.c(0x8a8c90))
    for (let t = 0; t < 7; t++) m.set(5 + Math.floor(t * 0.4), 7 + t, 4, m.c(0x8a6a42))
    return floor(m)
}

/** A wooden pail. */
function bucket(): DfDecorModel {
    const m = new DfVoxModel(5, 5, 5)
    m.vox.cylinder(2.5, 2.5, 2.6, 0, 5, m.shade(0x6f5236, 0.05, 2))
    m.vox.cylinder(2.5, 2.5, 1.6, 1, 5, 0)
    m.vox.cylinder(2.5, 2.5, 1.6, 1, 3, m.c(0x223a4a))
    m.vox.cylinder(2.5, 2.5, 2.6, 3, 4, m.c(IRON))
    m.vox.cylinder(2.5, 2.5, 1.6, 3, 4, 0)
    return floor(m)
}

/** A water trough on stubby legs. */
function trough(): DfDecorModel {
    const m = new DfVoxModel(26, 8, 8)
    const wood = m.shade(0x5e4630, 0.06, 3)
    m.box(0, 1, 0, 26, 8, 8, wood)
    m.box(1, 3, 1, 25, 8, 7, 0)
    m.box(1, 3, 1, 25, 6, 7, m.c(0x1c3446))
    for (const x of [1, 23]) m.box(x, 0, 1, x + 2, 1, 7, m.c(WOOD_D))
    m.box(0, 4, 0, 26, 5, 1, m.c(IRON)).box(0, 4, 7, 26, 5, 8, m.c(IRON))
    return { model: m, cell: S, pivot: [13, 0, 0], shadow: true }
}

/** A scarecrow in a greatcoat and a battered kepi. */
function scarecrow(): DfDecorModel {
    const m = new DfVoxModel(16, 34, 4)
    const pole = m.c(0x5a4028)
    m.box(7, 0, 1, 9, 30, 3, pole).box(0, 21, 1, 16, 23, 3, pole)
    const coat = m.shade(0x5f6650, 0.07, 3)
    m.box(4, 11, 0, 12, 23, 4, coat).box(1, 19, 0, 15, 23, 4, coat)
    for (let i = 4; i < 12; i++) if (dfHash3(i, 0, 0, 7) < 0.5) m.set(i, 11, dfHash3(i, 1, 0, 7) < 0.5 ? 0 : 3, 0)
    m.box(0, 18, 0, 1, 20, 4, m.c(0xc8a65a)).box(15, 18, 0, 16, 20, 4, m.c(0xc8a65a))
    const sack = m.shade(0xb39a6a, 0.05, 8)
    m.box(5, 23, 0, 11, 30, 4, sack)
    m.set(6, 27, 3, m.c(0x1a1410)).set(9, 27, 3, m.c(0x1a1410))
    m.box(6, 25, 3, 10, 26, 4, m.c(0x3a2a1c))
    m.box(4, 30, 0, 12, 31, 4, m.c(0x3d4a63)).box(5, 31, 0, 11, 33, 4, m.c(0x4a5978)).box(5, 33, 1, 11, 34, 4, m.c(0x8a2a24))
    return floor(m)
}

/** Artillery shells stood in a neat row with a few lying in front. */
function shells(): DfDecorModel {
    const m = new DfVoxModel(14, 9, 7)
    const brass = m.c(BRASS)
    const steel = m.c(0x55583f)
    const cap = m.c(0x8a8c90)
    for (let n = 0; n < 5; n++) {
        const x = n * 3
        m.box(x, 0, 0, x + 2, 4, 2, brass).box(x, 4, 0, x + 2, 7, 2, steel).set(x, 7, 0, cap).set(x + 1, 7, 1, cap)
    }
    m.box(1, 0, 4, 9, 2, 6, steel).box(9, 0, 4, 12, 2, 6, brass)
    return floor(m)
}

/** An olive ammunition box with a stencilled lid. */
function ammoBox(seed: number): DfDecorModel {
    const m = new DfVoxModel(12, 7, 7)
    const olive = m.shade(seed ? 0x56603e : 0x4d5838, 0.05, seed + 2)
    m.box(0, 0, 0, 12, 7, 7, olive)
    m.box(0, 6, 0, 12, 7, 7, m.c(scaleHex(seed ? 0x56603e : 0x4d5838, 0.8)))
    m.box(3, 2, 6, 9, 4, 7, m.c(0xd8cfa8)).box(5, 2, 6, 7, 4, 7, m.c(0x4d5838))
    m.box(0, 3, 2, 1, 4, 5, m.c(IRON)).box(11, 3, 2, 12, 4, 5, m.c(IRON))
    return floor(m)
}

/** A field desk: trestle table, a field telephone, a map and a candle stub. */
function fieldDesk(): DfDecorModel {
    const m = new DfVoxModel(22, 16, 12)
    const top = m.shade(0x6a4c2e, 0.06, 4)
    m.box(0, 11, 0, 22, 12, 12, top)
    for (const x of [1, 19]) m.box(x, 0, 1, x + 2, 11, 11, m.c(WOOD_D))
    m.box(3, 12, 2, 13, 13, 9, m.c(0xc9bb92))
    m.box(5, 12, 4, 9, 13, 5, m.c(0x6a5e48)).box(8, 12, 6, 12, 13, 7, m.c(0x8e2a24))
    m.box(15, 12, 3, 20, 16, 8, m.c(0x3a2a1c)).box(15, 16, 4, 20, 17, 6, m.c(IRON)).set(17, 14, 8, m.c(BRASS))
    m.box(2, 12, 9, 3, 14, 10, m.c(0xe8e0c8)).set(2, 14, 9, m.c(FLAME, 1))
    return { model: m, cell: S, pivot: [11, 0, 0], shadow: true }
}

/** A coffin, lid askew. */
function coffin(): DfDecorModel {
    const m = new DfVoxModel(9, 7, 22)
    const wood = m.shade(0x4a3424, 0.06, 6)
    for (let k = 0; k < 22; k++) {
        const w = k < 6 ? 6 + Math.floor(k / 2) : 9 - Math.floor((k - 6) / 6)
        const x0 = Math.floor((9 - w) / 2)
        m.box(x0, 0, k, x0 + w, 5, k + 1, wood)
    }
    m.box(2, 1, 2, 7, 5, 20, 0)
    m.box(2, 1, 2, 7, 2, 20, m.c(0x2a1e16))
    for (let k = 3; k < 21; k++) m.box(2, 5, k, 8, 6, k + 1, wood)
    m.box(4, 6, 8, 5, 7, 13, m.c(BRASS)).box(3, 6, 10, 6, 7, 11, m.c(BRASS))
    return floor(m)
}

/** Ossuary niches on a crypt wall: stacked coffin ends and a skull. */
function niches(): DfDecorModel {
    const m = new DfVoxModel(24, 28, 6)
    const stone = m.c(0xa8a59c)
    m.box(0, 0, 0, 24, 28, 6, stone)
    m.box(0, 9, 0, 24, 10, 6, m.c(0x9a978e)).box(0, 18, 0, 24, 19, 6, m.c(0x9a978e))
    for (const [x, y] of [[1, 1], [9, 1], [17, 1], [1, 10], [9, 10], [17, 10], [1, 19], [9, 19], [17, 19]] as const) {
        m.box(x, y, 1, x + 6, y + 7, 6, 0)
        const h = dfHash3(x, y, 0, 4)
        if (h < 0.55) m.box(x + 1, y, 2, x + 5, y + 5, 6, m.c(0x4a3424))
        else if (h < 0.8) {
            const bone = m.c(0xd8d0b4)
            m.box(x + 2, y, 3, x + 5, y + 3, 6, bone).set(x + 2, y + 1, 5, m.c(0x1a1410)).set(x + 4, y + 1, 5, m.c(0x1a1410))
        }
    }
    return wall(m, S, false)
}

/** Fresh flowers and a wreath for a grave. */
function graveFlowers(seed: number): DfDecorModel {
    const m = new DfVoxModel(7, 3, 5)
    const leaf = m.c(0x3a5228)
    const bloom = [m.c(0xc23a2e, 0.06), m.c(0xe6dcc4), m.c(0x8a5ab0)]
    for (let i = 0; i < 7; i++) {
        for (let k = 0; k < 5; k++) {
            const h = dfHash3(i, seed, k, 9)
            if (h < 0.55) m.set(i, 0, k, leaf)
            if (h < 0.3) m.set(i, 1, k, bloom[Math.floor(h * 10) % 3]!)
        }
    }
    if (seed) m.box(2, 0, 1, 5, 3, 2, m.c(0x2e4a26)).box(3, 1, 1, 4, 2, 2, 0)
    return floor(m, S, false)
}

/** A grave lantern: an iron cage around a glowing candle. */
function graveLantern(): DfDecorModel {
    const m = new DfVoxModel(4, 7, 4)
    const iron = m.c(IRON)
    m.box(0, 0, 0, 4, 1, 4, iron).box(0, 5, 0, 4, 6, 4, iron).box(1, 6, 1, 3, 7, 3, iron)
    m.box(1, 1, 1, 3, 5, 3, m.c(0xffb45c, 0.9))
    for (const [x, z] of [[0, 0], [3, 0], [0, 3], [3, 3]] as const) m.box(x, 1, z, x + 1, 5, z + 1, iron)
    return floor(m, S, false)
}

/** A fresh grave: a mound of turned earth with a spade dropped on it. */
function graveMound(): DfDecorModel {
    const m = new DfVoxModel(16, 8, 26)
    const earthA = m.c(0x4e3b29)
    const earthB = m.c(0x45341f)
    const earth = (i: number, _j: number, k: number) => (dfHash3(i >> 2, 0, k >> 2, 5) < 0.5 ? earthA : earthB)
    for (let k = 0; k < 26; k++) {
        for (let i = 0; i < 16; i++) {
            const dx = (i + 0.5 - 8) / 8
            const dz = (k + 0.5 - 13) / 13
            const h = Math.round(5 * (1 - dx * dx - dz * dz) + dfHash3(i >> 1, 0, k >> 1, 3) * 1.5)
            for (let j = 0; j < h; j++) m.set(i, j, k, earth(i, j, k))
        }
    }
    // A spade dropped across the heap.
    for (let k = 4; k < 20; k++) m.set(9, 6, k, m.c(0x8a6a42))
    m.box(8, 6, 20, 11, 7, 24, m.c(0x6a6c70))
    return floor(m)
}

/** A war memorial wreath of laurel with a red ribbon. */
function wreath(): DfDecorModel {
    const m = new DfVoxModel(10, 10, 1)
    const laurel = m.shade(0x3c5a2c, 0.1, 5)
    for (let j = 0; j < 10; j++) {
        for (let i = 0; i < 10; i++) {
            const d = Math.hypot(i + 0.5 - 5, j + 0.5 - 5)
            if (d < 5 && d > 2.8) m.set(i, j, 0, laurel(i, j, 0))
        }
    }
    m.box(4, 0, 0, 6, 3, 1, m.c(0xa8221c)).set(3, 0, 0, m.c(0xa8221c)).set(6, 0, 0, m.c(0xa8221c))
    return wall(m)
}

/** A flagpole with a tattered tricolour. */
function flag(): DfDecorModel {
    const m = new DfVoxModel(20, 48, 1)
    m.box(0, 0, 0, 1, 48, 1, m.c(0x5a4028))
    const cols = [m.c(0x2f4a78), m.c(0xd8d0bc), m.c(0x962c25)]
    for (let i = 1; i < 19; i++) {
        const band = cols[Math.min(2, Math.floor((i - 1) / 6))]!
        const sag = Math.round(Math.sin(i * 0.5) * 1)
        const tear = i > 12 ? Math.floor(dfHash3(i, 0, 0, 4) * 4) : 0
        m.box(i, 34 + sag + tear, 0, i + 1, 46 + sag, 1, band)
    }
    return { model: m, cell: S, pivot: [0.5, 0, 0.5], shadow: false }
}

/** A bunting flag (one pennant, strung along a line by the decor builder). */
function pennant(seed: number): DfDecorModel {
    const m = new DfVoxModel(5, 6, 1)
    const col = m.c([0x34507a, 0xd8d0bc, 0x8e2a24][seed % 3]!)
    for (let j = 0; j < 6; j++) {
        const w = Math.max(1, Math.round((j + 1) * 5 / 6))
        const x0 = Math.floor((5 - w) / 2)
        m.box(x0, j, 0, x0 + w, j + 1, 1, col)
    }
    return { model: m, cell: S, pivot: [2.5, 6, 0.5], shadow: false }
}

/** A short length of string between pennants. */
function cord(): DfDecorModel {
    const m = new DfVoxModel(1, 1, 1)
    m.set(0, 0, 0, m.c(0x2a2622))
    return { model: m, cell: 1, pivot: [0.5, 0.5, 0.5], shadow: false }
}

// ---------------------------------------------------------------- scatter

/** A grass tuft (three shapes). */
function tuft(seed: number): DfDecorModel {
    const m = new DfVoxModel(5, 6, 5)
    const greens = [m.c(0x4f6534), m.c(0x5d743c), m.c(0x45592e), m.c(0x6b7d40)]
    const blades = seed === 0 ? [[2, 2, 5], [1, 3, 3], [3, 1, 4], [3, 3, 2], [0, 1, 2]] : seed === 1 ? [[2, 2, 6], [1, 1, 4], [3, 2, 3], [2, 4, 2]] : [[1, 2, 3], [3, 2, 4], [2, 1, 2], [2, 3, 3]]
    blades.forEach(([x, z, h], n) => {
        for (let j = 0; j < h!; j++) m.set(x! + (j > 3 ? (n % 2 ? 1 : -1) : 0), j, z!, greens[n % 4]!)
    })
    if (seed === 2) m.set(2, 3, 2, m.c(0xd8c870)).set(3, 4, 2, m.c(0xd8c870))
    return { model: m, cell: 0.05, pivot: [2.5, 0, 2.5], shadow: false, opts: SCATTER }
}

/** A few pebbles. */
function pebbles(seed: number): DfDecorModel {
    const m = new DfVoxModel(6, 2, 6)
    const greys = [m.c(0x7a756c), m.c(0x6a655d), m.c(0x8a8478)]
    const pts = seed ? [[0, 1], [3, 4], [4, 0]] : [[1, 1], [4, 3], [2, 4], [0, 4]]
    pts.forEach(([x, z], n) => {
        m.box(x!, 0, z!, x! + 2, 1, z! + (n % 2 ? 1 : 2), greys[n % 3]!)
        if (n === 0) m.set(x!, 1, z!, greys[2]!)
    })
    return { model: m, cell: 0.06, pivot: [3, 0, 3], shadow: false, opts: SCATTER }
}

/** Wild flowers: poppies or white campion. */
function wildflowers(seed: number): DfDecorModel {
    const m = new DfVoxModel(5, 5, 5)
    const stem = m.c(0x46602f)
    const bloom = seed ? m.c(0xe6e0cc) : m.c(0xc2281e, 0.12)
    for (const [x, z, h] of [[1, 1, 3], [3, 2, 4], [2, 4, 3]] as const) {
        for (let j = 0; j < h; j++) m.set(x, j, z, stem)
        m.set(x, h, z, bloom)
        if (!seed) m.set(x + 1 > 4 ? x - 1 : x + 1, h, z, bloom)
    }
    return { model: m, cell: 0.05, pivot: [2.5, 0, 2.5], shadow: false, opts: SCATTER }
}

/** Brick chips and mortar crumbs. */
function bricks(seed: number): DfDecorModel {
    const m = new DfVoxModel(7, 2, 6)
    const b = [m.c(0x8a4a36), m.c(0x7d4332), m.c(0xa49a88)]
    m.box(0, 0, 0, 3, 1, 2, b[seed % 2]!).box(3, 0, 3, 6, 1, 5, b[(seed + 1) % 2]!).set(5, 0, 0, b[2]!).set(1, 0, 4, b[2]!)
    if (seed) m.box(1, 1, 0, 3, 2, 1, b[0]!)
    return { model: m, cell: 0.08, pivot: [3.5, 0, 3], shadow: false, opts: SCATTER }
}

export type DfDecorKind
    = | 'banner' | 'poster-a' | 'poster-b' | 'sign' | 'rood' | 'altar-cloth' | 'candelabra' | 'beam' | 'workbench'
        | 'tool-rack' | 'sacks' | 'ladder' | 'bench' | 'flower-box' | 'woodpile' | 'chop-block' | 'bucket' | 'trough'
        | 'scarecrow' | 'shells' | 'ammo-a' | 'ammo-b' | 'field-desk' | 'coffin' | 'niches' | 'grave-flowers'
        | 'grave-wreath' | 'grave-lantern' | 'grave-mound' | 'wreath' | 'flag' | 'pennant-0' | 'pennant-1' | 'pennant-2' | 'cord'
        | 'tuft-0' | 'tuft-1' | 'tuft-2' | 'pebbles-0' | 'pebbles-1' | 'poppies' | 'campion' | 'bricks-0' | 'bricks-1'

export function dfBuildDecorModel(kind: DfDecorKind): DfDecorModel {
    switch (kind) {
        case 'banner': return banner()
        case 'poster-a': return poster(0)
        case 'poster-b': return poster(1)
        case 'sign': return sign()
        case 'rood': return rood()
        case 'altar-cloth': return altarCloth()
        case 'candelabra': return candelabra()
        case 'beam': return brokenBeam()
        case 'workbench': return workbench()
        case 'tool-rack': return toolRack()
        case 'sacks': return sacks()
        case 'ladder': return ladder()
        case 'bench': return bench()
        case 'flower-box': return flowerBox()
        case 'woodpile': return woodpile()
        case 'chop-block': return chopBlock()
        case 'bucket': return bucket()
        case 'trough': return trough()
        case 'scarecrow': return scarecrow()
        case 'shells': return shells()
        case 'ammo-a': return ammoBox(0)
        case 'ammo-b': return ammoBox(1)
        case 'field-desk': return fieldDesk()
        case 'coffin': return coffin()
        case 'niches': return niches()
        case 'grave-flowers': return graveFlowers(0)
        case 'grave-wreath': return graveFlowers(1)
        case 'grave-lantern': return graveLantern()
        case 'grave-mound': return graveMound()
        case 'wreath': return wreath()
        case 'flag': return flag()
        case 'pennant-0': return pennant(0)
        case 'pennant-1': return pennant(1)
        case 'pennant-2': return pennant(2)
        case 'cord': return cord()
        case 'tuft-0': return tuft(0)
        case 'tuft-1': return tuft(1)
        case 'tuft-2': return tuft(2)
        case 'pebbles-0': return pebbles(0)
        case 'pebbles-1': return pebbles(1)
        case 'poppies': return wildflowers(0)
        case 'campion': return wildflowers(1)
        case 'bricks-0': return bricks(0)
        case 'bricks-1': return bricks(1)
    }
}
