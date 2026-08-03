#!/usr/bin/env bun
/**
 * Chaos harness for the live table. Drives N accounts from one process, each
 * with its own socket, and deliberately misbehaves: joining and leaving
 * mid-round, dropping and restoring sockets, sitting on decisions until the
 * turn timer fires, betting late enough to miss the round entirely.
 *
 *   bun scripts/live-blackjack-chaos.ts --bots 5 --duration 600
 *
 * Pair it with live-blackjack-smoke.ts, which asserts the invariants while this
 * tries to break them. This script only reports what it did; the observer is
 * what decides whether the table held up.
 */
import { chipStack } from '../shared/utils/live-blackjack/chips'
import { handScore, LB_TIMERS } from '../shared/utils/live-blackjack/rules'
import { LB_SIDE_BETS } from '../shared/utils/live-blackjack/sidebets'
import { basicStrategy } from '../shared/utils/live-blackjack/strategy'
import type { LbAction, LbServerMessage, LbTableState } from '../shared/utils/live-blackjack/types'

const args = process.argv.slice(2)
const flag = (name: string, fallback: string) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback
}

const BASE = flag('base', 'http://localhost:3000')
const BOTS = Number(flag('bots', '5'))
const DURATION = Number(flag('duration', '600')) * 1000
const PASSWORD = flag('password', 'blackjack-test-42')

const rand = (min: number, max: number) => min + Math.random() * (max - min)
const chance = (p: number) => Math.random() < p
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!

type Strategy = 'basic' | 'wild' | 'stand' | 'aggressive'

interface Bot {
    label: string
    email: string
    cookie: string
    ws: WebSocket | null
    userId: string | null
    seat: number | null
    balance: number
    bet: number
    strategy: Strategy
    /** How often this bot backs the side spots, and how long it dithers. */
    sideChance: number
    slow: number
    betForRound: number
    lastActionKey: string
    pendingAction: ReturnType<typeof setTimeout> | null
    stats: { rounds: number, reconnects: number, leaves: number, stalls: number, sideBets: number, errors: string[] }
}

const bots: Bot[] = []
let stopping = false

// ─── connection ───────────────────────────────────────────────────────────────

async function signIn(email: string): Promise<string> {
    const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: PASSWORD })
    })
    if (!res.ok) throw new Error(`sign-in failed for ${email} (${res.status})`)
    return (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')
}

function send(bot: Bot, message: unknown) {
    if (bot.ws?.readyState === WebSocket.OPEN) bot.ws.send(JSON.stringify(message))
}

function connect(bot: Bot) {
    if (stopping) return
    const host = BASE.replace(/^https?:\/\//, '')
    const proto = BASE.startsWith('https') ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${host}/api/live-blackjack/ws`, { headers: { cookie: bot.cookie } } as never)
    bot.ws = ws

    ws.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as LbServerMessage
        if (message.t === 'you') {
            bot.userId = message.userId
            bot.seat = message.seat
            bot.balance = message.balance
        } else if (message.t === 'balance') {
            bot.balance = message.balance
        } else if (message.t === 'error') {
            // "Not your turn" and friends are expected here — the whole point is
            // to act at moments the table should be rejecting.
            bot.stats.errors.push(message.message)
        } else if (message.t === 'state') {
            onState(bot, message.state)
        }
    })
    ws.addEventListener('close', () => {
        if (bot.ws === ws) bot.ws = null
    })
    ws.addEventListener('error', () => {
        if (bot.ws === ws) bot.ws = null
    })
}

/** Yank the socket out from under a live hand and bring it back. */
function dropAndReturn(bot: Bot) {
    if (!bot.ws) return
    bot.stats.reconnects++
    bot.ws.close()
    bot.ws = null
    setTimeout(() => {
        if (stopping) return
        bot.betForRound = -1
        connect(bot)
    }, rand(600, 6000))
}

// ─── play ─────────────────────────────────────────────────────────────────────

function decide(bot: Bot, state: LbTableState, seat: NonNullable<LbTableState['seats'][number]>): LbAction {
    const hand = seat.hands[state.activeHand ?? 0]
    if (!hand) return 'stand'
    const upcard = state.dealer.cards.find(c => c.rank && !c.hidden)?.rank
    if (!upcard) return 'stand'

    if (bot.strategy === 'stand') return 'stand'
    if (bot.strategy === 'wild') return pick<LbAction>(['hit', 'stand', 'hit', 'stand', 'double', 'split', 'surrender'])
    if (bot.strategy === 'aggressive') {
        return handScore(hand.cards).total < 17 ? 'hit' : 'stand'
    }
    return basicStrategy(hand, upcard, seat.hands, bot.balance)
}

function placeBets(bot: Bot, state: LbTableState) {
    const want = Math.min(bot.bet, bot.balance)
    if (want < state.minBet) return
    for (const chip of chipStack(want, 8)) send(bot, { t: 'bet', amount: chip.value })

    if (chance(bot.sideChance)) {
        bot.stats.sideBets++
        for (const spot of LB_SIDE_BETS) {
            if (!chance(0.75)) continue
            const side = Math.max(state.minBet, Math.floor(want * rand(0.2, 0.6)))
            for (const chip of chipStack(side, 3)) send(bot, { t: 'bet', amount: chip.value, spot })
        }
    }

    // Fiddling with the layout before committing, which a real player does.
    if (chance(0.15)) send(bot, { t: 'undoBet' })
    if (chance(0.05)) {
        send(bot, { t: 'clearBet' })
        for (const chip of chipStack(want, 8)) send(bot, { t: 'bet', amount: chip.value })
    }

    // Sometimes never vote, so the betting clock has to expire on its own.
    if (chance(0.8)) send(bot, { t: 'voteStart' })
    else bot.stats.stalls++
}

function onState(bot: Bot, state: LbTableState) {
    if (stopping) return
    const seat = bot.userId ? state.seats.find(s => s?.userId === bot.userId) ?? null : null
    bot.seat = seat?.index ?? null

    if (!seat) {
        const free = state.seats.map((s, i) => (s ? -1 : i)).filter(i => i >= 0)
        if (free.length && (state.phase === 'betting' || state.phase === 'idle') && chance(0.35)) {
            send(bot, { t: 'sit', seat: pick(free) })
        }
        return
    }

    if (state.phase === 'betting' && bot.betForRound !== state.roundId) {
        bot.betForRound = state.roundId
        // A long enough dither here means missing the round, which should cost
        // the seat rather than wedge the table.
        setTimeout(() => {
            if (!stopping && bot.ws) placeBets(bot, state)
        }, rand(200, bot.slow * LB_TIMERS.betting))
    }

    if (state.phase === 'insurance' && !seat.insuranceDecided) {
        setTimeout(() => send(bot, { t: 'insurance', take: chance(0.3) }), rand(200, 3000))
    }

    const mine = state.activeSeat === seat.index
    const key = `${state.roundId}:${state.activeSeat}:${state.activeHand}:${seat.hands[state.activeHand ?? 0]?.cards.length}`
    if (mine && key !== bot.lastActionKey) {
        bot.lastActionKey = key
        if (bot.pendingAction) clearTimeout(bot.pendingAction)
        // 1 in 12 turns is left to time out entirely.
        const stall = chance(1 / 12)
        if (stall) bot.stats.stalls++
        const delay = stall ? LB_TIMERS.turn + 3000 : rand(300, 4000)
        bot.pendingAction = setTimeout(() => {
            if (!stopping && bot.ws) send(bot, { t: 'action', action: decide(bot, state, seat) })
        }, delay)
    }

    if (state.phase === 'payout') bot.stats.rounds++
}

// ─── run ──────────────────────────────────────────────────────────────────────

const STRATEGIES: Strategy[] = ['basic', 'wild', 'stand', 'aggressive', 'basic']

for (let i = 0; i < BOTS; i++) {
    const email = `lb-bot-${String(i + 1).padStart(2, '0')}@polynux.test`
    const cookie = await signIn(email)
    bots.push({
        label: `bot${i + 1}`,
        email,
        cookie,
        ws: null,
        userId: null,
        seat: null,
        balance: 0,
        bet: pick([200, 500, 1000, 2500]),
        strategy: STRATEGIES[i % STRATEGIES.length]!,
        sideChance: rand(0.25, 0.9),
        slow: rand(0.1, 1.4),
        betForRound: -1,
        lastActionKey: '',
        pendingAction: null,
        stats: { rounds: 0, reconnects: 0, leaves: 0, stalls: 0, sideBets: 0, errors: [] }
    })
}

console.log(`chaos: ${BOTS} bots against ${BASE} for ${DURATION / 1000}s`)
for (const bot of bots) {
    console.log(`  ${bot.label}  ${bot.strategy.padEnd(10)} bet ${String(bot.bet).padEnd(5)} side ${(bot.sideChance * 100).toFixed(0)}%  dither ${bot.slow.toFixed(2)}x`)
    connect(bot)
}

// Background churn: sockets dropping and players walking away mid-hand.
const churn = setInterval(() => {
    if (stopping) return
    const bot = pick(bots)
    const roll = Math.random()
    if (roll < 0.5) {
        dropAndReturn(bot)
    } else if (roll < 0.75 && bot.seat !== null) {
        bot.stats.leaves++
        send(bot, { t: 'leave' })
    }
}, 9000)

await new Promise(resolve => setTimeout(resolve, DURATION))
stopping = true
clearInterval(churn)
for (const bot of bots) {
    if (bot.pendingAction) clearTimeout(bot.pendingAction)
    bot.ws?.close()
}

console.log('\nwhat each bot put the table through')
for (const bot of bots) {
    const s = bot.stats
    console.log(`  ${bot.label}  rounds ${String(s.rounds).padStart(3)}  reconnects ${s.reconnects}  leaves ${s.leaves}  stalls ${s.stalls}  side-bet rounds ${s.sideBets}  errors ${s.errors.length}`)
}

const allErrors = bots.flatMap(b => b.stats.errors)
const tally = new Map<string, number>()
for (const e of allErrors) tally.set(e, (tally.get(e) ?? 0) + 1)
if (tally.size) {
    console.log('\nserver rejections (expected ones are fine — listed so the odd one stands out)')
    for (const [message, count] of [...tally].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(count).padStart(4)}x  ${message}`)
    }
}
process.exit(0)
