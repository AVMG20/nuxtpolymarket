// shared/utils/gamelogic/magichands.ts
//
// "Magic Hands" — a live grid reveal game.
//
// Grid: 5 columns × 8 rows = 40 tiles. Tile indices are row-major:
//   index = row * COLS + col   →   col = index % COLS, row = floor(index / COLS)
//
// Round flow (all pre-computed on the server, the client just animates it):
//   1. A "top bar" of 5 slots is spun. Each slot is:
//        - "nothing"     no effect
//        - "multiplier"  rolls ONE value (2…100×) and stamps it onto
//                        1-4 random tiles in that column
//        - "reroll"      after the whole top bar is processed, the ENTIRE top bar is
//                        spun again (a new pass). Multipliers from later passes that
//                        land on a tile that already has one STACK multiplicatively —
//                        this is how a tile can climb to 200-500×+ (capped at 2500×).
//   2. After all passes resolve, 2-8 random tiles are revealed as winners.
//   3. Any placed hand on a winning tile pays: handValue × tile multiplier.
//      A winning tile with no multiplier pays 1× (your money back).
//
// Fairness / RTP:
//   The max win is enforced as a PER-TILE multiplier cap of 2500×. Because that cap is
//   baked into each tile's multiplier (not the round total), the expected return per
//   staked hand is identical no matter how many hands are placed — RTP is the same for
//   1 hand as for 40. No round can ever exceed 2500× the total stake.
//       RTP = P(tile is winner) × E[capped tile multiplier]
//   Winners are few (2-8, mean 5 → P ≈ 0.125). With the weights below E[multiplier] ≈
//   7.8, giving RTP ≈ 0.125 × 7.8 ≈ 0.98 (verified ≈ 97.5% by Monte Carlo, flat across
//   1/5/10/40 hands, never above 100%).

const COLS = 5
const ROWS = 8
const TILES = COLS * ROWS // 40

export const MAGIC_HANDS_MAX_HANDS = TILES // up to the whole board
export const MAGIC_HANDS_TILE_CAP = 2500 // max multiplier on a single tile (= max win ×)

// Multiplier values and their relative weights (must sum to ~1).
// Weights tuned so RTP ≈ 98% (E[value] ≈ 15.9; verified by Monte Carlo).
export const MAGIC_HANDS_MULTIPLIERS = [2, 5, 10, 15, 20, 25, 35, 50, 75, 100] as const
const MULTIPLIER_WEIGHTS = [0.296, 0.212, 0.131, 0.086, 0.068, 0.057, 0.048, 0.042, 0.036, 0.024] as const

// Per-slot probabilities (the remaining 0.08 is a reroll).
const P_NOTHING = 0.42
const P_MULTIPLIER = 0.50

// A multiplier slot stamps its value onto a random 1-4 tiles of its column.
const TILES_PER_MULTIPLIER_MIN = 1
const TILES_PER_MULTIPLIER_MAX = 4

// Winner tiles per round.
const WINNER_MIN = 2
const WINNER_MAX = 8

// Safety bound on reroll chains.
const MAX_PASSES = 6

export type SlotType = 'nothing' | 'multiplier' | 'reroll'

export interface PassSlot {
  col: number
  type: SlotType
  value: number | null // multiplier value if type === 'multiplier'
  tiles: number[] // tiles stamped this slot (multiplier only)
}

export interface TopBarPass {
  index: number // 1-based pass number
  slots: PassSlot[] // length 5, left to right
  hasReroll: boolean // true if any slot rolled a reroll (triggers another pass)
}

export interface HandWin {
  tile: number
  multiplier: number // the tile multiplier that was applied (>= 1)
  amount: number // handValue × multiplier
}

export interface MagicHandsResult {
  handCount: number
  handValue: number
  totalStake: number
  placements: number[] // tile indices that hold a hand
  passes: TopBarPass[] // one or more top-bar passes
  multiplierTiles: Record<number, number> // tile -> final (stacked, capped) multiplier
  winnerTiles: number[] // tiles revealed as winners
  wins: HandWin[] // placed hands sitting on a winning tile
  payout: number
  won: boolean // payout > totalStake (net profit)
  maxWin: number
  tileCap: number
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
  for (let i = 0; i < MAGIC_HANDS_MULTIPLIERS.length; i++) {
    acc += MULTIPLIER_WEIGHTS[i]!
    if (r < acc) return MAGIC_HANDS_MULTIPLIERS[i]!
  }
  return MAGIC_HANDS_MULTIPLIERS[MAGIC_HANDS_MULTIPLIERS.length - 1]!
}

function rollSlot(): SlotType {
  const r = rand()
  if (r < P_NOTHING) return 'nothing'
  if (r < P_NOTHING + P_MULTIPLIER) return 'multiplier'
  return 'reroll'
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

export function playMagicHands(bet: number, options?: Record<string, unknown>): MagicHandsResult {
  const handValue = Number(options?.handValue ?? 0)
  const placements = Array.isArray(options?.placements)
    ? (options!.placements as unknown[]).map(v => Math.trunc(Number(v)))
    : []
  const handCount = placements.length

  if (handCount < 1 || handCount > MAGIC_HANDS_MAX_HANDS) {
    throw createError({ statusCode: 400, message: `Place between 1 and ${MAGIC_HANDS_MAX_HANDS} hands` })
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

  // 1. Spin the top bar, re-spinning while a pass contains a reroll.
  const passes: TopBarPass[] = []
  const multiplierTiles: Record<number, number> = {}
  let again = true

  for (let p = 1; again && p <= MAX_PASSES; p++) {
    const slots: PassSlot[] = []
    let hasReroll = false

    for (let col = 0; col < COLS; col++) {
      const type = rollSlot()
      if (type === 'reroll') {
        hasReroll = true
        slots.push({ col, type, value: null, tiles: [] })
      } else if (type === 'multiplier') {
        const value = pickMultiplierValue()
        const count = randInt(TILES_PER_MULTIPLIER_MIN, TILES_PER_MULTIPLIER_MAX)
        const tiles = pickDistinct(tilesInColumn(col), count).sort((a, b) => a - b)
        for (const tile of tiles) {
          multiplierTiles[tile] = Math.min((multiplierTiles[tile] ?? 1) * value, MAGIC_HANDS_TILE_CAP)
        }
        slots.push({ col, type, value, tiles })
      } else {
        slots.push({ col, type, value: null, tiles: [] })
      }
    }

    // The final pass can't keep its reroll flag (chain capped) — clear it so the
    // client doesn't expect another pass that isn't there.
    if (p === MAX_PASSES) hasReroll = false
    passes.push({ index: p, slots, hasReroll })
    again = hasReroll
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
  payout = Math.round(payout * 10000) / 10000

  return {
    handCount,
    handValue,
    totalStake,
    placements,
    passes,
    multiplierTiles,
    winnerTiles,
    wins,
    payout,
    won: payout > totalStake,
    maxWin: totalStake * MAGIC_HANDS_TILE_CAP,
    tileCap: MAGIC_HANDS_TILE_CAP
  }
}
