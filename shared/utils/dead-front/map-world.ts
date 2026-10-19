import type { DfBarricade, DfDoor, DfLight, DfPerkMachine, DfSolid, DfSpot, DfWallBuy, DfZone } from './map'
import type { DfPerkId, Vec3 } from './types'
import { DfVox, dfHash3, dfVoxGreedyBoxes } from './voxel'
import type { DfVoxFill, DfVoxPaletteEntry } from './voxel'

// Sainte-Croix, authored on a 0.5 m voxel grid. A ruined village crossroads
// behind the lines, northern France, 1917, at night. The grid is the source
// for both the collision (greedy-merged boxes, server and client) and the
// client's rendering (greedy-meshed chunks). Small props (sandbags, crates,
// graves, trees, wire) are placed as finer voxel models by the client and
// collide through simple boxes.
//
// Axes: x east, y up, z south (metres). Ground is y = 0, the rampart walk is
// y = 3. Five zones in a ring around a block of gutted houses:
//
//   z=-40 +---------------- chapel ------------+------------ cemetery ----------+
//         | nave (PaP in the chancel)           :  crypt (power)    pedestal    |
//         | bell tower      churchyard          :  graves, dead trees            |
//   z=-9  +--- D2 (rubble) ---+==== ruined houses (zombie pockets) ===+-- D3 gate -+
//         | farm               |  x -13..21, z -9..2                  | ramparts    |
//         | barn, orchard      +---------------------------------------+ bailey, gun |
//         | well, haystacks   D1          the square (start)          D4  wall walk |
//         |                    |   fountain, sandbags, cart           |  (y = 3)    |
//   z=37  +--------------------+---------------------------------------+-------------+
//       x=-40                x=-13                                  x=21          x=40

export const DF_VOX_CELL = 0.5
export const DF_VOX_ORIGIN = { x: -48, y: -0.5, z: -48 } as const
export const DF_VOX_SIZE = { x: 192, y: 34, z: 192 } as const
/** Floor of the rampart walk. */
export const DF_WALK_Y = 3

// ---------------------------------------------------------------- palette

type PalDef = readonly [color: number, mat: string, opts?: { solid?: boolean, emissive?: number }]

const PALETTE_DEF = {
    mud1: [0x4d3d2d, 'mud'], mud2: [0x584530, 'mud'], mud3: [0x3f3227, 'mud'], crater: [0x2f261e, 'mud'],
    grass1: [0x44602f, 'mud'], grass2: [0x4f6c36, 'mud'], grass3: [0x395229, 'mud'], dgrass: [0x33472a, 'mud'],
    cobble1: [0x6f6b66, 'stone'], cobble2: [0x5f5c58, 'stone'], cobble3: [0x7c7873, 'stone'], gutter: [0x4b4946, 'stone'],
    gravel1: [0x8a8174, 'stone'], gravel2: [0x787064, 'stone'],
    earth1: [0x5e4b37, 'mud'], earth2: [0x6a563e, 'mud'], duck: [0x7a5c39, 'wood'],
    flag1: [0x8f8778, 'stone'], flag2: [0x7e776a, 'stone'],
    stone1: [0x8b8579, 'stone'], stone2: [0x7c776d, 'stone'], stone3: [0x979083, 'stone'], moss: [0x55663d, 'stone'],
    ashlar1: [0xc3b89f, 'stone'], ashlar2: [0xb3a88f, 'stone'], ashlar3: [0xd0c6ac, 'stone'],
    brick1: [0x8f4c37, 'stone'], brick2: [0x7e4331, 'stone'], brick3: [0x9b5741, 'stone'],
    plaster1: [0xc9bc9f, 'stone'], plaster2: [0xb7aa8d, 'stone'],
    roof1: [0x8c412c, 'stone'], roof2: [0x7a3725, 'stone'], slate1: [0x4d525b, 'stone'], slate2: [0x41454d, 'stone'],
    wood1: [0x7b5737, 'wood'], wood2: [0x6b4a2f, 'wood'], beam: [0x4b3521, 'wood'], plank: [0x9a7a52, 'wood'],
    hay1: [0xc8a65a, 'wood'], hay2: [0xb4924a, 'wood'],
    iron: [0x3c3e42, 'metal'], rust: [0x7b4b2b, 'metal'],
    marble1: [0xbab7ae, 'stone'], marble2: [0xa8a59c, 'stone'],
    water: [0x2c4a5f, 'stone'],
    rubble1: [0x7b7569, 'stone'], rubble2: [0x696359, 'stone'],
    sill: [0x908979, 'stone', { solid: false }],
    pane: [0x1d2430, 'stone'],
    lit: [0xffb45c, 'stone', { emissive: 0.9 }],
    glassBlue: [0x5d72e0, 'stone', { emissive: 0.55 }], glassRed: [0xc8463f, 'stone', { emissive: 0.55 }], glassGold: [0xe2b24f, 'stone', { emissive: 0.6 }]
} as const satisfies Record<string, PalDef>

type PalName = keyof typeof PALETTE_DEF

/** Palette index by name. */
export const DF_MAP_P = {} as Record<PalName, number>
/** Index 0 is empty. */
export const DF_MAP_PALETTE: DfVoxPaletteEntry[] = [{ color: 0, mat: 'mud', solid: false }]
for (const [name, def] of Object.entries(PALETTE_DEF) as [PalName, PalDef][]) {
    DF_MAP_P[name] = DF_MAP_PALETTE.length
    DF_MAP_PALETTE.push({ color: def[0], mat: def[1], solid: def[2]?.solid ?? true, emissive: def[2]?.emissive })
}
const P = DF_MAP_P

// ---------------------------------------------------------------- props

export type DfPropKind
    = | 'crate' | 'crate-small' | 'sandbags' | 'cart' | 'cross' | 'gravestone' | 'tree' | 'dead-tree' | 'wire'
        | 'pew' | 'barrel' | 'hay' | 'rubble' | 'lamppost' | 'fieldgun' | 'fence'

export interface DfPropDef {
    /** Visual extent [x, y, z] in metres at rot 0. */
    size: [number, number, number]
    /** Collision box [x, y, z] centred on the footprint; none = decor. */
    coll?: [number, number, number]
    mat: string
}

export const DF_PROP_DEFS: Record<DfPropKind, DfPropDef> = {
    'crate': { size: [1, 1, 1], coll: [1, 1, 1], mat: 'crate' },
    'crate-small': { size: [0.75, 0.75, 0.75], coll: [0.75, 0.75, 0.75], mat: 'crate' },
    'sandbags': { size: [2, 1, 0.8], coll: [2, 1, 0.8], mat: 'sandbag' },
    'cart': { size: [3, 1.6, 1.7], coll: [3, 1.2, 1.6], mat: 'wood' },
    'cross': { size: [0.75, 1.4, 0.25], coll: [0.25, 1.4, 0.25], mat: 'stone' },
    'gravestone': { size: [0.8, 1, 0.3], coll: [0.8, 1, 0.3], mat: 'stone' },
    'tree': { size: [4.5, 6.5, 4.5], coll: [0.8, 3, 0.8], mat: 'wood' },
    'dead-tree': { size: [3.5, 5.5, 3.5], coll: [0.6, 3, 0.6], mat: 'wood' },
    'wire': { size: [2, 0.7, 0.7], mat: 'metal' },
    'pew': { size: [0.7, 0.95, 3], coll: [0.7, 0.95, 3], mat: 'wood' },
    'barrel': { size: [0.6, 0.9, 0.6], coll: [0.6, 0.9, 0.6], mat: 'metal' },
    'hay': { size: [1.25, 0.8, 0.8], coll: [1.25, 0.8, 0.8], mat: 'sandbag' },
    'rubble': { size: [1.5, 0.5, 1.5], mat: 'stone' },
    'lamppost': { size: [0.5, 3.1, 0.5], coll: [0.3, 3, 0.3], mat: 'metal' },
    'fieldgun': { size: [2.4, 1.6, 3.4], coll: [2.2, 1.5, 3], mat: 'metal' },
    'fence': { size: [2, 1.1, 0.15], mat: 'wood' }
}

export interface DfPropPlacement {
    kind: DfPropKind
    x: number
    y: number
    z: number
    /** Quarter turns about +y. */
    rot: number
    seed: number
}

// ---------------------------------------------------------------- output

export interface DfMapWorld {
    vox: DfVox
    props: DfPropPlacement[]
    /** Everything that collides: ground slab, edge walls, merged voxel boxes, props and machines. */
    solids: DfSolid[]
    zones: DfZone[]
    zoneRects: { zone: string, rect: Rect }[]
    doors: DfDoor[]
    barricades: DfBarricade[]
    pockets: { rect: Rect, zone: string }[]
    wallBuys: DfWallBuy[]
    perks: DfPerkMachine[]
    boxSpots: DfSpot[]
    pap: DfSpot
    power: DfSpot
    fuses: DfSpot[]
    /** Lightning-rod masts for the egg's rods step (lever at the base, facing `yaw`). */
    rods: DfSpot[]
    generator: DfSpot
    pedestal: DfSpot
    riserSpawns: DfSpot[]
    playerSpawns: Vec3[]
    lights: DfLight[]
    /** Stairs for the nav graph: bottom and top centre points. */
    stairs: { bottom: Vec3, top: Vec3, steps: number, zone: string }[]
}

export interface Rect {
    x0: number
    z0: number
    x1: number
    z1: number
}

function rect(x0: number, z0: number, x1: number, z1: number): Rect {
    return { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) }
}

function v(x: number, y: number, z: number): Vec3 {
    return { x, y, z }
}

/** Index of a solid's merge class (one per surface family). */
const CLASS_MATS = ['', 'mud', 'stone', 'wood', 'metal', 'sandbag'] as const

function classOf(mat: string): number {
    switch (mat) {
        case 'mud':
            return 1
        case 'wood':
        case 'crate':
        case 'planks':
        case 'beam':
            return 3
        case 'metal':
            return 4
        case 'sandbag':
            return 5
        default:
            return 2
    }
}

let cached: DfMapWorld | null = null

/** The Sainte-Croix voxel world (built once, shared). */
export function dfMapWorld(): DfMapWorld {
    if (!cached) cached = buildWorld()
    return cached
}

function buildWorld(): DfMapWorld {
    const C = DF_VOX_CELL
    const O = DF_VOX_ORIGIN
    const g = new DfVox(DF_VOX_SIZE.x, DF_VOX_SIZE.y, DF_VOX_SIZE.z)
    const ci = (x: number) => Math.round((x - O.x) / C)
    const cj = (y: number) => Math.round((y - O.y) / C)
    const ck = (z: number) => Math.round((z - O.z) / C)
    const fill = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, f: DfVoxFill) => {
        g.box(ci(x0), cj(y0), ck(z0), ci(x1), cj(y1), ck(z1), f)
    }
    const hole = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => fill(x0, y0, z0, x1, y1, z1, 0)
    const PI = Math.PI
    const special: DfSolid[] = []
    const solid = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: string, extra: Partial<DfSolid> = {}) => {
        special.push({ min: v(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)), max: v(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)), mat, ...extra })
    }

    // ------------------------------------------------------------ patterns
    const pick = (h: number, a: number, b: number, c: number) => (h < 0.42 ? a : h < 0.8 ? b : c)
    const vnoise = (i: number, k: number, scale: number, seed: number) => {
        const fx = i / scale
        const fz = k / scale
        const x0 = Math.floor(fx)
        const z0 = Math.floor(fz)
        const tx = fx - x0
        const tz = fz - z0
        const sx = tx * tx * (3 - 2 * tx)
        const sz = tz * tz * (3 - 2 * tz)
        const a = dfHash3(x0, 0, z0, seed)
        const b = dfHash3(x0 + 1, 0, z0, seed)
        const c = dfHash3(x0, 0, z0 + 1, seed)
        const d = dfHash3(x0 + 1, 0, z0 + 1, seed)
        return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz
    }
    /** Coursed masonry: 1 m blocks with every other course offset. */
    const masonry = (a: number, b: number, c: number, seed: number, mossy = true): DfVoxFill => (i, j, k) => {
        if (mossy && j === 1 && dfHash3(i, j, k, seed + 9) < 0.3) return P.moss
        const off = j & 1
        return pick(dfHash3((i + off) >> 1, j, (k + off) >> 1, seed), a, b, c)
    }
    const stoneWall = masonry(P.stone1, P.stone2, P.stone3, 3)
    const ashlarWall = masonry(P.ashlar1, P.ashlar2, P.ashlar3, 5, false)
    const brickWall = masonry(P.brick1, P.brick2, P.brick3, 7)
    const marbleWall = masonry(P.marble1, P.marble2, P.marble1, 11, false)
    const plasterWall: DfVoxFill = (i, j, k) => {
        if (vnoise(i + j * 3, k + j * 2, 5, 13) > 0.68) return pick(dfHash3(i, j, k, 2), P.brick1, P.brick2, P.brick3)
        return dfHash3(i, j, k, 4) < 0.5 ? P.plaster1 : P.plaster2
    }
    const roofTiles: DfVoxFill = (i, j) => (((j + (i >> 1)) & 1) ? P.roof1 : P.roof2)
    const slateTiles: DfVoxFill = (i, j, k) => (((j + (i >> 1) + (k >> 2)) & 1) ? P.slate1 : P.slate2)
    const planks: DfVoxFill = (i, _j, k) => (((i + k) % 3) === 0 ? P.wood2 : ((i + k) % 3) === 1 ? P.wood1 : P.plank)

    // ------------------------------------------------------------ ground skins (row j = 0, y -0.5..0)
    const craters = [[-46, -10, 3], [44, 6, 2.5], [-20, 44, 3], [12, 45, 2.5], [-45, 30, 2], [30, -45, 3], [-8, -46, 2.5], [46, -30, 2]]
    fill(-48, -0.5, -48, 48, 0, 48, (i, _j, k) => {
        const x = O.x + (i + 0.5) * C
        const z = O.z + (k + 0.5) * C
        for (const [cx, cz, r] of craters) {
            const d = Math.hypot(x - cx!, z - cz!)
            if (d < r! * 0.6) return P.crater
            if (d < r!) return P.mud3
        }
        const n = vnoise(i, k, 7, 21)
        return n > 0.62 ? (dfHash3(i, 0, k, 3) < 0.5 ? P.dgrass : P.grass3) : pick(dfHash3(i, 0, k, 1), P.mud1, P.mud2, P.mud3)
    })
    const groundRect = (x0: number, z0: number, x1: number, z1: number, f: DfVoxFill) => fill(x0, -0.5, z0, x1, 0, z1, f)
    // Square: cobbles.
    groundRect(-13, 2, 21, 37, (i, _j, k) => {
        if (vnoise(i, k, 9, 31) > 0.72) return P.gutter
        return pick(dfHash3(i, 0, k, 5), P.cobble1, P.cobble2, P.cobble3)
    })
    // Farm: mud with grass.
    groundRect(-41, -9, -13, 38, (i, _j, k) => {
        const n = vnoise(i, k, 6, 41)
        if (n > 0.55) return pick(dfHash3(i, 0, k, 6), P.grass1, P.grass2, P.grass3)
        return pick(dfHash3(i, 0, k, 7), P.mud1, P.mud2, P.earth1)
    })
    // Churchyard: grass with a gravel path to the portal.
    groundRect(-41, -41, 5, -9, (i, _j, k) => pick(dfHash3(i, 0, k, 8), P.grass1, P.grass2, P.grass3))
    groundRect(-31, -26, -28, -9, (i, _j, k) => (dfHash3(i, 0, k, 9) < 0.5 ? P.gravel1 : P.gravel2))
    groundRect(-28, -14, 5, -11, (i, _j, k) => (dfHash3(i, 0, k, 9) < 0.5 ? P.gravel1 : P.gravel2))
    // Cemetery: dark grass, gravel paths.
    groundRect(5, -41, 41, -9, (i, _j, k) => (vnoise(i, k, 5, 51) > 0.6 ? P.grass3 : dfHash3(i, 0, k, 10) < 0.5 ? P.dgrass : P.grass3))
    groundRect(5, -24, 41, -21, (i, _j, k) => (dfHash3(i, 0, k, 11) < 0.5 ? P.gravel1 : P.gravel2))
    groundRect(24, -30, 28, -21, (i, _j, k) => (dfHash3(i, 0, k, 11) < 0.5 ? P.gravel1 : P.gravel2))
    // Ramparts: packed earth with duckboards.
    groundRect(21, -9, 41, 38, (i, _j, k) => pick(dfHash3(i, 0, k, 12), P.earth1, P.earth2, P.mud1))
    groundRect(23, -8, 25, 37, (i, _j, k) => ((k & 1) ? P.duck : P.beam))
    // Ruined houses: rubble.
    groundRect(-13, -9, 21, 2, (i, _j, k) => pick(dfHash3(i, 0, k, 13), P.rubble1, P.rubble2, P.mud3))

    // ------------------------------------------------------------ perimeter
    // North: chapel (ashlar, authored below) and the cemetery wall.
    fill(-18, 0, -41, 41, 3.5, -40, stoneWall)
    fill(-18, 3.5, -41, 41, 4, -40, (i) => ((i & 3) < 2 ? P.stone2 : 0))
    // West: churchyard and farm walls.
    fill(-41, 0, -26, -40, 3.5, 38, stoneWall)
    // East: cemetery wall.
    fill(40, 0, -41, 41, 3.5, -9, stoneWall)
    // South: farm wall, the house row behind the square, the rampart wall.
    fill(-41, 0, 37, -13, 3.5, 38, stoneWall)
    fill(21, 0, 37, 41, 4.5, 38, stoneWall)

    // ------------------------------------------------------------ zone walls
    fill(-13, 0, 2, -12, 3.5, 37, brickWall) // farm | square
    fill(20, 0, 2, 21, 3.5, 37, brickWall) // square | ramparts
    fill(-41, 0, -9, -13, 3.5, -8, stoneWall) // farm | churchyard
    fill(21, 0, -9, 40, 3.5, -8, stoneWall) // cemetery | ramparts
    // Low churchyard wall to the cemetery with two open gaps (the lychgate and a breach).
    fill(4, 0, -40, 5, 1.5, -9, stoneWall)
    hole(4, 0, -24, 5, 1.5, -20)
    hole(4, 0, -36, 5, 1.5, -33)
    // Lychgate posts and roof over the main gap.
    fill(4, 0, -24.5, 5, 3, -24, P.beam)
    fill(4, 0, -20, 5, 3, -19.5, P.beam)
    fill(3.5, 3, -25, 5.5, 3.5, -19, roofTiles)
    fill(4, 3.5, -24.5, 5, 4, -19.5, roofTiles)

    // ------------------------------------------------------------ the house row south of the square (outside, facades)
    {
        const z0 = 37
        // Hollow houses: zombies climb out of them through the boarded windows.
        fill(-13, 0, z0, 21, 6.5, z0 + 1, plasterWall)
        fill(-13, 0, 44, 21, 6.5, 45, plasterWall)
        for (const x of [-13, -5, 5, 15, 20]) fill(x, 0, z0 + 1, x + 1, 6.5, 44, brickWall)
        fill(-13, 6, z0 + 1, 21, 6.5, 44, P.beam)
        // Pitched roofs per house, gables to the street.
        for (const [xa, xb] of [[-13, -5], [-5, 5], [5, 15], [15, 21]] as const) {
            for (let n = 0; n < xb - xa; n++) fill(xa + n * 0.5, 6.5 + n * 0.5, z0 - 0.5, xb - n * 0.5, 7 + n * 0.5, 45.5, roofTiles)
        }
        // Shuttered windows and the odd lit one upstairs; house doors at street level.
        for (let x = -11; x < 20; x += 3) {
            const lit = dfHash3(x, 1, 2, 77) < 0.3
            fill(x, 3.5, z0, x + 1, 5, z0 + 0.5, lit ? P.lit : P.pane)
        }
        for (const x of [-9, 6, 17]) fill(x, 0, z0, x + 1.5, 2.5, z0 + 0.5, P.beam)
    }

    // ------------------------------------------------------------ farmhouse (solid backdrop in the farm's corner)
    fill(-40, 0, 30, -31, 5, 37, plasterWall)
    for (let n = 0; n < 5; n++) fill(-40.5 + n * 0.5, 5 + n * 0.5, 29.5, -30.5 - n * 0.5, 5.5 + n * 0.5, 37, roofTiles)
    fill(-38, 2.5, 29.5, -37, 4, 30, P.lit)
    fill(-34, 2.5, 29.5, -33, 4, 30, P.pane)
    fill(-36, 0, 29.5, -34.5, 2.5, 30, P.beam)

    // ------------------------------------------------------------ the ruined houses (central block, zombie pockets inside)
    {
        const x0 = -13
        const x1 = 21
        const z0 = -9
        const z1 = 2
        const H = 5
        fill(x0, 0, z0, x1, H, z0 + 1, brickWall)
        fill(x0, 0, z1 - 1, x1, H, z1, plasterWall)
        fill(x0, 0, z0, x0 + 1, H, z1, brickWall)
        fill(x1 - 1, 0, z0, x1, H, z1, brickWall)
        fill(-1, 0, z0, 0, H, z1, brickWall)
        fill(9, 0, z0, 10, H, z1, brickWall)
        // Upper floor windows: dark, a few with a glow.
        for (let x = -11; x < 20; x += 2.5) {
            if (x > -1.5 && x < 0.5) continue
            fill(x, 3, z1 - 0.5, x + 1, 4.5, z1, dfHash3(x, 3, 1, 5) < 0.2 ? P.lit : P.pane)
            fill(x, 3, z0, x + 1, 4.5, z0 + 0.5, P.pane)
        }
        // Roof: a slate deck, with shell holes and broken gables.
        fill(x0, H, z0, x1, H + 0.5, z1, slateTiles)
        for (const [hx, hz, r] of [[-7, -4, 2], [5, -5, 2.5], [15, -3, 1.6]]) {
            fill(hx! - r!, H, hz! - r!, hx! + r!, H + 0.5, hz! + r!, 0)
        }
        for (let n = 0; n < 4; n++) {
            fill(-12 + n * 0.5, H + 0.5 + n * 0.5, z1 - 1, -2 - n * 0.5, H + 1 + n * 0.5, z1, plasterWall)
            fill(10 + n * 0.5, H + 0.5 + n * 0.5, z0, 20 - n * 0.5, H + 1 + n * 0.5, z0 + 1, brickWall)
        }
        // Rubble heaps inside (in the pockets: never on a zombie's queueing spot).
        fill(-11, 0, -8, -9, 0.5, -6, P.rubble1)
        fill(11, 0, -1, 13, 0.5, 1, P.rubble2)
    }

    // ------------------------------------------------------------ chapel
    {
        const H = 7.5
        const wall = ashlarWall
        fill(-41, 0, -41, -18, H, -40, wall) // north (perimeter)
        fill(-41, 0, -41, -40, H, -26, wall) // west (perimeter)
        fill(-41, 0, -27, -18, H, -26, wall) // south
        fill(-19, 0, -41, -18, H, -26, wall) // east
        // Buttresses on the south face.
        for (const x of [-38, -33, -26.5, -21]) fill(x, 0, -26, x + 1, 4, -25.5, wall)
        // Openings: the portal, a side door, the east door.
        hole(-31, 0, -27, -28, 4, -26)
        hole(-24, 0, -27, -22, 3, -26)
        hole(-19, 0, -35, -18, 3, -32)
        fill(-31.5, 4, -27, -27.5, 4.5, -25.5, P.ashlar3)
        // Lancet windows in stained glass.
        const glass: DfVoxFill = (_i, j) => (j % 3 === 0 ? P.glassGold : j % 3 === 1 ? P.glassBlue : P.glassRed)
        for (const x of [-37, -33.5, -25.5, -21.5]) fill(x, 3.5, -27, x + 1, 6.5, -26.5, glass)
        for (const x of [-37, -29.5, -21.5]) fill(x, 3.5, -40.5, x + 1, 6.5, -40, glass)
        fill(-41, 3, -34.5, -40.5, 6.5, -32.5, glass)
        // Chancel: one step up, the altar.
        fill(-40, 0, -40, -35, 0.5, -27, (i, _j, k) => (((i + k) & 1) ? P.ashlar1 : P.ashlar2))
        fill(-39.5, 0.5, -34.5, -38.5, 1.5, -31.5, P.marble1)
        fill(-39.5, 1.5, -34.5, -38.5, 2, -34, P.glassGold)
        // Floor: flagstones.
        groundRect(-40, -40, -19, -27, (i, _j, k) => ((((i >> 1) + (k >> 1)) & 1) ? P.flag1 : P.flag2))
        // Roof: stepped slate gable with the ridge along x, and a shell hole over the nave.
        for (let n = 0; n < 8; n++) {
            const y = H + n * 0.5
            const za = -41 + n
            const zb = -26 - n
            if (za >= zb) break
            fill(-41.5, y, za, -17.5, y + 0.5, za + 1, slateTiles)
            fill(-41.5, y, zb - 1, -17.5, y + 0.5, zb, slateTiles)
            if (zb - za <= 2) fill(-41.5, y, za, -17.5, y + 0.5, zb, slateTiles)
            fill(-41, y, za + 1, -40, y + 0.5, zb - 1, wall)
            fill(-19, y, za + 1, -18, y + 0.5, zb - 1, wall)
        }
        hole(-31, 7.5, -37, -26, 12, -30)
        fill(-31, 7.5, -37.5, -26, 8, -37, P.beam)
        // Bell tower at the east end.
        fill(-18, 0, -31, -14, 12, -27, wall)
        hole(-17.5, 9.5, -31, -14.5, 11.5, -27)
        hole(-18, 9.5, -30.5, -14, 11.5, -27.5)
        fill(-17, 9.5, -30, -15, 10.5, -28, P.rust)
        for (let n = 0; n < 4; n++) fill(-18.5 + n * 0.5, 12 + n * 0.5, -31.5 + n * 0.5, -13.5 - n * 0.5, 12.5 + n * 0.5, -26.5 - n * 0.5, slateTiles)
        fill(-16.5, 14, -29.5, -15.5, 16, -28.5, P.iron)
    }

    // ------------------------------------------------------------ churchyard
    // A war memorial plinth.
    fill(-3, 0, -34, -1, 1.5, -32, ashlarWall)
    fill(-2.5, 1.5, -33.5, -1.5, 3, -32.5, P.ashlar3)

    // ------------------------------------------------------------ cemetery: the crypt
    {
        fill(22, 0, -38, 30, 4, -30, marbleWall)
        hole(23, 0, -37, 29, 4, -31)
        hole(25, 0, -31, 27, 2.5, -30)
        fill(21.5, 4, -38.5, 30.5, 4.5, -29.5, P.marble2)
        for (let n = 0; n < 3; n++) fill(22 + n, 4.5 + n * 0.5, -30, 30 - n, 5 + n * 0.5, -29.5, P.marble1)
        fill(22, 0, -30, 23, 4, -29.5, P.marble1)
        fill(29, 0, -30, 30, 4, -29.5, P.marble1)
        groundRect(23, -37, 29, -31, (i, _j, k) => (((i + k) & 1) ? P.flag1 : P.flag2))
    }

    // ------------------------------------------------------------ farm: barn and well
    {
        // West wall is the perimeter; north and south walls, open to the east on posts.
        fill(-40, 0, 12, -28, 4.5, 13, planks)
        fill(-40, 0, 25, -28, 4.5, 26, planks)
        for (const z of [13, 18.5, 24]) fill(-29, 0, z, -28, 4.5, z + 1, P.beam)
        fill(-41, 0, 12, -40, 4.5, 26, planks)
        for (const z of [14.5, 18.5, 22.5]) fill(-40, 4, z, -28, 4.5, z + 0.5, P.beam)
        for (let n = 0; n < 8; n++) {
            const y = 4.5 + n * 0.5
            fill(-41, y, 11.5 + n, -27, y + 0.5, 12.5 + n, roofTiles)
            fill(-41, y, 25.5 - n, -27, y + 0.5, 26.5 - n, roofTiles)
            fill(-41, y, 12.5 + n, -40, y + 0.5, 25.5 - n, planks)
            fill(-29, y, 12.5 + n, -28, y + 0.5, 25.5 - n, planks)
        }
        hole(-35, 5.5, 11.5, -32, 8.5, 15)
        groundRect(-40, 13, -28, 25, (i, _j, k) => (dfHash3(i, 0, k, 14) < 0.35 ? P.hay2 : ((i + k) % 3 ? P.plank : P.wood1)))
        // Well.
        g.cylinder(ci(-20), ck(18), 3.1, cj(0), cj(1), P.stone2)
        g.cylinder(ci(-20), ck(18), 2.1, cj(0), cj(1), 0)
        g.cylinder(ci(-20), ck(18), 2.1, cj(0), cj(0.5), P.water)
        fill(-21.5, 1, 17.5, -21, 3, 18.5, P.beam)
        fill(-19, 1, 17.5, -18.5, 3, 18.5, P.beam)
        fill(-22, 3, 17, -18, 3.5, 19, roofTiles)
    }

    // ------------------------------------------------------------ square: the fountain
    {
        g.cylinder(ci(4), ck(19), 5.6, cj(0), cj(1), P.ashlar2)
        g.cylinder(ci(4), ck(19), 4.3, cj(0.5), cj(1), 0)
        g.cylinder(ci(4), ck(19), 4.3, cj(0), cj(0.5), P.water)
        fill(3.5, 0.5, 18.5, 4.5, 3, 19.5, P.ashlar3)
        fill(3.5, 3, 18.5, 4.5, 4.5, 19.5, P.stone3)
        fill(2.5, 3.5, 18.5, 5.5, 4, 19.5, P.stone3)
    }

    // ------------------------------------------------------------ ramparts: the town wall and its walk
    {
        const walkTop = DF_WALK_Y
        // Outer parapet with merlons.
        fill(40, 0, -9, 41, 4.5, 38, stoneWall)
        for (let z = -9; z < 38; z += 1.5) fill(40, 4.5, z, 41, 5, z + 0.75, P.stone2)
        // Wall body under the walk; the walk is decked with planks.
        fill(35, 0, -4, 40, walkTop - 0.5, 33, stoneWall)
        fill(35, walkTop - 0.5, -4, 40, walkTop, 33, (i, _j, k) => ((k & 3) === 0 ? P.beam : (i & 1) ? P.plank : P.wood1))
        // End towers.
        for (const [z0, z1] of [[-9, -4], [33, 38]]) {
            fill(34, 0, z0!, 41, 6.5, z1!, stoneWall)
            for (let x = 34; x < 41; x += 1.5) {
                fill(x, 6.5, z0!, x + 0.75, 7, z0! + 0.5, P.stone2)
                fill(x, 6.5, z1! - 0.5, x + 0.75, 7, z1!, P.stone2)
            }
            fill(35, 2.5, z0! === -9 ? -4.5 : 33, 36, 4, z0! === -9 ? -4 : 33.5, P.lit)
        }
        // Wide stairs down into the bailey: six 0.5 m steps of 1 m.
        for (const zs of [0, 24]) {
            for (let m = 0; m < 6; m++) fill(29 + m, 0, zs, 30 + m, (m + 1) * 0.5, zs + 4, (i, j, k) => (j === cj((m + 1) * 0.5) - 1 ? ((i + k) & 1 ? P.stone3 : P.stone1) : P.stone2))
        }
    }

    // ------------------------------------------------------------ props
    const props: DfPropPlacement[] = []
    let seedN = 1
    const prop = (kind: DfPropKind, x: number, z: number, rot = 0, y = 0) => {
        props.push({ kind, x, y, z, rot, seed: seedN++ })
    }
    // Square.
    prop('sandbags', -6, 25.5, 0)
    prop('sandbags', -7.6, 27.1, 1)
    prop('sandbags', -4.4, 27.1, 1)
    prop('sandbags', 12, 31, 0)
    prop('cart', 13, 10, 1)
    prop('crate', -10.5, 4.5)
    prop('crate', -10.5, 5.6)
    prop('crate-small', -9.4, 4.6)
    prop('crate', 18.5, 34.5)
    prop('crate-small', 18.6, 33.3)
    prop('barrel', 8.5, 32)
    prop('barrel', 9.3, 32.6)
    prop('lamppost', -9, 9)
    prop('lamppost', 17, 9)
    prop('lamppost', -9, 34)
    prop('lamppost', 17, 34)
    prop('tree', 16.5, 23)
    prop('wire', 5, 35.8)
    prop('wire', 17.5, 35.6)
    prop('rubble', 7, 3.2)
    prop('rubble', -2.5, 3)
    // Farm.
    for (const [x, z] of [[-34, -2], [-27, -2], [-20, -2], [-34, 5], [-27, 5], [-20, 6]] as const) prop('tree', x, z)
    prop('hay', -38, 20)
    prop('hay', -38, 21.2)
    prop('hay', -36.5, 24.3, 1)
    prop('crate', -31, 15)
    prop('crate-small', -32.2, 14.4)
    prop('cart', -24, 24, 0)
    prop('hay', -24, 31)
    prop('hay', -22.6, 31)
    prop('hay', -23.3, 31.9)
    prop('fence', -21, 10, 0)
    prop('fence', -17, 10, 0)
    prop('fence', -15.1, 11.1, 1)
    prop('lamppost', -16, 22)
    prop('barrel', -14.5, 33)
    prop('rubble', -15, -6)
    // Churchyard.
    prop('tree', -10, -17)
    for (const [x, z] of [[-36, -21], [-33, -21], [-36, -16], [-33, -16], [-24, -21], [-21, -21]] as const) prop('cross', x, z)
    prop('sandbags', -14, -12, 0)
    prop('sandbags', -12, -12, 0)
    prop('crate', 1.5, -11)
    prop('crate-small', 2.6, -11.2)
    prop('lamppost', -26, -14)
    prop('lamppost', -6, -30)
    prop('dead-tree', -9, -37)
    prop('wire', -36, -10.5)
    // Chapel nave: pews (two banks, a few lost to shellfire).
    for (const x of [-31.5, -29, -26.5]) prop('pew', x, -37.5)
    for (const x of [-31.5, -26.5, -24, -21.5]) prop('pew', x, -29.5)
    prop('rubble', -28.5, -33.5)
    // Cemetery: rows of graves either side of the gravel path.
    for (const x of [8, 11, 14, 17]) {
        for (const z of [-37, -33.5, -30, -27, -18, -15, -12]) {
            if ((x === 11 || x === 17) && z === -37) continue
            if (dfHash3(x, 1, z, 61) < 0.15) continue
            prop(dfHash3(x, 2, z, 62) < 0.45 ? 'cross' : 'gravestone', x, z)
        }
    }
    for (const x of [33, 36]) for (const z of [-37, -33.5, -30, -27, -18, -15]) prop(dfHash3(x, 3, z, 63) < 0.5 ? 'cross' : 'gravestone', x, z)
    prop('dead-tree', 19.5, -26.5)
    prop('dead-tree', 37, -12)
    prop('dead-tree', 8, -10.5)
    prop('lamppost', 21, -21)
    prop('lamppost', 31.5, -21)
    // Ramparts.
    prop('fieldgun', 27, 29, 0)
    prop('sandbags', 24, 26.5, 0)
    prop('barrel', 31.5, 32)
    prop('sandbags', 30, -5, 0)
    prop('sandbags', 25, 8, 1)
    prop('crate', 22, -6.5)
    prop('crate', 22, -5.4)
    prop('crate-small', 23.1, -6.4)
    prop('barrel', 33.5, 12)
    prop('barrel', 33.5, 16)
    prop('wire', 38, 6, 1, DF_WALK_Y)
    prop('wire', 38, 26, 1, DF_WALK_Y)
    prop('crate', 37.6, 30, 0, DF_WALK_Y)
    prop('lamppost', 33, 7)
    prop('lamppost', 33, 21)
    // Outside the walls: wire and wrecks in no-man's land.
    for (const [x, z, r] of [[-44, 0, 1], [-44, 14, 1], [-44, 30, 1], [44, -20, 1], [-30, -44, 0], [0, -44, 0], [30, -44, 0], [-30, 40.5, 0], [28, 40.5, 0], [44, -36, 1]] as const) prop('wire', x, z, r)
    for (const [x, z] of [[-45, -40], [45, 40], [-45, 44], [44, -4]] as const) prop('dead-tree', x, z)
    prop('cart', -44.5, 22, 1)
    prop('crate', 44, -14)

    // ------------------------------------------------------------ doors
    const doors: DfDoor[] = [
        { id: 'door-farm', label: 'Farmyard', cost: 750, zones: ['square', 'farm'], pos: v(-12.5, 0, 17.5), style: 'door' },
        { id: 'door-ramparts', label: 'The Ramparts', cost: 1000, zones: ['square', 'ramparts'], pos: v(20.5, 0, 17.5), style: 'debris' },
        { id: 'door-chapel', label: 'Churchyard', cost: 1000, zones: ['farm', 'chapel'], pos: v(-26.5, 0, -8.5), style: 'debris' },
        { id: 'door-cemetery', label: 'Cemetery Gate', cost: 1250, zones: ['ramparts', 'cemetery'], pos: v(28.5, 0, -8.5), style: 'door' }
    ]
    hole(-13, 0, 16, -12, 3, 19)
    fill(-13, 3, 15.5, -12, 3.5, 19.5, P.beam)
    solid(-13, 0, 16, -12, 3, 19, 'wood', { door: 'door-farm' })
    hole(20, 0, 16, 21, 3, 19)
    solid(20, 0, 16, 21, 3, 19, 'rubble', { door: 'door-ramparts' })
    solid(19.2, 0, 16.2, 20, 1.4, 18.8, 'rubble', { door: 'door-ramparts' })
    solid(21, 0, 16.4, 21.8, 1.1, 18.6, 'rubble', { door: 'door-ramparts' })
    hole(-28, 0, -9, -25, 3, -8)
    solid(-28, 0, -9, -25, 3, -8, 'rubble', { door: 'door-chapel' })
    solid(-27.8, 0, -8, -25.2, 1.3, -7.2, 'rubble', { door: 'door-chapel' })
    solid(-27.6, 0, -9.8, -25.4, 1.1, -9, 'rubble', { door: 'door-chapel' })
    hole(27, 0, -9, 30, 3, -8)
    fill(26.5, 3, -9, 30.5, 3.5, -8, P.iron)
    fill(26.5, 0, -9.5, 27, 4, -7.5, P.stone3)
    fill(30, 0, -9.5, 30.5, 4, -7.5, P.stone3)
    solid(27, 0, -8.75, 30, 3, -8.25, 'metal', { door: 'door-cemetery' })

    // ------------------------------------------------------------ boarded windows
    const barricades: DfBarricade[] = []
    const pockets: { rect: Rect, zone: string }[] = []
    const SILL = 1
    const TOP = 2.5
    const W = 2
    /** A window in a wall of thickness [t0, t1] along `axis`, opening at `centre`; `inward` points into the play area. */
    const window = (id: string, zone: string, axis: 'x' | 'z', centre: number, t0: number, t1: number, inward: 1 | -1) => {
        const a = centre - W / 2
        const b = centre + W / 2
        const inner = inward > 0 ? t1 : t0
        const outer = inward > 0 ? t0 : t1
        if (axis === 'x') {
            hole(a, 0, t0, b, TOP, t1)
            fill(a, 0, t0, b, SILL, t1, P.sill)
            solid(a, 0, t0, b, SILL, t1, 'stone', { playerOnly: true, barricade: id })
            solid(a, SILL, t0, b, TOP, t1, 'stone', { playerOnly: true, hidden: true, barricade: id })
            barricades.push({ id, zone, width: W, pos: v(centre, 0, inner), inward: v(0, 0, inward), outside: v(centre, 0, outer - inward * 1.0) })
            const far = outer - inward * 4.2
            pockets.push({ rect: rect(a - 1, outer, b + 1, far), zone })
        } else {
            hole(t0, 0, a, t1, TOP, b)
            fill(t0, 0, a, t1, SILL, b, P.sill)
            solid(t0, 0, a, t1, SILL, b, 'stone', { playerOnly: true, barricade: id })
            solid(t0, SILL, a, t1, TOP, b, 'stone', { playerOnly: true, hidden: true, barricade: id })
            barricades.push({ id, zone, width: W, pos: v(inner, 0, centre), inward: v(inward, 0, 0), outside: v(outer - inward * 1.0, 0, centre) })
            const far = outer - inward * 4.2
            pockets.push({ rect: rect(outer, a - 1, far, b + 1), zone })
        }
    }
    window('b-square-s1', 'square', 'x', -2, 37, 38, -1)
    window('b-square-s2', 'square', 'x', 12, 37, 38, -1)
    window('b-square-n', 'square', 'x', 4, 1, 2, 1)
    window('b-farm-w1', 'farm', 'z', 4, -41, -40, 1)
    window('b-farm-w2', 'farm', 'z', 23, -41, -40, 1)
    window('b-chapel-n1', 'chapel', 'x', -34, -41, -40, 1)
    window('b-chapel-n2', 'chapel', 'x', -25, -41, -40, 1)
    window('b-chapel-s', 'chapel', 'x', -6, -9, -8, -1)
    window('b-cemetery-n', 'cemetery', 'x', 18, -41, -40, 1)
    window('b-cemetery-e', 'cemetery', 'z', -26, 40, 41, -1)
    window('b-ramparts-s', 'ramparts', 'x', 27, 37, 38, -1)
    window('b-ramparts-w', 'ramparts', 'z', -3, 20, 21, 1)

    // ------------------------------------------------------------ machines and spots
    const perks: DfPerkMachine[] = []
    const perkMachine = (perk: DfPerkId, cx: number, y: number, cz: number, yaw: number, zone: string) => {
        const fx = Math.round(Math.sin(yaw))
        const fz = Math.round(Math.cos(yaw))
        solid(cx - 0.5, y, cz - 0.5, cx + 0.5, y + 2.1, cz + 0.5, 'metal', { prop: 'perk' })
        perks.push({ id: `perk-${perk}`, perk, pos: v(cx + fx * 0.95, y, cz + fz * 0.95), yaw, zone })
    }
    perkMachine('quickhand', 12, 0, 2.5, 0, 'square')
    perkMachine('ironhide', -18, 0, -7.5, 0, 'farm')
    perkMachine('steadyeye', -22, 0, -39.5, 0, 'chapel')
    perkMachine('secondwind', 39.5, 0, -16, -PI / 2, 'cemetery')
    perkMachine('twinfire', 21.5, 0, 31, PI / 2, 'ramparts')
    perkMachine('fleetfoot', 39.5, DF_WALK_Y, 16, -PI / 2, 'ramparts')

    /** Footprint proxy of a spot object (long side across the facing direction). */
    const spotProxy = (s: DfSpot, along: number, depth: number, height: number, mat: string, tag: string) => {
        const fx = Math.abs(Math.round(Math.sin(s.yaw)))
        const hx = fx ? depth / 2 : along / 2
        const hz = fx ? along / 2 : depth / 2
        solid(s.pos.x - hx, s.pos.y, s.pos.z - hz, s.pos.x + hx, s.pos.y + height, s.pos.z + hz, mat, { prop: tag })
    }
    const boxSpots: DfSpot[] = [
        { id: 'box-square', pos: v(-11.55, 0, 28), yaw: PI / 2, zone: 'square' },
        { id: 'box-farm', pos: v(-39.55, 0, 17), yaw: PI / 2, zone: 'farm' },
        { id: 'box-cemetery', pos: v(12, 0, -39.55), yaw: 0, zone: 'cemetery' },
        { id: 'box-ramparts', pos: v(21.45, 0, 23.5), yaw: PI / 2, zone: 'ramparts' }
    ]
    for (const s of boxSpots) spotProxy(s, 1.7, 0.8, 0.55, 'wood', 'boxstand')
    const pap: DfSpot = { id: 'pap', pos: v(-37, 0.5, -38.2), yaw: PI / 2, zone: 'chapel' }
    spotProxy(pap, 1.6, 1.2, 2.2, 'metal', 'pap')
    const power: DfSpot = { id: 'power', pos: v(26, 0, -36.75), yaw: 0, zone: 'cemetery' }
    solid(25.4, 0.4, -37, 26.6, 2.2, -36.75, 'metal', { prop: 'panel' })
    const generator: DfSpot = { id: 'generator', pos: v(27, 0, 14), yaw: PI / 4, zone: 'ramparts' }
    solid(26.3, 0, 13.3, 27.7, 1.6, 14.7, 'metal', { prop: 'generator' })
    const pedestal: DfSpot = { id: 'pedestal', pos: v(26, 0, -25.5), yaw: 0, zone: 'cemetery' }
    solid(25.65, 0, -25.85, 26.35, 1, -25.15, 'stone', { prop: 'pedestal' })
    const fuses: DfSpot[] = [
        { id: 'fuse-farm', pos: v(-31, 1, 15), yaw: 0.4, zone: 'farm' },
        { id: 'fuse-chapel', pos: v(-39, 1.5, -32.5), yaw: -0.3, zone: 'chapel' },
        { id: 'fuse-ramparts', pos: v(38, DF_WALK_Y, -2.5), yaw: 1.2, zone: 'ramparts' }
    ]

    // Lightning rods: tall iron masts, one up on the rampart walk, one in the
    // farm field, one among the graves. The lever faces the approach.
    const rods: DfSpot[] = [
        { id: 'rod-0', pos: v(39.4, DF_WALK_Y, 5.5), yaw: -PI / 2, zone: 'ramparts' },
        { id: 'rod-1', pos: v(-30, 0, 2), yaw: 0, zone: 'farm' },
        { id: 'rod-2', pos: v(11, 0, -33), yaw: 0, zone: 'cemetery' }
    ]
    for (const r of rods) {
        solid(r.pos.x - 0.35, r.pos.y, r.pos.z - 0.35, r.pos.x + 0.35, r.pos.y + 0.35, r.pos.z + 0.35, 'metal', { prop: 'rod' })
        solid(r.pos.x - 0.15, r.pos.y + 0.35, r.pos.z - 0.15, r.pos.x + 0.15, r.pos.y + 5.6, r.pos.z + 0.15, 'metal', { prop: 'rod' })
    }

    const wallBuys: DfWallBuy[] = [
        { id: 'wall-kar98k', weapon: 'kar98k', pos: v(-6, 1.5, 2), normal: v(0, 0, 1), zone: 'square' },
        { id: 'wall-mp18', weapon: 'mp18', pos: v(20, 1.5, 27), normal: v(-1, 0, 0), zone: 'square' },
        { id: 'wall-m1897', weapon: 'm1897', pos: v(-13, 1.5, 9), normal: v(-1, 0, 0), zone: 'farm' },
        { id: 'wall-thompson', weapon: 'thompson', pos: v(-35.5, 1.5, -26), normal: v(0, 0, 1), zone: 'chapel' }
    ]

    const zones: DfZone[] = [
        { id: 'square', name: 'The Square' },
        { id: 'farm', name: 'Farmyard' },
        { id: 'chapel', name: 'Chapel of Sainte-Croix' },
        { id: 'cemetery', name: 'The Cemetery' },
        { id: 'ramparts', name: 'The Ramparts' }
    ]
    const zoneRects = [
        { zone: 'square', rect: rect(-12, 2, 20, 37) },
        { zone: 'farm', rect: rect(-40, -8, -13, 37) },
        { zone: 'chapel', rect: rect(-40, -40, 4, -9) },
        { zone: 'cemetery', rect: rect(5, -40, 40, -9) },
        { zone: 'ramparts', rect: rect(21, -8, 40, 37) }
    ]

    const riserSpawns: DfSpot[] = [
        { id: 'riser-square-1', pos: v(-4, 0, 12), yaw: 0.5, zone: 'square' },
        { id: 'riser-square-2', pos: v(14, 0, 26), yaw: 2.4, zone: 'square' },
        { id: 'riser-farm-1', pos: v(-23.5, 0, 10.5), yaw: 1.0, zone: 'farm' },
        { id: 'riser-farm-2', pos: v(-30, 0, 30), yaw: -2.2, zone: 'farm' },
        { id: 'riser-chapel-1', pos: v(-28, 0, -33.5), yaw: 3.0, zone: 'chapel' },
        { id: 'riser-chapel-2', pos: v(-14, 0, -18), yaw: 0.2, zone: 'chapel' },
        { id: 'riser-cemetery-1', pos: v(26, 0, -21), yaw: -0.8, zone: 'cemetery' },
        { id: 'riser-cemetery-2', pos: v(12.5, 0, -22.5), yaw: 2.0, zone: 'cemetery' },
        { id: 'riser-ramparts-1', pos: v(27, 0, -3), yaw: 1.4, zone: 'ramparts' },
        { id: 'riser-ramparts-2', pos: v(28, 0, 20), yaw: -1.9, zone: 'ramparts' }
    ]
    const playerSpawns: Vec3[] = [v(2, 0, 30), v(4, 0, 30), v(2, 0, 32), v(4, 0, 32)]

    const LAMP = '#ffb766'
    const CANDLE = '#ff9a45'
    const FIRE = '#ff7a2e'
    const BULB = '#ffd9a0'
    const ARC = '#cfe0ff'
    const lights: DfLight[] = [
        // square
        { pos: v(-9, 3.2, 9), color: LAMP, intensity: 1.5, distance: 13, flicker: true },
        { pos: v(17, 3.2, 9), color: LAMP, intensity: 1.5, distance: 13, flicker: true },
        { pos: v(-9, 3.2, 34), color: LAMP, intensity: 1.4, distance: 13, flicker: true },
        { pos: v(17, 3.2, 34), color: LAMP, intensity: 1.4, distance: 13, flicker: true },
        { pos: v(8.9, 1.25, 32.3), color: FIRE, intensity: 2.0, distance: 10, flicker: true },
        { pos: v(4, 5.6, 2.8), color: ARC, intensity: 2.4, distance: 20, power: true },
        // farm
        { pos: v(-34, 3.4, 19), color: LAMP, intensity: 1.4, distance: 12, flicker: true },
        { pos: v(-16, 3.2, 22), color: LAMP, intensity: 1.4, distance: 13, flicker: true },
        { pos: v(-27, 0.5, 13), color: FIRE, intensity: 2.0, distance: 10, flicker: true },
        { pos: v(-18, 3.1, -7.2), color: BULB, intensity: 1.6, distance: 11, power: true },
        // chapel
        { pos: v(-38.8, 2.3, -30.5), color: CANDLE, intensity: 1.6, distance: 10, flicker: true },
        { pos: v(-36, 0.9, -28), color: CANDLE, intensity: 1.0, distance: 7, flicker: true },
        { pos: v(-29, 5.4, -33.5), color: BULB, intensity: 2.2, distance: 16, power: true },
        { pos: v(-22, 5.4, -33.5), color: BULB, intensity: 1.8, distance: 14, power: true },
        { pos: v(-26, 3.2, -14), color: LAMP, intensity: 1.4, distance: 13, flicker: true },
        { pos: v(-6, 3.2, -30), color: LAMP, intensity: 1.4, distance: 13, flicker: true },
        { pos: v(-29.5, 4.0, -25.2), color: LAMP, intensity: 1.0, distance: 9, flicker: true },
        // cemetery
        { pos: v(26, 3.4, -34), color: BULB, intensity: 1.6, distance: 10, power: true },
        { pos: v(21, 3.2, -21), color: LAMP, intensity: 1.4, distance: 13, flicker: true },
        { pos: v(31.5, 3.2, -21), color: LAMP, intensity: 1.4, distance: 13, flicker: true },
        // ramparts
        { pos: v(33, 3.2, 7), color: LAMP, intensity: 1.4, distance: 13, flicker: true },
        { pos: v(33, 3.2, 21), color: LAMP, intensity: 1.4, distance: 13, flicker: true },
        { pos: v(37.5, 7.6, -6.5), color: ARC, intensity: 2.4, distance: 22, power: true },
        { pos: v(37.5, 7.6, 35.5), color: ARC, intensity: 2.4, distance: 22, power: true },
        { pos: v(31.5, 1.3, 32), color: FIRE, intensity: 1.8, distance: 9, flicker: true }
    ]

    const stairs = [0, 24].map(zs => ({ bottom: v(28.2, 0, zs + 2), top: v(35.8, DF_WALK_Y, zs + 2), steps: 6, zone: 'ramparts' }))

    // ------------------------------------------------------------ collision
    const solids: DfSolid[] = []
    solids.push({ min: v(-48, -1, -48), max: v(48, 0, 48), mat: 'mud' })
    // Map edge: tall invisible walls.
    solids.push({ min: v(-49, -1, -49), max: v(49, 17, -48), mat: 'stone', hidden: true })
    solids.push({ min: v(-49, -1, 48), max: v(49, 17, 49), mat: 'stone', hidden: true })
    solids.push({ min: v(-49, -1, -48), max: v(-48, 17, 48), mat: 'stone', hidden: true })
    solids.push({ min: v(48, -1, -48), max: v(49, 17, 48), mat: 'stone', hidden: true })
    const lut = DF_MAP_PALETTE.map(p => (p.solid === false ? 0 : classOf(p.mat)))
    for (const b of dfVoxGreedyBoxes(g, c => lut[c] ?? 0, 1)) {
        solids.push({
            min: v(O.x + b.i0 * C, O.y + b.j0 * C, O.z + b.k0 * C),
            max: v(O.x + b.i1 * C, O.y + b.j1 * C, O.z + b.k1 * C),
            mat: CLASS_MATS[b.cls] ?? 'stone'
        })
    }
    for (const p of props) {
        const def = DF_PROP_DEFS[p.kind]
        if (!def.coll) continue
        const odd = (p.rot & 1) === 1
        const hx = (odd ? def.coll[2] : def.coll[0]) / 2
        const hz = (odd ? def.coll[0] : def.coll[2]) / 2
        solids.push({ min: v(p.x - hx, p.y, p.z - hz), max: v(p.x + hx, p.y + def.coll[1], p.z + hz), mat: def.mat, prop: p.kind })
    }
    solids.push(...special)

    return {
        vox: g, props, solids, zones, zoneRects, doors, barricades, pockets, wallBuys, perks, boxSpots,
        pap, power, fuses, rods, generator, pedestal, riserSpawns, playerSpawns, lights, stairs
    }
}
