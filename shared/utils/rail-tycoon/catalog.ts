/**
 * Every simulation constant Rail Tycoon's rules read, so no rule carries a magic number.
 * Values mimic the original game's mechanics at its default settings, re-typed as
 * numbers from a behavioural reading of its source; the comment on each group names that source file.
 * Names of vehicles and industries are our own. Money is in the smallest unit (one pound in the original).
 * Network, persistence and server limits live in limits.ts, not here.
 */

/** One railway or road vehicle model; wagons have no engine, so their power, running cost and speed limit are 0. */
export interface RtVehicleModelSpec {
    /** Stable index written to saves and wire messages. */
    readonly index: number
    readonly name: string
    readonly kind: 'rail' | 'road'
    readonly role: 'engine' | 'wagon' | 'road'
    /** Purchase price, smallest money unit. */
    readonly cost: number
    /** Running cost per year of running ticks, smallest money unit (0 for wagons, as the original). */
    readonly runningCost: number
    /** Top speed in km/h; 0 means a wagon that sets no limit. */
    readonly maxSpeed: number
    /** Cargo units carried; 0 for a locomotive. */
    readonly capacity: number
    readonly cargo: 'passengers' | 'mail' | 'coal' | 'wood' | 'goods' | null
    /** Horsepower; 0 for a wagon. */
    readonly power: number
    /** Empty weight in tonnes. */
    readonly weight: number
    /** Reliability lost per game day, out of 65535. */
    readonly reliabilityDecay: number
    /** Days between depot services. */
    readonly serviceDays: number
}

// Default construction and running cost settings are "low": the base prices times 6/8, rounded down.
const TRACK_COST = 75
const TRAIN_DEPOT_COST = 450

const VEHICLE_MODELS = {
    // table/engines.h: an early tank engine (cost factor 7, 64 km/h, 300 hp, 47 t, running factor 50)
    tankEngine: { index: 0, name: 'Brookfield Tank', kind: 'rail', role: 'engine', cost: 8203, runningCost: 820, maxSpeed: 64, capacity: 0, cargo: null, power: 300, weight: 47, reliabilityDecay: 80, serviceDays: 150 },
    // table/engines.h: an express steam engine (cost factor 13, 112 km/h, 1000 hp, 131 t, running factor 120)
    expressEngine: { index: 1, name: 'Meridian Express', kind: 'rail', role: 'engine', cost: 15234, runningCost: 1968, maxSpeed: 112, capacity: 0, cargo: null, power: 1000, weight: 131, reliabilityDecay: 80, serviceDays: 150 },
    // table/engines.h: wagons (wagon base price times cost factor / 256, capacities 40/30/30/30/25)
    passengerCoach: { index: 2, name: 'Passenger Coach', kind: 'rail', role: 'wagon', cost: 1447, runningCost: 0, maxSpeed: 0, capacity: 40, cargo: 'passengers', power: 0, weight: 25, reliabilityDecay: 80, serviceDays: 150 },
    mailCar: { index: 3, name: 'Mail Car', kind: 'rail', role: 'wagon', cost: 1335, runningCost: 0, maxSpeed: 0, capacity: 30, cargo: 'mail', power: 0, weight: 21, reliabilityDecay: 80, serviceDays: 150 },
    coalHopper: { index: 4, name: 'Coal Hopper', kind: 'rail', role: 'wagon', cost: 1031, runningCost: 0, maxSpeed: 0, capacity: 30, cargo: 'coal', power: 0, weight: 18, reliabilityDecay: 80, serviceDays: 150 },
    timberFlat: { index: 5, name: 'Timber Flat', kind: 'rail', role: 'wagon', cost: 1060, runningCost: 0, maxSpeed: 0, capacity: 30, cargo: 'wood', power: 0, weight: 16, reliabilityDecay: 80, serviceDays: 150 },
    goodsBoxcar: { index: 6, name: 'Goods Boxcar', kind: 'rail', role: 'wagon', cost: 1113, runningCost: 0, maxSpeed: 0, capacity: 25, cargo: 'goods', power: 0, weight: 21, reliabilityDecay: 80, serviceDays: 150 },
    // table/engines.h: first-generation road vehicles (road speeds are stored at half km/h there: 112 and 96)
    townBus: { index: 7, name: 'Townhopper Bus', kind: 'road', role: 'road', cost: 4921, runningCost: 426, maxSpeed: 56, capacity: 31, cargo: 'passengers', power: 42, weight: 9, reliabilityDecay: 80, serviceDays: 150 },
    mailVan: { index: 8, name: 'Post Runner', kind: 'road', role: 'road', cost: 4716, runningCost: 421, maxSpeed: 48, capacity: 22, cargo: 'mail', power: 38, weight: 12, reliabilityDecay: 80, serviceDays: 150 },
    coalLorry: { index: 9, name: 'Coal Hauler', kind: 'road', role: 'road', cost: 4429, runningCost: 421, maxSpeed: 48, capacity: 20, cargo: 'coal', power: 38, weight: 12, reliabilityDecay: 80, serviceDays: 150 },
    timberLorry: { index: 10, name: 'Timber Hauler', kind: 'road', role: 'road', cost: 4839, runningCost: 421, maxSpeed: 48, capacity: 20, cargo: 'wood', power: 38, weight: 12, reliabilityDecay: 80, serviceDays: 150 },
    goodsLorry: { index: 11, name: 'Goods Hauler', kind: 'road', role: 'road', cost: 4388, runningCost: 421, maxSpeed: 48, capacity: 14, cargo: 'goods', power: 38, weight: 12, reliabilityDecay: 80, serviceDays: 150 }
} as const satisfies Record<string, RtVehicleModelSpec>

export const RT_CATALOG = {
    // timer/timer_game_tick.h, timer/timer_game_calendar.cpp, settings (starting year 1950)
    time: {
        /** Wall-clock milliseconds per tick. */
        tickMs: 27,
        dayTicks: 74,
        daysPerMonth: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
        /** February gains a day in Gregorian leap years, as the original's calendar. */
        leapYears: true,
        yearDays: 365,
        startYear: 1950,
        ratingCycleTicks: 185,
        packetAgeTicks: 185,
        townTickUnit: 70,
        industryCycleTicks: 256,
        stationAcceptanceTicks: 250
    },

    // table/cargo_const.h (temperate cargos: initial payment, transit-period thresholds, weight in 1/16 t)
    cargos: {
        passengers: { index: 0, name: 'Passengers', colour: 0x6ab0de, initialPrice: 3185, fastDays: 0, slowDays: 24, freight: false, bulk: false, weight16: 1 },
        mail: { index: 1, name: 'Mail', colour: 0xe4e4e4, initialPrice: 4550, fastDays: 20, slowDays: 90, freight: false, bulk: false, weight16: 4 },
        coal: { index: 2, name: 'Coal', colour: 0x3c3c3c, initialPrice: 5916, fastDays: 7, slowDays: 255, freight: true, bulk: true, weight16: 16 },
        wood: { index: 3, name: 'Wood', colour: 0x8b5a2b, initialPrice: 5005, fastDays: 15, slowDays: 255, freight: true, bulk: false, weight16: 16 },
        goods: { index: 4, name: 'Goods', colour: 0xd9a441, initialPrice: 6144, fastDays: 5, slowDays: 28, freight: true, bulk: false, weight16: 8 }
    },

    // economy.cpp (GetTransportedGoodsIncome): a "day" here is one transit period of packetAgeTicks
    payment: {
        timeFactorStart: 255,
        timeFactorFloor: 31,
        /** Fall per period past fastDays, then the extra fall per period past fastDays + slowDays. */
        slope1: 1,
        slope2: 1,
        /** Below the floor the factor decays as floor / (x / 32 + 1), in 1/16 fixed point. */
        timeFactorFracBits: 4,
        /** payment = distance * timeFactor * amount * price >> scaleShift. */
        scaleShift: 21,
        /** Transit periods saturate here (a u16 in the original). */
        maxTransitPeriods: 65535
    },

    // station.cpp, station_type.h (modified catchment, on by default)
    catchment: {
        rail: 4,
        roadStop: 3,
        /** A station accepts a cargo when the summed acceptance in its catchment reaches 8 eighths. */
        acceptanceThreshold: 8
    },

    // station_cmd.cpp (UpdateStationRating), station_base.h
    stationRating: {
        start: 175,
        max: 255,
        /** The rating moves toward its target by at most this much per rating cycle. */
        stepLimit: 2,
        /** Speed term: (lastSpeed - speedBase) >> speedShift when lastSpeed exceeds speedBase. */
        speedBase: 85,
        speedShift: 2,
        speedMax: 255,
        /** Cumulative bonuses for rating cycles since the last pickup, at or below each bound. */
        pickupBands: [{ maxCycles: 21, bonus: 25 }, { maxCycles: 12, bonus: 25 }, { maxCycles: 6, bonus: 45 }, { maxCycles: 3, bonus: 35 }],
        basePenalty: 90,
        /** Cumulative bonuses for the waiting amount, at or below each bound. */
        waitingBands: [{ maxWaiting: 1500, bonus: 55 }, { maxWaiting: 1000, bonus: 35 }, { maxWaiting: 600, bonus: 10 }, { maxWaiting: 300, bonus: 20 }, { maxWaiting: 100, bonus: 10 }],
        /** Cumulative bonuses for the last loading vehicle's age in years, below each bound. */
        ageBands: [{ belowYears: 3, bonus: 10 }, { belowYears: 2, bonus: 10 }, { belowYears: 1, bonus: 13 }],
        /** A statue in town; version 1 has no local-authority actions, so it is never applied. */
        statueBonus: 26,
        /** At or below lowRating with at least lowWaiting waiting, remove (random & mask) + 1, a smaller mask under smallPile. */
        lowRating: 64,
        lowWaiting: 100,
        lowSmallPile: 200,
        lowMask: 31,
        lowSmallMask: 7,
        /** At or below midRating, when rating <= a 7-bit random number, remove (2-bit random) + 1. */
        midRating: 127,
        midRandomBits: 7,
        midRemoveBits: 2,
        /** Above pileThreshold remove (excess / pileCutDivisor), then cap the pile at pileMax. */
        pileThreshold: 4096,
        pileCutDivisor: 64,
        pileMax: 32768,
        /** After this many rating cycles without a pickup the cargo's rating and pile are dropped. */
        abandonCycles: 255,
        /** A cargo without a rating creeps back toward start by this much per cycle. */
        recoveryStep: 1
    },

    // station_cmd.cpp (CmdBuildRailStation), settings (station_spread)
    stations: {
        stationSpread: 12
    },

    // station_cmd.cpp (MoveGoodsToStation, UpdateStationWaiting)
    production: {
        /** amount * (rating + 1) is shifted right by fracBits; the low bits carry over per station. */
        fracBits: 8,
        ratingOffset: 1
    },

    // town_cmd.cpp (GetNormalGrowthRate, UpdateTownGrowth, CountActiveStations, TownGenerateCargoBinomial)
    towns: {
        /** Each house produces once per this many ticks (the original's tile loop). */
        housePeriodTicks: 256,
        /** Growth interval in town ticks, indexed by active station count (capped at the last entry). */
        growthTownTicks: [320, 420, 300, 220, 160, 100],
        /** The default "normal" growth speed halves that table once. */
        growthRateShift: 1,
        /** Town ticks are converted to game ticks as (min(t, maxTownTicks) + 1) * townTickUnit - 1. */
        maxTownTicks: 930,
        /** The interval is divided by (houses / sizeDivisor + 1). */
        sizeDivisor: 50,
        /** A station is active when it loaded or unloaded within this many rating cycles. */
        activeStationWindow: 20,
        /** A town with no active station still grows in a month with this chance. */
        unservedGrowthNumerator: 1,
        unservedGrowthDenominator: 12,
        /** A new town waits this many town ticks before its first growth. */
        initialGrowthTownTicks: 250,
        /** Cargo per production: popcount of (random & ((1 << ((rate + 7) / genDivisor)) - 1)). */
        genDivisor: 8,
        /** Squared radius in which stations count for a town, indexed by houses / 4. */
        edgeRadiusSquared: [4, 16, 25, 36, 49, 64, 64, 64, 64, 81, 81, 81, 81, 81, 81, 81, 81, 81, 100, 100, 121, 121, 121],
        /** Past the table: (houses / radiusMassDivisor) * radiusMassFactor - radiusOffset. */
        radiusMassDivisor: 8,
        radiusMassFactor: 15,
        radiusOffset: 40
    },

    // table/town_land.h (temperate houses: population, mail generation, acceptance in eighths)
    houses: {
        classes: [
            { population: 40, mail: 20, acceptPassengers: 8, acceptMail: 3, acceptGoods: 1 },
            { population: 85, mail: 55, acceptPassengers: 8, acceptMail: 3, acceptGoods: 4 },
            { population: 187, mail: 70, acceptPassengers: 8, acceptMail: 3, acceptGoods: 4 }
        ]
    },

    // table/build_industry.h, industry_cmd.cpp (production every 256 ticks, input multiplier / 256)
    industries: {
        coalMine: { index: 0, name: 'Colliery', width: 3, height: 3, produces: [{ cargo: 'coal', rate: 15 }], accepts: [], converts: [] },
        powerStation: { index: 1, name: 'Generating Works', width: 4, height: 2, produces: [], accepts: ['coal'], converts: [] },
        forest: { index: 2, name: 'Woodland', width: 4, height: 5, produces: [{ cargo: 'wood', rate: 13 }], accepts: [], converts: [] },
        sawmill: { index: 3, name: 'Lumber Mill', width: 3, height: 3, produces: [], accepts: ['wood'], converts: [{ from: 'wood', to: 'goods', multiplier: 256 }] }
    },

    // industry_cmd.cpp (shared rules for every industry type)
    industryRules: {
        /** An industry tile accepts its cargos at a full 8 eighths. */
        acceptanceEighths: 8,
        /** Converted output is input * multiplier >> inputShift. */
        inputShift: 8,
        /** Waiting output saturates here (a u16 in the original). */
        maxWaiting: 65535
    },

    // economy_type.h, economy.cpp (interest, bankruptcy, other costs), company_cmd.cpp, settings (difficulty)
    economy: {
        /** A new company starts with this cash, all of it borrowed (startLoan), as the original. */
        startMoney: 100000,
        startLoan: 100000,
        loanStep: 10000,
        maxLoan: 300000,
        /** Yearly interest on the loan and on negative cash, charged monthly by cumulative share. */
        interestPercent: 2,
        /** Monthly "other" cost per company. */
        monthlyOtherCost: 25,
        /** Flat monthly upkeep per piece; the original's maintenance (off by default) grows with network size. */
        upkeep: { railPiece: 1, roadPiece: 1, signal: 1, stationTile: 2, depot: 1 },
        /** Months below -maxLoan (money minus loan) before the warning and the reset. */
        bankruptcyWarnMonths: 4,
        bankruptcyResetMonths: 10,
        /** A sold vehicle refunds this share of its current value (the original pays the full value). */
        sellRefundPercent: 100,
        /** A vehicle loses value >> valueDecayShift every valueDecayDays days. */
        valueDecayDays: 8,
        valueDecayShift: 8,
        /** Infrastructure sharing is this plan's own design; the original has none. */
        sharing: {
            railFeePerPiece: Math.max(1, Math.floor(TRACK_COST / 64)),
            stationSharePercent: 25,
            depotServiceFee: Math.max(1, Math.floor(TRAIN_DEPOT_COST / 32)),
            /** Added per foreign track piece, in pathfinder cost units. */
            foreignTrackPenalty: 300
        }
    },

    // This plan's own design (Michael, 2026-10-30); the original has no crossing inspector. A foreign
    // crossing is a company's road over another company's rail or its rail over another's road.
    inspector: {
        /** Each month end every foreign crossing is inspected with this chance. */
        visitNumerator: 1,
        visitDenominator: 4,
        /** An inspection fines the causer this much per month the crossing has stood (at least one). */
        baseFine: 2000,
        /** Next-of-kin compensation per person aboard a crashed vehicle (passengers and one driver). */
        perPerson: 500,
        /** Clearing the wreck of each crashed vehicle. */
        cleanup: 2500,
        /** The accident investigation, once per accident. */
        investigation: 5000,
        /** Paid to the crossing's rail owner per day the wreck blocks the line (crashTicks, in days rounded up). */
        delayPerDay: 250,
        /** Trains slow to this speed (km/h) on and before a foreign crossing; it has no barriers to stop for. */
        crossingSpeed: 48,
        /** A train that hits a road vehicle on a foreign crossing derails with this chance. */
        derailNumerator: 1,
        derailDenominator: 4,
        /** Crossing violations a world tracks (a save bound); a crossing past it goes unregistered. */
        maxViolations: 4096
    },

    // company_cmd.cpp, livery.h (sixteen company colours; a world uses the first unused one)
    companies: {
        colours: [0x2a4fa8, 0xc23a2b, 0x2f8f3a, 0xd8b52c, 0x7b3fa0, 0xe07a24, 0x2aa6a6, 0xd14f8c, 0x6b6b6b, 0x8c5a2e, 0x9cc43a, 0x1e2f6b, 0xe6e6e6, 0x5a0f0f, 0x4f7f9f, 0xb08f6a]
    },

    // table/engines.h, vehicle.cpp (CheckVehicleBreakdown), engine.cpp, settings (max_train_length, servicing)
    vehicles: {
        models: VEHICLE_MODELS,
        /** A train is at most 7 tiles long, every engine and wagon taking half a tile: 14 vehicles. */
        maxTrainLength: 7,
        halfTilesPerVehicle: 1,
        maxTrainVehicles: 14,
        /** Reliability on purchase and after a service: 75 percent plus half the original's random 25. */
        reliabilityMax: 57343,
        /** Breakdown chance threshold, indexed by reliability >> 10. */
        breakdownChance: [
            3, 3, 3, 3, 3, 3, 3, 3,
            4, 4, 5, 5, 6, 6, 7, 7,
            8, 8, 9, 9, 10, 10, 11, 11,
            12, 13, 13, 13, 13, 14, 15, 16,
            17, 19, 21, 25, 28, 31, 34, 37,
            40, 44, 48, 52, 56, 60, 64, 68,
            72, 80, 90, 100, 110, 120, 130, 140,
            150, 170, 190, 210, 230, 250, 250, 250
        ],
        /** Each daily check raises the chance by 1, plus 25 with a 1 in 25 chance. */
        breakdownChanceStep: 1,
        breakdownBonusStep: 25,
        breakdownBonusDenominator: 25,
        /** Reduced breakdowns, the default, adds this to reliability before the table lookup. */
        reducedBreakdownBonus: 26214,
        /** A vehicle slower than this never breaks down. */
        breakdownMinSpeed: 5,
        /** A breakdown stops the vehicle for breakdownDelayMin + (7-bit random) ticks. */
        breakdownDelayMin: 128,
        breakdownDelayRandom: 127,
        /** Gradual loading: loadAmount units per vehicle part per step, a step every so many ticks. */
        loadAmount: 5,
        trainLoadStepTicks: 40,
        roadLoadStepTicks: 20,
        /** A crashed vehicle is removed after this many ticks. */
        crashTicks: 4400,
        /** A road vehicle blocked this long drives through, the original's last resort. */
        roadBlockedTicks: 1480
    },

    // tile_type.h, vehicle_base.h, ground_vehicle.hpp, train_cmd.cpp (original acceleration model), roadveh_cmd.cpp
    movement: {
        /** A straight tile is 16 steps of 192 progress units. */
        subTileUnits: 3072,
        axialStepUnits: 192,
        /** A diagonal (corner) piece is 8 steps of 256. */
        cornerPieceUnits: 2048,
        cornerStepUnits: 256,
        /** Progress per tick is speed * 3 / 2 (two moves per tick, each at three quarters of speed). */
        advanceNumerator: 3,
        advanceDenominator: 2,
        /** Speed carries 8 fraction bits (subspeed). */
        speedFracBits: 8,
        /** Trains gain power * accelPowerFactor / weight (clamped to accelMax) fraction units per move. */
        trainAccelPowerFactor: 4,
        trainAccelMax: 255,
        trainMovesPerTick: 2,
        /** Braking is twice as strong as accelerating. */
        trainBrakeFactor: 2,
        /** Road vehicles gain half a km/h per tick (128 fraction units). */
        roadAccel: 128,
        /** Climbing one height level removes slopeUpLoss / 256 of the speed; descending adds slopeDownGain km/h. */
        slopeUpLoss: 64,
        slopeDownGain: 2,
        /** A 45-degree turn removes curveSmallLoss / 256 of the speed, a 90-degree turn curveLargeLoss / 256. */
        curveSmallLoss: 64,
        curveLargeLoss: 128,
        /** A road vehicle stops when one ahead in its lane is within half a tile. */
        roadLaneGap: 1536
    },

    // settings (pathfinding: wait_twoway_signal 41, wait_oneway_signal 15, wait_for_pbs_path 30 days), train_cmd.cpp
    signals: {
        /** Wait at a red two-way block signal before reversing (41 days). */
        twoWaySignalWaitTicks: 3034,
        /** Wait at a red one-way signal before reversing (15 days). */
        oneWaySignalWaitTicks: 1110,
        /** Wait for a path reservation before turning around (30 days). */
        pathWaitTicks: 2220,
        /** Tiles a block flood fill may visit; overflowing counts as occupied (red). */
        blockFillTiles: 4096
    },

    // pathfinder/yapf (YAPF_TILE_LENGTH 100), settings (yapf defaults)
    pathfinder: {
        tileCost: 100,
        cornerTileCost: 71,
        curvePenalty: 100,
        curve90Penalty: 600,
        uphillPenalty: 200,
        redSignalPenalty: 1000,
        redSignalExitPenalty: 10000,
        reservedPiecePenalty: 300,
        /** Per platform tile of a station that is not the target. */
        throughPlatformPenalty: 1000,
        crossingPenalty: 300,
        depotReversePenalty: 5000,
        roadSlopePenalty: 200,
        roadCurvePenalty: 100,
        roadCrossingPenalty: 300,
        roadStopPenalty: 800,
        /** Per-search node budget (the original's max search nodes). */
        maxSearchNodes: 10000,
        /** Nodes the whole world may expand per tick, shared round-robin. */
        pathNodesPerTick: 20000,
        /** A lost vehicle retries its search after one game day. */
        lostRetryTicks: 74,
        /** The original's maximum go-to-depot penalty: a service depot is at most 20 tiles' route cost away. */
        serviceDepotMaxCost: 2000
    },

    // table/pricebase.h at the default "low" construction cost (base price times 6/8, rounded down)
    construction: {
        track: TRACK_COST,
        road: 71,
        signal: 48,
        removeSignal: 7,
        /** Marking a parking spot costs and refunds like a signal. */
        siding: 48,
        removeSiding: 7,
        railStationTile: 150,
        railStationLength: 135,
        roadStop: 150,
        trainDepot: TRAIN_DEPOT_COST,
        roadDepot: 375,
        clearTrees: 15,
        clearGrass: 15,
        /** Removing a track piece refunds this much (the original's negative clear price). */
        removeRailRefund: 53,
        removeRoad: 30,
        removeRailStation: 37,
        removeRoadStop: 37,
        removeDepot: 60
    },

    // company_type.h, order_type.h, settings (max_trains, max_roadveh 500) and this plan's save bounds
    caps: {
        maxCompanies: 8,
        maxOrders: 64,
        maxStations: 1024,
        maxVehiclesPerCompany: 500,
        maxVehicles: 4000,
        maxTowns: 64,
        maxIndustries: 256,
        maxStationTiles: 4096,
        maxRouteLength: 4096,
        maxPacketsPerStation: 1024,
        maxPacketsPerVehicle: 256,
        maxNameBytes: 32,
        lineMaxTiles: 256,
        areaMaxTiles: 16
    }
} as const

export type RtCargoId = keyof typeof RT_CATALOG.cargos
export type RtIndustryTypeId = keyof typeof RT_CATALOG.industries
export type RtVehicleModelId = keyof typeof RT_CATALOG.vehicles.models

/** Cargo ids in index order, so a numeric cargo index maps back to its id. */
export const RT_CARGO_IDS: readonly RtCargoId[] = ['passengers', 'mail', 'coal', 'wood', 'goods']
/** Industry type ids in index order. */
export const RT_INDUSTRY_TYPE_IDS: readonly RtIndustryTypeId[] = ['coalMine', 'powerStation', 'forest', 'sawmill']
/** Vehicle model ids in index order. */
export const RT_VEHICLE_MODEL_IDS: readonly RtVehicleModelId[] = [
    'tankEngine', 'expressEngine', 'passengerCoach', 'mailCar', 'coalHopper', 'timberFlat', 'goodsBoxcar',
    'townBus', 'mailVan', 'coalLorry', 'timberLorry', 'goodsLorry'
]
