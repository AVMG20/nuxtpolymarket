/**
 * Loading and unloading: what a vehicle standing at a station does, one loading step at a
 * time, as the original's gradual loading. A step moves loadAmount units per cargo-carrying part,
 * unloading first, then loading with what is left of the step. Delivered cargo is paid by distance
 * from where it was produced and by its transit time (deliveryPayment), feeds an accepting industry
 * around the station and the station town's delivery counter. Station owners share in deliveries made
 * at their stations and of cargo picked up at them.
 */

import { RT_CATALOG } from './catalog'
import { bookMoney, chargeSharing, deliveryPayment, stationSharingShare } from './economy'
import { acceptDelivery, rtIndustryAccepts, rtIndustryTiles } from './industries'
import type { RtMap } from './map'
import { rtCurrentOrder } from './orders'
import { accepts, rtPacketTotal, rtStationServesCargo, stationCatchment } from './stations'
import { rtNewStationCargo } from './stations-build'
import type { RtTrainHooks } from './train'
import {
    RT_NONE,
    RtOrderFlag,
    RtOrderKind,
    RtVehicleKind,
    type RtCargoPacket,
    type RtCompany,
    type RtIndustry,
    type RtStation,
    type RtTown,
    type RtVehicle,
    type RtWorldSettings
} from './types'
import { rtConsistCapacity, rtConsistMaxSpeed, rtModelSpec } from './vehicles'

/** The parts of a world loading reads and writes; RtWorld satisfies it. */
export interface RtLoadWorld {
    readonly settings: Readonly<Pick<RtWorldSettings, 'sharing'>>
    readonly map: RtMap
    readonly tick: number
    readonly companies: readonly (RtCompany | null)[]
    readonly towns: readonly (RtTown | null)[]
    readonly industries: readonly (RtIndustry | null)[]
    readonly stations: readonly (RtStation | null)[]
}

const LOADING = RT_CATALOG.vehicles

/** Ticks between two loading steps of a vehicle of this kind. */
export function rtLoadStepTicks(vehicle: RtVehicle): number {
    return vehicle.kind === RtVehicleKind.rail ? LOADING.trainLoadStepTicks : LOADING.roadLoadStepTicks
}

/** Units one loading step moves: loadAmount for every part that carries cargo. */
export function rtLoadStepAmount(vehicle: RtVehicle): number {
    let parts = 0
    for (const part of vehicle.consist) {
        const spec = rtModelSpec(part)
        if (spec && spec.cargo !== null && spec.capacity > 0) parts++
    }
    return parts * LOADING.loadAmount
}

function byId<T extends { id: number }>(list: readonly (T | null)[], id: number): T | undefined {
    if (!Number.isInteger(id) || id < 0) return undefined
    const direct = list[id]
    if (direct && direct.id === id) return direct
    for (const item of list) if (item && item.id === id) return item
    return undefined
}

function manhattan(map: RtMap, a: number, b: number): number {
    if (!map.validTile(a) || !map.validTile(b)) return 0
    return Math.abs(map.tileX(a) - map.tileX(b)) + Math.abs(map.tileY(a) - map.tileY(b))
}

/** Units of a cargo aboard. */
function carried(vehicle: RtVehicle, cargo: number): number {
    let total = 0
    for (const packet of vehicle.cargo) if (packet.cargo === cargo) total += packet.count
    return total
}

/** Adds a packet to a list, merging it into an existing packet of the same origin and age. */
function addPacket(list: RtCargoPacket[], packet: RtCargoPacket): void {
    for (const held of list) {
        if (held.cargo === packet.cargo && held.sourceTile === packet.sourceTile && held.sourceStation === packet.sourceStation
            && held.transitPeriods === packet.transitPeriods && held.feederShare === 0 && packet.feederShare === 0) {
            held.count += packet.count
            return
        }
    }
    list.push(packet)
}

/** A part taken off a packet, with the packet's count before it was taken (for exact payment, see deliver). */
interface Portion {
    packet: RtCargoPacket
    before: number
}

/** Takes up to `amount` units from the packets matching `wanted`, oldest first; returns the portions taken. */
function takeFrom(packets: RtCargoPacket[], amount: number, wanted: (packet: RtCargoPacket) => boolean): Portion[] {
    const out: Portion[] = []
    let left = amount
    for (let k = 0; k < packets.length && left > 0; k++) {
        const packet = packets[k]!
        if (packet.count <= 0 || !wanted(packet)) continue
        const take = Math.min(packet.count, left)
        out.push({ packet: { ...packet, count: take }, before: packet.count })
        packet.count -= take
        left -= take
    }
    for (let k = packets.length - 1; k >= 0; k--) if (packets[k]!.count <= 0) packets.splice(k, 1)
    return out
}

/** The lowest-id industry with a tile in the station's catchment that accepts the cargo, or undefined. */
function acceptingIndustry(world: RtLoadWorld, station: RtStation, cargo: number): RtIndustry | undefined {
    const covered = new Set(stationCatchment(world.map, station))
    for (const industry of world.industries) {
        if (!industry) continue
        if (rtIndustryAccepts(industry, cargo) && rtIndustryTiles(world.map, industry).some(tile => covered.has(tile))) return industry
    }
    return undefined
}

/**
 * Pays for delivered packets: the vehicle owner books the payment as train or road
 * income; the station's owner, and the owner of another company's station the cargo was picked up
 * at, each take stationSharingShare of it. The vehicle's profit is the payment minus those shares.
 * A portion pays the packet's payment before it minus the payment for what stays aboard, so a packet
 * unloaded over several steps pays exactly what it would in one.
 */
function deliver(world: RtLoadWorld, vehicle: RtVehicle, station: RtStation, company: RtCompany, portions: Portion[]): void {
    const category = vehicle.kind === RtVehicleKind.rail ? 'trainIncome' : 'roadIncome'
    for (const { packet, before } of portions) {
        const distance = manhattan(world.map, packet.sourceTile, station.sign)
        const whole = deliveryPayment(packet.cargo, before, distance, packet.transitPeriods)
        const rest = deliveryPayment(packet.cargo, before - packet.count, distance, packet.transitPeriods)
        const payment = whole - rest
        const share = stationSharingShare(whole) - stationSharingShare(rest)
        bookMoney(company, category, payment)
        let profit = payment
        if (station.owner !== vehicle.owner && chargeSharing(world, vehicle.owner, station.owner, share, 'station')) profit -= share
        const source = packet.sourceStation !== RT_NONE ? byId(world.stations, packet.sourceStation) : undefined
        if (source && source.owner !== vehicle.owner && chargeSharing(world, vehicle.owner, source.owner, share, 'station')) profit -= share
        vehicle.profitThisYear += profit
        const industry = acceptingIndustry(world, station, packet.cargo)
        if (industry) acceptDelivery(industry, packet.cargo, packet.count)
        const town = byId(world.towns, station.town)
        if (town && packet.cargo < town.receivedThisMonth.length) town.receivedThisMonth[packet.cargo]! += packet.count
    }
    if (portions.length > 0) station.lastDeliveryTick = world.tick
}

/**
 * Packets unloaded here: accepted cargo, or with the unload flag every packet (non-accepted cargo is
 * transferred). Cargo never goes back to the station it was picked up at, as the original: a station
 * that both supplies and accepts a cargo would otherwise pay out for loading and unloading on the spot.
 */
function unloadable(station: RtStation, flags: number, packet: RtCargoPacket): boolean {
    if ((flags & RtOrderFlag.noUnload) !== 0 || packet.sourceStation === station.id) return false
    if (accepts(station, packet.cargo)) return true
    return (flags & RtOrderFlag.unload) !== 0 && rtStationServesCargo(station.facilities, packet.cargo)
}

/**
 * One loading step of a vehicle standing at `stationId`; true when it is done and may leave
 * (the mover then runs advanceOrder). Unloading comes first: accepted cargo is delivered and paid,
 * cargo the station does not accept stays aboard unless the order says unload, which transfers it to
 * the station's waiting cargo; no-unload keeps everything aboard. Then the vehicle tries to load every
 * cargo it can carry, which lets the station receive that cargo from now on, and takes waiting packets
 * oldest first up to its free capacity. With full load it stays until every cargo it carries is full;
 * otherwise it leaves once nothing more is waiting for it. A missing station or company ends the stop.
 */
export function loadUnload(world: RtLoadWorld, vehicle: RtVehicle, stationId: number): boolean {
    const station = byId(world.stations, stationId)
    const company = byId(world.companies, vehicle.owner)
    if (!station || !company) return true
    const order = rtCurrentOrder(vehicle)
    const flags = order && order.kind === RtOrderKind.gotoStation && order.target === station.id ? order.flags : 0
    let budget = rtLoadStepAmount(vehicle)

    // unload
    const off = takeFrom(vehicle.cargo, budget, packet => unloadable(station, flags, packet))
    for (const { packet } of off) budget -= packet.count
    deliver(world, vehicle, station, company, off.filter(({ packet }) => accepts(station, packet.cargo)))
    for (const { packet } of off) {
        if (accepts(station, packet.cargo)) continue
        while (station.cargo.length <= packet.cargo) station.cargo.push(rtNewStationCargo())
        addPacket(station.cargo[packet.cargo]!.packets, packet)
    }
    const unloadLeft = vehicle.cargo.some(packet => unloadable(station, flags, packet))
    if (unloadLeft) return false

    // load
    const capacity = rtConsistCapacity(vehicle.consist)
    const speed = Math.min(255, rtConsistMaxSpeed(vehicle.consist))
    const age = Math.min(255, Math.floor(Math.max(0, vehicle.age) / 365))
    let full = true
    let more = false
    for (let cargo = 0; cargo < capacity.length; cargo++) {
        const cap = capacity[cargo]!
        if (cap <= 0) continue
        const free = cap - carried(vehicle, cargo)
        // under unload, cargo the station does not accept was just transferred off: loading it would only unload it again
        if ((flags & RtOrderFlag.unload) !== 0 && !accepts(station, cargo)) continue
        if (!rtStationServesCargo(station.facilities, cargo)) {
            if (free > 0) full = false
            continue
        }
        while (station.cargo.length <= cargo) station.cargo.push(rtNewStationCargo())
        const goods = station.cargo[cargo]!
        goods.loadAttempted = true
        goods.hasRating = true
        goods.lastSpeed = speed
        goods.lastAge = age
        const take = Math.min(free, budget)
        const on = take > 0 ? takeFrom(goods.packets, take, () => true) : []
        for (const { packet } of on) {
            budget -= packet.count
            addPacket(vehicle.cargo, packet)
        }
        if (on.length > 0) {
            goods.cyclesSincePickup = 0
            station.lastPickupTick = world.tick
            station.lastVehicleKind = vehicle.kind
        }
        const freeNow = cap - carried(vehicle, cargo)
        if (freeNow > 0) {
            full = false
            if (rtPacketTotal(goods.packets) > 0) more = true
        }
    }
    if (full) return true
    if ((flags & RtOrderFlag.fullLoad) !== 0) return false
    return !more
}

/**
 * The movers' loading hooks: arrival starts the step timer, and every loadStepTicks a
 * loading step runs; the stop ends when loadUnload says so.
 */
export const rtLoadHooks: RtTrainHooks = {
    arrive(_world, vehicle) {
        vehicle.loadTicks = 0
    },
    loadStep(world, vehicle) {
        if (vehicle.loadTicks > 0) {
            vehicle.loadTicks--
            return false
        }
        vehicle.loadTicks = rtLoadStepTicks(vehicle) - 1
        return loadUnload(world, vehicle, vehicle.loadingStation)
    }
}
