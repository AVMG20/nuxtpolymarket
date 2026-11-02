/**
 * Seeded world generation: terrain, towns and industries, all driven by one SeededRandom so the same seed
 * always yields the same world. Integers only; the generator is written from scratch and only its
 * behaviour mimics the original game (sea at height 0, coast beside it, towns on flat land around a
 * road cross, industries on flat footprints away from towns).
 */

import { clampUtf8 } from './bytes'
import { RT_CARGO_IDS, RT_CATALOG, RT_INDUSTRY_TYPE_IDS } from './catalog'
import {
    RT_DIRS,
    RT_DIR_DX,
    RT_DIR_DY,
    RT_MAP_SIDES,
    RT_MAX_HEIGHT,
    RT_ROAD_DIR_BIT,
    RtMap,
    RtSlope,
    RtTileKind,
    rtReverseDir,
    rtTreePayload,
    type RtDir
} from './map'
import { SeededRandom } from '../random'
import { RT_OWNER_NONE, type RtIndustry, type RtTown } from './types'

/* ------------------------------------------------------------------------------------------
 * Terrain
 * ---------------------------------------------------------------------------------------- */

export interface RtTerrainOptions {
    /** Share of corners left at sea level before smoothing (percent, 5 to 90). */
    seaPercent: number
    /** Height level the highest land reaches (1 to RT_MAX_HEIGHT). */
    peakHeight: number
    /** Average chance a forest-suited land tile carries trees (percent, 0 to 100). */
    treePercent: number
}

export const RT_TERRAIN_DEFAULTS: Readonly<RtTerrainOptions> = { seaPercent: 40, peakHeight: 6, treePercent: 22 }

/**
 * Over the outer side / EDGE_FALLOFF_DIVISOR corners the land sinks by up to EDGE_SINK raw units, so
 * the map edge is mostly sea while the noise still shapes where the coast runs.
 */
const EDGE_FALLOFF_DIVISOR = 8
const EDGE_SINK = 384
/** Lattice cells of the two height octaves and of the forest density field (tiles). */
const COARSE_CELL = 32
const FINE_CELL = 16
const FOREST_CELL = 8
/** The coarse octave weighs this many times the fine one. */
const COARSE_WEIGHT = 2

function checkInt(value: number, min: number, max: number, what: string): void {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(`${what} out of range: ${value}`)
    }
}

/**
 * One octave of integer value noise over the corner grid: random 0-255 values on a lattice of the
 * given cell size, bilinearly interpolated in integers. Returns (side + 1) squared values 0-255.
 */
function valueNoise(rng: SeededRandom, side: number, cell: number): Uint8Array {
    const points = side / cell + 2
    const lattice = new Uint8Array(points * points)
    for (let i = 0; i < lattice.length; i++) lattice[i] = rng.randomInt(0, 255)
    const c = side + 1
    const out = new Uint8Array(c * c)
    const area = cell * cell
    for (let cy = 0; cy < c; cy++) {
        const gy = (cy / cell) | 0
        const fy = cy - gy * cell
        for (let cx = 0; cx < c; cx++) {
            const gx = (cx / cell) | 0
            const fx = cx - gx * cell
            const at = gy * points + gx
            const v = lattice[at]! * (cell - fx) * (cell - fy)
                + lattice[at + 1]! * fx * (cell - fy)
                + lattice[at + points]! * (cell - fx) * fy
                + lattice[at + points + 1]! * fx * fy
            out[cy * c + cx] = (v / area) | 0
        }
    }
    return out
}

/** Lower corners until no two axis-adjacent corners differ by more than one level (an exact L1 sweep). */
function limitCornerSteps(map: RtMap): void {
    const c = map.side + 1
    const h = map.heights
    for (let cy = 0; cy < c; cy++) {
        for (let cx = 0; cx < c; cx++) {
            const i = cy * c + cx
            let v = h[i]!
            if (cx > 0 && h[i - 1]! + 1 < v) v = h[i - 1]! + 1
            if (cy > 0 && h[i - c]! + 1 < v) v = h[i - c]! + 1
            h[i] = v
        }
    }
    for (let cy = c - 1; cy >= 0; cy--) {
        for (let cx = c - 1; cx >= 0; cx--) {
            const i = cy * c + cx
            let v = h[i]!
            if (cx < c - 1 && h[i + 1]! + 1 < v) v = h[i + 1]! + 1
            if (cy < c - 1 && h[i + c]! + 1 < v) v = h[i + c]! + 1
            h[i] = v
        }
    }
}

/**
 * Fill the map's corner heights from two octaves of value noise, sink the edges into the sea, mark
 * water (every corner at sea level) and coast (land touching water), then scatter forests over land.
 */
export function generateTerrain(map: RtMap, rng: SeededRandom, options: RtTerrainOptions = RT_TERRAIN_DEFAULTS): void {
    checkInt(options.seaPercent, 5, 90, 'seaPercent')
    checkInt(options.peakHeight, 1, RT_MAX_HEIGHT, 'peakHeight')
    checkInt(options.treePercent, 0, 100, 'treePercent')
    const side = map.side
    const c = side + 1
    const coarse = valueNoise(rng, side, COARSE_CELL)
    const fine = valueNoise(rng, side, FINE_CELL)

    // raw height 0 .. 255 * (COARSE_WEIGHT + 1), sinking linearly over the outer falloff corners
    const raw = new Uint16Array(c * c)
    const rawTop = 255 * (COARSE_WEIGHT + 1)
    const falloff = side / EDGE_FALLOFF_DIVISOR
    const histogram = new Uint32Array(rawTop + 1)
    let rawMax = 0
    for (let cy = 0; cy < c; cy++) {
        for (let cx = 0; cx < c; cx++) {
            const i = cy * c + cx
            let v = coarse[i]! * COARSE_WEIGHT + fine[i]!
            const edge = Math.min(cx, cy, side - cx, side - cy)
            if (edge === 0) v = 0
            else if (edge < falloff) v = Math.max(0, v - (((falloff - edge) * EDGE_SINK / falloff) | 0))
            raw[i] = v
            histogram[v]!++
            if (v > rawMax) rawMax = v
        }
    }

    // sea level: the smallest raw value that puts seaPercent of the corners at or below it
    const seaCorners = Math.ceil(c * c * options.seaPercent / 100)
    let sea = 0
    let below = histogram[0]!
    while (below < seaCorners && sea < rawTop) below += histogram[++sea]!
    const span = Math.max(1, rawMax - sea)
    const h = map.heights
    for (let i = 0; i < raw.length; i++) {
        const v = raw[i]!
        h[i] = v <= sea ? 0 : 1 + (((v - sea - 1) * options.peakHeight / span) | 0)
    }
    limitCornerSteps(map)

    for (let i = 0; i < map.tileCount; i++) {
        map.setTile(i, map.tileMaxHeight(i) === 0 ? RtTileKind.water : RtTileKind.clear, RT_OWNER_NONE, 0)
    }
    for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
            const i = y * side + x
            if (map.kind[i] === RtTileKind.water) continue
            let wet = false
            for (let dy = -1; dy <= 1 && !wet; dy++) {
                for (let dx = -1; dx <= 1 && !wet; dx++) {
                    const nx = x + dx
                    const ny = y + dy
                    if (nx >= 0 && ny >= 0 && nx < side && ny < side && map.kind[ny * side + nx] === RtTileKind.water) wet = true
                }
            }
            if (wet) map.setTile(i, RtTileKind.coast, RT_OWNER_NONE, 0)
        }
    }

    // forests: a third noise field gathers trees into woods; density 64 or less grows none
    const forest = valueNoise(rng, side, FOREST_CELL)
    if (options.treePercent === 0) return
    for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
            const i = y * side + x
            if (map.kind[i] !== RtTileKind.clear) continue
            const weight = Math.max(0, forest[y * c + x]! - 64) * 2
            if (weight === 0 || !rng.randomRatio(options.treePercent * weight, 12800)) continue
            const stage = Math.min(rng.randomInt(0, 7), 6)
            map.setTile(i, RtTileKind.tree, RT_OWNER_NONE, rtTreePayload(rng.randomInt(0, 11), stage, rng.randomInt(1, 4)))
        }
    }
}

/* ------------------------------------------------------------------------------------------
 * Towns
 * ---------------------------------------------------------------------------------------- */

/** Town centres keep this far (Chebyshev tiles) from each other and from the map edge. */
export const RT_TOWN_SPACING = 12
const TOWN_ARM_MIN = 3
const TOWN_ARM_MAX = 6
const TOWN_ATTEMPTS_PER_TOWN = 200
const NAME_ATTEMPTS = 64

// Our own syllable sets: names are built from sounds, never drawn from a list of place names.
const ONSETS = ['b', 'br', 'c', 'd', 'dr', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 'st', 't', 'th', 'tr', 'v', 'w']
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'a', 'e', 'o', 'ai', 'ea', 'ou']
const CODAS = ['', '', '', 'l', 'n', 'r', 's', 'th', 'nd', 'rn', 'm', 'x']
/** Endings follow an open last syllable only, so no vowels pile up. */
const ENDINGS = ['', '', 'ria', 'ven', 'dor', 'wyn', 'lis', 'mar', 'tel', 'rin', 'sk']

function pick(rng: SeededRandom, list: readonly string[]): string {
    return list[rng.randomInt(0, list.length - 1)]!
}

/** A pronounceable name of two or three syllables, the last closed or given an ending. */
export function rtTownName(rng: SeededRandom): string {
    const count = rng.randomRatio(1, 4) ? 3 : 2
    let name = ''
    for (let k = 0; k < count; k++) name += pick(rng, ONSETS) + pick(rng, VOWELS)
    const coda = pick(rng, CODAS)
    name += coda === '' ? pick(rng, ENDINGS) : coda
    return clampUtf8(name.charAt(0).toUpperCase() + name.slice(1), RT_CATALOG.caps.maxNameBytes)
}

function uniqueTownName(rng: SeededRandom, taken: Set<string>): string {
    for (let k = 0; k < NAME_ATTEMPTS; k++) {
        const name = rtTownName(rng)
        if (!taken.has(name)) return name
    }
    // practically unreachable: the syllable space holds hundreds of thousands of names
    const base = rtTownName(rng)
    for (let n = 2; ; n++) {
        const name = clampUtf8(`${base.slice(0, 24)} ${n}`, RT_CATALOG.caps.maxNameBytes)
        if (!taken.has(name)) return name
    }
}

/** Whether a free tile may take a road (or building): clear land or trees, which are cleared. */
function isFreeLand(map: RtMap, i: number): boolean {
    const kind = map.kind[i]
    return kind === RtTileKind.clear || kind === RtTileKind.tree
}

/** Whether a road along dir may lie on tile i: flat, or a ramp climbing along that axis. */
function roadSlopeFits(map: RtMap, i: number, dir: RtDir): boolean {
    const slope = map.tileSlope(i)
    if (slope === RtSlope.flat) return true
    if ((dir & 1) === 0) return slope === RtSlope.ne || slope === RtSlope.sw
    return slope === RtSlope.nw || slope === RtSlope.se
}

/** Size class of a new house: the larger classes gather near the centre. */
function houseClass(rng: SeededRandom, distance: number): number {
    if (distance <= 2) return rng.randomInt(1, 2)
    if (distance <= 4) return rng.randomInt(0, 1)
    return rng.randomRatio(1, 4) ? 1 : 0
}

/** Normal growth interval of a town without active stations (town ticks), as townTick resets it. */
function initialGrowthRate(houses: number): number {
    const towns = RT_CATALOG.towns
    const base = towns.growthTownTicks[0]! >> towns.growthRateShift
    return (base / ((houses / towns.sizeDivisor | 0) + 1)) | 0
}

function cargoZeros(): number[] {
    return RT_CARGO_IDS.map(() => 0)
}

/**
 * Lay one town around centre: a road cross of 3 to 6 tiles per arm (stopping before anything but
 * free flat land or a ramp along the arm) and houses on free flat tiles beside the road.
 * Returns the house count and population, or null when no arm could be laid.
 */
function layTown(map: RtMap, rng: SeededRandom, centre: number): { houses: number, population: number } | null {
    const side = map.side
    const cx = centre % side
    const cy = (centre / side) | 0
    const arms: number[][] = []
    for (const dir of RT_DIRS) {
        const want = rng.randomInt(TOWN_ARM_MIN, TOWN_ARM_MAX)
        const arm: number[] = []
        for (let k = 1; k <= want; k++) {
            const x = cx + RT_DIR_DX[dir]! * k
            const y = cy + RT_DIR_DY[dir]! * k
            if (!map.inBounds(x, y)) break
            const i = y * side + x
            if (!isFreeLand(map, i) || !roadSlopeFits(map, i, dir)) break
            arm.push(i)
        }
        arms.push(arm)
    }
    if (arms.every(arm => arm.length === 0)) return null

    // house sites: free flat tiles beside the planned road, each once, in road order
    const planned = new Set<number>([centre, ...arms.flat()])
    const sites: number[] = []
    for (const road of planned) {
        for (const dir of RT_DIRS) {
            const n = map.neighbour(road, dir)
            if (n < 0 || planned.has(n) || sites.includes(n) || !isFreeLand(map, n) || !map.isFlat(n)) continue
            sites.push(n)
        }
    }
    if (sites.length === 0) return null

    let centreBits = 0
    for (const dir of RT_DIRS) {
        const arm = arms[dir]!
        if (arm.length === 0) continue
        centreBits |= RT_ROAD_DIR_BIT[dir]!
        const back = RT_ROAD_DIR_BIT[rtReverseDir(dir)]!
        arm.forEach((i, k) => {
            const bits = back | (k < arm.length - 1 ? RT_ROAD_DIR_BIT[dir]! : 0)
            map.setTile(i, RtTileKind.road, RT_OWNER_NONE, bits)
        })
    }
    map.setTile(centre, RtTileKind.road, RT_OWNER_NONE, centreBits)

    // three in four sites get a house; the first site always does, so no town starts empty
    const classes = RT_CATALOG.houses.classes
    let houses = 0
    let population = 0
    sites.forEach((site, k) => {
        if (k > 0 && !rng.randomRatio(3, 4)) return
        const distance = Math.max(Math.abs(site % side - cx), Math.abs(((site / side) | 0) - cy))
        const size = houseClass(rng, distance)
        map.setTile(site, RtTileKind.house, RT_OWNER_NONE, size)
        houses++
        population += classes[size]!.population
    })
    return { houses, population }
}

/**
 * Found up to count towns on flat land, each centre at least RT_TOWN_SPACING tiles from the others
 * and from the map edge, named uniquely from our syllable generator. Returns the towns in id order;
 * fewer than count when the map has no room.
 */
export function placeTowns(map: RtMap, rng: SeededRandom, count: number): RtTown[] {
    checkInt(count, 0, RT_CATALOG.caps.maxTowns, 'town count')
    const side = map.side
    const towns: RtTown[] = []
    const names = new Set<string>()
    const low = RT_TOWN_SPACING
    const high = side - 1 - RT_TOWN_SPACING
    for (let attempt = 0; attempt < count * TOWN_ATTEMPTS_PER_TOWN && towns.length < count; attempt++) {
        const x = rng.randomInt(low, high)
        const y = rng.randomInt(low, high)
        const centre = y * side + x
        if (!isFreeLand(map, centre) || !map.isFlat(centre)) continue
        const crowded = towns.some(t => Math.max(Math.abs(t.centre % side - x), Math.abs(((t.centre / side) | 0) - y)) < RT_TOWN_SPACING)
        if (crowded) continue
        const laid = layTown(map, rng, centre)
        if (!laid) continue
        const name = uniqueTownName(rng, names)
        names.add(name)
        towns.push({
            id: towns.length,
            name,
            centre,
            houseCount: laid.houses,
            population: laid.population,
            growthCounter: RT_CATALOG.towns.initialGrowthTownTicks,
            growthRate: initialGrowthRate(laid.houses),
            growing: false,
            activeStations: 0,
            receivedThisMonth: cargoZeros(),
            receivedLastMonth: cargoZeros()
        })
    }
    return towns
}

/* ------------------------------------------------------------------------------------------
 * Industries
 * ---------------------------------------------------------------------------------------- */

/** Industries keep this far (Chebyshev tiles) from every town tile and from each other. */
export const RT_INDUSTRY_SPACING = 8

/** Summed-area table over tiles: entry (x, y) counts flagged tiles in [0, x) by [0, y). */
function summedArea(map: RtMap, flagged: (i: number) => boolean): Int32Array {
    const side = map.side
    const c = side + 1
    const sums = new Int32Array(c * c)
    for (let y = 0; y < side; y++) {
        let row = 0
        for (let x = 0; x < side; x++) {
            if (flagged(y * side + x)) row++
            sums[(y + 1) * c + x + 1] = sums[y * c + x + 1]! + row
        }
    }
    return sums
}

/** Flagged tiles in [x0, x1) by [y0, y1), clipped to the map. */
function areaCount(sums: Int32Array, side: number, x0: number, y0: number, x1: number, y1: number): number {
    const c = side + 1
    const ax = Math.max(0, x0)
    const ay = Math.max(0, y0)
    const bx = Math.min(side, x1)
    const by = Math.min(side, y1)
    return sums[by * c + bx]! - sums[ay * c + bx]! - sums[by * c + ax]! + sums[ay * c + ax]!
}

/**
 * The north tile of a random w by h footprint that is free, fully flat land at least
 * RT_INDUSTRY_SPACING from every town tile and industry, or -1 when none exists. Every fitting
 * origin is counted and one is drawn uniformly, so placement never misses a site that fits.
 */
function findIndustrySite(map: RtMap, rng: SeededRandom, w: number, h: number): number {
    const side = map.side
    const unusable = summedArea(map, i => !isFreeLand(map, i) || !map.isFlat(i))
    const builtUp = summedArea(map, (i) => {
        const kind = map.kind[i]
        return kind === RtTileKind.road || kind === RtTileKind.house || kind === RtTileKind.industry
    })
    const reach = RT_INDUSTRY_SPACING - 1
    const fits = (x: number, y: number) => areaCount(unusable, side, x, y, x + w, y + h) === 0
        && areaCount(builtUp, side, x - reach, y - reach, x + w + reach, y + h + reach) === 0
    // keep a one-tile margin from the map edge
    let count = 0
    for (let y = 1; y < side - h; y++) {
        for (let x = 1; x < side - w; x++) if (fits(x, y)) count++
    }
    if (count === 0) return -1
    let pick = rng.randomInt(0, count - 1)
    for (let y = 1; y < side - h; y++) {
        for (let x = 1; x < side - w; x++) {
            if (fits(x, y) && pick-- === 0) return y * side + x
        }
    }
    return -1
}

/**
 * Place perType instances of every industry type, taking the types in turn so each gets its first
 * instance before any gets a second. Footprints are the catalog size on fully flat free land,
 * RT_INDUSTRY_SPACING from towns and other industries; each tile becomes industry kind with the
 * industry id as payload. An instance with no fitting site left is skipped.
 */
export function placeIndustries(map: RtMap, rng: SeededRandom, perType: number): RtIndustry[] {
    checkInt(perType, 0, Math.floor(RT_CATALOG.caps.maxIndustries / RT_INDUSTRY_TYPE_IDS.length), 'perType')
    const side = map.side
    const industries: RtIndustry[] = []
    for (let round = 0; round < perType; round++) {
        for (let type = 0; type < RT_INDUSTRY_TYPE_IDS.length; type++) {
            const spec = RT_CATALOG.industries[RT_INDUSTRY_TYPE_IDS[type]!]
            const origin = findIndustrySite(map, rng, spec.width, spec.height)
            if (origin < 0) continue
            const id = industries.length
            const x = origin % side
            const y = (origin / side) | 0
            for (let ty = y; ty < y + spec.height; ty++) {
                for (let tx = x; tx < x + spec.width; tx++) map.setTile(ty * side + tx, RtTileKind.industry, RT_OWNER_NONE, id)
            }
            industries.push({
                id,
                type,
                origin,
                waiting: cargoZeros(),
                delivered: cargoZeros(),
                producedThisMonth: cargoZeros(),
                transportedThisMonth: cargoZeros()
            })
        }
    }
    return industries
}

/* ------------------------------------------------------------------------------------------
 * The composed generator
 * ---------------------------------------------------------------------------------------- */

export interface RtWorldOptions {
    /** Map side: 64, 128 or 256. */
    side: number
    /** Towns to found (0 to RT_CATALOG.caps.maxTowns); defaults by side. */
    towns?: number
    /** Industry density 0 (none) to 4: instances of each type per 128 by 128 tiles, at least one. */
    industryDensity?: number
}

export interface RtWorldLayout {
    map: RtMap
    towns: RtTown[]
    industries: RtIndustry[]
    /** The u32 seed the layout was generated from. */
    seed: number
}

const DEFAULT_TOWNS: Record<number, number> = { 64: 3, 128: 10, 256: 28 }
const DEFAULT_INDUSTRY_DENSITY = 2
const MAX_INDUSTRY_DENSITY = 4

/** The options a world of the given side gets when nothing else is chosen. */
export function rtDefaultWorldOptions(side = 128): Required<RtWorldOptions> {
    return { side, towns: DEFAULT_TOWNS[side] ?? 10, industryDensity: DEFAULT_INDUSTRY_DENSITY }
}

/** Instances of each industry type for a side and density. */
export function rtIndustriesPerType(side: number, density: number): number {
    if (density === 0) return 0
    return Math.max(1, (density * side * side / (128 * 128)) | 0)
}

/** Generate a fresh world from a u32 seed: terrain, then towns, then industries, from one SeededRandom. */
export function generateWorld(seed: number, options: RtWorldOptions = rtDefaultWorldOptions()): RtWorldLayout {
    checkInt(seed, 0, 0xffffffff, 'seed')
    if (!RT_MAP_SIDES.includes(options.side)) throw new RangeError(`map side must be 64, 128 or 256: ${options.side}`)
    const resolved = { ...rtDefaultWorldOptions(options.side), ...definedOnly(options) }
    checkInt(resolved.towns, 0, RT_CATALOG.caps.maxTowns, 'towns')
    checkInt(resolved.industryDensity, 0, MAX_INDUSTRY_DENSITY, 'industryDensity')
    const rng = new SeededRandom(seed)
    const map = new RtMap(resolved.side)
    generateTerrain(map, rng, RT_TERRAIN_DEFAULTS)
    const towns = placeTowns(map, rng, resolved.towns)
    const industries = placeIndustries(map, rng, rtIndustriesPerType(resolved.side, resolved.industryDensity))
    return { map, towns, industries, seed }
}

function definedOnly(options: RtWorldOptions): Partial<RtWorldOptions> {
    const out: Partial<RtWorldOptions> = { side: options.side }
    if (options.towns !== undefined) out.towns = options.towns
    if (options.industryDensity !== undefined) out.industryDensity = options.industryDensity
    return out
}
