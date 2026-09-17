/**
 * Drives the real table class through a full round with a stacked deck, so the
 * payouts the rules module computes are checked against balances that actually
 * moved.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tableWagers } from '#server/database/schema'
import { getBalance } from '#server/utils/balance'
import { LtShoe } from '#server/utils/live-table/shoe'
import { ThreeCardPokerTable } from '#server/utils/live-table/three-card-poker'
import type { TcpAction, TcpSeatState } from '#shared/utils/three-card-poker/types'
import type { LtCard } from '#shared/utils/live-table/types'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'
import { hand } from './cards'

const ALICE = 'test-tcp-alice'
const BOB = 'test-tcp-bob'

let cardSeq = 0

/** Deals a scripted deck, falling back to a real shuffle once it runs out. */
class StackedShoe extends LtShoe {
    queue: LtCard[] = []

    constructor() {
        super(1, 0)
    }

    override get needsShuffle(): boolean {
        return false
    }

    override draw(hidden = false): LtCard {
        const next = this.queue.shift()
        if (!next) return super.draw(hidden)
        return { ...next, id: `t${++cardSeq}`, hidden: hidden || undefined }
    }
}

class TestTable extends ThreeCardPokerTable {
    readonly deck = new StackedShoe()

    constructor() {
        super()
        this.shoe = this.deck
    }

    /** 'As Js Kd 9h 6c 4d' — dealt in order, players before the dealer per pass. */
    stack(notation: string) {
        this.deck.queue = hand(notation)
    }

    step(phase: string) {
        return this.run(() => this.onPhaseEnd(phase))
    }

    send(userId: string, action: TcpAction) {
        return this.run(() => this.action(userId, action))
    }

    seat(userId: string): TcpSeatState {
        return this.playerOf(userId)!.game
    }

    vote(userId: string) {
        return this.run(() => this.voteStart(userId))
    }

    /** A vote that closes the table deals through a nested, un-awaited run() —
     *  queuing a no-op behind it is how a caller outside the table waits for it. */
    flush() {
        return this.run(() => {})
    }

    currentPhase() {
        return this.phase
    }

    /** Drops the pending phase timer so a finished test leaves nothing running. */
    stop() {
        this.setPhase('idle', null)
    }
}

async function cleanup() {
    for (const id of [ALICE, BOB]) {
        await db.delete(tableWagers).where(eq(tableWagers.userId, id))
        await cleanupUser(id)
    }
}

describe.skipIf(SKIP)('ThreeCardPokerTable', () => {
    let table: TestTable

    beforeEach(async () => {
        await cleanup()
        table = new TestTable()
    })
    afterEach(async () => {
        table.stop()
        await cleanup()
    })
    afterAll(async () => { await db.$client.end() })

    it('pays the ante and pushes the play bet when the dealer does not qualify', async () => {
        await seedUser(ALICE, { balance: '10000.0000' })
        await table.sit(ALICE, 'Alice', null, 0)
        // A-K-6 against J-9-4: the dealer misses queen high.
        table.stack('As Js Kd 9h 6c 4d')

        await table.send(ALICE, { t: 'bet', spot: 'ante', amount: 100 })
        await table.step('betting')
        expect(await getBalance(ALICE)).toBe('9900.0000')

        await table.step('dealing')
        await table.send(ALICE, { t: 'decide', play: true })
        expect(await getBalance(ALICE)).toBe('9800.0000')

        await table.step('reveal')

        const result = table.seat(ALICE).result!
        expect(result.dealerQualified).toBe(false)
        expect(result.ante).toBe('win')
        expect(result.play).toBe('push')
        expect(await getBalance(ALICE)).toBe('10100.0000')
    })

    it('pays ante and play even money when the dealer qualifies and loses', async () => {
        await seedUser(ALICE, { balance: '10000.0000' })
        await table.sit(ALICE, 'Alice', null, 0)
        table.stack('As Qs Kd 3h 6c 2d')

        await table.send(ALICE, { t: 'bet', spot: 'ante', amount: 100 })
        await table.step('betting')
        await table.step('dealing')
        await table.send(ALICE, { t: 'decide', play: true })
        await table.step('reveal')

        expect(table.seat(ALICE).result!.dealerQualified).toBe(true)
        expect(await getBalance(ALICE)).toBe('10200.0000')
    })

    it('folds a seat that lets the decision timer run out', async () => {
        await seedUser(ALICE, { balance: '10000.0000' })
        await table.sit(ALICE, 'Alice', null, 0)
        table.stack('2s Qs 3h 4h 5d 2d')

        await table.send(ALICE, { t: 'bet', spot: 'ante', amount: 100 })
        await table.step('betting')
        await table.step('dealing')
        await table.step('decision')

        expect(table.seat(ALICE).decision).toBe('fold')
        await table.step('reveal')
        expect(await getBalance(ALICE)).toBe('9900.0000')
    })

    it('settles pair plus off the player hand even when the seat folds', async () => {
        await seedUser(ALICE, { balance: '10000.0000' })
        await table.sit(ALICE, 'Alice', null, 0)
        // A pair of sevens folded against a dealer ace: pair plus still pays 1:1.
        table.stack('7s As 7h Kd 3d 2c')

        await table.send(ALICE, { t: 'bet', spot: 'ante', amount: 100 })
        await table.send(ALICE, { t: 'bet', spot: 'pairPlus', amount: 50 })
        await table.step('betting')
        expect(await getBalance(ALICE)).toBe('9850.0000')

        await table.step('dealing')
        await table.send(ALICE, { t: 'decide', play: false })
        await table.step('reveal')

        expect(table.seat(ALICE).result!.pairPlusTier).toBe('pair')
        expect(await getBalance(ALICE)).toBe('9950.0000')
    })

    it('settles two seats independently in the same round', async () => {
        await seedUser(ALICE, { balance: '10000.0000' })
        await seedUser(BOB, { balance: '10000.0000' })
        await table.sit(ALICE, 'Alice', null, 0)
        await table.sit(BOB, 'Bob', null, 1)
        // Alice A-K-6 plays and beats the dealer's Q-4-2; Bob folds 5-3-2.
        table.stack('As 2s Qs Kd 3h 4h 6c 5d 2d')

        await table.send(ALICE, { t: 'bet', spot: 'ante', amount: 100 })
        await table.send(BOB, { t: 'bet', spot: 'ante', amount: 100 })
        await table.step('betting')
        await table.step('dealing')
        await table.send(ALICE, { t: 'decide', play: true })
        await table.send(BOB, { t: 'decide', play: false })
        await table.step('reveal')

        expect(await getBalance(ALICE)).toBe('10200.0000')
        expect(await getBalance(BOB)).toBe('9900.0000')
    })

    it('closes every escrow row it opened', async () => {
        await seedUser(ALICE, { balance: '10000.0000' })
        await table.sit(ALICE, 'Alice', null, 0)
        table.stack('As Qs Kd 3h 6c 2d')

        await table.send(ALICE, { t: 'bet', spot: 'ante', amount: 100 })
        await table.send(ALICE, { t: 'bet', spot: 'pairPlus', amount: 50 })
        await table.step('betting')
        await table.step('dealing')
        await table.send(ALICE, { t: 'decide', play: true })
        await table.step('reveal')

        const rows = await db.select({ settled: tableWagers.settled, kind: tableWagers.kind })
            .from(tableWagers)
            .where(eq(tableWagers.userId, ALICE))
        expect(rows).toHaveLength(3)
        expect(rows.every(row => row.settled)).toBe(true)
        expect(rows.map(row => row.kind).sort()).toEqual(['ante', 'pairPlus', 'play'])
    })

    it('refuses a second decision on the same hand', async () => {
        await seedUser(ALICE, { balance: '10000.0000' })
        await seedUser(BOB, { balance: '10000.0000' })
        await table.sit(ALICE, 'Alice', null, 0)
        // Bob holds the decision phase open by never answering it.
        await table.sit(BOB, 'Bob', null, 1)
        table.stack('As 2s Qs Kd 3h 4h 6c 5d 2d')

        await table.send(ALICE, { t: 'bet', spot: 'ante', amount: 100 })
        await table.send(BOB, { t: 'bet', spot: 'ante', amount: 100 })
        await table.step('betting')
        await table.step('dealing')
        await table.send(ALICE, { t: 'decide', play: true })

        await expect(table.send(ALICE, { t: 'decide', play: false })).rejects.toThrow(/already decided/i)
        expect(await getBalance(ALICE)).toBe('9800.0000')
    })

    it('hands the bets back to a seat whose bet never reached the felt', async () => {
        await seedUser(ALICE, { balance: '10000.0000' })
        await table.sit(ALICE, 'Alice', null, 0)

        await table.send(ALICE, { t: 'bet', spot: 'ante', amount: 100 })
        await table.send(ALICE, { t: 'bet', spot: 'pairPlus', amount: 50 })
        await table.send(ALICE, { t: 'undo' })
        expect(table.seat(ALICE).pendingPairPlus).toBe(0)
        expect(table.seat(ALICE).pendingAnte).toBe(100)

        await table.send(ALICE, { t: 'clear' })
        await table.step('betting')

        expect(await getBalance(ALICE)).toBe('10000.0000')
    })

    it('doubles every bet on the layout, side bets included', async () => {
        await seedUser(ALICE, { balance: '10000.0000' })
        await table.sit(ALICE, 'Alice', null, 0)

        await table.send(ALICE, { t: 'bet', spot: 'ante', amount: 100 })
        await table.send(ALICE, { t: 'bet', spot: 'pairPlus', amount: 50 })
        await table.send(ALICE, { t: 'scale', factor: 2 })

        expect(table.seat(ALICE).pendingAnte).toBe(200)
        expect(table.seat(ALICE).pendingPairPlus).toBe(100)
    })

    it('halves last round\'s bet when nothing is staked yet', async () => {
        await seedUser(ALICE, { balance: '10000.0000' })
        await table.sit(ALICE, 'Alice', null, 0)
        table.stack('2s Qs 3h 4h 5d 2d')

        await table.send(ALICE, { t: 'bet', spot: 'ante', amount: 100 })
        await table.send(ALICE, { t: 'bet', spot: 'pairPlus', amount: 40 })
        await table.step('betting')
        await table.step('dealing')
        await table.send(ALICE, { t: 'decide', play: false })
        await table.step('reveal')
        await table.step('payout')

        await table.send(ALICE, { t: 'scale', factor: 0.5 })

        expect(table.seat(ALICE).pendingAnte).toBe(50)
        expect(table.seat(ALICE).pendingPairPlus).toBe(20)
    })

    it('refuses to scale a bet below the table minimum, leaving it untouched', async () => {
        await seedUser(ALICE, { balance: '10000.0000' })
        await table.sit(ALICE, 'Alice', null, 0)

        await table.send(ALICE, { t: 'bet', spot: 'ante', amount: 1 })
        await expect(table.send(ALICE, { t: 'scale', factor: 0.5 })).rejects.toThrow(/minimum/i)
        expect(table.seat(ALICE).pendingAnte).toBe(1)
    })

    it('refuses to scale past the seat\'s balance, leaving the bet untouched', async () => {
        await seedUser(ALICE, { balance: '250.0000' })
        await table.sit(ALICE, 'Alice', null, 0)

        await table.send(ALICE, { t: 'bet', spot: 'ante', amount: 100 })
        await expect(table.send(ALICE, { t: 'scale', factor: 2 })).rejects.toThrow(/enough chips/i)
        expect(table.seat(ALICE).pendingAnte).toBe(100)
    })

    it('deals early once every anted seat votes to start', async () => {
        await seedUser(ALICE, { balance: '10000.0000' })
        await seedUser(BOB, { balance: '10000.0000' })
        await table.sit(ALICE, 'Alice', null, 0)
        await table.sit(BOB, 'Bob', null, 1)
        table.stack('As 2s Qs Kd 3h 4h 6c 5d 2d')

        await table.send(ALICE, { t: 'bet', spot: 'ante', amount: 100 })
        await table.send(BOB, { t: 'bet', spot: 'ante', amount: 100 })

        await table.vote(ALICE)
        expect(table.currentPhase()).toBe('betting')
        await table.vote(BOB)
        await table.flush()
        expect(table.currentPhase()).toBe('dealing')
    })

    it('does not count a vote from a seat with nothing staked', async () => {
        await seedUser(ALICE, { balance: '10000.0000' })
        await seedUser(BOB, { balance: '10000.0000' })
        await table.sit(ALICE, 'Alice', null, 0)
        await table.sit(BOB, 'Bob', null, 1)

        // Bob never antes, so his own vote can never close a betting round he
        // is not risking anything on.
        await table.send(ALICE, { t: 'bet', spot: 'ante', amount: 100 })
        await table.vote(ALICE)
        await table.vote(BOB)

        expect(table.currentPhase()).toBe('betting')
    })

    it('drops a vote when the ante behind it is undone', async () => {
        await seedUser(ALICE, { balance: '10000.0000' })
        await seedUser(BOB, { balance: '10000.0000' })
        await table.sit(ALICE, 'Alice', null, 0)
        await table.sit(BOB, 'Bob', null, 1)

        await table.send(ALICE, { t: 'bet', spot: 'ante', amount: 100 })
        await table.vote(ALICE)
        await table.send(ALICE, { t: 'undo' })
        // Restaking without voting again must not inherit the vote the undo dropped.
        await table.send(ALICE, { t: 'bet', spot: 'ante', amount: 100 })

        await table.send(BOB, { t: 'bet', spot: 'ante', amount: 100 })
        await table.vote(BOB)
        await table.flush()

        expect(table.currentPhase()).toBe('betting')
    })
})
