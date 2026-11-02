/**
 * Towns: house production of passengers and mail, active-station counting and growth.
 * Behaviour mimics the original game at its default settings (binomial cargo generation, normal
 * growth speed, original road layout); the code is written from scratch. Integers only; every random
 * draw goes through the SeededRandom passed in, in ascending tile order, so peers stay in lockstep.
 *
 * A house tile's payload is its size class (worldgen); it belongs to the nearest town centre by
 * Manhattan distance (ties to the lower id). Towns grow along their own roads (town-owned road tiles
 * nearest to them, and drive-through stops on those roads), as the original refuses to build over
 * another town's roads.
 */

import { RT_CARGO_IDS, RT_CATALOG } from './catalog'
import { distributeProduction } from './cargo'
import { manhattan } from './economy'
import { RT_DIRS, RT_ROAD_DIR_BIT, RtTileKind, rtReverseDir, type RtDir, type RtMap } from './map'
import { rtRoadBits, rtRoadSlopeError } from './road'
import type { SeededRandom } from '../random'
import { RtStationTile, rtRoadStopBits, rtRoadStopRoadOwner, rtStationTileType } from './stations-build'
import type { RtStationWorld } from './stations'
import { RT_NONE, RT_OWNER_NONE, type RtStation, type RtTown } from './types'

/** What town rules read and change; RtWorld satisfies it. */
export interface RtTownWorld extends RtStationWorld {
    readonly towns: readonly (RtTown | null)[]
    /** Marks a changed tile for the renderer (RtWorld.markDirty). */
    markDirty?(tile: number): void
}

const CARGOS = RT_CATALOG.cargos
const TOWNS = RT_CATALOG.towns

/* ------------------------------------------------------------------------------------------
 * House membership (derived; rebuilt from the map, never saved)
 * ---------------------------------------------------------------------------------------- */

/** The town a tile belongs to: the nearest centre by Manhattan distance, the lower id on a tie; RT_NONE without towns. */
export function rtNearestTownId(map: RtMap, towns: readonly (RtTown | null)[], tile: number): number {
    let best = RT_NONE
    let bestDistance = Infinity
    for (const town of towns) {
        if (!town) continue
        const d = manhattan(tile, town.centre, map.side)
        if (d < bestDistance) {
            best = town.id
            bestDistance = d
        }
    }
    return best
}

interface HouseCache {
    /** town id -> its house tiles, ascending */
    byTown: Map<number, number[]>
}

/** One cache per map; a decoded world has a new map, so it rebuilds from its tiles. */
const houseCaches = new WeakMap<RtMap, HouseCache>()

function houseCache(world: RtTownWorld): HouseCache {
    let cache = houseCaches.get(world.map)
    if (cache) return cache
    cache = { byTown: new Map() }
    const map = world.map
    for (let tile = 0; tile < map.tileCount; tile++) {
        if (map.kind[tile] !== RtTileKind.house) continue
        const id = rtNearestTownId(map, world.towns, tile)
        if (id === RT_NONE) continue
        const list = cache.byTown.get(id)
        if (list) list.push(tile)
        else cache.byTown.set(id, [tile])
    }
    houseCaches.set(map, cache)
    return cache
}

/** The town's house tiles, ascending (a tile no longer holding a house is dropped). */
export function rtTownHouses(world: RtTownWorld, town: RtTown): readonly number[] {
    const list = houseCache(world).byTown.get(town.id)
    if (!list) return []
    for (let k = list.length - 1; k >= 0; k--) if (world.map.kind[list[k]!] !== RtTileKind.house) list.splice(k, 1)
    return list
}

function addHouseToCache(world: RtTownWorld, townId: number, tile: number): void {
    const cache = houseCache(world)
    const list = cache.byTown.get(townId)
    if (!list) {
        cache.byTown.set(townId, [tile])
        return
    }
    let at = list.length
    while (at > 0 && list[at - 1]! > tile) at--
    if (list[at - 1] !== tile) list.splice(at, 0, tile)
}

/* ------------------------------------------------------------------------------------------
 * Town radius and active stations
 * ---------------------------------------------------------------------------------------- */

/** Squared radius of the town edge zone for a house count, as the original. */
export function rtTownEdgeRadiusSquared(houses: number): number {
    const table = TOWNS.edgeRadiusSquared
    if (houses < table.length * 4) return table[houses >> 2]!
    return Math.floor(houses / TOWNS.radiusMassDivisor) * TOWNS.radiusMassFactor - TOWNS.radiusOffset
}

/** Whether a station loaded or unloaded within activeStationWindow rating cycles of tick. */
export function rtStationActive(station: RtStation, tick: number): boolean {
    const window = TOWNS.activeStationWindow * RT_CATALOG.time.ratingCycleTicks
    const recent = (last: number) => last !== RT_NONE && last <= tick && tick - last <= window
    return recent(station.lastPickupTick) || recent(station.lastDeliveryTick)
}

/** Active stations whose sign lies within the town's edge radius (squared Euclidean, as the original). */
export function rtCountActiveStations(world: RtTownWorld, town: RtTown, tick: number): number {
    const map = world.map
    const limit = rtTownEdgeRadiusSquared(town.houseCount)
    const cx = map.tileX(town.centre)
    const cy = map.tileY(town.centre)
    let count = 0
    for (const station of world.stations) {
        if (!station || !map.validTile(station.sign)) continue
        const dx = map.tileX(station.sign) - cx
        const dy = map.tileY(station.sign) - cy
        if (dx * dx + dy * dy <= limit && rtStationActive(station, tick)) count++
    }
    return count
}

/** The normal growth interval in town ticks for an active station count and house count. */
export function rtTownGrowthRate(activeStations: number, houses: number): number {
    const table = TOWNS.growthTownTicks
    const base = table[Math.min(Math.max(0, activeStations), table.length - 1)]! >> TOWNS.growthRateShift
    return Math.min(TOWNS.maxTownTicks, Math.floor(base / (Math.floor(houses / TOWNS.sizeDivisor) + 1)))
}

/* ------------------------------------------------------------------------------------------
 * The town tick
 * ---------------------------------------------------------------------------------------- */

/** Units from one binomial roll: the set bits of a random u32 masked to (rate + 7) / genDivisor bits. */
function binomialAmount(rng: SeededRandom, rate: number): number {
    const bits = Math.floor((rate + 7) / TOWNS.genDivisor)
    const mask = bits >= 32 ? 0xffffffff : 2 ** bits - 1
    let v = (rng.next() & mask) >>> 0
    let count = 0
    while (v !== 0) {
        v &= v - 1
        count++
    }
    return count
}

/**
 * One tick of a town; RtWorld.step calls it every tick for each town in ascending id.
 * Houses: on the town's house period (housePeriodTicks, phased by town id), each house in ascending
 * tile order whose turn it is (a quarter of them each period, by the tile's low bits, as the
 * original's binomial mode) rolls passengers then mail and hands them to distributeProduction.
 * Growth: once per townTickUnit (phased by town id) a growing town counts down; past zero it tries to
 * grow (a house beside its road, or a road piece), then waits growthRate town ticks, or retries next
 * town tick after a failure. The monthly growth flag and rate are rtTownMonthly's.
 */
export function townTick(world: RtTownWorld, town: RtTown, rng: SeededRandom, tick: number): void {
    if ((tick + town.id) % TOWNS.housePeriodTicks === 0) produceHouses(world, town, rng, tick)
    if ((tick + town.id) % RT_CATALOG.time.townTickUnit === 0 && town.growing) {
        let counter = town.growthCounter - 1
        if (counter < 0) counter = growTown(world, town, rng) ? town.growthRate : 0
        town.growthCounter = Math.max(0, counter)
    }
}

function produceHouses(world: RtTownWorld, town: RtTown, rng: SeededRandom, tick: number): void {
    const map = world.map
    const classes = RT_CATALOG.houses.classes
    const turn = Math.floor(tick / TOWNS.housePeriodTicks) & 3
    for (const tile of rtTownHouses(world, town)) {
        if ((tile & 3) !== turn) continue
        const spec = classes[Math.min(classes.length - 1, map.payload[tile]! & 3)]!
        const passengers = binomialAmount(rng, spec.population)
        if (passengers > 0) distributeProduction(world, [tile], CARGOS.passengers.index, passengers)
        const mail = binomialAmount(rng, spec.mail)
        if (mail > 0) distributeProduction(world, [tile], CARGOS.mail.index, mail)
    }
}

/**
 * The town's monthly update (RtWorld.step calls it at each month change, towns in ascending id): count
 * active stations, set the normal growth rate (rescaling the counter so progress is kept, as the
 * original), decide whether the town grows this month (always with an active station, otherwise
 * with chance unservedGrowth), and roll this month's received cargo into last month's.
 */
export function rtTownMonthly(world: RtTownWorld, town: RtTown, rng: SeededRandom, tick: number): void {
    const active = rtCountActiveStations(world, town, tick)
    town.activeStations = active
    const old = town.growthRate
    town.growthRate = rtTownGrowthRate(active, town.houseCount)
    // keep relative progress: counter * (new + 1) / (old + 1), rounded
    town.growthCounter = Math.floor((town.growthCounter * (town.growthRate + 1) + Math.floor((old + 1) / 2)) / (old + 1))
    town.growing = active > 0 || rng.randomRatio(TOWNS.unservedGrowthNumerator, TOWNS.unservedGrowthDenominator)
    for (let cargo = 0; cargo < RT_CARGO_IDS.length; cargo++) {
        town.receivedLastMonth[cargo] = town.receivedThisMonth[cargo] ?? 0
        town.receivedThisMonth[cargo] = 0
    }
}

/* ------------------------------------------------------------------------------------------
 * Growth
 * ---------------------------------------------------------------------------------------- */

const Grow = { continue: 0, success: 1, stop: 2 } as const
type Grow = typeof Grow[keyof typeof Grow]

/** Road bits a town may walk on a tile: its own town road, or a drive-through stop on its road. */
function townRoadBits(world: RtTownWorld, town: RtTown, tile: number): number {
    const map = world.map
    const kind = map.kind[tile]
    if (kind === RtTileKind.road) {
        if (map.owner[tile] !== RT_OWNER_NONE) return 0
        if (rtNearestTownId(map, world.towns, tile) !== town.id) return 0
        return rtRoadBits(map.payload[tile]!)
    }
    if (kind === RtTileKind.station) {
        const payload = map.payload[tile]!
        if (rtStationTileType(payload) === RtStationTile.rail || rtRoadStopRoadOwner(payload) !== RT_OWNER_NONE) return 0
        if (rtNearestTownId(map, world.towns, tile) !== town.id) return 0
        return rtRoadStopBits(payload)
    }
    return 0
}

/** Whether the town may lay a new road with these bits on a tile: free land the bits fit on, nearest to it. */
function roadAllowed(world: RtTownWorld, town: RtTown, tile: number, bits: number): boolean {
    const map = world.map
    if (tile < 0) return false
    const kind = map.kind[tile]
    if (kind !== RtTileKind.clear && kind !== RtTileKind.tree) return false
    if (rtRoadSlopeError(map, tile, bits) !== null) return false
    return rtNearestTownId(map, world.towns, tile) === town.id
}

/** Whether the town may add bits to its own road tile (not a stop; the slope must take them). */
function canGrowRoad(world: RtTownWorld, town: RtTown, tile: number, bits: number): boolean {
    const map = world.map
    if (map.kind[tile] !== RtTileKind.road || map.owner[tile] !== RT_OWNER_NONE) return false
    if (rtNearestTownId(map, world.towns, tile) !== town.id) return false
    return rtRoadSlopeError(map, tile, rtRoadBits(map.payload[tile]!) | bits) === null
}

function setRoad(world: RtTownWorld, tile: number, bits: number): void {
    world.map.setTile(tile, RtTileKind.road, RT_OWNER_NONE, bits)
    world.markDirty?.(tile)
}

/** Size class of a new house: the larger classes gather near the centre. */
function newHouseClass(world: RtTownWorld, town: RtTown, tile: number, rng: SeededRandom): number {
    const map = world.map
    const distance = Math.max(Math.abs(map.tileX(tile) - map.tileX(town.centre)), Math.abs(map.tileY(tile) - map.tileY(town.centre)))
    if (distance <= 2) return rng.randomInt(1, 2)
    if (distance <= 4) return rng.randomInt(0, 1)
    return rng.randomRatio(1, 4) ? 1 : 0
}

/** Builds a house on free flat land that belongs to the town; false when the tile does not take one. */
function tryBuildHouse(world: RtTownWorld, town: RtTown, tile: number, rng: SeededRandom): boolean {
    const map = world.map
    if (tile < 0) return false
    const kind = map.kind[tile]
    if (kind !== RtTileKind.clear && kind !== RtTileKind.tree) return false
    if (!map.isFlat(tile)) return false
    if (rtNearestTownId(map, world.towns, tile) !== town.id) return false
    const size = newHouseClass(world, town, tile, rng)
    map.setTile(tile, RtTileKind.house, RT_OWNER_NONE, size)
    world.markDirty?.(tile)
    addHouseToCache(world, town.id, tile)
    town.houseCount++
    town.population += RT_CATALOG.houses.classes[size]!.population
    return true
}

/** Whether a tile beside the road holds a house (the original lets a straight road end beside one). */
function isHouse(map: RtMap, tile: number): boolean {
    return tile >= 0 && map.kind[tile] === RtTileKind.house
}

/** One growth step at a tile, the original's three cases: off the road, a road end to join, or on the road. */
function growInTile(world: RtTownWorld, town: RtTown, tile: number, bits: number, target: RtDir | -1, rng: SeededRandom): Grow {
    const map = world.map
    if (bits === 0) {
        // walked off the end of a road onto land: extend the road onto this tile
        if (target === -1) return Grow.stop
        const source = rtReverseDir(target)
        let dir = target
        if (rng.randomRatio(1, 4)) {
            do dir = rng.randomInt(0, 3) as RtDir
            while (dir === source)
        }
        const piece = RT_ROAD_DIR_BIT[source]! | RT_ROAD_DIR_BIT[dir]!
        if (!roadAllowed(world, town, tile, piece)) return Grow.stop
        if (!roadAllowed(world, town, map.neighbour(tile, dir), RT_ROAD_DIR_BIT[dir]! | RT_ROAD_DIR_BIT[rtReverseDir(dir)]!)) {
            if (dir !== target) return Grow.stop
            const left = map.neighbour(tile, ((dir + 1) & 3) as RtDir)
            const right = map.neighbour(tile, ((dir + 3) & 3) as RtDir)
            if (!isHouse(map, left) && !isHouse(map, right)) return Grow.stop
        }
        setRoad(world, tile, piece)
        return Grow.success
    }
    if (target !== -1 && (bits & RT_ROAD_DIR_BIT[rtReverseDir(target)]!) === 0) {
        // a road tile not yet joined toward where we came from: join it
        const join = RT_ROAD_DIR_BIT[rtReverseDir(target)]!
        if (!canGrowRoad(world, town, tile, join)) return Grow.continue
        setRoad(world, tile, bits | join)
        return Grow.success
    }
    // on the road: try a house beside it, or extend the road that way
    const dir = rng.randomInt(0, 3) as RtDir
    const bit = RT_ROAD_DIR_BIT[dir]!
    if ((bits & bit) !== 0) return Grow.continue
    const side = map.neighbour(tile, dir)
    if (side < 0) return Grow.continue
    const sideKind = map.kind[side]
    if (sideKind === RtTileKind.water || sideKind === RtTileKind.coast) return Grow.continue
    const allowHouse = !roadAllowed(world, town, side, bit | RT_ROAD_DIR_BIT[rtReverseDir(dir)]!) || rng.randomRatio(6, 10)
    if (allowHouse) {
        if (sideKind === RtTileKind.house) return Grow.continue
        return tryBuildHouse(world, town, side, rng) ? Grow.success : Grow.continue
    }
    if (!canGrowRoad(world, town, tile, bit)) return Grow.continue
    setRoad(world, tile, bits | bit)
    return Grow.success
}

/** Random walk along the town's roads from a start tile, trying to grow at each step (the original's GrowTownAtRoad). */
function growAtRoad(world: RtTownWorld, town: RtTown, start: number, rng: SeededRandom): boolean {
    const map = world.map
    let tile = start
    let target: RtDir | -1 = -1
    let iterations = 10 + Math.floor(town.houseCount * 4 / 9)
    do {
        let bits = townRoadBits(world, town, tile)
        const result = growInTile(world, town, tile, bits, target, rng)
        if (result === Grow.success) return true
        if (result === Grow.stop) return false
        if (target !== -1) bits &= ~RT_ROAD_DIR_BIT[rtReverseDir(target)]!
        if (bits === 0) return false
        let dir: RtDir
        do dir = rng.randomInt(0, 3) as RtDir
        while ((bits & RT_ROAD_DIR_BIT[dir]!) === 0)
        const next = map.neighbour(tile, dir)
        if (next < 0) return false
        const nextKind = map.kind[next]
        // never walk onto another town's or a company's road
        if ((nextKind === RtTileKind.road || nextKind === RtTileKind.station) && townRoadBits(world, town, next) === 0) return false
        tile = next
        target = dir
    } while (--iterations >= 0)
    return false
}

/** Tile offsets the original tries from the centre to find a road to grow from (cumulative steps). */
const SEARCH_STEPS: readonly (readonly [number, number])[] = [
    [-1, 0], [1, 1], [1, -1], [-1, -1], [-1, 0], [0, 2], [2, 0], [0, -2], [-1, -1], [-2, 2], [2, 2], [2, -2], [0, 0]
]

/** One growth attempt (the original's GrowTown): grow from the first own road near the centre, else lay a road block. */
function growTown(world: RtTownWorld, town: RtTown, rng: SeededRandom): boolean {
    const map = world.map
    let x = map.tileX(town.centre)
    let y = map.tileY(town.centre)
    for (const [dx, dy] of SEARCH_STEPS) {
        if (map.inBounds(x, y)) {
            const tile = map.idx(x, y)
            if (townRoadBits(world, town, tile) !== 0) return growAtRoad(world, town, tile, rng)
        }
        x += dx
        y += dy
    }
    x = map.tileX(town.centre)
    y = map.tileY(town.centre)
    for (const [dx, dy] of SEARCH_STEPS) {
        if (map.inBounds(x, y)) {
            const tile = map.idx(x, y)
            // only plain flat land of this town takes a random two-bit road block
            if (map.isFlat(tile) && roadAllowed(world, town, tile, 0)) {
                const a = rng.randomInt(0, 3)
                let b = rng.randomInt(0, 3)
                if (a === b) b ^= 2
                setRoad(world, tile, RT_ROAD_DIR_BIT[RT_DIRS[a]!]! | RT_ROAD_DIR_BIT[RT_DIRS[b]!]!)
                return true
            }
        }
        x += dx
        y += dy
    }
    return false
}
