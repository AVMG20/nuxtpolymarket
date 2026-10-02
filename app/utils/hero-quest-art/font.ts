// Three bitmap fonts: Pixel Crusade's 3×5 for small readouts and damage numbers, the same
// letterforms a size up (`mid`) for crits and totals, and a 5×7 for banners and the logo.
// Glyphs are row-major bit strings. Drawing never allocates — text is walked by char code.

import { C } from './palette'
import { rect, type Surface } from './surface'

const SMALL: Record<string, string> = {
    '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001011001111',
    '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001010010010',
    '8': '111101111101111', '9': '111101111001111',
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
    E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
    I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
    M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
    Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
    Y: '101101010010010', Z: '111001010100111',
    '+': '000010111010000', '-': '000000111000000', '/': '001001010100100', '%': '101001010100101',
    '?': '111001011000010', '>': '100010001010100', '<': '001010100010001', '#': '101111101111101',
    ' ': '000000000000000', '.': '000000000000010', '!': '010010010000010', ':': '000010000010000',
    ',': '000000000010100', '\'': '010010000000000', '×': '000101010101000'
}

// 5×7, bold enough to read over a busy fight.
const BIG: Record<string, string> = {
    '0': '01110100011001110101110011000101110', '1': '00100011000010000100001000010001110',
    '2': '01110100010000100010001000100011111', '3': '11110000010000101110000010000111110',
    '4': '00010001100101010010111110001000010', '5': '11111100001111000001000011000101110',
    '6': '00110010001000011110100011000101110', '7': '11111000010001000100010000100001000',
    '8': '01110100011000101110100011000101110', '9': '01110100011000101111000010001001100',
    A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110',
    C: '01110100011000010000100001000101110', D: '11100100101000110001100011001011100',
    E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000',
    G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001',
    I: '01110001000010000100001000010001110', J: '00111000100001000010000101001001100',
    K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
    M: '10001110111010110101100011000110001', N: '10001100011100110101100111000110001',
    O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000',
    Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001',
    S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100',
    U: '10001100011000110001100011000101110', V: '10001100011000110001100010101000100',
    W: '10001100011000110101101011010101010', X: '10001100010101000100010101000110001',
    Y: '10001100010101000100001000010000100', Z: '11111000010001000100010001000011111',
    '+': '00000001000010011111001000010000000', '-': '00000000000000011111000000000000000',
    '!': '00100001000010000100001000000000100', '.': '00000000000000000000000000110001100',
    ' ': '00000000000000000000000000000000000', '%': '11001110010001000100010001001110011',
    '×': '00000100010101000100010101000100000', ':': '00000011000110000000011000110000000',
    '\'': '00100001000100000000000000000000000', ',': '00000000000000000000000110001000100'
}

// 5×7, the 3×5's letterforms at about 1.5×: every vertical stroke two pixels wide, every
// horizontal one pixel, so it reads as the same typeface a size up rather than a new one. Only
// what a crit or a total prints: digits, the K/M/B/T suffixes, E, and . + - !
const MID: Record<string, string> = {
    '0': '11111110111101111011110111101111111',
    '1': '00110011100011000110001100011011111',
    '2': '11111000110001111111110001100011111',
    '3': '11111000110001101111000110001111111',
    '4': '11011110111101111111000110001100011',
    '5': '11111110001100011111000110001111111',
    '6': '11111110001100011111110111101111111',
    '7': '11111000110001100110001100011000110',
    '8': '11111110111101111111110111101111111',
    '9': '11111110111101111111000110001111111',
    '.': '00000000000000000000000001100011000',
    K: '11011110111111011100111101101111011',
    M: '11011111111111111011110111101111011',
    B: '11110110111101111110110111101111110',
    T: '11111001100011000110001100011000110',
    // past the trillions the game's numbers print as 4.20E15
    E: '11111110001100011110110001100011111',
    '+': '00000001100011011111001100011000000',
    '-': '00000000000000011111000000000000000',
    '!': '11000110001100011000000001100011000',
    ' ': '00000000000000000000000000000000000'
}

/** `track` is the gap between glyphs: the mid cut's two-pixel stems need two, or their outlines run together. */
interface Font { w: number, h: number, bits: Uint8Array[], widths: Uint8Array, track: number }

function build(src: Record<string, string>, w: number, h: number, trim: boolean, track = 1): Font {
    const bits: Uint8Array[] = []
    const widths = new Uint8Array(256)
    for (let i = 0; i < 256; i++) bits.push(new Uint8Array(w * h))
    for (const [ch, s] of Object.entries(src)) {
        const code = ch.charCodeAt(0) & 255
        let used = 0
        for (let i = 0; i < w * h; i++) {
            const on = s[i] === '1' ? 1 : 0
            bits[code]![i] = on
            if (on) used = Math.max(used, (i % w) + 1)
        }
        widths[code] = trim && ch !== ' ' ? Math.max(1, used) : w
    }
    return { w, h, bits, widths, track }
}

const FONTS = { small: build(SMALL, 3, 5, true), mid: build(MID, 5, 7, true, 2), big: build(BIG, 5, 7, false) }
export type FontName = keyof typeof FONTS

/** Glyph height in rows at scale 1. */
export function fontHeight(font: FontName): number { return FONTS[font].h }

function norm(code: number): number {
    if (code >= 97 && code <= 122) return code - 32
    if (code === 215) return 215
    return code & 255
}

export function textWidth(text: string, font: FontName = 'small', scale = 1): number {
    const f = FONTS[font]
    let w = 0
    for (let i = 0; i < text.length; i++) w += (f.widths[norm(text.charCodeAt(i))]! + f.track) * scale
    return w > 0 ? w - f.track * scale : 0
}

function glyph(s: Surface, f: Font, code: number, x: number, y: number, scale: number, c: number): void {
    const b = f.bits[code]!
    for (let r = 0; r < f.h; r++) {
        for (let k = 0; k < f.w; k++) if (b[r * f.w + k]) rect(s, x + k * scale, y + r * scale, scale, scale, c)
    }
}

/**
 * Draw text. align 0 left, 1 centre, 2 right. shadow 0 none, 1 drop shadow, 2 full outline.
 * Returns the drawn width.
 */
export function drawText(s: Surface, text: string, x: number, y: number, c: number, opts: {
    font?: FontName, scale?: number, align?: 0 | 1 | 2, shadow?: 0 | 1 | 2, shadowColor?: number, bevel?: number
} = {}): number {
    return textOut(s, text, x, y, c, opts.font ?? 'small', opts.scale ?? 1, opts.align ?? 0, opts.shadow ?? 1, opts.shadowColor ?? C.ink, opts.bevel ?? -1)
}

/** drawText with positional arguments, for hot loops that must not allocate. bevel −1 = none. */
export function textOut(s: Surface, text: string, x: number, y: number, c: number, font: FontName, scale: number,
    align: 0 | 1 | 2, shadow: 0 | 1 | 2, sc: number, bevel: number): number {
    const f = FONTS[font]
    const w = textWidth(text, font, scale)
    let cx = Math.round(align === 1 ? x - w / 2 : align === 2 ? x - w : x)
    const cy = Math.round(y)
    if (shadow) {
        let sx = cx
        for (let i = 0; i < text.length; i++) {
            const code = norm(text.charCodeAt(i))
            if (shadow === 2) {
                glyph(s, f, code, sx - 1, cy, scale, sc); glyph(s, f, code, sx + 1, cy, scale, sc)
                glyph(s, f, code, sx, cy - 1, scale, sc); glyph(s, f, code, sx - 1, cy + 1, scale, sc)
            }
            glyph(s, f, code, sx, cy + 1, scale, sc)
            glyph(s, f, code, sx + 1, cy + 1, scale, sc)
            sx += (f.widths[code]! + f.track) * scale
        }
    }
    for (let i = 0; i < text.length; i++) {
        const code = norm(text.charCodeAt(i))
        glyph(s, f, code, cx, cy, scale, c)
        // bevel: the top row of every glyph in a lighter colour
        if (bevel >= 0) {
            const b = f.bits[code]!
            for (let k = 0; k < f.w; k++) if (b[k]) rect(s, cx + k * scale, cy, scale, Math.max(1, scale >> 1), bevel)
        }
        cx += (f.widths[code]! + f.track) * scale
    }
    return w
}

/**
 * Text filled with a vertical gradient, `ramp` running top to bottom across the glyph height
 * (at any scale), inside a full 1px outline in `sc` and a drop shadow. The skill banner's
 * treatment, used for the damage numbers so the two read as one family. Doesn't allocate.
 */
export function textRamp(s: Surface, text: string, x: number, y: number, ramp: readonly number[], font: FontName, scale: number,
    align: 0 | 1 | 2, sc: number): number {
    const f = FONTS[font]
    const w = textWidth(text, font, scale)
    const x0 = Math.round(align === 1 ? x - w / 2 : align === 2 ? x - w : x)
    const cy = Math.round(y)
    let sx = x0
    for (let i = 0; i < text.length; i++) {
        const code = norm(text.charCodeAt(i))
        glyph(s, f, code, sx - 1, cy, scale, sc); glyph(s, f, code, sx + 1, cy, scale, sc)
        glyph(s, f, code, sx, cy - 1, scale, sc); glyph(s, f, code, sx - 1, cy + 1, scale, sc)
        glyph(s, f, code, sx, cy + 1, scale, sc); glyph(s, f, code, sx + 1, cy + 1, scale, sc)
        sx += (f.widths[code]! + f.track) * scale
    }
    const rows = f.h * scale
    const n = ramp.length
    let cx = x0
    for (let i = 0; i < text.length; i++) {
        const code = norm(text.charCodeAt(i))
        const b = f.bits[code]!
        for (let r = 0; r < f.h; r++) {
            for (let k = 0; k < f.w; k++) {
                if (!b[r * f.w + k]) continue
                for (let dy = 0; dy < scale; dy++) {
                    const c = ramp[Math.min(n - 1, Math.floor((r * scale + dy) * n / rows))]!
                    rect(s, cx + k * scale, cy + r * scale + dy, scale, 1, c)
                }
            }
        }
        cx += (f.widths[code]! + f.track) * scale
    }
    return w
}
