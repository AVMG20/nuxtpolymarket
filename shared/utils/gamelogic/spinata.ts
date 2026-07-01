// shared/utils/gamelogic/spinata.ts
//
// "Spiñata Piñata" — a 6×5 scatter-pay (pay-anywhere) cascade slot with a
// signature Piñata Multiplier Track and a Festival of Spins bonus. Mexican
// fiesta themed. Full design brief: docs/games/spinata-slots.md.
//
// Everything random is decided on the server in a single call; the client just
// replays the precomputed cascade (mirrors the Candy Madness / Xeno Slot / Magic
// Hands philosophy — the server is authoritative for every outcome and the
// payout, the client is pure presentation).
//
// ── Base game ────────────────────────────────────────────────────────────────
//   A full 6×5 grid drops. Wins are PAY-ANYWHERE: SPN_MIN_MATCH+ of the same
//   symbol anywhere on the grid pays `paytable[symbol][bracket] × bet`,
//   regardless of position. WILD (Giga-Piñata) substitutes for every pay symbol.
//
//   After a paying drop the winning symbols (plus any wilds) are removed, the
//   symbols above fall down (gravity) and new ones drop in from the top — a
//   "tumble". Tumbling repeats until a drop produces no win.
//
// ── Piñata Multiplier Track (the hook) ───────────────────────────────────────
//   The x1→x8 rail down the left edge. Every PIÑATA symbol on the board when a
//   paying tumble lands "breaks" and advances the track one step (x1 → … → x8,
//   capped). The track value multiplies the whole spin's win. In the base game
//   the track resets to x1 every paid spin; in the bonus it is PERSISTENT and
//   snowballs across the whole feature.
//
// ── Festival of Spins (bonus) ────────────────────────────────────────────────
//   SPN_SCATTER_TRIGGER+ Piñata Stick SCATTERs anywhere in the initial drop
//   award SPN_FREE_SPINS free spins. During the feature the track is persistent
//   and CANDY BOMB symbols (mult) drop carrying a value; every bomb that lands
//   during a winning sequence adds its value on top of the track multiplier.
//
// ── Feature buys ─────────────────────────────────────────────────────────────
//   buyFestival      — pay up front to jump straight into the free spins.
//   buySuperFestival — same, but the persistent track starts pre-charged.
//   doubleChance     — a cheap surcharge that raises the scatter odds.
//
// ── Fairness ────────────────────────────────────────────────────────────────
//   Total win (base + bonus) is capped at SPN_MAX_WIN_MULT × bet. Weights, the
//   paytable and the buy costs below are PLACEHOLDERS to be tuned by Monte-Carlo
//   in scripts/spinata-rtp.ts (see the design brief, step 3) to ~96% RTP.

export const SPN_COLS = 6
export const SPN_ROWS = 5
export const SPN_CELLS = SPN_COLS * SPN_ROWS // 30

export const SPN_MAX_WIN_MULT = 5000 // hard cap on total win, in × bet
export const SPN_MIN_MATCH = 8 // pay-anywhere: symbols of a kind needed to pay

export const SPN_TRACK_START = 1 // x1 = no boost
export const SPN_TRACK_CAP = 8 // the rail tops out at x8
export const SPN_FREE_SPINS = 12
export const SPN_SCATTER_TRIGGER = 4

// Safety bound on a single tumble sequence. Wins terminate probabilistically
// (a step with no win stops the sequence); this only guards a pathological chain.
const SPN_MAX_CASCADE = 500

// --- feature buys -----------------------------------------------------------
// Cost (× bet) the player pays instead of a normal spin. PLACEHOLDERS — tune in
// scripts/spinata-rtp.ts so each buy returns ~96% RTP.
export const SPN_BUY_FESTIVAL_COST = 100 // × bet → guaranteed Festival of Spins
export const SPN_BUY_SUPER_COST = 300 // × bet → Festival with a pre-charged track
export const SPN_DOUBLE_CHANCE_COST = 1.25 // × bet surcharge → raised scatter odds

// The persistent track step a Super Festival starts on (x3 instead of x1).
export const SPN_SUPER_START_STEP = 3

export type SpinataFeature = 'buyFestival' | 'buySuperFestival' | 'doubleChance'

export interface SpinataOptions {
  feature?: SpinataFeature
}

// --- symbols ----------------------------------------------------------------

// Ten pay symbols, low → high, then the four specials.
export type SpinPaySymbol
  = 'ten' | 'jack' | 'queen' | 'king' | 'ace'
    | 'maracas' | 'tequila' | 'sombrero' | 'pepper' | 'skull'

export type SpinSymbol = SpinPaySymbol | 'wild' | 'scatter' | 'pinata' | 'mult'

export const PAY_KEYS: SpinPaySymbol[]
  = ['ten', 'jack', 'queen', 'king', 'ace', 'maracas', 'tequila', 'sombrero', 'pepper', 'skull']

// Reel weights (same for every cell). Higher = more frequent. PLACEHOLDERS.
export const PAY_WEIGHTS: Record<SpinPaySymbol, number> = {
  ten: 1.00, jack: 0.94, queen: 0.88, king: 0.82, ace: 0.76,
  maracas: 0.60, tequila: 0.50, sombrero: 0.42, pepper: 0.34, skull: 0.26
}
export const WILD_WEIGHT = 0.10
export const PINATA_WEIGHT = 0.14 // drives the multiplier track
export const SCATTER_WEIGHT = 0.05 // base drops only (never on tumble refills)
export const MULT_WEIGHT = 0.18 // candy bombs — Festival of Spins only

// Candy-bomb face values (× the spin's win) and their draw weights. PLACEHOLDER.
export const BOMB_VALUES = [2, 3, 5, 10, 25, 50, 100] as const
export const BOMB_WEIGHTS = [40, 26, 16, 9, 5, 3, 1] as const

// Global scale applied to every paytable value. Tuned by Monte-Carlo so overall
// RTP lands ~96%; RTP scales ~linearly with this until the cap binds.
const PAY_SCALE = 1.0

// Count brackets for pay-anywhere wins (lower bound, inclusive): 8-9, 10-11, 12+.
const MATCH_BRACKETS = [8, 10, 12] as const

// Payout (× total bet) per symbol, indexed by MATCH_BRACKETS. PLACEHOLDERS.
const PAYTABLE: Record<SpinPaySymbol, number[]> = {
  //           8-9    10-11    12+
  ten: [0.25, 0.75, 2.0],
  jack: [0.30, 0.90, 2.4],
  queen: [0.40, 1.20, 3.0],
  king: [0.50, 1.50, 4.0],
  ace: [0.60, 1.80, 5.0],
  maracas: [0.80, 2.40, 6.0],
  tequila: [1.00, 3.00, 8.0],
  sombrero: [1.50, 5.00, 12.0],
  pepper: [2.00, 8.00, 20.0],
  skull: [5.00, 15.0, 40.0]
}

function matchBracket(count: number): number {
  let idx = 0
  for (let i = 0; i < MATCH_BRACKETS.length; i++) {
    if (count >= MATCH_BRACKETS[i]!) idx = i
    else break
  }
  return idx
}

// Pay-anywhere payout as a × bet multiplier (pre multiplier-track).
export function matchPayMult(symbol: SpinPaySymbol, count: number): number {
  return PAYTABLE[symbol][matchBracket(count)]! * PAY_SCALE
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

const PAY_WEIGHT_VALUES = PAY_KEYS.map(k => PAY_WEIGHTS[k])

function drawBombValue(): number {
  return weightedPick(BOMB_VALUES, BOMB_WEIGHTS)
}

// The four cell-draw contexts. `scatterOdds` lets Double Chance raise the base
// scatter weight; `bonus` swaps scatters out for candy bombs; `refill` drops
// scatters (they only ever seed on a full base drop).
interface DrawConfig {
  bonus: boolean
  refill: boolean
  scatterOdds: number
}

function drawCell(cfg: DrawConfig): SpinCell {
  const items: SpinSymbol[] = [...PAY_KEYS, 'wild', 'pinata']
  const weights: number[] = [...PAY_WEIGHT_VALUES, WILD_WEIGHT, PINATA_WEIGHT]

  if (cfg.bonus) {
    items.push('mult')
    weights.push(MULT_WEIGHT)
  } else if (!cfg.refill) {
    items.push('scatter')
    weights.push(SCATTER_WEIGHT * cfg.scatterOdds)
  }

  const s = weightedPick(items, weights)
  return s === 'mult' ? { s, v: drawBombValue() } : { s }
}

// --- result shapes ----------------------------------------------------------

export interface Cell { col: number, row: number }

// A grid cell: a symbol, plus a face value when it is a candy bomb (`mult`).
export interface SpinCell { s: SpinSymbol, v?: number }

export interface SymbolWin {
  symbol: SpinPaySymbol
  cells: Cell[] // the matching symbol cells (wilds are cleared separately)
  count: number // total including wild substitutes
  pay: number // × bet, pre multiplier-track
}

export interface BombCell { col: number, row: number, value: number }

// One tumble step. `grid` is the board the player sees BEFORE this step's
// winners are cleared; the next step's grid (or `restGrid`) is what the
// survivors + fresh drops tumble into.
export interface SpinStep {
  grid: SpinCell[][] // [col][row] state at the start of this step
  wins: SymbolWin[]
  winCells: Cell[] // every cell cleared this step (winners + wilds)
  pinataCells: Cell[] // piñatas that broke this step (advance the track)
  bombCells: BombCell[] // candy bombs on the board this step (bonus only)
  stepPay: number // Σ win pay (× bet, pre multiplier-track)
  trackAfter: number // track step after this step's piñatas broke
}

export interface SpinSequence {
  steps: SpinStep[]
  restGrid: SpinCell[][] // final settled grid (no winners) the client lands on
  trackBefore: number // track step entering this sequence (bonus carry-over)
  trackAfter: number // track step when the sequence ended
  bombSum: number // Σ candy-bomb values collected this sequence (bonus)
  basePay: number // Σ all win pay (× bet, pre multiplier-track)
  multiplier: number // effective multiplier applied = trackAfter + bombSum
  win: number // currency paid by this sequence (× bet)
}

export interface BonusSpin {
  round: number
  sequence: SpinSequence
  spinWin: number // currency this free spin paid (× bet)
}

export interface BonusResult {
  spins: BonusSpin[]
  finalTrack: number // track step when the feature ended
  bonusPayout: number // currency the feature paid (× bet, pre cap)
}

export interface SpinataResult {
  bet: number
  cost: number // currency actually staked this round (bet, or the buy price)
  feature: SpinataFeature | null
  grid: SpinCell[][] // initial base drop [col][row]
  scatterCells: Cell[]
  scatterCount: number
  base: SpinSequence
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

function cloneGrid(grid: SpinCell[][]): SpinCell[][] {
  return grid.map(col => col.map(cell => ({ ...cell })))
}

function fullDrop(cfg: DrawConfig): SpinCell[][] {
  const grid: SpinCell[][] = []
  for (let col = 0; col < SPN_COLS; col++) {
    const column: SpinCell[] = []
    for (let row = 0; row < SPN_ROWS; row++) column.push(drawCell(cfg))
    grid.push(column)
  }
  return grid
}

function cellsOf(grid: SpinCell[][], s: SpinSymbol): Cell[] {
  const out: Cell[] = []
  for (let col = 0; col < SPN_COLS; col++) {
    for (let row = 0; row < SPN_ROWS; row++) {
      if (grid[col]![row]!.s === s) out.push({ col, row })
    }
  }
  return out
}

function bombsOf(grid: SpinCell[][]): BombCell[] {
  const out: BombCell[] = []
  for (let col = 0; col < SPN_COLS; col++) {
    for (let row = 0; row < SPN_ROWS; row++) {
      const cell = grid[col]![row]!
      if (cell.s === 'mult') out.push({ col, row, value: cell.v ?? 0 })
    }
  }
  return out
}

// Pay-anywhere evaluation: every symbol type with SPN_MIN_MATCH+ occurrences
// (wilds substituting for all of them) pays. Returns the wins plus the wild
// cells, which are cleared whenever any win lands.
function findWins(grid: SpinCell[][]): { wins: SymbolWin[], wildCells: Cell[] } {
  const wildCells = cellsOf(grid, 'wild')
  const wins: SymbolWin[] = []

  for (const sym of PAY_KEYS) {
    const cells = cellsOf(grid, sym)
    const count = cells.length + wildCells.length
    if (count >= SPN_MIN_MATCH) {
      wins.push({ symbol: sym, cells, count, pay: matchPayMult(sym, count) })
    }
  }

  return { wins, wildCells }
}

// Remove the cleared cells and tumble: survivors keep their top-to-bottom order
// and pack to the BOTTOM of each column, fresh cells fill the top holes.
function tumble(grid: SpinCell[][], cleared: Cell[], cfg: DrawConfig): SpinCell[][] {
  const dead = new Set(cleared.map(c => key(c.col, c.row)))
  const next: SpinCell[][] = []
  for (let col = 0; col < SPN_COLS; col++) {
    const survivors: SpinCell[] = []
    for (let row = 0; row < SPN_ROWS; row++) {
      if (!dead.has(key(col, row))) survivors.push(grid[col]![row]!)
    }
    const holes = SPN_ROWS - survivors.length
    const fresh: SpinCell[] = Array.from({ length: holes }, () => drawCell(cfg))
    next.push([...fresh, ...survivors]) // fresh on top, survivors at bottom
  }
  return next
}

// --- one tumble sequence ----------------------------------------------------

// Runs a full cascade from `startGrid`. `track` carries the multiplier-track
// step (persistent across a bonus, reset per base spin by the caller).
function runSequence(startGrid: SpinCell[][], track: { step: number }, cfg: DrawConfig): SpinSequence {
  const trackBefore = track.step
  const refillCfg: DrawConfig = { ...cfg, refill: true }
  let grid = startGrid
  const steps: SpinStep[] = []
  let basePay = 0
  let bombSum = 0

  for (let i = 0; i < SPN_MAX_CASCADE; i++) {
    const { wins, wildCells } = findWins(grid)
    if (!wins.length) break

    const winCells: Cell[] = [...wildCells]
    let stepPay = 0
    for (const w of wins) {
      stepPay += w.pay
      for (const c of w.cells) winCells.push(c)
    }
    basePay += stepPay

    // Every piñata on the board breaks on a paying tumble and climbs the track.
    const pinataCells = cellsOf(grid, 'pinata')
    track.step = Math.min(track.step + pinataCells.length, SPN_TRACK_CAP)

    // Candy bombs on the board this step contribute to the sequence multiplier.
    const bombCells = cfg.bonus ? bombsOf(grid) : []
    for (const b of bombCells) bombSum += b.value

    steps.push({
      grid: cloneGrid(grid),
      wins,
      winCells,
      pinataCells,
      bombCells,
      stepPay,
      trackAfter: track.step
    })

    // Broken piñatas and collected bombs clear along with the winners.
    const cleared = [...winCells, ...pinataCells, ...bombCells.map(b => ({ col: b.col, row: b.row }))]
    grid = tumble(grid, cleared, refillCfg)
  }

  const multiplier = track.step + bombSum
  const win = basePay > 0 ? basePay * multiplier : 0

  return { steps, restGrid: grid, trackBefore, trackAfter: track.step, bombSum, basePay, multiplier, win }
}

// An empty sequence — the (visual-only) base for a bought bonus, where the
// player skips the paid spin and lands straight in the free spins.
function emptySequence(grid: SpinCell[][]): SpinSequence {
  return { steps: [], restGrid: grid, trackBefore: SPN_TRACK_START, trackAfter: SPN_TRACK_START, bombSum: 0, basePay: 0, multiplier: SPN_TRACK_START, win: 0 }
}

// --- bonus ------------------------------------------------------------------

function runBonus(startStep: number): BonusResult {
  const track = { step: startStep } // persistent across the whole feature
  const bonusCfg: DrawConfig = { bonus: true, refill: false, scatterOdds: 1 }
  const spins: BonusSpin[] = []
  let bonusPayout = 0

  for (let round = 1; round <= SPN_FREE_SPINS; round++) {
    const grid = fullDrop(bonusCfg)
    const sequence = runSequence(grid, track, bonusCfg)
    bonusPayout += sequence.win
    spins.push({ round, sequence, spinWin: sequence.win })
  }

  return { spins, finalTrack: track.step, bonusPayout }
}

// --- main entry -------------------------------------------------------------

export function playSpinata(bet: number, options?: Record<string, unknown>): SpinataResult {
  if (!Number.isFinite(bet) || bet <= 0) {
    throw createError({ statusCode: 400, message: 'Invalid bet amount' })
  }

  const feature = (options?.feature ?? null) as SpinataFeature | null
  const bought = feature === 'buyFestival' || feature === 'buySuperFestival'

  let cost = bet
  let grid: SpinCell[][]
  let base: SpinSequence
  let basePayout: number
  let bonusTriggered: boolean
  let bonus: BonusResult | null

  if (bought) {
    // Pay the buy price, skip the paid spin, go straight to the free spins.
    cost = bet * (feature === 'buySuperFestival' ? SPN_BUY_SUPER_COST : SPN_BUY_FESTIVAL_COST)
    const cosmeticCfg: DrawConfig = { bonus: false, refill: true, scatterOdds: 1 }
    grid = fullDrop(cosmeticCfg) // purely cosmetic — pays nothing
    // Seed the trigger scatters so the initial drop reads as a real trigger.
    const placed = new Set<string>()
    while (placed.size < SPN_SCATTER_TRIGGER) {
      const col = randInt(SPN_COLS)
      const row = randInt(SPN_ROWS)
      const k = key(col, row)
      if (placed.has(k)) continue
      placed.add(k)
      grid[col]![row] = { s: 'scatter' }
    }
    base = emptySequence(grid)
    basePayout = 0
    bonusTriggered = true
    bonus = runBonus(feature === 'buySuperFestival' ? SPN_SUPER_START_STEP : SPN_TRACK_START)
  } else {
    if (feature === 'doubleChance') cost = bet * SPN_DOUBLE_CHANCE_COST
    const baseCfg: DrawConfig = {
      bonus: false,
      refill: false,
      scatterOdds: feature === 'doubleChance' ? 2 : 1
    }
    grid = fullDrop(baseCfg)

    const track = { step: SPN_TRACK_START } // base game: resets every spin
    base = runSequence(grid, track, baseCfg)
    basePayout = base.win * bet
    bonusTriggered = cellsOf(grid, 'scatter').length >= SPN_SCATTER_TRIGGER
    bonus = bonusTriggered ? runBonus(SPN_TRACK_START) : null
  }

  const scatterCells = cellsOf(grid, 'scatter')
  const scatterCount = scatterCells.length
  const bonusPayout = (bonus?.bonusPayout ?? 0) * bet

  let payout = basePayout + bonusPayout
  const maxWin = bet * SPN_MAX_WIN_MULT
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
