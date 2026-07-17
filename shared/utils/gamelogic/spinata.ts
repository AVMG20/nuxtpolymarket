// shared/utils/gamelogic/spinata.ts
//
// "Spiñata Slots" — 5×3 traditional reel slot, 50 fixed paylines, left-to-right wins.
//
// ── Base game ────────────────────────────────────────────────────────────────
//   Grid is 5 columns × 3 rows. Each cell is an independent weighted draw.
//   Wins pay left-to-right on 50 fixed paylines: 3, 4 or 5 matching symbols
//   starting from reel 0. WILD substitutes for all pay symbols (not scatter/bonus).
//   Payout = paytable[symbol][count] × lineBet, where lineBet = bet / SPN_LINES.
//
// ── BONUS symbol ─────────────────────────────────────────────────────────────
//   3+ BONUS (piñata) symbols anywhere on the grid trigger an immediate prize:
//   3=5×bet, 4=15×bet, 5=50×bet. Independent of scatter free spins.
//
// ── Free Spins bonus ────────────────────────────────────────────────────────
//   3+ SCATTER anywhere on the initial grid triggers SPN_FREE_SPINS free spins.
//   A Piñata Multiplier Track persists across all free spins: it starts at
//   SPN_TRACK_START and every WILD that lands advances it by 1, capped at
//   SPN_TRACK_CAP. All line wins are multiplied by the current track level.
//   Every BONUS symbol that lands during a free spin adds a weighted random
//   prize (PINATA_POT_PRIZES × bet) to the piñata pot, paid out with the bonus.
//   Buying the bonus (feature: 'buyBonus') costs SPN_BUY_BONUS_COST × bet and
//   forces SPN_SCATTER_TRIGGER scatters onto an otherwise normal spin.
//
// ── Fairness ────────────────────────────────────────────────────────────────
//   Total win is capped at SPN_MAX_WIN_MULT × bet.

import { randomFloat } from '../random'

export const SPN_COLS = 5
export const SPN_ROWS = 3
export const SPN_LINES = 50

export const SPN_FREE_SPINS = 12
export const SPN_SCATTER_TRIGGER = 3

export const SPN_TRACK_CAP = 20
export const SPN_TRACK_START = 1

export const SPN_BONUS_TRIGGER = 3
export const SPN_MAX_WIN_MULT = 5000
export const SPN_BUY_BONUS_COST = 52 // × bet: skip straight to free spins

export type SpinPaySymbol
  = 'ten' | 'jack' | 'queen' | 'king' | 'ace'
    | 'maracas' | 'cactus' | 'sombrero' | 'flower'

export type SpinSymbol = SpinPaySymbol | 'wild' | 'scatter' | 'bonus'

export const PAY_KEYS: SpinPaySymbol[] = [
  'ten', 'jack', 'queen', 'king', 'ace',
  'maracas', 'cactus', 'sombrero', 'flower'
]

const DEBUG_BONUS = false // set true to boost scatter/bonus for testing

export const SYMBOL_WEIGHTS: Record<SpinSymbol, number> = DEBUG_BONUS
  ? {
      ten: 5, jack: 5, queen: 5, king: 5, ace: 5,
      maracas: 5, cactus: 5, sombrero: 5, flower: 5,
      wild: 10, scatter: 30, bonus: 30
    }
  : {
      ten: 33, jack: 30, queen: 26, king: 22, ace: 18,
      maracas: 13, cactus: 9, sombrero: 6, flower: 4,
      wild: 3, scatter: 3.8, bonus: 4
    }

// Paytable: [3-of-a-kind, 4-of-a-kind, 5-of-a-kind] × LINE BET
// lineBet = totalBet / SPN_LINES
// Tuned for ~98% RTP on both normal spins and bonus buys (scripts/spinata-rtp.ts).
export const PAYTABLE: Record<SpinPaySymbol | 'wild', [number, number, number]> = {
  ten: [8, 42, 165],
  jack: [8, 42, 165],
  queen: [14, 65, 245],
  king: [17, 81, 321],
  ace: [25, 120, 476],
  maracas: [32, 156, 624],
  cactus: [46, 229, 915],
  sombrero: [76, 377, 1508],
  flower: [142, 645, 3010],
  wild: [442, 2210, 7350]
}

// Piñata pot prizes — awarded per bonus symbol that lands during free spins.
// Weighted random: [2, 3, 5, 8, 12]× bet with weights [45, 30, 15, 7, 3].
// Avg ~3.5× per piñata → ~15× bet per triggered FS → contributes ~6% RTP at
// the 1-in-250 free-spin trigger rate.
export const PINATA_POT_PRIZES = [2, 3, 5, 8, 12] // × bet
export const PINATA_POT_WEIGHTS = [45, 30, 15, 7, 3]

// Scatter pays × total bet (anywhere, independent of lines)
export const SCATTER_PAY: Record<number, number> = { 3: 2, 4: 10, 5: 50 }

// Bonus symbol immediate prize × total bet
export const BONUS_PAY: Record<number, number> = { 3: 5, 4: 15, 5: 50 }

// 50 paylines — [row for reel0 .. reel4], rows: 0=top, 1=middle, 2=bottom
export const PAYLINES: number[][] = [
  // Straight (3)
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2],
  // V / inverted-V (2)
  [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  // Diagonals (4)
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [0, 1, 2, 2, 2], [2, 1, 0, 0, 0],
  // Steps (8)
  [0, 1, 1, 1, 2], [2, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1],
  [0, 0, 1, 1, 2], [2, 2, 1, 1, 0], [1, 1, 0, 0, 1], [1, 1, 2, 2, 1],
  // Zigzags (8)
  [0, 1, 0, 1, 0], [2, 1, 2, 1, 2], [1, 0, 1, 0, 1], [1, 2, 1, 2, 1],
  [0, 1, 0, 0, 1], [2, 1, 2, 2, 1], [1, 0, 0, 1, 2], [1, 2, 2, 1, 0],
  // Mixed mid (8)
  [0, 0, 0, 1, 2], [2, 2, 2, 1, 0], [0, 1, 1, 2, 1], [2, 1, 1, 0, 1],
  [1, 1, 2, 1, 0], [1, 1, 0, 1, 2], [0, 0, 1, 0, 1], [2, 2, 1, 2, 1],
  // Flat-end (8)
  [0, 1, 1, 0, 0], [2, 1, 1, 2, 2], [1, 0, 1, 1, 0], [1, 2, 1, 1, 2],
  [0, 0, 0, 0, 1], [2, 2, 2, 2, 1], [1, 0, 0, 0, 0], [1, 2, 2, 2, 2],
  // Near-flat (8)
  [0, 0, 0, 1, 1], [2, 2, 2, 1, 1], [1, 1, 1, 0, 0], [1, 1, 1, 2, 2],
  [0, 1, 0, 2, 1], [2, 1, 2, 0, 1], [1, 0, 1, 2, 1], [1, 2, 1, 0, 1],
  // Final 4
  [0, 1, 2, 0, 1], [2, 1, 0, 2, 1], [0, 0, 1, 2, 1], [2, 2, 1, 0, 1]
]

// --- RNG ─────────────────────────────────────────────────────────────────────


function weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = randomFloat() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!
    if (r < 0) return items[i]!
  }
  return items[items.length - 1]!
}

const SYM_KEYS = Object.keys(SYMBOL_WEIGHTS) as SpinSymbol[]
const SYM_WEIGHTS_ARR = SYM_KEYS.map(k => SYMBOL_WEIGHTS[k])
const NO_SCATTER_KEYS = SYM_KEYS.filter(k => k !== 'scatter')
const NO_SCATTER_WEIGHTS = NO_SCATTER_KEYS.map(k => SYMBOL_WEIGHTS[k])

function drawCell(noScatter = false): SpinSymbol {
  if (noScatter) return weightedPick(NO_SCATTER_KEYS, NO_SCATTER_WEIGHTS)
  return weightedPick(SYM_KEYS, SYM_WEIGHTS_ARR)
}

function fullDrop(noScatter = false): SpinSymbol[][] {
  return Array.from({ length: SPN_COLS }, () =>
    Array.from({ length: SPN_ROWS }, () => drawCell(noScatter))
  )
}

// --- Win evaluation ──────────────────────────────────────────────────────────

export interface Cell { col: number, row: number }

export interface LineWin {
  line: number
  symbol: SpinPaySymbol | 'wild'
  count: number
  pay: number // × line bet
  cells: Cell[]
}

const PAY_AND_WILD: (SpinPaySymbol | 'wild')[] = [...PAY_KEYS, 'wild']

function evalGrid(grid: SpinSymbol[][]): LineWin[] {
  const wins: LineWin[] = []

  for (let li = 0; li < PAYLINES.length; li++) {
    const line = PAYLINES[li]!
    let best: LineWin | null = null

    for (const sym of PAY_AND_WILD) {
      let count = 0
      const cells: Cell[] = []

      for (let reel = 0; reel < SPN_COLS; reel++) {
        const cell = grid[reel]![line[reel]!]!
        if (cell === sym || (sym !== 'wild' && cell === 'wild')) {
          count++
          cells.push({ col: reel, row: line[reel]! })
        } else {
          break
        }
      }

      if (count >= 3) {
        const entry = PAYTABLE[sym]
        const pay = entry[Math.min(count - 3, 2)]!
        if (!best || pay > best.pay) {
          best = { line: li, symbol: sym, count, pay, cells }
        }
      }
    }

    if (best) wins.push(best)
  }

  return wins
}

function findSpecialCells(grid: SpinSymbol[][], sym: SpinSymbol): Cell[] {
  const cells: Cell[] = []
  for (let col = 0; col < SPN_COLS; col++) {
    for (let row = 0; row < SPN_ROWS; row++) {
      if (grid[col]![row] === sym) cells.push({ col, row })
    }
  }
  return cells
}

function countSymbol(grid: SpinSymbol[][], sym: SpinSymbol): number {
  let n = 0
  for (let col = 0; col < SPN_COLS; col++) {
    for (let row = 0; row < SPN_ROWS; row++) {
      if (grid[col]![row] === sym) n++
    }
  }
  return n
}

function calcLinePayout(lines: LineWin[], bet: number, mult = 1): number {
  const lineBet = bet / SPN_LINES
  let total = 0
  for (const w of lines) total += w.pay * lineBet * mult
  return total
}

// --- Free spins with track ───────────────────────────────────────────────────

export interface SpinataFreeSpin {
  round: number
  grid: SpinSymbol[][]
  lines: LineWin[]
  wildCount: number
  trackBefore: number
  trackAfter: number
  spinPayout: number
  pinataPrizes: number[] // prize (× bet) for each bonus symbol that landed
}

function runFreeSpins(bet: number): SpinataFreeSpin[] {
  const spins: SpinataFreeSpin[] = []
  let trackLevel = SPN_TRACK_START

  for (let round = 1; round <= SPN_FREE_SPINS; round++) {
    const grid = fullDrop(true)
    const lines = evalGrid(grid)
    const wildCount = countSymbol(grid, 'wild')
    const trackBefore = trackLevel
    trackLevel = Math.min(trackLevel + wildCount, SPN_TRACK_CAP)
    const spinPayout = calcLinePayout(lines, bet, trackLevel)
    const bonusCount = countSymbol(grid, 'bonus')
    const pinataPrizes = Array.from({ length: bonusCount }, () =>
      weightedPick(PINATA_POT_PRIZES, PINATA_POT_WEIGHTS)
    )
    spins.push({ round, grid, lines, wildCount, trackBefore, trackAfter: trackLevel, spinPayout, pinataPrizes })
  }

  return spins
}

// --- Result shape ────────────────────────────────────────────────────────────

export interface SpinataResult {
  bet: number
  cost: number
  grid: SpinSymbol[][]
  lines: LineWin[]
  scatterCount: number
  scatterCells: Cell[]
  bonusSymbolCount: number
  bonusSymbolCells: Cell[]
  basePayout: number
  freeSpinsTriggered: boolean
  bonusPrizeTriggered: boolean
  freeSpins: SpinataFreeSpin[] | null
  freeSpinsPayout: number
  pinataPotTotal: number
  bonusPrizePayout: number
  bonusPayout: number
  payout: number
  won: boolean
  maxWin: number
  [key: string]: unknown
}

// --- Main entry ──────────────────────────────────────────────────────────────

const round4 = (n: number) => Math.round(n * 10000) / 10000

function forceScatters(grid: SpinSymbol[][]) {
  const placed = new Set<string>()
  while (placed.size < SPN_SCATTER_TRIGGER) {
    const col = Math.floor(randomFloat() * SPN_COLS)
    const row = Math.floor(randomFloat() * SPN_ROWS)
    const key = `${col}:${row}`
    if (!placed.has(key)) {
      placed.add(key)
      grid[col]![row] = 'scatter'
    }
  }
}

export function playSpinata(bet: number, options?: Record<string, unknown>): SpinataResult {
  if (!Number.isFinite(bet) || bet <= 0) {
    throw createError({ statusCode: 400, message: 'Invalid bet amount' })
  }

  const buyBonus = options?.feature === 'buyBonus'
  const cost = buyBonus ? bet * SPN_BUY_BONUS_COST : bet

  const grid = fullDrop()
  if (buyBonus) forceScatters(grid)

  const lines = evalGrid(grid)
  const scatterCells = findSpecialCells(grid, 'scatter')
  const bonusSymbolCells = findSpecialCells(grid, 'bonus')
  const scatterPay = SCATTER_PAY[Math.min(scatterCells.length, 5)] ?? 0
  const basePayout = calcLinePayout(lines, bet) + scatterPay * bet
  const freeSpinsTriggered = scatterCells.length >= SPN_SCATTER_TRIGGER
  const bonusPrizeTriggered = bonusSymbolCells.length >= SPN_BONUS_TRIGGER

  const freeSpins = freeSpinsTriggered ? runFreeSpins(bet) : null
  const freeSpinsPayout = freeSpins?.reduce((s, fs) => s + fs.spinPayout, 0) ?? 0
  const pinataPotTotal = freeSpins?.reduce((s, fs) =>
    s + fs.pinataPrizes.reduce((a, p) => a + p * bet, 0), 0
  ) ?? 0
  const bonusPrizePayout = bonusPrizeTriggered ? (BONUS_PAY[Math.min(bonusSymbolCells.length, 5)] ?? 0) * bet : 0
  const bonusPayout = freeSpinsPayout + pinataPotTotal + bonusPrizePayout

  const maxWin = bet * SPN_MAX_WIN_MULT
  const payout = round4(Math.min(basePayout + bonusPayout, maxWin))

  return {
    bet,
    cost: round4(cost),
    grid,
    lines,
    scatterCount: scatterCells.length,
    scatterCells,
    bonusSymbolCount: bonusSymbolCells.length,
    bonusSymbolCells,
    basePayout: round4(basePayout),
    freeSpinsTriggered,
    bonusPrizeTriggered,
    freeSpins,
    freeSpinsPayout: round4(freeSpinsPayout),
    pinataPotTotal: round4(pinataPotTotal),
    bonusPrizePayout: round4(bonusPrizePayout),
    bonusPayout: round4(bonusPayout),
    payout,
    won: payout > cost,
    maxWin
  }
}
