import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'
import { fail, LiveTable, round4 } from '#server/utils/live-table/table'
import type { LtConfig, LtPlayer } from '#server/utils/live-table/table'
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

interface LoggedBet {
    key: string
    amount: number
    wagerId: string
}

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

    // Per-player bookkeeping that never reaches the client: TSeat only travels
    // to a client through the seats array, which a seatless table never
    // populates, so there is nowhere to put a per-player flag even if the
    // client wanted one. Undo and repeat validate against these directly
    // instead, the same way any other invalid action fails.
    private betLog = new Map<string, LoggedBet[]>()
    private lastRoundBets = new Map<string, { key: string, amount: number }[]>()

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

    private async registerPlayer(userId: string): Promise<LtPlayer<RouletteSeatState>> {
        const existing = this.playerOf(userId)
        if (existing) return existing
        const [row] = await db.select({ name: user.name, emblem: user.emblem })
            .from(user)
            .where(eq(user.id, userId))
            .limit(1)
        if (!row) fail('Unknown player')
        return this.join(userId, row.name, row.emblem)
    }

    /** Stakes one bet and logs it, shared by a direct bet and each leg of a repeat. */
    private async placeSingleBet(player: LtPlayer<RouletteSeatState>, key: string, amount: number) {
        await this.stake(player, amount, 'bet')
        const wagerId = player.wagerIds[player.wagerIds.length - 1]!
        const log = this.betLog.get(player.userId) ?? []
        log.push({ key, amount, wagerId })
        this.betLog.set(player.userId, log)

        player.game.bets[key] = round4((player.game.bets[key] ?? 0) + amount)

        this.bus.broadcast({
            t: 'event',
            kind: 'game',
            payload: { type: 'bet', name: player.name, color: colorForPlayer(player.userId), key, amount }
        })
    }

    private validateBet(key: string, rawAmount: unknown): number {
        const bet = getBet(key)
        if (!bet) fail('Invalid bet')
        const amount = round4(Number(rawAmount))
        if (!Number.isFinite(amount) || amount < this.config.minBet) fail(`Minimum bet is ${this.config.minBet}`)
        if (amount > this.config.maxBet) fail(`Maximum bet is ${this.config.maxBet}`)
        return amount
    }

    protected async onAction(userId: string, action: RouletteAction) {
        if (action.type !== 'bet' && action.type !== 'undo' && action.type !== 'repeat') fail('Unknown action')
        if (this.phase !== 'idle' && this.phase !== 'betting') fail('Betting is closed')

        if (action.type === 'undo') {
            const player = this.requirePlayer(userId)
            const last = this.betLog.get(userId)?.pop()
            if (!last) fail('Nothing to undo')
            player.wagerIds = player.wagerIds.filter(id => id !== last.wagerId)
            const remaining = round4((player.game.bets[last.key] ?? 0) - last.amount)
            if (remaining > 0) player.game.bets[last.key] = remaining
            else delete player.game.bets[last.key]
            await this.refund(userId, [last.wagerId])
            return
        }

        if (action.type === 'repeat') {
            const previous = this.lastRoundBets.get(userId)
            if (!previous?.length) fail('No previous bet to repeat')
            const player = await this.registerPlayer(userId)
            if (this.phase === 'idle') this.onTableActive()
            for (const { key, amount } of previous) await this.placeSingleBet(player, key, amount)
            return
        }

        const amount = this.validateBet(action.key, action.amount)
        const player = await this.registerPlayer(userId)
        // Before staking, so the very first bet of a fresh round is recorded
        // under the roundId that activation just opened, not the stale one.
        if (this.phase === 'idle') this.onTableActive()
        await this.placeSingleBet(player, action.key, amount)
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
        const results: { userId: string, name: string, net: number }[] = []
        for (const player of this.everyone()) {
            const placed = Object.entries(player.game.bets).map(([key, amount]) => ({ key, amount }))
            if (!placed.length) continue
            const { totalStaked, totalPayout } = resolveBets(placed, winningNumber)
            payouts.push({ userId: player.userId, staked: totalStaked, payout: totalPayout })
            results.push({ userId: player.userId, name: player.name, net: round4(totalPayout - totalStaked) })
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
        for (const player of this.everyone()) {
            const entries = Object.entries(player.game.bets).map(([key, amount]) => ({ key, amount }))
            if (entries.length) this.lastRoundBets.set(player.userId, entries)
            this.betLog.delete(player.userId)
            player.game = this.createSeatState()
        }
        // A departed player's remembered slip is only useful if they come back.
        for (const userId of [...this.lastRoundBets.keys()]) {
            if (!this.players.has(userId)) this.lastRoundBets.delete(userId)
        }

        if (!this.players.size) return
        this.onTableActive()
    }
}

export const rouletteTable = new RouletteTable()
