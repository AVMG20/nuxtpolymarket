// Guild Raid (solo_boss): the Gilded Warlord, a champion the guild could not beat, come back
// mounted. A knight-king on an armoured warhorse: crimson barding trimmed in gold with his sun on
// the flank, a gold crinet, peytral, crupper and chanfron on the horse; gold plate on the rider
// from a great helm crowned in spikes down to spurred sabatons, a banner on his back and a lance.
//
// Horse and rider move as one body about the hind hooves: they rear on the wind-up and the roar,
// pitch into the charge on the strike (the lance stabbing down into the party), and over onto the
// chest as he falls. He enters at a gallop, braking into a rear.
//
// Drawn back to front, each layer over the one behind it: the banner, the far legs, the tail, the
// horse, the near legs, the barding (whose hem hangs over the tops of the near legs), the horse's
// plate, the saddle's cantle, the rider's far arm and reins, his sword, the saddle, his near leg,
// his body, his helm, the lance, then the near arm and pauldron over the lance.

import { C } from './palette'
import type { BossSpecial, CreatureDef } from './creature'
import { fr } from './creature'
import type { Surface } from './surface'
import { B, Entry, ENTRY_SETTLED, bossStates, withSpecial, spAttack, drive, finish, shift, bz, chain, elbow, P, rect, px, line, disc, tri, poly, taper, wv, q, hash2 } from './boss-kit'
import { mask, vol, eachPx, selOut, rot, T, type Mat5 } from './raid-kit'
import { sp, sq, hitTarget, chest, debris } from './special-kit'
import { blast, shockRing, type Ramp6 } from './vfx-cinematic'

const R = Math.round

const COAT: Mat5 = { ramp: [C.steel0, C.steel1, C.steel2, C.steel3], hi: C.white, rim: C.steel1 }
const CLOTH: Mat5 = { ramp: [C.red0, C.red1, C.red2, C.red3], hi: C.red3, rim: C.red1 }
const GOLD: Mat5 = { ramp: [C.gold0, C.gold1, C.gold2, C.gold3], hi: C.white, rim: C.gold1 }
const LEATHER: Mat5 = { ramp: [C.brown0, C.brown1, C.brown2, C.brown3], hi: C.brown3, rim: C.brown1 }
const MANE = [C.bone0, C.bone1, C.white] as const
const PLUME = [C.red1, C.red2, C.red3] as const

/** Px the entry gallops in from, and the strides it takes to cover them. */
const GALLOP_FROM = 170
const GALLOP_STRIDES = 2.6
/** Px a hoof sweeps through a stride. */
const STRIDE = 28

/** A leg: its hip, its foot at rest, and where it falls in the gallop's beat. */
interface Leg { hx: number, hy: number, fx: number, fy: number, fore: boolean, beat: number }
const FAR_FORE: Leg = { hx: 18, hy: -44, fx: 24, fy: -3, fore: true, beat: 0.45 }
const NEAR_FORE: Leg = { hx: 24, hy: -40, fx: 28, fy: -3, fore: true, beat: 0.57 }
const FAR_HIND: Leg = { hx: -28, hy: -44, fx: -32, fy: -3, fore: false, beat: 0 }
const NEAR_HIND: Leg = { hx: -22, hy: -40, fx: -26, fy: -3, fore: false, beat: 0.12 }

/** Lance hand x, y and angle per state: at rest, wound up, struck (x, y, x, y, x, y, a, a, a). */
const LANCE: Readonly<Record<string, readonly number[]>> = {
    attack: [22, -88, 6, -104, 30, -80, -0.62, -1.05, 0.55],
    special: [22, -88, 10, -100, 28, -86, -0.62, -0.95, -0.24],
    special2: [22, -88, 12, -118, 30, -80, -0.62, -1.55, 0.5]
}

const HOLY6: Ramp6 = [C.white, C.white, C.gold3, C.gold2, C.gold1, C.gold0]

/** Seconds each special runs, and the px the charge carries him forward. */
const CHARGE_DUR = 2.6
const JUDGEMENT_DUR = 2.8
const CHARGE_REACH = 64

/**
 * Sunlance Charge: he rears and wheels, then gallops through the front rank with the lance levelled,
 * a wake of gold streaming off it, and runs the nearest three through one after another.
 */
const SUNLANCE_CHARGE: BossSpecial = {
    name: 'Sunlance Charge', tint: 'dusk0', hits: [1.34, 1.44, 1.54], spread: true,
    fx(s, t, st) {
        const d = st.dir
        // pawing and wheeling: dust kicked up behind him
        for (let k = 0; k < 3; k++) debris(s, st.bx - d * 40, st.by - 2, st.by, t, 0.15 + k * 0.25, 8, 60, 'dust', 31 + k, 0.5)
        // the charge: gold streaming back off the levelled lance, dust in his wake
        const u = sp(t, 0.9, 1.3)
        const back = sp(t, 1.9, 2.4)
        if (u > 0 && back < 1) {
            const hx = st.bx + d * (CHARGE_REACH * u * (1 - back) + 60)
            const fade = 1 - back
            for (let i = 0; i < 14; i++) {
                if (hash2(i, 7) > fade) continue
                const len = 10 + (i * 7) % 18
                const y = st.by - 84 + ((i * 5) % 11) - 5
                const x0 = hx - d * (4 + (i * 13) % 50)
                line(s, R(x0), y, R(x0 - d * len), y, i % 3 === 0 ? C.white : i & 1 ? C.gold3 : C.gold2)
            }
            for (let i = 0; i < 10; i++) {
                const x0 = hx - d * (30 + (i * 17) % 60)
                const y = st.by - 1 - (i * 3) % 7
                line(s, R(x0), y, R(x0 - d * 6), y, i & 1 ? C.stone3 : C.bone0)
            }
        }
        // the impacts: each of the front three run through, a burst of gold light and earth
        for (let i = 0; i < 3; i++) {
            const pt = hitTarget(st, i, true)
            const t0 = SUNLANCE_CHARGE.hits[i]!
            blast(s, pt.x, chest(pt), t, t0, 10, 0.5, HOLY6, 41 + i, 'holy')
            debris(s, pt.x, pt.y - 2, pt.y, t, t0, 10, 100, 'dust', 51 + i)
        }
        const f = st.party[0]!
        shockRing(s, f.x, f.y - 1, t, 1.34, 0.5, 4, 34, C.gold3, true)
    }
}

/**
 * Judgement of the Sun: he rears and raises the lance to the sky, a sun gathers over the party,
 * and as he drives the lance down it rains spears of light onto every one of them in turn.
 */
const JUDGEMENT: BossSpecial = {
    name: 'Judgement of the Sun', tint: 'night1', hits: [1.5, 1.59, 1.68, 1.77, 1.86, 1.95], spread: true,
    fx(s, t, st) {
        const q0 = sq(t)
        let cx = 0
        for (const pt of st.party) cx += pt.x
        cx = R(cx / st.party.length)
        const cy = st.by - 104
        // the sun gathering: motes drawn in from all round, its disc swelling and its rays turning
        const g = sp(t, 0.3, 1.35)
        const out = sp(t, 2.0, 2.5)
        if (g > 0 && out < 1) {
            if (g < 1) {
                for (let i = 0; i < 20; i++) {
                    const a = hash2(i, 3) * Math.PI * 2
                    const r = (1 - ((g * 2 + hash2(i, 5)) % 1)) * 60
                    s.set(R(cx + Math.cos(a) * r), R(cy + Math.sin(a) * r * 0.7), i & 1 ? C.gold3 : C.white)
                }
            }
            const r = R((3 + g * 9) * (1 - out))
            if (r > 0) {
                const spin = q0 * 1.5
                for (let i = 0; i < 12; i++) {
                    const a = spin + i / 12 * Math.PI * 2
                    const len = r + 4 + (i & 1 ? 3 : 7) * g
                    line(s, R(cx + Math.cos(a) * (r + 2)), R(cy + Math.sin(a) * (r + 2)), R(cx + Math.cos(a) * len), R(cy + Math.sin(a) * len), i & 1 ? C.gold2 : C.gold3)
                }
                disc(s, cx, cy, r, C.gold2)
                disc(s, cx - 1, cy - 1, Math.max(1, r - 2), C.gold3)
                disc(s, cx - 1, cy - 1, Math.max(1, r - 5), C.white)
                // the flare as the first spear leaves it
                if (q0 >= 1.36 && q0 < 1.46) disc(s, cx, cy, r + 6, C.white)
            }
        }
        // the spears of light: each falls from the sun onto one of the party, then bursts on them
        for (let i = 0; i < 6; i++) {
            const pt = hitTarget(st, i, true)
            const t1 = JUDGEMENT.hits[i]!
            const u = sp(t, t1 - 0.12, t1)
            const ty = chest(pt)
            if (u > 0 && u < 1) {
                const hx = cx + (pt.x - cx) * u
                const hy = cy + (ty - cy) * u
                const tx = cx + (pt.x - cx) * Math.max(0, u - 0.6)
                const tyy = cy + (ty - cy) * Math.max(0, u - 0.6)
                line(s, R(tx), R(tyy), R(hx), R(hy), C.gold2, 4)
                line(s, R(tx), R(tyy), R(hx), R(hy), C.gold3, 2)
                line(s, R(tx), R(tyy), R(hx), R(hy), C.white)
            }
            blast(s, pt.x, ty, t, t1, 8, 0.45, HOLY6, 61 + i, 'holy')
            shockRing(s, pt.x, pt.y - 1, t, t1, 0.4, 2, 14, C.gold3, true)
        }
    }
}

/** Zero every pixel of `a` that `b` doesn't cover: plate stays inside the body it's strapped to. */
function clip(a: Surface, b: Surface): void {
    for (let i = 0; i < a.data.length; i++) if (!b.data[i]) a.data[i] = 0
}

export const GILDED_WARLORD: CreatureDef = {
    name: 'The Gilded Warlord', size: 256, room: 56, shadow: 58, accent: C.gold3,
    states: { ...withSpecial(bossStates(1.6, 2.0, 2.4), CHARGE_DUR), special2: { dur: JUDGEMENT_DUR, loop: false } },
    specials: [SUNLANCE_CHARGE, JUDGEMENT],
    draw(s, st, t) {
        drive(this, st, t, 26, 2.0)
        // the specials play as big attacks on his own pose: the charge carries him far forward
        if (st === 'special') spAttack(0.36, 0.5, 0.72, CHARGE_REACH)
        if (st === 'special2') spAttack(0.5, 0.54, 0.78, 10)
        const tt = q(t)
        const flutter = tt * 5
        const breath = B.breath

        // the entry: a gallop in from off to the side, braking to a halt and rearing on the roar
        let gallop = -1
        let bob = 0
        let pitch = 0
        let comeIn = 0
        // the charge gallops, from the wheel to the pull-up
        if (st === 'special' && B.sp > 0.3 && B.sp < 0.8) {
            gallop = (B.sp * 7) % 1
            bob = R(Math.sin(gallop * Math.PI * 2) * 3)
            pitch = Math.sin(gallop * Math.PI * 2 + 1) * 0.035
        }
        if (st === 'entry') {
            const k = Math.min(1, tt / (this.states.entry!.dur * ENTRY_SETTLED))
            const left = (1 - k) * (1 - k)
            comeIn = -R(GALLOP_FROM * left)
            if (k < 1) {
                gallop = (GALLOP_STRIDES * (1 - left)) % 1
                bob = R(Math.sin(gallop * Math.PI * 2) * 3)
                pitch = Math.sin(gallop * Math.PI * 2 + 1) * 0.035
            }
        }

        const bx = s.ax - 8 + B.lunge - B.kb
        const by = s.ay
        // the whole mount turns about its hind hooves: up on the wind-up and the roar, into the
        // stab, and over onto its chest as it falls
        const rear = pitch + (st === 'death' ? 0.24 * B.die : B.roar ? -0.16 : bz(0, -0.18, 0.08))
        const sink = R(B.die * 22)
        const pvx = bx - 30
        const at = (x: number, y: number): [number, number] => { rot(bx + x, by + y + sink + bob, pvx, by, rear); return [T.x, T.y] }
        // the rider leans back on the wind-up and into the stab, about his seat
        const lean = st === 'death' ? 0.2 * B.die : bz(0, -0.14, 0.2)
        const ra = (x: number, y: number): [number, number] => {
            const c = Math.cos(lean)
            const sn = Math.sin(lean)
            const dx = x + 4
            const dy = y + 74
            return at(-4 + dx * c - dy * sn, -74 + dx * sn + dy * c)
        }
        const poseAt = (key: string, pts: readonly number[], f: (x: number, y: number) => [number, number]): Surface => {
            const m = mask(s, key)
            const out: number[] = []
            for (let i = 0; i < pts.length; i += 2) { const [a, b] = f(pts[i]!, pts[i + 1]! ); out.push(a, b) }
            poly(m, out, 0, 0, 1)
            return m
        }
        // the near foreleg paws the ground now and then while he waits
        const paw = st === 'idle' ? Math.max(0, Math.sin(tt / 2.0 * Math.PI * 2)) : 0
        const rb = breath

        // where a hoof is this frame, in body space
        const foot = (l: Leg): [number, number] => {
            if (gallop >= 0) {
                const p = (gallop + l.beat) % 1
                if (p < 0.45) return [l.fx + STRIDE * (0.5 - p / 0.45), l.fy]
                const v = (p - 0.45) / 0.55
                const lift = Math.sin(v * Math.PI)
                return [l.fx + STRIDE * (v - 0.5) - (l.fore ? lift * 6 : 0), l.fy - lift * (l.fore ? 17 : 12)]
            }
            if (!l.fore) return [l.fx, l.fy]
            if (st === 'attack' || st === 'entry') {
                // rearing, the forelegs tuck up under the chest; on the stab they strike out ahead
                const k = Math.max(B.wind, B.roar ? 1 : 0)
                if (k > 0) return [l.fx + 2 * k, l.fy - 20 * k]
                if (B.rec > 0) return [l.fx + 14 * B.rec, l.fy - (l === NEAR_FORE ? 12 : 6) * B.rec]
            }
            if (l === NEAR_FORE && paw > 0.3) return [l.fx + 10, l.fy - 6 - R(paw * 6)]
            return [l.fx, l.fy]
        }
        const leg = (l: Leg, far: boolean): void => {
            const [fx, fy] = foot(l)
            elbow(l.hx, l.hy, fx, fy, 23, 22, l.fore ? -1 : 1)
            const m = mask(s, 'leg')
            const [a1, b1] = at(l.hx, l.hy)
            const [a2, b2] = at(P.x, P.y)
            const [a3, b3] = at(fx, fy)
            taper(m, a1, b1, a2, b2, 13, 8, 1)
            taper(m, a2, b2, a3, b3, 7, 6, 1)
            disc(m, a2, b2, 4, 1)
            vol(s, m, COAT, 8, far ? -0.3 : 0)
            selOut(s, m, far ? C.ink : C.steel0)
            // a feathered fetlock, then the hoof and its iron shoe
            for (let i = -3; i <= 3; i++) px(s, R(a3 + i), R(b3 - 4 - (i & 1)), far ? MANE[0] : i < 0 ? MANE[2] : MANE[1])
            rect(s, R(a3 - 4), R(b3 - 3), 8, 3, far ? C.ink : C.steel0)
            px(s, R(a3 - 3), R(b3 - 3), far ? C.steel0 : C.steel2)
            rect(s, R(a3 - 4), R(b3), 8, 1, far ? C.steel0 : C.steel1)
        }

        // ── the banner on his back, behind everything ──
        {
            const [p0x, p0y] = ra(-14, -96 + rb)
            const [p1x, p1y] = ra(-18, -150 + rb)
            line(s, p0x, p0y, p1x, p1y, C.brown0, 2)
            line(s, p0x - 1, p0y, p1x - 1, p1y, C.brown2)
            const pts: number[] = []
            for (let i = 0; i <= 6; i++) {
                const u = i / 6
                pts.push(-18 - u * 22, -138 + rb + Math.sin(flutter + u * 3) * 2 * u)
            }
            for (let i = 6; i >= 0; i--) {
                const u = i / 6
                pts.push(-18 - u * 22, -104 + rb + Math.sin(flutter + u * 3 + 1) * 3 * u + (i === 6 ? -6 : 0))
            }
            const m = poseAt('banner', pts, ra)
            vol(s, m, CLOTH, 8, -0.1)
            eachPx(m, (x, y, edge) => { if (edge) s.set(x, y, C.gold1) })
            const [ex, ey] = ra(-29, -122 + rb)
            sun(s, ex, ey, 4)
            // the finial
            disc(s, p1x, p1y - 1, 2, C.gold2); px(s, R(p1x) - 1, R(p1y) - 2, C.white)
        }

        // ── far legs, in shadow ──
        leg(FAR_FORE, true)
        leg(FAR_HIND, true)

        // ── the tail, streaming back: one flowing volume, strands drawn down it ──
        {
            const m = mask(s, 'tail')
            const sw = Math.sin(flutter * 0.6) * 3 - (gallop >= 0 ? 8 : 0)
            const spine: [number, number][] = []
            for (let i = 0; i <= 10; i++) {
                const u = i / 10
                spine.push(at(-50 - u * 18 + Math.sin(u * 2.4) * 5 + sw * u, -62 + u * (gallop >= 0 ? 34 : 46)))
            }
            for (let i = 0; i < 10; i++) {
                const u = i / 10
                taper(m, spine[i]![0], spine[i]![1], spine[i + 1]![0], spine[i + 1]![1], 6 + Math.sin(u * Math.PI) * 8, 6 + Math.sin((u + 0.1) * Math.PI) * 8 - (i === 9 ? 5 : 0), 1)
            }
            vol(s, m, { ramp: [C.bone0, C.bone1, C.white], hi: C.white, rim: C.bone0 }, 8, -0.15)
            eachPx(m, (x, y, edge) => { if (!edge && ((x * 3 + y) % 7 === 0)) s.set(x, y, C.bone0) })
        }

        // ── the horse: body, neck and head as one volume ──
        const horse = mask(s, 'horse')
        {
            const m = horse
            const b = (x: number, y: number) => at(x, y + breath * 0.5)
            const [hx, hy] = b(-32, -56)
            const [cx, cy] = b(26, -54)
            taper(m, hx, hy, cx, cy, 34, 30, 1)
            disc(m, hx, hy, 17, 1)
            disc(m, cx, cy, 16, 1)
            const [n0x, n0y] = b(20, -60)
            const [n1x, n1y] = b(34, -84)
            const [n2x, n2y] = b(46, -99)
            taper(m, n0x, n0y, n1x, n1y, 23, 17, 1)
            taper(m, n1x, n1y, n2x, n2y, 17, 13, 1)
            const [crx, cry] = b(31, -86)
            disc(m, crx, cry, 7, 1)
            const [h0x, h0y] = b(46, -101)
            const [h1x, h1y] = b(72, -84)
            taper(m, h0x, h0y, h1x, h1y, 17, 11, 1)
            disc(m, h0x + 1, h0y + 2, 9, 1)
            disc(m, h1x, h1y, 6, 1)
            const [e0x, e0y] = b(46, -106)
            tri(m, e0x - 2, e0y + 3, e0x + 2, e0y + 2, e0x - 1, e0y - 5, 1) // the ear
            vol(s, m, COAT, 12)
            // the nostril and the mouth, round the bit
            const [nx, ny] = b(73, -85)
            px(s, R(nx), R(ny), C.ink); px(s, R(nx) - 1, R(ny) + 1, C.steel0)
            const [mx, my] = b(67, -79)
            line(s, mx, my, mx + 5, my - 1, C.steel0)
        }

        // ── near legs: over the body, under the barding's hem ──
        leg(NEAR_FORE, false)
        leg(NEAR_HIND, false)

        // ── the barding: crimson, scalloped, trimmed and fringed in gold, his sun on the flank ──
        {
            const pts: number[] = []
            for (const [x, y] of [[-50, -60], [-34, -68], [-12, -70], [10, -68], [26, -62], [34, -52], [36, -32]] as const) pts.push(x, y + breath * 0.5)
            const wave = gallop >= 0 ? 2.5 : 1.2
            for (let x = 34; x >= -52; x -= 6) pts.push(x, -30 + Math.sin(flutter * 0.5 + x * 0.2) * wave)
            pts.push(-56, -46)
            const m = poseAt('barding', pts, at)
            // scallops along the hem
            for (let x = 34; x >= -50; x -= 8) { const [a, b] = at(x, -30); disc(m, a, b, 3.5, 1) }
            vol(s, m, CLOTH, 14, 0.05)
            // deep folds falling from the saddle, each lit along its near side
            for (const fx of [-42, -26, 8, 24]) {
                for (let k = 0; k <= 30; k++) {
                    const [x, y] = at(fx + Math.sin(k * 0.18 + fx) * 2 + (fx < 0 ? -k * 0.12 : k * 0.12), -62 + k)
                    if (m.get(R(x), R(y)) && m.get(R(x), R(y) + 3)) { s.set(R(x), R(y), C.red0); s.set(R(x) - 1, R(y), C.red3) }
                }
            }
            // a band of gold lozenges above the hem
            for (let x = 28; x >= -48; x -= 8) {
                const [a, b] = at(x, -37)
                if (!m.get(R(a), R(b))) continue
                px(s, R(a), R(b) - 2, C.gold3); px(s, R(a) - 1, R(b) - 1, C.gold2); px(s, R(a) + 1, R(b) - 1, C.gold1)
                px(s, R(a) - 2, R(b), C.gold2); px(s, R(a), R(b), C.red3); px(s, R(a) + 2, R(b), C.gold1)
                px(s, R(a) - 1, R(b) + 1, C.gold1); px(s, R(a) + 1, R(b) + 1, C.gold0); px(s, R(a), R(b) + 2, C.gold0)
            }
            // gold along the top edge where it lies on the horse, and the hem trimmed and fringed
            eachPx(m, (x, y, edge, below) => {
                if (!edge) return
                if (below && y > by - 42 + sink + bob) {
                    s.set(x, y, C.gold2); s.set(x, y - 1, C.gold3)
                    if ((x & 1) === 0) s.set(x, y + 1, C.gold1)
                    if ((x & 3) === 0) s.set(x, y + 2, C.gold0)
                } else if (!below) s.set(x, y, C.gold2)
            })
            const [sx, sy] = at(-10, -48 + breath * 0.5)
            sun(s, sx, sy, 7)
        }

        // ── the horse's plate ──
        {
            const b = (x: number, y: number) => at(x, y + breath * 0.5)
            // the crupper over the rump, ridged, its edge riveted
            const cm = poseAt('crupper', [-60, -52, -56, -66, -42, -74, -34, -72, -36, -64, -48, -58, -56, -50], b)
            clip(cm, horse)
            vol(s, cm, GOLD, 7)
            selOut(s, cm, C.gold0)
            eachPx(cm, (x, y, edge, below) => { if (edge && below && ((x + y) % 4 === 0)) s.set(x, y, C.gold3) })
            const [r0x, r0y] = b(-56, -60)
            const [r1x, r1y] = b(-36, -69)
            line(s, r0x, r0y, r1x, r1y, C.gold3)

            // the mane, falling from under the crinet down the near side of the neck
            for (let i = 0; i < 6; i++) {
                const u = i / 5
                const sw = Math.sin(flutter * 0.7 + i * 0.9) * 2 - (gallop >= 0 ? 3 : 0)
                const [x0, y0] = b(24 + u * 18, -72 - u * 26)
                const [x1, y1] = b(18 + u * 15 + sw * 1.5, -60 - u * 22)
                chain(s, x0, y0, (x0 + x1) / 2 + sw, (y0 + y1) / 2 - 1, x1, y1, 2.5, 1, MANE, 8)
            }
            // the crinet: six lames down the crest from the withers to the poll, each over the one
            // below it, its lower edge shadowed where it lies on the next
            // (the crest is the neck's back edge: its centreline pushed out along the normal NX, NY)
            const NX = -0.82
            const NY = -0.58
            for (let i = 0; i < 6; i++) {
                const u0 = i / 6
                const u1 = (i + 1.3) / 6
                const cx0 = 20 + u0 * 26
                const cy0 = -62 - u0 * 37
                const cx1 = 20 + u1 * 26
                const cy1 = -62 - u1 * 37
                const lm = poseAt('lame', [cx0 + NX * 12, cy0 + NY * 12, cx1 + NX * 12, cy1 + NY * 12, cx1 + NX * 3, cy1 + NY * 3, cx0 + NX * 3, cy0 + NY * 3], b)
                clip(lm, horse)
                vol(s, lm, GOLD, 3)
                selOut(s, lm, C.gold0)
                const [rx, ry] = b((cx0 + cx1) / 2 + NX * 6, (cy0 + cy1) / 2 + NY * 6)
                px(s, R(rx), R(ry), C.gold3)
            }
            // the peytral over the breast, a sun boss on it, riveted round its scalloped hem
            const pm = poseAt('peytral', [30, -69, 38, -67, 43, -59, 43, -49, 38, -43, 32, -45, 30, -55], b)
            clip(pm, horse)
            vol(s, pm, GOLD, 8)
            selOut(s, pm, C.gold0)
            eachPx(pm, (x, y, edge) => { if (edge && ((x * 3 + y) % 5 === 0)) s.set(x, y, C.gold3) })
            const [bsx, bsy] = b(37, -55)
            sun(s, bsx, bsy, 5)

            // the chanfron down the face: a ridged plate, a guard round the eye, a ruby on the brow
            const fm = poseAt('chanfron', [44, -110, 52, -109, 63, -97, 73, -88, 72, -83, 64, -88, 52, -96, 46, -101], b)
            clip(fm, horse)
            vol(s, fm, GOLD, 5)
            selOut(s, fm, C.gold0)
            const [f0x, f0y] = b(49, -107)
            const [f1x, f1y] = b(70, -88)
            line(s, f0x, f0y, f1x, f1y, C.gold3)
            // the eye in its guard
            const [ex, ey] = b(54, -97)
            for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; px(s, R(ex + Math.cos(a) * 3), R(ey + Math.sin(a) * 2.5), i < 5 ? C.gold1 : C.gold3) }
            px(s, R(ex), R(ey), C.ink); px(s, R(ex) + 1, R(ey), C.ink); px(s, R(ex), R(ey) - 1, B.glow > 0.5 ? C.red3 : C.white)
            const [gx, gy] = b(50, -104)
            px(s, R(gx), R(gy), C.red3); px(s, R(gx) + 1, R(gy), C.red1); px(s, R(gx), R(gy) + 1, C.red0)
            // the bridle: a cheekpiece studded in gold, a noseband, the bit ring
            const [c0x, c0y] = b(50, -100)
            const [c1x, c1y] = b(64, -81)
            line(s, c0x, c0y, c1x, c1y, C.brown0, 2)
            for (let k = 1; k < 4; k++) px(s, R(c0x + (c1x - c0x) * k / 4), R(c0y + (c1y - c0y) * k / 4), C.gold3)
            const [nb0x, nb0y] = b(62, -88)
            const [nb1x, nb1y] = b(68, -81)
            line(s, nb0x, nb0y, nb1x, nb1y, C.brown0)
            disc(s, c1x, c1y, 1.5, C.gold2); px(s, R(c1x), R(c1y), C.gold0)
            // the plume on the brow, streaming back
            for (let i = 0; i < 3; i++) {
                const [x0, y0] = b(46, -108)
                const [x1, y1] = b(32 - i * 4 + Math.sin(flutter + i) * 2 - (gallop >= 0 ? 4 : 0), -112 + i * 4)
                chain(s, x0, y0, (x0 + x1) / 2, Math.min(y0, y1) - 4, x1, y1, 3, 1.5, PLUME, 10)
            }
            disc(s, R(b(46, -108)[0]), R(b(46, -108)[1]), 1.5, C.gold2)
        }

        // ── the saddle's cantle, behind his hips ──
        {
            const m = poseAt('cantle', [-22, -70, -14, -70, -13, -80, -18, -88, -24, -85], at)
            vol(s, m, GOLD, 5)
            selOut(s, m, C.gold0)
        }

        // ── his far arm, on the reins, and the reins down to the bit ──
        const [rhx, rhy] = ra(15, -83 + rb)
        {
            const m = mask(s, 'farm')
            const [e0x, e0y] = ra(2, -95 + rb)
            taper(m, e0x, e0y, rhx, rhy, 7, 6, 1)
            disc(m, rhx, rhy, 3.5, 1)
            vol(s, m, GOLD, 5, -0.3)
            selOut(s, m, C.ink)
            const [bitx, bity] = at(64, -81 + breath * 0.5)
            const sag = 4 + (gallop >= 0 ? Math.sin(gallop * Math.PI * 4) * 2 : 0)
            for (let k = 0; k <= 24; k++) {
                const u = k / 24
                s.set(R(rhx + (bitx - rhx) * u), R(rhy + (bity - rhy) * u + Math.sin(u * Math.PI) * sag), C.brown0)
            }
        }

        // ── his sword, scabbarded at the hip, hanging down over the barding ──
        {
            const [h0x, h0y] = ra(-10, -80)
            const [h1x, h1y] = ra(-32, -54)
            const m = mask(s, 'scabbard')
            taper(m, h0x, h0y, h1x, h1y, 4, 3, 1)
            vol(s, m, LEATHER, 3)
            selOut(s, m, C.ink)
            // the chape and a locket, in gold
            line(s, h1x, h1y, h1x - 2, h1y + 2, C.gold2, 2)
            const [lx, ly] = ra(-15, -74)
            line(s, lx - 2, ly - 1, lx + 2, ly + 1, C.gold2, 2)
            // the hilt: a crossguard, a wire grip and a ruby pommel
            const [gx, gy] = ra(-8, -82)
            line(s, gx - 3, gy - 3, gx + 3, gy + 3, C.gold2, 2)
            const [pgx, pgy] = ra(-4, -86)
            line(s, gx, gy, pgx, pgy, C.brown1, 2)
            disc(s, pgx + 1, pgy - 1, 1.5, C.red2)
        }

        // ── the saddle: the seat and the high pommel ──
        {
            const [q0x, q0y] = at(-18, -71)
            const [q1x, q1y] = at(4, -71)
            taper(s, q0x, q0y, q1x, q1y, 5, 5, C.red1)
            line(s, q0x, q0y - 2, q1x, q1y - 2, C.gold2)
            const m = poseAt('pommel', [2, -70, 9, -70, 11, -79, 7, -84, 4, -79], at)
            vol(s, m, GOLD, 5)
            selOut(s, m, C.gold0)
            // the stirrup leather, down to the iron
            const [l0x, l0y] = at(-3, -70)
            const [l1x, l1y] = at(3, -49)
            line(s, l0x, l0y, l1x, l1y, C.brown0, 2)
        }

        // ── his near leg: cuisse, winged poleyn, greave, a laminated sabaton spurred and stirruped ──
        {
            const m = mask(s, 'rleg')
            const [t0x, t0y] = ra(-4, -76 + rb)
            const [t1x, t1y] = at(10, -62)
            const [t2x, t2y] = at(5, -47)
            const [f0x, f0y] = at(13, -45)
            taper(m, t0x, t0y, t1x, t1y, 12, 9, 1)
            taper(m, t1x, t1y, t2x, t2y, 8, 6, 1)
            taper(m, t2x, t2y, f0x, f0y, 5, 3, 1)
            vol(s, m, GOLD, 8)
            selOut(s, m, C.gold0)
            // the cuisse's ridge, the greave's
            line(s, t0x + 1, t0y - 3, t1x, t1y - 3, C.gold3)
            line(s, t1x - 1, t1y + 2, t2x - 1, t2y, C.gold3)
            // lames across the sabaton
            for (const u of [0.35, 0.7]) { const x = t2x + (f0x - t2x) * u; const y = t2y + (f0y - t2y) * u; px(s, R(x), R(y) - 1, C.gold0); px(s, R(x), R(y) + 1, C.gold0) }
            // the poleyn and its fan-shaped wing
            const wm = mask(s, 'wing')
            tri(wm, t1x - 1, t1y - 1, t1x - 7, t1y - 5, t1x - 6, t1y + 4, 1)
            vol(s, wm, GOLD, 3)
            line(s, t1x - 2, t1y, t1x - 6, t1y - 3, C.gold0)
            disc(s, t1x, t1y, 3, C.gold2); px(s, R(t1x) - 1, R(t1y) - 1, C.white); px(s, R(t1x) + 1, R(t1y) + 1, C.gold0)
            // the rowel spur at the heel
            const [spx, spy] = at(2, -46)
            line(s, spx, spy, spx - 4, spy, C.gold1)
            px(s, R(spx) - 5, R(spy) - 1, C.gold3); px(s, R(spx) - 5, R(spy) + 1, C.gold3); px(s, R(spx) - 6, R(spy), C.gold3)
            // the stirrup iron round the foot
            const [six, siy] = at(8, -45)
            for (let i = 0; i < 12; i++) { const a = Math.PI * (0.1 + i / 12 * 0.8); px(s, R(six + Math.cos(a) * 4), R(siy - 3 + Math.sin(a) * 4), C.gold1) }
            px(s, R(six) - 4, R(siy) - 3, C.gold3); px(s, R(six) + 4, R(siy) - 3, C.gold3)
        }

        // ── his body: a ridged breastplate with his sun on it, a crimson skirt, a sword belt ──
        {
            const m = poseAt('torso', [-14, -76 + rb, 8, -76 + rb, 12, -94 + rb, 10, -110 + rb, -12, -111 + rb, -15, -94 + rb], ra)
            vol(s, m, GOLD, 10)
            selOut(s, m, C.gold0)
            // the ridge down the front of the breastplate, and the plackart's edge across it
            for (let y = -108; y <= -80; y++) {
                const x = 9 + Math.sin((y + 108) / 28 * Math.PI) * 2
                const [a, b] = ra(x, y + rb)
                s.set(R(a), R(b), C.gold3); s.set(R(a) - 1, R(b), C.gold1)
            }
            for (let x = -14; x <= 10; x++) { const [a, b] = ra(x, -88 + rb + Math.abs(x - 2) * 0.12); s.set(R(a), R(b), C.gold0) }
            const [cx, cy] = ra(0, -100 + rb)
            sun(s, cx, cy, 4)
            // the skirt of his tabard below the belt, dagged, falling over the saddle and his thigh
            const sk: number[] = [-12, -78 + rb, 8, -78 + rb, 11, -72]
            for (let x = 11; x >= -12; x -= 3) sk.push(x, -69 + (((x + 13) / 3) & 1 ? -3 : 0))
            const km = poseAt('skirt', sk, ra)
            vol(s, km, CLOTH, 6, 0.05)
            eachPx(km, (x, y, edge, below) => { if (edge && below) s.set(x, y, C.gold2) })
            // the sword belt, riveted, a gold buckle
            const [w0x, w0y] = ra(-16, -79 + rb)
            const [w1x, w1y] = ra(11, -79 + rb)
            line(s, w0x, w0y, w1x, w1y, C.brown0, 2)
            for (let x = -12; x <= 8; x += 5) { const [a, b] = ra(x, -79 + rb); px(s, R(a), R(b), C.gold2) }
            const [kx, ky] = ra(2, -79 + rb)
            rect(s, R(kx) - 1, R(ky) - 1, 3, 3, C.gold3); px(s, R(kx), R(ky), C.gold0)
        }

        // ── his gorget and great helm, crowned, a crimson plume sweeping back from the crown ──
        {
            const gm = mask(s, 'gorget')
            const [g0x, g0y] = ra(-8, -114 + rb)
            const [g1x, g1y] = ra(8, -114 + rb)
            taper(gm, g0x, g0y, g1x, g1y, 6, 6, 1)
            vol(s, gm, GOLD, 4)
            line(s, g0x, g0y + 1, g1x, g1y + 1, C.gold0)
            const hy = -126 + rb + R(bz(0, -2, 2))
            for (let i = 0; i < 4; i++) {
                const [x0, y0] = ra(-3, hy - 8)
                const [cx, cy] = ra(-10 - i * 3, hy - 16 + i + Math.sin(flutter + i) * 1.5)
                const [x1, y1] = ra(-22 - i * 3 + Math.sin(flutter * 0.8 + i) * 2 - (gallop >= 0 ? 4 : 0), hy - 4 + i * 3)
                chain(s, x0, y0, cx, cy, x1, y1, 4 - i * 0.5, 2, PLUME, 12)
            }
            const m = mask(s, 'helm')
            const [h0x, h0y] = ra(1, hy)
            disc(m, h0x, h0y - 2, 9, 1)
            const [h1x, h1y] = ra(1, hy + 7)
            taper(m, h0x, h0y, h1x, h1y, 17, 15, 1)
            vol(s, m, GOLD, 12)
            selOut(s, m, C.gold0)
            // the ridge down the face, the visor slit with his eyes burning in it, the breaths
            const [r0x, r0y] = ra(8, hy - 8)
            const [r1x, r1y] = ra(9, hy + 9)
            line(s, r0x, r0y, r1x, r1y, C.gold3)
            const [vx, vy] = ra(1, hy + 1)
            rect(s, R(vx) - 2, R(vy), 12, 2, C.ink)
            const eye = B.hurt ? C.white : B.glow > 0.4 ? C.white : C.red3
            px(s, R(vx) + 5, R(vy), eye); px(s, R(vx) + 8, R(vy), eye)
            if (B.glow > 0.4) { px(s, R(vx) + 5, R(vy) - 1, C.red3); px(s, R(vx) + 8, R(vy) - 1, C.red3) }
            for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) px(s, R(vx) + 5 + i * 2, R(vy) + 4 + j * 2, C.gold0)
            // rivets round the brow
            for (let i = 0; i < 4; i++) px(s, R(vx) - 2 + i * 4, R(vy) - 3, C.gold3)
            // the crown: a band and five spikes, a ruby in the middle one
            const [cx, cy] = ra(1, hy - 10)
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

        // ── the lance: raised at rest, drawn back on the wind-up, stabbed down into the party ──
        const [shx, shy] = ra(6, -104 + rb)
        // the lance hand and angle at rest, wound up and struck: stabbing down, couched for the
        // charge, and raised to the sky then driven down for the Judgement
        const ln = LANCE[st]
        const hand = ln ? [bz(ln[0]!, ln[2]!, ln[4]!), bz(ln[1]!, ln[3]!, ln[5]!)] : st === 'death' ? [22, -80] : [22, -88]
        const [hx, hy] = ra(hand[0]!, hand[1]!)
        {
            const a = (ln ? bz(ln[6]!, ln[7]!, ln[8]!) : st === 'death' ? -0.62 + B.die * 1.2 : -0.62 + wv(t, 2.0, 1) * 0.02) + rear + lean * 0.5
            const ca = Math.cos(a)
            const sa = Math.sin(a)
            const bxl = hx - ca * 22
            const byl = hy - sa * 22
            const txl = hx + ca * 80
            const tyl = hy + sa * 80
            // the shaft, crimson spiralled in gold, tapering to the point
            const m = mask(s, 'lance')
            taper(m, bxl, byl, txl, tyl, 5, 2, 1)
            vol(s, m, CLOTH, 4)
            for (let k = 0; k < 102; k += 7) {
                const x = bxl + ca * k
                const y = byl + sa * k
                const w = 2 - k / 102
                line(s, x - sa * w, y + ca * w, x + ca * 2 + sa * w, y + sa * 2 - ca * w, C.gold2)
            }
            // the butt cap
            disc(s, bxl, byl, 2, C.gold1)
            // the steel point, its socket and its glint
            poly(s, [txl - sa * 3, tyl + ca * 3, txl + sa * 3, tyl - ca * 3, txl + ca * 13, tyl + sa * 13], 0, 0, C.steel2)
            line(s, txl - sa * 2, tyl + ca * 2, txl + ca * 12, tyl + sa * 12, C.white)
            line(s, txl + sa * 3, tyl - ca * 3, txl + ca * 12, tyl + sa * 12, C.steel0)
            line(s, txl - sa * 3, tyl + ca * 3, txl + sa * 3, tyl - ca * 3, C.gold2, 2)
            // the pennant, a crimson swallowtail blowing back from below the point
            const fl = Math.sin(flutter * 1.3) * 3
            const [ax, ay] = [hx + ca * 66, hy + sa * 66]
            const [bx2, by2] = [hx + ca * 54, hy + sa * 54]
            const pm = mask(s, 'pennant')
            poly(pm, [ax, ay, ax - 24, ay + 4 + fl, ax - 16, ay + 8 + fl * 0.6, bx2 - 22, by2 + 12 + fl, bx2, by2], 0, 0, 1)
            vol(s, pm, CLOTH, 6)
            eachPx(pm, (x, y, edge) => { if (edge && ((x + y) & 1)) s.set(x, y, C.gold2) })
            // the vamplate, a gold cone guarding the hand
            const vm = mask(s, 'vamp')
            const vx = hx + ca * 7
            const vy = hy + sa * 7
            poly(vm, [hx - sa * 7, hy + ca * 7, hx + sa * 7, hy - ca * 7, vx + ca * 8, vy + sa * 8], 0, 0, 1)
            vol(s, vm, GOLD, 6)
            selOut(s, vm, C.gold0)
        }

        // ── the near arm over the lance: rerebrace, winged couter, vambrace, the gauntlet closed on it ──
        {
            elbow(shx, shy, hx, hy, 16, 16, 1)
            const am = mask(s, 'arm')
            taper(am, shx, shy, P.x, P.y, 9, 7, 1)
            taper(am, P.x, P.y, hx, hy, 7, 6, 1)
            disc(am, P.x, P.y, 3.5, 1)
            vol(s, am, GOLD, 8)
            selOut(s, am, C.gold0)
            // the couter's wing, and the gauntlet's flared cuff
            tri(s, P.x - 1, P.y - 1, P.x - 6, P.y + 2, P.x - 2, P.y + 5, C.gold1)
            disc(s, P.x, P.y, 2.5, C.gold2); px(s, R(P.x) - 1, R(P.y) - 1, C.white)
            const cx = P.x + (hx - P.x) * 0.72
            const cy = P.y + (hy - P.y) * 0.72
            disc(s, cx, cy, 3.5, C.gold1); disc(s, cx - 0.5, cy - 0.5, 2.5, C.gold2)
            disc(s, hx, hy, 3.5, C.gold2)
            px(s, R(hx) - 1, R(hy) - 1, C.gold3); px(s, R(hx) + 1, R(hy) + 1, C.gold0)
        }
        // ── his great pauldron, three lames and a crest of spikes, over the top of the arm ──
        {
            const m = mask(s, 'pauldron')
            const [p1x, p1y] = ra(5, -106 + rb)
            disc(m, p1x, p1y, 8, 1)
            const [p2x, p2y] = ra(7, -100 + rb)
            disc(m, p2x, p2y, 6, 1)
            vol(s, m, GOLD, 10)
            selOut(s, m, C.gold0)
            for (let i = 0; i < 2; i++) {
                for (let k = -6; k <= 6; k++) {
                    const [a, b] = ra(5 + k, -102 + i * 3 + rb + (k * k) / 14)
                    if (m.get(R(a), R(b))) { s.set(R(a), R(b), C.gold0); if (m.get(R(a), R(b) - 1)) s.set(R(a), R(b) - 1, C.gold3) }
                }
            }
            for (let i = 0; i < 4; i++) {
                const [a, b] = ra(-2 + i * 5, -114 + Math.abs(i - 1.5) + rb)
                tri(s, a - 1, b + 2, a + 2, b + 2, a, b - 4, C.gold2)
                px(s, R(a) + 1, R(b), C.gold0)
                px(s, R(a), R(b) - 4, C.white)
            }
        }

        // the gallop carries the whole drawing in from the side
        if (comeIn) shift(s, comeIn, 0, s.h)
        B.ent = 1
        finish(s, Entry.Walk, 0)
    },
    fx(dst, st, t, x, y, dir) {
        const k = fr(t, 10, 8)
        // dust thrown up behind the hooves as he gallops in, thinning as he brakes
        if (st === 'entry') {
            const u = Math.min(1, q(t) / (this.states.entry!.dur * ENTRY_SETTLED))
            const left = (1 - u) * (1 - u)
            const ox = x - dir * R(GALLOP_FROM * left)
            const n = R(18 * (1 - u) + (u < 1 ? 4 : 0))
            for (let i = 0; i < n; i++) {
                const d = hash2(i, k) * 70
                dst.set(ox - dir * R(20 + d), y - 1 - R(hash2(i, k + 3) * (4 + d * 0.15)), i & 1 ? C.stone3 : C.bone0)
            }
        }
        // on the stab: dust kicked up under the forehooves, and a streak down the line of the lance
        if (st === 'attack' && (B.strike || B.rec > 0.6)) {
            for (let i = 0; i < 14; i++) dst.set(x + dir * (-10 + ((i * 17 + k * 9) % 70)), y - 1 - ((i * 7 + k) % 6), i & 1 ? C.stone3 : C.bone0)
            if (B.strike) {
                for (let i = 0; i < 18; i++) {
                    const u = i / 18
                    dst.set(x + dir * R(40 + u * 60), y - 70 + R(u * 60) - 3, i & 1 ? C.white : C.gold3)
                }
            }
        }
        // his roar: gold motes shaken off the banner
        if (B.roar) for (let i = 0; i < 10; i++) dst.set(x + dir * (-50 + ((i * 13 + k * 5) % 60)), y - 120 + ((i * 11 + k * 3) % 40), i & 1 ? C.gold3 : C.gold2)
    }
}

/** His sun: a gold disc with a ruby heart and eight rays, `r` px round, at (x, y). */
function sun(s: Surface, x: number, y: number, r: number): void {
    const cx = R(x)
    const cy = R(y)
    for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2
        line(s, cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, cx + Math.cos(a) * (r + 1), cy + Math.sin(a) * (r + 1), i & 1 ? C.gold1 : C.gold2)
    }
    disc(s, cx, cy, Math.max(1, r * 0.55), C.gold2)
    if (r >= 4) { disc(s, cx, cy, Math.max(1, r * 0.3), C.red2); px(s, cx - 1, cy - 1, C.gold3) } else px(s, cx, cy, C.gold3)
}
