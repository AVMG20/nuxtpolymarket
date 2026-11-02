import { describe, expect, it } from 'vitest'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { RtCommandKind, applyCommand, type RtCommand } from '#shared/utils/rail-tycoon/commands'
import { RtDir, RtMap, RtTileKind } from '#shared/utils/rail-tycoon/map'
import { RtOrderError } from '#shared/utils/rail-tycoon/orders'
import { RtAxis } from '#shared/utils/rail-tycoon/stations-build'
import { RtOrderFlag, RtOrderKind, RtVehicleKind, RtVehicleState, type RtOrder } from '#shared/utils/rail-tycoon/types'
import { rtConsistHalfTiles } from '#shared/utils/rail-tycoon/vehicles'
import { RtWorld, rtNewCompany, rtStartDate } from '#shared/utils/rail-tycoon/world'
import {
    RT_MINIMAP_WIDTH,
    rtAgeText,
    rtBuyableModels,
    rtCapacityText,
    rtConsistSummary,
    rtConsistText,
    rtDepotKindAt,
    rtMaxWagons,
    rtMinimapColour,
    rtMinimapFromWorld,
    rtMinimapScale,
    rtMinimapToWorld,
    rtOrderErrorText,
    rtOrdersInsert,
    rtOrdersMove,
    rtOrdersRemove,
    rtOrdersToggleFlag,
    rtOrderText,
    rtPercent,
    rtPlannedConsist,
    rtQueryTarget,
    rtSortVehicleRows,
    rtStationAccepts,
    rtStationCargoRows,
    rtVehicleCargo,
    rtVehicleName,
    rtVehicleRows,
    rtVehiclesInDepot,
    rtVehicleStatus,
    rtWagonModels,
    type RtVehicleRow
} from '../../app/utils/rail-tycoon/world-windows'

const ME = 0
const RIVAL = 1
const M = RT_CATALOG.vehicles.models

function flatWorld(side = 64): RtWorld {
    const w = new RtWorld({
        settings: { side, maxCompanies: 8, sharing: false }, map: new RtMap(side), rngState: 5, tick: 0, date: rtStartDate(),
        pathfinderCursor: 0, companies: [rtNewCompany(ME, 'Mine', 0, 0), rtNewCompany(RIVAL, 'Rival', 1, 0)],
        towns: [], industries: [], stations: [], vehicles: []
    })
    for (const company of w.companyList()) company.money = 1_000_000
    return w
}

function must(w: RtWorld, company: number, command: RtCommand) {
    const result = applyCommand(w, company, command, true)
    if (!result.ok) throw new Error(`command ${command.kind} refused (${result.error})`)
    return result
}

/** A world with my rail depot at (10, 10), a rival's at (20, 20) and my two-tile station at (30, 30). */
function network() {
    const w = flatWorld()
    const depot = w.map.idx(10, 10)
    const rivalDepot = w.map.idx(20, 20)
    const stationTile = w.map.idx(30, 30)
    must(w, ME, { kind: RtCommandKind.buildDepot, tile: depot, vehicleKind: RtVehicleKind.rail, facing: RtDir.sw })
    must(w, RIVAL, { kind: RtCommandKind.buildDepot, tile: rivalDepot, vehicleKind: RtVehicleKind.rail, facing: RtDir.sw })
    must(w, ME, { kind: RtCommandKind.buildRailStation, tile: stationTile, axis: RtAxis.x, tracks: 1, length: 2 })
    const station = w.stationList()[0]!
    return { w, depot, rivalDepot, stationTile, station }
}

describe('buying', () => {
    it('lists locomotives for a rail depot and road vehicles for a road depot', () => {
        expect(rtBuyableModels(RtVehicleKind.rail).map(m => m.index)).toEqual([M.tankEngine.index, M.expressEngine.index])
        expect(rtBuyableModels(RtVehicleKind.road).every(m => m.role === 'road')).toBe(true)
        expect(rtWagonModels().every(m => m.role === 'wagon')).toBe(true)
        expect(rtWagonModels()).toHaveLength(5)
    })

    it('stops the wagon count at the longest train maxTrainLength allows', () => {
        const engine = M.expressEngine.index
        const max = rtMaxWagons(engine)
        const v = RT_CATALOG.vehicles
        expect(rtConsistHalfTiles(rtPlannedConsist(engine, M.passengerCoach.index, max))).toBeLessThanOrEqual(v.maxTrainLength * 2)
        expect(max + 1).toBeLessThanOrEqual(v.maxTrainVehicles)
        expect(max).toBe(13)
        expect(rtMaxWagons(M.townBus.index)).toBe(0)
        expect(rtMaxWagons(M.passengerCoach.index)).toBe(0)
        // asking for more is clamped, and a road vehicle never takes wagons
        expect(rtPlannedConsist(engine, M.coalHopper.index, 99)).toHaveLength(max + 1)
        expect(rtPlannedConsist(M.townBus.index, M.coalHopper.index, 3)).toEqual([M.townBus.index])
        expect(rtPlannedConsist(engine, null, 3)).toEqual([engine])
    })

    it('a planned consist buys exactly what the rule accepts at the cap and refuses one more', () => {
        const { w, depot } = network()
        const engine = M.tankEngine.index
        const wagons = rtPlannedConsist(engine, M.mailCar.index, 99).slice(1)
        const ok = applyCommand(w, ME, { kind: RtCommandKind.buyVehicle, depot, model: engine, wagons }, false)
        expect(ok.ok).toBe(true)
        const tooLong = applyCommand(w, ME, { kind: RtCommandKind.buyVehicle, depot, model: engine, wagons: [...wagons, M.mailCar.index] }, false)
        expect(tooLong.ok).toBe(false)
    })

    it('sums cost, capacity, speed and length', () => {
        const consist = rtPlannedConsist(M.expressEngine.index, M.passengerCoach.index, 3)
        const summary = rtConsistSummary(consist)
        expect(summary.cost).toBe(M.expressEngine.cost + 3 * M.passengerCoach.cost)
        expect(summary.maxSpeed).toBe(M.expressEngine.maxSpeed)
        expect(summary.runningCost).toBe(M.expressEngine.runningCost)
        expect(summary.capacity[RT_CATALOG.cargos.passengers.index]).toBe(120)
        expect(summary.lengthTiles).toBe(2)
        expect(rtCapacityText(summary.capacity)).toBe('120 Passengers')
        expect(rtCapacityText(rtConsistSummary([M.expressEngine.index]).capacity)).toBe('None')
        expect(rtConsistText(consist)).toBe('Meridian Express + 3 Passenger Coach')
    })
})

describe('vehicles', () => {
    it('names, rows, status and cargo for a bought train', () => {
        const { w, depot } = network()
        must(w, ME, { kind: RtCommandKind.buyVehicle, depot, model: M.tankEngine.index, wagons: [M.coalHopper.index, M.coalHopper.index] })
        const train = w.vehicleList()[0]!
        expect(rtVehicleName(train)).toBe(`Train ${train.id + 1}`)
        expect(rtVehicleName({ id: 4, kind: RtVehicleKind.road })).toBe('Road vehicle 5')
        expect(rtVehicleStatus(w, train)).toBe('Stopped in depot')
        expect(rtVehiclesInDepot(w, depot).map(v => v.id)).toEqual([train.id])
        const cargo = rtVehicleCargo(train)
        expect(cargo).toEqual([{ cargo: RT_CATALOG.cargos.coal.index, name: 'Coal', aboard: 0, capacity: 60 }])
        train.cargo.push({ cargo: RT_CATALOG.cargos.coal.index, count: 25, sourceTile: 0, sourceStation: -1, transitPeriods: 0, feederShare: 0 })
        expect(rtVehicleCargo(train)[0]!.aboard).toBe(25)
        expect(rtVehicleRows(w, ME).map(r => r.id)).toEqual([train.id])
        expect(rtVehicleRows(w, RIVAL)).toEqual([])
    })

    it('status follows state: crashed, broken down, loading, orders', () => {
        const { w, depot, station } = network()
        must(w, ME, { kind: RtCommandKind.buyVehicle, depot, model: M.tankEngine.index, wagons: [] })
        const train = w.vehicleList()[0]!
        train.state = RtVehicleState.driving
        train.stopped = false
        expect(rtVehicleStatus(w, train)).toBe('No orders')
        train.orders = [{ kind: RtOrderKind.gotoStation, target: station.id, flags: 0 }]
        expect(rtVehicleStatus(w, train)).toBe(`Heading for ${station.name}`)
        train.state = RtVehicleState.loading
        train.loadingStation = station.id
        expect(rtVehicleStatus(w, train)).toBe(`Loading at ${station.name}`)
        train.breakdownTicks = 10
        expect(rtVehicleStatus(w, train)).toBe('Broken down')
        train.state = RtVehicleState.crashed
        expect(rtVehicleStatus(w, train)).toBe('Crashed!')
    })

    it('sorts rows by number, profit and age, ties by number', () => {
        const row = (id: number, profit: number, age: number): RtVehicleRow => ({
            id, name: '', kind: RtVehicleKind.rail, status: '', profitThisYear: profit, profitLastYear: 0, age
        })
        const rows = [row(2, 50, 10), row(0, -20, 300), row(1, 50, 5)]
        expect(rtSortVehicleRows(rows, 'number', false).map(r => r.id)).toEqual([0, 1, 2])
        expect(rtSortVehicleRows(rows, 'profit', true).map(r => r.id)).toEqual([1, 2, 0])
        expect(rtSortVehicleRows(rows, 'profit', false).map(r => r.id)).toEqual([0, 1, 2])
        expect(rtSortVehicleRows(rows, 'age', true).map(r => r.id)).toEqual([0, 2, 1])
        expect(rows.map(r => r.id)).toEqual([2, 0, 1])
    })

    it('formats age and percentages', () => {
        expect(rtAgeText(1)).toBe('1 day')
        expect(rtAgeText(200)).toBe('200 days')
        expect(rtAgeText(365)).toBe('1 year')
        expect(rtAgeText(365 * 3 + 20)).toBe('3 years')
        expect(rtPercent(255, 255)).toBe(100)
        expect(rtPercent(0, 255)).toBe(0)
        expect(rtPercent(10, 0)).toBe(0)
    })
})

describe('order edits', () => {
    const a: RtOrder = { kind: RtOrderKind.gotoStation, target: 1, flags: 0 }
    const b: RtOrder = { kind: RtOrderKind.gotoStation, target: 2, flags: 0 }
    const d: RtOrder = { kind: RtOrderKind.gotoDepot, target: 99, flags: 0 }

    it('inserts after the selection or appends, without touching the input', () => {
        const list = [a, b]
        expect(rtOrdersInsert(list, 0, d).map(o => o.target)).toEqual([1, 99, 2])
        expect(rtOrdersInsert(list, -1, d).map(o => o.target)).toEqual([1, 2, 99])
        expect(rtOrdersInsert([], -1, a)).toEqual([a])
        expect(list).toEqual([a, b])
    })

    it('removes and moves', () => {
        expect(rtOrdersRemove([a, b, d], 1).map(o => o.target)).toEqual([1, 99])
        expect(rtOrdersMove([a, b, d], 2, -1).map(o => o.target)).toEqual([1, 99, 2])
        expect(rtOrdersMove([a, b, d], 0, 1).map(o => o.target)).toEqual([2, 1, 99])
        expect(rtOrdersMove([a, b], 0, -1).map(o => o.target)).toEqual([1, 2])
        expect(rtOrdersMove([a, b], 1, 1).map(o => o.target)).toEqual([1, 2])
    })

    it('toggles flags, keeping unload and no unloading apart, and leaves depot orders alone', () => {
        let list = rtOrdersToggleFlag([a], 0, RtOrderFlag.fullLoad)
        expect(list[0]!.flags).toBe(RtOrderFlag.fullLoad)
        list = rtOrdersToggleFlag(list, 0, RtOrderFlag.unload)
        expect(list[0]!.flags).toBe(RtOrderFlag.fullLoad | RtOrderFlag.unload)
        list = rtOrdersToggleFlag(list, 0, RtOrderFlag.noUnload)
        expect(list[0]!.flags).toBe(RtOrderFlag.fullLoad | RtOrderFlag.noUnload)
        list = rtOrdersToggleFlag(list, 0, RtOrderFlag.fullLoad)
        expect(list[0]!.flags).toBe(RtOrderFlag.noUnload)
        expect(rtOrdersToggleFlag([d], 0, RtOrderFlag.fullLoad)[0]!.flags).toBe(0)
        expect(a.flags).toBe(0)
    })

    it('describes orders and order refusals', () => {
        const { w, station, depot } = network()
        expect(rtOrderText(w, { kind: RtOrderKind.gotoStation, target: station.id, flags: RtOrderFlag.fullLoad })).toBe(`Go to ${station.name} (Full load)`)
        expect(rtOrderText(w, { kind: RtOrderKind.gotoDepot, target: depot, flags: 0 })).toBe('Service at depot at 10, 10')
        expect(rtOrderErrorText(RtOrderError.foreignFullLoad)).toMatch(/own stations/)
    })
})

describe('stations', () => {
    it('lists waiting cargo and ratings, and acceptance from the catchment', () => {
        const { w, station, stationTile } = network()
        expect(rtStationCargoRows(station)).toEqual([])
        const pax = RT_CATALOG.cargos.passengers.index
        station.cargo[pax]!.hasRating = true
        station.cargo[pax]!.rating = 255
        station.cargo[pax]!.packets.push({ cargo: pax, count: 42, sourceTile: 0, sourceStation: station.id, transitPeriods: 0, feederShare: 0 })
        expect(rtStationCargoRows(station)).toEqual([{ cargo: pax, name: 'Passengers', waiting: 42, rating: 100 }])
        expect(rtStationAccepts(w, station)).toEqual([])
        // two big houses next to it accept passengers (8 eighths each)
        w.map.setTile(stationTile + 2 * w.map.side, RtTileKind.house, 255, 2)
        w.map.setTile(stationTile + 3 * w.map.side, RtTileKind.house, 255, 2)
        expect(rtStationAccepts(w, station)).toContain(pax)
    })
})

describe('query clicks (for the game page)', () => {
    it('opens a station, my own depot, never a rival depot, and a vehicle on its tile', () => {
        const { w, depot, rivalDepot, stationTile, station } = network()
        expect(rtQueryTarget(w, ME, stationTile)).toEqual({ kind: 'station', id: station.id })
        expect(rtQueryTarget(w, RIVAL, stationTile)).toEqual({ kind: 'station', id: station.id })
        expect(rtQueryTarget(w, ME, depot)).toEqual({ kind: 'buyVehicle', id: depot })
        expect(rtQueryTarget(w, ME, rivalDepot)).toBeNull()
        expect(rtQueryTarget(w, null, depot)).toBeNull()
        expect(rtQueryTarget(w, ME, w.map.idx(1, 1))).toBeNull()
        expect(rtDepotKindAt(w, depot)).toBe(RtVehicleKind.rail)
        expect(rtDepotKindAt(w, stationTile)).toBeNull()
        must(w, ME, { kind: RtCommandKind.buyVehicle, depot, model: M.tankEngine.index, wagons: [] })
        const train = w.vehicleList()[0]!
        // inside the depot it is not on the map: the depot still opens the buy window
        expect(rtQueryTarget(w, ME, depot)).toEqual({ kind: 'buyVehicle', id: depot })
        train.state = RtVehicleState.loading
        train.tiles = [stationTile]
        expect(rtQueryTarget(w, ME, stationTile)).toEqual({ kind: 'vehicle', id: train.id })
    })
})

describe('minimap', () => {
    it('fits the map diamond in the minimap and maps world points both ways', () => {
        for (const side of [64, 128, 256]) {
            expect(rtMinimapScale(side) * 2 * side).toBe(RT_MINIMAP_WIDTH)
            // the west corner of the map (x = side, y = 0) is the left edge, the east corner the right
            const west = rtMinimapFromWorld(side, -side * 32, side * 16)
            const east = rtMinimapFromWorld(side, side * 32, side * 16)
            const south = rtMinimapFromWorld(side, 0, side * 32)
            expect(west).toEqual({ x: 0, y: RT_MINIMAP_WIDTH / 4 })
            expect(east).toEqual({ x: RT_MINIMAP_WIDTH, y: RT_MINIMAP_WIDTH / 4 })
            expect(south.y).toBe(RT_MINIMAP_WIDTH / 2)
            const back = rtMinimapToWorld(side, 100, 50)
            expect(rtMinimapFromWorld(side, back.x, back.y)).toEqual({ x: 100, y: 50 })
        }
    })

    it('colours water, grass and owned infrastructure', () => {
        const { w, depot, rivalDepot } = network()
        w.map.setTile(0, RtTileKind.water, 255, 0)
        expect(rtMinimapColour(w, 0)).not.toBe(rtMinimapColour(w, 1))
        expect(rtMinimapColour(w, depot)).toBe(RT_CATALOG.companies.colours[0])
        expect(rtMinimapColour(w, rivalDepot)).toBe(RT_CATALOG.companies.colours[1])
    })
})
