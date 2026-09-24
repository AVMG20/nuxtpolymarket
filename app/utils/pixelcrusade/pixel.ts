// Pixel primitives for Pixel Crusade. Everything draws with integer fillRects on
// the logical canvas, so there's no anti-aliasing anywhere.

import { C } from './palette'

/** Logical resolution. The display canvas scales this by an integer factor. */
export const LW = 256
export const LH = 144
/** y of the floor line that feet stand on. */
export const GROUND = 118

type Ctx = CanvasRenderingContext2D

export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, c: string): void {
    ctx.fillStyle = c
    ctx.fillRect(x | 0, y | 0, w | 0, h | 0)
}

export function px(ctx: Ctx, x: number, y: number, c: string): void {
    ctx.fillStyle = c
    ctx.fillRect(x | 0, y | 0, 1, 1)
}

/** 1px Bresenham line; `t` > 1 stamps a t×t square per step. */
export function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, c: string, t = 1): void {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0
    ctx.fillStyle = c
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    const o = t > 1 ? (t >> 1) : 0
    let err = dx + dy
    for (;;) {
        ctx.fillRect(x0 - o, y0 - o, t, t)
        if (x0 === x1 && y0 === y1) break
        const e2 = 2 * err
        if (e2 >= dy) { err += dy; x0 += sx }
        if (e2 <= dx) { err += dx; y0 += sy }
    }
}

/** Filled circle made of horizontal spans. */
export function disc(ctx: Ctx, cx: number, cy: number, r: number, c: string): void {
    cx |= 0; cy |= 0
    ctx.fillStyle = c
    if (r < 1) { ctx.fillRect(cx, cy, 1, 1); return }
    const rr = r * r + r * 0.8
    for (let dy = -Math.floor(r); dy <= Math.floor(r); dy++) {
        const half = Math.floor(Math.sqrt(Math.max(0, rr - dy * dy)))
        ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1)
    }
}

/** Filled ellipse made of horizontal spans. */
export function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, c: string): void {
    cx |= 0; cy |= 0
    ctx.fillStyle = c
    const iry = Math.max(1, Math.floor(ry))
    for (let dy = -iry; dy <= iry; dy++) {
        const k = 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5))
        const half = Math.floor(rx * Math.sqrt(Math.max(0, k)) + 0.35)
        ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1)
    }
}

/** 1px circle outline (midpoint algorithm). */
export function ring(ctx: Ctx, cx: number, cy: number, r: number, c: string): void {
    cx |= 0; cy |= 0; r |= 0
    ctx.fillStyle = c
    if (r <= 0) { ctx.fillRect(cx, cy, 1, 1); return }
    let x = r
    let y = 0
    let err = 1 - r
    while (x >= y) {
        ctx.fillRect(cx + x, cy + y, 1, 1); ctx.fillRect(cx - x, cy + y, 1, 1)
        ctx.fillRect(cx + x, cy - y, 1, 1); ctx.fillRect(cx - x, cy - y, 1, 1)
        ctx.fillRect(cx + y, cy + x, 1, 1); ctx.fillRect(cx - y, cy + x, 1, 1)
        ctx.fillRect(cx + y, cy - x, 1, 1); ctx.fillRect(cx - y, cy - x, 1, 1)
        y++
        if (err < 0) err += 2 * y + 1
        else { x--; err += 2 * (y - x) + 1 }
    }
}

/** Ordered 2×2 dither fill: `level` 0..4 of the 4 cells get painted. Used instead of alpha. */
export function dither(ctx: Ctx, x: number, y: number, w: number, h: number, c: string, level: number): void {
    if (level <= 0) return
    if (level >= 4) { rect(ctx, x, y, w, h, c); return }
    x |= 0; y |= 0
    ctx.fillStyle = c
    for (let j = 0; j < h; j++) {
        const gy = (y + j) & 1
        for (let i = 0; i < w; i++) {
            const gx = (x + i) & 1
            // Bayer 2×2: (0,0)=0 (1,1)=1 (1,0)=2 (0,1)=3
            const t = gy === 0 ? (gx === 0 ? 0 : 2) : (gx === 0 ? 3 : 1)
            if (t < level) ctx.fillRect(x + i, y + j, 1, 1)
        }
    }
}

/** Deterministic hash → [0,1). Use for scenery layout so nothing is random per frame. */
export function hash(n: number): number {
    let h = (n | 0) * 374761393
    h = (h ^ (h >>> 13)) * 1274126177
    h = h ^ (h >>> 16)
    return (h >>> 0) / 4294967296
}

// ------------------------------------------------------------------ sprite buffer

/**
 * Scratch canvas a single sprite is drawn into, then stamped onto the scene with a
 * generated 1px outline, an optional flash tint and an optional rim light. The feet
 * anchor of the sprite is (ax, ay) inside the buffer.
 */
export class SpriteBuffer {
    readonly size: number
    readonly ax: number
    readonly ay: number
    readonly canvas: HTMLCanvasElement
    readonly ctx: Ctx
    private readonly tint: HTMLCanvasElement
    private readonly tctx: Ctx
    private readonly checker: HTMLCanvasElement

    constructor(size: number) {
        this.size = size
        this.ax = size >> 1
        this.ay = size - 6
        this.canvas = document.createElement('canvas')
        this.canvas.width = this.canvas.height = size
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!
        this.tint = document.createElement('canvas')
        this.tint.width = this.tint.height = size
        this.tctx = this.tint.getContext('2d')!
        this.checker = document.createElement('canvas')
        this.checker.width = this.checker.height = size
        const k = this.checker.getContext('2d')!
        k.fillStyle = '#000'
        for (let y = 0; y < size; y++) {
            for (let x = (y & 1); x < size; x += 2) k.fillRect(x, y, 1, 1)
        }
        this.ctx.imageSmoothingEnabled = false
        this.tctx.imageSmoothingEnabled = false
    }

    /** Clear and return the buffer context. Draw with the feet at (ax, ay). */
    begin(): Ctx {
        this.ctx.clearRect(0, 0, this.size, this.size)
        return this.ctx
    }

    private tinted(color: string): HTMLCanvasElement {
        const t = this.tctx
        t.globalCompositeOperation = 'source-over'
        t.clearRect(0, 0, this.size, this.size)
        t.drawImage(this.canvas, 0, 0)
        t.globalCompositeOperation = 'source-in'
        t.fillStyle = color
        t.fillRect(0, 0, this.size, this.size)
        t.globalCompositeOperation = 'source-over'
        return this.tint
    }

    /**
     * Stamp the buffer so its feet anchor lands on (x, y).
     * outline: colour of the generated 1px outline (null for none).
     * flash: draw the whole sprite as this solid colour (hit flash).
     * rim: light colour painted on the sprite edge facing (rimDx, rimDy).
     */
    blit(dst: Ctx, x: number, y: number, outline: string | null = C.ink, flash: string | null = null,
        rim: string | null = null, rimDx = 1, rimDy = 0): void {
        const dx = (x | 0) - this.ax
        const dy = (y | 0) - this.ay
        if (outline) {
            const o = this.tinted(outline)
            dst.drawImage(o, dx - 1, dy)
            dst.drawImage(o, dx + 1, dy)
            dst.drawImage(o, dx, dy - 1)
            dst.drawImage(o, dx, dy + 1)
        }
        if (flash) {
            dst.drawImage(this.tinted(flash), dx, dy)
            return
        }
        dst.drawImage(this.canvas, dx, dy)
        if (rim) {
            // rim = sprite pixels whose neighbour toward the light is empty
            const t = this.tinted(rim)
            this.tctx.globalCompositeOperation = 'destination-out'
            this.tctx.drawImage(this.canvas, -rimDx, -rimDy)
            this.tctx.globalCompositeOperation = 'source-over'
            dst.drawImage(t, dx, dy)
        }
    }

    /** Checker-dithered solid silhouette (afterimages, ghosts, shadows). */
    ghost(dst: Ctx, x: number, y: number, color: string): void {
        const t = this.tinted(color)
        this.tctx.globalCompositeOperation = 'destination-in'
        const par = ((x | 0) + (y | 0)) & 1
        this.tctx.drawImage(this.checker, par, 0)
        this.tctx.globalCompositeOperation = 'source-over'
        dst.drawImage(t, (x | 0) - this.ax, (y | 0) - this.ay)
    }

    /** Raw RGBA of the buffer (used to shatter a sprite into particles). */
    pixels(): Uint8ClampedArray {
        return this.ctx.getImageData(0, 0, this.size, this.size).data
    }
}

// ------------------------------------------------------------------ 3×5 pixel font

const GLYPHS: Record<string, string> = {
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
    '+': '000010111010000', '-': '000000111000000', '/': '001001010100100', 'x': '000101010101000',
    '%': '101001010100101', '?': '111001011000010', '>': '100010001010100', '<': '001010100010001',
    ' ': '000000000000000'
}
const NARROW: Record<string, string> = { '.': '00001', '!': '11101', ':': '01010', ',': '00011', '\'': '11000' }

const glyphW = new Uint8Array(128)
const glyphBits: Uint8Array[] = []
for (let i = 0; i < 128; i++) glyphBits.push(new Uint8Array(15))
for (const [ch, bits] of Object.entries(GLYPHS)) {
    const code = ch.charCodeAt(0)
    glyphW[code] = 3
    for (let i = 0; i < 15; i++) glyphBits[code]![i] = bits[i] === '1' ? 1 : 0
}
for (const [ch, bits] of Object.entries(NARROW)) {
    const code = ch.charCodeAt(0)
    glyphW[code] = 1
    for (let r = 0; r < 5; r++) glyphBits[code]![r * 3] = bits[r] === '1' ? 1 : 0
}

function charW(code: number): number {
    if (code >= 97 && code <= 122 && code !== 120) code -= 32
    return glyphW[code] || 3
}

function drawGlyph(ctx: Ctx, code: number, x: number, y: number, s: number): void {
    if (code >= 97 && code <= 122 && code !== 120) code -= 32
    const w = glyphW[code] || 3
    const b = glyphBits[code]!
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < w; c++) {
            if (b[r * 3 + c]) ctx.fillRect(x + c * s, y + r * s, s, s)
        }
    }
}

// char codes of the current string being drawn (numbers are formatted in here, no allocation)
const buf = new Uint8Array(32)
let bufLen = 0

function bufFromString(s: string): void {
    bufLen = Math.min(s.length, buf.length)
    for (let i = 0; i < bufLen; i++) buf[i] = s.charCodeAt(i)
}

const SUFFIX = ['', 'K', 'M', 'B', 'T', 'QA', 'QI', 'SX', 'SP', 'OC', 'NO', 'DC']

function pushInt(n: number): void {
    if (n === 0) { buf[bufLen++] = 48; return }
    const start = bufLen
    while (n > 0 && bufLen < buf.length) { buf[bufLen++] = 48 + (n % 10); n = Math.floor(n / 10) }
    for (let i = start, j = bufLen - 1; i < j; i++, j--) { const t = buf[i]!; buf[i] = buf[j]!; buf[j] = t }
}

/** Compact number (1.23K, 45.6M…) into the char buffer. */
function bufFromNumber(v: number, prefix: number): void {
    bufLen = 0
    if (prefix) buf[bufLen++] = prefix
    if (!Number.isFinite(v)) v = 0
    if (v < 1000) { pushInt(Math.floor(v)); return }
    let tier = Math.floor(Math.log10(v) / 3)
    if (tier >= SUFFIX.length) tier = SUFFIX.length - 1
    let m = v / Math.pow(1000, tier)
    if (m >= 999.5 && tier < SUFFIX.length - 1) { tier++; m /= 1000 }
    if (m >= 100) pushInt(Math.floor(m))
    else if (m >= 10) {
        const t = Math.floor(m * 10)
        pushInt(Math.floor(t / 10)); buf[bufLen++] = 46; pushInt(t % 10)
    } else {
        const t = Math.floor(m * 100)
        pushInt(Math.floor(t / 100)); buf[bufLen++] = 46
        buf[bufLen++] = 48 + Math.floor((t % 100) / 10); buf[bufLen++] = 48 + (t % 10)
    }
    const suf = SUFFIX[tier]!
    for (let i = 0; i < suf.length; i++) buf[bufLen++] = suf.charCodeAt(i)
}

function bufWidth(s: number): number {
    let w = 0
    for (let i = 0; i < bufLen; i++) w += (charW(buf[i]!) + 1) * s
    return w > 0 ? w - s : 0
}

/** align: 0 left, 1 centre, 2 right. shadow: 0 none, 1 drop shadow, 2 full outline. */
function drawBuf(ctx: Ctx, x: number, y: number, color: string, s: number, align: number, shadow: number, shadowColor: string): number {
    const w = bufWidth(s)
    let cx = (align === 1 ? x - (w >> 1) : align === 2 ? x - w : x) | 0
    y |= 0
    if (shadow) {
        ctx.fillStyle = shadowColor
        let sx = cx
        for (let i = 0; i < bufLen; i++) {
            const code = buf[i]!
            if (shadow === 2) {
                drawGlyph(ctx, code, sx - 1, y, s); drawGlyph(ctx, code, sx + 1, y, s)
                drawGlyph(ctx, code, sx, y - 1, s)
            }
            drawGlyph(ctx, code, sx, y + 1, s)
            if (shadow === 2 || s > 1) drawGlyph(ctx, code, sx + 1, y + 1, s)
            sx += (charW(code) + 1) * s
        }
    }
    ctx.fillStyle = color
    for (let i = 0; i < bufLen; i++) {
        drawGlyph(ctx, buf[i]!, cx, y, s)
        cx += (charW(buf[i]!) + 1) * s
    }
    return w
}

export function textWidth(s: string, scale = 1): number {
    bufFromString(s)
    return bufWidth(scale)
}

export function drawText(ctx: Ctx, s: string, x: number, y: number, color: string, scale = 1, align = 0, shadow = 1, shadowColor: string = C.ink): number {
    bufFromString(s)
    return drawBuf(ctx, x, y, color, scale, align, shadow, shadowColor)
}

/** Draw a compact number without allocating. prefix: optional char code ('+' = 43). */
export function drawNumber(ctx: Ctx, v: number, x: number, y: number, color: string, scale = 1, align = 0, shadow = 1, prefix = 0, shadowColor: string = C.ink): number {
    bufFromNumber(v, prefix)
    return drawBuf(ctx, x, y, color, scale, align, shadow, shadowColor)
}

export function numberWidth(v: number, scale = 1, prefix = 0): number {
    bufFromNumber(v, prefix)
    return bufWidth(scale)
}
