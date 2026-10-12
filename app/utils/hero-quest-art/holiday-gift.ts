// Holiday gifts on the stage (`holiday-events.md`). While a holiday's gift waits, a gift box in its
// holiday's colours sits under the battle view's top-right readout and wiggles every couple of
// seconds. Pressed, it opens the reveal: the box drops onto a panel, shakes while the claim is on
// its way, bursts open in gold with its lid flung off and confetti thrown, and what it held pops
// out a line at a time, each count running up to what was paid.

import { C } from './palette'
import { Surface, rect, px, dither, blit, hash2 } from './surface'
import { drawRevealAura, drawRevealBase, REVEAL_LUT, REVEAL_SIZE } from './feedback'
import { drawSkillBanner } from './presentation'
import { drawText, textWidth } from './font'
import { glyph } from './icon-kit'
import { CURRENCY_ICONS } from './icons-items'
import { panel } from './ui-art'
import { formatHq } from '../../../shared/utils/hero-quest/numbers'
import type { HolidayId } from '../../../shared/utils/hero-quest/content/holidays'

interface Box {
    x: number
    y: number
    w: number
    h: number
}

/**
 * The reveal's one button, in the plate style of `collections-scene`'s buttons. Drawn here because
 * that module reaches the catalog, which registers this one for the gallery.
 */
function plateButton(s: Surface, b: Box, label: string, plate: readonly [number, number, number], lit: boolean, down: boolean): void {
    const sink = lit && down ? 1 : 0
    rect(s, b.x, b.y, b.w, b.h, C.ink)
    rect(s, b.x + 1, b.y + 1 + sink, b.w - 2, b.h - 2 - sink, lit ? plate[2] : plate[1])
    rect(s, b.x + 1, b.y + 1 + sink, b.w - 2, 1, lit ? C.white : plate[2])
    if (!sink) rect(s, b.x + 1, b.y + b.h - 2, b.w - 2, 1, plate[0])
    drawText(s, label, b.x + (b.w >> 1), b.y + 4 + sink, C.white, { align: 1, shadow: 1 })
}

/** The gift waiting to be opened, for the icon. */
export interface HolidayGiftIconView {
    id: HolidayId
    name: string
}

/** One line of what a gift paid: a `CURRENCY_ICONS` key, the amount and what it is. */
export interface GiftRewardLine {
    icon: string
    amount: number
    label: string
}

/**
 * The reveal on screen. `lines` is null while the claim is on its way; the box shakes until it
 * lands. `key` changes with every gift opened, so a second one plays from the start.
 */
export interface HolidayRevealView {
    key: number
    id: HolidayId
    name: string
    lines: readonly GiftRewardLine[] | null
}

/** A holiday's box: body ramp dark to light, ribbon, and the confetti it throws. */
interface GiftTheme {
    body: readonly [number, number, number]
    ribbon: number
    confetti: readonly number[]
    motif: 'spark' | 'coins' | 'hearts' | 'eggs' | 'pumpkin' | 'snow'
}

const THEMES: Readonly<Record<HolidayId, GiftTheme>> = {
    holiday_new_year: { body: [C.blue0, C.blue1, C.blue2], ribbon: C.gold2, confetti: [C.gold3, C.white, C.cyan, C.gold2], motif: 'spark' },
    holiday_lunar_new_year: { body: [C.red0, C.red1, C.red2], ribbon: C.gold2, confetti: [C.gold3, C.red3, C.gold2, C.orange], motif: 'coins' },
    holiday_valentines: { body: [C.red1, C.red2, C.red3], ribbon: C.pink, confetti: [C.pink, C.white, C.red3, C.red2], motif: 'hearts' },
    holiday_easter: { body: [C.purple0, C.purple1, C.purple2], ribbon: C.green3, confetti: [C.pink, C.cyan, C.gold3, C.green4], motif: 'eggs' },
    holiday_halloween: { body: [C.red1, C.orange, C.gold2], ribbon: C.purple1, confetti: [C.orange, C.purple2, C.green3, C.gold3], motif: 'pumpkin' },
    holiday_christmas: { body: [C.green0, C.green1, C.green2], ribbon: C.red2, confetti: [C.red3, C.white, C.green3, C.gold3], motif: 'snow' }
}

/** A box's proportions: the icon's and the reveal's. */
interface GiftDims {
    w: number
    h: number
    lidW: number
    lidH: number
    ribbon: number
    /** Each bow loop's length, in pixels. */
    bow: number
}

const ICON_DIMS: GiftDims = { w: 14, h: 10, lidW: 16, lidH: 4, ribbon: 2, bow: 4 }
const BIG_DIMS: GiftDims = { w: 26, h: 19, lidW: 30, lidH: 7, ribbon: 4, bow: 8 }

/** Where the lid is: lifted off the box by `dy` (up is negative), pushed `dx`, or gone. */
interface LidPose {
    dx: number
    dy: number
    gone?: boolean
}

/** The box's lid alone, its bow on top, centred on `cx` with its bottom row at `by`. */
function drawLid(s: Surface, cx: number, by: number, theme: GiftTheme, d: GiftDims): void {
    const [, mid, light] = theme.body
    const x = cx - (d.lidW >> 1)
    const y = by - d.lidH + 1
    rect(s, x, y, d.lidW, d.lidH, C.ink)
    rect(s, x + 1, y + 1, d.lidW - 2, d.lidH - 2, mid)
    rect(s, x + 1, y + 1, d.lidW - 2, 1, light)
    rect(s, cx - (d.ribbon >> 1), y + 1, d.ribbon, d.lidH - 2, theme.ribbon)
    drawBow(s, cx, y, theme, d)
}

/**
 * The bow on a lid whose top row is `y`: a knot the ribbon's width sitting on the lid, two rounded
 * loops flaring out and a little up from it, each with a hole, and on the big box two tails.
 */
function drawBow(s: Surface, cx: number, y: number, theme: GiftTheme, d: GiftDims): void {
    const big = d.bow > 5
    const k0 = cx - (d.ribbon >> 1)
    const k1 = k0 + d.ribbon - 1
    const knotH = big ? 3 : 2
    const ky = y - knotH + 1
    // per column out from the knot: the loop's half-height and how far it tilts up
    const half = big ? [0, 1, 1, 2, 2, 2, 1, 0] : [0, 1, 1, 0]
    const tilt = big ? [0, 0, 1, 1, 1, 2, 2, 2] : [0, 1, 1, 1]
    const holes = big ? [3, 4, 5] : []
    if (big) {
        // tails falling out and down over the lid, cut in a notch
        for (const side of [-1, 1]) {
            const x0 = side < 0 ? k0 : k1
            for (let j = 1; j <= 3; j++) {
                const tx = x0 + side * j
                rect(s, Math.min(tx, tx + side), y + j, 2, 1, theme.ribbon)
                px(s, tx + side * 2, y + j, C.ink)
                px(s, tx - side, y + j + 1, C.ink)
            }
            px(s, x0 + side * 3, y + 4, C.ink)
        }
    }
    for (const side of [-1, 1]) {
        for (let i = 0; i < half.length; i++) {
            const x = (side < 0 ? k0 - 1 : k1 + 1) + side * i
            const end = i === half.length - 1
            const top = ky - half[i]! - tilt[i]!
            const bot = ky + knotH - 1 + half[i]! - tilt[i]!
            for (let yy = top; yy <= bot; yy++) px(s, x, yy, end || yy === top || yy === bot ? C.ink : theme.ribbon)
            if (holes.includes(i)) px(s, x, ky - tilt[i]! + (big ? 1 : 0), C.ink)
            if (big && i === 4) px(s, x, ky - tilt[i]!, C.ink)
            if (i === 1) px(s, x, top + 1, C.white)
        }
    }
    rect(s, k0 - 1, ky - 1, d.ribbon + 2, knotH + 2, C.ink)
    rect(s, k0, ky, d.ribbon, knotH, theme.ribbon)
    px(s, k0, ky, C.white)
}

/** The box: its body standing on `by` (its bottom row), and the lid where `lid` puts it. */
function drawGiftBox(s: Surface, cx: number, by: number, theme: GiftTheme, d: GiftDims, lid: LidPose): void {
    const [dark, mid, light] = theme.body
    const x = cx - (d.w >> 1)
    const y = by - d.h + 1
    rect(s, x, y, d.w, d.h, C.ink)
    rect(s, x + 1, y + 1, d.w - 2, d.h - 2, mid)
    rect(s, x + d.w - 3, y + 1, 2, d.h - 2, dark)
    rect(s, x + 1, y + 1, d.w - 2, 1, light)
    drawMotif(s, x, y, d, theme)
    rect(s, cx - (d.ribbon >> 1), y + 1, d.ribbon, d.h - 2, theme.ribbon)
    if (!lid.gone) drawLid(s, cx + lid.dx, y + lid.dy, theme, d)
}

/** The holiday's mark on the box's front, either side of the ribbon. */
function drawMotif(s: Surface, x: number, y: number, d: GiftDims, theme: GiftTheme): void {
    const big = d.w > 20
    const left = x + (big ? 5 : 3)
    const right = x + d.w - (big ? 8 : 5)
    const my = y + (d.h >> 1)
    const mark = (mx: number) => {
        switch (theme.motif) {
            case 'spark':
                px(s, mx, my - 1, C.gold3); px(s, mx - 1, my, C.gold3); px(s, mx + 1, my, C.gold3); px(s, mx, my + 1, C.gold3)
                if (big) { px(s, mx, my, C.white); px(s, mx, my - 2, C.gold2); px(s, mx, my + 2, C.gold2) }
                break
            case 'coins':
                rect(s, mx - 1, my - 1, 3, 3, C.gold2)
                px(s, mx, my, C.red0)
                if (big) { rect(s, mx - 1, my + 3, 3, 2, C.gold2) }
                break
            case 'hearts':
                px(s, mx - 1, my - 1, C.white); px(s, mx + 1, my - 1, C.white)
                rect(s, mx - 1, my, 3, 1, C.white); px(s, mx, my + 1, C.white)
                if (big) { px(s, mx - 2, my - 1, C.pink); px(s, mx + 2, my - 1, C.pink); rect(s, mx - 2, my, 5, 1, C.pink); rect(s, mx - 1, my + 1, 3, 1, C.pink); px(s, mx, my + 2, C.pink) }
                break
            case 'eggs':
                rect(s, mx - 1, my - 1, 2, 3, C.gold3)
                px(s, mx, my - 2, C.gold3)
                if (big) { rect(s, mx - 1, my, 3, 1, C.pink); px(s, mx + 1, my - 1, C.gold3) }
                break
            case 'pumpkin':
                // a jack-o'-lantern's eyes and grin
                px(s, mx - 1, my - 1, C.ink); px(s, mx + 1, my - 1, C.ink); rect(s, mx - 1, my + 1, 3, 1, C.ink)
                break
            case 'snow':
                px(s, mx, my - 1, C.white); px(s, mx - 1, my + 1, C.white); px(s, mx + 1, my + 1, C.white)
                if (big) { px(s, mx, my, C.frost); px(s, mx - 2, my - 2, C.white); px(s, mx + 2, my + 3, C.white) }
                break
        }
    }
    mark(left)
    mark(right)
}

// ── The icon ───────────────────────────────────────────────────────────────────────────

const ICON = 20
/** Every `WIGGLE_EVERY` seconds the box wiggles for the length of its pattern, at 10 fps. */
const WIGGLE_EVERY = 2.2
const WIGGLE_SWAY = [0, -1, 1, -1, 1, -1, 1, 0] as const
const WIGGLE_LID = [0, -1, -2, -1, -2, -1, 0, 0] as const

/** The icon's box on a view `w` wide: under the top-right readout. */
export function giftIconBox(w: number): Box {
    return { x: w - 6 - ICON, y: 13, w: ICON, h: ICON }
}

export function onGiftIcon(w: number, x: number, y: number): boolean {
    const b = giftIconBox(w)
    return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h
}

/**
 * The gift box waiting in the corner. It wiggles in bursts, stepped at 10 fps like the rest of the
 * UI's loops, with two glints twinkling round it; pointed at, it sits up a pixel and says whose
 * gift it is.
 */
export function drawGiftIcon(s: Surface, t: number, view: HolidayGiftIconView, hover: boolean): void {
    drawGiftIconIn(s, giftIconBox(s.w), t, view, hover)
}

/** The icon in box `b`: the battle view's corner, or a gallery sheet's cell. */
export function drawGiftIconIn(s: Surface, b: Box, t: number, view: HolidayGiftIconView, hover: boolean): void {
    const theme = THEMES[view.id]
    const f = Math.floor((t % WIGGLE_EVERY) * 10)
    const sway = f < WIGGLE_SWAY.length ? WIGGLE_SWAY[f]! : 0
    const lidUp = f < WIGGLE_LID.length ? WIGGLE_LID[f]! : 0
    const lift = hover ? 1 : 0
    const cx = b.x + (b.w >> 1) + sway
    const by = b.y + b.h - 2 - lift
    drawGiftBox(s, cx, by, theme, ICON_DIMS, { dx: 0, dy: lidUp })
    // glints: each lit for a few frames of its own cycle
    const tick = Math.floor(t * 10)
    for (let i = 0; i < 3; i++) {
        if ((tick + i * 5) % 14 >= 4 && !hover) continue
        // either side of the box, clear of the bow
        const gx = i % 2 ? b.x + b.w - 1 : b.x
        const gy = b.y + 2 + Math.round(hash2(32, i) * 10)
        px(s, gx, gy, C.white)
        px(s, gx - 1, gy, C.gold3); px(s, gx + 1, gy, C.gold3); px(s, gx, gy - 1, C.gold3); px(s, gx, gy + 1, C.gold3)
    }
    if (hover) drawText(s, `${view.name.toUpperCase()} GIFT`, b.x + b.w, b.y + b.h + 2, C.gold3, { align: 2, shadow: 1 })
}

// ── The reveal ─────────────────────────────────────────────────────────────────────────

const PANEL_W = 204
const PANEL_H = 133
/** The box falls this long onto the panel. */
const DROP = 0.35
/** It shakes at least this long before bursting, however soon the claim lands. */
const MIN_SHAKE = 0.5
/** After the burst, the first line pops out this late, and each next one this much later. */
const LINES_AFTER = 0.55
const LINE_GAP = 0.3
/** Rows between reward lines, in pixels. */
const LINE_STEP = 15
/** Each line's count runs up this long. */
const COUNT_FOR = 0.6
const FLASH_FOR = 1.4
const CONFETTI = 48
const CONFETTI_FOR = 2.6

function panelBox(w: number, h: number): Box {
    return { x: (w - PANEL_W) >> 1, y: Math.max(2, (h - PANEL_H) >> 1), w: PANEL_W, h: PANEL_H }
}

function buttonBox(w: number, h: number): Box {
    const p = panelBox(w, h)
    return { x: p.x + ((p.w - 60) >> 1), y: p.y + p.h - 18, w: 60, h: 13 }
}

export function onRevealButton(w: number, h: number, x: number, y: number): boolean {
    const b = buttonBox(w, h)
    return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h
}

const ease = (u: number) => 1 - (1 - u) * (1 - u)
const clamp01 = (u: number) => Math.max(0, Math.min(1, u))

const FLASH = new Surface(REVEAL_SIZE, REVEAL_SIZE, 0, 0)

export class GiftReveal {
    private key = -1
    private openedAt = 0
    /** When the claim's lines arrived, in scene time; null while it is on its way. */
    private arrivedAt: number | null = null
    private skipped = false

    /** The moment the box bursts: once it has landed and shaken a beat, and the claim is in. */
    private burstAt(): number | null {
        if (this.arrivedAt === null) return null
        return Math.max(this.openedAt + DROP + MIN_SHAKE, this.arrivedAt)
    }

    /** Whether every line is out and counted, at scene time `t`. */
    done(view: HolidayRevealView, t: number): boolean {
        if (this.key !== view.key || !view.lines) return false
        if (this.skipped) return true
        const burst = this.burstAt()
        return burst !== null && t >= burst + LINES_AFTER + (view.lines.length - 1) * LINE_GAP + COUNT_FOR
    }

    /** A press before the end: show everything at once, once there is something to show. */
    skip(view: HolidayRevealView): void {
        if (this.key === view.key && view.lines) this.skipped = true
    }

    render(s: Surface, t: number, view: HolidayRevealView, lit: boolean, pressed: boolean): void {
        if (this.key !== view.key) {
            this.key = view.key
            this.openedAt = t
            this.arrivedAt = null
            this.skipped = false
        }
        if (view.lines && this.arrivedAt === null) this.arrivedAt = t
        const theme = THEMES[view.id]
        const since = t - this.openedAt
        const burst = this.burstAt()
        // seconds since the burst, or negative before it; a skip lands well past every beat
        const after = this.skipped ? 1e3 : burst === null ? -1 : t - burst

        dither(s, 0, 0, s.w, s.h, C.ink, 10)
        const p = panelBox(s.w, s.h)
        panel(s, p.x, p.y, p.w, p.h, [C.gold0, C.gold1, C.gold3])
        const cx = p.x + (p.w >> 1)
        const floor = p.y + 60

        if (after < 0) {
            // the drop, then a shake that grows the longer the claim takes
            const fall = clamp01(since / DROP)
            const dropY = Math.round((1 - fall * fall) * -26)
            const shaking = since >= DROP
            const level = shaking ? Math.min(2, 1 + Math.floor((since - DROP) / 0.6)) : 0
            const jitter = shaking ? (Math.floor(t * 15) % 2 ? level : -level) : 0
            const hop = shaking && Math.floor(t * 15) % 3 === 0 ? -2 : 0
            if (fall >= 1 && since < DROP + 0.12) dither(s, cx - 18, floor - 1, 36, 3, C.bone1, 6)
            drawGiftBox(s, cx + jitter, floor + dropY, theme, BIG_DIMS, { dx: 0, dy: hop })
            if (shaking) drawText(s, 'OPENING', cx, p.y + p.h - 14, C.stone3, { align: 1, shadow: 1 })
            return
        }

        // the glow it keeps once open, the burst over it, and the open box in front
        const mid = floor - 14
        FLASH.clear()
        drawRevealAura(FLASH, after)
        blit(s, FLASH, cx - (REVEAL_SIZE >> 1), mid - (REVEAL_SIZE >> 1), REVEAL_LUT.legendary!)
        if (after < FLASH_FOR) {
            FLASH.clear()
            drawRevealBase(FLASH, after + 0.3)
            blit(s, FLASH, cx - (REVEAL_SIZE >> 1), mid - (REVEAL_SIZE >> 1), REVEAL_LUT.legendary!)
        }
        drawGiftBox(s, cx, floor, theme, BIG_DIMS, { dx: 0, dy: 0, gone: true })
        // the lid, flung up and away to the left, wobbling as it goes
        if (after < 1.1) {
            const lx = cx - Math.round(after * 70) + (Math.floor(after * 12) % 2 ? 1 : -1)
            const ly = floor - BIG_DIMS.h + Math.round(-after * 150 + after * after * 240)
            if (ly > p.y + 4) drawLid(s, lx, ly, theme, BIG_DIMS)
        }
        // confetti thrown out of the open box, fluttering as it falls
        if (after < CONFETTI_FOR) {
            for (let i = 0; i < CONFETTI; i++) {
                const vx = (hash2(41, i) - 0.5) * 150
                const vy = -60 - hash2(42, i) * 110
                const x = Math.round(cx + vx * after)
                const y = Math.round(floor - BIG_DIMS.h + vy * after + 150 * after * after)
                if (y > p.y + p.h - 3 || x < p.x + 2 || x > p.x + p.w - 3) continue
                const c = theme.confetti[i % theme.confetti.length]!
                // a third are squares, the rest flip edge-on and back as they flutter
                if (i % 3 === 0) rect(s, x, y, 2, 2, c)
                else if ((Math.floor(after * 14) + i) % 2) rect(s, x, y, 2, 1, c)
                else rect(s, x, y, 1, 2, c)
            }
        }

        drawSkillBanner(s, `${view.name.toUpperCase()} GIFT`, cx, p.y + 5, after)

        // what it held, a line at a time, two columns once there are more than three
        const lines = view.lines ?? []
        const cols = lines.length > 3 ? 2 : 1
        const colW = cols === 2 ? 96 : 120
        const top = floor + 8
        lines.forEach((line, i) => {
            const out = after - LINES_AFTER - i * LINE_GAP
            if (out < 0) return
            const col = cols === 2 ? i % 2 : 0
            const row = cols === 2 ? i >> 1 : i
            const x0 = cols === 2 ? p.x + 8 + col * colW : cx - (colW >> 1) + 16
            const y0 = top + row * LINE_STEP + Math.round((1 - ease(clamp01(out / 0.15))) * 4)
            const counted = Math.floor(line.amount * ease(clamp01(out / COUNT_FOR)))
            const text = `+${formatHq(counted).toUpperCase()} ${line.label}`
            glyph(s, CURRENCY_ICONS[line.icon] ?? CURRENCY_ICONS.gold!, x0 + 4, y0 + 2, true)
            drawText(s, text, x0 + 12, y0, out < 0.1 ? C.white : C.gold3, { shadow: 1 })
            // a glint along the line as it lands
            if (out < 0.25) {
                const gx = x0 + 12 + Math.round(textWidth(text) * (out / 0.25))
                px(s, gx, y0 + 2, C.white)
            }
        })

        if (this.done(view, t)) plateButton(s, buttonBox(s.w, s.h), 'CONTINUE', [C.green0, C.green1, C.green2], lit, pressed)
    }
}
