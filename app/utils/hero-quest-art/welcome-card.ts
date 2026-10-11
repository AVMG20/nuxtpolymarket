// The welcome-back card: what a stretch away banked, over the stage when the player returns. The
// real time away against the time the offline rules counted, the Gold, XP, kills, levels and stages
// it came to, then a line for each thing that held it back or sped it up, and a button to put it away.

import { C } from './palette'
import { dither, type Surface } from './surface'
import { drawText, textWidth } from './font'
import { glyph } from './icon-kit'
import { CURRENCY_ICONS } from './icons-items'
import { panel } from './ui-art'
import { plateButton, type Box } from './collections-scene'

export interface WelcomeView {
    /** Real time away, and what the offline cap, Battle Speed and efficiency made of it. */
    away: string
    counted: string
    gold: string
    xp: string
    kills: string
    /** "LEVEL 12 > 14", or null when no level was reached. */
    level: string | null
    /** Where the run went, or null when it stayed on its stage. */
    stage: string | null
    notes: readonly WelcomeNote[]
}

/** `bad` lost time or a wall, `warn` a tax, `info` a boost, `good` something the player can do. */
export interface WelcomeNote {
    text: string
    tone: 'bad' | 'warn' | 'info' | 'good'
}

const TONE: Readonly<Record<WelcomeNote['tone'], number>> = { bad: C.red2, warn: C.gold2, info: C.blue2, good: C.green3 }

const W = 228
const LINE = 9
const NOTE = 8
const BTN = { w: 60, h: 13 }
const RIM = [C.gold0, C.gold1, C.gold2] as const
const PLATE = [C.green0, C.green1, C.green2] as const

function cardBox(w: number, h: number, view: WelcomeView): Box {
    const rows = 2 + (view.stage ? 1 : 0)
    const ch = 5 + 11 + LINE + 4 + rows * LINE + (view.notes.length ? 4 + view.notes.length * NOTE : 0) + 6 + BTN.h + 5
    return { x: (w - W) >> 1, y: Math.max(2, (h - ch) >> 1), w: W, h: ch }
}

function buttonBox(w: number, h: number, view: WelcomeView): Box {
    const b = cardBox(w, h, view)
    return { x: b.x + ((b.w - BTN.w) >> 1), y: b.y + b.h - BTN.h - 5, w: BTN.w, h: BTN.h }
}

/** Whether a point on a view `w` × `h` is on the card's button. */
export function onWelcomeButton(w: number, h: number, view: WelcomeView, x: number, y: number): boolean {
    const b = buttonBox(w, h, view)
    return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h
}

export function drawWelcome(s: Surface, view: WelcomeView, lit: boolean, pressed: boolean): void {
    dither(s, 0, 0, s.w, s.h, C.ink, 9)
    const b = cardBox(s.w, s.h, view)
    panel(s, b.x, b.y, b.w, b.h, RIM)
    const cx = b.x + (b.w >> 1)
    let y = b.y + 5
    drawText(s, 'WELCOME BACK', cx, y, C.gold2, { font: 'big', align: 1, shadow: 1 })
    y += 11
    drawText(s, `AWAY ${view.away}  COUNTED ${view.counted}`, cx, y, C.stone3, { align: 1, shadow: 1 })
    y += LINE + 4

    // two columns: what it paid on the left, what it did on the right
    const left = b.x + 14
    const right = cx + 8
    glyph(s, CURRENCY_ICONS.gold!, left + 4, y + 2, true)
    drawText(s, `${view.gold} GOLD`, left + 12, y, C.gold3, { shadow: 1 })
    drawText(s, view.kills, right, y, C.bone1, { shadow: 1 })
    y += LINE
    drawText(s, `${view.xp} XP`, left + 12, y, C.purple2, { shadow: 1 })
    if (view.level) drawText(s, view.level, right, y, C.green3, { shadow: 1 })
    y += LINE
    if (view.stage) {
        drawText(s, view.stage, cx, y, C.bone1, { align: 1, shadow: 1 })
        y += LINE
    }

    if (view.notes.length) {
        y += 4
        for (const note of view.notes) {
            // a tone mark before each line, so the colours read even where the text is long
            const tw = textWidth(note.text)
            const nx = cx - ((tw + 6) >> 1)
            drawText(s, '-', nx, y, TONE[note.tone], { shadow: 1 })
            drawText(s, note.text, nx + 6, y, TONE[note.tone], { shadow: 1 })
            y += NOTE
        }
    }
    plateButton(s, buttonBox(s.w, s.h, view), 'CONTINUE', PLATE, true, lit, pressed)
}
