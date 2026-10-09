// The guide's dialog (`shared/utils/hero-quest/tutorials.ts`): a panel near the top of the stage,
// clear of the party band and the menu, with the snail's portrait, its name, the page being read,
// a page count and a Skip button. A press anywhere else on the panel turns the page, and on the last
// page closes it. Drawn over whatever scene is open, so the battle runs on behind it.

import { C } from './palette'
import { disc, line, px, rect, ring, type Surface } from './surface'
import { drawText, textWidth } from './font'
import { panel } from './ui-art'
import { plateButton, type Box } from './collections-scene'

export interface GuideView {
    name: string
    pages: readonly string[]
    /** 0-based. */
    page: number
}

export type GuideTarget = 'guide:next' | 'guide:skip'

const BOX: Box = { x: 4, y: 16, w: 264, h: 38 }
const PORTRAIT: Box = { x: BOX.x + 3, y: BOX.y + 3, w: 32, h: 32 }
const SKIP: Box = { x: BOX.x + BOX.w - 33, y: BOX.y + 3, w: 30, h: 11 }
const TEXT_X = PORTRAIT.x + PORTRAIT.w + 5
const TEXT_W = BOX.x + BOX.w - 6 - TEXT_X
const SKIP_PLATE = [C.stone0, C.stone1, C.stone2] as const

function inside(b: Box, x: number, y: number): boolean {
    return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h
}

/** Break text onto lines no wider than `width` px. */
function wrap(text: string, width: number): string[] {
    const out: string[] = []
    let current = ''
    for (const word of text.toUpperCase().split(' ')) {
        const next = current ? `${current} ${word}` : word
        if (current && textWidth(next) > width) {
            out.push(current)
            current = word
        } else current = next
    }
    if (current) out.push(current)
    return out
}

/** A page as the panel prints it: two lines at most, the second clear of the tap hint. */
export function guideLines(page: string): string[] {
    return wrap(page, TEXT_W).slice(0, 2)
}

/** Whether a page fits the panel whole: what the tutorial spec holds every page to. */
export function guidePageFits(page: string): boolean {
    return wrap(page, TEXT_W).length <= 2
}

export function guideTargetAt(x: number, y: number): GuideTarget | null {
    if (inside(SKIP, x, y)) return 'guide:skip'
    return inside(BOX, x, y) ? 'guide:next' : null
}

/**
 * The snail, a placeholder until its art round: a brown spiral shell on a green body, two eye
 * stalks, bobbing a pixel as it talks.
 */
function snail(s: Surface, b: Box, t: number): void {
    rect(s, b.x, b.y, b.w, b.h, C.night0)
    const bob = Math.floor(t * 3) % 2
    const cx = b.x + 17
    const cy = b.y + 18 + bob
    // the body: a soft foot along the ground, the head raised at the left
    rect(s, cx - 13, cy + 7, 24, 4, C.green2)
    rect(s, cx - 13, cy + 7, 24, 1, C.green3)
    rect(s, cx - 13, cy + 2, 5, 6, C.green2)
    px(s, cx - 12, cy + 2, C.green3)
    // eye stalks and their eyes
    line(s, cx - 12, cy + 2, cx - 14, cy - 5, C.green2)
    line(s, cx - 9, cy + 2, cx - 8, cy - 5, C.green2)
    disc(s, cx - 14, cy - 6, 1.5, C.white); px(s, cx - 14, cy - 6, C.ink)
    disc(s, cx - 8, cy - 6, 1.5, C.white); px(s, cx - 8, cy - 6, C.ink)
    // the shell: a disc with a spiral wound into it
    disc(s, cx + 2, cy + 1, 8, C.brown1)
    disc(s, cx + 2, cy + 1, 7, C.brown2)
    ring(s, cx + 2, cy + 1, 5, C.brown3)
    ring(s, cx + 3, cy + 1, 2, C.brown1)
    px(s, cx + 3, cy + 1, C.gold2)
    px(s, cx - 1, cy - 4, C.bone1)
}

export function drawGuide(s: Surface, t: number, view: GuideView, hover: GuideTarget | null, pressed: boolean): void {
    panel(s, BOX.x, BOX.y, BOX.w, BOX.h, undefined, C.night1)
    snail(s, PORTRAIT, t)
    drawText(s, view.name.toUpperCase(), TEXT_X, BOX.y + 4, C.gold2, { shadow: 1 })
    if (view.pages.length > 1) {
        drawText(s, `${view.page + 1}/${view.pages.length}`, SKIP.x - 4, BOX.y + 4, C.stone3, { align: 2, shadow: 1 })
    }
    plateButton(s, SKIP, 'SKIP', SKIP_PLATE, true, hover === 'guide:skip', pressed)
    guideLines(view.pages[view.page] ?? '').forEach((l, i) => {
        drawText(s, l, TEXT_X, BOX.y + 14 + i * 7, C.bone1, { shadow: 1 })
    })
    const last = view.page >= view.pages.length - 1
    const pulse = Math.floor(t * 2) % 2 === 0
    drawText(s, last ? 'TAP TO CLOSE' : 'TAP TO GO ON', BOX.x + BOX.w - 6, BOX.y + BOX.h - 9,
        hover === 'guide:next' || pulse ? C.gold3 : C.gold1, { align: 2, shadow: 1 })
}
