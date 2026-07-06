// shared/utils/gamelogic/bookofshadows.ts
//
// "Book of Shadows" — a 5×6 grid slot with a BOOK (wild + scatter) bonus.
//
// Connections always start at column 0 and read left → right. From one
// column to the next, a matching symbol can sit in the same row or one row
// up/down (a "zigzag" is allowed, not just a straight line) — so a win is a
// run of columns where each column has at least one cell adjacent (row ±1 or
// same row) to a matching cell in the previous column. BOOK (wild)
// substitutes for every other symbol. Minimum run length is 3 columns.
//
// ── Bonus ("fill the columns") ───────────────────────────────────────────────
// 3+ BOOK symbols anywhere trigger the bonus. The whole bonus playthrough
// (BONUS_SPINS reel spins, which columns lock with the rare bonus wild and
// when, every connection along the way) is precomputed in one shot at the
// UNSCALED baseline value — the player's tier pick only scales the final
// total, it never changes what actually happens, so we only ever have to
// simulate it once regardless of which tier the player ends up on.
//
// The bonus tier (which scales the payout) is picked entirely server-side —
// the client's "roll" button is a purely cosmetic reveal animation with no
// influence on the outcome.
//
// During bonus spins, an unlocked column has a small chance per spin to land
// the rare BONUS_WILD symbol. At most one BONUS_WILD cell is ever placed in a
// column pre-expansion (it's about to fill the whole column anyway, so more
// than one is just visual noise) — once it lands, that whole column expands
// to BONUS_WILD and stays that way (sticky) for the rest of the bonus.
// BONUS_WILD is also a wild, so it substitutes into ordinary paylines too.

export const BOS_COLS = 5
export const BOS_ROWS = 6

export const BOS_MAX_WIN_MULT = 20000 // hard cap on total win, in × bet

export type SlotSymbol
  = 'ten' | 'jack' | 'queen' | 'king' | 'ace'
    | 'raven' | 'cat' | 'potion' | 'cauldron'
    | 'wild' | 'bonuswild'

// Reel strip weights (same for every reel). Higher = more frequent.
// `bonuswild` is deliberately absent — it never comes up in a normal draw,
// only via the bonus's own per-spin column roll (see BONUS_WILD_CHANCE).
export const SYMBOL_WEIGHTS: Record<Exclude<SlotSymbol, 'bonuswild'>, number> = {
  ten: 26, jack: 24, queen: 20, king: 18, ace: 14,
  raven: 10, cat: 8, potion: 6, cauldron: 4,
  wild: 2 // ~1 in 90 spins land 3+ (see scripts/bookofshadows-rtp.ts)
}

// Payout multiplier of the total bet for a connected run of [3, 4, 5] columns.
// The 6-row grid makes connections land far more often than a classic 3-row
// payline slot, so these sit much lower than they look at first glance —
// tuned via scripts/bookofshadows-rtp.ts to land total RTP around 95-96%.
export const PAYTABLE: Record<SlotSymbol, [number, number, number]> = {
  ten: [0.35, 0.9, 1.8],
  jack: [0.35, 0.9, 1.8],
  queen: [0.45, 1.35, 2.7],
  king: [0.55, 1.8, 3.6],
  ace: [0.9, 2.25, 4.5],
  raven: [1.1, 2.7, 6.3],
  cat: [1.35, 3.6, 9],
  potion: [1.8, 4.5, 10.8],
  cauldron: [2.25, 6.3, 16.2],
  wild: [5.4, 16.2, 54],
  bonuswild: [9, 31.5, 108]
}

export const BOS_MIN_CONNECTION = 3

const SYMBOL_KEYS = Object.keys(SYMBOL_WEIGHTS) as Exclude<SlotSymbol, 'bonuswild'>[]
const SYMBOL_WEIGHT_VALUES = SYMBOL_KEYS.map(k => SYMBOL_WEIGHTS[k])

// --- bonus tuning ------------------------------------------------------------

export const BONUS_TRIGGER_COUNT = 3 // BOOK symbols needed anywhere on the grid
export const BONUS_SPINS = 10 // fixed spin count, no resets/extensions
// Chance an unlocked column locks in on any given bonus spin. Tuned via
// scripts/bookofshadows-rtp.ts so a full 5-column clear isn't trivial over
// 10 spins while still being reachable.
const BONUS_WILD_CHANCE = 0.03

// Cost (× bet) of the "Buy Bonus" feature buy. Tuned via
// scripts/bookofshadows-rtp.ts (buyBonus mode) to track the natural bonus RTP.
export const BOS_BUY_BONUS_COST = 7.5

export interface BonusTier { id: string, label: string, multiplier: number }

export const BONUS_TIERS: BonusTier[] = [
  { id: 'ember', label: 'Ember Candle', multiplier: 2 },
  { id: 'chalice', label: 'Silver Chalice', multiplier: 3 },
  { id: 'ravenseye', label: 'Raven\'s Eye', multiplier: 5 },
  { id: 'cauldron', label: 'Witch\'s Cauldron', multiplier: 8 },
  { id: 'bloodmoon', label: 'Blood Moon', multiplier: 15 },
  { id: 'grimoire', label: 'Grimoire', multiplier: 25 }
]

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

function spinSymbol(): SlotSymbol {
  return weightedPick(SYMBOL_KEYS, SYMBOL_WEIGHT_VALUES)
}

// --- result shapes ----------------------------------------------------------

export interface Cell { col: number, row: number }

export interface ConnectionWin {
  symbol: SlotSymbol
  length: number // number of connected columns (3, 4 or 5)
  amount: number // currency won by this connection
  cells: Cell[] // every cell that took part in the connection
}

export interface BonusSpinResult {
  landedGrid: SlotSymbol[][] // as the reels actually land this spin
  expandedGrid: SlotSymbol[][] // after any newly-triggered column fills — used for win eval
  newlyLocked: number[] // columns that expanded to BONUS_WILD this spin
  wins: ConnectionWin[]
  ordinaryPayout: number // wins NOT involving BONUS_WILD — paid at face value, same as a base spin
  wildPayout: number // wins involving BONUS_WILD — this portion is what the tier multiplier scales
  spinPayout: number // ordinaryPayout + wildPayout, unscaled — used for the live per-spin display
}

export interface BonusResult {
  tier: BonusTier // picked server-side; the client only plays a reveal animation for it
  spins: BonusSpinResult[] // the whole precomputed playthrough, in order
  lockedColumnsFinal: number[]
  // The tier multiplier only ever scales the value of the special BONUS_WILD
  // symbol itself — ordinary symbols pay their normal PAYTABLE rate no matter
  // what tier is rolled, so they're summed and paid separately, unscaled.
  ordinaryPayout: number // sum of every spin's non-wild wins, paid as-is
  wildBaseline: number // sum of every spin's BONUS_WILD wins, BEFORE the tier multiplier
}

export interface BookOfShadowsResult {
  bet: number
  grid: SlotSymbol[][] // [col][row]
  wins: ConnectionWin[]
  payout: number
  won: boolean
  maxWin: number
  bonusTriggered?: boolean
  bonus?: BonusResult | null
  cost?: number
  resolvedTier?: BonusTier
  [key: string]: unknown
}

// --- grid + win evaluation ---------------------------------------------------

function generateGrid(): SlotSymbol[][] {
  const grid: SlotSymbol[][] = []
  for (let col = 0; col < BOS_COLS; col++) {
    const column: SlotSymbol[] = []
    for (let row = 0; row < BOS_ROWS; row++) column.push(spinSymbol())
    grid.push(column)
  }
  return grid
}

// DEBUG ONLY: force BONUS_TRIGGER_COUNT distinct cells to BOOK so the bonus
// can be tested on demand instead of waiting on the real odds.
function forcePlaceBonusSymbols(grid: SlotSymbol[][]) {
  const chosen = new Set<number>()
  const totalCells = BOS_COLS * BOS_ROWS
  while (chosen.size < BONUS_TRIGGER_COUNT) chosen.add(Math.floor(rand() * totalCells))
  for (const idx of chosen) {
    const col = Math.floor(idx / BOS_ROWS)
    const row = idx % BOS_ROWS
    grid[col]![row] = 'wild'
  }
}

// A cell matches `symbol` when it holds that symbol or any of `wildSymbols`.
function matches(grid: SlotSymbol[][], col: number, row: number, symbol: SlotSymbol, wildSymbols: readonly SlotSymbol[]): boolean {
  const v = grid[col]![row]!
  return v === symbol || wildSymbols.includes(v)
}

// Union-find over the matching cells for one symbol, connecting a cell to
// adjacent-column cells within row ±1. Two column-0 occurrences of the same
// symbol are NOT automatically the same connection — they only merge if a
// path of matching cells actually links them. This matters because a symbol
// can appear more than once in column 0: one occurrence's run might reach
// length 3+ while another's dies out after 1-2 columns, and only cells in
// the surviving component should pay/highlight.
function findConnectedComponents(grid: SlotSymbol[][], symbol: SlotSymbol, wildSymbols: readonly SlotSymbol[]): Cell[][] {
  const idx = (col: number, row: number) => col * BOS_ROWS + row
  const parent = new Map<number, number>()

  function find(x: number): number {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    while (parent.get(x) !== root) {
      const next = parent.get(x)!
      parent.set(x, root)
      x = next
    }
    return root
  }
  function union(a: number, b: number) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (let col = 0; col < BOS_COLS; col++) {
    for (let row = 0; row < BOS_ROWS; row++) {
      if (matches(grid, col, row, symbol, wildSymbols)) parent.set(idx(col, row), idx(col, row))
    }
  }

  for (let col = 0; col < BOS_COLS - 1; col++) {
    for (let row = 0; row < BOS_ROWS; row++) {
      if (!matches(grid, col, row, symbol, wildSymbols)) continue
      for (const nr of [row - 1, row, row + 1]) {
        if (nr < 0 || nr >= BOS_ROWS) continue
        if (matches(grid, col + 1, nr, symbol, wildSymbols)) union(idx(col, row), idx(col + 1, nr))
      }
    }
  }

  const groups = new Map<number, Cell[]>()
  for (let col = 0; col < BOS_COLS; col++) {
    for (let row = 0; row < BOS_ROWS; row++) {
      if (!matches(grid, col, row, symbol, wildSymbols)) continue
      const root = find(idx(col, row))
      if (!groups.has(root)) groups.set(root, [])
      groups.get(root)!.push({ col, row })
    }
  }

  return [...groups.values()]
}

// `wildSymbols` defaults to just BOOK for the base game. Bonus spins pass
// `['wild', 'bonuswild']` since BONUS_WILD substitutes too — that also means
// a 'wild'-symbol scan and a would-be 'bonuswild' scan see the IDENTICAL
// connected component (both wild types satisfy both scans' match test), so
// bonuswild is never scanned as its own target: a wild-scan win that
// actually contains a bonus wild cell is simply paid at the bonus-wild rate
// instead. Scanning it separately too would double-pay the same cells.
function detectConnections(grid: SlotSymbol[][], bet: number, wildSymbols: readonly SlotSymbol[] = ['wild']): { wins: ConnectionWin[], payout: number } {
  const wins: ConnectionWin[] = []
  let payout = 0

  for (const symbol of SYMBOL_KEYS) {
    for (const cells of findConnectedComponents(grid, symbol, wildSymbols)) {
      if (!cells.some(c => c.col === 0)) continue // connections always start left

      const length = Math.max(...cells.map(c => c.col)) + 1
      if (length < BOS_MIN_CONNECTION) continue

      let paySymbol: SlotSymbol = symbol
      if (symbol === 'wild') {
        const upgrade = cells.find(c => grid[c.col]![c.row] !== 'wild' && wildSymbols.includes(grid[c.col]![c.row]!))
        if (upgrade) paySymbol = grid[upgrade.col]![upgrade.row]!
      }

      const hasRealSymbol = cells.some(c => grid[c.col]![c.row] === paySymbol)
      if (!hasRealSymbol) continue

      const amount = PAYTABLE[paySymbol][length - 3]! * bet
      payout += amount
      wins.push({ symbol: paySymbol, length, amount, cells })
    }
  }

  return { wins, payout }
}

// --- bonus simulation --------------------------------------------------------

function pickBonusTier(): BonusTier {
  return BONUS_TIERS[Math.floor(rand() * BONUS_TIERS.length)]!
}

function simulateBonusSpin(locked: Set<number>): Pick<BonusSpinResult, 'landedGrid' | 'expandedGrid' | 'newlyLocked'> {
  const landedGrid: SlotSymbol[][] = []
  const expandedGrid: SlotSymbol[][] = []
  const newlyLocked: number[] = []

  for (let col = 0; col < BOS_COLS; col++) {
    if (locked.has(col)) {
      const wildColumn = Array.from({ length: BOS_ROWS }, (): SlotSymbol => 'bonuswild')
      landedGrid.push(wildColumn)
      expandedGrid.push([...wildColumn])
      continue
    }

    const column: SlotSymbol[] = []
    for (let row = 0; row < BOS_ROWS; row++) column.push(spinSymbol())

    if (rand() < BONUS_WILD_CHANCE) {
      const triggerRow = Math.floor(rand() * BOS_ROWS)
      const landedColumn = [...column]
      landedColumn[triggerRow] = 'bonuswild' // exactly one cell pre-expansion
      landedGrid.push(landedColumn)
      expandedGrid.push(Array.from({ length: BOS_ROWS }, (): SlotSymbol => 'bonuswild'))
      newlyLocked.push(col)
      locked.add(col)
    } else {
      landedGrid.push(column)
      expandedGrid.push(column)
    }
  }

  return { landedGrid, expandedGrid, newlyLocked }
}

function simulateBonus(bet: number): BonusResult {
  const locked = new Set<number>()
  const spins: BonusSpinResult[] = []
  let ordinaryPayout = 0
  let wildBaseline = 0

  for (let i = 0; i < BONUS_SPINS; i++) {
    const { landedGrid, expandedGrid, newlyLocked } = simulateBonusSpin(locked)
    const { wins, payout } = detectConnections(expandedGrid, bet, ['wild', 'bonuswild'])
    const wildPayout = wins.filter(w => w.symbol === 'bonuswild').reduce((sum, w) => sum + w.amount, 0)
    const spinOrdinary = payout - wildPayout
    spins.push({ landedGrid, expandedGrid, newlyLocked, wins, ordinaryPayout: spinOrdinary, wildPayout, spinPayout: payout })
    ordinaryPayout += spinOrdinary
    wildBaseline += wildPayout
  }

  return {
    tier: pickBonusTier(),
    spins,
    lockedColumnsFinal: [...locked],
    ordinaryPayout: Math.round(ordinaryPayout * 10000) / 10000,
    wildBaseline: Math.round(wildBaseline * 10000) / 10000
  }
}

// --- main entry -------------------------------------------------------------

export function playBookOfShadows(bet: number, options?: Record<string, unknown>): BookOfShadowsResult {
  if (!Number.isFinite(bet) || bet <= 0) {
    throw createError({ statusCode: 400, message: 'Invalid bet amount' })
  }

  const maxWin = bet * BOS_MAX_WIN_MULT

  // Step 2 of the bonus flow: the player already watched the precomputed
  // playthrough and saw their (server-picked) tier revealed. Pay out —
  // no new spin happens here, and (for now, no anti-tamper) we trust the
  // ordinary/wild sums the client sends back. Only the wild portion is
  // scaled by the tier multiplier; ordinary symbols pay their normal rate.
  const resolve = options?.resolveBonus as { ordinaryPayout?: number, wildBaseline?: number, tierId?: string } | undefined
  if (resolve && typeof resolve.ordinaryPayout === 'number' && typeof resolve.wildBaseline === 'number' && typeof resolve.tierId === 'string') {
    const tier = BONUS_TIERS.find(t => t.id === resolve.tierId) ?? BONUS_TIERS[0]!
    const payout = Math.round(Math.min(resolve.ordinaryPayout + resolve.wildBaseline * tier.multiplier, maxWin) * 10000) / 10000
    return {
      bet,
      grid: [],
      wins: [],
      payout,
      won: payout > 0,
      maxWin,
      cost: 0, // the bet was already charged on the triggering spin
      resolvedTier: tier
    }
  }

  // Feature buy: skip waiting for natural odds, force the trigger, and charge
  // the buy-bonus premium instead of the raw bet. `forceBonus` (below) stays a
  // free dev/testing-only hook, not exposed in the UI once buyBonus exists.
  if (options?.buyBonus) {
    const cost = Math.round(bet * BOS_BUY_BONUS_COST * 10000) / 10000
    const grid = generateGrid()
    forcePlaceBonusSymbols(grid)
    const { wins, payout: rawPayout } = detectConnections(grid, bet)
    const bonus = simulateBonus(bet)
    const payout = Math.round(Math.min(rawPayout, maxWin) * 10000) / 10000

    return {
      bet,
      grid,
      wins,
      payout,
      won: true,
      maxWin,
      bonusTriggered: true,
      bonus,
      cost
    }
  }

  const grid = generateGrid()
  if (options?.forceBonus) forcePlaceBonusSymbols(grid)

  const { wins, payout: rawPayout } = detectConnections(grid, bet)

  const scatterCount = grid.flat().filter(s => s === 'wild').length
  const bonusTriggered = scatterCount >= BONUS_TRIGGER_COUNT
  const bonus = bonusTriggered ? simulateBonus(bet) : null

  const payout = Math.round(Math.min(rawPayout, maxWin) * 10000) / 10000

  return {
    bet,
    grid,
    wins,
    payout,
    won: payout > bet,
    maxWin,
    bonusTriggered,
    bonus
  }
}
