// scripts/bos-fast-rtp.ts
//
// Fast Monte-Carlo harness for Book of Shadows tuning. Uses the REAL game
// logic (imported below) but swaps crypto.getRandomValues for a fast seeded
// xorshift PRNG so we can run many millions of rounds while iterating on the
// paytable / tier tuning. NOT for production — the game itself still uses
// crypto in prod. Run: node_modules/.bin/tsx scripts/bos-fast-rtp.ts [rounds] [buyBonus]

// ---- fast entropy source: Math.random (good quality, fast, non-reproducible) --
Object.defineProperty(globalThis.crypto, 'getRandomValues', {
  configurable: true,
  writable: true,
  value: (arr: any) => {
    for (let i = 0; i < arr.length; i++) arr[i] = (Math.random() * 0x1_0000_0000) >>> 0
    return arr
  }
})

const { playBookOfShadows, BOS_MAX_WIN_MULT, BOS_BUY_BONUS_COST } = await import('../shared/utils/gamelogic/bookofshadows')

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
let hits5kTo10k = 0
let hitsOver10k = 0
let maxObserved = 0
let bonusOrdinarySum = 0
let bonusWildBaselineSum = 0
let bonusWildPayoutSum = 0
let retriggers = 0

const maxWin = bet * BOS_MAX_WIN_MULT
const buckets = [0, 0.5, 1, 2, 5, 10, 50, 100, 500, 1000, 5000, 10000, Infinity]
const bucketCounts = new Array(buckets.length).fill(0)

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
    bonusOrdinarySum += r.bonus.ordinaryPayout
    bonusWildBaselineSum += r.bonus.wildBaseline
    bonusWildPayoutSum += r.bonus.wildPayout
    if (r.bonus.retriggered) retriggers++
  } else {
    basePayoutSum += roundPayout
  }

  totalPayout += roundPayout
  if (roundPayout >= maxWin) capHits++
  if (roundPayout > cost) wins++
  const m = roundPayout / bet
  if (m > maxObserved) maxObserved = m
  if (m >= 5000 && m < 10000) hits5kTo10k++
  if (m >= 10000) hitsOver10k++

  for (let b = 0; b < buckets.length; b++) {
    if (m <= buckets[b]!) { bucketCounts[b]++; break }
  }
}

const pct = (n: number) => (100 * n).toFixed(4) + '%'
console.log(`rounds:             ${rounds.toLocaleString()}${buyBonus ? '  (buy-bonus mode)' : ''}`)
console.log(`total RTP:          ${pct(totalPayout / totalCost)}`)
console.log(`  base RTP:         ${pct(basePayoutSum / totalCost)}  (${pct(basePayoutSum / totalPayout)} of payout)`)
console.log(`  bonus RTP:        ${pct(bonusPayoutSum / totalCost)}  (${pct(bonusPayoutSum / totalPayout)} of payout)`)
console.log(`bonus trigger:      ${pct(bonusTriggers / rounds)}  (1 in ${bonusTriggers ? (rounds / bonusTriggers).toFixed(0) : '—'})`)
console.log(`hit freq (>cost):   ${pct(wins / rounds)}`)
console.log(`max-win cap hits:   ${capHits}  (1 in ${capHits ? (rounds / capHits).toFixed(0) : '—'})`)
console.log(`5000x–10000x hits:  ${hits5kTo10k}  (1 in ${hits5kTo10k ? (rounds / hits5kTo10k).toFixed(0) : '—'})`)
console.log(`>10000x hits:       ${hitsOver10k}  (1 in ${hitsOver10k ? (rounds / hitsOver10k).toFixed(0) : '—'})`)
console.log(`max observed:       ${maxObserved.toFixed(1)}x`)
if (bonusTriggers) {
  console.log(`\navg columns locked at bonus end: ${(lockedColumnsSum / bonusTriggers).toFixed(2)} / 5`)
  console.log(`full clears (all 5 cols):        ${fullClears}  (${pct(fullClears / bonusTriggers)} of bonuses, 1 in ${(bonusTriggers / fullClears).toFixed(1)})`)
  console.log(`book retriggers (+spins):        ${retriggers}  (${pct(retriggers / bonusTriggers)} of bonuses)`)
  console.log(`avg bonus round payout:          ${(bonusPayoutSum / bonusTriggers).toFixed(2)}x bet`)
  console.log(`  avg ordinary portion:          ${(bonusOrdinarySum / bonusTriggers).toFixed(2)}x`)
  console.log(`  avg wild baseline (pre-tier):  ${(bonusWildBaselineSum / bonusTriggers).toFixed(2)}x`)
  console.log(`  avg wild payout (post-tier):   ${(bonusWildPayoutSum / bonusTriggers).toFixed(2)}x`)
  console.log(`  implied avg tier mult:         ${(bonusWildPayoutSum / bonusWildBaselineSum).toFixed(3)}`)
  console.log(`bonus RTP contribution split → ordinary: ${pct(bonusOrdinarySum / totalCost)}, wild: ${pct(bonusWildPayoutSum / totalCost)}`)
}
console.log(`\ncurrent BOS_BUY_BONUS_COST: ${BOS_BUY_BONUS_COST}x bet`)
console.log('\npayout distribution (× bet):')
for (let b = 0; b < buckets.length; b++) {
  const lo = b === 0 ? 0 : buckets[b - 1]!
  const hi = buckets[b]!
  const label = hi === Infinity ? `>${lo}` : `${lo}–${hi}`
  console.log(`  ${label.padEnd(12)} ${pct(bucketCounts[b] / rounds)}`)
}
