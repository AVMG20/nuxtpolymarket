/**
 * Station catchment, acceptance and ratings. Behaviour mimics the original game at
 * its default settings (modified catchment, selective goods, manual cargo distribution); the code is
 * written from scratch. Integers only; every random draw goes through the SeededRandom passed in.
 *
 * Catchment: each station tile covers a square of its own radius (rail 4, road stop 3); the station
 * covers the union. It depends only on the station's own tiles, so it is a derived cache keyed by the
 * station's tilesRevision. Acceptance is saved station state: recomputed for each station on its own
 * phase every stationAcceptanceTicks, and at once when its tiles change (stationTilesChanged).
 * The tile-to-stations index is derived from the catchments only (no house or industry data), keyed by
 * the world's station list, checked against every station's tilesRevision on use and rebuilt when stale.
 */

import { RT_CARGO_IDS, RT_CATALOG, RT_INDUSTRY_TYPE_IDS } from './catalog'
import { RtTileKind, type RtMap } from './map'
import type { SeededRandom } from '../random'
import { RtStationTile, rtStationTileType } from './stations-build'
import { RT_NONE, RtFacility, type RtCargoPacket, type RtIndustry, type RtStation } from './types'

/** A station accepts a cargo when the summed acceptance in its catchment reaches 8 eighths. */
export const RT_ACCEPT_THRESHOLD = RT_CATALOG.catchment.acceptanceThreshold

/** Passengers: the one cargo of the passenger class (bus stops), every other cargo uses truck stops. */
const PASSENGERS = RT_CATALOG.cargos.passengers.index

/** What the catchment and acceptance rules read from a world; RtWorld satisfies it. */
export interface RtStationWorld {
    readonly map: RtMap
    readonly stations: readonly (RtStation | null)[]
}

/** Acceptance also reads industry types; RtWorld satisfies it. */
export interface RtAcceptanceWorld extends RtStationWorld {
    readonly industries: readonly (RtIndustry | null)[]
}

/* ------------------------------------------------------------------------------------------
 * Facility rules (original: passengers are never served by a truck stop alone, every other
 * cargo never by a bus stop alone; rail serves everything)
 * ---------------------------------------------------------------------------------------- */

/**
 * Whether a station with these facility bits handles a cargo at all: production, acceptance and
 * loading all use this rule. Passengers need rail or a bus stop; mail and freight need rail
 * or a truck stop, as the original (mail vans use truck stops).
 */
export function rtStationServesCargo(facilities: number, cargo: number): boolean {
    if (cargo === PASSENGERS) return (facilities & (RtFacility.rail | RtFacility.busStop)) !== 0
    return (facilities & (RtFacility.rail | RtFacility.truckStop)) !== 0
}

/* ------------------------------------------------------------------------------------------
 * Catchment
 * ---------------------------------------------------------------------------------------- */

/** Catchment radius of one station tile: rail platforms 4, road stops 3 (modified catchment). */
export function rtStationTileRadius(map: RtMap, tile: number, station: RtStation): number {
    const catchment = RT_CATALOG.catchment
    if (map.validTile(tile) && map.kind[tile] === RtTileKind.station) {
        return rtStationTileType(map.payload[tile]!) === RtStationTile.rail ? catchment.rail : catchment.roadStop
    }
    return (station.facilities & RtFacility.rail) !== 0 ? catchment.rail : catchment.roadStop
}

/**
 * The tiles a station covers, ascending and unique: the union of each station tile's square of its
 * own radius, clipped to the map. A station without tiles covers nothing.
 */
export function computeCatchment(map: RtMap, station: RtStation): number[] {
    const side = map.side
    const tiles = station.tiles
    if (tiles.length === 0) return []
    const reach = Math.max(RT_CATALOG.catchment.rail, RT_CATALOG.catchment.roadStop)
    let minX = side
    let minY = side
    let maxX = -1
    let maxY = -1
    for (const tile of tiles) {
        if (!map.validTile(tile)) continue
        const x = map.tileX(tile)
        const y = map.tileY(tile)
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
    }
    if (maxX < 0) return []
    const x0 = Math.max(0, minX - reach)
    const y0 = Math.max(0, minY - reach)
    const x1 = Math.min(side - 1, maxX + reach)
    const y1 = Math.min(side - 1, maxY + reach)
    const w = x1 - x0 + 1
    const mark = new Uint8Array(w * (y1 - y0 + 1))
    for (const tile of tiles) {
        if (!map.validTile(tile)) continue
        const r = rtStationTileRadius(map, tile, station)
        const tx = map.tileX(tile)
        const ty = map.tileY(tile)
        const ax = Math.max(x0, tx - r)
        const bx = Math.min(x1, tx + r)
        const ay = Math.max(y0, ty - r)
        const by = Math.min(y1, ty + r)
        for (let y = ay; y <= by; y++) {
            for (let x = ax; x <= bx; x++) mark[(y - y0) * w + (x - x0)] = 1
        }
    }
    const out: number[] = []
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) if (mark[(y - y0) * w + (x - x0)] === 1) out.push(y * side + x)
    }
    return out
}

/** Whether a station's catchment cache matches its current tiles. */
function catchmentFresh(station: RtStation): boolean {
    return station.catchment !== null && station.catchmentRevision === station.tilesRevision
}

/** The station's covered tiles from its derived cache, recomputed when its tiles changed. */
export function stationCatchment(map: RtMap, station: RtStation): readonly number[] {
    if (!catchmentFresh(station)) {
        station.catchment = computeCatchment(map, station)
        station.catchmentRevision = station.tilesRevision
    }
    return station.catchment!
}

/* ------------------------------------------------------------------------------------------
 * The tile-to-stations index (derived; never saved or hashed)
 * ---------------------------------------------------------------------------------------- */

interface StationIndex {
    side: number
    /** covered tile -> stations covering it, ascending id */
    byTile: Map<number, RtStation[]>
    /** station id -> the station object and tilesRevision the index was built from */
    built: Map<number, { station: RtStation, revision: number }>
}

const EMPTY_STATIONS: readonly RtStation[] = Object.freeze([])

/** One index per station list: a decoded world has a new list, so it starts with a fresh index. */
const indexes = new WeakMap<object, StationIndex>()

function indexStale(world: RtStationWorld, index: StationIndex): boolean {
    if (index.side !== world.map.side) return true
    let live = 0
    for (const station of world.stations) {
        if (!station) continue
        live++
        const entry = index.built.get(station.id)
        if (!entry || entry.station !== station || entry.revision !== station.tilesRevision || !catchmentFresh(station)) return true
    }
    return live !== index.built.size
}

/**
 * Rebuilds the world's tile-to-stations index from every station's catchment, in ascending id
 * (decode calls it from rtRebuildDerived; stationsAround rebuilds a stale index by itself).
 */
export function rtRebuildStationIndex(world: RtStationWorld): void {
    const index: StationIndex = { side: world.map.side, byTile: new Map(), built: new Map() }
    for (const station of world.stations) {
        if (!station) continue
        for (const tile of stationCatchment(world.map, station)) {
            const list = index.byTile.get(tile)
            if (list) list.push(station)
            else index.byTile.set(tile, [station])
        }
        index.built.set(station.id, { station, revision: station.tilesRevision })
    }
    indexes.set(world.stations, index)
}

/** The world's index, rebuilt first when any station's tiles changed, appeared or went. */
function stationIndex(world: RtStationWorld): StationIndex {
    const index = indexes.get(world.stations)
    if (index && !indexStale(world, index)) return index
    rtRebuildStationIndex(world)
    return indexes.get(world.stations)!
}

/** The stations whose catchment covers the tile, ascending id. Never allocates once the index is fresh. */
export function stationsAround(world: RtStationWorld, tile: number): readonly RtStation[] {
    return stationIndex(world).byTile.get(tile) ?? EMPTY_STATIONS
}

/** The stations covering any of the tiles, each once, ascending id (production sources). */
export function stationsAroundTiles(world: RtStationWorld, tiles: readonly number[]): RtStation[] {
    const index = stationIndex(world)
    if (tiles.length === 1) return (index.byTile.get(tiles[0]!) ?? EMPTY_STATIONS).slice()
    const seen = new Map<number, RtStation>()
    for (const tile of tiles) {
        const list = index.byTile.get(tile)
        if (!list) continue
        for (const station of list) seen.set(station.id, station)
    }
    return [...seen.values()].sort((a, b) => a.id - b.id)
}

/* ------------------------------------------------------------------------------------------
 * Acceptance
 * ---------------------------------------------------------------------------------------- */

/** Summed acceptance in eighths per cargo index over a set of tiles: houses by class, industry tiles by type. */
export function rtAcceptanceAround(world: RtAcceptanceWorld, tiles: readonly number[]): number[] {
    const map = world.map
    const sums = RT_CARGO_IDS.map(() => 0)
    const classes = RT_CATALOG.houses.classes
    const cargos = RT_CATALOG.cargos
    const industryEighths = RT_CATALOG.industryRules.acceptanceEighths
    for (const tile of tiles) {
        const kind = map.kind[tile]
        if (kind === RtTileKind.house) {
            const spec = classes[Math.min(classes.length - 1, map.payload[tile]! & 3)]!
            sums[cargos.passengers.index]! += spec.acceptPassengers
            sums[cargos.mail.index]! += spec.acceptMail
            sums[cargos.goods.index]! += spec.acceptGoods
        } else if (kind === RtTileKind.industry) {
            const industry = world.industries[map.payload[tile]!]
            if (!industry) continue
            const typeId = RT_INDUSTRY_TYPE_IDS[industry.type]
            if (!typeId) continue
            for (const cargo of RT_CATALOG.industries[typeId].accepts) sums[cargos[cargo].index]! += industryEighths
        }
    }
    return sums
}

/**
 * Recomputes a station's stored acceptance: the bit of each cargo whose summed acceptance over the
 * catchment reaches RT_ACCEPT_THRESHOLD and which the station's facilities handle.
 */
export function updateAcceptance(world: RtAcceptanceWorld, station: RtStation): void {
    const sums = rtAcceptanceAround(world, stationCatchment(world.map, station))
    let mask = 0
    for (let cargo = 0; cargo < sums.length; cargo++) {
        if (sums[cargo]! >= RT_ACCEPT_THRESHOLD && rtStationServesCargo(station.facilities, cargo)) mask |= 1 << cargo
    }
    station.acceptance = mask
}

/** Whether the station accepts the cargo, from its stored acceptance. */
export function accepts(station: RtStation, cargo: number): boolean {
    return Number.isInteger(cargo) && cargo >= 0 && ((station.acceptance >>> cargo) & 1) === 1
}

/**
 * A station's tiles changed (built, joined or removed): refresh its catchment and the index, and
 * recompute its acceptance at once. applyCommand calls it after every station build or removal that
 * applied; a station that lost its last tile is simply dropped from the index on next use.
 */
export function stationTilesChanged(world: RtAcceptanceWorld, station: RtStation): void {
    stationCatchment(world.map, station)
    rtRebuildStationIndex(world)
    updateAcceptance(world, station)
}

/** Whether this tick is the station's acceptance recompute, spread by id over stationAcceptanceTicks as the original. */
export function rtAcceptanceDue(station: RtStation, tick: number): boolean {
    return (tick + station.id) % RT_CATALOG.time.stationAcceptanceTicks === 0
}

/** Whether this tick ends one of the station's rating cycles, spread by id over ratingCycleTicks. */
export function rtRatingDue(station: RtStation, tick: number): boolean {
    return (tick + station.id) % RT_CATALOG.time.ratingCycleTicks === 0
}

/**
 * The per-tick station step for RtWorld.step: every station in ascending id recomputes its acceptance on
 * its acceptance tick and updates its ratings on its rating tick, drawing from the world's rng.
 */
export function stationsTick(world: RtAcceptanceWorld, rng: SeededRandom, tick: number): void {
    for (const station of world.stations) {
        if (!station) continue
        if (rtAcceptanceDue(station, tick)) updateAcceptance(world, station)
        if (rtRatingDue(station, tick)) {
            updateStationRatings(station, tick, rng, id => world.stations[id] ?? undefined)
        }
    }
}

/* ------------------------------------------------------------------------------------------
 * Ratings
 * ---------------------------------------------------------------------------------------- */

/** Units waiting in a packet list. */
export function rtPacketTotal(packets: readonly RtCargoPacket[]): number {
    let total = 0
    for (const packet of packets) total += packet.count
    return total
}

/**
 * Removes `amount` units from a station's waiting packets so each packet loses roughly the same
 * share: a pass over the packets oldest first skips each with probability (total - amount) / total
 * and otherwise takes what is still due from it; passes repeat until the amount is gone. Empty
 * packets are dropped. Returns the units removed.
 */
export function rtTruncatePackets(packets: RtCargoPacket[], amount: number, rng: SeededRandom): number {
    const total = rtPacketTotal(packets)
    const due = Math.min(Math.max(0, Math.floor(amount)), total)
    if (due === 0) return 0
    let removed = 0
    while (removed < due) {
        for (let k = 0; k < packets.length && removed < due; k++) {
            const packet = packets[k]!
            if (packet.count === 0) continue
            if (total > due && rng.randomInt(0, total - 1) < total - due) continue
            const take = Math.min(packet.count, due - removed)
            packet.count -= take
            removed += take
        }
    }
    for (let k = packets.length - 1; k >= 0; k--) if (packets[k]!.count === 0) packets.splice(k, 1)
    return removed
}

/** The rating a cargo moves toward this cycle, from the catalog bands (no statue in version 1). */
export function rtRatingTarget(lastSpeed: number, cyclesSincePickup: number, maxWaiting: number, lastAge: number): number {
    const spec = RT_CATALOG.stationRating
    let rating = 0
    const fast = lastSpeed - spec.speedBase
    if (fast >= 0) rating += fast >> spec.speedShift
    for (const band of spec.pickupBands) if (cyclesSincePickup <= band.maxCycles) rating += band.bonus
    rating -= spec.basePenalty
    for (const band of spec.waitingBands) if (maxWaiting <= band.maxWaiting) rating += band.bonus
    for (const band of spec.ageBands) if (lastAge < band.belowYears) rating += band.bonus
    return rating
}

/**
 * One rating cycle of a station, as the original: a cargo without a rating creeps back toward
 * the start rating; otherwise cyclesSincePickup advances, and at abandonCycles the rating and pile
 * are dropped. The rating moves toward its target by at most stepLimit; a low rating, a middling one
 * (by chance) and a huge pile remove waiting cargo at random, after which maxWaiting is fed back to
 * the packets' source stations. `nowTick` is unused (the cycle counter carries time); `lookup` finds
 * source stations for that feedback (omitted, only this station's own cargo feeds back).
 */
export function updateStationRatings(
    station: RtStation, nowTick: number, rng: SeededRandom, lookup?: (id: number) => RtStation | undefined
): void {
    void nowTick
    const spec = RT_CATALOG.stationRating
    for (let cargo = 0; cargo < station.cargo.length; cargo++) {
        const goods = station.cargo[cargo]!
        if (!goods.hasRating) {
            if (goods.rating < spec.start) goods.rating = Math.min(spec.start, goods.rating + spec.recoveryStep)
            continue
        }
        goods.cyclesSincePickup = Math.min(255, goods.cyclesSincePickup + 1)
        if (goods.cyclesSincePickup >= spec.abandonCycles) {
            goods.hasRating = false
            goods.lastSpeed = 0
            rtTruncatePackets(goods.packets, rtPacketTotal(goods.packets), rng)
            continue
        }

        const total = rtPacketTotal(goods.packets)
        let waiting = total
        // manual distribution: one next hop ("anywhere") whenever cargo waits
        const dests = waiting > 0 ? 1 : 0
        const waitingAvg = Math.floor(waiting / (dests + 1))
        const target = rtRatingTarget(goods.lastSpeed, goods.cyclesSincePickup, goods.maxWaiting, goods.lastAge)
        const old = goods.rating
        const rating = Math.max(0, Math.min(spec.max, old + Math.max(-spec.stepLimit, Math.min(spec.stepLimit, target - old))))
        goods.rating = rating

        let changed = false
        if (rating <= spec.lowRating && waitingAvg >= spec.lowWaiting) {
            let dec = rng.next() & spec.lowMask
            if (waitingAvg < spec.lowSmallPile) dec &= spec.lowSmallMask
            waiting -= (dec + 1) * dests
            changed = true
        }
        if (rating <= spec.midRating && waiting !== 0) {
            const r = rng.next()
            if (rating <= (r & ((1 << spec.midRandomBits) - 1))) {
                const cut = ((r >>> 8) & ((1 << spec.midRemoveBits) - 1)) + 1
                waiting = Math.max(0, waiting - cut * dests)
                changed = true
            }
        }
        if (waiting > spec.pileThreshold) {
            waiting -= Math.floor((waiting - spec.pileThreshold) / spec.pileCutDivisor)
            waiting = Math.min(waiting, spec.pileMax)
            changed = true
        }

        if (changed && waiting < total) {
            goods.maxWaiting = 0
            rtTruncatePackets(goods.packets, total - waiting, rng)
            feedBackWaiting(station, cargo, goods.packets, lookup)
        } else {
            goods.maxWaiting = waitingAvg
        }
    }
}

/** After truncation each packet source station sees at least the cargo still waiting from it (ascending id). */
function feedBackWaiting(
    station: RtStation, cargo: number, packets: readonly RtCargoPacket[], lookup?: (id: number) => RtStation | undefined
): void {
    const bySource = new Map<number, number>()
    for (const packet of packets) {
        if (packet.sourceStation === RT_NONE) continue
        bySource.set(packet.sourceStation, (bySource.get(packet.sourceStation) ?? 0) + packet.count)
    }
    const ids = [...bySource.keys()].sort((a, b) => a - b)
    for (const id of ids) {
        const source = id === station.id ? station : lookup?.(id)
        const goods = source?.cargo[cargo]
        if (goods) goods.maxWaiting = Math.max(goods.maxWaiting, bySource.get(id)!)
    }
}
