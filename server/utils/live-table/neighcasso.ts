import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { neighcassoHorses } from '#server/database/schema'
import { getBalance } from '#server/utils/balance'
import { getOwnHorse } from '#server/utils/neighcasso'
import { fail, LiveTable, round4 } from '#server/utils/live-table/table'
import type { LtConfig, LtPlayer } from '#server/utils/live-table/table'
import { NC_RACE_DURATION, NC_RACE_STEP, planRace } from '#shared/utils/neighcasso/race'
import { NC_BOT_NAMES, ncPayout } from '#shared/utils/neighcasso/bots'
import { NC_BOT_FEE, NC_LANES } from '#shared/utils/neighcasso/types'
import type {
    NcAction,
    NcBot,
    NcGameEvent,
    NcRaceScript,
    NcResult,
    NcSeatState,
    NcSharedState
} from '#shared/utils/neighcasso/types'
import type { LtPayout } from '#shared/utils/live-table/types'
import { randomInt, randomPick } from '#shared/utils/random'

const MIN_HORSES = 2
/** Once two horses are ready, how long the rest get before they are scratched. */
const HURRY_MS = 45_000
/** Everyone is ready: a short beat before the gates close, so a late change of heart still lands. */
const ALL_READY_MS = 2_500
const GATES_MS = 4_000
const FINISH_MS = 9_000
/**
 * The clients slow the last second into a photo finish and reveal the winner
 * about 1.55s after the post, so the payout (and the balance it pushes) waits
 * for that reveal instead of spoiling it.
 */
const REVEAL_MS = 1_700
const HISTORY_LENGTH = 10

type Player = LtPlayer<NcSeatState>

/**
 * Neighcasso Derby. Up to six doodled horses, one lobby, winner takes the pot.
 *
 * Nothing is staked while the lobby waits: a bet is only an intent until the
 * gates close, and every stake is taken then, in one pass. That keeps escrow
 * rows short-lived (the recovery sweep refunds anything older than 15 minutes,
 * and a lobby can idle far longer than that) and means a player who went broke
 * elsewhere in the meantime is scratched instead of racing on credit.
 *
 * Bets are matched: every horse races for the smallest bet in the gates, and
 * only that much is taken from anyone who bet more. Every horse therefore has
 * the same odds and the winner takes the pot; the race the clients watch is
 * written after the winner is drawn.
 *
 * Bots are house horses that fill empty gates, so a lone player can race.
 * Each bot bets the matched stake, and whenever one runs the house keeps
 * NC_BOT_FEE of the pot, so every bet returns 99% however many bots are
 * added. More bots only trade a lower chance for a bigger pot.
 */
export class NeighcassoTable extends LiveTable<NcSeatState, NcSharedState, NcAction> {
    protected readonly config: LtConfig = {
        game: 'neighcasso',
        seats: NC_LANES,
        minBet: 1,
        // Any size goes; the player's own balance is the ceiling.
        maxBet: Number.MAX_SAFE_INTEGER,
        disconnectGrace: 60_000,
        disconnectGraceIdle: 20_000,
        seatNeedsBalance: false
    }

    protected race: NcRaceScript | null = null
    protected result: NcResult | null = null
    private history: NcResult[] = []
    private lobbyTimer: 'none' | 'hurry' | 'go' = 'none'
    private winnerSeat: number | null = null
    private odds = 0
    /** Gates the lobby put a bot in. A human sitting down in one takes it over. */
    private botSeats = new Set<number>()
    /** Picks this round's bot names and doodles. Cosmetic. */
    private botSeed = randomInt(1, 1_000_000)
    /** Frozen when the gates close, so the bots that race are the ones that were staked for. */
    private raceBots: NcBot[] | null = null
    /** The matched stake every runner put up, once the gates close. */
    private raceStake = 0

    protected createSeatState(): NcSeatState {
        return { horseId: null, horseName: '', horseRev: 0, horseWins: 0, horseRaces: 0, bet: 0, racing: false }
    }

    protected gameState(): NcSharedState {
        const racing = this.seated().filter(p => p.game.racing)
        const counted = racing.length ? racing : this.seated().filter(p => !p.leaving && p.game.bet > 0)
        const matched = this.matched()
        const bots = this.bots()
        return {
            matched,
            pot: round4(matched * (counted.length + bots.length)),
            race: this.race,
            result: this.result,
            history: this.history,
            minHorses: MIN_HORSES,
            bots,
            botsWanted: this.botSeats.size,
            fee: NC_BOT_FEE
        }
    }

    private humanSeats(): Set<number | null> {
        return new Set(this.seated().filter(p => !p.leaving).map(p => p.seatIndex))
    }

    /** The smallest bet in the gates; every horse races for this much. */
    private matched(): number {
        if (this.race) return this.raceStake
        const bets = this.seated().filter(p => !p.leaving && p.game.bet > 0).map(p => p.game.bet)
        return bets.length ? Math.min(...bets) : 0
    }

    /**
     * The bots in the gates, each betting the matched stake. Humans always win
     * a gate over a bot: sitting down in a bot's gate replaces it.
     */
    private bots(betOverride?: number): NcBot[] {
        if (this.raceBots) return this.raceBots
        const taken = this.humanSeats()
        const bet = betOverride ?? this.matched()
        return [...this.botSeats].filter(seat => !taken.has(seat)).sort((a, b) => a - b).map(seat => ({
            seat,
            name: NC_BOT_NAMES[(this.botSeed + seat) % NC_BOT_NAMES.length]!,
            seed: this.botSeed * 7 + seat,
            bet
        }))
    }

    private inLobby() {
        return this.phase === 'idle' || this.phase === 'lobby'
    }

    private requireSeated(userId: string): Player {
        const player = this.requirePlayer(userId)
        if (player.seatIndex === null) fail('Take a gate first')
        return player
    }

    private emit(payload: NcGameEvent) {
        this.bus.broadcast({ t: 'event', kind: 'game', payload })
    }

    // ─── lobby ─────────────────────────────────────────────────────────────

    protected onTableActive() {
        this.setLobby()
    }

    private setLobby() {
        this.lobbyTimer = 'none'
        this.message = 'Pick a horse, place a bet and hit Ready'
        this.setPhase('lobby', null)
    }

    override async sit(userId: string, name: string, emblem: string | null, index: number) {
        if (!this.inLobby()) fail('A race is running. Grab a gate for the next one')
        await super.sit(userId, name, emblem, index)
        this.botSeats.delete(index)
        this.evaluateLobby()
    }

    override leave(userId: string) {
        super.leave(userId)
        if (this.phase === 'lobby') this.evaluateLobby()
    }

    override async voteStart(userId: string) {
        const player = this.requireSeated(userId)
        if (!this.inLobby()) fail('The race is already on')
        if (!player.game.horseId) fail('Pick a horse from your stable first')
        if (player.game.bet < this.config.minBet) fail('Place a bet first')
        await this.checkAffordable(player, player.game.bet)
        player.votedStart = true
        this.evaluateLobby()
    }

    private async checkAffordable(player: Player, amount: number) {
        // Only a courtesy: nothing is taken until the gates close, and the
        // stake itself is what actually refuses a player who cannot pay.
        const balance = Number(await getBalance(player.userId))
        player.balanceHint = balance
        if (balance < amount) fail('You can\'t afford that bet')
    }

    protected async onAction(userId: string, action: NcAction) {
        const player = this.requireSeated(userId)
        if (!this.inLobby()) fail('The race is on. Wait for the next one')

        if (action.type === 'horse') {
            const row = await getOwnHorse(userId, String(action.horseId ?? ''))
            if (!row) fail('That horse is not in your stable')
            player.game.horseId = row.id
            player.game.horseName = row.name
            player.game.horseRev = row.updatedAt.getTime()
            player.game.horseWins = row.wins
            player.game.horseRaces = row.races
        } else if (action.type === 'bet') {
            const amount = round4(Number(action.amount))
            if (!Number.isFinite(amount) || amount < this.config.minBet) fail(`Minimum bet is ${this.config.minBet}`)
            if (amount > this.config.maxBet) fail('That bet is too big')
            await this.checkAffordable(player, amount)
            player.game.bet = amount
        } else if (action.type === 'bots' || action.type === 'bot') {
            if (action.type === 'bots') this.setBotCount(Number(action.count))
            else this.toggleBot(Number(action.seat), !!action.on)
            // Everyone else's odds and payout just changed, so they confirm
            // again; whoever changed the bots already knows what they asked for.
            for (const other of this.everyone()) if (other !== player) other.votedStart = false
            this.evaluateLobby()
            return
        } else if (action.type !== 'unready') {
            fail('Unknown action')
        }
        // Any change to what you are racing with takes back your Ready.
        player.votedStart = false
        this.evaluateLobby()
    }

    private setBotCount(count: number) {
        if (!Number.isInteger(count) || count < 0 || count > NC_LANES - 1) fail('Invalid number of bots')
        const taken = this.humanSeats()
        for (const seat of [...this.botSeats]) if (taken.has(seat)) this.botSeats.delete(seat)
        // Adds fill the highest free gates and removals empty the highest bot
        // gate, so the humans' end of the grid stays open for new arrivals.
        for (let seat = NC_LANES - 1; seat >= 0 && this.botSeats.size < count; seat--) {
            if (!taken.has(seat)) this.botSeats.add(seat)
        }
        const bySeat = [...this.botSeats].sort((a, b) => b - a)
        while (this.botSeats.size > count) this.botSeats.delete(bySeat.shift()!)
    }

    private toggleBot(seat: number, on: boolean) {
        if (!Number.isInteger(seat) || seat < 0 || seat >= NC_LANES) fail('Invalid gate')
        if (!on) {
            this.botSeats.delete(seat)
            return
        }
        if (this.humanSeats().has(seat)) fail('That gate is taken')
        this.botSeats.add(seat)
    }

    private ready(): Player[] {
        return this.seated().filter(p => p.votedStart && !p.leaving)
    }

    /**
     * Pick the lobby clock from who is ready. Always hands off to a timer rather
     * than closing the gates inline: `leave` also calls this from a disconnect
     * timer, and a timer is the only way to get the stakes onto the mutation
     * chain from there.
     */
    private evaluateLobby() {
        if (this.phase !== 'lobby') return
        const ready = this.ready().length
        const waiting = this.seated().filter(p => !p.leaving).length
        const canRun = ready >= 1 && ready + this.bots().length >= MIN_HORSES
        if (canRun && ready === waiting) {
            if (this.lobbyTimer === 'go') return
            this.lobbyTimer = 'go'
            this.message = 'Everyone is ready!'
            this.advance('lobby', ALL_READY_MS)
        } else if (canRun) {
            if (this.lobbyTimer === 'hurry') return
            this.lobbyTimer = 'hurry'
            this.message = 'Stragglers get scratched when the clock runs out'
            this.advance('lobby', HURRY_MS)
        } else if (this.lobbyTimer !== 'none') {
            this.setLobby()
        } else {
            this.message = ready ? 'Waiting for another horse (or add a bot)' : 'Pick a horse, place a bet and hit Ready'
        }
    }

    protected onPhaseEnd(phase: string): void | Promise<void> {
        switch (phase) {
            case 'lobby': return this.closeGates()
            case 'gates': return this.startRace()
            case 'racing': return this.finishRace()
            case 'finish': return this.reopenLobby()
        }
    }

    // ─── the race ──────────────────────────────────────────────────────────

    private async closeGates() {
        for (const player of this.seated()) {
            if (player.votedStart || player.leaving) continue
            this.emit({ type: 'scratched', name: player.name, reason: 'wasn\'t ready' })
            super.leave(player.userId)
        }
        // Scratching the last player already sent the table idle.
        if (!this.players.size) return

        const entrants = this.ready().filter(p => p.game.horseId && p.game.bet >= this.config.minBet)
        if (!entrants.length || entrants.length + this.bots().length < MIN_HORSES) {
            this.setLobby()
            this.evaluateLobby()
            return
        }

        this.roundId++
        // Anyone who bet more than the smallest bet only stakes the smallest.
        const stake = Math.min(...entrants.map(p => p.game.bet))
        const runners: Player[] = []
        for (const player of entrants) {
            try {
                await this.stake(player, stake, 'horse')
                player.game.racing = true
                runners.push(player)
            } catch {
                player.votedStart = false
                this.emit({ type: 'scratched', name: player.name, reason: 'couldn\'t cover the bet' })
            }
        }

        const bots = runners.length ? this.bots(stake) : []
        if (!runners.length || runners.length + bots.length < MIN_HORSES) {
            for (const player of runners) {
                const ids = player.wagerIds
                player.wagerIds = []
                player.game.racing = false
                await this.refund(player.userId, ids)
            }
            this.setLobby()
            this.message = 'Not enough horses could run. Bets returned'
            this.evaluateLobby()
            return
        }

        this.raceBots = bots
        this.raceStake = stake
        const field = [...runners.map(p => p.seatIndex!), ...bots.map(b => b.seat)]
        const winner = randomPick(field)
        this.winnerSeat = winner
        this.odds = 1 / field.length

        const plan = planRace(field, winner)
        this.race = {
            startsAt: Date.now() + GATES_MS,
            duration: NC_RACE_DURATION,
            step: NC_RACE_STEP,
            lanes: plan.lanes,
            events: plan.events,
            winnerSeat: winner
        }
        this.result = null
        this.lobbyTimer = 'none'
        this.clearVotes()
        this.message = 'They\'re in the gates!'
        this.emit({ type: 'gates', race: this.race })
        this.advance('gates', GATES_MS)
    }

    private startRace() {
        this.message = 'And they\'re off!'
        this.advance('racing', NC_RACE_DURATION * 1000 + REVEAL_MS)
    }

    private async finishRace() {
        const runners = this.seated().filter(p => p.game.racing)
        const bots = this.raceBots ?? []
        const winner = runners.find(p => p.seatIndex === this.winnerSeat)
        const botWinner = bots.find(b => b.seat === this.winnerSeat)
        if (!winner && !botWinner) throw new Error('Winner missing from the race')

        const pot = round4(this.raceStake * (runners.length + bots.length))
        const payout = winner ? ncPayout(pot, bots.length > 0) : 0
        const payouts: LtPayout[] = runners.map(p => ({
            userId: p.userId,
            staked: this.raceStake,
            payout: p === winner ? payout : 0
        }))
        const result: NcResult = {
            roundId: this.roundId,
            winnerSeat: this.winnerSeat!,
            winnerName: winner ? winner.name : 'the house',
            horseName: winner ? winner.game.horseName : botWinner!.name,
            horseId: winner?.game.horseId ?? null,
            botWon: !winner,
            pot,
            payout,
            odds: round4(this.odds)
        }

        const horseIds = runners.map(p => p.game.horseId).filter((id): id is string => !!id)
        // Mirrors the stats write below, so the gates show the new record now.
        for (const p of runners) {
            p.game.horseRaces++
            if (p === winner) p.game.horseWins++
        }
        await this.settle(payouts)
        this.result = result
        this.history = [result, ...this.history].slice(0, HISTORY_LENGTH)
        this.message = `${result.horseName} wins!`
        this.emit({ type: 'result', result })
        void this.recordStats(horseIds, result.horseId)

        this.nextRoundAt = Date.now() + FINISH_MS
        // Settling may have released the last player (everyone asked to leave).
        if (!this.players.size) return
        this.advance('finish', FINISH_MS)
    }

    /** Bragging rights only, so a failed write is not worth failing the round over. */
    private async recordStats(horseIds: string[], winnerId: string | null) {
        try {
            if (horseIds.length) {
                await db.update(neighcassoHorses)
                    .set({ races: sql`${neighcassoHorses.races} + 1` })
                    .where(inArray(neighcassoHorses.id, horseIds))
            }
            if (winnerId) {
                await db.update(neighcassoHorses)
                    .set({ wins: sql`${neighcassoHorses.wins} + 1` })
                    .where(eq(neighcassoHorses.id, winnerId))
            }
        } catch (error) {
            console.error('[neighcasso] stats update failed', error)
        }
    }

    private reopenLobby() {
        this.resetRace()
        // Horse and bet stay put, so running it back is one click on Ready.
        this.setLobby()
        this.evaluateLobby()
    }

    private resetRace() {
        this.race = null
        this.result = null
        this.winnerSeat = null
        this.raceBots = null
        this.raceStake = 0
        this.botSeed = randomInt(1, 1_000_000)
        this.nextRoundAt = null
        for (const player of this.everyone()) player.game.racing = false
        this.clearVotes()
    }

    protected override async abortRound() {
        this.resetRace()
        this.lobbyTimer = 'none'
        await super.abortRound()
    }

    protected override onEmpty() {
        this.resetRace()
        this.botSeats.clear()
        this.lobbyTimer = 'none'
        super.onEmpty()
    }
}

export const neighcassoTable = new NeighcassoTable()
