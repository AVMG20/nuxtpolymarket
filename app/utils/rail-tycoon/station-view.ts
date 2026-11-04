// Rail Tycoon — what the station window shows: cargo waiting with its rating, and what the station
// accepts.

import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { RT_ACCEPT_THRESHOLD, computeCatchment, rtAcceptanceAround, rtStationServesCargo } from '#shared/utils/rail-tycoon/stations'
import type { RtStation } from '#shared/utils/rail-tycoon/types'
import type { RtWorld } from '#shared/utils/rail-tycoon/world'
import { rtCargoName, rtPercent } from './view-format'

export interface RtStationCargoRow {
    cargo: number
    name: string
    /** Units waiting. */
    waiting: number
    /** Rating as a percentage, or null while the cargo has none. */
    rating: number | null
}

/** Each cargo that waits or has a rating at the station, in cargo order. */
export function rtStationCargoRows(station: RtStation): RtStationCargoRow[] {
    const rows: RtStationCargoRow[] = []
    station.cargo.forEach((entry, cargo) => {
        let waiting = 0
        for (const packet of entry.packets) waiting += packet.count
        if (waiting === 0 && !entry.hasRating) return
        rows.push({
            cargo,
            name: rtCargoName(cargo),
            waiting,
            rating: entry.hasRating ? rtPercent(entry.rating, RT_CATALOG.stationRating.max) : null
        })
    })
    return rows
}

/** The cargo indices the station accepts, summed over its catchment (computeCatchment) as the acceptance rule does. */
export function rtStationAccepts(world: RtWorld, station: RtStation): number[] {
    const sums = rtAcceptanceAround(world, computeCatchment(world.map, station))
    const out: number[] = []
    sums.forEach((sum, cargo) => {
        if (sum >= RT_ACCEPT_THRESHOLD && rtStationServesCargo(station.facilities, cargo)) out.push(cargo)
    })
    return out
}
