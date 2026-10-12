// The Calendar scene: the login calendar's thirty days as a grid, ten to a row. A day still to
// claim shows the icon of what it pays and how much; a claimed day is checked off; a missed one is
// dimmed with a red corner, and today's pulses gold and claims when pressed. Under the grid, what
// the day pointed at pays, the make-up button that takes the oldest missed day, and the clocks.

import { C } from './palette'
import { line, rect, dither, type Surface } from './surface'
import { drawText } from './font'
import { glyph, type Glyph } from './icon-kit'
import { CURRENCY_ICONS } from './icons-items'
import { panel } from './ui-art'
import { plateButton, type Box } from './collections-scene'
import { KEY_ICON } from './raids-scene'
import { stageNumber } from './run-director'
import type { SceneBackdrops } from './menu-band'
import { D } from '../../../shared/utils/hero-quest/numbers'
import { getRaid, type RaidId } from '../../../shared/utils/hero-quest/content/raids'
import type { CalendarDayState } from '../../../shared/utils/hero-quest/calendar'
import type { CalendarReward } from '../../../shared/utils/hero-quest/constants'

export interface CalendarDayView {
    day: number
    state: CalendarDayState
    kind: CalendarReward['kind']
    system: string | null
    raid: RaidId | null
    /** What it pays as of now, as a number string. */
    amount: string
}

export interface CalendarView {
    /** 0-based. */
    today: number
    days: readonly CalendarDayView[]
    makeupsLeft: number
    makeupsPerCycle: number
    /** The day a make-up takes, 0-based; null when none is missed. */
    makeupDay: number | null
    /** Spelled out: time to the next day, and days to the cycle's end. */
    nextDayIn: string
    cycleDaysLeft: number
}

/** Today's cell, the make-up button, or a day pointed at for what it pays (0-based). */
export type CalendarTarget = 'claim' | 'makeup' | `day:${number}`

const COLS = 10
const CELL_W = 24
const CELL_H = 30
const GAP = 2
const GRID_Y = 16
const INFO_Y = 113
const MAKEUP: Box = { x: 6, y: 124, w: 76, h: 13 }

const MAKEUP_PLATE = [C.blue0, C.blue1, C.blue2] as const

/** The info line's right end: what a day's state means for it. */
const DAY_STATE_LINE: Readonly<Record<CalendarDayState, string>> = { today: 'PRESS TO CLAIM', claimed: 'CLAIMED', missed: 'MISSED', upcoming: 'COMING UP' }
const SEAL_NAME: Readonly<Record<string, string>> = { gear: 'FORGE SEALS', champion: 'GUILD SEALS', skill: 'SKILL SEALS', artifact: 'EXCAVATION SEALS' }

function cellBox(w: number, i: number): Box {
    const x0 = (w - (COLS * CELL_W + (COLS - 1) * GAP)) >> 1
    return { x: x0 + (i % COLS) * (CELL_W + GAP), y: GRID_Y + Math.floor(i / COLS) * (CELL_H + GAP), w: CELL_W, h: CELL_H }
}

function inside(b: Box, x: number, y: number): boolean {
    return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h
}

function iconFor(d: CalendarDayView): Glyph {
    if (d.kind === 'seals') return CURRENCY_ICONS[`seal_${d.system}`]!
    if (d.kind === 'keys') return CURRENCY_ICONS[KEY_ICON[d.raid!]]!
    return CURRENCY_ICONS[d.kind]!
}

/** What a day pays, spelled out in full. */
export function calendarRewardLabel(d: CalendarDayView): string {
    const n = stageNumber(D(d.amount))
    switch (d.kind) {
        case 'gold': return `${n} GOLD`
        case 'gems': return `${n} GEMS`
        case 'trait_gems': return `${n} TRAIT GEMS`
        case 'void_shards': return `${n} VOID SHARDS`
        case 'seals': return `${n} ${SEAL_NAME[d.system!] ?? 'SEALS'}`
        case 'keys': return `${n} ${getRaid(d.raid!).key.toUpperCase()}`
    }
}

/** Whether the make-up button does anything now. */
export function calendarMakeupEnabled(view: CalendarView): boolean {
    return view.makeupDay !== null && view.makeupsLeft > 0
}

/** What a point on the view is over. */
export function calendarTargetAt(view: CalendarView, w: number, x: number, y: number): CalendarTarget | null {
    if (inside(MAKEUP, x, y)) return 'makeup'
    for (let i = 0; i < view.days.length; i++) {
        if (!inside(cellBox(w, i), x, y)) continue
        return view.days[i]!.state === 'today' ? 'claim' : `day:${i}`
    }
    return null
}

/** A green tick, outlined in ink, centred on (x, y). */
function check(s: Surface, x: number, y: number): void {
    for (const [dx, dy, c] of [[1, 1, C.ink], [0, 0, C.green2], [0, -1, C.green3]] as const) {
        line(s, x - 5 + dx, y + dy, x - 2 + dx, y + 3 + dy, c)
        line(s, x - 2 + dx, y + 3 + dy, x + 4 + dx, y - 3 + dy, c)
        line(s, x - 5 + dx, y + 1 + dy, x - 2 + dx, y + 4 + dy, c)
        line(s, x - 2 + dx, y + 4 + dy, x + 4 + dx, y - 2 + dy, c)
    }
}

export class CalendarScene {
    constructor(private readonly backdrops: SceneBackdrops) {}

    /** `hover` is what the pointer is over; `busy` holds the claim and the make-up while one is on its way. */
    render(t: number, view: CalendarView, hover: CalendarTarget | null, pressed: boolean, busy: boolean): Surface {
        // the Calendar's tabs stand where a title would (`scene-tabs.ts`), drawn over by the canvas
        const s = this.backdrops.render('calendar', t, false)
        drawText(s, `DAY ${view.today + 1} OF ${view.days.length}`, s.w - 6, 4, C.bone1, { align: 2, shadow: 1 })

        const pulse = Math.floor(t * 3) % 2 === 0
        const makeupLit = hover === 'makeup' && calendarMakeupEnabled(view)
        view.days.forEach((d, i) => {
            const b = cellBox(s.w, i)
            const today = d.state === 'today'
            const lit = today ? hover === 'claim' : hover === `day:${i}`
            const sink = today && lit && pressed && !busy ? 1 : 0
            panel(s, b.x, b.y + sink, b.w, b.h - sink, undefined, today ? C.night2 : C.night1)
            glyph(s, iconFor(d), b.x + (b.w >> 1), b.y + 14 + sink, true)
            drawText(s, stageNumber(D(d.amount)), b.x + (b.w >> 1), b.y + 22 + sink, C.bone1, { align: 1, shadow: 1 })

            // a day done with is dimmed under its number: checked off, or a red corner for one missed
            if (d.state === 'claimed' || d.state === 'missed') dither(s, b.x + 2, b.y + 2, b.w - 4, b.h - 4, C.ink, d.state === 'claimed' ? 9 : 10)
            drawText(s, String(d.day), b.x + 3, b.y + 3 + sink, C.stone3, { shadow: 1 })
            if (d.state === 'claimed') check(s, b.x + (b.w >> 1), b.y + 15)
            else if (d.state === 'missed') {
                rect(s, b.x + b.w - 6, b.y + 2, 4, 1, C.red2)
                rect(s, b.x + b.w - 3, b.y + 2, 1, 4, C.red2)
            }

            // the outline: today's pulses, the make-up's day lights while its button is pointed at
            const rim = today ? (pulse || lit ? C.gold3 : C.gold1) : makeupLit && view.makeupDay === i ? C.blue2 : lit ? C.steel3 : null
            if (rim !== null) {
                rect(s, b.x - 1, b.y - 1 + sink, b.w + 2, 1, rim)
                rect(s, b.x - 1, b.y + b.h, b.w + 2, 1, rim)
                rect(s, b.x - 1, b.y - 1 + sink, 1, b.h + 2 - sink, rim)
                rect(s, b.x + b.w, b.y - 1 + sink, 1, b.h + 2 - sink, rim)
            }
        })

        // what the day pointed at pays; today's, with what to do about it, when nothing is
        const at = hover === 'claim' ? view.today : hover?.startsWith('day:') ? Number(hover.slice(4)) : hover === 'makeup' ? view.makeupDay : null
        const shown = view.days[at ?? view.today]
        if (shown) {
            const why = DAY_STATE_LINE[shown.state]
            drawText(s, `DAY ${shown.day}: ${calendarRewardLabel(shown)}`, 6, INFO_Y, C.bone1, { shadow: 1 })
            drawText(s, why, s.w - 6, INFO_Y, shown.state === 'today' ? C.gold3 : shown.state === 'missed' ? C.red2 : C.stone3, { align: 2, shadow: 1 })
        }

        const canMakeup = calendarMakeupEnabled(view)
        plateButton(s, MAKEUP, view.makeupDay === null ? 'NO MISSED DAYS' : `MAKE UP DAY ${view.makeupDay + 1}`, MAKEUP_PLATE, canMakeup && !busy, hover === 'makeup', pressed)
        drawText(s, `${view.makeupsLeft} OF ${view.makeupsPerCycle} MAKE-UPS LEFT`, MAKEUP.x + MAKEUP.w + 6, MAKEUP.y + 4, C.stone3, { shadow: 1 })
        drawText(s, `NEXT DAY IN ${view.nextDayIn}`, s.w - 6, MAKEUP.y + 4, C.stone3, { align: 2, shadow: 1 })
        drawText(s, `THE CALENDAR STARTS OVER IN ${view.cycleDaysLeft} DAY${view.cycleDaysLeft === 1 ? '' : 'S'}. MISSED DAYS DON'T WAIT.`, 6, MAKEUP.y + 17, C.stone2, { shadow: 1 })
        return s
    }
}
