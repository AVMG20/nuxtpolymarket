/**
 * Settlement against the real row: the 5x debt ceiling has to hold in the
 * database write, not just in the math helper.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '#server/database'
import { bailoutStateOf, bankSummary, getLockedBankState, settleBankState } from '#server/utils/bank'
import { BAILOUT_LOCKOUT_MS, bankDailyRate, growBankBalance, isBailoutActive } from '#shared/utils/gamelogic/bank'
import { SKIP, cleanupUser, getBankState, seedBankState, seedUser } from '../setup/db-helpers'

const USER_ID = 'test-bank-settlement-user'
const DAY = 86_400_000

const settle = () => db.transaction(async tx => settleBankState(tx, await getLockedBankState(tx, USER_ID)))

afterAll(async () => { if (!SKIP) await db.$client.end() })

describe.skipIf(SKIP)('bank settlement', () => {
    beforeEach(() => cleanupUser(USER_ID))
    afterEach(() => cleanupUser(USER_ID))

    it('stops debt at 5x the borrowed principal however long it is left', async () => {
        await seedUser(USER_ID)
        await seedBankState(USER_ID, {
            balance: '-1000.0000',
            maxPrincipal: '1000.0000',
            loanPrincipal: '1000.0000',
            lastSettledAt: new Date(Date.now() - 365 * DAY)
        })

        const settled = await settle()

        expect(parseFloat(settled.balance)).toBe(-5_000)
        expect(bankSummary(settled).debtLimit).toBe(5_000)
    })

    it('compounds an untouched debt below the ceiling at 7% a day', async () => {
        await seedUser(USER_ID)
        await seedBankState(USER_ID, {
            balance: '-1000.0000',
            maxPrincipal: '1000.0000',
            loanPrincipal: '1000.0000',
            lastSettledAt: new Date(Date.now() - 2 * DAY)
        })

        const settled = await settle()

        expect(parseFloat(settled.balance)).toBeCloseTo(-1000 * 1.07 ** 2, 1)
    })

    it('compounds savings and reports the 5x loan limit off total deposited', async () => {
        await seedUser(USER_ID)
        await seedBankState(USER_ID, {
            balance: '10000.0000',
            principal: '10000.0000',
            maxPrincipal: '10000.0000',
            lastSettledAt: new Date(Date.now() - DAY)
        })

        const settled = await settle()
        const summary = bankSummary(settled)

        expect(parseFloat(settled.balance)).toBeCloseTo(10_000 * (1 + bankDailyRate(10_000)), 1)
        expect(summary.loanLimit).toBe(50_000)
        expect(summary.loanAvailable).toBe(50_000)
    })
})

/** The one bit of bank state the rest of the app sees: the sidebar's red wallet. */
describe.skipIf(SKIP)('sidebar debt flag', () => {
    beforeEach(() => cleanupUser(USER_ID))
    afterEach(() => cleanupUser(USER_ID))

    const flagFor = async () => {
        const state = await getBankState(USER_ID)
        const bailout = bailoutStateOf(state)
        const balance = growBankBalance(parseFloat(state.balance), state.lastSettledAt, new Date(), bailout)
        return balance < 0 || isBailoutActive(bailout)
    }

    it('is set while an ordinary debt is open and clear once savings are positive', async () => {
        await seedUser(USER_ID)
        await seedBankState(USER_ID, { balance: '-500.0000', loanPrincipal: '500.0000' })
        expect(await flagFor()).toBe(true)

        await seedBankState(USER_ID, { balance: '500.0000', loanPrincipal: '0.0000' })
        expect(await flagFor()).toBe(false)
    })

    it('stays set through a bail-out, since the lifted debt is still owed', async () => {
        await seedUser(USER_ID)
        await seedBankState(USER_ID, {
            balance: '0.0000',
            bailoutAt: new Date(),
            bailoutUntil: new Date(Date.now() + BAILOUT_LOCKOUT_MS),
            bailoutDebt: '1000.0000',
            bailoutRepaid: '250.0000'
        })

        expect(await flagFor()).toBe(true)
    })

    it('clears once the bail-out is repaid in full', async () => {
        await seedUser(USER_ID)
        await seedBankState(USER_ID, {
            balance: '0.0000',
            bailoutAt: new Date(),
            bailoutUntil: null,
            bailoutDebt: '1000.0000',
            bailoutRepaid: '1000.0000'
        })

        expect(await flagFor()).toBe(false)
    })

    it('clears once the 30-day term lapses with a remainder written off', async () => {
        await seedUser(USER_ID)
        await seedBankState(USER_ID, {
            balance: '0.0000',
            bailoutAt: new Date(Date.now() - BAILOUT_LOCKOUT_MS - DAY),
            bailoutUntil: new Date(Date.now() - DAY),
            bailoutDebt: '1000.0000',
            bailoutRepaid: '120.0000'
        })

        expect(await flagFor()).toBe(false)
    })
})
