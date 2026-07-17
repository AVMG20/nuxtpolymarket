// scripts/candymadness-rtp.ts
//
// Monte-Carlo RTP tester for Candy Madness.
// Run:  bun scripts/candymadness-rtp.ts [rounds]
//
// Imports the *real* game logic so the measured RTP matches production exactly.

import { playCandyMadness, CM_MAX_WIN_MULT } from '../shared/utils/gamelogic/candymadness'

const rounds = Number(process.argv[2] ?? 2_000_000)
const bet = 1

let totalBet = 0
let totalPayout = 0
let basePayoutSum = 0
let bonusPayoutSum = 0

let bonusTriggers = 0
let wins = 0
let capHits = 0

const buckets = [0, 0.5, 1, 2, 5, 10, 50, 100, 500, 1000, Infinity]
const bucketCounts = new Array(buckets.length).fill(0)

const maxWin = bet * CM_MAX_WIN_MULT

// --- top-N win tracking -----------------------------------------------
const TOP_N = 20

type WinRecord = { round: number; payout: number; mult: number }

function pushTop(list: WinRecord[], rec: WinRecord) {
    // list kept sorted descending by payout, capped at TOP_N
    if (list.length < TOP_N) {
        list.push(rec)
        list.sort((a, b) => b.payout - a.payout)
        return
    }
    if (rec.payout > list[list.length - 1]!.payout) {
        list[list.length - 1] = rec
        list.sort((a, b) => b.payout - a.payout)
    }
}

const topBonusWins: WinRecord[] = []
const topBaseWins: WinRecord[] = []

// --- spins-to-bonus tracking -------------------------------------------
let lastBonusRound = -1 // round index (0-based) of previous bonus trigger
let gapSum = 0
let gapCount = 0

for (let i = 0; i < rounds; i++) {
    const r = playCandyMadness(bet)
    totalBet += bet
    totalPayout += r.payout
    basePayoutSum += r.basePayout
    bonusPayoutSum += r.bonusPayout
    if (r.payout > bet) wins++
    if (r.payout >= maxWin) capHits++

    if (r.bonusTriggered) {
        bonusTriggers++

        if (lastBonusRound >= 0) {
            gapSum += i - lastBonusRound
            gapCount++
        }
        lastBonusRound = i

        pushTop(topBonusWins, { round: i, payout: r.bonusPayout, mult: r.bonusPayout / bet })
    } else {
        pushTop(topBaseWins, { round: i, payout: r.basePayout, mult: r.basePayout / bet })
    }

    const m = r.payout / bet
    for (let b = 0; b < buckets.length; b++) {
        if (m <= buckets[b]!) { bucketCounts[b]++; break }
    }
}

const pct = (n: number) => (100 * n).toFixed(4) + '%'
const fmtMult = (n: number) => n.toFixed(2) + 'x'

console.log(`rounds:            ${rounds.toLocaleString()}`)
console.log(`total RTP:         ${pct(totalPayout / totalBet)}`)
console.log(`  base RTP:        ${pct(basePayoutSum / totalBet)}`)
console.log(`  bonus RTP:       ${pct(bonusPayoutSum / totalBet)}`)
console.log(`bonus trigger:     ${pct(bonusTriggers / rounds)}  (1 in ${bonusTriggers ? (rounds / bonusTriggers).toFixed(0) : '—'})`)
console.log(`hit freq (>bet):   ${pct(wins / rounds)}`)
console.log(`max-win hits:      ${capHits}  (1 in ${capHits ? (rounds / capHits).toFixed(0) : '—'})`)

console.log(`avg spins to bonus: ${gapCount ? (gapSum / gapCount).toFixed(2) : '—'}  (n=${gapCount} gaps observed)`)

console.log('payout distribution (× bet):')
for (let b = 0; b < buckets.length; b++) {
    const lo = b === 0 ? 0 : buckets[b - 1]!
    const hi = buckets[b]!
    const label = hi === Infinity ? `>${lo}` : `${lo}–${hi}`
    console.log(`  ${label.padEnd(10)} ${pct(bucketCounts[b] / rounds)}`)
}

console.log(`\ntop ${TOP_N} bonus wins:`)
if (topBonusWins.length === 0) {
    console.log('  (none observed)')
} else {
    topBonusWins.forEach((w, idx) => {
        console.log(`  ${(idx + 1).toString().padStart(2)}. round ${w.round.toLocaleString().padStart(10)}  payout ${w.payout.toFixed(2).padStart(12)}  (${fmtMult(w.mult)})`)
    })
}

console.log(`\ntop ${TOP_N} base game wins:`)
if (topBaseWins.length === 0) {
    console.log('  (none observed)')
} else {
    topBaseWins.forEach((w, idx) => {
        console.log(`  ${(idx + 1).toString().padStart(2)}. round ${w.round.toLocaleString().padStart(10)}  payout ${w.payout.toFixed(2).padStart(12)}  (${fmtMult(w.mult)})`)
    })
}