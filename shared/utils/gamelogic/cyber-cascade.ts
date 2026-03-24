// --- Configuration ---
export const GRID_WIDTH = 6
export const GRID_HEIGHT = 5
export const GRID_SIZE = GRID_WIDTH * GRID_HEIGHT
const MIN_MATCH_SIZE = 5

const WILD_PROBABILITY = 0.02
const SCATTER_PROBABILITY = 0.015
const MAX_TRAIL_MULTIPLIER = 64
const MAX_WILD_CLUSTER_MULT = 10
const MAX_CASCADES = 30
const FREE_SPINS_COUNT = 8

export const SYMBOL_CONFIG: Record<SymbolId, number> = {
  CYBER_SKULL: 0.040,
  NEON_7: 0.028,
  PLASMA_ORB: 0.023,
  DATA_CUBE: 0.018,
  CHIP: 0.013
}

export type SymbolId = 'CYBER_SKULL' | 'NEON_7' | 'PLASMA_ORB' | 'DATA_CUBE' | 'CHIP'
export type SymbolType = 'SYMBOL' | 'WILD' | 'SCATTER' | 'EMPTY'

export interface GridCell {
  id: string
  type: SymbolType
  symbolId?: SymbolId
  baseValue: number
  multiplier?: number
  direction?: number
  isMatch?: boolean
  isNew?: boolean
  isMerged?: boolean
  justMoved?: boolean
}

export interface WinEvent {
  row: number
  col: number
  amount: number
  symbolId?: SymbolId
}

export interface GameFrame {
  id: string
  grid: GridCell[]
  trails: number[]
  action: 'INIT' | 'SPIN_START' | 'MATCH' | 'WALK' | 'GRAVITY' | 'BONUS_TRIGGER' | 'IDLE'
  winEvents: WinEvent[]
  roundWin: number
  stepWin: number
}

export interface RoundResult {
  frames: GameFrame[]
  totalWin: number
  isBonusTriggered: boolean
  finalGrid: GridCell[]
  finalTrails: number[]
}

const SYMBOLS: SymbolId[] = ['CYBER_SKULL', 'NEON_7', 'PLASMA_ORB', 'DATA_CUBE', 'CHIP']

const getIndex = (r: number, c: number) => r * GRID_WIDTH + c
const getCoords = (i: number) => ({ r: Math.floor(i / GRID_WIDTH), c: i % GRID_WIDTH })

const getRandomSymbol = (): SymbolId => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]

const getRandomWildMultiplier = (): number => {
  const r = Math.random()
  if (r < 0.05) return 10
  if (r < 0.15) return 5
  if (r < 0.35) return 3
  return 2
}

const generateSymbol = (isFreeSpin: boolean): GridCell => {
  const rand = Math.random()
  if (!isFreeSpin && rand < SCATTER_PROBABILITY) {
    return { id: crypto.randomUUID(), type: 'SCATTER', baseValue: 0, isNew: true }
  }
  const effectiveWildProb = isFreeSpin ? 0 : WILD_PROBABILITY
  if (rand < SCATTER_PROBABILITY + effectiveWildProb) {
    return {
      id: crypto.randomUUID(),
      type: 'WILD',
      baseValue: 0,
      multiplier: getRandomWildMultiplier(),
      direction: Math.random() > 0.5 ? 1 : -1,
      isNew: true
    }
  }
  const sym = getRandomSymbol()
  return { id: crypto.randomUUID(), type: 'SYMBOL', symbolId: sym, baseValue: SYMBOL_CONFIG[sym], isNew: true }
}

export const getInitialGrid = (): GridCell[] =>
  Array(GRID_SIZE).fill(null).map(() => generateSymbol(false))

const cloneGrid = (grid: GridCell[]): GridCell[] => grid.map(c => ({ ...c }))

export const simulateRound = (
  bet: number,
  startGrid: GridCell[] | null,
  startTrails: number[],
  isFreeSpin: boolean
): RoundResult => {
  const frames: GameFrame[] = []
  let currentGrid: GridCell[]
  let currentTrails: number[] = [...startTrails]
  let totalWin = 0

  if (startGrid && isFreeSpin) {
    currentGrid = startGrid.map(c => {
      if (c.type === 'WILD') return { ...c, isNew: false, isMatch: false, isMerged: false, justMoved: false }
      return generateSymbol(true)
    })
  } else {
    currentGrid = getInitialGrid()
    currentTrails = Array(GRID_SIZE).fill(0)
  }

  frames.push({
    id: crypto.randomUUID(),
    grid: cloneGrid(currentGrid),
    trails: [...currentTrails],
    action: 'INIT',
    winEvents: [],
    roundWin: 0,
    stepWin: 0
  })

  let active = true
  let safety = 0
  let scattersFound = 0

  while (active && safety < MAX_CASCADES) {
    safety++
    const clusters: number[][] = []
    const visited = new Set<number>()

    scattersFound = currentGrid.filter(c => c.type === 'SCATTER').length

    for (let i = 0; i < GRID_SIZE; i++) {
      if (visited.has(i)) continue
      const cell = currentGrid[i]
      if (cell.type === 'EMPTY' || cell.type === 'SCATTER') continue

      const cluster = [i]
      const queue = [i]
      visited.add(i)
      let matchType: SymbolId | 'WILD' = cell.type === 'WILD' ? 'WILD' : cell.symbolId!

      while (queue.length > 0) {
        const currIdx = queue.shift()!
        const { r, c } = getCoords(currIdx)
        const neighbors = [{ r: r - 1, c }, { r: r + 1, c }, { r, c: c - 1 }, { r, c: c + 1 }]

        for (const n of neighbors) {
          if (n.r >= 0 && n.r < GRID_HEIGHT && n.c >= 0 && n.c < GRID_WIDTH) {
            const nIdx = getIndex(n.r, n.c)
            if (!visited.has(nIdx)) {
              const nCell = currentGrid[nIdx]
              let isMatch = false
              if (matchType === 'WILD') {
                if (nCell.type === 'WILD') isMatch = true
                else if (nCell.type === 'SYMBOL') { isMatch = true; matchType = nCell.symbolId! }
              } else {
                if (nCell.type === 'WILD') isMatch = true
                else if (nCell.type === 'SYMBOL' && nCell.symbolId === matchType) isMatch = true
              }
              if (isMatch) { visited.add(nIdx); cluster.push(nIdx); queue.push(nIdx) }
            }
          }
        }
      }

      if (cluster.length >= MIN_MATCH_SIZE) clusters.push(cluster)
      else cluster.forEach(idx => visited.delete(idx))
    }

    if (clusters.length === 0) { active = false; break }

    let stepWin = 0
    const winEvents: WinEvent[] = []
    const matchIndices = new Set<number>()
    const wildIndices = new Set<number>()
    const matchGrid = cloneGrid(currentGrid)

    clusters.forEach(cluster => {
      const symCell = cluster.map(i => currentGrid[i]).find(c => c.type === 'SYMBOL')
      const baseVal = symCell ? symCell.baseValue : SYMBOL_CONFIG['CYBER_SKULL']
      let clusterBaseWin = 0
      let wildMultSum = 0

      cluster.forEach(idx => {
        matchIndices.add(idx)
        matchGrid[idx].isMatch = true
        const cellTrail = Math.min(MAX_TRAIL_MULTIPLIER, currentTrails[idx] > 1 ? currentTrails[idx] : 1)
        clusterBaseWin += baseVal * bet * cellTrail
        if (currentGrid[idx].type === 'WILD') { wildIndices.add(idx); wildMultSum += currentGrid[idx].multiplier || 1 }
      })

      const wildMultiplier = wildMultSum > 0 ? Math.min(MAX_WILD_CLUSTER_MULT, wildMultSum) : 1
      const clusterWin = clusterBaseWin * wildMultiplier
      stepWin += clusterWin

      let sumR = 0, sumC = 0
      cluster.forEach(idx => { const { r, c } = getCoords(idx); sumR += r; sumC += c })
      winEvents.push({ row: sumR / cluster.length, col: sumC / cluster.length, amount: clusterWin, symbolId: symCell?.symbolId })
    })

    totalWin += stepWin
    frames.push({ id: crypto.randomUUID(), grid: matchGrid, trails: [...currentTrails], action: 'MATCH', winEvents, roundWin: totalWin, stepWin })

    const nextGrid = Array(GRID_SIZE).fill(null).map(() => ({ id: crypto.randomUUID(), type: 'EMPTY' as SymbolType, baseValue: 0 } as GridCell))
    for (let i = 0; i < GRID_SIZE; i++) { if (!matchIndices.has(i)) nextGrid[i] = currentGrid[i] }

    const wildList = Array.from(wildIndices)
    const rightMovers = wildList.filter(i => (currentGrid[i].direction || 1) === 1).sort((a, b) => b - a)
    const leftMovers = wildList.filter(i => (currentGrid[i].direction || 1) === -1).sort((a, b) => a - b)

    ;[...rightMovers, ...leftMovers].forEach(wildIdx => {
      const wild = currentGrid[wildIdx]
      const { r, c } = getCoords(wildIdx)

      if (isFreeSpin) {
        const currentTrailVal = currentTrails[wildIdx] || 0
        currentTrails[wildIdx] = Math.min(MAX_TRAIL_MULTIPLIER, currentTrailVal + (wild.multiplier || 0))
      }

      const dir = wild.direction || 1
      const tC = c + dir
      let finalIdx = wildIdx
      let merged = false
      let moved = false

      if (tC < 0 || tC >= GRID_WIDTH) return

      const tIdx = getIndex(r, tC)
      const tCell = nextGrid[tIdx]

      if (tCell.type === 'EMPTY') { finalIdx = tIdx; moved = true }
      else if (tCell.type === 'WILD' && tCell.justMoved) { finalIdx = tIdx; merged = true; moved = true }

      const newWild: GridCell = { ...wild, direction: dir, isMatch: false, isMerged: merged, justMoved: moved, isNew: false }
      if (merged) {
        const existing = nextGrid[finalIdx]
        newWild.multiplier = Math.max(existing.multiplier || 1, wild.multiplier || 1)
        newWild.id = existing.id
      }
      nextGrid[finalIdx] = newWild
    })

    frames.push({ id: crypto.randomUUID(), grid: cloneGrid(nextGrid), trails: [...currentTrails], action: 'WALK', winEvents: [], roundWin: totalWin, stepWin: 0 })

    const gravityGrid = Array(GRID_SIZE).fill(null).map(() => ({ id: crypto.randomUUID(), type: 'EMPTY' as SymbolType, baseValue: 0 } as GridCell))
    for (let i = 0; i < GRID_SIZE; i++) {
      if (nextGrid[i].type === 'WILD') gravityGrid[i] = { ...nextGrid[i], isMatch: false, justMoved: false }
    }

    for (let col = 0; col < GRID_WIDTH; col++) {
      const fallingSymbols: GridCell[] = []
      for (let row = 0; row < GRID_HEIGHT; row++) {
        const cell = nextGrid[getIndex(row, col)]
        if (cell.type !== 'EMPTY' && cell.type !== 'WILD') fallingSymbols.push({ ...cell, isMatch: false, justMoved: false })
      }
      const availableSlots: number[] = []
      for (let row = GRID_HEIGHT - 1; row >= 0; row--) {
        const idx = getIndex(row, col)
        if (gravityGrid[idx].type === 'EMPTY') availableSlots.push(idx)
      }
      for (const slotIdx of availableSlots) {
        gravityGrid[slotIdx] = fallingSymbols.length > 0 ? fallingSymbols.pop()! : generateSymbol(isFreeSpin)
      }
    }

    currentGrid = gravityGrid
    frames.push({ id: crypto.randomUUID(), grid: cloneGrid(currentGrid), trails: [...currentTrails], action: 'GRAVITY', winEvents: [], roundWin: totalWin, stepWin: 0 })
  }

  return {
    frames,
    totalWin,
    isBonusTriggered: !isFreeSpin && scattersFound >= 3,
    finalGrid: currentGrid,
    finalTrails: currentTrails
  }
}

export function playGame(bet: number): {
  baseRound: RoundResult
  freeSpins?: RoundResult[]
  payout: number
} {
  const baseRound = simulateRound(bet, null, Array(GRID_SIZE).fill(0), false)
  let payout = baseRound.totalWin
  let freeSpins: RoundResult[] | undefined

  if (baseRound.isBonusTriggered) {
    freeSpins = []
    let currentGrid = baseRound.finalGrid
    let currentTrails = baseRound.finalTrails
    for (let i = 0; i < FREE_SPINS_COUNT; i++) {
      const freeSpinResult = simulateRound(bet, currentGrid, currentTrails, true)
      freeSpins.push(freeSpinResult)
      payout += freeSpinResult.totalWin
      currentGrid = freeSpinResult.finalGrid
      currentTrails = freeSpinResult.finalTrails
    }
  }

  return { baseRound, freeSpins,  payout }
}
