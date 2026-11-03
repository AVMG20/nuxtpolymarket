import { describe, expect, it } from 'vitest'
import { RtWriter } from '#shared/utils/rail-tycoon/bytes'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { applyCommand, RtCommandKind, type RtCommand } from '#shared/utils/rail-tycoon/commands'
import {
    RT_INSPECTOR_MONTH_TICKS,
    rtInspectCrossings,
    rtIsForeignCrossing,
    rtPeopleAboard,
    rtViolationAt,
    rtWreckDays
} from '#shared/utils/rail-tycoon/inspector'
import { RtMap, RtTileKind } from '#shared/utils/rail-tycoon/map'
import { decodeWorld, encodeWorld } from '#shared/utils/rail-tycoon/save'
import { RT_ROAD_Y, RtTrack } from '#shared/utils/rail-tycoon/track'
import { RT_NONE, RT_OWNER_NONE, RtVehicleKind, RtVehicleState, type RtVehicle } from '#shared/utils/rail-tycoon/types'
import { RtWorld, rtStartDate } from '#shared/utils/rail-tycoon/world'

const SIDE = 64
const ROW = 10
const CROSS_X = 20
const EXPRESS = RT_CATALOG.vehicles.models.expressEngine.index
const COACH = RT_CATALOG.vehicles.models.passengerCoach.index
const BUS = RT_CATALOG.vehicles.models.townBus.index
const TILE = RT_CATALOG.movement.subTileUnits
const RULES = RT_CATALOG.inspector

/** A flat world with three companies: 0 lays the railway, 1 the road, 2 stands by. */
function newWorld(rngState = 777): RtWorld {
    const world = new RtWorld({
        settings: { side: SIDE, maxCompanies: 8, sharing: false }, map: new RtMap(SIDE), rngState, tick: 0,
        date: rtStartDate(), pathfinderCursor: 0, companies: [], towns: [], industries: [], stations: [], vehicles: []
    })
    world.addCompany('Rail Co')
    world.addCompany('Road Co')
    world.addCompany('Bystander')
    return world
}

function must(world: RtWorld, company: number, command: RtCommand): number | undefined {
    const result = applyCommand(world, company, command, true)
    if (!result.ok) throw new Error(`command ${command.kind} refused (${result.error})`)
    return result.id
}

function railRow(world: RtWorld, company: number, x0: number, x1: number): void {
    for (let x = x0; x <= x1; x++) must(world, company, { kind: RtCommandKind.buildRail, tile: world.map.idx(x, ROW), piece: RtTrack.x })
}

function roadColumn(world: RtWorld, company: number): void {
    for (let y = ROW - 2; y <= ROW + 2; y++) must(world, company, { kind: RtCommandKind.buildRoad, tile: world.map.idx(CROSS_X, y), bits: RT_ROAD_Y })
}

type Layout = 'roadOverRail' | 'railOverRoad' | 'townRoad' | 'own'

/** Company 0's line along row ROW from x 6 to 60, crossed by a road at CROSS_X built in the given way. */
function crossingWorld(layout: Layout, rngState = 777): { world: RtWorld, crossing: number } {
    const world = newWorld(rngState)
    const map = world.map
    const crossing = map.idx(CROSS_X, ROW)
    if (layout === 'roadOverRail') {
        railRow(world, 0, 6, 60)
        must(world, 1, { kind: RtCommandKind.buildRoad, tile: crossing, bits: RT_ROAD_Y })
    } else if (layout === 'railOverRoad') {
        roadColumn(world, 1)
        railRow(world, 0, 6, 60)
    } else if (layout === 'townRoad') {
        for (let y = ROW - 2; y <= ROW + 2; y++) map.setTile(map.idx(CROSS_X, y), RtTileKind.road, RT_OWNER_NONE, RT_ROAD_Y)
        railRow(world, 0, 6, 60)
    } else {
        roadColumn(world, 0)
        railRow(world, 0, 6, 60)
    }
    return { world, crossing }
}

/** An express with two coaches bought at a depot west of the line, started, with passengers aboard. */
function startTrain(world: RtWorld, passengers = 50): RtVehicle {
    const depot = world.map.idx(5, ROW)
    if (world.map.kind[depot] !== RtTileKind.depot) must(world, 0, { kind: RtCommandKind.buildDepot, tile: depot, vehicleKind: RtVehicleKind.rail, facing: 2 })
    const train = world.vehicle(must(world, 0, { kind: RtCommandKind.buyVehicle, depot, model: EXPRESS, wagons: [COACH, COACH] })!)!
    must(world, 0, { kind: RtCommandKind.startStop, vehicle: train.id, stopped: false })
    if (passengers > 0) train.cargo.push({ cargo: 0, count: passengers, sourceTile: depot, sourceStation: RT_NONE, transitPeriods: 0, feederShare: 0 })
    return train
}

/** A stopped bus of `owner` standing on the crossing, as if it had stalled there. */
/** A bus standing on `tile`: broken down there (an accident), or stopped there by its owner. */
function parkCar(world: RtWorld, owner: number, tile: number, passengers: number, how: 'brokenDown' | 'stopped' = 'brokenDown'): RtVehicle {
    const depot = world.map.idx(30 + owner * 3, 30)
    must(world, owner, { kind: RtCommandKind.buildDepot, tile: depot, vehicleKind: RtVehicleKind.road, facing: 0 })
    const car = world.vehicle(must(world, owner, { kind: RtCommandKind.buyVehicle, depot, model: BUS, wagons: [] })!)!
    world.occupied.leaveDepot(car.id, depot)
    car.state = RtVehicleState.driving
    car.stopped = how === 'stopped'
    if (how === 'brokenDown') car.breakdownTicks = 100_000
    car.tiles = [tile]
    car.pieces = [1]
    car.direction = 1
    car.progress = TILE / 2
    car.speed = 0
    world.occupied.holdRoad(car.id, tile, 1)
    if (passengers > 0) car.cargo.push({ cargo: 0, count: passengers, sourceTile: tile, sourceStation: RT_NONE, transitPeriods: 0, feederShare: 0 })
    return car
}

function fines(world: RtWorld): number[] {
    return world.companyList().map(company => company.financeThisYear.fines)
}

/** Steps until the car is crashed; returns each company's fines change over the crash tick. */
function runToCrash(world: RtWorld, car: RtVehicle, limit = 4000): number[] {
    for (let t = 0; t < limit; t++) {
        const before = fines(world)
        world.step()
        if (car.state === RtVehicleState.crashed) return fines(world).map((value, k) => value - before[k]!)
        // nothing is charged on a tick without a crash (the run ends well before the first month end)
        expect(fines(world)).toEqual(before)
    }
    throw new Error('the train never reached the car')
}

/** What one accident costs its causer and pays the others, from the crashed vehicles' state. */
function expectedCharges(world: RtWorld, causer: number, tile: number, crashed: RtVehicle[]): number[] {
    const out = world.companyList().map(() => 0)
    for (const vehicle of crashed) {
        if (vehicle.owner !== causer && !vehicle.stopped) {
            out[causer]! -= vehicle.value
            out[vehicle.owner]! += vehicle.value
        }
        out[causer]! -= RULES.perPerson * rtPeopleAboard(vehicle) + RULES.cleanup
    }
    out[causer]! -= RULES.investigation
    const railOwner = world.map.owner[tile]!
    if (railOwner !== causer) {
        const delay = RULES.delayPerDay * Math.ceil(RT_CATALOG.vehicles.crashTicks / RT_CATALOG.time.dayTicks)
        out[causer]! -= delay
        out[railOwner]! += delay
    }
    return out
}

describe('rail tycoon crossing inspector: registration', () => {
    it('records a road over a rival railway against the road builder', () => {
        const { world, crossing } = crossingWorld('roadOverRail')
        expect(rtIsForeignCrossing(world.map, crossing)).toBe(true)
        expect(world.violations).toEqual([{ tile: crossing, causer: 1, since: 0 }])
    })

    it('records a railway over a rival road against the rail builder', () => {
        const { world, crossing } = crossingWorld('railOverRoad')
        expect(rtIsForeignCrossing(world.map, crossing)).toBe(true)
        expect(world.violations).toEqual([{ tile: crossing, causer: 0, since: 0 }])
    })

    it('records nothing for a crossing with a town road or within one company', () => {
        for (const layout of ['townRoad', 'own'] as const) {
            const { world, crossing } = crossingWorld(layout)
            expect(world.map.kind[crossing]).toBe(RtTileKind.rail)
            expect(rtIsForeignCrossing(world.map, crossing)).toBe(false)
            expect(world.violations).toEqual([])
        }
    })

    it('records nothing when the build is only validated', () => {
        const world = newWorld()
        railRow(world, 0, 6, 30)
        const crossing = world.map.idx(CROSS_X, ROW)
        const result = applyCommand(world, 1, { kind: RtCommandKind.buildRoad, tile: crossing, bits: RT_ROAD_Y }, false)
        expect(result.ok).toBe(true)
        expect(world.violations).toEqual([])
    })

    it('stamps the tick of the build', () => {
        const world = newWorld()
        railRow(world, 0, 6, 30)
        for (let t = 0; t < 500; t++) world.step()
        must(world, 1, { kind: RtCommandKind.buildRoad, tile: world.map.idx(CROSS_X, ROW), bits: RT_ROAD_Y })
        expect(world.violations[0]!.since).toBe(500)
    })
})

describe('rail tycoon crossing inspector: monthly fines', () => {
    it('keeps twin worlds in lockstep across month ends and actually fines the causer', () => {
        const a = crossingWorld('roadOverRail').world
        const b = crossingWorld('roadOverRail').world
        let monthEnds = 0
        let month = a.date.month
        while (monthEnds < 10) {
            a.step()
            b.step()
            if (a.date.month !== month) {
                month = a.date.month
                monthEnds++
                expect(b.hash()).toBe(a.hash())
            }
        }
        const fined = a.company(1)!.financeThisYear.fines
        expect(fined).toBeLessThan(0)
        expect(-fined % RULES.baseFine).toBe(0)
        // the victim and the bystander are never fined
        expect(a.company(0)!.financeThisYear.fines).toBe(0)
        expect(a.company(2)!.financeThisYear.fines).toBe(0)
    })

    it('visits with the catalog chance, drawn from the world RNG', () => {
        const { world } = crossingWorld('roadOverRail')
        let visits = 0
        for (let k = 0; k < 400; k++) if (rtInspectCrossings(world) > 0) visits++
        const expected = 400 * RULES.visitNumerator / RULES.visitDenominator
        expect(visits).toBeGreaterThan(expected * 0.6)
        expect(visits).toBeLessThan(expected * 1.4)
    })

    it('fines more the longer the crossing has stood, at least one month', () => {
        const { world } = crossingWorld('roadOverRail')
        const fineAt = (ticks: number): number => {
            world.tick = ticks
            for (let k = 0; k < 200; k++) {
                const fine = rtInspectCrossings(world)
                if (fine > 0) return fine
            }
            throw new Error('the inspector never came')
        }
        expect(fineAt(10)).toBe(RULES.baseFine)
        expect(fineAt(RT_INSPECTOR_MONTH_TICKS - 1)).toBe(RULES.baseFine)
        expect(fineAt(RT_INSPECTOR_MONTH_TICKS * 3)).toBe(RULES.baseFine * 3)
        expect(fineAt(RT_INSPECTOR_MONTH_TICKS * 7 + 5)).toBe(RULES.baseFine * 7)
        const before = world.company(1)!.money
        const fine = fineAt(RT_INSPECTOR_MONTH_TICKS * 2)
        expect(world.company(1)!.money).toBe(before - fine)
    })

    it('stops fining once the crossing is removed', () => {
        const { world, crossing } = crossingWorld('roadOverRail')
        must(world, 1, { kind: RtCommandKind.removeRoad, tile: crossing, bits: RT_ROAD_Y })
        expect(rtIsForeignCrossing(world.map, crossing)).toBe(false)
        expect(world.violations).toEqual([])
        for (let k = 0; k < 50; k++) expect(rtInspectCrossings(world)).toBe(0)
        expect(world.company(1)!.financeThisYear.fines).toBe(0)
    })

    it('drops an entry whose crossing went another way at the next inspection, drawing nothing', () => {
        const { world, crossing } = crossingWorld('roadOverRail')
        // the rail owner's reset leaves the crossing as Road Co's plain road
        world.resetCompany(0)
        expect(rtIsForeignCrossing(world.map, crossing)).toBe(false)
        expect(world.violations).toHaveLength(1)
        const rng = world.rng.state
        expect(rtInspectCrossings(world)).toBe(0)
        expect(world.violations).toEqual([])
        expect(world.rng.state).toBe(rng)
    })

    it('drops the causer\'s entries on its bankruptcy reset', () => {
        const { world } = crossingWorld('railOverRoad')
        expect(world.violations).toHaveLength(1)
        world.resetCompany(0)
        expect(world.violations).toEqual([])
    })
})

describe('rail tycoon crossing inspector: accidents', () => {
    it('charges a road-over-rail causer for every vehicle, the investigation and the delay, and pays the victims', () => {
        const { world, crossing } = crossingWorld('roadOverRail')
        const car = parkCar(world, 2, crossing, 12)
        const train = startTrain(world)
        const delta = runToCrash(world, car)
        const crashed = [car, ...(train.state === RtVehicleState.crashed ? [train] : [])]
        expect(delta).toEqual(expectedCharges(world, 1, crossing, crashed))
        // the bus's owner gets its value back, the rail owner the delay
        expect(delta[2]).toBe(car.value)
        expect(delta[0]).toBeGreaterThanOrEqual(RULES.delayPerDay * rtWreckDays())
        expect(delta[1]).toBeLessThan(-(RULES.investigation + RULES.cleanup + 13 * RULES.perPerson))
    })

    it('pays nothing back for a bus its owner stopped on the crossing, and still fines the causer', () => {
        const { world, crossing } = crossingWorld('roadOverRail')
        const car = parkCar(world, 2, crossing, 0, 'stopped')
        const train = startTrain(world)
        const delta = runToCrash(world, car)
        const crashed = [car, ...(train.state === RtVehicleState.crashed ? [train] : [])]
        expect(delta).toEqual(expectedCharges(world, 1, crossing, crashed))
        expect(delta[2]).toBe(0)
    })

    it('charges a rail-over-road causer without paying itself for its own train or line', () => {
        const { world, crossing } = crossingWorld('railOverRoad')
        const car = parkCar(world, 1, crossing, 0)
        const train = startTrain(world)
        const delta = runToCrash(world, car)
        const crashed = [car, ...(train.state === RtVehicleState.crashed ? [train] : [])]
        expect(delta).toEqual(expectedCharges(world, 0, crossing, crashed))
        expect(delta[1]).toBe(car.value)
        expect(delta[2]).toBe(0)
    })

    it('charges nobody for an accident on a town-road crossing, and the train never derails there', () => {
        const { world, crossing } = crossingWorld('townRoad')
        const car = parkCar(world, 2, crossing, 5)
        const train = startTrain(world)
        const delta = runToCrash(world, car)
        expect(delta).toEqual([0, 0, 0])
        expect(train.state).not.toBe(RtVehicleState.crashed)
        expect(fines(world)).toEqual([0, 0, 0])
    })

    it('derails the train by the world RNG: twin worlds agree, and both outcomes happen over seeds', () => {
        const outcomes = new Set<boolean>()
        for (let seed = 1; seed <= 24; seed++) {
            const runs = [0, 1].map(() => {
                const { world, crossing } = crossingWorld('roadOverRail', seed)
                const car = parkCar(world, 2, crossing, 0)
                const train = startTrain(world)
                runToCrash(world, car)
                return { world, train }
            })
            expect(runs[1]!.world.hash()).toBe(runs[0]!.world.hash())
            outcomes.add(runs[0]!.train.state === RtVehicleState.crashed)
        }
        expect(outcomes).toEqual(new Set([true, false]))
    })
})

describe('rail tycoon crossing inspector: trains slow for a foreign crossing', () => {
    /**
     * The train's top speed with its head on the crossing (the speed it entered with was set the tick
     * before, its head next door), whether it was slowed in the tile before, and whether it got past.
     */
    function crossingSpeeds(layout: Layout): { top: number, approach: number, past: boolean } {
        const { world } = crossingWorld(layout)
        const train = startTrain(world, 0)
        let top = 0
        let approach = 0
        let past = false
        let ticksBefore = 0
        for (let t = 0; t < 3000 && !past; t++) {
            world.step()
            const x = train.tiles[0]! % SIDE
            if (train.state !== RtVehicleState.driving) continue
            if (x === CROSS_X) top = Math.max(top, train.speed)
            // from the second tick in the tile before: the first tick's speed was set a tile further back
            if (x === CROSS_X - 1 && ++ticksBefore > 1) approach = Math.max(approach, train.speed)
            if (x >= CROSS_X + 3) past = true
        }
        return { top, approach, past }
    }

    it('caps the train at crossingSpeed on and before a foreign crossing, and it drives across', () => {
        const foreign = crossingSpeeds('roadOverRail')
        expect(foreign.past).toBe(true)
        expect(foreign.top).toBeGreaterThan(0)
        expect(foreign.top).toBeLessThanOrEqual(RULES.crossingSpeed)
        expect(foreign.approach).toBeGreaterThan(0)
        expect(foreign.approach).toBeLessThanOrEqual(RULES.crossingSpeed)
        const own = crossingSpeeds('own')
        expect(own.past).toBe(true)
        expect(own.top).toBeGreaterThan(RULES.crossingSpeed)
        expect(own.approach).toBeGreaterThan(RULES.crossingSpeed)
    })
})

describe('rail tycoon crossing inspector: save', () => {
    it('keeps the violations and the hash through a save round trip, and the hash covers them', () => {
        const { world } = crossingWorld('railOverRoad')
        for (let t = 0; t < 300; t++) world.step()
        must(world, 1, { kind: RtCommandKind.buildRoad, tile: world.map.idx(40, ROW), bits: RT_ROAD_Y })
        expect(world.violations).toHaveLength(2)
        const copy = decodeWorld(encodeWorld(world))!
        expect(copy).not.toBeNull()
        expect(copy.violations).toEqual(world.violations)
        expect(copy.hash()).toBe(world.hash())
        expect(rtViolationAt(copy, world.map.idx(40, ROW))).toEqual({ tile: world.map.idx(40, ROW), causer: 1, since: 300 })
        copy.violations.pop()
        expect(copy.hash()).not.toBe(world.hash())
    })

    /** A save of `world` with its (empty) violation list replaced by `entries`, written raw. */
    function withViolations(world: RtWorld, count: number, entries: number[][]): Uint8Array | null {
        expect(world.violations).toEqual([])
        const bytes = encodeWorld(world)
        const tail = new RtWriter()
        tail.u32(world.rng.state)
        tail.varint(world.tick)
        tail.u8(world.date.day)
        tail.u8(world.date.month)
        tail.varint(world.date.year)
        tail.varint(world.pathfinderCursor)
        const scalars = tail.finish()
        const at = bytes.length - scalars.length - 1
        expect(bytes[at]).toBe(0)
        const list = new RtWriter()
        list.varint(count)
        for (const entry of entries) for (const value of entry) list.varint(value)
        const middle = list.finish()
        const out = new Uint8Array(at + middle.length + scalars.length)
        out.set(bytes.subarray(0, at))
        out.set(middle, at)
        out.set(scalars, at + middle.length)
        return out
    }

    it('refuses a hostile violation list', () => {
        const world = newWorld()
        for (let t = 0; t < 100; t++) world.step()
        const tiles = SIDE * SIDE
        // the splice itself is sound: a good list decodes
        const good = decodeWorld(withViolations(world, 2, [[5, 0, 10], [9, 2, 100]])!)
        expect(good?.violations).toEqual([{ tile: 5, causer: 0, since: 10 }, { tile: 9, causer: 2, since: 100 }])
        const hostile: [string, number, number[][]][] = [
            ['a tile off the map', 1, [[tiles, 0, 0]]],
            ['a causer that is no company', 1, [[5, 3, 0]]],
            ['a causer past the company cap', 1, [[5, 8, 0]]],
            ['a repeated tile', 2, [[5, 0, 0], [5, 1, 0]]],
            ['a date after the tick', 1, [[5, 0, 101]]],
            ['a count over the bound', RULES.maxViolations + 1, [[5, 0, 0]]]
        ]
        for (const [what, count, entries] of hostile) {
            expect(decodeWorld(withViolations(world, count, entries)!), what).toBeNull()
        }
    })
})
