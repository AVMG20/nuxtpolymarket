/**
 * The shape of every Rail Tycoon simulation entity, fixed once so the rules, the save format and the
 * client agree. Every number is an integer: ticks, tiles (map index y * side + x), sub-tile units,
 * km/h, or money in the smallest unit. Fields marked "derived" are caches that decode rebuilds; they
 * are neither saved nor hashed. Everything else is saved state, written by save.ts in field order.
 */

/** Marks an absent id or tile in integer fields. */
export const RT_NONE = -1

/** Owner byte for town-owned or unowned objects. */
export const RT_OWNER_NONE = 255

export const RtVehicleKind = { rail: 0, road: 1 } as const
export type RtVehicleKind = typeof RtVehicleKind[keyof typeof RtVehicleKind]

export const RtOrderKind = { gotoStation: 0, gotoDepot: 1 } as const
export type RtOrderKind = typeof RtOrderKind[keyof typeof RtOrderKind]

/** Bits of RtOrder.flags. */
export const RtOrderFlag = { fullLoad: 1, unload: 2, noUnload: 4 } as const

/** Bits of RtStation.facilities. */
export const RtFacility = { rail: 1, busStop: 2, truckStop: 4 } as const

export const RtVehicleState = {
    /** On track or road, following orders. */
    driving: 0,
    /** Stopped at a station, loading or unloading. */
    loading: 1,
    /** Inside a depot (a depot occupant, not a track holder). */
    inDepot: 2,
    /** Crashed; removed when crashTicks runs out. */
    crashed: 3,
    /** Under a stop order, driving to a parking place. */
    parking: 4,
    /** Under a stop order, standing in a parking spot. */
    parked: 5
} as const
export type RtVehicleState = typeof RtVehicleState[keyof typeof RtVehicleState]

export interface RtDate {
    /** Day of month, 1-based. */
    day: number
    /** Month, 0 = January. */
    month: number
    year: number
}

/** The world-level saved scalars besides the entity lists; RtWorld carries these. */
export interface RtWorldScalars {
    /** Ticks since the world was created. */
    tick: number
    date: RtDate
    /** SeededRandom state (u32). */
    rngState: number
    /** Index of the next vehicle the round-robin pathfinder budget serves. */
    pathfinderCursor: number
}

export interface RtWorldSettings {
    /** Map side in tiles: 64, 128 or 256. */
    side: number
    /** Companies allowed, 2 to 8. */
    maxCompanies: number
    /** Infrastructure sharing between companies, on by default. */
    sharing: boolean
}

/** One year of a company's finances, by category; expenses are negative, income positive (money). */
export interface RtFinance {
    /** Track, road, stations, depots, signals and clearing (money). */
    construction: number
    /** Vehicle purchases (money). */
    newVehicles: number
    /** Accrued vehicle running costs (money). */
    runningCosts: number
    /** Infrastructure upkeep (money). */
    property: number
    /** Loan interest (money). */
    loanInterest: number
    /** Delivery income earned by trains (money). */
    trainIncome: number
    /** Delivery income earned by road vehicles (money). */
    roadIncome: number
    /** Fees and shares received from other companies using our infrastructure (money). */
    sharingIncome: number
    /** Fees and shares paid to other companies for their infrastructure (money). */
    sharingCosts: number
    /** Everything else, such as the monthly other cost (money). */
    other: number
    /**
     * Crossing inspector fines and accident costs paid as the causer (negative), and compensation
     * received as a victim of another company's crossing (positive) (money).
     */
    fines: number
}

/**
 * A foreign level crossing (a company's road over another company's rail, or its rail over another
 * company's road) and the company that built it. Saved; the inspector fines it monthly.
 */
export interface RtCrossingViolation {
    /** The crossing (tile index). */
    tile: number
    /** The company whose build made the crossing (company id). */
    causer: number
    /** Tick the crossing was built (ticks). */
    since: number
}

/** One completed month's totals for the income graph. */
export interface RtMonthTotals {
    /** Total income that month (money). */
    income: number
    /** Total expenses that month, negative (money). */
    expenses: number
}

/** Pieces a company owns, counted on build and demolish; derived, recomputed on decode. */
export interface RtInfrastructure {
    /** Track pieces, including level crossings (count). */
    railPieces: number
    /** Road bits (count). */
    roadPieces: number
    /** Signals (count). */
    signals: number
    /** Station tiles of every kind (count). */
    stationTiles: number
    /** Rail and road depots (count). */
    depots: number
}

export interface RtCompany {
    /** Company id, 0 to maxCompanies - 1. */
    id: number
    name: string
    /** Index into RT_CATALOG.companies.colours. */
    colour: number
    /** Cash, may be negative (money). */
    money: number
    /** Outstanding loan (money). */
    loan: number
    /** Consecutive months below the bankruptcy line (months). */
    bankruptMonths: number
    /** Tick the company was founded or last reset (ticks). */
    foundedTick: number
    /** Derived: piece counts for upkeep and the finances window. */
    infrastructure: RtInfrastructure
    financeThisYear: RtFinance
    financeLastYear: RtFinance
    /** Income booked so far this month (money). */
    monthIncome: number
    /** Expenses booked so far this month, negative (money). */
    monthExpenses: number
    /** The last 12 completed months, newest last. */
    monthlyIncome: RtMonthTotals[]
}

export interface RtTown {
    /** Town id. */
    id: number
    name: string
    /** Centre tile (tile index). */
    centre: number
    /** Houses in the town (count). */
    houseCount: number
    /** Sum of house populations (people). */
    population: number
    /** Ticks left until the next growth attempt (town ticks). */
    growthCounter: number
    /** Current growth interval (town ticks). */
    growthRate: number
    /** Whether the town is growing this month. */
    growing: boolean
    /** Stations counted active at the last growth update (count). */
    activeStations: number
    /** Cargo delivered to the town this month, per cargo index (units). */
    receivedThisMonth: number[]
    /** Cargo delivered to the town last month, per cargo index (units). */
    receivedLastMonth: number[]
}

export interface RtIndustry {
    /** Industry id. */
    id: number
    /** Industry type index (RT_INDUSTRY_TYPE_IDS). */
    type: number
    /** North corner of the footprint (tile index). */
    origin: number
    /** Produced output not yet distributed, per cargo index (units). */
    waiting: number[]
    /** Accepted input not yet converted, per cargo index (units). */
    delivered: number[]
    /** Output produced this month, per cargo index (units). */
    producedThisMonth: number[]
    /** Output moved to stations this month, per cargo index (units). */
    transportedThisMonth: number[]
}

export interface RtCargoPacket {
    /** Cargo index (RT_CARGO_IDS). */
    cargo: number
    /** Units in the packet. */
    count: number
    /** Tile the cargo was produced on (tile index), the payment distance origin. */
    sourceTile: number
    /** Station the cargo first entered, or RT_NONE (station id). */
    sourceStation: number
    /** Transit periods aged so far (periods of packetAgeTicks). */
    transitPeriods: number
    /** Income already credited to a feeder leg (money). */
    feederShare: number
}

/** A station's state for one cargo. */
export interface RtStationCargo {
    /** Rating 0 to 255. */
    rating: number
    /** Whether the cargo has a rating at this station (a vehicle has loaded it). */
    hasRating: boolean
    /** Whether a vehicle has ever tried to load this cargo here; only then does the station receive it. */
    loadAttempted: boolean
    /** Waiting packets, oldest first. */
    packets: RtCargoPacket[]
    /** Fractional production carried between deliveries (1/256 units). */
    fraction: number
    /** Rating cycles since the last pickup (cycles, saturating at 255). */
    cyclesSincePickup: number
    /** Waiting amount the rating saw last cycle (units). */
    maxWaiting: number
    /** Speed of the last vehicle that loaded (km/h, saturating at 255). */
    lastSpeed: number
    /** Age of the last vehicle that loaded (years, saturating at 255). */
    lastAge: number
}

export interface RtStation {
    /** Station id. */
    id: number
    /** Owning company id. */
    owner: number
    name: string
    /** Town the station is named after (town id). */
    town: number
    /** Sign tile, the first tile built (tile index). */
    sign: number
    /** Station tiles in ascending order (tile indices). */
    tiles: number[]
    /** Bumped on every change to tiles (count). */
    tilesRevision: number
    /** Facility bits (RtFacility). */
    facilities: number
    /** Per cargo index. */
    cargo: RtStationCargo[]
    /** Stored acceptance bitmask by cargo index, recomputed every stationAcceptanceTicks. */
    acceptance: number
    /** Last tick a vehicle loaded here (ticks). */
    lastPickupTick: number
    /** Last tick a vehicle unloaded here (ticks). */
    lastDeliveryTick: number
    /** Kind of the last vehicle that loaded (RtVehicleKind). */
    lastVehicleKind: number
    /** Derived: covered tile indices, built from the tiles at catchmentRevision. */
    catchment: number[] | null
    /** Derived: the tilesRevision the catchment cache was built from (count). */
    catchmentRevision: number
}

export interface RtOrder {
    kind: RtOrderKind
    /** Station id for gotoStation; depot tile index for gotoDepot. */
    target: number
    /** RtOrderFlag bits. */
    flags: number
}

export interface RtVehicle {
    /** Vehicle id. */
    id: number
    /** Owning company id. */
    owner: number
    kind: RtVehicleKind
    /** Engine or road vehicle model index (RT_VEHICLE_MODEL_IDS). */
    model: number
    /** Every part's model index, engine first; a road vehicle has one entry. */
    consist: number[]
    /** Wagons behind the engine (count). */
    wagonCount: number
    /** Tiles the vehicle occupies, head first (tile indices). */
    tiles: number[]
    /** Trackdir (rail) or road direction held on each occupied tile, parallel to tiles. */
    pieces: number[]
    /** Travel direction of the head (trackdir or road direction). */
    direction: number
    /** Head's progress through its tile (sub-tile units). */
    progress: number
    /** Current speed (km/h). */
    speed: number
    /** Speed fraction (1/256 km/h). */
    subspeed: number
    /** Cached route, trackdirs for trains or directions for road vehicles. */
    route: number[]
    /** Next route index the head will enter. */
    routeIndex: number
    /** Tick the cached route was computed (ticks). */
    routeTick: number
    /** Route index up to which the train holds a path reservation (index, 0 when none). */
    reservedEnd: number
    orders: RtOrder[]
    /** Current order index. */
    orderIndex: number
    /** RtVehicleState. */
    state: RtVehicleState
    /** Stopped by the player (start/stop). */
    stopped: boolean
    /** Ticks until the next loading step (ticks). */
    loadTicks: number
    /** Station being loaded at, or RT_NONE (station id). */
    loadingStation: number
    /** Carried packets, oldest first. */
    cargo: RtCargoPacket[]
    /** Reliability 0 to 65535. */
    reliability: number
    /** Breakdown chance accumulator (0 to 255). */
    breakdownChance: number
    /** Ticks left of a current breakdown, 0 when running (ticks). */
    breakdownTicks: number
    /** Breakdowns since the last service (count). */
    breakdownsSinceService: number
    /** Tick of the last depot service (ticks). */
    lastServiceTick: number
    /** Depot tile of an implicit service visit, or RT_NONE (tile index). */
    serviceDepot: number
    /** serviceDepot is a send-to-depot target: the vehicle stops when it drives in. */
    haltInDepot: boolean
    /** Running ticks not yet charged as running cost (ticks). */
    runningTicks: number
    /** No route exists either way. */
    lost: boolean
    /** Tick a lost vehicle next retries its search (ticks). */
    lostRetryTick: number
    /** Ticks a road vehicle has been blocked by one ahead (ticks). */
    blockedTicks: number
    /** Ticks waited at a red signal (ticks). */
    waitTicks: number
    /** Ticks left before a crashed vehicle is removed (ticks). */
    crashTicks: number
    /** Age since purchase (days). */
    age: number
    /** Current value, decaying over time (money). */
    value: number
    /** Profit this year (money). */
    profitThisYear: number
    /** Profit last year (money). */
    profitLastYear: number
}
