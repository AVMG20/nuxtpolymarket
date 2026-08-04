import { getBalance } from '#server/utils/balance'
import { LtShoe } from '#server/utils/live-table/shoe'
import { LiveTable, fail, round4 } from '#server/utils/live-table/table'
import type { LtConfig, LtPlayer } from '#server/utils/live-table/table'
import { BAC_BET_KEYS, emptyBets, resolveBets, totalStaked } from '#shared/utils/baccarat/payouts'
import type { BacBets } from '#shared/utils/baccarat/payouts'
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
        // No table maximum by design; the player's own balance is the ceiling.
        maxBet: Number.MAX_SAFE_INTEGER,
        disconnectGrace: 60_000,
        disconnectGraceIdle: 15_000
    }

    private shoe = new LtShoe(6, 0.75)
    private round: BacRoundResult | null = null
    private history: BacHistoryEntry[] = []

    protected createSeatState(): BacSeatState {
        return { bets: emptyBets(), lastBets: emptyBets() }
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
        this.clearVotes()
        this.advance('betting', TIMERS.betting)
    }

    protected onAction(userId: string, action: BacAction) {
        // requirePlayer is enough of a guard: baccarat only ever registers a
        // player through sit(), so a registered player is always seated.
        const player = this.requirePlayer(userId)

        switch (action.kind) {
            case 'bet': return this.placeBet(player, action.spot, Number(action.amount))
            case 'clear': return this.clearBets(player)
            case 'repeat': return this.repeatBets(player)
            case 'scale': return this.scaleBets(player, Number(action.factor))
        }
    }

    private async placeBet(player: LtPlayer<BacSeatState>, spot: BacBetKey, amount: number) {
        if (this.phase !== 'betting') fail('Betting is closed')
        if (!BAC_BET_KEYS.includes(spot)) fail('Invalid bet')
        if (!Number.isFinite(amount) || amount <= 0) fail('Invalid stake')
        if (amount < this.config.minBet) fail(`Minimum bet is ${this.config.minBet}`)
        const total = round4(player.game.bets[spot] + amount)

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

    private async repeatBets(player: LtPlayer<BacSeatState>) {
        if (this.phase !== 'betting') fail('Betting is closed')
        if (totalStaked(player.game.lastBets) <= 0) fail('No previous bet to repeat')
        await this.applyBets(player, { ...player.game.lastBets }, 'repeated')
    }

    private async scaleBets(player: LtPlayer<BacSeatState>, factor: number) {
        if (this.phase !== 'betting') fail('Betting is closed')
        if (factor !== 0.5 && factor !== 2) fail('Invalid scale')
        // Sizing up before committing: a seat with nothing down yet scales its
        // last bet instead of doing nothing.
        const base = totalStaked(player.game.bets) > 0 ? player.game.bets : player.game.lastBets
        if (totalStaked(base) <= 0) fail('No bet to scale')

        const target = emptyBets()
        for (const key of BAC_BET_KEYS) {
            // Chips only come in whole denominations, so a scaled stake has to
            // land on one too -- rounding to 4dp still leaves the fractional
            // cents the table cannot legally hold a bet in.
            if (base[key] > 0) target[key] = Math.round(base[key] * factor)
        }
        await this.applyBets(player, target, factor > 1 ? 'doubled' : 'halved')
    }

    /**
     * Replace a seat's whole bet set in one move. Validated in full before any
     * escrow moves, so a bet that fails min/max or affordability is refused
     * outright rather than landing half-applied across the five spots.
     */
    private async applyBets(player: LtPlayer<BacSeatState>, target: BacBets, verb: string) {
        const total = totalStaked(target)
        if (total <= 0) fail('Nothing to bet')
        for (const key of BAC_BET_KEYS) {
            if (target[key] <= 0) continue
            if (target[key] < this.config.minBet) fail(`Minimum bet is ${this.config.minBet}`)
        }
        const balance = Number(await getBalance(player.userId))
        if (total > balance) fail('Not enough balance')

        // New stakes land before the old ones are released: a failure partway
        // through only has to unwind what this call just placed, leaving the
        // seat's existing bet exactly as it was rather than half-replaced.
        const oldIds = [...player.wagerIds]
        const placed = emptyBets()
        try {
            for (const key of BAC_BET_KEYS) {
                if (target[key] <= 0) continue
                await this.stake(player, target[key], key)
                placed[key] = target[key]
            }
        } catch (error) {
            const newIds = player.wagerIds.slice(oldIds.length)
            player.wagerIds = oldIds
            await this.refund(player.userId, newIds)
            throw error
        }

        const newIds = player.wagerIds.slice(oldIds.length)
        player.wagerIds = newIds
        player.game.bets = placed
        await this.refund(player.userId, oldIds)

        this.bus.broadcast({
            t: 'event',
            kind: 'game',
            payload: { type: 'rebet', name: player.name, verb, amount: total }
        })
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
            if (totalStaked(bets) <= 0) {
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
        for (const player of this.everyone()) {
            // Carries forward across a round a seat sits out, so REPEAT still
            // has something to restore after skipping a hand.
            if (totalStaked(player.game.bets) > 0) player.game.lastBets = player.game.bets
            player.game.bets = emptyBets()
        }

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
