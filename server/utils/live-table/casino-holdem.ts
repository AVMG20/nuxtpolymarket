import { LtShoe } from '#server/utils/live-table/shoe'
import { LiveTable, fail, round4 } from '#server/utils/live-table/table'
import type { LtConfig, LtPlayer } from '#server/utils/live-table/table'
import { bestHand, evaluateFive } from '#shared/utils/casino-holdem/evaluator'
import type { ChCard, ChHandValue } from '#shared/utils/casino-holdem/evaluator'
import {
    CH_CALL_MULTIPLIER,
    CH_MIN_BET,
    CH_TIMERS,
    dealerQualifies,
    resolveSeat
} from '#shared/utils/casino-holdem/rules'
import type { ChAction, ChBetSpot, ChSeatState, ChSharedState } from '#shared/utils/casino-holdem/types'
import { LB_CHIPS } from '#shared/utils/live-blackjack/chips'
import type { LtCard, LtPayout } from '#shared/utils/live-table/types'

const CHIP_VALUES = new Set(LB_CHIPS.map(c => c.value))

/** Server-side cards always carry a rank and suit; only the wire hides them. */
function faces(cards: LtCard[]): ChCard[] {
    return cards.map(card => ({ rank: card.rank!, suit: card.suit! }))
}

interface BetLog {
    spot: ChBetSpot
    amount: number
}

/**
 * Casino Hold'em. Every seat plays the dealer and never another seat, so the
 * whole table can win the same hand — and there is no turn order at all: one
 * call-or-fold decision per seat, all of them on the same clock.
 */
export class CasinoHoldemTable extends LiveTable<ChSeatState, ChSharedState, ChAction> {
    // LtConfig still carries maxBet for the wire contract shared with other games;
    // this table never reads it back — a player's own balance is the only ceiling.
    protected readonly config: LtConfig = {
        game: 'casino-holdem',
        seats: 5,
        minBet: CH_MIN_BET,
        maxBet: Number.MAX_SAFE_INTEGER,
        disconnectGrace: 60_000,
        disconnectGraceIdle: 15_000
    }

    // One deck, no penetration: every hand starts from a full shuffle, which is
    // what stops a five-seat table running the deck out mid-round.
    protected shoe: LtShoe = new LtShoe(1, 0)
    private board: LtCard[] = []
    private dealerCards: LtCard[] = []
    private dealerHand: ChHandValue | null = null
    private dealerQualified: boolean | null = null
    private revealed = false
    private bettingCut = false
    private betLog = new Map<string, BetLog[]>()

    protected createSeatState(): ChSeatState {
        return {
            pendingAnte: 0,
            pendingAa: 0,
            ante: 0,
            aa: 0,
            call: 0,
            lastAnte: 0,
            lastAa: 0,
            cards: [],
            decision: null,
            handLabel: null,
            outcome: null,
            dealerQualified: null,
            net: null,
            aaLabel: null,
            aaMultiplier: null
        }
    }

    protected gameState(): ChSharedState {
        return {
            board: this.board,
            dealer: {
                cards: this.dealerCards.map(card => (card.hidden ? { id: card.id, hidden: true } : card)),
                label: this.revealed ? this.dealerHand?.label ?? null : null,
                qualified: this.revealed ? this.dealerQualified : null
            }
        }
    }

    protected onTableActive() {
        this.startBetting()
    }

    protected onAction(userId: string, action: ChAction): void | Promise<void> {
        const player = this.requirePlayer(userId)
        if (player.seatIndex === null) fail('Take a seat to play')

        switch (action.t) {
            case 'bet': return this.placeBet(player, action.spot, Number(action.amount))
            case 'undo': return this.undoBet(player)
            case 'clear': return this.clearBet(player)
            case 'repeat': return this.repeatBet(player)
            case 'scale': return this.scaleBet(player, Number(action.factor))
            case 'decide': return this.decide(player, action.decision)
            default: fail('Unknown action')
        }
    }

    protected onPhaseEnd(phase: string): void | Promise<void> {
        switch (phase) {
            case 'betting': return this.dealHand()
            case 'deal': return this.openDecision()
            case 'decision': return this.dealTurnAndRiver()
            case 'board': return this.showdown()
            case 'reveal': return this.payRound()
            case 'payout': return this.nextRound()
        }
    }

    // ─── betting ───────────────────────────────────────────────────────────

    private startBetting() {
        this.roundId++
        this.board = []
        this.dealerCards = []
        this.dealerHand = null
        this.dealerQualified = null
        this.revealed = false
        this.bettingCut = false
        this.nextRoundAt = null
        this.betLog.clear()
        this.shoe.shuffle()

        for (const player of this.seated()) {
            const seat = player.game
            seat.pendingAnte = 0
            seat.pendingAa = 0
            seat.ante = 0
            seat.aa = 0
            seat.call = 0
            seat.cards = []
            seat.decision = null
            seat.handLabel = null
            seat.outcome = null
            seat.dealerQualified = null
            seat.net = null
            seat.aaLabel = null
            seat.aaMultiplier = null
        }

        this.message = 'Place your ante'
        this.advance('betting', CH_TIMERS.betting)
    }

    private logFor(userId: string): BetLog[] {
        let log = this.betLog.get(userId)
        if (!log) {
            log = []
            this.betLog.set(userId, log)
        }
        return log
    }

    /**
     * The call is not a real choice: a seat that cannot cover it can only fold
     * and forfeit its ante. So the layout has to leave room for the call while
     * the bet is still being placed, rather than failing at the decision.
     */
    private requireBankroll(player: LtPlayer<ChSeatState>, ante: number, aa: number) {
        if (ante + aa > player.balanceHint) fail('Not enough chips')
        if (ante + aa + round4(ante * CH_CALL_MULTIPLIER) > player.balanceHint) {
            fail(`Not enough chips — the call costs ${CH_CALL_MULTIPLIER}x your ante, so keep some back`)
        }
    }

    private placeBet(player: LtPlayer<ChSeatState>, spot: ChBetSpot, amount: number) {
        if (this.phase !== 'betting') fail('Betting is closed')
        if (!CHIP_VALUES.has(amount)) fail('Invalid chip')

        const seat = player.game
        const ante = spot === 'ante' ? seat.pendingAnte + amount : seat.pendingAnte
        const aa = spot === 'ante' ? seat.pendingAa : seat.pendingAa + amount

        if (spot !== 'ante') {
            if (seat.pendingAnte <= 0) fail('Place an ante first')
            if (aa > seat.pendingAnte) fail('The AA bonus cannot exceed your ante')
        }
        this.requireBankroll(player, ante, aa)

        seat.pendingAnte = ante
        seat.pendingAa = aa

        this.logFor(player.userId).push({ spot, amount })
        this.maybeCutBetting()
    }

    private undoBet(player: LtPlayer<ChSeatState>) {
        if (this.phase !== 'betting') fail('Betting is closed')
        const last = this.logFor(player.userId).pop()
        if (!last) return

        const seat = player.game
        if (last.spot === 'ante') {
            seat.pendingAnte = Math.max(0, seat.pendingAnte - last.amount)
            // The bonus can never be bigger than the ante left behind it.
            seat.pendingAa = Math.min(seat.pendingAa, seat.pendingAnte)
        } else {
            seat.pendingAa = Math.max(0, seat.pendingAa - last.amount)
        }
    }

    private clearBet(player: LtPlayer<ChSeatState>) {
        if (this.phase !== 'betting') fail('Betting is closed')
        player.game.pendingAnte = 0
        player.game.pendingAa = 0
        this.betLog.set(player.userId, [])
    }

    private repeatBet(player: LtPlayer<ChSeatState>) {
        if (this.phase !== 'betting') fail('Betting is closed')
        const seat = player.game
        if (seat.lastAnte <= 0) fail('No previous bet to repeat')
        this.requireBankroll(player, seat.lastAnte, seat.lastAa)

        seat.pendingAnte = seat.lastAnte
        seat.pendingAa = seat.lastAa
        this.betLog.set(player.userId, [])
        this.maybeCutBetting()
    }

    /**
     * Halve or double the layout. Scales whatever is already down; with nothing
     * staked yet it scales last round's bet instead, so a player can size up
     * before committing. The AA bonus rides the same factor as the ante, which
     * keeps it inside its cap for free since it started there.
     */
    private scaleBet(player: LtPlayer<ChSeatState>, factor: number) {
        if (this.phase !== 'betting') fail('Betting is closed')
        if (factor !== 0.5 && factor !== 2) fail('Invalid bet scale')

        const seat = player.game
        const onLayout = seat.pendingAnte > 0
        const baseAnte = onLayout ? seat.pendingAnte : seat.lastAnte
        const baseAa = onLayout ? seat.pendingAa : seat.lastAa
        if (baseAnte <= 0) fail('No bet to scale')

        const ante = round4(baseAnte * factor)
        const aa = round4(baseAa * factor)
        if (ante < this.config.minBet) fail('Below the table minimum')
        this.requireBankroll(player, ante, aa)

        seat.pendingAnte = ante
        seat.pendingAa = aa
        this.betLog.set(player.userId, [])
        this.maybeCutBetting()
    }

    /** Nobody should sit through a countdown they have already answered. */
    private maybeCutBetting() {
        if (this.bettingCut || this.phase !== 'betting') return
        const seated = this.seated()
        if (!seated.length || seated.some(p => p.game.pendingAnte <= 0)) return
        if ((this.phaseEndsAt ?? 0) - Date.now() <= CH_TIMERS.bettingCut) return

        this.bettingCut = true
        this.message = 'All bets in'
        this.advance('betting', CH_TIMERS.bettingCut)
    }

    // ─── the deal ──────────────────────────────────────────────────────────

    private async dealHand() {
        const entrants: LtPlayer<ChSeatState>[] = []

        for (const player of this.seated()) {
            const seat = player.game
            if (seat.pendingAnte <= 0) continue
            try {
                await this.stake(player, seat.pendingAnte, 'ante')
            } catch {
                // One seat short of chips must not take the whole round down.
                seat.pendingAnte = 0
                seat.pendingAa = 0
                continue
            }
            seat.ante = seat.pendingAnte
            seat.lastAnte = seat.pendingAnte
            seat.lastAa = 0

            if (seat.pendingAa > 0) {
                try {
                    await this.stake(player, seat.pendingAa, 'aa')
                    seat.aa = seat.pendingAa
                    seat.lastAa = seat.pendingAa
                } catch { /* the ante is down; the bonus simply does not ride */ }
            }

            seat.pendingAnte = 0
            seat.pendingAa = 0
            entrants.push(player)
        }

        if (!entrants.length) {
            this.startBetting()
            return
        }

        for (let round = 0; round < 2; round++) {
            for (const player of entrants) player.game.cards.push(this.shoe.draw())
            this.dealerCards.push(this.shoe.draw(true))
        }
        this.board = [this.shoe.draw(), this.shoe.draw(), this.shoe.draw()]

        this.message = 'The flop is out'
        this.advance('deal', CH_TIMERS.deal)
    }

    private openDecision() {
        this.message = 'Every seat decides at once'
        this.advance('decision', CH_TIMERS.decision)
        this.maybeEndDecision()
    }

    /** Seats still in the hand that have not answered yet. */
    private undecided(): LtPlayer<ChSeatState>[] {
        return this.seated().filter(p => p.game.cards.length > 0 && p.game.decision === null)
    }

    private async decide(player: LtPlayer<ChSeatState>, decision: 'call' | 'fold') {
        if (this.phase !== 'decision') fail('There is nothing to decide')
        const seat = player.game
        if (!seat.cards.length) fail('You are not in this hand')
        if (seat.decision) fail('You have already decided')

        if (decision === 'call') {
            const call = round4(seat.ante * CH_CALL_MULTIPLIER)
            // Recorded only once the money is down, so a seat that cannot cover
            // the call is still free to fold.
            await this.stake(player, call, 'call')
            seat.call = call
            seat.decision = 'call'
        } else {
            seat.decision = 'fold'
        }

        this.maybeEndDecision()
    }

    private maybeEndDecision() {
        if (this.phase !== 'decision' || this.undecided().length) return
        this.advance('decision', CH_TIMERS.decisionCut)
    }

    private dealTurnAndRiver() {
        // Running out the clock is a fold; the ante is already staked either way.
        for (const player of this.seated()) {
            const seat = player.game
            if (seat.cards.length && !seat.decision) seat.decision = 'fold'
        }

        this.board.push(this.shoe.draw(), this.shoe.draw())
        this.message = 'Turn and river'
        this.advance('board', CH_TIMERS.board)
    }

    private showdown() {
        for (const card of this.dealerCards) card.hidden = undefined
        this.revealed = true

        const board = faces(this.board)
        this.dealerHand = bestHand([...faces(this.dealerCards), ...board])
        this.dealerQualified = dealerQualifies(this.dealerHand)

        for (const player of this.seated()) {
            const seat = player.game
            if (!seat.cards.length) continue
            seat.handLabel = bestHand([...faces(seat.cards), ...board]).label
        }

        this.message = this.dealerQualified
            ? `Dealer: ${this.dealerHand.label}`
            : `Dealer does not qualify — ${this.dealerHand.label}`

        const inHand = this.seated().filter(p => p.game.cards.length > 0).length
        this.nextRoundAt = Date.now() + CH_TIMERS.reveal + this.payoutHold(inHand)
        this.advance('reveal', CH_TIMERS.reveal)
    }

    private async payRound() {
        const board = faces(this.board)
        const payouts: LtPayout[] = []

        for (const player of this.seated()) {
            const seat = player.game
            if (!seat.cards.length) continue

            const hole = faces(seat.cards)
            const folded = seat.decision !== 'call'
            const aaHand = seat.aa > 0 ? evaluateFive([...hole, ...board.slice(0, 3)]) : null
            const result = resolveSeat(
                { ante: seat.ante, call: seat.call, aa: seat.aa },
                {
                    folded,
                    player: folded ? null : bestHand([...hole, ...board]),
                    dealer: this.dealerHand,
                    aa: aaHand
                }
            )

            seat.outcome = result.outcome
            seat.dealerQualified = result.dealerQualified
            seat.net = round4(result.net)
            seat.aaLabel = aaHand?.label ?? null
            seat.aaMultiplier = aaHand ? result.aaMultiplier : null
            payouts.push({ userId: player.userId, staked: result.staked, payout: result.payout })
        }

        await this.settle(payouts)

        // The dealer's result set at showdown stays up: it is what the felt is
        // being read for, and it outlives the phase that produced it.
        const hold = this.payoutHold(payouts.length)
        this.nextRoundAt = Date.now() + hold
        this.advance('payout', hold)
    }

    private payoutHold(inHand: number) {
        return CH_TIMERS.payoutBase + Math.max(0, inHand - 1) * CH_TIMERS.payoutPerExtraSeat
    }

    private nextRound() {
        this.nextRoundAt = null
        if (!this.seated().length) {
            this.setPhase('idle', null)
            this.message = 'Waiting for players'
            return
        }
        this.startBetting()
    }
}

export const casinoHoldemTable = new CasinoHoldemTable()
