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
// when, every connection along the way) is precomputed in one shot, the tier
// is picked server-side, and the ENTIRE payout (trigger-spin grid win + bonus
// total) is settled on the triggering call. The client's "roll" button and
// the bonus spins it plays afterwards are purely cosmetic replays of this
// precomputed result — no second API call, nothing client-supplied is trusted.
//
// The tier ONLY scales the value of the special BONUS_WILD symbol itself
// (`wildBaseline` → `wildPayout`); every ordinary symbol win during the bonus
// (`ordinaryPayout`) pays at the exact same PAYTABLE rate as a base spin.
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
    | 'sword' | 'orb' | 'scythe' | 'hood'
    | 'book' | 'bonuswild'

// Reel strip weights (same for every reel). Higher = more frequent.
// `bonuswild` is deliberately absent — it never comes up in a normal draw,
// only via the bonus's own per-spin column roll (see BONUS_WILD_CHANCE).
export const SYMBOL_WEIGHTS: Record<Exclude<SlotSymbol, 'bonuswild'>, number> = {
  ten: 26, jack: 24, queen: 20, king: 18, ace: 14,
  sword: 10, orb: 8, scythe: 6, hood: 4,
  book: 2 // ~1 in 90 spins land 3+ (see scripts/bookofshadows-rtp.ts)
}

// Payout multiplier of the total bet for a connected run of [3, 4, 5] columns.
// The 6-row grid makes connections land far more often than a classic 3-row
// payline slot, so these sit much lower than they look at first glance. This
// is the ONE table used everywhere — base spins and bonus spins alike — so a
// symbol is never worth less just because it landed during the bonus.
//
// The base game is now a meaningful chunk of RTP (~40% of the total) rather
// than a slow bleed: these ordinary-symbol values were scaled up ~2.2× so the
// base return sits around 30-55% of total RTP. The bonus still carries the
// rest (~60%) and all of the top-end volatility (skull columns × the rolled
// bonus symbol). Tuned via scripts/bookofshadows-rtp.ts.
export const PAYTABLE: Record<SlotSymbol, [number, number, number]> = {
  ten: [0.18, 0.45, 0.9],
  jack: [0.18, 0.45, 0.9],
  queen: [0.22, 0.65, 1.3],
  king: [0.26, 0.9, 1.8],
  ace: [0.44, 1.1, 2.2],
  sword: [0.55, 1.3, 3],
  orb: [0.66, 1.8, 4.4],
  scythe: [0.9, 2.2, 5.3],
  hood: [1.1, 3, 8],
  book: [1.2, 3.6, 12],
  bonuswild: [4.6, 14, 42]
}

export const BOS_MIN_CONNECTION = 3

const SYMBOL_KEYS = Object.keys(SYMBOL_WEIGHTS) as Exclude<SlotSymbol, 'bonuswild'>[]
const SYMBOL_WEIGHT_VALUES = SYMBOL_KEYS.map(k => SYMBOL_WEIGHTS[k])

// --- bonus tuning ------------------------------------------------------------

export const BONUS_TRIGGER_COUNT = 3 // BOOK symbols needed anywhere on the grid
export const BONUS_SPINS = 10 // base spin count (before any retrigger)

// Retrigger: landing BONUS_RETRIGGER_BOOKS BOOK symbols on a single bonus spin
// awards BONUS_RETRIGGER_SPINS extra spins. This can fire AT MOST ONCE per
// bonus — the moment it does, BOOK symbols stop appearing for the rest of the
// bonus (so it can never chain into a second retrigger).
export const BONUS_RETRIGGER_BOOKS = 3
export const BONUS_RETRIGGER_SPINS = 4

// Chance an unlocked column locks in on any given bonus spin. Lowered so full
// clears stay rare (~1 in 25-30 bonuses); the bonus symbol values are set high
// enough that each lock is worth more, keeping the bonus RTP on target while
// making the game feel more volatile. Tuned via scripts/bookofshadows-rtp.ts.
const BONUS_WILD_CHANCE = 0.07

// Cost (× bet) of the "Buy Bonus" feature buy. Tuned via
// scripts/bookofshadows-rtp.ts (buyBonus mode) to track the natural bonus RTP.
export const BOS_BUY_BONUS_COST = 57

// The bonus "symbol roll": before the spins start, one paytable symbol is
// drawn (weighted — commons are likely, premiums are the dream). Every win
// paid at the skull rate is multiplied by the rolled symbol's multiplier, so
// the player is hoping for a rare symbol AND a board full of skulls. Values
// scale with bet automatically since all pays are × bet.
export interface BonusTier {
  id: string
  symbol: Exclude<SlotSymbol, 'ten' | 'bonuswild'>
  label: string
  multiplier: number
  weight: number
}

// A flatter ladder than a pure jackpot table: the mid tiers pay real
// multipliers (king ×2.5, ace ×4, sword ×8, orb ×20) so you can still hit a big
// win WITHOUT rolling the very top symbol — landing any mid/high tier on a
// multi-column lock pays. The top (scythe ×55, hood ×120) is the dream, but
// no longer the only route to a 5,000x+ hit. Weighted-average multiplier is
// ~2.6, which keeps the bonus around 55-60% of total RTP. The rarest tier
// (hood ×120) still rolls ~0.3% of bonuses — rare, but never impossible.
// BOOK takes TEN's old slot in the ladder — it's already the base game's wild
// and scatter, so as a bonus-tier roll it's deliberately kept common/low value.
export const BONUS_TIERS: BonusTier[] = [
  { id: 'book', symbol: 'book', label: 'Book', multiplier: 1, weight: 32 },
  { id: 'jack', symbol: 'jack', label: 'Jack', multiplier: 1, weight: 26 },
  { id: 'queen', symbol: 'queen', label: 'Queen', multiplier: 1.5, weight: 18 },
  { id: 'king', symbol: 'king', label: 'King', multiplier: 2.5, weight: 10 },
  { id: 'ace', symbol: 'ace', label: 'Ace', multiplier: 4, weight: 6 },
  { id: 'sword', symbol: 'sword', label: 'Sword', multiplier: 8, weight: 3 },
  { id: 'orb', symbol: 'orb', label: 'Orb', multiplier: 20, weight: 1.4 },
  { id: 'scythe', symbol: 'scythe', label: 'Scythe', multiplier: 55, weight: 0.6 },
  { id: 'hood', symbol: 'hood', label: 'Hood', multiplier: 120, weight: 0.3 }
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

// Same weighted draw but with BOOK removed from the pool. Used for the
// remaining bonus spins once the retrigger has fired — after that point books
// can no longer appear.
const NO_BOOK_KEYS = SYMBOL_KEYS.filter(k => k !== 'book')
const NO_BOOK_WEIGHTS = NO_BOOK_KEYS.map(k => SYMBOL_WEIGHTS[k])
function spinSymbolNoBook(): SlotSymbol {
  return weightedPick(NO_BOOK_KEYS, NO_BOOK_WEIGHTS)
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
  booksLanded: number // BOOK cells that landed this spin
  retriggered: boolean // true only on the spin that awarded the +BONUS_RETRIGGER_SPINS
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
  wildPayout: number // wildBaseline × tier.multiplier — what the wild wins actually pay
  totalWin: number // ordinaryPayout + wildPayout — the bonus's full payout, pre max-win cap
  retriggered: boolean // whether the +BONUS_RETRIGGER_SPINS ever fired this bonus
  totalSpins: number // BONUS_SPINS, plus BONUS_RETRIGGER_SPINS if it retriggered
}

export interface BookOfShadowsResult {
  bet: number
  grid: SlotSymbol[][] // [col][row]
  wins: ConnectionWin[]
  payout: number
  won: boolean
  maxWin: number
  basePayout: number // the triggering grid's own wins (payout minus the bonus part)
  bonusTriggered?: boolean
  bonus?: BonusResult | null
  cost?: number
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
    grid[col]![row] = 'book'
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
// `['book', 'bonuswild']` since BONUS_WILD substitutes too — that also means
// a 'book'-symbol scan and a would-be 'bonuswild' scan see the IDENTICAL
// connected component (both wild types satisfy both scans' match test), so
// bonuswild is never scanned as its own target: a wild-scan win that
// actually contains a bonus wild cell is simply paid at the bonus-wild rate
// instead. Scanning it separately too would double-pay the same cells.
function detectConnections(grid: SlotSymbol[][], bet: number, wildSymbols: readonly SlotSymbol[] = ['book']): { wins: ConnectionWin[], payout: number } {
  const wins: ConnectionWin[] = []
  let payout = 0

  for (const symbol of SYMBOL_KEYS) {
    for (const cells of findConnectedComponents(grid, symbol, wildSymbols)) {
      if (!cells.some(c => c.col === 0)) continue // connections always start left

      const length = Math.max(...cells.map(c => c.col)) + 1
      if (length < BOS_MIN_CONNECTION) continue

      let paySymbol: SlotSymbol = symbol
      if (symbol === 'book') {
        const upgrade = cells.find(c => grid[c.col]![c.row] !== 'book' && wildSymbols.includes(grid[c.col]![c.row]!))
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
  return weightedPick(BONUS_TIERS, BONUS_TIERS.map(t => t.weight))
}

function simulateBonusSpin(locked: Set<number>, booksAllowed: boolean): Pick<BonusSpinResult, 'landedGrid' | 'expandedGrid' | 'newlyLocked'> {
  const landedGrid: SlotSymbol[][] = []
  const expandedGrid: SlotSymbol[][] = []
  const newlyLocked: number[] = []
  const draw = booksAllowed ? spinSymbol : spinSymbolNoBook

  for (let col = 0; col < BOS_COLS; col++) {
    if (locked.has(col)) {
      const wildColumn = Array.from({ length: BOS_ROWS }, (): SlotSymbol => 'bonuswild')
      landedGrid.push(wildColumn)
      expandedGrid.push([...wildColumn])
      continue
    }

    const column: SlotSymbol[] = []
    for (let row = 0; row < BOS_ROWS; row++) column.push(draw())

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

  // Spin count can grow once, via the BOOK retrigger. `booksAllowed` starts
  // true and flips off permanently the moment the retrigger fires, so BOOK
  // symbols vanish for the rest of the bonus and it can never chain.
  let totalSpins = BONUS_SPINS
  let booksAllowed = true
  let retriggered = false

  for (let i = 0; i < totalSpins; i++) {
    const { landedGrid, expandedGrid, newlyLocked } = simulateBonusSpin(locked, booksAllowed)

    const booksLanded = landedGrid.reduce(
      (n, colCells) => n + colCells.reduce((m, s) => m + (s === 'book' ? 1 : 0), 0),
      0
    )

    let spinRetriggered = false
    if (booksAllowed && !retriggered && booksLanded >= BONUS_RETRIGGER_BOOKS) {
      retriggered = true
      spinRetriggered = true
      booksAllowed = false // no more BOOK symbols for the rest of the bonus
      totalSpins += BONUS_RETRIGGER_SPINS
    }

    const { wins, payout } = detectConnections(expandedGrid, bet, ['book', 'bonuswild'])
    const wildPayout = wins.filter(w => w.symbol === 'bonuswild').reduce((sum, w) => sum + w.amount, 0)
    const spinOrdinary = payout - wildPayout
    spins.push({ landedGrid, expandedGrid, newlyLocked, wins, ordinaryPayout: spinOrdinary, wildPayout, spinPayout: payout, booksLanded, retriggered: spinRetriggered })
    ordinaryPayout += spinOrdinary
    wildBaseline += wildPayout
  }

  const tier = pickBonusTier()
  const ordinary = Math.round(ordinaryPayout * 10000) / 10000
  const baseline = Math.round(wildBaseline * 10000) / 10000
  const wildPayout = Math.round(baseline * tier.multiplier * 10000) / 10000

  return {
    tier,
    spins,
    lockedColumnsFinal: [...locked],
    ordinaryPayout: ordinary,
    wildBaseline: baseline,
    wildPayout,
    totalWin: Math.round((ordinary + wildPayout) * 10000) / 10000,
    retriggered,
    totalSpins
  }
}

// --- main entry -------------------------------------------------------------

export function playBookOfShadows(bet: number, options?: Record<string, unknown>): BookOfShadowsResult {
  if (!Number.isFinite(bet) || bet <= 0) {
    throw createError({ statusCode: 400, message: 'Invalid bet amount' })
  }

  const maxWin = bet * BOS_MAX_WIN_MULT

  // Feature buy: skip waiting for natural odds, force the trigger, and charge
  // the buy-bonus premium instead of the raw bet. `forceBonus` (below) stays a
  // free dev/testing-only hook, not exposed in the UI once buyBonus exists.
  if (options?.buyBonus) {
    const cost = Math.round(bet * BOS_BUY_BONUS_COST * 10000) / 10000
    const grid = generateGrid()
    forcePlaceBonusSymbols(grid)
    const { wins, payout: rawPayout } = detectConnections(grid, bet)
    const bonus = simulateBonus(bet)
    const basePayout = Math.round(Math.min(rawPayout, maxWin) * 10000) / 10000
    // The full round — trigger grid + every bonus spin, tier already applied —
    // settles right here in one call.
    const payout = Math.round(Math.min(rawPayout + bonus.totalWin, maxWin) * 10000) / 10000

    return {
      bet,
      grid,
      wins,
      payout,
      basePayout,
      won: payout > 0,
      maxWin,
      bonusTriggered: true,
      bonus,
      cost
    }
  }

  const grid = generateGrid()
  if (options?.forceBonus) forcePlaceBonusSymbols(grid)

  const { wins, payout: rawPayout } = detectConnections(grid, bet)

  const scatterCount = grid.flat().filter(s => s === 'book').length
  const bonusTriggered = scatterCount >= BONUS_TRIGGER_COUNT
  const bonus = bonusTriggered ? simulateBonus(bet) : null

  const basePayout = Math.round(Math.min(rawPayout, maxWin) * 10000) / 10000
  const payout = Math.round(Math.min(rawPayout + (bonus?.totalWin ?? 0), maxWin) * 10000) / 10000

  return {
    bet,
    grid,
    wins,
    payout,
    basePayout,
    won: payout > bet,
    maxWin,
    bonusTriggered,
    bonus
  }
}
