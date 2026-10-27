import { WHEEL_CONFIGS, type WheelDifficulty, type WheelResult } from '#shared/utils/gamelogic/wheel'
import type { DiceResult } from '#shared/utils/gamelogic/dice'
import type { LimboResult } from '#shared/utils/gamelogic/limbo'
import { parseAmount } from '#shared/utils/parse-amount'
import { CASINO_MAX_BET } from '#shared/utils/limits'

// The casino tabs of spreadsheet mode: Dice, Limbo, Wheel and the slots, all
// played through /api/games/play-game. Each tab has its inputs in A:B, a
// checkbox that plays a round when ticked, and a log of rounds from column D.

type Game = 'dice' | 'limbo' | 'wheel' | 'slots'

interface LogRow {
  at: number
  bet: number
  cost: number
  /** Game input: win chance, target, difficulty or slot name */
  input: number | string
  /** Outcome: roll, result multiplier, wheel multiplier or bonus flag */
  outcome: number | boolean
  payout: number
}

// The slots whose spin (bonus included) resolves in a single play-game call
export const SHEET_SLOTS: Record<string, string> = {
  xenoslot: 'Xeno Slot',
  candymadness: 'Candy Madness',
  aethergates: 'Aether Gates',
  fireinthehole: 'Fire in the Hole',
  bookofshadows: 'Book of Shadows',
  spinata: 'Spiñata Slots',
  trashpanda: 'Trash Panda Heist',
  emberportals: 'Ember Portals',
  polymasters: 'PolyMasters'
}

const DIFFICULTIES: Record<WheelDifficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

const LOG_LIMIT = 200
const STORAGE_KEY = 'sheet-log'

export const SHEET_HEADER = { bold: true, bg: '#c9daf8' } as const
export const SHEET_INPUT_BG = '#fff2cc'
export const SHEET_GAIN = '#137333'
export const SHEET_LOSS = '#a50e0e'

function loadLogs(): Record<Game, LogRow[]> {
  const empty = { dice: [], limbo: [], wheel: [], slots: [] }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...empty, ...JSON.parse(raw) } : empty
  } catch {
    return empty
  }
}

/** Parses a typed coin amount (`10k`, `2.5m`) for a stake cell */
export function stakeEditor(apply: (amount: number) => void, max = CASINO_MAX_BET) {
  return (raw: string) => {
    const amount = parseAmount(raw)
    if (amount === null || amount < 1 || amount > max) return 'Input must be a number greater than or equal to 1.'
    apply(amount)
  }
}

export function numberEditor(apply: (n: number) => void, min: number, max: number) {
  return (raw: string) => {
    const n = Number(raw.replace('%', '').replace(/x$/i, '').trim())
    if (!Number.isFinite(n) || n < min || n > max) return `Input must be a number between ${min} and ${max}.`
    apply(n)
  }
}

export function choiceEditor<K extends string>(choices: Record<K, string>, apply: (key: K) => void) {
  return (raw: string) => {
    const match = (Object.keys(choices) as K[]).find(key => choices[key].toLowerCase() === raw.trim().toLowerCase())
    if (!match) return 'Input must be an item on the specified list.'
    apply(match)
  }
}

export const netColor = (n: number) => n < 0 ? SHEET_LOSS : n > 0 ? SHEET_GAIN : undefined

/** A slot symbol as cell text: symbols are strings, or objects in a few games */
function symbolText(symbol: unknown): string {
  if (typeof symbol === 'string' || typeof symbol === 'number') return String(symbol)
  if (symbol && typeof symbol === 'object') {
    const s = symbol as Record<string, unknown>
    return String(s.symbol ?? s.id ?? s.type ?? '')
  }
  return ''
}

export function useSheetCasino() {
  const { balanceNum, setBalance } = useAuth()

  const logs = ref(loadLogs())
  watch(logs, (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    } catch {
      // private window or blocked storage: the log just won't survive a reload
    }
  }, { deep: true })

  const bets = reactive<Record<Game, number>>({ dice: 10, limbo: 10, wheel: 10, slots: 10 })
  const winChance = ref(50)
  const target = ref(2)
  const difficulty = ref<WheelDifficulty>('medium')
  const slot = ref('xenoslot')
  const lastGrid = ref<string[][] | null>(null)
  const busy = reactive<Record<Game, boolean>>({ dice: false, limbo: false, wheel: false, slots: false })
  const errors = reactive<Record<Game, string>>({ dice: '', limbo: '', wheel: '', slots: '' })

  async function run<T extends { payout: number, cost?: unknown }>(game: Game, apiGame: string, options: Record<string, unknown>, toRow: (data: T) => Pick<LogRow, 'input' | 'outcome'>) {
    if (busy[game]) return
    busy[game] = true
    errors[game] = ''
    const bet = bets[game]
    try {
      const data = await apiFetch<{ gameData: T, balance: number }>('/api/games/play-game', {
        method: 'POST',
        body: { bet, game: apiGame, options }
      })
      const cost = typeof data.gameData.cost === 'number' ? data.gameData.cost : bet
      logs.value[game].unshift({ at: Date.now(), bet, cost, payout: data.gameData.payout, ...toRow(data.gameData) })
      if (logs.value[game].length > LOG_LIMIT) logs.value[game].length = LOG_LIMIT
      setBalance(data.balance)
    } catch (e) {
      errors[game] = apiErrorMessage(e, 'Calculation failed')
    } finally {
      busy[game] = false
    }
  }

  const playDice = () => run<DiceResult>('dice', 'dice', { winChance: winChance.value }, d => ({ input: d.winChance, outcome: d.roll }))
  const playLimbo = () => run<LimboResult>('limbo', 'limbo', { target: target.value }, d => ({ input: d.target, outcome: d.result }))
  const playWheel = () => run<WheelResult>('wheel', 'wheel', { difficulty: difficulty.value }, d => ({ input: DIFFICULTIES[d.difficulty], outcome: d.multiplier }))
  const playSlot = () => {
    const game = slot.value
    return run<{ payout: number, cost?: number, grid?: unknown[][], bonusTriggered?: boolean, freeSpinsTriggered?: boolean }>('slots', game, {}, (d) => {
      lastGrid.value = Array.isArray(d.grid) ? d.grid.map(col => (Array.isArray(col) ? col : []).map(symbolText)) : null
      return { input: SHEET_SLOTS[game] ?? game, outcome: !!(d.bonusTriggered || d.freeSpinsTriggered) }
    })
  }

  const balanceCell = computed<SheetCell>(() => ({ v: balanceNum.value, fmt: 'number' }))

  /** Inputs in A:B, then Rounds/Net, and the round log from column D */
  function gameCells(game: Game, inputs: [string, SheetCell, string?][], logHeads: string[], inputCell: (row: LogRow) => SheetCell, outcomeCell: (row: LogRow) => SheetCell): SheetCells {
    const cells: SheetCells = {
      A1: { v: 'Setting', ...SHEET_HEADER },
      B1: { v: 'Value', ...SHEET_HEADER }
    }
    inputs.forEach(([label, cell, note], i) => {
      cells[`A${i + 2}`] = { v: label, note }
      cells[`B${i + 2}`] = cell
    })
    const rows = logs.value[game]
    const next = inputs.length + 3
    const net = rows.reduce((sum, row) => sum + row.payout - row.cost, 0)
    cells[`A${next}`] = { v: 'Rounds', bold: true }
    cells[`B${next}`] = { v: rows.length, f: '=COUNTA(D2:D)', bold: true }
    cells[`A${next + 1}`] = { v: 'Net', bold: true }
    cells[`B${next + 1}`] = { v: net, fmt: 'number', f: '=SUM(I2:I)', bold: true, color: netColor(net) }
    if (errors[game]) cells[`B${next + 2}`] = { error: errors[game] }

    ;['Time', 'Bet', ...logHeads, 'Payout', 'Net'].forEach((head, i) => {
      cells[`${colName(3 + i)}1`] = { v: head, ...SHEET_HEADER }
    })
    if (busy[game]) {
      cells.D2 = { v: formatTimestamp(new Date()) }
      cells.E2 = { v: bets[game], fmt: 'number' }
      for (const col of ['F', 'G', 'H', 'I']) cells[`${col}2`] = { loading: true }
    }
    const offset = busy[game] ? 3 : 2
    rows.forEach((row, i) => {
      const r = i + offset
      const rowNet = row.payout - row.cost
      cells[`D${r}`] = { v: formatTimestamp(new Date(row.at)) }
      cells[`E${r}`] = { v: row.cost, fmt: 'number' }
      cells[`F${r}`] = inputCell(row)
      cells[`G${r}`] = outcomeCell(row)
      cells[`H${r}`] = { v: row.payout, fmt: 'number' }
      cells[`I${r}`] = { v: rowNet, fmt: 'number', f: `=H${r}-E${r}`, color: rowNet < 0 ? SHEET_LOSS : SHEET_GAIN }
    })
    return cells
  }

  const checkbox = (game: Game, play: () => void): SheetCell => ({ type: 'checkbox', v: busy[game], toggle: play })
  const betCell = (game: Game): SheetCell => ({ v: bets[game], fmt: 'number', bg: SHEET_INPUT_BG, edit: stakeEditor(amount => bets[game] = amount) })
  const widths = { 0: 130, 1: 120, 2: 30, 3: 150 }

  const dice = computed<SheetTab>(() => {
    const multiplier = 98 / winChance.value
    return {
      id: 'dice',
      name: 'Dice',
      widths,
      cells: gameCells('dice', [
        ['Bet', betCell('dice')],
        ['Win chance (%)', { v: winChance.value, fmt: 'number', bg: SHEET_INPUT_BG, edit: numberEditor(n => winChance.value = Math.round(n * 10) / 10, 2, 96) }, 'You win when the roll is below the win chance.'],
        ['Multiplier', { v: multiplier, fmt: 'number', f: '=ROUND(98/B3, 4)' }],
        ['Payout on win', { v: bets.dice * multiplier, fmt: 'number', f: '=B2*B4' }],
        ['Roll', checkbox('dice', playDice)],
        ['Balance', balanceCell.value]
      ], ['Win chance', 'Roll'],
      row => ({ v: Number(row.input), fmt: 'number' }),
      row => ({ v: Number(row.outcome), fmt: 'number', color: row.payout > 0 ? SHEET_GAIN : undefined }))
    }
  })

  const limbo = computed<SheetTab>(() => ({
    id: 'limbo',
    name: 'Limbo',
    widths,
    cells: gameCells('limbo', [
      ['Bet', betCell('limbo')],
      ['Target', { v: target.value, fmt: 'multiple', bg: SHEET_INPUT_BG, edit: numberEditor(n => target.value = Math.round(n * 100) / 100, 1.1, 1_000_000) }, 'You win bet × target when the result reaches the target.'],
      ['Win chance', { v: 0.98 / target.value, fmt: 'percent', f: '=0.98/B3' }],
      ['Payout on win', { v: bets.limbo * target.value, fmt: 'number', f: '=B2*B3' }],
      ['Play', checkbox('limbo', playLimbo)],
      ['Balance', balanceCell.value]
    ], ['Target', 'Result'],
    row => ({ v: Number(row.input), fmt: 'multiple' }),
    row => ({ v: Number(row.outcome), fmt: 'multiple', color: row.payout > 0 ? SHEET_GAIN : undefined }))
  }))

  const wheel = computed<SheetTab>(() => {
    const segments = WHEEL_CONFIGS[difficulty.value]
    const total = segments.reduce((sum, seg) => sum + seg.count, 0)
    const cells = gameCells('wheel', [
      ['Bet', betCell('wheel')],
      ['Difficulty', { v: DIFFICULTIES[difficulty.value], type: 'dropdown', options: Object.values(DIFFICULTIES), edit: choiceEditor(DIFFICULTIES, key => difficulty.value = key) }],
      ['Top multiplier', { v: Math.max(...segments.map(seg => seg.multiplier)), fmt: 'multiple', f: '=MAX(A13:A16)' }],
      ['Spin', checkbox('wheel', playWheel)],
      ['Balance', balanceCell.value]
    ], ['Difficulty', 'Multiplier'],
    row => ({ v: row.input }),
    row => ({ v: Number(row.outcome), fmt: 'multiple', color: row.payout > 0 ? SHEET_GAIN : SHEET_LOSS }))
    cells.A12 = { v: 'Multiplier', ...SHEET_HEADER }
    cells.B12 = { v: 'Chance', ...SHEET_HEADER }
    segments.forEach((seg, i) => {
      cells[`A${13 + i}`] = { v: seg.multiplier, fmt: 'multiple' }
      cells[`B${13 + i}`] = { v: seg.count / total, fmt: 'percent' }
    })
    return { id: 'wheel', name: 'Wheel', widths, cells }
  })

  const slots = computed<SheetTab>(() => {
    const cells = gameCells('slots', [
      ['Bet', betCell('slots')],
      ['Slot', { v: SHEET_SLOTS[slot.value], type: 'dropdown', options: Object.values(SHEET_SLOTS), edit: choiceEditor(SHEET_SLOTS, (key) => {
        slot.value = key
        lastGrid.value = null
      }) }],
      ['Spin', checkbox('slots', playSlot)],
      ['Balance', balanceCell.value]
    ], ['Slot', 'Bonus'],
    row => ({ v: row.input }),
    row => ({ v: row.outcome === true }))
    // The last spin's reels from column K, one column per reel
    const grid = lastGrid.value
    if (grid?.length) {
      grid.forEach((col, c) => {
        cells[cellKey(0, 10 + c)] = { v: `Reel ${c + 1}`, ...SHEET_HEADER, align: 'center' }
        col.forEach((symbol, r) => {
          if (symbol) cells[cellKey(1 + r, 10 + c)] = { v: symbol, align: 'center' }
        })
      })
    }
    return { id: 'slots', name: 'Slots', widths, cells }
  })

  return { dice, limbo, wheel, slots, logs }
}
