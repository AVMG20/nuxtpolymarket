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

export const XENOSLOT_BUY_BONUS_COST = 52 // × bet → ~98% RTP (measured via bonus-only sim, see scripts/xenoslot-rtp.ts)

// --- bonus feature tuning ---------------------------------------------------

export const BONUS_FREE_SPINS = 10 // fixed number of bonus spins

// Per free cell, per spin: chance to land a coin / a collector / a glover.
// Collectors are deliberately uncommon so harvesting one stays a highlight —
// coins land often and accumulate, then a (rarer) collector sweeps the whole
// board. Coins fill faster (higher P_COIN) to keep each collection rich, which
// offsets the RTP otherwise lost by collecting less often. Tuned to ~98% RTP
// (see scripts/xenoslot-rtp.ts).
//
// P_COIN scales down as the board fills up (see coinProbability below) so a
// coin-choked board — one with no room left for a glover or collector to ever
// land — becomes vanishingly rare. An empty board gets a small boost to make
// up for the coins lost late-game, keeping the overall fill rate close to the
// old flat 0.20.
const P_COIN_EMPTY = 0.22 // chance per free cell when the board has 0 coins locked
const P_COIN_FULL = 0.06 // chance per free cell once the board is almost full
const P_COLLECTOR = 0.028
const P_GLOVER = 0.028

// Linear ramp from P_COIN_EMPTY down to P_COIN_FULL as coins accumulate.
function coinProbability(coinsOnBoard: number): number {
  const t = Math.min(coinsOnBoard / (XENOSLOT_CELLS - 1), 1)
  return P_COIN_EMPTY - (P_COIN_EMPTY - P_COIN_FULL) * t
}

// Coin face values (× bet) and their relative weights. Heavily low-skewed:
// individual coins are small, but glovers land often (see P_GLOVER) and multiply
// neighbours, so most of the bonus payout comes from boosted coins rather than
// big base faces. Skewed slightly smaller than a flat distribution would need —
// coins now land more readily on an empty board and then sit there for more of
// the remaining spins (since the fill rate tapers off), so each one has more
// opportunities to be caught by a glover; the lighter weights offset that and
// keep RTP at ~98% (see scripts/xenoslot-rtp.ts).
const COIN_VALUES = [0.2, 0.5, 1, 2, 5, 10, 25, 50] as const
const COIN_WEIGHTS = [0.360, 0.254, 0.17, 0.1, 0.06, 0.033, 0.020, 0.003] as const

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

// Same reel weights with BONUS excluded — used to fill a bought bonus's grid so
// the forced trigger cells are the only BONUS symbols on it (a natural roll
// could otherwise land extra scatters and seed the board with more coins than
// the buy price was tuned for).
const NON_BONUS_SYMBOL_KEYS = SYMBOL_KEYS.filter(k => k !== 'bonus')
const NON_BONUS_SYMBOL_WEIGHT_VALUES = NON_BONUS_SYMBOL_KEYS.map(k => SYMBOL_WEIGHTS[k])

function spinNonBonusSymbol(): SlotSymbol {
  return weightedPick(NON_BONUS_SYMBOL_KEYS, NON_BONUS_SYMBOL_WEIGHT_VALUES)
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
  cost: number // currency staked this round — bet, or the buy-bonus price
  grid: SlotSymbol[][] // [col][row]
  lines: LineWin[]
  basePayout: number
  bonusTriggered: boolean
  bonusCells: Cell[] // BONUS positions in the base grid
  bonus: BonusResult | null
  payout: number // total currency returned (capped)
  won: boolean // payout > cost
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

// Grid for a bought bonus: every other cell rolls normally (minus BONUS, so no
// stray scatter can sneak in), then exactly BONUS_TRIGGER_COUNT random cells
// are forced to BONUS — the minimum seed, matching what XENOSLOT_BUY_BONUS_COST
// was tuned against. Line wins are never evaluated on this grid (see the
// buyBonus branch in playXenoSlot), so the non-BONUS symbols are just dressing.
function buyBonusGrid(): { grid: SlotSymbol[][], cells: Cell[] } {
  const grid: SlotSymbol[][] = []
  for (let col = 0; col < XENOSLOT_COLS; col++) {
    const column: SlotSymbol[] = []
    for (let row = 0; row < XENOSLOT_ROWS; row++) column.push(spinNonBonusSymbol())
    grid.push(column)
  }

  const pool: Cell[] = []
  for (let col = 0; col < XENOSLOT_COLS; col++) {
    for (let row = 0; row < XENOSLOT_ROWS; row++) pool.push({ col, row })
  }

  const cells: Cell[] = []
  for (let i = 0; i < BONUS_TRIGGER_COUNT && pool.length > 0; i++) {
    const index = Math.floor(rand() * pool.length)
    const [cell] = pool.splice(index, 1)
    if (!cell) continue
    grid[cell.col]![cell.row] = 'bonus'
    cells.push(cell)
  }

  return { grid, cells }
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

    const pCoin = coinProbability(board.size)
    for (const cell of freeCells) {
      const r = rand()
      if (r < pCoin) {
        coins.push({ cell, value: pickCoinValue() }) // locked onto the board below
      } else if (r < pCoin + P_COLLECTOR) {
        collectors.push({ cell, collected: 0 })
      } else if (r < pCoin + P_COLLECTOR + P_GLOVER) {
        glovers.push({ cell, mult: pickGloverMult(), upgrades: [] })
      }
    }

    // Guarantee at least one free cell survives the wave so a glover or
    // collector always has somewhere to land — unless a collector is about to
    // wipe the board clean anyway, in which case a full board doesn't matter.
    if (!collectors.length && coins.length && board.size + coins.length >= XENOSLOT_CELLS) {
      coins.pop()
    }

    // Live entries — glovers may mutate these.
    for (const coin of coins) board.set(key(coin.cell), { cell: coin.cell, value: coin.value })

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

export function playXenoSlot(bet: number, options?: Record<string, unknown>): XenoSlotResult {
  if (!Number.isFinite(bet) || bet <= 0) {
    throw createError({ statusCode: 400, message: 'Invalid bet amount' })
  }

  const lineBet = bet / XENOSLOT_LINES
  const maxWin = bet * XENOSLOT_MAX_WIN_MULT

  if (options?.buyBonus) {
    const cost = Number((bet * XENOSLOT_BUY_BONUS_COST).toFixed(4))
    const { grid, cells } = buyBonusGrid()
    const bonus = runBonus(bet, cells)
    const payout = Math.min(maxWin, Math.round(bonus.bonusPayout * 10000) / 10000)

    return {
      bet,
      lineBet,
      cost,
      grid,
      lines: [],
      basePayout: 0,
      bonusTriggered: true,
      bonusCells: cells,
      bonus,
      payout,
      won: payout > cost,
      maxWin
    }
  }

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
  if (payout > maxWin) payout = maxWin
  payout = Math.round(payout * 10000) / 10000

  return {
    bet,
    lineBet,
    cost: bet,
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
