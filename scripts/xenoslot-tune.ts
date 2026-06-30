// scripts/xenoslot-tune.ts
//
// Parameter sweep for the Xeno Slot bonus. Reimplements the bonus feature with
// tunable P_COIN / P_COLLECTOR / P_GLOVER so we can search for a combo that hits
// the target RTP while making collectors rarer.
//
// The base game is untouched, so we only need to match the BONUS rtp target:
//   target bonus RTP = target total RTP - base RTP(~34.3%)
//
// Run:  bun scripts/xenoslot-tune.ts
//
// After picking a winner, set the constants in xenoslot.ts and confirm with
// scripts/xenoslot-rtp.ts against the real module.

const COLS = 5
const ROWS = 3
const CELLS = COLS * ROWS
const FREE_SPINS = 10
const TRIGGER = 3

// base-grid bonus probability per cell (weight 5 of total 150)
const P_BONUS_CELL = 5 / 150

const COIN_VALUES = [0.2, 0.5, 1, 2, 5, 10, 25, 50]
const COIN_WEIGHTS = [0.34, 0.26, 0.18, 0.1, 0.06, 0.035, 0.02, 0.005]
const GLOVER_MULTS = [2, 5, 10]
const GLOVER_WEIGHTS = [0.7, 0.24, 0.06]

function rand() { return Math.random() }

function weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rand() * total
  for (let i = 0; i < items.length; i++) { r -= weights[i]!; if (r < 0) return items[i]! }
  return items[items.length - 1]!
}
const pickCoin = () => weightedPick(COIN_VALUES, COIN_WEIGHTS)
const pickGlover = () => weightedPick(GLOVER_MULTS, GLOVER_WEIGHTS)

const idx = (c: number, r: number) => c * ROWS + r
function neighborIdx(i: number): number[] {
  const col = Math.floor(i / ROWS); const row = i % ROWS
  const out: number[] = []
  for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
    if (dc === 0 && dr === 0) continue
    const c = col + dc; const r = row + dr
    if (c >= 0 && c < COLS && r >= 0 && r < ROWS) out.push(idx(c, r))
  }
  return out
}

interface Params { coin: number, collector: number, glover: number, coinScale?: number, coinWeights?: number[] }

function pickCoinW(p: Params): number {
  return p.coinWeights ? weightedPick(COIN_VALUES, p.coinWeights) : pickCoin()
}

// returns { payout (× bet), collectorsLanded, spinsWithCollector }
function runBonus(seedCount: number, p: Params) {
  const scale = p.coinScale ?? 1
  const board = new Array<number>(CELLS).fill(-1) // -1 = empty, else coin value
  for (let s = 0; s < seedCount; s++) board[s] = pickCoinW(p) * scale // seed cells (positions irrelevant for payout)

  let collected = 0
  let collectorsLanded = 0
  let spinsWithCollector = 0

  for (let round = 1; round <= FREE_SPINS; round++) {
    const free: number[] = []
    for (let i = 0; i < CELLS; i++) if (board[i] === -1) free.push(i)

    const collectorCells: number[] = []
    const gloverCells: number[] = []
    for (const i of free) {
      const r = rand()
      if (r < p.coin) board[i] = pickCoinW(p) * scale
      else if (r < p.coin + p.collector) collectorCells.push(i)
      else if (r < p.coin + p.collector + p.glover) gloverCells.push(i)
    }

    for (const g of gloverCells) {
      const mult = pickGlover()
      for (const n of neighborIdx(g)) if (board[n] > 0) board[n] = board[n]! * mult
    }

    if (collectorCells.length) {
      let sum = 0
      for (let i = 0; i < CELLS; i++) if (board[i]! > 0) sum += board[i]!
      collected += sum * collectorCells.length
      collectorsLanded += collectorCells.length
      spinsWithCollector++
      board.fill(-1)
    }
  }
  return { payout: collected, collectorsLanded, spinsWithCollector }
}

// sample a trigger's seed count (number of bonus cells given >= TRIGGER)
function sampleSeedCount(): number {
  for (;;) {
    let n = 0
    for (let i = 0; i < CELLS; i++) if (rand() < P_BONUS_CELL) n++
    if (n >= TRIGGER) return Math.min(n, CELLS)
  }
}

const TRIGGER_RATE = (() => {
  // P(>=3 bonus cells in 15) — measure empirically
  let hits = 0; const N = 5_000_000
  for (let t = 0; t < N; t++) {
    let n = 0
    for (let i = 0; i < CELLS; i++) if (rand() < P_BONUS_CELL) n++
    if (n >= TRIGGER) hits++
  }
  return hits / N
})()

function evalParams(p: Params, triggers = 400_000) {
  let payoutSum = 0
  let collectors = 0
  let spinsWithColl = 0
  for (let t = 0; t < triggers; t++) {
    const seed = sampleSeedCount()
    const res = runBonus(seed, p)
    payoutSum += res.payout
    collectors += res.collectorsLanded
    spinsWithColl += res.spinsWithCollector
  }
  const ePayout = payoutSum / triggers
  const bonusRTP = TRIGGER_RATE * ePayout
  return {
    bonusRTP,
    ePayout,
    collectorsPerBonus: collectors / triggers,
    spinsWithCollPerBonus: spinsWithColl / triggers, // out of 10 spins
  }
}

const BASE_RTP = 0.343 // measured from real module
const TARGET_TOTAL = 0.98
const TARGET_BONUS = TARGET_TOTAL - BASE_RTP

console.log(`trigger rate: ${(100 * TRIGGER_RATE).toFixed(4)}%   target bonus RTP: ${(100 * TARGET_BONUS).toFixed(3)}%\n`)
console.log('coin   coll   glov  scale | bonusRTP  E[pay]  coll/bonus  spins_w_coll/10')

const candidates: Params[] = []
candidates.push({ coin: 0.12, collector: 0.055, glover: 0.011 }) // baseline sanity-check vs real module (~63.6%)
// Candidate coin-weight sets (same face values, heavier toward bigger coins to
// recover the RTP lost by making collectors rarer). E[coin] noted per set.
const WS_A = [0.33, 0.25, 0.17, 0.10, 0.06, 0.04, 0.035, 0.015]  // E≈2.89
const WS_B = [0.31, 0.25, 0.17, 0.105, 0.065, 0.045, 0.035, 0.015] // E≈2.99
const WS_C = [0.34, 0.25, 0.16, 0.10, 0.06, 0.04, 0.035, 0.015]   // E≈2.85
for (const [name, ws] of [['A', WS_A], ['B', WS_B], ['C', WS_C]] as const) {
  const e = COIN_VALUES.reduce((a, v, i) => a + v * ws[i]!, 0) / ws.reduce((a, b) => a + b, 0)
  console.error(`WS_${name} sum=${ws.reduce((a, b) => a + b, 0).toFixed(3)} E[coin]=${e.toFixed(3)}`)
  candidates.push({ coin: 0.20, collector: 0.028, glover: 0.011, coinWeights: ws })
  candidates.push({ coin: 0.20, collector: 0.030, glover: 0.011, coinWeights: ws })
}

for (const p of candidates) {
  const m = evalParams(p)
  const flag = Math.abs(m.bonusRTP - TARGET_BONUS) < 0.01 ? '  <== near target' : ''
  console.log(
    `${p.coin.toFixed(2)}   ${p.collector.toFixed(3)} ${p.glover.toFixed(3)} ${(p.coinScale ?? 1).toFixed(2)} | `
    + `${(100 * m.bonusRTP).toFixed(2)}%  ${m.ePayout.toFixed(1)}  ${m.collectorsPerBonus.toFixed(2)}       ${m.spinsWithCollPerBonus.toFixed(2)}${flag}`,
  )
}
