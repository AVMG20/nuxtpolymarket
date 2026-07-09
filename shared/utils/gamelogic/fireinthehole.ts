export const FITH_COLS = 6
export const FITH_ROWS = 6
export const FITH_STARTING_LINES = 3
export const FITH_MAX_LINES = 6
export const FITH_MIN_CONNECTION = 5
export const FITH_MAX_CASCADES = 8
export const FITH_SCATTERS_FOR_BONUS = 3
export const FITH_FREE_SPINS = 10
export const FITH_MAX_BONUS_MULTIPLIER = 20000
export const FITH_MAX_WIN_MULT = 20000
export const FITH_BUY_BONUS_COST = 65 // × bet → ~97.5% RTP (measured via bonus-only sim at FITH_MAX_LINES - 1)

// Base-game coin drop — a coin can land on top of an existing symbol roughly
// 1 in 3 spins. It never joins a cascade cluster itself, but if a bomb
// detonates in the same cascade step that clears its tile, the coin "pops"
// and pays out a flat bet multiplier (the badge's "×N" is always exactly
// N× bet), regardless of whether that tile was directly in the matched
// cluster or only caught in the blast radius.
export const FITH_COIN_DROP_CHANCE = 1 / 3
export const FITH_COIN_MIN_MULT = 1.5
export const FITH_COIN_MAX_MULT = 25

export type FireSymbol = 'coal' | 'ore' | 'ruby' | 'sapphire' | 'emerald' | 'bomb' | 'scatter' | 'coin' | 'boost' | 'double' | 'collector' | 'empty' | 'rock'
export type FirePaySymbol = Extract<FireSymbol, 'coal' | 'ore' | 'ruby' | 'sapphire' | 'emerald'>
export type FireBonusSymbol = 'coin' | 'boost' | 'double' | 'collector'

export interface FireCell {
  col: number
  row: number
}

export interface FireBonusDrop extends FireCell {
  symbol: FireBonusSymbol
  multiplier: number
}

export interface FireBonusValueEvent {
  type: 'add' | 'double' | 'collect'
  source: FireBonusDrop
  target: FireBonusDrop
  amount: number
  before: number
  after: number
}

export interface FireBonusStep {
  spin: number
  grid: FireSymbol[][]
  drops: FireBonusDrop[]
  coins: FireBonusDrop[]
  valueEvents: FireBonusValueEvent[]
  appliedAdd: number
  appliedDouble: boolean
  collected: number
  totalMultiplier: number
}

export interface FireBonusResult {
  triggered: boolean
  freeSpins: number
  activeLines: number
  steps: FireBonusStep[]
  totalMultiplier: number
  payout: number
}

export interface FireCoinDrop extends FireCell {
  multiplier: number
}

export interface FireCoinHit {
  cell: FireCell
  multiplier: number
  bonusPay: number
}

export interface FireCascadeStep {
  grid: FireSymbol[][]
  activeLinesBefore: number
  activeLinesAfter: number
  winCells: FireCell[]
  bombCells: FireCell[]
  unlockedRows: number[]
  stepPay: number
  totalPay: number
  // Base-game coin drop state — coinBefore is where the coin sits (if any)
  // as this step begins, coinHit is populated the moment a bomb blast pops it.
  coinBefore?: FireCoinDrop
  coinHit?: FireCoinHit
}

export interface FireInTheHoleResult {
  bet: number
  cost: number
  payout: number
  basePayout: number
  maxWin: number
  won: boolean
  grid: FireSymbol[][]
  steps: FireCascadeStep[]
  restGrid: FireSymbol[][]
  scatterCells: FireCell[]
  activeLines: number
  maxLines: number
  bonus?: FireBonusResult
  coinDrop?: FireCoinDrop
  restCoinDrop?: FireCoinDrop
  [key: string]: unknown
}

const PAY_SYMBOLS: FirePaySymbol[] = ['coal', 'ore', 'ruby', 'sapphire', 'emerald']
const PAY_WEIGHTS = [34, 28, 18, 13, 9]
const BOMB_WEIGHT = 7
const SCATTER_WEIGHT = 1.4
const SYMBOL_PAY: Record<FirePaySymbol, number> = {
  coal: 0.0134,
  ore: 0.0185,
  ruby: 0.0285,
  sapphire: 0.0394,
  emerald: 0.0545
}

function rand(): number {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return arr[0]! / 0x1_0000_0000
}

function weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let roll = rand() * total

  for (let i = 0; i < items.length; i++) {
    roll -= weights[i]!
    if (roll < 0) return items[i]!
  }

  return items[items.length - 1]!
}

function drawSymbol(canBomb = true): Exclude<FireSymbol, 'coin' | 'boost' | 'double' | 'collector' | 'empty' | 'rock'> {
  if (canBomb) {
    return weightedPick([...PAY_SYMBOLS, 'bomb', 'scatter'] as const, [...PAY_WEIGHTS, BOMB_WEIGHT, SCATTER_WEIGHT])
  }

  return weightedPick([...PAY_SYMBOLS, 'scatter'] as const, [...PAY_WEIGHTS, SCATTER_WEIGHT])
}

function cloneGrid(grid: FireSymbol[][]): FireSymbol[][] {
  return grid.map(col => [...col])
}

function isLocked(row: number, activeLines: number): boolean {
  return row >= activeLines
}

function createGrid(activeLines: number): FireSymbol[][] {
  return Array.from({ length: FITH_COLS }, () =>
    Array.from({ length: FITH_ROWS }, (_, row) => isLocked(row, activeLines) ? 'rock' : drawSymbol())
  )
}

function key(cell: FireCell): string {
  return `${cell.col}:${cell.row}`
}

function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < FITH_COLS && row >= 0 && row < FITH_ROWS
}

function neighbours(cell: FireCell): FireCell[] {
  return [
    { col: cell.col + 1, row: cell.row },
    { col: cell.col - 1, row: cell.row },
    { col: cell.col, row: cell.row + 1 },
    { col: cell.col, row: cell.row - 1 }
  ].filter(next => inBounds(next.col, next.row))
}

function surroundingCells(cell: FireCell): FireCell[] {
  const cells: FireCell[] = []

  for (let col = cell.col - 1; col <= cell.col + 1; col++) {
    for (let row = cell.row - 1; row <= cell.row + 1; row++) {
      if (col === cell.col && row === cell.row) continue
      if (inBounds(col, row)) cells.push({ col, row })
    }
  }

  return cells
}

function detectConnections(grid: FireSymbol[][], activeLines: number): FireCell[] {
  const claimed = new Set<string>()
  const winners: FireCell[] = []

  for (const symbol of PAY_SYMBOLS) {
    const visited = new Set<string>()

    for (let col = 0; col < FITH_COLS; col++) {
      for (let row = 0; row < activeLines; row++) {
        const id = `${col}:${row}`
        const value = grid[col]![row]

        if (visited.has(id) || claimed.has(id) || (value !== symbol && value !== 'bomb')) continue

        const stack: FireCell[] = [{ col, row }]
        const cluster: FireCell[] = []
        let hasPaySymbol = false

        visited.add(id)

        while (stack.length > 0) {
          const current = stack.pop()!
          const currentValue = grid[current.col]![current.row]

          cluster.push(current)
          if (currentValue === symbol) hasPaySymbol = true

          for (const next of neighbours(current)) {
            if (isLocked(next.row, activeLines)) continue

            const nextId = key(next)
            const nextValue = grid[next.col]![next.row]

            if (visited.has(nextId) || claimed.has(nextId)) continue
            if (nextValue !== symbol && nextValue !== 'bomb') continue

            visited.add(nextId)
            stack.push(next)
          }
        }

        if (hasPaySymbol && cluster.length >= FITH_MIN_CONNECTION) {
          for (const cell of cluster) {
            const cellKey = key(cell)

            if (!claimed.has(cellKey)) {
              claimed.add(cellKey)
              winners.push(cell)
            }
          }
        }
      }
    }
  }

  return winners
}

function resolveBombExplosions(grid: FireSymbol[][], connectionCells: FireCell[], activeLines: number) {
  const winByKey = new Map(connectionCells.map(cell => [key(cell), cell]))
  const bombByKey = new Map<string, FireCell>()
  const queue = connectionCells.filter(cell => grid[cell.col]![cell.row] === 'bomb')

  for (const bomb of queue) {
    bombByKey.set(key(bomb), bomb)
  }

  for (let index = 0; index < queue.length; index++) {
    const bomb = queue[index]!

    for (const cell of surroundingCells(bomb)) {
      if (isLocked(cell.row, activeLines)) continue

      const cellKey = key(cell)
      const symbol = grid[cell.col]![cell.row]

      // Scatters are invulnerable to bomb blasts — they survive so the mine
      // stays consistent, but SCATTER_WEIGHT is tuned lower to compensate.
      if (symbol !== 'scatter' && !winByKey.has(cellKey)) {
        winByKey.set(cellKey, cell)
      }

      if (symbol === 'bomb' && !bombByKey.has(cellKey)) {
        bombByKey.set(cellKey, cell)
        queue.push(cell)
      }
    }
  }

  return {
    winCells: [...winByKey.values()],
    bombCells: [...bombByKey.values()],
    lineBombCells: [...bombByKey.values()].filter(cell => cell.row >= activeLines - 2)
  }
}

// Collapses the grid after winners are removed (gravity-drops survivors
// bottom-aligned within their column, refills vacated top slots with new
// symbols), while additionally tracking where a single cell (the base-game
// coin drop) ends up — or reporting it as consumed if it was among the
// winners removed this step.
function collapseGridTracking(
  grid: FireSymbol[][],
  winners: FireCell[],
  activeLines: number,
  tracked: FireCell | null
): { grid: FireSymbol[][], trackedCell: FireCell | null } {
  const next = cloneGrid(grid)
  const removed = new Set(winners.map(key))
  let trackedAfter: FireCell | null = null

  if (tracked && removed.has(key(tracked))) {
    trackedAfter = null
  }

  for (let col = 0; col < FITH_COLS; col++) {
    const survivorRows: number[] = []

    for (let row = activeLines - 1; row >= 0; row--) {
      if (!removed.has(`${col}:${row}`)) survivorRows.push(row)
    }

    const survivorValues = survivorRows.map(row => next[col]![row]!)

    if (tracked && tracked.col === col && !removed.has(key(tracked))) {
      const idx = survivorRows.indexOf(tracked.row)
      if (idx >= 0) trackedAfter = { col, row: activeLines - 1 - idx }
    }

    for (let i = 0; i < survivorRows.length; i++) {
      next[col]![activeLines - 1 - i] = survivorValues[i]!
    }

    for (let row = 0; row < activeLines - survivorRows.length; row++) {
      next[col]![row] = drawSymbol()
    }

    for (let row = activeLines; row < FITH_ROWS; row++) {
      next[col]![row] = 'rock'
    }
  }

  return { grid: next, trackedCell: trackedAfter }
}

function coinDropValue(): number {
  return weightedPick(
    [1.5, 2, 3, 5, 8, 12, 18, 25] as const,
    [70, 15, 8, 4, 2, 0.7, 0.25, 0.05]
  )
}

function applyUnlockedRows(grid: FireSymbol[][], activeLines: number, nextActiveLines: number): number[] {
  if (nextActiveLines <= activeLines) return []

  const unlocked: number[] = []

  for (let row = activeLines; row < nextActiveLines; row++) {
    unlocked.push(row)
    for (let col = 0; col < FITH_COLS; col++) {
      grid[col]![row] = drawSymbol(false)
    }
  }

  return unlocked
}

function calculateStepPay(grid: FireSymbol[][], winCells: FireCell[], chain: number, bet: number): number {
  const symbolPay = winCells.reduce((sum, cell) => {
    const symbol = grid[cell.col]![cell.row]!

    if (!PAY_SYMBOLS.includes(symbol as FirePaySymbol)) return sum

    return sum + SYMBOL_PAY[symbol as FirePaySymbol]
  }, 0)

  return Number((symbolPay * (1 + chain * 0.18) * bet).toFixed(2))
}

function findScatters(grid: FireSymbol[][], activeLines: number): FireCell[] {
  const cells: FireCell[] = []

  for (let col = 0; col < FITH_COLS; col++) {
    for (let row = 0; row < activeLines; row++) {
      if (grid[col]![row] === 'scatter') cells.push({ col, row })
    }
  }

  return cells
}

function buyBonusGrid(activeLines: number): FireSymbol[][] {
  const grid = createGrid(activeLines)
  const cells: FireCell[] = []

  for (let row = 0; row < activeLines; row++) {
    for (let col = 0; col < FITH_COLS; col++) {
      cells.push({ col, row })
    }
  }

  for (let i = 0; i < FITH_SCATTERS_FOR_BONUS && cells.length > 0; i++) {
    const index = Math.floor(rand() * cells.length)
    const [cell] = cells.splice(index, 1)
    if (!cell) continue

    grid[cell.col]![cell.row] = 'scatter'
  }

  return grid
}

function createBonusGrid(activeLines: number): FireSymbol[][] {
  return Array.from({ length: FITH_COLS }, () =>
    Array.from({ length: FITH_ROWS }, (_, row) => isLocked(row, activeLines) ? 'rock' : 'empty')
  )
}

function emptyBonusCells(grid: FireSymbol[][], activeLines: number): FireCell[] {
  const cells: FireCell[] = []

  for (let col = 0; col < FITH_COLS; col++) {
    for (let row = 0; row < activeLines; row++) {
      if (grid[col]![row] === 'empty') cells.push({ col, row })
    }
  }

  return cells
}

// Values kept at a legible floor (never below 0.5x) so a single coin drop
// always reads as a real amount on screen — RTP is tuned via drop
// *frequency* in bonusDropChances below, not by shrinking these numbers.
function bonusCoinValue(): number {
  return weightedPick(
    [0.5, 1, 1.5, 2.5, 4, 6, 10, 18, 35] as const,
    [30, 24, 17, 12, 8, 5, 2.6, 0.9, 0.1]
  )
}

function bonusAddValue(): number {
  return weightedPick([1, 2, 4, 8, 15] as const, [45, 30, 18, 6.8, 1.1])
}

function clampBonusValue(value: number): number {
  return Math.min(FITH_MAX_BONUS_MULTIPLIER, value)
}

function bonusCapacity(activeLines: number): number {
  return FITH_COLS * activeLines
}

function bonusDropChances(occupied: number, capacity: number) {
  const nonCollectorScale = Math.max(0, (capacity - occupied - 1) / Math.max(1, capacity - 1))

  return {
    coin: 0.0125 * nonCollectorScale,
    boost: 0.00275 * nonCollectorScale,
    double: 0.0095 * nonCollectorScale,
    collector: 0.0017
  }
}

function bonusStateToCoins(values: Map<string, { symbol: Exclude<FireBonusSymbol, 'double'>, multiplier: number }>): FireBonusDrop[] {
  return [...values.entries()].map(([id, state]) => {
    const [col, row] = id.split(':').map(Number)

    return { col: col!, row: row!, symbol: state.symbol, multiplier: state.multiplier }
  })
}

function playBonus(activeLines: number, bet: number): FireBonusResult {
  const grid = createBonusGrid(activeLines)
  const values = new Map<string, { symbol: Exclude<FireBonusSymbol, 'double'>, multiplier: number }>()
  const steps: FireBonusStep[] = []
  const capacity = bonusCapacity(activeLines)

  for (let spin = 1; spin <= FITH_FREE_SPINS; spin++) {
    const emptyCells = emptyBonusCells(grid, activeLines)
    const drops: FireBonusDrop[] = []
    const valueEvents: FireBonusValueEvent[] = []
    let appliedAdd = 0
    let appliedDouble = false
    let collected = 0

    let collectorDropped = false

    for (const cell of emptyCells) {
      const roll = rand()
      const chances = bonusDropChances(values.size, capacity)
      const coinLimit = chances.coin
      const boostLimit = coinLimit + (values.size > 0 ? chances.boost : 0)
      const doubleLimit = boostLimit + (values.size > 0 ? chances.double : 0)
      // Only one collector may drop per spin — a second collector would find
      // every coin already swept up by the first, so it'd have nothing to do.
      const canCollector = !collectorDropped && [...values.values()].some(value => value.symbol === 'coin')
      const collectorLimit = doubleLimit + (canCollector ? chances.collector : 0)

      if (roll < coinLimit) {
        const multiplier = bonusCoinValue()
        grid[cell.col]![cell.row] = 'coin'
        values.set(key(cell), { symbol: 'coin', multiplier })
        drops.push({ ...cell, symbol: 'coin', multiplier })
      } else if (roll < boostLimit) {
        const multiplier = bonusAddValue()
        grid[cell.col]![cell.row] = 'boost'
        values.set(key(cell), { symbol: 'boost', multiplier })
        drops.push({ ...cell, symbol: 'boost', multiplier })
      } else if (roll < doubleLimit) {
        drops.push({ ...cell, symbol: 'double', multiplier: 2 })
      } else if (roll < collectorLimit) {
        grid[cell.col]![cell.row] = 'collector'
        values.set(key(cell), { symbol: 'collector', multiplier: 0 })
        drops.push({ ...cell, symbol: 'collector', multiplier: 0 })
        collectorDropped = true
      }
    }

    for (const [sourceId, sourceState] of [...values.entries()]) {
      if (sourceState.symbol !== 'boost') continue

      const [sourceCol, sourceRow] = sourceId.split(':').map(Number)
      const source = {
        col: sourceCol!,
        row: sourceRow!,
        symbol: 'boost',
        multiplier: sourceState.multiplier
      } as FireBonusDrop

      appliedAdd += sourceState.multiplier

      for (const [id, state] of values) {
        if (state.symbol === 'boost') continue

        const before = state.multiplier
        const after = clampBonusValue(before + sourceState.multiplier)
        const [col, row] = id.split(':').map(Number)
        const target = { col: col!, row: row!, symbol: state.symbol, multiplier: after } as FireBonusDrop

        state.multiplier = after
        valueEvents.push({ type: 'add', source, target, amount: sourceState.multiplier, before, after })
      }
    }

    for (const drop of drops) {
      if (drop.symbol === 'double') {
        appliedDouble = true

        for (const [id, state] of values) {
          if (state.symbol === 'boost') continue

          const before = state.multiplier
          const after = clampBonusValue(before * 2)
          const [col, row] = id.split(':').map(Number)
          const target = { col: col!, row: row!, symbol: state.symbol, multiplier: after } as FireBonusDrop

          state.multiplier = after
          valueEvents.push({ type: 'double', source: drop, target, amount: after - before, before, after })
        }
      }
    }

    for (const collector of drops.filter(drop => drop.symbol === 'collector')) {
      const collectorState = values.get(key(collector))
      if (!collectorState) continue

      for (const [id, state] of [...values.entries()]) {
        if (state.symbol !== 'coin') continue

        const [col, row] = id.split(':').map(Number)
        const before = collectorState.multiplier
        const amount = state.multiplier
        const after = clampBonusValue(before + amount)
        const target = { col: col!, row: row!, symbol: 'coin', multiplier: amount } as FireBonusDrop

        collectorState.multiplier = after
        collected += amount
        grid[col!]![row!] = 'empty'
        values.delete(id)
        valueEvents.push({ type: 'collect', source: { ...collector, multiplier: after }, target, amount, before, after })
      }
    }

    const displayGrid = createBonusGrid(activeLines)

    for (const drop of drops) {
      displayGrid[drop.col]![drop.row] = drop.symbol
    }

    const coins = bonusStateToCoins(values)
    const totalMultiplier = coins.reduce((sum, coin) => coin.symbol === 'boost' ? sum : sum + coin.multiplier, 0)

    steps.push({
      spin,
      grid: displayGrid,
      drops,
      coins,
      valueEvents,
      appliedAdd,
      appliedDouble,
      collected,
      totalMultiplier
    })
  }

  const totalMultiplier = steps.at(-1)?.totalMultiplier ?? 0

  return {
    triggered: true,
    freeSpins: FITH_FREE_SPINS,
    activeLines,
    steps,
    totalMultiplier,
    payout: Number((bet * totalMultiplier).toFixed(2))
  }
}

export function playFireInTheHole(bet: number, options?: Record<string, unknown>): FireInTheHoleResult {
  if (!Number.isFinite(bet) || bet <= 0) {
    throw createError({ statusCode: 400, message: 'Invalid bet amount' })
  }

  if (options?.buyBonus) {
    // Buying the bonus guarantees a strong entry (5 of 6 rows unlocked —
    // the most common tier a natural trigger actually lands at) instead of
    // the worst-case FITH_STARTING_LINES a base spin starts at. Paying a
    // premium should get you a bonus at least as good as a typical natural
    // trigger, not the weakest possible one.
    const activeLines = FITH_MAX_LINES - 1
    const cost = Number((bet * FITH_BUY_BONUS_COST).toFixed(2))
    const grid = buyBonusGrid(activeLines)
    const bonus = playBonus(activeLines, bet)
    const maxWin = bet * FITH_MAX_WIN_MULT
    const totalPayout = Number(Math.min(maxWin, bonus.payout).toFixed(2))

    return {
      bet,
      cost,
      payout: totalPayout,
      basePayout: 0,
      maxWin,
      won: totalPayout > cost,
      grid,
      steps: [],
      restGrid: grid,
      scatterCells: findScatters(grid, activeLines),
      activeLines,
      maxLines: FITH_MAX_LINES,
      bonus
    }
  }

  let activeLines = FITH_STARTING_LINES
  let grid = createGrid(activeLines)
  const steps: FireCascadeStep[] = []
  let payout = 0

  let coin: FireCoinDrop | null = null
  if (rand() < FITH_COIN_DROP_CHANCE) {
    // Never land on a scatter — scatters need to stay clearly readable so
    // the bonus trigger count is never obscured by a coin badge.
    const coinCandidates: FireCell[] = []
    for (let col = 0; col < FITH_COLS; col++) {
      for (let row = 0; row < activeLines; row++) {
        if (grid[col]![row] !== 'scatter') coinCandidates.push({ col, row })
      }
    }

    const pick = coinCandidates.length > 0 ? coinCandidates[Math.floor(rand() * coinCandidates.length)] : undefined
    if (pick) {
      coin = { col: pick.col, row: pick.row, multiplier: coinDropValue() }
    }
  }
  const initialCoinDrop = coin ? { ...coin } : undefined

  for (let chain = 0; chain < FITH_MAX_CASCADES; chain++) {
    const connectionCells = detectConnections(grid, activeLines)
    if (connectionCells.length === 0) break

    const { winCells, bombCells, lineBombCells } = resolveBombExplosions(grid, connectionCells, activeLines)
    let stepPay = calculateStepPay(grid, winCells, chain, bet)
    const activeLinesBefore = activeLines
    const nextActiveLines = Math.min(FITH_MAX_LINES, activeLines + lineBombCells.length)

    const coinBefore = coin ? { ...coin } : undefined
    let coinHit: FireCoinHit | undefined

    // A coin pops any time its cell is cleared during a step where at least
    // one bomb detonated — it doesn't matter whether that block was part of
    // the original matched cluster or only caught in the blast radius. If a
    // bomb blew up this step and the coin's block went with it, it always
    // pays out. It pays a flat bet multiplier — the badge's "×N" always
    // means exactly N× bet, regardless of how small or large the underlying
    // connection's own payout was.
    if (coin && bombCells.length > 0 && winCells.some(cell => cell.col === coin!.col && cell.row === coin!.row)) {
      const bonusPay = Number((bet * coin.multiplier).toFixed(2))
      stepPay = Number((stepPay + bonusPay).toFixed(2))
      coinHit = { cell: { col: coin.col, row: coin.row }, multiplier: coin.multiplier, bonusPay }
    }

    const { grid: nextGrid, trackedCell: nextCoinCell } = collapseGridTracking(grid, winCells, activeLines, coin)
    coin = coinHit ? null : (nextCoinCell ? { ...nextCoinCell, multiplier: coin!.multiplier } : null)
    const unlockedRows = applyUnlockedRows(nextGrid, activeLines, nextActiveLines)

    activeLines = nextActiveLines
    payout = Number((payout + stepPay).toFixed(2))

    steps.push({
      grid: cloneGrid(grid),
      activeLinesBefore,
      activeLinesAfter: activeLines,
      winCells,
      bombCells,
      unlockedRows,
      stepPay,
      totalPay: payout,
      coinBefore,
      coinHit
    })

    grid = nextGrid
  }

  // Coin survived every cascade this spin without being popped or swept
  // away — surface its resting position so the UI can keep it on screen.
  const restCoinDrop = coin ? { ...coin } : undefined

  const scatterCells = findScatters(grid, activeLines)
  const bonus = scatterCells.length >= FITH_SCATTERS_FOR_BONUS
    ? playBonus(activeLines, bet)
    : undefined
  const maxWin = bet * FITH_MAX_WIN_MULT
  const rawPayout = payout + (bonus?.payout ?? 0)
  const totalPayout = Number(Math.min(maxWin, rawPayout).toFixed(2))

  return {
    bet,
    cost: bet,
    payout: totalPayout,
    basePayout: payout,
    maxWin,
    won: totalPayout > bet,
    grid: steps[0]?.grid ?? cloneGrid(grid),
    steps,
    restGrid: cloneGrid(grid),
    scatterCells,
    activeLines,
    maxLines: FITH_MAX_LINES,
    bonus,
    coinDrop: initialCoinDrop,
    restCoinDrop
  }
}
