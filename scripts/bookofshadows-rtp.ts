// scripts/bookofshadows-rtp.ts
//
// Monte-Carlo RTP tester for Book of Shadows.
// Run:  bun run scripts/bookofshadows-rtp.ts [rounds] [buyBonus]
//
// Pass "buyBonus" as the second arg to simulate the buy-bonus feature instead
// of base spins (useful for checking BOS_BUY_BONUS_COST is still calibrated).
//
// Imports the *real* game logic so the measured RTP matches production exactly.
//
// A bonus-triggering spin settles in ONE call in production: `payout` already
// includes the trigger grid's own win plus the whole precomputed bonus with
// the (server-picked) tier multiplier applied to the wild portion. The
// client's "roll" and bonus spins are purely cosmetic replays.

import { playBookOfShadows, BOS_MAX_WIN_MULT, BOS_BUY_BONUS_COST } from '../shared/utils/gamelogic/bookofshadows'

const rounds = Number(process.argv[2] ?? 2_000_000)
const buyBonus = process.argv[3] === 'buyBonus'
const bet = 1

let totalCost = 0
let totalPayout = 0
let basePayoutSum = 0
let bonusPayoutSum = 0

let bonusTriggers = 0
let wins = 0
let capHits = 0
let fullClears = 0
let lockedColumnsSum = 0

const maxWin = bet * BOS_MAX_WIN_MULT

const buckets = [0, 0.5, 1, 2, 5, 10, 50, 100, 500, 1000, 5000, Infinity]
const bucketCounts = new Array(buckets.length).fill(0)

let lastBonusRound = -1
let gapSum = 0
let gapCount = 0

for (let i = 0; i < rounds; i++) {
  const r = playBookOfShadows(bet, buyBonus ? { buyBonus: true } : undefined)
  const cost = r.cost ?? bet
  totalCost += cost

  const roundPayout = r.payout

  if (r.bonus) {
    bonusTriggers++
    bonusPayoutSum += roundPayout
    lockedColumnsSum += r.bonus.lockedColumnsFinal.length
    if (r.bonus.lockedColumnsFinal.length >= 5) fullClears++

    if (lastBonusRound >= 0) {
      gapSum += i - lastBonusRound
      gapCount++
    }
    lastBonusRound = i
  } else {
    basePayoutSum += roundPayout
  }

  totalPayout += roundPayout
  if (roundPayout >= maxWin) capHits++
  if (roundPayout > cost) wins++

  const m = roundPayout / bet
  for (let b = 0; b < buckets.length; b++) {
    if (m <= buckets[b]!) {
      bucketCounts[b]++
      break
    }
  }
}

const pct = (n: number) => (100 * n).toFixed(4) + '%'

console.log(`rounds:             ${rounds.toLocaleString()}${buyBonus ? '  (buy-bonus mode)' : ''}`)
console.log(`total RTP:          ${pct(totalPayout / totalCost)}`)
console.log(`  base RTP:         ${pct(basePayoutSum / totalCost)}`)
console.log(`  bonus RTP:        ${pct(bonusPayoutSum / totalCost)}`)
console.log(`bonus trigger:      ${pct(bonusTriggers / rounds)}  (1 in ${bonusTriggers ? (rounds / bonusTriggers).toFixed(0) : '—'})`)
console.log(`avg spins to bonus: ${gapCount ? (gapSum / gapCount).toFixed(2) : '—'}  (n=${gapCount} gaps observed)`)
console.log(`hit freq (>cost):   ${pct(wins / rounds)}`)
console.log(`max-win hits:       ${capHits}  (1 in ${capHits ? (rounds / capHits).toFixed(0) : '—'})`)

if (bonusTriggers) {
  console.log(`\navg columns locked at bonus end: ${(lockedColumnsSum / bonusTriggers).toFixed(2)} / 5`)
  console.log(`full clears (all 5 cols):        ${fullClears}  (${pct(fullClears / bonusTriggers)} of bonuses)`)
  console.log(`avg bonus round payout:          ${(bonusPayoutSum / bonusTriggers).toFixed(2)}x bet`)
}

console.log(`\ncurrent BOS_BUY_BONUS_COST: ${BOS_BUY_BONUS_COST}x bet`)

console.log('\npayout distribution (× bet):')
for (let b = 0; b < buckets.length; b++) {
  const lo = b === 0 ? 0 : buckets[b - 1]!
  const hi = buckets[b]!
  const label = hi === Infinity ? `>${lo}` : `${lo}–${hi}`
  console.log(`  ${label.padEnd(12)} ${pct(bucketCounts[b] / rounds)}`)
}
