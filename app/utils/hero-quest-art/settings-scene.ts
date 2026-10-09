// The Settings scene: one panel per setting, its name over a line saying what it does, and its
// control on the right, an ON/OFF switch or a button. Grouped under small headings as the list grows,
// and scrolled under a fixed title once it outgrows the stage, a thin bar on the right saying where.

import { C } from './palette'
import { rect, type Surface } from './surface'
import { drawText } from './font'
import { panel } from './ui-art'
import { plateButton, type Box } from './collections-scene'
import type { SceneBackdrops } from './menu-band'
import type { HqSettingKey, HqSettings } from '../../../shared/utils/hero-quest/settings'

export interface SettingsView {
    settings: HqSettings
    /** Whether there are tutorial flags to reset yet; until then the button waits. */
    tutorialsReady: boolean
}

/** A row's control: a switch for a setting, or the one-off reset. */
export type SettingsTarget = HqSettingKey | 'resetTutorials'

interface Row { id: SettingsTarget, name: string, line: string }

const SECTIONS: readonly { title: string, rows: readonly Row[] }[] = [
    {
        title: 'TUTORIALS',
        rows: [
            { id: 'tutorials', name: 'SHOW TUTORIALS', line: 'SHELLBY EXPLAINS EACH PART OF THE GAME AS IT OPENS.' },
            { id: 'resetTutorials', name: 'RESET TUTORIALS', line: 'SEE EVERY TUTORIAL AGAIN.' }
        ]
    },
    {
        // every spend of a hard-won currency that asks for a second press
        title: 'CONFIRMATIONS',
        rows: [
            { id: 'confirmGoldSeals', name: 'GOLD PULLS', line: 'A PULL THAT BUYS SEALS WITH GOLD.' },
            { id: 'confirmVoidShards', name: 'VOID SHARD SPENDING', line: 'A PRESTIGE SHOP PURCHASE IN VOID SHARDS.' },
            { id: 'confirmGemSpeed', name: 'BATTLE SPEED', line: 'A BATTLE SPEED BLOCK BOUGHT WITH GEMS.' }
        ]
    }
]

/** The title band that stays put while the rows scroll under it. */
export const SETTINGS_HEADER = 14
const ROW_X = 6
const ROW_H = 24
const ROW_GAP = 3
const HEAD_H = 10
const TOP = 16
const CTRL_W = 34
const CTRL_H = 13

const ON_PLATE = [C.green0, C.green1, C.green2] as const
const OFF_PLATE = [C.night0, C.night2, C.night3] as const
const ACT_PLATE = [C.red0, C.red1, C.red2] as const

/** Every row's box and its control's, top to bottom, with the headings' places, `scroll` px up. */
function layout(w: number, scroll = 0): { heads: { title: string, y: number }[], rows: { row: Row, box: Box, ctrl: Box }[], bottom: number } {
    const heads: { title: string, y: number }[] = []
    const rows: { row: Row, box: Box, ctrl: Box }[] = []
    let y = TOP - Math.round(scroll)
    for (const section of SECTIONS) {
        heads.push({ title: section.title, y })
        y += HEAD_H
        for (const row of section.rows) {
            const box = { x: ROW_X, y, w: w - ROW_X * 2, h: ROW_H }
            rows.push({ row, box, ctrl: { x: box.x + box.w - CTRL_W - 5, y: y + ((ROW_H - CTRL_H) >> 1), w: CTRL_W, h: CTRL_H } })
            y += ROW_H + ROW_GAP
        }
        y += 2
    }
    return { heads, rows, bottom: y + Math.round(scroll) }
}

/** How far the list scrolls on a scene `h` px tall: 0 while it all fits. */
export function settingsMaxScroll(w: number, h: number): number {
    return Math.max(0, layout(w).bottom + 2 - h)
}

/** Whether a row's control does anything now. */
export function settingsTargetEnabled(view: SettingsView, id: SettingsTarget): boolean {
    return id !== 'resetTutorials' || view.tutorialsReady
}

/** The control a point on the view is over, with the list scrolled `scroll` px. The title band covers it. */
export function settingsTargetAt(w: number, x: number, y: number, scroll = 0): SettingsTarget | null {
    if (y < SETTINGS_HEADER) return null
    for (const { row, ctrl } of layout(w, scroll).rows) {
        if (x >= ctrl.x && x < ctrl.x + ctrl.w && y >= ctrl.y && y < ctrl.y + ctrl.h) return row.id
    }
    return null
}

export class SettingsScene {
    constructor(private readonly backdrops: SceneBackdrops) {}

    render(t: number, view: SettingsView, hover: SettingsTarget | null, pressed: boolean, busy: boolean, scroll = 0): Surface {
        const s = this.backdrops.render('settings', t, false)
        const { heads, rows } = layout(s.w, scroll)
        for (const head of heads) drawText(s, head.title, ROW_X + 1, head.y + 1, C.stone3, { shadow: 1 })
        for (const { row, box, ctrl } of rows) {
            panel(s, box.x, box.y, box.w, box.h)
            drawText(s, row.name, box.x + 5, box.y + 5, C.bone1, { shadow: 1 })
            drawText(s, row.line, box.x + 5, box.y + 14, C.stone3, { shadow: 1 })
            const enabled = !busy && settingsTargetEnabled(view, row.id)
            const lit = hover === row.id
            if (row.id === 'resetTutorials') {
                plateButton(s, ctrl, view.tutorialsReady ? 'RESET' : 'SOON', ACT_PLATE, enabled, lit, pressed)
            } else {
                const on = view.settings[row.id]
                plateButton(s, ctrl, on ? 'ON' : 'OFF', on ? ON_PLATE : OFF_PLATE, enabled, lit, pressed)
            }
        }
        // the title band over whatever scrolled under it
        rect(s, 0, 0, s.w, SETTINGS_HEADER, C.ink)
        drawText(s, 'SETTINGS', 6, 4, C.gold2, { shadow: 1 })
        const max = settingsMaxScroll(s.w, s.h)
        if (max > 0) {
            // the bar: its track down the right margin, the thumb as long as the share of the list in view
            const track = s.h - SETTINGS_HEADER - 4
            const thumb = Math.max(8, Math.round(track * (s.h - SETTINGS_HEADER) / (s.h - SETTINGS_HEADER + max)))
            const at = SETTINGS_HEADER + 2 + Math.round((track - thumb) * Math.min(1, scroll / max))
            rect(s, s.w - 4, SETTINGS_HEADER + 2, 2, track, C.night2)
            rect(s, s.w - 4, at, 2, thumb, C.stone3)
        }
        return s
    }
}
