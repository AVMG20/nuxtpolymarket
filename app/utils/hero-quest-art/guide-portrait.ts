// Mossimer, the guide (`content/tutorials.ts`): a snail who keeps the Chronicle, every run written
// into the turns of its shell. Drawn facing right, toward the words it speaks: a teal body, a brown
// shell wound with a gold spiral, moss and a sprout on top, a quill tucked in behind, and round gold
// spectacles on its eye stalks. Its own module, so the gallery can show it without the guide's
// panel and the scenes that panel borrows from.

import { C } from './palette'
import { Surface, StampStyle, arc, disc, dither, line, px, rect, ring, stamp, taper, tri, hash2 } from './surface'

export const GUIDE_PORTRAIT = 32
/** Every idle motion divides it, so the gallery strip closes on itself. */
export const GUIDE_LOOP = 4

const SPRITE = new Surface(GUIDE_PORTRAIT, GUIDE_PORTRAIT, 0, 0)
const STYLE = new StampStyle()

const SHELL_X = 12
const SHELL_Y = 16
const SHELL_R = 9

function body(s: Surface): void {
    // the foot, tapering to a tail behind the shell, its belly in shadow
    tri(s, 2, 27, 10, 22, 10, 27, C.teal2)
    rect(s, 6, 23, 23, 5, C.teal2)
    rect(s, 3, 27, 26, 1, C.teal1)
    rect(s, 27, 24, 2, 4, C.teal1)
    // the neck rising into the head, lit down its back
    rect(s, 22, 15, 7, 11, C.teal2)
    disc(s, 25, 15, 4, C.teal3)
    disc(s, 26, 16, 4, C.teal2)
    rect(s, 22, 16, 1, 7, C.teal3)
}

function quill(s: Surface): void {
    // the Chronicle's quill, tucked in behind the shell
    taper(s, 9, 16, 2, 2, 1, 3.5, C.white)
    taper(s, 9, 16, 3, 4, 1, 1.5, C.steel3)
    line(s, 9, 16, 2, 2, C.steel2)
    px(s, 2, 2, C.white)
}

function shell(s: Surface, bob: number): void {
    const cx = SHELL_X
    const cy = SHELL_Y - bob
    disc(s, cx, cy, SHELL_R, C.brown1)
    disc(s, cx - 1, cy - 1, SHELL_R - 1, C.brown2)
    // lit from the upper left, as every sprite is
    arc(s, cx - 1, cy - 1, SHELL_R - 2, Math.PI, Math.PI * 1.5, C.brown3)
    arc(s, cx - 1, cy - 1, SHELL_R - 3, Math.PI * 1.05, Math.PI * 1.4, C.brown3)
    // the gold spiral: the run, wound round and round
    for (let th = 0; th < 16; th += 0.12) {
        const r = 0.8 + th * 0.42
        const a = th + 2.4
        const x = cx - 1 + Math.cos(a) * r
        const y = cy - 1 + Math.sin(a) * r
        px(s, Math.round(x), Math.round(y), Math.cos(a) < 0.2 && Math.sin(a) < 0.2 ? C.gold2 : C.gold1)
    }
    px(s, cx - 1, cy - 1, C.gold3)
    // moss along the crown, tufted by hash so it holds still frame to frame
    const top = cy - SHELL_R + 1
    for (let x = cx - 6; x <= cx + 4; x++) {
        const h = 1 + Math.floor(hash2(x, 7) * 2.5) - (x === cx - 6 || x === cx + 4 ? 1 : 0)
        rect(s, x, top - h + 1, 1, h + 1, C.green2)
        px(s, x, top - h + 1, x < cx ? C.green3 : C.green2)
        px(s, x, top + 2, C.green1)
    }
}

function sprout(s: Surface, t: number, bob: number): void {
    const sway = Math.round(Math.sin(t * Math.PI * 2 / GUIDE_LOOP))
    const bx = SHELL_X - 2
    const by = SHELL_Y - SHELL_R - 1 - bob
    line(s, bx, by, bx + sway, by - 4, C.green2)
    px(s, bx + sway - 1, by - 4, C.green3); px(s, bx + sway - 2, by - 5, C.green4)
    px(s, bx + sway + 1, by - 3, C.green3); px(s, bx + sway + 2, by - 4, C.green3)
}

function eyes(s: Surface, t: number): void {
    const sway = Math.round(Math.sin(t * Math.PI) * 0.6)
    const blink = t % GUIDE_LOOP < 0.12
    for (const [base, ex] of [[24, 21], [27, 27]] as const) {
        const x = ex + sway
        line(s, base, 13, x, 7, C.teal2)
        if (blink) {
            disc(s, x, 5, 1.5, C.teal2)
            rect(s, x - 1, 5, 3, 1, C.ink)
        } else {
            disc(s, x, 5, 1.5, C.white)
            // looking right, at what it is saying
            px(s, x + 1, 5, C.ink); px(s, x + 1, 4, C.ink)
        }
        // the spectacles
        ring(s, x, 5, 2, C.gold2)
        px(s, x - 1, 3, C.gold3)
    }
    px(s, 24 + sway, 5, C.gold1)
}

function face(s: Surface, t: number, talking: boolean): void {
    px(s, 25, 18, C.pink)
    if (talking && Math.floor(t * 6) % 2 === 0) {
        rect(s, 27, 17, 2, 2, C.ink)
        px(s, 27, 18, C.red1)
    } else {
        px(s, 27, 18, C.ink); px(s, 28, 18, C.ink); px(s, 29, 17, C.ink)
    }
}

/** The snail alone, outlined, its frame's top-left at `x`, `y`. `talking` works its mouth. */
export function drawGuideSnail(dst: Surface, x: number, y: number, t: number, talking = false): void {
    const s = SPRITE
    s.clear()
    // breathing: the shell rises a pixel and settles
    const bob = Math.floor(t * 2.5) % 2
    quill(s)
    body(s)
    shell(s, bob)
    sprout(s, t, bob)
    eyes(s, t)
    face(s, t, talking)
    stamp(dst, s, x, y, STYLE.reset())
}

/** The portrait as the guide's panel shows it: the snail on a patch of grass under a dim glow. */
export function drawGuidePortrait(dst: Surface, x: number, y: number, t: number, talking = false): void {
    const n = GUIDE_PORTRAIT
    rect(dst, x, y, n, n, C.night0)
    dither(dst, x, y, n, 20, C.night1, 6)
    rect(dst, x, y + n - 4, n, 4, C.green1)
    for (let i = 0; i < n; i++) if (hash2(i, 3) < 0.45) px(dst, x + i, y + n - 5, C.green2)
    drawGuideSnail(dst, x, y, t, talking)
}
