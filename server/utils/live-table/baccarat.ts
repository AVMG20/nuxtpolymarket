import { LtShoe } from '#server/utils/live-table/shoe'
import { LiveTable, fail, round4 } from '#server/utils/live-table/table'
import type { LtConfig, LtPlayer } from '#server/utils/live-table/table'
import { BAC_BET_KEYS, emptyBets, resolveBets } from '#shared/utils/baccarat/payouts'
import { bankerDraws, handTotal, isNatural, isPair, playerDraws, rankValue, winnerOf } from '#shared/utils/baccarat/rules'
import type {
    BacAction,
    BacBetKey,
    BacHistoryEntry,
    BacRoundResult,
    BacSeatState,
    BacSharedState
} from '#shared/utils/baccarat/types'
import type { LtPayout } from '#shared/utils/live-table/types'

const TIMERS = {
    betting: 15_000,
    dealing: 4_000,
    resolve: 3_000,
    payout: 3_500
} as const

/** Bead Plate / Big Road never need more than this many hands; a shoe reshuffle resets it anyway. */
const HISTORY_LIMIT = 100

/** Exported (rather than kept file-private) so tests can drive a fresh table without the singleton's shared state. */
export class BaccaratTable extends LiveTable<BacSeatState, BacSharedState, BacAction> {
    protected readonly config: LtConfig = {
        game: 'baccarat',
        seats: 5,
        minBet: 5,
        maxBet: 1_000_000,
        disconnectGrace: 60_000,
        disconnectGraceIdle: 15_000
    }

    private shoe = new LtShoe(6, 0.75)
    private round: BacRoundResult | null = null
    private history: BacHistoryEntry[] = []

    protected createSeatState(): BacSeatState {
        return { bets: emptyBets() }
    }

    protected gameState(): BacSharedState {
        return {
            round: this.round,
            history: this.history,
            shoe: this.shoe.info()
        }
    }

    protected onTableActive() {
        this.startBetting()
    }

    private startBetting() {
        this.roundId++
        this.round = null
        this.message = 'Place your bets'
        this.advance('betting', TIMERS.betting)
    }

    protected onAction(userId: string, action: BacAction) {
        // requirePlayer is enough of a guard: baccarat only ever registers a
        // player through sit(), so a registered player is always seated.
        const player = this.requirePlayer(userId)

        switch (action.kind) {
            case 'bet': return this.placeBet(player, action.spot, Number(action.amount))
            case 'clear': return this.clearBets(player)
        }
    }

    private async placeBet(player: LtPlayer<BacSeatState>, spot: BacBetKey, amount: number) {
        if (this.phase !== 'betting') fail('Betting is closed')
        if (!BAC_BET_KEYS.includes(spot)) fail('Invalid bet')
        if (!Number.isFinite(amount) || amount <= 0) fail('Invalid stake')
        if (amount < this.config.minBet) fail(`Minimum bet is ${this.config.minBet}`)
        const total = round4(player.game.bets[spot] + amount)
        if (total > this.config.maxBet) fail(`Maximum bet is ${this.config.maxBet}`)

        await this.stake(player, amount, spot)
        player.game.bets[spot] = total
        this.bus.broadcast({
            t: 'event',
            kind: 'game',
            payload: { type: 'bet', name: player.name, spot, amount }
        })
    }

    private async clearBets(player: LtPlayer<BacSeatState>) {
        if (this.phase !== 'betting') fail('Betting is closed')
        const ids = player.wagerIds
        player.wagerIds = []
        player.game.bets = emptyBets()
        await this.refund(player.userId, ids)
    }

    protected onPhaseEnd(phase: string) {
        switch (phase) {
            case 'betting': return this.deal()
            case 'dealing': return this.advance('resolve', TIMERS.resolve)
            case 'resolve': return this.settleRound()
            case 'payout': return this.nextRound()
        }
    }

    /**
     * The whole hand is dealt in one go -- there is no player input to wait on,
     * so "dealing", "resolve" and "payout" are a paced reveal of a result this
     * function already knows in full, not three separate decisions.
     */
    private deal() {
        const playerCards = [this.shoe.draw(), this.shoe.draw()]
        const bankerCards = [this.shoe.draw(), this.shoe.draw()]

        if (!isNatural(playerCards) && !isNatural(bankerCards)) {
            let playerThirdValue: number | null = null
            if (playerDraws(handTotal(playerCards))) {
                const card = this.shoe.draw()
                playerCards.push(card)
                playerThirdValue = rankValue(card.rank!)
            }
            if (bankerDraws(handTotal(bankerCards), playerThirdValue)) {
                bankerCards.push(this.shoe.draw())
            }
        }

        const playerTotal = handTotal(playerCards)
        const bankerTotal = handTotal(bankerCards)
        const winner = winnerOf(playerTotal, bankerTotal)

        this.round = {
            playerCards,
            bankerCards,
            playerTotal,
            bankerTotal,
            winner,
            playerNatural: isNatural(playerCards),
            bankerNatural: isNatural(bankerCards),
            playerPair: isPair(playerCards),
            bankerPair: isPair(bankerCards)
        }
        this.message = winner === 'tie' ? 'Tie' : `${winner === 'player' ? 'Player' : 'Banker'} wins`
        this.advance('dealing', TIMERS.dealing)
    }

    private async settleRound() {
        const round = this.round!
        const payouts: LtPayout[] = []
        for (const player of this.seated()) {
            const bets = player.game.bets
            const totalStaked = Object.values(bets).reduce((sum, amount) => sum + amount, 0)
            if (totalStaked <= 0) {
                // No badge should carry over from a round this seat sat out.
                player.lastNet = null
                continue
            }
            const { staked, payout } = resolveBets(bets, round)
            payouts.push({ userId: player.userId, staked, payout })
        }
        await this.settle(payouts)

        this.history.push({ winner: round.winner, playerPair: round.playerPair, bankerPair: round.bankerPair })
        if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT)

        // settle() may have released the table's last player (a leaving seat
        // with no other stake frees immediately); nothing left to show a payout to.
        if (!this.seated().length) return
        this.advance('payout', TIMERS.payout)
    }

    private nextRound() {
        for (const player of this.everyone()) player.game.bets = emptyBets()

        if (this.shoe.needsShuffle) {
            this.shoe.shuffle()
            this.history = []
            this.bus.broadcast({ t: 'event', kind: 'game', payload: { type: 'shuffle' } })
        }

        if (!this.seated().length) {
            this.round = null
            return
        }
        this.startBetting()
    }
}

export const baccaratTable = new BaccaratTable()
