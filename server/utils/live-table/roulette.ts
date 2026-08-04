import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'
import { fail, LiveTable, round4 } from '#server/utils/live-table/table'
import type { LtConfig } from '#server/utils/live-table/table'
import type { LtPayout } from '#shared/utils/live-table/types'
import { randomInt } from '#shared/utils/random'
import { colorForPlayer } from '#shared/utils/roulette/colors'
import { getBet } from '#shared/utils/roulette/layout'
import { resolveBets } from '#shared/utils/roulette/resolve'
import { pocketColor } from '#shared/utils/roulette/wheel'
import type {
    RouletteAction,
    RouletteFeltBet,
    RouletteSeatState,
    RouletteSharedState
} from '#shared/utils/roulette/types'

const HISTORY_LENGTH = 20
const BETTING_MS = 15_000
const NO_MORE_BETS_MS = 4_000
const SPINNING_MS = 5_000
const PAYOUT_MS = 5_000

/**
 * No seats, no turns: everyone watching bets on one shared layout, the wheel
 * spins once, and every matching bet settles off that single pocket. A player
 * is registered the moment they place their first bet rather than through
 * `sit()`, which `config.seats: 0` makes unreachable.
 */
export class RouletteTable extends LiveTable<RouletteSeatState, RouletteSharedState, RouletteAction> {
    protected readonly config: LtConfig = {
        game: 'roulette',
        seats: 0,
        minBet: 25,
        maxBet: 1_000_000,
        disconnectGrace: 60_000,
        disconnectGraceIdle: 15_000
    }

    private history: number[] = []
    private result: number | null = null

    protected createSeatState(): RouletteSeatState {
        return { bets: {} }
    }

    protected gameState(): RouletteSharedState {
        const bets: RouletteFeltBet[] = []
        for (const player of this.everyone()) {
            for (const [key, amount] of Object.entries(player.game.bets)) {
                bets.push({ userId: player.userId, name: player.name, color: colorForPlayer(player.userId), key, amount })
            }
        }
        return { lastNumbers: this.history, result: this.result, bets }
    }

    protected async onAction(userId: string, action: RouletteAction) {
        if (action.type !== 'bet') fail('Unknown action')
        if (this.phase !== 'idle' && this.phase !== 'betting') fail('Betting is closed')

        const bet = getBet(action.key)
        if (!bet) fail('Invalid bet')

        const amount = round4(Number(action.amount))
        if (!Number.isFinite(amount) || amount < this.config.minBet) fail(`Minimum bet is ${this.config.minBet}`)
        if (amount > this.config.maxBet) fail(`Maximum bet is ${this.config.maxBet}`)

        let player = this.playerOf(userId)
        if (!player) {
            const [row] = await db.select({ name: user.name, emblem: user.emblem })
                .from(user)
                .where(eq(user.id, userId))
                .limit(1)
            if (!row) fail('Unknown player')
            player = await this.join(userId, row.name, row.emblem)
        }

        // Before staking, so the very first bet of a fresh round is recorded
        // under the roundId that activation just opened, not the stale one.
        if (this.phase === 'idle') this.onTableActive()

        await this.stake(player, amount, 'bet')
        player.game.bets[action.key] = round4((player.game.bets[action.key] ?? 0) + amount)

        this.bus.broadcast({
            t: 'event',
            kind: 'game',
            payload: { type: 'bet', name: player.name, color: colorForPlayer(userId), key: action.key, amount }
        })
    }

    protected onTableActive() {
        this.roundId++
        this.message = 'Place your bets'
        this.advance('betting', BETTING_MS)
    }

    protected onPhaseEnd(phase: string): void | Promise<void> {
        switch (phase) {
            case 'betting': return this.closeBets()
            case 'nomorebets': return this.spin()
            case 'spinning': return this.settleRound()
            case 'payout': return this.startNextRound()
        }
    }

    private closeBets() {
        this.message = 'No more bets'
        this.advance('nomorebets', NO_MORE_BETS_MS)
    }

    private spin() {
        this.result = randomInt(0, 36)
        this.message = 'Spinning'
        this.advance('spinning', SPINNING_MS)
        this.bus.broadcast({
            t: 'event',
            kind: 'game',
            payload: { type: 'spin', number: this.result, color: pocketColor(this.result) }
        })
    }

    private async settleRound() {
        const winningNumber = this.result!
        this.history = [winningNumber, ...this.history].slice(0, HISTORY_LENGTH)

        const payouts: LtPayout[] = []
        const results: { name: string, net: number }[] = []
        for (const player of this.everyone()) {
            const placed = Object.entries(player.game.bets).map(([key, amount]) => ({ key, amount }))
            if (!placed.length) continue
            const { totalStaked, totalPayout } = resolveBets(placed, winningNumber)
            payouts.push({ userId: player.userId, staked: totalStaked, payout: totalPayout })
            results.push({ name: player.name, net: round4(totalPayout - totalStaked) })
        }

        this.message = `Winning number ${winningNumber}`
        await this.settle(payouts)
        this.bus.broadcast({
            t: 'event',
            kind: 'game',
            payload: { type: 'result', winningNumber, results }
        })

        // The last payout may have released the table's only remaining
        // player mid-settle, which already sent it idle — advancing on top
        // of that would force a betting phase back onto an empty table.
        if (!this.players.size) return
        this.advance('payout', PAYOUT_MS)
    }

    private startNextRound() {
        this.result = null
        for (const player of this.everyone()) player.game = this.createSeatState()
        if (!this.players.size) return
        this.onTableActive()
    }
}

export const rouletteTable = new RouletteTable()
