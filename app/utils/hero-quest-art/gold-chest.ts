// The Gold chest in the battle view's top-right corner. The settles bank the run's Gold in it
// rather than the shared balance; it shows only while it holds some, and pressing it pays out.

import { C } from './palette'
import { px, hash2, type Surface } from './surface'
import { drawText, textWidth } from './font'
import { glyph, SMALL_ICON } from './icon-kit'
import { CURRENCY_ICONS } from './icons-items'
import { panel } from './ui-art'

/** What opening the chest paid, or why it didn't: a new `key` starts the toast over. */
export interface ChestToast {
    key: number
    text: string
    error: boolean
}

interface Box { x: number, y: number, w: number, h: number }

const BOX_W = 20
const BOX_H = 16
/** Gap to the view's top and right edges. */
const MARGIN = 3
/** The width the corner keeps clear for the chest, for the readouts beside it. */
export const GOLD_CHEST_CORNER = MARGIN + BOX_W + 3
/** Every `SHAKE_EVERY` seconds the chest shakes for the length of its pattern, at 10 fps. */
const SHAKE_EVERY = 5
const SHAKE_SWAY = [0, -1, 1, -1, 1, -1, 1, 0] as const
const SHAKE_LID = [0, -1, -2, -1, -2, -1, 0, 0] as const
/** Seconds the toast stays up, and the last stretch of them it spends sliding away. */
export const CHEST_TOAST_FOR = 2.4
const TOAST_OUT = 0.3
const TOAST_H = 18
/** Each sparkle lives `SPARKLE_LIFE` seconds at a fresh spot; `SPARKLES` of them, out of step. */
const SPARKLE_LIFE = 1.2
const SPARKLES = 3

// o ink; W/R/r/s/d red, glint to deepest; G/g/y gold, lit to shadowed; k the keyhole.
// Gold straps run over the lid and down the body, a gold rim parts them, a lock plate sits on the seam.
const LID = [
    '...oooooooooooo...',
    '..oRRGRRRRRRGRRo..',
    '.oRWrGrrrrrrGrrso.',
    '.osssgssssssgssdo.',
    'oGGGGGGGGGGGGGGGGo',
    'oyggggggGGggggggyo'
] as const
const BODY = [
    'oGrrrgrGGGGrgrrsgo',
    'oRrrrgrgkgyrgrrsdo',
    'orrrrgrgkgyrgrrsdo',
    'orsssgsyyyysgsssdo',
    'ogdddgddddddgdddgo',
    'oGggggggggggggggyo',
    'oooooooooooooooooo'
] as const
const CHEST_W = 18
const INK: Record<string, number> = {
    W: C.white, R: C.red3, r: C.red2, s: C.red1, d: C.red0,
    G: C.gold3, g: C.gold2, y: C.gold1, k: C.ink, o: C.ink
}

/** Seconds a landed coin bumps the lid for. */
const GULP_FOR = 0.12

/** The chest's box on a view `w` wide: the top-right corner. */
export function goldChestBox(w: number): Box {
    return { x: w - MARGIN - BOX_W, y: MARGIN - 1, w: BOX_W, h: BOX_H }
}

/** Where a coin flying in drops, on a view `w` wide: the lid's seam. */
export function goldChestMouth(w: number): { x: number, y: number } {
    const b = goldChestBox(w)
    return { x: b.x + (b.w >> 1), y: b.y + b.h - 8 }
}

export function onGoldChest(w: number, x: number, y: number): boolean {
    const b = goldChestBox(w)
    return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h
}

function rows(s: Surface, shape: readonly string[], x: number, y: number): void {
    for (let r = 0; r < shape.length; r++) {
        const line = shape[r]!
        for (let c = 0; c < line.length; c++) {
            const ch = line[c]!
            if (ch !== '.') px(s, x + c, y + r, INK[ch]!)
        }
    }
}

/** A four-point twinkle at (x, y): a cross at its peak, a lone pixel as it fades in and out. */
function sparkle(s: Surface, x: number, y: number, k: number): void {
    // k runs 0..1 over the sparkle's life
    const peak = k > 0.3 && k < 0.7
    if (!peak) {
        px(s, x, y, C.gold3)
        return
    }
    px(s, x, y, C.white)
    px(s, x - 1, y, C.gold3); px(s, x + 1, y, C.gold3); px(s, x, y - 1, C.gold3); px(s, x, y + 1, C.gold3)
    if (k > 0.4 && k < 0.6) { px(s, x - 2, y, C.gold2); px(s, x + 2, y, C.gold2); px(s, x, y - 2, C.gold2); px(s, x, y + 2, C.gold2) }
}

/**
 * The chest in the corner. It sparkles, and every few seconds shakes with its lid popping on the
 * Gold inside, stepped at 10 fps like the rest of the UI's loops; pointed at, it sits up a pixel.
 * `landedAgo` is how long since a coin last dropped in, which lifts the lid for a moment.
 */
export function drawGoldChest(s: Surface, t: number, hover: boolean, landedAgo = -1): void {
    const b = goldChestBox(s.w)
    const f = Math.floor((t % SHAKE_EVERY) * 10)
    const sway = f < SHAKE_SWAY.length ? SHAKE_SWAY[f]! : 0
    const gulp = landedAgo >= 0 && landedAgo < GULP_FOR ? -1 : 0
    const lidUp = f < SHAKE_LID.length ? SHAKE_LID[f]! : gulp
    const x = b.x + ((b.w - CHEST_W) >> 1) + sway
    const bodyY = b.y + b.h - BODY.length - (hover ? 1 : 0)
    const lidY = bodyY - LID.length + lidUp
    // the Gold inside shows through the gap a popped lid leaves
    for (let gy = lidY + LID.length; gy < bodyY; gy++) {
        for (let gx = 2; gx < CHEST_W - 2; gx++) px(s, x + gx, gy, (gx + gy) % 3 ? C.gold3 : C.white)
    }
    rows(s, BODY, x, bodyY)
    rows(s, LID, x, lidY)
    for (let i = 0; i < SPARKLES; i++) {
        const life = t / SPARKLE_LIFE + i / SPARKLES
        const cycle = Math.floor(life)
        // stepped at 10 fps, and a fresh spot round the chest every cycle
        const k = Math.floor((life - cycle) * SPARKLE_LIFE * 10) / (SPARKLE_LIFE * 10)
        const sx = b.x + Math.round(hash2(cycle, i * 2) * (b.w - 1))
        const sy = b.y + Math.round(hash2(cycle, i * 2 + 1) * (b.h - 4))
        sparkle(s, sx, sy, k)
    }
}

/**
 * The toast an open leaves in the corner, `age` seconds in: what it paid beside a coin, or why it
 * paid nothing in red. In the chest's place, which an open empties.
 */
export function drawChestToast(s: Surface, toast: ChestToast, age: number): void {
    if (age < 0 || age >= CHEST_TOAST_FOR) return
    const b = goldChestBox(s.w)
    const icon = toast.error ? 0 : SMALL_ICON
    const w = textWidth(toast.text) + icon + 10
    const right = b.x + b.w
    // slides up out of view over its last moments, stepped a pixel at a time
    const out = age > CHEST_TOAST_FOR - TOAST_OUT ? Math.floor((age - CHEST_TOAST_FOR + TOAST_OUT) / TOAST_OUT * (TOAST_H + b.y)) : 0
    const x = right - w
    const y = b.y - out
    panel(s, x, y, w, TOAST_H)
    if (icon) glyph(s, CURRENCY_ICONS.gold!, x + 2 + (SMALL_ICON >> 1), y + (TOAST_H >> 1), true)
    drawText(s, toast.text, x + 5 + icon, y + 7, toast.error ? C.red3 : C.gold3, { shadow: 1 })
}
