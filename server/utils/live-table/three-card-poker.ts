import { LtShoe } from '#server/utils/live-table/shoe'
import { LiveTable, fail, round4, type LtConfig, type LtPlayer } from '#server/utils/live-table/table'
import { LB_MIN_BET } from '#shared/utils/live-blackjack/chips'
import { dealerQualifies, evaluateHand, type TcpCard, type TcpHand } from '#shared/utils/three-card-poker/hand'
import { resolveHand } from '#shared/utils/three-card-poker/payouts'
import type {
    TcpAction,
    TcpHandView,
    TcpSeatState,
    TcpSharedState,
    TcpSpot
} from '#shared/utils/three-card-poker/types'
import type { LtCard, LtPayout } from '#shared/utils/live-table/types'

const TIMERS = {
    betting: 20_000,
    /** Held long enough for the client to slide three cards into every seat. */
    dealing: 1_800,
    decision: 24_000,
    reveal: 3_200,
    payoutBase: 4_000,
    payoutPerExtraPlayer: 700,
    payoutMax: 7_000,
    disconnectGrace: 45_000,
    disconnectGraceIdle: 8_000
}

const SPOTS: TcpSpot[] = ['ante', 'pairPlus']

/** The shoe fills both fields on every card it deals. */
function faces(cards: LtCard[]): TcpCard[] {
    return cards.map(card => ({ rank: card.rank!, suit: card.suit! }))
}

function view(hand: TcpHand): TcpHandView {
    return { category: hand.category, label: hand.label }
}

/**
 * Three card poker. Every seat plays its own three cards against the dealer and
 * never against another seat, so there is no turn order at all: one shared
 * play-or-fold window covers the whole table and a seat that lets it run out
 * folds.
 */
export class ThreeCardPokerTable extends LiveTable<TcpSeatState, TcpSharedState, TcpAction> {
    protected readonly config: LtConfig = {
        game: 'three-card-poker',
        seats: 5,
        minBet: LB_MIN_BET,
        // No table maximum by design; the player's own balance is the ceiling.
        maxBet: Number.MAX_SAFE_INTEGER,
        disconnectGrace: TIMERS.disconnectGrace,
        disconnectGraceIdle: TIMERS.disconnectGraceIdle
    }

    // One deck, zero penetration: the shoe reports itself spent the moment any
    // card is gone, so every hand is dealt off a fresh shuffle.
    protected shoe = new LtShoe(1, 0)
    private dealerCards: LtCard[] = []
    private dealerHand: TcpHand | null = null

    protected createSeatState(): TcpSeatState {
        return {
            pendingAnte: 0,
            pendingPairPlus: 0,
            placed: [],
            ante: 0,
            pairPlus: 0,
            play: 0,
            lastAnte: 0,
            lastPairPlus: 0,
            cards: [],
            hand: null,
            decision: null,
            result: null
        }
    }

    protected gameState(): TcpSharedState {
        const shown = this.phase === 'reveal' || this.phase === 'payout'
        return {
            dealer: {
                // Rank and suit are stripped rather than flagged, so a client
                // cannot read the dealer's hand out of the snapshot early.
                cards: this.dealerCards.map(card => (shown ? card : { id: card.id, hidden: true })),
                hand: shown && this.dealerHand ? view(this.dealerHand) : null,
                qualified: shown && this.dealerHand ? dealerQualifies(this.dealerHand) : null
            }
        }
    }

    protected onTableActive() {
        this.startBetting()
    }

    protected onAction(userId: string, action: TcpAction) {
        const player = this.requirePlayer(userId)
        if (player.seatIndex === null) fail('Take a seat first')

        switch (action?.t) {
            case 'bet':
                return this.placeBet(player, action.spot, Number(action.amount))
            case 'undo':
                return this.undoBet(player)
            case 'clear':
                return this.clearBet(player)
            case 'repeat':
                return this.repeatBet(player)
            case 'scale':
                return this.scaleBets(player, Number(action.factor))
            case 'decide':
                return this.decide(player, !!action.play)
            default:
                fail('Unknown action')
        }
    }

    protected onPhaseEnd(phase: string) {
        switch (phase) {
            case 'betting':
                return this.dealRound()
            case 'dealing':
                return this.openDecision()
            case 'decision':
                return this.closeDecision()
            case 'reveal':
                return this.payRound()
            case 'payout':
                return this.startBetting()
        }
    }

    // ─── betting ───────────────────────────────────────────────────────────

    private startBetting() {
        this.nextRoundAt = null
        if (!this.seated().length) {
            this.setPhase('idle', null)
            this.message = 'Waiting for players'
            return
        }
        this.roundId++
        this.dealerCards = []
        this.dealerHand = null
        this.clearVotes()
        for (const player of this.everyone()) {
            const { lastAnte, lastPairPlus } = player.game
            player.game = this.createSeatState()
            player.game.lastAnte = lastAnte
            player.game.lastPairPlus = lastPairPlus
        }
        this.message = 'Place your ante'
        this.advance('betting', TIMERS.betting)
    }

    private requireBetting() {
        if (this.phase !== 'betting') fail('Betting is closed')
    }

    private placeBet(player: LtPlayer<TcpSeatState>, spot: TcpSpot, amount: number) {
        this.requireBetting()
        if (!SPOTS.includes(spot)) fail('Unknown bet spot')
        if (!Number.isFinite(amount) || amount <= 0) fail('Invalid bet')

        const seat = player.game
        const next = (spot === 'ante' ? seat.pendingAnte : seat.pendingPairPlus) + amount
        // Playing costs a second ante, so the seat has to be able to cover both
        // or it is committing to a bet it will be unable to finish.
        const committed = seat.pendingAnte * 2 + seat.pendingPairPlus
        const extra = spot === 'ante' ? amount * 2 : amount
        if (committed + extra > player.balanceHint) fail('Not enough chips')

        if (spot === 'ante') seat.pendingAnte = next
        else seat.pendingPairPlus = next
        seat.placed.push({ spot, amount })
    }

    private undoBet(player: LtPlayer<TcpSeatState>) {
        this.requireBetting()
        const last = player.game.placed.pop()
        if (!last) return
        if (last.spot === 'ante') player.game.pendingAnte -= last.amount
        else player.game.pendingPairPlus -= last.amount
        // A vote only means something while it stakes the seat to the round.
        if (!player.game.pendingAnte) player.votedStart = false
    }

    private clearBet(player: LtPlayer<TcpSeatState>) {
        this.requireBetting()
        player.game.pendingAnte = 0
        player.game.pendingPairPlus = 0
        player.game.placed = []
        player.votedStart = false
    }

    private repeatBet(player: LtPlayer<TcpSeatState>) {
        this.requireBetting()
        const seat = player.game
        if (!seat.lastAnte) fail('Nothing to repeat')
        this.clearBet(player)
        this.placeBet(player, 'ante', seat.lastAnte)
        if (seat.lastPairPlus) this.placeBet(player, 'pairPlus', seat.lastPairPlus)
    }

    /**
     * Halve or double every bet on the layout, pair plus riding along with the
     * ante at the same factor. Scales last round's bet instead when nothing is
     * staked yet, so a player can size up before committing to a fresh ante.
     * Validated in full before anything is mutated — a bet that cannot legally
     * scale is refused outright rather than applied to just one spot.
     */
    private scaleBets(player: LtPlayer<TcpSeatState>, factor: number) {
        this.requireBetting()
        if (factor !== 0.5 && factor !== 2) fail('Invalid scale')

        const seat = player.game
        const fromLayout = seat.pendingAnte > 0
        const baseAnte = fromLayout ? seat.pendingAnte : seat.lastAnte
        const basePairPlus = fromLayout ? seat.pendingPairPlus : seat.lastPairPlus
        if (!baseAnte) fail('Nothing to scale')

        const nextAnte = round4(baseAnte * factor)
        const nextPairPlus = basePairPlus ? round4(basePairPlus * factor) : 0
        if (nextAnte < this.config.minBet) fail('Below the table minimum')
        if (nextAnte * 2 + nextPairPlus > player.balanceHint) fail('Not enough chips')

        this.clearBet(player)
        this.placeBet(player, 'ante', nextAnte)
        if (nextPairPlus) this.placeBet(player, 'pairPlus', nextPairPlus)
    }

    /** A vote only counts once the seat has an ante down — nothing to deal early otherwise. */
    protected override everyoneVoted(): boolean {
        const waiting = this.everyone().filter(p => !p.leaving)
        return waiting.length > 0 && waiting.every(p => p.game.pendingAnte > 0 && p.votedStart)
    }

    /**
     * The default fires `onPhaseEnd` inline, but `dealRound` is async — called
     * bare, its stake and shuffle would run detached from the run() chain that
     * publishes the result. A nested run() is what closeBetting does on the
     * blackjack table for the same reason.
     */
    protected override async onVoteStart() {
        if (this.everyoneVoted()) void this.run(() => this.dealRound())
    }

    // ─── the deal ──────────────────────────────────────────────────────────

    private async dealRound() {
        if (this.shoe.needsShuffle) this.shoe.shuffle()

        for (const player of this.seated()) {
            if (player.game.pendingAnte <= 0) continue
            try {
                await this.stake(player, player.game.pendingAnte, 'ante')
                if (player.game.pendingPairPlus > 0) {
                    await this.stake(player, player.game.pendingPairPlus, 'pairPlus')
                }
                player.game.ante = player.game.pendingAnte
                player.game.pairPlus = player.game.pendingPairPlus
                player.game.lastAnte = player.game.pendingAnte
                player.game.lastPairPlus = player.game.pendingPairPlus
            } catch {
                // The balance moved between placing and dealing — spent in
                // another tab, most likely. Sit this seat out and hand back
                // whatever did land, rather than killing everyone else's round.
                const ids = player.wagerIds
                player.wagerIds = []
                await this.refund(player.userId, ids)
                player.game.ante = 0
                player.game.pairPlus = 0
            }
            player.game.pendingAnte = 0
            player.game.pendingPairPlus = 0
            player.game.placed = []
        }

        const active = this.inRound()
        if (!active.length) {
            this.startBetting()
            return
        }

        for (let i = 0; i < 3; i++) {
            for (const player of active) player.game.cards.push(this.shoe.draw())
            this.dealerCards.push(this.shoe.draw(true))
        }
        for (const player of active) {
            player.game.hand = view(evaluateHand(faces(player.game.cards)))
        }
        this.dealerHand = evaluateHand(faces(this.dealerCards))

        this.message = 'Dealing'
        this.advance('dealing', TIMERS.dealing)
    }

    private inRound(): LtPlayer<TcpSeatState>[] {
        return this.everyone().filter(player => player.game.ante > 0)
    }

    // ─── the one decision ──────────────────────────────────────────────────

    private openDecision() {
        this.message = 'Play or fold'
        this.advance('decision', TIMERS.decision)
    }

    private async decide(player: LtPlayer<TcpSeatState>, play: boolean) {
        if (this.phase !== 'decision') fail('Not the time to decide')
        const seat = player.game
        if (seat.ante <= 0) fail('You are not in this hand')
        if (seat.decision) fail('You have already decided')

        if (play) {
            // Staked before the decision is recorded so a seat that cannot cover
            // the play bet stays undecided and can still fold on the timer.
            await this.stake(player, seat.ante, 'play')
            seat.play = seat.ante
        }
        seat.decision = play ? 'play' : 'fold'

        if (this.inRound().every(p => p.game.decision)) this.reveal()
    }

    private closeDecision() {
        for (const player of this.inRound()) {
            if (!player.game.decision) player.game.decision = 'fold'
        }
        this.reveal()
    }

    /**
     * Showing the dealer here rather than at payout keeps one result on the
     * felt for the whole settle window, which is what the countdown to the
     * next round is measured against.
     */
    private reveal() {
        const dealer = this.dealerHand
        this.message = dealer
            ? (dealerQualifies(dealer) ? `Dealer: ${dealer.label}` : `Dealer does not qualify — ${dealer.label}`)
            : 'Showdown'

        this.nextRoundAt = Date.now() + TIMERS.reveal + this.payoutHold(this.inRound().length)
        this.advance('reveal', TIMERS.reveal)
    }

    private payoutHold(inRound: number) {
        const extra = Math.max(0, inRound - 1)
        return Math.min(TIMERS.payoutMax, TIMERS.payoutBase + extra * TIMERS.payoutPerExtraPlayer)
    }

    // ─── settlement ────────────────────────────────────────────────────────

    private async payRound() {
        const dealer = this.dealerHand
        if (!dealer) {
            this.startBetting()
            return
        }

        const payouts: LtPayout[] = []
        for (const player of this.inRound()) {
            const seat = player.game
            const hand = evaluateHand(faces(seat.cards))
            const result = resolveHand(
                { ante: seat.ante, pairPlus: seat.pairPlus, played: seat.decision === 'play' },
                hand,
                dealer
            )
            seat.result = {
                net: result.net,
                dealerQualified: result.dealerQualified,
                ante: result.ante,
                play: result.play,
                anteBonusTier: result.anteBonusTier,
                anteBonusPayout: result.anteBonusPayout,
                pairPlusTier: result.pairPlusTier,
                pairPlusPayout: result.pairPlusPayout
            }
            payouts.push({ userId: player.userId, staked: result.staked, payout: result.payout })
        }

        const hold = this.payoutHold(payouts.length)
        this.nextRoundAt = Date.now() + hold
        this.advance('payout', hold)
        await this.settle(payouts)
    }
}

export const threeCardPokerTable = new ThreeCardPokerTable()
