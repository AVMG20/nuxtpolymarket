// The Settings scene: one panel per setting, its name over a line saying what it does, and its
// control on the right, an ON/OFF switch or a button. Grouped under small headings as the list grows,
// and scrolled under a fixed title once it outgrows the stage, a thin bar on the right saying where.

import { C } from './palette'
import { rect, type Surface } from './surface'
import { drawText } from './font'
import { panel } from './ui-art'
import { plateButton, type Box } from './collections-scene'
import type { SceneBackdrops } from './menu-band'
import { HQ_STAGE_SIZES, type HqStageSize } from './stage-size'
import type { HqSettingKey, HqSettings } from '#shared/utils/hero-quest/settings'
import { GUIDE_NAME } from '#shared/utils/hero-quest/content/tutorials'

export interface SettingsView {
    settings: HqSettings
    /** Whether there are tutorial flags to reset yet; until then the button waits. */
    tutorialsReady: boolean
    /** This browser's stage size (`useHqStageSize`), not an account setting. */
    stageSize: HqStageSize
}

/** A row's control: a switch for a setting, the one-off reset, or one of the stage sizes. */
export type SettingsTarget = HqSettingKey | 'resetTutorials' | `stage:${HqStageSize}`

/** Whether a control is one of the stage sizes, which the page keeps rather than the server. */
export function isStageTarget(target: SettingsTarget): target is `stage:${HqStageSize}` {
    return target.startsWith('stage:')
}

interface Row { id: HqSettingKey | 'resetTutorials' | 'stageSize', name: string, line: string }

const SECTIONS: readonly { title: string, rows: readonly Row[] }[] = [
    {
        title: 'TUTORIALS',
        rows: [
            { id: 'tutorials', name: 'SHOW TUTORIALS', line: `${GUIDE_NAME.toUpperCase()} EXPLAINS EACH PART OF THE GAME AS IT OPENS.` },
            { id: 'resetTutorials', name: 'RESET TUTORIALS', line: 'SEE EVERY TUTORIAL AGAIN.' }
        ]
    },
    {
        // every spend of a hard-won currency that asks for a second press
        title: 'CONFIRMATIONS',
        rows: [
            { id: 'confirmGoldSeals', name: 'GOLD PULLS', line: 'A PULL THAT BUYS SEALS WITH GOLD.' },
            { id: 'confirmVoidShards', name: 'VOID SHARD SPENDING', line: 'A PRESTIGE SHOP PURCHASE IN VOID SHARDS.' },
            { id: 'confirmGemSpends', name: 'GEM SPENDING', line: 'BATTLE SPEED, A SHOP SLOT OR AN ARENA BUY IN GEMS.' },
            { id: 'confirmTreeRespec', name: 'TREE RESPEC', line: 'A PASSIVE TREE RESPEC, FREE OR PAID IN GEMS.' },
            { id: 'confirmTraitSpends', name: 'TRAIT SPENDING', line: 'AN AUTO ROLL, A SET LOADED OR BOUGHT, A GRADED SAVE REPLACED.' }
        ]
    },
    {
        title: 'DISPLAY',
        rows: [
            { id: 'stageSize', name: 'SCREEN SIZE', line: 'SMALL IS THE ORIGINAL SIZE.' },
            { id: 'reduceMotion', name: 'REDUCE MOTION', line: 'NO SCREEN SHAKE AND FEWER FLASHES.' },
            { id: 'fastReveals', name: 'FAST PULL REVEALS', line: 'A PULL SHOWS ITS CARDS AT ONCE, WITHOUT THE DEAL.' },
            { id: 'skillCinematics', name: 'SKILL CINEMATICS', line: 'THE HERO\'S SIGNATURE SKILL PLAYS ITS CINEMATIC.' },
            { id: 'combatNumbers', name: 'COMBAT NUMBERS', line: 'DAMAGE, HEAL AND MISS NUMBERS OVER THE FIGHT.' },
            { id: 'detailedDescriptions', name: 'DESCRIPTIONS', line: 'COLLECTIONS ITEMS IN SHORT, OR WITH EXACT FIGURES.' }
        ]
    },
    {
        // the red dots on the menu buttons; a scene not visited yet always gets its own
        title: 'MENU DOTS',
        rows: [
            { id: 'dotFreePulls', name: 'FREE PULLS', line: 'GACHA, WHEN A FREE PULL IS READY.' },
            { id: 'dotUpgrades', name: 'UPGRADES', line: 'COLLECTIONS, WHEN SOMETHING CAN BE LEVELLED OR BEATS YOUR GEAR.' },
            { id: 'dotTreeNodes', name: 'TREE NODES', line: 'SKILL TREE, WHEN A NODE CAN BE BOUGHT.' },
            { id: 'dotRewards', name: 'REWARDS', line: 'CALENDAR AND ARENA, WHEN A REWARD WAITS.' }
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
const CTRL_GAP = 2

const ON_PLATE = [C.green0, C.green1, C.green2] as const
const OFF_PLATE = [C.night0, C.night2, C.night3] as const
const ACT_PLATE = [C.red0, C.red1, C.red2] as const

/** A row's controls, right to left from its edge: one for a switch or the reset, a button per size for the stage. */
function controlsOf(row: Row, box: Box): { id: SettingsTarget, box: Box }[] {
    const y = box.y + ((ROW_H - CTRL_H) >> 1)
    const right = box.x + box.w - 5
    if (row.id !== 'stageSize') return [{ id: row.id, box: { x: right - CTRL_W, y, w: CTRL_W, h: CTRL_H } }]
    const n = HQ_STAGE_SIZES.length
    return HQ_STAGE_SIZES.map((size, i) => ({
        id: `stage:${size}` as const,
        box: { x: right - (n - i) * CTRL_W - (n - 1 - i) * CTRL_GAP, y, w: CTRL_W, h: CTRL_H }
    }))
}

/** Every row's box and its controls', top to bottom, with the headings' places, `scroll` px up. */
function layout(w: number, scroll = 0): { heads: { title: string, y: number }[], rows: { row: Row, box: Box, ctrls: { id: SettingsTarget, box: Box }[] }[], bottom: number } {
    const heads: { title: string, y: number }[] = []
    const rows: { row: Row, box: Box, ctrls: { id: SettingsTarget, box: Box }[] }[] = []
    let y = TOP - Math.round(scroll)
    for (const section of SECTIONS) {
        heads.push({ title: section.title, y })
        y += HEAD_H
        for (const row of section.rows) {
            const box = { x: ROW_X, y, w: w - ROW_X * 2, h: ROW_H }
            rows.push({ row, box, ctrls: controlsOf(row, box) })
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
    for (const { ctrls } of layout(w, scroll).rows) {
        for (const { id, box } of ctrls) if (x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h) return id
    }
    return null
}

export class SettingsScene {
    constructor(private readonly backdrops: SceneBackdrops) {}

    render(t: number, view: SettingsView, hover: SettingsTarget | null, pressed: boolean, busy: boolean, scroll = 0): Surface {
        const s = this.backdrops.render('settings', t, false)
        const { heads, rows } = layout(s.w, scroll)
        for (const head of heads) drawText(s, head.title, ROW_X + 1, head.y + 1, C.stone3, { shadow: 1 })
        for (const { row, box, ctrls } of rows) {
            panel(s, box.x, box.y, box.w, box.h)
            drawText(s, row.name, box.x + 5, box.y + 5, C.bone1, { shadow: 1 })
            drawText(s, row.line, box.x + 5, box.y + 14, C.stone3, { shadow: 1 })
            for (const { id, box: ctrl } of ctrls) {
                const enabled = !busy && settingsTargetEnabled(view, id)
                const lit = hover === id
                if (id === 'resetTutorials') {
                    plateButton(s, ctrl, view.tutorialsReady ? 'RESET' : 'SOON', ACT_PLATE, enabled, lit, pressed)
                } else if (isStageTarget(id)) {
                    const size = id.slice(6) as HqStageSize
                    const on = view.stageSize === size
                    plateButton(s, ctrl, size === 'mid' ? 'MID' : size.toUpperCase(), on ? ON_PLATE : OFF_PLATE, enabled, lit, pressed)
                } else if (id === 'detailedDescriptions') {
                    const on = view.settings[id]
                    plateButton(s, ctrl, on ? 'DETAILED' : 'SHORT', on ? ON_PLATE : OFF_PLATE, enabled, lit, pressed)
                } else {
                    const on = view.settings[id]
                    plateButton(s, ctrl, on ? 'ON' : 'OFF', on ? ON_PLATE : OFF_PLATE, enabled, lit, pressed)
                }
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
