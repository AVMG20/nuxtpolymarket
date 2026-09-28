// Training Grounds Raid (solo_boss): the Drillmaster, every drill in the yard built into one
// machine. A great wing-chun pell on an iron-bound turntable: a wooden post banded in iron, a straw
// chest painted with a target and stuck with arrows, a sack head with a painted scowl and a straw
// moustache under a kettle helmet, and six arms on iron joints, each gripping a practice weapon.
// It turns its arms through the air at rest and throws the near three in a flurry on the attack.

import { C } from './palette'
import type { CreatureDef } from './creature'
import { fr } from './creature'
import { B, Entry, bossStates, drive, finish, bz, chain, rect, px, line, disc, poly, taper, ellipse, q } from './boss-kit'
import { mask, vol, eachPx, selOut, type Mat5 } from './raid-kit'

const R = Math.round

const WOOD: Mat5 = { ramp: [C.brown0, C.brown1, C.brown2, C.brown3], hi: C.bone1, rim: C.brown1 }
const PALE: Mat5 = { ramp: [C.brown1, C.brown2, C.brown3, C.bone1], hi: C.white, rim: C.brown2 }
const IRON: Mat5 = { ramp: [C.steel0, C.steel1, C.steel2, C.steel3], hi: C.white, rim: C.steel1 }
const BRASS: Mat5 = { ramp: [C.gold0, C.gold1, C.gold2, C.gold3], hi: C.white, rim: C.gold1 }
const SACK: Mat5 = { ramp: [C.brown1, C.brown2, C.brown3, C.bone1], hi: C.bone1, rim: C.brown2 }
const STRAW = [C.gold1, C.gold2, C.gold3] as const
const PAD: Mat5 = { ramp: [C.red0, C.red1, C.red2, C.red3], hi: C.red3, rim: C.red1 }

type Weapon = 'sword' | 'spear' | 'mace' | 'shield' | 'axe' | 'club'

/** One arm: its shoulder on the post, its rest angle, its weapon, and where it falls in the flurry. */
interface Arm { sy: number, a: number, w: Weapon, k: number }
const NEAR: readonly Arm[] = [{ sy: -98, a: -0.7, w: 'sword', k: 0 }, { sy: -80, a: 0.05, w: 'spear', k: 1 }, { sy: -62, a: 0.75, w: 'mace', k: 2 }]
const FAR: readonly Arm[] = [{ sy: -100, a: Math.PI + 0.55, w: 'shield', k: 0 }, { sy: -82, a: Math.PI - 0.05, w: 'axe', k: 1 }, { sy: -64, a: Math.PI - 0.7, w: 'club', k: 2 }]

export const DRILLMASTER: CreatureDef = {
    name: 'The Drillmaster', size: 256, room: 12, shadow: 50, accent: C.red2,
    states: bossStates(1.4, 1.8, 2.2),
    draw(s, st, t) {
        drive(this, st, t, 12, 1.8)
        const x = s.ax - 4 + B.lunge - B.kb
        const y = s.ay
        const sink = R(B.die * 30)
        const top = -118 + B.breath + sink
        const ph = q(t) / 1.8 * Math.PI * 2
        const lean = R(B.die * 10)

        // an arm's angle now: swaying at rest, thrown back and forward in turn on the attack, hanging when it dies
        const angle = (arm: Arm, near: boolean): number => {
            if (st === 'death') return arm.a + (near ? 1 : -1) * B.die * (near ? 1.6 - arm.a : 1.2)
            if (st === 'attack' && near) {
                const off = arm.k * 0.12
                const w = Math.max(0, Math.min(1, B.wind * 1.2 - off))
                return arm.a - w * 1.6 + (B.strike || B.rec > 0 ? B.rec * (0.9 - off) : 0)
            }
            return arm.a + Math.sin(ph + arm.k * 1.7) * 0.12 * (near ? 1 : -1)
        }
        const armAt = (arm: Arm, near: boolean, far: boolean): void => {
            const sx = x + (near ? 9 : -9) + lean
            const sy = y + arm.sy + B.breath + sink
            const a = angle(arm, near)
            const ex = sx + Math.cos(a) * 20
            const ey = sy + Math.sin(a) * 20
            const a2 = a + (near ? 0.35 : -0.35)
            const hx = ex + Math.cos(a2) * 18
            const hy = ey + Math.sin(a2) * 18
            weapon(arm.w, hx, hy, a2, far)
            const m = mask(s, 'arm')
            taper(m, sx, sy, ex, ey, 6, 5, 1)
            taper(m, ex, ey, hx, hy, 5, 4, 1)
            vol(s, m, WOOD, 5, far ? -0.3 : 0)
            if (!far) selOut(s, m, C.brown0)
            // the iron joints: at the post, at the elbow, the hand a clamp
            for (const [jx, jy, r] of [[sx, sy, 3.5], [ex, ey, 3], [hx, hy, 3]] as const) {
                disc(s, jx, jy, r, far ? C.steel0 : C.steel1)
                px(s, R(jx) - 1, R(jy) - 1, far ? C.steel1 : C.steel3)
            }
        }
        const weapon = (w: Weapon, hx: number, hy: number, a: number, far: boolean): void => {
            const ca = Math.cos(a)
            const sa = Math.sin(a)
            const bias = far ? -0.3 : 0
            const m = mask(s, 'weapon')
            if (w === 'sword' || w === 'axe' || w === 'club') {
                const len = w === 'sword' ? 30 : w === 'axe' ? 24 : 22
                taper(m, hx - ca * 5, hy - sa * 5, hx + ca * len, hy + sa * len, w === 'club' ? 4 : 3, w === 'club' ? 7 : w === 'sword' ? 3 : 2, 1)
                if (w === 'axe') {
                    const ax = hx + ca * (len - 5)
                    const ay = hy + sa * (len - 5)
                    poly(m, [ax + sa * 2, ay - ca * 2, ax + sa * 11 - ca * 5, ay - ca * 11 - sa * 5, ax + sa * 12 + ca * 6, ay - ca * 12 + sa * 6, ax + ca * 4, ay + sa * 4], 0, 0, 1)
                }
                vol(s, m, w === 'sword' ? PALE : WOOD, 5, bias)
                if (w === 'sword') {
                    // a wooden blade: a crossguard of iron, a red cloth wrap
                    line(s, hx + sa * 5, hy - ca * 5, hx - sa * 5, hy + ca * 5, far ? C.steel0 : C.steel2, 2)
                    line(s, hx + ca * 4, hy + sa * 4, hx + ca * 26, hy + sa * 26, C.brown2)
                }
                if (w === 'club') for (let k = 8; k < 22; k += 4) { const cx = hx + ca * k; const cy = hy + sa * k; px(s, R(cx - sa * 3), R(cy + ca * 3), C.steel2); px(s, R(cx + sa * 3), R(cy - ca * 3), C.steel2) }
            } else if (w === 'spear') {
                taper(m, hx - ca * 8, hy - sa * 8, hx + ca * 34, hy + sa * 34, 3, 2, 1)
                vol(s, m, WOOD, 4, bias)
                // the padded tip: a red cloth ball bound with cord
                const pm = mask(s, 'pad')
                disc(pm, hx + ca * 37, hy + sa * 37, 5, 1)
                vol(s, pm, PAD, 5, bias)
                line(s, hx + ca * 33 - sa * 4, hy + sa * 33 + ca * 4, hx + ca * 33 + sa * 4, hy + sa * 33 - ca * 4, C.bone0)
            } else if (w === 'mace') {
                taper(m, hx - ca * 4, hy - sa * 4, hx + ca * 16, hy + sa * 16, 3, 3, 1)
                disc(m, hx + ca * 21, hy + sa * 21, 7, 1)
                vol(s, m, WOOD, 6, bias)
                // iron studs round the head
                for (let i = 0; i < 6; i++) { const b = i / 6 * Math.PI * 2; disc(s, hx + ca * 21 + Math.cos(b) * 6, hy + sa * 21 + Math.sin(b) * 6, 1.2, far ? C.steel0 : C.steel2) }
            } else {
                // a round target shield, red rings on pale wood, an iron boss
                disc(m, hx, hy, 12, 1)
                vol(s, m, PALE, 10, bias)
                for (const [r, c] of [[9, C.red1], [7, C.bone1], [5, C.red1]] as const) {
                    for (let i = 0; i < 40; i++) { const b = i / 40 * Math.PI * 2; px(s, R(hx + Math.cos(b) * r), R(hy + Math.sin(b) * r), far ? C.red0 : c) }
                }
                disc(s, hx, hy, 2.5, far ? C.steel0 : C.steel2)
            }
        }

        // ── behind: the far arms ──
        for (const arm of FAR) armAt(arm, false, true)

        // ── the turntable, iron-banded, a brass cog turning in its face ──
        {
            const m = mask(s, 'base')
            taper(m, x - 42, y - 10, x + 42, y - 10, 16, 16, 1)
            disc(m, x - 42, y - 10, 8, 1)
            disc(m, x + 42, y - 10, 8, 1)
            vol(s, m, WOOD, 10)
            for (const yy of [y - 17, y - 4]) {
                line(s, x - 46, yy, x + 46, yy, C.steel1, 2)
                for (let i = -44; i <= 44; i += 8) px(s, x + i, yy, C.steel3)
            }
            // planks
            for (let i = -36; i <= 36; i += 12) line(s, x + i, y - 15, x + i, y - 6, C.brown0)
            const gx = x + 28
            const gy = y - 10
            const turn = q(t) * (st === 'attack' ? 6 : 1.5)
            const gm = mask(s, 'cog')
            disc(gm, gx, gy, 8, 1)
            for (let i = 0; i < 10; i++) { const b = turn + i / 10 * Math.PI * 2; rect(gm, R(gx + Math.cos(b) * 9) - 1, R(gy + Math.sin(b) * 9) - 1, 3, 3, 1) }
            vol(s, gm, BRASS, 6)
            disc(s, gx, gy, 3, C.gold0)
            px(s, gx, gy, C.gold3)
        }

        // ── the post, banded in iron ──
        {
            const m = mask(s, 'post')
            taper(m, x + lean * 0.3, y - 16, x + lean, y + top + 4, 22, 18, 1)
            vol(s, m, WOOD, 12)
            eachPx(m, (px_, py) => { if (((px_ * 7 + (py >> 2)) % 11) === 0) s.set(px_, py, C.brown0) }) // grain
            for (const yy of [-30, -54]) {
                const by = y + yy + sink * 0.5
                rect(s, x - 12, by, 25, 3, C.steel1)
                rect(s, x - 12, by, 25, 1, C.steel3)
                px(s, x - 8, by + 1, C.steel3); px(s, x + 8, by + 1, C.steel3)
            }
        }

        // ── the chest: a straw sack, a target painted on it, arrows in it, straps crossing ──
        const cy = y + top + 40
        {
            const m = mask(s, 'chest')
            ellipse(m, x + 2 + lean, cy, 24, 22, 1)
            vol(s, m, SACK, 14)
            // burlap weave and stitched seams
            eachPx(m, (px_, py, edge) => { if (!edge && ((px_ + py * 2) % 5 === 0)) s.set(px_, py, C.brown1) })
            for (let i = -18; i <= 18; i += 2) px(s, x + 2 + lean + i, cy - 12 + (i & 2 ? 1 : 0), C.brown0)
            // straw bursting from a split seam
            for (let i = 0; i < 6; i++) line(s, x - 18 + lean, cy + 4 + i * 2, x - 25 + lean - (i & 1) * 2, cy + 1 + i * 3, STRAW[i % 3]!)
            // the target
            const tx = x + 9 + lean
            const ty = cy + 2
            for (const [r, c] of [[11, C.red1], [9, C.bone1], [7, C.red2], [5, C.bone1], [3, C.red2]] as const) disc(s, tx, ty, r, c)
            px(s, tx - 1, ty - 1, C.red3)
            // straps crossing, a brass buckle where they meet
            line(s, x - 16 + lean, cy - 18, x + 20 + lean, cy + 16, C.brown0, 3)
            line(s, x - 16 + lean, cy - 17, x + 20 + lean, cy + 15, C.brown1)
            rect(s, x + 1 + lean, cy - 2, 5, 5, C.gold1); rect(s, x + 2 + lean, cy - 1, 3, 3, C.gold3)
            // arrows stuck in it
            for (const [ax, ay, len] of [[14, -8, 16], [4, 10, 14], [18, 6, 12]] as const) {
                const x0 = tx + ax - 9
                const y0 = ty + ay
                line(s, x0, y0, x0 - len, y0 - len * 0.35, C.brown2)
                line(s, x0 - len, y0 - len * 0.35, x0 - len - 3, y0 - len * 0.35 - 3, C.white)
                line(s, x0 - len, y0 - len * 0.35 + 1, x0 - len - 3, y0 - len * 0.35 + 3, C.red2)
            }
        }

        // ── the head: a sack face with a painted scowl and a straw moustache, under a kettle helmet ──
        {
            const hx = x + 4 + lean * 1.5
            const hy = y + top + 8 + R(bz(0, -3, 3)) + R(B.die * 6)
            const m = mask(s, 'head')
            disc(m, hx, hy, 13, 1)
            vol(s, m, SACK, 12)
            eachPx(m, (px_, py, edge) => { if (!edge && ((px_ + py * 2) % 5 === 0)) s.set(px_, py, C.brown1) })
            // the scowl: brows slanting down to the nose, eyes that burn on the attack
            line(s, hx + 1, hy - 6, hx + 7, hy - 3, C.ink, 2)
            line(s, hx + 13, hy - 6, hx + 9, hy - 3, C.ink, 2)
            const eye = B.hurt ? C.white : B.glow > 0.3 ? C.red3 : C.red2
            rect(s, R(hx) + 4, R(hy) - 2, 3, 2, C.bone1); px(s, R(hx) + 5, R(hy) - 2, eye)
            rect(s, R(hx) + 9, R(hy) - 2, 3, 2, C.bone1); px(s, R(hx) + 10, R(hy) - 2, eye)
            // the moustache: two great sweeps of straw, and the stitched mouth under it
            for (const d of [-1, 1]) {
                for (let i = 0; i < 4; i++) {
                    const x0 = R(hx) + 8
                    line(s, x0, R(hy) + 3 + (i >> 1), x0 + d * (7 + i), R(hy) + 2 + i, STRAW[(i + 1) % 3]!)
                }
            }
            const mo = B.strike || B.roar ? 3 : 1
            rect(s, R(hx) + 5, R(hy) + 6, 7, mo, C.ink)
            if (mo > 1) rect(s, R(hx) + 6, R(hy) + 7, 5, mo - 1, C.red0)
            // the kettle helmet: a wide brim, a domed crown, a red horsehair crest
            const km = mask(s, 'kettle')
            ellipse(km, hx + 2, hy - 10, 18, 3, 1)
            disc(km, hx + 2, hy - 14, 11, 1)
            rect(km, R(hx) - 12, R(hy) - 11, 30, 5, 0)
            ellipse(km, hx + 2, hy - 10, 18, 3, 1)
            vol(s, km, IRON, 10)
            selOut(s, km, C.steel0)
            for (let i = -8; i <= 12; i += 5) px(s, R(hx) + i, R(hy) - 10, C.steel3) // rivets on the brim
            for (let i = 0; i < 5; i++) {
                const cx = hx + 2 - 4 + i * 2
                chain(s, cx, hy - 24, cx - 6 - i, hy - 30 + i, cx - 14 - i * 2, hy - 22 + i * 2 + Math.sin(ph + i) * 1.5, 2.5, 1, [C.red1, C.red2, C.red3], 8)
            }
        }

        // ── in front: the near arms ──
        for (const arm of NEAR) armAt(arm, true, false)
        finish(s, Entry.Drop, 0)
    },
    fx(dst, st, t, x, y, dir) {
        const k = fr(t, 10, 8)
        // straw flying off it when it is struck and when it swings
        if (st === 'hit' || st === 'death' || (st === 'attack' && B.strike)) {
            for (let i = 0; i < 12; i++) dst.set(x + dir * (-30 + ((i * 17 + k * 7) % 70)), y - 110 + ((i * 13 + k * 9) % 70), i % 3 === 0 ? C.gold3 : i % 3 === 1 ? C.gold2 : C.gold1)
        }
        // the whistle of the swing
        if (st === 'attack' && B.strike) for (let i = 0; i < 16; i++) dst.set(x + dir * (50 + i * 3), y - 100 + i * 5 + (i & 1), i & 1 ? C.white : C.bone1)
    }
}
