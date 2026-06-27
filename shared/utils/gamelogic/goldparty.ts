// shared/utils/gamelogic/goldparty.ts
//
// "Gold Party" — a live grid reveal game.
//
// Grid: 5 columns × 8 rows = 40 tiles. Tile indices are row-major:
//   index = row * COLS + col   →   col = index % COLS, row = floor(index / COLS)
//
// Round flow (all pre-computed on the server, the client just animates it):
//   1. Each of the 5 columns rolls a top-bar result:
//        - "nothing"    (~65%)  no effect
//        - "multiplier" (~25%)  1-3 random tiles in that column get a multiplier
//        - "reroll"     (~10%)  re-rolls that column once (nothing / multiplier only)
//   2. After all columns resolve, a number of random tiles are revealed as winners.
//   3. Any placed hand on a winning tile pays: handValue × tile multiplier (default 1×).
//
// RTP tuning (target 98%):
//   Every tile is statistically identical, so the placement of hands does not change
//   the odds. The expected return per staked hand is:
//       RTP = P(tile is winner) × E[tile multiplier]
//   With the multiplier frequencies below, E[tile multiplier] ≈ 1.40, and drawing the
//   winner count uniformly from [24, 32] (mean 28) gives:
//       RTP = (28 / 40) × 1.40 ≈ 0.981 ≈ 98%   (verified ≈ 98.1% by Monte Carlo)
//   The winner count is the documented tuning knob — a base 1× payout with few winners
//   cannot reach 98% RTP, so winners are intentionally dense.
//
// Max win is capped at 2500× the total stake.

const COLS = 5
const ROWS = 8
const TILES = COLS * ROWS // 40
const MAX_WIN_MULTIPLIER = 2500

export const GOLD_PARTY_MAX_HANDS = 10

// Multiplier values and their relative weights (must sum to ~1).
const MULTIPLIER_VALUES = [2, 5, 10, 15, 25] as const
const MULTIPLIER_WEIGHTS = [0.40, 0.28, 0.17, 0.10, 0.05] as const

// Per-column first-roll probabilities.
const P_NOTHING = 0.65
const P_MULTIPLIER = 0.25
// remaining 0.10 is reroll

// Winner count is drawn uniformly from [WINNER_MIN, WINNER_MAX] inclusive (mean 28).
const WINNER_MIN = 24
const WINNER_MAX = 32

export type ColumnRoll = 'nothing' | 'multiplier' | 'reroll'

export interface MultiplierAssignment {
  tile: number // global tile index 0..39
  value: number // multiplier value (2, 5, 10, 15 or 25)
}

export interface ColumnResult {
  col: number
  rolls: ColumnRoll[] // 1 entry normally, 2 if the first roll was a reroll
  type: 'nothing' | 'multiplier' // effective final result for the column
  multipliers: MultiplierAssignment[]
}

export interface HandWin {
  tile: number
  multiplier: number // the tile multiplier that was applied (>= 1)
  amount: number // handValue × multiplier
}

export interface GoldPartyResult {
  handCount: number
  handValue: number
  totalStake: number
  placements: number[] // tile indices that hold a hand
  columns: ColumnResult[] // length 5, left to right
  multiplierTiles: Record<number, number> // tile -> multiplier value (aggregated)
  winnerTiles: number[] // tiles revealed as winners
  wins: HandWin[] // placed hands sitting on a winning tile
  payout: number
  won: boolean // payout > totalStake (net profit)
  maxWin: number
  [key: string]: unknown
}

// --- crypto RNG helpers -----------------------------------------------------

function rand(): number {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return arr[0]! / 0x1_0000_0000 // [0, 1)
}

function randInt(minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rand() * (maxInclusive - minInclusive + 1))
}

function pickMultiplierValue(): number {
  const r = rand()
  let acc = 0
  for (let i = 0; i < MULTIPLIER_VALUES.length; i++) {
    acc += MULTIPLIER_WEIGHTS[i]!
    if (r < acc) return MULTIPLIER_VALUES[i]!
  }
  return MULTIPLIER_VALUES[MULTIPLIER_VALUES.length - 1]!
}

// Roll a single column result. `allowReroll` is false on the second roll so reroll
// columns resolve in at most two steps.
function rollColumn(allowReroll: boolean): ColumnRoll {
  const r = rand()
  if (r < P_NOTHING) return 'nothing'
  if (r < P_NOTHING + P_MULTIPLIER) return 'multiplier'
  return allowReroll ? 'reroll' : 'multiplier'
}

// Tiles belonging to a given column, top to bottom.
function tilesInColumn(col: number): number[] {
  const out: number[] = []
  for (let row = 0; row < ROWS; row++) out.push(row * COLS + col)
  return out
}

// Pick `count` distinct values from `pool`.
function pickDistinct(pool: number[], count: number): number[] {
  const copy = [...pool]
  const out: number[] = []
  const n = Math.min(count, copy.length)
  for (let i = 0; i < n; i++) {
    const idx = randInt(0, copy.length - 1)
    out.push(copy.splice(idx, 1)[0]!)
  }
  return out
}

// --- main entry -------------------------------------------------------------

export function playGoldParty(bet: number, options?: Record<string, unknown>): GoldPartyResult {
  const handCount = Math.trunc(Number(options?.handCount ?? 0))
  const handValue = Number(options?.handValue ?? 0)
  const placements = Array.isArray(options?.placements)
    ? (options!.placements as unknown[]).map(v => Math.trunc(Number(v)))
    : []

  if (!Number.isFinite(handCount) || handCount < 1 || handCount > GOLD_PARTY_MAX_HANDS) {
    throw createError({ statusCode: 400, message: `Hand count must be between 1 and ${GOLD_PARTY_MAX_HANDS}` })
  }
  if (!Number.isFinite(handValue) || handValue <= 0) {
    throw createError({ statusCode: 400, message: 'Hand value must be greater than 0' })
  }

  const totalStake = handCount * handValue
  if (Math.abs(totalStake - bet) > 0.01) {
    throw createError({ statusCode: 400, message: 'Bet must equal hand count × hand value' })
  }

  // Validate placements: exactly handCount distinct, in-range tiles.
  const unique = new Set(placements)
  if (placements.length !== handCount || unique.size !== handCount) {
    throw createError({ statusCode: 400, message: `You must place exactly ${handCount} hand(s)` })
  }
  for (const tile of placements) {
    if (!Number.isInteger(tile) || tile < 0 || tile >= TILES) {
      throw createError({ statusCode: 400, message: 'Invalid hand placement' })
    }
  }

  // 1. Resolve each column.
  const columns: ColumnResult[] = []
  const multiplierTiles: Record<number, number> = {}

  for (let col = 0; col < COLS; col++) {
    const rolls: ColumnRoll[] = []
    let first = rollColumn(true)
    rolls.push(first)
    if (first === 'reroll') {
      first = rollColumn(false)
      rolls.push(first)
    }

    const type: 'nothing' | 'multiplier' = first === 'multiplier' ? 'multiplier' : 'nothing'
    const multipliers: MultiplierAssignment[] = []

    if (type === 'multiplier') {
      const count = randInt(1, 3)
      const tiles = pickDistinct(tilesInColumn(col), count)
      for (const tile of tiles) {
        const value = pickMultiplierValue()
        multipliers.push({ tile, value })
        // A tile lives in exactly one column, so no clobbering across columns.
        multiplierTiles[tile] = value
      }
    }

    columns.push({ col, rolls, type, multipliers })
  }

  // 2. Reveal winner tiles.
  const winnerCount = randInt(WINNER_MIN, WINNER_MAX)
  const allTiles = Array.from({ length: TILES }, (_, i) => i)
  const winnerTiles = pickDistinct(allTiles, winnerCount).sort((a, b) => a - b)
  const winnerSet = new Set(winnerTiles)

  // 3. Compute payout from placed hands on winning tiles.
  const wins: HandWin[] = []
  let payout = 0
  for (const tile of placements) {
    if (winnerSet.has(tile)) {
      const multiplier = multiplierTiles[tile] ?? 1
      const amount = handValue * multiplier
      wins.push({ tile, multiplier, amount })
      payout += amount
    }
  }

  const maxWin = totalStake * MAX_WIN_MULTIPLIER
  if (payout > maxWin) payout = maxWin
  payout = Math.round(payout * 10000) / 10000

  return {
    handCount,
    handValue,
    totalStake,
    placements,
    columns,
    multiplierTiles,
    winnerTiles,
    wins,
    payout,
    won: payout > totalStake,
    maxWin
  }
}
