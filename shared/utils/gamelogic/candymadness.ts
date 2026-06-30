// shared/utils/gamelogic/candymadness.ts
//
// "Candy Madness" — a 6×5 cluster-pays cascade (tumble) slot with a sticky
// multiplier mechanic and a free-spins bonus. Candy themed.
//
// Everything random is decided on the server in a single call; the client just
// replays the precomputed cascade (mirrors the Xeno Slot / Magic Hands
// philosophy — the server is authoritative for every outcome and the payout,
// the client is pure presentation).
//
// ── Base game ────────────────────────────────────────────────────────────────
//   A full 6×5 grid drops. Wins are CLUSTERS: 5+ of the same candy connected
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
//   paytable are tuned by Monte-Carlo to ~98% RTP (see scripts/candymadness-rtp.ts).

export const CM_COLS = 6
export const CM_ROWS = 5
export const CM_CELLS = CM_COLS * CM_ROWS

export const CM_MAX_WIN_MULT = 5000 // hard cap on total win, in × bet
export const CM_MIN_CLUSTER = 4 // candies needed for a winning cluster

export const CM_MULT_START = 2
export const CM_MULT_CAP = 2048
export const CM_FREE_SPINS = 10
export const CM_SCATTER_TRIGGER = 3

// --- symbols ----------------------------------------------------------------

export type CandySymbol
  = 'grape' | 'blue' | 'green' | 'orange' | 'red' | 'scatter'

// The five paying candies, low → high. `scatter` is the bonus trigger and never
// forms a cluster.
export const CANDY_KEYS: Exclude<CandySymbol, 'scatter'>[]
  = ['grape', 'blue', 'green', 'orange', 'red']

// Reel weights (same for every cell). Higher = more frequent. The scatter is
// only ever drawn on a base-game full drop (never during tumbles or the bonus),
// so its weight only sets the bonus trigger rate.
export const CANDY_WEIGHTS: Record<Exclude<CandySymbol, 'scatter'>, number> = {
  grape: 1.0, blue: 1.0, green: 0.92, orange: 0.82, red: 0.66
}
export const SCATTER_WEIGHT = 0.05

// Global scale applied to every paytable value — the single knob the RTP tuner
// turns to land the target return. Tuned to ~98% total RTP (≈60% base, ≈38%
// bonus; bonus trigger ≈ 1 in 220). See scripts/candymadness-rtp.ts.
const PAY_SCALE = 0.418

// Cluster size brackets (lower bound, inclusive). A cluster of `n` candies uses
// the highest bracket whose bound is ≤ n.
const SIZE_BRACKETS = [4, 5, 6, 7, 8, 9, 10, 12, 15] as const

// Payout (× total bet) per symbol, indexed by SIZE_BRACKETS. Deliberately tiny:
// the multiplier-spot sum is where the money is.
const PAYTABLE: Record<Exclude<CandySymbol, 'scatter'>, number[]> = {
  //         4       5       6       7       8       9      10      12      15+
  grape:  [0.008, 0.012, 0.018, 0.026, 0.038, 0.055, 0.084, 0.144, 0.300],
  blue:   [0.009, 0.013, 0.019, 0.029, 0.042, 0.060, 0.094, 0.162, 0.336],
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
  grid: CandySymbol[][] // initial base drop [col][row]
  scatterCells: Cell[]
  scatterCount: number
  base: TumbleSequence
  basePayout: number
  bonusTriggered: boolean
  bonus: BonusResult | null
  bonusPayout: number
  payout: number // total currency returned (capped)
  won: boolean // payout > bet
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

// Flood-fill every cluster of 5+ matching candies (scatters never match).
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
// and pack to the BOTTOM of each column, new candies fill the top holes. This
// matches pixi-reels' gravity convention (top `winners.length` rows are new).
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

// Runs a full tumble chain from `startGrid`, mutating the shared `spots` map
// (so the bonus can carry spots across spins). Returns the precomputed steps,
// the settled grid and the sequence win in × bet.
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

    // Place / upgrade a multiplier spot on every winning position.
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
  // Multiplier spots persist for the whole feature — this map is never cleared.
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

export function playCandyMadness(bet: number, _options?: Record<string, unknown>): CandyMadnessResult {
  if (!Number.isFinite(bet) || bet <= 0) {
    throw createError({ statusCode: 400, message: 'Invalid bet amount' })
  }

  const grid = fullDrop(drawCell)
  const scatterCells = findScatters(grid)
  const scatterCount = scatterCells.length

  // Base game: spots are fresh each paid spin.
  const baseSpots = new Map<string, number>()
  const base = runSequence(grid, baseSpots)
  const basePayout = base.win * bet

  const bonusTriggered = scatterCount >= CM_SCATTER_TRIGGER
  const bonus = bonusTriggered ? runBonus() : null
  const bonusPayout = (bonus?.bonusPayout ?? 0) * bet

  let payout = basePayout + bonusPayout
  const maxWin = bet * CM_MAX_WIN_MULT
  if (payout > maxWin) payout = maxWin
  payout = Math.round(payout * 10000) / 10000

  return {
    bet,
    grid,
    scatterCells,
    scatterCount,
    base,
    basePayout: Math.round(basePayout * 10000) / 10000,
    bonusTriggered,
    bonus,
    bonusPayout: Math.round(bonusPayout * 10000) / 10000,
    payout,
    won: payout > bet,
    maxWin
  }
}
