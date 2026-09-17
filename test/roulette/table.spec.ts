/**
 * Smoke test driving RouletteTable directly: players bet, the round resolves
 * off a real server-chosen pocket, and balances move by exactly what
 * resolveBets says they should. The winning number is not mocked — it comes
 * from the table's own #shared/utils/random roll, and the test prices it
 * after the fact rather than pretending to control it.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tableWagers } from '#server/database/schema'
import { debit, getBalance } from '#server/utils/balance'
import { RouletteTable } from '#server/utils/live-table/roulette'
import { resolveBets } from '#shared/utils/roulette/resolve'
import type { RouletteSeatState } from '#shared/utils/roulette/types'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const USER_A = 'test-roulette-user-a'
const USER_B = 'test-roulette-user-b'
const GAME = 'roulette'

class TestRouletteTable extends RouletteTable {
    forcePhaseEnd(phase: string) {
        return this.onPhaseEnd(phase)
    }

    currentPhase() {
        return this.phase
    }

    seatOf(userId: string): RouletteSeatState | undefined {
        return this.playerOf(userId)?.game
    }

    // Cancels whatever real setTimeout the last advance() left running, so a
    // stale timer cannot fire into a closed database pool once the test ends.
    stop() {
        this.setPhase('idle', null)
    }
}

async function bet(table: TestRouletteTable, userId: string, key: string, amount: number) {
    await table.run(() => table.action(userId, { type: 'bet', key, amount }))
}

async function undo(table: TestRouletteTable, userId: string) {
    await table.run(() => table.action(userId, { type: 'undo' }))
}

async function repeat(table: TestRouletteTable, userId: string) {
    await table.run(() => table.action(userId, { type: 'repeat' }))
}

async function scale(table: TestRouletteTable, userId: string, factor: 0.5 | 2) {
    await table.run(() => table.action(userId, { type: 'scale', factor }))
}

async function clear(table: TestRouletteTable, userId: string) {
    await table.run(() => table.action(userId, { type: 'clear' }))
}

async function endPhase(table: TestRouletteTable, phase: string) {
    await table.run(() => table.forcePhaseEnd(phase))
}

async function wagerRows(userId: string) {
    return db.select({ settled: tableWagers.settled })
        .from(tableWagers)
        .where(and(eq(tableWagers.userId, userId), eq(tableWagers.game, GAME)))
}

async function cleanup() {
    await db.delete(tableWagers).where(eq(tableWagers.game, GAME))
    await cleanupUser(USER_A)
    await cleanupUser(USER_B)
}

describe.skipIf(SKIP)('RouletteTable', () => {
    let table: TestRouletteTable

    beforeEach(async () => {
        await cleanup()
        await seedUser(USER_A, { balance: '10000.0000' })
        await seedUser(USER_B, { balance: '10000.0000' })
        table = new TestRouletteTable()
    })
    afterEach(async () => {
        table.stop()
        await cleanup()
    })
    afterAll(async () => { await db.$client.end() })

    it('registers a first-time bettor and opens betting on an idle table', async () => {
        expect(table.currentPhase()).toBe('idle')

        await bet(table, USER_A, 'straight:17', 100)

        expect(table.currentPhase()).toBe('betting')
        expect(await getBalance(USER_A)).toBe('9900.0000')
    })

    it('rejects a bet below the table minimum without touching the balance', async () => {
        await expect(bet(table, USER_A, 'red', 1)).rejects.toThrow(/minimum/i)
        expect(await getBalance(USER_A)).toBe('10000.0000')
    })

    it('rejects a bet key that is not on the layout', async () => {
        await expect(bet(table, USER_A, 'not-a-real-bet', 100)).rejects.toThrow(/invalid bet/i)
    })

    it('accumulates repeated bets on the same spot', async () => {
        await bet(table, USER_A, 'red', 100)
        await bet(table, USER_A, 'red', 50)

        expect(table.snapshot().game.bets).toEqual([
            { userId: USER_A, name: 'concurrency test user', color: expect.any(String), key: 'red', amount: 150 }
        ])
    })

    it('closes betting once the phase advances', async () => {
        await bet(table, USER_A, 'red', 100)
        await endPhase(table, 'betting')
        expect(table.currentPhase()).toBe('nomorebets')

        await expect(bet(table, USER_A, 'black', 100)).rejects.toThrow(/closed/i)
    })

    it('resolves a full round and pays every seat exactly what resolveBets says it is owed', async () => {
        await bet(table, USER_A, 'straight:17', 100)
        await bet(table, USER_B, 'red', 50)
        await bet(table, USER_B, 'black', 50)

        await endPhase(table, 'betting')
        await endPhase(table, 'nomorebets')

        const winningNumber = table.snapshot().game.result
        expect(winningNumber).toBeGreaterThanOrEqual(0)
        expect(winningNumber).toBeLessThanOrEqual(36)

        await endPhase(table, 'spinning')

        const expectedA = resolveBets([{ key: 'straight:17', amount: 100 }], winningNumber!)
        const expectedB = resolveBets([{ key: 'red', amount: 50 }, { key: 'black', amount: 50 }], winningNumber!)

        expect(await getBalance(USER_A)).toBe((10000 - 100 + expectedA.totalPayout).toFixed(4))
        expect(await getBalance(USER_B)).toBe((10000 - 100 + expectedB.totalPayout).toFixed(4))

        expect(table.snapshot().game.lastNumbers[0]).toBe(winningNumber)
        expect((await wagerRows(USER_A)).every(r => r.settled)).toBe(true)
        expect((await wagerRows(USER_B)).every(r => r.settled)).toBe(true)
    })

    it('clears every bet slip and reopens betting for the next round', async () => {
        await bet(table, USER_A, 'straight:17', 100)
        await endPhase(table, 'betting')
        await endPhase(table, 'nomorebets')
        await endPhase(table, 'spinning')
        await endPhase(table, 'payout')

        expect(table.snapshot().game.bets).toEqual([])
        expect(table.snapshot().game.result).toBeNull()
        expect(table.currentPhase()).toBe('betting')

        // The cleared slip means a second round bets and settles independently.
        await bet(table, USER_A, 'black', 200)
        expect(table.snapshot().game.bets).toEqual([
            { userId: USER_A, name: 'concurrency test user', color: expect.any(String), key: 'black', amount: 200 }
        ])
    })

    it('sends the table idle once the only player leaves with nothing staked', async () => {
        await bet(table, USER_A, 'straight:17', 100)
        await endPhase(table, 'betting')
        await endPhase(table, 'nomorebets')
        await endPhase(table, 'spinning')

        table.leave(USER_A)

        expect(table.currentPhase()).toBe('idle')
    })

    it('undoes the most recent bet and refunds exactly that stake', async () => {
        await bet(table, USER_A, 'red', 100)
        await bet(table, USER_A, 'black', 50)

        await undo(table, USER_A)

        expect(await getBalance(USER_A)).toBe('9900.0000')
        expect(table.seatOf(USER_A)?.bets).toEqual({ red: 100 })
    })

    it('only undoes the amount of the last bet when the same spot was raised twice', async () => {
        await bet(table, USER_A, 'red', 100)
        await bet(table, USER_A, 'red', 50)

        await undo(table, USER_A)

        expect(await getBalance(USER_A)).toBe('9900.0000')
        expect(table.seatOf(USER_A)?.bets).toEqual({ red: 100 })
    })

    it('rejects undo once every bet this round is already undone', async () => {
        await bet(table, USER_A, 'red', 100)
        await undo(table, USER_A)

        await expect(undo(table, USER_A)).rejects.toThrow(/nothing to undo/i)
    })

    it('rejects repeat with no previous round to draw from', async () => {
        await expect(repeat(table, USER_A)).rejects.toThrow(/no previous bet/i)
    })

    it('repeats the exact bet slip from the last round a player bet in', async () => {
        await bet(table, USER_A, 'straight:17', 100)
        await bet(table, USER_A, 'red', 50)
        await endPhase(table, 'betting')
        await endPhase(table, 'nomorebets')
        await endPhase(table, 'spinning')
        await endPhase(table, 'payout')

        const balanceAfterFirstRound = Number(await getBalance(USER_A))
        await repeat(table, USER_A)

        expect(table.seatOf(USER_A)?.bets).toEqual({ 'straight:17': 100, red: 50 })
        expect(await getBalance(USER_A)).toBe((balanceAfterFirstRound - 150).toFixed(4))
    })

    it('doubles every current bet by staking the same amounts again', async () => {
        await bet(table, USER_A, 'red', 100)
        await bet(table, USER_A, 'black', 50)

        await scale(table, USER_A, 2)

        expect(table.seatOf(USER_A)?.bets).toEqual({ red: 200, black: 100 })
        expect(await getBalance(USER_A)).toBe('9700.0000')
    })

    it('halves every current bet, refunding exactly the difference', async () => {
        await bet(table, USER_A, 'red', 100)
        await bet(table, USER_A, 'black', 50)

        await scale(table, USER_A, 0.5)

        expect(table.seatOf(USER_A)?.bets).toEqual({ red: 50, black: 25 })
        expect(await getBalance(USER_A)).toBe('9925.0000')
    })

    it('refuses to halve a bet below the table minimum, leaving the slip untouched', async () => {
        await bet(table, USER_A, 'red', 25)

        await expect(scale(table, USER_A, 0.5)).rejects.toThrow(/minimum/i)

        expect(table.seatOf(USER_A)?.bets).toEqual({ red: 25 })
        expect(await getBalance(USER_A)).toBe('9975.0000')
    })

    it('scales last round\'s bet when nothing is staked yet this round', async () => {
        await bet(table, USER_A, 'red', 100)
        await endPhase(table, 'betting')
        await endPhase(table, 'nomorebets')
        await endPhase(table, 'spinning')
        await endPhase(table, 'payout')

        const balanceAfterFirstRound = Number(await getBalance(USER_A))
        await scale(table, USER_A, 2)

        expect(table.seatOf(USER_A)?.bets).toEqual({ red: 200 })
        expect(await getBalance(USER_A)).toBe((balanceAfterFirstRound - 200).toFixed(4))
    })

    it('rejects scale with no current or previous bet to size', async () => {
        // Registered but empty, rather than never having bet at all, so the
        // failure exercises the "nothing to scale" check and not "not at this table".
        await bet(table, USER_A, 'red', 100)
        await undo(table, USER_A)

        await expect(scale(table, USER_A, 2)).rejects.toThrow(/no bets to scale/i)
    })

    it('clears every staked bet and refunds all of it', async () => {
        await bet(table, USER_A, 'red', 100)
        await bet(table, USER_A, 'black', 50)

        await clear(table, USER_A)

        expect(table.seatOf(USER_A)?.bets).toEqual({})
        expect(await getBalance(USER_A)).toBe('10000.0000')
    })

    it('rejects clear with nothing staked', async () => {
        await bet(table, USER_A, 'red', 100)
        await undo(table, USER_A)

        await expect(clear(table, USER_A)).rejects.toThrow(/nothing to clear/i)
    })

    it('rolls back every leg of a repeat that runs out of balance partway through', async () => {
        await bet(table, USER_A, 'red', 60)
        await bet(table, USER_A, 'black', 60)
        await endPhase(table, 'betting')
        await endPhase(table, 'nomorebets')
        await endPhase(table, 'spinning')
        await endPhase(table, 'payout')

        // Enough for one leg of the 120 total repeat, not both.
        const remaining = Number(await getBalance(USER_A))
        await debit(USER_A, (remaining - 90).toFixed(4), 'test-drain')

        await expect(repeat(table, USER_A)).rejects.toThrow(/insufficient/i)

        expect(await getBalance(USER_A)).toBe('90.0000')
        expect(table.seatOf(USER_A)?.bets).toEqual({})
    })
})
