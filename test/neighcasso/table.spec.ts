/**
 * Drives NeighcassoTable directly against the local Postgres: horses enter,
 * bets are taken only when the gates close, and the pot moves to exactly one
 * player. Skips when DATABASE_URL is not local.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { neighcassoHorses, tableWagers, user } from '#server/database/schema'
import { debit, getBalance } from '#server/utils/balance'
import { NeighcassoTable } from '#server/utils/live-table/neighcasso'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const USER_A = 'test-neighcasso-user-a'
const USER_B = 'test-neighcasso-user-b'
const USER_C = 'test-neighcasso-user-c'
const USERS = [USER_A, USER_B, USER_C]
const GAME = 'neighcasso'
const DRAWING = { v: 1 as const, strokes: [{ k: 'body' as const, c: '#000000', w: 4, p: [10, 10, 50, 50] }] }

class TestTable extends NeighcassoTable {
    endPhase(phase: string) {
        return this.run(() => this.onPhaseEnd(phase))
    }

    currentPhase() {
        return this.phase
    }

    stop() {
        this.setPhase('idle', null)
    }
}

async function horseFor(userId: string) {
    const [row] = await db.insert(neighcassoHorses).values({ userId, name: `${userId} horse`, drawing: DRAWING }).returning()
    return row!.id
}

async function enter(table: TestTable, userId: string, seat: number, bet: number) {
    const horseId = await horseFor(userId)
    await table.run(() => table.sit(userId, userId, null, seat))
    await table.run(() => table.action(userId, { type: 'horse', horseId }))
    await table.run(() => table.action(userId, { type: 'bet', amount: bet }))
    await table.run(() => table.voteStart(userId))
    return horseId
}

async function unsettled() {
    return db.select().from(tableWagers).where(and(eq(tableWagers.game, GAME), eq(tableWagers.settled, false)))
}

async function cleanup() {
    await db.delete(tableWagers).where(eq(tableWagers.game, GAME))
    for (const id of USERS) {
        await db.delete(neighcassoHorses).where(eq(neighcassoHorses.userId, id))
        await cleanupUser(id)
    }
}

describe.skipIf(SKIP)('NeighcassoTable', () => {
    let table: TestTable

    beforeEach(async () => {
        await cleanup()
        for (const id of USERS) await seedUser(id, { balance: '1000.0000' })
        table = new TestTable()
    })
    afterEach(async () => {
        table.stop()
        await cleanup()
    })
    afterAll(async () => { await db.$client.end() })

    it('takes nothing while the lobby waits, matches bets to the smallest, and pays the pot to one horse', async () => {
        const horseA = await enter(table, USER_A, 0, 100)
        const horseB = await enter(table, USER_B, 3, 300)

        expect(await getBalance(USER_A)).toBe('1000.0000')
        expect(table.currentPhase()).toBe('lobby')
        expect(table.snapshot().game.matched).toBe(100)
        expect(table.snapshot().game.pot).toBe(200)

        await table.endPhase('lobby')
        expect(table.currentPhase()).toBe('gates')
        // B bet 300 but only the matched 100 is taken.
        expect(await getBalance(USER_A)).toBe('900.0000')
        expect(await getBalance(USER_B)).toBe('900.0000')
        const race = table.snapshot().game.race!
        expect(race.lanes.map(l => l.seat).sort()).toEqual([0, 3])

        await table.endPhase('gates')
        expect(table.currentPhase()).toBe('racing')
        await expect(table.run(() => table.sit(USER_C, USER_C, null, 1))).rejects.toThrow(/next one/i)

        await table.endPhase('racing')
        const result = table.snapshot().game.result!
        expect(result.winnerSeat).toBe(race.winnerSeat)
        expect(result.pot).toBe(200)
        expect(result.odds).toBe(0.5)
        const a = Number(await getBalance(USER_A))
        const b = Number(await getBalance(USER_B))
        expect(a + b).toBe(2000)
        expect(result.winnerSeat === 0 ? a : b).toBe(1100)
        expect(table.snapshot().seats[result.winnerSeat]!.game.horseWins).toBe(1)
        expect(await unsettled()).toEqual([])

        const [winnerHorse] = await db.select().from(neighcassoHorses)
            .where(eq(neighcassoHorses.id, result.winnerSeat === 0 ? horseA : horseB))
        await new Promise(r => setTimeout(r, 50))
        const [after] = await db.select().from(neighcassoHorses).where(eq(neighcassoHorses.id, winnerHorse!.id))
        expect(after!.races).toBe(1)
        expect(after!.wins).toBe(1)

        await table.endPhase('finish')
        expect(table.currentPhase()).toBe('lobby')
        expect(table.snapshot().game.race).toBeNull()
        // Horse and bet stay for a quick rematch; Ready does not.
        const seat = table.snapshot().seats[0]!
        expect(seat.game.bet).toBe(100)
        expect(seat.votedStart).toBe(false)
    })

    it('scratches a horse whose owner went broke, and refunds when too few can run', async () => {
        await enter(table, USER_A, 0, 100)
        await enter(table, USER_B, 1, 500)
        await debit(USER_B, '950.0000')

        await table.endPhase('lobby')

        expect(table.currentPhase()).toBe('lobby')
        expect(await getBalance(USER_A)).toBe('1000.0000')
        expect(await unsettled()).toEqual([])
    })

    it('scratches stragglers when the hurry clock runs out', async () => {
        await enter(table, USER_A, 0, 100)
        await enter(table, USER_B, 1, 100)
        await table.run(() => table.sit(USER_C, USER_C, null, 2))
        expect(table.snapshot().phaseEndsAt).not.toBeNull()

        await table.endPhase('lobby')

        expect(table.currentPhase()).toBe('gates')
        expect(table.snapshot().seats[2]).toBeNull()
        expect(await getBalance(USER_C)).toBe('1000.0000')
    })

    it('will not race someone else\'s horse or a bet the player cannot afford', async () => {
        const other = await horseFor(USER_B)
        await table.run(() => table.sit(USER_A, USER_A, null, 0))
        await expect(table.run(() => table.action(USER_A, { type: 'horse', horseId: other }))).rejects.toThrow(/stable/i)
        await expect(table.run(() => table.action(USER_A, { type: 'bet', amount: 5000 }))).rejects.toThrow(/afford/i)
        await expect(table.run(() => table.voteStart(USER_A))).rejects.toThrow(/horse/i)
    })

    it('races a lone player against bots and keeps the 1% fee off a win', async () => {
        await table.run(() => table.sit(USER_A, USER_A, null, 0))
        await table.run(() => table.action(USER_A, { type: 'bots', count: 3 }))
        await enter(table, USER_A, 0, 200)
        expect(table.currentPhase()).toBe('lobby')
        expect(table.snapshot().game.bots.map(b => [b.seat, b.bet])).toEqual([[3, 200], [4, 200], [5, 200]])
        expect(table.snapshot().game.pot).toBe(800)

        await table.endPhase('lobby')
        expect(await getBalance(USER_A)).toBe('800.0000')
        expect(table.snapshot().game.race!.lanes.map(l => l.seat)).toEqual([0, 3, 4, 5])
        await table.endPhase('gates')
        await table.endPhase('racing')

        const result = table.snapshot().game.result!
        if (result.botWon) {
            expect(result.payout).toBe(0)
            expect(await getBalance(USER_A)).toBe('800.0000')
        } else {
            expect(result.payout).toBe(792)
            expect(await getBalance(USER_A)).toBe('1592.0000')
        }
        expect(await unsettled()).toEqual([])
    })

    it('lets a human take a bot\'s gate, and keeps the changer ready when bots change', async () => {
        await table.run(() => table.sit(USER_A, USER_A, null, 0))
        await table.run(() => table.action(USER_A, { type: 'bots', count: 5 }))
        expect(table.snapshot().game.bots.map(b => b.seat)).toEqual([1, 2, 3, 4, 5])
        await enter(table, USER_B, 5, 100)
        expect(table.snapshot().game.bots.map(b => b.seat)).toEqual([1, 2, 3, 4])

        await table.run(() => table.action(USER_B, { type: 'bot', seat: 2, on: false }))
        expect(table.snapshot().game.bots.map(b => b.seat)).toEqual([1, 3, 4])
        expect(table.snapshot().seats[5]!.votedStart).toBe(true)

        await table.run(() => table.voteStart(USER_B))
        await table.run(() => table.action(USER_A, { type: 'bot', seat: 2, on: true }))
        expect(table.snapshot().seats[5]!.votedStart).toBe(false)
        await expect(table.run(() => table.action(USER_A, { type: 'bot', seat: 0, on: true }))).rejects.toThrow(/taken/i)
        await expect(table.run(() => table.action(USER_A, { type: 'bots', count: 9 }))).rejects.toThrow(/bots/i)
    })

    it('starts a solo race as soon as a ready player adds a bot', async () => {
        await enter(table, USER_A, 0, 100)
        expect(table.snapshot().phaseEndsAt).toBeNull()
        await table.run(() => table.action(USER_A, { type: 'bot', seat: 3, on: true }))
        expect(table.snapshot().seats[0]!.votedStart).toBe(true)
        expect(table.snapshot().phaseEndsAt).not.toBeNull()
        await table.endPhase('lobby')
        expect(table.currentPhase()).toBe('gates')
    })

    it('un-readies a player who changes their bet', async () => {
        await enter(table, USER_A, 0, 100)
        await enter(table, USER_B, 1, 100)
        await table.run(() => table.action(USER_A, { type: 'bet', amount: 200 }))
        expect(table.snapshot().seats[0]!.votedStart).toBe(false)
        const [row] = await db.select({ balance: user.balance }).from(user).where(eq(user.id, USER_A))
        expect(row!.balance).toBe('1000.0000')
    })
})
