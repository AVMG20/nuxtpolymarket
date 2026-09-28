// Forge Raid (phased_boss): the Anvil Heart, a forge that learned to walk, and heats as it breaks.
//
// A riveted iron boiler on anvil-block feet, a grated furnace door in its chest, a pressure gauge,
// twin chimney stacks off its shoulders, a scorched leather apron, and for a head an anvil whose horn
// juts forward like a visor. Its near fist is a sledgehammer; its far hand is a pair of tongs
// gripping a blade still glowing from the fire. Each phase is the same body hotter: cold iron with a
// banked fire and grey smoke; red-hot, the seams glowing and embers in the smoke; white-hot, plates
// gone from its chest over a molten core, metal dripping off it and fire jetting from the stacks.

import { C } from './palette'
import type { CreatureDef } from './creature'
import { fr } from './creature'
import { B, Entry, bossStates, drive, finish, bz, elbow, P, rect, px, line, disc, poly, taper, ellipse, q, hash2 } from './boss-kit'
import { mask, vol, eachPx, selOut, type Mat5 } from './raid-kit'

const R = Math.round

type Phase = 1 | 2 | 3

/** The iron, hotter each phase: its ramp, and what its seams and cracks burn. */
// sooty, dark iron, its shadowed edges caught warm by the furnace's light (the reflected rim)
const IRON: Readonly<Record<Phase, Mat5>> = {
    1: { ramp: [C.steel0, C.steel0, C.steel1, C.steel2], hi: C.steel3, rim: C.red1 },
    2: { ramp: [C.steel0, C.steel1, C.red1, C.red2], hi: C.orange, rim: C.orange },
    3: { ramp: [C.red0, C.red1, C.lava1, C.orange], hi: C.gold3, rim: C.gold3 }
}
const SEAM: Readonly<Record<Phase, number>> = { 1: C.steel0, 2: C.orange, 3: C.gold3 }
/** The fire behind the grate, dark → bright. */
const FIRE: Readonly<Record<Phase, readonly number[]>> = {
    1: [C.red0, C.red1, C.orange],
    2: [C.red1, C.orange, C.gold3],
    3: [C.orange, C.gold3, C.white]
}
const LEATHER: Mat5 = { ramp: [C.brown0, C.brown1, C.brown2, C.brown3], hi: C.brown3, rim: C.brown1 }
const WOOD: Mat5 = { ramp: [C.brown0, C.brown1, C.brown2, C.brown3], hi: C.bone1, rim: C.brown1 }

function anvilHeart(phase: Phase): CreatureDef['draw'] {
    const iron = IRON[phase]
    const seam = SEAM[phase]
    const fire = FIRE[phase]
    return function (this: CreatureDef, s, st, t) {
        drive(this, st, t, 12, 1.6)
        const x = s.ax - 6 + B.lunge - B.kb
        const y = s.ay
        const br = B.breath
        const sink = R(B.die * 34)
        const flick = fr(t, 8, 3)
        const glow = Math.max(B.glow, (Math.sin(q(t) / 1.6 * Math.PI * 2) + 1) * 0.2)

        // ── the chimney stacks off its back, behind everything ──
        for (const [cx, h, w] of [[-30, 76, 12], [-10, 86, 11]] as const) {
            const m = mask(s, 'stack')
            const base = y - 92 + br + sink
            taper(m, x + cx, base, x + cx - 2, base - h + 30, w, w - 1, 1)
            vol(s, m, IRON[1], 6, -0.1)
            selOut(s, m, C.steel0)
            const ty = base - h + 30
            rect(s, x + cx - w / 2 - 2, ty - 1, w + 3, 3, C.steel1)
            rect(s, x + cx - w / 2 - 2, ty - 1, w + 3, 1, C.steel3)
            // what comes out of it: smoke, then embers, then fire
            for (let i = 0; i < 5; i++) {
                const u = ((q(t) * 0.8 + i / 5) % 1)
                const sx = x + cx - 3 - u * 10 + Math.sin(u * 6 + i) * 2
                const sy = ty - 4 - u * 26
                if (phase === 3 && u < 0.5) { disc(s, sx, sy + 6, 3 - u * 4, u < 0.25 ? C.gold3 : C.orange); px(s, R(sx), R(sy) + 6, C.white) }
                else disc(s, sx, sy, 2 + u * 3, u > 0.7 ? C.steel1 : C.steel2)
                if (phase >= 2 && i & 1) px(s, R(sx) + 3, R(sy) - 2, C.orange)
            }
        }

        // ── the far arm: the tongs, and the glowing blade in them ──
        {
            const sx = x - 30
            const sy = y - 86 + br + sink
            const hx = x + (st === 'attack' ? bz(-50, -58, -40) : -52)
            const hy = y + (st === 'attack' ? bz(-50, -60, -48) : -48) + sink
            elbow(sx, sy, hx, hy, 24, 24, -1)
            const m = mask(s, 'farArm')
            taper(m, sx, sy, P.x, P.y, 16, 13, 1)
            taper(m, P.x, P.y, hx, hy, 13, 11, 1)
            disc(m, P.x, P.y, 7, 1)
            vol(s, m, iron, 10, -0.3)
            // the tongs, pointing forward, a blade red from the fire in their jaws
            const tx = hx + 30
            const ty = hy - 6
            line(s, hx, hy, tx, ty, C.steel0, 3)
            line(s, hx, hy - 1, tx, ty - 1, C.steel1)
            const bm = mask(s, 'blade')
            poly(bm, [tx - 2, ty - 1, tx + 26, ty - 6, tx + 30, ty - 5, tx + 26, ty - 2, tx - 2, ty + 2], 0, 0, 1)
            vol(s, bm, { ramp: phase === 1 ? [C.red1, C.lava1, C.orange] : [C.orange, C.gold3, C.white], hi: C.white, rim: C.red1 }, 4)
        }

        // ── legs: short iron columns on anvil-block feet ──
        for (const [lx, far] of [[-22, true], [16, false]] as const) {
            const m = mask(s, 'leg')
            taper(m, x + lx, y - 42 + sink, x + lx + 2, y - 14, 25, 23, 1)
            vol(s, m, iron, 10, far ? -0.3 : 0)
            // rivet rows
            for (let k = -44; k < -16; k += 7) { px(s, x + lx - 6, y + k + sink * 0.5, far ? C.steel1 : C.steel3); px(s, x + lx + 7, y + k + sink * 0.5, far ? C.steel0 : C.steel2) }
            // the foot: an anvil block, its horn forward
            const fm = mask(s, 'foot')
            poly(fm, [x + lx - 14, y - 14, x + lx + 12, y - 14, x + lx + 22, y - 11, x + lx + 12, y - 8, x + lx + 10, y, x + lx - 12, y, x + lx - 14, y - 8], 0, 0, 1)
            vol(s, fm, IRON[1], 6, far ? -0.3 : 0)
            if (!far) selOut(s, fm, C.steel0)
        }

        // ── the body: a riveted boiler, banded, the furnace in its chest ──
        const cy = y - 70 + br + sink
        {
            // hunched: the boiler wider at the shoulder than the belly, a hump of plate behind the head
            const m = mask(s, 'boiler')
            ellipse(m, x - 2, cy - 4, 48, 36, 1)
            poly(m, [x - 44, cy, x + 42, cy, x + 34, cy + 28, x - 38, cy + 28], 0, 0, 1)
            disc(m, x - 18, cy - 30, 20, 1)
            vol(s, m, iron, 22)
            // bands and their rivets
            for (const dy of [-26, 20]) {
                eachPx(m, (px_, py) => { if (py === cy + dy || py === cy + dy + 1) s.set(px_, py, py === cy + dy ? iron.ramp[2]! : iron.ramp[0]!) })
                for (let k = -34; k <= 30; k += 6) if (m.get(x + k, cy + dy)) px(s, x + k, cy + dy - 1, C.white)
            }
            // glowing seams and cracks, more of them each phase
            for (let i = 0; i < (phase - 1) * 6; i++) {
                const sx0 = x - 34 + R(hash2(phase * 7, i) * 64)
                const sy0 = cy - 30 + R(hash2(phase + 11, i) * 56)
                if (!m.get(sx0, sy0)) continue
                const d = (i & 1) ? 1 : -1
                line(s, sx0, sy0, sx0 + 3 * d, sy0 + 4, seam)
                line(s, sx0 + 3 * d, sy0 + 4, sx0 + 1 * d, sy0 + 8, seam)
            }
            // white-hot: plates gone over the core, the molten metal behind showing
            if (phase === 3) {
                for (const [ox, oy, w, h] of [[-30, -18, 12, 10], [18, -30, 10, 8], [-26, 8, 10, 8]] as const) {
                    rect(s, x + ox, cy + oy, w, h, C.ink)
                    rect(s, x + ox + 1, cy + oy + 1, w - 2, h - 2, flick ? C.gold3 : C.orange)
                    px(s, x + ox + 2, cy + oy + 2, C.white)
                }
            }
            selOut(s, m, C.steel0)
        }
        // the leather apron, scorched, hanging from the belly
        {
            const m = mask(s, 'apron')
            poly(m, [x - 20, cy + 16, x + 26, cy + 16, x + 30, cy + 46, x - 22, cy + 46], 0, 0, 1)
            vol(s, m, LEATHER, 10)
            // scorched along its hem, more each phase
            eachPx(m, (px_, py) => { if (py > cy + 40 - phase * 2 && hash2(px_ * 3, py) < 0.3) s.set(px_, py, py > cy + 43 ? C.ink : C.brown0) })
            line(s, x - 20, cy + 16, x + 26, cy + 16, C.steel1, 2)
            for (let k = -16; k <= 22; k += 9) px(s, x + k, cy + 16, C.steel3)
        }
        // the furnace: a grated door in the chest, the fire behind it breathing
        {
            const fx = x + 8
            const fy = cy - 4
            rect(s, fx - 14, fy - 12, 28, 24, C.ink)
            const m = mask(s, 'fire')
            rect(m, fx - 12, fy - 10, 24, 20, 1)
            eachPx(m, (px_, py) => {
                const u = (py - (fy - 10)) / 20
                const f = Math.sin(px_ * 0.9 + q(t) * 9) * 0.15 + (1 - u) * 0.2
                const k = Math.min(2, Math.max(0, Math.floor((u + f + glow * 0.3) * 2.2)))
                s.set(px_, py, fire[k]!)
            })
            // the grate over it
            for (let i = 0; i < 5; i++) rect(s, fx - 12, fy - 9 + i * 5, 24, 1, C.steel0)
            for (let i = 0; i < 4; i++) rect(s, fx - 10 + i * 6, fy - 10, 1, 20, C.steel1)
            rect(s, fx - 14, fy - 12, 28, 1, C.steel3)
            // the gauge beside it, its needle climbing with the phase
            const gx = x - 22
            const gy = cy - 10
            disc(s, gx, gy, 5, C.ink); disc(s, gx, gy, 4, C.bone1)
            const na = -Math.PI * 0.9 + phase * 0.6 + Math.sin(q(t) * 11) * 0.08
            line(s, gx, gy, gx + Math.cos(na) * 3, gy + Math.sin(na) * 3, C.red1)
            disc(s, gx, gy, 0.5, C.ink)
        }

        // ── the head: an anvil, its horn forward like a visor, eyes burning under it ──
        {
            const hy = cy - 42 + R(bz(0, -4, 4))
            const m = mask(s, 'head')
            poly(m, [x - 24, hy - 12, x + 20, hy - 12, x + 34, hy - 10, x + 52, hy - 7, x + 34, hy - 2, x + 18, hy, x + 14, hy + 14, x - 18, hy + 14, x - 24, hy], 0, 0, 1)
            vol(s, m, IRON[phase === 3 ? 2 : 1], 10)
            selOut(s, m, C.steel0)
            rect(s, x - 24, hy - 12, 44, 1, C.steel3) // the face of the anvil, polished by use
            // the eye slit
            rect(s, x + 2, hy + 3, 14, 3, C.ink)
            const eye = B.hurt ? C.white : B.glow > 0.4 ? C.white : fire[2]!
            rect(s, x + 6, hy + 4, 3, 1, eye); rect(s, x + 12, hy + 4, 3, 1, eye)
            // a hardy hole and pritchel hole in its face
            rect(s, x - 10, hy - 9, 3, 2, C.ink); px(s, x - 2, hy - 9, C.ink)
            if (phase === 3) for (let i = 0; i < 3; i++) px(s, x - 14 + i * 12, hy + 14 + ((flick + i) % 3) * 2, C.gold3)
        }

        // ── the near arm: the sledgehammer fist, raised and brought down ──
        {
            const sx = x + 26
            const sy = cy - 22
            const hand = st === 'attack' ? [bz(46, 30, 70), bz(-40, -128, -20)] : st === 'death' ? [40, -18] : [44, -38 + (st === 'idle' ? br : 0)]
            const hx = x + hand[0]!
            const hy = y + hand[1]! + sink
            elbow(sx, sy, hx, hy, 26, 26, st === 'attack' && B.wind > 0.3 ? -1 : 1)
            const m = mask(s, 'arm')
            disc(m, sx, sy, 12, 1)
            taper(m, sx, sy, P.x, P.y, 20, 16, 1)
            taper(m, P.x, P.y, hx, hy, 16, 14, 1)
            disc(m, P.x, P.y, 8, 1)
            vol(s, m, iron, 12)
            selOut(s, m, C.steel0)
            // the pauldron: a riveted plate over the shoulder
            for (let k = -8; k <= 8; k += 4) px(s, R(sx) + k, R(sy) - 10 + Math.abs(k) / 3, C.white)
            // the haft through the fist, and the hammer head on the end of it
            const a = Math.atan2(hy - P.y, hx - P.x)
            const ca = Math.cos(a)
            const sa = Math.sin(a)
            const tx = hx + ca * 16
            const ty = hy + sa * 16
            const wm = mask(s, 'haft')
            taper(wm, hx - ca * 6, hy - sa * 6, tx, ty, 4, 4, 1)
            vol(s, wm, WOOD, 4)
            const hm = mask(s, 'hammer')
            poly(hm, [tx - sa * 18 - ca * 9, ty + ca * 18 - sa * 9, tx - sa * 18 + ca * 12, ty + ca * 18 + sa * 12, tx + sa * 18 + ca * 12, ty - ca * 18 + sa * 12, tx + sa * 18 - ca * 9, ty - ca * 18 - sa * 9], 0, 0, 1)
            vol(s, hm, IRON[phase === 1 ? 1 : 2], 8)
            selOut(s, hm, C.steel0)
            // its striking face, bright from the anvil
            line(s, tx - sa * 17 + ca * 12, ty + ca * 17 + sa * 12, tx + sa * 17 + ca * 12, ty - ca * 17 + sa * 12, phase === 1 ? C.steel3 : C.gold3)
            // bands round the hammer head
            for (const k of [-3, 6]) line(s, tx - sa * 18 + ca * k, ty + ca * 18 + sa * k, tx + sa * 18 + ca * k, ty - ca * 18 + sa * k, C.steel0)
            // the fist closed on the haft
            disc(s, hx, hy, 6, iron.ramp[1]!)
            disc(s, hx - 1, hy - 1, 4, iron.ramp[2]!)
        }
        finish(s, Entry.Rise, 0)
    }
}

function forgeDef(phase: Phase): CreatureDef {
    const def: CreatureDef = {
        name: `The Anvil Heart — phase ${phase}`, size: 256, room: 12, shadow: 50, accent: phase === 1 ? C.orange : phase === 2 ? C.lava1 : C.gold3,
        states: bossStates(1.6, 1.6, 2.4),
        draw: () => {},
        fx(dst, st, t, x, y, dir) {
            const k = fr(t, 10, 10)
            // sparks spat from the furnace, more each phase
            for (let i = 0; i < phase * 3; i++) dst.set(x + dir * (-10 + ((i * 13 + k * 5) % 44)), y - 80 - ((k * 3 + i * 7) % 30), phase === 3 ? C.gold3 : C.orange)
            // white-hot, it drips: molten metal pooling at its feet
            if (phase === 3) for (let i = 0; i < 6; i++) dst.set(x + dir * (-30 + i * 11), y - ((k + i * 3) % 6), i & 1 ? C.gold3 : C.orange)
            // the hammer falls: sparks and a ring of heat on the ground
            if (st === 'attack' && B.strike) {
                const gx = x + dir * 80
                for (let i = 0; i < 18; i++) {
                    const a = i / 18 * Math.PI
                    dst.set(R(gx + Math.cos(a) * (8 + (i & 1) * 8)), R(y - 2 - Math.sin(a) * (6 + (i % 3) * 4)), i & 1 ? C.gold3 : C.orange)
                }
            }
        }
    }
    def.draw = anvilHeart(phase).bind(def)
    return def
}

export const ANVIL_HEART = [forgeDef(1), forgeDef(2), forgeDef(3)] as const
