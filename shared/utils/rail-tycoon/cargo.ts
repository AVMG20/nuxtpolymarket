/**
 * Cargo packets: production handed to stations by rating, the packet caps and ageing
 * in transit. Behaviour mimics the original game (cargo moves only to stations a vehicle has
 * tried to load at, the total is scaled by the best rating and split between companies by their best
 * rating and within a company by rating); the code is written from scratch. Integers only.
 */
import { RT_CATALOG } from './catalog'
import type { SeededRandom } from '../random'
import { rtStationServesCargo, stationsAroundTiles, type RtStationWorld } from './stations'
import type { RtCargoPacket, RtStation } from './types'

/** The most units one production call distributes, so amount * rating products stay exact integers. */
const MAX_PRODUCTION = RT_CATALOG.industryRules.maxWaiting

/**
 * Whether a station takes newly produced cargo of this kind: a vehicle has tried to load it there,
 * its rating is above zero, and its facilities handle the cargo (rtStationServesCargo).
 */
export function rtStationTakesCargo(station: RtStation, cargo: number): boolean {
    const goods = station.cargo[cargo]
    if (!goods || !goods.loadAttempted || goods.rating === 0) return false
    return rtStationServesCargo(station.facilities, cargo)
}

/**
 * Adds a packet to a list, merging into the newest packet when it has the same cargo and source and
 * has not travelled (no transit, no feeder share), then applies the cap.
 */
export function rtAppendPacket(packets: RtCargoPacket[], packet: RtCargoPacket, max: number): void {
    const last = packets[packets.length - 1]
    if (last && last.cargo === packet.cargo && last.sourceTile === packet.sourceTile
        && last.sourceStation === packet.sourceStation && last.transitPeriods === packet.transitPeriods
        && last.feederShare === 0 && packet.feederShare === 0) {
        last.count += packet.count
    } else {
        packets.push(packet)
    }
    rtCapPackets(packets, max)
}

/**
 * Keeps a packet list at most `max` long: while it is longer, the oldest packet absorbs the
 * next-oldest packet of the same cargo, keeping the larger transit value, the older source tile and
 * station, and the summed count and feeder share. A list whose cargos are all different is left as is.
 */
export function rtCapPackets(packets: RtCargoPacket[], max: number): void {
    const limit = Math.max(1, Math.floor(max))
    while (packets.length > limit) {
        let merged = false
        for (let a = 0; a < packets.length && !merged; a++) {
            const older = packets[a]!
            for (let b = a + 1; b < packets.length; b++) {
                const newer = packets[b]!
                if (newer.cargo !== older.cargo) continue
                older.count += newer.count
                older.transitPeriods = Math.max(older.transitPeriods, newer.transitPeriods)
                older.feederShare += newer.feederShare
                packets.splice(b, 1)
                merged = true
                break
            }
        }
        if (!merged) return
    }
}

/**
 * Hands `amount256` (units times 256, rating-scaled) to one station: the low 8 bits join the
 * station's per-cargo fraction, whole units become a packet from sourceTile. Arriving cargo gives the
 * cargo a rating, as the original. Returns the whole units added.
 */
function updateStationWaiting(station: RtStation, cargo: number, amount256: number, sourceTile: number): number {
    const goods = station.cargo[cargo]!
    const bits = RT_CATALOG.production.fracBits
    const sum = amount256 + goods.fraction
    goods.fraction = sum & ((1 << bits) - 1)
    const units = Math.floor(sum / (1 << bits))
    if (units === 0) return 0
    rtAppendPacket(goods.packets, {
        cargo,
        count: units,
        sourceTile,
        sourceStation: station.id,
        transitPeriods: 0,
        feederShare: 0
    }, RT_CATALOG.caps.maxPacketsPerStation)
    goods.hasRating = true
    return units
}

/**
 * Moves produced cargo to the stations around its source. sourceTiles is a house's tile or an
 * industry's footprint; the packets' source tile is the first of them. Eligible stations cover a
 * source tile and take the cargo (rtStationTakesCargo). One station gets amount * (rating + 1) / 256;
 * several share amount * (best + 1) / 256: each company's part is in proportion to its best rating,
 * and within a company each station's in proportion to its rating, by integer division; the units
 * left by rounding go one each to the best-rated stations (ties to the lower id). Fractions carry
 * per station. Returns the whole units moved. `rng` is unused (the split draws nothing, as the original).
 */
export function distributeProduction(
    world: RtStationWorld, sourceTiles: readonly number[], cargo: number, amount: number, rng?: SeededRandom
): number {
    void rng
    const units = Math.min(MAX_PRODUCTION, Math.max(0, Math.floor(amount)))
    if (units === 0 || sourceTiles.length === 0) return 0
    const eligible = stationsAroundTiles(world, sourceTiles).filter(station => rtStationTakesCargo(station, cargo))
    if (eligible.length === 0) return 0
    const sourceTile = sourceTiles[0]!
    const offset = RT_CATALOG.production.ratingOffset

    if (eligible.length === 1) {
        const station = eligible[0]!
        return updateStationWaiting(station, cargo, units * (station.cargo[cargo]!.rating + offset), sourceTile)
    }

    const companyBest = new Map<number, number>()
    const companySum = new Map<number, number>()
    let best = 0
    for (const station of eligible) {
        const rating = station.cargo[cargo]!.rating
        if (rating > (companyBest.get(station.owner) ?? 0)) companyBest.set(station.owner, rating)
        companySum.set(station.owner, (companySum.get(station.owner) ?? 0) + rating)
        if (rating > best) best = rating
    }
    let bestSum = 0
    for (const rating of companyBest.values()) bestSum += rating

    const total = units * (best + offset)
    const shares = eligible.map((station) => {
        const rating = station.cargo[cargo]!.rating
        const company = companyBest.get(station.owner)!
        return Math.floor(Math.floor(total * company * rating / bestSum) / companySum.get(station.owner)!)
    })
    let moving = 0
    for (const share of shares) moving += share
    if (total > moving) {
        const order = eligible.map((station, k) => k)
            .sort((a, b) => eligible[b]!.cargo[cargo]!.rating - eligible[a]!.cargo[cargo]!.rating || eligible[a]!.id - eligible[b]!.id)
        for (let k = 0; k < total - moving; k++) shares[order[k % order.length]!]!++
    }
    let moved = 0
    eligible.forEach((station, k) => {
        moved += updateStationWaiting(station, cargo, shares[k]!, sourceTile)
    })
    return moved
}

/**
 * Ages every packet of a vehicle's load by `periods` transit periods, saturating at
 * RT_CATALOG.payment.maxTransitPeriods. Called once per packetAgeTicks for cargo aboard a vehicle;
 * cargo waiting at a station does not age, as the original.
 */
export function agePackets(packets: RtCargoPacket[], periods = 1): void {
    const step = Math.max(0, Math.floor(periods))
    if (step === 0) return
    const max = RT_CATALOG.payment.maxTransitPeriods
    for (const packet of packets) {
        packet.transitPeriods = Math.min(max, packet.transitPeriods + step)
    }
}
