/**
 * The crossing inspector (Michael, 2026-10-30; this plan's own design, the original has none). A
 * company may lay its road across another company's unsignalled straight rail, or its rail across
 * another company's road, as the original allows. Such a foreign crossing has no barriers: trains
 * slow for it but never stop (train.ts), and a train that hits a road vehicle there may derail. The
 * company whose build made it is the causer: an inspector visits each month end and fines it more
 * the longer the crossing has stood, and every accident on it is charged to it (the crashed vehicles'
 * value to their owners, next-of-kin compensation, clean-up, the investigation, and the rail owner's
 * delay while the wreck blocks the line). Crossings with a town road or within one company are normal.
 * Every draw is the world RNG's, so peers stay in lockstep.
 */

import { RT_CARGO_IDS, RT_CATALOG } from './catalog'
import { bookMoney } from './economy'
import { RtTileKind, type RtMap } from './map'
import { rtCrossingRoadOwner, rtIsCrossing } from './track'
import { RT_OWNER_NONE, RtVehicleKind, RtVehicleState, type RtCrossingViolation, type RtVehicle } from './types'
import type { RtWorld } from './world'

const PASSENGERS = RT_CARGO_IDS.indexOf('passengers')

/** Ticks in an inspector month: thirty game days, whatever the calendar month's length. */
export const RT_INSPECTOR_MONTH_TICKS = RT_CATALOG.time.dayTicks * 30

/** Whether the tile is a level crossing whose rail and road belong to two different companies. */
export function rtIsForeignCrossing(map: RtMap, tile: number): boolean {
    if (!map.validTile(tile) || map.kind[tile] !== RtTileKind.rail) return false
    const payload = map.payload[tile]!
    if (!rtIsCrossing(payload)) return false
    const rail = map.owner[tile]!
    const road = rtCrossingRoadOwner(payload)
    return rail !== RT_OWNER_NONE && road !== RT_OWNER_NONE && rail !== road
}

/** The violation recorded for a tile, or undefined. */
export function rtViolationAt(world: RtWorld, tile: number): RtCrossingViolation | undefined {
    for (const entry of world.violations) if (entry.tile === tile) return entry
    return undefined
}

/**
 * After an applied build command of `causer`: a touched tile that is no longer a foreign crossing
 * loses its entry, and one that now is (and has none) records the acting company as the causer,
 * whichever side it built, from this tick. A company that owns neither side is never recorded.
 */
export function rtRecordCrossings(world: RtWorld, causer: number, tiles: readonly number[]): void {
    const map = world.map
    for (const tile of tiles) {
        const at = world.violations.findIndex(entry => entry.tile === tile)
        if (!rtIsForeignCrossing(map, tile)) {
            if (at >= 0) world.violations.splice(at, 1)
            continue
        }
        if (at >= 0 || world.violations.length >= RT_CATALOG.inspector.maxViolations) continue
        if (map.owner[tile] !== causer && rtCrossingRoadOwner(map.payload[tile]!) !== causer) continue
        world.violations.push({ tile, causer, since: world.tick })
    }
}

/** Drops every violation of a company (its bankruptcy reset). */
export function rtDropViolationsOf(world: RtWorld, company: number): void {
    const list = world.violations
    let kept = 0
    for (const entry of list) if (entry.causer !== company) list[kept++] = entry
    list.length = kept
}

/** Whether an entry still stands: its tile is a foreign crossing and its causer exists. */
function stands(world: RtWorld, entry: RtCrossingViolation): boolean {
    return rtIsForeignCrossing(world.map, entry.tile) && world.company(entry.causer) !== undefined
}

/**
 * Month end, before the companies' monthly finance: entries that no longer stand are dropped, then
 * each in list order is visited with the catalog chance (one world RNG draw per standing entry) and
 * its causer fined baseFine times the whole inspector months the crossing has stood, at least one.
 * Cash may go negative. Returns the total fined.
 */
export function rtInspectCrossings(world: RtWorld): number {
    const rules = RT_CATALOG.inspector
    const list = world.violations
    let kept = 0
    for (const entry of list) if (stands(world, entry)) list[kept++] = entry
    list.length = kept
    let total = 0
    for (const entry of list) {
        if (!world.rng.randomRatio(rules.visitNumerator, rules.visitDenominator)) continue
        const months = Math.max(1, Math.floor((world.tick - entry.since) / RT_INSPECTOR_MONTH_TICKS))
        const fine = rules.baseFine * months
        bookMoney(world.company(entry.causer)!, 'fines', -fine)
        total += fine
    }
    return total
}

/** The ids of every vehicle not crashed, ascending; RtWorld.step takes it before the vehicles move. */
export function rtUncrashedIds(world: RtWorld): number[] {
    const ids: number[] = []
    for (const vehicle of world.vehicles) if (vehicle && vehicle.state !== RtVehicleState.crashed) ids.push(vehicle.id)
    return ids
}

/** People aboard a vehicle: its passengers plus one driver. */
export function rtPeopleAboard(vehicle: RtVehicle): number {
    let people = 1
    for (const packet of vehicle.cargo) if (packet.cargo === PASSENGERS) people += packet.count
    return people
}

/** Days a wreck blocks the line: the crash period in days, rounded up. */
export function rtWreckDays(): number {
    return Math.ceil(RT_CATALOG.vehicles.crashTicks / RT_CATALOG.time.dayTicks)
}

/**
 * Every tick, after the vehicles moved: an accident is a registered, still-foreign crossing on which
 * a road vehicle crashed this tick (a crash between trains alone is not the crossing's doing). For
 * each, in violation order, the causer pays for every vehicle that crashed this tick on that tile:
 * its value to its owner (a transfer, skipped when the owner is the causer), next-of-kin compensation
 * per person aboard and the clean-up; then the investigation once, and the delay to the crossing's
 * rail owner (a transfer, skipped when that is the causer). Everything is booked under fines.
 * `before` is rtUncrashedIds from before the move.
 */
export function rtProsecuteAccidents(world: RtWorld, before: readonly number[]): void {
    if (world.violations.length === 0) return
    const fresh: RtVehicle[] = []
    for (const id of before) {
        const vehicle = world.vehicle(id)
        if (vehicle && vehicle.state === RtVehicleState.crashed) fresh.push(vehicle)
    }
    if (fresh.length === 0) return
    const rules = RT_CATALOG.inspector
    const charged = new Set<number>()
    for (const entry of world.violations) {
        const causer = world.company(entry.causer)
        if (!causer || !rtIsForeignCrossing(world.map, entry.tile)) continue
        const involved = fresh.filter(vehicle => vehicle.tiles.includes(entry.tile))
        if (!involved.some(vehicle => vehicle.kind === RtVehicleKind.road)) continue
        for (const vehicle of involved) {
            if (charged.has(vehicle.id)) continue
            charged.add(vehicle.id)
            const owner = world.company(vehicle.owner)
            const value = Math.floor(Math.max(0, vehicle.value))
            if (owner && owner !== causer && value > 0) {
                bookMoney(causer, 'fines', -value)
                bookMoney(owner, 'fines', value)
            }
            bookMoney(causer, 'fines', -(rules.perPerson * rtPeopleAboard(vehicle) + rules.cleanup))
        }
        bookMoney(causer, 'fines', -rules.investigation)
        const railOwner = world.company(world.map.owner[entry.tile]!)
        if (railOwner && railOwner !== causer) {
            const delay = rules.delayPerDay * rtWreckDays()
            bookMoney(causer, 'fines', -delay)
            bookMoney(railOwner, 'fines', delay)
        }
    }
}
