import { parseAmount } from '#shared/utils/parse-amount'
import { CASINO_MAX_BET } from '#shared/utils/limits'
import { cellKey, formatCellNumber, type SheetCells } from './sheet'

// Styles and cell helpers shared by every spreadsheet-mode tab

export const SHEET_HEADER = { bold: true, bg: '#c9daf8' } as const
export const SHEET_INPUT_BG = '#fff2cc'
export const SHEET_GAIN = '#137333'
export const SHEET_LOSS = '#a50e0e'
export const SHEET_MUTED = '#5f6368'
/** Background of a checkbox that's armed and waits for a second tick */
export const SHEET_ARMED_BG = '#fce8e6'

export const netColor = (n: number) => n < 0 ? SHEET_LOSS : n > 0 ? SHEET_GAIN : undefined

/** Writes a header row of `labels` into row `r`, starting at column `c0` */
export function sheetHeads(cells: SheetCells, r: number, labels: string[], c0 = 0) {
  labels.forEach((label, c) => {
    cells[cellKey(r, c0 + c)] = { v: label, ...SHEET_HEADER }
  })
}

/** Parses a typed coin amount (`10k`, `2.5m`) for a stake cell */
export function stakeEditor(apply: (amount: number) => void, max = CASINO_MAX_BET) {
  return (raw: string) => {
    const amount = parseAmount(raw)
    if (amount === null || amount < 1 || amount > max) return `Input must be a number between 1 and ${formatCellNumber(max, 'int')}.`
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
