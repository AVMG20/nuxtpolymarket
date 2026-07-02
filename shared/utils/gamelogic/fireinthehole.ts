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

export interface FireCascadeStep {
  grid: FireSymbol[][]
  activeLinesBefore: number
  activeLinesAfter: number
  winCells: FireCell[]
  bombCells: FireCell[]
  unlockedRows: number[]
  stepPay: number
  totalPay: number
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
  [key: string]: unknown
}

export interface FireInTheHoleOptions {
  forceScatters?: boolean
}

const PAY_SYMBOLS: FirePaySymbol[] = ['coal', 'ore', 'ruby', 'sapphire', 'emerald']
const PAY_WEIGHTS = [34, 28, 18, 13, 9]
const BOMB_WEIGHT = 7
const SCATTER_WEIGHT = 1.3
const SYMBOL_PAY: Record<FirePaySymbol, number> = {
  coal: 0.019,
  ore: 0.026,
  ruby: 0.04,
  sapphire: 0.056,
  emerald: 0.076
}
const BOMB_PAY = 0.089

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

      if (!winByKey.has(cellKey)) {
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

function collapseGrid(grid: FireSymbol[][], winners: FireCell[], activeLines: number): FireSymbol[][] {
  const next = cloneGrid(grid)
  const removed = new Set(winners.map(key))

  for (let col = 0; col < FITH_COLS; col++) {
    const survivors: FireSymbol[] = []

    for (let row = activeLines - 1; row >= 0; row--) {
      if (!removed.has(`${col}:${row}`)) survivors.push(next[col]![row]!)
    }

    for (let row = activeLines - 1; row >= 0; row--) {
      next[col]![row] = survivors.shift() ?? drawSymbol()
    }

    for (let row = activeLines; row < FITH_ROWS; row++) {
      next[col]![row] = 'rock'
    }
  }

  return next
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

    if (symbol === 'bomb') return sum + BOMB_PAY
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

function forceScatterTrigger(grid: FireSymbol[][], activeLines: number): FireCell[] {
  const cells: FireCell[] = []

  for (let row = 0; row < activeLines; row++) {
    for (let col = 0; col < FITH_COLS; col++) {
      cells.push({ col, row })
    }
  }

  const existing = findScatters(grid, activeLines)
  const existingKeys = new Set(existing.map(key))
  const needed = Math.max(0, FITH_SCATTERS_FOR_BONUS - existing.length)
  const candidates = cells.filter(cell => !existingKeys.has(key(cell)))

  for (let i = 0; i < needed && i < candidates.length; i++) {
    const index = Math.floor(rand() * candidates.length)
    const [cell] = candidates.splice(index, 1)
    if (!cell) continue

    grid[cell.col]![cell.row] = 'scatter'
  }

  return findScatters(grid, activeLines)
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

function bonusCoinValue(): number {
  return weightedPick([0.2, 0.5, 1, 2, 3, 5, 8, 10, 15, 20] as const, [18, 22, 22, 16, 8, 5, 3, 2.4, 1.1, 0.5])
}

function bonusAddValue(): number {
  return weightedPick([2, 5, 10, 15] as const, [45, 30, 18, 7])
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
    coin: 0.0523 * nonCollectorScale,
    boost: 0.0034 * nonCollectorScale,
    double: 0.0011 * nonCollectorScale,
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

    for (const cell of emptyCells) {
      const roll = rand()
      const chances = bonusDropChances(values.size, capacity)
      const coinLimit = chances.coin
      const boostLimit = coinLimit + (values.size > 0 ? chances.boost : 0)
      const doubleLimit = boostLimit + (values.size > 0 ? chances.double : 0)
      const collectorLimit = doubleLimit + ([...values.values()].some(value => value.symbol === 'coin') ? chances.collector : 0)

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

export function playFireInTheHole(bet: number, options: FireInTheHoleOptions = {}): FireInTheHoleResult {
  if (!Number.isFinite(bet) || bet <= 0) {
    throw createError({ statusCode: 400, message: 'Invalid bet amount' })
  }

  let activeLines = FITH_STARTING_LINES
  let grid = createGrid(activeLines)
  const steps: FireCascadeStep[] = []
  let payout = 0

  for (let chain = 0; chain < FITH_MAX_CASCADES; chain++) {
    const connectionCells = detectConnections(grid, activeLines)
    if (connectionCells.length === 0) break

    const { winCells, bombCells, lineBombCells } = resolveBombExplosions(grid, connectionCells, activeLines)
    const stepPay = calculateStepPay(grid, winCells, chain, bet)
    const activeLinesBefore = activeLines
    const nextActiveLines = Math.min(FITH_MAX_LINES, activeLines + lineBombCells.length)
    const nextGrid = collapseGrid(grid, winCells, activeLines)
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
      totalPay: payout
    })

    grid = nextGrid
  }

  const scatterCells = import.meta.dev && options.forceScatters
    ? forceScatterTrigger(grid, activeLines)
    : findScatters(grid, activeLines)
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
    bonus
  }
}
