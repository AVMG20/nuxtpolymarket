// shared/utils/gamelogic/aethergates.ts
//
// "Aether Gates" — a Gates-of-Olympus-style pay-anywhere 6×5 tumble slot.
// Wilds ("multiplier" relics) never substitute into a pay-symbol
// match; each one rolls its own multiplier value the moment it's drawn. Every
// time ANY pay-symbol win lands on a tumble step, every multiplier relic
// currently on the board — wherever it sits — flies into a shared meter and
// is cleared away with the winning symbols. The meter is a plain running
// number (no per-cell state to track), carried through the whole cascade and,
// during the bonus, through every free spin.
//
// Everything random is decided on the server in a single call; the client
// just replays the precomputed steps (server is authoritative for every
// outcome and payout — mirrors the Candy Madness / Xeno Slot philosophy).
//
// ── Base game ────────────────────────────────────────────────────────────────
//   A full 6×5 grid drops. A win is 8+ of the same symbol anywhere on the
//   grid (no adjacency needed — "pay anywhere"). Each win pays
//   `paytable[symbol][countBracket] × bet`. Winning symbols AND every
//   multiplier relic currently on the board are cleared together and the
//   board tumbles (gravity + refill) — this repeats until a drop has no win.
//
// ── Multiplier meter (the hook) ──────────────────────────────────────────────
//   Relics show a value (×2 up to ×100) the moment they land. The instant any
//   win occurs on a tumble step, every relic on the board flies into the
//   meter and is swept away. When the tumble sequence ends, the meter
//   multiplies the whole sequence's total win. In the base game the meter
//   resets every paid spin.
//
// ── Bonus (free spins) ───────────────────────────────────────────────────────
//   3 🌀 scatters anywhere in the initial drop award FREE_SPINS free spins;
//   4+ scatters award the richer FREE_SPINS_SUPER free spins instead. During
//   the bonus, relics appear more often and can roll bigger values, and the
//   meter NEVER resets between spins (it keeps growing for the whole
//   feature). Scatters can still land during the bonus, but only matter
//   once: the first time a spin lands AG_SCATTER_TRIGGER+ of them, the
//   feature gets +RETRIGGER_SPINS extra spins and scatters stop spawning
//   for the rest of the bonus — a single one-time bonus-within-a-bonus.
//
// ── Fairness ────────────────────────────────────────────────────────────────
//   Total win (base + bonus) is capped at MAX_WIN_MULT × bet. Weights, the
//   paytable, relic-value odds and the buy-feature costs are tuned by
//   Monte-Carlo to ~96–97% RTP (see the measured figures next to each cost).

import { randomFloat } from '../random'

export const AG_COLS = 6
export const AG_ROWS = 5
export const AG_CELLS = AG_COLS * AG_ROWS // 30
export const AG_MIN_MATCH = 8

export const AG_SCATTER_TRIGGER = 3
export const AG_SCATTER_TRIGGER_SUPER = 4
export const AG_FREE_SPINS = 10
export const AG_FREE_SPINS_SUPER = 12
// Landing AG_SCATTER_TRIGGER+ gates during the bonus adds this many spins —
// but only once per bonus (see runBonus): after it fires, gates stop
// spawning for the rest of the feature.
export const AG_RETRIGGER_SPINS = 8
// Hard ceiling on how many free-spin rounds a single bonus can chain through
// the one-time retrigger — astronomically unlikely to bind, just a safety rail.
export const AG_MAX_FREE_SPIN_ROUNDS = 120

export const AG_MAX_WIN_MULT = 10000 // hard cap on total win, in × bet

// --- feature buys -------------------------------------------------------
// Cost (× bet) the player pays instead of a normal spin. Tuned by Monte-Carlo
// so each feature returns roughly the same RTP as a normal spin.
//
//   buyFreeSpins — pay up front to jump straight into the 10 free spins.
//   superBonus   — pay a premium to jump straight into the RICHER 12 free
//                  spins (the 4-scatter tier).
//   bonusChance  — ante toggle: every spin costs more but scatter odds are
//                  roughly doubled, raising the odds of a natural trigger.
export const AG_BUY_FREESPINS_COST = 43 // × bet → ~97.5% RTP (measured, scripts/aethergates-rtp.ts 3e6 sims)
export const AG_BUY_SUPERBONUS_COST = 58.5 // × bet → ~97.5% RTP (measured, scripts/aethergates-rtp.ts 1e6 sims)
export const AG_BONUS_CHANCE_COST = 3.54 // × bet → ~97.5% RTP (measured, scripts/aethergates-rtp.ts 1e6 sims)

export type AetherFeature = 'buyFreeSpins' | 'superBonus' | 'bonusChance'
export type AetherBonusTier = 'normal' | 'super'

export interface AetherGatesOptions {
  feature?: AetherFeature
}

export type AetherPaySymbol = 'coin' | 'ring' | 'chalice' | 'laurel' | 'lyre' | 'helm' | 'sun' | 'star'
export type AetherSymbol = AetherPaySymbol | 'scatter' | 'multiplier'

export interface Cell { col: number, row: number }

export interface MultDrop extends Cell {
  value: number
}

export interface AetherWinGroup {
  symbol: AetherPaySymbol
  cells: Cell[]
  count: number
  payMult: number
}

export interface AetherStep {
  grid: AetherSymbol[][] // [col][row] state at the start of this step
  wins: AetherWinGroup[]
  winCells: Cell[]
  multipliers: MultDrop[] // every relic on the board this step, about to fly into the meter
  meterBefore: number
  meterAfter: number
  stepPayMult: number
}

export interface AetherSequence {
  steps: AetherStep[]
  restGrid: AetherSymbol[][] // final settled grid (no winners) the client lands on
  restMults: MultDrop[] // relic values sitting on restGrid, not yet collected
  meterBefore: number
  meterAfter: number
  basePayMult: number
  winMult: number // = basePayMult × max(1, meterAfter)
}

export interface AetherFreeSpin {
  round: number
  sequence: AetherSequence
  spinWinMult: number
  scatterCount: number
  retriggered: boolean
}

export interface AetherBonusResult {
  spins: AetherFreeSpin[]
  finalMeter: number
  bonusWinMult: number
  retriggers: number
  totalSpins: number // final spin count including every retrigger
}

export interface AetherGatesResult {
  bet: number
  cost: number
  feature: AetherFeature | null
  grid: AetherSymbol[][]
  scatterCells: Cell[]
  scatterCount: number
  base: AetherSequence
  basePayout: number
  bonusTriggered: boolean
  bonusTier: AetherBonusTier | null
  bonus: AetherBonusResult | null
  bonusPayout: number
  totalWinMult: number
  payout: number
  won: boolean
  maxWin: number
  [key: string]: unknown
}

// --- symbols & weights --------------------------------------------------

export const AETHER_PAY_SYMBOLS: AetherPaySymbol[] = ['coin', 'ring', 'chalice', 'laurel', 'lyre', 'helm', 'sun', 'star']

// Reel weights (same for every cell). Higher = more frequent.
export const AETHER_SYMBOL_WEIGHTS: Record<AetherPaySymbol, number> = {
  coin: 54,
  ring: 48,
  chalice: 42,
  laurel: 35,
  lyre: 28,
  helm: 21,
  sun: 14,
  star: 8
}

export const AETHER_SCATTER_WEIGHT = 3.78
// Gates can still land during the bonus (see AG_RETRIGGER_SPINS) — the odds
// are close to the base game's since the payoff (one extra +8-spin
// retrigger, once per bonus) is meaningful but shouldn't be routine.
export const AETHER_BONUS_SCATTER_WEIGHT = 1.5
export const AETHER_MULTIPLIER_WEIGHT = 3.2 // rarer in the base game — fewer, smaller relic hits
export const AETHER_BONUS_MULTIPLIER_WEIGHT = 9 // more common than the base game, but no longer flooding the board
const AG_BONUS_CHANCE_SCATTER_MULT = 2.15

// Relic values and how often each rolls. Bigger, rarer values are reserved
// for the bonus so free spins feel like the payoff. Base-game relics are
// capped low (max ×15) so the base stays subdued. The bonus pool keeps the
// same average relic value (~×4.6) as the common tiers below ×50, but adds a
// long, very-thin tail up to ×500 — those top tiers almost never land (×100
// is roughly 1-in-15,000 relics, ×500 roughly 1-in-1,000,000), but on the
// rare bonus where several do, the stacked meter can genuinely explode.
export const AETHER_MULT_VALUES_BASE = [2, 3, 4, 5, 6, 8, 10, 15] as const
const AETHER_MULT_WEIGHTS_BASE = [100, 70, 50, 34, 22, 14, 8, 4] as const

export const AETHER_MULT_VALUES_BONUS = [2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 250, 500] as const
const AETHER_MULT_WEIGHTS_BONUS = [90, 66, 48, 34, 24, 16, 10, 6, 3.4, 2, 1.1, 0.55, 0.22, 0.07, 0.02, 0.006, 0.0015, 0.0003] as const

const COUNT_BRACKETS = [8, 10, 12, 15, 20, 25, 30] as const

// Payouts are × total bet before the meter is applied. Unlike Candy Madness,
// relics are rare, so base pays need to stand on their own — the meter is a
// bonus on top, not the whole show.
const PAYTABLE: Record<AetherPaySymbol, number[]> = {
  coin: [0.20, 0.30, 0.45, 0.70, 1.5, 3.0, 6.0],
  ring: [0.25, 0.40, 0.60, 1.0, 2.0, 4.0, 8.0],
  chalice: [0.30, 0.50, 0.80, 1.3, 2.6, 5.5, 11],
  laurel: [0.40, 0.65, 1.0, 1.7, 3.5, 7.5, 15],
  lyre: [0.60, 1.0, 1.6, 2.6, 5.5, 12, 24],
  helm: [0.90, 1.5, 2.4, 4.0, 8.5, 18, 36],
  sun: [1.5, 2.5, 4.0, 6.5, 14, 30, 60],
  star: [2.5, 4.2, 6.8, 11, 24, 50, 100]
}

// Global scale applied to every paytable value — identical in base game and
// bonus. Symbol pays never differ by phase; all of the volatility (and the
// big wins) comes from the relic/multiplier meter, which IS tuned
// differently per phase (rare + small in base, frequent + stacking in bonus
// — see the relic pools above). Retune by simple ratio if weights change.
const PAY_SCALE = 0.40

// --- crypto RNG helpers --------------------------------------------------


function randInt(n: number): number {
  return Math.floor(randomFloat() * n)
}

function weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = randomFloat() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!
    if (r < 0) return items[i]!
  }
  return items[items.length - 1]!
}

interface ValuePool { values: readonly number[], weights: readonly number[] }
const BASE_MULT_POOL: ValuePool = { values: AETHER_MULT_VALUES_BASE, weights: AETHER_MULT_WEIGHTS_BASE }
const BONUS_MULT_POOL: ValuePool = { values: AETHER_MULT_VALUES_BONUS, weights: AETHER_MULT_WEIGHTS_BONUS }

function drawMultValue(pool: ValuePool): number {
  return weightedPick(pool.values, pool.weights)
}

const PAY_WEIGHTS = AETHER_PAY_SYMBOLS.map(s => AETHER_SYMBOL_WEIGHTS[s])

function drawCell(scatterAllowed: boolean, multWeight: number, scatterWeight: number = AETHER_SCATTER_WEIGHT): AetherSymbol {
  const items: AetherSymbol[] = [...AETHER_PAY_SYMBOLS, 'multiplier']
  const weights = [...PAY_WEIGHTS, multWeight]
  if (scatterAllowed) {
    items.push('scatter')
    weights.push(scatterWeight)
  }
  return weightedPick(items, weights)
}

function bracketIndex(count: number): number {
  let idx = 0
  for (let i = 0; i < COUNT_BRACKETS.length; i++) {
    if (count >= COUNT_BRACKETS[i]!) idx = i
    else break
  }
  return idx
}

export function aetherPayMult(symbol: AetherPaySymbol, count: number): number {
  return PAYTABLE[symbol][bracketIndex(count)]! * PAY_SCALE
}

function key(cell: Cell): string {
  return `${cell.col}:${cell.row}`
}

function cloneGrid(grid: AetherSymbol[][]): AetherSymbol[][] {
  return grid.map(col => [...col])
}

function cellsToList(cellKeys: Set<string>): Cell[] {
  return [...cellKeys].map((k) => {
    const [col, row] = k.split(':').map(Number)
    return { col: col!, row: row! }
  })
}

function multsToList(mults: Map<string, number>): MultDrop[] {
  return [...mults].map(([k, value]) => {
    const [col, row] = k.split(':').map(Number)
    return { col: col!, row: row!, value }
  })
}

// --- board (grid + the value carried by every relic currently on it) ----

interface Board { grid: AetherSymbol[][], mults: Map<string, number> }

function fullDrop(scatterAllowed: boolean, multWeight: number, scatterWeight: number, valuePool: ValuePool): Board {
  const grid: AetherSymbol[][] = []
  const mults = new Map<string, number>()
  for (let col = 0; col < AG_COLS; col++) {
    const column: AetherSymbol[] = []
    for (let row = 0; row < AG_ROWS; row++) {
      const sym = drawCell(scatterAllowed, multWeight, scatterWeight)
      column.push(sym)
      if (sym === 'multiplier') mults.set(key({ col, row }), drawMultValue(valuePool))
    }
    grid.push(column)
  }
  return { grid, mults }
}

function findScatters(grid: AetherSymbol[][]): Cell[] {
  const cells: Cell[] = []
  for (let col = 0; col < AG_COLS; col++) {
    for (let row = 0; row < AG_ROWS; row++) {
      if (grid[col]![row] === 'scatter') cells.push({ col, row })
    }
  }
  return cells
}

// A win is 8+ of the same pay symbol anywhere on the grid. Relics never
// substitute — they're a separate feature, not a wild.
function findWins(grid: AetherSymbol[][]): AetherWinGroup[] {
  const bySymbol: Record<AetherPaySymbol, Cell[]> = {
    coin: [], ring: [], chalice: [], laurel: [], lyre: [], helm: [], sun: [], star: []
  }
  for (let col = 0; col < AG_COLS; col++) {
    for (let row = 0; row < AG_ROWS; row++) {
      const sym = grid[col]![row]!
      if (sym === 'scatter' || sym === 'multiplier') continue
      bySymbol[sym].push({ col, row })
    }
  }

  const wins: AetherWinGroup[] = []
  for (const symbol of AETHER_PAY_SYMBOLS) {
    const cells = bySymbol[symbol]
    if (cells.length >= AG_MIN_MATCH) {
      wins.push({ symbol, cells, count: cells.length, payMult: aetherPayMult(symbol, cells.length) })
    }
  }
  return wins
}

// Remove the winning cells + every relic on the board, then tumble: survivors
// pack to the bottom of each column, fresh symbols fill the top holes.
// Scatters never appear via a tumble refill (only on a fresh full drop).
function refill(board: Board, clearCells: Cell[], multWeight: number, valuePool: ValuePool): Board {
  const clear = new Set(clearCells.map(key))
  const grid: AetherSymbol[][] = []
  const mults = new Map<string, number>()

  for (let col = 0; col < AG_COLS; col++) {
    const survivors: AetherSymbol[] = []
    const survivorVals: (number | undefined)[] = []
    for (let row = 0; row < AG_ROWS; row++) {
      const k = key({ col, row })
      if (clear.has(k)) continue
      survivors.push(board.grid[col]![row]!)
      survivorVals.push(board.mults.get(k))
    }

    const holes = AG_ROWS - survivors.length
    const freshSyms: AetherSymbol[] = []
    const freshVals: (number | undefined)[] = []
    for (let i = 0; i < holes; i++) {
      const sym = drawCell(false, multWeight)
      freshSyms.push(sym)
      freshVals.push(sym === 'multiplier' ? drawMultValue(valuePool) : undefined)
    }

    const colSyms = [...freshSyms, ...survivors]
    const colVals = [...freshVals, ...survivorVals]
    grid.push(colSyms)
    colVals.forEach((v, row) => {
      if (v !== undefined) mults.set(key({ col, row }), v)
    })
  }

  return { grid, mults }
}

// --- one tumble sequence --------------------------------------------------

function runSequence(startBoard: Board, startMeter: number, multWeight: number, valuePool: ValuePool): AetherSequence {
  let board = startBoard
  let meter = startMeter
  let basePayMult = 0
  const steps: AetherStep[] = []

  for (let chain = 0; chain < 64; chain++) {
    const wins = findWins(board.grid)
    if (!wins.length) break

    const winCellKeys = new Set(wins.flatMap(w => w.cells).map(key))
    const winCells = cellsToList(winCellKeys)
    const stepPayMult = wins.reduce((sum, w) => sum + w.payMult, 0)
    basePayMult += stepPayMult

    // Every relic on the board — connected to this win by virtue of a win
    // having happened at all — flies into the meter.
    const multipliers: MultDrop[] = multsToList(board.mults)

    const meterBefore = meter
    for (const drop of multipliers) meter += drop.value
    const meterAfter = meter

    steps.push({
      grid: cloneGrid(board.grid),
      wins,
      winCells,
      multipliers,
      meterBefore,
      meterAfter,
      stepPayMult
    })

    const clearCells = [...winCells, ...multipliers.map((m): Cell => ({ col: m.col, row: m.row }))]
    board = refill(board, clearCells, multWeight, valuePool)
  }

  const winMult = basePayMult > 0 ? basePayMult * Math.max(1, meter) : 0
  return { steps, restGrid: board.grid, restMults: multsToList(board.mults), meterBefore: startMeter, meterAfter: meter, basePayMult, winMult }
}

// --- bonus ------------------------------------------------------------------

function runBonus(startMeter: number, initialSpins: number): AetherBonusResult {
  let meter = startMeter
  let bonusWinMult = 0
  let totalSpins = Math.min(initialSpins, AG_MAX_FREE_SPIN_ROUNDS)
  let retriggers = 0
  let retriggerUsed = false // the scatter retrigger can only fire once per bonus
  const spins: AetherFreeSpin[] = []

  let round = 0
  while (round < totalSpins) {
    round++
    // Once the one-time retrigger has fired, scatters stop spawning entirely
    // for the rest of the feature — they have nothing left to do.
    const board = fullDrop(!retriggerUsed, AETHER_BONUS_MULTIPLIER_WEIGHT, AETHER_BONUS_SCATTER_WEIGHT, BONUS_MULT_POOL)
    const sequence = runSequence(board, meter, AETHER_BONUS_MULTIPLIER_WEIGHT, BONUS_MULT_POOL)
    meter = sequence.meterAfter
    bonusWinMult += sequence.winMult

    const scatterCount = retriggerUsed ? 0 : findScatters(board.grid).length
    const retriggered = !retriggerUsed && scatterCount >= AG_SCATTER_TRIGGER
    if (retriggered) {
      totalSpins = Math.min(totalSpins + AG_RETRIGGER_SPINS, AG_MAX_FREE_SPIN_ROUNDS)
      retriggers++
      retriggerUsed = true
    }

    spins.push({ round, sequence, spinWinMult: sequence.winMult, scatterCount, retriggered })
  }

  return { spins, finalMeter: meter, bonusWinMult, retriggers, totalSpins: round }
}

// --- main entry -------------------------------------------------------------

// An empty sequence — used as the (visual-only) base for a bought bonus,
// where the player skips the paid spin and lands straight in free spins.
function emptySequence(grid: AetherSymbol[][], mults: Map<string, number> = new Map()): AetherSequence {
  return { steps: [], restGrid: grid, restMults: multsToList(mults), meterBefore: 0, meterAfter: 0, basePayMult: 0, winMult: 0 }
}

function forceScatters(grid: AetherSymbol[][], mults: Map<string, number>, count: number) {
  const placed = new Set<string>()
  while (placed.size < count) {
    const col = randInt(AG_COLS)
    const row = randInt(AG_ROWS)
    const k = `${col}:${row}`
    if (placed.has(k)) continue
    placed.add(k)
    grid[col]![row] = 'scatter'
    mults.delete(k)
  }
}

export function playAetherGates(bet: number, options?: Record<string, unknown>): AetherGatesResult {
  if (!Number.isFinite(bet) || bet <= 0) {
    throw createError({ statusCode: 400, message: 'Invalid bet amount' })
  }

  const feature = (options?.feature ?? null) as AetherFeature | null
  let cost = bet
  let grid: AetherSymbol[][]
  let base: AetherSequence
  let bonusTriggered = false
  let bonusTier: AetherBonusTier | null = null
  let bonus: AetherBonusResult | null = null

  if (feature === 'buyFreeSpins' || feature === 'superBonus') {
    const isSuper = feature === 'superBonus'
    cost = bet * (isSuper ? AG_BUY_SUPERBONUS_COST : AG_BUY_FREESPINS_COST)

    // Symbols only — purely cosmetic, pays nothing — with the trigger count
    // of scatters placed so the drop reads as a real bonus trigger.
    const board = fullDrop(false, AETHER_MULTIPLIER_WEIGHT, AETHER_SCATTER_WEIGHT, BASE_MULT_POOL)
    forceScatters(board.grid, board.mults, isSuper ? AG_SCATTER_TRIGGER_SUPER : AG_SCATTER_TRIGGER)
    grid = board.grid
    base = emptySequence(grid, board.mults)
    bonusTriggered = true
    bonusTier = isSuper ? 'super' : 'normal'
    bonus = runBonus(0, isSuper ? AG_FREE_SPINS_SUPER : AG_FREE_SPINS)
  } else {
    const scatterWeight = feature === 'bonusChance' ? AETHER_SCATTER_WEIGHT * AG_BONUS_CHANCE_SCATTER_MULT : AETHER_SCATTER_WEIGHT
    if (feature === 'bonusChance') cost = bet * AG_BONUS_CHANCE_COST

    const board = fullDrop(true, AETHER_MULTIPLIER_WEIGHT, scatterWeight, BASE_MULT_POOL)
    grid = board.grid
    base = runSequence(board, 0, AETHER_MULTIPLIER_WEIGHT, BASE_MULT_POOL)

    const triggerCount = findScatters(grid).length
    if (triggerCount >= AG_SCATTER_TRIGGER_SUPER) {
      bonusTriggered = true
      bonusTier = 'super'
      bonus = runBonus(base.meterAfter, AG_FREE_SPINS_SUPER)
    } else if (triggerCount >= AG_SCATTER_TRIGGER) {
      bonusTriggered = true
      bonusTier = 'normal'
      bonus = runBonus(base.meterAfter, AG_FREE_SPINS)
    }
  }

  const scatterCells = findScatters(grid)
  const scatterCount = scatterCells.length

  const baseWinMult = base.winMult
  const bonusWinMult = bonus?.bonusWinMult ?? 0
  const uncappedWinMult = baseWinMult + bonusWinMult
  const totalWinMult = Math.min(AG_MAX_WIN_MULT, uncappedWinMult)

  let payout = totalWinMult * bet
  const maxWin = bet * AG_MAX_WIN_MULT
  if (payout > maxWin) payout = maxWin
  payout = Math.round(payout * 10000) / 10000

  return {
    bet,
    cost: Math.round(cost * 10000) / 10000,
    feature,
    grid,
    scatterCells,
    scatterCount,
    base,
    basePayout: Math.round(baseWinMult * bet * 10000) / 10000,
    bonusTriggered,
    bonusTier,
    bonus,
    bonusPayout: Math.round(bonusWinMult * bet * 10000) / 10000,
    totalWinMult: Math.round(totalWinMult * 10000) / 10000,
    payout,
    won: payout > cost,
    maxWin
  }
}
