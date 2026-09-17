/**
 * The bail-out lifecycle: taking it, living under the penalty, and buying out of
 * it early. Drives the same utils the endpoints do.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { bankHistory } from '#server/database/schema'
import { getBalance } from '#server/utils/balance'
import { bankSummary, getLockedBankState, performBailout, repayBailout, settleBankState } from '#server/utils/bank'
import { BAILOUT_LOCKOUT_MS, LOAN_MULTIPLIER } from '#shared/utils/gamelogic/bank'
import { SKIP, burst, cleanupUser, getBankState, seedBankState, seedUser } from '../setup/db-helpers'

const USER_ID = 'test-bank-bailout-user'
const DAY = 86_400_000

/** 100m borrowed against a 20m deposit history, now compounded to `debt`. */
const spiralling = (debt: number) => seedBankState(USER_ID, {
    balance: (-debt).toFixed(4),
    principal: '0.0000',
    maxPrincipal: '20000000.0000',
    loanPrincipal: '100000000.0000'
})

const historyActions = async () => (await db.select().from(bankHistory).where(eq(bankHistory.userId, USER_ID)))
    .map(row => row.action)

afterAll(async () => { if (!SKIP) await db.$client.end() })

describe.skipIf(SKIP)('accepting a bail-out', () => {
    beforeEach(() => cleanupUser(USER_ID))
    afterEach(() => cleanupUser(USER_ID))

    it('is refused until the debt reaches 1.2x what was borrowed', async () => {
        await seedUser(USER_ID)
        await spiralling(119_000_000)

        await expect(performBailout(USER_ID)).rejects.toThrow()
        expect(parseFloat((await getBankState(USER_ID)).balance)).toBeLessThan(0)
    })

    it('is refused with no debt at all', async () => {
        await seedUser(USER_ID)
        await seedBankState(USER_ID, { balance: '5000.0000', maxPrincipal: '5000.0000' })

        await expect(performBailout(USER_ID)).rejects.toThrow()
    })

    it('lifts the whole debt off the account and opens a 30-day penalty', async () => {
        await seedUser(USER_ID)
        await spiralling(120_000_000)

        const summary = await performBailout(USER_ID)

        const state = await getBankState(USER_ID)
        expect(parseFloat(state.balance)).toBe(0)
        expect(parseFloat(state.principal)).toBe(0)
        expect(parseFloat(state.loanPrincipal)).toBe(0)
        // Seeded debt plus whatever 7%/day accrued during the test itself.
        expect(parseFloat(state.bailoutDebt)).toBeGreaterThanOrEqual(120_000_000)
        expect(parseFloat(state.bailoutDebt)).toBeLessThan(120_001_000)
        expect(parseFloat(state.bailoutRepaid)).toBe(0)
        expect(state.bailoutUntil!.getTime() - state.bailoutAt!.getTime()).toBe(BAILOUT_LOCKOUT_MS)
        expect(summary.bailoutActive).toBe(true)
        expect(summary.garnishRate).toBe(0.4)
        expect(await historyActions()).toContain('bailout')
    })

    it('blocks new loans for the whole term, then restores the 5x allowance', async () => {
        await seedUser(USER_ID)
        await spiralling(120_000_000)
        await performBailout(USER_ID)

        const state = await getBankState(USER_ID)
        expect(bankSummary(state).loanAvailable).toBe(0)

        const afterTerm = new Date(Date.now() + BAILOUT_LOCKOUT_MS + DAY)
        expect(bankSummary(state, afterTerm).loanAvailable).toBe(20_000_000 * LOAN_MULTIPLIER)
    })

    it('pays no interest on savings while the penalty runs', async () => {
        await seedUser(USER_ID)
        await seedBankState(USER_ID, {
            balance: '1000000.0000',
            principal: '1000000.0000',
            maxPrincipal: '1000000.0000',
            lastSettledAt: new Date(Date.now() - 10 * DAY),
            bailoutAt: new Date(Date.now() - 10 * DAY),
            bailoutUntil: new Date(Date.now() + 20 * DAY),
            bailoutDebt: '5000000.0000',
            bailoutRepaid: '0.0000'
        })

        const settled = await db.transaction(async tx => settleBankState(tx, await getLockedBankState(tx, USER_ID)))
        expect(parseFloat(settled.balance)).toBeCloseTo(1_000_000, 2)
    })

    it('cannot be taken twice — a concurrent burst lifts the debt once', async () => {
        await seedUser(USER_ID)
        await spiralling(120_000_000)

        const result = await burst(5, () => performBailout(USER_ID))

        expect(result.ok).toBe(1)
        expect(result.rejected).toBe(4)
        expect(parseFloat((await getBankState(USER_ID)).bailoutDebt)).toBeLessThan(120_001_000)
    })
})

describe.skipIf(SKIP)('repaying a bail-out early', () => {
    beforeEach(() => cleanupUser(USER_ID))
    afterEach(() => cleanupUser(USER_ID))

    const midPenalty = (debt: number, repaid: number) => seedBankState(USER_ID, {
        balance: '0.0000',
        maxPrincipal: '20000000.0000',
        bailoutAt: new Date(Date.now() - 5 * DAY),
        bailoutUntil: new Date(Date.now() + 25 * DAY),
        bailoutDebt: debt.toFixed(4),
        bailoutRepaid: repaid.toFixed(4)
    })

    it('pays the outstanding remainder out of the wallet and ends the penalty', async () => {
        await seedUser(USER_ID, { balance: '5000.0000' })
        await midPenalty(1_000, 400)

        const { paid } = await repayBailout(USER_ID)

        expect(paid).toBeCloseTo(600, 4)
        const state = await getBankState(USER_ID)
        expect(state.bailoutUntil).toBeNull()
        expect(parseFloat(state.bailoutRepaid)).toBeCloseTo(1_000, 4)
        expect(parseFloat(await getBalance(USER_ID))).toBeCloseTo(4_400, 4)
        expect(await historyActions()).toContain('bailout-settled')
    })

    it('restores loans and interest the moment it is settled', async () => {
        await seedUser(USER_ID, { balance: '5000.0000' })
        await midPenalty(1_000, 0)
        await repayBailout(USER_ID)

        const summary = bankSummary(await getBankState(USER_ID))
        expect(summary.bailoutActive).toBe(false)
        expect(summary.garnishRate).toBe(0)
        expect(summary.loanAvailable).toBe(20_000_000 * LOAN_MULTIPLIER)
    })

    it('refuses when the wallet cannot cover the remainder', async () => {
        await seedUser(USER_ID, { balance: '100.0000' })
        await midPenalty(1_000, 0)

        await expect(repayBailout(USER_ID)).rejects.toThrow()
        expect(parseFloat(await getBalance(USER_ID))).toBeCloseTo(100, 4)
        expect((await getBankState(USER_ID)).bailoutUntil).not.toBeNull()
    })

    it('refuses when no penalty is running', async () => {
        await seedUser(USER_ID, { balance: '5000.0000' })
        await seedBankState(USER_ID, { balance: '0.0000' })

        await expect(repayBailout(USER_ID)).rejects.toThrow()
        expect(parseFloat(await getBalance(USER_ID))).toBeCloseTo(5_000, 4)
    })

    it('charges the wallet once under a concurrent burst', async () => {
        await seedUser(USER_ID, { balance: '5000.0000' })
        await midPenalty(1_000, 0)

        const result = await burst(5, () => repayBailout(USER_ID))

        expect(result.ok).toBe(1)
        expect(result.rejected).toBe(4)
        expect(parseFloat(await getBalance(USER_ID))).toBeCloseTo(4_000, 4)
        expect(parseFloat((await getBankState(USER_ID)).bailoutRepaid)).toBeCloseTo(1_000, 4)
    })
})
