import { describe, expect, it } from 'vitest'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import {
    RT_SERVER_COMPANY,
    RtCommandError,
    RtCommandKind,
    applyCommand,
    decodeCommand,
    encodeCommand,
    type RtCommand
} from '#shared/utils/rail-tycoon/commands'
import { RtOrderError } from '#shared/utils/rail-tycoon/orders'
import { SeededRandom } from '#shared/utils/random'
import { stepRoadVehicle } from '#shared/utils/rail-tycoon/road-vehicle'
import { RtSignalType, rtSignalGreen, rtSignalOnTrackdir } from '#shared/utils/rail-tycoon/signals'
import { RtDir, RtMap, RtTileKind } from '#shared/utils/rail-tycoon/map'
import { decodeWorldOrThrow, encodeWorld } from '#shared/utils/rail-tycoon/save'
import { RtAxis } from '#shared/utils/rail-tycoon/stations-build'
import {
    RT_ROAD_X,
    RtTrack,
    buildRail,
    rtIsCrossing,
    rtPieceEdges,
    rtRailTilePieces,
    rtTrackdirOf,
    type RtTrack as Track
} from '#shared/utils/rail-tycoon/track'
import { rtRemoveTrain, stepTrain } from '#shared/utils/rail-tycoon/train'
import { RT_NONE, RtOrderFlag, RtOrderKind, RtVehicleKind, RtVehicleState, type RtVehicle } from '#shared/utils/rail-tycoon/types'
import { rtVehicleSellValue } from '#shared/utils/rail-tycoon/vehicles'
import { RtWorld, rtNewCompany, rtStartDate } from '#shared/utils/rail-tycoon/world'

const ME = 0
const RIVAL = 1
const M = RT_CATALOG.vehicles.models
const ENGINE = M.expressEngine.index
const K = RtCommandKind

function world(sharing = false, side = 64): RtWorld {
    const w = new RtWorld({
        settings: { side, maxCompanies: 8, sharing }, map: new RtMap(side), rngState: 7, tick: 0, date: rtStartDate(),
        pathfinderCursor: 0, companies: [rtNewCompany(ME, 'Mine', 0, 0), rtNewCompany(RIVAL, 'Rival', 1, 0)],
        towns: [], industries: [], stations: [], vehicles: []
    })
    for (const company of w.companyList()) company.money = 1_000_000
    return w
}

const at = (w: RtWorld, x: number, y: number) => w.map.idx(x, y)

/** Applies a command and expects it to succeed. */
function must(w: RtWorld, company: number, command: RtCommand) {
    const result = applyCommand(w, company, command, true)
    if (!result.ok) throw new Error(`command ${command.kind} refused (${result.error})`)
    return result
}

/** Expects the command refused with `error`, with the world hash unchanged, validating and applying. */
function refused(w: RtWorld, company: number, command: RtCommand, error: number) {
    const before = w.hash()
    expect(applyCommand(w, company, command, false)).toMatchObject({ ok: false, error })
    expect(applyCommand(w, company, command, true)).toMatchObject({ ok: false, error })
    expect(w.hash()).toBe(before)
}

const railCost = (w: RtWorld, x: number, y: number) => {
    const probe = buildRail(w.map, ME, at(w, x, y), RtTrack.x, false)
    if (!probe.ok) throw new Error('probe refused')
    return probe.cost
}

/** A train bought through commands in a new own depot at (x, y) facing `facing`, started. */
function train(w: RtWorld, owner: number, x: number, y: number, facing: number): RtVehicle {
    must(w, owner, { kind: K.buildDepot, tile: at(w, x, y), vehicleKind: RtVehicleKind.rail, facing })
    const bought = must(w, owner, { kind: K.buyVehicle, depot: at(w, x, y), model: ENGINE, wagons: [] })
    const v = w.vehicle(bought.id!)!
    must(w, owner, { kind: K.startStop, vehicle: v.id, stopped: false })
    return v
}

function run(w: RtWorld, ticks: number, until: () => boolean): void {
    for (let t = 0; t < ticks; t++) {
        w.tick++
        w.pathNodesLeft = RT_CATALOG.pathfinder.pathNodesPerTick
        for (const v of w.vehicleList()) if (stepTrain(w, v).remove) rtRemoveTrain(w, v)
        if (until()) return
    }
}

describe('rail tycoon applyCommand', () => {
    it('refuses building beyond the money without changing the world; validating never changes it', () => {
        const w = world()
        const company = w.company(ME)!
        const cost = railCost(w, 10, 10)
        company.money = cost - 1
        refused(w, ME, { kind: K.buildRail, tile: at(w, 10, 10), piece: RtTrack.x }, RtCommandError.money)
        company.money = cost
        const before = w.hash()
        expect(applyCommand(w, ME, { kind: K.buildRail, tile: at(w, 10, 10), piece: RtTrack.x }, false)).toEqual({ ok: true, cost })
        expect(w.hash()).toBe(before)
        expect(must(w, ME, { kind: K.buildRail, tile: at(w, 10, 10), piece: RtTrack.x }).cost).toBe(cost)
        expect(company.money).toBe(0)
        expect(company.financeThisYear.construction).toBe(-cost)
        expect(company.monthExpenses).toBe(-cost)
    })

    it('a 100-tile rail line builds as one command, and with money for 40 tiles builds 40 and stops', () => {
        const w = world()
        const cost = railCost(w, 2, 10)
        const line: RtCommand = { kind: K.buildRailLine, tile: at(w, 2, 10), endTile: at(w, 61, 10), trackdir: rtTrackdirOf(RtTrack.x, true) }
        expect(must(w, ME, line).cost).toBe(60 * cost)
        for (let x = 2; x <= 61; x++) expect(rtRailTilePieces(w.map, at(w, x, 10))).toBe(1 << RtTrack.x)

        const poor = world()
        poor.company(ME)!.money = 40 * cost + cost - 1
        const result = must(poor, ME, { ...line, tile: at(poor, 2, 20), endTile: at(poor, 61, 20) })
        expect(result.cost).toBe(40 * cost)
        expect(poor.company(ME)!.money).toBe(cost - 1)
        expect(poor.map.kind[at(poor, 41, 20)]).toBe(RtTileKind.rail)
        expect(poor.map.kind[at(poor, 42, 20)]).toBe(RtTileKind.clear)
    })

    it('a line over existing own track continues past it charging only new pieces, and stops at a foreign tile', () => {
        const w = world()
        const cost = railCost(w, 2, 10)
        for (const x of [5, 6, 7]) must(w, ME, { kind: K.buildRail, tile: at(w, x, 10), piece: RtTrack.x })
        buildRail(w.map, RIVAL, at(w, 15, 10), RtTrack.x, true)
        const result = must(w, ME, { kind: K.buildRailLine, tile: at(w, 2, 10), endTile: at(w, 20, 10), trackdir: rtTrackdirOf(RtTrack.x, true) })
        // 2..14 less the three already there
        expect(result.cost).toBe(10 * cost)
        expect(w.map.owner[at(w, 15, 10)]).toBe(RIVAL)
        expect(w.map.kind[at(w, 16, 10)]).toBe(RtTileKind.clear)
        // a line entirely on existing track builds nothing
        refused(w, ME, { kind: K.buildRailLine, tile: at(w, 5, 10), endTile: at(w, 7, 10), trackdir: rtTrackdirOf(RtTrack.x, true) }, RtCommandError.alreadyBuilt)
    })

    it('a diagonal line alternates its two pieces into one connected track', () => {
        const w = world()
        const start = at(w, 30, 30)
        const td = rtTrackdirOf(RtTrack.upper, false)
        // walk the expected tiles from the pieces' own edges
        const tiles: number[] = [start]
        let piece: Track = RtTrack.upper
        for (let k = 0; k < 9; k++) {
            const exit = rtPieceEdges(piece)[1]
            tiles.push(w.map.neighbour(tiles[tiles.length - 1]!, exit))
            piece = piece === RtTrack.upper ? RtTrack.lower : RtTrack.upper
        }
        const result = must(w, ME, { kind: K.buildRailLine, tile: start, endTile: tiles[9]!, trackdir: td })
        expect(result.cost).toBeGreaterThan(0)
        for (let k = 0; k < tiles.length; k++) {
            const pieces = rtRailTilePieces(w.map, tiles[k]!)
            expect(pieces).toBe(1 << (k % 2 === 0 ? RtTrack.upper : RtTrack.lower))
        }
        // an end tile the drag never reaches is refused
        refused(w, ME, { kind: K.buildRailLine, tile: at(w, 2, 2), endTile: at(w, 9, 3), trackdir: rtTrackdirOf(RtTrack.x, true) }, RtCommandError.invalid)
    })

    it('buying needs an own depot; selling refunds the sell value into newVehicles', () => {
        const w = world()
        must(w, RIVAL, { kind: K.buildDepot, tile: at(w, 5, 5), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw })
        refused(w, ME, { kind: K.buyVehicle, depot: at(w, 5, 5), model: ENGINE, wagons: [] }, RtCommandError.notOwner)
        refused(w, ME, { kind: K.buyVehicle, depot: at(w, 9, 9), model: ENGINE, wagons: [] }, RtCommandError.invalid)
        must(w, ME, { kind: K.buildDepot, tile: at(w, 5, 9), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw })
        const company = w.company(ME)!
        const money = company.money
        const bought = must(w, ME, { kind: K.buyVehicle, depot: at(w, 5, 9), model: ENGINE, wagons: [M.passengerCoach.index] })
        expect(company.money).toBe(money - bought.cost)
        const v = w.vehicle(bought.id!)!
        const refund = rtVehicleSellValue(v)
        expect(refund).toBeGreaterThan(0)
        expect(must(w, ME, { kind: K.sellVehicle, vehicle: v.id }).cost).toBe(-refund)
        expect(w.vehicle(v.id)).toBeUndefined()
        expect(company.money).toBe(money - bought.cost + refund)
        expect(company.financeThisYear.newVehicles).toBe(-bought.cost + refund)
    })

    it('foundCompany is the server\'s alone and adds exactly one company with a clamped name', () => {
        const w = world()
        const name = '🚂'.repeat(30)
        refused(w, ME, { kind: K.foundCompany, name, colour: 3 }, RtCommandError.noCompany)
        const result = must(w, RT_SERVER_COMPANY, { kind: K.foundCompany, name, colour: 3 })
        expect(w.companyList().length).toBe(3)
        const company = w.company(result.id!)!
        expect(company.colour).toBe(3)
        expect(new TextEncoder().encode(company.name).length).toBeLessThanOrEqual(RT_CATALOG.caps.maxNameBytes)
        expect(decodeWorldOrThrow(encodeWorld(w)).hash()).toBe(w.hash())
        // a command from a company that does not exist
        refused(w, 6, { kind: K.buildRail, tile: at(w, 1, 1), piece: RtTrack.x }, RtCommandError.noCompany)
    })

    it('refuses every command on another company\'s vehicle with the hash unchanged', () => {
        const w = world()
        must(w, ME, { kind: K.buildRailLine, tile: at(w, 6, 10), endTile: at(w, 40, 10), trackdir: rtTrackdirOf(RtTrack.x, true) })
        const v = train(w, ME, 5, 10, RtDir.sw)
        run(w, 400, () => v.state === RtVehicleState.driving && v.tiles[0]! >= at(w, 12, 10))
        for (const command of [
            { kind: K.sellVehicle, vehicle: v.id },
            { kind: K.setOrders, vehicle: v.id, orders: [] },
            { kind: K.startStop, vehicle: v.id, stopped: true },
            { kind: K.sendToDepot, vehicle: v.id },
            { kind: K.reverseTrain, vehicle: v.id }
        ] as RtCommand[]) refused(w, RIVAL, command, RtCommandError.notOwner)
    })

    it('removing rail under a train is refused, and an area drag stops at the train\'s tile', () => {
        const w = world()
        must(w, ME, { kind: K.buildRailLine, tile: at(w, 6, 10), endTile: at(w, 40, 10), trackdir: rtTrackdirOf(RtTrack.x, true) })
        const v = train(w, ME, 5, 10, RtDir.sw)
        run(w, 2000, () => v.state === RtVehicleState.driving && v.tiles[0] === at(w, 20, 10))
        must(w, ME, { kind: K.startStop, vehicle: v.id, stopped: true })
        run(w, 2000, () => v.speed === 0 && v.state !== RtVehicleState.inDepot)
        const head = v.tiles[0]!
        refused(w, ME, { kind: K.removeRail, tile: head, piece: RtTrack.x }, RtCommandError.conflict)
        refused(w, ME, { kind: K.demolish, tile: head }, RtCommandError.conflict)
        const x = Math.min(...v.tiles.map(t => w.map.tileX(t)))
        // row 9 (a tree) and the track west of the train in row 10 are cleared; the drag stops at the train
        w.map.setTile(at(w, x - 2, 9), RtTileKind.tree, 255, 0)
        const result = must(w, ME, { kind: K.demolishArea, tile: at(w, x - 4, 9), endTile: at(w, x + 1, 10) })
        expect(result.cost).not.toBe(0)
        expect(w.map.kind[at(w, x - 2, 9)]).toBe(RtTileKind.clear)
        for (let k = x - 4; k < x; k++) expect(w.map.kind[at(w, k, 10)]).toBe(RtTileKind.clear)
        for (const tile of v.tiles) expect(w.map.kind[tile]).toBe(RtTileKind.rail)
    })

    it('sendToDepot drives a train to its nearest own depot, where it stops; the flag survives a save', () => {
        const w = world()
        must(w, ME, { kind: K.buildRailLine, tile: at(w, 6, 10), endTile: at(w, 40, 10), trackdir: rtTrackdirOf(RtTrack.x, true) })
        must(w, ME, { kind: K.buildDepot, tile: at(w, 41, 10), vehicleKind: RtVehicleKind.rail, facing: RtDir.ne })
        const v = train(w, ME, 5, 10, RtDir.sw)
        run(w, 2000, () => v.state === RtVehicleState.driving && v.tiles[0] === at(w, 15, 10))
        refused(w, ME, { kind: K.sendToDepot, vehicle: 99 }, RtCommandError.invalid)
        must(w, ME, { kind: K.sendToDepot, vehicle: v.id })
        expect(v.haltInDepot).toBe(true)
        expect(v.serviceDepot).not.toBe(RT_NONE)
        const decoded = decodeWorldOrThrow(encodeWorld(w))
        expect(decoded.vehicle(v.id)!.haltInDepot).toBe(true)
        expect(decoded.hash()).toBe(w.hash())
        run(w, 6000, () => v.state === RtVehicleState.inDepot)
        expect(v.state).toBe(RtVehicleState.inDepot)
        expect(v.stopped).toBe(true)
        expect(v.haltInDepot).toBe(false)
        // in a depot the button is gone; started again it leaves
        refused(w, ME, { kind: K.sendToDepot, vehicle: v.id }, RtCommandError.state)
        must(w, ME, { kind: K.startStop, vehicle: v.id, stopped: false })
        refused(w, ME, { kind: K.startStop, vehicle: v.id, stopped: false }, RtCommandError.state)
    })

    it('a second sendToDepot cancels the first', () => {
        const w = world()
        must(w, ME, { kind: K.buildRailLine, tile: at(w, 6, 10), endTile: at(w, 40, 10), trackdir: rtTrackdirOf(RtTrack.x, true) })
        const v = train(w, ME, 5, 10, RtDir.sw)
        run(w, 2000, () => v.state === RtVehicleState.driving && v.tiles[0] === at(w, 15, 10))
        must(w, ME, { kind: K.buildDepot, tile: at(w, 41, 10), vehicleKind: RtVehicleKind.rail, facing: RtDir.ne })
        must(w, ME, { kind: K.sendToDepot, vehicle: v.id })
        must(w, ME, { kind: K.sendToDepot, vehicle: v.id })
        expect(v.haltInDepot).toBe(false)
        expect(v.serviceDepot).toBe(RT_NONE)
    })

    it('sendToDepot turns a moving train round when its nearest depot lies behind it, as the original', () => {
        const w = world()
        must(w, ME, { kind: K.buildRailLine, tile: at(w, 6, 10), endTile: at(w, 40, 10), trackdir: rtTrackdirOf(RtTrack.x, true) })
        const v = train(w, ME, 5, 10, RtDir.sw)
        run(w, 2000, () => v.state === RtVehicleState.driving && v.tiles[0] === at(w, 15, 10))
        expect(v.speed).toBeGreaterThan(0)
        const tail = v.tiles[v.tiles.length - 1]!
        // validating alone turns nothing
        expect(applyCommand(w, ME, { kind: K.sendToDepot, vehicle: v.id }, false).ok).toBe(true)
        expect(v.tiles[0]).toBe(at(w, 15, 10))
        must(w, ME, { kind: K.sendToDepot, vehicle: v.id })
        expect(v.tiles[0]).toBe(tail)
        expect(v.speed).toBe(0)
        expect(v.serviceDepot).toBe(at(w, 5, 10))
        run(w, 6000, () => v.state === RtVehicleState.inDepot)
        expect(v.state).toBe(RtVehicleState.inDepot)
        expect(v.tiles[0]).toBe(at(w, 5, 10))
        expect(v.stopped).toBe(true)
    })

    it('a train on another company\'s track cannot be stopped there, not even with only its tail on it', () => {
        const w = world(true)
        must(w, ME, { kind: K.buildRailLine, tile: at(w, 6, 10), endTile: at(w, 20, 10), trackdir: rtTrackdirOf(RtTrack.x, true) })
        must(w, RIVAL, { kind: K.buildRailLine, tile: at(w, 21, 10), endTile: at(w, 40, 10), trackdir: rtTrackdirOf(RtTrack.x, true) })
        const v = train(w, ME, 5, 10, RtDir.sw)
        const stop: RtCommand = { kind: K.startStop, vehicle: v.id, stopped: true }
        run(w, 4000, () => v.state === RtVehicleState.driving && v.tiles[0]! >= at(w, 24, 10))
        expect(w.map.owner[v.tiles[0]!]).toBe(RIVAL)
        refused(w, ME, stop, RtCommandError.notOwner)
        // back on its own track with only its tail on the rival's: still refused
        must(w, ME, { kind: K.reverseTrain, vehicle: v.id })
        run(w, 4000, () => v.state === RtVehicleState.driving && w.map.owner[v.tiles[0]!] === ME
            && w.map.owner[v.tiles[v.tiles.length - 1]!] === RIVAL)
        expect(w.map.owner[v.tiles[0]!]).toBe(ME)
        expect(v.tiles.some(t => w.map.owner[t] === RIVAL)).toBe(true)
        refused(w, ME, stop, RtCommandError.notOwner)
        run(w, 4000, () => v.tiles.every(t => w.map.owner[t] === ME))
        must(w, ME, stop)
        expect(v.stopped).toBe(true)
    })

    it('reverseTrain flips a running own train and is refused in a depot', () => {
        const w = world()
        must(w, ME, { kind: K.buildRailLine, tile: at(w, 6, 10), endTile: at(w, 40, 10), trackdir: rtTrackdirOf(RtTrack.x, true) })
        const v = train(w, ME, 5, 10, RtDir.sw)
        refused(w, ME, { kind: K.reverseTrain, vehicle: v.id }, RtCommandError.state)
        run(w, 2000, () => v.state === RtVehicleState.driving && v.tiles[0] === at(w, 15, 10))
        const head = v.tiles[0]
        must(w, ME, { kind: K.reverseTrain, vehicle: v.id })
        expect(v.tiles[v.tiles.length - 1]).toBe(head)
        expect(v.pieces[0]! & 8).toBe(0)
    })

    it('setOrders validates the list; changeLoan and renameCompany act on the company', () => {
        const w = world()
        must(w, ME, { kind: K.buildRailStation, tile: at(w, 10, 10), axis: RtAxis.x, tracks: 1, length: 3 })
        must(w, RIVAL, { kind: K.buildRailStation, tile: at(w, 30, 10), axis: RtAxis.x, tracks: 1, length: 3 })
        expect(w.stationList().map(s => s.owner)).toEqual([ME, RIVAL])
        must(w, ME, { kind: K.buildDepot, tile: at(w, 5, 9), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw })
        const v = w.vehicle(must(w, ME, { kind: K.buyVehicle, depot: at(w, 5, 9), model: ENGINE, wagons: [] }).id!)!
        const own = { kind: RtOrderKind.gotoStation, target: 0, flags: 0 }
        must(w, ME, { kind: K.setOrders, vehicle: v.id, orders: [own] })
        expect(v.orders).toEqual([own])
        expect(applyCommand(w, ME, { kind: K.setOrders, vehicle: v.id, orders: [own, { ...own, target: 1 }] }, true))
            .toMatchObject({ ok: false, error: RtCommandError.orders })
        expect(v.orders).toEqual([own])

        const company = w.company(ME)!
        const [money, loan] = [company.money, company.loan]
        must(w, ME, { kind: K.changeLoan, steps: 2 })
        expect(company.loan).toBe(loan + 2 * RT_CATALOG.economy.loanStep)
        expect(company.money).toBe(money + 2 * RT_CATALOG.economy.loanStep)
        refused(w, ME, { kind: K.changeLoan, steps: -(company.loan / RT_CATALOG.economy.loanStep) - 1 }, RtCommandError.loan)
        refused(w, ME, { kind: K.changeLoan, steps: RT_CATALOG.economy.maxLoan / RT_CATALOG.economy.loanStep }, RtCommandError.loan)
        refused(w, ME, { kind: K.changeLoan, steps: 0 }, RtCommandError.loan)
        must(w, ME, { kind: K.renameCompany, name: '  Northern Lines ' })
        expect(company.name).toBe('Northern Lines')
        refused(w, ME, { kind: K.renameCompany, name: 'Rival' }, RtCommandError.conflict)
        refused(w, ME, { kind: K.renameCompany, name: '   ' }, RtCommandError.invalid)
    })

    it('refuses hostile payloads without throwing or changing the world', () => {
        const w = world()
        const trap = new Proxy({}, { get() { throw new Error('trap') } })
        const before = w.hash()
        const cases: unknown[] = [
            null, 7, 'buildRail', [], {}, { kind: 99 }, { kind: -1 }, { kind: 1.5 },
            { kind: K.buildRail, tile: -1, piece: 0 }, { kind: K.buildRail, tile: 64 * 64, piece: 0 },
            { kind: K.buildRail, tile: 10, piece: 6 }, { kind: K.buildRail, tile: 10, piece: '0' },
            { kind: K.buildRailLine, tile: 10, endTile: 10 + 64 * 200, trackdir: 8 },
            { kind: K.buildRailLine, tile: 10, endTile: 20, trackdir: 6 },
            { kind: K.buildRoadLine, tile: at(w, 1, 1), endTile: at(w, 3, 3) },
            { kind: K.demolishArea, tile: at(w, 0, 0), endTile: at(w, 40, 40) },
            { kind: K.buyVehicle, depot: 5, model: 9999, wagons: 'x' },
            { kind: K.setOrders, vehicle: 0, orders: trap },
            { kind: K.startStop, vehicle: 0, stopped: 1 },
            { kind: K.changeLoan, steps: 1e300 },
            { kind: K.renameCompany, name: { toString: () => 'x' } },
            trap
        ]
        for (const command of cases) {
            const result = applyCommand(w, ME, command as RtCommand, true)
            expect(result.ok).toBe(false)
        }
        expect(w.hash()).toBe(before)
    })
})

const EAST = rtTrackdirOf(RtTrack.x, true)

/** A line of own track along y = 10 from x0 to x1. */
function line(w: RtWorld, owner: number, x0: number, x1: number, y = 10): void {
    must(w, owner, { kind: K.buildRailLine, tile: at(w, x0, y), endTile: at(w, x1, y), trackdir: EAST })
}

/** Runs until the train stands still on track (stopped by a command or broken down). */
function parkAt(w: RtWorld, v: RtVehicle, x: number): void {
    run(w, 4000, () => v.state === RtVehicleState.driving && w.map.tileX(v.tiles[0]!) >= x)
    v.breakdownTicks = 1_000_000
    run(w, 400, () => v.speed === 0)
}

describe('rail tycoon commands', () => {
    it('foundCompany on twin worlds at the same tick keeps their hashes equal', () => {
        const [a, b] = [world(), world()]
        a.tick = b.tick = 1234
        must(a, RT_SERVER_COMPANY, { kind: K.foundCompany, name: 'Twin', colour: 4 })
        must(b, RT_SERVER_COMPANY, { kind: K.foundCompany, name: 'Twin', colour: 4 })
        expect(a.hash()).toBe(b.hash())
        expect(a.company(2)!.foundedTick).toBe(1234)
    })

    it('a 100-tile rail line on a 128 map builds every tile as one command', () => {
        const w = world(false, 128)
        const cost = railCost(w, 10, 10)
        expect(must(w, ME, { kind: K.buildRailLine, tile: at(w, 10, 10), endTile: at(w, 109, 10), trackdir: EAST }).cost).toBe(100 * cost)
        for (let x = 10; x <= 109; x++) expect(rtRailTilePieces(w.map, at(w, x, 10))).toBe(1 << RtTrack.x)
    })

    it('a line from the end of an own line extends it; one crossing an own piece continues past it, charging only new pieces', () => {
        const w = world()
        const cost = railCost(w, 2, 10)
        line(w, ME, 2, 10)
        expect(must(w, ME, { kind: K.buildRailLine, tile: at(w, 10, 10), endTile: at(w, 20, 10), trackdir: EAST }).cost).toBe(10 * cost)
        must(w, ME, { kind: K.buildRail, tile: at(w, 15, 20), piece: RtTrack.y })
        const crossing = must(w, ME, { kind: K.buildRailLine, tile: at(w, 10, 20), endTile: at(w, 20, 20), trackdir: EAST })
        expect(crossing.cost).toBe(11 * cost)
        expect(rtRailTilePieces(w.map, at(w, 15, 20))).toBe((1 << RtTrack.x) | (1 << RtTrack.y))
    })

    it('demolishArea over trees and own track clears both and stops at a foreign tile', () => {
        const w = world()
        line(w, ME, 2, 9)
        buildRail(w.map, RIVAL, at(w, 6, 11), RtTrack.x, true)
        for (const x of [2, 3, 4, 5]) w.map.setTile(at(w, x, 11), RtTileKind.tree, 255, 0)
        const result = must(w, ME, { kind: K.demolishArea, tile: at(w, 2, 10), endTile: at(w, 9, 11) })
        expect(result.cost).not.toBe(0)
        for (let x = 2; x <= 9; x++) expect(w.map.kind[at(w, x, 10)]).toBe(RtTileKind.clear)
        for (const x of [2, 3, 4, 5]) expect(w.map.kind[at(w, x, 11)]).toBe(RtTileKind.clear)
        expect(w.map.owner[at(w, 6, 11)]).toBe(RIVAL)
        // it stopped there: the tree beyond the foreign tile stands
        w.map.setTile(at(w, 7, 11), RtTileKind.tree, 255, 0)
        refused(w, ME, { kind: K.demolishArea, tile: at(w, 6, 11), endTile: at(w, 7, 11) }, RtCommandError.notOwner)
        expect(w.map.kind[at(w, 7, 11)]).toBe(RtTileKind.tree)
    })

    it('removing road under a moving bus is refused with the hash unchanged', () => {
        const w = world()
        must(w, ME, { kind: K.buildRoadLine, tile: at(w, 6, 10), endTile: at(w, 40, 10) })
        must(w, ME, { kind: K.buildDepot, tile: at(w, 5, 10), vehicleKind: RtVehicleKind.road, facing: RtDir.sw })
        const bus = w.vehicle(must(w, ME, { kind: K.buyVehicle, depot: at(w, 5, 10), model: M.townBus.index, wagons: [] }).id!)!
        must(w, ME, { kind: K.startStop, vehicle: bus.id, stopped: false })
        for (let t = 0; t < 600 && !(bus.state === RtVehicleState.driving && bus.tiles[0]! >= at(w, 12, 10)); t++) {
            w.tick++
            stepRoadVehicle(w, bus)
        }
        expect(bus.speed).toBeGreaterThan(0)
        refused(w, ME, { kind: K.removeRoad, tile: bus.tiles[0]!, bits: RT_ROAD_X }, RtCommandError.conflict)
        refused(w, ME, { kind: K.demolish, tile: bus.tiles[0]! }, RtCommandError.conflict)
    })

    it('stops a road vehicle only in its own depot or on its own and town roads, never on a level crossing', () => {
        const w = world(true)
        must(w, ME, { kind: K.buildRoadLine, tile: at(w, 6, 10), endTile: at(w, 20, 10) })
        must(w, RIVAL, { kind: K.buildRoadLine, tile: at(w, 6, 12), endTile: at(w, 20, 12) })
        must(w, ME, { kind: K.buildDepot, tile: at(w, 5, 10), vehicleKind: RtVehicleKind.road, facing: RtDir.sw })
        must(w, RIVAL, { kind: K.buildDepot, tile: at(w, 5, 12), vehicleKind: RtVehicleKind.road, facing: RtDir.sw })
        expect(buildRail(w.map, ME, at(w, 10, 10), RtTrack.y, true).ok).toBe(true)
        expect(rtIsCrossing(w.map.payload[at(w, 10, 10)]!)).toBe(true)
        const bus = w.vehicle(must(w, ME, { kind: K.buyVehicle, depot: at(w, 5, 10), model: M.townBus.index, wagons: [] }).id!)!
        const stop: RtCommand = { kind: K.startStop, vehicle: bus.id, stopped: true }
        const standOn = (tile: number, state: RtVehicleState) => {
            bus.stopped = false
            bus.state = state
            bus.tiles = [tile]
            bus.pieces = [0]
        }
        standOn(at(w, 5, 12), RtVehicleState.inDepot)
        refused(w, ME, stop, RtCommandError.notOwner)
        standOn(at(w, 14, 12), RtVehicleState.driving)
        refused(w, ME, stop, RtCommandError.notOwner)
        standOn(at(w, 10, 10), RtVehicleState.driving)
        refused(w, ME, stop, RtCommandError.state)
        standOn(at(w, 14, 10), RtVehicleState.driving)
        must(w, ME, stop)
        standOn(at(w, 5, 10), RtVehicleState.inDepot)
        must(w, ME, stop)
    })

    it('a signal placed before a free block shows green and before an occupied one red, in the same command', () => {
        const w = world()
        line(w, ME, 6, 40)
        const v = train(w, ME, 5, 10, RtDir.sw)
        parkAt(w, v, 30)
        must(w, ME, { kind: K.placeSignal, tile: at(w, 20, 10), piece: RtTrack.x, signalType: RtSignalType.block })
        expect(rtSignalOnTrackdir(w.map, at(w, 20, 10), EAST)).toBe(true)
        expect(rtSignalGreen(w.map, at(w, 20, 10), EAST)).toBe(false)
        // facing west the block is the free stretch back to the depot
        expect(rtSignalGreen(w.map, at(w, 20, 10), EAST ^ 8)).toBe(true)
    })

    it('removing rail that splits a block leaves both new blocks\' signals right', () => {
        const w = world()
        line(w, ME, 6, 40)
        const v = train(w, ME, 5, 10, RtDir.sw)
        parkAt(w, v, 37)
        // the third placement cycles to one way, eastbound
        for (const x of [15, 30]) {
            for (let k = 0; k < 3; k++) must(w, ME, { kind: K.placeSignal, tile: at(w, x, 10), piece: RtTrack.x, signalType: RtSignalType.block })
        }
        expect(rtSignalGreen(w.map, at(w, 30, 10), EAST)).toBe(false)
        // the train stands east of 33 in the block behind the signal at 30
        expect(Math.min(...v.tiles.map(t => w.map.tileX(t)))).toBeGreaterThan(33)
        expect(rtSignalGreen(w.map, at(w, 15, 10), EAST)).toBe(true)
        must(w, ME, { kind: K.removeRail, tile: at(w, 33, 10), piece: RtTrack.x })
        // the signal at 30 now guards a dead end with no train in it; the one at 15 still a free block
        expect(rtSignalGreen(w.map, at(w, 30, 10), EAST)).toBe(true)
        expect(rtSignalGreen(w.map, at(w, 15, 10), EAST)).toBe(true)
    })

    it('a depot order to another company\'s depot services the train, which pays the fee and drives on', () => {
        const w = world(true)
        line(w, ME, 6, 40)
        must(w, RIVAL, { kind: K.buildDepot, tile: at(w, 41, 10), vehicleKind: RtVehicleKind.rail, facing: RtDir.ne })
        const v = train(w, ME, 5, 10, RtDir.sw)
        must(w, ME, { kind: K.setOrders, vehicle: v.id, orders: [{ kind: RtOrderKind.gotoDepot, target: at(w, 41, 10), flags: 0 }] })
        const costs = w.company(ME)!.financeThisYear.sharingCosts
        run(w, 6000, () => v.state === RtVehicleState.inDepot && v.tiles[0] === at(w, 41, 10))
        expect(v.tiles[0]).toBe(at(w, 41, 10))
        expect(v.lastServiceTick).toBe(w.tick)
        expect(v.stopped).toBe(false)
        expect(w.company(ME)!.financeThisYear.sharingCosts).toBeLessThan(costs)
        run(w, 400, () => v.state === RtVehicleState.driving)
        expect(v.state).toBe(RtVehicleState.driving)
        expect(v.stopped).toBe(false)
    })

    it('sendToDepot never picks another company\'s depot', () => {
        const w = world(true)
        line(w, ME, 6, 40)
        must(w, ME, { kind: K.buildDepot, tile: at(w, 5, 10), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw })
        must(w, RIVAL, { kind: K.buildDepot, tile: at(w, 41, 10), vehicleKind: RtVehicleKind.rail, facing: RtDir.ne })
        const v = w.vehicle(must(w, ME, { kind: K.buyVehicle, depot: at(w, 5, 10), model: ENGINE, wagons: [] }).id!)!
        must(w, ME, { kind: K.startStop, vehicle: v.id, stopped: false })
        run(w, 2000, () => v.state === RtVehicleState.driving && v.tiles[0] === at(w, 20, 10))
        // the own depot is behind the moving train and the rival's ahead is no target: it turns round
        must(w, ME, { kind: K.sendToDepot, vehicle: v.id })
        expect(v.serviceDepot).toBe(at(w, 5, 10))
        // cancelled, and with the own depot gone, the rival's alone is refused either way round
        must(w, ME, { kind: K.sendToDepot, vehicle: v.id })
        must(w, ME, { kind: K.demolish, tile: at(w, 5, 10) })
        refused(w, ME, { kind: K.sendToDepot, vehicle: v.id }, RtCommandError.noDepot)
    })

    it('a 30-emoji company name is stored clamped and the world and command still encode', () => {
        const w = world()
        const name = '🚄'.repeat(30)
        must(w, ME, { kind: K.renameCompany, name })
        const stored = w.company(ME)!.name
        expect(new TextEncoder().encode(stored).length).toBeLessThanOrEqual(RT_CATALOG.caps.maxNameBytes)
        expect(stored.startsWith('🚄')).toBe(true)
        expect(decodeWorldOrThrow(encodeWorld(w)).company(ME)!.name).toBe(stored)
        expect(decodeCommand(encodeCommand({ kind: K.renameCompany, name }))).toEqual({ kind: K.renameCompany, name: stored })
    })

    it('buyVehicle at the per-company cap and a station at maxStations are refused with the hash unchanged', () => {
        const w = world(false, 128)
        w.company(ME)!.money = 1e12
        must(w, ME, { kind: K.buildDepot, tile: at(w, 120, 120), vehicleKind: RtVehicleKind.road, facing: RtDir.ne })
        const buy: RtCommand = { kind: K.buyVehicle, depot: at(w, 120, 120), model: M.townBus.index, wagons: [] }
        for (let k = 0; k < RT_CATALOG.caps.maxVehiclesPerCompany; k++) must(w, ME, buy)
        refused(w, ME, buy, RtCommandError.limit)
        // the rival can still buy
        must(w, RIVAL, { kind: K.buildDepot, tile: at(w, 110, 120), vehicleKind: RtVehicleKind.road, facing: RtDir.ne })
        must(w, RIVAL, { ...buy, depot: at(w, 110, 120) })

        for (let k = 0; k < RT_CATALOG.caps.maxStations; k++) {
            must(w, ME, { kind: K.buildRailStation, tile: at(w, 2 * (k % 32), 2 * Math.floor(k / 32)), axis: RtAxis.x, tracks: 1, length: 1 })
        }
        expect(w.stationList().length).toBe(RT_CATALOG.caps.maxStations)
        refused(w, ME, { kind: K.buildRailStation, tile: at(w, 100, 100), axis: RtAxis.x, tracks: 1, length: 1 }, RtCommandError.limit)
        must(w, RIVAL, { kind: K.buildRoad, tile: at(w, 100, 104), bits: RT_ROAD_X })
        refused(w, RIVAL, { kind: K.buildRoadStop, tile: at(w, 100, 104), stop: 1 }, RtCommandError.limit)
    })

    it('buyVehicle one wagon past maxTrainLength is refused with the hash unchanged', () => {
        const w = world()
        must(w, ME, { kind: K.buildDepot, tile: at(w, 5, 9), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw })
        const most = RT_CATALOG.vehicles.maxTrainVehicles - 1
        const wagons = (n: number) => Array.from({ length: n }, () => M.coalHopper.index)
        must(w, ME, { kind: K.buyVehicle, depot: at(w, 5, 9), model: ENGINE, wagons: wagons(most) })
        refused(w, ME, { kind: K.buyVehicle, depot: at(w, 5, 9), model: ENGINE, wagons: wagons(most + 1) }, RtCommandError.limit)
    })

    it('a full-load order at a competitor\'s station is refused', () => {
        const w = world(true)
        must(w, RIVAL, { kind: K.buildRailStation, tile: at(w, 30, 10), axis: RtAxis.x, tracks: 1, length: 3 })
        must(w, ME, { kind: K.buildDepot, tile: at(w, 5, 9), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw })
        const v = w.vehicle(must(w, ME, { kind: K.buyVehicle, depot: at(w, 5, 9), model: ENGINE, wagons: [] }).id!)!
        const order = { kind: RtOrderKind.gotoStation, target: 0, flags: RtOrderFlag.fullLoad }
        const result = applyCommand(w, ME, { kind: K.setOrders, vehicle: v.id, orders: [order] }, true)
        expect(result).toEqual({ ok: false, error: RtCommandError.orders, detail: RtOrderError.foreignFullLoad })
        must(w, ME, { kind: K.setOrders, vehicle: v.id, orders: [{ ...order, flags: 0 }] })
    })
})

/** One of every command variant, at awkward values (the largest ids, both stopped states, a full order list). */
const VARIANTS: RtCommand[] = [
    { kind: K.buildRail, tile: 65535, piece: 5 },
    { kind: K.buildRailLine, tile: 64 * 10 + 2, endTile: 64 * 10 + 61, trackdir: 8 },
    { kind: K.buildRailLine, tile: 64 * 30 + 30, endTile: 64 * 34 + 26, trackdir: 2 },
    { kind: K.removeRail, tile: 0, piece: 0 },
    { kind: K.buildRoad, tile: 77, bits: 15 },
    { kind: K.buildRoadLine, tile: 64 * 5 + 1, endTile: 64 * 60 + 1 },
    { kind: K.removeRoad, tile: 78, bits: 1 },
    { kind: K.buildRailStation, tile: 500, axis: RtAxis.y, tracks: 4, length: 7 },
    { kind: K.buildRoadStop, tile: 501, stop: 2 },
    { kind: K.buildDepot, tile: 502, vehicleKind: RtVehicleKind.road, facing: 3 },
    { kind: K.placeSignal, tile: 503, piece: 4, signalType: 1 },
    { kind: K.demolish, tile: 504 },
    { kind: K.demolishArea, tile: 64 * 2 + 2, endTile: 64 * 17 + 17 },
    { kind: K.buyVehicle, depot: 505, model: ENGINE, wagons: Array.from({ length: RT_CATALOG.vehicles.maxTrainVehicles - 1 }, () => M.coalHopper.index) },
    { kind: K.sellVehicle, vehicle: RT_CATALOG.caps.maxVehicles - 1 },
    { kind: K.setOrders, vehicle: 3, orders: Array.from({ length: RT_CATALOG.caps.maxOrders }, (_, k) => ({ kind: (k % 2) as 0 | 1, target: k % 2 === 0 ? 1023 : 4095, flags: k % 2 === 0 ? 3 : 0 })) },
    { kind: K.setOrders, vehicle: 3, orders: [] },
    { kind: K.startStop, vehicle: 9, stopped: true },
    { kind: K.startStop, vehicle: 9, stopped: false },
    { kind: K.sendToDepot, vehicle: 10 },
    { kind: K.reverseTrain, vehicle: 11 },
    { kind: K.changeLoan, steps: -32768 },
    { kind: K.changeLoan, steps: 32767 },
    { kind: K.renameCompany, name: 'Ünïcode Rail 🚂 Co' },
    { kind: K.buildSiding, tile: 506 },
    { kind: K.removeSiding, tile: 507 },
    { kind: K.foundCompany, name: 'Joiner', colour: RT_CATALOG.companies.colours.length - 1 }
]

describe('rail tycoon command codec', () => {
    it('covers every command kind', () => {
        expect(new Set(VARIANTS.map(c => c.kind))).toEqual(new Set(Object.values(K)))
    })

    it('every variant round-trips to an identical command and identical bytes', () => {
        for (const command of VARIANTS) {
            const bytes = encodeCommand(command)
            const decoded = decodeCommand(bytes)
            expect(decoded).toEqual(command)
            expect(encodeCommand(decoded!)).toEqual(bytes)
        }
    })

    it('every variant but setOrders and renameCompany encodes under 64 bytes; a drag is fixed size', () => {
        for (const command of VARIANTS) {
            if (command.kind === K.setOrders || command.kind === K.renameCompany) continue
            expect(encodeCommand(command).length).toBeLessThan(64)
        }
        expect(encodeCommand(VARIANTS[1]!).length).toBe(10)
        expect(encodeCommand({ kind: K.demolishArea, tile: 0, endTile: 0 }).length).toBe(9)
    })

    it('a name is clamped to maxNameBytes on encode and refused past it on decode', () => {
        const bytes = encodeCommand({ kind: K.renameCompany, name: '🚂'.repeat(30) })
        const decoded = decodeCommand(bytes) as { name: string }
        expect(new TextEncoder().encode(decoded.name).length).toBeLessThanOrEqual(RT_CATALOG.caps.maxNameBytes)
        const long = new Uint8Array([K.renameCompany, 33, ...new TextEncoder().encode('x'.repeat(33))])
        expect(decodeCommand(long)).toBeNull()
    })

    it('truncated, padded and unknown-kind input decodes to null', () => {
        for (const command of VARIANTS) {
            const bytes = encodeCommand(command)
            for (let n = 0; n < bytes.length; n++) expect(decodeCommand(bytes.subarray(0, n))).toBeNull()
            expect(decodeCommand(new Uint8Array([...bytes, 0]))).toBeNull()
        }
        for (let kind = Object.keys(K).length; kind < 256; kind++) expect(decodeCommand(new Uint8Array([kind, 0, 0, 0, 0, 0]))).toBeNull()
    })

    it('refuses out-of-range fields: tiles past the map, long lines, wide areas, 255 wagons', () => {
        const tile = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]
        expect(decodeCommand(new Uint8Array([K.demolish, ...tile(64 * 64)]), 64)).toBeNull()
        expect(decodeCommand(new Uint8Array([K.demolish, ...tile(64 * 64 - 1)]), 64)).not.toBeNull()
        expect(decodeCommand(new Uint8Array([K.demolish, ...tile(256 * 256)]))).toBeNull()
        expect(decodeCommand(new Uint8Array([K.buildRail, ...tile(5), 6]))).toBeNull()
        expect(decodeCommand(new Uint8Array([K.buildRailLine, ...tile(5), ...tile(9), 6]))).toBeNull()
        // with the side known: a straight line off its row, and one 257 tiles long; without it the shape is applyCommand's
        expect(decodeCommand(new Uint8Array([K.buildRoadLine, ...tile(0), ...tile(256 + 1)]), 256)).toBeNull()
        expect(decodeCommand(new Uint8Array([K.buildRoadLine, ...tile(0), ...tile(256 + 1)]))).not.toBeNull()
        expect(decodeCommand(new Uint8Array([K.buildRailLine, ...tile(0), ...tile(255 * 256 + 2), 9]), 256)).toBeNull()
        expect(decodeCommand(new Uint8Array([K.demolishArea, ...tile(0), ...tile(16 * 64 + 15)]), 64)).toBeNull()
        expect(decodeCommand(new Uint8Array([K.demolishArea, ...tile(0), ...tile(15 * 64 + 15)]), 64)).not.toBeNull()
        expect(decodeCommand(new Uint8Array([K.buyVehicle, ...tile(5), ENGINE, 255, ...new Array(255).fill(0)]))).toBeNull()
        expect(decodeCommand(new Uint8Array([K.startStop, 1, 0, 2]))).toBeNull()
        expect(decodeCommand(new Uint8Array([K.setOrders, 1, 0, RT_CATALOG.caps.maxOrders + 1]))).toBeNull()
        expect(decodeCommand(new Uint8Array([K.setOrders, 1, 0, 1, 0, ...tile(5), 8]))).toBeNull()
        expect(decodeCommand(new Uint8Array([K.buildRoad, ...tile(5), 0]))).toBeNull()
        expect(decodeCommand(new Uint8Array([K.buildRoadStop, ...tile(5), 0]))).toBeNull()
        expect(decodeCommand(new Uint8Array([K.demolish, 0, 0, 0, 0]), 100)).toBeNull()
    })

    it('encoding a command the decoder would refuse throws RangeError', () => {
        expect(() => encodeCommand({ kind: K.buildRail, tile: 5, piece: 6 })).toThrow(RangeError)
        expect(() => encodeCommand({ kind: K.buildRail, tile: -1, piece: 0 })).toThrow(RangeError)
        expect(() => encodeCommand({ kind: 99 } as unknown as RtCommand)).toThrow(RangeError)
    })

    it('1000 random byte arrays decode to null or a command that re-encodes to the same bytes, never throwing', () => {
        const rng = new SeededRandom(4242)
        let decoded = 0
        for (let k = 0; k < 1000; k++) {
            const bytes = new Uint8Array(rng.randomInt(0, 24))
            for (let i = 0; i < bytes.length; i++) bytes[i] = rng.randomInt(0, 255)
            // a valid kind more often, so the field checks are reached
            if (bytes.length > 0 && rng.randomRatio(3, 4)) bytes[0] = rng.randomInt(0, 22)
            const command = decodeCommand(bytes)
            if (command === null) continue
            decoded++
            expect(encodeCommand(command)).toEqual(bytes)
        }
        expect(decoded).toBeGreaterThan(0)
    })
})
