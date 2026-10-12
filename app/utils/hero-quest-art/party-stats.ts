// The party's stats: a popup over the battle, opened from the profile badge's portrait. One column
// per fielded unit, the Hero first, under its portrait, one row per stat, read from `stats.get.ts` when it opens. A base
// stat's cell opens where it comes from: each stage of its pipeline and the parts that summed to it.

import { C } from './palette'
import { rect, dither, blit, type Surface } from './surface'
import { drawText, textWidth } from './font'
import { panel } from './ui-art'
import { stageNumber } from './run-director'
import { headOf, HEAD } from './demo'
import { D } from '../../../shared/utils/hero-quest/numbers'
import { CHAMPION_BY_ID } from '../../../shared/utils/hero-quest/content/champions'

/** One fielded unit's column: its portrait's art asset, its name, and each row's value already spelled out. */
export interface PartyStatsUnit {
    asset: string
    name: string
    hero: boolean
    values: readonly string[]
}

/** One line of a stat's sources: a stage of the pipeline, or one of the parts that summed to it. */
export interface PartyStatLine {
    label: string
    value: string
    part: boolean
}

/** The sources of one unit's stat, as the drill-down shows them. */
export interface PartyStatDetail {
    title: string
    final: string
    lines: readonly PartyStatLine[]
}

/** Null `units` while the read is out; `detail` while a cell's sources are open. */
export interface PartyStatsView {
    units: readonly PartyStatsUnit[] | null
    detail?: PartyStatDetail | null
}

/** A cell by its row and its unit's column, the back button, or where the press fell. */
export type PartyStatsTarget = 'close' | 'back' | `cell:${number}:${number}` | 'inside' | 'outside'

/** What `stats.get.ts` returns, as far as this reads it. */
export interface PartyStatsPayload {
    units: readonly {
        label: string
        role: string | null
        stats: readonly {
            key: string
            final: string
            stages: readonly { id: string, label: string, factor: string, parts: readonly { label: string, amount: number }[] }[]
        }[]
        derived: readonly { key: string, value: string }[]
    }[]
}

/** The rows, top to bottom: a base stat by its key, or a derived value as the breakdown spells it. */
const ROWS: readonly { label: string, stat?: string, derived?: string }[] = [
    { label: 'PWR', stat: 'pwr' },
    { label: 'DEF', stat: 'def' },
    { label: 'VIT', stat: 'vit' },
    { label: 'SPD', stat: 'spd' },
    { label: 'LCK', stat: 'lck' },
    { label: 'IMP', stat: 'imp' },
    { label: 'MAX HP', derived: 'maxHp' },
    { label: 'ATK/S', derived: 'attacksPerSecond' },
    { label: 'CRIT', derived: 'critChance' },
    { label: 'CRIT DMG', derived: 'critMultiplier' },
    { label: 'EVASION', derived: 'evasion' }
]

/** A stat as the popup prints it: a decimal under 100, the stage's own figure above. */
function statNumber(value: string): string {
    const v = D(value)
    if (v.lt(100)) return String(Number(v.toNumber().toFixed(1)))
    return stageNumber(v)
}

/** A stage's factor: the base as a figure, every later stage as the multiplier it applied. */
function factorText(factor: string, base: boolean): string {
    if (base) return statNumber(factor)
    const value = Number(factor)
    return Number.isFinite(value) ? `×${value.toFixed(3)}` : `×${stageNumber(D(factor))}`
}

/** A part as an addend: points on the base, a percentage everywhere else, so nobody multiplies them. */
function partText(amount: number, base: boolean): string {
    if (base) return `${amount > 0 ? '+' : ''}${Number(amount.toFixed(1))}`
    return `${amount >= 0 ? '+' : ''}${(amount * 100).toFixed(1)}%`
}

/** The column's name: the Hero by `heroName`, a Champion by its given name. */
function unitName(unit: PartyStatsPayload['units'][number], heroName: string): string {
    return (unit.role === null ? heroName || unit.label : CHAMPION_BY_ID[unit.label]?.givenName ?? unit.label).toUpperCase()
}

/**
 * The popup's columns from the stats read, Hero first as it sends them, the Hero named and drawn by
 * its class. `cell` is the base stat whose sources are open, by its row and its unit's column.
 */
export function partyStatsView(payload: PartyStatsPayload, heroName: string, heroClassId: string, cell: { row: number, unit: number } | null = null): PartyStatsView {
    const units = payload.units.map(unit => ({
        asset: unit.role === null ? `hero/${heroClassId}` : `champion/${unit.label}`,
        name: unitName(unit, heroName),
        hero: unit.role === null,
        values: ROWS.map((row) => {
            if (row.stat) {
                const stat = unit.stats.find(s => s.key === row.stat)
                return stat ? statNumber(stat.final) : '-'
            }
            return (unit.derived.find(d => d.key === row.derived)?.value ?? '-').toUpperCase()
        })
    }))
    return { units, detail: cell ? statDetail(payload, heroName, cell) : null }
}

function statDetail(payload: PartyStatsPayload, heroName: string, cell: { row: number, unit: number }): PartyStatDetail | null {
    const unit = payload.units[cell.unit]
    const key = ROWS[cell.row]?.stat
    const stat = key ? unit?.stats.find(s => s.key === key) : undefined
    if (!unit || !stat) return null
    const lines: PartyStatLine[] = []
    for (const stage of stat.stages) {
        const base = stage.id === 'base'
        lines.push({ label: stage.label.toUpperCase(), value: factorText(stage.factor, base), part: false })
        for (const part of stage.parts) {
            if (part.amount !== 0) lines.push({ label: part.label.toUpperCase(), value: partText(part.amount, base), part: true })
        }
    }
    return { title: `${unitName(unit, heroName)}: ${ROWS[cell.row]!.label}`, final: statNumber(stat.final), lines }
}

/** Whether a row opens its sources: the base stats do, the derived ones have none of their own. */
export function partyStatRowOpens(row: number): boolean {
    return !!ROWS[row]?.stat
}

interface Box { x: number, y: number, w: number, h: number }

const W = 252
const H = 147
const PAD = 6
const LABEL_W = 36
const MAX_COL_W = 64
const ROW_H = 8
const TITLE_H = 12
const CLOSE_W = 13
const CLOSE_H = 11
const BACK_W = 30
const LINE_H = 7
const PLATE = HEAD + 2

function box(w: number, h: number): Box {
    return { x: (w - W) >> 1, y: (h - H) >> 1, w: W, h: H }
}

function closeBox(w: number, h: number): Box {
    const b = box(w, h)
    return { x: b.x + b.w - CLOSE_W - 4, y: b.y + 4, w: CLOSE_W, h: CLOSE_H }
}

function backBox(w: number, h: number): Box {
    const c = closeBox(w, h)
    return { x: c.x - BACK_W - 3, y: c.y, w: BACK_W, h: CLOSE_H }
}

/** The grid's columns: how wide each is, and where the first starts. */
function grid(b: Box, units: number): { colW: number, left: number, top: number } {
    return {
        colW: Math.min(MAX_COL_W, Math.floor((b.w - 2 * PAD - LABEL_W) / units)),
        left: b.x + PAD + LABEL_W,
        top: b.y + TITLE_H + 5 + PLATE
    }
}

const inside = (b: Box, x: number, y: number) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h

/** What a point on a view `w` × `h` is over: the close or back button, a stat's cell, the popup, or the battle round it. */
export function partyStatsTargetAt(w: number, h: number, view: PartyStatsView, x: number, y: number): PartyStatsTarget {
    if (inside(closeBox(w, h), x, y)) return 'close'
    const b = box(w, h)
    if (!inside(b, x, y)) return 'outside'
    if (view.detail) return inside(backBox(w, h), x, y) ? 'back' : 'inside'
    const units = view.units
    if (!units?.length) return 'inside'
    const g = grid(b, units.length)
    const row = Math.floor((y - (g.top + 9)) / ROW_H)
    const unit = Math.floor((x - g.left) / g.colW)
    if (row < 0 || unit < 0 || unit >= units.length || !partyStatRowOpens(row)) return 'inside'
    return `cell:${row}:${unit}`
}

const heads = new Map<string, Surface>()

/** `asset`'s portrait, cropped once: the same face the party band below wears. */
function headFor(asset: string): Surface {
    let h = heads.get(asset)
    if (!h) {
        h = headOf(asset)
        heads.set(asset, h)
    }
    return h
}

/** `text` cut to `max` px. */
function fit(text: string, max: number): string {
    let t = text
    while (t && textWidth(t) > max) t = t.slice(0, -1)
    return t
}

/** The popup over the battle, the stage dimmed behind it; `hover` is the target under the pointer. */
export function drawPartyStats(s: Surface, view: PartyStatsView, hover: PartyStatsTarget | null): void {
    dither(s, 0, 0, s.w, s.h, C.ink, 9)
    const b = box(s.w, s.h)
    panel(s, b.x, b.y, b.w, b.h)

    const c = closeBox(s.w, s.h)
    const closeLit = hover === 'close'
    rect(s, c.x, c.y, CLOSE_W, CLOSE_H, C.ink)
    rect(s, c.x + 1, c.y + 1, CLOSE_W - 2, CLOSE_H - 2, closeLit ? C.red2 : C.red1)
    rect(s, c.x + 1, c.y + 1, CLOSE_W - 2, 1, closeLit ? C.red3 : C.red2)
    for (let i = 0; i < 5; i++) {
        rect(s, c.x + 4 + i, c.y + 3 + i, 1, 1, C.white)
        rect(s, c.x + 8 - i, c.y + 3 + i, 1, 1, C.white)
    }

    if (view.detail) {
        drawDetail(s, b, view.detail, hover === 'back')
        return
    }
    drawText(s, 'PARTY STATS', b.x + PAD, b.y + 6, C.gold2, { shadow: 1 })

    const units = view.units
    if (!units) {
        drawText(s, 'LOADING...', b.x + (b.w >> 1), b.y + (b.h >> 1) - 2, C.stone3, { align: 1, shadow: 1 })
        return
    }
    if (units.length === 0) {
        drawText(s, 'NOBODY FIELDED', b.x + (b.w >> 1), b.y + (b.h >> 1) - 2, C.stone3, { align: 1, shadow: 1 })
        return
    }
    const { colW, left, top } = grid(b, units.length)
    // each column's values right-aligned under its centred name
    const colRight = (k: number) => left + (k + 1) * colW - 3
    units.forEach((unit, k) => {
        // the face on a plate above the name, ringed in gold for the Hero
        const px = left + k * colW + ((colW - PLATE) >> 1)
        const py = top - PLATE - 2
        rect(s, px, py, PLATE, PLATE, unit.hero ? C.gold2 : C.night3)
        rect(s, px + 1, py + 1, HEAD, HEAD, C.night1)
        blit(s, headFor(unit.asset), px + 1, py + 1)
        drawText(s, fit(unit.name, colW - 2), left + k * colW + (colW >> 1), top, unit.hero ? C.gold3 : C.bone1, { align: 1, shadow: 1 })
    })
    rect(s, b.x + PAD, top + 7, b.w - 2 * PAD, 1, C.night3)
    ROWS.forEach((row, r) => {
        const y = top + 10 + r * ROW_H
        // every other row banded, so a long row reads across
        if (r % 2 === 0) rect(s, b.x + PAD, y - 1, b.w - 2 * PAD, ROW_H - 1, C.night0)
        drawText(s, row.label, b.x + PAD + 2, y, C.stone3, { shadow: 1 })
        units.forEach((unit, k) => {
            // a base stat's cell opens its sources: lit under the pointer
            if (hover === `cell:${r}:${k}`) rect(s, left + k * colW, y - 1, colW, ROW_H - 1, C.night3)
            drawText(s, fit(unit.values[r] ?? '-', colW - 4), colRight(k), y, C.bone1, { align: 2, shadow: 1 })
        })
    })
    drawText(s, 'PRESS A STAT TO SEE WHERE IT COMES FROM', b.x + (b.w >> 1), b.y + b.h - 9, C.stone2, { align: 1, shadow: 1 })
}

/** One stat's sources: each stage and its factor, the parts that summed to it indented under it. */
function drawDetail(s: Surface, b: Box, d: PartyStatDetail, backLit: boolean): void {
    drawText(s, d.title, b.x + PAD, b.y + 6, C.gold2, { shadow: 1 })
    drawText(s, d.final, b.x + PAD + textWidth(d.title) + 8, b.y + 6, C.white, { shadow: 1 })
    const k = backBox(s.w, s.h)
    rect(s, k.x, k.y, k.w, k.h, C.ink)
    rect(s, k.x + 1, k.y + 1, k.w - 2, k.h - 2, backLit ? C.night3 : C.night2)
    rect(s, k.x + 1, k.y + 1, k.w - 2, 1, backLit ? C.steel2 : C.night3)
    drawText(s, 'BACK', k.x + (k.w >> 1), k.y + 3, C.bone1, { align: 1, shadow: 1 })

    const top = b.y + TITLE_H + 8
    rect(s, b.x + PAD, top - 3, b.w - 2 * PAD, 1, C.night3)
    const fits = Math.floor((b.y + b.h - PAD - top) / LINE_H)
    const right = b.x + b.w - PAD - 2
    d.lines.slice(0, fits).forEach((line, i) => {
        const y = top + i * LINE_H
        const x = b.x + PAD + 2 + (line.part ? 8 : 0)
        const valueW = textWidth(line.value)
        drawText(s, fit(line.label, right - valueW - 6 - x), x, y, line.part ? C.stone2 : C.stone3, { shadow: 1 })
        drawText(s, line.value, right, y, line.part ? C.stone3 : C.bone1, { align: 2, shadow: 1 })
    })
}
