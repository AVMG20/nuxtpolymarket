import { describe, expect, it } from 'vitest'
import {
    RT_CARGO_IDS,
    RT_CATALOG,
    RT_INDUSTRY_TYPE_IDS,
    RT_VEHICLE_MODEL_IDS,
    type RtCargoId
} from '#shared/utils/rail-tycoon/catalog'
import * as limits from '#shared/utils/rail-tycoon/limits'

const isPositiveInt = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0

function expectPositive(label: string, value: unknown): void {
    expect(isPositiveInt(value), `${label} = ${String(value)}`).toBe(true)
}

const cargoIds = Object.keys(RT_CATALOG.cargos) as RtCargoId[]
const models = Object.values(RT_CATALOG.vehicles.models)
const industries = Object.values(RT_CATALOG.industries)

describe('RT_CATALOG', () => {
    it('has every group the game reads', () => {
        for (const group of ['time', 'cargos', 'payment', 'catchment', 'stationRating', 'stations', 'production', 'towns', 'houses', 'industries', 'economy', 'vehicles', 'movement', 'signals', 'pathfinder', 'construction', 'caps']) {
            expect(RT_CATALOG, group).toHaveProperty(group)
        }
        expect(RT_CATALOG.economy).toHaveProperty('sharing')
    })

    it('uses the original timing', () => {
        expect(RT_CATALOG.time.tickMs).toBe(27)
        expect(RT_CATALOG.time.dayTicks).toBe(74)
        expect(RT_CATALOG.time.ratingCycleTicks).toBe(185)
        expect(RT_CATALOG.time.packetAgeTicks).toBe(185)
        expect(RT_CATALOG.time.townTickUnit).toBe(70)
        expect(RT_CATALOG.time.industryCycleTicks).toBe(256)
        expect(RT_CATALOG.time.stationAcceptanceTicks).toBe(250)
        expect(RT_CATALOG.time.daysPerMonth).toHaveLength(12)
        expect(RT_CATALOG.time.daysPerMonth.reduce((a, b) => a + b, 0)).toBe(RT_CATALOG.time.yearDays)
    })

    it('keeps the values later steps rely on', () => {
        expect(RT_CATALOG.catchment.rail).toBe(4)
        expect(RT_CATALOG.catchment.roadStop).toBe(3)
        expect(RT_CATALOG.catchment.acceptanceThreshold).toBe(8)
        expect(RT_CATALOG.stationRating.stepLimit).toBe(2)
        expect(RT_CATALOG.payment.timeFactorStart).toBe(255)
        expect(RT_CATALOG.payment.timeFactorFloor).toBe(31)
        expect(RT_CATALOG.economy.loanStep).toBe(10000)
        expect(RT_CATALOG.caps.maxCompanies).toBe(8)
        expect(RT_CATALOG.caps.lineMaxTiles).toBe(256)
        expect(RT_CATALOG.caps.areaMaxTiles).toBe(16)
        expect(RT_CATALOG.stations.stationSpread).toBe(12)
        expect(RT_CATALOG.vehicles.maxTrainLength).toBe(7)
        expect(RT_CATALOG.vehicles.maxTrainVehicles).toBe(RT_CATALOG.vehicles.maxTrainLength * 2 / RT_CATALOG.vehicles.halfTilesPerVehicle)
        expect(RT_CATALOG.vehicles.roadBlockedTicks).toBe(1480)
        expect(RT_CATALOG.pathfinder.pathNodesPerTick).toBe(20000)
        expect(RT_CATALOG.pathfinder.lostRetryTicks).toBe(RT_CATALOG.time.dayTicks)
        expect(RT_CATALOG.economy.sharing.stationSharePercent).toBe(25)
        expect(RT_CATALOG.economy.maxLoan % RT_CATALOG.economy.loanStep).toBe(0)
    })

    it('derives the sharing fees from the construction costs in integers', () => {
        const { sharing } = RT_CATALOG.economy
        expect(sharing.railFeePerPiece).toBe(Math.max(1, Math.floor(RT_CATALOG.construction.track / 64)))
        expect(sharing.depotServiceFee).toBe(Math.max(1, Math.floor(RT_CATALOG.construction.trainDepot / 32)))
        for (const [key, value] of Object.entries(sharing)) expectPositive(`sharing.${key}`, value)
    })

    it('indexes cargos, industries and models consistently with their id lists', () => {
        expect([...RT_CARGO_IDS].sort()).toEqual([...cargoIds].sort())
        RT_CARGO_IDS.forEach((id, i) => expect(RT_CATALOG.cargos[id].index).toBe(i))
        RT_INDUSTRY_TYPE_IDS.forEach((id, i) => expect(RT_CATALOG.industries[id].index).toBe(i))
        expect(RT_INDUSTRY_TYPE_IDS).toHaveLength(industries.length)
        RT_VEHICLE_MODEL_IDS.forEach((id, i) => expect(RT_CATALOG.vehicles.models[id].index).toBe(i))
        expect(RT_VEHICLE_MODEL_IDS).toHaveLength(models.length)
        expect(Object.keys(RT_CATALOG.industries).sort()).toEqual(['coalMine', 'forest', 'powerStation', 'sawmill'])
    })

    it('references only cargos that exist from every industry', () => {
        for (const industry of industries) {
            for (const p of industry.produces) expect(cargoIds).toContain(p.cargo)
            for (const a of industry.accepts) expect(cargoIds).toContain(a)
            for (const c of industry.converts) {
                expect(cargoIds).toContain(c.from)
                expect(cargoIds).toContain(c.to)
                expect(industry.accepts as readonly string[]).toContain(c.from)
            }
            expectPositive(`${industry.name} width`, industry.width)
            expectPositive(`${industry.name} height`, industry.height)
        }
    })

    it('references only cargos that exist from every vehicle', () => {
        for (const m of models) {
            if (m.role === 'engine') {
                expect(m.cargo).toBeNull()
                expect(m.capacity).toBe(0)
            } else {
                expect(cargoIds).toContain(m.cargo)
                expectPositive(`${m.name} capacity`, m.capacity)
            }
        }
    })

    it('has at least one rail and one road vehicle for each cargo', () => {
        for (const cargo of cargoIds) {
            expect(models.some(m => m.kind === 'rail' && m.cargo === cargo), `rail ${cargo}`).toBe(true)
            expect(models.some(m => m.kind === 'road' && m.cargo === cargo), `road ${cargo}`).toBe(true)
        }
        expect(models.filter(m => m.role === 'engine')).toHaveLength(2)
    })

    it('makes every cost and rate a positive safe integer', () => {
        for (const id of cargoIds) expectPositive(`${id} initialPrice`, RT_CATALOG.cargos[id].initialPrice)
        for (const industry of industries) {
            for (const p of industry.produces) expectPositive(`${industry.name} rate`, p.rate)
            for (const c of industry.converts) expectPositive(`${industry.name} multiplier`, c.multiplier)
        }
        for (const [key, value] of Object.entries(RT_CATALOG.construction)) expectPositive(`construction.${key}`, value)
        for (const [key, value] of Object.entries(RT_CATALOG.economy.upkeep)) expectPositive(`upkeep.${key}`, value)
        const { startMoney, startLoan, loanStep, maxLoan, interestPercent, monthlyOtherCost, sellRefundPercent } = RT_CATALOG.economy
        for (const [key, value] of Object.entries({ startMoney, startLoan, loanStep, maxLoan, interestPercent, monthlyOtherCost, sellRefundPercent })) {
            expectPositive(`economy.${key}`, value)
        }
        for (const m of models) {
            expectPositive(`${m.name} cost`, m.cost)
            expectPositive(`${m.name} weight`, m.weight)
            expectPositive(`${m.name} reliabilityDecay`, m.reliabilityDecay)
            expectPositive(`${m.name} serviceDays`, m.serviceDays)
            if (m.role === 'wagon') {
                // as the original: wagons have no running cost, no engine and no speed limit
                expect(m.runningCost).toBe(0)
                expect(m.power).toBe(0)
                expect(m.maxSpeed).toBe(0)
            } else {
                expectPositive(`${m.name} runningCost`, m.runningCost)
                expectPositive(`${m.name} power`, m.power)
                expectPositive(`${m.name} maxSpeed`, m.maxSpeed)
            }
        }
        for (const [key, value] of Object.entries(RT_CATALOG.pathfinder)) expectPositive(`pathfinder.${key}`, value)
        for (const [key, value] of Object.entries(RT_CATALOG.caps)) expectPositive(`caps.${key}`, value)
        for (const [key, value] of Object.entries(RT_CATALOG.signals)) expectPositive(`signals.${key}`, value)
        for (const [key, value] of Object.entries(RT_CATALOG.movement)) expectPositive(`movement.${key}`, value)
    })

    it('orders every cargo payment threshold pair', () => {
        for (const id of cargoIds) {
            const cargo = RT_CATALOG.cargos[id]
            expect(cargo.fastDays, id).toBeLessThan(cargo.slowDays)
            expect(Number.isSafeInteger(cargo.fastDays)).toBe(true)
        }
    })

    it('keeps rating bands and tables well formed', () => {
        const r = RT_CATALOG.stationRating
        expect(r.start).toBeLessThanOrEqual(r.max)
        expect(RT_CATALOG.vehicles.breakdownChance).toHaveLength(64)
        expect(RT_CATALOG.towns.growthTownTicks).toHaveLength(6)
        for (const house of RT_CATALOG.houses.classes) expectPositive('house population', house.population)
    })
})

const LIMIT_NAMES = [
    'RT_INPUT_DELAY', 'RT_HASH_EVERY', 'RT_CHECKPOINT_MS', 'RT_ROOM_IDLE_MS', 'RT_MAX_OPEN_WORLDS', 'RT_MAX_LIVE_ROOMS',
    'RT_STEP_BUDGET_MS', 'RT_JOIN_LOAD_TIMEOUT_MS', 'RT_LIVE_JOIN_TIMEOUT_MS', 'RT_CLIENT_STEPS_PER_FRAME',
    'RT_RESYNC_BEHIND_TICKS', 'RT_ROOM_CMD_RATE', 'RT_ROOM_CMD_BURST', 'RT_SOCKET_MSG_RATE', 'RT_SOCKET_MSG_BURST',
    'RT_MAX_PEERS', 'RT_MAX_FRAME_BYTES', 'RT_MAX_SAVE_BYTES', 'RT_MAX_SNAPSHOT_FRAME_BYTES', 'RT_BACKLOG_CLOSE_BYTES',
    'RT_WS_BACKPRESSURE_LIMIT_BYTES', 'RT_GUNZIP_MAX_BYTES', 'RT_BROKEN_UNLOADS', 'RT_BROKEN_WINDOW_MS', 'RT_RESYNC_COOLDOWN_MS', 'RT_OPEN_COOLDOWN_MS',
    'RT_JOIN_PAUSE_WINDOW_MS', 'RT_CREATE_COOLDOWN_MS', 'RT_MAX_PENDING_CREATES', 'RT_JOIN_PAUSE_SHARE_PERCENT',
    'RT_JOIN_PAUSE_BUDGET_WINDOW_MS', 'RT_INVITE_FAILS_PER_MINUTE', 'RT_MAX_WORLDS_PER_OWNER', 'RT_CHAIN_TIMEOUT_MS',
    'RT_INVITE_CODE_LENGTH'
] as const
/** The invite code's alphabet and shape checker live in limits.ts beside its length. */
const NON_LIMIT_EXPORTS = ['RT_INVITE_CODE_ALPHABET', 'isRtInviteCode'] as const

describe('limits.ts', () => {
    const table = limits as Record<string, unknown>

    it('exports every limit as a positive safe integer', () => {
        for (const name of LIMIT_NAMES) expectPositive(name, table[name])
        expect(Object.keys(limits).sort()).toEqual([...LIMIT_NAMES, ...NON_LIMIT_EXPORTS].sort())
    })

    it('keeps the limits consistent with each other', () => {
        expect(limits.RT_INPUT_DELAY).toBeLessThan(limits.RT_HASH_EVERY)
        expect(limits.RT_ROOM_CMD_BURST).toBeLessThan(limits.RT_SOCKET_MSG_BURST)
        expect(limits.RT_MAX_FRAME_BYTES).toBeLessThan(limits.RT_MAX_SNAPSHOT_FRAME_BYTES)
        expect(limits.RT_MAX_SAVE_BYTES).toBeLessThan(limits.RT_GUNZIP_MAX_BYTES)
        expect(limits.RT_MAX_SNAPSHOT_FRAME_BYTES).toBeGreaterThan(limits.RT_MAX_SAVE_BYTES)
        // the backlog close leaves at least 1 MiB above the largest snapshot frame
        expect(limits.RT_BACKLOG_CLOSE_BYTES).toBeGreaterThanOrEqual(limits.RT_MAX_SNAPSHOT_FRAME_BYTES + 1048576)
        expect(limits.RT_BACKLOG_CLOSE_BYTES).toBeLessThan(limits.RT_WS_BACKPRESSURE_LIMIT_BYTES)
        expect(limits.RT_JOIN_LOAD_TIMEOUT_MS).toBe(500 * RT_CATALOG.time.tickMs)
    })
})

describe('invite code shape', () => {
    it('is 16 Crockford base32 characters', () => {
        expect(limits.RT_INVITE_CODE_LENGTH).toBe(16)
        expect(limits.RT_INVITE_CODE_ALPHABET).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ')
        expect(new Set(limits.RT_INVITE_CODE_ALPHABET).size).toBe(32)
    })

    it('accepts a code of the right length from the alphabet', () => {
        expect(limits.isRtInviteCode('0123456789ABCDEF')).toBe(true)
        expect(limits.isRtInviteCode('GHJKMNPQRSTVWXYZ')).toBe(true)
        expect(limits.isRtInviteCode('ZZZZZZZZZZZZZZZZ')).toBe(true)
    })

    it('refuses a wrong length', () => {
        expect(limits.isRtInviteCode('')).toBe(false)
        expect(limits.isRtInviteCode('0123456789ABCDE')).toBe(false)
        expect(limits.isRtInviteCode('0123456789ABCDEFG')).toBe(false)
        expect(limits.isRtInviteCode('23456789AB')).toBe(false)
    })

    it('refuses characters outside the alphabet', () => {
        for (const bad of ['I', 'L', 'O', 'U', 'a', 'z', '-', ' ', 'é']) {
            expect(limits.isRtInviteCode(`${bad}123456789ABCDEF`), bad).toBe(false)
        }
        expect(limits.isRtInviteCode('0123456789abcdef')).toBe(false)
    })

    it('refuses a non-string', () => {
        for (const value of [undefined, null, 1234567890123456, ['0123456789ABCDEF'], {}]) {
            expect(limits.isRtInviteCode(value)).toBe(false)
        }
    })
})
