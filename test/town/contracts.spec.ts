import { describe, expect, it } from 'vitest'
import {
    TOWN_CONTRACT_SLOTS,
    rollTownContracts,
    townContractCandidates,
    townContractDayKey,
    townContractQuantity,
    townContractResetAt,
    townContractReward
} from '#shared/utils/gamelogic/town-contracts'

/** Always returns `v`: the low, middle or high end of every roll. */
const fixed = (v: number) => () => v

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
})

describe('townContractQuantity', () => {
    it('never asks for more than 85% of storage', () => {
        expect(townContractQuantity(10_000, 50_000, fixed(0.999999))).toBeLessThanOrEqual(42_500)
        for (const v of [0, 0.3, 0.7, 0.99]) {
            expect(townContractQuantity(1e9, 2_000, fixed(v))).toBeLessThanOrEqual(1_700)
        }
    })
})

describe('townContractCandidates', () => {
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

    it('gives a brand-new town the three raw goods', () => {
        const { contracts } = rollTownContracts({ net: {}, gross: {} }, 2_000, fixed(0.5))
        expect(contracts.map(c => c.resource).sort()).toEqual(['stone', 'wheat', 'wood'])
    })
})
