import { and, eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { tableWagers } from '#server/database/schema'
import { accumulateRake, credit, debit, getBalance, getDailyNet } from '#server/utils/balance'
import { LtBus } from '#server/utils/live-table/bus'
import type {
    LtPayout,
    LtScoreEntry,
    LtSeat,
    LtServerMessage,
    LtTableState
} from '#shared/utils/live-table/types'

export interface LtConfig {
    /** Also the transaction category, so analytics gets one row per game. */
    game: string
    seats: number
    minBet: number
    maxBet: number
    /** How long a seat is held for a player who disconnected with money staked. */
    disconnectGrace: number
    /** The same, with nothing at risk — no reason to hold the seat as long. */
    disconnectGraceIdle: number
}

const CHAT_MAX_LENGTH = 120
const SCOREBOARD_ALUMNI = 12

export function round4(value: number): number {
    return Math.round(value * 10_000) / 10_000
}

export class LtError extends Error {}

/** Rejects the current action with a message the client shows verbatim. */
export function fail(message: string): never {
    throw new LtError(message)
}

interface ScoreRecord {
    name: string
    emblem: string | null
    net: number
    winStreak: number
    lastNet: number | null
    leftAt: number | null
}

export interface LtPlayer<TSeat> {
    userId: string
    name: string
    emblem: string | null
    /** null for games with no seating, where anyone watching can bet. */
    seatIndex: number | null
    connected: boolean
    leaving: boolean
    votedStart: boolean
    lastNet: number | null
    sessionNet: number
    dailyNet: number
    winStreak: number
    roundsPlayed: number
    balanceHint: number
    /** Escrow rows for the current round. Non-empty means real money is at risk. */
    wagerIds: string[]
    releaseTimer: ReturnType<typeof setTimeout> | null
    game: TSeat
}

/**
 * The half of a multiplayer table that is the same in every game: the
 * serialized mutation chain, the phase machine, seat lifecycle, chat, the
 * scoreboard, wager escrow and the snapshot broadcast.
 *
 * Games subclass this and supply only their own rules. In particular they never
 * call `credit` or `debit` — they stake through `stake()` and settle through
 * `settle()`, so the concurrency guarantees live in one reviewed place rather
 * than being re-derived once per game.
 */
export abstract class LiveTable<TSeat, TShared, TAction> {
    protected abstract readonly config: LtConfig

    /** Fresh per-seat game data for a player who just sat down. */
    protected abstract createSeatState(): TSeat

    /** The game-specific half of the snapshot. */
    protected abstract gameState(): TShared

    protected abstract onAction(userId: string, action: TAction): void | Promise<void>

    /** A phase timer expired. Advance the round. */
    protected abstract onPhaseEnd(phase: string): void | Promise<void>

    /** First player arrived at an idle table. */
    protected abstract onTableActive(): void

    readonly bus = new LtBus()

    protected players = new Map<string, LtPlayer<TSeat>>()
    protected phase = 'idle'
    protected phaseEndsAt: number | null = null
    protected phaseDuration: number | null = null
    protected nextRoundAt: number | null = null
    protected phaseToken = 0
    protected roundId = 0
    protected message = 'Waiting for players'

    private timer: ReturnType<typeof setTimeout> | null = null
    private version = 0
    private scores = new Map<string, ScoreRecord>()

    // Every mutation — socket message or timer — runs through this chain, so no
    // two of them can interleave across an `await` on a balance write.
    private chain: Promise<unknown> = Promise.resolve()

    run<T>(fn: () => T | Promise<T>): Promise<T> {
        // Publishing on the rejected path too: a rejected action may still have
        // mutated the table before it failed a later check.
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

    protected setPhase(phase: string, durationMs: number | null) {
        this.phaseToken++
        this.phase = phase
        this.phaseDuration = durationMs
        this.phaseEndsAt = durationMs === null ? null : Date.now() + durationMs
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = null
        }
    }

    /**
     * Run `fn` when the timer expires, but only if the phase it was scheduled
     * against is still current — otherwise a timer from an abandoned round
     * fires into a live one.
     */
    protected schedule(ms: number, fn: () => void | Promise<void>) {
        if (this.timer) clearTimeout(this.timer)
        const token = this.phaseToken
        this.timer = setTimeout(() => {
            this.timer = null
            void this.run(async () => {
                if (token !== this.phaseToken) return
                try {
                    await fn()
                } catch {
                    // A failed transition must not wedge the table, but the
                    // round it abandons has real money staked on it.
                    try {
                        await this.abortRound()
                    } catch {
                        // Even the refund failed. The escrow rows stay
                        // unsettled, so the recovery sweep pays them back.
                        this.message = 'Table reset'
                        this.setPhase('idle', null)
                    }
                }
            })
        }, ms)
    }

    protected advance(phase: string, durationMs: number) {
        this.setPhase(phase, durationMs)
        this.schedule(durationMs, () => this.onPhaseEnd(phase))
    }

    // ─── players and seats ─────────────────────────────────────────────────

    protected playerOf(userId: string): LtPlayer<TSeat> | undefined {
        return this.players.get(userId)
    }

    protected requirePlayer(userId: string): LtPlayer<TSeat> {
        const player = this.players.get(userId)
        if (!player) fail('You are not at this table')
        return player
    }

    protected seated(): LtPlayer<TSeat>[] {
        return [...this.players.values()].filter(p => p.seatIndex !== null)
    }

    protected everyone(): LtPlayer<TSeat>[] {
        return [...this.players.values()]
    }

    seatIndexOf(userId: string): number | null {
        return this.players.get(userId)?.seatIndex ?? null
    }

    private seatTaken(index: number): boolean {
        return this.seated().some(p => p.seatIndex === index)
    }

    /**
     * Register a player without a seat. Seatless games (roulette) call this the
     * first time someone bets; seated games go through `sit` instead.
     */
    protected async join(userId: string, name: string, emblem: string | null): Promise<LtPlayer<TSeat>> {
        const existing = this.players.get(userId)
        if (existing) return existing
        return this.addPlayer(userId, name, emblem, null)
    }

    private async addPlayer(
        userId: string,
        name: string,
        emblem: string | null,
        seatIndex: number | null
    ): Promise<LtPlayer<TSeat>> {
        const [balance, dailyNet] = await Promise.all([
            getBalance(userId),
            getDailyNet(userId, this.config.game)
        ])
        const record = this.scores.get(userId)
        const player: LtPlayer<TSeat> = {
            userId,
            name,
            emblem,
            seatIndex,
            connected: true,
            leaving: false,
            votedStart: false,
            lastNet: record?.lastNet ?? null,
            // Counted from this sit-down rather than the last one: it is the
            // figure on the nameplate, and standing up ends that session.
            sessionNet: 0,
            dailyNet,
            winStreak: record?.winStreak ?? 0,
            roundsPlayed: 0,
            balanceHint: Number(balance),
            wagerIds: [],
            releaseTimer: null,
            game: this.createSeatState()
        }
        this.players.set(userId, player)
        this.scores.set(userId, {
            name,
            emblem,
            net: record?.net ?? 0,
            winStreak: record?.winStreak ?? 0,
            lastNet: record?.lastNet ?? null,
            leftAt: null
        })
        return player
    }

    async sit(userId: string, name: string, emblem: string | null, index: number) {
        if (!Number.isInteger(index) || index < 0 || index >= this.config.seats) fail('Invalid seat')
        const existing = this.players.get(userId)
        if (existing?.seatIndex !== null && existing !== undefined) {
            if (existing.seatIndex !== index) fail('You are already seated')
            // Clicking your own seat again takes back a pending stand-up.
            existing.leaving = false
            return
        }
        if (this.seatTaken(index)) fail('Seat is taken')

        const balance = Number(await getBalance(userId))
        // Turning a broke player away at the seat beats letting them sit
        // through rounds they can never bet in.
        if (balance < this.config.minBet) {
            fail(`You need at least ${this.config.minBet} to take a seat`)
        }

        if (existing) {
            existing.seatIndex = index
            existing.leaving = false
        } else {
            await this.addPlayer(userId, name, emblem, index)
        }
        this.bus.broadcast({ t: 'event', kind: 'sit', name, seat: index })
        if (this.phase === 'idle') this.onTableActive()
    }

    leave(userId: string) {
        const player = this.players.get(userId)
        if (!player) return
        // A staked round still has to resolve and pay out, so the seat only
        // frees once the escrow is closed out.
        if (player.wagerIds.length > 0) {
            player.leaving = true
            return
        }
        this.release(player)
    }

    private release(player: LtPlayer<TSeat>) {
        if (player.releaseTimer) clearTimeout(player.releaseTimer)
        this.players.delete(player.userId)
        const record = this.scores.get(player.userId)
        if (record) record.leftAt = Date.now()
        this.pruneScores()
        if (player.seatIndex !== null) {
            this.bus.broadcast({ t: 'event', kind: 'leave', name: player.name, seat: player.seatIndex })
        }
        if (!this.players.size) this.onEmpty()
    }

    /**
     * A table session runs from the first player arriving to the last leaving.
     * The scoreboard tracks that session, so an empty table starts everyone back
     * at zero rather than carrying yesterday's figures forever.
     */
    protected onEmpty() {
        this.scores.clear()
        this.setPhase('idle', null)
        this.message = 'Waiting for players'
    }

    setConnected(userId: string, connected: boolean) {
        const player = this.players.get(userId)
        if (!player) return
        player.connected = connected
        if (connected) {
            if (player.releaseTimer) {
                clearTimeout(player.releaseTimer)
                player.releaseTimer = null
            }
            return
        }
        // Unsettled escrow is the only reason to hold a place for someone who
        // is gone: it means real money is still riding on the round.
        const grace = player.wagerIds.length
            ? this.config.disconnectGrace
            : this.config.disconnectGraceIdle
        player.releaseTimer = setTimeout(() => {
            void this.run(() => {
                const current = this.players.get(player.userId)
                if (!current || current.connected) return
                this.leave(player.userId)
            })
        }, grace)
    }

    // ─── money ─────────────────────────────────────────────────────────────

    /**
     * Take money off a player for this round. The debit, the rake and the
     * escrow row are one transaction, so a stake can never exist without its
     * receipt — that receipt is what lets a crashed round be refunded rather
     * than lost.
     */
    protected async stake(player: LtPlayer<TSeat>, amount: number, kind: string) {
        if (!(amount > 0)) fail('Invalid stake')
        const id = await db.transaction(async (tx) => {
            await debit(player.userId, amount.toFixed(4), this.config.game, tx)
            await accumulateRake(player.userId, amount, tx)
            const [row] = await tx.insert(tableWagers).values({
                game: this.config.game,
                userId: player.userId,
                roundId: this.roundId,
                amount: amount.toFixed(4),
                kind
            }).returning({ id: tableWagers.id })
            return row!.id
        })
        player.wagerIds.push(id)
        void this.pushBalance(player.userId)
    }

    /**
     * Close out a round. The payout and the escrow claim share a transaction,
     * so a round is either fully settled or still recoverable, never half of
     * each — and the claim is what stops a retried settle paying twice.
     */
    protected async settle(payouts: LtPayout[]) {
        for (const result of payouts) {
            const player = this.players.get(result.userId)
            if (!player) continue

            const wagerIds = player.wagerIds
            player.wagerIds = []
            const payout = round4(result.payout)
            const net = round4(payout - result.staked)

            // Claiming the escrow is the guard, so it runs unconditionally: an
            // empty claim means these stakes were already closed out by the
            // recovery sweep or by a retry of this same settle, and paying on
            // top of that would double the round. A player with no escrow rows
            // staked nothing and is owed nothing.
            const paid = await db.transaction(async (tx) => {
                if (!wagerIds.length) return false
                const claimed = await tx.update(tableWagers)
                    .set({ settled: true })
                    .where(and(inArray(tableWagers.id, wagerIds), eq(tableWagers.settled, false)))
                    .returning({ id: tableWagers.id })
                if (!claimed.length) return false
                if (payout > 0) await credit(player.userId, payout.toFixed(4), this.config.game, tx)
                return true
            })
            if (!paid) continue
            void this.pushBalance(player.userId)

            player.lastNet = net
            player.sessionNet = round4(player.sessionNet + net)
            player.dailyNet = round4(player.dailyNet + net)
            player.roundsPlayed++
            // A push is not a loss, so it holds the streak where it is.
            if (net > 0) player.winStreak++
            else if (net < 0) player.winStreak = 0

            const record = this.scores.get(player.userId)
            if (record) {
                // Accumulated rather than copied: the board spans the whole
                // table session, across leaving and sitting back down.
                record.net = round4(record.net + net)
                record.lastNet = net
                record.winStreak = player.winStreak
            }
            this.bus.broadcast({ t: 'event', kind: 'settled', seat: player.seatIndex ?? -1, net })
        }

        // Anyone who asked to stand up was held only by their escrow.
        for (const player of this.everyone()) {
            if (player.leaving && !player.wagerIds.length) this.release(player)
        }
    }

    /**
     * Hand back everything a player has staked this round. Claiming the escrow
     * rows is the guard: this refunds exactly the rows it flips, so a stake
     * already settled by a payout — or already refunded by the recovery sweep —
     * cannot be handed back a second time.
     */
    protected async refund(userId: string, ids: string[]) {
        if (!ids.length) return
        const total = await db.transaction(async (tx) => {
            const rows = await tx.update(tableWagers)
                .set({ settled: true })
                .where(and(inArray(tableWagers.id, ids), eq(tableWagers.settled, false)))
                .returning({ amount: tableWagers.amount })
            const sum = round4(rows.reduce((acc, row) => acc + Number(row.amount), 0))
            if (sum > 0) await credit(userId, sum.toFixed(4), this.config.game, tx)
            return sum
        })
        if (total > 0) void this.pushBalance(userId)
    }

    /**
     * Tear down a round that cannot be finished. Every player gets their stake
     * back rather than losing it to whatever failed mid-transition.
     */
    protected async abortRound() {
        for (const player of this.everyone()) {
            const ids = player.wagerIds
            player.wagerIds = []
            player.game = this.createSeatState()
            await this.refund(player.userId, ids)
        }
        this.message = 'Round cancelled — bets returned'
        this.setPhase('idle', null)
        if (this.players.size) this.onTableActive()
    }

    async pushBalance(userId: string) {
        if (!this.bus.isUserConnected(userId)) return
        const balance = Number(await getBalance(userId))
        const player = this.players.get(userId)
        if (player) player.balanceHint = balance
        this.bus.sendToUser(userId, { t: 'balance', balance })
    }

    // ─── chat ──────────────────────────────────────────────────────────────

    chat(userId: string, name: string, text: string) {
        const clean = text.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH)
        if (!clean) return
        this.bus.broadcast({
            t: 'event',
            kind: 'chat',
            name,
            seat: this.players.get(userId)?.seatIndex ?? -1,
            text: clean
        })
    }

    // ─── vote to start ─────────────────────────────────────────────────────

    /**
     * Skip the rest of the betting clock. Games decide what counts as ready by
     * overriding `onVoteStart`; the base only records the vote and tallies it.
     */
    async voteStart(userId: string) {
        const player = this.requirePlayer(userId)
        player.votedStart = true
        await this.onVoteStart()
    }

    /** Everyone who could still act has asked to get on with it. */
    protected everyoneVoted(): boolean {
        const waiting = this.everyone().filter(p => !p.leaving)
        return waiting.length > 0 && waiting.every(p => p.votedStart)
    }

    protected clearVotes() {
        for (const player of this.everyone()) player.votedStart = false
    }

    /**
     * Default: start as soon as the table is unanimous.
     *
     * Awaited, or `run()` publishes the snapshot before the transition the vote
     * triggered has happened and the phase change is lost until the next
     * mutation. The pending timer is dropped first so a game whose `onPhaseEnd`
     * does not itself change phase cannot then advance the round twice.
     */
    protected async onVoteStart() {
        if (!this.everyoneVoted()) return
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = null
        }
        await this.onPhaseEnd(this.phase)
    }

    // ─── actions ───────────────────────────────────────────────────────────

    action(userId: string, payload: TAction) {
        return this.onAction(userId, payload)
    }

    // ─── snapshot ──────────────────────────────────────────────────────────

    private pruneScores() {
        const departed = [...this.scores.entries()]
            .filter(([userId, record]) => record.leftAt !== null && !this.players.has(userId))
            .sort((a, b) => (b[1].leftAt ?? 0) - (a[1].leftAt ?? 0))
        for (const [userId] of departed.slice(SCOREBOARD_ALUMNI)) this.scores.delete(userId)
    }

    private scoreboard(): LtScoreEntry[] {
        return [...this.scores.entries()]
            .map(([userId, record]) => ({
                userId,
                name: record.name,
                emblem: record.emblem,
                net: record.net,
                winStreak: record.winStreak,
                seated: this.players.has(userId),
                lastNet: record.lastNet
            }))
            .sort((a, b) => b.net - a.net)
    }

    private publicSeat(player: LtPlayer<TSeat>): LtSeat<TSeat> {
        return {
            index: player.seatIndex ?? -1,
            userId: player.userId,
            name: player.name,
            emblem: player.emblem,
            connected: player.connected,
            leaving: player.leaving,
            votedStart: player.votedStart,
            lastNet: player.lastNet,
            sessionNet: player.sessionNet,
            dailyNet: player.dailyNet,
            winStreak: player.winStreak,
            roundsPlayed: player.roundsPlayed,
            balanceHint: player.balanceHint,
            game: player.game
        }
    }

    snapshot(): LtTableState<TSeat, TShared> {
        const seats: (LtSeat<TSeat> | null)[] = Array.from({ length: this.config.seats }, () => null)
        for (const player of this.seated()) {
            seats[player.seatIndex!] = this.publicSeat(player)
        }
        return {
            version: ++this.version,
            roundId: this.roundId,
            phase: this.phase,
            phaseEndsAt: this.phaseEndsAt,
            phaseDuration: this.phaseDuration,
            nextRoundAt: this.nextRoundAt,
            now: Date.now(),
            seats,
            message: this.message,
            scoreboard: this.scoreboard(),
            watching: this.bus.count,
            minBet: this.config.minBet,
            maxBet: this.config.maxBet,
            game: this.gameState()
        }
    }

    publish() {
        this.bus.broadcast({ t: 'state', state: this.snapshot() } as LtServerMessage)
    }
}
