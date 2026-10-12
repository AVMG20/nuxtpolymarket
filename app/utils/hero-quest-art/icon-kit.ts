// Icon construction: 24×24 icons are a frame plus a glyph, the glyph drawn into a scratch
// buffer, lit from the upper left, and stamped with the same generated ink outline the sprites
// get over a 1px drop shadow, so icons and sprites read as one style. Small icons (status,
// currency) are 16×16.

import { C, CLEAR, PALETTE_RGB, type ColorName } from './palette'
import { Surface, StampStyle, stamp, rect, px, line, disc, ring, tri, ellipse, dither, ditherDisc, poly, arc } from './surface'
import type { Mat } from './weapons'

export const ICON = 24
export const SMALL_ICON = 16

const GLYPH = new Surface(ICON, ICON, 0, 0)
const GLYPH_S = new Surface(SMALL_ICON, SMALL_ICON, 0, 0)
const ST = new StampStyle()
const LIT = new Surface(ICON, ICON, 0, 0)
const LIT_S = new Surface(SMALL_ICON, SMALL_ICON, 0, 0)

/**
 * The palette's colour families, dark to light: a lit edge steps one along its family, a
 * shadowed one steps back. A colour in no family keeps its own.
 */
const FAMILIES: readonly (readonly ColorName[])[] = [
    ['ink', 'night0', 'night1', 'night2', 'night3'],
    ['steel0', 'steel1', 'steel2', 'steel3', 'white'],
    ['gold0', 'gold1', 'gold2', 'gold3', 'white'],
    ['red0', 'red1', 'red2', 'red3'],
    ['lava0', 'lava1', 'orange', 'gold3'],
    ['green0', 'green1', 'green2', 'green3', 'green4'],
    ['blue0', 'blue1', 'blue2', 'cyan', 'frost'],
    ['purple0', 'purple1', 'purple2', 'pink'],
    ['brown0', 'brown1', 'brown2', 'brown3'],
    ['skin0', 'skin1', 'skin2'],
    ['teal0', 'teal1', 'teal2', 'teal3'],
    ['olive0', 'olive1', 'olive2'],
    ['stone0', 'stone1', 'stone2', 'stone3', 'bone0', 'bone1', 'white'],
    ['dusk0', 'dusk1', 'dusk2', 'dusk3'], ['sky0', 'sky1', 'sky2'], ['moss0', 'moss1', 'moss2', 'moss3'],
    ['lagoon0', 'lagoon1', 'lagoon2', 'lagoon3'], ['slate0', 'slate1', 'slate2', 'slate3'],
    ['heather0', 'heather1', 'heather2', 'heather3'], ['rust0', 'rust1', 'rust2', 'rust3'],
    ['rock0', 'rock1', 'rock2', 'rock3'], ['sand0', 'sand1', 'sand2', 'sand3'], ['ice0', 'ice1', 'ice2', 'ice3']
]
const LIGHTER = new Uint8Array(PALETTE_RGB.length).map((_, i) => i)
const DARKER = new Uint8Array(PALETTE_RGB.length).map((_, i) => i)
for (const fam of FAMILIES) {
    for (let k = 0; k < fam.length; k++) {
        const c = C[fam[k]!]
        // a colour in two families (white, gold3) keeps the step its first family gave it
        if (k + 1 < fam.length && LIGHTER[c] === c) LIGHTER[c] = C[fam[k + 1]!]
        if (k > 0 && DARKER[c] === c) DARKER[c] = C[fam[k - 1]!]
    }
}

/**
 * Light a glyph from the upper left: an edge pixel facing up or left steps lighter, one facing
 * down or right steps darker. Only where the shape is at least two pixels thick behind that edge,
 * so a one-pixel line (a blade's edge, an arrow's shaft) keeps its colour.
 */
function lightGlyph(g: Surface, out: Surface): void {
    out.clear()
    const w = g.w
    const h = g.h
    const d = g.data
    const at = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && d[y * w + x] !== CLEAR
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const c = d[y * w + x]!
            if (c === CLEAR) continue
            let o = c
            if ((!at(x - 1, y) || !at(x, y - 1)) && at(x + 1, y) && at(x, y + 1)) o = LIGHTER[c]!
            else if ((!at(x + 1, y) || !at(x, y + 1)) && at(x - 1, y) && at(x, y - 1)) o = DARKER[c]!
            out.data[y * w + x] = o
        }
    }
}

export type Glyph = (g: Surface, cx: number, cy: number) => void

/**
 * Draw `glyph` centred at (cx, cy) of `dst`, outlined in ink. `lit` lights it from the upper
 * left and drops a 1px shadow under it; the locked badges that predate it pass false.
 */
export function glyph(dst: Surface, glyphFn: Glyph, cx: number, cy: number, small = false, outline: number = C.ink, lit = true): void {
    const g = small ? GLYPH_S : GLYPH
    g.clear()
    glyphFn(g, g.w >> 1, g.h >> 1)
    let src = g
    if (lit) {
        src = small ? LIT_S : LIT
        lightGlyph(g, src)
        // the drop shadow: the whole silhouette in ink, a pixel down and right
        ST.reset()
        ST.outline = CLEAR
        ST.flash = C.ink
        src.ax = src.w >> 1
        src.ay = src.h >> 1
        stamp(dst, src, cx + 1, cy + 1, ST)
    }
    ST.reset()
    ST.outline = outline
    src.ax = src.w >> 1
    src.ay = src.h >> 1
    stamp(dst, src, cx, cy, ST)
}

// ── Frames ─────────────────────────────────────────────────────────────────────────

/**
 * Every frame is built the same way: an ink edge, a bevelled rim in the frame's colour (lit along
 * the top and left, shaded along the bottom and right), an ink inset, the dark ground, and behind
 * the glyph a solid spotlight in the rim's shade. No dither and no rings: a patterned ground
 * fights the glyph.
 */

/** Square skill frame (class-tree skills — `skills-gacha.md` §7 locks square). */
export function squareFrame(s: Surface, m: Mat, bg: number = C.night0): void {
    rect(s, 1, 1, 22, 22, C.ink)
    rect(s, 2, 2, 20, 20, m[1])
    rect(s, 2, 2, 20, 1, m[2]); rect(s, 2, 2, 1, 20, m[2])
    rect(s, 2, 21, 20, 1, m[0]); rect(s, 21, 2, 1, 20, m[0])
    px(s, 2, 2, C.white)
    rect(s, 3, 3, 18, 18, C.ink)
    rect(s, 4, 4, 16, 16, bg)
    disc(s, 12, 12, 7, m[0])
}

/** Circular skill frame (Training Grounds skills — deliberately distinct from class skills). */
export function circleFrame(s: Surface, m: Mat, bg: number = C.night0): void {
    disc(s, 12, 12, 11, C.ink)
    disc(s, 12, 12, 10, m[1])
    arc(s, 12, 12, 10, Math.PI * 1.0, Math.PI * 1.75, m[2])
    arc(s, 12, 12, 10, 0, Math.PI * 0.75, m[0])
    px(s, 5, 5, C.white)
    disc(s, 12, 12, 8, C.ink)
    disc(s, 12, 12, 7, bg)
    disc(s, 12, 12, 5, m[0])
}

/** Diamond crest frame (Champion abilities), coloured by archetype. */
export function crestFrame(s: Surface, m: Mat, bg: number = C.night0): void {
    poly(s, [12, 0, 23, 11, 23, 13, 12, 24, 1, 13, 1, 11], 0, 0, C.ink)
    poly(s, [12, 1, 22, 11, 22, 13, 12, 23, 2, 13, 2, 11], 0, 0, m[1])
    line(s, 12, 1, 2, 11, m[2]); line(s, 12, 1, 22, 11, m[2])
    line(s, 2, 13, 12, 23, m[0]); line(s, 22, 13, 12, 23, m[0])
    px(s, 12, 1, C.white)
    poly(s, [12, 3, 20, 11, 20, 13, 12, 21, 4, 13, 4, 11], 0, 0, C.ink)
    poly(s, [12, 4, 19, 11, 19, 13, 12, 20, 5, 13, 5, 11], 0, 0, bg)
    poly(s, [12, 7, 17, 12, 12, 17, 7, 12], 0, 0, m[0])
}

/** The dark tile behind item icons, its rim in the item's rarity. */
export function itemTile(s: Surface, m: Mat): void {
    rect(s, 1, 1, 22, 22, C.ink)
    rect(s, 2, 2, 20, 20, m[1])
    rect(s, 2, 2, 20, 1, m[2]); rect(s, 2, 2, 1, 20, m[2])
    rect(s, 2, 21, 20, 1, m[0]); rect(s, 21, 2, 1, 20, m[0])
    rect(s, 3, 3, 18, 18, C.ink)
    rect(s, 4, 4, 16, 16, C.night0)
    disc(s, 12, 12, 7, m[0])
}

export { C, CLEAR, rect, px, line, disc, ring, tri, ellipse, dither, ditherDisc, poly, arc }
