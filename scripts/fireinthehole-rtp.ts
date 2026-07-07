// scripts/fireinthehole-rtp.ts
//
// Monte-Carlo RTP tester for Fire in the Hole.
// Run:  bun run scripts/fireinthehole-rtp.ts [rounds] [buyBonus]
//
// Pass "buyBonus" as the second arg to simulate the buy-bonus feature instead
// of base spins (useful for checking FITH_BUY_BONUS_COST is still calibrated).
//
// Imports the *real* game logic so the measured RTP matches production exactly.

import { playFireInTheHole, FITH_MAX_WIN_MULT, FITH_STARTING_LINES, FITH_MAX_LINES } from '../shared/utils/gamelogic/fireinthehole'

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
const buckets = [0, 0.5, 1, 2, 5, 10, 50, 100, 500, 1000, 5000, Infinity]
const bucketCounts = new Array(buckets.length).fill(0)

const maxWin = bet * FITH_MAX_WIN_MULT

// --- top-N win tracking --------------------------------------------------
const TOP_N = 20

type WinRecord = { round: number, payout: number, mult: number, type: 'base' | 'bonus', rows: number }

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

// --- spins-to-bonus tracking ----------------------------------------------
let lastBonusRound = -1 // round index (0-based) of previous bonus trigger
let gapSum = 0
let gapCount = 0

// --- rows unlocked when the bonus round started ---------------------------
// FireBonusResult.activeLines already records this (rows unlock from bombs
// hitting the divider during the base spin, before free spins begin), so no
// changes to the game logic were needed to expose it.
const rowsAtBonus = new Map<number, { count: number, payoutSum: number, multSum: number }>()
for (let rows = FITH_STARTING_LINES; rows <= FITH_MAX_LINES; rows++) {
  rowsAtBonus.set(rows, { count: 0, payoutSum: 0, multSum: 0 })
}

for (let i = 0; i < rounds; i++) {
  const r = playFireInTheHole(bet, buyBonus ? { buyBonus: true } : undefined)
  totalBet += r.cost
  totalPayout += r.payout
  basePayoutSum += r.basePayout
  bonusPayoutSum += r.bonus?.payout ?? 0
  if (r.payout > r.cost) wins++
  if (r.payout >= maxWin) capHits++

  if (r.bonus) {
    bonusTriggers++

    if (lastBonusRound >= 0) {
      gapSum += i - lastBonusRound
      gapCount++
    }
    lastBonusRound = i

    const tier = rowsAtBonus.get(r.bonus.activeLines)
    if (tier) {
      tier.count++
      tier.payoutSum += r.bonus.payout
      tier.multSum += r.bonus.payout / bet
    }

    pushTop(topWins, { round: i, payout: r.payout, mult: r.payout / bet, type: 'bonus', rows: r.bonus.activeLines })
  } else {
    pushTop(topWins, { round: i, payout: r.payout, mult: r.payout / bet, type: 'base', rows: r.activeLines })
  }

  const m = r.payout / bet
  for (let b = 0; b < buckets.length; b++) {
    if (m <= buckets[b]!) {
      bucketCounts[b]++
      break
    }
  }
}

const pct = (n: number) => (100 * n).toFixed(4) + '%'
const fmtMult = (n: number) => n.toFixed(2) + 'x'

console.log(`rounds:             ${rounds.toLocaleString()}${buyBonus ? '  (buy-bonus mode)' : ''}`)
console.log(`total RTP:          ${pct(totalPayout / totalBet)}`)
console.log(`  base RTP:         ${pct(basePayoutSum / totalBet)}`)
console.log(`  bonus RTP:        ${pct(bonusPayoutSum / totalBet)}`)
console.log(`bonus trigger:      ${pct(bonusTriggers / rounds)}  (1 in ${bonusTriggers ? (rounds / bonusTriggers).toFixed(0) : '—'})`)
console.log(`avg spins to bonus: ${gapCount ? (gapSum / gapCount).toFixed(2) : '—'}  (n=${gapCount} gaps observed)`)
console.log(`hit freq (>bet):    ${pct(wins / rounds)}`)
console.log(`max-win hits:       ${capHits}  (1 in ${capHits ? (rounds / capHits).toFixed(0) : '—'})`)

console.log('\npayout distribution (× bet):')
for (let b = 0; b < buckets.length; b++) {
  const lo = b === 0 ? 0 : buckets[b - 1]!
  const hi = buckets[b]!
  const label = hi === Infinity ? `>${lo}` : `${lo}–${hi}`
  console.log(`  ${label.padEnd(12)} ${pct(bucketCounts[b] / rounds)}`)
}

console.log('\nbonus triggers by rows unlocked (activeLines when free spins started):')
console.log(`  ${'rows'.padEnd(6)}${'triggers'.padEnd(11)}${'share'.padEnd(11)}${'avg payout'.padEnd(14)}${'avg mult'.padEnd(12)}bonus RTP share`)
for (const [rows, tier] of rowsAtBonus) {
  const share = bonusTriggers ? tier.count / bonusTriggers : 0
  const avgPayout = tier.count ? tier.payoutSum / tier.count : 0
  const avgMult = tier.count ? tier.multSum / tier.count : 0
  const rtpShare = bonusPayoutSum ? tier.payoutSum / bonusPayoutSum : 0
  console.log(`  ${String(rows).padEnd(6)}${String(tier.count).padEnd(11)}${pct(share).padEnd(11)}${avgPayout.toFixed(2).padEnd(14)}${fmtMult(avgMult).padEnd(12)}${pct(rtpShare)}`)
}

console.log(`\ntop ${TOP_N} wins overall (base + bonus):`)
if (topWins.length === 0) {
  console.log('  (none observed)')
} else {
  topWins.forEach((w, idx) => {
    console.log(`  ${(idx + 1).toString().padStart(2)}. round ${w.round.toLocaleString().padStart(10)}  ${w.type.padEnd(5)}  payout ${w.payout.toFixed(2).padStart(12)}  (${fmtMult(w.mult)})  rows ${w.rows}`)
  })
}
