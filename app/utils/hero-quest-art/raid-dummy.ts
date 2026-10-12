// Training Grounds Raid (training_dummy): the Great Dummy, the Arena scarecrow's giant cousin. It
// can't attack and can't die: the raid is how much damage the party lands before the timer runs
// out, so it has only three states. Entry: it falls out of the sky and drives its iron-shod stake
// into the ground, then wobbles still. Idle: it stands, its ribbon and straw stirring. Hit: it
// rocks back on its stake and wobbles upright.
//
// A burlap body stuffed with straw on a post banded in iron, a crossbar through its shoulders in
// straw-stuffed sleeves bound at the wrists, a painted target on its chest stuck with arrows and a
// wooden sword, a stitched patch, a sack head with the Arena dummy's stitched X eyes and grin, and
// a dented bucket for a helmet. Tally marks scratched on the post count the rounds it has stood.

import { C } from './palette'
import type { CreatureDef } from './creature'
import { CF, hitPhase, fr } from './creature'
import { Surface } from './surface'
import { rect, px, line, disc, ellipse, poly, taper, bayer, hash2, q, sm } from './boss-kit'
import { mask, vol, eachPx, selOut, type Mat5 } from './raid-kit'

const R = Math.round

const WOOD: Mat5 = { ramp: [C.brown0, C.brown1, C.brown2, C.brown3], hi: C.bone1, rim: C.brown1 }
const IRON: Mat5 = { ramp: [C.steel0, C.steel1, C.steel2, C.steel3], hi: C.white, rim: C.steel1 }
const SACK: Mat5 = { ramp: [C.brown1, C.brown2, C.brown3, C.bone1], hi: C.bone1, rim: C.brown2 }
const PATCH: Mat5 = { ramp: [C.olive0, C.olive1, C.olive2, C.bone0], hi: C.bone1, rim: C.olive1 }
const STRAW = [C.gold1, C.gold2, C.gold3] as const

/** Seconds into the entry at which it starts to fall, and at which its stake hits the ground. */
const FALL_AT = 0.2
export const DUMMY_IMPACT = 0.75
const ENTRY_DUR = 2.4
/** How high above its mark it falls from: clear of the top of its buffer. */
const FALL_FROM = 300

const TMP = new Map<number, Surface>()

/**
 * Lean and squash what is drawn above the anchor, pivoting on the ground: `lean` shears the top
 * sideways by that many px per px of height (+ toward the party), `sx`/`sy` scale about the anchor.
 */
function bend(s: Surface, lean: number, sx: number, sy: number): void {
    if (!lean && sx === 1 && sy === 1) return
    let t = TMP.get(s.w * 10000 + s.h)
    if (!t) { t = new Surface(s.w, s.h, 0, 0); TMP.set(s.w * 10000 + s.h, t) }
    t.data.set(s.data)
    for (let y = 0; y < s.ay; y++) {
        const h = s.ay - y
        const srcY = R(s.ay - h / sy)
        const off = lean * h
        for (let x = 0; x < s.w; x++) s.data[y * s.w + x] = t.get(R(s.ax + (x - off - s.ax) / sx), srcY)
    }
}

/** Set a pixel only where nothing is drawn yet: what sits behind the body. */
function under(s: Surface, x: number, y: number, c: number): void {
    if (s.get(x, y) === 0) s.set(x, y, c)
}

/** The crater its stake punched: dirt heaped round the post, cracks running out over the ground. */
function crater(s: Surface, x: number, y: number, front: boolean): void {
    if (!front) {
        for (let i = 0; i < 7; i++) {
            const a = hash2(i, 3) * Math.PI * 2
            const len = 18 + hash2(i, 5) * 22
            let cx = x
            let cy = y
            for (let k = 0; k < len; k++) {
                cx += Math.cos(a + Math.sin(k * 0.5 + i) * 0.4)
                cy += Math.sin(a + Math.cos(k * 0.4 + i) * 0.4) * 0.22
                under(s, R(cx), R(cy), k < len * 0.6 ? C.ink : C.brown0)
            }
        }
        for (let yy = -4; yy <= 0; yy++) for (let xx = -24; xx <= 24; xx++) {
            if ((xx * xx) / 576 + (yy * yy) / 16 <= 1) under(s, x + xx, y + yy, yy < -2 ? C.brown2 : C.brown1)
        }
        return
    }
    // the near lip of the heap, lit along its top, clods and stones thrown on it
    for (let yy = 0; yy <= 3; yy++) for (let xx = -22; xx <= 22; xx++) {
        if ((xx * xx) / 484 + (yy * yy) / 9 <= 1) s.set(x + xx, y + yy, yy === 0 ? C.brown3 : yy === 1 ? C.brown2 : bayer(xx, yy, 8) ? C.brown1 : C.brown0)
    }
    for (const [dx, dy, c] of [[-16, 1, C.stone2], [-9, 2, C.brown3], [12, 1, C.stone1], [18, 0, C.brown3], [5, 2, C.stone2]] as const) {
        rect(s, x + dx, y + dy, 2, 1, c); px(s, x + dx, y + dy - 1, C.stone3)
    }
}

/** The dummy, upright and at rest, its feet (the ground) at (x, y). `ph` stirs its ribbon and straw. */
function body(s: Surface, x: number, y: number, ph: number, hurt: boolean): void {
    // ── the crossbar, through both shoulders ──
    const armY = y - 99
    {
        const m = mask(s, 'bar')
        taper(m, x - 66, armY, x + 66, armY, 7, 7, 1)
        vol(s, m, WOOD, 4)
    }
    // straw-stuffed sleeves, bound at the wrist, straw bursting out past the binding
    for (const d of [-1, 1]) {
        const m = mask(s, 'sleeve')
        taper(m, x + d * 20, armY - 1, x + d * 52, armY, 18, 14, 1)
        disc(m, x + d * 52, armY, 7, 1)
        vol(s, m, SACK, 9, d < 0 ? -0.08 : 0)
        eachPx(m, (px_, py, edge) => { if (!edge && ((px_ + py * 2) % 5 === 0)) s.set(px_, py, C.brown1) })
        selOut(s, m, C.brown0)
        // the rope binding at the wrist
        for (let k = -6; k <= 6; k++) { px(s, x + d * 49, armY + k, (k & 1) ? C.bone0 : C.brown1); px(s, x + d * 50, armY + k, (k & 1) ? C.bone1 : C.bone0) }
        // straw fanning out of the cuff, stirring
        for (let i = 0; i < 9; i++) {
            const a = (i - 4) * 0.22 + Math.sin(ph + i * 1.3) * 0.06
            const len = 8 + (i * 5) % 6
            const x0 = x + d * 54
            line(s, x0, armY + (i - 4), x0 + d * Math.cos(a) * len, armY + (i - 4) + Math.sin(a) * len, STRAW[i % 3]!)
        }
        // a seam split open along the top of the sleeve, straw poking out
        for (let i = 0; i < 4; i++) line(s, x + d * (30 + i * 3), armY - 7, x + d * (29 + i * 3), armY - 11 - (i & 1) * 2, STRAW[(i + 1) % 3]!)
    }
    // a red practice ribbon tied round the far wrist, streaming in the breeze
    {
        const bx = x - 50
        const by = armY + 4
        for (let i = 0; i < 16; i++) {
            const u = i / 15
            const rx = bx - 2 - i * 1.6
            const ry = by + i * 1.9 + Math.sin(ph * 1.3 - i * 0.55) * (1 + u * 3)
            px(s, R(rx), R(ry), u < 0.3 ? C.red2 : C.red1)
            px(s, R(rx) + 1, R(ry), i & 1 ? C.red3 : C.red2)
            px(s, R(rx) - 1, R(ry) + 1, C.red0)
        }
    }

    // ── the post, banded in iron, tally marks scratched down it ──
    {
        const m = mask(s, 'post')
        taper(m, x, y + 2, x, y - 56, 22, 19, 1)
        vol(s, m, WOOD, 12)
        eachPx(m, (px_, py) => { if (((px_ * 7 + (py >> 2)) % 11) === 0) s.set(px_, py, C.brown0) }) // grain
        // the iron shoe the stake is driven in by, and a band higher up
        for (const [yy, hh] of [[-12, 8], [-34, 3]] as const) {
            const bm = mask(s, 'band')
            rect(bm, x - 12, y + yy, 25, hh, 1)
            vol(s, bm, IRON, 3)
            for (let i = -9; i <= 9; i += 6) px(s, x + i, y + yy + (hh >> 1), C.steel3)
        }
        // tally marks: two gates of five
        const tx = x - 5
        for (const ty of [y - 25, y - 16]) {
            for (let i = 0; i < 4; i++) line(s, tx + i * 2, ty, tx + i * 2, ty - 6, C.bone0)
            line(s, tx - 1, ty - 1, tx + 7, ty - 5, C.bone1)
        }
    }

    // ── the body: a stuffed burlap sack, cinched at the waist with rope ──
    const cy = y - 79
    {
        const m = mask(s, 'chest')
        ellipse(m, x + 1, cy, 30, 28, 1)
        // shoulders filled out under the crossbar
        ellipse(m, x + 1, cy - 18, 33, 11, 1)
        vol(s, m, SACK, 16)
        eachPx(m, (px_, py, edge) => { if (!edge && ((px_ + py * 2) % 5 === 0)) s.set(px_, py, C.brown1) })
        selOut(s, m, C.brown0)
        // a patch sewn over the far shoulder, cross-stitched round its edge
        const pm = mask(s, 'patch')
        poly(pm, [-23, -25, -8, -28, -6, -12, -21, -9], x, cy, 1)
        vol(s, pm, PATCH, 6)
        eachPx(pm, (px_, py, edge) => { if (edge && ((px_ + py) & 1)) s.set(px_, py, C.bone1) })
        // the seam up the middle, stitched
        for (let yy = -25; yy < 24; yy += 3) { px(s, x - 3, cy + yy, C.brown0); px(s, x - 2, cy + yy + 1, C.bone0) }
        // straw bursting from a split low on the near side
        for (let i = 0; i < 7; i++) line(s, x + 26, cy + 6 + i * 2, x + 32 + (i & 1) * 2, cy + 4 + i * 3, STRAW[i % 3]!)
    }
    // the rope cinching the waist, and the straw skirt pushed out below it
    {
        const wy = y - 53
        for (let i = 0; i < 16; i++) {
            const a = (i - 7.5) * 0.12
            const len = 9 + (i * 7) % 5
            line(s, x - 18 + i * 2.4, wy + 1, x - 18 + i * 2.4 + Math.sin(a) * len, wy + 1 + Math.cos(a) * len, STRAW[(i + 2) % 3]!)
        }
        for (let xx = -20; xx <= 21; xx++) {
            const k = (xx + 40) % 4
            px(s, x + xx, wy - 1, k < 2 ? C.bone1 : C.bone0)
            px(s, x + xx, wy, k < 2 ? C.bone0 : C.brown1)
            px(s, x + xx, wy + 1, C.brown0)
        }
        // the knot, its ends hanging
        disc(s, x + 12, wy, 3, C.bone0); px(s, x + 11, wy - 1, C.bone1)
        line(s, x + 12, wy + 2, x + 14, wy + 10, C.bone0); line(s, x + 13, wy + 2, x + 17, wy + 9, C.bone1)
    }
    // the target painted on the chest, stuck with arrows and a wooden practice sword
    {
        const tx = x + 11
        const ty = cy + 2
        for (const [r, c] of [[16, C.red0], [15, C.red1], [12, C.bone1], [9, C.red2], [6, C.bone1], [3, C.red2]] as const) disc(s, tx, ty, r, c)
        // the paint lit on its upper left, worn thin and flaking
        for (let i = 0; i < 40; i++) { const b = Math.PI * (1 + i / 40); px(s, R(tx + Math.cos(b) * 13), R(ty + Math.sin(b) * 13), C.red2) }
        for (let i = 0; i < 12; i++) { const h = hash2(i, 9); const r = 4 + hash2(i, 11) * 11; px(s, R(tx + Math.cos(h * 7) * r), R(ty + Math.sin(h * 7) * r), C.brown2) }
        px(s, tx - 1, ty - 1, C.red3)
        // arrows: in at the chest, the shafts angled back toward whoever loosed them
        // well clear of the body, pale against the dark behind it
        for (const [ax, ay, len, a] of [[-3, -6, 34, -0.3], [5, 4, 30, 0.05], [-7, 9, 27, 0.25], [2, -11, 32, -0.5]] as const) {
            const x0 = tx + ax
            const y0 = ty + ay
            const x1 = R(x0 + Math.cos(a) * len)
            const y1 = R(y0 + Math.sin(a) * len)
            line(s, x0, y0, x1, y1, C.bone1)
            line(s, x0, y0 + 1, x1, y1 + 1, C.brown1)
            // the fletching, white and red
            const fx = R(Math.cos(a) * 4)
            const fy = R(Math.sin(a) * 4)
            line(s, x1 - fx, y1 - fy - 2, x1, y1 - 1, C.white)
            line(s, x1 - fx, y1 - fy + 2, x1, y1 + 1, C.red2)
            px(s, x0, y0, C.ink)
        }
        // the wooden sword run in low on the far side, its hilt out
        const sx0 = x - 14
        const sy0 = cy + 12
        const wm = mask(s, 'sword')
        taper(wm, sx0, sy0, sx0 - 20, sy0 + 12, 4, 5, 1)
        vol(s, wm, WOOD, 3)
        line(s, sx0 - 18, sy0 + 6, sx0 - 14, sy0 + 15, C.steel2, 2)
        line(s, sx0 - 20, sy0 + 12, sx0 - 26, sy0 + 15, C.red1, 2)
    }

    // ── the head: a sack, the Arena dummy's X eyes and stitched grin, a bucket for a helmet ──
    {
        const hx = x + 3
        const hy = y - 122
        // the neck tie
        for (let xx = -9; xx <= 9; xx++) { px(s, hx + xx, hy + 13, (xx & 1) ? C.bone0 : C.bone1); px(s, hx + xx, hy + 14, C.brown0) }
        const m = mask(s, 'head')
        ellipse(m, hx, hy, 19, 15, 1)
        rect(m, hx - 7, hy + 10, 15, 4, 1)
        vol(s, m, SACK, 14)
        eachPx(m, (px_, py, edge) => { if (!edge && ((px_ + py * 2) % 5 === 0)) s.set(px_, py, C.brown1) })
        selOut(s, m, C.brown0)
        // stitched X eyes, big and dark; on a hit they pinch shut into lines
        for (const ex of [hx + 5, hx + 15]) {
            const ey = hy - 3
            if (hurt) { rect(s, ex - 3, ey, 7, 2, C.ink); continue }
            for (let k = -3; k <= 3; k++) {
                px(s, ex + k, ey + k, C.ink); px(s, ex + k + 1, ey + k, C.ink)
                px(s, ex + k, ey - k, C.ink); px(s, ex + k + 1, ey - k, C.ink)
            }
        }
        // the stitched grin: a curve of stitches crossing a seam
        for (let k = -7; k <= 7; k++) {
            const gx = hx + 10 + k
            const gy = hy + 8 - R((k * k) / 18)
            px(s, gx, gy, C.brown0)
            if (!(k & 1)) { px(s, gx, gy - 1, C.bone1); px(s, gx, gy + 1, C.bone0) }
        }
        // a patch of straw sticking out over the ear
        for (let i = 0; i < 6; i++) line(s, hx - 17, hy + 1 + i, hx - 24 - (i & 1) * 3, hy - 2 + i * 2 + R(Math.sin(ph + i) * 1), STRAW[i % 3]!)

        // the bucket, dented, tipped back over the brow, its handle hanging
        const bm = mask(s, 'bucket')
        poly(bm, [-18, -9, 16, -13, 13, -27, -12, -25], hx, hy, 1)
        vol(s, bm, IRON, 10)
        selOut(s, bm, C.steel0)
        // the rolled rim and the hoops
        line(s, hx - 19, hy - 9, hx + 17, hy - 13, C.steel3, 2)
        line(s, hx - 18, hy - 8, hx + 17, hy - 12, C.steel0)
        line(s, hx - 15, hy - 17, hx + 14, hy - 20, C.steel1)
        line(s, hx - 13, hy - 23, hx + 13, hy - 26, C.steel1)
        // a dent, and rust weeping from a rivet
        disc(s, hx + 6, hy - 19, 2, C.steel1); px(s, hx + 5, hy - 20, C.steel0); px(s, hx + 7, hy - 18, C.steel3)
        line(s, hx - 8, hy - 20, hx - 8, hy - 15, C.brown1); px(s, hx - 8, hy - 21, C.steel3)
        // the handle, a wire bail swinging under the chin
        const sw = Math.sin(ph) * 2
        for (let k = 0; k <= 14; k++) {
            const u = k / 14
            const bx = hx - 18 + u * 35
            const by = hy - 9 - u * 4 + Math.sin(u * Math.PI) * (22 + sw)
            px(s, R(bx + sw * Math.sin(u * Math.PI)), R(by), C.steel2)
        }
        // straw poking out from under the brim
        for (let i = 0; i < 5; i++) line(s, hx - 16 + i * 3, hy - 9, hx - 18 + i * 3, hy - 5, STRAW[(i + 2) % 3]!)
    }
}

export const GREAT_DUMMY: CreatureDef = {
    name: 'The Great Dummy', size: 256, room: 12, shadow: 32, accent: C.red2,
    states: {
        idle: { dur: 2.0, loop: true },
        hit: { dur: 0.7, loop: false },
        entry: { dur: ENTRY_DUR, loop: false }
    },
    draw(s, st, t) {
        const x = s.ax
        const y = s.ay
        const tt = q(t)
        const ph = tt / 2.0 * Math.PI * 2
        let lean = 0
        let sx = 1
        let sy = 1
        let dy = 0
        let landed = true
        let hurt = false

        if (st === 'hit') {
            hitPhase(t, 0.7)
            hurt = tt < 0.2
            // knocked back on its stake, springing past upright and settling
            const u = tt / 0.7
            lean = -0.1 * Math.exp(-3 * u) * Math.cos(u * Math.PI * 3.2)
            sy = 1 - 0.04 * Math.max(0, 1 - u * 5)
        } else if (st === 'entry') {
            if (tt < FALL_AT) {
                // nothing yet but its shadow, gathering where it will land
                landed = false
                CF.shadow = 0.12 * tt / FALL_AT
            } else if (tt < DUMMY_IMPACT) {
                // falling, faster and faster, stretched with the speed of it
                landed = false
                const k = (tt - FALL_AT) / (DUMMY_IMPACT - FALL_AT)
                dy = -R((1 - k * k) * FALL_FROM)
                sy = 1 + 0.1 * k
                sx = 1 - 0.05 * k
                CF.shadow = 0.12 + 0.88 * k * k
            } else {
                // the stake drives in: squashed flat, springing back tall, then wobbling still
                const a = tt - DUMMY_IMPACT
                const sq = Math.exp(-7 * a) * Math.cos(a * Math.PI * 5.5)
                sy = 1 - 0.14 * sq
                sx = 1 + 0.08 * sq
                lean = 0.05 * Math.exp(-2.4 * a) * Math.sin(a * Math.PI * 2.4) * sm(Math.min(1, a / 0.15))
            }
        }

        if (landed) crater(s, x, y, false)
        body(s, x, y + dy, ph, hurt)
        bend(s, lean, sx, sy)
        if (landed) crater(s, x, y, true)
    },
    fx(dst, st, t, x, y, dir) {
        const tt = q(t)
        if (st === 'entry') {
            if (tt >= FALL_AT && tt < DUMMY_IMPACT) {
                // speed lines trailing up behind it as it comes down
                const k = (tt - FALL_AT) / (DUMMY_IMPACT - FALL_AT)
                const top = y - R((1 - k * k) * FALL_FROM) - 150
                for (let i = 0; i < 7; i++) {
                    const lx = x + dir * (-50 + i * 17)
                    const len = 20 + (i * 13) % 25
                    for (let k2 = 0; k2 < len; k2 += 2) dst.set(lx, top - k2 - (i * 11) % 30, k2 < 8 ? C.white : C.bone1)
                }
            } else if (tt >= DUMMY_IMPACT && tt < DUMMY_IMPACT + 0.9) {
                const a = tt - DUMMY_IMPACT
                const u = a / 0.9
                // a shockwave running out along the ground
                const r = 26 + u * 90
                for (let i = 0; i < 64; i++) {
                    const b = i / 64 * Math.PI * 2
                    if (u > 0.5 && (i & 1)) continue
                    dst.set(R(x + Math.cos(b) * r), R(y + Math.sin(b) * r * 0.18), u < 0.35 ? C.white : C.bone1)
                }
                // dust billowing out both ways, thinning as it goes
                // round puffs lit on top, eaten away through the dither as they thin
                const level = Math.max(1, R(16 * (1 - u * u)))
                for (const d of [-1, 1]) {
                    for (let k2 = 0; k2 < 5; k2++) {
                        const cx = R(x + d * (12 + k2 * 7 + u * (30 + k2 * 12)))
                        const cy = R(y - 3 - (k2 & 1) * 4 - u * (6 + k2 * 3))
                        const r = 5 + (k2 * 3) % 4 + u * 7
                        for (let yy = -R(r); yy <= R(r); yy++) for (let xx = -R(r); xx <= R(r); xx++) {
                            if (xx * xx + yy * yy > r * r || !bayer(cx + xx, cy + yy, level)) continue
                            dst.set(cx + xx, cy + yy, yy < -r * 0.3 ? C.bone1 : yy < r * 0.4 ? C.bone0 : C.stone2)
                        }
                    }
                }
                // clods and stones thrown up and falling back
                for (let i = 0; i < 14; i++) {
                    const vx = (hash2(i, 1) - 0.5) * 220
                    const vy = -80 - hash2(i, 2) * 140
                    const px_ = x + vx * a
                    const py_ = y - 2 + vy * a + 320 * a * a
                    if (py_ > y + 2) continue
                    dst.set(R(px_), R(py_), i % 3 ? C.brown1 : C.stone2)
                    dst.set(R(px_) + 1, R(py_), i % 3 ? C.brown2 : C.stone3)
                }
            }
        }
        if (st === 'hit') {
            // straw puffing out of it where it was struck
            const k = fr(t, 10, 7)
            if (k < 6) {
                for (let i = 0; i < 14; i++) {
                    const a = hash2(i, 4) * Math.PI - Math.PI / 2
                    const d = 10 + k * 5 + hash2(i, 6) * 8
                    dst.set(R(x + dir * (8 + Math.cos(a) * d)), R(y - 80 + Math.sin(a) * d + k * k * 0.4), STRAW[i % 3]!)
                }
            }
        }
        if (st === 'idle') {
            // now and then a wisp of straw works loose and drifts down
            const u = (q(t) % 2.0) / 2.0
            dst.set(R(x - dir * (30 + u * 30)), R(y - 90 + u * 70), u < 0.5 ? C.gold3 : C.gold2)
        }
    }
}
