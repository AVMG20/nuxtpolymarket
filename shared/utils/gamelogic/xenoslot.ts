// shared/utils/gamelogic/xenoslot.ts
//
// "Xeno Slot" — a traditional 5×3 line-pay slot with a Hold & Win bonus.
//
// (Symbols are placeholder fruit/card glyphs for now; the plan is to later swap
// them for plant species from the Xeno game.)
//
// Everything is pre-computed on the server in a single call; the client just
// animates the result (a base reel spin, then — if triggered — the Hold & Win
// collector feature). This mirrors the Magic Hands philosophy: the server is
// authoritative for every random outcome and the payout, the client is pure
// presentation.
//
// ── Base game ────────────────────────────────────────────────────────────────
//   Grid is 5 columns × 3 rows. Each cell is an independent weighted draw.
//   Wins pay left-to-right on 5 fixed paylines: 3+ matching symbols starting
//   from reel 0. WILD substitutes for every symbol except BONUS. Each line
//   pays `paytable[symbol][count] × lineBet`, where `lineBet = bet / LINES`.
//
// ── Bonus (Hold & Win "collector") ───────────────────────────────────────────
//   3+ BONUS symbols anywhere trigger the feature. The bonus board reuses the
//   5×3 grid; the triggering BONUS cells seed it as the first locked coins.
//   The player gets BONUS_FREE_SPINS spins. Each spin, every free cell can land:
//     - a COIN      → sticks to the grid with a value (× bet) and accumulates
//     - a COLLECTOR → harvests the summed value of every coin on the board into
//                     the win, then WIPES THE WHOLE BOARD CLEAN (coins included)
//                     so every cell is free again for the remaining spins
//     - nothing
//
//   IMPORTANT: only money pulled in by a COLLECTOR counts. Coins on their own
//   pay nothing — if no collector ever lands, the bonus pays 0.
//
// ── Fairness ────────────────────────────────────────────────────────────────
//   The total win (base + bonus) is capped at XENOSLOT_MAX_WIN_MULT × bet.
//   Weights and the bonus probabilities below are tuned by Monte-Carlo to ~96%
//   RTP.

export const XENOSLOT_COLS = 5
export const XENOSLOT_ROWS = 3

export const XENOSLOT_MAX_WIN_MULT = 5000 // hard cap on total win, in × bet

// --- base game symbols ------------------------------------------------------

export type SlotSymbol
  = 'ten' | 'jack' | 'queen' | 'king' | 'ace'
    | 'bell' | 'seven' | 'diamond'
    | 'wild' | 'bonus'

// Reel strip weights (same for every reel). Higher = more frequent.
export const SYMBOL_WEIGHTS: Record<SlotSymbol, number> = {
  ten: 30, jack: 28, queen: 24, king: 20, ace: 16,
  bell: 12, seven: 7, diamond: 4,
  wild: 4, bonus: 5
}

// Paytable: payout multiplier of the LINE bet for [3, 4, 5] of a kind.
// BONUS never pays on a line (it only triggers the feature).
export const PAYTABLE: Record<Exclude<SlotSymbol, 'bonus'>, [number, number, number]> = {
  ten: [5, 10, 25],
  jack: [5, 10, 25],
  queen: [8, 15, 40],
  king: [8, 18, 50],
  ace: [12, 25, 60],
  bell: [18, 50, 120],
  seven: [40, 120, 360],
  diamond: [60, 250, 750],
  wild: [120, 600, 2500]
}

// 5 fixed paylines, expressed as the row index per column (left → right).
const PAYLINES: number[][] = [
  [1, 1, 1, 1, 1], // middle
  [0, 0, 0, 0, 0], // top
  [2, 2, 2, 2, 2], // bottom
  [0, 1, 2, 1, 0], // V
  [2, 1, 0, 1, 2] // ^
]
export const XENOSLOT_LINES = PAYLINES.length

export const BONUS_TRIGGER_COUNT = 3 // BONUS symbols needed to start the feature
export const XENOSLOT_CELLS = XENOSLOT_COLS * XENOSLOT_ROWS

// --- bonus feature tuning ---------------------------------------------------

export const BONUS_FREE_SPINS = 10 // fixed number of bonus spins

// Per free cell, per spin: chance to land a coin / a collector / a glover.
// Collectors are deliberately uncommon so harvesting one stays a highlight —
// coins land often and accumulate, then a (rarer) collector sweeps the whole
// board. Coins fill faster (higher P_COIN) to keep each collection rich, which
// offsets the RTP otherwise lost by collecting less often. Tuned to ~98% RTP
// (see scripts/xenoslot-rtp.ts).
const P_COIN = 0.20
const P_COLLECTOR = 0.028
const P_GLOVER = 0.011

// Coin face values (× bet) and their relative weights. Low-skewed, but weighted
// a touch heavier toward the bigger faces so the rarer collectors still pay out.
const COIN_VALUES = [0.2, 0.5, 1, 2, 5, 10, 25, 50] as const
const COIN_WEIGHTS = [0.328, 0.25, 0.17, 0.1, 0.06, 0.042, 0.035, 0.015] as const

// Glover (multiplier) — when one lands it multiplies the value of every coin in
// the 8 neighbouring cells by its multiplier, then vanishes (it never occupies
// a cell). Higher multipliers are rare.
const GLOVER_MULTS = [2, 5, 10] as const
const GLOVER_WEIGHTS = [0.7, 0.24, 0.06] as const

// --- crypto RNG helpers -----------------------------------------------------

function rand(): number {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return arr[0]! / 0x1_0000_0000 // [0, 1)
}

function weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rand() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!
    if (r < 0) return items[i]!
  }
  return items[items.length - 1]!
}

const SYMBOL_KEYS = Object.keys(SYMBOL_WEIGHTS) as SlotSymbol[]
const SYMBOL_WEIGHT_VALUES = SYMBOL_KEYS.map(k => SYMBOL_WEIGHTS[k])

function spinSymbol(): SlotSymbol {
  return weightedPick(SYMBOL_KEYS, SYMBOL_WEIGHT_VALUES)
}

function pickCoinValue(): number {
  return weightedPick(COIN_VALUES, COIN_WEIGHTS)
}

function pickGloverMult(): number {
  return weightedPick(GLOVER_MULTS, GLOVER_WEIGHTS)
}

// The (up to) 8 cells surrounding a cell, clamped to the grid.
function neighbors(c: Cell): Cell[] {
  const out: Cell[] = []
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (dc === 0 && dr === 0) continue
      const col = c.col + dc
      const row = c.row + dr
      if (col >= 0 && col < XENOSLOT_COLS && row >= 0 && row < XENOSLOT_ROWS) out.push({ col, row })
    }
  }
  return out
}

// --- result shapes ----------------------------------------------------------

export interface Cell { col: number, row: number }

export interface LineWin {
  line: number // payline index
  symbol: Exclude<SlotSymbol, 'bonus'>
  count: number // 3, 4 or 5
  cells: Cell[] // winning cells, left → right
  amount: number // currency won on this line
}

export interface BonusCoin {
  cell: Cell
  value: number // × bet
}

export interface BonusCollector {
  cell: Cell
  collected: number // summed coin value harvested (× bet)
}

export interface GloverUpgrade {
  cell: Cell // the neighbouring coin that was boosted
  from: number // value before (× bet)
  to: number // value after (× bet)
}

export interface BonusGlover {
  cell: Cell
  mult: number // 2, 5 or 10
  upgrades: GloverUpgrade[] // neighbour coins it multiplied (empty if none adjacent)
}

export interface BonusWave {
  round: number
  spinning: Cell[] // free cells that spun this wave
  coins: BonusCoin[] // coins that locked this wave
  glovers: BonusGlover[] // glovers that landed this wave (multiply neighbours, then vanish)
  collectors: BonusCollector[] // collectors that landed this wave
  collectedCoins: BonusCoin[] // every coin harvested this wave (flies into the collector)
  collectedAmount: number // currency pulled in this wave (× bet)
  cleared: boolean // true when a collector wiped the board this wave
  hit: boolean // landed at least one coin/collector
  respinsLeft: number // counter after this wave resolved
  boardCoins: BonusCoin[] // snapshot of every locked coin after this wave resolved
}

export interface BonusResult {
  seed: BonusCoin[] // coins seeded from the BONUS trigger
  waves: BonusWave[]
  collectedTotal: number // currency from all collectors (× bet) — the only payout
  bonusPayout: number // currency paid by the feature (pre-cap) === collectedTotal
}

export interface XenoSlotResult {
  bet: number
  lineBet: number
  grid: SlotSymbol[][] // [col][row]
  lines: LineWin[]
  basePayout: number
  bonusTriggered: boolean
  bonusCells: Cell[] // BONUS positions in the base grid
  bonus: BonusResult | null
  payout: number // total currency returned (capped)
  won: boolean // payout > bet
  maxWin: number
  [key: string]: unknown
}

// --- base-grid evaluation ---------------------------------------------------

function generateGrid(): SlotSymbol[][] {
  const grid: SlotSymbol[][] = []
  for (let col = 0; col < XENOSLOT_COLS; col++) {
    const column: SlotSymbol[] = []
    for (let row = 0; row < XENOSLOT_ROWS; row++) column.push(spinSymbol())
    grid.push(column)
  }
  return grid
}

function evaluateLine(grid: SlotSymbol[][], lineIdx: number, lineBet: number): LineWin | null {
  const rows = PAYLINES[lineIdx]!
  const syms = rows.map((row, col) => grid[col]![row]!)

  // The matchable symbol is the first non-wild on the line (BONUS can't match).
  let matchSym: SlotSymbol | null = null
  for (const s of syms) {
    if (s === 'wild') continue
    matchSym = s
    break
  }

  function payFor(sym: Exclude<SlotSymbol, 'bonus'>): LineWin | null {
    let count = 0
    for (const s of syms) {
      if (s === sym || s === 'wild') count++
      else break
    }
    if (count < 3) return null
    const mult = PAYTABLE[sym][count - 3]!
    return {
      line: lineIdx,
      symbol: sym,
      count,
      cells: Array.from({ length: count }, (_, col) => ({ col, row: rows[col]! })),
      amount: mult * lineBet
    }
  }

  const candidates: LineWin[] = []
  // Pure leading wilds pay the wild paytable.
  const wildWin = payFor('wild')
  if (wildWin) candidates.push(wildWin)
  // The first real symbol (with leading wilds counted) pays its own table.
  if (matchSym && matchSym !== 'bonus') {
    const w = payFor(matchSym)
    if (w) candidates.push(w)
  }
  if (!candidates.length) return null
  // Take the highest-paying interpretation of the line.
  return candidates.reduce((best, c) => (c.amount > best.amount ? c : best))
}

function findBonusCells(grid: SlotSymbol[][]): Cell[] {
  const cells: Cell[] = []
  for (let col = 0; col < XENOSLOT_COLS; col++) {
    for (let row = 0; row < XENOSLOT_ROWS; row++) {
      if (grid[col]![row] === 'bonus') cells.push({ col, row })
    }
  }
  return cells
}

// --- bonus feature ----------------------------------------------------------

function key(c: Cell): string {
  return `${c.col}:${c.row}`
}

function runBonus(bet: number, seedCells: Cell[]): BonusResult {
  // Locked coins on the board, keyed by cell.
  const board = new Map<string, BonusCoin>()

  const seed: BonusCoin[] = seedCells.map(cell => ({ cell, value: pickCoinValue() }))
  // Board entries are separate objects so future glover mutations don't corrupt the seed records.
  for (const coin of seed) board.set(key(coin.cell), { cell: coin.cell, value: coin.value })

  const allCells: Cell[] = []
  for (let col = 0; col < XENOSLOT_COLS; col++) {
    for (let row = 0; row < XENOSLOT_ROWS; row++) allCells.push({ col, row })
  }

  const waves: BonusWave[] = []
  let collectedTotal = 0

  for (let round = 1; round <= BONUS_FREE_SPINS; round++) {
    const freeCells = allCells.filter(c => !board.has(key(c)))
    const coins: BonusCoin[] = []
    const collectors: BonusCollector[] = []
    const glovers: BonusGlover[] = []

    for (const cell of freeCells) {
      const r = rand()
      if (r < P_COIN) {
        const value = pickCoinValue()
        coins.push({ cell, value })            // snapshot — not shared with board
        board.set(key(cell), { cell, value })  // live entry — glovers may mutate this
      } else if (r < P_COIN + P_COLLECTOR) {
        collectors.push({ cell, collected: 0 })
      } else if (r < P_COIN + P_COLLECTOR + P_GLOVER) {
        glovers.push({ cell, mult: pickGloverMult(), upgrades: [] })
      }
    }

    // Glovers resolve after coins have locked: each multiplies the value of
    // every coin in its 8 neighbouring cells, then disappears (never occupies a
    // cell). Stacking is allowed — a coin next to two glovers is boosted twice.
    for (const glover of glovers) {
      for (const nc of neighbors(glover.cell)) {
        const coin = board.get(key(nc))
        if (coin) {
          const from = coin.value
          coin.value = from * glover.mult
          glover.upgrades.push({ cell: nc, from, to: coin.value })
        }
      }
    }

    // A collector harvests every coin on the board (the coins locked this wave
    // included), then the whole board is wiped clean. When several collectors
    // land in one wave they each pull the full board, multiplying the harvest.
    let collectedCoins: BonusCoin[] = []
    let collectedAmount = 0
    let cleared = false
    if (collectors.length) {
      const snapshot = [...board.values()].map(c => ({ cell: c.cell, value: c.value }))
      const boardSum = snapshot.reduce((a, c) => a + c.value, 0)
      for (const collector of collectors) collector.collected = boardSum
      collectedAmount = boardSum * collectors.length
      collectedTotal += collectedAmount
      collectedCoins = snapshot
      board.clear()
      cleared = true
    }

    const hit = coins.length > 0 || collectors.length > 0 || glovers.length > 0

    waves.push({
      round,
      spinning: freeCells,
      coins,
      glovers,
      collectors,
      collectedCoins,
      collectedAmount,
      cleared,
      hit,
      respinsLeft: BONUS_FREE_SPINS - round,
      boardCoins: [...board.values()].map(c => ({ cell: c.cell, value: c.value }))
    })
  }

  return {
    seed,
    waves,
    collectedTotal: collectedTotal * bet,
    bonusPayout: collectedTotal * bet
  }
}

// --- main entry -------------------------------------------------------------

export function playXenoSlot(bet: number, _options?: Record<string, unknown>): XenoSlotResult {
  if (!Number.isFinite(bet) || bet <= 0) {
    throw createError({ statusCode: 400, message: 'Invalid bet amount' })
  }

  const lineBet = bet / XENOSLOT_LINES
  const grid = generateGrid()

  const lines: LineWin[] = []
  let basePayout = 0
  for (let i = 0; i < PAYLINES.length; i++) {
    const win = evaluateLine(grid, i, lineBet)
    if (win) {
      lines.push(win)
      basePayout += win.amount
    }
  }

  const bonusCells = findBonusCells(grid)
  const bonusTriggered = bonusCells.length >= BONUS_TRIGGER_COUNT
  const bonus = bonusTriggered ? runBonus(bet, bonusCells) : null

  let payout = basePayout + (bonus?.bonusPayout ?? 0)
  const maxWin = bet * XENOSLOT_MAX_WIN_MULT
  if (payout > maxWin) payout = maxWin
  payout = Math.round(payout * 10000) / 10000

  return {
    bet,
    lineBet,
    grid,
    lines,
    basePayout: Math.round(basePayout * 10000) / 10000,
    bonusTriggered,
    bonusCells,
    bonus,
    payout,
    won: payout > bet,
    maxWin
  }
}
