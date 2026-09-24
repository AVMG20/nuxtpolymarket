/**
 * Procedural art for Gold Miner. Every model is painted here with Canvas2D —
 * gradients, rim light, soft ambient occlusion and a warm cartoon outline — and
 * uploaded once as a texture. Nothing is loaded from disk.
 */
import { Assets, CanvasSource, Texture } from 'pixi.js'
import { GM_GROUND_Y, GM_H, GM_ITEMS, GM_W, type GmKind } from '#shared/utils/gamelogic/gold-miner'

type Ctx = CanvasRenderingContext2D

export const FONT = '"Lilita One", "Arial Black", sans-serif'
const RES = 2

/** How far the backdrop reaches past the 1280×720 world on each side, so wide and tall screens never see an edge. */
export const BLEED_X = 420
export const BLEED_TOP = 320
export const BLEED_BOTTOM = 420

function canvas(w: number, h: number, res: number) {
    const cv = document.createElement('canvas')
    cv.width = Math.ceil(w * res)
    cv.height = Math.ceil(h * res)
    const c = cv.getContext('2d')!
    c.scale(res, res)
    c.lineJoin = 'round'
    c.lineCap = 'round'
    return { cv, c }
}

function paint(w: number, h: number, draw: (c: Ctx) => void, res = RES): Texture {
    const { cv, c } = canvas(w, h, res)
    draw(c)
    return new Texture({ source: new CanvasSource({ resource: cv, resolution: res }) })
}

/** Paints to a data URL, for portraits the Vue overlays show as <img>. */
export function paintUrl(w: number, h: number, draw: (c: Ctx) => void, res = 2): string {
    const { cv, c } = canvas(w, h, res)
    draw(c)
    return cv.toDataURL('image/png')
}

function lin(c: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
    const g = c.createLinearGradient(x0, y0, x1, y1)
    for (const [o, col] of stops) g.addColorStop(o, col)
    return g
}

function rad(c: Ctx, x: number, y: number, r0: number, r1: number, stops: [number, string][], x1 = x, y1 = y) {
    const g = c.createRadialGradient(x, y, r0, x1, y1, r1)
    for (const [o, col] of stops) g.addColorStop(o, col)
    return g
}

function rrect(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
    c.beginPath()
    c.moveTo(x + r, y)
    c.arcTo(x + w, y, x + w, y + h, r)
    c.arcTo(x + w, y + h, x, y + h, r)
    c.arcTo(x, y + h, x, y, r)
    c.arcTo(x, y, x + w, y, r)
    c.closePath()
}

/** Tiny deterministic PRNG so the art is identical on every load. */
function prng(seed: number) {
    let s = seed >>> 0
    return () => {
        s = (s + 0x6d2b79f5) >>> 0
        let t = s
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** A lumpy closed blob around (cx, cy), smoothed through midpoints. */
function blob(c: Ctx, cx: number, cy: number, rx: number, ry: number, rnd: () => number, n = 11, jag = 0.22) {
    const pts: [number, number][] = []
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.3
        const k = 1 - jag + rnd() * jag
        pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k])
    }
    c.beginPath()
    const mid = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const
    const m0 = mid(pts[n - 1]!, pts[0]!)
    c.moveTo(m0[0], m0[1])
    for (let i = 0; i < n; i++) {
        const p = pts[i]!
        const m = mid(p, pts[(i + 1) % n]!)
        c.quadraticCurveTo(p[0], p[1], m[0], m[1])
    }
    c.closePath()
    return pts
}

function softShadow(c: Ctx, x: number, y: number, rx: number, ry: number, alpha = 0.35) {
    c.save()
    c.translate(x, y)
    c.scale(1, ry / rx)
    c.fillStyle = rad(c, 0, 0, 0, rx, [[0, `rgba(0,0,0,${alpha})`], [1, 'rgba(0,0,0,0)']])
    c.beginPath()
    c.arc(0, 0, rx, 0, Math.PI * 2)
    c.fill()
    c.restore()
}

// ─── Themes ─────────────────────────────────────────────────────────────────

export interface Theme {
    name: string
    skyTop: string
    skyMid: string
    skyLow: string
    sun: string
    far: string
    near: string
    strata: string[]
    speck: string
    deep: string
    lip: string
    grass: string
}

export const THEMES: Theme[] = [
    {
        name: 'Sunbaked Mesa',
        skyTop: '#2f7fd6', skyMid: '#77c1f4', skyLow: '#ffe3a6', sun: '#fff4c4',
        far: '#c58a63', near: '#a8623c',
        strata: ['#c98c4f', '#b5733b', '#9f5f2f', '#8a4e25', '#733f1d'],
        speck: '#e7b77a', deep: '#3a1c0c', lip: '#7a4a22', grass: '#8fb34a'
    },
    {
        name: 'Red Canyon',
        skyTop: '#ff8a5c', skyMid: '#ffb877', skyLow: '#ffe2b0', sun: '#fff0c8',
        far: '#b2553d', near: '#8e3a2a',
        strata: ['#c8674a', '#b3553b', '#9d4630', '#853826', '#6c2b1d'],
        speck: '#eea07f', deep: '#2c0f0a', lip: '#6a2a1a', grass: '#a4a64a'
    },
    {
        name: 'Slate Hollow',
        skyTop: '#1c3a66', skyMid: '#4f7fb8', skyLow: '#b9d4ee', sun: '#f2f7ff',
        far: '#5e6f86', near: '#43516a',
        strata: ['#7b7e86', '#686b75', '#575a65', '#474a55', '#383a45'],
        speck: '#a9adb8', deep: '#101218', lip: '#3a3d48', grass: '#6c9a5a'
    },
    {
        name: 'Crystal Deep',
        skyTop: '#140b3a', skyMid: '#3b2a7a', skyLow: '#b57ad0', sun: '#ffe9ff',
        far: '#4b3a7e', near: '#35295e',
        strata: ['#6c5a8f', '#5b4a7e', '#4b3c6c', '#3d305b', '#2f244a'],
        speck: '#b79ce0', deep: '#0b0616', lip: '#2e2450', grass: '#6aa08a'
    }
]

// ─── Backdrop ───────────────────────────────────────────────────────────────

const BG_RES = 1.25

/** Sky, sun, clouds and distant mesas: world y from -BLEED_TOP down to the dirt. */
export function paintSky(t: Theme, seed: number): Texture {
    const w = GM_W + BLEED_X * 2
    const h = BLEED_TOP + GM_GROUND_Y + 30
    return paint(w, h, (c) => {
        const oy = BLEED_TOP
        c.fillStyle = lin(c, 0, 0, 0, h, [[0, t.skyTop], [0.55, t.skyMid], [0.9, t.skyLow], [1, t.skyLow]])
        c.fillRect(0, 0, w, h)
        const rnd = prng(seed)
        // Sun with a soft bloom.
        const sx = BLEED_X + 250
        const sy = oy + 40
        c.fillStyle = rad(c, sx, sy, 0, 260, [[0, t.sun], [0.12, t.sun + 'cc'], [0.35, t.sun + '33'], [1, t.sun + '00']])
        c.fillRect(sx - 260, sy - 260, 520, 520)
        c.fillStyle = t.sun
        c.beginPath()
        c.arc(sx, sy, 30, 0, Math.PI * 2)
        c.fill()
        // Stars for the night theme.
        if (t.name === 'Crystal Deep') {
            for (let i = 0; i < 180; i++) {
                c.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.7})`
                const r = rnd() * 1.4 + 0.3
                c.beginPath()
                c.arc(rnd() * w, rnd() * (oy + 110), r, 0, Math.PI * 2)
                c.fill()
            }
        }
        // Clouds: stacked soft puffs with a lit top and shaded belly.
        for (let i = 0; i < 9; i++) {
            const cx = rnd() * w
            const cy = oy - 40 + rnd() * 110
            const s = 0.6 + rnd() * 0.9
            for (let k = 0; k < 7; k++) {
                const px = cx + (k - 3) * 26 * s + (rnd() - 0.5) * 14
                const py = cy + (rnd() - 0.5) * 12 * s - Math.abs(k - 3) * -3
                const pr = (26 - Math.abs(k - 3) * 4) * s
                c.fillStyle = rad(c, px - pr * 0.3, py - pr * 0.5, 0, pr * 1.2, [[0, 'rgba(255,255,255,0.95)'], [0.7, 'rgba(255,255,255,0.75)'], [1, 'rgba(230,238,255,0)']])
                c.beginPath()
                c.arc(px, py, pr * 1.2, 0, Math.PI * 2)
                c.fill()
            }
        }
        // Two ranges of mesas with haze between them.
        const range = (base: number, amp: number, col: string, step: number) => {
            c.fillStyle = col
            c.beginPath()
            c.moveTo(0, h)
            let x = 0
            let y = base
            while (x <= w + step) {
                c.lineTo(x, y)
                const flat = rnd() < 0.45
                x += step * (0.4 + rnd())
                if (!flat) y = base - rnd() * amp
                c.lineTo(x, y)
            }
            c.lineTo(w, h)
            c.closePath()
            c.fill()
        }
        range(oy + GM_GROUND_Y - 38, 58, t.far, 70)
        c.fillStyle = lin(c, 0, oy + 60, 0, h, [[0, 'rgba(255,255,255,0)'], [1, t.skyLow + '66']])
        c.fillRect(0, oy + 60, w, h)
        range(oy + GM_GROUND_Y - 6, 34, t.near, 46)
        // Heat haze where the mesas meet the dirt.
        c.fillStyle = lin(c, 0, h - 40, 0, h, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.25)']])
        c.fillRect(0, h - 40, w, 40)
    }, BG_RES)
}

/** The dirt the claw digs through: strata, pebbles, roots, fossils and a darkening depth. */
export function paintGround(t: Theme, seed: number): Texture {
    const w = GM_W + BLEED_X * 2
    const top = GM_GROUND_Y - 6
    const h = GM_H - top + BLEED_BOTTOM
    return paint(w, h, (c) => {
        const rnd = prng(seed * 31 + 7)
        // Strata: wavy bands, each a gradient.
        const bands = t.strata.length
        let y0 = 0
        for (let b = 0; b < bands; b++) {
            const bandH = b === bands - 1 ? h - y0 : 70 + rnd() * 70 + b * 18
            const col = t.strata[b]!
            c.fillStyle = col
            c.beginPath()
            c.moveTo(0, h)
            c.lineTo(0, y0)
            for (let x = 0; x <= w; x += 40) c.lineTo(x, y0 + Math.sin(x * 0.006 + b * 2.1) * 10 + (rnd() - 0.5) * 6)
            c.lineTo(w, h)
            c.closePath()
            c.fill()
            y0 += bandH
        }
        // Mottled noise so no band reads as flat colour.
        for (let i = 0; i < 2600; i++) {
            const x = rnd() * w
            const y = rnd() * h
            const r = 2 + rnd() * 10
            c.fillStyle = rnd() < 0.5 ? `rgba(255,235,200,${0.015 + rnd() * 0.03})` : `rgba(20,8,0,${0.02 + rnd() * 0.04})`
            c.beginPath()
            // Flattened along the strata, like settled sediment.
            c.ellipse(x, y, r * 2.4, r * 0.8, (rnd() - 0.5) * 0.3, 0, Math.PI * 2)
            c.fill()
        }
        // Pebbles with a lit top and a contact shadow.
        for (let i = 0; i < 520; i++) {
            const x = rnd() * w
            const y = 20 + rnd() * (h - 20)
            const r = 1.5 + rnd() * rnd() * 7
            c.fillStyle = 'rgba(0,0,0,0.25)'
            c.beginPath()
            c.ellipse(x + 1, y + r * 0.6, r, r * 0.6, 0, 0, Math.PI * 2)
            c.fill()
            c.fillStyle = rad(c, x - r * 0.4, y - r * 0.4, 0, r * 1.3, [[0, t.speck], [1, t.strata[3]!]])
            c.beginPath()
            c.ellipse(x, y, r, r * 0.8, rnd(), 0, Math.PI * 2)
            c.fill()
        }
        // Roots hanging from the surface.
        c.strokeStyle = 'rgba(60,32,14,0.55)'
        for (let i = 0; i < 26; i++) {
            let x = rnd() * w
            let y = 8
            let a = Math.PI / 2 + (rnd() - 0.5) * 0.6
            const len = 30 + rnd() * 70
            c.lineWidth = 2.5
            c.beginPath()
            c.moveTo(x, y)
            for (let s = 0; s < len; s += 6) {
                a += (rnd() - 0.5) * 0.5
                x += Math.cos(a) * 6
                y += Math.sin(a) * 6
                c.lineWidth = Math.max(0.6, 2.5 * (1 - s / len))
                c.lineTo(x, y)
            }
            c.stroke()
        }
        // Fossils and old bones deep down, very faint.
        for (let i = 0; i < 10; i++) {
            const x = rnd() * w
            const y = 240 + rnd() * (h - 300)
            c.save()
            c.translate(x, y)
            c.rotate(rnd() * Math.PI)
            // An ammonite: a tightening spiral with ribs.
            const size = 14 + rnd() * 12
            c.strokeStyle = 'rgba(255,240,210,0.12)'
            c.lineWidth = 2.5
            c.beginPath()
            for (let a = 0; a < Math.PI * 5; a += 0.15) {
                const rr = size * Math.exp(-0.18 * a)
                c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
            }
            c.stroke()
            c.lineWidth = 1.2
            for (let a = 0; a < Math.PI * 3; a += 0.45) {
                const r0 = size * Math.exp(-0.18 * a)
                const r1 = size * Math.exp(-0.18 * (a + Math.PI * 2))
                c.beginPath()
                c.moveTo(Math.cos(a) * r0, Math.sin(a) * r0)
                c.lineTo(Math.cos(a) * r1, Math.sin(a) * r1)
                c.stroke()
            }
            c.restore()
        }
        // Crystals glitter in the deep themes.
        if (t.name === 'Crystal Deep' || t.name === 'Slate Hollow') {
            for (let i = 0; i < 40; i++) {
                const x = rnd() * w
                const y = 120 + rnd() * (h - 140)
                const s = 3 + rnd() * 6
                c.fillStyle = t.name === 'Crystal Deep' ? `rgba(200,160,255,${0.25 + rnd() * 0.3})` : `rgba(180,220,255,${0.15 + rnd() * 0.2})`
                c.beginPath()
                c.moveTo(x, y - s * 2)
                c.lineTo(x + s, y)
                c.lineTo(x, y + s * 0.6)
                c.lineTo(x - s, y)
                c.closePath()
                c.fill()
            }
        }
        // Darken with depth, and vignette the far edges.
        c.fillStyle = lin(c, 0, 0, 0, h, [[0, 'rgba(0,0,0,0)'], [0.45, 'rgba(0,0,0,0.12)'], [1, t.deep + 'ee']])
        c.fillRect(0, 0, w, h)
        c.fillStyle = lin(c, 0, 0, w, 0, [[0, t.deep + 'cc'], [0.16, 'rgba(0,0,0,0)'], [0.84, 'rgba(0,0,0,0)'], [1, t.deep + 'cc']])
        c.fillRect(0, 0, w, h)
        // The lip: a band of topsoil with grass tufts and a hard shadow under it.
        c.fillStyle = lin(c, 0, 0, 0, 26, [[0, t.lip], [1, 'rgba(0,0,0,0)']])
        c.fillRect(0, 0, w, 26)
        c.fillStyle = t.lip
        c.fillRect(0, 0, w, 8)
        for (let x = 0; x < w; x += 5) {
            const gh = 3 + rnd() * 9
            c.strokeStyle = rnd() < 0.5 ? t.grass : shade(t.grass, -30)
            c.lineWidth = 2
            c.beginPath()
            c.moveTo(x, 6)
            c.quadraticCurveTo(x + (rnd() - 0.5) * 6, 6 - gh * 0.6, x + (rnd() - 0.5) * 8, 6 - gh)
            c.stroke()
        }
    }, BG_RES)
}

function shade(hex: string, amt: number): string {
    const n = parseInt(hex.slice(1), 16)
    const r = Math.max(0, Math.min(255, (n >> 16) + amt))
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt))
    const b = Math.max(0, Math.min(255, (n & 255) + amt))
    return `rgb(${r},${g},${b})`
}

// ─── Surface set dressing ───────────────────────────────────────────────────

export const WINCH = { w: 150, h: 120, drumX: 75, drumY: 74, drumR: 24 }

/** A-frame and axle; the drum and crank are separate so they can turn. */
function paintWinchFrame(): Texture {
    return paint(WINCH.w, WINCH.h, (c) => {
        const beam = (x0: number, y0: number, x1: number, y1: number, wd: number) => {
            c.save()
            c.strokeStyle = '#3d2410'
            c.lineWidth = wd + 3
            c.beginPath()
            c.moveTo(x0, y0)
            c.lineTo(x1, y1)
            c.stroke()
            c.strokeStyle = lin(c, x0 - wd, y0, x0 + wd, y0, [[0, '#6b3f1c'], [0.45, '#b77b43'], [1, '#6b3f1c']])
            c.lineWidth = wd
            c.stroke()
            c.restore()
        }
        const { drumX: dx, drumY: dy } = WINCH
        beam(18, WINCH.h - 4, dx - 6, 14, 12)
        beam(WINCH.w - 18, WINCH.h - 4, dx + 6, 14, 12)
        beam(30, WINCH.h - 30, WINCH.w - 30, WINCH.h - 30, 8)
        // Top pulley block.
        c.fillStyle = lin(c, 0, 4, 0, 26, [[0, '#8a8f98'], [1, '#3a3e46']])
        rrect(c, dx - 14, 6, 28, 18, 5)
        c.fill()
        c.strokeStyle = '#1f2228'
        c.lineWidth = 2
        c.stroke()
        // Axle bearings either side of the drum.
        for (const x of [dx - 34, dx + 34]) {
            c.fillStyle = rad(c, x - 2, dy - 3, 0, 10, [[0, '#d6dae0'], [0.6, '#7d838d'], [1, '#353941']])
            c.beginPath()
            c.arc(x, dy, 9, 0, Math.PI * 2)
            c.fill()
            c.strokeStyle = '#1f2228'
            c.stroke()
        }
    })
}

/** The rope drum, drawn face-on with iron bands: rotated by the scene as rope pays out. */
function paintDrum(): Texture {
    const r = WINCH.drumR
    return paint(r * 2 + 8, r * 2 + 8, (c) => {
        const o = r + 4
        c.fillStyle = rad(c, o - 6, o - 8, 0, r + 4, [[0, '#d99c5c'], [0.7, '#8a5328'], [1, '#4a2a10']])
        c.beginPath()
        c.arc(o, o, r, 0, Math.PI * 2)
        c.fill()
        // Coiled rope rings.
        c.strokeStyle = 'rgba(210,180,120,0.9)'
        c.lineWidth = 2
        for (let k = 0; k < 3; k++) {
            c.beginPath()
            c.arc(o, o, r - 5 - k * 5, 0, Math.PI * 2)
            c.stroke()
        }
        // Spokes, so the turning reads.
        c.strokeStyle = '#3a2008'
        c.lineWidth = 4
        for (let k = 0; k < 4; k++) {
            const a = (k / 4) * Math.PI * 2
            c.beginPath()
            c.moveTo(o, o)
            c.lineTo(o + Math.cos(a) * (r - 2), o + Math.sin(a) * (r - 2))
            c.stroke()
        }
        c.fillStyle = rad(c, o - 2, o - 2, 0, 8, [[0, '#f0f2f5'], [1, '#50555e']])
        c.beginPath()
        c.arc(o, o, 6, 0, Math.PI * 2)
        c.fill()
        c.strokeStyle = '#2a1606'
        c.lineWidth = 2.5
        c.beginPath()
        c.arc(o, o, r, 0, Math.PI * 2)
        c.stroke()
    }, 3)
}

/** Mine cart on a stub of rail, heaped with gold. Anchor bottom-centre. */
function paintCart(): Texture {
    return paint(150, 100, (c) => {
        const rnd = prng(19)
        // Rails.
        c.fillStyle = '#4a3020'
        for (let x = 4; x < 146; x += 18) c.fillRect(x, 88, 10, 8)
        c.fillStyle = lin(c, 0, 84, 0, 90, [[0, '#c7ccd4'], [1, '#5a5f68']])
        c.fillRect(0, 84, 150, 5)
        // Gold heap.
        for (let i = 0; i < 16; i++) {
            const x = 40 + rnd() * 70
            const y = 30 + rnd() * 16 - Math.sin(((x - 40) / 70) * Math.PI) * 14
            const r = 7 + rnd() * 7
            goldBlobAt(c, x, y, r, r * 0.85, rnd)
        }
        // Tub.
        c.fillStyle = lin(c, 0, 36, 0, 78, [[0, '#8a5a34'], [0.5, '#6b4226'], [1, '#3e2412']])
        c.beginPath()
        c.moveTo(22, 38)
        c.lineTo(128, 38)
        c.lineTo(118, 78)
        c.lineTo(32, 78)
        c.closePath()
        c.fill()
        c.strokeStyle = '#2a1608'
        c.lineWidth = 2.5
        c.stroke()
        c.fillStyle = lin(c, 0, 36, 0, 46, [[0, '#d5d9df'], [1, '#6b7079']])
        rrect(c, 18, 34, 114, 9, 3)
        c.fill()
        c.stroke()
        for (const x of [40, 110]) {
            c.fillStyle = rad(c, x - 2, 80, 0, 11, [[0, '#9aa0a8'], [0.6, '#4a4f58'], [1, '#22252b']])
            c.beginPath()
            c.arc(x, 80, 10, 0, Math.PI * 2)
            c.fill()
            c.stroke()
            c.fillStyle = '#c8ccd2'
            c.beginPath()
            c.arc(x, 80, 3, 0, Math.PI * 2)
            c.fill()
        }
    })
}

/** Lantern on a post. Anchor bottom-centre; the flame glow is a separate additive sprite. */
function paintLanternPost(): Texture {
    return paint(40, 120, (c) => {
        c.fillStyle = lin(c, 16, 0, 24, 0, [[0, '#4a2a12'], [0.5, '#8a5a30'], [1, '#3a200c']])
        c.fillRect(17, 20, 6, 100)
        c.fillStyle = '#4a2a12'
        c.fillRect(10, 18, 20, 4)
        c.strokeStyle = '#2a1a0a'
        c.lineWidth = 2
        c.beginPath()
        c.moveTo(12, 22)
        c.lineTo(12, 30)
        c.stroke()
        // Lantern cage.
        c.fillStyle = rad(c, 12, 40, 0, 12, [[0, '#fffbe0'], [0.5, '#ffc84a'], [1, '#c87010']])
        rrect(c, 4, 30, 16, 20, 4)
        c.fill()
        c.strokeStyle = '#2a1a0a'
        c.stroke()
        c.beginPath()
        c.moveTo(12, 30)
        c.lineTo(12, 50)
        c.stroke()
        c.fillStyle = '#2a1a0a'
        c.fillRect(3, 28, 18, 3)
        c.fillRect(3, 49, 18, 3)
    })
}

/** A cactus for the desert themes. Anchor bottom-centre. */
function paintCactus(): Texture {
    return paint(70, 110, (c) => {
        const body = lin(c, 0, 0, 70, 0, [[0, '#2f6b33'], [0.45, '#5fae4c'], [1, '#27572a']])
        c.fillStyle = body
        c.strokeStyle = '#173a1a'
        c.lineWidth = 2.5
        const arm = (x: number, y: number, w: number, h: number, bend: number) => {
            c.beginPath()
            c.moveTo(x, y)
            c.lineTo(x + bend, y)
            c.lineTo(x + bend, y - h)
            c.arc(x + bend + (bend > 0 ? -w / 2 : w / 2), y - h, w / 2, bend > 0 ? 0 : Math.PI, bend > 0 ? Math.PI : 0, bend > 0)
            c.lineTo(x + (bend > 0 ? bend - w : bend + w), y - w)
            c.lineTo(x, y - w)
            c.closePath()
            c.fill()
            c.stroke()
        }
        arm(28, 64, 12, 30, -18)
        arm(42, 52, 12, 26, 18)
        rrect(c, 24, 8, 22, 104, 11)
        c.fill()
        c.stroke()
        c.strokeStyle = 'rgba(20,60,20,0.5)'
        c.lineWidth = 1.5
        for (const x of [31, 39]) {
            c.beginPath()
            c.moveTo(x, 14)
            c.lineTo(x, 108)
            c.stroke()
        }
        c.fillStyle = '#ff7aa8'
        c.beginPath()
        c.arc(35, 9, 4, 0, Math.PI * 2)
        c.fill()
    })
}

// ─── Miner ──────────────────────────────────────────────────────────────────

export const MINER = { w: 110, h: 140 }
/** Where the shoulder sits on the body texture, and the head's neck point. */
export const MINER_SHOULDER = { x: 36, y: 66 }
export const MINER_NECK = { x: 52, y: 50 }

/** Torso, legs and boots, facing left toward the winch. Anchor bottom-centre. */
function paintMinerBody(): Texture {
    return paint(MINER.w, MINER.h, (c) => {
        const OUT = '#2a150a'
        c.lineWidth = 2.5
        c.strokeStyle = OUT
        // Boots.
        for (const [x, s] of [[34, 1], [66, 1]] as const) {
            c.fillStyle = lin(c, 0, 118, 0, 138, [[0, '#6b3a1a'], [1, '#2a140a']])
            c.beginPath()
            c.moveTo(x - 12 * s, 138)
            c.lineTo(x - 14, 124)
            c.lineTo(x + 8, 122)
            c.lineTo(x + 10, 138)
            c.closePath()
            c.fill()
            c.stroke()
        }
        // Legs (denim).
        c.fillStyle = lin(c, 26, 0, 80, 0, [[0, '#1f3f7a'], [0.5, '#3a68b0'], [1, '#1c3566']])
        c.beginPath()
        c.moveTo(24, 92)
        c.lineTo(26, 124)
        c.lineTo(46, 124)
        c.lineTo(52, 104)
        c.lineTo(58, 124)
        c.lineTo(78, 124)
        c.lineTo(78, 92)
        c.closePath()
        c.fill()
        c.stroke()
        // Belly + plaid shirt.
        c.fillStyle = lin(c, 20, 0, 90, 0, [[0, '#8a1f1a'], [0.45, '#d83a2c'], [1, '#7a1a14']])
        c.beginPath()
        c.ellipse(52, 78, 32, 30, 0, 0, Math.PI * 2)
        c.fill()
        c.save()
        c.clip()
        c.strokeStyle = 'rgba(40,0,0,0.35)'
        c.lineWidth = 3
        for (let x = 16; x < 92; x += 11) {
            c.beginPath()
            c.moveTo(x, 44)
            c.lineTo(x, 112)
            c.stroke()
        }
        for (let y = 50; y < 112; y += 11) {
            c.beginPath()
            c.moveTo(16, y)
            c.lineTo(92, y)
            c.stroke()
        }
        c.restore()
        c.strokeStyle = OUT
        c.lineWidth = 2.5
        c.beginPath()
        c.ellipse(52, 78, 32, 30, 0, 0, Math.PI * 2)
        c.stroke()
        // Overall bib and straps.
        c.fillStyle = lin(c, 30, 0, 76, 0, [[0, '#244a8a'], [0.5, '#3f73bf'], [1, '#203f78']])
        rrect(c, 34, 72, 36, 32, 6)
        c.fill()
        c.stroke()
        c.strokeStyle = '#244a8a'
        c.lineWidth = 6
        c.beginPath()
        c.moveTo(37, 74)
        c.lineTo(40, 52)
        c.moveTo(67, 74)
        c.lineTo(64, 52)
        c.stroke()
        c.fillStyle = '#f2c14a'
        for (const x of [38, 66]) {
            c.beginPath()
            c.arc(x, 76, 3, 0, Math.PI * 2)
            c.fill()
        }
        // Belt.
        c.fillStyle = '#3a2210'
        c.fillRect(22, 96, 58, 7)
        c.fillStyle = '#e8b83a'
        c.fillRect(46, 95, 10, 9)
        // Rim light down the right side.
        c.strokeStyle = 'rgba(255,220,170,0.45)'
        c.lineWidth = 3
        c.beginPath()
        c.arc(52, 78, 29, -0.9, 0.6)
        c.stroke()
    })
}

// ─── Photo head ─────────────────────────────────────────────────────────────
//
// The miner's head is a cut-out photo (public/gold-miner/head-*.png) split at
// the lips: the top of the head, a jaw that drops to talk, and the mouth
// interior that shows through the gap. Everything below is in that photo's
// pixel space, so the hat and kerchief line up whatever the head is scaled to.

export const PHOTO = {
    w: 288,
    h: 412,
    /** Where the neck tucks into the kerchief (the photo's neck runs a little past it). */
    neck: { x: 158, y: 368 },
    /** Middle of the lips. */
    mouth: { x: 156, y: 307 },
    /** How far the jaw drops at full open. */
    jawOpen: 15,
    /** Crown of the head, where the hard hat sits. */
    crown: { x: 146, y: 70 }
}

export const PHOTO_URLS = {
    top: '/gold-miner/head-top.png',
    jaw: '/gold-miner/head-jaw.png',
    mouth: '/gold-miner/head-mouth.png'
}

/** Yellow hard hat with a lamp, sized for the photo head. Anchor at the brim's bottom-centre. */
function paintHardHat(): Texture {
    return paint(300, 170, (c) => {
        const OUT = '#2a150a'
        c.lineWidth = 7
        c.strokeStyle = OUT
        // Dome.
        c.fillStyle = lin(c, 0, 10, 0, 140, [[0, '#fff3a0'], [0.35, '#ffd23a'], [0.75, '#e79a0c'], [1, '#a86204']])
        c.beginPath()
        c.moveTo(34, 140)
        c.bezierCurveTo(30, 40, 90, 12, 150, 12)
        c.bezierCurveTo(210, 12, 270, 40, 266, 140)
        c.closePath()
        c.fill()
        c.stroke()
        // Ridge down the middle.
        c.fillStyle = lin(c, 132, 0, 168, 0, [[0, '#e8a412'], [0.5, '#fff0a0'], [1, '#d08a0c']])
        c.beginPath()
        c.moveTo(134, 140)
        c.quadraticCurveTo(128, 30, 150, 14)
        c.quadraticCurveTo(172, 30, 166, 140)
        c.closePath()
        c.fill()
        c.lineWidth = 4
        c.stroke()
        // Brim.
        c.lineWidth = 7
        c.fillStyle = lin(c, 0, 128, 0, 162, [[0, '#ffd23a'], [1, '#9a5a04']])
        c.beginPath()
        c.ellipse(150, 142, 146, 20, 0, 0, Math.PI * 2)
        c.fill()
        c.stroke()
        // Specular.
        c.strokeStyle = 'rgba(255,255,255,0.75)'
        c.lineWidth = 9
        c.beginPath()
        c.arc(150, 150, 108, Math.PI * 1.18, Math.PI * 1.42)
        c.stroke()
        // Lamp.
        c.strokeStyle = OUT
        c.lineWidth = 6
        c.fillStyle = lin(c, 0, 60, 0, 120, [[0, '#e6eaef'], [1, '#6a707a']])
        rrect(c, 116, 62, 68, 56, 14)
        c.fill()
        c.stroke()
        c.fillStyle = rad(c, 150, 90, 0, 24, [[0, '#ffffff'], [0.45, '#fff3a0'], [1, '#ffb400']])
        c.beginPath()
        c.arc(150, 90, 19, 0, Math.PI * 2)
        c.fill()
        c.lineWidth = 4
        c.stroke()
    }, 1)
}

/** Red kerchief knotted round the neck, hiding the photo's cut. Anchor top-centre. */
function paintKerchief(): Texture {
    return paint(210, 120, (c) => {
        const OUT = '#3a0a06'
        c.lineWidth = 6
        c.strokeStyle = OUT
        c.fillStyle = lin(c, 0, 0, 0, 120, [[0, '#ff5a44'], [0.5, '#d42a1c'], [1, '#8a120a']])
        c.beginPath()
        c.moveTo(12, 14)
        c.quadraticCurveTo(105, 44, 198, 14)
        c.lineTo(190, 40)
        c.quadraticCurveTo(150, 60, 118, 112)
        c.lineTo(96, 112)
        c.quadraticCurveTo(62, 60, 20, 40)
        c.closePath()
        c.fill()
        c.stroke()
        // Polka dots.
        c.fillStyle = 'rgba(255,240,220,0.85)'
        const rnd = prng(8)
        for (let i = 0; i < 26; i++) {
            const x = 28 + rnd() * 154
            const y = 24 + rnd() * 70
            if (y > 40 + (1 - Math.abs(x - 105) / 90) * 70) continue
            c.beginPath()
            c.arc(x, y, 4, 0, Math.PI * 2)
            c.fill()
        }
        // Knot.
        c.fillStyle = '#b01e12'
        c.beginPath()
        c.ellipse(104, 34, 18, 13, 0, 0, Math.PI * 2)
        c.fill()
        c.lineWidth = 5
        c.stroke()
        c.strokeStyle = 'rgba(255,200,180,0.55)'
        c.lineWidth = 5
        c.beginPath()
        c.moveTo(30, 22)
        c.quadraticCurveTo(105, 48, 180, 22)
        c.stroke()
    }, 1)
}

/** Dynamite stick, for the pack by the miner and the thrown one. Anchor centre. */
function paintDynamite(): Texture {
    return paint(18, 44, (c) => {
        c.strokeStyle = '#2a0a06'
        c.lineWidth = 1.8
        c.fillStyle = lin(c, 2, 0, 16, 0, [[0, '#8a140e'], [0.4, '#ff4a3a'], [1, '#7a120a']])
        rrect(c, 3, 10, 12, 32, 3)
        c.fill()
        c.stroke()
        c.fillStyle = '#f4e6c8'
        c.fillRect(3, 22, 12, 6)
        c.strokeStyle = '#3a2a1a'
        c.lineWidth = 1.6
        c.beginPath()
        c.moveTo(9, 10)
        c.quadraticCurveTo(13, 4, 9, 1)
        c.stroke()
    }, 3)
}

// ─── Claw ───────────────────────────────────────────────────────────────────

export const CLAW = { w: 60, h: 50, hubY: 10 }

function paintClawHub(): Texture {
    return paint(28, 26, (c) => {
        c.fillStyle = rad(c, 11, 9, 0, 14, [[0, '#f2f4f7'], [0.5, '#9aa1ab'], [1, '#3e434b']])
        c.strokeStyle = '#1b1d22'
        c.lineWidth = 2
        rrect(c, 4, 3, 20, 20, 7)
        c.fill()
        c.stroke()
        c.fillStyle = '#2b2e35'
        c.beginPath()
        c.arc(14, 13, 3.5, 0, Math.PI * 2)
        c.fill()
    }, 3)
}

/** One jaw; the other is the same sprite mirrored. Pivot at its top. */
function paintClawJaw(): Texture {
    return paint(30, 42, (c) => {
        c.fillStyle = lin(c, 0, 0, 30, 0, [[0, '#5a616c'], [0.35, '#dfe3e8'], [0.6, '#98a0aa'], [1, '#3e434b']])
        c.strokeStyle = '#1b1d22'
        c.lineWidth = 2
        c.beginPath()
        c.moveTo(6, 2)
        c.quadraticCurveTo(-2, 22, 10, 38)
        c.lineTo(18, 40)
        c.lineTo(14, 32)
        c.quadraticCurveTo(8, 20, 14, 6)
        c.closePath()
        c.fill()
        c.stroke()
        c.fillStyle = '#1b1d22'
        c.beginPath()
        c.arc(9, 5, 2.4, 0, Math.PI * 2)
        c.fill()
    }, 3)
}

// ─── Items ──────────────────────────────────────────────────────────────────

function goldBlobAt(c: Ctx, x: number, y: number, rx: number, ry: number, rnd: () => number) {
    const pts = blob(c, x, y, rx, ry, rnd, 10, 0.25)
    c.fillStyle = rad(c, x - rx * 0.35, y - ry * 0.45, rx * 0.05, Math.max(rx, ry) * 1.25, [
        [0, '#fffbe0'], [0.18, '#ffe36a'], [0.5, '#f5b324'], [0.82, '#b86e0c'], [1, '#6e3a04']
    ])
    c.fill()
    c.strokeStyle = '#5a2e02'
    c.lineWidth = Math.max(1.6, rx * 0.07)
    c.stroke()
    return pts
}

function paintGold(kind: 'goldS' | 'goldM' | 'goldL' | 'goldXL', variant: number): Texture {
    const r = GM_ITEMS[kind].r
    const pad = 10
    const size = r * 2 + pad * 2
    return paint(size, size, (c) => {
        const rnd = prng(variant * 97 + r)
        const o = size / 2
        softShadow(c, o + 2, o + r * 0.7, r * 1.05, r * 0.35, 0.4)
        goldBlobAt(c, o, o, r, r * 0.88, rnd)
        // Dents and facets: warm shadows and bright planes.
        c.save()
        blob(c, o, o, r, r * 0.88, prng(variant * 97 + r), 10, 0.25)
        c.clip()
        const dents = 3 + Math.floor(r / 10)
        for (let i = 0; i < dents; i++) {
            const a = rnd() * Math.PI * 2
            const d = rnd() * r * 0.6
            const x = o + Math.cos(a) * d
            const y = o + Math.sin(a) * d
            const dr = r * (0.12 + rnd() * 0.18)
            c.fillStyle = rad(c, x + dr * 0.3, y + dr * 0.3, 0, dr, [[0, 'rgba(120,60,0,0.55)'], [1, 'rgba(120,60,0,0)']])
            c.beginPath()
            c.arc(x, y, dr, 0, Math.PI * 2)
            c.fill()
            c.fillStyle = rad(c, x - dr * 0.5, y - dr * 0.5, 0, dr * 0.6, [[0, 'rgba(255,255,220,0.7)'], [1, 'rgba(255,255,220,0)']])
            c.beginPath()
            c.arc(x - dr * 0.4, y - dr * 0.4, dr * 0.6, 0, Math.PI * 2)
            c.fill()
        }
        // Rim bounce from below.
        c.fillStyle = lin(c, 0, o + r * 0.3, 0, o + r, [[0, 'rgba(255,170,40,0)'], [1, 'rgba(255,200,90,0.45)']])
        c.fillRect(0, o, size, size)
        c.restore()
        // Specular streak and star glint.
        c.fillStyle = 'rgba(255,255,255,0.85)'
        c.beginPath()
        c.ellipse(o - r * 0.38, o - r * 0.42, r * 0.22, r * 0.1, -0.6, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = 'rgba(255,255,255,0.6)'
        c.beginPath()
        c.arc(o - r * 0.12, o - r * 0.58, r * 0.06, 0, Math.PI * 2)
        c.fill()
    }, r < 20 ? 3 : 2)
}

function paintRock(kind: 'rockS' | 'rockL', variant: number): Texture {
    const r = GM_ITEMS[kind].r
    const pad = 10
    const size = r * 2 + pad * 2
    return paint(size, size, (c) => {
        const rnd = prng(variant * 53 + r * 7)
        const o = size / 2
        softShadow(c, o + 2, o + r * 0.7, r * 1.05, r * 0.3, 0.45)
        const shapeSeed = variant * 53 + r * 7 + 1
        blob(c, o, o, r, r * 0.84, prng(shapeSeed), 7, 0.28)
        c.fillStyle = rad(c, o - r * 0.35, o - r * 0.4, r * 0.05, r * 1.3, [[0, '#d7d3cc'], [0.35, '#9c968d'], [0.75, '#645e57'], [1, '#34302c']])
        c.fill()
        c.strokeStyle = '#1f1b18'
        c.lineWidth = 2.2
        c.stroke()
        c.save()
        blob(c, o, o, r, r * 0.84, prng(shapeSeed), 7, 0.28)
        c.clip()
        // Planar facets.
        for (let i = 0; i < 4; i++) {
            c.fillStyle = i % 2 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.14)'
            c.beginPath()
            c.moveTo(o + (rnd() - 0.5) * r * 2, o - r)
            c.lineTo(o + (rnd() - 0.5) * r, o + (rnd() - 0.5) * r)
            c.lineTo(o + (rnd() - 0.5) * r * 2, o + r)
            c.lineTo(o + r * (rnd() < 0.5 ? -1.2 : 1.2), o)
            c.closePath()
            c.fill()
        }
        // Cracks.
        c.strokeStyle = 'rgba(25,20,18,0.6)'
        c.lineWidth = 1.4
        for (let i = 0; i < 2; i++) {
            let x = o + (rnd() - 0.5) * r
            let y = o - r * 0.2 + (rnd() - 0.5) * r * 0.6
            c.beginPath()
            c.moveTo(x, y)
            for (let s = 0; s < 4; s++) {
                x += (rnd() - 0.3) * r * 0.35
                y += (rnd() - 0.5) * r * 0.3
                c.lineTo(x, y)
            }
            c.stroke()
        }
        // Lichen speckles.
        for (let i = 0; i < r; i++) {
            c.fillStyle = rnd() < 0.5 ? 'rgba(160,190,110,0.35)' : 'rgba(230,225,210,0.3)'
            c.beginPath()
            c.arc(o + (rnd() - 0.5) * r * 1.6, o + (rnd() - 0.5) * r * 1.4, 0.8 + rnd() * 1.6, 0, Math.PI * 2)
            c.fill()
        }
        c.restore()
    })
}

function paintDiamond(r = GM_ITEMS.diamond.r): Texture {
    const s = r * 2 + 16
    return paint(s, s, (c) => {
        const o = s / 2
        const w = r * 1.25
        const top = o - r * 0.75
        const girdle = o - r * 0.2
        const tip = o + r * 1.0
        c.lineWidth = 1.6
        c.strokeStyle = '#123a6a'
        // Pavilion (lower) facets.
        const pav: [number, string][] = [[-1, '#3fa9f5'], [-0.5, '#9fe0ff'], [0, '#5cc0ff'], [0.5, '#c9f2ff'], [1, '#2a86d8']]
        for (let i = 0; i < pav.length - 1; i++) {
            c.fillStyle = pav[i]![1]
            c.beginPath()
            c.moveTo(o + pav[i]![0] * w, girdle)
            c.lineTo(o + pav[i + 1]![0] * w, girdle)
            c.lineTo(o, tip)
            c.closePath()
            c.fill()
            c.stroke()
        }
        // Crown facets.
        const crown: [number, number, string][] = [
            [-w, -w * 0.55, '#bdeeff'], [-w * 0.55, 0, '#ffffff'], [0, w * 0.55, '#8fd9ff'], [w * 0.55, w, '#5ab8f0']
        ]
        for (const [x0, x1, col] of crown) {
            c.fillStyle = col
            c.beginPath()
            c.moveTo(o + x0, girdle)
            c.lineTo(o + x0 * 0.62 + (x0 < 0 ? 0 : 0), top)
            c.lineTo(o + x1 * 0.62, top)
            c.lineTo(o + x1, girdle)
            c.closePath()
            c.fill()
            c.stroke()
        }
        c.fillStyle = 'rgba(255,255,255,0.9)'
        c.beginPath()
        c.moveTo(o - w * 0.3, top + 2)
        c.lineTo(o - w * 0.05, top + 2)
        c.lineTo(o - w * 0.25, girdle - 1)
        c.closePath()
        c.fill()
        c.strokeStyle = '#0d2a4e'
        c.lineWidth = 2
        c.beginPath()
        c.moveTo(o - w, girdle)
        c.lineTo(o - w * 0.62, top)
        c.lineTo(o + w * 0.62, top)
        c.lineTo(o + w, girdle)
        c.lineTo(o, tip)
        c.closePath()
        c.stroke()
    }, 4)
}

function paintMole(frame: number, withDiamond: boolean): Texture {
    const w = 70
    const h = 56
    return paint(w, h, (c) => {
        const OUT = '#2a150a'
        softShadow(c, 35, 48, 26, 6, 0.4)
        c.strokeStyle = OUT
        c.lineWidth = 2.2
        // Feet, alternating per frame.
        c.fillStyle = '#e89a86'
        for (const [x, lift] of [[22, frame ? -3 : 0], [46, frame ? 0 : -3]] as const) {
            c.beginPath()
            c.ellipse(x, 47 + lift, 7, 4, 0, 0, Math.PI * 2)
            c.fill()
            c.stroke()
        }
        // Body (facing right; the scene mirrors it).
        c.fillStyle = rad(c, 28, 20, 2, 32, [[0, '#8a6a58'], [0.6, '#5a4032'], [1, '#33231a']])
        c.beginPath()
        c.ellipse(32, 30, 25, 18, 0, 0, Math.PI * 2)
        c.fill()
        c.stroke()
        // Belly.
        c.fillStyle = 'rgba(200,170,150,0.55)'
        c.beginPath()
        c.ellipse(36, 38, 14, 8, 0, 0, Math.PI * 2)
        c.fill()
        // Snout and big pink nose.
        c.fillStyle = '#a07a64'
        c.beginPath()
        c.ellipse(54, 30, 11, 8, 0.1, 0, Math.PI * 2)
        c.fill()
        c.stroke()
        c.fillStyle = rad(c, 63, 27, 0, 6, [[0, '#ffc2d0'], [1, '#e0607a']])
        c.beginPath()
        c.arc(63, 29, 5, 0, Math.PI * 2)
        c.fill()
        c.stroke()
        // Whiskers.
        c.strokeStyle = 'rgba(40,20,10,0.6)'
        c.lineWidth = 1
        for (const d of [-3, 0, 3]) {
            c.beginPath()
            c.moveTo(58, 32)
            c.lineTo(68, 33 + d * 1.6)
            c.stroke()
        }
        // Sunglasses — moles hate the light.
        c.fillStyle = '#111'
        c.strokeStyle = OUT
        c.lineWidth = 1.5
        rrect(c, 40, 19, 9, 7, 2)
        c.fill()
        rrect(c, 50, 19, 9, 7, 2)
        c.fill()
        c.fillRect(48, 21, 3, 1.5)
        c.fillStyle = 'rgba(255,255,255,0.5)'
        c.fillRect(42, 20, 3, 2)
        c.fillRect(52, 20, 3, 2)
        // Front claws, reaching.
        c.fillStyle = '#e89a86'
        c.strokeStyle = OUT
        c.lineWidth = 1.8
        c.beginPath()
        c.ellipse(50, 42 + (frame ? -2 : 1), 6, 4, 0.3, 0, Math.PI * 2)
        c.fill()
        c.stroke()
        if (withDiamond) {
            c.save()
            c.translate(52, 38)
            c.scale(0.6, 0.6)
            const d = paintDiamondInline()
            d(c)
            c.restore()
        }
    }, 3)
}

/** The diamond as a draw call, for compositing into other art. */
function paintDiamondInline() {
    return (c: Ctx) => {
        const r = 12
        const w = r * 1.25
        c.lineWidth = 1.6
        c.strokeStyle = '#123a6a'
        c.fillStyle = '#7fd0ff'
        c.beginPath()
        c.moveTo(-w, -2)
        c.lineTo(-w * 0.62, -r * 0.75)
        c.lineTo(w * 0.62, -r * 0.75)
        c.lineTo(w, -2)
        c.lineTo(0, r)
        c.closePath()
        c.fill()
        c.stroke()
        c.fillStyle = '#e8f9ff'
        c.beginPath()
        c.moveTo(-w * 0.5, -r * 0.7)
        c.lineTo(0, -r * 0.7)
        c.lineTo(-w * 0.2, -2)
        c.closePath()
        c.fill()
    }
}

function paintBag(): Texture {
    const r = GM_ITEMS.bag.r
    const s = r * 2 + 22
    return paint(s, s + 6, (c) => {
        const o = s / 2
        const OUT = '#3a2208'
        softShadow(c, o + 2, o + r * 0.95, r * 1.1, r * 0.3, 0.45)
        c.strokeStyle = OUT
        c.lineWidth = 2.4
        // Sack body.
        c.fillStyle = rad(c, o - r * 0.35, o - r * 0.1, 2, r * 1.5, [[0, '#f1d9a4'], [0.6, '#c89a5a'], [1, '#7a5426']])
        c.beginPath()
        c.moveTo(o - r * 0.35, o - r * 0.55)
        c.bezierCurveTo(o - r * 1.4, o - r * 0.2, o - r * 1.2, o + r * 1.1, o, o + r * 1.05)
        c.bezierCurveTo(o + r * 1.2, o + r * 1.1, o + r * 1.4, o - r * 0.2, o + r * 0.35, o - r * 0.55)
        c.closePath()
        c.fill()
        c.stroke()
        // Burlap weave.
        c.save()
        c.clip()
        c.strokeStyle = 'rgba(90,60,20,0.25)'
        c.lineWidth = 1
        for (let k = -r * 2; k < r * 2; k += 4) {
            c.beginPath()
            c.moveTo(o + k, o - r)
            c.lineTo(o + k + r, o + r * 1.2)
            c.stroke()
        }
        c.restore()
        // Neck and tie.
        c.fillStyle = '#c89a5a'
        c.beginPath()
        c.moveTo(o - r * 0.35, o - r * 0.55)
        c.lineTo(o - r * 0.55, o - r * 1.05)
        c.quadraticCurveTo(o, o - r * 1.25, o + r * 0.55, o - r * 1.05)
        c.lineTo(o + r * 0.35, o - r * 0.55)
        c.closePath()
        c.fill()
        c.stroke()
        c.strokeStyle = '#a0281c'
        c.lineWidth = 3.5
        c.beginPath()
        c.moveTo(o - r * 0.42, o - r * 0.62)
        c.quadraticCurveTo(o, o - r * 0.5, o + r * 0.42, o - r * 0.62)
        c.stroke()
        // Stamped question mark.
        c.fillStyle = '#6a1e10'
        c.font = `${r * 1.1}px ${FONT}`
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        c.fillText('?', o, o + r * 0.3)
    }, 3)
}

function paintBone(): Texture {
    return paint(46, 30, (c) => {
        softShadow(c, 24, 24, 20, 4, 0.35)
        c.fillStyle = lin(c, 0, 6, 0, 22, [[0, '#fffdf4'], [1, '#d6ccb4']])
        c.strokeStyle = '#4a3a22'
        c.lineWidth = 2
        c.beginPath()
        c.arc(8, 10, 5, Math.PI * 0.5, Math.PI * 1.9)
        c.arc(8, 18, 5, Math.PI * 0.1, Math.PI * 1.5)
        c.lineTo(38, 17)
        c.arc(38, 18, 5, Math.PI * 1.5, Math.PI * 0.9)
        c.arc(38, 10, 5, Math.PI * 1.1, Math.PI * 0.5)
        c.closePath()
        c.fill()
        c.stroke()
    }, 3)
}

function paintSkull(): Texture {
    return paint(42, 42, (c) => {
        softShadow(c, 21, 36, 16, 4, 0.35)
        c.fillStyle = rad(c, 16, 14, 1, 20, [[0, '#fffdf4'], [1, '#c9bfa4']])
        c.strokeStyle = '#4a3a22'
        c.lineWidth = 2
        c.beginPath()
        c.arc(21, 18, 14, Math.PI * 0.8, Math.PI * 2.2)
        c.lineTo(29, 34)
        c.lineTo(13, 34)
        c.closePath()
        c.fill()
        c.stroke()
        c.fillStyle = '#2a1e10'
        c.beginPath()
        c.ellipse(15, 20, 4, 5, 0, 0, Math.PI * 2)
        c.ellipse(27, 20, 4, 5, 0, 0, Math.PI * 2)
        c.fill()
        c.beginPath()
        c.moveTo(21, 25)
        c.lineTo(18, 29)
        c.lineTo(24, 29)
        c.closePath()
        c.fill()
        c.strokeStyle = '#4a3a22'
        c.lineWidth = 1.4
        for (const x of [16, 21, 26]) {
            c.beginPath()
            c.moveTo(x, 30)
            c.lineTo(x, 34)
            c.stroke()
        }
    }, 3)
}

function paintTnt(): Texture {
    const r = GM_ITEMS.tnt.r
    const s = r * 2 + 18
    return paint(s, s + 10, (c) => {
        const o = s / 2
        softShadow(c, o + 2, o + r * 0.95, r, r * 0.28, 0.45)
        const OUT = '#2a0806'
        c.strokeStyle = OUT
        c.lineWidth = 2.4
        // Keg.
        c.fillStyle = lin(c, o - r, 0, o + r, 0, [[0, '#6a100a'], [0.35, '#e8392a'], [0.55, '#ff6a50'], [1, '#6a100a']])
        c.beginPath()
        c.moveTo(o - r * 0.8, o - r * 0.9)
        c.quadraticCurveTo(o - r * 1.08, o, o - r * 0.8, o + r * 0.9)
        c.lineTo(o + r * 0.8, o + r * 0.9)
        c.quadraticCurveTo(o + r * 1.08, o, o + r * 0.8, o - r * 0.9)
        c.closePath()
        c.fill()
        c.stroke()
        // Iron hoops.
        for (const y of [o - r * 0.6, o + r * 0.6]) {
            c.fillStyle = lin(c, 0, y - 3, 0, y + 3, [[0, '#c8ccd2'], [1, '#4a4f58']])
            c.fillRect(o - r * 0.95, y - 3, r * 1.9, 6)
            c.strokeRect(o - r * 0.95, y - 3, r * 1.9, 6)
        }
        // Label.
        c.fillStyle = '#f7e7c0'
        rrect(c, o - r * 0.7, o - r * 0.32, r * 1.4, r * 0.64, 3)
        c.fill()
        c.stroke()
        c.fillStyle = '#b01a10'
        c.font = `${r * 0.56}px ${FONT}`
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        c.fillText('TNT', o, o + 1)
        // Fuse.
        c.strokeStyle = '#3a2a1a'
        c.lineWidth = 2.2
        c.beginPath()
        c.moveTo(o, o - r * 0.9)
        c.quadraticCurveTo(o + 8, o - r * 1.3, o + 4, o - r * 1.5)
        c.stroke()
    }, 3)
}

// ─── FX ─────────────────────────────────────────────────────────────────────

function paintGlow(): Texture {
    return paint(128, 128, (c) => {
        c.fillStyle = rad(c, 64, 64, 0, 64, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [0.6, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']])
        c.fillRect(0, 0, 128, 128)
    }, 1)
}

function paintSpark(): Texture {
    return paint(64, 64, (c) => {
        c.fillStyle = rad(c, 32, 32, 0, 32, [[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']])
        c.beginPath()
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2
            const rr = i % 2 ? 6 : 32
            c.lineTo(32 + Math.cos(a) * rr, 32 + Math.sin(a) * rr)
        }
        c.closePath()
        c.fill()
    }, 1)
}

function paintPuff(): Texture {
    return paint(64, 64, (c) => {
        c.fillStyle = rad(c, 28, 26, 2, 32, [[0, 'rgba(255,255,255,0.95)'], [0.6, 'rgba(235,230,220,0.6)'], [1, 'rgba(220,210,200,0)']])
        c.beginPath()
        c.arc(32, 32, 32, 0, Math.PI * 2)
        c.fill()
    }, 1)
}

function paintChunk(): Texture {
    return paint(16, 16, (c) => {
        c.fillStyle = '#ffffff'
        c.beginPath()
        c.moveTo(3, 5)
        c.lineTo(11, 2)
        c.lineTo(14, 10)
        c.lineTo(7, 14)
        c.lineTo(2, 11)
        c.closePath()
        c.fill()
    }, 2)
}

function paintRing(): Texture {
    return paint(128, 128, (c) => {
        c.strokeStyle = 'rgba(255,255,255,1)'
        c.lineWidth = 6
        c.beginPath()
        c.arc(64, 64, 58, 0, Math.PI * 2)
        c.stroke()
        c.strokeStyle = 'rgba(255,255,255,0.35)'
        c.lineWidth = 14
        c.stroke()
    }, 1)
}

/** Timber-framed shaft entrance cut into a mound. Anchor bottom-centre. */
function paintShaft(): Texture {
    return paint(190, 150, (c) => {
        const rnd = prng(41)
        const OUT = '#24140a'
        // Mound of spoil.
        c.fillStyle = lin(c, 0, 20, 0, 150, [[0, '#b0703c'], [1, '#6a3a18']])
        c.beginPath()
        c.moveTo(0, 150)
        c.bezierCurveTo(10, 60, 60, 26, 95, 24)
        c.bezierCurveTo(130, 26, 180, 60, 190, 150)
        c.closePath()
        c.fill()
        for (let i = 0; i < 40; i++) {
            c.fillStyle = `rgba(40,20,5,${0.15 + rnd() * 0.2})`
            c.beginPath()
            c.arc(10 + rnd() * 170, 50 + rnd() * 95, 1.5 + rnd() * 4, 0, Math.PI * 2)
            c.fill()
        }
        // Dark mouth of the shaft with depth.
        c.fillStyle = rad(c, 95, 120, 4, 60, [[0, '#000000'], [0.7, '#140a04'], [1, '#2e1a0a']])
        c.beginPath()
        c.moveTo(56, 150)
        c.lineTo(58, 78)
        c.quadraticCurveTo(95, 60, 132, 78)
        c.lineTo(134, 150)
        c.closePath()
        c.fill()
        // Timbers.
        const beam = (x0: number, y0: number, x1: number, y1: number, w: number) => {
            c.strokeStyle = OUT
            c.lineWidth = w + 4
            c.beginPath()
            c.moveTo(x0, y0)
            c.lineTo(x1, y1)
            c.stroke()
            c.strokeStyle = lin(c, x0 - w, y0, x0 + w, y1, [[0, '#6b3f1c'], [0.5, '#b07a42'], [1, '#6b3f1c']])
            c.lineWidth = w
            c.stroke()
        }
        beam(58, 150, 60, 72, 12)
        beam(132, 150, 130, 72, 12)
        beam(46, 72, 144, 70, 13)
        // Hanging lantern inside and a warning sign.
        c.fillStyle = rad(c, 95, 96, 0, 10, [[0, '#fffbe0'], [0.5, '#ffc84a'], [1, '#c87010']])
        c.beginPath()
        c.arc(95, 96, 6, 0, Math.PI * 2)
        c.fill()
        c.strokeStyle = '#1a0e06'
        c.lineWidth = 1.5
        c.beginPath()
        c.moveTo(95, 76)
        c.lineTo(95, 90)
        c.stroke()
        c.fillStyle = '#f2d98a'
        c.strokeStyle = OUT
        c.lineWidth = 2.5
        rrect(c, 140, 88, 40, 26, 3)
        c.fill()
        c.stroke()
        c.fillStyle = '#8a2010'
        c.font = `11px ${FONT}`
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        c.fillText('GOLD', 160, 97)
        c.fillText('MINE', 160, 107)
        c.strokeStyle = OUT
        c.beginPath()
        c.moveTo(160, 114)
        c.lineTo(160, 142)
        c.stroke()
    })
}

/** Soft god-rays for the sun. */
function paintRays(): Texture {
    return paint(256, 256, (c) => {
        for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2
            c.save()
            c.translate(128, 128)
            c.rotate(a)
            c.fillStyle = lin(c, 0, 0, 128, 0, [[0, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']])
            c.beginPath()
            c.moveTo(0, 0)
            c.lineTo(128, -9 - (i % 3) * 4)
            c.lineTo(128, 9 + (i % 3) * 4)
            c.closePath()
            c.fill()
            c.restore()
        }
    }, 1)
}

/** Screen vignette: transparent middle, `color` corners. */
function paintVignette(color: string): Texture {
    return paint(256, 144, (c) => {
        c.save()
        c.scale(1, 144 / 256)
        c.fillStyle = rad(c, 128, 128, 70, 190, [[0, `rgba(${color},0)`], [0.6, `rgba(${color},0.22)`], [1, `rgba(${color},0.7)`]])
        c.fillRect(0, 0, 256, 256)
        c.restore()
    }, 1)
}

// ─── Portraits for the Vue overlays ─────────────────────────────────────────

/** The shopkeeper: a big-bellied trader behind his counter. */
export function paintShopkeeperUrl(): string {
    return paintUrl(220, 220, (c) => {
        const OUT = '#2a150a'
        c.lineWidth = 3
        c.strokeStyle = OUT
        // Body.
        c.fillStyle = lin(c, 40, 0, 180, 0, [[0, '#2a5a3a'], [0.5, '#3f8a56'], [1, '#234a30']])
        c.beginPath()
        c.ellipse(110, 190, 78, 64, 0, Math.PI, 0)
        c.lineTo(188, 220)
        c.lineTo(32, 220)
        c.closePath()
        c.fill()
        c.stroke()
        c.fillStyle = '#f4ecd8'
        c.beginPath()
        c.moveTo(96, 132)
        c.lineTo(110, 176)
        c.lineTo(124, 132)
        c.closePath()
        c.fill()
        c.stroke()
        c.fillStyle = '#b8272a'
        c.beginPath()
        c.moveTo(104, 136)
        c.lineTo(116, 136)
        c.lineTo(110, 160)
        c.closePath()
        c.fill()
        // Head.
        c.fillStyle = rad(c, 100, 90, 4, 50, [[0, '#ffd8bc'], [0.7, '#f0ae88'], [1, '#c98060']])
        c.beginPath()
        c.ellipse(110, 96, 40, 42, 0, 0, Math.PI * 2)
        c.fill()
        c.stroke()
        // Handlebar moustache.
        c.fillStyle = '#4a2a14'
        c.beginPath()
        c.moveTo(110, 110)
        c.bezierCurveTo(90, 100, 70, 118, 72, 106)
        c.bezierCurveTo(80, 124, 100, 118, 110, 116)
        c.bezierCurveTo(120, 118, 140, 124, 148, 106)
        c.bezierCurveTo(150, 118, 130, 100, 110, 110)
        c.fill()
        // Eyes.
        c.fillStyle = '#1a0e06'
        c.beginPath()
        c.arc(96, 90, 4.5, 0, Math.PI * 2)
        c.arc(124, 90, 4.5, 0, Math.PI * 2)
        c.fill()
        c.strokeStyle = '#4a2a14'
        c.lineWidth = 4
        c.beginPath()
        c.moveTo(86, 80)
        c.lineTo(102, 78)
        c.moveTo(118, 78)
        c.lineTo(134, 80)
        c.stroke()
        // Nose.
        c.fillStyle = '#e59070'
        c.strokeStyle = OUT
        c.lineWidth = 2.5
        c.beginPath()
        c.ellipse(110, 102, 9, 8, 0, 0, Math.PI * 2)
        c.fill()
        c.stroke()
        // Bowler hat.
        c.fillStyle = lin(c, 0, 30, 0, 70, [[0, '#4a3a30'], [1, '#1a120c']])
        c.beginPath()
        c.ellipse(110, 64, 56, 10, 0, 0, Math.PI * 2)
        c.fill()
        c.stroke()
        c.beginPath()
        c.moveTo(78, 64)
        c.quadraticCurveTo(78, 22, 110, 22)
        c.quadraticCurveTo(142, 22, 142, 64)
        c.closePath()
        c.fill()
        c.stroke()
        c.fillStyle = '#b8272a'
        c.fillRect(79, 52, 62, 8)
        c.fillStyle = 'rgba(255,255,255,0.25)'
        c.beginPath()
        c.ellipse(96, 38, 8, 12, -0.4, 0, Math.PI * 2)
        c.fill()
    })
}

/** Big nugget emblem for the title card. */
export function paintEmblemUrl(): string {
    return paintUrl(160, 140, (c) => {
        const rnd = prng(77)
        goldBlobAt(c, 80, 76, 62, 50, rnd)
        c.fillStyle = 'rgba(255,255,255,0.85)'
        c.beginPath()
        c.ellipse(56, 52, 16, 7, -0.6, 0, Math.PI * 2)
        c.fill()
    })
}

// ─── Bundle ─────────────────────────────────────────────────────────────────

export interface Art {
    winchFrame: Texture
    drum: Texture
    cart: Texture
    lantern: Texture
    cactus: Texture
    minerBody: Texture
    hardHat: Texture
    kerchief: Texture
    head: { top: Texture, jaw: Texture, mouth: Texture }
    dynamite: Texture
    clawHub: Texture
    clawJaw: Texture
    items: Record<GmKind, Texture[]>
    moleFrames: Texture[]
    moleDiamondFrames: Texture[]
    glow: Texture
    spark: Texture
    puff: Texture
    chunk: Texture
    ring: Texture
    shaft: Texture
    rays: Texture
    vignette: Texture
    edgeGlow: Texture
}

export async function buildArt(): Promise<Art> {
    // The display font has to be ready before anything paints text into a texture.
    try {
        await Promise.race([document.fonts.load(`40px ${FONT}`), new Promise(r => setTimeout(r, 1500))])
    } catch {
        // fall back to Arial Black
    }
    const variants = (fn: (v: number) => Texture) => [0, 1, 2, 3].map(fn)
    const [top, jaw, mouth] = await Promise.all([PHOTO_URLS.top, PHOTO_URLS.jaw, PHOTO_URLS.mouth].map(url => Assets.load<Texture>(url)))
    const head = { top: top!, jaw: jaw!, mouth: mouth! }
    const moleFrames = [paintMole(0, false), paintMole(1, false)]
    const moleDiamondFrames = [paintMole(0, true), paintMole(1, true)]
    return {
        winchFrame: paintWinchFrame(),
        drum: paintDrum(),
        cart: paintCart(),
        lantern: paintLanternPost(),
        cactus: paintCactus(),
        minerBody: paintMinerBody(),
        hardHat: paintHardHat(),
        kerchief: paintKerchief(),
        head,
        dynamite: paintDynamite(),
        clawHub: paintClawHub(),
        clawJaw: paintClawJaw(),
        items: {
            goldS: variants(v => paintGold('goldS', v)),
            goldM: variants(v => paintGold('goldM', v)),
            goldL: variants(v => paintGold('goldL', v)),
            goldXL: variants(v => paintGold('goldXL', v)),
            rockS: variants(v => paintRock('rockS', v)),
            rockL: variants(v => paintRock('rockL', v)),
            diamond: [paintDiamond()],
            mole: moleFrames,
            moleDiamond: moleDiamondFrames,
            bag: [paintBag()],
            bone: [paintBone()],
            skull: [paintSkull()],
            tnt: [paintTnt()]
        },
        moleFrames,
        moleDiamondFrames,
        glow: paintGlow(),
        spark: paintSpark(),
        puff: paintPuff(),
        chunk: paintChunk(),
        ring: paintRing(),
        shaft: paintShaft(),
        rays: paintRays(),
        vignette: paintVignette('0,0,0'),
        edgeGlow: paintVignette('255,255,255')
    }
}

/** Shop shelf icons, 96×96. */
export function paintShopIconUrl(item: 'dynamite' | 'strength' | 'clover' | 'book' | 'polish'): string {
    return paintUrl(96, 96, (c) => {
        const OUT = '#2a150a'
        c.lineWidth = 3
        c.strokeStyle = OUT
        softShadow(c, 48, 86, 30, 6, 0.35)
        if (item === 'dynamite') {
            for (const [x, rot] of [[34, -0.18], [48, 0], [62, 0.18]] as const) {
                c.save()
                c.translate(x, 54)
                c.rotate(rot)
                c.fillStyle = lin(c, -9, 0, 9, 0, [[0, '#8a140e'], [0.4, '#ff4a3a'], [1, '#7a120a']])
                rrect(c, -9, -28, 18, 56, 4)
                c.fill()
                c.stroke()
                c.fillStyle = '#f4e6c8'
                c.fillRect(-9, -6, 18, 10)
                c.strokeRect(-9, -6, 18, 10)
                c.restore()
            }
            c.strokeStyle = '#3a2a1a'
            c.beginPath()
            c.moveTo(48, 26)
            c.quadraticCurveTo(58, 14, 52, 6)
            c.stroke()
            c.fillStyle = rad(c, 52, 6, 0, 8, [[0, '#fff'], [0.4, '#ffd040'], [1, 'rgba(255,120,0,0)']])
            c.beginPath()
            c.arc(52, 6, 8, 0, Math.PI * 2)
            c.fill()
        } else if (item === 'strength') {
            c.fillStyle = lin(c, 24, 0, 72, 0, [[0, '#1f6a2a'], [0.4, '#6ff27a'], [1, '#1a5a24']])
            c.beginPath()
            c.moveTo(40, 14)
            c.lineTo(56, 14)
            c.lineTo(56, 34)
            c.quadraticCurveTo(76, 44, 74, 64)
            c.quadraticCurveTo(72, 86, 48, 86)
            c.quadraticCurveTo(24, 86, 22, 64)
            c.quadraticCurveTo(20, 44, 40, 34)
            c.closePath()
            c.fill()
            c.stroke()
            c.fillStyle = '#8a5a30'
            rrect(c, 37, 6, 22, 12, 3)
            c.fill()
            c.stroke()
            c.fillStyle = '#f7e7c0'
            rrect(c, 32, 52, 32, 20, 4)
            c.fill()
            c.stroke()
            c.fillStyle = '#b01a10'
            c.font = `16px ${FONT}`
            c.textAlign = 'center'
            c.textBaseline = 'middle'
            c.fillText('XXX', 48, 63)
            c.fillStyle = 'rgba(255,255,255,0.6)'
            c.beginPath()
            c.ellipse(32, 56, 4, 12, 0.3, 0, Math.PI * 2)
            c.fill()
        } else if (item === 'clover') {
            c.strokeStyle = '#1a4a1a'
            c.lineWidth = 5
            c.beginPath()
            c.moveTo(48, 50)
            c.quadraticCurveTo(52, 70, 44, 88)
            c.stroke()
            c.lineWidth = 3
            for (let i = 0; i < 4; i++) {
                c.save()
                c.translate(48, 46)
                c.rotate(i * Math.PI / 2 + Math.PI / 4)
                c.fillStyle = lin(c, 0, 0, 0, -30, [[0, '#2f8a2f'], [1, '#7be26a']])
                c.beginPath()
                c.moveTo(0, 0)
                c.bezierCurveTo(-22, -12, -16, -34, 0, -24)
                c.bezierCurveTo(16, -34, 22, -12, 0, 0)
                c.fill()
                c.strokeStyle = '#1a4a1a'
                c.stroke()
                c.restore()
            }
            c.fillStyle = 'rgba(255,255,255,0.5)'
            c.beginPath()
            c.ellipse(36, 30, 5, 3, -0.6, 0, Math.PI * 2)
            c.fill()
        } else if (item === 'book') {
            c.fillStyle = lin(c, 0, 16, 0, 84, [[0, '#6a3a9a'], [1, '#3a1a5a']])
            rrect(c, 18, 14, 60, 70, 6)
            c.fill()
            c.stroke()
            c.fillStyle = '#f4ecd8'
            c.fillRect(72, 18, 6, 62)
            c.strokeRect(72, 18, 6, 62)
            c.fillStyle = rad(c, 42, 44, 1, 18, [[0, '#d7d3cc'], [0.6, '#8c867d'], [1, '#4a4540']])
            c.beginPath()
            c.ellipse(46, 48, 17, 14, 0.2, 0, Math.PI * 2)
            c.fill()
            c.stroke()
            c.fillStyle = '#e8c04a'
            c.fillRect(24, 70, 42, 5)
        } else {
            c.save()
            c.translate(48, 44)
            c.scale(2.3, 2.3)
            paintDiamondInline()(c)
            c.restore()
            c.fillStyle = lin(c, 0, 66, 0, 86, [[0, '#f4ecd8'], [1, '#c8b890']])
            rrect(c, 24, 66, 48, 18, 5)
            c.fill()
            c.stroke()
            for (const [x, y] of [[22, 22], [76, 30], [70, 12]] as const) {
                c.fillStyle = 'rgba(255,255,255,0.95)'
                c.beginPath()
                for (let i = 0; i < 8; i++) {
                    const a = (i / 8) * Math.PI * 2
                    const rr = i % 2 ? 1.5 : 6
                    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
                }
                c.closePath()
                c.fill()
            }
        }
    })
}
