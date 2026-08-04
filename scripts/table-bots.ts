/**
 * Fills a live table with simulated players so multiplayer can be exercised
 * without a room full of humans.
 *
 *   bun scripts/table-bots.ts --game=baccarat --port=3202 --bots=4
 *
 * Websockets do not upgrade under `bun run dev` in this environment, so point
 * this at a production build:
 *
 *   bun run build
 *   PORT=3202 BETTER_AUTH_URL=http://localhost:3202 bun .output/server/index.mjs
 *
 * Bots authenticate through better-auth's own sign-up/sign-in endpoints rather
 * than forged cookies, so they exercise the same auth path a real client does.
 * They are QA and review tooling — nothing here ships to production.
 */
import { eq, sql } from 'drizzle-orm'
import { db } from '../server/database'
import { user } from '../server/database/schema'
import type { BacAction, BacSeatState, BacSharedState } from '../shared/utils/baccarat/types'
import type { LtServerMessage, LtSeat, LtTableState } from '../shared/utils/live-table/types'
import type { RouletteAction } from '../shared/utils/roulette/types'
import { randomChance, randomInt } from '../shared/utils/random'

interface Args {
    game: string
    port: number
    bots: number
    balance: number
}

function parseArgs(): Args {
    const get = (name: string, fallback?: string) => {
        const hit = process.argv.find(a => a.startsWith(`--${name}=`))
        const value = hit?.split('=').slice(1).join('=') ?? fallback
        if (value === undefined) {
            console.error(`Missing --${name}`)
            process.exit(1)
        }
        return value
    }
    return {
        game: get('game'),
        port: Number(get('port', '3000')),
        bots: Number(get('bots', '3')),
        balance: Number(get('balance', '250000'))
    }
}

const NAMES = ['Kayla_88', 'mikey_v', 'NoLimitNina', 'dutchdegen', 'ShrimpKing', 'Vex', 'otto.b', 'PixelPete']
const PASSWORD = 'bot-password-not-a-secret'

/**
 * How a bot reacts to a snapshot. Games register their own; the fallback just
 * takes a seat and watches, which is enough to prove the socket and the seat
 * lifecycle work.
 */
export interface BotStrategy {
    /** Called on every snapshot. Return actions to send, or nothing. */
    onState(state: LtTableState, ctx: BotContext): unknown[] | undefined
}

export interface BotContext {
    userId: string
    name: string
    seat: number | null
    /** Deterministic per-bot index, for strategies that want varied behaviour. */
    index: number
}

const STRATEGIES: Record<string, BotStrategy> = {}

export function registerStrategy(game: string, strategy: BotStrategy) {
    STRATEGIES[game] = strategy
}

const watchOnly: BotStrategy = { onState: () => undefined }

/**
 * A spread across bet types every fresh betting round: a straight number, an
 * outside colour, and a dozen — enough to exercise every payout tier and the
 * felt's chip stacking without hammering the socket every snapshot.
 */
const betRounds = new Map<string, number>()
registerStrategy('roulette', {
    onState(state, ctx) {
        // An idle table has never rolled its first roundId — that first bet is
        // what activates it, so idle counts as a biddable phase too.
        if (state.phase !== 'betting' && state.phase !== 'idle') return undefined
        if (betRounds.get(ctx.userId) === state.roundId) return undefined
        betRounds.set(ctx.userId, state.roundId)

        const straightNumber = (ctx.index * 7 + 3) % 37
        const dozens = ['dozen:0', 'dozen:1', 'dozen:2']
        const actions: RouletteAction[] = [
            { type: 'bet', key: `straight:${straightNumber}`, amount: 25 },
            { type: 'bet', key: ctx.index % 2 === 0 ? 'red' : 'black', amount: 50 },
            { type: 'bet', key: dozens[ctx.index % 3]!, amount: 100 }
        ]
        return actions
    }
})

async function signIn(base: string, email: string, name: string): Promise<string> {
    const body = JSON.stringify({ email, password: PASSWORD, name })
    const headers = { 'content-type': 'application/json' }

    for (const path of ['/api/auth/sign-up/email', '/api/auth/sign-in/email']) {
        const res = await fetch(`${base}${path}`, { method: 'POST', headers, body })
        const cookie = res.headers.getSetCookie?.().join('; ') ?? res.headers.get('set-cookie') ?? ''
        if (res.ok && cookie) return cookie
    }
    throw new Error(`could not authenticate ${email}`)
}

/**
 * Bots need chips to bet with. Set directly rather than through credit() so the
 * top-up does not land in the ledger and skew the analytics the tables feed.
 */
async function topUp(email: string, balance: number): Promise<string> {
    const [row] = await db.select({ id: user.id, balance: user.balance })
        .from(user)
        .where(eq(user.email, email))
        .limit(1)
    if (!row) throw new Error(`bot ${email} has no user row`)
    if (Number(row.balance) < balance) {
        await db.update(user).set({ balance: sql`${balance}` }).where(eq(user.id, row.id))
    }
    return row.id
}

async function runBot(args: Args, index: number) {
    const name = NAMES[index % NAMES.length]!
    const email = `bot-${index}@bots.invalid`
    const base = `http://localhost:${args.port}`

    const cookie = await signIn(base, email, name)
    const userId = await topUp(email, args.balance)
    const strategy = STRATEGIES[args.game] ?? watchOnly

    const ctx: BotContext = { userId, name, seat: null, index }
    const ws = new WebSocket(`ws://localhost:${args.port}/api/${args.game}/ws`, {
        headers: { cookie }
    } as never)

    ws.onopen = () => console.log(`[${name}] connected`)
    ws.onclose = (e) => console.log(`[${name}] closed ${e.code} ${e.reason}`)
    ws.onerror = () => console.log(`[${name}] socket error`)

    ws.onmessage = (event) => {
        let message: LtServerMessage
        try {
            message = JSON.parse(String(event.data))
        } catch {
            return
        }

        if (message.t === 'you') {
            ctx.seat = message.seat
            return
        }
        if (message.t === 'error') {
            console.log(`[${name}] rejected: ${message.message}`)
            return
        }
        if (message.t !== 'state') return

        const state = message.state as LtTableState
        const mine = state.seats.find(s => s?.userId === userId) ?? null
        ctx.seat = mine?.index ?? null

        // Take the first free seat. Seatless games report no seats at all, so
        // this is a no-op there and the strategy drives everything.
        if (!mine && state.seats.length) {
            const free = state.seats.findIndex(s => s === null)
            if (free >= 0) {
                ws.send(JSON.stringify({ t: 'sit', seat: free }))
                return
            }
        }

        for (const action of strategy.onState(state, ctx) ?? []) {
            ws.send(JSON.stringify({ t: 'action', action }))
        }
    }

    return ws
}

/**
 * Sits, bets a plausible spread across Player/Banker/Tie (with an occasional
 * pair side bet) and repeats every round -- "repeats" needs no extra state
 * here, since a fresh round always clears every seat's bets back to zero.
 */
registerStrategy('baccarat', {
    onState(rawState, ctx) {
        const state = rawState as unknown as LtTableState<BacSeatState, BacSharedState>
        if (ctx.seat === null || state.phase !== 'betting') return

        const seat = state.seats[ctx.seat] as LtSeat<BacSeatState> | null
        if (!seat || Object.values(seat.game.bets).some(amount => amount > 0)) return

        const unit = 25 * randomInt(1, 8)
        const actions: BacAction[] = []
        const roll = randomInt(1, 100)
        if (roll <= 45) actions.push({ kind: 'bet', spot: 'player', amount: unit })
        else if (roll <= 90) actions.push({ kind: 'bet', spot: 'banker', amount: unit })
        else actions.push({ kind: 'bet', spot: 'tie', amount: Math.max(5, Math.round(unit / 4)) })

        if (randomChance(0.25)) actions.push({ kind: 'bet', spot: 'playerPair', amount: Math.max(5, Math.round(unit / 5)) })
        if (randomChance(0.25)) actions.push({ kind: 'bet', spot: 'bankerPair', amount: Math.max(5, Math.round(unit / 5)) })

        return actions
    }
})

const args = parseArgs()
console.log(`Seating ${args.bots} bot(s) at ${args.game} on port ${args.port}`)

const sockets: WebSocket[] = []
for (let i = 0; i < args.bots; i++) {
    try {
        sockets.push(await runBot(args, i))
    } catch (error) {
        console.error(`bot ${i} failed to start:`, (error as Error).message)
    }
    // Staggered so they take distinct seats instead of racing for the same one.
    await new Promise(resolve => setTimeout(resolve, 350))
}

process.on('SIGINT', () => {
    for (const ws of sockets) ws.close()
    void db.$client.end().then(() => process.exit(0))
})
