#!/usr/bin/env bun
// Monte Carlo RTP simulation for Spiñata Slots — simulates normal spins and
// bought bonuses (feature: 'buyBonus') as separate runs so both modes can be
// tuned to the same target RTP.
//
// Run: bun scripts/spinata-rtp.ts
//
// Constants are imported from the engine so the sim can never drift from
// production behaviour. Uses Math.random() for speed (the engine uses
// crypto.getRandomValues, statistically equivalent for simulation purposes).

import {
  SPN_COLS, SPN_ROWS, SPN_LINES, SPN_FREE_SPINS, SPN_SCATTER_TRIGGER,
  SPN_TRACK_CAP, SPN_TRACK_START, SPN_BONUS_TRIGGER, SPN_MAX_WIN_MULT,
  SPN_BUY_BONUS_COST, PAY_KEYS, SYMBOL_WEIGHTS, PAYTABLE,
  PINATA_POT_PRIZES, PINATA_POT_WEIGHTS, SCATTER_PAY, BONUS_PAY, PAYLINES
} from '../shared/utils/gamelogic/spinata'
import type { SpinPaySymbol, SpinSymbol } from '../shared/utils/gamelogic/spinata'

const NORMAL_SPINS = Number(process.env.SPINS ?? 5_000_000)
const BUY_SPINS = Number(process.env.BUYS ?? 500_000)
const BET = 100

// ── RNG helpers ───────────────────────────────────────────────────────────────

const SYM_KEYS = Object.keys(SYMBOL_WEIGHTS) as SpinSymbol[]
const SYM_W = SYM_KEYS.map(k => SYMBOL_WEIGHTS[k])
const SYM_TOT = SYM_W.reduce((a, b) => a + b, 0)

const NS_KEYS = SYM_KEYS.filter(k => k !== 'scatter')
const NS_W = NS_KEYS.map(k => SYMBOL_WEIGHTS[k])
const NS_TOT = NS_W.reduce((a, b) => a + b, 0)

function drawCell(noScatter: boolean): SpinSymbol {
  const keys = noScatter ? NS_KEYS : SYM_KEYS
  const w = noScatter ? NS_W : SYM_W
  const tot = noScatter ? NS_TOT : SYM_TOT
  let r = Math.random() * tot
  for (let i = 0; i < keys.length; i++) {
    r -= w[i]!
    if (r < 0) return keys[i]!
  }
  return keys[keys.length - 1]!
}

function fullDrop(noScatter: boolean): SpinSymbol[][] {
  return Array.from({ length: SPN_COLS }, () =>
    Array.from({ length: SPN_ROWS }, () => drawCell(noScatter))
  )
}

// Mirrors forceScatters in the engine: overwrite SPN_SCATTER_TRIGGER distinct
// random cells with scatters (natural scatters elsewhere survive).
function forceScatters(grid: SpinSymbol[][]) {
  const placed = new Set<string>()
  while (placed.size < SPN_SCATTER_TRIGGER) {
    const col = Math.floor(Math.random() * SPN_COLS)
    const row = Math.floor(Math.random() * SPN_ROWS)
    const key = `${col}:${row}`
    if (!placed.has(key)) {
      placed.add(key)
      grid[col]![row] = 'scatter'
    }
  }
}

// ── Win evaluation ────────────────────────────────────────────────────────────

const PAY_AND_WILD = [...PAY_KEYS, 'wild'] as (SpinPaySymbol | 'wild')[]

// Returns total × LINE_BET multiplier across all paylines (before bet scaling)
function evalGrid(grid: SpinSymbol[][]): number {
  let total = 0
  for (let li = 0; li < PAYLINES.length; li++) {
    const line = PAYLINES[li]!
    let best = 0
    for (const sym of PAY_AND_WILD) {
      let count = 0
      for (let reel = 0; reel < SPN_COLS; reel++) {
        const cell = grid[reel]![line[reel]!]!
        if (cell === sym || (sym !== 'wild' && cell === 'wild')) count++
        else break
      }
      if (count >= 3) {
        const pay = PAYTABLE[sym][Math.min(count - 3, 2)]!
        if (pay > best) best = pay
      }
    }
    total += best
  }
  return total
}

function countSym(grid: SpinSymbol[][], sym: SpinSymbol): number {
  let n = 0
  for (let c = 0; c < SPN_COLS; c++)
    for (let r = 0; r < SPN_ROWS; r++)
      if (grid[c]![r] === sym) n++
  return n
}

// ── Free spins ────────────────────────────────────────────────────────────────

const PINATA_W_TOT = PINATA_POT_WEIGHTS.reduce((a, b) => a + b, 0)

function drawPinataPrize(): number {
  let r = Math.random() * PINATA_W_TOT
  for (let i = 0; i < PINATA_POT_PRIZES.length; i++) {
    r -= PINATA_POT_WEIGHTS[i]!
    if (r < 0) return PINATA_POT_PRIZES[i]!
  }
  return PINATA_POT_PRIZES[PINATA_POT_PRIZES.length - 1]!
}

function simFreeSpins(bet: number): [linePayout: number, pinataPot: number] {
  const lineBet = bet / SPN_LINES
  let linePayout = 0
  let pinataPot = 0
  let track = SPN_TRACK_START
  for (let i = 0; i < SPN_FREE_SPINS; i++) {
    const grid = fullDrop(true)
    const wilds = countSym(grid, 'wild')
    track = Math.min(track + wilds, SPN_TRACK_CAP)
    linePayout += evalGrid(grid) * lineBet * track
    const bonusN = countSym(grid, 'bonus')
    for (let b = 0; b < bonusN; b++) pinataPot += drawPinataPrize() * bet
  }
  return [linePayout, pinataPot]
}

// ── Simulation ────────────────────────────────────────────────────────────────

interface ModeStats {
  mode: string
  spins: number
  costPerSpin: number
  totalCost: number
  totalPayout: number
  wins: number
  baseSum: number
  scatterPaySum: number
  fsLineSum: number
  pinataPotSum: number
  bonusPaySum: number
  fsTriggers: number
  bonusTriggers: number
  maxWinMult: number
  bucketHits: number[]
}

// Win distribution buckets, as a multiple of the mode's cost per spin
const BUCKETS = [0, 0.5, 1, 2, 5, 10, 50, 100, Infinity]
const BUCKET_LABELS = ['0×', '<0.5×', '0.5-1×', '1-2×', '2-5×', '5-10×', '10-50×', '50-100×', '100×+']

function simulate(mode: 'normal' | 'buy', spins: number): ModeStats {
  const costPerSpin = mode === 'buy' ? BET * SPN_BUY_BONUS_COST : BET
  const s: ModeStats = {
    mode, spins, costPerSpin,
    totalCost: 0, totalPayout: 0, wins: 0,
    baseSum: 0, scatterPaySum: 0, fsLineSum: 0, pinataPotSum: 0, bonusPaySum: 0,
    fsTriggers: 0, bonusTriggers: 0, maxWinMult: 0,
    bucketHits: new Array(BUCKETS.length - 1).fill(0)
  }
  const lineBet = BET / SPN_LINES

  for (let i = 0; i < spins; i++) {
    s.totalCost += costPerSpin
    const grid = fullDrop(false)
    if (mode === 'buy') forceScatters(grid)

    const linePay = evalGrid(grid) * lineBet
    const scatN = countSym(grid, 'scatter')
    const bonusN = countSym(grid, 'bonus')
    const scatPay = (SCATTER_PAY[Math.min(scatN, 5)] ?? 0) * BET

    let spin = linePay + scatPay
    s.baseSum += linePay
    s.scatterPaySum += scatPay

    if (scatN >= SPN_SCATTER_TRIGGER) {
      s.fsTriggers++
      const [fl, pp] = simFreeSpins(BET)
      spin += fl + pp
      s.fsLineSum += fl
      s.pinataPotSum += pp
    }

    if (bonusN >= SPN_BONUS_TRIGGER) {
      s.bonusTriggers++
      const bp = (BONUS_PAY[Math.min(bonusN, 5)] ?? 0) * BET
      spin += bp
      s.bonusPaySum += bp
    }

    spin = Math.min(spin, BET * SPN_MAX_WIN_MULT)
    s.totalPayout += spin
    if (spin > 0) s.wins++

    const mult = spin / BET
    if (mult > s.maxWinMult) s.maxWinMult = mult

    const costMult = spin / costPerSpin
    for (let b = 0; b < BUCKETS.length - 1; b++) {
      if (costMult >= BUCKETS[b]! && costMult < BUCKETS[b + 1]!) {
        s.bucketHits[b]!++
        break
      }
    }
  }
  return s
}

// ── Report ────────────────────────────────────────────────────────────────────

function pct(part: number, total: number): string {
  return (part / total * 100).toFixed(2) + '%'
}

function report(s: ModeStats, elapsed: string) {
  const title = s.mode === 'buy'
    ? `BUY BONUS (${SPN_BUY_BONUS_COST}× bet per buy)`
    : 'NORMAL SPINS'
  console.log(`\n┌─ ${title} ${'─'.repeat(Math.max(1, 51 - title.length))}┐`)
  console.log(`│  Spins:           ${s.spins.toLocaleString()}  (${elapsed}s)`)
  console.log(`│  Bet per spin:    ${BET}${s.mode === 'buy' ? `  (cost ${s.costPerSpin.toLocaleString()})` : ''}`)
  console.log(`│  Total wagered:   ${s.totalCost.toLocaleString()}`)
  console.log(`│  Total paid out:  ${Math.round(s.totalPayout).toLocaleString()}`)
  console.log(`├─ Overall ────────────────────────────────────────────┤`)
  console.log(`│  RTP:             ${pct(s.totalPayout, s.totalCost)}`)
  console.log(`│  Hit rate:        ${pct(s.wins, s.spins)}  (spins with any win)`)
  console.log(`│  Max win:         ${Math.round(s.maxWinMult).toLocaleString()}× bet`)
  console.log(`├─ Contribution breakdown (of wagered) ────────────────┤`)
  console.log(`│  Base line wins:  ${pct(s.baseSum, s.totalCost)}`)
  console.log(`│  Scatter pays:    ${pct(s.scatterPaySum, s.totalCost)}`)
  console.log(`│  FS line wins:    ${pct(s.fsLineSum, s.totalCost)}`)
  console.log(`│  Piñata pot:      ${pct(s.pinataPotSum, s.totalCost)}`)
  console.log(`│  Bonus prize:     ${pct(s.bonusPaySum, s.totalCost)}`)
  console.log(`├─ Feature frequency ──────────────────────────────────┤`)
  if (s.mode === 'normal') {
    console.log(`│  Free spins:      1 in ${(s.spins / s.fsTriggers).toFixed(0)} spins  (${s.fsTriggers.toLocaleString()} triggers)`)
  } else {
    console.log(`│  Free spins:      every buy  (${s.fsTriggers.toLocaleString()} triggers)`)
  }
  console.log(`│  Bonus prize:     1 in ${(s.spins / s.bonusTriggers).toFixed(0)} spins  (${s.bonusTriggers.toLocaleString()} triggers)`)
  console.log(`│  Avg FS lines:    ${(s.fsLineSum / s.fsTriggers / BET).toFixed(1)}× bet`)
  console.log(`│  Avg piñata pot:  ${(s.pinataPotSum / s.fsTriggers / BET).toFixed(1)}× bet  (per FS trigger)`)
  if (s.bonusTriggers > 0) {
    console.log(`│  Avg bonus win:   ${(s.bonusPaySum / s.bonusTriggers / BET).toFixed(1)}× bet`)
  }
  console.log(`├─ Win distribution (× cost, % of spins) ──────────────┤`)
  for (let b = 0; b < s.bucketHits.length; b++) {
    const p = (s.bucketHits[b]! / s.spins * 100).toFixed(2)
    const bar = '█'.repeat(Math.round(s.bucketHits[b]! / s.spins * 50))
    console.log(`│  ${BUCKET_LABELS[b]!.padEnd(9)} ${p.padStart(6)}%  ${bar}`)
  }
  console.log(`└──────────────────────────────────────────────────────┘`)
}

console.log(`\n╔══════════════════════════════════════════════════════╗`)
console.log(`║        Spiñata Slots — RTP Simulation Results        ║`)
console.log(`╚══════════════════════════════════════════════════════╝`)

let t = Date.now()
const normal = simulate('normal', NORMAL_SPINS)
report(normal, ((Date.now() - t) / 1000).toFixed(1))

t = Date.now()
const buy = simulate('buy', BUY_SPINS)
report(buy, ((Date.now() - t) / 1000).toFixed(1))

console.log()
