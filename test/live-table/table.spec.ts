/**
 * Contract tests for the LiveTable base class. Every table game inherits its
 * money handling from here, so these cover the guarantees the games are
 * allowed to assume rather than any particular game's rules.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tableWagers } from '#server/database/schema'
import { getBalance } from '#server/utils/balance'
import { LiveTable, round4 } from '#server/utils/live-table/table'
import type { LtConfig, LtPlayer } from '#server/utils/live-table/table'
import type { LtPayout } from '#shared/utils/live-table/types'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

// Unique per run: several worktrees run this suite against the same local
// Postgres at once, and a fixed id makes them collide on the seed insert.
const RUN = crypto.randomUUID().slice(0, 8)
const USER_ID = `test-live-table-user-${RUN}`
const GAME = `test-table-game-${RUN}`

interface SeatState {
    bet: number
}

/** The smallest possible subclass: just enough to exercise the base. */
class TestTable extends LiveTable<SeatState, { spun: boolean }, { t: 'noop' }> {
    protected readonly config: LtConfig = {
        game: GAME,
        seats: 5,
        minBet: 1,
        maxBet: 1_000_000,
        disconnectGrace: 60_000,
        disconnectGraceIdle: 5_000
    }

    spun = false
    phaseEnded: string[] = []

    protected createSeatState(): SeatState {
        return { bet: 0 }
    }

    protected gameState() {
        return { spun: this.spun }
    }

    protected onAction() {}

    protected onPhaseEnd(phase: string) {
        this.phaseEnded.push(phase)
    }

    protected onTableActive() {
        this.setPhase('betting', null)
    }

    // Test seams onto the protected money API.
    player(userId: string) {
        return this.playerOf(userId) as LtPlayer<SeatState>
    }

    testStake(userId: string, amount: number, kind = 'bet') {
        return this.stake(this.player(userId), amount, kind)
    }

    testSettle(payouts: LtPayout[]) {
        return this.settle(payouts)
    }

    testAbort() {
        return this.abortRound()
    }

    currentPhase() {
        return this.phase
    }
}

async function wagerRows(userId: string) {
    return db.select({ settled: tableWagers.settled, amount: tableWagers.amount })
        .from(tableWagers)
        .where(and(eq(tableWagers.userId, userId), eq(tableWagers.game, GAME)))
}

async function cleanup() {
    await db.delete(tableWagers).where(eq(tableWagers.userId, USER_ID))
    await cleanupUser(USER_ID)
}

describe.skipIf(SKIP)('LiveTable', () => {
    let table: TestTable

    beforeEach(async () => {
        await cleanup()
        table = new TestTable()
    })
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    it('debits the stake and writes an unsettled escrow row in one transaction', async () => {
        await seedUser(USER_ID, { balance: '1000.0000' })
        await table.sit(USER_ID, 'tester', null, 0)

        await table.testStake(USER_ID, 250)

        expect(await getBalance(USER_ID)).toBe('750.0000')
        expect(await wagerRows(USER_ID)).toEqual([{ settled: false, amount: '250.0000' }])
    })

    it('refuses to seat a player who cannot cover the minimum bet', async () => {
        await seedUser(USER_ID, { balance: '0.0000' })

        await expect(table.sit(USER_ID, 'tester', null, 0)).rejects.toThrow(/at least/)
    })

    it('credits the payout and closes the escrow on settle', async () => {
        await seedUser(USER_ID, { balance: '1000.0000' })
        await table.sit(USER_ID, 'tester', null, 0)
        await table.testStake(USER_ID, 100)

        await table.testSettle([{ userId: USER_ID, staked: 100, payout: 250 }])

        expect(await getBalance(USER_ID)).toBe('1150.0000')
        expect(await wagerRows(USER_ID)).toEqual([{ settled: true, amount: '100.0000' }])
    })

    it('pays a losing round nothing but still closes its escrow', async () => {
        await seedUser(USER_ID, { balance: '1000.0000' })
        await table.sit(USER_ID, 'tester', null, 0)
        await table.testStake(USER_ID, 100)

        await table.testSettle([{ userId: USER_ID, staked: 100, payout: 0 }])

        expect(await getBalance(USER_ID)).toBe('900.0000')
        expect((await wagerRows(USER_ID))[0]!.settled).toBe(true)
    })

    it('does not pay twice when the same round is settled again', async () => {
        await seedUser(USER_ID, { balance: '1000.0000' })
        await table.sit(USER_ID, 'tester', null, 0)
        await table.testStake(USER_ID, 100)

        const payout: LtPayout[] = [{ userId: USER_ID, staked: 100, payout: 200 }]
        await table.testSettle(payout)
        // Replaying the same settle is what a retry after a transient failure
        // looks like; the escrow claim is what has to stop it.
        await table.testSettle(payout)

        expect(await getBalance(USER_ID)).toBe('1100.0000')
    })

    it('refunds every stake when a round is aborted', async () => {
        await seedUser(USER_ID, { balance: '1000.0000' })
        await table.sit(USER_ID, 'tester', null, 0)
        await table.testStake(USER_ID, 300)

        await table.testAbort()

        expect(await getBalance(USER_ID)).toBe('1000.0000')
        expect((await wagerRows(USER_ID))[0]!.settled).toBe(true)
    })

    it('does not refund a stake the abort already handed back', async () => {
        await seedUser(USER_ID, { balance: '1000.0000' })
        await table.sit(USER_ID, 'tester', null, 0)
        await table.testStake(USER_ID, 300)

        await table.testAbort()
        await table.testAbort()

        expect(await getBalance(USER_ID)).toBe('1000.0000')
    })

    it('holds the seat of a player who asks to leave with money staked', async () => {
        await seedUser(USER_ID, { balance: '1000.0000' })
        await table.sit(USER_ID, 'tester', null, 0)
        await table.testStake(USER_ID, 100)

        table.leave(USER_ID)

        expect(table.snapshot().seats[0]?.leaving).toBe(true)
        expect(table.snapshot().seats[0]?.userId).toBe(USER_ID)
    })

    it('frees that seat once the round settles', async () => {
        await seedUser(USER_ID, { balance: '1000.0000' })
        await table.sit(USER_ID, 'tester', null, 0)
        await table.testStake(USER_ID, 100)
        table.leave(USER_ID)

        await table.testSettle([{ userId: USER_ID, staked: 100, payout: 100 }])

        expect(table.snapshot().seats[0]).toBeNull()
    })

    it('serializes concurrent mutations through the run chain', async () => {
        await seedUser(USER_ID, { balance: '1000.0000' })
        await table.sit(USER_ID, 'tester', null, 0)

        // Ten stakes fired at once. Serialized, every one lands; interleaved,
        // the balance reads would collide.
        await Promise.all(Array.from({ length: 10 }, () => table.run(() => table.testStake(USER_ID, 50))))

        expect(await getBalance(USER_ID)).toBe('500.0000')
        expect(await wagerRows(USER_ID)).toHaveLength(10)
    })

    it('rejects a stake a player cannot afford without writing escrow', async () => {
        await seedUser(USER_ID, { balance: '50.0000' })
        await table.sit(USER_ID, 'tester', null, 0)

        await expect(table.testStake(USER_ID, 500)).rejects.toThrow()

        expect(await getBalance(USER_ID)).toBe('50.0000')
        expect(await wagerRows(USER_ID)).toHaveLength(0)
    })

    it('tracks streaks across rounds, holding on a push', async () => {
        await seedUser(USER_ID, { balance: '10000.0000' })
        await table.sit(USER_ID, 'tester', null, 0)

        await table.testStake(USER_ID, 100)
        await table.testSettle([{ userId: USER_ID, staked: 100, payout: 200 }])
        expect(table.player(USER_ID).winStreak).toBe(1)

        await table.testStake(USER_ID, 100)
        await table.testSettle([{ userId: USER_ID, staked: 100, payout: 100 }])
        expect(table.player(USER_ID).winStreak).toBe(1)

        await table.testStake(USER_ID, 100)
        await table.testSettle([{ userId: USER_ID, staked: 100, payout: 0 }])
        expect(table.player(USER_ID).winStreak).toBe(0)
    })

    it('goes idle when the last player leaves', async () => {
        await seedUser(USER_ID, { balance: '1000.0000' })
        await table.sit(USER_ID, 'tester', null, 0)
        expect(table.currentPhase()).toBe('betting')

        table.leave(USER_ID)

        expect(table.currentPhase()).toBe('idle')
    })

    it('rounds money to four places, matching the numeric column', () => {
        expect(round4(0.1 + 0.2)).toBe(0.3)
        expect(round4(1 / 3)).toBe(0.3333)
    })
})
