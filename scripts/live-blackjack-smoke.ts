#!/usr/bin/env bun
/**
 * Watches a live table as an unseated observer and asserts the invariants that
 * a human would otherwise have to catch by eye: card counts, phase order,
 * countdown sanity and settlement arithmetic.
 *
 *   bun scripts/live-blackjack-smoke.ts --base http://localhost:3000 \
 *     --email ramon-table@polynux.test --password blackjack-test-42 --rounds 12
 *
 * Exits non-zero on the first broken invariant, so it can gate a deploy.
 */
import { handScore } from '../shared/utils/live-blackjack/rules'
import type { LbServerMessage, LbTableState } from '../shared/utils/live-blackjack/types'

const args = process.argv.slice(2)
const flag = (name: string, fallback?: string) => {
    const i = args.indexOf(`--${name}`)
    if (i >= 0 && args[i + 1] !== undefined) return args[i + 1]!
    if (fallback !== undefined) return fallback
    throw new Error(`missing --${name}`)
}

const BASE = flag('base', 'http://localhost:3000')
const EMAIL = flag('email')
const PASSWORD = flag('password')
const ROUNDS = Number(flag('rounds', '12'))
const TIMEOUT_MS = Number(flag('timeout', '240000'))

const failures: string[] = []
const seen = { rounds: 0, deals: 0, sideBets: 0, sideWins: 0 }

function bad(message: string) {
    failures.push(message)
    console.error(`  FAIL  ${message}`)
}

// ─── invariants ───────────────────────────────────────────────────────────────

/** Legal phase successors. A jump outside this graph means a lost transition. */
const NEXT: Record<string, string[]> = {
    idle: ['idle', 'betting'],
    betting: ['betting', 'idle', 'dealing'],
    dealing: ['dealing', 'insurance', 'playing', 'dealer', 'payout'],
    insurance: ['insurance', 'playing', 'dealer', 'payout'],
    playing: ['playing', 'dealer', 'payout'],
    dealer: ['dealer', 'payout'],
    payout: ['payout', 'betting', 'idle']
}

let lastPhase: string | null = null
let lastRoundId = -1
const counted = new Set<string>()

/** Rounds that actually had money on the table, so empty ones are not counted against the deal tally. */
const livedRounds = new Set<number>()

/** Wall-clock spent in each phase, to catch a stall the invariants would pass. */
const phaseMs = new Map<string, number[]>()
let phaseStarted = Date.now()
const roundMs: number[] = []
let roundStarted = Date.now()

function check(state: LbTableState) {
    if (lastPhase && state.phase !== lastPhase) {
        if (!NEXT[lastPhase]?.includes(state.phase)) {
            bad(`illegal phase jump ${lastPhase} -> ${state.phase} (round ${state.roundId})`)
        }
        if (state.phase === 'dealing') seen.deals++
        const elapsed = Date.now() - phaseStarted
        if (!phaseMs.has(lastPhase)) phaseMs.set(lastPhase, [])
        phaseMs.get(lastPhase)!.push(elapsed)
        phaseStarted = Date.now()
    }
    lastPhase = state.phase

    if (state.roundId !== lastRoundId) {
        if (lastRoundId >= 0 && state.roundId !== lastRoundId + 1) {
            bad(`round id jumped ${lastRoundId} -> ${state.roundId}`)
        }
        if (lastRoundId >= 0) roundMs.push(Date.now() - roundStarted)
        roundStarted = Date.now()
        lastRoundId = state.roundId
        seen.rounds++
    }

    // A countdown that has already expired but is still advertised means the
    // client will sit on a dead timer, which is what "it stops and waits" looks like.
    if (state.phaseEndsAt !== null && state.phaseDuration !== null) {
        const remaining = state.phaseEndsAt - state.now
        if (remaining > state.phaseDuration + 1000) {
            bad(`phase ${state.phase} advertises ${remaining}ms left on a ${state.phaseDuration}ms timer`)
        }
        if (remaining < -8000) {
            bad(`phase ${state.phase} timer expired ${-remaining}ms ago and has not advanced`)
        }
    }

    for (const seat of state.seats) {
        if (!seat) continue
        if (seat.hands.length) livedRounds.add(state.roundId)

        for (const hand of seat.hands) {
            // The tell for a double deal: two cards is the opening hand, and
            // nothing but a hit or a split can grow it.
            if (state.phase === 'dealing' && hand.cards.length > 2) {
                bad(`seat ${seat.index} holds ${hand.cards.length} cards while still dealing (round ${state.roundId})`)
            }
            if (hand.cards.length > 12) {
                bad(`seat ${seat.index} holds ${hand.cards.length} cards, which no legal hand reaches`)
            }

            const visible = hand.cards.filter(c => c.rank && !c.hidden)
            const total = handScore(hand.cards).total
            if (visible.length === hand.cards.length && total !== hand.score) {
                bad(`seat ${seat.index} score ${hand.score} disagrees with its cards (${total})`)
            }
            // Four aces is 44 hard; anything past that cannot be a real hand.
            if (total > 44) {
                bad(`seat ${seat.index} totals ${total}, which is not reachable (${hand.cards.length} cards)`)
            }
            if (hand.status === 'stood' && total > 21) {
                bad(`seat ${seat.index} stood on ${total} (round ${state.roundId})`)
            }
            if (hand.status === 'busted' && total <= 21) {
                bad(`seat ${seat.index} busted on ${total} (round ${state.roundId})`)
            }
        }

        if (seat.hands.length > 8) bad(`seat ${seat.index} has ${seat.hands.length} hands, past the cap`)

        for (const result of seat.sideResults ?? []) {
            // Results ride along on every snapshot for the rest of the round,
            // so tally them once per round and seat rather than per message.
            const tag = `${state.roundId}:${seat.index}:${result.key}`
            const fresh = !counted.has(tag)
            if (fresh) counted.add(tag)

            if (result.stake > 0 && fresh) seen.sideBets++
            if (result.payout > 0) {
                if (fresh) seen.sideWins++
                if (!result.label) bad(`seat ${seat.index} won a side bet with no winning combination named`)
                const expected = result.stake * (1 + result.multiplier)
                if (Math.abs(result.payout - expected) > 0.001) {
                    bad(`side bet payout ${result.payout} != stake ${result.stake} x ${1 + result.multiplier}`)
                }
            }
        }
    }

    const dealerTotal = handScore(state.dealer.cards.filter(c => !c.hidden)).total
    if (state.phase === 'payout' && dealerTotal > 26) {
        bad(`dealer finished on ${dealerTotal}, which it should never draw to`)
    }
    if (state.dealer.cards.length > 12) {
        bad(`dealer holds ${state.dealer.cards.length} cards`)
    }
}

// ─── run ──────────────────────────────────────────────────────────────────────

const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
})
if (!res.ok) throw new Error(`sign-in failed (${res.status}): ${await res.text()}`)
const cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')

const host = BASE.replace(/^https?:\/\//, '')
const proto = BASE.startsWith('https') ? 'wss' : 'ws'
const ws = new WebSocket(`${proto}://${host}/api/live-blackjack/ws`, { headers: { cookie } } as never)

console.log(`watching ${BASE} for ${ROUNDS} rounds\n`)

const done = Promise.withResolvers<boolean>()
const deadline = setTimeout(() => {
    bad(`timed out after ${TIMEOUT_MS}ms having seen only ${seen.rounds} rounds`)
    done.resolve(true)
}, TIMEOUT_MS)

ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as LbServerMessage
    if (message.t !== 'state') return
    check(message.state)
    if (seen.rounds > ROUNDS) {
        clearTimeout(deadline)
        done.resolve(true)
    }
})
ws.addEventListener('error', () => {
    bad('socket error')
    done.resolve(true)
})

await done.promise
ws.close()

console.log(`\nrounds observed:   ${seen.rounds}`)
console.log(`deals observed:    ${seen.deals}`)
console.log(`side bets staked:  ${seen.sideBets}`)
console.log(`side bets won:     ${seen.sideWins}`)

// A round that never broadcasts its dealing phase is the tell for cards
// arriving all at once instead of being dealt out. Only rounds that were
// actually played count, and the first and last are partly observed.
const played = livedRounds.size
if (played > 2 && seen.deals < played - 2) {
    bad(`only ${seen.deals} of ${played} played rounds broadcast a dealing phase`)
}
console.log(`rounds played:     ${played}`)

const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
console.log('\nphase timings (avg / max, ms)')
for (const [phase, samples] of phaseMs) {
    console.log(`  ${phase.padEnd(10)} ${String(avg(samples)).padStart(6)} / ${String(Math.max(...samples)).padStart(6)}   (${samples.length}x)`)
}
if (roundMs.length) {
    console.log(`\nround length:      ${(avg(roundMs) / 1000).toFixed(1)}s avg, ${(Math.max(...roundMs) / 1000).toFixed(1)}s max`)
}

if (failures.length) {
    console.error(`\n${failures.length} broken invariant${failures.length === 1 ? '' : 's'}`)
    process.exit(1)
}
console.log('\nall invariants held')
process.exit(0)
