// Guild Raid (solo_boss): the Gilded Warlord, a champion the guild could not beat, come back
// mounted. A knight-king on an armoured warhorse: crimson barding trimmed in gold with his sun on
// the flank, gold plate, a great helm crowned in spikes, a banner on his back and a couched lance.
// Horse and rider move as one body about the hind hooves: they rear on the wind-up and the roar,
// charge and level the lance on the strike, and pitch forward when he falls.

import { C } from './palette'
import type { CreatureDef } from './creature'
import { fr } from './creature'
import { B, Entry, bossStates, drive, finish, bz, chain, elbow, P, rect, px, line, disc, tri, poly, taper, wv, q } from './boss-kit'
import { mask, vol, eachPx, selOut, rot, T, type Mat5 } from './raid-kit'

const R = Math.round

const COAT: Mat5 = { ramp: [C.steel0, C.steel1, C.steel2, C.steel3], hi: C.white, rim: C.steel1 }
const CLOTH: Mat5 = { ramp: [C.red0, C.red1, C.red2, C.red3], hi: C.red3, rim: C.red1 }
const GOLD: Mat5 = { ramp: [C.gold0, C.gold1, C.gold2, C.gold3], hi: C.white, rim: C.gold1 }
const MANE = [C.bone0, C.bone1, C.white] as const
const PLUME = [C.red1, C.red2, C.red3] as const

export const GILDED_WARLORD: CreatureDef = {
    name: 'The Gilded Warlord', size: 256, room: 18, shadow: 58, accent: C.gold3,
    states: bossStates(1.6, 2.0, 2.4),
    draw(s, st, t) {
        drive(this, st, t, 16, 2.0)
        const bx = s.ax - 8 + B.lunge - B.kb
        const by = s.ay
        // the whole mount turns about its hind hooves: up on the wind-up and the roar, into the
        // thrust, and over onto its chest as it falls
        const rear = st === 'death' ? 0.24 * B.die : B.roar ? -0.16 : bz(0, -0.18, 0.05)
        const sink = R(B.die * 22)
        const pvx = bx - 30
        const at = (x: number, y: number): [number, number] => { rot(bx + x, by + y + sink, pvx, by, rear); return [T.x, T.y] }
        const flutter = q(t) * 5
        const breath = B.breath
        // the near foreleg paws the ground now and then while he waits
        const paw = st === 'idle' ? Math.max(0, Math.sin(q(t) / 2.0 * Math.PI * 2)) : 0

        // ── the banner on his back, behind everything ──
        {
            const [p0x, p0y] = at(-14, -96 + breath)
            const [p1x, p1y] = at(-18, -142 + breath)
            line(s, p0x, p0y, p1x, p1y, C.brown1, 2)
            const m = mask(s, 'banner')
            const pts: number[] = []
            for (let i = 0; i <= 6; i++) {
                const u = i / 6
                const [x, y] = at(-18 - u * 22, -138 + breath + Math.sin(flutter + u * 3) * 2 * u)
                pts.push(x, y)
            }
            for (let i = 6; i >= 0; i--) {
                const u = i / 6
                const [x, y] = at(-18 - u * 22, -104 + breath + Math.sin(flutter + u * 3 + 1) * 3 * u + (i === 6 ? -6 : 0))
                pts.push(x, y)
            }
            poly(m, pts, 0, 0, 1)
            vol(s, m, CLOTH, 8, -0.1)
            eachPx(m, (x, y, edge) => { if (edge) s.set(x, y, C.gold2) })
            const [ex, ey] = at(-29, -122 + breath)
            sun(s, ex, ey, 4)
            disc(s, p1x, p1y, 2, C.gold2); px(s, p1x - 1, p1y - 1, C.white)
        }

        // ── far legs, in shadow ──
        const fore = (near: boolean): [number, number, number, number] => {
            const dx = near ? 0 : -4
            if (st === 'attack' || st === 'entry') {
                // rearing: the forelegs tuck up under the chest
                const k = Math.max(B.wind, B.roar ? 1 : 0)
                return [dx + 30 + 6 * k, -22 - 14 * k, dx + 28 + 8 * k, -3 - 22 * k]
            }
            if (near && paw > 0.3) return [36, -26 - R(paw * 4), 40, -12 - R(paw * 6)]
            return [dx + 30, -22, dx + 28, -3]
        }
        const leg = (hx: number, hy: number, kx: number, ky: number, fx: number, fy: number, far: boolean): void => {
            const m = mask(s, 'leg')
            const [a1, b1] = at(hx, hy)
            const [a2, b2] = at(kx, ky)
            const [a3, b3] = at(fx, fy)
            taper(m, a1, b1, a2, b2, 12, 8, 1)
            taper(m, a2, b2, a3, b3, 7, 6, 1)
            disc(m, a2, b2, 4, 1)
            vol(s, m, COAT, 8, far ? -0.3 : 0)
            if (!far) selOut(s, m, C.steel0)
            // a feathered fetlock and a dark hoof
            for (let i = -2; i <= 2; i++) px(s, R(a3 + i), R(b3 - 3 - (i & 1)), far ? MANE[0] : MANE[1])
            rect(s, R(a3 - 4), R(b3 - 2), 8, 3, far ? C.ink : C.steel0)
            px(s, R(a3 - 3), R(b3 - 2), far ? C.steel0 : C.steel2)
        }
        {
            const [kx, ky, fx, fy] = fore(false)
            leg(18, -44, kx, ky, fx, fy, true)
            leg(-28, -44, -38, -20, -32, -3, true)
        }

        // ── the tail, streaming back: one flowing volume, strands drawn down it ──
        {
            const m = mask(s, 'tail')
            const sw = Math.sin(flutter * 0.6) * 3
            const spine: [number, number][] = []
            for (let i = 0; i <= 10; i++) {
                const u = i / 10
                spine.push(at(-50 - u * 18 + Math.sin(u * 2.4) * 5 + sw * u, -62 + u * 46))
            }
            for (let i = 0; i < 10; i++) {
                const u = i / 10
                taper(m, spine[i]![0], spine[i]![1], spine[i + 1]![0], spine[i + 1]![1], 6 + Math.sin(u * Math.PI) * 8, 6 + Math.sin((u + 0.1) * Math.PI) * 8 - (i === 9 ? 5 : 0), 1)
            }
            vol(s, m, { ramp: [C.bone0, C.bone1, C.white], hi: C.white, rim: C.bone0 }, 8, -0.15)
            eachPx(m, (x, y, edge) => { if (!edge && ((x * 3 + y) % 7 === 0)) s.set(x, y, C.bone0) })
        }

        // ── the horse: body, neck and head as one volume ──
        {
            const m = mask(s, 'horse')
            const b = (x: number, y: number) => at(x, y + breath * 0.5)
            const [hx, hy] = b(-32, -56)
            const [cx, cy] = b(26, -54)
            taper(m, hx, hy, cx, cy, 34, 30, 1)
            disc(m, hx, hy, 17, 1)
            disc(m, cx, cy, 16, 1)
            // the neck, arched at the crest
            const [n0x, n0y] = b(20, -60)
            const [n1x, n1y] = b(31, -78)
            const [n2x, n2y] = b(40, -91)
            taper(m, n0x, n0y, n1x, n1y, 23, 17, 1)
            taper(m, n1x, n1y, n2x, n2y, 17, 13, 1)
            const [crx, cry] = b(28, -80)
            disc(m, crx, cry, 7, 1)
            const [h0x, h0y] = b(40, -93)
            const [h1x, h1y] = b(66, -76)
            taper(m, h0x, h0y, h1x, h1y, 15, 10, 1)
            disc(m, h0x + 1, h0y + 2, 8, 1)
            disc(m, h1x, h1y, 5.5, 1)
            const [e0x, e0y] = b(40, -98)
            tri(m, e0x - 2, e0y + 3, e0x + 2, e0y + 2, e0x - 1, e0y - 5, 1) // the ear
            vol(s, m, COAT, 12)
            // the eye, a nostril, the bit
            const [ex, ey] = b(48, -89)
            px(s, R(ex), R(ey), C.ink); px(s, R(ex) + 1, R(ey), C.ink); px(s, R(ex), R(ey) - 1, C.white)
            const [nx, ny] = b(67, -77)
            px(s, R(nx), R(ny), C.ink); px(s, R(nx) - 1, R(ny) + 1, C.steel0)
            const [mx, my] = b(62, -71)
            line(s, mx, my, mx + 4, my - 1, C.steel0) // the mouth
            const [bx2, by2] = b(58, -73)
            disc(s, bx2, by2, 1.5, C.gold2)
        }
        // the mane, down the crest of the neck
        for (let i = 0; i < 6; i++) {
            const u = i / 5
            const sw = Math.sin(flutter * 0.7 + i * 0.9) * 2
            const [x0, y0] = at(24 + u * 16, -70 - u * 22 + breath * 0.5)
            const [cx, cy] = at(18 + u * 14 + sw, -62 - u * 20)
            const [x1, y1] = at(12 + u * 12 + sw * 1.5, -54 - u * 16)
            chain(s, x0, y0, cx, cy, x1, y1, 2.5, 1, MANE, 8)
        }

        // ── the barding: crimson, scalloped, trimmed in gold, his sun on the flank ──
        {
            const m = mask(s, 'barding')
            const top = [[-50, -60], [-34, -68], [-12, -70], [10, -68], [28, -62], [40, -50], [42, -30]]
            const pts: number[] = []
            for (const [x, y] of top) { const [a, b] = at(x!, y! + breath * 0.5); pts.push(a, b) }
            for (let x = 38; x >= -52; x -= 6) { const [a, b] = at(x, -30 + Math.sin(flutter * 0.5 + x * 0.2) * 1.2); pts.push(a, b) }
            const [a0, b0] = at(-56, -46)
            pts.push(a0, b0)
            poly(m, pts, 0, 0, 1)
            // scallops along the hem
            for (let x = 38; x >= -50; x -= 8) { const [a, b] = at(x, -30); disc(m, a, b, 3.5, 1) }
            vol(s, m, CLOTH, 14, 0.05)
            // folds hanging from the saddle, and the hem trimmed and fringed in gold
            // a few deep folds falling from the saddle, each lit along its near side
            for (const fx of [-42, -26, 8, 26]) {
                for (let k = 0; k <= 28; k++) {
                    const [x, y] = at(fx + Math.sin(k * 0.18 + fx) * 2 + (fx < 0 ? -k * 0.12 : k * 0.12), -60 + k)
                    if (m.get(R(x), R(y)) && m.get(R(x), R(y) + 2)) { s.set(R(x), R(y), C.red0); s.set(R(x) - 1, R(y), C.red3) }
                }
            }
            // the hem trimmed and fringed in gold
            eachPx(m, (x, y, _edge, below) => {
                if (below && y > by - 40 + sink) { s.set(x, y, C.gold2); s.set(x, y - 1, C.gold3); if ((x & 3) === 0) s.set(x, y + 1, C.gold1) }
            })
            const [sx, sy] = at(-10, -48 + breath * 0.5)
            sun(s, sx, sy, 7)
            // the saddle
            const [q0x, q0y] = at(-18, -70)
            const [q1x, q1y] = at(4, -70)
            taper(s, q0x, q0y, q1x, q1y, 5, 5, C.brown1)
            line(s, q0x, q0y - 2, q1x, q1y - 2, C.brown2)
        }
        // the crinet: gold plates down the neck, and the chanfron with its spike and plume
        {
            // the crinet: a row of small lames along the crest, each lit on its leading edge
            for (let i = 0; i < 5; i++) {
                const u = i / 4
                const [x0, y0] = at(22 + u * 16, -66 - u * 23 + breath * 0.5)
                const [x1, y1] = at(26 + u * 16, -71 - u * 23 + breath * 0.5)
                taper(s, x0, y0, x1, y1, 6, 5, C.gold1)
                line(s, x0 - 1, y0 - 2, x1 - 1, y1 - 2, C.gold3)
                px(s, R(x0) + 2, R(y0) + 2, C.gold0)
            }
            // the chanfron: a gold strip down the face, a ruby set in it
            const f = mask(s, 'chanfron')
            const [c0x, c0y] = at(45, -97 + breath * 0.5)
            const [c1x, c1y] = at(64, -80 + breath * 0.5)
            taper(f, c0x, c0y, c1x, c1y, 6, 4, 1)
            vol(s, f, GOLD, 5)
            const [gx, gy] = at(52, -91 + breath * 0.5)
            px(s, R(gx), R(gy), C.red3); px(s, R(gx) + 1, R(gy), C.red1)
            for (let i = 0; i < 3; i++) {
                const [x0, y0] = at(40, -98 + breath * 0.5)
                const [x1, y1] = at(28 - i * 4 + Math.sin(flutter + i) * 2, -104 + i * 4)
                chain(s, x0, y0, (x0 + x1) / 2, Math.min(y0, y1) - 4, x1, y1, 3, 1.5, PLUME, 10)
            }
        }

        // ── near legs, over the barding ──
        {
            const [kx, ky, fx, fy] = fore(true)
            leg(24, -40, kx, ky, fx, fy, false)
            leg(-22, -40, -32, -20, -26, -3, false)
        }

        // ── the rider ──
        const rb = breath
        // his near leg in its stirrup
        {
            const m = mask(s, 'rleg')
            const [t0x, t0y] = at(-6, -76 + rb)
            const [t1x, t1y] = at(8, -62)
            const [t2x, t2y] = at(4, -46)
            taper(m, t0x, t0y, t1x, t1y, 11, 8, 1)
            taper(m, t1x, t1y, t2x, t2y, 7, 6, 1)
            const [f0x, f0y] = at(10, -44)
            taper(m, t2x, t2y, f0x, f0y, 5, 4, 1)
            vol(s, m, GOLD, 8)
            selOut(s, m, C.gold0)
            disc(s, t1x, t1y, 2.5, C.gold3); px(s, R(t1x) - 1, R(t1y) - 1, C.white) // the poleyn
        }
        // his torso: gold plate under a crimson tabard with his sun on it
        {
            const m = mask(s, 'torso')
            const pts: number[] = []
            for (const [x, y] of [[-14, -76], [8, -76], [12, -92], [10, -106], [-14, -106], [-18, -92]]) { const [a, b] = at(x!, y! + rb); pts.push(a, b) }
            poly(m, pts, 0, 0, 1)
            vol(s, m, GOLD, 10)
            selOut(s, m, C.gold0)
            const tb = mask(s, 'tabard')
            const tp: number[] = []
            for (const [x, y] of [[-6, -74], [8, -74], [10, -92], [6, -100], [-4, -100]]) { const [a, b] = at(x!, y! + rb); tp.push(a, b) }
            poly(tb, tp, 0, 0, 1)
            vol(s, tb, CLOTH, 8, 0.05)
            eachPx(tb, (x, y, edge) => { if (edge) s.set(x, y, C.gold2) })
            const [cx, cy] = at(2, -90 + rb)
            sun(s, cx, cy, 3)
            const [w0x, w0y] = at(-16, -80 + rb)
            const [w1x, w1y] = at(10, -80 + rb)
            line(s, w0x, w0y, w1x, w1y, C.brown0, 2)
            const [kx, ky] = at(2, -80 + rb)
            rect(s, R(kx) - 1, R(ky) - 1, 3, 3, C.gold3) // the buckle
        }
        // his great pauldron, layered, a crest of spikes along it
        {
            const m = mask(s, 'pauldron')
            const [px1, py1] = at(4, -102 + rb)
            disc(m, px1, py1, 10, 1)
            const [px2, py2] = at(6, -94 + rb)
            disc(m, px2, py2, 7, 1)
            vol(s, m, GOLD, 10)
            selOut(s, m, C.gold0)
            for (let i = 0; i < 3; i++) { const [a, b] = at(-2 + i * 4, -96 + i * 2 + rb); line(s, a, b, a + 7, b - 2, C.gold0) }
            for (let i = 0; i < 4; i++) {
                const [a, b] = at(-4 + i * 5, -111 + Math.abs(i - 1.5) + rb)
                tri(s, a - 1, b + 2, a + 2, b + 2, a, b - 4, C.gold2)
                px(s, R(a), R(b) - 4, C.white)
            }
        }
        // his great helm, crowned, a crimson plume sweeping back from the crown
        {
            const hy = -120 + rb + R(bz(0, -2, 2))
            for (let i = 0; i < 4; i++) {
                const [x0, y0] = at(0, hy - 8)
                const [cx, cy] = at(-10 - i * 3, hy - 16 + i + Math.sin(flutter + i) * 1.5)
                const [x1, y1] = at(-22 - i * 3 + Math.sin(flutter * 0.8 + i) * 2, hy - 4 + i * 3)
                chain(s, x0, y0, cx, cy, x1, y1, 4 - i * 0.5, 2, PLUME, 12)
            }
            const m = mask(s, 'helm')
            const [h0x, h0y] = at(4, hy)
            disc(m, h0x, h0y - 2, 9, 1)
            const [h1x, h1y] = at(4, hy + 7)
            taper(m, h0x, h0y, h1x, h1y, 17, 15, 1)
            vol(s, m, GOLD, 12)
            // the visor slit and the breaths, eyes burning in the dark of it
            const [vx, vy] = at(4, hy + 1)
            rect(s, R(vx) - 2, R(vy), 12, 2, C.ink)
            const eye = B.hurt ? C.white : B.glow > 0.4 ? C.white : C.red3
            px(s, R(vx) + 5, R(vy), eye); px(s, R(vx) + 8, R(vy), eye)
            if (B.glow > 0.4) { px(s, R(vx) + 5, R(vy) - 1, C.red3); px(s, R(vx) + 8, R(vy) - 1, C.red3) }
            for (let i = 0; i < 3; i++) px(s, R(vx) + 5 + i * 2, R(vy) + 4, C.gold0)
            // the crown: a band and five spikes, a ruby in the middle one
            const [cx, cy] = at(4, hy - 10)
            rect(s, R(cx) - 8, R(cy), 17, 2, C.gold2)
            rect(s, R(cx) - 8, R(cy), 17, 1, C.gold3)
            for (let i = 0; i < 5; i++) {
                const sx = R(cx) - 8 + i * 4
                const h = i === 2 ? 6 : i === 0 || i === 4 ? 3 : 4
                tri(s, sx - 1, R(cy), sx + 1, R(cy), sx, R(cy) - h, C.gold2)
                px(s, sx, R(cy) - h, C.gold3)
            }
            px(s, R(cx), R(cy) + 1, C.red3); px(s, R(cx) + 1, R(cy) + 1, C.red1)
        }

        // ── the lance, and the arm that holds it ──
        {
            const [shx, shy] = at(6, -100 + rb)
            const hand = st === 'attack' ? [bz(20, 6, 34), bz(-86, -94, -84)] : st === 'death' ? [22, -80] : [20, -86]
            const [hx, hy] = at(hand[0]!, hand[1]!)
            // at rest the lance leans forward; drawn back on the wind-up, it levels for the thrust
            const a = (st === 'attack' ? bz(-0.75, -0.5, 0.02) : st === 'death' ? -0.75 + B.die * 1.2 : -0.75 + wv(t, 2.0, 1) * 0.02) + rear
            const ca = Math.cos(a)
            const sa = Math.sin(a)
            const bxl = hx - ca * 20
            const byl = hy - sa * 20
            const txl = hx + ca * 72
            const tyl = hy + sa * 72
            // the shaft, striped crimson and gold, tapering to the point
            const m = mask(s, 'lance')
            taper(m, bxl, byl, txl, tyl, 5, 2, 1)
            vol(s, m, CLOTH, 4)
            for (let k = 0; k < 92; k += 7) {
                const x = bxl + ca * k
                const y = byl + sa * k
                const w = 2 - k / 92
                line(s, x - sa * w, y + ca * w, x + ca * 2 + sa * w, y + sa * 2 - ca * w, C.gold2)
            }
            // the vamplate, a gold cone before the hand
            const vm = mask(s, 'vamp')
            const vx = hx + ca * 6
            const vy = hy + sa * 6
            poly(vm, [hx - sa * 7, hy + ca * 7, hx + sa * 7, hy - ca * 7, vx + ca * 8, vy + sa * 8], 0, 0, 1)
            vol(s, vm, GOLD, 6)
            // the steel point and its glint
            poly(s, [txl - sa * 3, tyl + ca * 3, txl + sa * 3, tyl - ca * 3, txl + ca * 12, tyl + sa * 12], 0, 0, C.steel2)
            line(s, txl - sa * 2, tyl + ca * 2, txl + ca * 11, tyl + sa * 11, C.white)
            // the pennant, a crimson swallowtail flying back from below the point
            const pk = 60
            const pxx = hx + ca * pk
            const pyy = hy + sa * pk
            const fl = Math.sin(flutter * 1.3) * 3
            const pm = mask(s, 'pennant')
            poly(pm, [pxx, pyy, pxx - ca * 14, pyy - sa * 14, pxx - ca * 26 + 3, pyy - sa * 26 + 10 + fl, pxx - ca * 18 + 2, pyy - sa * 18 + 6 + fl, pxx - ca * 28 + 5, pyy - sa * 28 + 16 + fl, pxx - ca * 8 + 2, pyy - sa * 8 + 9], 0, 0, 1)
            vol(s, pm, CLOTH, 6)
            eachPx(pm, (x, y, edge) => { if (edge && ((x + y) & 1)) s.set(x, y, C.gold2) })
            // the arm over it: upper arm and vambrace, the gauntlet closed on the shaft
            elbow(shx, shy, hx, hy, 14, 14, 1)
            const am = mask(s, 'arm')
            taper(am, shx, shy, P.x, P.y, 9, 7, 1)
            taper(am, P.x, P.y, hx, hy, 7, 6, 1)
            disc(am, P.x, P.y, 3.5, 1)
            disc(am, hx, hy, 4, 1)
            vol(s, am, GOLD, 8)
            selOut(s, am, C.gold0)
            px(s, R(P.x) - 1, R(P.y) - 1, C.white)
        }
        finish(s, Entry.Walk, 0)
    },
    fx(dst, st, t, x, y, dir) {
        const k = fr(t, 10, 8)
        // dust thrown up under the hooves on the charge
        if (st === 'attack' && (B.strike || B.rec > 0.6)) {
            for (let i = 0; i < 14; i++) dst.set(x + dir * (-40 + ((i * 17 + k * 9) % 90)), y - 1 - ((i * 7 + k) % 6), i & 1 ? C.stone3 : C.bone0)
        }
        // his roar: gold motes shaken off the banner
        if (B.roar) for (let i = 0; i < 10; i++) dst.set(x + dir * (-50 + ((i * 13 + k * 5) % 60)), y - 120 + ((i * 11 + k * 3) % 40), i & 1 ? C.gold3 : C.gold2)
    }
}

/** His sun: a gold disc with a ruby heart and eight rays, `r` px round, at (x, y). */
function sun(s: Parameters<CreatureDef['draw']>[0], x: number, y: number, r: number): void {
    const cx = R(x)
    const cy = R(y)
    for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2
        line(s, cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, cx + Math.cos(a) * (r + 1), cy + Math.sin(a) * (r + 1), i & 1 ? C.gold1 : C.gold2)
    }
    disc(s, cx, cy, Math.max(1, r * 0.55), C.gold2)
    if (r >= 4) { disc(s, cx, cy, Math.max(1, r * 0.3), C.red2); px(s, cx - 1, cy - 1, C.gold3) } else px(s, cx, cy, C.gold3)
}
