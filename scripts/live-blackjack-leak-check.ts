#!/usr/bin/env bun
/**
 * Sits at the table and audits every byte the server sends, looking for
 * information a player should not have: the dealer's hole card before the
 * reveal, shoe contents or ordering, another player's private fields.
 *
 *   bun scripts/live-blackjack-leak-check.ts --rounds 8
 *
 * The hole card is checked by proving a negative — during play the client is
 * told a card exists and nothing else, so the audit fails if any rank or suit
 * ever rides along with `hidden`, and separately if the count of face-down
 * cards the client can see ever disagrees with what the phase allows.
 */
import type { LbServerMessage, LbTableState } from '../shared/utils/live-blackjack/types'

const args = process.argv.slice(2)
const flag = (name: string, fallback?: string) => {
    const i = args.indexOf(`--${name}`)
    if (i >= 0 && args[i + 1] !== undefined) return args[i + 1]!
    if (fallback !== undefined) return fallback
    throw new Error(`missing --${name}`)
}

const BASE = flag('base', 'http://localhost:3000')
const EMAIL = flag('email', 'ramon-table@polynux.test')
const PASSWORD = flag('password', 'blackjack-test-42')
const ROUNDS = Number(flag('rounds', '8'))

const failures: string[] = []
const bad = (m: string) => {
    failures.push(m)
    console.error(`  LEAK  ${m}`)
}

const seen = { snapshots: 0, rounds: 0, hiddenCards: 0, phasesWithHidden: new Set<string>() }
let lastRound = -1

/** Every key the server has ever sent, so a new field cannot slip in unnoticed. */
const dealerCardKeys = new Set<string>()
const seatKeys = new Set<string>()
const shoeKeys = new Set<string>()

function audit(state: LbTableState, raw: string) {
    seen.snapshots++
    if (state.roundId !== lastRound) {
        lastRound = state.roundId
        seen.rounds++
    }

    for (const card of state.dealer.cards) {
        for (const k of Object.keys(card)) dealerCardKeys.add(k)
        if (!card.hidden) continue
        seen.hiddenCards++
        seen.phasesWithHidden.add(state.phase)
        // The whole contract: a face-down card is an id and a flag, nothing else.
        if (card.rank !== undefined) bad(`hole card carried rank ${card.rank} in phase ${state.phase}`)
        if (card.suit !== undefined) bad(`hole card carried suit ${card.suit} in phase ${state.phase}`)
        const extra = Object.keys(card).filter(k => k !== 'id' && k !== 'hidden')
        if (extra.length) bad(`hole card carried unexpected fields: ${extra.join(', ')}`)
    }

    // The dealer's advertised score must never account for a card we cannot see.
    const visible = state.dealer.cards.filter(c => !c.hidden && c.rank)
    if (state.dealer.cards.some(c => c.hidden)) {
        if (visible.length !== 1) {
            bad(`${visible.length} dealer cards face up alongside a hole card`)
        }
        if (state.dealer.blackjack) {
            bad('dealer advertised blackjack while still holding a face-down card')
        }
    }

    for (const k of Object.keys(state.shoe)) shoeKeys.add(k)
    // A shoe that ships anything array-shaped is shipping cards.
    for (const [k, v] of Object.entries(state.shoe as Record<string, unknown>)) {
        if (Array.isArray(v) || (v && typeof v === 'object')) bad(`shoe exposes structured field "${k}"`)
    }

    for (const seat of state.seats) {
        if (!seat) continue
        for (const k of Object.keys(seat)) seatKeys.add(k)
        for (const hand of seat.hands) {
            for (const card of hand.cards) {
                if (card.hidden) bad(`seat ${seat.index} had a face-down card, which player hands never have`)
            }
        }
    }

    // Nothing resembling a deck should appear anywhere in the payload.
    if (/"cards"\s*:\s*\[[^\]]{2000,}/.test(raw)) bad('a suspiciously large card array is present in the snapshot')
}

const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
})
if (!res.ok) throw new Error(`sign-in failed (${res.status})`)
const cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')

const host = BASE.replace(/^https?:\/\//, '')
const ws = new WebSocket(`ws://${host}/api/live-blackjack/ws`, { headers: { cookie } } as never)

console.log(`auditing every frame for ${ROUNDS} rounds\n`)
const done = Promise.withResolvers<boolean>()
const deadline = setTimeout(() => done.resolve(true), 300000)

ws.addEventListener('message', (event) => {
    const raw = String(event.data)
    const message = JSON.parse(raw) as LbServerMessage
    if (message.t !== 'state') return
    audit(message.state, raw)
    if (seen.rounds > ROUNDS) {
        clearTimeout(deadline)
        done.resolve(true)
    }
})

await done.promise
ws.close()

console.log(`snapshots audited:  ${seen.snapshots}`)
console.log(`rounds:             ${seen.rounds}`)
console.log(`face-down cards:    ${seen.hiddenCards} (phases: ${[...seen.phasesWithHidden].join(', ')})`)
console.log(`\ndealer card fields sent: ${[...dealerCardKeys].sort().join(', ')}`)
console.log(`shoe fields sent:        ${[...shoeKeys].sort().join(', ')}`)
console.log(`seat fields sent:        ${[...seatKeys].sort().join(', ')}`)

if (!seen.hiddenCards) {
    bad('never observed a face-down card, so the hole-card check proved nothing')
}
if (failures.length) {
    console.error(`\n${failures.length} problem${failures.length === 1 ? '' : 's'}`)
    process.exit(1)
}
console.log('\nno card data leaked')
process.exit(0)
