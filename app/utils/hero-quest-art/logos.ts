// The logo (Branding): the title in its own hand-drawn lettering, gold on a red ribbon.
//
// Four concepts were drawn on this lettering (a royal banner, a crest, stone and sword, arcade);
// the user chose the banner and gave it the arcade's sparkles (art-style.md, sixth pass Round 4).
// The lettering is a chunky display alphabet, 2 px strokes on a 9-row cap height, drawn only for
// the letters the title needs, so a new name means drawing its few new letters and nothing else.

import { C } from './palette'
import { type Surface, rect, px } from './surface'
import { drawText, textWidth } from './font'
import { qt } from './vfx-kit'

const R = Math.round

export const GAME_TITLE = 'HERO QUEST'
export const LOGO_W = 200
export const LOGO_H = 64
/** Seconds the logo's animation takes to close: two sweeps of the glint, three rounds of the sparkles. */
export const LOGO_LOOP = 4.8
/** How long the glint takes to cross, and the sparkles' beat (8 beats a round). */
const GLINT_PERIOD = 2.4
const SPARKLE_FPS = 5

/** The title alphabet: 2 px strokes, 9 rows. Q's tail runs out past its bowl. */
const TITLE_GLYPHS: Readonly<Record<string, readonly string[]>> = {
    H: ['##...##', '##...##', '##...##', '#######', '#######', '##...##', '##...##', '##...##', '##...##'],
    E: ['#######', '#######', '##.....', '######.', '######.', '##.....', '##.....', '#######', '#######'],
    R: ['######.', '#######', '##...##', '##...##', '######.', '#####..', '##.###.', '##..###', '##...##'],
    O: ['.#####.', '#######', '##...##', '##...##', '##...##', '##...##', '##...##', '#######', '.#####.'],
    Q: ['.#####..', '#######.', '##...##.', '##...##.', '##...##.', '##.#.##.', '##..##..', '#######.', '.#######'],
    U: ['##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '#######', '.#####.'],
    S: ['.######', '#######', '##.....', '######.', '.######', '.....##', '.....##', '#######', '######.'],
    T: ['######', '######', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..']
}
const CAP = 9
const LETTER_GAP = 1
const WORD_GAP = 4

/** Width of `text` in the title lettering at `scale`, with `space` in place of a word gap if given. */
export function titleWidth(text: string, scale: number, space = WORD_GAP * scale): number {
    let w = 0
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]!
        w += ch === ' ' ? space : TITLE_GLYPHS[ch]![0]!.length * scale + (i < text.length - 1 && text[i + 1] !== ' ' ? LETTER_GAP * scale : 0)
    }
    return w
}

interface TitleStyle {
    /** The letters' fill, top row to bottom. */
    ramp: readonly number[]
    /** The lit top edge of every stroke. */
    hi: number
    /** Outlines round the letters, inner first. */
    outlines: readonly number[]
    /** A drop shadow of the outlined shape, `dy` px down. */
    shadow?: { dy: number, c: number }
}

/**
 * Paint `text` in the title lettering with its top-left at (x, y): the shadow, then the outlines
 * outermost first, then the fill down its ramp with the top edges lit. `space` widens a word gap
 * (for something set between the words). Returns the mask it painted, for effects that follow it.
 */
function paintTitle(s: Surface, text: string, x: number, y: number, scale: number, st: TitleStyle, space = WORD_GAP * scale): Uint8Array {
    const W = s.w
    const H = s.h
    const mask = new Uint8Array(W * H)
    let cx = R(x)
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]!
        if (ch === ' ') { cx += space; continue }
        const rows = TITLE_GLYPHS[ch]!
        for (let gy = 0; gy < CAP; gy++) {
            for (let gx = 0; gx < rows[gy]!.length; gx++) {
                if (rows[gy]![gx] !== '#') continue
                for (let sy = 0; sy < scale; sy++) {
                    for (let sx = 0; sx < scale; sx++) {
                        const px_ = cx + gx * scale + sx
                        const py = R(y) + gy * scale + sy
                        if (px_ >= 0 && px_ < W && py >= 0 && py < H) mask[py * W + px_] = 1
                    }
                }
            }
        }
        cx += rows[0]!.length * scale + (i < text.length - 1 && text[i + 1] !== ' ' ? LETTER_GAP * scale : 0)
    }
    // grow the shape one ring per outline
    const rings: Uint8Array[] = []
    let grown = mask
    for (let k = 0; k < st.outlines.length; k++) {
        const next = new Uint8Array(grown)
        for (let p = 0; p < W * H; p++) {
            if (grown[p]) continue
            const px0 = p % W
            if ((px0 > 0 && grown[p - 1]) || (px0 < W - 1 && grown[p + 1]) || (p >= W && grown[p - W]) || (p < W * (H - 1) && grown[p + W])) next[p] = 1
        }
        rings.push(next)
        grown = next
    }
    if (st.shadow) {
        for (let p = 0; p < W * H; p++) if (grown[p] && p + st.shadow.dy * W < W * H) s.data[p + st.shadow.dy * W] = st.shadow.c
    }
    for (let k = st.outlines.length - 1; k >= 0; k--) {
        for (let p = 0; p < W * H; p++) if (rings[k]![p]) s.data[p] = st.outlines[k]!
    }
    const top = R(y)
    const h = CAP * scale
    for (let p = 0; p < W * H; p++) {
        if (!mask[p]) continue
        const py = Math.floor(p / W)
        const f = Math.min(st.ramp.length - 1, Math.floor((py - top) / h * st.ramp.length))
        s.data[p] = p >= W && !mask[p - W] ? st.hi : st.ramp[f]!
    }
    return mask
}

/** A glint, a slanted white band, sweeping across whatever of `mask` it crosses. */
function glint(s: Surface, mask: Uint8Array, x0: number, x1: number, t: number, period: number): void {
    const u = (qt(t) % period) / period
    const gx = R(x0 - 20 + (x1 - x0 + 40) * u)
    for (let p = 0; p < mask.length; p++) {
        if (!mask[p]) continue
        const x = p % s.w
        const y = Math.floor(p / s.w)
        const d = x - gx + (y >> 1)
        if (d >= 0 && d < 3) s.data[p] = d === 1 ? C.white : C.gold3
    }
}

const TAGLINE = 'AN IDLE ADVENTURE'

/** A four-point sparkle, `r` long, at (x, y). */
function sparkle(s: Surface, x: number, y: number, r: number): void {
    for (let i = -r; i <= r; i++) { px(s, x + i, y, Math.abs(i) === r ? C.gold2 : C.white); px(s, x, y + i, Math.abs(i) === r ? C.gold2 : C.white) }
}

/**
 * The logo, centred on `cx` with the top of its letters at `y`: gold letters on a red ribbon stitched
 * in gold, its swallowtailed ends folded back behind it, a glint sweeping the letters and sparkles
 * twinkling round the ribbon, each on its own beat. The tagline sits under it between two gold studs.
 */
export function drawLogo(s: Surface, cx: number, y: number, t: number): void {
    const scale = 2
    const tw = titleWidth(GAME_TITLE, scale)
    const x0 = R(cx - tw / 2)
    const y0 = R(y)
    const bx0 = x0 - 7
    const bx1 = x0 + tw + 7
    const by0 = y0 - 6
    const by1 = y0 + CAP * scale + 6
    // the folded-back tails, darker, a V cut into each outer end, kept inside the canvas. Drawn a
    // pixel at a time with the notch left unpainted, never erased: over a scene (the splash)
    // erasing it punched a hole through to nothing.
    const tail = 11
    const ty0 = by0 + 5
    const ty1 = by1 + 4
    const mid = (ty0 + ty1) / 2
    // `i` columns out from the ribbon's end; the ribbon covers the join, so inward counts as inside
    const inTail = (i: number, yy: number): boolean => i < 0 || (i < tail && yy >= ty0 && yy <= ty1 && Math.abs(yy - mid) >= (i - (tail - 6)) * 2.2)
    for (const side of [-1, 1]) {
        for (let i = 0; i < tail; i++) {
            for (let yy = ty0; yy <= ty1; yy++) {
                if (!inTail(i, yy)) continue
                const edge = !inTail(i + 1, yy) || !inTail(i, yy - 1) || !inTail(i, yy + 1) || !inTail(i - 1, yy)
                px(s, side < 0 ? bx0 - 1 - i : bx1 + i, yy, edge ? C.ink : yy === ty0 + 1 ? C.red1 : C.red0)
            }
        }
    }
    // the ribbon: lit along the top, shaded along the bottom, a gold stitch line inside each edge
    rect(s, bx0, by0, bx1 - bx0, by1 - by0, C.ink)
    rect(s, bx0 + 1, by0 + 1, bx1 - bx0 - 2, by1 - by0 - 2, C.red1)
    rect(s, bx0 + 1, by0 + 1, bx1 - bx0 - 2, 2, C.red2)
    rect(s, bx0 + 1, by1 - 3, bx1 - bx0 - 2, 2, C.red0)
    for (let x = bx0 + 3; x < bx1 - 3; x += 2) { px(s, x, by0 + 3, C.gold2); px(s, x, by1 - 4, C.gold1) }
    const mask = paintTitle(s, GAME_TITLE, x0, y0, scale, { ramp: [C.gold3, C.gold3, C.gold2, C.gold2, C.gold1], hi: C.white, outlines: [C.ink], shadow: { dy: 2, c: C.red0 } })
    glint(s, mask, x0, x0 + tw, t, GLINT_PERIOD)
    // sparkles on the ribbon's edges and ends, each on its own beat
    const spots = [[x0 - 3, y0 + 2], [x0 + 44, by0], [x0 + tw - 16, by0 - 1], [x0 + tw + 3, y0 + 13], [x0 + 70, by1 - 1]] as const
    const f = Math.floor(qt(t) * SPARKLE_FPS)
    spots.forEach(([x, yy], i) => {
        const beat = (f + i * 3) % 8
        if (beat < 3) sparkle(s, x, yy, beat === 1 ? 3 : 1)
    })
    tavernSign(s, cx, by1)
}

/**
 * The tagline on a tavern sign hung from the ribbon's lower edge (`top`) on two short iron chains:
 * a wooden plank lit along its top and shaded along its foot, its grain running across it, clipped
 * corners, a nail at each end, the words painted in gold. It gives the tagline a solid backing
 * wherever the logo sits (on the splash it fell across a pale cloud).
 */
function tavernSign(s: Surface, cx: number, top: number): void {
    const tw = textWidth(TAGLINE)
    const w = tw + 14
    const h = 11
    const x0 = R(cx - w / 2)
    const y0 = top + 3
    // the chains, a link a pixel, from under the ribbon to the plank
    for (const x of [x0 + 7, x0 + w - 8]) {
        for (let y = top; y < y0; y++) px(s, x, y, (y - top) & 1 ? C.steel1 : C.steel3)
    }
    // the plank, its corners clipped by leaving them unpainted (never erased: over a scene that is a hole)
    rect(s, x0 + 1, y0, w - 2, h, C.ink)
    rect(s, x0, y0 + 1, w, h - 2, C.ink)
    rect(s, x0 + 1, y0 + 1, w - 2, h - 2, C.brown1)
    rect(s, x0 + 1, y0 + 1, w - 2, 1, C.brown2)
    rect(s, x0 + 1, y0 + h - 2, w - 2, 1, C.brown0)
    // the grain: dark streaks across the board, broken up
    for (let y = y0 + 2; y < y0 + h - 2; y++) {
        for (let x = x0 + 2; x < x0 + w - 2; x++) if (((x * 7 + y * 29) % 23) < 4 && (y & 1)) px(s, x, y, C.brown0)
    }
    // a nail at each end
    for (const x of [x0 + 3, x0 + w - 4]) { px(s, x, y0 + 5, C.steel3); px(s, x + 1, y0 + 6, C.ink) }
    drawText(s, TAGLINE, cx, y0 + 3, C.gold3, { align: 1, shadow: 1 })
}
