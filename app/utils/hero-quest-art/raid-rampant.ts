// Trait Raid (rampaging_boss): the Rampant, which cannot be killed and never shows an HP bar, so its
// rampage level is read off its body. A behemoth on four pillar legs: a great hump of shoulder armoured
// in plates of bone, a mane of crystal growing up between the plates, a heavy head behind a bone skull
// mask with its eyes burning in the sockets, tusks, and horns sweeping forward like a bull's. Each tier
// it is bigger, its mane longer and brighter, one more pair of horns, more eyes lit, the veins under its
// hide burning hotter; on the escalation beat it rears and roars and grows into the next. No Death.

import { C } from './palette'
import type { CreatureDef } from './creature'
import { fr, span, sm } from './creature'
import { B, drive, rect, px, line, disc, tri, poly, taper, ellipse, q, hash2 } from './boss-kit'
import { mask, vol, eachPx, selOut, type Mat5 } from './raid-kit'

const R = Math.round

export const RAMPAGE_TIERS = 5

const HIDE: Mat5 = { ramp: [C.void, C.night1, C.night2, C.night3], hi: C.purple2, rim: C.purple0 }
const BONE: Mat5 = { ramp: [C.bone0, C.bone0, C.bone1, C.white], hi: C.white, rim: C.bone0 }
const OLD_BONE: Mat5 = { ramp: [C.stone1, C.bone0, C.bone0, C.bone1], hi: C.bone1, rim: C.stone1 }
/** The crystals, brighter each tier: a lit face, a dark face and a burning core. */
const CRYSTAL = [
    { lit: C.purple2, dark: C.purple0, core: C.purple2 },
    { lit: C.purple2, dark: C.purple1, core: C.pink },
    { lit: C.pink, dark: C.purple1, core: C.pink },
    { lit: C.pink, dark: C.purple2, core: C.white },
    { lit: C.white, dark: C.pink, core: C.white }
] as const
/** The veins under its hide: faint at the start, white-hot at the top. */
const VEIN = [C.purple1, C.purple2, C.pink, C.pink, C.white] as const

type S = Parameters<CreatureDef['draw']>[0]

function rampantDraw(tier: number, s: S, st: string, t: number, def: CreatureDef): void {
    drive(def, st, t, 16, 1.2 - tier * 0.08)
    // the escalation beat grows it into the next tier
    const up = st === 'escalate' ? sm(span(t, 0.3, 1.1)) : 0
    const lv = tier + up
    const sz = 0.8 + lv * 0.06
    const x = s.ax - 6 + B.lunge - B.kb
    const y = s.ay
    const br = B.breath
    const pulse = (Math.sin(q(t) * 5) + 1) / 2
    const cr = CRYSTAL[Math.min(4, Math.round(lv))]!
    const vein = VEIN[Math.min(4, Math.round(lv))]!
    // a point on the body, scaled from its feet
    const L = (dx: number, dy: number): [number, number] => [x + dx * sz, y + dy * sz]
    // it rears on the escalation and the wind-up, and drives its horns down on the strike
    const rear = st === 'escalate' ? Math.sin(Math.min(1, q(t) / 1.1) * Math.PI) : B.wind
    // the escalation is its big beat: the head goes up much further than on a wind-up
    const lift = rear * (st === 'escalate' ? 30 : 16) - (B.strike ? 8 : B.rec * 5)

    // ── legs: pillars, the hind ones bent at the hock, heavy bone claws ──
    const legs = (far: boolean): void => {
        const ox = far ? -7 : 0
        for (const [hx, hy, kx, ky, fx, w] of [[24, -58, 28, -30, 26, 24], [-40, -54, -50, -28, -42, 21]] as const) {
            const m = mask(s, 'leg')
            const [a, b] = L(hx + ox, hy - (hx > 0 ? rear * 8 : 0))
            const [c, d] = L(kx + ox, ky)
            const [e] = L(fx + ox, 0)
            taper(m, a, b, c, d, w * sz, (w - 5) * sz, 1)
            taper(m, c, d, e, y - 4, (w - 5) * sz, (w - 3) * sz, 1)
            disc(m, c, d, (w - 5) * sz * 0.5, 1)
            vol(s, m, HIDE, 12, far ? -0.3 : 0)
            if (!far) selOut(s, m, C.void)
            // three claws, curling over the ground
            for (let k = -1; k <= 1; k++) {
                const cx = e + k * 6 * sz + 2
                tri(s, cx - 2, y - 5, cx + 3, y - 5, cx + 6, y, far ? C.bone0 : C.bone1)
                px(s, R(cx) + 5, y - 1, far ? C.bone0 : C.white)
            }
        }
    }
    legs(true)

    // ── the tail, heavy, crystals clustered at its end ──
    {
        const m = mask(s, 'tail')
        const sw = Math.sin(q(t) * 2) * 4
        const [a, b] = L(-58, -66)
        const [c, d] = L(-80, -48 + sw)
        const [e, f] = L(-86, -26 + sw)
        taper(m, a, b, c, d, 14 * sz, 9 * sz, 1)
        taper(m, c, d, e, f, 9 * sz, 5 * sz, 1)
        vol(s, m, HIDE, 8, -0.1)
        crystal(s, e, f, -2.0, 11 * sz, 5 * sz, cr, pulse)
        crystal(s, e + 2, f - 3, -1.4, 8 * sz, 4 * sz, cr, 1 - pulse)
    }

    // ── the crystal mane, growing up along the spine (the plates will sit over its roots) ──
    const count = 6 + R(lv * 2.5)
    for (let i = 0; i < count; i++) {
        const u = i / (count - 1)
        const [bx, by] = L(-38 + u * 70, -76 - Math.sin(u * Math.PI) * 26 + br - rear * 10 * u)
        const h = (10 + Math.sin(u * Math.PI) * (9 + lv * 4)) * sz * (0.8 + hash2(i, 3) * 0.4)
        crystal(s, bx, by, -Math.PI / 2 - 0.45 + u * 0.5 + (hash2(i, 7) - 0.5) * 0.3, h, (5 + lv * 0.6) * sz, cr, (pulse + u) % 1)
    }

    // ── the body: haunch, barrel and the great hump of shoulder ──
    {
        const m = mask(s, 'body')
        const [hx, hy] = L(-42, -60 + br)
        const [sx, sy] = L(24, -70 + br - rear * 8)
        taper(m, hx, hy, sx, sy, 50 * sz, 62 * sz, 1)
        disc(m, hx, hy, 26 * sz, 1)
        const [kx, ky] = L(6, -80 + br - rear * 10)
        disc(m, kx, ky, 28 * sz, 1)
        vol(s, m, HIDE, 24)
        // shaggy hide: short strokes raked back
        eachPx(m, (px_, py, edge) => { if (!edge && hash2(px_, py) < 0.014) { s.set(px_, py, C.night3); s.set(px_ - 1, py + 1, C.night1) } })
        // veins burning under the hide, branching, hotter each tier
        for (let i = 0; i < 3 + R(lv * 2); i++) {
            let vx = R(hx + hash2(i, 5) * (sx - hx))
            let vy = R(hy + 6 * sz + hash2(i, 9) * 18 * sz)
            for (let k = 0; k < 6; k++) {
                const nx = vx + 3 + R(hash2(i * 7 + k, 2) * 3)
                const ny = vy - 2 + R(hash2(i * 5 + k, 4) * 5) - 2
                if (!m.get(nx, ny)) break
                line(s, vx, vy, nx, ny, (k + i + R(q(t) * 6)) % 5 === 0 ? C.white : vein)
                vx = nx
                vy = ny
            }
        }
        selOut(s, m, C.void)
    }
    // ── the bone plates armouring the hump, over the mane's roots ──
    for (let i = 0; i < 6; i++) {
        const u = i / 5
        const [px0, py0] = L(-34 + u * 62, -82 - Math.sin(u * Math.PI) * 20 + br - rear * 10 * u)
        const m = mask(s, 'plate')
        ellipse(m, px0, py0, 9 * sz, 5 * sz, 1)
        vol(s, m, OLD_BONE, 6)
        selOut(s, m, C.stone1)
        // a lit ridge down the middle of each plate
        line(s, px0 - 5 * sz, py0 - 1, px0 + 4 * sz, py0 - 2, C.bone1)
    }

    // ── the head: a heavy skull behind a bone mask, eyes burning in it, a glowing maw, tusks, horns ──
    {
        const [cx, cy] = L(50, -62 + br - lift)
        const [nx, ny] = L(78, -54 + br - lift * 0.8)
        // the lower jaw, which drops on the roar and the strike
        const open = (st === 'escalate' ? rear : 0) + (B.strike ? 1 : 0) + B.wind * 0.3
        const jm = mask(s, 'jaw')
        const [j0x, j0y] = L(46, -50 + br - lift)
        taper(jm, j0x, j0y, nx - 2, ny + 8 * sz + open * 10 * sz, 16 * sz, 10 * sz, 1)
        vol(s, jm, HIDE, 8, -0.1)
        // the maw between the jaws, lit from inside
        const mx = R(cx + 10 * sz)
        const my = R(cy + 10 * sz)
        const mw = R(24 * sz)
        const mh = R(2 + open * 9 * sz)
        rect(s, mx, my, mw, mh, C.void)
        if (mh > 3) {
            rect(s, mx + 1, my + 1, mw - 2, mh - 2, lv >= 3 ? C.pink : C.purple1)
            rect(s, mx + 3, my + 2, mw - 6, 1, C.white)
        }
        for (let k = 1; k < mw; k += 3) { px(s, mx + k, my, C.bone1); px(s, mx + k + 1, my + mh, C.bone1) }
        // the skull
        const m = mask(s, 'head')
        disc(m, cx, cy, 20 * sz, 1)
        taper(m, cx, cy, nx, ny, 30 * sz, 20 * sz, 1)
        vol(s, m, HIDE, 12, 0.05)
        selOut(s, m, C.void)
        // the bone mask over its brow and snout, its eye sockets burning
        const bm = mask(s, 'mask')
        const pts = [[34, -80], [44, -86], [64, -76], [80, -62], [80, -56], [64, -62], [46, -64], [34, -70]]
        poly(bm, pts.flatMap(([px0, py0]) => { const [a, b] = L(px0!, py0! + br); return [a, b - lift * (px0! > 60 ? 0.8 : 1)] }), 0, 0, 1)
        vol(s, bm, BONE, 8)
        selOut(s, bm, C.bone0)
        // cracks in the mask
        const [kx, ky] = L(58, -76 + br)
        line(s, kx, ky - lift, kx + 3, ky + 5 - lift, C.bone0)
        const eyes = 1 + Math.floor(lv / 2)
        for (let e = 0; e < eyes; e++) {
            const [ex, ey] = L(62 - e * 9, -70 + e * 2 + br)
            const exr = R(ex)
            const eyr = R(ey - lift)
            rect(s, exr - 2, eyr - 1, 5, 3, C.void)
            const c = B.hurt ? C.white : lv >= 3 || B.glow > 0.4 ? C.white : C.pink
            px(s, exr, eyr, c); px(s, exr + 1, eyr, C.pink)
        }
        // nostrils at the tip of the mask, steaming on the roar
        const [sx, sy] = L(78, -59 + br)
        px(s, R(sx), R(sy - lift * 0.8), C.void); px(s, R(sx) - 2, R(sy - lift * 0.8), C.void)
        // tusks rising from the lower jaw
        for (const off of [4, 16]) {
            const tm = mask(s, 'tusk')
            const tx = mx + off * sz
            const ty = my + mh
            poly(tm, [tx, ty, tx + 5 * sz, ty, tx + 11 * sz, ty - 17 * sz, tx + 7 * sz, ty - 19 * sz], 0, 0, 1)
            vol(s, tm, BONE, 5)
        }
        // horns: a great pair sweeping forward, another pair behind them every two tiers
        const pairs = 1 + Math.floor(lv / 2)
        for (let p = pairs - 1; p >= 0; p--) {
            const [ax, ay] = L(40 - p * 9, -80 - p * 3 + br)
            horn(s, ax, ay - lift, (40 + p * 6 + lv * 3) * sz, (9 - p) * sz, p > 0)
        }
    }

    // ── near legs, over the body ──
    legs(false)
}

/** A crystal spike from (x, y) along `a`: a lit face and a dark face, a burning core line, a tip. */
function crystal(s: S, x: number, y: number, a: number, h: number, w: number, cr: typeof CRYSTAL[number], pulse: number): void {
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const tx = x + ca * h
    const ty = y + sa * h
    tri(s, x - sa * w, y + ca * w, x, y, tx, ty, cr.lit)
    tri(s, x, y, x + sa * w, y - ca * w, tx, ty, cr.dark)
    line(s, x + ca * h * 0.15, y + sa * h * 0.15, x + ca * h * 0.8, y + sa * h * 0.8, pulse > 0.5 ? C.white : cr.core)
    px(s, R(tx), R(ty), C.white)
}

/**
 * A horn from its root (x, y): up first, then sweeping forward and down at the party like a bull's,
 * tapering to a dark tip, ridged across its length. `back` horns are older and duller.
 */
function horn(s: S, x: number, y: number, len: number, w: number, back: boolean): void {
    const m = mask(s, 'horn')
    let cx = x
    let cy = y
    const n = 12
    for (let i = 0; i < n; i++) {
        const u = i / n
        const a = -Math.PI / 2 + (back ? -0.15 : 0.1) + u * 1.9
        const nx = cx + Math.cos(a) * len / n
        const ny = cy + Math.sin(a) * len / n
        taper(m, cx, cy, nx, ny, Math.max(1, w * (1 - u * 0.85)), Math.max(1, w * (1 - (u + 1 / n) * 0.85)), 1)
        cx = nx
        cy = ny
    }
    vol(s, m, back ? OLD_BONE : BONE, 6)
    selOut(s, m, back ? C.stone1 : C.bone0)
    eachPx(m, (px_, py) => { if ((px_ + py * 2) % 7 === 0) s.set(px_, py, C.bone0) })
    px(s, R(cx), R(cy), C.void)
}

function rampantDef(tier: number): CreatureDef {
    const def: CreatureDef = {
        name: `The Rampant — rampage ${tier + 1}`, size: 256, room: 12, shadow: 64, accent: C.pink,
        states: {
            idle: { dur: 1.2, loop: true }, attack: { dur: 1.2, loop: false }, hit: { dur: 0.5, loop: false },
            escalate: { dur: 1.4, loop: false }
        },
        draw: (s, st, t) => rampantDraw(tier, s, st, t, def),
        fx(dst, st, t, x, y, dir) {
            // the aura ring IS the level read — no HP bar exists for this boss
            const lv = tier + (st === 'escalate' ? sm(span(t, 0.3, 1.1)) : 0)
            const k = fr(t, 10, 4)
            for (let r = 0; r <= Math.floor(lv); r++) {
                const rx = 62 + r * 10 + (k & 1)
                for (let a = 0; a < Math.PI * 2; a += 0.06) {
                    const px2 = x + R(Math.cos(a) * rx)
                    const py2 = y - 2 + R(Math.sin(a) * rx * 0.1)
                    if (((a * 20) | 0) % (4 - Math.min(3, r)) === 0) dst.set(px2, py2, r >= 3 ? C.white : r >= 2 ? C.pink : C.purple2)
                }
            }
            if (st === 'escalate') for (let i = 0; i < 16; i++) dst.set(x + dir * (-50 + i * 7), y - 120 - ((k * 5 + i * 7) % 30), i & 1 ? C.pink : C.white)
            if (st === 'attack' && B.strike) for (let i = 0; i < 14; i++) dst.set(x + dir * (76 + i * 2), y - 2 - (i % 5), i & 1 ? C.pink : C.purple2)
        }
    }
    return def
}

export const RAMPANT = Array.from({ length: RAMPAGE_TIERS }, (_, i) => rampantDef(i))
