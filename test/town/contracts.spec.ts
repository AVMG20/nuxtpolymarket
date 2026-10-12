import { describe, expect, it } from 'vitest'
import {
    TOWN_CONTRACT_BONUS_WEIGHTS,
    TOWN_CONTRACT_FALLBACK_RESOURCES,
    TOWN_CONTRACT_MIN_QUANTITY,
    TOWN_CONTRACT_SLOTS,
    rollTownContracts,
    roundToSignificant,
    townContractBonusGems,
    townContractCandidates,
    townContractDayBefore,
    townContractDayKey,
    townContractFloorValue,
    townContractQuantity,
    townContractRates,
    townContractResetAt,
    townContractReward
} from '#shared/utils/gamelogic/town-contracts'
import { deriveTown, townFloorPrice, type TownSimBuilding } from '#shared/utils/gamelogic/town'

/** Always returns `v`: the low, middle or high end of every roll. */
const fixed = (v: number) => () => v

/** Cycles through `values`, for rolls that need several different draws. */
function seq(values: number[]) {
    let i = 0
    return () => values[i++ % values.length]!
}

describe('town contract days', () => {
    it('keys days in UTC', () => {
        expect(townContractDayKey(Date.UTC(2026, 9, 4, 23, 59, 59))).toBe('2026-10-04')
        expect(townContractDayKey(Date.UTC(2026, 9, 5, 0, 0, 0))).toBe('2026-10-05')
    })

    it('resets at the next UTC midnight', () => {
        expect(townContractResetAt(Date.UTC(2026, 9, 4, 13, 30))).toBe(Date.UTC(2026, 9, 5))
        expect(townContractResetAt(Date.UTC(2026, 9, 4))).toBe(Date.UTC(2026, 9, 5))
        expect(townContractResetAt(Date.UTC(2026, 11, 31, 22))).toBe(Date.UTC(2027, 0, 1))
    })

    it('counts days back across a month', () => {
        expect(townContractDayBefore(Date.UTC(2026, 9, 4, 12), 7)).toBe('2026-09-27')
    })
})

describe('roundToSignificant', () => {
    it('keeps two significant figures', () => {
        expect(roundToSignificant(12_345)).toBe(12_000)
        expect(roundToSignificant(987)).toBe(990)
        expect(roundToSignificant(1_049)).toBe(1_000)
        expect(roundToSignificant(55)).toBe(55)
        expect(roundToSignificant(7.4)).toBe(7)
        expect(roundToSignificant(0)).toBe(0)
        expect(roundToSignificant(-5)).toBe(0)
    })
})

describe('townContractQuantity', () => {
    it('asks for 10 to 18 hours of output when storage allows', () => {
        // 1,000/h with 50k storage: 10h is 10k, below a quarter of storage, so it lifts to 12.5k → 13k.
        expect(townContractQuantity(1_000, 50_000, fixed(0))).toBe(13_000)
        expect(townContractQuantity(1_000, 50_000, fixed(0.5))).toBe(14_000)
        expect(townContractQuantity(1_000, 50_000, fixed(0.999999))).toBe(18_000)
    })

    it('never asks for more than 85% of storage', () => {
        expect(townContractQuantity(10_000, 50_000, fixed(0.999999))).toBe(42_000)
        for (const v of [0, 0.3, 0.7, 0.99]) {
            expect(townContractQuantity(1e9, 2_000, fixed(v))).toBeLessThanOrEqual(1_700)
        }
    })

    it('stretches a small output toward a quarter of storage, but at most to double the hours', () => {
        // 100/h with 200k storage: a quarter would be 500 hours; the stretch stops at 2 × 10h.
        expect(townContractQuantity(100, 200_000, fixed(0))).toBe(2_000)
        expect(townContractQuantity(100, 200_000, fixed(0.999999))).toBe(3_600)
    })

    it('is never trivially small', () => {
        expect(townContractQuantity(0, 2_000, fixed(0.5))).toBe(TOWN_CONTRACT_MIN_QUANTITY)
        expect(townContractQuantity(0.1, 2_000, fixed(0.5))).toBe(TOWN_CONTRACT_MIN_QUANTITY)
        expect(townContractQuantity(0, 0, fixed(0.5))).toBe(TOWN_CONTRACT_MIN_QUANTITY)
    })

    it('rounds to two significant figures', () => {
        for (let i = 0; i < 50; i++) {
            const q = townContractQuantity(37 + i * 113, 9_000 + i * 7_919, fixed((i % 10) / 10))
            const digits = String(q).replace(/0+$/, '')
            expect(digits.length).toBeLessThanOrEqual(2)
        }
    })
})

describe('townContractReward', () => {
    it('pays twice the floor', () => {
        expect(townContractReward('planks', 13_000)).toBe(13_000 * townFloorPrice('planks') * 2)
        expect(townContractFloorValue('planks', 13_000)).toBe(13_000 * townFloorPrice('planks'))
        expect(townContractReward('wheat', 600)).toBe(36_000)
    })
})

describe('townContractBonusGems', () => {
    it('maps the roll onto 40/25/18/10/7', () => {
        expect(TOWN_CONTRACT_BONUS_WEIGHTS.reduce((s, w) => s + w.weight, 0)).toBe(100)
        expect(townContractBonusGems(fixed(0))).toBe(1)
        expect(townContractBonusGems(fixed(0.399))).toBe(1)
        expect(townContractBonusGems(fixed(0.4))).toBe(2)
        expect(townContractBonusGems(fixed(0.649))).toBe(2)
        expect(townContractBonusGems(fixed(0.65))).toBe(3)
        expect(townContractBonusGems(fixed(0.85))).toBe(4)
        expect(townContractBonusGems(fixed(0.95))).toBe(5)
        expect(townContractBonusGems(fixed(0.999999))).toBe(5)
    })
})

describe('townContractCandidates', () => {
    it('takes goods with net output, and a share of goods eaten downstream', () => {
        const list = townContractCandidates({
            net: { wheat: 120, planks: -10, wood: 0 },
            gross: { wheat: 180, planks: 400, wood: 300 }
        })
        expect(list).toEqual([
            { resource: 'wheat', perHour: 120 },
            { resource: 'wood', perHour: 75 },
            { resource: 'planks', perHour: 100 }
        ])
    })

    it('never offers jewels or goods nothing makes', () => {
        const list = townContractCandidates({ net: { jewels: 500, steel: -3 }, gross: { jewels: 500 } })
        expect(list).toEqual([])
    })
})

describe('rollTownContracts', () => {
    it('picks three different goods the town makes', () => {
        const rates = { net: { wheat: 60, wood: 60, stone: 60, planks: 30, bricks: 30 }, gross: {} }
        for (const v of [0, 0.25, 0.5, 0.75, 0.99]) {
            const { contracts, bonusGems } = rollTownContracts(rates, 7_000, fixed(v))
            expect(contracts).toHaveLength(TOWN_CONTRACT_SLOTS)
            expect(new Set(contracts.map(c => c.resource)).size).toBe(TOWN_CONTRACT_SLOTS)
            expect(contracts.map(c => c.slot)).toEqual([0, 1, 2])
            for (const c of contracts) {
                expect(Object.keys(rates.net)).toContain(c.resource)
                expect(c.reward).toBe(townContractReward(c.resource, c.quantity))
            }
            expect(bonusGems).toBeGreaterThanOrEqual(1)
            expect(bonusGems).toBeLessThanOrEqual(5)
        }
    })

    it('tops a young town up with raw goods', () => {
        const { contracts } = rollTownContracts({ net: { wheat: 60 }, gross: { wheat: 60 } }, 2_000, seq([0, 0.5, 0.1, 0.9, 0.3]))
        const goods = contracts.map(c => c.resource)
        expect(goods[0]).toBe('wheat')
        expect(new Set(goods).size).toBe(3)
        for (const g of goods) expect(TOWN_CONTRACT_FALLBACK_RESOURCES).toContain(g)
    })

    it('gives a brand-new town the three raw goods', () => {
        const { contracts } = rollTownContracts({ net: {}, gross: {} }, 2_000, fixed(0.5))
        expect(contracts.map(c => c.resource).sort()).toEqual(['stone', 'wheat', 'wood'])
        for (const c of contracts) expect(c.quantity).toBe(840)
    })

    it('is deterministic for a given random source', () => {
        const rates = { net: { wheat: 60, wood: 60, stone: 60, planks: 30, bricks: 30, flour: 25 }, gross: {} }
        const a = rollTownContracts(rates, 7_000, seq([0.1, 0.7, 0.3, 0.2, 0.9, 0.4, 0.6]))
        const b = rollTownContracts(rates, 7_000, seq([0.1, 0.7, 0.3, 0.2, 0.9, 0.4, 0.6]))
        expect(a).toEqual(b)
    })
})

describe('townContractRates', () => {
    it('reads a farm as about 60 wheat an hour', () => {
        const past = Date.now() - 60_000
        const buildings: TownSimBuilding[] = [
            ...Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`, type: 'road' as const, level: 1, completesAt: past, upgradingTo: null, createdAt: past, wx: i, wy: 0, rotation: 0 })),
            { id: 'h', type: 'house', level: 5, completesAt: past, upgradingTo: null, createdAt: past, wx: 0, wy: 1, rotation: 2 },
            { id: 'f', type: 'farm', level: 1, completesAt: past, upgradingTo: null, createdAt: past + 1, wx: 1, wy: 1, rotation: 2 }
        ]
        const now = Date.now()
        const derived = deriveTown(buildings, 50, now)
        const rates = townContractRates(buildings, derived, now)
        const throughput = derived.throughput.get('f') ?? 0
        expect(throughput).toBeGreaterThan(0)
        expect(rates.gross.wheat).toBeCloseTo(60 * throughput * derived.speedMultiplier)
    })
})
