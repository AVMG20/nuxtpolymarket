// shared/utils/gamelogic/goldparty.ts
//
// "Gold Party" — a live grid reveal game.
//
// Grid: 5 columns × 8 rows = 40 tiles. Tile indices are row-major:
//   index = row * COLS + col   →   col = index % COLS, row = floor(index / COLS)
//
// Round flow (all pre-computed on the server, the client just animates it):
//   1. Each of the 5 columns rolls a top-bar result:
//        - "nothing"     no effect
//        - "multiplier"  the column rolls ONE value (2/5/10/15/25/50×) and stamps it
//                        onto 1-4 random tiles in that column (all the same value)
//        - "reroll"      re-rolls that column once (nothing / multiplier only)
//   2. After all columns resolve, 2-8 random tiles are revealed as winners.
//   3. Any placed hand on a winning tile pays: handValue × BASE × tile multiplier,
//      where BASE = 2 and the tile multiplier defaults to 1 (so a plain winning hand
//      pays 2×, a 25× tile pays 50×, …).
//
// RTP tuning (target 98%):
//   Every tile is statistically identical, so where hands are placed does not change
//   the odds. Expected return per staked hand:
//       RTP = P(tile is winner) × BASE × E[tile multiplier]
//   Winners are few (2-8, mean 5 → P ≈ 0.125), so the multiplier mix has to carry most
//   of the return. With BASE = 2 and the weights below, E[tile multiplier] ≈ 3.93 and:
//       RTP ≈ 0.125 × 2 × 3.93 ≈ 0.983   (verified ≈ 98.3% by Monte Carlo)
//   You win roughly one round in six — the big wins come from landing several multiplier
//   tiles among your picks. The few-winner constraint forces a fairly flat multiplier
//   distribution; the values are still tiered by colour client-side.
//
// Max win is capped at 2500× the total stake.

const COLS = 5
const ROWS = 8
const TILES = COLS * ROWS // 40
const MAX_WIN_MULTIPLIER = 2500

export const GOLD_PARTY_MAX_HANDS = 20
export const GOLD_PARTY_BASE_MULTIPLIER = 2

// Multiplier values and their relative weights (must sum to ~1).
export const GOLD_PARTY_MULTIPLIERS = [2, 5, 10, 15, 25, 50] as const
const MULTIPLIER_WEIGHTS = [0.18, 0.16, 0.15, 0.15, 0.20, 0.16] as const

// Per-column first-roll probabilities (remaining 0.10 is a reroll).
const P_NOTHING = 0.40
const P_MULTIPLIER = 0.50

// A multiplier column stamps its value onto a random 1-4 tiles.
const TILES_PER_MULTIPLIER_MIN = 1
const TILES_PER_MULTIPLIER_MAX = 4

// Winner tiles per round.
const WINNER_MIN = 2
const WINNER_MAX = 8

export type ColumnRoll = 'nothing' | 'multiplier' | 'reroll'

export interface ColumnResult {
  col: number
  rolls: ColumnRoll[] // 1 entry normally, 2 if the first roll was a reroll
  type: 'nothing' | 'multiplier' // effective final result for the column
  value: number | null // the column's multiplier value, or null
  tiles: number[] // tiles in this column stamped with `value`
}

export interface HandWin {
  tile: number
  multiplier: number // the tile multiplier that was applied (>= 1)
  amount: number // handValue × BASE × multiplier
}

export interface GoldPartyResult {
  handCount: number
  handValue: number
  totalStake: number
  base: number
  placements: number[] // tile indices that hold a hand
  columns: ColumnResult[] // length 5, left to right
  multiplierTiles: Record<number, number> // tile -> multiplier value
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
  for (let i = 0; i < GOLD_PARTY_MULTIPLIERS.length; i++) {
    acc += MULTIPLIER_WEIGHTS[i]!
    if (r < acc) return GOLD_PARTY_MULTIPLIERS[i]!
  }
  return GOLD_PARTY_MULTIPLIERS[GOLD_PARTY_MULTIPLIERS.length - 1]!
}

// Roll a single column result. On the second roll (`allowReroll` false) the reroll
// slot is renormalised across nothing / multiplier so columns resolve in two steps.
function rollColumn(allowReroll: boolean): ColumnRoll {
  const r = rand()
  if (r < P_NOTHING) return 'nothing'
  if (r < P_NOTHING + P_MULTIPLIER) return 'multiplier'
  if (allowReroll) return 'reroll'
  return rand() < P_NOTHING / (P_NOTHING + P_MULTIPLIER) ? 'nothing' : 'multiplier'
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
  const handValue = Number(options?.handValue ?? 0)
  const placements = Array.isArray(options?.placements)
    ? (options!.placements as unknown[]).map(v => Math.trunc(Number(v)))
    : []
  const handCount = placements.length

  if (handCount < 1 || handCount > GOLD_PARTY_MAX_HANDS) {
    throw createError({ statusCode: 400, message: `Place between 1 and ${GOLD_PARTY_MAX_HANDS} hands` })
  }
  if (!Number.isFinite(handValue) || handValue <= 0) {
    throw createError({ statusCode: 400, message: 'Hand value must be greater than 0' })
  }

  const totalStake = handCount * handValue
  if (Math.abs(totalStake - bet) > 0.01) {
    throw createError({ statusCode: 400, message: 'Bet must equal hand count × hand value' })
  }

  // Validate placements: distinct, in-range tiles.
  const unique = new Set(placements)
  if (unique.size !== handCount) {
    throw createError({ statusCode: 400, message: 'Duplicate hand placement' })
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
    let roll = rollColumn(true)
    rolls.push(roll)
    if (roll === 'reroll') {
      roll = rollColumn(false)
      rolls.push(roll)
    }

    if (roll === 'multiplier') {
      const value = pickMultiplierValue()
      const count = randInt(TILES_PER_MULTIPLIER_MIN, TILES_PER_MULTIPLIER_MAX)
      const tiles = pickDistinct(tilesInColumn(col), count).sort((a, b) => a - b)
      for (const tile of tiles) multiplierTiles[tile] = value
      columns.push({ col, rolls, type: 'multiplier', value, tiles })
    } else {
      columns.push({ col, rolls, type: 'nothing', value: null, tiles: [] })
    }
  }

  // 2. Reveal winner tiles.
  const winnerCount = randInt(WINNER_MIN, WINNER_MAX)
  const allTiles = Array.from({ length: TILES }, (_, i) => i)
  const winnerTiles = pickDistinct(allTiles, winnerCount).sort((a, b) => a - b)
  const winnerSet = new Set(winnerTiles)

  // 3. Compute payout from placed hands on winning tiles.
  const base = GOLD_PARTY_BASE_MULTIPLIER
  const wins: HandWin[] = []
  let payout = 0
  for (const tile of placements) {
    if (winnerSet.has(tile)) {
      const multiplier = multiplierTiles[tile] ?? 1
      const amount = handValue * base * multiplier
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
    base,
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
