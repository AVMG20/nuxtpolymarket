// scripts/xenoslot-rtp.ts
//
// Monte-Carlo RTP tester for the Xeno Slot.
// Run:  bun run scripts/xenoslot-rtp.ts [rounds] [buyBonus]
//
// Pass "buyBonus" as the second arg to simulate the buy-bonus feature instead
// of base spins (useful for checking XENOSLOT_BUY_BONUS_COST is still
// calibrated).
//
// Imports the *real* game logic so the measured RTP matches production exactly.

import { playXenoSlot, XENOSLOT_MAX_WIN_MULT } from '../shared/utils/gamelogic/xenoslot'

const rounds = Number(process.argv[2] ?? 2_000_000)
const buyBonus = process.argv[3] === 'buyBonus'
const bet = 1

let totalBet = 0
let totalPayout = 0

let basePayoutSum = 0
let bonusPayoutSum = 0

let bonusTriggers = 0
let wins = 0
let capHits = 0

// payout distribution buckets (× bet)
const buckets = [0, 0.5, 1, 2, 5, 10, 50, 100, 500, 1000, Infinity]
const bucketCounts = new Array(buckets.length).fill(0)

const maxWin = bet * XENOSLOT_MAX_WIN_MULT

// --- top-N win tracking ------------------------------------------------------
const TOP_N = 30

type WinRecord = { round: number, payout: number, mult: number, type: 'base' | 'bonus' }

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

const topWins: WinRecord[] = []

for (let i = 0; i < rounds; i++) {
  const r = playXenoSlot(bet, buyBonus ? { buyBonus: true } : undefined)
  totalBet += r.cost
  totalPayout += r.payout
  basePayoutSum += r.basePayout
  bonusPayoutSum += r.bonus?.bonusPayout ?? 0
  if (r.bonusTriggered) bonusTriggers++
  if (r.won) wins++
  if (r.payout >= maxWin) capHits++

  pushTop(topWins, { round: i, payout: r.payout, mult: r.payout / bet, type: r.bonusTriggered ? 'bonus' : 'base' })

  const m = r.payout / bet
  for (let b = 0; b < buckets.length; b++) {
    if (m <= buckets[b]!) { bucketCounts[b]++; break }
  }
}

const pct = (n: number) => (100 * n).toFixed(4) + '%'
const fmtMult = (n: number) => n.toFixed(2) + 'x'

console.log(`rounds:            ${rounds.toLocaleString()}${buyBonus ? '  (buy-bonus mode)' : ''}`)
console.log(`total RTP:         ${pct(totalPayout / totalBet)}`)
console.log(`  base RTP:        ${pct(basePayoutSum / totalBet)}`)
console.log(`  bonus RTP:       ${pct(bonusPayoutSum / totalBet)}`)
console.log(`bonus trigger:     ${pct(bonusTriggers / rounds)}  (1 in ${(rounds / bonusTriggers).toFixed(0)})`)
console.log(`hit freq (>bet):   ${pct(wins / rounds)}`)
console.log(`max-win hits:      ${capHits}  (1 in ${capHits ? (rounds / capHits).toFixed(0) : '—'})`)
console.log('payout distribution (× bet):')
for (let b = 0; b < buckets.length; b++) {
  const lo = b === 0 ? 0 : buckets[b - 1]!
  const hi = buckets[b]!
  const label = hi === Infinity ? `>${lo}` : `${lo}–${hi}`
  console.log(`  ${label.padEnd(10)} ${pct(bucketCounts[b] / rounds)}`)
}

console.log(`\ntop ${TOP_N} wins overall (base + bonus):`)
if (topWins.length === 0) {
  console.log('  (none observed)')
} else {
  topWins.forEach((w, idx) => {
    console.log(`  ${(idx + 1).toString().padStart(2)}. round ${w.round.toLocaleString().padStart(10)}  ${w.type.padEnd(5)}  payout ${w.payout.toFixed(2).padStart(12)}  (${fmtMult(w.mult)})`)
  })
}
