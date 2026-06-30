// scripts/candymadness-rtp.ts
//
// Monte-Carlo RTP tester for Candy Madness.
// Run:  pnpm tsx scripts/candymadness-rtp.ts [rounds]
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

for (let i = 0; i < rounds; i++) {
  const r = playCandyMadness(bet)
  totalBet += bet
  totalPayout += r.payout
  basePayoutSum += r.basePayout
  bonusPayoutSum += r.bonusPayout
  if (r.bonusTriggered) bonusTriggers++
  if (r.payout > bet) wins++
  if (r.payout >= maxWin) capHits++

  const m = r.payout / bet
  for (let b = 0; b < buckets.length; b++) {
    if (m <= buckets[b]!) { bucketCounts[b]++; break }
  }
}

const pct = (n: number) => (100 * n).toFixed(4) + '%'

console.log(`rounds:            ${rounds.toLocaleString()}`)
console.log(`total RTP:         ${pct(totalPayout / totalBet)}`)
console.log(`  base RTP:        ${pct(basePayoutSum / totalBet)}`)
console.log(`  bonus RTP:       ${pct(bonusPayoutSum / totalBet)}`)
console.log(`bonus trigger:     ${pct(bonusTriggers / rounds)}  (1 in ${bonusTriggers ? (rounds / bonusTriggers).toFixed(0) : '—'})`)
console.log(`hit freq (>bet):   ${pct(wins / rounds)}`)
console.log(`max-win hits:      ${capHits}  (1 in ${capHits ? (rounds / capHits).toFixed(0) : '—'})`)
console.log('payout distribution (× bet):')
for (let b = 0; b < buckets.length; b++) {
  const lo = b === 0 ? 0 : buckets[b - 1]!
  const hi = buckets[b]!
  const label = hi === Infinity ? `>${lo}` : `${lo}–${hi}`
  console.log(`  ${label.padEnd(10)} ${pct(bucketCounts[b] / rounds)}`)
}
