/**
 * Drives the Casino Hold'em table end to end against a stacked deck, so a round
 * that pays the wrong amount fails here rather than on the felt.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tableWagers } from '#server/database/schema'
import { getBalance } from '#server/utils/balance'
import { CasinoHoldemTable } from '#server/utils/live-table/casino-holdem'
import { LtShoe } from '#server/utils/live-table/shoe'
import type { ChSeatState } from '#shared/utils/casino-holdem/types'
import type { LtCard, LtRank, LtSuit } from '#shared/utils/live-table/types'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const ALICE = 'test-holdem-alice'
const BOB = 'test-holdem-bob'
const CARL = 'test-holdem-carl'

const SUITS: Record<string, LtSuit> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }

let seq = 0

/** A shoe that deals a written-down order instead of shuffling. */
class StackedShoe extends LtShoe {
    stack: { rank: LtRank, suit: LtSuit }[] = []

    override shuffle() {}

    override draw(hidden = false): LtCard {
        const card = this.stack.shift()
        if (!card) throw new Error('stacked shoe is empty')
        return { id: `st${++seq}`, rank: card.rank, suit: card.suit, hidden: hidden || undefined }
    }
}

function stack(text: string) {
    return text.split(' ').map(token => ({
        rank: token.slice(0, -1) as LtRank,
        suit: SUITS[token.slice(-1)]!
    }))
}

class TestTable extends CasinoHoldemTable {
    private readonly stacked = new StackedShoe()

    constructor() {
        super()
        this.shoe = this.stacked
    }

    setStack(text: string) {
        this.stacked.stack = stack(text)
    }

    /**
     * Advances one phase by hand and cancels the timer it schedules, so the
     * round only moves when the test says so.
     */
    async step(phase: string) {
        await this.onPhaseEnd(phase)
        this.setPhase(this.phase, null)
    }

    seat(userId: string): ChSeatState {
        return this.playerOf(userId)!.game
    }

    freeze() {
        this.setPhase(this.phase, null)
    }
}

async function cleanup() {
    for (const userId of [ALICE, BOB, CARL]) {
        await db.delete(tableWagers).where(eq(tableWagers.userId, userId))
        await cleanupUser(userId)
    }
}

describe.skipIf(SKIP)("Casino Hold'em table", () => {
    let table: TestTable

    beforeEach(async () => {
        await cleanup()
        await seedUser(ALICE, { balance: '10000.0000' })
        await seedUser(BOB, { balance: '10000.0000' })
        table = new TestTable()
        await table.sit(ALICE, 'alice', null, 0)
        await table.sit(BOB, 'bob', null, 1)
        table.freeze()
    })

    afterEach(async () => {
        table.freeze()
        await cleanup()
    })

    afterAll(async () => {
        await db.$client.end()
    })

    async function bet(userId: string, ante: number, aa = 0) {
        await table.action(userId, { t: 'bet', spot: 'ante', amount: ante })
        if (aa) await table.action(userId, { t: 'bet', spot: 'aa', amount: aa })
        table.freeze()
    }

    /** Deal order is one card per seat, then the dealer, twice, then the flop. */
    async function playTo(phase: 'decision' | 'settled') {
        await table.step('betting')
        await table.step('deal')
        if (phase === 'decision') return
        await table.step('decision')
        await table.step('board')
        await table.step('reveal')
    }

    it('rejects an ante that leaves too little for the 2x call', async () => {
        await seedUser(CARL, { balance: '1000.0000' })
        await table.sit(CARL, 'carl', null, 2)
        table.freeze()

        expect(() => table.action(CARL, { t: 'bet', spot: 'ante', amount: 500 }))
            .toThrow(/call costs/)
        expect(table.seat(CARL).pendingAnte).toBe(0)

        await table.action(CARL, { t: 'bet', spot: 'ante', amount: 100 })
        expect(table.seat(CARL).pendingAnte).toBe(100)
    })

    it('counts the AA bonus against the room left for the call', async () => {
        await seedUser(CARL, { balance: '1000.0000' })
        await table.sit(CARL, 'carl', null, 2)
        table.freeze()

        // 100 ante + 100 AA commits 200 and reserves a 200 call, inside 1000.
        await table.action(CARL, { t: 'bet', spot: 'ante', amount: 100 })
        await table.action(CARL, { t: 'bet', spot: 'aa', amount: 100 })

        // Raising the ante to 500 would need 500 + 100 + 1000.
        expect(() => table.action(CARL, { t: 'bet', spot: 'ante', amount: 500 }))
            .toThrow(/call costs/)
    })

    it('deals two hole cards to every seat that anted, plus a three-card flop', async () => {
        table.setStack('As 7d Qh Ks 2c 9h Ah 9c 4s 3d 6s')
        await bet(ALICE, 100)
        await bet(BOB, 100)

        await playTo('decision')

        expect(table.seat(ALICE).cards).toHaveLength(2)
        expect(table.seat(BOB).cards).toHaveLength(2)
        expect(table.snapshot().game.board).toHaveLength(3)
        // The dealer's cards are on the table but not on the wire.
        expect(table.snapshot().game.dealer.cards.every(c => c.hidden)).toBe(true)
        expect(table.snapshot().game.dealer.label).toBeNull()
    })

    it('pays the caller and takes the loser when the dealer qualifies', async () => {
        // Alice As Ks, Bob 7d 2c, dealer Qh 9h, board Ah 9c 4s 3d 6s.
        table.setStack('As 7d Qh Ks 2c 9h Ah 9c 4s 3d 6s')
        await bet(ALICE, 100)
        await bet(BOB, 100)
        await table.step('betting')
        await table.step('deal')

        await table.action(ALICE, { t: 'decide', decision: 'call' })
        await table.action(BOB, { t: 'decide', decision: 'call' })
        table.freeze()

        await table.step('decision')
        await table.step('board')
        await table.step('reveal')

        expect(table.snapshot().game.dealer.qualified).toBe(true)
        // Alice: pair of aces beats a pair of nines. 100 ante + 200 call staked,
        // ante pays 1:1 and the call pays even money.
        expect(table.seat(ALICE).outcome).toBe('win')
        expect(table.seat(ALICE).net).toBe(300)
        expect(await getBalance(ALICE)).toBe('10300.0000')
        // Bob: ace high loses both bets.
        expect(table.seat(BOB).outcome).toBe('lose')
        expect(table.seat(BOB).net).toBe(-300)
        expect(await getBalance(BOB)).toBe('9700.0000')
    })

    it('pays the ante and pushes the call when the dealer does not qualify', async () => {
        // Same board, but the dealer holds Qh Jh for nothing but ace high.
        table.setStack('As 7d Qh Ks 2c Jh Ah 9c 4s 3d 6s')
        await bet(ALICE, 100)
        await bet(BOB, 100)
        await table.step('betting')
        await table.step('deal')

        await table.action(ALICE, { t: 'decide', decision: 'call' })
        await table.action(BOB, { t: 'decide', decision: 'call' })
        table.freeze()

        await table.step('decision')
        await table.step('board')
        await table.step('reveal')

        expect(table.snapshot().game.dealer.qualified).toBe(false)
        // Both seats are paid: the ante wins 1:1 and the call comes back whole,
        // whatever either of them was holding.
        expect(table.seat(ALICE).net).toBe(100)
        expect(table.seat(BOB).net).toBe(100)
        expect(await getBalance(ALICE)).toBe('10100.0000')
        expect(await getBalance(BOB)).toBe('10100.0000')
    })

    it('takes the ante from a seat that folds and never stakes its call', async () => {
        table.setStack('As 7d Qh Ks 2c 9h Ah 9c 4s 3d 6s')
        await bet(ALICE, 100)
        await bet(BOB, 100)
        await table.step('betting')
        await table.step('deal')

        await table.action(ALICE, { t: 'decide', decision: 'call' })
        await table.action(BOB, { t: 'decide', decision: 'fold' })
        table.freeze()

        await table.step('decision')
        await table.step('board')
        await table.step('reveal')

        expect(table.seat(BOB).call).toBe(0)
        expect(table.seat(BOB).outcome).toBe('folded')
        expect(table.seat(BOB).net).toBe(-100)
        expect(await getBalance(BOB)).toBe('9900.0000')
    })

    it('folds a seat that runs the decision clock out', async () => {
        table.setStack('As 7d Qh Ks 2c 9h Ah 9c 4s 3d 6s')
        await bet(ALICE, 100)
        await bet(BOB, 100)
        await playTo('settled')

        expect(table.seat(ALICE).decision).toBe('fold')
        expect(table.seat(BOB).decision).toBe('fold')
        expect(await getBalance(ALICE)).toBe('9900.0000')
    })

    it('pays the AA bonus off the flop even when the seat folds afterwards', async () => {
        // Alice holds As Ks and the flop brings Ah, so her AA bonus is a pair of aces.
        table.setStack('As 7d Qh Ks 2c 9h Ah 9c 4s 3d 6s')
        await bet(ALICE, 100, 100)
        await bet(BOB, 100)
        await table.step('betting')
        await table.step('deal')

        await table.action(ALICE, { t: 'decide', decision: 'fold' })
        await table.action(BOB, { t: 'decide', decision: 'fold' })
        table.freeze()

        await table.step('decision')
        await table.step('board')
        await table.step('reveal')

        expect(table.seat(ALICE).aaMultiplier).toBe(7)
        // 100 ante lost, 100 bonus returning 800.
        expect(table.seat(ALICE).net).toBe(600)
        expect(await getBalance(ALICE)).toBe('10600.0000')
    })

    it('settles every escrow row the round opened', async () => {
        table.setStack('As 7d Qh Ks 2c 9h Ah 9c 4s 3d 6s')
        await bet(ALICE, 100, 100)
        await bet(BOB, 100)
        await table.step('betting')
        await table.step('deal')
        await table.action(ALICE, { t: 'decide', decision: 'call' })
        table.freeze()
        await table.step('decision')
        await table.step('board')
        await table.step('reveal')

        const rows = await db.select({ kind: tableWagers.kind, settled: tableWagers.settled })
            .from(tableWagers)
            .where(eq(tableWagers.userId, ALICE))
        expect(rows.map(r => r.kind).sort()).toEqual(['aa', 'ante', 'call'])
        expect(rows.every(r => r.settled)).toBe(true)
    })

    it('refuses a bonus larger than the ante behind it', async () => {
        await table.action(ALICE, { t: 'bet', spot: 'ante', amount: 100 })
        expect(() => table.action(ALICE, { t: 'bet', spot: 'aa', amount: 500 })).toThrow(/cannot exceed/)
        table.freeze()
    })

    it('refuses a bonus with no ante behind it', () => {
        expect(() => table.action(ALICE, { t: 'bet', spot: 'aa', amount: 100 })).toThrow(/ante first/)
        table.freeze()
    })

    it('refuses a second decision from the same seat', async () => {
        table.setStack('As 7d Qh Ks 2c 9h Ah 9c 4s 3d 6s')
        await bet(ALICE, 100)
        await bet(BOB, 100)
        await table.step('betting')
        await table.step('deal')

        await table.action(ALICE, { t: 'decide', decision: 'call' })
        table.freeze()
        await expect(table.action(ALICE, { t: 'decide', decision: 'fold' }))
            .rejects.toThrow(/already decided/)
        table.freeze()

        expect(table.seat(ALICE).call).toBe(100 * 2)
    })

    it('takes chips back off the layout with undo and clear', async () => {
        await table.action(ALICE, { t: 'bet', spot: 'ante', amount: 100 })
        await table.action(ALICE, { t: 'bet', spot: 'ante', amount: 500 })
        await table.action(ALICE, { t: 'bet', spot: 'aa', amount: 100 })
        table.freeze()
        expect(table.seat(ALICE).pendingAnte).toBe(600)

        await table.action(ALICE, { t: 'undo' })
        expect(table.seat(ALICE).pendingAa).toBe(0)

        await table.action(ALICE, { t: 'clear' })
        table.freeze()
        expect(table.seat(ALICE).pendingAnte).toBe(0)
        expect(await getBalance(ALICE)).toBe('10000.0000')
    })

    it('doubles or halves the layout, keeping the AA bonus proportional', async () => {
        await table.action(ALICE, { t: 'bet', spot: 'ante', amount: 100 })
        await table.action(ALICE, { t: 'bet', spot: 'aa', amount: 100 })
        table.freeze()

        await table.action(ALICE, { t: 'scale', factor: 2 })
        table.freeze()
        expect(table.seat(ALICE).pendingAnte).toBe(200)
        expect(table.seat(ALICE).pendingAa).toBe(200)

        await table.action(ALICE, { t: 'scale', factor: 0.5 })
        table.freeze()
        expect(table.seat(ALICE).pendingAnte).toBe(100)
        expect(table.seat(ALICE).pendingAa).toBe(100)

        expect(() => table.action(ALICE, { t: 'scale', factor: 3 })).toThrow(/Invalid bet scale/)
    })

    it('scales last round\'s bet when nothing is staked yet', async () => {
        table.setStack('As 7d Qh Ks 2c 9h Ah 9c 4s 3d 6s')
        await bet(ALICE, 100)
        await bet(BOB, 100)
        await playTo('settled')
        await table.step('payout')
        table.freeze()

        expect(table.seat(ALICE).pendingAnte).toBe(0)
        await table.action(ALICE, { t: 'scale', factor: 2 })
        table.freeze()
        expect(table.seat(ALICE).pendingAnte).toBe(200)
    })

    it('refuses to scale below the table minimum or with nothing to scale', async () => {
        expect(() => table.action(ALICE, { t: 'scale', factor: 2 })).toThrow(/No bet to scale/)

        await table.action(ALICE, { t: 'bet', spot: 'ante', amount: 1 })
        table.freeze()
        expect(() => table.action(ALICE, { t: 'scale', factor: 0.5 })).toThrow(/minimum/)
    })

    it('refuses a bet over the seat\'s own balance, with no table maximum to hit', async () => {
        expect(() => table.action(ALICE, { t: 'bet', spot: 'ante', amount: 100_000_000_000 }))
            .toThrow(/Not enough chips/)
    })

    it('deals nobody in when no ante is down', async () => {
        table.setStack('As 7d Qh Ks 2c 9h Ah 9c 4s 3d 6s')
        await table.step('betting')

        expect(table.seat(ALICE).cards).toHaveLength(0)
        expect(await getBalance(ALICE)).toBe('10000.0000')
    })
})
