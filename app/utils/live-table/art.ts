/**
 * SVG port of app/utils/live-blackjack/art.ts — same bezier control points,
 * court-card layout and chip ring construction, rendered as markup strings
 * instead of baked PixiJS textures so the four DOM/SVG table games match the
 * Pixi blackjack table exactly rather than approximating it.
 */
import { LB_CHIPS, chipStack as breakIntoChips, type LbChip } from '#shared/utils/live-blackjack/chips'
import type { LbRank, LbSuit } from '#shared/utils/live-blackjack/types'

export const chipsFor = breakIntoChips

export const CARD_W = 112
export const CARD_H = 156
export const CHIP_R = 46

/** Where the deal comes from and the discard pile collects to, in the table's
 *  1720x1200 stage coordinates. Sat on the community-card line rather than the
 *  top rail, so the trays read as part of the felt the cards are dealt across. */
export const LT_SHOE_POS = { x: 1431, y: 292 }
export const LT_DISCARD_POS = { x: 289, y: 292 }

export const FELT = '#0f5132'
export const FELT_EDGE = '#0a3a24'
export const RAIL = '#3b2416'
export const GOLD = '#d9b167'

const SUIT_COLOR: Record<LbSuit, string> = {
    hearts: '#c02434',
    diamonds: '#c02434',
    clubs: '#14181f',
    spades: '#14181f'
}
const CARD_FACE = '#fbfaf6'
const CARD_EDGE = '#c8c3b4'
const SERIF = 'Georgia, "Times New Roman", "DejaVu Serif", serif'
const UI_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

/** Column/row positions of the centre pips, in card-body fractions. */
const PIP_LAYOUTS: Record<string, [number, number][]> = {
    '2': [[0.5, 0.14], [0.5, 0.86]],
    '3': [[0.5, 0.14], [0.5, 0.5], [0.5, 0.86]],
    '4': [[0.28, 0.14], [0.72, 0.14], [0.28, 0.86], [0.72, 0.86]],
    '5': [[0.28, 0.14], [0.72, 0.14], [0.5, 0.5], [0.28, 0.86], [0.72, 0.86]],
    '6': [[0.28, 0.14], [0.72, 0.14], [0.28, 0.5], [0.72, 0.5], [0.28, 0.86], [0.72, 0.86]],
    '7': [[0.28, 0.14], [0.72, 0.14], [0.5, 0.32], [0.28, 0.5], [0.72, 0.5], [0.28, 0.86], [0.72, 0.86]],
    '8': [[0.28, 0.14], [0.72, 0.14], [0.5, 0.32], [0.28, 0.5], [0.72, 0.5], [0.5, 0.68], [0.28, 0.86], [0.72, 0.86]],
    '9': [[0.28, 0.14], [0.72, 0.14], [0.28, 0.38], [0.72, 0.38], [0.5, 0.5], [0.28, 0.62], [0.72, 0.62], [0.28, 0.86], [0.72, 0.86]],
    '10': [[0.28, 0.14], [0.72, 0.14], [0.5, 0.26], [0.28, 0.38], [0.72, 0.38], [0.28, 0.62], [0.72, 0.62], [0.5, 0.74], [0.28, 0.86], [0.72, 0.86]]
}

const n = (v: number) => Math.round(v * 1000) / 1000

/** Verbatim port of art.ts drawSuit(), emitting SVG path data instead of Graphics calls. */
function suitPath(suit: LbSuit, x: number, y: number, s: number): string {
    switch (suit) {
        case 'hearts':
            return `M ${n(x)},${n(y + 0.75 * s)} C ${n(x - 1.1 * s)},${n(y + 0.05 * s)} ${n(x - 0.6 * s)},${n(y - 0.85 * s)} ${n(x)},${n(y - 0.25 * s)} C ${n(x + 0.6 * s)},${n(y - 0.85 * s)} ${n(x + 1.1 * s)},${n(y + 0.05 * s)} ${n(x)},${n(y + 0.75 * s)} Z`
        case 'diamonds':
            return `M ${n(x)},${n(y - 0.9 * s)} L ${n(x + 0.66 * s)},${n(y)} L ${n(x)},${n(y + 0.9 * s)} L ${n(x - 0.66 * s)},${n(y)} Z`
        case 'spades':
            return `M ${n(x)},${n(y - 0.85 * s)} C ${n(x + 0.55 * s)},${n(y - 0.2 * s)} ${n(x + 1.05 * s)},${n(y + 0.15 * s)} ${n(x + 0.42 * s)},${n(y + 0.5 * s)} C ${n(x + 0.18 * s)},${n(y + 0.62 * s)} ${n(x + 0.06 * s)},${n(y + 0.5 * s)} ${n(x + 0.1 * s)},${n(y + 0.34 * s)} L ${n(x + 0.34 * s)},${n(y + 0.86 * s)} L ${n(x - 0.34 * s)},${n(y + 0.86 * s)} L ${n(x - 0.1 * s)},${n(y + 0.34 * s)} C ${n(x - 0.06 * s)},${n(y + 0.5 * s)} ${n(x - 0.18 * s)},${n(y + 0.62 * s)} ${n(x - 0.42 * s)},${n(y + 0.5 * s)} C ${n(x - 1.05 * s)},${n(y + 0.15 * s)} ${n(x - 0.55 * s)},${n(y - 0.2 * s)} ${n(x)},${n(y - 0.85 * s)} Z`
        case 'clubs':
            return `M ${n(x - 0.3 * s)},${n(y + 0.88 * s)} C ${n(x - 0.08 * s)},${n(y + 0.5 * s)} ${n(x - 0.06 * s)},${n(y + 0.3 * s)} ${n(x - 0.07 * s)},${n(y + 0.18 * s)} L ${n(x + 0.07 * s)},${n(y + 0.18 * s)} C ${n(x + 0.06 * s)},${n(y + 0.3 * s)} ${n(x + 0.08 * s)},${n(y + 0.5 * s)} ${n(x + 0.3 * s)},${n(y + 0.88 * s)} Z`
    }
}

/** Clubs needs three circles alongside its stem path. */
function suitShape(suit: LbSuit, x: number, y: number, s: number, color: string): string {
    if (suit === 'clubs') {
        return `<circle cx="${n(x)}" cy="${n(y - 0.4 * s)}" r="${n(0.37 * s)}" fill="${color}"/>`
            + `<circle cx="${n(x - 0.44 * s)}" cy="${n(y + 0.2 * s)}" r="${n(0.37 * s)}" fill="${color}"/>`
            + `<circle cx="${n(x + 0.44 * s)}" cy="${n(y + 0.2 * s)}" r="${n(0.37 * s)}" fill="${color}"/>`
            + `<path d="${suitPath(suit, x, y, s)}" fill="${color}"/>`
    }
    return `<path d="${suitPath(suit, x, y, s)}" fill="${color}"/>`
}

function cornerIndex(rank: LbRank, suit: LbSuit, color: string, x: number, y: number, rotated: boolean): string {
    const size = rank === '10' ? 24 : 27
    // SVG text has no live bounding box at string-build time, so the pip offset
    // approximates PIXI.Text's measured height (label.height + 11 in art.ts).
    const pipY = size * 1.16 + 11
    const t = rotated ? ` transform="rotate(180 ${n(x)} ${n(y)})"` : ''
    return `<g${t}>`
        + `<text x="${n(x)}" y="${n(y + size * 0.92)}" font-family='${SERIF}' font-size="${size}" font-weight="700" fill="${color}" text-anchor="middle">${rank}</text>`
        + suitShape(suit, x, y + pipY, 8.5, color)
        + '</g>'
}

function courtPanel(rank: LbRank, suit: LbSuit, color: string): string {
    const bodyW = CARD_W - 34
    const bodyH = CARD_H - 44
    const cx = CARD_W / 2
    const cy = CARD_H / 2
    let s = '<g>'
    s += `<rect x="${n(cx - bodyW / 2)}" y="${n(cy - bodyH / 2)}" width="${bodyW}" height="${bodyH}" rx="5" fill="#fdfcf8" stroke="${color}" stroke-opacity="0.55" stroke-width="1.6"/>`
    s += `<line x1="${n(cx - bodyW / 2)}" y1="${n(cy + bodyH / 2)}" x2="${n(cx + bodyW / 2)}" y2="${n(cy - bodyH / 2)}" stroke="${color}" stroke-opacity="0.22" stroke-width="1"/>`
    s += `<text x="${n(cx)}" y="${n(cy + 16)}" font-family='${SERIF}' font-size="46" font-weight="700" fill="${color}" text-anchor="middle">${rank}</text>`
    s += suitShape(suit, cx, cy - bodyH / 2 + 17, 11, color)
    s += `<g transform="rotate(180 ${n(cx)} ${n(cy + bodyH / 2 - 17)})">${suitShape(suit, cx, cy + bodyH / 2 - 17, 11, color)}</g>`
    s += '</g>'
    return s
}

/** A card face at native 112x156. Scale it with CSS width/height — it is vector, so it stays crisp at any size. */
export function cardFace(rank: LbRank, suit: LbSuit): string {
    const color = SUIT_COLOR[suit]
    let body = ''

    if (rank === 'A') {
        body += suitShape(suit, CARD_W / 2, CARD_H / 2, 34, color)
    } else if (rank === 'J' || rank === 'Q' || rank === 'K') {
        body += courtPanel(rank, suit, color)
    } else {
        const layout = PIP_LAYOUTS[rank] ?? []
        const left = 20
        const top = 26
        const w = CARD_W - left * 2
        const h = CARD_H - top * 2
        for (const [fx, fy] of layout) {
            const px = left + fx * w
            const py = top + fy * h
            // Pips on the lower half sit upside down, exactly as on a real card.
            if (fy > 0.55) {
                body += `<g transform="rotate(180 ${n(px)} ${n(py)})">${suitShape(suit, px, py, 11.5, color)}</g>`
            } else {
                body += suitShape(suit, px, py, 11.5, color)
            }
        }
    }

    body += cornerIndex(rank, suit, color, 15, 8, false)
    body += cornerIndex(rank, suit, color, CARD_W - 15, CARD_H - 8, true)

    // Rect is inset by half the stroke width so the stroke's outer edge lands
    // exactly at the viewBox bounds instead of bleeding past it.
    return `<svg class="lt-card" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">`
        + `<rect x="0.7" y="0.7" width="${CARD_W - 1.4}" height="${CARD_H - 1.4}" rx="9" fill="${CARD_FACE}" stroke="${CARD_EDGE}" stroke-width="1.4"/>`
        + body + '</svg>'
}

export function cardBack(): string {
    const step = 13
    let lattice = ''
    for (let y = 12; y < CARD_H - 12; y += step) {
        for (let x = 12; x < CARD_W - 12; x += step) {
            const off = (Math.floor(y / step)) % 2 ? step / 2 : 0
            const px = x + off
            if (px > CARD_W - 14) continue
            lattice += `M ${n(px)},${n(y - 4)} L ${n(px + 4)},${n(y)} L ${n(px)},${n(y + 4)} L ${n(px - 4)},${n(y)} Z `
        }
    }
    const id = 'ltbk' + Math.random().toString(36).slice(2, 8)
    return `<svg class="lt-card" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">`
        + `<defs><clipPath id="${id}"><rect x="10" y="10" width="${CARD_W - 20}" height="${CARD_H - 20}" rx="4"/></clipPath></defs>`
        + `<rect width="${CARD_W}" height="${CARD_H}" rx="9" fill="#fbfaf6"/>`
        + `<rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" rx="6" fill="#8f1230"/>`
        + `<rect x="9.7" y="9.7" width="${CARD_W - 19.4}" height="${CARD_H - 19.4}" rx="4" fill="none" stroke="#f0c674" stroke-opacity="0.85" stroke-width="1.4"/>`
        + `<path d="${lattice}" fill="#f0c674" fill-opacity="0.2" clip-path="url(#${id})"/>`
        + `<circle cx="${CARD_W / 2}" cy="${CARD_H / 2}" r="24" fill="#6d0c24" stroke="#f0c674" stroke-opacity="0.9" stroke-width="2"/>`
        + suitShape('spades', CARD_W / 2, CARD_H / 2, 14, '#f0c674')
        + '</svg>'
}

/** Verbatim port of art.ts shade(): mixes a numeric 0xRRGGBB colour toward white or black. */
function shade(color: number, amount: number): number {
    const r = (color >> 16) & 0xff
    const g = (color >> 8) & 0xff
    const b = color & 0xff
    const mix = (c: number) => Math.max(0, Math.min(255, Math.round(amount > 0
        ? c + (255 - c) * amount
        : c * (1 + amount))))
    return (mix(r) << 16) | (mix(g) << 8) | mix(b)
}

const hex = (color: number) => '#' + color.toString(16).padStart(6, '0')

function chipDef(value: number): LbChip {
    return LB_CHIPS.find((c) => c.value === value) ?? LB_CHIPS[0]!
}

/** A chip at native 92x92 (CHIP_R 46, centred). Port of art.ts buildChip(). */
export function chip(value: number): string {
    const d = chipDef(value)
    const r = CHIP_R
    const size = r * 2
    let s = `<svg class="lt-chip" viewBox="${-r - 1} ${-r - 1} ${size + 5} ${size + 5}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">`

    s += `<circle cx="0" cy="3" r="${r}" fill="#000" fill-opacity="0.28"/>`
    s += `<circle cx="0" cy="0" r="${r}" fill="${hex(d.base)}" stroke="${hex(shade(d.base, -0.35))}" stroke-width="2"/>`

    // Rim spots: wedges drawn full-radius, then covered back to a band by the
    // inner disc — the same silhouette as the inlays on a real clay chip.
    const spots = d.tier >= 3 ? 12 : d.tier >= 1 ? 8 : 6
    const spotArc = Math.PI / spots / 1.9
    let wedges = ''
    for (let i = 0; i < spots; i++) {
        const mid = (i / spots) * Math.PI * 2 - Math.PI / 2
        const a0 = mid - spotArc
        const a1 = mid + spotArc
        wedges += `M 0,0 L ${n(Math.cos(a0) * r)},${n(Math.sin(a0) * r)} A ${r} ${r} 0 0 1 ${n(Math.cos(a1) * r)},${n(Math.sin(a1) * r)} Z `
    }
    s += `<path d="${wedges}" fill="${hex(d.edge)}"/>`
    s += `<circle cx="0" cy="0" r="${n(r * 0.79)}" fill="${hex(d.base)}"/>`

    s += `<circle cx="0" cy="0" r="${n(r * 0.74)}" fill="${hex(shade(d.base, 0.1))}" stroke="${hex(d.accent)}" stroke-opacity="0.85" stroke-width="2"/>`
    s += `<circle cx="0" cy="0" r="${n(r * 0.6)}" fill="none" stroke="${hex(d.edge)}" stroke-opacity="0.6" stroke-width="1.2"/>`

    if (d.tier >= 2) {
        let ticks = ''
        for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2
            ticks += `M ${n(Math.cos(a) * r * 0.64)},${n(Math.sin(a) * r * 0.64)} L ${n(Math.cos(a) * r * 0.7)},${n(Math.sin(a) * r * 0.7)} `
        }
        s += `<path d="${ticks}" stroke="${hex(d.accent)}" stroke-opacity="0.5" stroke-width="1.2" fill="none"/>`
    }
    if (d.tier >= 3) {
        // Metallic sweep across the top-left, the way a polished plaque catches light.
        const rr = r * 0.74
        const a0 = Math.PI * 1.08
        const a1 = Math.PI * 1.62
        s += `<path d="M ${n(-r * 0.72)},${n(-r * 0.2)} L ${n(Math.cos(a0) * rr)},${n(Math.sin(a0) * rr)} A ${n(rr)} ${n(rr)} 0 0 1 ${n(Math.cos(a1) * rr)},${n(Math.sin(a1) * rr)} L ${n(r * 0.1)},${n(-r * 0.55)} Z" fill="#fff" fill-opacity="0.16"/>`
    }
    if (d.tier >= 4) {
        const bands = [0xf87171, 0xfbbf24, 0x34d399, 0x60a5fa, 0xc084fc, 0xf472b6]
        const rr = r * 0.58
        for (let i = 0; i < bands.length; i++) {
            const a0 = (i / bands.length) * Math.PI * 2
            const a1 = ((i + 1) / bands.length) * Math.PI * 2
            s += `<path d="M 0,0 L ${n(Math.cos(a0) * rr)},${n(Math.sin(a0) * rr)} A ${n(rr)} ${n(rr)} 0 0 1 ${n(Math.cos(a1) * rr)},${n(Math.sin(a1) * rr)} Z" fill="${hex(bands[i]!)}" fill-opacity="0.5"/>`
        }
        s += `<circle cx="0" cy="0" r="${n(r * 0.44)}" fill="${hex(d.base)}" fill-opacity="0.92"/>`
    }

    s += `<text x="0" y="${d.label.length > 3 ? 6 : 7.5}" font-family='${UI_FONT}' font-size="${d.label.length > 3 ? 17 : 21}" font-weight="800" fill="${hex(d.text)}" text-anchor="middle" letter-spacing="-0.4">${d.label}</text>`
    s += '</svg>'
    return s
}

export interface ChipStackOptions {
    /** Pixel size of each chip. Defaults to 56 — the bet-spot size, deliberately larger than the old table's 46. */
    size?: number
    /** Cap on how many chips render before the rest are implied. */
    max?: number
}

/**
 * A bet spot's chip pile — chips offset upward as the felt draws them.
 * Port of art.ts/scene.ts chip stacking, sized for a DOM bet spot rather than
 * a Pixi sprite stack.
 */
export function chipStack(amount: number, options: ChipStackOptions = {}): string {
    const size = options.size ?? 56
    const stack = chipsFor(amount, options.max ?? 8)
    const lift = size * 0.152
    const height = size + lift * Math.max(0, stack.length - 1)
    let s = `<div class="lt-stack" style="width:${size}px;height:${n(height)}px">`
    stack.forEach((c, i) => {
        s += `<span style="position:absolute;left:0;bottom:${n(i * lift)}px;width:${size}px;height:${size}px;z-index:${i}">${chip(c.value)}</span>`
    })
    s += '</div>'
    return s
}

/**
 * Stable colour per player name, so the same person reads the same in the feed,
 * on their chips and on their nameplate across every table. Hue-only so every
 * name stays legible on the dark rail.
 */
export function nameColor(name: string): string {
    let hash = 0
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
    return `hsl(${Math.abs(hash) % 360} 70% 68%)`
}
