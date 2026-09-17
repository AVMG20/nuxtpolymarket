/**
 * The bank's cut of incoming earnings, exercised through credit() itself rather
 * than the math helpers — the wallet, the bank row and the ledger all have to
 * agree, and that only happens end to end.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { transactions } from '#server/database/schema'
import { credit, getBalance } from '#server/utils/balance'
import { BAILOUT_LOCKOUT_MS } from '#shared/utils/gamelogic/bank'
import { SKIP, burst, cleanupUser, getBankState, seedBankState, seedUser } from '../setup/db-helpers'

const USER_ID = 'test-bank-garnish-user'

const inDebt = (debt: number) => seedBankState(USER_ID, {
    balance: (-debt).toFixed(4),
    maxPrincipal: '10000.0000',
    loanPrincipal: debt.toFixed(4)
})

const inBailout = (debt: number, repaid = 0) => seedBankState(USER_ID, {
    balance: '0.0000',
    bailoutAt: new Date(),
    bailoutUntil: new Date(Date.now() + BAILOUT_LOCKOUT_MS),
    bailoutDebt: debt.toFixed(4),
    bailoutRepaid: repaid.toFixed(4)
})

const garnishRows = () => db.select().from(transactions)
    .where(and(eq(transactions.userId, USER_ID), eq(transactions.category, 'bank:garnish')))

// One pool for the file: closing it inside a suite would strand the next one.
afterAll(async () => { if (!SKIP) await db.$client.end() })

describe.skipIf(SKIP)('debt garnish on credit()', () => {
    beforeEach(() => cleanupUser(USER_ID))
    afterEach(() => cleanupUser(USER_ID))

    it('diverts 10% of an earning to the debt and pays the player the rest', async () => {
        await seedUser(USER_ID)
        await inDebt(1_000)

        await credit(USER_ID, '500.0000', 'miner')

        expect(parseFloat(await getBalance(USER_ID))).toBeCloseTo(450, 4)
        expect(parseFloat((await getBankState(USER_ID)).balance)).toBeCloseTo(-950, 4)
    })

    it('leaves a solvent player untouched', async () => {
        await seedUser(USER_ID)
        await seedBankState(USER_ID, { balance: '2500.0000', principal: '2500.0000', maxPrincipal: '2500.0000' })

        await credit(USER_ID, '500.0000', 'miner')

        expect(parseFloat(await getBalance(USER_ID))).toBeCloseTo(500, 4)
        expect(parseFloat((await getBankState(USER_ID)).balance)).toBeCloseTo(2500, 4)
        expect(await garnishRows()).toHaveLength(0)
    })

    it('does nothing for a player who has never used the bank', async () => {
        await seedUser(USER_ID)

        await credit(USER_ID, '500.0000', 'miner')

        expect(parseFloat(await getBalance(USER_ID))).toBeCloseTo(500, 4)
    })

    it('never takes more than the debt and clears the loan principal when it lands on zero', async () => {
        await seedUser(USER_ID)
        await inDebt(30)

        await credit(USER_ID, '10000.0000', 'pirates')

        const state = await getBankState(USER_ID)
        expect(parseFloat(state.balance)).toBe(0)
        expect(parseFloat(state.loanPrincipal)).toBe(0)
        expect(parseFloat(await getBalance(USER_ID))).toBeCloseTo(9_970, 4)
    })

    it('exempts refunds, escrow returns and crash recovery — money the player already owned', async () => {
        await seedUser(USER_ID)
        await inDebt(1_000)

        await credit(USER_ID, '100.0000', 'shapezz:weapon-refund')
        await credit(USER_ID, '100.0000', 'live-blackjack:recovery')
        await credit(USER_ID, '100.0000', 'bank')

        expect(parseFloat(await getBalance(USER_ID))).toBeCloseTo(300, 4)
        expect(parseFloat((await getBankState(USER_ID)).balance)).toBeCloseTo(-1_000, 4)
        expect(await garnishRows()).toHaveLength(0)
    })

    it('writes one garnish ledger row per garnished credit', async () => {
        await seedUser(USER_ID)
        await inDebt(1_000)

        await credit(USER_ID, '100.0000', 'miner')
        await credit(USER_ID, '100.0000', 'colony')

        const rows = await garnishRows()
        expect(rows).toHaveLength(2)
        expect(rows.every(row => row.type === 'debit' && parseFloat(row.amount) === 10)).toBe(true)
    })

    it('cannot overpay the debt under a concurrent burst of credits', async () => {
        await seedUser(USER_ID)
        await inDebt(50)

        // Ten parallel 1000 wins: 10% of each is 100, far past the 50 owed.
        await burst(10, () => credit(USER_ID, '1000.0000', 'miner'))

        const state = await getBankState(USER_ID)
        expect(parseFloat(state.balance)).toBe(0)
        expect(parseFloat(state.loanPrincipal)).toBe(0)

        const taken = (await garnishRows()).reduce((sum, row) => sum + parseFloat(row.amount), 0)
        expect(taken).toBeCloseTo(50, 4)
        expect(parseFloat(await getBalance(USER_ID))).toBeCloseTo(10_000 - 50, 4)
    })

    it('keeps the wallet and the bank in step across a burst that only partly repays', async () => {
        await seedUser(USER_ID)
        await inDebt(10_000)

        await burst(10, () => credit(USER_ID, '100.0000', 'miner'))

        const state = await getBankState(USER_ID)
        // Debt accrues at 7% daily; over a test's lifetime that is far below a cent.
        expect(parseFloat(state.balance)).toBeCloseTo(-9_900, 2)
        expect(parseFloat(await getBalance(USER_ID))).toBeCloseTo(900, 4)
    })
})

describe.skipIf(SKIP)('bail-out levy on credit()', () => {
    beforeEach(() => cleanupUser(USER_ID))
    afterEach(() => cleanupUser(USER_ID))

    it('takes 40% of every earning while the penalty runs', async () => {
        await seedUser(USER_ID)
        await inBailout(100_000)

        await credit(USER_ID, '1000.0000', 'miner')

        const state = await getBankState(USER_ID)
        expect(parseFloat(state.bailoutRepaid)).toBeCloseTo(400, 4)
        expect(parseFloat(state.balance)).toBe(0)
        expect(parseFloat(await getBalance(USER_ID))).toBeCloseTo(600, 4)
    })

    it('stops at the remainder and ends the penalty once the lifted debt is settled', async () => {
        await seedUser(USER_ID)
        await inBailout(1_000, 950)

        await credit(USER_ID, '1000.0000', 'miner')

        const state = await getBankState(USER_ID)
        expect(parseFloat(state.bailoutRepaid)).toBeCloseTo(1_000, 4)
        expect(state.bailoutUntil).toBeNull()
        // Only the outstanding 50 was taken, not a full 40% of the win.
        expect(parseFloat(await getBalance(USER_ID))).toBeCloseTo(950, 4)

        // Penalty over: the next win is clean.
        await credit(USER_ID, '100.0000', 'miner')
        expect(parseFloat(await getBalance(USER_ID))).toBeCloseTo(1_050, 4)
    })

    it('stops levying once the term has lapsed, writing off the remainder', async () => {
        await seedUser(USER_ID)
        await seedBankState(USER_ID, {
            balance: '0.0000',
            bailoutAt: new Date(Date.now() - BAILOUT_LOCKOUT_MS - 86_400_000),
            bailoutUntil: new Date(Date.now() - 86_400_000),
            bailoutDebt: '100000.0000',
            bailoutRepaid: '2500.0000'
        })

        await credit(USER_ID, '1000.0000', 'miner')

        expect(parseFloat(await getBalance(USER_ID))).toBeCloseTo(1_000, 4)
        expect(parseFloat((await getBankState(USER_ID)).bailoutRepaid)).toBeCloseTo(2_500, 4)
    })

    it('cannot overpay the lifted debt under a concurrent burst', async () => {
        await seedUser(USER_ID)
        await inBailout(200)

        await burst(10, () => credit(USER_ID, '1000.0000', 'miner'))

        const state = await getBankState(USER_ID)
        expect(parseFloat(state.bailoutRepaid)).toBeCloseTo(200, 4)
        expect(state.bailoutUntil).toBeNull()
        expect(parseFloat(await getBalance(USER_ID))).toBeCloseTo(10_000 - 200, 4)
    })
})
