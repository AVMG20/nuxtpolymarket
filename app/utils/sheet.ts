// Spreadsheet mode: the model behind the Google Sheets disguise (/sheet).
// A tab is a sparse map of A1-style keys to cells; the grid renders it and
// routes edits back through each cell's handlers.

export type SheetFormat = 'text' | 'number' | 'int' | 'percent' | 'multiple' | 'datetime'

export interface SheetCell {
  v?: string | number | boolean | null
  /** What the formula bar shows instead of the value (e.g. `=B2*B4`) */
  f?: string
  fmt?: SheetFormat
  bold?: boolean
  italic?: boolean
  color?: string
  bg?: string
  align?: 'left' | 'center' | 'right'
  size?: number
  type?: 'checkbox' | 'dropdown'
  options?: string[]
  /** Hover note (black corner triangle) */
  note?: string
  /** Error message: renders `#ERROR!` with a red corner triangle */
  error?: string
  loading?: boolean
  /** Editable cells take the raw text; return a message to reject it */
  edit?: (raw: string) => string | undefined
  toggle?: () => void
  /** Internal link to another tab, opened from the link popover */
  link?: { label: string, tabId: string }
}

export type SheetCells = Record<string, SheetCell>

export interface SheetTab {
  id: string
  name: string
  cells: SheetCells
  /** Column widths in px by column index (default 100) */
  widths?: Record<number, number>
  color?: string
  /** Fetches or refreshes the tab's data when it is opened */
  activate?: () => void
}

export const SHEET_COLS = 26
export const SHEET_ROWS = 1000
export const SHEET_ROW_HEIGHT = 21
export const SHEET_COL_WIDTH = 100

export function colName(c: number): string {
  let name = ''
  let n = c + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    name = String.fromCharCode(65 + rem) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

export function cellKey(r: number, c: number): string {
  return `${colName(c)}${r + 1}`
}

export function parseKey(key: string): { r: number, c: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(key.toUpperCase())
  if (!m) return null
  let c = 0
  for (const ch of m[1]!) c = c * 26 + (ch.charCodeAt(0) - 64)
  return { r: Number(m[2]) - 1, c: c - 1 }
}

const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 10, useGrouping: false })
const fixed2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export function formatCellNumber(value: number, fmt?: SheetFormat): string {
  if (!Number.isFinite(value)) return '#NUM!'
  switch (fmt) {
    case 'number': return fixed2.format(value)
    case 'int': return int.format(value)
    case 'percent': return `${fixed2.format(value * 100)}%`
    case 'multiple': return `${fixed2.format(value)}x`
    default: return plain.format(value)
  }
}

export function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${d.getHours()}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function displayCell(cell: SheetCell | undefined): string {
  if (!cell) return ''
  if (cell.error) return '#ERROR!'
  if (cell.loading) return 'Loading...'
  const v = cell.v
  if (typeof v === 'boolean') return cell.type === 'checkbox' ? '' : v ? 'TRUE' : 'FALSE'
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return formatCellNumber(v, cell.fmt)
  return v
}

/** The text a cell shows in the formula bar and starts editing with */
export function cellSource(cell: SheetCell | undefined): string {
  if (!cell) return ''
  if (cell.f !== undefined) return cell.f
  if (typeof cell.v === 'boolean') return cell.v ? 'TRUE' : 'FALSE'
  if (typeof cell.v === 'number') return plain.format(cell.v)
  return cell.v ?? ''
}

/** Numeric value for formulas and the selection sum, or null */
export function cellNumber(cell: SheetCell | undefined): number | null {
  if (!cell || cell.error || cell.loading) return null
  if (typeof cell.v === 'number') return cell.v
  return null
}

// --- Scratch formulas: the cells a player types into themselves ---

class FormulaError extends Error {}

type Value = number | number[]

/**
 * Evaluates `=…` with numbers, cell refs, ranges, + - * / ^, parentheses and
 * SUM/AVERAGE/MIN/MAX/COUNT/ROUND/ABS. Anything else is `#NAME?`/`#ERROR!`,
 * which is what a real sheet would show for most of it anyway.
 */
export function evaluateFormula(src: string, lookup: (key: string) => number | null): string | number {
  let pos = 0
  const s = src.replace(/^=/, '')

  const peek = () => s[pos]
  const skip = () => {
    while (s[pos] === ' ') pos++
  }

  function scalar(v: Value): number {
    if (Array.isArray(v)) {
      if (v.length !== 1) throw new FormulaError('#VALUE!')
      return v[0]!
    }
    return v
  }

  function range(a: string, b: string): number[] {
    const from = parseKey(a)
    const to = parseKey(b)
    if (!from || !to) throw new FormulaError('#REF!')
    const out: number[] = []
    for (let r = Math.min(from.r, to.r); r <= Math.max(from.r, to.r); r++) {
      for (let c = Math.min(from.c, to.c); c <= Math.max(from.c, to.c); c++) {
        const n = lookup(cellKey(r, c))
        if (n !== null) out.push(n)
      }
    }
    return out
  }

  function primary(): Value {
    skip()
    const ch = peek()
    if (ch === '(') {
      pos++
      const v = expr()
      skip()
      if (peek() !== ')') throw new FormulaError('#ERROR!')
      pos++
      return v
    }
    if (ch === '-') {
      pos++
      return -scalar(primary())
    }
    if (ch === '+') {
      pos++
      return primary()
    }
    const num = /^\d+(\.\d+)?|^\.\d+/.exec(s.slice(pos))
    if (num) {
      pos += num[0].length
      return Number(num[0])
    }
    const word = /^[A-Za-z]+\d*/.exec(s.slice(pos))
    if (!word) throw new FormulaError('#ERROR!')
    pos += word[0].length
    const name = word[0].toUpperCase()
    skip()
    if (/^[A-Z]+\d+$/.test(name)) {
      if (peek() === ':') {
        pos++
        skip()
        const end = /^[A-Za-z]+\d+/.exec(s.slice(pos))
        if (!end) throw new FormulaError('#ERROR!')
        pos += end[0].length
        return range(name, end[0].toUpperCase())
      }
      return lookup(name) ?? 0
    }
    if (peek() !== '(') throw new FormulaError('#NAME?')
    pos++
    const args: number[] = []
    skip()
    if (peek() !== ')') {
      for (;;) {
        const v = expr()
        if (Array.isArray(v)) args.push(...v)
        else args.push(v)
        skip()
        if (peek() === ',') {
          pos++
          continue
        }
        break
      }
    }
    if (peek() !== ')') throw new FormulaError('#ERROR!')
    pos++
    switch (name) {
      case 'SUM': return args.reduce((a, b) => a + b, 0)
      case 'AVERAGE':
        if (!args.length) throw new FormulaError('#DIV/0!')
        return args.reduce((a, b) => a + b, 0) / args.length
      case 'MIN': return args.length ? Math.min(...args) : 0
      case 'MAX': return args.length ? Math.max(...args) : 0
      case 'COUNT': return args.length
      case 'ABS': return Math.abs(args[0] ?? 0)
      case 'ROUND': {
        const p = 10 ** (args[1] ?? 0)
        return Math.round((args[0] ?? 0) * p) / p
      }
      default: throw new FormulaError('#NAME?')
    }
  }

  function power(): Value {
    let left = primary()
    skip()
    while (peek() === '^') {
      pos++
      left = scalar(left) ** scalar(primary())
      skip()
    }
    return left
  }

  function term(): Value {
    let left = power()
    skip()
    while (peek() === '*' || peek() === '/') {
      const op = s[pos++]
      const right = scalar(power())
      if (op === '/' && right === 0) throw new FormulaError('#DIV/0!')
      left = op === '*' ? scalar(left) * right : scalar(left) / right
      skip()
    }
    return left
  }

  function expr(): Value {
    let left = term()
    skip()
    while (peek() === '+' || peek() === '-') {
      const op = s[pos++]
      const right = scalar(term())
      left = op === '+' ? scalar(left) + right : scalar(left) - right
      skip()
    }
    return left
  }

  try {
    const v = expr()
    skip()
    if (pos < s.length) return '#ERROR!'
    return scalar(v)
  } catch (e) {
    if (e instanceof FormulaError) return e.message
    throw e
  }
}

/** A cell the player typed: a number, a formula or plain text */
export function scratchCell(raw: string, lookup: (key: string) => number | null): SheetCell {
  const text = raw.trim()
  if (text.startsWith('=') && text.length > 1) {
    const result = evaluateFormula(text, lookup)
    return typeof result === 'number'
      ? { v: result, f: raw }
      : { v: result, f: raw, align: 'left' }
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) return { v: Number(text) }
  return { v: raw }
}

/** The green spreadsheet glyph, used for the logo and the tab's favicon */
export const SHEET_LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32"><path d="M15 0H2.5A2.5 2.5 0 0 0 0 2.5v27A2.5 2.5 0 0 0 2.5 32h19a2.5 2.5 0 0 0 2.5-2.5V9z" fill="#0F9D58"/><path d="M15 0v6.5A2.5 2.5 0 0 0 17.5 9H24z" fill="#87CEAC"/><path fill-rule="evenodd" fill="#F1F1F1" d="M5 13h14v13H5zM6.5 14.5h4.75v2.33H6.5zM12.75 14.5h4.75v2.33h-4.75zM6.5 18.33h4.75v2.34H6.5zM12.75 18.33h4.75v2.34h-4.75zM6.5 22.17h4.75v2.33H6.5zM12.75 22.17h4.75v2.33h-4.75z"/></svg>'

export const SHEET_LOGO_URL = `data:image/svg+xml,${encodeURIComponent(SHEET_LOGO_SVG)}`
