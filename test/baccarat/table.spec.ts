/**
 * Drives BaccaratTable directly through its round loop without waiting on
 * real timers, cross-checking money movement against the pure payout
 * resolver -- so the test does not need to control which cards get dealt to
 * know whether the table paid the right amount.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '#server/database'
import { getBalance } from '#server/utils/balance'
import { BaccaratTable } from '#server/utils/live-table/baccarat'
import type { BacBets } from '#shared/utils/baccarat/payouts'
import { resolveBets } from '#shared/utils/baccarat/payouts'
import { handTotal, isPair, winnerOf } from '#shared/utils/baccarat/rules'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

class TestableBaccaratTable extends BaccaratTable {
    forcePhaseEnd(phase: string) {
        return this.onPhaseEnd(phase)
    }

    currentRound() {
        return this.gameState().round
    }

    /** Cancels the real setTimeout `advance()` scheduled, so a manually-driven test leaves no pending timer behind. */
    haltTimer() {
        this.setPhase(this.phase, null)
    }
}

function round4(value: number): number {
    return Math.round(value * 10_000) / 10_000
}

const P1 = 'test-baccarat-p1'
const P2 = 'test-baccarat-p2'

async function cleanup() {
    await cleanupUser(P1)
    await cleanupUser(P2)
}

describe.skipIf(SKIP)('BaccaratTable', () => {
    let table: TestableBaccaratTable

    beforeEach(async () => {
        await cleanup()
        table = new TestableBaccaratTable()
    })
    afterEach(async () => {
        table.haltTimer()
        await cleanup()
    })
    afterAll(async () => { await db.$client.end() })

    async function bet(userId: string, bets: BacBets) {
        for (const [spot, amount] of Object.entries(bets)) {
            if (amount > 0) await table.action(userId, { kind: 'bet', spot: spot as keyof BacBets, amount })
        }
    }

    it('seats players, deals, and settles balances by exactly what the payout resolver says', async () => {
        await seedUser(P1, { balance: '10000.0000' })
        await seedUser(P2, { balance: '10000.0000' })
        await table.sit(P1, 'p1', null, 0)
        await table.sit(P2, 'p2', null, 1)
        expect(table.snapshot().phase).toBe('betting')

        let expected1 = 10000
        let expected2 = 10000

        // Several rounds so naturals, third-card draws and pushes all get a
        // chance to occur under real (not mocked) shoe randomness.
        for (let round = 0; round < 10; round++) {
            const bets1: BacBets = { player: 100, banker: 0, tie: 10, playerPair: 0, bankerPair: 0 }
            const bets2: BacBets = { player: 0, banker: 80, tie: 0, playerPair: 15, bankerPair: 15 }
            await bet(P1, bets1)
            await bet(P2, bets2)

            await table.forcePhaseEnd('betting') // deals the whole hand
            await table.forcePhaseEnd('dealing') // -> resolve, no new state
            const result = table.currentRound()!

            // Wiring check: the table's own result must agree with an
            // independent recompute from the actual cards it dealt.
            expect(result.playerTotal).toBe(handTotal(result.playerCards))
            expect(result.bankerTotal).toBe(handTotal(result.bankerCards))
            expect(result.winner).toBe(winnerOf(result.playerTotal, result.bankerTotal))
            expect(result.playerPair).toBe(isPair(result.playerCards))
            expect(result.bankerPair).toBe(isPair(result.bankerCards))
            if (result.playerNatural || result.bankerNatural) {
                expect(result.playerCards).toHaveLength(2)
                expect(result.bankerCards).toHaveLength(2)
            }

            const r1 = resolveBets(bets1, result)
            const r2 = resolveBets(bets2, result)
            expected1 = round4(expected1 - r1.staked + r1.payout)
            expected2 = round4(expected2 - r2.staked + r2.payout)

            await table.forcePhaseEnd('resolve') // settles

            expect(await getBalance(P1)).toBe(expected1.toFixed(4))
            expect(await getBalance(P2)).toBe(expected2.toFixed(4))

            await table.forcePhaseEnd('payout') // clears bets, maybe reshuffles, reopens betting
        }
    })

    it('lets a seat sit out a round with no bet and settles nothing for them', async () => {
        await seedUser(P1, { balance: '1000.0000' })
        await table.sit(P1, 'p1', null, 0)

        await table.forcePhaseEnd('betting')
        await table.forcePhaseEnd('dealing')
        await table.forcePhaseEnd('resolve')

        expect(await getBalance(P1)).toBe('1000.0000')
        expect(table.snapshot().seats[0]?.lastNet).toBeNull()
    })

    it('refunds a cleared bet in full', async () => {
        await seedUser(P1, { balance: '1000.0000' })
        await table.sit(P1, 'p1', null, 0)

        await table.action(P1, { kind: 'bet', spot: 'banker', amount: 200 })
        expect(await getBalance(P1)).toBe('800.0000')

        await table.action(P1, { kind: 'clear' })

        expect(await getBalance(P1)).toBe('1000.0000')
        expect(table.snapshot().seats[0]?.game.bets).toEqual({ player: 0, banker: 0, tie: 0, playerPair: 0, bankerPair: 0 })
    })

    it('rejects a bet once betting has closed', async () => {
        await seedUser(P1, { balance: '1000.0000' })
        await table.sit(P1, 'p1', null, 0)
        await table.forcePhaseEnd('betting') // -> dealing

        await expect(table.action(P1, { kind: 'bet', spot: 'player', amount: 50 }))
            .rejects.toThrow(/betting is closed/i)
    })

    it('rejects a bet below the table minimum', async () => {
        await seedUser(P1, { balance: '1000.0000' })
        await table.sit(P1, 'p1', null, 0)

        await expect(table.action(P1, { kind: 'bet', spot: 'player', amount: 1 }))
            .rejects.toThrow(/minimum bet/i)
    })

    it('rejects a bet that pushes a spot past the table maximum', async () => {
        await seedUser(P1, { balance: '10000000.0000' })
        await table.sit(P1, 'p1', null, 0)
        await table.action(P1, { kind: 'bet', spot: 'player', amount: 900_000 })

        await expect(table.action(P1, { kind: 'bet', spot: 'player', amount: 200_000 }))
            .rejects.toThrow(/maximum bet/i)
    })

    it('rejects a bet the player cannot afford without writing escrow', async () => {
        await seedUser(P1, { balance: '50.0000' })
        await table.sit(P1, 'p1', null, 0)

        await expect(table.action(P1, { kind: 'bet', spot: 'player', amount: 500 }))
            .rejects.toThrow()

        expect(await getBalance(P1)).toBe('50.0000')
    })

    it('rejects an action from someone who has never sat', async () => {
        await seedUser(P1, { balance: '1000.0000' })

        // requirePlayer throws synchronously (onAction is not async on this
        // path), unlike the placeBet/clearBets rejections above.
        expect(() => table.action(P1, { kind: 'bet', spot: 'player', amount: 50 }))
            .toThrow(/not at this table/i)
    })
})
