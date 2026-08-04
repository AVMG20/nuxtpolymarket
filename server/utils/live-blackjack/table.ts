import * as Sentry from '@sentry/nuxt'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { liveBlackjackWagers } from '#server/database/schema'
import { accumulateRake, credit, debit, getBalance, getDailyNet } from '#server/utils/balance'
import { LB_CHIPS, LB_MAX_BET, LB_MIN_BET } from '#shared/utils/live-blackjack/chips'
import {
    canDouble,
    canSplit,
    canSurrender,
    dealerShouldHit,
    handScore,
    hiLoValue,
    isBlackjack,
    LB_RULES,
    LB_TIMERS,
    rankValue,
    round4,
    settleHand
} from '#shared/utils/live-blackjack/rules'
import { isBetSpot, LB_SIDE_BETS, LB_SIDE_BET_LABELS, settleSideBets } from '#shared/utils/live-blackjack/sidebets'
import type {
    LbAction,
    LbBetSpot,
    LbCard,
    LbDealer,
    LbHand,
    LbPhase,
    LbScoreEntry,
    LbSeat,
    LbSideBetKey,
    LbTableState
} from '#shared/utils/live-blackjack/types'
import { broadcast, isUserConnected, peerCount, sendToUser } from './bus'
import { Shoe } from './shoe'

const CATEGORY = 'live-blackjack'
const CHIP_VALUES = new Set(LB_CHIPS.map(c => c.value))
const noSideBets = (): Record<LbSideBetKey, number> => ({ perfectPairs: 0, twentyOnePlusThree: 0 })
const CHAT_MAX_LENGTH = 120
/** Scoreboard rows kept for players who have left the table. */
const SCOREBOARD_ALUMNI = 12

interface SeatState extends LbSeat {
    /** Chips in placement order so a single click can be taken back, spot included. */
    betChips: { spot: LbBetSpot, amount: number }[]
    /**
     * Last known balance, refreshed whenever one is pushed to the client. Placing
     * a chip checks this instead of the database — the check is advisory, and on
     * a remote database a read per chip is the difference between a rack that
     * responds to a click and one that lags a second behind it.
     */
    balanceHint: number
    disconnectedAt: number | null
    releaseTimer: ReturnType<typeof setTimeout> | null
    /** Escrow rows for everything staked this round, closed out at settlement. */
    wagerIds: string[]
}

interface ScoreRecord {
    name: string
    emblem: string | null
    prestige: number
    net: number
    winStreak: number
    lastNet: number | null
    leftAt: number | null
}

function fail(message: string): never {
    throw createError({ statusCode: 400, statusMessage: message })
}

/** `debit` throws a 400 when the balance genuinely will not cover the stake. */
function isInsufficientBalance(error: unknown): boolean {
    const e = error as { statusCode?: number, statusMessage?: string }
    return e?.statusCode === 400 && /insufficient/i.test(e.statusMessage ?? '')
}

function stakeErrorMessage(error: unknown): string {
    return isInsufficientBalance(error)
        ? 'Bet skipped — not enough balance'
        : 'Bet could not be placed — the table had a problem, your money was not taken'
}

/** A stake failing for any reason other than funds is a server fault worth seeing. */
function reportStakeFailure(error: unknown, userId: string, amount: number) {
    if (isInsufficientBalance(error)) return
    console.error('[live-blackjack] stake failed', { userId, amount, error })
    Sentry.captureException(error, { extra: { userId, amount, game: 'live-blackjack' } })
}

class LiveBlackjackTable {
    private seats: (SeatState | null)[] = Array.from({ length: LB_RULES.seats }, () => null)
    private dealerCards: LbCard[] = []
    private phase: LbPhase = 'idle'
    private phaseEndsAt: number | null = null
    private phaseDuration: number | null = null
    private phaseToken = 0
    private timer: ReturnType<typeof setTimeout> | null = null
    /** Held across closeBetting's awaits so the betting timer cannot deal a second round. */
    private closing = false
    private shoe = new Shoe()
    private runningCount = 0
    private activeSeat: number | null = null
    private activeHand: number | null = null
    private roundId = 0
    private version = 0
    private message = 'Waiting for players'
    private scores = new Map<string, ScoreRecord>()
    private handSeq = 0

    // Every mutation — socket message or timer — runs through this chain, so no
    // two of them can interleave across an `await` on a balance write.
    private chain: Promise<unknown> = Promise.resolve()

    run<T>(fn: () => T | Promise<T>): Promise<T> {
        // Publishing on the rejected path too: a rejected action may still have
        // mutated the table (a split that debited before failing a later check).
        const result = this.chain.then(fn).then(
            (value) => {
                this.publish()
                return value
            },
            (error) => {
                this.publish()
                throw error
            }
        )
        this.chain = result.then(() => undefined, () => undefined)
        return result
    }

    // ─── phase plumbing ────────────────────────────────────────────────────

    private setPhase(phase: LbPhase, durationMs: number | null) {
        this.phaseToken++
        this.phase = phase
        this.phaseDuration = durationMs
        this.phaseEndsAt = durationMs === null ? null : Date.now() + durationMs
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = null
        }
    }

    private schedule(ms: number, fn: () => void | Promise<void>) {
        if (this.timer) clearTimeout(this.timer)
        const token = this.phaseToken
        this.timer = setTimeout(() => {
            this.timer = null
            void this.run(async () => {
                if (token !== this.phaseToken) return
                try {
                    await fn()
                } catch {
                    // A failed transition must not wedge the table — but the
                    // round it abandons has real money staked on it, so hand
                    // that back before starting over.
                    try {
                        await this.abortRound()
                    } catch {
                        // Even the refund failed (the database is the likely
                        // culprit for both). The escrow rows stay unsettled, so
                        // the recovery sweep pays them back instead.
                        this.message = 'Table reset'
                        this.enterBetting()
                    }
                }
            })
        }, ms)
    }

    // ─── seats ─────────────────────────────────────────────────────────────

    private seatOf(userId: string): SeatState | null {
        return this.seats.find(s => s?.userId === userId) ?? null
    }

    seatIndexOf(userId: string): number | null {
        return this.seatOf(userId)?.index ?? null
    }

    private requireSeat(userId: string): SeatState {
        const seat = this.seatOf(userId)
        if (!seat) fail('You are not seated')
        return seat
    }

    private activeSeats(): SeatState[] {
        return this.seats.filter((s): s is SeatState => !!s)
    }

    private seatsInPlay(): SeatState[] {
        return this.activeSeats().filter(s => s.hands.length > 0)
    }

    async sit(userId: string, name: string, emblem: string | null, prestige: number, index: number) {
        if (!Number.isInteger(index) || index < 0 || index >= LB_RULES.seats) fail('Invalid seat')
        const existing = this.seatOf(userId)
        if (existing) {
            if (existing.index !== index) fail('You are already seated')
            // Clicking your own seat again takes back a pending stand-up.
            existing.leaving = false
            return
        }
        if (this.seats[index]) fail('Seat is taken')
        const [balance, dailyNet] = await Promise.all([
            getBalance(userId),
            getDailyNet(userId, CATEGORY)
        ])
        // Turning a broke player away at the seat beats letting them sit through
        // rounds they can never bet in.
        if (Number(balance) < LB_MIN_BET) {
            fail(`You need at least ${LB_MIN_BET} to take a seat`)
        }

        const record = this.scores.get(userId)
        this.seats[index] = {
            index,
            userId,
            name,
            emblem,
            prestige,
            connected: true,
            pendingBet: 0,
            pendingSide: noSideBets(),
            lastSide: noSideBets(),
            sideResults: null,
            hands: [],
            insurance: 0,
            insuranceDecided: false,
            lastNet: record?.lastNet ?? null,
            // Counted from this sit-down, not from the last one: it is the
            // figure on the nameplate, and standing up ends that session.
            sessionNet: 0,
            dailyNet,
            winStreak: record?.winStreak ?? 0,
            roundsPlayed: 0,
            betChips: [],
            balanceHint: Number(balance),
            lastBet: 0,
            disconnectedAt: null,
            releaseTimer: null,
            leaving: false,
            votedStart: false,
            wagerIds: []
        }
        this.scores.set(userId, {
            name,
            emblem,
            prestige,
            net: record?.net ?? 0,
            winStreak: record?.winStreak ?? 0,
            lastNet: record?.lastNet ?? null,
            leftAt: null
        })
        broadcast({ t: 'event', kind: 'sit', name, seat: index })
        if (this.phase === 'idle') this.enterBetting()
    }

    leave(userId: string) {
        const seat = this.seatOf(userId)
        if (!seat) return
        // A staked hand still has to resolve and pay out, so the seat only frees
        // once the round is settled.
        if (seat.hands.length > 0 && this.phase !== 'payout') {
            seat.leaving = true
            return
        }
        this.releaseSeat(seat)
    }

    // Chips placed during betting are not staked until the window closes, so
    // there is nothing to hand back here — only settled hands ever moved money.
    private releaseSeat(seat: SeatState) {
        if (seat.releaseTimer) clearTimeout(seat.releaseTimer)
        this.seats[seat.index] = null
        const record = this.scores.get(seat.userId)
        if (record) record.leftAt = Date.now()
        this.pruneScores()
        broadcast({ t: 'event', kind: 'leave', name: seat.name, seat: seat.index })
        if (!this.activeSeats().length) {
            this.endSession()
            if (this.phase === 'betting') {
                this.setPhase('idle', null)
                this.message = 'Waiting for players'
            }
        }
    }

    /**
     * A table session runs from the first player sitting down to the last one
     * leaving. The board tracks that session, so an empty table starts everyone
     * back at zero rather than carrying yesterday's figures forever.
     */
    private endSession() {
        this.scores.clear()
    }

    /**
     * Unsettled escrow is the only reason to hold a seat for someone who is
     * gone: it means real money is still riding on the current round.
     */
    private graceFor(seat: SeatState): number {
        return seat.wagerIds.length ? LB_TIMERS.disconnectGrace : LB_TIMERS.disconnectGraceIdle
    }

    setConnected(userId: string, connected: boolean) {
        const seat = this.seatOf(userId)
        if (!seat) return
        seat.connected = connected
        if (connected) {
            seat.disconnectedAt = null
            if (seat.releaseTimer) {
                clearTimeout(seat.releaseTimer)
                seat.releaseTimer = null
            }
            return
        }
        seat.disconnectedAt = Date.now()
        const grace = this.graceFor(seat)
        seat.releaseTimer = setTimeout(() => {
            void this.run(() => {
                const current = this.seats[seat.index]
                if (current?.userId !== seat.userId || current.connected) return
                this.leave(seat.userId)
            })
        }, grace)
    }


    /**
     * Take money off a player for this round. The debit, the rake and the escrow
     * row are one transaction, so a stake can never exist without its receipt —
     * that receipt is what lets a crashed round be refunded rather than lost.
     */
    private async stake(seat: SeatState, amount: number, kind: string) {
        const id = await db.transaction(async (tx) => {
            await debit(seat.userId, amount.toFixed(4), kind === 'bet' ? CATEGORY : `${CATEGORY}:${kind}`, tx)
            await accumulateRake(seat.userId, amount, tx)
            const [row] = await tx.insert(liveBlackjackWagers).values({
                userId: seat.userId,
                roundId: this.roundId,
                amount: amount.toFixed(4),
                kind
            }).returning({ id: liveBlackjackWagers.id })
            return row!.id
        })
        seat.wagerIds.push(id)
        void this.pushBalance(seat.userId)
    }

    // ─── betting ───────────────────────────────────────────────────────────

    async placeBet(userId: string, amount: number, spot: LbBetSpot = 'main') {
        const seat = this.requireSeat(userId)
        if (this.phase !== 'betting') fail('Betting is closed')
        if (!CHIP_VALUES.has(amount)) fail('Invalid chip')
        if (!isBetSpot(spot)) fail('Invalid bet spot')
        // A side bet rides on a hand, so there has to be one to ride on —
        // otherwise the seat is dropped at lock-in and the chips just vanish.
        if (spot !== 'main' && seat.pendingBet <= 0) fail('Place your main bet first')

        const next = round4((spot === 'main' ? seat.pendingBet : seat.pendingSide[spot]) + amount)
        if (next > LB_MAX_BET) fail('Table maximum reached')

        // Advisory only — the atomic debit at lock-in is what actually enforces
        // affordability, this just stops the player stacking chips they can't
        // cover. The cached figure carries the common case; only a chip that
        // looks unaffordable pays for a round trip to confirm it.
        const wanted = round4(this.committed(seat) + amount)
        if (wanted > seat.balanceHint) {
            seat.balanceHint = Number(await getBalance(userId))
            if (wanted > seat.balanceHint) fail('Not enough balance')
        }

        if (spot === 'main') seat.pendingBet = next
        else seat.pendingSide[spot] = next
        seat.betChips.push({ spot, amount })
    }

    /** Everything this seat has on the layout right now, main and sides together. */
    private committed(seat: SeatState): number {
        return round4(seat.pendingBet + LB_SIDE_BETS.reduce((sum, key) => sum + seat.pendingSide[key], 0))
    }

    /**
     * Skip the rest of the betting clock. Everyone still seated has to have both
     * placed a bet and voted, so one player cannot deal the table out from under
     * someone who is still choosing chips.
     */
    voteStart(userId: string) {
        const seat = this.requireSeat(userId)
        if (this.phase !== 'betting') fail('Betting is closed')
        if (seat.pendingBet <= 0) fail('Place a bet first')
        seat.votedStart = true

        const seated = this.activeSeats()
        if (seated.every(s => s.pendingBet > 0 && s.votedStart)) {
            // Through run(), not bare: it is what publishes the dealing snapshot
            // once the stakes land. Called directly, the phase would flip to
            // 'dealing' with nothing broadcast, and the table would sit on a dead
            // countdown until afterDeal fired — cards then all appearing at once.
            void this.run(() => this.closeBetting())
        }
    }

    undoBet(userId: string) {
        const seat = this.requireSeat(userId)
        if (this.phase !== 'betting') fail('Betting is closed')
        const last = seat.betChips.pop()
        if (!last) return
        if (last.spot === 'main') {
            seat.pendingBet = round4(Math.max(0, seat.pendingBet - last.amount))
        } else {
            seat.pendingSide[last.spot] = round4(Math.max(0, seat.pendingSide[last.spot] - last.amount))
        }
        if (!seat.pendingBet) seat.votedStart = false
    }

    clearBet(userId: string) {
        const seat = this.requireSeat(userId)
        if (this.phase !== 'betting') fail('Betting is closed')
        seat.pendingBet = 0
        seat.pendingSide = noSideBets()
        seat.betChips = []
        seat.votedStart = false
    }

    async repeatBet(userId: string) {
        const seat = this.requireSeat(userId)
        if (this.phase !== 'betting') fail('Betting is closed')
        if (!seat.lastBet) fail('No previous bet')

        const total = round4(seat.lastBet + LB_SIDE_BETS.reduce((sum, key) => sum + seat.lastSide[key], 0))
        const balance = Number(await getBalance(userId))
        if (total > balance) fail('Not enough balance')

        seat.pendingBet = seat.lastBet
        seat.pendingSide = { ...seat.lastSide }
        seat.betChips = [
            { spot: 'main' as LbBetSpot, amount: seat.lastBet },
            ...LB_SIDE_BETS.filter(key => seat.lastSide[key] > 0)
                .map(key => ({ spot: key as LbBetSpot, amount: seat.lastSide[key] }))
        ]
    }

    private enterBetting() {
        this.sweepSeats()
        if (!this.activeSeats().length) {
            this.setPhase('idle', null)
            this.message = 'Waiting for players'
            this.activeSeat = null
            this.activeHand = null
            return
        }
        this.roundId++
        this.dealerCards = []
        for (const seat of this.activeSeats()) {
            seat.hands = []
            seat.insurance = 0
            seat.insuranceDecided = false
            seat.pendingBet = 0
            seat.pendingSide = noSideBets()
            seat.sideResults = null
            seat.betChips = []
            seat.votedStart = false
            // Anything still here means last round's escrow never closed; drop it
            // so the recovery sweep refunds it rather than a later settle
            // marking it paid.
            seat.wagerIds = []
        }
        this.activeSeat = null
        this.activeHand = null
        this.message = 'Place your bets'
        this.setPhase('betting', LB_TIMERS.betting)
        this.schedule(LB_TIMERS.betting, () => this.closeBetting())
    }

    /** Drop seats whose player is gone for good, and park the ones going idle. */
    private sweepSeats() {
        const now = Date.now()
        for (const seat of this.activeSeats()) {
            if (seat.leaving) {
                this.releaseSeat(seat)
                continue
            }
            if (!seat.connected && seat.disconnectedAt && now - seat.disconnectedAt >= this.graceFor(seat)) {
                this.releaseSeat(seat)
            }
        }
    }

    private async closeBetting() {
        // voteStart fires this without awaiting it, so the betting timer can
        // land while the stakes below are still in flight. Both callers would
        // otherwise deal a full round each and every hand would get two cards
        // too many. The guard is taken synchronously, before the first await,
        // which is what makes it airtight.
        if (this.closing) return
        this.closing = true
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = null
        }
        try {
            await this.runCloseBetting()
        } finally {
            this.closing = false
        }
    }

    private async runCloseBetting() {
        const wagering = this.activeSeats().filter(s => s.pendingBet > 0 && s.connected)

        // Seats stake in parallel because every one of these is a round trip to
        // the database, and the table cannot deal until the last of them lands.
        // Run in series, a full table on a slow database spends that whole time
        // sitting on an expired countdown before a single card moves.
        await Promise.all(wagering.map(seat => this.stakeSeat(seat)))

        // No bet, no seat. A player who wants back in clicks the seat again.
        for (const seat of this.activeSeats()) {
            if (!seat.hands.length) this.releaseSeat(seat)
        }

        if (!this.seatsInPlay().length) {
            this.enterBetting()
            return
        }
        this.deal()
    }

    /**
     * Stakes one seat's whole layout. The main bet goes first and alone: a seat
     * that cannot cover it has no hand, and side bets on no hand are meaningless.
     * The two side spots stay in series behind it because both hit the same
     * user row, so running them together only moves the contention.
     */
    private async stakeSeat(seat: SeatState) {
        const bet = seat.pendingBet
        try {
            await this.stake(seat, bet, 'bet')
        } catch (error) {
            // Only an actual failed debit means the player was short. Anything
            // else is our fault, and reporting it as "not enough balance" sent
            // every seat at the table chasing a problem they do not have.
            sendToUser(seat.userId, { t: 'error', message: stakeErrorMessage(error) })
            reportStakeFailure(error, seat.userId, bet)
            seat.pendingBet = 0
            seat.pendingSide = noSideBets()
            seat.betChips = []
            return
        }

        for (const key of LB_SIDE_BETS) {
            const side = seat.pendingSide[key]
            if (side <= 0) continue
            try {
                await this.stake(seat, side, `side:${key}`)
            } catch (error) {
                sendToUser(seat.userId, { t: 'error', message: stakeErrorMessage(error) })
                reportStakeFailure(error, seat.userId, side)
                seat.pendingSide[key] = 0
            }
        }

        seat.hands = [this.newHand(bet, false)]
        seat.lastBet = bet
        seat.lastSide = { ...seat.pendingSide }
        seat.lastNet = null
        seat.roundsPlayed++
        seat.pendingBet = 0
        seat.betChips = []
    }

    // ─── dealing ───────────────────────────────────────────────────────────

    private newHand(bet: number, fromSplit: boolean): LbHand {
        return {
            id: `h${++this.handSeq}`,
            cards: [],
            bet,
            status: 'playing',
            doubled: false,
            fromSplit,
            score: 0,
            soft: false
        }
    }

    private reshuffle() {
        this.shoe.shuffle()
        this.runningCount = 0
        broadcast({ t: 'event', kind: 'shuffle' })
    }

    /**
     * The only place cards leave the shoe. A round that outruns the reserve
     * behind the cut card gets a real, announced shuffle here, so the running
     * count the table publishes always describes the deck actually in play.
     */
    private drawCard(hidden = false): LbCard {
        if (!this.shoe.remaining) this.reshuffle()
        return this.shoe.draw(hidden)
    }

    /** Draw a face-up card and fold it into the running count. */
    private drawUp(): LbCard {
        const card = this.drawCard()
        this.runningCount += hiLoValue(card.rank!)
        return card
    }

    private deal() {
        if (this.shoe.needsShuffle) this.reshuffle()

        const playing = this.seatsInPlay()
        for (const seat of playing) seat.hands[0]!.cards.push(this.drawUp())
        this.dealerCards.push(this.drawUp())
        for (const seat of playing) seat.hands[0]!.cards.push(this.drawUp())
        // Hole card stays out of the count until it is turned over.
        this.dealerCards.push(this.drawCard(true))

        for (const seat of playing) {
            const hand = seat.hands[0]!
            if (isBlackjack(hand)) hand.status = 'blackjack'
        }

        this.message = 'Dealing'
        this.setPhase('dealing', LB_TIMERS.dealing)
        this.schedule(LB_TIMERS.dealing, () => this.afterDeal())
    }

    // A dealer blackjack needs an ace or a ten showing, so every other upcard
    // goes straight to play without a peek.
    /**
     * Side bets are decided by the opening three cards alone, so they resolve
     * here — before insurance, before the peek, before anyone acts. The money
     * still moves at settlement so the round keeps one escrow close-out.
     */
    private resolveSideBets() {
        const upcard = this.dealerCards[0]!
        for (const seat of this.seatsInPlay()) {
            if (!LB_SIDE_BETS.some(key => seat.pendingSide[key] > 0)) continue

            const results = settleSideBets(seat.pendingSide, seat.hands[0]!.cards, upcard)
            seat.sideResults = results
            for (const result of results) {
                if (result.stake <= 0 || result.payout <= 0) continue
                broadcast({
                    t: 'event',
                    kind: 'sideBet',
                    seat: seat.index,
                    name: seat.name,
                    label: `${LB_SIDE_BET_LABELS[result.key]} — ${result.label}`,
                    payout: result.payout
                })
            }
        }
    }

    private afterDeal() {
        const upcard = this.dealerCards[0]!
        this.resolveSideBets()

        if (upcard.rank === 'A') {
            this.message = 'Insurance?'
            this.setPhase('insurance', LB_TIMERS.insurance)
            this.schedule(LB_TIMERS.insurance, () => this.peek())
            return
        }
        if (rankValue(upcard.rank!) === 10) {
            this.peek()
            return
        }
        this.beginPlay()
    }

    async takeInsurance(userId: string, take: boolean) {
        const seat = this.requireSeat(userId)
        if (this.phase !== 'insurance') fail('Insurance is closed')
        if (seat.insuranceDecided) fail('Already decided')
        const hand = seat.hands[0]
        if (!hand) fail('You are not in this round')

        if (take) {
            const cost = round4(hand.bet / 2)
            await this.stake(seat, cost, 'insurance')
            seat.insurance = cost
        }
        seat.insuranceDecided = true

        if (!this.seatsInPlay().some(s => !s.insuranceDecided)) this.peek()
    }

    private peek() {
        const hole = this.dealerCards[1]!
        const dealerTotal = handScore([this.dealerCards[0]!, { ...hole, hidden: false }]).total
        if (dealerTotal === 21) {
            this.revealHole()
            this.message = 'Dealer has blackjack'
            this.setPhase('dealer', LB_TIMERS.dealerDraw)
            this.schedule(LB_TIMERS.dealerDraw, () => this.settleRound())
            return
        }
        this.beginPlay()
    }

    private revealHole() {
        const hole = this.dealerCards[1]
        if (!hole?.hidden) return
        hole.hidden = undefined
        this.runningCount += hiLoValue(hole.rank!)
    }

    // ─── player turns ──────────────────────────────────────────────────────

    private beginPlay() {
        const next = this.findNextHand(-1, 0)
        if (!next) {
            this.dealerTurn()
            return
        }
        this.activeSeat = next.seat
        this.activeHand = next.hand
        this.startTurnTimer()
    }

    private startTurnTimer() {
        const seat = this.currentSeat()
        this.message = seat ? `${seat.name} to act` : 'Player turn'
        this.setPhase('playing', LB_TIMERS.turn)
        this.schedule(LB_TIMERS.turn, () => this.autoPlay())
    }

    /** Turn clock ran out — stand the hand and move on so the table keeps moving. */
    private autoPlay() {
        const hand = this.currentHand()
        if (hand) hand.status = 'stood'
        this.advanceAfterBeat()
    }

    private findNextHand(fromSeat: number, fromHand: number): { seat: number, hand: number } | null {
        for (let s = fromSeat < 0 ? 0 : fromSeat; s < this.seats.length; s++) {
            const seat = this.seats[s]
            if (!seat?.hands.length) continue
            const start = s === fromSeat ? fromHand : 0
            for (let h = start; h < seat.hands.length; h++) {
                if (seat.hands[h]!.status === 'playing') return { seat: s, hand: h }
            }
        }
        return null
    }

    private currentSeat(): SeatState | null {
        return this.activeSeat === null ? null : this.seats[this.activeSeat] ?? null
    }

    private currentHand(): LbHand | null {
        const seat = this.currentSeat()
        if (!seat || this.activeHand === null) return null
        return seat.hands[this.activeHand] ?? null
    }

    /**
     * Hold the table on the hand that just finished before passing the turn on.
     * The clock is cleared for the beat so the countdown ring does not keep
     * running against a player who has already acted.
     */
    private advanceAfterBeat() {
        this.setPhase('playing', null)
        this.schedule(LB_TIMERS.actionBeat, () => this.advance())
    }

    private advance() {
        const from = this.activeSeat ?? 0
        const next = this.findNextHand(from, (this.activeHand ?? 0) + 1)
        if (!next) {
            this.dealerTurn()
            return
        }
        this.activeSeat = next.seat
        this.activeHand = next.hand
        this.startTurnTimer()
    }

    async act(userId: string, action: LbAction) {
        if (this.phase !== 'playing') fail('Not your turn')
        const seat = this.requireSeat(userId)
        if (this.activeSeat !== seat.index) fail('Not your turn')
        const hand = this.currentHand()
        if (!hand || hand.status !== 'playing') fail('Nothing to act on')

        await this.perform(seat, hand, action)
        // Announced only once it actually took: a rejected double should not
        // read as a double to the rest of the table.
        broadcast({ t: 'event', kind: 'action', name: seat.name, seat: seat.index, action })
    }

    private async perform(seat: SeatState, hand: LbHand, action: LbAction) {
        switch (action) {
            case 'hit':
                return this.doHit(hand)
            case 'stand':
                hand.status = 'stood'
                return this.advanceAfterBeat()
            case 'double':
                return this.doDouble(seat, hand)
            case 'split':
                return this.doSplit(seat, hand)
            case 'surrender':
                if (!canSurrender(hand, seat.hands)) fail('Cannot surrender now')
                hand.status = 'surrendered'
                return this.advanceAfterBeat()
        }
    }

    private doHit(hand: LbHand) {
        hand.cards.push(this.drawUp())
        const { total } = handScore(hand.cards)
        if (total > 21) {
            hand.status = 'busted'
            this.advanceAfterBeat()
            return
        }
        // Nothing can improve a 21, so move the table on rather than making
        // everyone wait out the clock.
        if (total === 21) {
            hand.status = 'stood'
            this.advanceAfterBeat()
            return
        }
        this.startTurnTimer()
    }

    private async doDouble(seat: SeatState, hand: LbHand) {
        if (!canDouble(hand)) fail('Cannot double now')
        await this.stake(seat, hand.bet, 'double')

        hand.doubled = true
        hand.cards.push(this.drawUp())
        hand.status = handScore(hand.cards).total > 21 ? 'busted' : 'stood'
        this.advanceAfterBeat()
    }

    private async doSplit(seat: SeatState, hand: LbHand) {
        if (!canSplit(hand, seat.hands)) fail('Cannot split now')
        await this.stake(seat, hand.bet, 'split')

        const moved = hand.cards.pop()!
        const sibling = this.newHand(hand.bet, true)
        sibling.cards.push(moved)
        hand.fromSplit = true

        hand.cards.push(this.drawUp())
        sibling.cards.push(this.drawUp())
        seat.hands.splice(this.activeHand! + 1, 0, sibling)

        if (handScore(hand.cards).total === 21) {
            hand.status = 'stood'
            this.advanceAfterBeat()
            return
        }
        this.startTurnTimer()
    }

    // ─── dealer + settlement ───────────────────────────────────────────────

    private dealerTurn() {
        this.activeSeat = null
        this.activeHand = null
        this.revealHole()
        this.message = 'Dealer plays'
        this.setPhase('dealer', null)

        // Naturals were already ruled safe by the peek, so the dealer only draws
        // when a stood hand could still be beaten.
        const contested = this.seatsInPlay().some(s => s.hands.some(h => h.status === 'stood'))
        this.schedule(LB_TIMERS.dealerDraw, () => (contested ? this.dealerStep() : this.settleRound()))
    }

    private dealerStep(): void | Promise<void> {
        if (!dealerShouldHit(this.dealerCards)) return this.settleRound()
        this.dealerCards.push(this.drawUp())
        this.schedule(LB_TIMERS.dealerDraw, () => this.dealerStep())
    }

    private async settleRound() {
        const dealerBj = this.dealerCards.length === 2 && handScore(this.dealerCards).total === 21

        for (const seat of this.seatsInPlay()) {
            let payout = 0
            let staked = 0

            for (const hand of seat.hands) {
                const result = settleHand(hand, this.dealerCards)
                hand.status = result.status
                hand.payout = result.payout
                hand.net = result.net
                payout = round4(payout + result.payout)
                staked = round4(staked + (hand.doubled ? hand.bet * 2 : hand.bet))
            }

            if (seat.insurance > 0) {
                staked = round4(staked + seat.insurance)
                if (dealerBj) payout = round4(payout + seat.insurance * (1 + LB_RULES.insurancePays))
            }

            for (const result of seat.sideResults ?? []) {
                staked = round4(staked + result.stake)
                payout = round4(payout + result.payout)
            }

            const net = round4(payout - staked)
            // Payout and escrow close-out share a transaction: the round is
            // either fully settled or still recoverable, never half of each.
            const wagerIds = seat.wagerIds
            seat.wagerIds = []
            await db.transaction(async (tx) => {
                if (payout > 0) await credit(seat.userId, payout.toFixed(4), CATEGORY, tx)
                if (wagerIds.length) {
                    await tx.update(liveBlackjackWagers)
                        .set({ settled: true })
                        .where(inArray(liveBlackjackWagers.id, wagerIds))
                }
            })
            void this.pushBalance(seat.userId)

            seat.lastNet = net
            seat.sessionNet = round4(seat.sessionNet + net)
            seat.dailyNet = round4(seat.dailyNet + net)
            // A push is not a loss, so it holds the streak where it is.
            if (net > 0) seat.winStreak++
            else if (net < 0) seat.winStreak = 0
            const record = this.scores.get(seat.userId)
            if (record) {
                // Accumulated rather than copied from the seat: the board spans
                // the whole table session, across leaving and sitting back down.
                record.net = round4(record.net + net)
                record.lastNet = net
                record.winStreak = seat.winStreak
            }
            broadcast({ t: 'event', kind: 'settled', seat: seat.index, net })
        }

        const players = this.activeSeats().length
        const wait = Math.min(
            LB_TIMERS.payoutMax,
            LB_TIMERS.payoutBase + Math.max(0, players - 1) * LB_TIMERS.payoutPerExtraPlayer
        )
        this.message = 'Next round in'
        this.setPhase('payout', wait)
        this.schedule(wait, () => this.enterBetting())
    }

    // ─── chat ──────────────────────────────────────────────────────────────

    chat(userId: string, name: string, text: string) {
        const clean = text.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH)
        if (!clean) return
        const seat = this.seatOf(userId)
        broadcast({ t: 'event', kind: 'chat', name, seat: seat?.index ?? -1, text: clean })
    }

    // ─── balances + snapshots ──────────────────────────────────────────────

    /**
     * Hand back everything a player has staked in the current round. Claiming
     * the escrow rows is the guard: this pays back exactly the rows it flips, so
     * a stake already settled by a payout — or already refunded by the recovery
     * sweep — cannot be handed back a second time.
     */
    private async refundWagers(userId: string, ids: string[]) {
        if (!ids.length) return
        const total = await db.transaction(async (tx) => {
            const rows = await tx.update(liveBlackjackWagers)
                .set({ settled: true })
                .where(and(
                    inArray(liveBlackjackWagers.id, ids),
                    eq(liveBlackjackWagers.settled, false)
                ))
                .returning({ amount: liveBlackjackWagers.amount })
            const sum = round4(rows.reduce((acc, row) => acc + Number(row.amount), 0))
            if (sum > 0) await credit(userId, sum.toFixed(4), `${CATEGORY}:refund`, tx)
            return sum
        })
        if (total > 0) void this.pushBalance(userId)
    }

    /**
     * Tear down a round that cannot be finished. Every seat gets its stake back
     * rather than losing it to whatever failed mid-transition.
     */
    private async abortRound() {
        for (const seat of this.activeSeats()) {
            const ids = seat.wagerIds
            seat.wagerIds = []
            seat.hands = []
            seat.insurance = 0
            await this.refundWagers(seat.userId, ids)
        }
        this.message = 'Round cancelled — bets returned'
        this.enterBetting()
    }

    async pushBalance(userId: string) {
        if (!isUserConnected(userId)) return
        const balance = Number(await getBalance(userId))
        const seat = this.seatOf(userId)
        if (seat) seat.balanceHint = balance
        sendToUser(userId, { t: 'balance', balance })
    }

    private pruneScores() {
        const gone = [...this.scores.entries()]
            .filter(([, r]) => r.leftAt !== null)
            .sort((a, b) => (a[1].leftAt ?? 0) - (b[1].leftAt ?? 0))
        while (gone.length > SCOREBOARD_ALUMNI) {
            const [userId] = gone.shift()!
            this.scores.delete(userId)
        }
    }

    private scoreboard(): LbScoreEntry[] {
        const seated = new Set(this.activeSeats().map(s => s.userId))
        return [...this.scores.entries()]
            .map(([userId, r]) => ({
                userId,
                name: r.name,
                emblem: r.emblem,
                prestige: r.prestige,
                net: r.net,
                winStreak: r.winStreak,
                seated: seated.has(userId),
                lastNet: r.lastNet
            }))
            .sort((a, b) => b.net - a.net || a.name.localeCompare(b.name))
    }

    private wireSeat(seat: SeatState): LbSeat {
        return {
            index: seat.index,
            userId: seat.userId,
            name: seat.name,
            emblem: seat.emblem,
            prestige: seat.prestige,
            connected: seat.connected,
            leaving: seat.leaving,
            votedStart: seat.votedStart,
            pendingBet: seat.pendingBet,
            lastBet: seat.lastBet,
            pendingSide: { ...seat.pendingSide },
            lastSide: { ...seat.lastSide },
            sideResults: seat.sideResults,
            insurance: seat.insurance,
            insuranceDecided: seat.insuranceDecided,
            lastNet: seat.lastNet,
            sessionNet: seat.sessionNet,
            dailyNet: seat.dailyNet,
            winStreak: seat.winStreak,
            roundsPlayed: seat.roundsPlayed,
            hands: seat.hands.map((hand) => {
                const { total, soft } = handScore(hand.cards)
                return { ...hand, score: total, soft }
            })
        }
    }

    private wireDealer(): LbDealer {
        const visible = this.dealerCards.map(c => (c.hidden ? { id: c.id, hidden: true } : c))
        const { total, soft } = handScore(visible)
        return {
            cards: visible,
            score: total,
            soft,
            blackjack: this.dealerCards.length === 2
                && !this.dealerCards.some(c => c.hidden)
                && total === 21,
            busted: total > 21
        }
    }

    snapshot(): LbTableState {
        return {
            version: this.version,
            roundId: this.roundId,
            phase: this.phase,
            phaseEndsAt: this.phaseEndsAt,
            phaseDuration: this.phaseDuration,
            now: Date.now(),
            seats: this.seats.map(s => (s ? this.wireSeat(s) : null)),
            dealer: this.wireDealer(),
            activeSeat: this.activeSeat,
            activeHand: this.activeHand,
            shoe: {
                dealt: this.shoe.dealt,
                total: this.shoe.total,
                decks: this.shoe.decks,
                runningCount: this.runningCount,
                untilShuffle: this.shoe.untilShuffle
            },
            message: this.message,
            scoreboard: this.scoreboard(),
            watching: peerCount(),
            minBet: LB_MIN_BET,
            maxBet: LB_MAX_BET
        }
    }

    publish() {
        this.version++
        broadcast({ t: 'state', state: this.snapshot() })
    }
}

export const liveBlackjackTable = new LiveBlackjackTable()
