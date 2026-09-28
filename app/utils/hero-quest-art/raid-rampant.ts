// Trait Raid (rampaging_boss): the Rampant, which cannot be killed and never shows an HP bar, so its
// rampage level is read off its body. A behemoth on four heavy legs, jointed and capped in bone, broad
// padded feet, a thick neck carrying its head low, a great hump over the shoulders armoured in plates of
// bone laid along its back, a mane of crystal growing up between the plates, a heavy head behind a bone skull
// mask with its eyes burning in the sockets, tusks, and horns sweeping forward like a bull's. Each tier
// it is bigger, its mane longer and brighter, one more pair of horns, more eyes lit, the veins under its
// hide burning hotter; on the escalation beat it rears and roars and grows into the next. No Death.

import { C } from './palette'
import type { CreatureDef } from './creature'
import { fr, sm } from './creature'
import { B, drive, elbow, P, bayer, px, line, disc, tri, poly, taper, ellipse, q, hash2 } from './boss-kit'
import { mask, vol, eachPx, selOut, type Mat5 } from './raid-kit'
import { debris, spike } from './special-kit'
import { shockRing } from './vfx-cinematic'

const R = Math.round

export const RAMPAGE_TIERS = 5

/**
 * The escalation, its big beat, in seconds: it crouches and gathers itself until ESC_CROUCH, rears
 * and roars (its roar goes up at RAMPAGE_ROAR, at the height of it at ESC_PEAK), slams its forelegs
 * down and grows into the next tier at RAMPAGE_SLAM, overshooting, and has settled by ESC_SETTLE.
 * The live stage times its hit-stop, shake and banner to these.
 */
const ESC_DUR = 1.9
const ESC_CROUCH = 0.35
export const RAMPAGE_ROAR = 0.55
const ESC_PEAK = 0.8
export const RAMPAGE_SLAM = 1.15
const ESC_SETTLE = 1.6

/** How far it rears at `t` into the escalation: down into the crouch (−), up to the roar (1), slammed down. */
function escRear(t: number): number {
    const q0 = q(t)
    if (q0 < ESC_CROUCH) return -0.35 * sm(q0 / ESC_CROUCH)
    if (q0 < ESC_PEAK) return -0.35 + 1.35 * sm((q0 - ESC_CROUCH) / (ESC_PEAK - ESC_CROUCH))
    if (q0 < RAMPAGE_SLAM) { const u = (q0 - ESC_PEAK) / (RAMPAGE_SLAM - ESC_PEAK); return 1 - 1.25 * u * u }
    const u = Math.min(1, (q0 - RAMPAGE_SLAM) / (ESC_SETTLE - RAMPAGE_SLAM))
    return -0.25 * (1 - u) * Math.cos(u * Math.PI * 1.5)
}

/** How far into the next tier it has grown at `t`: nothing until the slam, then a pop past it that settles. */
function escUp(t: number): number {
    const q0 = q(t)
    if (q0 < RAMPAGE_SLAM) return 0
    const pop = Math.min(1, (q0 - RAMPAGE_SLAM) / 0.1)
    const u = Math.min(1, (q0 - RAMPAGE_SLAM - 0.1) / 0.45)
    return q0 < RAMPAGE_SLAM + 0.1 ? 1.18 * pop : 1 + 0.18 * (1 - sm(u)) * Math.cos(u * Math.PI * 1.5)
}

/** Whether its crystals, veins and eyes are flaring white: from the roar through the slam. */
function escFlare(t: number): boolean {
    const q0 = q(t)
    return q0 >= RAMPAGE_ROAR - 0.1 && q0 < RAMPAGE_SLAM + 0.3
}

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
    // the escalation beat grows it into the next tier, on the slam
    const esc = st === 'escalate'
    const up = esc ? escUp(t) : 0
    if (esc && escFlare(t)) B.glow = 1
    const lv = tier + up
    const sz = 0.8 + lv * 0.06
    const x = s.ax - 6 + B.lunge - B.kb
    const y = s.ay
    const br = B.breath
    const pulse = (Math.sin(q(t) * 5) + 1) / 2
    // flaring on the roar, as bright as they go
    const cr = CRYSTAL[esc && escFlare(t) ? 4 : Math.min(4, Math.round(lv))]!
    const vein = VEIN[esc && escFlare(t) ? 4 : Math.min(4, Math.round(lv))]!
    // a point on the body, scaled from its feet
    const L = (dx: number, dy: number): [number, number] => [x + dx * sz, y + dy * sz]
    // it rears on the escalation and the wind-up, and drives its horns down on the strike
    const rear = esc ? escRear(t) : B.wind
    // the escalation is its big beat: the head goes up much further than on a wind-up
    const lift = rear * (st === 'escalate' ? 30 : 16) - (B.strike ? 8 : B.rec * 5)

    // ── a leg: two bones out of the shoulder, three out of the hip, a bone cap on each joint that
    //    shows, a broad padded foot and three heavy claws; the forelegs lift and tuck as it rears ──
    const cap = (jx: number, jy: number, r: number, far: boolean, backward: boolean): void => {
        const m = mask(s, 'cap')
        ellipse(m, jx + (backward ? -r * 0.55 : r * 0.45), jy, r * 0.5, r * 0.75, 1)
        vol(s, m, far ? OLD_BONE : BONE, 4, far ? -0.25 : 0)
        selOut(s, m, far ? C.stone1 : C.bone0)
    }
    const leg = (fore: boolean, far: boolean): void => {
        const ox = far ? -8 : 0
        const m = mask(s, 'leg')
        let fx: number
        let fy: number
        const joints: [number, number, number, boolean][] = []
        const tops: [number, number, number][] = []
        if (fore) {
            const tuck = Math.max(0, rear) * (far ? 14 : 18)
            const [sx, sy] = L(20 + ox, -68 - rear * 8)
            ;[fx, fy] = L(26 + ox + rear * 8, -4 - tuck)
            elbow(sx, sy, fx, fy, 33 * sz, 37 * sz, 1)
            const ex = P.x
            const ey = P.y
            const wx = ex + (fx - ex) * 0.72
            const wy = ey + (fy - ey) * 0.72
            taper(m, sx, sy, ex, ey, 34 * sz, 24 * sz, 1)
            taper(m, ex, ey, wx, wy, 23 * sz, 17 * sz, 1)
            taper(m, wx, wy, fx, fy, 17 * sz, 20 * sz, 1)
            disc(m, ex, ey, 12 * sz, 1)
            disc(m, wx, wy, 9 * sz, 1)
            if (!far) { const [tx, ty] = [sx - 5 * sz, sy]; disc(m, tx, ty, 19 * sz, 1); taper(m, tx, ty, ex, ey, 30 * sz, 24 * sz, 1); tops.push([tx, ty, 17 * sz]) }
            joints.push([ex, ey, 10 * sz, true], [wx, wy, 7 * sz, false])
        } else {
            const [hx, hy] = L(-40 + ox, -64)
            const [kx, ky] = L(-28 + ox, -40)
            const [jx, jy] = L(-50 + ox, -22)
            ;[fx, fy] = L(-44 + ox, -4)
            taper(m, hx, hy, kx, ky, 38 * sz, 26 * sz, 1)
            taper(m, kx, ky, jx, jy, 25 * sz, 16 * sz, 1)
            taper(m, jx, jy, fx, fy, 16 * sz, 19 * sz, 1)
            disc(m, kx, ky, 13 * sz, 1)
            disc(m, jx, jy, 9 * sz, 1)
            if (!far) { const [tx, ty] = [hx, hy + 9 * sz]; disc(m, tx, ty, 15 * sz, 1); tops.push([tx, ty, 12 * sz]) }
            joints.push([kx, ky, 10 * sz, false], [jx, jy, 8 * sz, true])
        }
        vol(s, m, HIDE, 12, far ? -0.3 : 0)
        selOut(s, m, C.void)
        for (const [jx, jy, r, backward] of joints) cap(jx, jy, r, far, backward)
        // the shoulder or hip it swings from: a bone plate over the top of the joint, ridged
        for (const [jx, jy, r] of tops) {
            const tm = mask(s, 'topcap')
            ellipse(tm, jx, jy - r * 0.4, r * 0.95, r * 0.6, 1)
            vol(s, tm, BONE, 6)
            selOut(s, tm, C.bone0)
            line(s, jx - r * 0.6, jy - r * 0.55, jx + r * 0.5, jy - r * 0.7, C.white)
            for (const k of [-0.45, 0, 0.45]) px(s, jx + k * r, jy - r * 0.25, C.stone1)
        }
        // the foot: a broad pad, three heavy claws curling over the ground
        const pm = mask(s, 'pad')
        ellipse(pm, fx + 2 * sz, fy + 1, 14 * sz, 5 * sz, 1)
        vol(s, pm, HIDE, 5, far ? -0.35 : -0.1)
        selOut(s, pm, C.void)
        for (let k = -1; k <= 1; k++) {
            const cx = fx + 2 * sz + k * 8 * sz
            const cy = fy + 2
            poly(s, [cx - 3 * sz, cy - 2, cx + 2 * sz, cy - 3, cx + 8 * sz, cy + 3, cx + 4 * sz, cy + 3], 0, 0, far ? C.bone0 : C.bone1)
            line(s, cx - 2 * sz, cy - 2, cx + 6 * sz, cy + 2, far ? C.stone1 : C.bone0)
            px(s, cx + 8 * sz, cy + 3, far ? C.bone0 : C.white)
        }
    }
    leg(true, true)
    leg(false, true)

    // ── the body: haunch, barrel, sagging belly, the great hump over the shoulders, and a thick neck
    //    down and forward to the head ──
    const [hx0, hy0] = L(-50, -68 + br)
    const [sx0, sy0] = L(30, -76 + br - rear * 8)
    const body = mask(s, 'body')
    {
        const [hx, hy] = L(-40, -64 + br)
        ellipse(body, hx, hy, 24 * sz, 23 * sz, 1)
        const [bx, by] = L(16, -76 + br - rear * 8)
        taper(body, hx, hy, bx, by, 40 * sz, 60 * sz, 1)
        const [gx, gy] = L(2, -60 + br)
        ellipse(body, gx, gy, 24 * sz, 14 * sz, 1)
        const [ux, uy] = L(10, -96 + br - rear * 10)
        disc(body, ux, uy, 29 * sz, 1)
        const [shx, shy] = L(20, -70 + br - rear * 8)
        ellipse(body, shx, shy, 23 * sz, 27 * sz, 1)
        const [n0x, n0y] = L(26, -80 + br - rear * 9)
        const [n1x, n1y] = L(48, -62 + br - lift)
        taper(body, n0x, n0y, n1x, n1y, 40 * sz, 30 * sz, 1)
        vol(s, body, HIDE, 24)
        shag(s, body)
        // veins burning under the hide, branching, hotter each tier
        for (let i = 0; i < 3 + R(lv * 2); i++) {
            let vx = R(hx0 + hash2(i, 5) * (sx0 - hx0))
            let vy = R(hy0 + 6 * sz + hash2(i, 9) * 18 * sz)
            for (let k = 0; k < 6; k++) {
                const nx = vx + 3 + R(hash2(i * 7 + k, 2) * 3)
                const ny = vy - 2 + R(hash2(i * 5 + k, 4) * 5) - 2
                if (!body.get(nx, ny)) break
                line(s, vx, vy, nx, ny, (k + i + R(q(t) * 6)) % 5 === 0 ? C.white : vein)
                vx = nx
                vy = ny
            }
        }
        // the creases that mark out the shoulder and the haunch under the hide
        for (const [cx0, cy0, r, a0, a1] of [[20, -70, 25, 1.5, 3.4], [-40, -62, 23, -0.1, 1.5]] as const) {
            for (let k = 0; k <= 16; k++) {
                const w = a0 + (a1 - a0) * k / 16
                const [ex, ey] = L(cx0 + Math.cos(w) * r, cy0 + br - (cx0 > 0 ? rear * 8 : 0) + Math.sin(w) * r)
                if (!body.get(R(ex), R(ey))) continue
                px(s, ex, ey, C.void)
                px(s, ex - 1, ey - 1, C.night3)
            }
        }
        selOut(s, body, C.void)
    }
    // ── the tail, over the body: out of the top of the rump, heavy at the root, small plates down it, a
    //    club of crystal at its end ──
    {
        const m = mask(s, 'tail')
        const sw = Math.sin(q(t) * 2) * 4
        const [a, b] = L(-54, -68 + br)
        const [c, d] = L(-78, -56 + sw)
        const [e, f] = L(-88, -34 + sw)
        taper(m, a, b, c, d, 22 * sz, 12 * sz, 1)
        disc(m, a, b, 10 * sz, 1)
        taper(m, c, d, e, f, 12 * sz, 7 * sz, 1)
        disc(m, c, d, 6 * sz, 1)
        vol(s, m, HIDE, 8, -0.1)
        selOut(s, m, C.void)
        for (let i = 0; i < 3; i++) {
            const u = 0.2 + i * 0.28
            const tx = a + (c - a) * u * 1.4
            const ty = b + (d - b) * u * 1.4
            const pm = mask(s, 'tplate')
            ellipse(pm, tx - 1, ty - 5 * sz * (1 - u * 0.6), 5 * sz * (1 - u * 0.4), 3 * sz, 1)
            vol(s, pm, OLD_BONE, 3)
            selOut(s, pm, C.stone1)
        }
        crystal(s, e, f, -2.0, 13 * sz, 6 * sz, cr, pulse)
        crystal(s, e + 3, f - 3, -1.4, 10 * sz, 5 * sz, cr, 1 - pulse)
        crystal(s, e - 3, f - 1, -2.6, 8 * sz, 4 * sz, cr, (pulse + 0.5) % 1)
    }


    // the line of its back, from the body just drawn: where the mane grows and the plates lie
    const backAt = (bx: number): number => {
        const cx = R(bx)
        for (let yy = 0; yy < s.h; yy++) if (body.get(cx, yy)) return yy
        return -1
    }

    // ── the crystal mane, growing up out of the back (the plates will sit over its roots) ──
    const count = 6 + R(lv * 2.5)
    for (let i = 0; i < count; i++) {
        const u = i / (count - 1)
        const [bx] = L(-36 + u * 68, 0)
        const by = backAt(bx)
        if (by < 0) continue
        const h = (10 + Math.sin(u * Math.PI) * (9 + lv * 4)) * sz * (0.8 + hash2(i, 3) * 0.4)
        crystal(s, bx, by + 4, -Math.PI / 2 - 0.45 + u * 0.5 + (hash2(i, 7) - 0.5) * 0.3, h, (5 + lv * 0.6) * sz, cr, (pulse + u) % 1)
    }

    // ── bone armour down the back: plates laid along its line, each over the one behind ──
    for (let i = 0; i < 7; i++) {
        const u = i / 6
        const [bx] = L(-40 + u * 72, 0)
        const by = backAt(bx)
        if (by < 0) continue
        const a = Math.atan2(backAt(bx + 5) - backAt(bx - 5), 10)
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        const rx = 11 * sz
        const ry = 5.5 * sz
        const pts: number[] = []
        for (let k = 0; k < 16; k++) {
            const w = k / 16 * Math.PI * 2
            const ex = Math.cos(w) * rx
            const ey = Math.sin(w) * ry
            pts.push(bx + ex * ca - ey * sa, by + 3 + ex * sa + ey * ca)
        }
        const m = mask(s, 'plate')
        poly(m, pts, 0, 0, 1)
        vol(s, m, OLD_BONE, 6)
        selOut(s, m, C.stone1)
        // its lit ridge, and a worn notch at its front edge
        line(s, bx - ca * rx * 0.7, by + 2 - sa * rx * 0.7, bx + ca * rx * 0.6, by + 2 + sa * rx * 0.6, C.bone1)
        px(s, bx + ca * rx * 0.8, by + 3 + sa * rx * 0.8, C.stone1)
    }

    // ── near legs, in front of the body, their round shoulder and hip joints capped in bone ──
    leg(false, false)
    leg(true, false)

    // ── the head: a heavy skull under a bone face-plate, a brow over deep burning sockets, a nasal
    //    ridge down to the nostrils, a real lower jaw, a maw lit from inside, curved boar tusks ──
    {
        // a point on the head, lifted as it rears (the snout a little less)
        const Hp = (dx: number, dy: number): [number, number] => { const [a, b] = L(dx, dy + br); return [a, b - lift * (dx > 60 ? 0.8 : 1)] }
        // the lower jaw, which drops on the roar and the strike
        const open = Math.min(1.3, (esc ? Math.max(0, rear) * 1.3 : 0) + (B.strike ? 1 : 0) + B.wind * 0.3)
        const drop = open * 9
        // the far tusk, behind everything on the head
        {
            const [tx, ty] = Hp(68, -48 + drop)
            tusk(s, tx, ty, (20 + lv * 2) * sz, 5 * sz, true)
        }
        const jm = mask(s, 'jaw')
        {
            const [j0x, j0y] = Hp(46, -52)
            const [j1x, j1y] = Hp(76, -46 + drop)
            taper(jm, j0x, j0y, j1x, j1y, 17 * sz, 11 * sz, 1)
            disc(jm, j1x, j1y, 6 * sz, 1)
            vol(s, jm, HIDE, 8, -0.12)
            selOut(s, jm, C.void)
        }
        // the maw between the jaws: dark, lit from inside as it opens, a row of teeth along each jaw
        {
            const [u0x, u0y] = Hp(56, -56)
            const [u1x, u1y] = Hp(80, -54)
            const [l1x, l1y] = Hp(78, -50 + drop)
            const [l0x, l0y] = Hp(56, -52 + drop * 0.4)
            poly(s, [u0x, u0y, u1x, u1y, l1x, l1y, l0x, l0y], 0, 0, C.void)
            if (open > 0.3) {
                const [gx, gy] = Hp(68, -53 + drop * 0.5)
                disc(s, gx, gy, (2 + open * 3) * sz, lv >= 3 ? C.pink : C.purple1)
                disc(s, gx, gy, (1 + open * 1.5) * sz, C.white)
            }
            for (let k = 0; k < 6; k++) {
                const u = (k + 0.5) / 6
                px(s, u0x + (u1x - u0x) * u, u0y + (u1y - u0y) * u + 1, C.bone1)
                px(s, l0x + (l1x - l0x) * u, l0y + (l1y - l0y) * u - 1, C.bone1)
            }
        }
        // the skull: a round cranium and a heavy snout
        const m = mask(s, 'head')
        {
            const [cx, cy] = Hp(50, -64)
            const [nx, ny] = Hp(80, -58)
            disc(m, cx, cy, 20 * sz, 1)
            taper(m, cx, cy, nx, ny, 30 * sz, 19 * sz, 1)
            disc(m, nx, ny, 9 * sz, 1)
            vol(s, m, HIDE, 12, 0.05)
            selOut(s, m, C.void)
        }
        // the bone face-plate over the brow and down the snout
        const bm = mask(s, 'mask')
        poly(bm, [[36, -80], [46, -88], [60, -85], [72, -74], [84, -63], [86, -57], [80, -57], [70, -61], [58, -64], [46, -66], [36, -71]].flatMap(([a, b]) => Hp(a!, b!)), 0, 0, 1)
        vol(s, bm, BONE, 9)
        selOut(s, bm, C.bone0)
        // the brow ridge: lit along its top, a shadow under it over the sockets
        for (let k = 0; k <= 14; k++) {
            const u = k / 14
            const [a, b] = Hp(44 + u * 24, -78 + u * 6 - Math.sin(u * Math.PI) * 2)
            px(s, a, b - 1, C.white)
            px(s, a, b + 1, C.bone0)
            px(s, a, b + 2, C.stone1)
        }
        // the nasal ridge down to the nostrils, and a crack across the plate
        for (let k = 0; k <= 12; k++) {
            const u = k / 12
            const [a, b] = Hp(68 + u * 15, -70 + u * 10)
            px(s, a, b, C.white)
            px(s, a + 1, b + 1, C.bone0)
        }
        {
            const [a, b] = Hp(52, -84)
            line(s, a, b, a + 3 * sz, b + 4 * sz, C.stone1)
            line(s, a + 3 * sz, b + 4 * sz, a + 2 * sz, b + 8 * sz, C.stone1)
        }
        {
            const [a, b] = Hp(84, -59)
            px(s, a, b, C.void); px(s, a - 2, b + 1, C.void); px(s, a - 1, b, C.void)
        }
        // deep sockets under the brow, eyes burning in them, a glow spilling round
        const eyes = 1 + Math.floor(lv / 2)
        for (let e = 0; e < eyes; e++) {
            const [ex, ey] = Hp(62 - e * 9, -71 + e * 2)
            for (let k = -3; k <= 3; k++) { px(s, ex + k * sz, ey + k * 0.35, C.void); px(s, ex + k * sz, ey + k * 0.35 - 1, C.void) }
            const c = B.hurt ? C.white : lv >= 3 || B.glow > 0.4 ? C.white : C.pink
            px(s, ex, ey, c)
            px(s, ex + 1, ey, c)
            px(s, ex + 2, ey + 1, C.pink)
            px(s, ex - 1, ey, C.pink)
            px(s, ex, ey - 2, C.purple2)
            if (lv >= 2 || B.glow > 0.4) { px(s, ex - 3, ey + 2, C.pink); px(s, ex + 3, ey + 2, C.purple2) }
        }
        // the near tusk, out of the side of the lower jaw, sweeping up past the snout
        {
            const [tx, ty] = Hp(72, -47 + drop)
            tusk(s, tx, ty, (26 + lv * 2.5) * sz, 7.5 * sz, false)
        }
        // horns: a great pair sweeping forward, another pair behind them every two tiers
        const pairs = 1 + Math.floor(lv / 2)
        for (let p = pairs - 1; p >= 0; p--) {
            const [ax, ay] = L(40 - p * 9, -80 - p * 3 + br)
            horn(s, ax, ay - lift, (40 + p * 6 + lv * 3) * sz, (9 - p) * sz, p > 0)
        }
    }

}

/** Shaggy hide over what is drawn in `m`: short strokes raked back. */
function shag(s: S, m: S): void {
    eachPx(m, (px_, py, edge) => { if (!edge && hash2(px_, py) < 0.014) { s.set(px_, py, C.night3); s.set(px_ - 1, py + 1, C.night1) } })
}

/**
 * A boar's tusk from its root in the jaw at (x, y): up and forward out of the jaw, then curving up
 * and back past the snout, tapering to a sharp tip, ringed with ridges, a dark gum where it leaves the jaw. The
 * `far` one is duller and behind the head.
 */
function tusk(s: S, x: number, y: number, len: number, w: number, far: boolean): void {
    const m = mask(s, 'tusk')
    let cx = x
    let cy = y
    const n = 10
    for (let i = 0; i < n; i++) {
        const u = i / n
        const a = -0.45 - u * 1.9
        const nx = cx + Math.cos(a) * len / n
        const ny = cy + Math.sin(a) * len / n
        taper(m, cx, cy, nx, ny, Math.max(1, w * (1 - u * 0.8)), Math.max(1, w * (1 - (u + 1 / n) * 0.8)), 1)
        cx = nx
        cy = ny
    }
    vol(s, m, far ? OLD_BONE : BONE, 5, far ? -0.2 : 0)
    selOut(s, m, far ? C.stone1 : C.bone0)
    eachPx(m, (px_, py) => { if ((px_ * 2 + py) % 6 === 0) s.set(px_, py, far ? C.stone1 : C.bone0) })
    px(s, cx, cy, C.white)
    disc(s, x, y, Math.max(1.5, w * 0.55), far ? C.void : C.night1)
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

/**
 * The escalation, round it: light drawn in from all round as it crouches, rings of its roar rolling off
 * its head, then the slam: a shockwave out across the ground, the new level's ring blazing, earth
 * thrown up both ways and shards of crystal erupting round its feet.
 */
function escalationFx(dst: S, t: number, x: number, y: number, dir: number, sz: number, tier: number): void {
    const q0 = q(t)
    const cx = x + dir * 10 * sz
    const cy = y - 70 * sz
    // gathering
    if (q0 < ESC_PEAK) {
        const fade = q0 > ESC_PEAK - 0.2 ? (ESC_PEAK - q0) / 0.2 : 1
        for (let i = 0; i < 28; i++) {
            if (hash2(i, 7) > fade) continue
            const a = hash2(i, 3) * Math.PI * 2
            const r = (1 - ((q0 * 1.6 + hash2(i, 5)) % 1)) * 110
            dst.set(R(cx + Math.cos(a) * r), R(cy + Math.sin(a) * r * 0.7), i % 3 ? C.pink : C.white)
        }
    }
    // the roar, off its head
    const hx = x + dir * 64 * sz
    const hy = y - 96 * sz
    for (let k = 0; k < 3; k++) {
        const t0 = RAMPAGE_ROAR + k * 0.16
        shockRing(dst, hx, hy, t, t0, 0.4, 6, 50 + k * 8, k & 1 ? C.white : C.pink)
        shockRing(dst, hx, hy, t, t0, 0.4, 5, 49 + k * 8, k & 1 ? C.pink : C.white)
    }
    // the roar's force: streaks bursting off its head
    const rr = (q0 - RAMPAGE_ROAR) / (RAMPAGE_SLAM - RAMPAGE_ROAR)
    if (rr > 0 && rr < 1) {
        for (let i = 0; i < 12; i++) {
            const a = -Math.PI * 0.85 + i / 11 * Math.PI * 0.95
            const d0 = 16 + ((rr * 3 + hash2(i, 29)) % 1) * 40
            const ax = Math.cos(a) * dir
            const ay = Math.sin(a)
            line(dst, R(hx + ax * d0), R(hy + ay * d0), R(hx + ax * (d0 + 8)), R(hy + ay * (d0 + 8)), i & 1 ? C.white : C.pink)
        }
    }
    // the slam
    const g = x + dir * 26 * sz
    shockRing(dst, g, y - 1, t, RAMPAGE_SLAM, 0.6, 12, 150, C.white, true)
    shockRing(dst, g, y - 1, t, RAMPAGE_SLAM + 0.08, 0.55, 8, 110, C.pink, true)
    debris(dst, g - dir * 20, y - 2, y, t, RAMPAGE_SLAM, 16, 150, 'dust', 71 + tier, 0.9)
    debris(dst, g + dir * 20, y - 2, y, t, RAMPAGE_SLAM, 16, 150, 'dust', 81 + tier, 0.9)
    debris(dst, g, y - 4, y, t, RAMPAGE_SLAM, 12, 120, 'arcane', 91 + tier, 0.8)
    const e = (q0 - RAMPAGE_SLAM) / 0.7
    if (e > 0 && e < 1) {
        const grow = sm(Math.min(1, e / 0.2))
        const sink = e > 0.6 ? 1 - (e - 0.6) / 0.4 : 1
        // shards of crystal breaking out of the ground all along the shockwave's first reach
        for (let i = 0; i < 11; i++) {
            const dx = (i - 5) * 17 * sz + (hash2(i, 13) - 0.5) * 8
            const h = R((16 + hash2(i, 17) * 20) * sz * grow * sink * (1 - Math.abs(i - 5) * 0.06))
            if (h > 1) spike(dst, R(g + dx), R(y + 3 + (i & 1) * 3), h, 6, R((i - 5) * 1.6), C.purple0, C.pink, C.white)
        }
        // dust rolling out both ways, thinning
        const level = Math.max(1, R(14 * (1 - e)))
        for (const side of [-1, 1]) {
            for (let k = 0; k < 4; k++) {
                const cx0 = R(g + side * (30 + e * (70 + k * 22)))
                const cy0 = R(y - 5 - k * 3 - e * 10)
                const r0 = 7 + e * 12 + k * 2
                for (let yy = -R(r0); yy <= R(r0); yy++) for (let xx = -R(r0); xx <= R(r0); xx++) {
                    if (xx * xx + yy * yy * 2.2 > r0 * r0) continue
                    if (!bayer(cx0 + xx, cy0 + yy, level)) continue
                    dst.set(cx0 + xx, cy0 + yy, yy < -r0 * 0.25 ? C.bone1 : C.bone0)
                }
            }
        }
        // the new level's ring, blazing as it comes in
        if (e < 0.4) {
            const rx = 62 + (tier + 1) * 10
            for (let a = 0; a < Math.PI * 2; a += 0.03) {
                dst.set(x + R(Math.cos(a) * rx), y - 2 + R(Math.sin(a) * rx * 0.1), C.white)
                dst.set(x + R(Math.cos(a) * rx), y - 1 + R(Math.sin(a) * rx * 0.1), C.pink)
            }
        }
    }
}

function rampantDef(tier: number): CreatureDef {
    const def: CreatureDef = {
        name: `The Rampant — rampage ${tier + 1}`, size: 256, room: 12, shadow: 64, accent: C.pink,
        states: {
            idle: { dur: 1.2, loop: true }, attack: { dur: 1.2, loop: false }, hit: { dur: 0.5, loop: false },
            escalate: { dur: ESC_DUR, loop: false }
        },
        draw: (s, st, t) => rampantDraw(tier, s, st, t, def),
        fx(dst, st, t, x, y, dir) {
            // the aura ring IS the level read — no HP bar exists for this boss
            const up = st === 'escalate' ? escUp(t) : 0
            const lv = tier + Math.min(1, up)
            const k = fr(t, 10, 4)
            for (let r = 0; r <= Math.floor(lv); r++) {
                const rx = 62 + r * 10 + (k & 1)
                for (let a = 0; a < Math.PI * 2; a += 0.06) {
                    const px2 = x + R(Math.cos(a) * rx)
                    const py2 = y - 2 + R(Math.sin(a) * rx * 0.1)
                    if (((a * 20) | 0) % (4 - Math.min(3, r)) === 0) dst.set(px2, py2, r >= 3 ? C.white : r >= 2 ? C.pink : C.purple2)
                }
            }
            if (st === 'escalate') escalationFx(dst, t, x, y, dir, 0.8 + (tier + up) * 0.06, tier)
            if (st === 'attack' && B.strike) for (let i = 0; i < 14; i++) dst.set(x + dir * (76 + i * 2), y - 2 - (i % 5), i & 1 ? C.pink : C.purple2)
        }
    }
    return def
}

export const RAMPANT = Array.from({ length: RAMPAGE_TIERS }, (_, i) => rampantDef(i))
