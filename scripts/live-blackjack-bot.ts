/**
 * Headless player for the live blackjack table. Signs in over the real auth
 * endpoint, joins the real socket and plays real money — nothing about it is
 * privileged, so whatever it can do a browser can do too.
 *
 *   bun scripts/live-blackjack-bot.ts --email bot1@polynux.test --password ... \
 *     --seat 1 --bet 500 --rounds 20 --strategy basic
 */
import { chipStack } from '../shared/utils/live-blackjack/chips'
import { LB_SIDE_BETS } from '../shared/utils/live-blackjack/sidebets'
import { handScore } from '../shared/utils/live-blackjack/rules'
import { basicStrategy } from '../shared/utils/live-blackjack/strategy'
import type { LbAction, LbServerMessage, LbTableState } from '../shared/utils/live-blackjack/types'

type Strategy = 'basic' | 'counter' | 'wild' | 'always-stand'

interface Options {
    base: string
    email: string
    password: string
    seat: number
    bet: number
    rounds: number
    strategy: Strategy
    side: number
    quiet: boolean
}

function parseArgs(): Options {
    const args = process.argv.slice(2)
    const get = (name: string, fallback?: string) => {
        const i = args.indexOf(`--${name}`)
        if (i >= 0 && args[i + 1] !== undefined) return args[i + 1]!
        if (fallback !== undefined) return fallback
        throw new Error(`missing --${name}`)
    }
    return {
        base: get('base', 'http://localhost:3000'),
        email: get('email'),
        password: get('password'),
        seat: Number(get('seat', '-1')),
        bet: Number(get('bet', '100')),
        rounds: Number(get('rounds', '10')),
        strategy: get('strategy', 'basic') as Strategy,
        /** Fraction of the main bet put on each side spot; 0 leaves them empty. */
        side: Number(get('side', '0')),
        quiet: args.includes('--quiet')
    }
}

const opts = parseArgs()
const log = (...parts: unknown[]) => {
    if (!opts.quiet) console.log(`[${opts.email.split('@')[0]}]`, ...parts)
}

async function signIn(): Promise<string> {
    const res = await fetch(`${opts.base}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: opts.email, password: opts.password })
    })
    if (!res.ok) throw new Error(`sign-in failed (${res.status}): ${await res.text()}`)
    const cookies = res.headers.getSetCookie?.() ?? []
    const cookie = cookies.map(c => c.split(';')[0]).join('; ')
    if (!cookie) throw new Error('sign-in returned no session cookie')
    return cookie
}

// ─── bot loop ──────────────────────────────────────────────────────────────

const cookie = await signIn()
log('signed in')

const proto = opts.base.startsWith('https') ? 'wss' : 'ws'
const host = opts.base.replace(/^https?:\/\//, '')
const ws = new WebSocket(`${proto}://${host}/api/live-blackjack/ws`, { headers: { cookie } } as never)

let youId: string | null = null
let balance = 0
let startingBalance: number | null = null
let mySeat: number | null = null
let roundsPlayed = 0
let betForRound = -1
let insuranceRound = -1
let lastActionKey = ''
/** Set once we have left for good, so the sit-down logic below stops firing. */
let done = false
const errors: string[] = []
const results: number[] = []

function send(message: unknown) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
}

function targetBet(state: LbTableState): number {
    if (opts.strategy === 'counter') {
        const decksLeft = Math.max(0.5, (state.shoe.total - state.shoe.dealt) / 52)
        const trueCount = state.shoe.runningCount / decksLeft
        const spread = Math.max(1, Math.min(6, Math.floor(trueCount)))
        return opts.bet * spread
    }
    if (opts.strategy === 'wild') return opts.bet * (1 + Math.floor(Math.random() * 4))
    return opts.bet
}

function placeBet(state: LbTableState) {
    const want = Math.min(targetBet(state), balance)
    if (want < state.minBet) return
    const stack = chipStack(want, 12)
    for (const chip of stack) send({ t: 'bet', amount: chip.value })

    // Side spots only accept chips once the main bet is down, so this has to
    // follow the stack above rather than interleave with it.
    if (opts.side > 0) {
        for (const spot of LB_SIDE_BETS) {
            const sideWant = Math.max(state.minBet, Math.floor(want * opts.side))
            if (sideWant > balance) continue
            for (const chip of chipStack(sideWant, 4)) {
                send({ t: 'bet', amount: chip.value, spot })
            }
        }
    }

    betForRound = state.roundId
    // Bots never need the full betting clock, and a table of them waiting it
    // out makes live testing crawl. Voting only starts the round once every
    // seated player has voted, so a human at the table still sets the pace.
    send({ t: 'voteStart' })
    log(`round ${state.roundId}: betting ${stack.reduce((sum, c) => sum + c.value, 0)}, voted to deal`)
}

function playTurn(state: LbTableState, seat: NonNullable<LbTableState['seats'][number]>) {
    if (state.activeHand === null) return
    const hand = seat.hands[state.activeHand]
    if (!hand || hand.status !== 'playing') return

    // One decision per distinct hand state, so a re-broadcast never double-acts.
    const key = `${state.roundId}:${state.activeHand}:${hand.cards.length}:${hand.cards.map(c => c.id).join()}`
    if (key === lastActionKey) return
    lastActionKey = key

    const upcard = state.dealer.cards[0]?.rank
    if (!upcard) return

    const action: LbAction = opts.strategy === 'always-stand'
        ? 'stand'
        : opts.strategy === 'wild'
            ? (handScore(hand.cards).total < 19 ? 'hit' : 'stand')
            : basicStrategy(hand, upcard, seat.hands, balance)

    log(`round ${state.roundId} hand ${state.activeHand}: ${handScore(hand.cards).total}${handScore(hand.cards).soft ? 's' : ''} vs ${upcard} → ${action}`)
    send({ t: 'action', action })
}

function onState(state: LbTableState) {
    // Without this the bot sees its own seat freed by `leave` and immediately
    // sits back down, leaving a seat parked until the disconnect grace expires.
    if (done) return

    if (mySeat === null) {
        const free = opts.seat >= 0
            ? (state.seats[opts.seat] ? -1 : opts.seat)
            : state.seats.findIndex(s => !s)
        if (free >= 0) {
            send({ t: 'sit', seat: free })
            return
        }
        if (opts.seat >= 0 && state.seats[opts.seat]?.userId !== youId) {
            errors.push(`seat ${opts.seat} already taken`)
            log(`seat ${opts.seat} taken — waiting`)
        }
        return
    }

    const seat = state.seats[mySeat]
    if (!seat || seat.userId !== youId) {
        mySeat = null
        return
    }

    if (state.phase === 'betting' && betForRound !== state.roundId && roundsPlayed < opts.rounds) {
        placeBet(state)
        return
    }

    if (state.phase === 'insurance' && !seat.insuranceDecided && seat.hands.length && insuranceRound !== state.roundId) {
        insuranceRound = state.roundId
        const decksLeft = Math.max(0.5, (state.shoe.total - state.shoe.dealt) / 52)
        const take = opts.strategy === 'counter' && state.shoe.runningCount / decksLeft >= 3
        send({ t: 'insurance', take })
        return
    }

    if (state.phase === 'playing' && state.activeSeat === mySeat) playTurn(state, seat)
}

ws.addEventListener('open', () => log('socket open'))

ws.addEventListener('message', (event) => {
    let message: LbServerMessage
    try {
        message = JSON.parse(String(event.data))
    } catch {
        return
    }

    switch (message.t) {
        case 'you':
            youId = message.userId
            balance = message.balance
            if (startingBalance === null) startingBalance = message.balance
            mySeat = message.seat
            log(`balance ${balance}`)
            return
        case 'balance':
            balance = message.balance
            return
        case 'error':
            errors.push(message.message)
            log('ERROR:', message.message)
            return
        case 'state': {
            const seat = message.state.seats.findIndex(s => s?.userId === youId)
            mySeat = seat >= 0 ? seat : null
            onState(message.state)
            return
        }
        case 'event':
            if (message.kind === 'settled' && message.seat === mySeat) {
                roundsPlayed++
                results.push(message.net)
                log(`round settled: ${message.net > 0 ? '+' : ''}${message.net} (${roundsPlayed}/${opts.rounds})`)
                if (roundsPlayed >= opts.rounds) setTimeout(finish, 1500)
            }
            return
    }
})

ws.addEventListener('close', () => {
    log('socket closed')
})

function finish() {
    done = true
    send({ t: 'leave' })
    const net = results.reduce((sum, n) => sum + n, 0)
    console.log(JSON.stringify({
        bot: opts.email,
        strategy: opts.strategy,
        seat: mySeat,
        roundsPlayed,
        net,
        startingBalance,
        endingBalance: balance,
        balanceDelta: startingBalance === null ? null : balance - startingBalance,
        results,
        errors
    }, null, 2))
    setTimeout(() => {
        ws.close()
        process.exit(errors.length ? 1 : 0)
    }, 400)
}

// Hard stop so a wedged table can never leave a bot hanging in CI or a subagent run.
setTimeout(() => {
    errors.push(`timed out after ${roundsPlayed}/${opts.rounds} rounds`)
    finish()
}, 60_000 + opts.rounds * 45_000)
