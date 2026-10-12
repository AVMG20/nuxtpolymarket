// Dig-site Raid (reinforced_boss): the Deepcoil, the tunnel wyrm the dig broke into, and the two
// add waves that crawl up out of its tunnels.
//
// A great armoured worm lying coiled on the ground, its tail trailing back into the tunnel it came
// out of, its neck curling up in an S out of the front of the coil. The body is a chain of armoured
// segments, each shaded as a round volume, encrusted with cut stones, a ridge of small crystal
// clusters down its back and two great amethyst clusters; the pale belly shows only up the raised
// neck. The head is the focal point, built from the same segments: a riveted helm-plate brow the
// spikes grow from, three ore-lit eyes in ember-rimmed sockets, a cheek guard, grooves down the
// snout, and a round drill maw of turning teeth, studded round its lip. A toppled cart spills ore
// beside it.
//
// It bursts up out of the ground, sways, rears back and plunges its head down into the party, and
// slumps onto its coil when it dies.
//
// The coil is one spiral, narrowing and climbing, drawn in depth order: the tail, the far half of
// each turn bottom-up, the near halves top-down, then the neck.

import { C } from './palette'
import type { BossSpecial, CreatureDef } from './creature'
import { fr, deathPhase } from './creature'
import type { Surface } from './surface'
import { B, Entry, bossStates, withSpecial, spAttack, drive, finish, bz, px, line, disc, poly, ellipse, ditherEllipse, bayer, q, hash2 } from './boss-kit'
import { mask, vol, selOut, type Mat5 } from './raid-kit'
import { sp, hitTarget, chest, debris } from './special-kit'
import { blast, shockRing, type Ramp6 } from './vfx-cinematic'

const R = Math.round

const PLATE: Mat5 = { ramp: [C.brown0, C.stone1, C.stone2, C.stone3], hi: C.bone1, rim: C.stone1 }
const CRYSTAL = [C.teal1, C.cyan, C.frost, C.white] as const
const AMETHYST = [C.purple0, C.purple2, C.pink, C.white] as const
const RUBY = [C.red0, C.red2, C.red3, C.white] as const
/** The ridge of small clusters down the gem-encrusted trial's back, in turn: one geode's colours. */
const CLUSTERS = [AMETHYST, CRYSTAL] as const

/**
 * The neck is a cubic that carries straight on out of the coil, rising, to the head. Per pose, its
 * last two points and the head's heading: at rest, reared back on the wind-up, plunged down onto the
 * party on the strike, and slumped in death (P2x, P2y, P3x, P3y, heading), from the anchor.
 */
const REST = [8, -98, 28, -100, 0.45] as const
const WIND = [4, -112, 10, -124, -0.35] as const
const STRIKE = [44, -84, 68, -54, 0.9] as const
const SLUMP = [36, -50, 56, -24, 1.3] as const
/** The neck on its specials: the Eruption's dive, its head driven into the ground, and the Mantle's hymn, reared to the sky. */
const DIVE = [40, -62, 58, -14, 1.5] as const
const HYMN = [-2, -100, 4, -116, -0.75] as const
/** How far the neck carries on along the coil's own line before it bends toward the head. */
const NECK_LEAD = 14
/** The share of the neck, from its base, drawn over the top turn but under the bottom turn's near side. */
const NECK_BASE = 0.4

/**
 * The coil is one spiral, narrowing and climbing as it turns, each turn resting on the inner
 * shoulder of the one below: its centre from the anchor, where it starts and ends (the left end of
 * the bottom turn; the front of the top turn, where the neck lifts off), its half-width at each end,
 * how much of that the camera sees as depth, and how high it has climbed by the end.
 */
const COIL_DX = -6
const TH0 = Math.PI
const TH1 = 4.5 * Math.PI
const COIL_RX = [66, 28] as const
const COIL_DEPTH = 0.34
const COIL_LIFT = 34
/** Hide radius at the bottom of the coil and the top, and down the neck from its base to the head. */
const R_LOW = 16
const R_TOP = 12
const R_NECK = [14, 13] as const
/** Where the tail goes into its tunnel, from the anchor. */
const HOLE = [-80, -22] as const
/** Px along the body between one armoured segment and the next; they overlap, shingled. */
const SEGMENT_GAP = 8
/** How much bigger the head is drawn than its outline: the focal point. */
const HEAD_SCALE = 1.25
const ARMOUR_RAMP = [C.stone0, C.stone1, C.stone2, C.stone3] as const
const BELLY_RAMP = [C.bone0, C.bone0, C.bone1, C.bone1] as const

/**
 * A point on the body: position, unit tangent (toward the head), hide radius, whether it's on the
 * near side, and its place in the draw order.
 */
interface Pt { x: number, y: number, tx: number, ty: number, r: number, front: boolean, key: number }

const ERUPTION_DUR = 2.6
const MANTLE_DUR = 2.4
const AMETHYST6: Ramp6 = [C.white, C.pink, C.purple2, C.purple1, C.purple0, C.void]
/** How often a stone throws a glint, as a share of its beat; far more while the Mantle is sung. */
let glint = 0.025

/**
 * Geode Eruption: it rears and drives its head into the ground, and great clusters of amethyst
 * burst up under the four nearest in turn.
 */
const GEODE_ERUPTION: BossSpecial = {
    name: 'Geode Eruption', tint: 'night1', hits: [1.45, 1.55, 1.65, 1.75], spread: true,
    fx(s, t, st) {
        const d = st.dir
        const gx = st.bx + d * 62
        const gy = st.by - 1
        // where the head goes in: rock thrown up, a ring of light
        debris(s, gx, gy - 1, st.by, t, 1.1, 14, 110, 'dust', 21)
        shockRing(s, gx, gy, t, 1.1, 0.4, 4, 26, C.pink, true)
        for (let i = 0; i < 4; i++) {
            const pt = hitTarget(st, i, true)
            const t0 = GEODE_ERUPTION.hits[i]!
            // amethyst bursting up under them, then sinking back
            const g = sp(t, t0 - 0.05, t0 + 0.1)
            const f = sp(t, t0 + 0.55, t0 + 0.85)
            if (g > 0 && f < 1) {
                // a great cluster: five shards fanning out from under them, the tallest over their heads
                const h = 46 * g * (1 - f)
                let n = 0
                for (const [dx, k, lean] of [[-11, 0.5, -7], [-6, 0.78, -3], [0, 1, 1], [6, 0.72, 4], [11, 0.44, 7]] as const) {
                    if (h * k > 1) shard(s, pt.x + dx, pt.y, h * k, dx ? 7 : 9, lean, t, i * 5 + n)
                    n++
                }
                // motes of light drifting up off the cluster while it stands
                for (let m = 0; m < 8; m++) {
                    const age = (t * 0.9 + hash2(i, m)) % 1
                    const mx = pt.x + (hash2(m, i + 9) - 0.5) * 30 + Math.sin(age * 6 + m) * 2
                    const my = pt.y - 6 - hash2(m, i + 3) * h * 0.8 - age * 18
                    px(s, mx, my, age < 0.5 ? C.white : C.pink)
                }
            }
            blast(s, pt.x, chest(pt), t, t0, 11, 0.45, AMETHYST6, 41 + i, 'arcane')
        }
    }
}

/**
 * Crystal Mantle, for its adds: it rears with its maw to the sky, every stone on it flaring; the
 * great stone on its crown gathers the light and beams it to each add, and a shell of crystal
 * grows round them.
 */
const CRYSTAL_MANTLE: BossSpecial = {
    name: 'Crystal Mantle', tint: 'night1', target: 'adds', hits: [1.05, 1.15, 1.25], spread: true,
    fx(s, t, st) {
        const d = st.dir
        // the great stone on its crown, where the neck holds it in the hymn
        const cx = st.bx - d * 10
        const cy = st.by - 121
        const g = sp(t, 0.3, 0.9)
        const out = sp(t, 1.9, 2.3)
        if (g > 0 && out < 1) {
            // light drawn in from all round, the stone swelling with it
            if (g < 1) {
                for (let i = 0; i < 16; i++) {
                    const a = hash2(i, 3) * Math.PI * 2
                    const r = (1 - ((g * 2 + hash2(i, 5)) % 1)) * 40
                    s.set(R(cx + Math.cos(a) * r), R(cy + Math.sin(a) * r), i & 1 ? C.pink : C.white)
                }
            }
            const r = R((2 + g * 5) * (1 - out))
            for (let i = 0; i < 8; i++) {
                const a = t * 2 + i / 8 * Math.PI * 2
                line(s, R(cx + Math.cos(a) * (r + 2)), R(cy + Math.sin(a) * (r + 2)), R(cx + Math.cos(a) * (r + 6)), R(cy + Math.sin(a) * (r + 6)), i & 1 ? C.purple2 : C.pink)
            }
            disc(s, cx, cy, r, C.purple2)
            disc(s, cx - 1, cy - 1, Math.max(1, r - 2), C.pink)
            px(s, cx - 1, cy - 1, C.white)
        }
        const adds = st.adds ?? []
        for (let i = 0; i < adds.length; i++) {
            const a = adds[i]!
            const t1 = CRYSTAL_MANTLE.hits[i % CRYSTAL_MANTLE.hits.length]!
            const ay = a.y - 10
            // the beam, from the stone down onto them
            const u = sp(t, t1 - 0.2, t1)
            if (u > 0 && sp(t, t1 + 0.1, t1 + 0.3) < 1) {
                const hx = cx + (a.x - cx) * u
                const hy = cy + (ay - cy) * u
                line(s, R(cx), R(cy), R(hx), R(hy), C.purple1, 3)
                line(s, R(cx), R(cy), R(hx), R(hy), C.pink)
            }
            // the shell: shards of crystal growing round them in a ring, holding, then fading
            const grow = sp(t, t1, t1 + 0.3)
            const fade = sp(t, 2.0, 2.4)
            if (grow > 0 && fade < 1) {
                for (let k = 0; k < 8; k++) {
                    if (hash2(k, i + 1) > 1 - fade) continue
                    const ang = k / 8 * Math.PI * 2 + 0.2
                    const rr = 11 * grow
                    const sx = a.x + Math.cos(ang) * rr
                    const sy = ay + Math.sin(ang) * rr * 0.8
                    const len = 4 * grow
                    line(s, R(sx), R(sy), R(sx + Math.cos(ang) * len), R(sy + Math.sin(ang) * len), k & 1 ? C.purple2 : C.cyan, 2)
                    px(s, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len, C.white)
                }
                shockRing(s, a.x, a.y - 1, t, t1, 0.4, 2, 12, C.pink, true)
            }
        }
    }
}

export const DEEPCOIL: CreatureDef = {
    name: 'The Deepcoil', size: 256, room: 14, shadow: 74, accent: C.orange,
    states: { ...withSpecial(bossStates(1.6, 2.4, 2.8), ERUPTION_DUR), special2: { dur: MANTLE_DUR, loop: false } },
    specials: [GEODE_ERUPTION, CRYSTAL_MANTLE],
    draw(s, st, t) {
        drive(this, st, t, 16, 2.4)
        // the Eruption plays as a big attack, the head driven into the ground; the Mantle rears
        // and holds the hymn
        if (st === 'special') spAttack(0.42, 0.52, 0.74, 10)
        if (st === 'special2') spAttack(0.3, 0.36, 0.82, 0)
        const hymn = st === 'special2' && B.rec > 0.3
        glint = hymn ? 0.3 : 0.025
        const tt = q(t)
        const x = s.ax - 6
        const y = s.ay
        const ph = tt / 2.4 * Math.PI * 2
        const sway = st === 'idle' ? 1 : st === 'entry' ? 0.5 : 0
        const breath = Math.sin(ph) * 0.6
        const pose = (i: number) => {
            const v = bz(REST[i]!, WIND[i]!, (st === 'special' ? DIVE : st === 'special2' ? HYMN : STRIKE)[i]!)
            return v + (SLUMP[i]! - v) * B.die
        }
        const lunge = B.lunge - B.kb * 2
        const N2 = [x + pose(0) + lunge * 0.8 + Math.sin(ph + 1) * 4 * sway, y + pose(1) + Math.cos(ph) * 2 * sway]
        const N3 = [x + pose(2) + lunge + Math.sin(ph + 2) * 3 * sway, y + pose(3) + Math.sin(ph + 1.5) * 3 * sway]
        const heading = pose(4) + Math.sin(ph + 2.5) * 0.06 * sway - B.kb * 0.03
        const open = st === 'attack' || st === 'special' ? Math.max(B.wind * 0.6, B.strike ? 1 : B.rec * 0.8) : hymn || B.roar ? 1 : st === 'death' ? 0.6 : 0.15 + Math.max(0, Math.sin(ph * 2)) * 0.1
        const spin = tt * (st === 'attack' || st === 'special' || hymn || B.roar ? 14 : 3)
        const eye = B.hurt ? C.white : B.glow > 0.5 ? C.gold3 : C.orange

        // ── the body's path: the tail from its tunnel, the coil, the neck ──
        const pts: Pt[] = []
        const cx = x + COIL_DX
        const coilAt = (th: number): [number, number, number, boolean, number] => {
            const u = (th - TH0) / (TH1 - TH0)
            const rx = COIL_RX[0] + (COIL_RX[1] - COIL_RX[0]) * u
            const ry = rx * COIL_DEPTH
            const r = R_LOW + (R_TOP - R_LOW) * u + breath
            const front = Math.sin(th) > 0
            // the far half of each turn, bottom turn first; then the near halves, top turn first,
            // since a lower turn's near half is the nearer of the two
            const turn = Math.floor((th - TH0) / (Math.PI * 2))
            // the bottom turn lies on the ground; the climb starts where the spiral passes inside it
            const c = Math.min(1, Math.max(0, (th - 2.7 * Math.PI) / (TH1 - 2.7 * Math.PI)))
            const lift = COIL_LIFT * c * c * (3 - 2 * c)
            return [cx + Math.cos(th) * rx, y - r - ry - lift + Math.sin(th) * ry, r, front, front ? 100 - turn : turn]
        }
        const add = (px0: number, py0: number, r: number, front: boolean, key: number) => pts.push({ x: px0, y: py0, tx: 0, ty: 0, r, front, key })
        // the tail: out of the hole, thickening toward the bottom turn's left end
        {
            const [lx, ly, lr] = coilAt(TH0)
            const hx = x + HOLE[0]
            const hy = y + HOLE[1]
            for (let i = 0; i < 24; i++) {
                const u = i / 24
                add(hx + (lx - hx) * u, hy + (ly - hy) * u - Math.sin(u * Math.PI) * 4, 5 + (lr - 5) * u, false, -1)
            }
        }
        for (let th = TH0; th <= TH1; th += 0.025) { const [px0, py0, r, f, key] = coilAt(th); add(px0, py0, r, f, key) }
        // the neck: a cubic carrying on along the coil's line as it leaves it, rising to the head.
        // Its base goes down before the near side of the coil, which wraps round it; the rest over everything
        {
            const [ex, ey] = coilAt(TH1)
            const [bx0, by0] = coilAt(TH1 - 0.05)
            const l = Math.hypot(ex - bx0, ey - by0) || 1
            // on along the coil's line, lifting: the neck curls up out of the coil in an S
            const N1 = [ex + (ex - bx0) / l * NECK_LEAD, ey + (ey - by0) / l * NECK_LEAD - NECK_LEAD * 1.4]
            for (let i = 1; i <= 50; i++) {
                const u = i / 50
                const a = 1 - u
                add(a * a * a * ex + 3 * a * a * u * N1[0]! + 3 * a * u * u * N2[0]! + u * u * u * N3[0]!,
                    a * a * a * ey + 3 * a * a * u * N1[1]! + 3 * a * u * u * N2[1]! + u * u * u * N3[1]!,
                    R_TOP + (R_NECK[0] - R_TOP) * Math.min(1, u * 4) + (R_NECK[1] - R_NECK[0]) * u, true, u <= NECK_BASE ? 99.5 : 1000)
            }
        }
        for (let i = 0; i < pts.length; i++) {
            const a = pts[Math.max(0, i - 1)]!
            const b = pts[Math.min(pts.length - 1, i + 1)]!
            const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
            pts[i]!.tx = (b.x - a.x) / l
            pts[i]!.ty = (b.y - a.y) / l
        }

        // the side of the body its spines stand on: up and away from the party along the coil. Up the
        // neck the throat faces where the head looks, so the belly is aimed between down-and-toward
        // the party at its base and the head's own underside at its tip, the back opposite
        const backs = new Map<Pt, [number, number]>()
        {
            const hbx = -Math.sin(heading)
            const hby = Math.cos(heading)
            let n0 = 0
            for (const p of pts) {
                const nx = -p.ty
                const ny = p.tx
                let n: [number, number] = nx * -0.5 + ny * -0.87 > 0 ? [nx, ny] : [-nx, -ny]
                if (p.key === 99.5 || p.key === 1000) {
                    const u = (n0++ / 50) ** 2
                    const rx = 0.6 + (hbx - 0.6) * u
                    const ry = 0.8 + (hby - 0.8) * u
                    n = nx * rx + ny * ry > 0 ? [-nx, -ny] : [nx, ny]
                }
                backs.set(p, n)
            }
        }
        const back = (p: Pt): [number, number] => backs.get(p)!
        // one armoured segment every SEGMENT_GAP px along the path, drawn in depth order and, within
        // a stretch of the same depth, from the tail toward the head so each overlaps the one behind
        const segs: number[] = []
        {
            let run = SEGMENT_GAP
            for (let i = 0; i < pts.length; i++) {
                if (i) run += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)
                if (run >= SEGMENT_GAP || i === pts.length - 1) { segs.push(i); run = 0 }
            }
        }
        const drawn = [...segs.keys()].sort((m, n) => pts[segs[m]!]!.key - pts[segs[n]!]!.key || m - n)
        const crystals = new Set<number>()
        for (const [key, at] of [[0, 0.55], [99, 0.5]] as const) {
            const ks = [...segs.keys()].filter(k => pts[segs[k]!]!.key === key)
            if (ks.length) crystals.add(ks[R((ks.length - 1) * at)]!)
        }
        for (const k of drawn) {
            const pt = pts[segs[k]!]!
            const [nx, ny] = back(pt)
            // the coil lies on its belly; only the raised neck shows it
            const neck = pt.key === 99.5 || pt.key === 1000
            segment(s, pt.x, pt.y, pt.r, neck ? -nx : 0, neck ? -ny : 0, pt.tx, pt.ty)
            // a ridge of small crystal clusters down its back, amethyst and cyan in turn
            if (k % 3 === 1) crystal(s, pt, nx, ny, CLUSTERS[(k / 3 | 0) % CLUSTERS.length]!, 0.45)
            setGems(s, pt, nx, ny, k, tt)
            if (crystals.has(k)) crystal(s, pt, nx, ny, AMETHYST, 1)
        }

        // ── the head: an armoured skull, spiked along the brow, a drill maw at its front ──
        {
            const end = pts[pts.length - 1]!
            const nx0 = end.x
            const ny0 = end.y
            const ca = Math.cos(heading)
            const sa = Math.sin(heading)
            const hp = (lx: number, ly: number): [number, number] => [nx0 + (ca * lx - sa * ly) * HEAD_SCALE, ny0 + (sa * lx + ca * ly) * HEAD_SCALE]
            const shape = (key: string, p: readonly number[]): Surface => {
                const m = mask(s, key)
                const out: number[] = []
                for (let i = 0; i < p.length; i += 2) { const [a, b] = hp(p[i]!, p[i + 1]!); out.push(a, b) }
                poly(m, out, 0, 0, 1)
                return m
            }
            // three great brow spikes, swept back, behind the head
            for (let i = 0; i < 3; i++) {
                const lx = 2 + i * 9
                const [a0x, a0y] = hp(lx - 3, -11)
                const [a1x, a1y] = hp(lx + 4, -12)
                const [tx, ty] = hp(lx - 14 - i * 2, -27 - (i === 1 ? 5 : 0) + i * 2)
                const m = mask(s, 'spike')
                poly(m, [a0x, a0y, a1x, a1y, tx, ty], 0, 0, 1)
                vol(s, m, PLATE, 3, -0.1)
                selOut(s, m, C.stone0)
            }
            // the mandibles, under the maw, spreading as it opens
            for (const side of [-1, 1]) {
                const spread = open * 6 * side
                const [m0x, m0y] = hp(36, 10)
                const [m1x, m1y] = hp(48 + open * 4, 14 + spread)
                const [m2x, m2y] = hp(54 + open * 5, 8 + spread * 1.4)
                line(s, m0x, m0y, m1x, m1y, side < 0 ? C.bone0 : C.bone1, 3)
                line(s, m1x, m1y, m2x, m2y, side < 0 ? C.bone0 : C.bone1, 2)
                px(s, m2x, m2y, C.white)
            }
            // the head: a crown segment, a middle plate and the snout, each overlapping the one behind,
            // the pale of its jaw underneath
            for (const [lx, ly, r] of [[4, 0, 15], [18, 1, 14], [31, 2, 12]] as const) {
                const [hx, hy] = hp(lx, ly)
                segment(s, hx, hy, r * HEAD_SCALE, -sa, ca, ca, sa)
            }
            // weathering: pits knocked into the plates, each shadowed on its lit side and caught below
            for (let i = 0; i < 14; i++) {
                const [a, b] = hp(-6 + hash2(i, 31) * 38, -11 + hash2(i, 37) * 15)
                if (!s.get(R(a), R(b)) || !s.get(R(a) + 1, R(b) + 1)) continue
                px(s, a, b, C.stone0)
                px(s, a + 1, b + 1, C.stone3)
            }
            // a crack of ore glowing down the side of the crown
            {
                const hot = B.glow > 0.5 ? C.gold3 : C.orange
                for (let i = 0; i <= 8; i++) {
                    const [a, b] = hp(-3 + i * 1.3 + (i & 1 ? 1 : -0.5), -3 + i * 1.1)
                    px(s, a, b, i === 4 ? C.gold3 : hot)
                    px(s, a + 1, b, C.lava1)
                }
            }
            // the brow: a raised helmet plate over the crown and the middle plate, riveted, the
            // spikes growing out of it; its lower edge shadows the eyes
            {
                const bm = shape('brow', [-8, -11, 2, -16.5, 16, -15.5, 27, -11.5, 31, -8, 25, -7, 13, -8.5, 1, -8, -6, -6])
                vol(s, bm, PLATE, 9, 0.08)
                selOut(s, bm, C.stone0)
                for (let i = 0; i <= 12; i++) { const [a, b] = hp(-1 + i * 2.2, -7.2 - Math.sin(i / 12 * Math.PI) * 1.5); px(s, a, b, C.ink) }
                for (const lx of [3, 11, 19]) {
                    const [a, b] = hp(lx, -12.5 + (lx === 11 ? -1 : 0))
                    gem(s, a, b, 2, lx === 11 ? 1 : 4, tt, lx)
                }
                // the great stone on its crown
                { const [a, b] = hp(-3, -8); gem(s, a, b, 4, 3, tt, 99) }
            }
            // the cheek guard along the jaw, over the middle plate and the snout
            {
                const cm = shape('cheek', [10, 1, 20, -1.5, 30, -1, 35, 3, 31, 8, 19, 9.5, 11, 7])
                vol(s, cm, PLATE, 9, 0.18)
                selOut(s, cm, C.stone0)
                for (let i = 0; i <= 8; i++) { const [a, b] = hp(14 + i * 2, 4 + Math.sin(i / 8 * Math.PI) * 1.2); px(s, a, b, C.stone1) }
                for (const [lx, ly, kind] of [[17, 1.5, 3], [26, 1.5, 1]] as const) { const [a, b] = hp(lx, ly); gem(s, a, b, 2, kind, tt, lx * 7) }
            }
            // grooves down the snout, running forward into the maw
            for (const [y0, y1] of [[-8.5, -6], [-4.5, -3.5]] as const) {
                for (let i = 0; i <= 8; i++) {
                    const [a, b] = hp(29 + i * 1.1, y0 + (y1 - y0) * i / 8)
                    px(s, a, b, C.stone0)
                    px(s, a, b - 1, C.stone3)
                }
            }
            // three ore-lit eyes in deep sockets under the brow, embers glowing round them
            for (const [lx, ly] of [[15, -4.5], [21, -5.5], [26.5, -4.5]] as const) {
                const [ex, ey] = hp(lx, ly)
                disc(s, ex, ey, 2.7, C.ink)
                px(s, ex - 2, ey + 2, C.lava1)
                px(s, ex + 2, ey + 2, C.lava1)
                px(s, ex, ey + 3, C.lava0)
                px(s, ex, ey, eye)
                px(s, ex + 1, ey, eye)
                px(s, ex, ey + 1, B.glow > 0.5 ? C.gold3 : C.orange)
                px(s, ex, ey - 1, B.glow > 0.5 ? C.white : C.gold3)
            }
            // the drill maw: a ring of teeth round the dark of its throat, turning
            const [mx, my] = hp(41, 3)
            const rx = (3 + open * 4) * HEAD_SCALE
            const ry = (10 + open * 4) * HEAD_SCALE
            const lim = Math.ceil(ry + 2)
            for (let yy = -lim; yy <= lim; yy++) {
                for (let xx = -lim; xx <= lim; xx++) {
                    const lx = xx * ca + yy * sa
                    const ly = -xx * sa + yy * ca
                    const d = (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry)
                    if (d > 1.35) continue
                    s.set(R(mx) + xx, R(my) + yy, d > 1 ? C.stone3 : d > 0.6 ? C.red0 : open > 0.5 ? C.red1 : C.ink)
                }
            }
            for (let i = 0; i < 10; i++) {
                const a = spin + i / 10 * Math.PI * 2
                const lx = Math.cos(a) * rx * 0.85
                const ly = Math.sin(a) * ry * 0.85
                const t0x = mx + ca * lx - sa * ly
                const t0y = my + sa * lx + ca * ly
                const t1x = mx + (ca * lx - sa * ly) * 0.45
                const t1y = my + (sa * lx + ca * ly) * 0.45
                // only the teeth on the near side of the ring show, lit when they face us
                const near = Math.cos(a) > -0.2
                line(s, t0x, t0y, t1x, t1y, near ? C.bone1 : C.bone0)
                if (near) px(s, t1x, t1y, C.white)
            }
            // bony studs round the maw's lip
            for (let i = 0; i < 12; i++) {
                const a = i / 12 * Math.PI * 2
                const lx = Math.cos(a) * (rx + 1.6)
                const ly = Math.sin(a) * (ry + 1.6)
                const sx = mx + ca * lx - sa * ly
                const sy = my + sa * lx + ca * ly
                if (Math.cos(a) < -0.3) continue
                px(s, sx, sy, i & 1 ? C.bone0 : C.bone1)
                px(s, sx + 1, sy + 1, C.brown2)
            }
        }

        finish(s, Entry.Rise, 8)

    },
    fx(dst, st, t, x, y, dir) {
        const k = fr(t, 10, 10)
        // the tunnel the tail runs into, rubble heaped round its mouth, over the tail's end
        {
            const hx = x + dir * (HOLE[0] - 6)
            const hy = y + HOLE[1]
            ditherEllipse(dst, hx, hy + 2, 13, 6, C.ink, 16)
            ditherEllipse(dst, hx, hy + 2, 9, 4, C.purple0, 16)
            for (let i = 0; i < 18; i++) {
                const a = (i / 18) * Math.PI
                const rx = hx + R(Math.cos(a) * (15 + (i % 3)))
                const ry = hy + 2 + R(Math.sin(a) * 7)
                dst.set(rx, ry, i & 1 ? C.stone2 : C.stone3)
                dst.set(rx + 1, ry - 1, i % 3 ? C.brown2 : C.stone1)
            }
        }
        // the toppled cart beside the coil, spilling ore, and the rails torn up toward the tunnel
        {
            const cx = x + dir * 64
            for (let i = 0; i < 26; i++) {
                const rx = cx + dir * (4 + i)
                dst.set(rx, y + 3 - R(Math.max(0, 8 - i) * 0.6), C.steel2)
                if (i % 5 === 0) for (let j = 0; j <= 3; j++) dst.set(rx, y + 2 + (j > 1 ? 1 : 0), C.brown1)
            }
            // the cart on its side: an iron tub, its mouth toward us, a wheel up in the air
            for (let yy = -11; yy <= 0; yy++) for (let xx = -8; xx <= 8; xx++) {
                const edge = yy === -11 || yy === 0 || xx === -8 || xx === 8
                dst.set(cx + xx, y + yy, edge ? C.steel0 : xx < -4 ? C.brown0 : yy < -8 ? C.steel2 : C.steel1)
            }
            for (let xx = -7; xx <= 7; xx += 4) dst.set(cx + xx, y - 6, C.steel3)
            for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; dst.set(cx - dir * 6 + R(Math.cos(a) * 3), y - 14 + R(Math.sin(a) * 3), C.steel1) }
            // ore spilled out of it
            for (let i = 0; i < 9; i++) dst.set(cx - dir * (10 + (i * 3) % 9), y - (i % 3), i % 3 === 0 ? C.gold3 : i & 1 ? C.stone2 : C.gold1)
        }
        // grit trickling off its plates
        if (st !== 'death') for (let i = 0; i < 6; i++) dst.set(x + dir * (-50 + (i % 3) * 30), y - 70 + ((k * 4 + i * 13) % 60), i & 1 ? C.stone3 : C.brown3)
        // bursting out: rocks and earth flung up out of the ground as it surfaces
        if (st === 'entry') {
            const u = q(t)
            const cx = x + dir * COIL_DX
            for (let i = 0; i < 28; i++) {
                const age = u - 0.2 - hash2(i, 2) * 0.5
                if (age < 0 || age > 1.2) continue
                const vx = (hash2(i, 5) - 0.5) * 160
                const vy = -110 - hash2(i, 7) * 120
                const rx = cx + (hash2(i, 9) - 0.5) * 110 + vx * age
                const ry = y - 4 + vy * age + 260 * age * age
                if (ry > y) continue
                dst.set(R(rx), R(ry), i % 3 === 0 ? C.brown2 : i & 1 ? C.stone2 : C.stone3)
                dst.set(R(rx) + 1, R(ry), C.stone1)
            }
            if (u > 0.2 && u < 1.4) ditherEllipse(dst, cx, y - 6 - R((u - 0.2) * 16), R(50 + (u - 0.2) * 40), R(8 + (u - 0.2) * 10), C.bone0, Math.max(1, R(10 * (1.4 - u))))
        }
        // the plunge: stone spraying from where the maw bites down
        if (st === 'attack' && B.strike) {
            const gx = x + dir * 100
            for (let i = 0; i < 16; i++) {
                const a = i / 16 * Math.PI
                dst.set(R(gx + Math.cos(a) * (8 + (i & 1) * 6)), R(y - 22 - Math.sin(a) * (6 + (i % 3) * 4)), i & 1 ? C.stone3 : C.bone1)
            }
        }
    }
}

/**
 * One amethyst shard of the Eruption, from the ground at (x, y), `h` tall and `w` wide at its foot,
 * its tip leaning `lean` px: a lit facet on the left with a bright edge, a shaded one on the right,
 * a glowing ridge between them up to a white tip, a streak of light across it, and now and then, on
 * its own beat, a four-pointed glint off it.
 */
function shard(s: Surface, x: number, y: number, h: number, w: number, lean: number, t: number, seed: number): void {
    const H = R(h)
    if (H < 2) return
    for (let k = 0; k < H; k++) {
        const u = k / H
        const hw = Math.max(0, w * (1 - u) * 0.5)
        const cx = x + lean * u
        const yy = R(y) - k
        for (let dx = -R(hw); dx <= R(hw); dx++) {
            const edge = Math.abs(dx) >= R(hw) - 0.5
            const ridge = u > 0.82 ? C.white : u > 0.4 ? C.pink : C.purple2
            s.set(R(cx) + dx, yy, dx < 0 ? (edge && dx === -R(hw) ? C.pink : C.purple2) : dx === 0 ? ridge : edge ? C.purple0 : C.purple1)
        }
    }
    s.set(R(x + lean), R(y) - H, C.white)
    // a streak of light across the upper facets
    const k0 = R(H * 0.62)
    for (let d = -2; d <= 1; d++) s.set(R(x + lean * (k0 + d) / H) + d, R(y) - k0 - d, C.white)
    // a glint off it, on its own beat
    const g = (t * 1.3 + hash2(seed, 21)) % 1
    if (g < 0.16) {
        const gx = R(x + lean * 0.7) - 1
        const gy = R(y) - R(H * 0.7)
        const arm = g < 0.08 ? 3 : 2
        s.set(gx, gy, C.white)
        for (let i = 1; i <= arm; i++) {
            const c = i === arm ? C.pink : C.white
            s.set(gx + i, gy, c); s.set(gx - i, gy, c); s.set(gx, gy + i, c); s.set(gx, gy - i, c)
        }
    }
}

/** Light on the segments: from the upper left and toward the viewer. */
const LX = -0.45
const LY = -0.62
const LZ = 0.64

/**
 * One armoured segment at (x, y), radius r, shaded as a round volume: armour where it faces up and
 * away, the pale belly where it faces (bx, by) (none when that is zero). Its rear edge (against the tangent) and its lower
 * right rim go dark, which is what parts it from the segment behind it.
 */
function segment(s: Surface, x: number, y: number, r: number, bx: number, by: number, tx: number, ty: number): void {
    const cx = R(x)
    const cy = R(y)
    const lim = Math.ceil(r)
    const r2 = r * r
    const rim = (r - 1.3) * (r - 1.3)
    for (let yy = -lim; yy <= lim; yy++) {
        for (let xx = -lim; xx <= lim; xx++) {
            const d2 = xx * xx + yy * yy
            if (d2 > r2) continue
            const nx = xx / r
            const ny = yy / r
            const nz = Math.sqrt(Math.max(0, 1 - d2 / r2))
            const lum = nx * LX + ny * LY + nz * LZ
            const belly = nx * bx + ny * by > 0.5
            const ramp = belly ? BELLY_RAMP : ARMOUR_RAMP
            let c: number
            if (d2 > rim && (nx * 0.6 + ny * 0.8 > 0.1 || nx * -tx + ny * -ty > 0.35)) c = belly ? C.bone0 : C.stone0
            else if (lum > 0.97 && !belly) c = C.stone3
            else {
                const v = Math.min(0.999, Math.max(0, (lum + 0.25) / 1.15)) * ramp.length
                const b = Math.floor(v)
                const f = v - b
                c = ramp[Math.min(ramp.length - 1, b + (f > 0.62 || (f > 0.4 && bayer(cx + xx, cy + yy, 8)) ? 1 : 0))]!
            }
            s.set(cx + xx, cy + yy, c)
        }
    }
}



/** A cluster of crystal in colours `c` (dark, body, lit, tip), scaled by `size`, grown out of the back of the segment at `p`. */
function crystal(s: Surface, p: Pt, nx: number, ny: number, c: readonly number[], size: number): void {
    const shards = [[-7, 14, -0.4], [0, 24, 0], [6, 17, 0.35], [11, 10, 0.65]] as const
    for (const [off0, len0, lean] of size < 1 ? shards.slice(0, 3) : shards) {
        const off = off0 * size
        const len = len0 * size
        const bx = p.x + nx * p.r * 0.5 + p.tx * off
        const by = p.y + ny * p.r * 0.5 + p.ty * off
        const dx = nx + p.tx * lean
        const dy = ny + p.ty * lean
        const tipx = bx + dx * len
        const tipy = by + dy * len
        const w = 3.4 * Math.max(0.7, size)
        poly(s, [bx - p.tx * w, by - p.ty * w, bx + p.tx * w, by + p.ty * w, tipx, tipy], 0, 0, c[1]!)
        line(s, bx - p.tx * w * 0.6, by - p.ty * w * 0.6, tipx, tipy, c[2]!)
        line(s, bx + p.tx * w, by + p.ty * w, tipx, tipy, c[0]!)
        px(s, tipx, tipy, c[3]!)
    }
    // light caught at the heart of the cluster
    px(s, p.x + nx * p.r * 0.7, p.y + ny * p.r * 0.7, C.white)
}

/** Cut stones: ruby, sapphire, emerald, amethyst, topaz (dark, body, lit). */
const GEM_RAMPS = [
    [C.red0, C.red2, C.red3], [C.blue0, C.blue1, C.cyan], [C.green0, C.green2, C.green4], [C.purple0, C.purple2, C.pink], [C.gold0, C.gold2, C.gold3]
] as const

/**
 * A cut stone at (x, y), `size` px to each point: a dark girdle, its upper-left facets lit, a glint;
 * now and then, on its own beat, a four-pointed sparkle off it.
 */
function gem(s: Surface, x: number, y: number, size: number, kind: number, t: number, seed: number): void {
    const [d, m, l] = GEM_RAMPS[kind % GEM_RAMPS.length]!
    const cx = R(x)
    const cy = R(y)
    for (let yy = -size; yy <= size; yy++) {
        for (let xx = -size; xx <= size; xx++) {
            const k = Math.abs(xx) + Math.abs(yy)
            if (k > size) continue
            s.set(cx + xx, cy + yy, k === size ? d : xx + yy < 0 ? l : m)
        }
    }
    s.set(cx - (size > 2 ? 1 : 0), cy - (size > 2 ? 1 : 0), C.white)
    if ((t * 0.6 + hash2(seed, 13)) % 1 < glint) {
        const arm = size + 2
        for (let i = 1; i <= arm; i++) {
            const c = i < arm ? C.white : l
            s.set(cx + i, cy, c); s.set(cx - i, cy, c); s.set(cx, cy + i, c); s.set(cx, cy - i, c)
        }
    }
}

/**
 * The stones set into one segment's armour: two to four, on its rear half (the next segment covers
 * the front) and on the side the light and the eye find.
 */
function setGems(s: Surface, p: Pt, nx: number, ny: number, k: number, t: number): void {
    const n = 2 + Math.floor(hash2(k, 1) * 3)
    for (let i = 0; i < n; i++) {
        const up = 0.05 + hash2(k, 3 + i) * 0.7
        const along = -(0.2 + hash2(k, 5 + i) * 0.6) * p.r
        const size = hash2(k, 7 + i) < 0.12 ? 4 : hash2(k, 7 + i) < 0.45 ? 3 : 2
        // mostly amethyst and sapphire, now and then a topaz
        const pick = hash2(k, 9 + i)
        gem(s, p.x + nx * p.r * up + p.tx * along, p.y + ny * p.r * up + p.ty * along, size, pick < 0.48 ? 3 : pick < 0.88 ? 1 : 4, t, k * 3 + i)
    }
}

// ── Add waves ───────────────────────────────────────────────────────────────────

const GRUB: Mat5 = { ramp: [C.brown1, C.bone0, C.bone1, C.white], hi: C.white, rim: C.brown1 }
const ORE: Mat5 = { ramp: [C.stone0, C.stone1, C.stone2, C.stone3], hi: C.bone1, rim: C.stone1 }

/** Add wave 1: the Burrow Grub, a pale segmented grub the size of a dog, a ringed maw at its front. */
export const BURROW_GRUB: CreatureDef = {
    name: 'Burrow Grub', size: 48, shadow: 12, accent: C.bone1,
    states: { idle: { dur: 0.8, loop: true }, attack: { dur: 0.8, loop: false }, death: { dur: 1.0, loop: false } },
    draw(s, st, t) {
        const x = s.ax
        const y = s.ay
        let lunge = 0
        let rear = 0
        let die = 0
        let open = 0.3
        if (st === 'attack') {
            const u = q(t) / 0.8
            rear = u < 0.4 ? u / 0.4 : u < 0.6 ? 1 - (u - 0.4) / 0.2 : 0
            lunge = u < 0.4 ? -2 : u < 0.6 ? 7 : R(7 * (1 - (u - 0.6) / 0.4))
            open = u < 0.4 ? 0.3 + u : u < 0.65 ? 1 : 0.4
        }
        if (st === 'death') { die = deathPhase(t, 1.0); open = 0.8 }
        // crawling: each segment rises in turn, a wave running front to back
        const wave = q(t) / 0.8 * Math.PI * 2
        const m = mask(s, 'grub')
        const segs: [number, number, number][] = []
        for (let i = 0; i < 5; i++) {
            const sx = x - 12 + i * 6 + lunge * (i / 4)
            const lift = st === 'idle' ? Math.max(0, Math.sin(wave - i * 1.2)) * 2 : 0
            const sy = y - 5 - lift - (i > 2 ? rear * (i - 2) * 4 : 0) + die * 2
            const r = i === 4 ? 5 : 4 + (i === 2 ? 1 : 0)
            segs.push([sx, sy, r * (1 - die * 0.3)])
            disc(m, sx, sy, r * (1 - die * 0.3), 1)
        }
        vol(s, m, GRUB, 5)
        // the rings between its segments
        for (let i = 1; i < 5; i++) {
            const [sx, sy, r] = segs[i]!
            for (let d = -r; d <= r; d++) if (m.get(R(sx - 3), R(sy + d))) s.set(R(sx - 3), R(sy + d), C.brown1)
        }
        // stubby legs under the front segments
        for (let i = 2; i < 5; i++) { const [sx, sy] = segs[i]!; px(s, R(sx), R(sy) + 4, C.brown1); px(s, R(sx) - 1, R(sy) + 5, C.brown0) }
        // the maw at its front: a dark ring, tiny teeth round it
        const [hx, hy] = segs[4]!
        const mr = 1.5 + open * 2
        disc(s, hx + 4, hy, mr + 1, C.brown1)
        disc(s, hx + 4, hy, mr, die > 0.5 ? C.ink : C.red0)
        for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + q(t) * 4; px(s, R(hx + 4 + Math.cos(a) * mr), R(hy + Math.sin(a) * mr), C.white) }
    }
}

/** Add wave 2: the Ore Beetle, a beetle whose shell is a lump of ore; it cracks it open to spit molten ore. */
export const ORE_BEETLE: CreatureDef = {
    name: 'Ore Beetle', size: 48, shadow: 11, accent: C.orange,
    states: { idle: { dur: 1.0, loop: true }, attack: { dur: 0.8, loop: false }, death: { dur: 1.0, loop: false } },
    draw(s, st, t) {
        const x = s.ax
        const y = s.ay
        let crack = 0
        let die = 0
        let recoil = 0
        if (st === 'attack') {
            const u = q(t) / 0.8
            crack = u < 0.45 ? u / 0.45 : u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4
            recoil = u >= 0.45 && u < 0.6 ? -2 : 0
        }
        if (st === 'death') { die = deathPhase(t, 1.0); crack = 1 - die }
        const leg = fr(t, st === 'idle' ? 6 : 10, 2)
        const bx = x + recoil
        const by = y - 9 + R(die * 3)
        // six stubby legs, stepping
        for (let i = 0; i < 3; i++) {
            const lx = bx - 7 + i * 7
            const f = (leg ? 1 : -1) * (i & 1 ? 1 : -1)
            line(s, lx, by + 4, lx - 3 + f, y - 1, C.stone0)
            line(s, lx - 3 + f, y - 1, lx - 5 + f, y - 1, C.stone0)
        }
        // the shell: a lump of ore, gold-veined, split along the top where it glows
        const m = mask(s, 'ore')
        poly(m, [bx - 12, by + 4, bx - 11, by - 3, bx - 5, by - 8, bx + 3, by - 9, bx + 10, by - 5, bx + 12, by + 3, bx + 4, by + 6, bx - 6, by + 6], 0, 0, 1)
        vol(s, m, ORE, 7)
        selOut(s, m, C.stone0)
        for (const [ox, oy] of [[-7, -2], [5, -4], [-1, 2], [8, 1]] as const) { px(s, bx + ox, by + oy, C.gold2); px(s, bx + ox + 1, by + oy, C.gold3) }
        // the crack across its back: a line of ember at rest, forced open and blazing to spit
        const glow = crack > 0.6 ? C.white : crack > 0.25 ? C.gold3 : C.orange
        for (let i = -8; i <= 8; i++) {
            const cy = by - 6 + R(Math.abs(i) * 0.3) + ((i & 3) === 0 ? 1 : 0)
            px(s, bx + i, cy, glow)
            if (crack > 0.3) { px(s, bx + i, cy - 1, C.orange); if (crack > 0.7) px(s, bx + i, cy + 1, C.lava1) }
        }
        // the head, low in front, its mandibles
        const hm = mask(s, 'bhead')
        ellipse(hm, bx + 13, by + 2, 4, 3, 1)
        vol(s, hm, ORE, 3)
        line(s, bx + 16, by + 1, bx + 19, by - 1, C.stone0)
        line(s, bx + 16, by + 4, bx + 19, by + 5, C.stone0)
        px(s, bx + 14, by + 1, st === 'death' ? C.ink : C.orange)
    }
}
