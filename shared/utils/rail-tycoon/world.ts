/**
 * RtWorld: the complete, deterministic Rail Tycoon game state in one object. Every peer holds
 * one and advances it identically; save.ts saves exactly its saved state and hash() hashes the same.
 * Entities live in dense arrays indexed by id, null where an id is free, so lookups are direct and
 * iteration in ascending id is a plain loop. A new entity takes the lowest free id of its kind, as
 * the original's pools allocate, so there is no next-id counter to save.
 * There is no paused flag: pausing is room state.
 */

import { RT_CATALOG } from './catalog'
import { rtCleanCompanyName, rtDefaultCompanyName, rtNameSkeleton } from './company-names'
import { rtClearCompanyAssets } from './bankruptcy'
import { bookMoney, monthlyFinance, rtEmptyFinance } from './economy'
import { RT_MAP_SIDES, RtMap } from './map'
import { SeededRandom } from '../random'
import { rtWorldHash } from './world-hash'
import { RtOccupiedRegistry } from './occupied'
import {
    RT_NONE,
    RtVehicleKind,
    type RtCompany,
    type RtCrossingViolation,
    type RtDate,
    type RtIndustry,
    type RtStation,
    type RtTown,
    type RtVehicle,
    type RtWorldEvents,
    type RtWorldScalars,
    type RtWorldSettings
} from './types'
import { agePackets } from './cargo'
import { rtDepotTiles } from './depots'
import { rtDropViolationsOf, rtInspectCrossings, rtProsecuteAccidents, rtUncrashedIds } from './inspector'
import { rtRecountInfrastructure } from './infrastructure'
import { rtLoadHooks } from './loading'
import { findRailRoute, findRoadRoute, RtRouteOutcome } from './pathfinder'
import { stepRoadVehicle } from './road-vehicle'
import { rtTickTileEntities } from './tile-entities'
import { rtTownMonthly, townTick } from './towns'
import { rtRemoveTrain, stepTrain } from './train'
import { rtIsVehicleDayTick, rtVehicleDay } from './vehicles'
import type { RtWorldLayout } from './worldgen'

/** Days in a month (0 = January) of a year: February gains one in a Gregorian leap year, as the original's calendar. */
export function rtDaysInMonth(month: number, year: number): number {
    const time = RT_CATALOG.time
    const days = time.daysPerMonth[month]!
    const leap = time.leapYears && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return month === 1 && leap ? days + 1 : days
}

/* ------------------------------------------------------------------------------------------
 * Entity id helpers
 * ---------------------------------------------------------------------------------------- */

/** The lowest free id in an id-indexed list below cap, or RT_NONE when every id is taken. */
export function rtLowestFreeId(list: readonly (unknown | null)[], cap: number): number {
    const end = Math.min(list.length, cap)
    for (let id = 0; id < end; id++) if (list[id] === null || list[id] === undefined) return id
    return list.length < cap ? list.length : RT_NONE
}

/** The live entities of an id-indexed list, ascending id. */
function live<T>(list: readonly (T | null)[]): T[] {
    const out: T[] = []
    for (const entity of list) if (entity) out.push(entity)
    return out
}

/** Builds an id-indexed list from entities in any order, refusing a bad or repeated id. */
function indexById<T extends { id: number }>(entities: readonly T[], cap: number, what: string): (T | null)[] {
    const list: (T | null)[] = []
    for (const entity of entities) {
        const id = entity.id
        if (!Number.isInteger(id) || id < 0 || id >= cap) throw new RangeError(`${what} id out of range: ${id}`)
        while (list.length <= id) list.push(null)
        if (list[id]) throw new RangeError(`duplicate ${what} id: ${id}`)
        list[id] = entity
    }
    return list
}

/** Puts an entity at its id in an id-indexed list, growing it with free slots as needed. */
function placeAt<T extends { id: number }>(list: (T | null)[], entity: T, cap: number, what: string): void {
    const id = entity.id
    if (!Number.isInteger(id) || id < 0 || id >= cap) throw new RangeError(`${what} id out of range: ${id}`)
    while (list.length <= id) list.push(null)
    if (list[id]) throw new RangeError(`${what} id already taken: ${id}`)
    list[id] = entity
}

/** Frees an id; trailing free slots are trimmed so the list's length stays one past the highest id. */
function removeAt<T>(list: (T | null)[], id: number): T | null {
    if (!Number.isInteger(id) || id < 0 || id >= list.length) return null
    const entity = list[id] ?? null
    list[id] = null
    while (list.length > 0 && list[list.length - 1] === null) list.pop()
    return entity
}

/* ------------------------------------------------------------------------------------------
 * Companies
 * ---------------------------------------------------------------------------------------- */

/**
 * A company as it starts (and restarts after a bankruptcy reset): start money, all of it the
 * start loan, as the original; no finances, infrastructure or history yet.
 */
export function rtNewCompany(id: number, name: string, colour: number, foundedTick: number): RtCompany {
    const economy = RT_CATALOG.economy
    return {
        id,
        name,
        colour,
        money: economy.startMoney,
        loan: economy.startLoan,
        bankruptMonths: 0,
        foundedTick,
        infrastructure: { railPieces: 0, roadPieces: 0, signals: 0, stationTiles: 0, depots: 0 },
        financeThisYear: rtEmptyFinance(),
        financeLastYear: rtEmptyFinance(),
        monthIncome: 0,
        monthExpenses: 0,
        monthlyIncome: []
    }
}

/* ------------------------------------------------------------------------------------------
 * The world
 * ---------------------------------------------------------------------------------------- */

/** Everything a world is built from: create(layout, settings) for a new world, decodeWorld for a saved one. */
export interface RtWorldInit {
    settings: RtWorldSettings
    map: RtMap
    rngState: number
    tick: number
    date: RtDate
    pathfinderCursor: number
    companies: readonly RtCompany[]
    towns: readonly RtTown[]
    industries: readonly RtIndustry[]
    stations: readonly RtStation[]
    vehicles: readonly RtVehicle[]
    /** Foreign level crossings the inspector watches, in registration order; none when omitted. */
    violations?: readonly RtCrossingViolation[]
}

/** Copies and checks a violation list: tiles on the map and unique, causers below the company cap, since at most the tick. */
function checkViolations(list: readonly RtCrossingViolation[], tileCount: number, maxCompanies: number, tick: number): RtCrossingViolation[] {
    if (list.length > RT_CATALOG.inspector.maxViolations) throw new RangeError(`too many violations: ${list.length}`)
    const seen = new Set<number>()
    const out: RtCrossingViolation[] = []
    for (const entry of list) {
        const { tile, causer, since } = entry
        if (!Number.isInteger(tile) || tile < 0 || tile >= tileCount) throw new RangeError(`violation tile off the map: ${tile}`)
        if (seen.has(tile)) throw new RangeError(`duplicate violation tile: ${tile}`)
        if (!Number.isInteger(causer) || causer < 0 || causer >= maxCompanies) throw new RangeError(`bad violation causer: ${causer}`)
        if (!Number.isSafeInteger(since) || since < 0 || since > tick) throw new RangeError(`bad violation since: ${since}`)
        seen.add(tile)
        out.push({ tile, causer, since })
    }
    return out
}

/** 1 January of the catalog's start year. */
export function rtStartDate(): RtDate {
    return { day: 1, month: 0, year: RT_CATALOG.time.startYear }
}

/**
 * The simulation RNG of a new world, kept apart from the generator's sequence: generateWorld
 * consumed an SeededRandom seeded with the same u32, so the world mixes the seed before seeding its own.
 */
export function rtWorldRngSeed(layoutSeed: number): number {
    return (Math.imul(layoutSeed ^ 0x5bd1e995, 0x9e3779b1) ^ 0x2545f491) >>> 0
}

function checkSettings(settings: RtWorldSettings): void {
    if (!RT_MAP_SIDES.includes(settings.side)) throw new RangeError(`map side must be 64, 128 or 256: ${settings.side}`)
    const max = settings.maxCompanies
    if (!Number.isInteger(max) || max < 2 || max > RT_CATALOG.caps.maxCompanies) {
        throw new RangeError(`maxCompanies must be 2 to ${RT_CATALOG.caps.maxCompanies}: ${max}`)
    }
    if (typeof settings.sharing !== 'boolean') throw new TypeError('sharing must be a boolean')
}

function checkDate(date: RtDate): void {
    const days = RT_CATALOG.time.daysPerMonth
    if (!Number.isInteger(date.month) || date.month < 0 || date.month >= days.length) throw new RangeError(`bad month: ${date.month}`)
    // the 29th of February is checked by the calendar step; here only the static bound
    const most = date.month === 1 ? 29 : days[date.month]!
    if (!Number.isInteger(date.day) || date.day < 1 || date.day > most) throw new RangeError(`bad day: ${date.day}`)
    if (!Number.isInteger(date.year) || date.year < 0) throw new RangeError(`bad year: ${date.year}`)
}

export class RtWorld {
    /** Map side, company cap and sharing; set at creation, saved, never changed. */
    readonly settings: Readonly<RtWorldSettings>
    readonly map: RtMap
    /** The one simulation RNG; its state is saved and hashed. */
    readonly rng: SeededRandom
    /** Ticks since the world was created. */
    tick: number
    /** The calendar; step() advances it every RT_CATALOG time dayTicks ticks. */
    date: RtDate
    /** Index of the next vehicle the round-robin pathfinder budget serves (saved). */
    pathfinderCursor: number
    /** Derived: pathfinder nodes left this tick, refilled to pathNodesPerTick at the start of every step. */
    pathNodesLeft: number
    /**
     * Not state: the per-tick search budget, RT_CATALOG's on every peer. Only a test lowers it, to make
     * searches scarce; a world in play must never change it, or peers would split.
     */
    pathNodesPerTick: number = RT_CATALOG.pathfinder.pathNodesPerTick

    /** Companies by id, null where free; at most settings.maxCompanies. */
    readonly companies: (RtCompany | null)[]
    readonly towns: (RtTown | null)[]
    readonly industries: (RtIndustry | null)[]
    readonly stations: (RtStation | null)[]
    readonly vehicles: (RtVehicle | null)[]
    /** Foreign level crossings and their causers (inspector.ts), in registration order; saved and hashed. */
    readonly violations: RtCrossingViolation[]

    /** Derived: who stands on which piece, depot and lane; rebuilt on decode. */
    readonly occupied: RtOccupiedRegistry
    /** Derived: tiles changed since the last drain, empty at a tick boundary after step(). */
    readonly dirtyTiles = new Set<number>()
    /** Not state: a client's listener for payments and vehicle list changes; null on the server. */
    events: RtWorldEvents | null = null

    // The tile-to-stations index and the path-signal memo are derived state too, held in WeakMaps
    // by stations.ts (keyed by the station list) and signals.ts (keyed by the map), not on the world.

    /**
     * Builds a world from complete state. The map and entity objects are taken over, not copied.
     * The occupied registry starts empty: a world with vehicles on track (decode) rebuilds it
     * with occupied.rebuild(world.vehicles, trackdirPiece), and infrastructure counts likewise, since
     * both need track.ts encodings this file does not import.
     */
    constructor(init: RtWorldInit) {
        const settings = { side: init.settings.side, maxCompanies: init.settings.maxCompanies, sharing: init.settings.sharing }
        checkSettings(settings)
        if (init.map.side !== settings.side) throw new RangeError(`map side ${init.map.side} differs from settings side ${settings.side}`)
        if (!Number.isSafeInteger(init.tick) || init.tick < 0) throw new RangeError(`bad tick: ${init.tick}`)
        if (!Number.isInteger(init.pathfinderCursor) || init.pathfinderCursor < 0) throw new RangeError(`bad pathfinder cursor: ${init.pathfinderCursor}`)
        checkDate(init.date)
        const caps = RT_CATALOG.caps
        this.settings = Object.freeze(settings)
        this.map = init.map
        this.rng = new SeededRandom(init.rngState)
        this.tick = init.tick
        this.date = { day: init.date.day, month: init.date.month, year: init.date.year }
        this.pathfinderCursor = init.pathfinderCursor
        this.pathNodesLeft = RT_CATALOG.pathfinder.pathNodesPerTick
        this.companies = indexById(init.companies, settings.maxCompanies, 'company')
        this.towns = indexById(init.towns, caps.maxTowns, 'town')
        this.industries = indexById(init.industries, caps.maxIndustries, 'industry')
        this.stations = indexById(init.stations, caps.maxStations, 'station')
        this.vehicles = indexById(init.vehicles, caps.maxVehicles, 'vehicle')
        this.violations = checkViolations(init.violations ?? [], init.map.tileCount, settings.maxCompanies, init.tick)
        this.occupied = new RtOccupiedRegistry(init.map.tileCount)
    }

    /**
     * A new world from generateWorld's layout: tick 0 on 1 January of the start year, no companies,
     * stations or vehicles, the layout's towns and industries under their ids. The layout is taken
     * over, not copied. settings.side must equal the layout's map side.
     */
    static create(layout: RtWorldLayout, settings: RtWorldSettings): RtWorld {
        return RtWorld.empty(settings, {
            map: layout.map,
            rngState: rtWorldRngSeed(layout.seed),
            towns: layout.towns,
            industries: layout.industries
        })
    }

    /**
     * A world at tick 0 on the start date with nothing in it but `parts`: by default an empty map of
     * the settings' side, rng state 1 and no companies, towns, industries, stations or vehicles.
     */
    static empty(settings: RtWorldSettings, parts: Partial<Omit<RtWorldInit, 'settings'>> = {}): RtWorld {
        return new RtWorld({
            settings,
            map: new RtMap(settings.side),
            rngState: 1,
            tick: 0,
            date: rtStartDate(),
            pathfinderCursor: 0,
            companies: [],
            towns: [],
            industries: [],
            stations: [],
            vehicles: [],
            violations: [],
            ...parts
        })
    }

    /** The saved world-level scalars (save.ts writes them, hash() hashes them). */
    scalars(): RtWorldScalars {
        return {
            tick: this.tick,
            date: { day: this.date.day, month: this.date.month, year: this.date.year },
            rngState: this.rng.state,
            pathfinderCursor: this.pathfinderCursor
        }
    }

    /** The desync hash over exactly the saved state (world-hash.ts); call it at a tick boundary. */
    hash(): number {
        return rtWorldHash(this)
    }

    /* ---- lookups by id; undefined for a free or out-of-range id ---- */

    company(id: number): RtCompany | undefined {
        return this.companies[id] ?? undefined
    }

    town(id: number): RtTown | undefined {
        return this.towns[id] ?? undefined
    }

    industry(id: number): RtIndustry | undefined {
        return this.industries[id] ?? undefined
    }

    station(id: number): RtStation | undefined {
        return this.stations[id] ?? undefined
    }

    vehicle(id: number): RtVehicle | undefined {
        return this.vehicles[id] ?? undefined
    }

    /* ---- iteration, ascending id ---- */

    companyList(): RtCompany[] {
        return live(this.companies)
    }

    townList(): RtTown[] {
        return live(this.towns)
    }

    industryList(): RtIndustry[] {
        return live(this.industries)
    }

    stationList(): RtStation[] {
        return live(this.stations)
    }

    vehicleList(): RtVehicle[] {
        return live(this.vehicles)
    }

    /* ---- id allocation: the lowest free id of the kind, RT_NONE at the cap ---- */

    freeCompanyId(): number {
        return rtLowestFreeId(this.companies, this.settings.maxCompanies)
    }

    freeTownId(): number {
        return rtLowestFreeId(this.towns, RT_CATALOG.caps.maxTowns)
    }

    freeIndustryId(): number {
        return rtLowestFreeId(this.industries, RT_CATALOG.caps.maxIndustries)
    }

    freeStationId(): number {
        return rtLowestFreeId(this.stations, RT_CATALOG.caps.maxStations)
    }

    freeVehicleId(): number {
        return rtLowestFreeId(this.vehicles, RT_CATALOG.caps.maxVehicles)
    }

    /* ---- insertion and removal by id; the caller has taken the id from free*Id ---- */

    insertCompany(company: RtCompany): void {
        placeAt(this.companies, company, this.settings.maxCompanies, 'company')
    }

    /** Whether a live company already uses that colour index. */
    colourInUse(colour: number): boolean {
        for (const company of this.companies) if (company && company.colour === colour) return true
        return false
    }

    /** The lowest colour index no company uses (there are more colours than the company cap). */
    firstUnusedColour(): number {
        const count = RT_CATALOG.companies.colours.length
        for (let colour = 0; colour < count; colour++) if (!this.colourInUse(colour)) return colour
        return 0
    }

    /**
     * A player joins as a new company under the lowest free id: start money, all of it the
     * start loan, as the original. The name is cleaned and clamped to maxNameBytes, with a
     * default when nothing is left. The preferred colour is used when it is a valid, unused index;
     * otherwise the company gets the first unused one, as the catalog decides (the original draws a
     * random unused colour; this one draws nothing, so joining never moves the RNG). Returns the new
     * id, or null when the world already has settings.maxCompanies companies. Never throws on bad
     * input; whether a player already has a company here is room state, not world state.
     */
    addCompany(name: unknown, colour?: unknown): number | null {
        const id = this.freeCompanyId()
        if (id === RT_NONE) return null
        const preferred = typeof colour === 'number' && Number.isInteger(colour)
            && colour >= 0 && colour < RT_CATALOG.companies.colours.length && !this.colourInUse(colour)
        const clean = rtCleanCompanyName(name)
        // a joining player's name that reads as another company's falls back to the default
        const looks = rtNameSkeleton(clean)
        const taken = this.companyList().some(other => rtNameSkeleton(other.name) === looks)
        const company = rtNewCompany(
            id,
            clean === '' || taken ? rtDefaultCompanyName(id) : clean,
            preferred ? colour : this.firstUnusedColour(),
            this.tick
        )
        this.insertCompany(company)
        return id
    }

    insertStation(station: RtStation): void {
        placeAt(this.stations, station, RT_CATALOG.caps.maxStations, 'station')
    }

    insertVehicle(vehicle: RtVehicle): void {
        placeAt(this.vehicles, vehicle, RT_CATALOG.caps.maxVehicles, 'vehicle')
        this.events?.vehicles()
    }

    /** Frees a station id; order and packet clean-up is the caller's. */
    removeStation(id: number): RtStation | null {
        return removeAt(this.stations, id)
    }

    /** Frees a vehicle id and drops its occupied holdings; reservations are the caller's. */
    removeVehicle(id: number): RtVehicle | null {
        const vehicle = removeAt(this.vehicles, id)
        if (vehicle) {
            this.occupied.releaseVehicle(id)
            this.events?.vehicles()
        }
        return vehicle
    }

    /**
     * The bankruptcy reset: everything the company built and ran comes off the world
     * (rtClearCompanyAssets), then it restarts with start money and loan and a cleared record, keeping
     * its id, name and colour. Returns false for an unknown id.
     */
    resetCompany(id: number): boolean {
        const company = this.company(id)
        if (!company) return false
        rtClearCompanyAssets(this, id)
        this.companies[id] = rtNewCompany(id, company.name, company.colour, this.tick)
        rtDropViolationsOf(this, id)
        rtRecountInfrastructure(this)
        return true
    }

    /* ---- the tick ---- */

    /**
     * Advances the world one tick, in the fixed order every peer follows: the date; every
     * vehicle in id order from the pathfinder cursor, its daily step (age, breakdown, service, running
     * cost booked as it accrues) before its move, a block it enters or leaves updated before the next
     * vehicle moves; accidents on foreign crossings charged to their causers
     * (inspector.ts); towns in id order; the tile entities (rtTickTileEntities: industries' production,
     * then stations' acceptance and ratings, each in id order);
     * cargo aboard ageing every packetAgeTicks; on a new month the towns' monthly update, the crossing
     * inspector's visits and each company's month end in id order, resetting a company that went bankrupt; on 1 January the
     * new-year roll of finances and vehicle profits. Commands for the tick are applied before
     * it is stepped (the room's and the client's job). Pausing is not stepping.
     */
    step(): void {
        this.tick++
        this.pathNodesLeft = this.pathNodesPerTick
        const closing = this.date.month
        const turn = this.tick % RT_CATALOG.time.dayTicks === 0 ? this.advanceDay() : 'day'

        const uncrashed = this.violations.length > 0 ? rtUncrashedIds(this) : null
        this.stepVehicles()
        if (uncrashed) rtProsecuteAccidents(this, uncrashed)
        const towns = this.townList()
        for (const town of towns) townTick(this, town, this.rng, this.tick)
        rtTickTileEntities(this, this.rng, this.tick)
        if (this.tick % RT_CATALOG.time.packetAgeTicks === 0) {
            for (const vehicle of this.vehicleList()) agePackets(vehicle.cargo)
        }

        if (turn === 'day') return
        for (const town of towns) rtTownMonthly(this, town, this.rng, this.tick)
        // upkeep is charged on a fresh count, so a count that drifted between month ends never costs anything
        rtRecountInfrastructure(this)
        rtInspectCrossings(this)
        for (const company of this.companyList()) {
            if (monthlyFinance(company, closing, 0, company.infrastructure) === 'reset') this.resetCompany(company.id)
        }
        if (turn !== 'year') return
        for (const company of this.companyList()) {
            company.financeLastYear = company.financeThisYear
            company.financeThisYear = rtEmptyFinance()
        }
        for (const vehicle of this.vehicleList()) {
            vehicle.profitLastYear = vehicle.profitThisYear
            vehicle.profitThisYear = 0
        }
    }

    /** Moves the date on a day; returns whether that began a month, a year, or only a day. */
    private advanceDay(): 'day' | 'month' | 'year' {
        const date = this.date
        date.day++
        if (date.day <= rtDaysInMonth(date.month, date.year)) return 'day'
        date.day = 1
        date.month++
        if (date.month < 12) return 'month'
        date.month = 0
        date.year++
        return 'year'
    }

    /**
     * Every vehicle once, in id order starting at the pathfinder cursor and wrapping. The cursor then
     * moves to the first vehicle that found this tick's search budget spent, so a vehicle starved of
     * searches goes first next tick and every search waits a bounded number of ticks.
     */
    private stepVehicles(): void {
        const list = this.vehicleList()
        if (list.length === 0) return
        let start = list.findIndex(vehicle => vehicle.id >= this.pathfinderCursor)
        if (start < 0) start = 0
        let starved = RT_NONE
        const context = { world: this, findServiceDepot: (vehicle: RtVehicle) => this.serviceDepotFor(vehicle) }
        for (let k = 0; k < list.length; k++) {
            const vehicle = list[(start + k) % list.length]!
            if (this.vehicles[vehicle.id] !== vehicle) continue
            const budget = this.pathNodesLeft
            if (rtIsVehicleDayTick(vehicle.id, this.tick)) {
                const day = rtVehicleDay(vehicle, this.rng, this.tick, context)
                const owner = this.company(vehicle.owner)
                if (owner && day.runningCost > 0) bookMoney(owner, 'runningCosts', -day.runningCost)
            }
            const moved = vehicle.kind === RtVehicleKind.rail ? stepTrain(this, vehicle, rtLoadHooks) : stepRoadVehicle(this, vehicle, rtLoadHooks)
            // starved: the budget was gone before its turn, or its own search ran it out unfinished (deferred)
            if (starved === RT_NONE && this.pathNodesLeft <= 0 && (budget <= 0 || vehicle.routeTick === RT_NONE)) starved = vehicle.id
            if (moved.remove) rtRemoveTrain(this, vehicle)
        }
        if (starved !== RT_NONE) this.pathfinderCursor = starved
    }

    /**
     * The depot a vehicle due for a service drives to, as the original: the nearest of its kind it can
     * reach within serviceDepotMaxCost of route, its own or, with sharing on, another company's;
     * RT_NONE when none is that near or this tick's search budget is spent. The search is
     * charged to the tick's budget.
     */
    private serviceDepotFor(vehicle: RtVehicle): number {
        const map = this.map
        if (vehicle.tiles.length === 0 || this.pathNodesLeft <= 0) return RT_NONE
        const depots = rtDepotTiles(map, vehicle.kind, owner => owner === vehicle.owner || this.settings.sharing)
        if (depots.length === 0) return RT_NONE
        const p = RT_CATALOG.pathfinder
        const target = { tiles: depots }
        const found = vehicle.kind === RtVehicleKind.rail
            ? findRailRoute(map, vehicle.owner, vehicle.tiles[0]!, vehicle.pieces[0]!, target, p.maxSearchNodes, this.pathNodesLeft, { sharing: this.settings.sharing })
            : findRoadRoute(map, vehicle.tiles[0]!, vehicle.pieces[0]!, target, p.maxSearchNodes, this.pathNodesLeft)
        this.pathNodesLeft -= found.nodes
        return found.outcome === RtRouteOutcome.found && found.cost <= p.serviceDepotMaxCost ? found.goal : RT_NONE
    }

    /* ---- dirty tiles (derived) ---- */

    markDirty(tile: number): void {
        this.dirtyTiles.add(tile)
    }

    /** The dirty tiles in ascending order, clearing the set. */
    drainDirtyTiles(): number[] {
        const tiles = [...this.dirtyTiles].sort((a, b) => a - b)
        this.dirtyTiles.clear()
        return tiles
    }
}
