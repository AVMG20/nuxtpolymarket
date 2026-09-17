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
        // No table maximum by design; the player's own balance is the ceiling.
        maxBet: Number.MAX_SAFE_INTEGER,
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
        const waiting = this.everyone().filter(p => !p.leaving)
        for (const player of this.everyone()) {
            for (const [key, amount] of Object.entries(player.game.bets)) {
                bets.push({ userId: player.userId, name: player.name, color: colorForPlayer(player.userId), key, amount })
            }
        }
        const votes = waiting.filter(p => p.votedStart).map(p => ({ userId: p.userId, name: p.name }))
        return { lastNumbers: this.history, result: this.result, bets, votes, votesTotal: waiting.length }
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

    /** Stakes one bet and logs it, shared by a direct bet and each leg of a repeat or scale. */
    private async placeSingleBet(player: LtPlayer<RouletteSeatState>, key: string, amount: number): Promise<string> {
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
        return wagerId
    }

    /**
     * Reverses one leg placed by placeSingleBet — the shared undo behind the
     * UNDO button, CLEAR, a halving scale tearing up its old stakes, and the
     * rollback below when a repeat or scale-up fails partway through.
     */
    private async retractBet(player: LtPlayer<RouletteSeatState>, wagerId: string) {
        const log = this.betLog.get(player.userId) ?? []
        const idx = log.findIndex(l => l.wagerId === wagerId)
        if (idx === -1) return
        const [entry] = log.splice(idx, 1)
        this.betLog.set(player.userId, log)
        player.wagerIds = player.wagerIds.filter(id => id !== wagerId)
        const remaining = round4((player.game.bets[entry!.key] ?? 0) - entry!.amount)
        if (remaining > 0) player.game.bets[entry!.key] = remaining
        else delete player.game.bets[entry!.key]
        await this.refund(player.userId, [wagerId])
    }

    /**
     * Applies every leg of a repeat or a scale-up as one unit. A leg that fails
     * partway — a limit crossed, balance spent by another table in between —
     * unwinds every leg already staked, so a round never carries half the
     * intended bet.
     */
    private async placeBetSet(player: LtPlayer<RouletteSeatState>, entries: { key: string, amount: number }[]) {
        const placed: string[] = []
        try {
            for (const { key, amount } of entries) placed.push(await this.placeSingleBet(player, key, amount))
        } catch (error) {
            for (const wagerId of placed) await this.retractBet(player, wagerId)
            throw error
        }
    }

    private validateBet(key: string, rawAmount: unknown): number {
        const bet = getBet(key)
        if (!bet) fail('Invalid bet')
        const amount = round4(Number(rawAmount))
        if (!Number.isFinite(amount) || amount < this.config.minBet) fail(`Minimum bet is ${this.config.minBet}`)
        return amount
    }

    protected async onAction(userId: string, action: RouletteAction) {
        if (this.phase !== 'idle' && this.phase !== 'betting') fail('Betting is closed')

        if (action.type === 'undo') {
            const player = this.requirePlayer(userId)
            const last = this.betLog.get(userId)?.at(-1)
            if (!last) fail('Nothing to undo')
            await this.retractBet(player, last.wagerId)
            // A vote to start early was a promise made on the strength of a bet
            // that no longer exists.
            if (!Object.keys(player.game.bets).length) player.votedStart = false
            return
        }

        if (action.type === 'clear') {
            const player = this.requirePlayer(userId)
            if (!player.wagerIds.length) fail('Nothing to clear')
            for (const wagerId of [...player.wagerIds]) await this.retractBet(player, wagerId)
            player.votedStart = false
            return
        }

        if (action.type === 'repeat') {
            const previous = this.lastRoundBets.get(userId)
            if (!previous?.length) fail('No previous bet to repeat')
            const player = await this.registerPlayer(userId)
            if (this.phase === 'idle') this.onTableActive()
            await this.placeBetSet(player, previous)
            return
        }

        if (action.type === 'scale') {
            const player = this.requirePlayer(userId)
            const current = Object.entries(player.game.bets).map(([key, amount]) => ({ key, amount }))
            const base = current.length ? current : this.lastRoundBets.get(userId)
            if (!base?.length) fail('No bets to scale')

            const scaled = base.map(({ key, amount }) => ({ key, amount: round4(amount * action.factor) }))
            for (const { amount } of scaled) {
                if (amount < this.config.minBet) fail(`Minimum bet is ${this.config.minBet}`)
            }

            if (this.phase === 'idle') this.onTableActive()
            if (!current.length) {
                // Nothing at risk yet — sizing last round's slip up or down is a fresh stake.
                await this.placeBetSet(player, scaled)
            } else if (action.factor > 1) {
                // Doubling what is already staked is staking the same amounts again —
                // the escrow rows already down do not need to move for that.
                await this.placeBetSet(player, current)
            } else {
                // Halving can only shrink a stake by tearing up its escrow rows and
                // restaking the smaller total: there is no such thing as a partial
                // refund of a single wager row.
                for (const wagerId of [...player.wagerIds]) await this.retractBet(player, wagerId)
                await this.placeBetSet(player, scaled)
            }
            return
        }

        if (action.type !== 'bet') fail('Unknown action')
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
        this.clearVotes()
        this.advance('betting', BETTING_MS)
    }

    /**
     * A bet is the entry fee for a vote — otherwise a table full of watchers
     * could deal a round nobody staked anything on.
     */
    override async voteStart(userId: string) {
        const player = this.requirePlayer(userId)
        if (this.phase !== 'betting') fail('Betting is closed')
        if (!Object.keys(player.game.bets).length) fail('Place a bet first')
        await super.voteStart(userId)
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
