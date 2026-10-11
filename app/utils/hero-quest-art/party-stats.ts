// The party's stats: a popup over the battle, opened from the profile badge's portrait. One column
// per fielded unit, the Hero first, one row per stat, read from `stats.get.ts` when it opens.

import { C } from './palette'
import { rect, dither, type Surface } from './surface'
import { drawText, textWidth } from './font'
import { panel } from './ui-art'
import { stageNumber } from './run-director'
import { D } from '../../../shared/utils/hero-quest/numbers'
import { CHAMPION_BY_ID } from '../../../shared/utils/hero-quest/content/champions'

/** One fielded unit's column: its name, and each row's value already spelled out. */
export interface PartyStatsUnit {
    name: string
    hero: boolean
    values: readonly string[]
}

/** Null `units` while the read is out. */
export interface PartyStatsView {
    units: readonly PartyStatsUnit[] | null
}

export type PartyStatsTarget = 'close' | 'inside' | 'outside'

/** What `stats.get.ts` returns, as far as this reads it. */
export interface PartyStatsPayload {
    units: readonly {
        label: string
        role: string | null
        stats: readonly { key: string, final: string }[]
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

/** The popup's columns from the stats read, Hero first as it sends them. */
export function partyStatsView(payload: PartyStatsPayload): PartyStatsView {
    return {
        units: payload.units.map(unit => ({
            // a Champion comes labelled by its id: it shows by its given name
            name: (unit.role === null ? unit.label : CHAMPION_BY_ID[unit.label]?.givenName ?? unit.label).toUpperCase(),
            hero: unit.role === null,
            values: ROWS.map((row) => {
                if (row.stat) {
                    const stat = unit.stats.find(s => s.key === row.stat)
                    return stat ? statNumber(stat.final) : '-'
                }
                return (unit.derived.find(d => d.key === row.derived)?.value ?? '-').toUpperCase()
            })
        }))
    }
}

interface Box { x: number, y: number, w: number, h: number }

const W = 252
const H = 130
const PAD = 6
const LABEL_W = 36
const MAX_COL_W = 64
const ROW_H = 8
const TITLE_H = 12
const CLOSE_W = 13
const CLOSE_H = 11

function box(w: number, h: number): Box {
    return { x: (w - W) >> 1, y: (h - H) >> 1, w: W, h: H }
}

function closeBox(w: number, h: number): Box {
    const b = box(w, h)
    return { x: b.x + b.w - CLOSE_W - 4, y: b.y + 4, w: CLOSE_W, h: CLOSE_H }
}

const inside = (b: Box, x: number, y: number) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h

/** What a point on a view `w` × `h` is over: the close button, the popup, or the battle round it. */
export function partyStatsTargetAt(w: number, h: number, x: number, y: number): PartyStatsTarget {
    if (inside(closeBox(w, h), x, y)) return 'close'
    return inside(box(w, h), x, y) ? 'inside' : 'outside'
}

/** `text` cut to `max` px. */
function fit(text: string, max: number): string {
    let t = text
    while (t && textWidth(t) > max) t = t.slice(0, -1)
    return t
}

/** The popup over the battle, the stage dimmed behind it. */
export function drawPartyStats(s: Surface, view: PartyStatsView, closeLit: boolean): void {
    dither(s, 0, 0, s.w, s.h, C.ink, 9)
    const b = box(s.w, s.h)
    panel(s, b.x, b.y, b.w, b.h)
    drawText(s, 'PARTY STATS', b.x + PAD, b.y + 6, C.gold2, { shadow: 1 })

    const c = closeBox(s.w, s.h)
    rect(s, c.x, c.y, CLOSE_W, CLOSE_H, C.ink)
    rect(s, c.x + 1, c.y + 1, CLOSE_W - 2, CLOSE_H - 2, closeLit ? C.red2 : C.red1)
    rect(s, c.x + 1, c.y + 1, CLOSE_W - 2, 1, closeLit ? C.red3 : C.red2)
    for (let i = 0; i < 5; i++) {
        rect(s, c.x + 4 + i, c.y + 3 + i, 1, 1, C.white)
        rect(s, c.x + 8 - i, c.y + 3 + i, 1, 1, C.white)
    }

    const units = view.units
    if (!units) {
        drawText(s, 'LOADING...', b.x + (b.w >> 1), b.y + (b.h >> 1) - 2, C.stone3, { align: 1, shadow: 1 })
        return
    }
    if (units.length === 0) {
        drawText(s, 'NOBODY FIELDED', b.x + (b.w >> 1), b.y + (b.h >> 1) - 2, C.stone3, { align: 1, shadow: 1 })
        return
    }
    const colW = Math.min(MAX_COL_W, Math.floor((b.w - 2 * PAD - LABEL_W) / units.length))
    const left = b.x + PAD + LABEL_W
    const top = b.y + TITLE_H + 6
    // each column's values right-aligned under its centred name
    const colRight = (k: number) => left + (k + 1) * colW - 3
    units.forEach((unit, k) => {
        drawText(s, fit(unit.name, colW - 2), left + k * colW + (colW >> 1), top, unit.hero ? C.gold3 : C.bone1, { align: 1, shadow: 1 })
    })
    rect(s, b.x + PAD, top + 7, b.w - 2 * PAD, 1, C.night3)
    ROWS.forEach((row, r) => {
        const y = top + 10 + r * ROW_H
        // every other row banded, so a long row reads across
        if (r % 2 === 0) rect(s, b.x + PAD, y - 1, b.w - 2 * PAD, ROW_H - 1, C.night0)
        drawText(s, row.label, b.x + PAD + 2, y, C.stone3, { shadow: 1 })
        units.forEach((unit, k) => {
            drawText(s, fit(unit.values[r] ?? '-', colW - 4), colRight(k), y, C.bone1, { align: 2, shadow: 1 })
        })
    })
}
