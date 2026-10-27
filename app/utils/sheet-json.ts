// Lays out an API payload as spreadsheet cells, for the read-only game tabs
// of spreadsheet mode. Plain fields become a Field/Value list, and lists of
// records (or maps of id → record) become tables stacked below it.

import { cellKey, formatTimestamp, type SheetCell, type SheetCells } from './sheet'

const MAX_ROWS = 300
const MAX_COLS = 20
const MAX_TEXT = 200
const HEADER = { bold: true, bg: '#c9daf8' } as const

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
type Record_ = { [key: string]: Json }

const isRecord = (v: unknown): v is Record_ => typeof v === 'object' && v !== null && !Array.isArray(v)

/** `totalDeposited` → `Total deposited`, `bank.loanLimit` → `Bank loan limit` */
export function humanizeKey(path: string): string {
  const words = path
    .replace(/[._]/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const TIMESTAMP_KEY = /(At|Now|Until|Date|Time)$/

/** One value as a cell: numbers, numeric strings, dates, booleans and text */
export function valueCell(value: Json | undefined, key = ''): SheetCell {
  if (value === null || value === undefined) return {}
  if (typeof value === 'boolean') return { v: value }
  if (typeof value === 'number') {
    if (TIMESTAMP_KEY.test(key) && value > 1e12) return { v: formatTimestamp(new Date(value)) }
    return { v: value, fmt: Number.isInteger(value) ? 'int' : 'number' }
  }
  if (typeof value === 'string') {
    if (/^-?\d+\.\d+$/.test(value)) return { v: Number(value), fmt: 'number' }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
      const date = new Date(value)
      if (!Number.isNaN(date.getTime())) return { v: formatTimestamp(date) }
    }
    return { v: value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value }
  }
  if (Array.isArray(value)) {
    if (value.every(item => !isRecord(item) && !Array.isArray(item))) {
      const text = value.join(', ')
      return { v: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text }
    }
    return { v: `${value.length} items`, color: '#5f6368' }
  }
  const text = JSON.stringify(value)
  return { v: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text, color: '#5f6368' }
}

interface Table { title: string, keyColumn?: string, rows: [string | null, Record_][] }

/** Flattens a record one level deep into scalar columns (`gear.tool` etc.) */
function flatRow(record: Record_): Record<string, Json> {
  const out: Record<string, Json> = {}
  for (const [key, value] of Object.entries(record)) {
    if (isRecord(value) && Object.values(value).every(v => !isRecord(v) && !Array.isArray(v))) {
      for (const [inner, v] of Object.entries(value)) out[`${key}.${inner}`] = v
    } else {
      out[key] = value
    }
  }
  return out
}

/** A map whose values are all records reads better as a table keyed by id */
function isRecordMap(value: Record_): boolean {
  const values = Object.values(value)
  return values.length >= 2 && values.every(isRecord)
}

function collect(value: Record_, prefix: string, fields: [string, Json][], tables: Table[], depth: number) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (Array.isArray(child) && child.length && child.every(isRecord)) {
      tables.push({ title: path, rows: (child as Record_[]).map(row => [null, row]) })
    } else if (isRecord(child) && isRecordMap(child)) {
      tables.push({ title: path, keyColumn: 'id', rows: Object.entries(child).map(([id, row]) => [id, row as Record_]) })
    } else if (isRecord(child) && depth < 3 && Object.keys(child).length) {
      collect(child, path, fields, tables, depth + 1)
    } else {
      fields.push([path, child])
    }
  }
}

/** Cells for a payload, starting at `startRow` (0-based). Returns the cells and the next free row. */
export function jsonToCells(data: unknown, startRow = 0): { cells: SheetCells, nextRow: number } {
  const cells: SheetCells = {}
  const fields: [string, Json][] = []
  const tables: Table[] = []

  if (Array.isArray(data)) {
    tables.push({ title: 'Rows', rows: (data as Json[]).map(row => [null, isRecord(row) ? row : { value: row }]) })
  } else if (isRecord(data)) {
    collect(data, '', fields, tables, 0)
  }

  let r = startRow
  if (fields.length) {
    cells[cellKey(r, 0)] = { v: 'Field', ...HEADER }
    cells[cellKey(r, 1)] = { v: 'Value', ...HEADER }
    r++
    for (const [path, value] of fields) {
      cells[cellKey(r, 0)] = { v: humanizeKey(path) }
      cells[cellKey(r, 1)] = valueCell(value, path.split('.').pop())
      r++
    }
    r++
  }

  for (const table of tables) {
    const rows = table.rows.map(([id, record]) => [id, flatRow(record)] as const)
    const columns: string[] = table.keyColumn ? [table.keyColumn] : []
    for (const [, row] of rows) {
      for (const key of Object.keys(row)) {
        if (!columns.includes(key) && columns.length < MAX_COLS) columns.push(key)
      }
    }
    cells[cellKey(r, 0)] = { v: `${humanizeKey(table.title)} (${rows.length})`, bold: true }
    r++
    columns.forEach((column, c) => {
      cells[cellKey(r, c)] = { v: humanizeKey(column), ...HEADER }
    })
    r++
    for (const [id, row] of rows.slice(0, MAX_ROWS)) {
      columns.forEach((column, c) => {
        const cell = table.keyColumn && c === 0 ? { v: id } : valueCell(row[column], column.split('.').pop())
        if (cell.v !== undefined) cells[cellKey(r, c)] = cell
      })
      r++
    }
    if (rows.length > MAX_ROWS) {
      cells[cellKey(r, 0)] = { v: `… ${rows.length - MAX_ROWS} more rows`, italic: true, color: '#5f6368' }
      r++
    }
    r++
  }

  return { cells, nextRow: r }
}
