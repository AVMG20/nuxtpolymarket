// The guide's dialog (`shared/utils/hero-quest/tutorials.ts`): a bar along the bottom of the scene,
// just over the menu band, with Mossimer's portrait (`guide-portrait.ts`), its name, the page being
// read and a page count. A tutorial is forced (the user's call, 2026-10-09): the whole frame dims
// behind the bar and only one thing answers a press. An unlock points at its scene's menu button,
// left lit, and only that button works; any other tutorial is read by pressing the bar, which turns
// the page and closes it on the last. There is no skip.

import { C, shadeLut } from './palette'
import { rect, type Surface } from './surface'
import { drawText, textWidth } from './font'
import { panel } from './ui-art'
import { drawGuidePortrait } from './guide-portrait'
import { menuButtonRect } from './menu-band'
import type { Box } from './collections-scene'
import { HQ_SCENE_LABELS, type HqMenuScene } from '../hero-quest-scenes'

export interface GuideView {
    name: string
    pages: readonly string[]
    /** 0-based. */
    page: number
    /** An unlock's scene: its menu button is the one thing that can be pressed. Null to read by pressing the bar. */
    focus: HqMenuScene | null
}

export type GuideTarget = 'guide:next'

/** As wide as the battle stage allows; a wider scene (the prestige gate) centres it. */
const BAR_W = 264
const BAR_H = 38
const BAR_MARGIN = 4
/** The text column: after the portrait, short of the right edge. */
const TEXT_DX = 3 + 32 + 5
const TEXT_W = BAR_W - 6 - TEXT_DX
/** How far the lit ring round a pointed-at button stands off it. */
const FOCUS_PAD = 2

/** Where the bar and its parts sit on a scene of the given size. */
function layout(w: number, sceneH: number) {
    const box: Box = { x: (w - BAR_W) >> 1, y: sceneH - BAR_H - BAR_MARGIN, w: BAR_W, h: BAR_H }
    return {
        box,
        portrait: { x: box.x + 3, y: box.y + 3, w: 32, h: 32 },
        textX: box.x + TEXT_DX
    }
}

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

/**
 * What a press at `x`, `y` on a `w`-wide frame whose scene is `sceneH` tall turns the page of. An
 * unlock's bar takes no press: its scene's button does, which the stage hit-tests on the band.
 */
export function guideTargetAt(w: number, sceneH: number, x: number, y: number, view: GuideView): GuideTarget | null {
    if (view.focus) return null
    return inside(layout(w, sceneH).box, x, y) ? 'guide:next' : null
}

/** How long the snail's mouth works after a page appears. */
const TALK_SECONDS = 1.2

// the page last drawn and when it appeared, so the snail talks as each one comes up
let talkPage = ''
let talkFrom = 0

let dimLut: Uint8Array | null = null

/** Darken every pixel of `s` outside `keep`, by palette remap: the frame stays indexed. */
function dim(s: Surface, keep: Box | null): void {
    dimLut ??= shadeLut(0.4, 'night0', 0.25)
    const d = s.data
    for (let y = 0; y < s.h; y++) {
        const kept = keep !== null && y >= keep.y && y < keep.y + keep.h
        for (let x = 0; x < s.w; x++) {
            if (kept && x >= keep.x && x < keep.x + keep.w) continue
            const i = y * s.w + x
            d[i] = dimLut[d[i]!]!
        }
    }
}

/**
 * The guide over a whole frame: the scene `sceneH` tall with the menu band under it. Everything
 * dims but the bar and, for an unlock, the button it points at, ringed in pulsing gold.
 */
export function drawGuide(s: Surface, sceneH: number, t: number, view: GuideView, hover: GuideTarget | null): void {
    const pulse = Math.floor(t * 2) % 2 === 0
    const btn = view.focus ? menuButtonRect(s.w, s.h, view.focus) : null
    const ring = btn ? { x: btn.x - FOCUS_PAD, y: btn.y - FOCUS_PAD, w: btn.w + 2 * FOCUS_PAD, h: btn.h + 2 * FOCUS_PAD } : null
    dim(s, ring)
    if (ring) {
        const c = pulse ? C.gold3 : C.gold2
        panelRing(s, ring, c)
    }

    const { box, portrait, textX } = layout(s.w, sceneH)
    panel(s, box.x, box.y, box.w, box.h, undefined, C.night1)
    const page = view.pages[view.page] ?? ''
    if (page !== talkPage) {
        talkPage = page
        talkFrom = t
    }
    drawGuidePortrait(s, portrait.x, portrait.y, t, t - talkFrom < TALK_SECONDS)
    drawText(s, view.name.toUpperCase(), textX, box.y + 4, C.gold2, { shadow: 1 })
    if (view.pages.length > 1) {
        drawText(s, `${view.page + 1}/${view.pages.length}`, box.x + box.w - 6, box.y + 4, C.stone3, { align: 2, shadow: 1 })
    }
    guideLines(page).forEach((l, i) => {
        drawText(s, l, textX, box.y + 16 + i * 7, C.bone1, { shadow: 1 })
    })
    const last = view.page >= view.pages.length - 1
    const hint = view.focus
        ? `TAP ${HQ_SCENE_LABELS[view.focus].toUpperCase()} BELOW`
        : last ? 'TAP TO CLOSE' : 'TAP TO GO ON'
    drawText(s, hint, box.x + box.w - 6, box.y + box.h - 9,
        hover === 'guide:next' || pulse ? C.gold3 : C.gold1, { align: 2, shadow: 1 })
}

/** A 1px frame round `b`, inside it. */
function panelRing(s: Surface, b: Box, c: number): void {
    rect(s, b.x, b.y, b.w, 1, c)
    rect(s, b.x, b.y + b.h - 1, b.w, 1, c)
    rect(s, b.x, b.y, 1, b.h, c)
    rect(s, b.x + b.w - 1, b.y, 1, b.h, c)
}
