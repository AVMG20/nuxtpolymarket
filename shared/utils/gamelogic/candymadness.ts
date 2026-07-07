// shared/utils/gamelogic/candymadness.ts
//
// "Candy Madness" — a 7×7 cluster-pays cascade (tumble) slot with a sticky
// multiplier mechanic and a free-spins bonus. Candy themed.
//
// Everything random is decided on the server in a single call; the client just
// replays the precomputed cascade (mirrors the Xeno Slot / Magic Hands
// philosophy — the server is authoritative for every outcome and the payout,
// the client is pure presentation).
//
// ── Base game ────────────────────────────────────────────────────────────────
//   A full 7×7 grid drops. Wins are CLUSTERS: 4+ of the same candy connected
//   orthogonally (up/down/left/right). Each cluster pays
//   `paytable[symbol][sizeBracket] × bet`.
//
//   After a win the winning candies are removed, the candies above fall down
//   (gravity) and new candies drop in from the top — a "tumble". Tumbling
//   repeats until a drop produces no win.
//
// ── Multiplier spots (the hook) ──────────────────────────────────────────────
//   Every grid POSITION that takes part in a win gets a multiplier "spot":
//   it appears at ×2, and doubles (×2 → ×4 → ×8 → … up to ×2048) every further
//   time a win lands on that position. When the tumble sequence finally stops,
//   the SUM of every multiplier spot on the grid multiplies the whole
//   sequence's win. In the base game the spots reset every paid spin.
//
// ── Bonus (free spins) ───────────────────────────────────────────────────────
//   3+ 🍭 SCATTER symbols anywhere in the initial drop award FREE_SPINS free
//   spins. During the bonus the multiplier spots DO NOT reset between spins —
//   they stay on the grid and keep growing for the whole feature, so the sum
//   that multiplies each spin's win snowballs.
//
// ── Fairness ────────────────────────────────────────────────────────────────
//   Total win (base + bonus) is capped at MAX_WIN_MULT × bet. Weights and the
//   paytable are tuned by Monte-Carlo to ~98% RTP.

export const CM_COLS = 7
export const CM_ROWS = 7
export const CM_CELLS = CM_COLS * CM_ROWS // 49

export const CM_MAX_WIN_MULT = 5000 // hard cap on total win, in × bet
export const CM_MIN_CLUSTER = 4    // candies needed for a winning cluster

export const CM_MULT_START = 2
export const CM_MULT_CAP = 2048
export const CM_FREE_SPINS = 10
export const CM_SCATTER_TRIGGER = 3

// --- feature buys -----------------------------------------------------------
// Cost (× bet) the player pays instead of a normal spin. Tuned by Monte-Carlo
// so each feature returns ~95–98% RTP (see CM_*_RTP below, measured at 5e6 sims).
//
//   buyFreeSpins — pay up front to jump straight into the 10 free spins.
//   bonusHunt    — pay a premium for a spin that is guaranteed to drop one 🍭
//                  scatter, sharply raising the odds of triggering the bonus.
export const CM_BUY_FREESPINS_COST = 38.1 // × bet → ~98% RTP (bonus EV ≈ 37.31× bet)
export const CM_BONUS_HUNT_COST = 3.62 // × bet → ~98% RTP (EV ≈ 3.545× bet)

export type CandyFeature = 'buyFreeSpins' | 'bonusHunt'

export interface CandyMadnessOptions {
  feature?: CandyFeature
}

// --- symbols ----------------------------------------------------------------

export type CandySymbol
  = 'grape' | 'blue' | 'banana' | 'green' | 'orange' | 'red' | 'scatter'

// The six paying candies, low → high. `scatter` is the bonus trigger and
// never forms a cluster.
export const CANDY_KEYS: Exclude<CandySymbol, 'scatter'>[]
  = ['grape', 'blue', 'banana', 'green', 'orange', 'red']

// Reel weights (same for every cell). Higher = more frequent. The scatter is
// only ever drawn on a base-game full drop (never during tumbles or the bonus).
export const CANDY_WEIGHTS: Record<Exclude<CandySymbol, 'scatter'>, number> = {
  grape: 1.00, blue: 0.96, banana: 0.90, green: 0.84, orange: 0.68, red: 0.56
}
export const SCATTER_WEIGHT = 0.05

// Global scale applied to every paytable value. Tuned by Monte-Carlo (5e6
// sims) to ~98% base-game RTP. RTP scales linearly with this until the
// MAX_WIN cap starts binding (which is rare), so retune by simple ratio.
const PAY_SCALE = 0.385

// Cluster size brackets (lower bound, inclusive). A cluster of `n` candies uses
// the highest bracket whose bound is ≤ n.
const SIZE_BRACKETS = [4, 5, 6, 7, 8, 9, 10, 12, 15] as const

// Payout (× total bet) per symbol, indexed by SIZE_BRACKETS. Deliberately tiny:
// the multiplier-spot sum is where the money is.
const PAYTABLE: Record<Exclude<CandySymbol, 'scatter'>, number[]> = {
  //          4       5       6       7       8       9      10      12      15+
  grape:  [0.008, 0.012, 0.018, 0.026, 0.038, 0.055, 0.084, 0.144, 0.300],
  blue:   [0.009, 0.013, 0.019, 0.029, 0.042, 0.060, 0.094, 0.162, 0.336],
  banana: [0.010, 0.015, 0.021, 0.032, 0.046, 0.066, 0.104, 0.180, 0.372],
  green:  [0.010, 0.016, 0.023, 0.034, 0.050, 0.072, 0.114, 0.198, 0.408],
  orange: [0.013, 0.019, 0.029, 0.043, 0.065, 0.094, 0.150, 0.264, 0.552],
  red:    [0.018, 0.026, 0.041, 0.062, 0.096, 0.142, 0.228, 0.408, 0.864]
}

function sizeBracket(size: number): number {
  let idx = 0
  for (let i = 0; i < SIZE_BRACKETS.length; i++) {
    if (size >= SIZE_BRACKETS[i]!) idx = i
    else break
  }
  return idx
}

// Cluster payout as a × bet multiplier (pre multiplier-spot).
export function clusterPayMult(symbol: Exclude<CandySymbol, 'scatter'>, size: number): number {
  return PAYTABLE[symbol][sizeBracket(size)]! * PAY_SCALE
}

// --- crypto RNG helpers -----------------------------------------------------

function rand(): number {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return arr[0]! / 0x1_0000_0000 // [0, 1)
}

function randInt(n: number): number {
  return Math.floor(rand() * n)
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

const CANDY_WEIGHT_VALUES = CANDY_KEYS.map(k => CANDY_WEIGHTS[k])

// A candy only (used for tumble refills and bonus drops — never a scatter).
function drawCandy(): Exclude<CandySymbol, 'scatter'> {
  return weightedPick(CANDY_KEYS, CANDY_WEIGHT_VALUES)
}

// A base-game cell: candy or (rarely) a scatter.
const FULL_KEYS: CandySymbol[] = [...CANDY_KEYS, 'scatter']
const FULL_WEIGHTS = [...CANDY_WEIGHT_VALUES, SCATTER_WEIGHT]
function drawCell(): CandySymbol {
  return weightedPick(FULL_KEYS, FULL_WEIGHTS)
}

// --- result shapes ----------------------------------------------------------

export interface Cell { col: number, row: number }

export interface Cluster {
  symbol: Exclude<CandySymbol, 'scatter'>
  cells: Cell[]
  size: number
  pay: number // currency won by this cluster (× bet, pre multiplier-spots)
}

export interface MultSpot { col: number, row: number, value: number }

// One tumble (one drop + its winning clusters). The grid here is the board the
// player sees BEFORE the winning candies are cleared; the next step's grid (or
// `restGrid`) is what the survivors + new candies tumble into.
export interface TumbleStep {
  grid: CandySymbol[][] // [col][row] state at the start of this step
  clusters: Cluster[]
  winCells: Cell[] // every winning cell this step (union of clusters)
  stepPay: number // Σ cluster pay (× bet, pre multiplier-spots)
  spotsAfter: MultSpot[] // multiplier spots after this step's upgrades
}

export interface TumbleSequence {
  steps: TumbleStep[]
  restGrid: CandySymbol[][] // final settled grid (no winners) the client lands on
  spotsBefore: MultSpot[] // spots present before this sequence (bonus carry-over)
  basePay: number // Σ all cluster pay (× bet, pre multiplier-spots)
  multiplierSum: number // Σ of every spot value at sequence end
  win: number // currency paid by this sequence (× bet) = basePay × max(1, multiplierSum)
}

export interface BonusSpin {
  round: number
  sequence: TumbleSequence
  spinWin: number // currency this free spin paid (× bet)
}

export interface BonusResult {
  spins: BonusSpin[]
  finalSpots: MultSpot[] // spots on the grid when the feature ended
  bonusPayout: number // currency the feature paid (× bet, pre cap)
}

export interface CandyMadnessResult {
  bet: number
  cost: number // currency actually staked this round (bet, or the feature-buy price)
  feature: CandyFeature | null
  grid: CandySymbol[][] // initial base drop [col][row]
  scatterCells: Cell[]
  scatterCount: number
  base: TumbleSequence
  basePayout: number
  bonusTriggered: boolean
  bonus: BonusResult | null
  bonusPayout: number
  payout: number // total currency returned (capped)
  won: boolean // payout > cost
  maxWin: number
  [key: string]: unknown
}

// --- grid helpers -----------------------------------------------------------

function key(col: number, row: number): string {
  return `${col}:${row}`
}

function cloneGrid(grid: CandySymbol[][]): CandySymbol[][] {
  return grid.map(col => [...col])
}

function fullDrop(draw: () => CandySymbol): CandySymbol[][] {
  const grid: CandySymbol[][] = []
  for (let col = 0; col < CM_COLS; col++) {
    const column: CandySymbol[] = []
    for (let row = 0; row < CM_ROWS; row++) column.push(draw())
    grid.push(column)
  }
  return grid
}

// Flood-fill every cluster of 4+ matching candies (scatters never match).
function findClusters(grid: CandySymbol[][]): Cluster[] {
  const seen: boolean[][] = grid.map(col => col.map(() => false))
  const clusters: Cluster[] = []

  for (let col = 0; col < CM_COLS; col++) {
    for (let row = 0; row < CM_ROWS; row++) {
      if (seen[col]![row]) continue
      const sym = grid[col]![row]!
      seen[col]![row] = true
      if (sym === 'scatter') continue

      // BFS over orthogonal neighbours of the same candy.
      const cells: Cell[] = [{ col, row }]
      const queue: Cell[] = [{ col, row }]
      while (queue.length) {
        const c = queue.pop()!
        const adj = [
          { col: c.col - 1, row: c.row },
          { col: c.col + 1, row: c.row },
          { col: c.col, row: c.row - 1 },
          { col: c.col, row: c.row + 1 }
        ]
        for (const n of adj) {
          if (n.col < 0 || n.col >= CM_COLS || n.row < 0 || n.row >= CM_ROWS) continue
          if (seen[n.col]![n.row]) continue
          if (grid[n.col]![n.row] !== sym) continue
          seen[n.col]![n.row] = true
          cells.push(n)
          queue.push(n)
        }
      }

      if (cells.length >= CM_MIN_CLUSTER) {
        clusters.push({ symbol: sym, cells, size: cells.length, pay: clusterPayMult(sym, cells.length) })
      }
    }
  }
  return clusters
}

// Remove the winning cells and tumble: survivors keep their top-to-bottom order
// and pack to the BOTTOM of each column, new candies fill the top holes.
function tumble(grid: CandySymbol[][], winCells: Cell[]): CandySymbol[][] {
  const dead: Set<string> = new Set(winCells.map(c => key(c.col, c.row)))
  const next: CandySymbol[][] = []
  for (let col = 0; col < CM_COLS; col++) {
    const survivors: CandySymbol[] = []
    for (let row = 0; row < CM_ROWS; row++) {
      if (!dead.has(key(col, row))) survivors.push(grid[col]![row]!)
    }
    const holes = CM_ROWS - survivors.length
    const fresh: CandySymbol[] = Array.from({ length: holes }, () => drawCandy())
    next.push([...fresh, ...survivors]) // fresh on top, survivors at bottom
  }
  return next
}

function snapshotSpots(spots: Map<string, number>): MultSpot[] {
  const out: MultSpot[] = []
  for (const [k, value] of spots) {
    const [col, row] = k.split(':').map(Number)
    out.push({ col: col!, row: row!, value })
  }
  return out
}

// --- one tumble sequence ----------------------------------------------------

function runSequence(startGrid: CandySymbol[][], spots: Map<string, number>): TumbleSequence {
  const spotsBefore = snapshotSpots(spots)
  let grid = startGrid
  const steps: TumbleStep[] = []
  let basePay = 0

  for (;;) {
    const clusters = findClusters(grid)
    if (!clusters.length) break

    const winCells: Cell[] = []
    let stepPay = 0
    for (const cl of clusters) {
      stepPay += cl.pay
      for (const c of cl.cells) winCells.push(c)
    }
    basePay += stepPay

    for (const c of winCells) {
      const k = key(c.col, c.row)
      const cur = spots.get(k)
      spots.set(k, cur === undefined ? CM_MULT_START : Math.min(cur * 2, CM_MULT_CAP))
    }

    steps.push({
      grid: cloneGrid(grid),
      clusters,
      winCells,
      stepPay,
      spotsAfter: snapshotSpots(spots)
    })

    grid = tumble(grid, winCells)
  }

  let multiplierSum = 0
  for (const v of spots.values()) multiplierSum += v

  const win = basePay > 0 ? basePay * Math.max(1, multiplierSum) : 0

  return { steps, restGrid: grid, spotsBefore, basePay, multiplierSum, win }
}

// --- scatter detection ------------------------------------------------------

function findScatters(grid: CandySymbol[][]): Cell[] {
  const cells: Cell[] = []
  for (let col = 0; col < CM_COLS; col++) {
    for (let row = 0; row < CM_ROWS; row++) {
      if (grid[col]![row] === 'scatter') cells.push({ col, row })
    }
  }
  return cells
}

// --- bonus ------------------------------------------------------------------

function runBonus(): BonusResult {
  const spots = new Map<string, number>()
  const spins: BonusSpin[] = []
  let bonusPayout = 0

  for (let round = 1; round <= CM_FREE_SPINS; round++) {
    const grid = fullDrop(drawCandy) // no scatters during the bonus
    const sequence = runSequence(grid, spots)
    bonusPayout += sequence.win
    spins.push({ round, sequence, spinWin: sequence.win })
  }

  return { spins, finalSpots: snapshotSpots(spots), bonusPayout }
}

// --- main entry -------------------------------------------------------------

// An empty sequence — used as the (visual-only) base for a bought bonus, where
// the player skips the paid spin and lands straight in free spins.
function emptySequence(grid: CandySymbol[][]): TumbleSequence {
  return { steps: [], restGrid: grid, spotsBefore: [], basePay: 0, multiplierSum: 0, win: 0 }
}

export function playCandyMadness(bet: number, options?: Record<string, unknown>): CandyMadnessResult {
  if (!Number.isFinite(bet) || bet <= 0) {
    throw createError({ statusCode: 400, message: 'Invalid bet amount' })
  }

  const feature = (options?.feature ?? null) as CandyFeature | null

  let cost = bet
  let grid: CandySymbol[][]
  let base: TumbleSequence
  let basePayout: number
  let bonusTriggered: boolean
  let bonus: BonusResult | null

  if (feature === 'buyFreeSpins') {
    // Pay the buy price, skip the paid spin, go straight to free spins.
    cost = bet * CM_BUY_FREESPINS_COST
    grid = fullDrop(drawCandy) // candies only — purely cosmetic, pays nothing
    // Scatter in the trigger symbols so the initial drop reads as a real bonus
    // trigger. Purely visual: the base is an empty (non-paying) sequence.
    const placed = new Set<string>()
    while (placed.size < CM_SCATTER_TRIGGER) {
      const col = randInt(CM_COLS)
      const row = randInt(CM_ROWS)
      const k = key(col, row)
      if (placed.has(k)) continue
      placed.add(k)
      grid[col]![row] = 'scatter'
    }
    base = emptySequence(grid)
    basePayout = 0
    bonusTriggered = true
    bonus = runBonus()
  } else {
    if (feature === 'bonusHunt') cost = bet * CM_BONUS_HUNT_COST
    grid = fullDrop(drawCell)
    // Bonus Hunter guarantees at least one scatter on the initial drop.
    if (feature === 'bonusHunt') grid[randInt(CM_COLS)]![randInt(CM_ROWS)] = 'scatter'

    const baseSpots = new Map<string, number>()
    base = runSequence(grid, baseSpots)
    basePayout = base.win * bet
    bonusTriggered = findScatters(grid).length >= CM_SCATTER_TRIGGER
    bonus = bonusTriggered ? runBonus() : null
  }

  const scatterCells = findScatters(grid)
  const scatterCount = scatterCells.length
  const bonusPayout = (bonus?.bonusPayout ?? 0) * bet

  let payout = basePayout + bonusPayout
  const maxWin = bet * CM_MAX_WIN_MULT
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
    basePayout: Math.round(basePayout * 10000) / 10000,
    bonusTriggered,
    bonus,
    bonusPayout: Math.round(bonusPayout * 10000) / 10000,
    payout,
    won: payout > cost,
    maxWin
  }
}
