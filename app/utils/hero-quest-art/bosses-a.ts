// World bosses and super bosses, Worlds 1–5 (asset-list §1.4). Each is bespoke art drawn as
// an inhabitant of its world, with Idle, Attack, Hit, Death and an Entry — the boss arriving.
// Bosses are 96px buffers, super bosses 128px and the most elaborate thing in their world.

import { C } from './palette'
import type { BossSpecial, CreatureDef } from './creature'
import { fr, sm } from './creature'
import type { Mat } from './weapons'
import type { Surface } from './surface'
import {
    B, Entry, bossStates, withSpecial, spAttack, drive, finish, bz, ball, chain, spikes, mouth,
    limbT, reach, elbow, waterline, drawPool, type Pool, P, rect, px, line, disc, ellipse, tri, quad, dither, ditherEllipse, arc, poly, q, wv, hash2
} from './boss-kit'
import { dome, ditherDisc } from './surface'
import { blast, blob, shockRing } from './vfx-cinematic'
import { sq, sp, hitTarget, chest, debris, spike, flames, crack, pit, DUST6, FIRE6, FROST6, ROT6, WATER6 } from './special-kit'

const R = Math.round

const HIDE: Mat = [C.brown0, C.brown1, C.brown2]
const SCALE_RED: Mat = [C.red1, C.orange, C.gold2]
const OBSIDIAN: Mat = [C.void, C.stone0, C.stone1]

// ═══════════════════════════════════════════════════════════════ 1 · Thornwick Vale

// Stage 5: the goblins' warboss riding Old Gnarlhide into the gate, the leader of the goblins
// the run has been fighting, on the beast. Stage 10: Gorsecrown, the Wicker King, a hollow
// effigy woven from hedge-wood with a carved goat skull for a head, gorse-fire in his ribs and
// gorse at the roots of his horns: the thing the hedgerows have become.

const GOBLIN: Mat = [C.green1, C.green2, C.green3]
const LEATHER: Mat = [C.brown0, C.brown1, C.brown2]
const IRON: Mat = [C.steel0, C.steel1, C.steel2]
const WICKER: Mat = [C.brown1, C.brown2, C.brown3]
const SKULL: Mat = [C.brown2, C.brown3, C.bone0]
const HORN: Mat = [C.brown1, C.brown2, C.bone0]
const HORN_FAR: Mat = [C.brown0, C.brown1, C.brown2]

/**
 * The cleaver: a haft from the hand along `a`, then a broad blade on the side the chop leads
 * with, its edge bright and a rust bloom near the spine.
 */
function cleaver(s: Surface, hx: number, hy: number, a: number): void {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const nx = -dy
    const ny = dx
    line(s, R(hx - dx * 2), R(hy - dy * 2), R(hx + dx * 4), R(hy + dy * 4), C.brown0, 2)
    for (let k = 4; k <= 15; k++) {
        const w = k < 6 ? 4 : 6
        const bx = hx + dx * k
        const by = hy + dy * k
        line(s, R(bx), R(by), R(bx + nx * w), R(by + ny * w), k & 1 ? IRON[1] : IRON[0])
        px(s, R(bx + nx * w), R(by + ny * w), C.steel3)
        if (k % 4 === 1) px(s, R(bx + nx), R(by + ny), C.orange)
    }
    px(s, R(hx + dx * 15 + nx * 6), R(hy + dy * 15 + ny * 6), C.white)
}

/**
 * Tusk Charge: the boar paws the ground, dust kicking up behind it, then charges through the front
 * rank in a wake of dust and knocks the two nearest flying.
 */
const TUSK_CHARGE: BossSpecial = {
    name: 'Tusk Charge', tint: 'dusk0', hits: [1.0, 1.12], spread: true,
    fx(s, t, st) {
        const d = st.dir
        // pawing: dust kicked up behind it
        for (let k = 0; k < 3; k++) debris(s, st.bx - d * 18, st.by - 2, st.by, t, 0.1 + k * 0.22, 7, 60, 'dust', 11 + k, 0.5)
        // the charge: a wake of dust streaming behind the boar's head as it closes
        const u = sp(t, 0.78, 1.06)
        if (u > 0 && u < 1) {
            const hx = st.bx + d * (26 + 30 * u)
            for (let i = 0; i < 12; i++) {
                const len = 6 + (i * 7) % 10
                const y = st.by - 3 - (i * 5) % 18
                const x0 = hx - d * (8 + (i * 11) % 30)
                line(s, R(x0), y, R(x0 - d * len), y, i & 1 ? C.bone1 : C.stone3)
            }
        }
        // the impact: the front two knocked flying, the ground torn up round them
        for (let i = 0; i < 2; i++) {
            const p = hitTarget(st, i, true)
            const t0 = 1.0 + i * 0.12
            blast(s, p.x, chest(p), t, t0, 10, 0.55, DUST6, 71 + i, 'dust')
            debris(s, p.x, p.y - 2, p.y, t, t0, 12, 110, 'dust', 81 + i)
        }
        const f = st.party[0]!
        shockRing(s, f.x, f.y - 1, t, 1.0, 0.5, 4, 30, C.white, true)
        debris(s, st.bx + d * 50, st.by - 1, st.by, t, 1.35, 10, 70, 'dust', 91, 0.6) // the skid back
    }
}

/**
 * Old Gnarlhide, saddled and harnessed, the goblins' chieftain on his back in a
 * scrap-iron helm under a bramble crown, a bone mantle, a heavy cleaver, and a tattered war
 * banner on a pole behind him. The boar charges; the rider chops as it lands.
 */
export const OLD_GNARLHIDE: CreatureDef = {
    name: 'Old Gnarlhide', size: 128, shadow: 24, accent: C.red2,
    states: withSpecial(bossStates(1.1, 1.4, 1.8), 2.2),
    special: TUSK_CHARGE,
    draw(s, st, t) {
        drive(this, st, t, 12, 1.4)
        // the charge: pawing and rearing on the wind-up, then a gallop of 30px through the front rank
        if (st === 'special') spAttack(0.36, 0.48, 0.6, 30)
        const x = s.ax - 8 + B.lunge - B.kb
        const y = s.ay
        const charge = B.wind > 0 ? B.wind : B.strike ? 1 : B.rec
        const by = y - 16 + B.breath + R(B.die * 4)
        const step = st === 'entry' || (st === 'special' && B.sp > 0.3 && B.sp < 0.62) ? fr(t, st === 'special' ? 14 : 8, 4) : B.strike ? 1 : 0
        const flap = fr(t, 4, 2)

        // the rider's seat, and the banner pole strapped behind it
        const rx = x - 4
        const ry = by - 11 + R(B.die * 6)
        const lean = R(charge * 2)
        line(s, rx - 8, ry + 2, rx - 11, ry - 36, C.brown1, 2)
        px(s, rx - 11, ry - 37, C.bone1); px(s, rx - 12, ry - 38, C.bone1); px(s, rx - 10, ry - 38, C.bone1) // skull finial
        px(s, rx - 11, ry - 38, C.ink)
        for (let i = 0; i < 12; i++) {
            const len = 10 - (i >> 2) + ((i + flap) % 3 === 0 ? -2 : 0)
            const c = i < 2 ? C.red3 : i > 9 ? C.red1 : C.red2
            line(s, rx - 12, ry - 35 + i, rx - 12 - len - (flap && i > 6 ? 1 : 0), ry - 35 + i + (i > 6 ? flap : 0), c)
        }
        rect(s, rx - 17, ry - 31, 3, 2, C.bone1) // a daubed claw mark on the rag

        // boar legs, far pair then near
        const legH = R(10 - B.die * 6)
        for (const [lx, far] of [[-13, true], [9, true], [-9, false], [13, false]] as const) {
            const off = (step & 1) && !far ? 2 : 0
            rect(s, x + lx + off, by + 5, 5, legH, far ? C.brown0 : C.brown1)
            rect(s, x + lx + off, y - 2, 5, 2, C.ink)
        }
        // boar body and bristles
        ball(s, x, by, 21, 11, HIDE)
        dither(s, x - 18, by + 3, 32, 6, C.brown0, 6)
        for (let i = 0; i < 8; i++) line(s, x - 17 + i * 4, by - 6 + (i & 1), x - 19 + i * 4, by - 2, C.brown0)
        spikes(s, x - 19, by - 9, x - 9, by - 11, 3, 3, C.brown2, C.bone1)
        line(s, x - 21, by - 3, x - 25, by - 6 + wv(t, 0.6, 1), C.brown1) // tail
        // harness: a girth strap studded with iron, a red saddle blanket with a ragged fringe
        rect(s, x - 1, by - 10, 3, 20, LEATHER[0])
        for (let i = 0; i < 4; i++) px(s, x, by - 7 + i * 5, C.steel3)
        rect(s, x - 11, by - 13, 16, 4, C.red1)
        rect(s, x - 11, by - 13, 16, 1, C.red2)
        for (let i = 0; i < 8; i++) px(s, x - 11 + i * 2, by - 9, C.red0)
        line(s, x + 2, by - 4, x + 17, by + 1, LEATHER[0], 2) // breast strap to the head

        // boar head: tusks like roots, an iron ring through the snout
        const hx = x + 20
        const hy = by + 1 + R(charge * 3 + B.die * 6)
        ball(s, hx, hy, 10, 8, HIDE)
        tri(s, hx - 7, hy - 5, hx - 2, hy - 7, hx - 6, hy - 13, C.brown1)
        px(s, hx - 6, hy - 12, C.brown2)
        rect(s, hx + 6, hy - 1, 7, 6, C.brown2)
        rect(s, hx + 12, hy, 2, 4, C.bone0)
        px(s, hx + 12, hy + 1, C.ink); px(s, hx + 12, hy + 3, C.ink)
        disc(s, hx + 13, hy + 5, 1.5, C.steel2); px(s, hx + 13, hy + 5, C.brown2)
        line(s, hx + 7, hy + 5, hx + 11, hy + 3, C.bone1, 2)
        line(s, hx + 11, hy + 3, hx + 13, hy - 3, C.bone1, 2)
        px(s, hx + 13, hy - 4, C.white)
        const boarEye = B.hurt ? C.ink : (B.glow > 0.5 ? C.gold3 : C.red2)
        rect(s, hx + 1, hy - 4, 3, 1, C.brown0)
        px(s, hx + 3, hy - 3, boarEye)
        if (B.roar || B.strike) mouth(s, hx + 6, hy + 5, 6, 2, C.red1, C.bone1)

        // rider: back arm on the reins, leg down the boar's flank
        line(s, rx + 2, ry - 10, hx - 2, hy - 2, C.brown0) // rein
        limbT(s, rx - 1, ry - 11, rx + 4, ry - 6, 3, 2.5, [C.green0, C.green1, C.green2])
        limbT(s, rx + 1, ry - 1, rx + 5, ry + 6, 4, 3, LEATHER)
        rect(s, rx + 3, ry + 6, 4, 2, C.brown0) // boot in the stirrup
        // torso: a leather jerkin under a bone mantle, a red war-paint slash
        const tx = rx + lean
        ball(s, tx, ry - 7, 6, 7, LEATHER)
        ellipse(s, tx, ry - 12, 7, 3, C.bone0)
        ellipse(s, tx - 1, ry - 13, 6, 2, C.bone1)
        for (let i = -5; i <= 5; i += 2) px(s, tx + i, ry - 10, C.bone0)
        line(s, tx - 2, ry - 7, tx + 3, ry - 3, C.red2)
        // head: a goblin's, bigger than the trash, long ear swept back
        const gx = tx + 2
        const gy = ry - 21
        tri(s, gx - 5, gy, gx - 4, gy + 3, gx - 14, gy - 4, C.green1) // ear
        line(s, gx - 6, gy + 1, gx - 12, gy - 3, C.green2)
        ball(s, gx, gy, 7, 6, GOBLIN)
        rect(s, gx + 6, gy, 3, 3, C.green2); px(s, gx + 8, gy + 3, C.green1) // hooked nose
        const eye = B.hurt ? C.ink : (B.glow > 0.5 ? C.gold3 : C.red2)
        rect(s, gx + 2, gy - 2, 3, 2, C.ink)
        px(s, gx + 3, gy - 2, eye); px(s, gx + 4, gy - 2, eye)
        line(s, gx - 1, gy, gx + 4, gy, C.red1) // war paint under the eye
        if (B.roar || B.strike) mouth(s, gx + 1, gy + 3, 6, 2, C.red0, C.white)
        else { rect(s, gx + 1, gy + 3, 5, 1, C.ink); px(s, gx + 5, gy + 4, C.white); px(s, gx + 2, gy + 4, C.white) }
        // scrap-iron helm sitting on top, dented and riveted, crowned in bramble
        ellipse(s, gx - 1, gy - 6, 7, 3, IRON[1])
        rect(s, gx - 8, gy - 5, 15, 1, IRON[0])
        px(s, gx - 3, gy - 8, C.steel3); px(s, gx + 2, gy - 7, C.steel3); px(s, gx - 6, gy - 5, C.steel2)
        for (let i = -3; i <= 3; i++) {
            const cx = gx - 1 + i * 2
            const ch = 3 + (i & 1) * 2
            line(s, cx, gy - 9, cx - 1, gy - 9 - ch, C.brown1)
            px(s, cx - 1, gy - 10 - ch, i & 1 ? C.red2 : C.green2)
        }
        // front arm and the cleaver: raised back on the wind-up, chopped down on the strike
        const sx = tx + 4
        const sy = ry - 11
        const a = bz(-1.1, -2.6, 0.6)
        reach(sx, sy, a, 8)
        limbT(s, sx, sy, P.x, P.y, 3.5, 3, GOBLIN)
        cleaver(s, P.x, P.y, a)
        disc(s, P.x, P.y, 1.5, C.green3)
        finish(s, Entry.Walk)
    },
    fx(dst, st, t, x, y, dir) {
        if (B.roar || (st === 'attack' && B.wind > 0.6)) {
            const k = fr(t, 10, 4)
            for (let i = 0; i < 4; i++) dst.set(x + dir * (32 + k * 2 + i), y - 15 - i - (k & 1), i & 1 ? C.bone1 : C.white)
        }
        if (st === 'attack' && B.strike) for (let i = 0; i < 6; i++) dst.set(x + dir * (12 + i * 3), y - (i & 1), C.stone3)
    }
}

/** Cross-weave every base-shade pixel in a box: the wicker's over-and-under strands. */
function weave(s: Surface, x0: number, y0: number, w: number, h: number): void {
    for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
            if (s.get(x, y) !== WICKER[1]) continue
            if (((x + y) & 3) === 0) s.set(x, y, WICKER[0])
            else if (((x - y) & 3) === 0) s.set(x, y, WICKER[2])
        }
    }
}

/**
 * Wicker Blaze: the gorse-fire in his ribs roars up as he raises his arm, then he drives his fist
 * into the ground; a seam of fire runs out to the party and burning thorns burst up under each of
 * them in turn, nearest first, and keep burning.
 */
const WICKER_BLAZE: BossSpecial = {
    name: 'Wicker Blaze', tint: 'dusk0', hits: [1.28, 1.38, 1.48, 1.58, 1.68, 1.78], spread: true,
    fx(s, t, st) {
        const q = sq(t)
        const d = st.dir
        // embers pouring up out of the ribcage as the fire rises
        if (q < 1.2) for (let i = 0; i < 10; i++) {
            const u = ((q * 1.6 + i / 10) % 1)
            s.set(R(st.bx - d * (2 - (i * 7) % 12)), R(st.by - 66 - u * 44), u < 0.4 ? C.gold3 : u < 0.7 ? C.orange : C.lava1)
        }
        // the seam of fire running from his fist to the party
        const near = st.party[0]!
        crack(s, st.bx + d * 22, st.by - 1, near.x, near.y - 1, sp(t, 1.1, 1.28), 31, C.lava1, C.gold3)
        crack(s, st.bx + d * 22, st.by - 1, st.party[st.party.length - 1]!.x, st.party[st.party.length - 1]!.y - 1, sp(t, 1.1, 1.5), 37, C.lava1, C.gold2)
        // burning thorns bursting up under each of them in turn
        st.party.forEach((p, i) => {
            const t0 = 1.22 + i * 0.1
            const g = sp(t, t0, t0 + 0.12)
            if (g <= 0) return
            flames(s, p.x, p.y, 20, t, t0 + 0.08, 2.6, 41 + i, 12)
            for (let k = 0; k < 5; k++) {
                const off = (k - 2) * 4 + (hash2(i, k) - 0.5) * 2
                const h = R(g * (10 + hash2(i + 7, k) * 10))
                spike(s, R(p.x + off), p.y, h, 1.6, (k - 2) * 2, C.brown1, C.brown3, q > t0 + 0.2 ? C.gold3 : C.bone1)
            }
            blast(s, p.x, chest(p), t, t0 + 0.05, 7, 0.45, FIRE6, 51 + i, 'ember')
            debris(s, p.x, p.y - 4, p.y, t, t0, 6, 80, 'ember', 61 + i)
        })
    }
}

/**
 * Gorsecrown, King of Hedges, the Wicker King: a hollow giant woven from hedge-wood on human lines, long in the leg, a
 * broad woven trunk from a yoke of shoulders straight down to the hips, and jointed arms. His
 * head is a goat skull carved from pale wood, ram's horns curling round it with gorse at their
 * roots, fire in the eye socket and in the hollow of his ribs. Tan wicker and gold fire, so he
 * stands out of the green field rather than melting into it.
 */
export const GORSECROWN: CreatureDef = {
    name: 'Gorsecrown, King of Hedges', size: 128, shadow: 24, accent: C.gold2,
    states: withSpecial(bossStates(1.4, 1.8, 2.2), 2.6),
    special: WICKER_BLAZE,
    draw(s, st, t) {
        drive(this, st, t, 6, 1.8)
        // the fist raised as the fire in him roars, then driven into the ground
        if (st === 'special') spAttack(0.4, 0.45, 0.62, 4)
        const x = s.ax - 6 + B.lunge - B.kb
        const y = s.ay
        const sink = R(B.die * 12)
        // as tall as Gorsecrown: the horns top out about 100px above the feet
        const hipY = y - 46 + sink
        const chestY = y - 64 + B.breath + sink
        const shY = y - 78 + B.breath + sink
        const flick = fr(t, 10, 4)
        const burn = 0.5 + B.glow * 0.5
        const sway = wv(t, 1.8, 1)

        // back arm, relaxed: upper arm, a knot of an elbow, forearm, an open woven hand
        const bex = x - 21
        const bey = shY + 15
        limbT(s, x - 16, shY + 1, bex, bey, 5, 4, WICKER)
        limbT(s, bex, bey, x - 18, shY + 29, 4, 3.5, WICKER)
        ball(s, bex, bey, 3, 3, WICKER)
        ball(s, x - 18, shY + 31, 3, 3, WICKER)
        weave(s, x - 26, shY - 4, 14, 40)
        // legs: thigh, a knot of a knee, shin, splayed a little
        for (const side of [-1, 1]) {
            const kx = x + side * 7
            const ky = y - 23 + R(sink * 0.5)
            const ax = x + side * 6
            limbT(s, x + side * 6, hipY, kx, ky, 9, 7, WICKER)
            limbT(s, kx, ky, ax, y - 3, 7, 6, WICKER)
            rect(s, ax - 4, y - 3, 9, 3, WICKER[0])
            ball(s, kx, ky, 4, 4, WICKER)
        }
        // the trunk: a broad woven block from the yoke of the shoulders straight to the hips
        rect(s, x - 17, shY - 2, 34, 4, WICKER[1])
        tri(s, x - 16, shY, x + 16, shY, x, chestY, WICKER[1])
        rect(s, x - 12, chestY, 24, hipY - chestY, WICKER[1])
        ball(s, x, hipY, 12, 5, WICKER)
        weave(s, x - 22, shY - 4, 44, y - shY + 4)
        rect(s, x - 17, shY - 2, 34, 1, WICKER[2])
        // the ribcage: hollow, gorse-fire burning inside, woven bands across it
        ellipse(s, x, chestY, 13, 13, WICKER[0])
        ellipse(s, x, chestY + 1, 10, 10, C.brown0)
        ditherEllipse(s, x, chestY + 3, 8, 8, C.lava1, burn > 0.7 ? 16 : 11)
        ditherEllipse(s, x + 1, chestY + 4, 6, 6, C.orange, 12 + flick)
        ditherEllipse(s, x + 1, chestY + 4, 3 + (flick & 1), 4, C.gold2, 14)
        disc(s, x + 1, chestY + 4, 1.5, B.glow > 0.5 ? C.white : C.gold3)
        for (let i = -2; i <= 2; i++) {
            const ry = chestY + i * 5
            const half = R(12 * Math.sqrt(Math.max(0, 1 - (i * 5 / 13) ** 2)))
            rect(s, x - half, ry, half * 2, 2, WICKER[1])
            rect(s, x - half, ry, half * 2, 1, WICKER[2])
        }
        rect(s, x - 12, chestY - 10, 3, 22, WICKER[1]) // the spine along his back
        ball(s, x - 16, shY, 5, 4, WICKER)
        ball(s, x + 16, shY, 5, 4, WICKER)
        weave(s, x - 22, shY - 5, 44, 30)
        for (let i = 0; i < 4; i++) px(s, x - 7 + i * 5, chestY - 8 + ((i + flick) % 3) * 7, i & 1 ? C.gold3 : C.orange)
        // neck
        rect(s, x - 1, shY - 8, 4, 7, WICKER[1])
        weave(s, x - 2, shY - 9, 6, 8)

        // head: a goat skull carved from pale wood
        const hx = x + 1
        const hy = shY - 12 + sway
        ramHorn(s, hx - 3, hy - 1, 7, 2, HORN_FAR) // far horn, peeking out behind
        ball(s, hx, hy, 6, 6, SKULL)
        limbT(s, hx + 3, hy + 1, hx + 11, hy + 5, 6, 4, SKULL) // a short, blunt snout
        line(s, hx - 3, hy - 3, hx + 1, hy - 5, C.brown2) // grain
        line(s, hx + 5, hy + 2, hx + 9, hy + 4, C.brown2)
        px(s, hx + 11, hy + 4, C.brown0); px(s, hx + 10, hy + 3, C.ink) // nostril
        rect(s, hx + 2, hy - 2, 4, 3, C.brown0) // the eye socket
        const eye = B.hurt ? C.lava1 : (B.glow > 0.5 ? C.white : C.gold3)
        px(s, hx + 3, hy - 1, eye); px(s, hx + 4, hy - 1, eye); px(s, hx + 4, hy, C.orange)
        // the jaw, dropping open on a roar or a swing, fire behind the teeth
        const gape = B.roar || B.strike ? 3 : 0
        if (gape) rect(s, hx + 3, hy + 6, 6, gape, flick & 1 ? C.orange : C.lava1)
        limbT(s, hx + 1, hy + 6 + gape, hx + 9, hy + 7 + gape, 4, 2, SKULL)
        for (let i = 0; i < 4; i++) px(s, hx + 3 + i * 2, hy + 6 + (gape ? 1 : 0), C.bone1)
        // near horn: a ram's, curling back and round beside the skull
        ramHorn(s, hx - 5, hy + 1, 8, 2.4, HORN)
        // gorse wound round the roots of the horns: the crown he is named for
        for (const [dx, dy, c] of [[-1, -7, C.gold3], [-5, -9, C.gold2], [2, -6, C.gold2]] as const) {
            px(s, hx + dx + 1, hy + dy + 1, C.green0)
            disc(s, hx + dx, hy + dy, 1.3, c)
        }

        // front arm, jointed: raised back at shoulder and elbow, then chopped down, fist burning
        const sx = x + 16
        const sy = shY
        const a1 = bz(1.35, -2.3, 0.85)
        const a2 = bz(0.9, -1.5, 1.3)
        reach(sx, sy, a1, 15)
        const ex = P.x
        const ey = P.y
        reach(ex, ey, a2, 14)
        limbT(s, sx, sy, ex, ey, 5, 4, WICKER)
        limbT(s, ex, ey, P.x, P.y, 4, 3.5, WICKER)
        weave(s, Math.min(sx, ex, P.x) - 6, Math.min(sy, ey, P.y) - 6, Math.max(sx, ex, P.x) - Math.min(sx, ex, P.x) + 12, Math.max(sy, ey, P.y) - Math.min(sy, ey, P.y) + 12)
        ball(s, ex, ey, 3, 3, WICKER)
        ball(s, P.x, P.y, 4, 4, WICKER)
        const fire = B.glow > 0.3 || flick === 0
        px(s, P.x + 1, P.y - 4, fire ? C.gold3 : C.orange)
        px(s, P.x - 1, P.y - 5 - (flick & 1), C.orange)
        px(s, P.x + 3, P.y - 3, C.lava1)
        finish(s, Entry.Rise, 12)
    },
    fx(dst, st, t, x, y, dir) {
        // embers drifting up out of the ribcage
        const k = fr(t, 10, 12)
        for (let i = 0; i < 4; i++) {
            const u = ((k + i * 3) % 12) / 12
            dst.set(x + dir * (-6 + ((i * 5) % 14)), y - 66 - R(u * 40), u < 0.5 ? C.gold3 : C.orange)
        }
        if (st === 'attack' && B.strike) {
            for (let i = 0; i < 12; i++) dst.set(x + dir * (30 + i * 2), y - (i % 3) - 1, i & 1 ? C.orange : C.gold3)
        }
        if (st === 'death') {
            const f = fr(t, 10, 16)
            for (let i = 0; i < 8; i++) dst.set(x + dir * (-18 + i * 5 + (f % 3)), y - 80 + i * 6 + f * 2, i & 1 ? C.gold3 : C.lava1)
        }
    }
}

/**
 * A ram's horn curling round (cx, cy): it rises from the crown, sweeps back and down and comes
 * forward underneath, the spiral tightening and thinning as it goes, ridged along its length.
 */
function ramHorn(s: Surface, cx: number, cy: number, r: number, w: number, m: Mat): void {
    const n = 22
    for (let i = 0; i <= n; i++) {
        const u = i / n
        const a = -1.2 - u * Math.PI * 1.6
        const rr = r * (1 - u * 0.4)
        const hx = cx + Math.cos(a) * rr
        const hy = cy + Math.sin(a) * rr
        const ww = w * (1 - u * 0.55)
        disc(s, hx, hy, ww, m[0])
        disc(s, hx - 0.5, hy - 0.5, Math.max(0.6, ww - 1), m[1])
        if (i % 3 === 0 && ww > 1.5) px(s, R(hx + Math.cos(a) * (ww - 1)), R(hy + Math.sin(a) * (ww - 1)), m[2])
    }
}

// ═══════════════════════════════════════════════════════════════ 2 · Mirewood

// Stage 5: Mother Leech, a leech the size of a cypress rearing out of the black water, her head
// a lamprey's sucker ringed with teeth and her brood clinging to her. Stage 10: Rotheart, the
// Sunken Elder, the oldest cypress of the drowned forest risen on its roots, rotted hollow at
// the heart, where something green still glows.

const LEECH_SKIN: Mat = [C.olive0, C.olive1, C.olive2]
/** The black water she rears out of. */
const LEECH_POOL: Pool = { dx: -8, rx: 32, ry: 3 }
const LEECH_LIP: Mat = [C.red0, C.red1, C.red2]
const BROOD: Mat = [C.olive0, C.olive1, C.orange]
const BARK_OLD: Mat = [C.brown0, C.brown1, C.brown2]
const MOSS: Mat = [C.green1, C.green2, C.olive2]

/** Point on the quadratic curve (x0,y0)→(cx,cy)→(x1,y1) at u, into P. */
function bez(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, u: number): void {
    const a = (1 - u) * (1 - u)
    const b = 2 * (1 - u) * u
    const c = u * u
    P.x = a * x0 + b * cx + c * x1
    P.y = a * y0 + b * cy + c * y1
}

/** A leechling at (x, y), wriggling on `ph`, facing `dir`: a striped little slug with a gold spot. */
function leechling(s: Surface, x: number, y: number, ph: number, dir: number): void {
    for (let i = 0; i < 8; i++) {
        const lx = R(x - dir * i)
        const ly = R(y + Math.sin(ph + i * 0.8) * 1.2)
        const w = i === 0 || i === 7 ? 1 : 2
        s.set(lx, ly, C.ink)
        s.set(lx, ly - 1, i === 0 ? C.red2 : i % 3 === 1 ? C.olive1 : C.red1)
        if (w > 1) s.set(lx, ly - 2, i === 3 || i === 5 ? C.gold2 : C.red2)
        s.set(lx, ly - w - 1, C.ink)
    }
}

/**
 * Brood Swarm: she rears and swells, then gapes and spews her brood: leechlings arc out over the
 * water, land, and squirm across the ground to the party, each one latching on to a body in turn.
 */
const BROOD_SWARM: BossSpecial = {
    name: 'Brood Swarm', tint: 'dusk0', hits: [1.7, 1.8, 1.9, 2.0, 2.1, 2.2], spread: true,
    fx(s, t, st) {
        const q = sq(t)
        const d = st.dir
        const mx = st.bx + d * 8
        const my = st.by - 50
        for (let i = 0; i < 12; i++) {
            const p = st.party[i % st.party.length]!
            const t0 = 1.0 + (i % 6) * 0.04
            const land = 1.3 + (i % 4) * 0.04
            // where it lands, short of the party, then the crawl to its target
            const lx = st.bx + d * (18 + hash2(i, 3) * 30)
            const ly = p.y - 1 - (i & 1)
            if (q < t0) continue
            if (q < land) {
                const u = (q - t0) / (land - t0)
                const x = mx + (lx - mx) * u
                const y = my + (ly - my) * u - Math.sin(u * Math.PI) * 18
                leechling(s, x, y, q * 20 + i, d)
                continue
            }
            const reach = 1.6 + (i % 6) * 0.1
            const u = Math.min(1, (q - land) / (reach - land))
            const x = lx + (p.x + d * 3 - lx) * u
            if (u < 1) { leechling(s, x, ly, q * 18 + i, d); continue }
            // latched on and climbing
            const up = Math.min(8, (q - reach) * 20)
            leechling(s, p.x + (i & 1 ? 2 : -2), p.y - 4 - up, q * 14 + i, i & 1 ? 1 : -1)
        }
        // the spew: slime thrown out of her gape
        debris(s, mx, my, st.by, t, 1.0, 10, 70, 'poison', 21, 0.6)
        st.party.forEach((p, i) => blast(s, p.x, chest(p), t, 1.7 + i * 0.1, 5, 0.4, ROT6, 31 + i, 'blood'))
    }
}

/**
 * Mother Leech: a great striped leech rearing out of the black water in an S, glistening, two
 * rows of orange spots down her back and ring after ring of segment, her brood clinging to her
 * flanks. Her head flares into a lamprey's sucker: a ring of lip round rings of hooked teeth
 * round a throat, pursed at rest, gaping on the strike and the roar, a crescent of eyespots
 * over it. She sways, draws back, and strikes down at the front rank.
 */
export const MOTHER_LEECH: CreatureDef = {
    name: 'Mother Leech', size: 96, shadow: 0, accent: C.red2,
    states: withSpecial(bossStates(1.1, 1.6, 2.0), 2.5),
    special: BROOD_SWARM,
    draw(s, st, t) {
        drive(this, st, t, 12, 1.6)
        // rearing back and swelling, then the gape as she spews her brood
        if (st === 'special') spAttack(0.4, 0.46, 0.6, 6)
        const x = s.ax - 10 - B.kb
        const y = s.ay
        const sway = wv(t, 1.6, 3)
        const hx = x + 14 + sway + B.lunge + R(B.die * 12)
        const hy = y - 60 + R(bz(0, -8, 12)) + R(B.die * 36)
        const x0 = x - 6
        const y0 = y + 3
        const cx = x - 26
        const cy = y - 30
        // the body: fat at the water, tapering a little to the neck, glossy on the lit side
        chain(s, x0, y0, cx, cy, hx - 4, hy + 6, 12, 8, LEECH_SKIN, 20)
        // two gold stripes running the length of her back, broken by the segments
        for (let i = 2; i < 96; i++) {
            const u = i / 100
            bez(x0, y0, cx, cy, hx - 4, hy + 6, u)
            const r = 12 - u * 4
            if (i % 8 === 0) continue
            px(s, R(P.x - r * 0.62), R(P.y - r * 0.05), C.gold1)
            px(s, R(P.x - r * 0.2), R(P.y - r * 0.6), C.orange)
            if (i % 8 === 4) px(s, R(P.x - r * 0.4), R(P.y - r * 0.4), C.olive2)
        }
        for (let i = 1; i < 12; i++) {
            const u = i / 12
            bez(x0, y0, cx, cy, hx - 4, hy + 6, u)
            const r = 12 - u * 4
            arc(s, P.x, P.y, r - 0.5, -1.2, 1.5, C.olive0) // segment ring
            if (i % 2 === 0) px(s, R(P.x - r * 0.3), R(P.y - r * 0.8), C.teal3) // a wet highlight
        }
        // her brood, clinging to her flanks and squirming
        const k = fr(t, 6, 4)
        for (const [u, side] of [[0.25, 1], [0.5, -1], [0.72, 1]] as const) {
            bez(x0, y0, cx, cy, hx - 4, hy + 6, u)
            const bx = P.x + side * (11 - u * 4)
            const by = P.y
            const w = (k + R(u * 8)) & 1
            chain(s, bx, by, bx + side * (5 + w), by + 4, bx + side * 3, by + 10, 3, 2, BROOD, 7)
            for (let j = 1; j < 4; j++) px(s, R(bx + side * (3 + j * 0.6)), by + 2 + j * 2, C.gold1)
            px(s, R(bx + side * 3), by + 11, C.red2)
        }
        // the sucker: a ring of lip round rings of hooked teeth round the throat
        const open = B.strike || B.roar ? 1 : B.wind > 0.4 ? 0.7 : 0.35
        const sr = R(9 + open * 3)
        const mx = hx + 3
        const my = hy
        disc(s, mx - 2, my + 1, sr + 1, LEECH_SKIN[0])
        disc(s, mx, my, sr, LEECH_LIP[1])
        disc(s, mx - 1, my - 1, sr - 1, LEECH_LIP[2])
        disc(s, mx, my, sr - 2, LEECH_LIP[0])
        const throat = Math.max(1, R(sr * open * 0.55))
        disc(s, mx, my, throat + 2, C.red1)
        disc(s, mx, my, throat, C.ink)
        // the teeth turn slowly inward while she gapes, like a lamprey's
        const turn = B.strike || B.roar ? q(t) * 2 : 0
        for (const [rr, n, c] of [[sr - 2.5, 14, C.bone1], [sr - 4.5, 10, C.white], [throat + 1.5, 7, C.bone1]] as const) {
            if (rr < 1.5) continue
            for (let i = 0; i < n; i++) {
                const a = (i / n) * Math.PI * 2 + turn
                px(s, mx + R(Math.cos(a) * rr), my + R(Math.sin(a) * rr), c)
            }
        }
        // slime drooling off the lower lip
        const drip = fr(t, 5, 4)
        line(s, mx - 2, my + sr, mx - 2, my + sr + 2 + drip, C.teal2)
        px(s, mx + 3, my + sr + 1 + (drip >> 1), C.teal3)
        // a crescent of eyespots over the sucker
        const eye = B.hurt ? C.ink : (B.glow > 0.5 ? C.gold3 : C.gold2)
        for (let i = 0; i < 5; i++) {
            const a = -Math.PI * (0.35 + i * 0.13)
            const ex = mx - 4 + R(Math.cos(a) * (sr + 3))
            const ey = my + R(Math.sin(a) * (sr + 3))
            px(s, ex, ey, C.ink)
            px(s, ex, ey - 1, eye)
        }
        finish(s, Entry.Rise, 0)
        waterline(s, LEECH_POOL)
    },
    fx(dst, st, t, x, y, dir) {
        // black water and the rest of the brood, un-outlined so she rises out of it
        const rx = LEECH_POOL.rx
        drawPool(dst, LEECH_POOL, x, y, dir, C.void)
        ditherEllipse(dst, x - dir * 8, y - 2, rx - 5, 2, C.night0, 16)
        const k = fr(t, 10, 8)
        for (let i = 0; i < 6; i++) dst.set(x - dir * (8 - rx + 6 + ((i * 11 + k * 3) % (rx * 2 - 8))), y - 3, i & 1 ? C.teal1 : C.teal2)
        for (let i = 0; i < 3; i++) {
            const bx = x + dir * (-28 + i * 18) + (((k + i * 3) & 3) - 1)
            for (let j = 0; j < 5; j++) dst.set(bx + dir * j, y - 3 - ((j + k + i) & 1), j === 4 ? C.orange : C.olive1)
        }
        // ripples spreading where she broke the surface
        const ring = (k % 8) * 3
        for (let i = -1; i <= 1; i += 2) dst.set(x - dir * 8 + i * (10 + ring), y - 2, C.teal3)
        if (B.roar || B.strike) for (let i = 0; i < 5; i++) dst.set(x + dir * (20 + i * 3), y - 60 + ((i * 5 + k) % 9), C.teal3)
    }
}

/** Ridge every base-shade pixel in a box into bark: dark furrows and lit ridges running up it. */
function barkGrain(s: Surface, x0: number, y0: number, w: number, h: number): void {
    for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
            if (s.get(x, y) !== BARK_OLD[1]) continue
            const k = (x + Math.floor(Math.sin(y * 0.18 + x * 0.3) * 1.5)) & 3
            if (k === 0) s.set(x, y, BARK_OLD[0])
            else if (k === 2 && ((y >> 1) & 3) !== 0) s.set(x, y, BARK_OLD[2])
        }
    }
}

/** A curtain of hanging moss from (x, y) across `w`: strands of uneven length, swaying. */
function mossCurtain(s: Surface, x: number, y: number, w: number, len: number, t: number, seed: number): void {
    for (let i = 0; i < w; i++) {
        const l = R(len * (0.4 + 0.6 * ((i * 7 + seed) % 5) / 4))
        const sway = R(wv(t, 2.0, 1, i * 0.1))
        line(s, x + i, y, x + i + sway, y + l, i % 3 === 0 ? MOSS[0] : i % 3 === 1 ? MOSS[1] : MOSS[2])
    }
}

/**
 * A root-claw hand at (x, y): a knot of a wrist, long root fingers curling down and forward.
 * `grip` 0 (open) … 1 (curled).
 */
function rootHand(s: Surface, x: number, y: number, grip: number): void {
    ball(s, x, y, 4, 3, BARK_OLD)
    for (let i = 0; i < 4; i++) {
        const a = 0.5 + i * 0.35 - grip * 0.4
        const len = 8 + (i & 1) * 2
        let fx = x + Math.cos(a) * 3
        let fy = y + Math.sin(a) * 3
        for (let j = 0; j < 3; j++) {
            const aa = a + j * (0.35 + grip * 0.5)
            const nx = fx + Math.cos(aa) * len / 3
            const ny = fy + Math.sin(aa) * len / 3
            line(s, R(fx), R(fy), R(nx), R(ny), j === 0 ? BARK_OLD[1] : BARK_OLD[0], j === 0 ? 2 : 1)
            fx = nx
            fy = ny
        }
        px(s, R(fx), R(fy), C.bone0)
    }
}

/**
 * Drowning Mire: he brings his arm down into the water, and the black mire wells up under each of
 * the party in turn, roots bursting out of it and coiling round them to drag them under, green
 * bubbles rising.
 */
const DROWNING_MIRE: BossSpecial = {
    name: 'Drowning Mire', tint: 'night0', hits: [1.4, 1.5, 1.6, 1.7, 1.8, 1.9], spread: true,
    fx(s, t, st) {
        const q = sq(t)
        const d = st.dir
        // the ripple running out from where his arm struck the water
        shockRing(s, st.bx + d * 20, st.by - 1, t, 1.15, 0.6, 4, 40, C.teal3, true)
        st.party.forEach((p, i) => {
            const t0 = 1.25 + i * 0.1
            const g = sp(t, t0, t0 + 0.2)
            if (g <= 0) return
            const fade = 1 - sp(t, 2.3, 2.7)
            // the mire welling up under them
            pit(s, p.x, p.y, 4 + g * 10 * fade, C.ink, C.teal0)
            if (fade > 0.3) for (let k = 0; k < 4; k++) {
                // roots coiling up out of it round them
                const h = R(g * (12 + hash2(i, k) * 8) * fade)
                const off = (k - 1.5) * 5
                spike(s, R(p.x + off), p.y, h, 1.4, -off * 0.6 + Math.sin(q * 6 + k) * 2, C.brown0, C.brown2, C.green3)
            }
            blast(s, p.x, chest(p) + 6, t, t0 + 0.12, 6, 0.5, WATER6, 41 + i, 'water')
            // bubbles rising out of the black water
            for (let k = 0; k < 3; k++) {
                const u = ((q - t0) * 1.5 + k / 3) % 1
                if (fade > 0.2) s.set(R(p.x - 6 + k * 6), R(p.y - 2 - u * 12), u < 0.5 ? C.green3 : C.olive2)
            }
        })
    }
}

/**
 * Rotheart, the Sunken Elder: the oldest cypress of the drowned forest, risen on its roots. A
 * hunched trunk of twisted bark stands on buttress roots splayed into the water; long arms hang
 * nearly to the surface, curtained in moss, with root-claw hands. The chest is rotted hollow,
 * ribbed with roots, and the heart in it glows a sick green among luminous mushrooms. The face is
 * the bark itself: a heavy brow over deep sockets lit green, a long split mouth with a beard of
 * moss and roots, and a crown of dead branches hung with moss. He raises an arm and brings it
 * down on the front rank.
 */
export const ROTHEART: CreatureDef = {
    name: 'Rotheart, the Sunken Elder', size: 128, shadow: 0, accent: C.green4,
    // his crown of branches ran off the top of the camera
    lower: 6,
    // for the arm he swings out at the front rank
    room: 19,
    states: withSpecial(bossStates(1.4, 2.0, 2.4), 2.8),
    special: DROWNING_MIRE,
    draw(s, st, t) {
        drive(this, st, t, 6, 2.0)
        // the arm raised high, then brought down into the water
        if (st === 'special') spAttack(0.38, 0.44, 0.6, 3)
        const x = s.ax - 4 + B.lunge - B.kb
        const y = s.ay
        const sink = R(B.die * 14)
        const hunch = R(B.breath + bz(0, -2, 3))
        const hipY = y - 30 + sink
        const shY = y - 78 + hunch + sink
        const hx = x + 6 + R(bz(0, -2, 4))
        const hy = shY - 8
        const pulse = fr(t, 5, 2) === 1 || B.glow > 0.5
        const flick = fr(t, 10, 4)

        // the far arm, hanging, moss trailing off it
        limbT(s, x - 14, shY + 4, x - 24, shY + 34, 9, 7, BARK_OLD)
        limbT(s, x - 24, shY + 34, x - 22, shY + 62, 7, 5, BARK_OLD)
        rootHand(s, x - 22, shY + 64, 0.3)
        mossCurtain(s, x - 28, shY + 12, 8, 18, t, 3)
        // buttress roots splayed into the water, bent like knees
        for (const [kx, ky, fx, w, far] of [[-18, -16, -26, 8, true], [16, -18, 24, 8, true], [-9, -12, -14, 11, false], [8, -13, 13, 11, false]] as const) {
            const m: Mat = far ? [C.brown0, C.brown0, C.brown1] : BARK_OLD
            limbT(s, x + (kx > 0 ? 5 : -5), hipY, x + kx, y + ky + sink * 0.3, w, w - 2, m)
            limbT(s, x + kx, y + ky + sink * 0.3, x + fx, y, w - 2, w + 2, m)
        }
        // the trunk: hunched forward from the hips to a broad yoke of shoulders
        quad(s, x - 13, hipY, x + 13, hipY, x + 22, shY + 2, x - 18, shY + 4, BARK_OLD[1])
        ball(s, x + 2, shY + 4, 20, 9, BARK_OLD)
        rect(s, x - 13, hipY - 2, 26, 6, BARK_OLD[1])
        barkGrain(s, x - 24, shY - 6, 48, hipY - shY + 10)
        ditherEllipse(s, x, hipY + 2, 14, 5, C.olive1, 7) // the waterline rot
        // the hollow of the chest, ribbed with roots, the heart glowing in it
        const cy = shY + 24
        ditherEllipse(s, x + 3, cy + 1, 15, 17, C.green1, pulse ? 7 : 4) // the glow on the bark round it
        ellipse(s, x + 3, cy, 11, 14, BARK_OLD[0])
        ellipse(s, x + 3, cy + 1, 9, 12, C.ink)
        ditherEllipse(s, x + 3, cy + 2, 7, 9, C.olive0, 10)
        ditherEllipse(s, x + 3, cy + 2, 5, 6, C.green1, pulse ? 12 : 8)
        disc(s, x + 3, cy + 2, pulse ? 5 : 4, C.green2)
        disc(s, x + 3, cy + 2, pulse ? 3 : 2, C.green3)
        disc(s, x + 3, cy + 2, 1.5, pulse ? C.white : C.green4)
        for (let i = 0; i < 4; i++) line(s, x - 6 + i * 6, cy - 10, x - 4 + i * 5, cy + 11, BARK_OLD[1], 2) // root ribs
        for (let i = 0; i < 3; i++) line(s, x + 3, cy + 2, x - 2 + i * 5, cy + 12, C.olive2) // rot veins
        // luminous mushrooms clustered round the rim of the hollow
        for (const [mx, my, r] of [[-7, -9, 2], [-8, -4, 1.5], [12, 6, 2.5], [13, 11, 1.5], [-6, 10, 2]] as const) {
            rect(s, x + mx + 3, cy + my + 1, 1, 2, C.bone1)
            dome(s, x + mx + 3, cy + my + 1, r, r, C.green3)
            px(s, x + mx + 2, cy + my, C.green4)
        }
        // moss draped off the shoulders
        mossCurtain(s, x - 19, shY + 2, 7, 12, t, 7)
        mossCurtain(s, x + 15, shY + 2, 7, 10, t, 11)

        // the crown of dead branches, spreading like antlers, hung with moss
        for (const [bx, a, len] of [[-12, -2.3, 24], [-4, -1.9, 30], [6, -1.4, 28], [14, -0.9, 22]] as const) {
            const sx = hx + bx
            reach(sx, hy - 8, a, len)
            line(s, sx, hy - 8, R(P.x), R(P.y), C.brown1, 2)
            const mx = sx + (P.x - sx) * 0.6
            const my = hy - 8 + (P.y - hy + 8) * 0.6
            line(s, R(mx), R(my), R(mx + Math.cos(a + 0.9) * 8), R(my + Math.sin(a + 0.9) * 8), C.brown1)
            line(s, R(mx), R(my), R(mx + Math.cos(a - 0.8) * 7), R(my + Math.sin(a - 0.8) * 7), C.brown0)
            for (let i = 0; i < 3; i++) line(s, R(mx + i * 2 - 2), R(my + 1), R(mx + i * 2 - 2), R(my + 4 + ((i + flick) & 1) * 3), MOSS[i % 3]!)
        }
        // the head: part of the trunk, a heavy brow, deep sockets lit green, a long split mouth
        // the head is the broken top of the trunk: tapering up to a jagged, splintered crown
        poly(s, [-14, 14, 14, 14, 13, -4, 9, -10, 6, -7, 2, -13, -3, -8, -7, -12, -12, -5], hx, hy, BARK_OLD[1])
        poly(s, [-14, 14, -8, 14, -9, -6, -12, -5], hx, hy, BARK_OLD[0])
        barkGrain(s, hx - 15, hy - 14, 30, 30)
        for (const [dx, dy] of [[9, -10], [2, -13], [-7, -12]] as const) px(s, hx + dx, hy + dy, C.bone0) // splinters
        // a heavy brow overhanging deep sockets, green light pooled in them
        line(s, hx - 10, hy - 1, hx - 2, hy + 1, BARK_OLD[2])
        line(s, hx + 3, hy + 1, hx + 11, hy - 1, BARK_OLD[2])
        line(s, hx - 10, hy, hx - 2, hy + 2, BARK_OLD[0])
        line(s, hx + 3, hy + 2, hx + 11, hy, BARK_OLD[0])
        const eye = B.hurt ? C.olive1 : B.glow > 0.5 ? C.white : C.green4
        for (const ex of [hx - 5, hx + 6]) {
            ellipse(s, ex, hy + 3, 3.5, 2.5, C.ink)
            rect(s, ex - 1, hy + 3, 3, 1, C.green3)
            px(s, ex, hy + 3, eye)
            px(s, ex, hy + 5, C.green2) // light running down the bark like a tear
        }
        const gape = B.roar || B.strike ? 5 : B.wind > 0.5 ? 2 : 0
        line(s, hx - 6, hy + 9, hx + 9, hy + 8, C.ink)
        if (gape) {
            rect(s, hx - 5, hy + 9, 13, gape, C.ink)
            ditherEllipse(s, hx + 1, hy + 10 + (gape >> 1), 4, gape >> 1, C.green3, pulse ? 8 : 5)
            for (let i = 0; i < 6; i++) px(s, hx - 4 + i * 2, hy + 9, C.bone0)
        }
        // a short beard of moss and roots hanging from the jaw
        mossCurtain(s, hx - 6, hy + 10 + gape, 13, 7, t, 5)
        for (let i = 0; i < 3; i++) line(s, hx - 3 + i * 4, hy + 11 + gape, hx - 4 + i * 4, hy + 16 + gape + (i & 1) * 2, C.brown1)

        // The near arm, from a shoulder set out past the edge of the head so the raise clears the
        // face: hanging nearly to the water at rest, lifted up and out with the elbow bent back on
        // the wind-up, then swung over in an arc that brings the hand down on the ground in front.
        const sx = x + 24
        const sy = shY + 10
        const a1 = bz(1.35, -0.8, 0.9)
        // The lift leads with the elbow while the hand still hangs, and the hand only comes up at
        // the top: the forearm's rise is eased in behind the upper arm's. Swung as one straight
        // pole, the arm poked out level at the party halfway up.
        const a2 = B.wind > 0 ? 1.5 - 3.4 * B.wind ** 2.5 : a1 + bz(0.15, -1.1, 0.35)
        reach(sx, sy, a1, 26)
        const ex = P.x
        const ey = P.y
        reach(ex, ey, a2, 29)
        limbT(s, sx, sy, ex, ey, 12, 9, BARK_OLD)
        limbT(s, ex, ey, P.x, P.y, 9, 6, BARK_OLD)
        ball(s, ex, ey, 5, 5, BARK_OLD)
        barkGrain(s, Math.min(sx, ex, P.x) - 7, Math.min(sy, ey, P.y) - 7, Math.abs(Math.max(sx, ex, P.x) - Math.min(sx, ex, P.x)) + 14, Math.abs(Math.max(sy, ey, P.y) - Math.min(sy, ey, P.y)) + 14)
        ball(s, sx, sy, 7, 6, BARK_OLD) // the knot of the shoulder
        px(s, sx - 3, sy - 3, BARK_OLD[2])
        rootHand(s, P.x, P.y, B.strike ? 1 : B.wind > 0 ? 0.2 : 0.4)
        for (let i = 1; i < 5; i++) {
            const mx = sx + (ex - sx) * i / 5
            const my = sy + (ey - sy) * i / 5
            line(s, R(mx), R(my + 3), R(mx) + R(wv(t, 2.0, 1, i * 0.2)), R(my + 8 + (i & 1) * 4), MOSS[i % 3]!)
        }
        finish(s, Entry.Rise, 14)
    },
    fx(dst, st, t, x, y, dir) {
        ditherEllipse(dst, x, y - 1, 40, 3, C.void, 16)
        ditherEllipse(dst, x, y - 2, 34, 2, C.teal0, 12)
        const k = fr(t, 10, 10)
        for (let i = 0; i < 5; i++) dst.set(x + dir * (-30 + ((i * 17 + k * 5) % 60)), y - 3, C.teal2)
        // spores rising from the heart, and wisps circling the crown
        for (let i = 0; i < 4; i++) dst.set(x + dir * (3 + ((i * 7 + k) % 11) - 5), y - 52 - ((k * 3 + i * 9) % 34), i & 1 ? C.green3 : C.green4)
        for (let i = 0; i < 3; i++) {
            const a = (k / 10 + i / 3) * Math.PI * 2
            dst.set(x + dir * (6 + R(Math.cos(a) * 22)), y - 104 + R(Math.sin(a) * 6), C.green4)
        }
        if (st === 'attack' && B.strike) for (let i = 0; i < 10; i++) dst.set(x + dir * (34 + i * 2), y - (i % 3) - 1, i & 1 ? C.teal3 : C.white)
    }
}

// ═══════════════════════════════════════════════════════════════ 3 · Cinderpass

// Stage 5: Slagjaw, the kobolds' war-chief, a head taller and three times the girth of his
// clan, in black iron, his lower jaw a plate of cooling slag. Stage 10: Pyrrhax, the Molten
// Wyrm the kobolds worship, rising out of the lava lake at the heart of the pass.

const IRON_BLACK: Mat = [C.void, C.stone0, C.stone1]
const WYRM_HORN: Mat = [C.stone1, C.stone2, C.stone3]

/** Molten seams across a dark plate: a jagged line of lava with a hot core that pulses. */
function seam(s: Surface, x0: number, y0: number, x1: number, y1: number, hot: boolean): void {
    const n = Math.max(2, R(Math.hypot(x1 - x0, y1 - y0) / 3))
    let px0 = x0
    let py0 = y0
    for (let i = 1; i <= n; i++) {
        const u = i / n
        const nx = x0 + (x1 - x0) * u + (i < n ? ((i * 7) % 3) - 1 : 0)
        const ny = y0 + (y1 - y0) * u + (i < n ? ((i * 5) % 3) - 1 : 0)
        line(s, R(px0), R(py0), R(nx), R(ny), C.lava1)
        if (hot && i & 1) px(s, R(nx), R(ny), C.gold2)
        px0 = nx
        py0 = ny
    }
}

/**
 * Molten Quake: the hammer goes up over his head and comes down on the ground; the ground cracks
 * and lava runs out along the crack to the party, bursting up under each of them in turn.
 */
const MOLTEN_QUAKE: BossSpecial = {
    name: 'Molten Quake', tint: 'dusk0', hits: [1.3, 1.4, 1.5, 1.6, 1.7, 1.8], spread: true,
    fx(s, t, st) {
        const d = st.dir
        const hx = st.bx + d * 20
        // the hammer landing: a flat shock and slag thrown up
        shockRing(s, hx, st.by - 1, t, 1.1, 0.5, 4, 34, C.gold3, true)
        debris(s, hx, st.by - 2, st.by, t, 1.1, 14, 110, 'ember', 71)
        st.party.forEach((p, i) => {
            const t0 = 1.22 + i * 0.1
            crack(s, hx, st.by - 1, p.x, p.y - 1, sp(t, 1.1, t0), 81 + i, C.lava0, C.lava1)
            blast(s, p.x, p.y - 4, t, t0, 9, 0.55, FIRE6, 91 + i, 'ember', true)
            debris(s, p.x, p.y - 2, p.y, t, t0, 8, 100, 'ember', 101 + i)
            flames(s, p.x, p.y, 12, t, t0 + 0.1, 2.4, 111 + i, 7)
        })
    }
}

/**
 * Slagjaw, the kobolds' war-chief: the clan's own long-snouted, horned face on a body three times
 * their girth, in a black iron breastplate cracked with molten seams, spiked pauldrons, a crown of
 * iron spikes, a scorched cape and a belt of trophy skulls. His lower jaw is a plate of slag,
 * dark metal glowing through a molten seam and dripping. He swings a slag hammer, an iron block
 * banded round a cracked, glowing core, up over his head and down onto the front rank.
 */
export const SLAGJAW: CreatureDef = {
    name: 'Slagjaw', size: 96, shadow: 20, accent: C.lava1,
    // for the hammer brought down in front of him
    room: 6,
    states: withSpecial(bossStates(1.2, 1.2, 1.8), 2.4),
    special: MOLTEN_QUAKE,
    draw(s, st, t) {
        drive(this, st, t, 8, 1.2)
        // the hammer heaved high and held, then brought down on the ground
        if (st === 'special') spAttack(0.42, 0.46, 0.62, 6)
        const x = s.ax - 6 + B.lunge - B.kb
        const y = s.ay
        const crouch = R(B.wind * 3 + (B.strike ? 4 : B.rec * 3) + B.die * 10)
        const hip = y - 22 + crouch + B.bob
        const top = hip - 24
        const flap = fr(t, 5, 3)
        const hot = fr(t, 5, 2) === 1 || B.glow > 0.5

        // the scorched cape behind him, ragged at the hem and stirring in the heat
        poly(s, [-6, 0, 6, 0, 4, 30, -2, 32 + flap, -8, 29, -12, 31 - flap, -14, 26], x - 4, top + 2, C.red0)
        line(s, x - 10, top + 4, x - 17, top + 27, C.brown0)
        for (let i = 0; i < 4; i++) px(s, x - 16 + i * 4, top + 30 + ((i + flap) & 1), C.lava0) // embers in the hem
        // the tail, thick and banded
        chain(s, x - 8, hip - 2, x - 26, hip + 2, x - 32, y - 5 + wv(t, 1.2, 2), 5, 2, SCALE_RED, 12)
        for (let i = 1; i < 4; i++) px(s, x - 12 - i * 6, hip + 1 + i, C.red0)
        // digitigrade legs in iron greaves
        for (const [lx, far] of [[-6, true], [6, false]] as const) {
            const m = far ? C.red1 : C.orange
            line(s, x + lx, hip, x + lx - 5, hip + 10 - R(crouch / 2), m, 5)
            line(s, x + lx - 5, hip + 10 - R(crouch / 2), x + lx + 1, y - 2, m, 4)
            rect(s, x + lx - 3, hip + 11 - R(crouch / 2), 5, 7, far ? IRON_BLACK[0] : IRON_BLACK[1]) // greave
            px(s, x + lx - 2, hip + 12 - R(crouch / 2), C.stone2)
            rect(s, x + lx - 2, y - 2, 8, 2, C.ink)
            for (let i = 0; i < 3; i++) px(s, x + lx + 3 + i, y - 1, C.bone1) // claws
        }
        // the barrel of a body, gold belly scales, then the black iron breastplate over it
        ball(s, x, top + 14, 14, 15, SCALE_RED)
        ellipse(s, x + 4, top + 18, 7, 9, C.gold2)
        for (let i = 0; i < 4; i++) rect(s, x, top + 13 + i * 4, 9, 1, C.gold1)
        poly(s, [-12, 0, 10, 0, 12, 12, 6, 20, -8, 20, -13, 10], x - 1, top + 2, IRON_BLACK[1])
        poly(s, [-12, 0, -4, 0, -6, 20, -8, 20, -13, 10], x - 1, top + 2, IRON_BLACK[0])
        line(s, x - 12, top + 2, x + 9, top + 2, IRON_BLACK[2])
        seam(s, x - 8, top + 6, x + 6, top + 11, hot)
        seam(s, x - 4, top + 14, x + 8, top + 18, hot)
        // the belt and its trophies: small skulls of goblin and kobold
        rect(s, x - 13, hip - 4, 26, 4, C.brown0)
        rect(s, x - 13, hip - 4, 26, 1, C.brown1)
        for (const [sx, c] of [[-9, C.bone1], [-2, C.bone0], [5, C.bone1]] as const) {
            rect(s, x + sx, hip - 2, 4, 4, c)
            px(s, x + sx + 1, hip - 1, C.ink); px(s, x + sx + 3, hip - 1, C.ink)
            px(s, x + sx + 1, hip + 2, C.ink)
        }
        // spiked pauldrons
        for (const [px0, far] of [[-10, true], [9, false]] as const) {
            ball(s, x + px0, top + 2, 6, 4, far ? [C.void, C.void, C.stone0] : IRON_BLACK)
            for (let i = 0; i < 3; i++) tri(s, x + px0 - 4 + i * 4, top - 1, x + px0 - 2 + i * 4, top - 1, x + px0 - 3 + i * 4, top - 6, far ? C.stone0 : C.stone1)
        }

        // the head: the clan's long snout and horns, bigger and scarred, crowned in iron
        const hx = x + 7
        const hy = top - 7 + R(B.die * 4)
        tri(s, hx - 5, hy - 3, hx - 5, hy + 2, hx - 12, hy - 2, C.red1) // ear fin
        ball(s, hx, hy, 8, 7, SCALE_RED)
        poly(s, [0, -5, 7, -5, 15, -2, 15, 1, 0, 2], hx + 3, hy, C.orange)
        line(s, hx + 4, hy - 5, hx + 17, hy - 2, C.gold2)
        px(s, hx + 17, hy - 2, C.ink)
        const eye = B.hurt ? C.ink : (B.glow > 0.4 ? C.white : C.gold3)
        rect(s, hx + 1, hy - 6, 5, 1, C.red0)
        rect(s, hx + 2, hy - 5, 2, 2, eye)
        px(s, hx + 3, hy - 5, C.ink)
        line(s, hx - 1, hy - 7, hx + 4, hy - 2, C.red0) // a scar across the eye
        // the slag jaw: a plate of dark metal glowing through a molten seam, dripping
        const jaw = B.roar || B.strike ? 3 : 1
        if (jaw > 1) rect(s, hx + 4, hy + 2, 11, jaw, C.lava0)
        rect(s, hx + 2, hy + 2 + jaw, 14, 5, IRON_BLACK[1])
        rect(s, hx + 2, hy + 2 + jaw, 14, 1, IRON_BLACK[2])
        rect(s, hx + 2, hy + 6 + jaw, 14, 1, IRON_BLACK[0])
        seam(s, hx + 4, hy + 4 + jaw, hx + 15, hy + 4 + jaw, hot)
        for (let i = 0; i < 4; i++) px(s, hx + 5 + i * 3, hy + 2 + jaw, C.bone1) // teeth set in the slag
        const drip = fr(t, 6, 4)
        px(s, hx + 12, hy + 7 + jaw + drip, drip < 2 ? C.gold2 : C.lava1)
        px(s, hx + 7, hy + 7 + jaw + (drip >> 1), C.lava1)
        // horns and a crown of iron spikes
        for (let i = 0; i < 2; i++) {
            line(s, hx - 4 + i * 5, hy - 6, hx - 10 + i * 5, hy - 12, C.bone1, 2)
            px(s, hx - 11 + i * 5, hy - 13, C.white)
        }
        rect(s, hx - 6, hy - 8, 12, 2, IRON_BLACK[1])
        for (let i = 0; i < 4; i++) tri(s, hx - 6 + i * 3, hy - 8, hx - 4 + i * 3, hy - 8, hx - 5 + i * 3, hy - 12 - (i & 1) * 2, C.stone2)

        // The slag hammer, in both hands: at rest it lies back over his shoulder, the grip in
        // front of his chest; the wind-up lifts it up over his head, the strike brings it down
        // in front of him, and the recovery swings it back up onto the shoulder.
        const ga = bz(-2.5, -1.75, 0.6)
        const gx = bz(x + 9, x + 5, x + 17)
        const gy = bz(top + 12, top - 6, top + 16)
        const dx = Math.cos(ga)
        const dy = Math.sin(ga)
        const nx = -dy
        const ny = dx
        const hdx = gx + dx * 24
        const hdy = gy + dy * 24
        const H = (u: number, v: number): [number, number] => [hdx + dx * u + nx * v, hdy + dy * u + ny * v]
        const hammer = () => {
            line(s, R(gx - dx * 3), R(gy - dy * 3), R(hdx), R(hdy), C.brown1, 2)
            px(s, R(gx - dx * 3), R(gy - dy * 3), C.stone2) // the pommel cap
            const [a0x, a0y] = H(-2, -9)
            const [a1x, a1y] = H(-2, 9)
            const [a2x, a2y] = H(9, 9)
            const [a3x, a3y] = H(9, -9)
            quad(s, a0x, a0y, a1x, a1y, a2x, a2y, a3x, a3y, IRON_BLACK[1])
            for (const u of [0, 7]) {
                const [b0x, b0y] = H(u, -9)
                const [b1x, b1y] = H(u, 9)
                line(s, R(b0x), R(b0y), R(b1x), R(b1y), C.stone2)
            }
            const [k0x, k0y] = H(3.5, -6)
            const [k1x, k1y] = H(3.5, 6)
            seam(s, k0x, k0y, k1x, k1y, true)
            const [ccx, ccy] = H(3.5, 0)
            disc(s, ccx, ccy, 2, hot ? C.gold2 : C.lava1)
            px(s, R(ccx), R(ccy), hot ? C.white : C.gold3)
        }
        // resting on the shoulder, the hammer's head lies behind him, so the body goes over it
        const behind = ga < -2.1
        if (behind) {
            const keep = new Uint8Array(s.data)
            hammer()
            for (let i = 0; i < s.data.length; i++) if (keep[i]) s.data[i] = keep[i]!
        }
        // the far arm on the lower grip, the near arm higher up the haft
        const far: Mat = [C.red0, C.red1, C.orange]
        limbT(s, x - 8, top + 5, gx - dx * 1, gy - dy * 1, 6, 5, far)
        ball(s, gx - dx, gy - dy, 3, 3, far)
        if (!behind) hammer()
        else line(s, R(gx - dx * 3), R(gy - dy * 3), R(gx + dx * 8), R(gy + dy * 8), C.brown1, 2)
        const nhx = gx + dx * 6
        const nhy = gy + dy * 6
        limbT(s, x + 9, top + 4, nhx, nhy, 7, 5, SCALE_RED)
        ball(s, nhx, nhy, 3, 3, SCALE_RED)
        finish(s, Entry.Drop, 8)
    },
    fx(dst, st, t, x, y, dir) {
        if (st === 'attack' && B.strike) {
            for (let i = 0; i < 10; i++) { dst.set(x + dir * (26 + i * 2), y - 1 - (i % 3), i & 1 ? C.lava1 : C.gold2); dst.set(x + dir * (24 + i), y - 4 - i, C.orange) }
        }
        if (st === 'entry' && B.ent > 0.95) for (let i = 0; i < 12; i++) dst.set(x + dir * (-22 + i * 4), y - (i & 1), C.stone3)
        const k = fr(t, 10, 12)
        dst.set(x + dir * (6 + (k % 5)), y - 54 - k * 2, C.orange)
        dst.set(x + dir * (-4 + (k % 3)), y - 40 - k, C.stone2) // smoke off the cape
    }
}

/**
 * A wyrm's wing from the shoulder (x, y), reaching back: an arm bone to the wrist, four finger
 * bones fanning out from it, and dark membrane stretched between them, veined with fire.
 * `spread` 0 (folded low) … 1 (raised and open); `far` draws the wing behind the neck darker.
 */
function batWing(s: Surface, x: number, y: number, span: number, spread: number, far: boolean): void {
    const bone = far ? C.void : C.stone1
    const skin = far ? C.red0 : C.lava0
    const vein = far ? C.lava0 : C.lava1
    const wx = x - span * 0.35
    const wy = y - span * (0.2 + 0.4 * spread)
    const tips: readonly (readonly [number, number])[] = [
        [wx - span * 0.55, wy - span * 0.2 * spread - 3],
        [wx - span * 0.65, wy + span * 0.12],
        [wx - span * 0.5, wy + span * 0.4],
        [wx - span * 0.2, wy + span * 0.55]
    ]
    const bx = x - span * 0.1
    const by = y + span * 0.3
    // the membrane, then the fire in its veins, then the bones over it
    for (let i = 0; i < tips.length - 1; i++) tri(s, wx, wy, tips[i]![0], tips[i]![1], tips[i + 1]![0], tips[i + 1]![1], skin)
    tri(s, x, y, wx, wy, tips[3]![0], tips[3]![1], skin)
    tri(s, x, y, tips[3]![0], tips[3]![1], bx, by, skin)
    for (let i = 0; i < tips.length - 1; i++) {
        const mx = (tips[i]![0] + tips[i + 1]![0]) / 2
        const my = (tips[i]![1] + tips[i + 1]![1]) / 2
        line(s, R(wx), R(wy), R(wx + (mx - wx) * 0.8), R(wy + (my - wy) * 0.8), vein)
    }
    line(s, R(x), R(y), R(wx), R(wy), bone, 2)
    for (const [tx, ty] of tips) line(s, R(wx), R(wy), R(tx), R(ty), bone)
    disc(s, wx, wy, 1.5, bone)
    tri(s, wx - 1, wy - 1, wx + 1, wy - 1, wx - 2, wy - 5, bone) // the claw at the wrist
}

/**
 * Inferno: he rears back, the magma in his throat and belly blazing, then breathes a torrent of
 * fire and sweeps it along the whole party from front to back, leaving the ground burning.
 */
const INFERNO: BossSpecial = {
    name: 'Inferno', tint: 'dusk0', hits: [1.2, 1.38, 1.56, 1.74, 1.92, 2.1], spread: true,
    fx(s, t, st) {
        const q = sq(t)
        const d = st.dir
        const mx = st.bx + d * 50
        const my = st.by - 76
        // the breath held: its target sweeps from the nearest to the furthest
        if (q >= 1.05 && q < 2.3) {
            const u = Math.min(1, (q - 1.1) / 1.0)
            const k = Math.max(0, u) * (st.party.length - 1)
            const a = st.party[Math.floor(k)]!
            const b = st.party[Math.min(st.party.length - 1, Math.floor(k) + 1)]!
            const f = k - Math.floor(k)
            const tx = a.x + (b.x - a.x) * f
            const ty = a.y - 8 + (b.y - a.y) * f
            const fade = Math.min(1, (2.3 - q) / 0.2)
            for (let i = 0; i <= 16; i++) {
                const v = i / 16
                const wob = Math.sin(q * 30 + i) * v * 3
                blob(s, mx + (tx - mx) * v, my + (ty - my) * v + wob, (2 + v * 10) * fade, 0.08 + v * 0.35, FIRE6, 17 + i + Math.floor(q * 20))
            }
            debris(s, tx, ty + 6, ty + 8, t, Math.floor(q * 8) / 8, 6, 90, 'ember', 23 + Math.floor(q * 8), 0.4)
        }
        // the ground left burning where it passed
        st.party.forEach((p, i) => flames(s, p.x, p.y, 20, t, 1.15 + i * 0.18, 2.8, 131 + i, 12))
    }
}

/**
 * Pyrrhax, the Molten Wyrm, the dragon the kobolds worship: so large that his hindquarters and
 * tail run on past the edge of the screen. A long body armoured in obsidian scale and cracked
 * with magma, standing on four clawed legs; spikes down the spine; a glowing belly up the chest
 * and neck; two great wings half-folded over his back that spread as he rears. The head, on an
 * S of neck, is long and horned, the jaw hinged open on a throat of magma, teeth like glass,
 * eyes blazing. He rears back and breathes fire.
 */
export const PYRRHAX: CreatureDef = {
    name: 'Pyrrhax, the Molten Wyrm', size: 256, shadow: 70, accent: C.lava1,
    states: withSpecial(bossStates(1.4, 1.8, 2.2), 2.8),
    special: INFERNO,
    draw(s, st, t) {
        drive(this, st, t, 10, 1.8)
        // a long rear with the magma blazing, then the breath held while it sweeps the line
        if (st === 'special') spAttack(0.36, 0.4, 0.82, 6)
        const x = s.ax - B.kb
        const y = s.ay
        const hot = fr(t, 5, 2) === 1 || B.glow > 0.5
        const rear = R(bz(0, 8, -6)) // he draws his head back on the wind-up, thrusts it on the breath
        const lift = R(bz(0, 6, 2)) + B.breath
        const sink = R(B.die * 14)
        const spread = B.roar || B.wind > 0.3 ? 1 : B.strike ? 0.7 : 0.3 + wv(t, 1.8, 1) * 0.05
        const bodyY = y - 44 + sink + B.breath

        // the tail, out past the edge of the frame, and the far legs
        chain(s, x - 96, bodyY - 2, x - 140, bodyY + 16, x - 176, bodyY - 4 + wv(t, 1.8, 3), 13, 7, OBSIDIAN, 18)
        const leg = (hx: number, hy: number, kx: number, ky: number, fx: number, far: boolean) => {
            const m: Mat = far ? [C.void, C.void, C.stone0] : OBSIDIAN
            limbT(s, hx, hy, kx, ky, far ? 12 : 14, far ? 9 : 11, m)
            limbT(s, kx, ky, fx, y - 2, far ? 9 : 11, far ? 7 : 8, m)
            ball(s, kx, ky, far ? 5 : 6, far ? 5 : 6, m)
            rect(s, fx - 6, y - 4, 14, 4, m[0])
            for (let i = 0; i < 3; i++) line(s, fx + 3 + i * 3, y - 3, fx + 5 + i * 3, y, C.bone1)
        }
        leg(x - 84, bodyY + 2, x - 70, y - 22, x - 80, true)
        leg(x - 28, bodyY, x - 18, y - 22, x - 12, true)
        // the far wing, behind the body
        batWing(s, x - 52, bodyY - 18 - lift, 84, spread, true)

        // the body: a long barrel of obsidian scale, magma in its cracks, spikes down the spine
        for (let i = 0; i < 9; i++) {
            const sx = x - 100 + i * 10
            const sy = bodyY - 20 + R(Math.sin(i * 0.5) * 2)
            tri(s, sx - 4, sy + 4, sx + 3, sy + 4, sx - 3, sy - 8 - (i & 1) * 3, C.stone0)
            px(s, sx - 3, sy - 8 - (i & 1) * 3, C.lava1)
        }
        ellipse(s, x - 58, bodyY, 48, 20, OBSIDIAN[0])
        ellipse(s, x - 59, bodyY - 2, 46, 17, OBSIDIAN[1])
        ellipse(s, x - 70, bodyY - 10, 26, 5, OBSIDIAN[2])
        ellipse(s, x - 50, bodyY + 12, 34, 5, C.lava0) // the belly's glow along the underside
        for (let i = 0; i < 7; i++) rect(s, x - 82 + i * 9, bodyY + 12, 6, 2, i & 1 ? C.orange : C.gold1)
        seam(s, x - 96, bodyY - 4, x - 70, bodyY + 2, hot)
        seam(s, x - 62, bodyY - 8, x - 36, bodyY - 2, hot)
        seam(s, x - 44, bodyY + 4, x - 20, bodyY - 4, hot)
        for (let i = 0; i < 10; i++) px(s, x - 94 + i * 8, bodyY - 6 + (i & 1) * 8, C.stone2) // scale glints
        // the near hind leg, a great haunch
        ball(s, x - 84, bodyY + 2, 17, 15, OBSIDIAN)
        seam(s, x - 92, bodyY - 4, x - 78, bodyY + 10, hot)
        leg(x - 82, bodyY + 8, x - 66, y - 20, x - 74, false)

        // the near wing, raised off the back so the body still reads under it; the neck goes in front
        batWing(s, x - 40, bodyY - 20 - lift, 58, spread, false)
        // the neck, an S from the chest to the head, fins down its back, belly glowing up its front
        const nx0 = x - 22
        const ny0 = bodyY - 6
        const ncx = x - 4
        const ncy = bodyY - 44
        const hx = x + 22 - rear + R(wv(t, 1.8, 2))
        const hy = y - 80 - lift + sink * 3
        const nx1 = hx - 10
        const ny1 = hy + 6
        for (let i = 3; i < 16; i += 2) {
            const u = i / 18
            bez(nx0, ny0, ncx, ncy, nx1, ny1, u)
            const r = 12 - u * 4
            tri(s, P.x - r * 0.9, P.y - r * 0.1, P.x - r * 0.5, P.y - r * 0.8, P.x - r * 1.5, P.y - r * 0.9, C.stone0)
            px(s, R(P.x - r * 1.5), R(P.y - r * 0.9), C.lava1)
        }
        chain(s, nx0, ny0, ncx, ncy, nx1, ny1, 13, 8, OBSIDIAN, 18)
        for (let i = 1; i < 16; i++) {
            const u = i / 16
            bez(nx0, ny0, ncx, ncy, nx1, ny1, u)
            const r = 13 - u * 5
            rect(s, R(P.x + r * 0.3), R(P.y + r * 0.2), R(r * 0.55), 2, i & 1 ? C.orange : C.gold1)
            if (i % 4 === 2) seam(s, P.x - r * 0.6, P.y - r * 0.3, P.x - r * 0.1, P.y + r * 0.1, hot)
        }
        // the near foreleg, planted in front
        leg(x - 24, bodyY + 2, x - 12, y - 24, x - 4, false)

        // the head: a long horned wedge, the jaw hinged open on a throat of magma
        const open = B.strike || B.roar ? 9 : B.wind > 0.5 ? 5 : 2
        chain(s, hx - 4, hy - 7, hx - 16, hy - 20, hx - 30, hy - 18, 3, 1, WYRM_HORN, 10)
        chain(s, hx + 2, hy - 9, hx - 6, hy - 24, hx - 18, hy - 26, 2.5, 1, WYRM_HORN, 10)
        poly(s, [-8, 2, 22, 2 + open, 20, 6 + open, -6, 8], hx, hy, OBSIDIAN[0])
        line(s, hx - 6, hy + 7, hx + 19, hy + 6 + open, C.orange)
        if (open > 2) {
            poly(s, [-4, 1, 22, 0, 21, 2 + open, -4, 3 + open * 0.5], hx, hy, C.lava0)
            ditherEllipse(s, hx + 6, hy + 2 + open * 0.5, 9, open * 0.4, C.gold2, hot ? 12 : 8)
            px(s, hx + 3, hy + 2 + R(open * 0.4), C.white)
        }
        ball(s, hx, hy - 2, 11, 8, OBSIDIAN)
        poly(s, [0, -8, 20, -5, 28, -2, 27, 1, 0, 2], hx + 2, hy, OBSIDIAN[1])
        line(s, hx - 6, hy - 9, hx + 28, hy - 4, OBSIDIAN[2])
        seam(s, hx - 6, hy - 3, hx + 14, hy - 5, hot)
        px(s, hx + 28, hy - 2, C.lava1); px(s, hx + 27, hy - 3, C.gold2)
        for (let i = 0; i < 7; i++) {
            px(s, hx + 4 + i * 3, hy + 2, C.bone1)
            px(s, hx + 4 + i * 3, hy + 3, C.bone1)
            if (open > 2) px(s, hx + 3 + i * 3, hy + 1 + open, C.bone1)
        }
        rect(s, hx + 5, hy - 8, 7, 1, OBSIDIAN[0])
        for (let i = 0; i < 3; i++) tri(s, hx + 3 + i * 3, hy - 9, hx + 5 + i * 3, hy - 9, hx + 2 + i * 3, hy - 13, C.stone0)
        const eye = B.hurt ? C.ink : hot ? C.white : C.gold3
        rect(s, hx + 7, hy - 7, 4, 2, C.lava1)
        rect(s, hx + 8, hy - 7, 2, 1, eye)
        for (let i = 0; i < 3; i++) tri(s, hx - 6 + i * 4, hy + 7, hx - 4 + i * 4, hy + 7, hx - 6 + i * 4, hy + 12, C.stone0)
        const drip = fr(t, 6, 4)
        px(s, hx + 14, hy + 7 + open + drip, drip < 2 ? C.gold2 : C.lava1)
        finish(s, Entry.Drop, 10)
    },
    fx(dst, st, t, x, y, dir) {
        const k = fr(t, 10, 8)
        // lava dripped from him cooling round his feet, and embers rising off his back
        ditherEllipse(dst, x - dir * 20, y - 1, 34, 2, C.lava0, 8)
        for (let i = 0; i < 6; i++) dst.set(x - dir * (-10 + i * 16 + (k & 1)), y - 60 - ((k * 3 + i * 7) % 30), i & 1 ? C.orange : C.gold2)
        if ((st === 'attack' && (B.strike || B.rec > 0.6)) || B.roar) {
            // fire breath: a widening cone of flame from the jaw, down onto the front rank
            const hx = x + dir * (48 + (st === 'attack' ? 6 : 0))
            const hy = y - 78
            for (let i = 0; i < 56; i++) {
                const d = 2 + i * 1.3
                const w = d * 0.35
                const off = Math.sin(i * 7.3 + k) * w
                const c = i < 8 ? C.gold3 : i < 22 ? C.gold2 : i < 36 ? C.orange : C.lava1
                dst.set(hx + dir * R(d), R(hy + d * 0.7 + off), c)
                dst.set(hx + dir * R(d), R(hy + d * 0.7 + off + 1), i < 24 ? C.white : c)
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════ 4 · Rimeholt

// Stage 5: Jarl Hrimgar, the raider-king who swore the hold to the cold, in a bearskin and a
// crowned helm, leaning on an axe of ice. Stage 10: Vinterhel, the Glacier Titan, a mountain of
// rock and glacier ice that got up and walked, with a cold star for a heart.

const JARL_SKIN: Mat = [C.night3, C.haze, C.frost]
const BEARSKIN: Mat = [C.brown0, C.brown1, C.brown2]
const MAIL: Mat = [C.steel0, C.steel1, C.steel2]
const TITAN_ROCK: Mat = [C.stone1, C.stone2, C.stone3]

/** Ringed mail: every base-shade pixel in the box turned into rows of rings, lit on the upper left. */
function mailRings(s: Surface, x0: number, y0: number, w: number, h: number): void {
    for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
            if (s.get(x, y) !== MAIL[1]) continue
            const odd = (y & 1) === 1
            if (!odd && ((x + (y >> 1)) & 1) === 0) s.set(x, y, MAIL[2])
            else if (odd && ((x + (y >> 1)) & 1) === 1) s.set(x, y, MAIL[0])
        }
    }
}

/**
 * Jarl Hrimgar, the raider-king: broad in a bearskin cloak, the bear's head worn on his near
 * shoulder; a domed helm banded in a gold crown with cheek guards and curving horns; a face lit
 * frost-pale with a band of woad across the eyes, a drooping moustache and a long beard white
 * with rime, two braids of it bound in gold rings; a barrel chest in ringed mail with a studded
 * baldric, a red tunic edged in gold below the hauberk, cross-gartered wool trousers and
 * fur-cuffed boots. At rest he leans on his great axe of ice, its head planted beside him and
 * both hands on the haft; he heaves it up over his head, leaning back, and cleaves down.
 */
/**
 * Winter's Cleave: he heaves the ice axe up, leaps, and brings it down on the ground; a line of ice
 * spikes bursts out of the frozen ground and marches through the party.
 */
const WINTERS_CLEAVE: BossSpecial = {
    name: 'Winter\'s Cleave', tint: 'night0', hits: [1.22, 1.3, 1.38, 1.46, 1.54, 1.62], spread: true,
    fx(s, t, st) {
        const q = sq(t)
        const d = st.dir
        const hx = st.bx + d * 18
        shockRing(s, hx, st.by - 1, t, 1.1, 0.5, 4, 30, C.frost, true)
        debris(s, hx, st.by - 2, st.by, t, 1.1, 12, 100, 'frost', 141)
        // the spikes marching out, ahead of the hits and on through each of the party
        const far = st.party[st.party.length - 1]!
        for (let k = 0; k < 16; k++) {
            const u = k / 15
            const x = hx + (far.x - 8 - hx) * u
            const y = st.by + (far.y - st.by) * u
            const t0 = 1.1 + u * 0.55
            const g = sp(t, t0, t0 + 0.08)
            const melt = 1 - sp(t, 2.0 + u * 0.2, 2.4)
            if (g <= 0 || melt <= 0) continue
            const h = R(g * melt * (8 + hash2(k, 5) * 10))
            spike(s, R(x), R(y), h, 2.2, (hash2(k, 6) - 0.5) * 6, C.blue1, C.frost, C.white)
            if (q < t0 + 0.2) debris(s, x, y - 2, y, t, t0, 3, 60, 'frost', 151 + k, 0.4)
        }
        st.party.forEach((p, i) => blast(s, p.x, chest(p), t, 1.22 + i * 0.08, 7, 0.45, FROST6, 161 + i, 'frost'))
    }
}

export const JARL_HRIMGAR: CreatureDef = {
    name: 'Jarl Hrimgar', size: 96, shadow: 20, accent: C.cyan,
    // for the great axe heaved overhead and cleaved down in front of him
    room: 9,
    states: withSpecial(bossStates(1.2, 1.6, 2.0), 2.4),
    special: WINTERS_CLEAVE,
    draw(s, st, t) {
        drive(this, st, t, 8, 1.6)
        // the axe heaved up, a leap, and the cleave down onto the ground
        if (st === 'special') spAttack(0.42, 0.46, 0.62, 10)
        const leap = st === 'special' ? R(Math.sin(Math.PI * Math.min(1, Math.max(0, (B.sp - 0.28) / 0.18))) * 12) : 0
        const x = s.ax - 6 + B.lunge - B.kb
        const y = s.ay - leap
        const crouch = R(B.strike ? 4 : B.rec * 3 + B.die * 12)
        const hip = y - 27 + crouch + B.bob
        const sy = hip - 21
        const lean = R(bz(0, -2, 3))
        const walk = st === 'entry' ? fr(t, 6, 2) : 0
        const flap = fr(t, 5, 3)
        const sway = wv(t, 1.6, 1)

        // the bearskin cloak, hanging from the shoulders behind him, its hem ragged fur
        const cx = x - 6 + lean
        poly(s, [-8, 0, 10, 0, 8, 36, 0, 38 + flap, -8, 36, -14, 38 - flap, -18, 32], cx, sy, BEARSKIN[1])
        poly(s, [-8, 0, -2, 0, -8, 36, -14, 38 - flap, -18, 32], cx, sy, BEARSKIN[0])
        for (let i = 0; i < 6; i++) line(s, cx - 15 + i * 4, sy + 10 + (i & 1) * 6, cx - 16 + i * 4, sy + 16 + (i & 1) * 6, BEARSKIN[0])
        for (let i = 0; i < 7; i++) px(s, cx - 17 + i * 4, sy + 37 + ((i + flap) & 1), BEARSKIN[2])

        // legs: wool trousers cross-gartered to the knee, boots with fur cuffs
        const leg = (lx: number, fx: number, far: boolean) => {
            const m: Mat = far ? [C.stone0, C.stone1, C.stone2] : [C.stone1, C.stone2, C.stone3]
            limbT(s, x + lx, hip + 2, x + fx, y - 7, 8, 6, m)
            for (let k = 0; k < 3; k++) {
                const gy = hip + 10 + k * 4
                const gx = x + lx + (fx - lx) * (gy - hip) / (y - 7 - hip)
                line(s, R(gx - 3), gy, R(gx + 3), gy + 2, far ? C.brown0 : C.brown1)
            }
            const bx = x + fx
            poly(s, [-4, -8, 4, -8, 5, -2, 8, -1, 8, 0, -5, 0], bx, y, far ? C.brown0 : C.brown1)
            rect(s, bx - 4, y - 1, 13, 1, C.ink) // the sole
            ellipse(s, bx, y - 8, 5, 2, far ? C.bone0 : C.bone1) // the fur cuff
            px(s, bx - 3, y - 9, C.white)
        }
        leg(-4, -6 - walk * 3, true)
        leg(5, 6 + walk * 3, false)
        // the red tunic below the hauberk, split at the front, gold at the hem
        poly(s, [-12, 0, 12, 0, 13, 11, 2, 11, 0, 7, -2, 11, -12, 11], x + lean, hip - 3, C.red1)
        poly(s, [-12, 0, -6, 0, -6, 11, -12, 11], x + lean, hip - 3, C.red0)
        rect(s, x - 12 + lean, hip + 7, 14, 1, C.gold1); rect(s, x + 2 + lean, hip + 7, 11, 1, C.gold1)
        // the hauberk: a barrel chest tapering to the waist, its hem scalloped
        const tx = x + lean
        poly(s, [-14, 2, -10, -2, 10, -2, 14, 2, 12, 20, 11, 24, -11, 24, -12, 20], tx, sy + 2, MAIL[1])
        poly(s, [-14, 2, -10, -2, -6, -2, -8, 24, -11, 24, -12, 20], tx, sy + 2, MAIL[0])
        mailRings(s, tx - 14, sy, 29, 27)
        for (let i = 0; i < 7; i++) px(s, tx - 10 + i * 3, sy + 26, MAIL[0])
        line(s, tx + 12, sy + 4, tx + 11, sy + 22, MAIL[2]) // the lit flank
        // the studded baldric across the chest, the wide belt, the gold buckle
        line(s, tx - 10, sy + 2, tx + 9, sy + 18, C.brown1, 2)
        for (let i = 0; i < 4; i++) px(s, tx - 7 + i * 5, sy + 5 + i * 4, C.gold2)
        rect(s, tx - 12, hip - 6, 25, 4, C.brown0)
        rect(s, tx - 12, hip - 6, 25, 1, C.brown1)
        rect(s, tx - 3, hip - 7, 7, 6, C.gold0)
        rect(s, tx - 2, hip - 6, 5, 4, C.gold2)
        px(s, tx - 1, hip - 5, C.gold3); px(s, tx + 1, hip - 4, C.gold1)

        // the far arm, reaching across to the lower grip
        const ga = bz(1.35, -1.9, 0.75)
        const gx = bz(x + 15, x + 6, x + 19) + lean
        const gy = bz(sy + 13, sy - 10, sy + 17)
        const dx = Math.cos(ga)
        const dy = Math.sin(ga)
        const fsx = tx - 10
        const fsy = sy + 3
        elbow(fsx, fsy, gx - dx, gy - dy, 11, 11, -1)
        const fex = P.x
        const fey = P.y
        limbT(s, fsx, fsy, fex, fey, 7, 6, [C.steel0, C.steel0, C.steel1])
        limbT(s, fex, fey, gx - dx, gy - dy, 6, 5, [C.night3, C.night3, C.haze])
        ball(s, gx - dx, gy - dy, 3, 3, [C.night3, C.night3, C.haze])

        // the head: frost-pale under the helm, woad across the eyes
        const hx = tx + 3
        const hy = sy - 4 + R(B.die * 6)
        ellipse(s, hx, hy - 7, 6, 7, JARL_SKIN[1])
        ellipse(s, hx + 2, hy - 8, 3, 4, JARL_SKIN[2])
        rect(s, hx - 5, hy - 9, 11, 3, C.blue1)
        rect(s, hx - 5, hy - 9, 11, 1, C.blue2)
        const eye = B.hurt ? C.ink : (B.glow > 0.5 ? C.white : C.cyan)
        rect(s, hx, hy - 8, 2, 1, C.ink); rect(s, hx + 3, hy - 8, 2, 1, C.ink)
        px(s, hx + 1, hy - 8, eye); px(s, hx + 4, hy - 8, eye)
        line(s, hx - 1, hy - 10, hx + 5, hy - 10, C.bone0) // frosted brows
        poly(s, [0, 0, 3, 3, 0, 3], hx + 5, hy - 7, JARL_SKIN[1]) // the nose
        px(s, hx + 6, hy - 5, JARL_SKIN[0])
        // the beard, white with rime, strands running down it, a moustache drooping over it
        poly(s, [-5, 0, 7, 0, 6, 6, 2, 12, -2, 11, -5, 6], hx, hy - 4, C.white)
        for (let i = 0; i < 4; i++) line(s, hx - 3 + i * 3, hy - 2, hx - 2 + i * 3, hy + 5, C.frost)
        line(s, hx, hy - 4, hx + 6, hy - 4, C.frost)
        px(s, hx + 6, hy - 3, C.white); px(s, hx - 1, hy - 3, C.white)
        if (B.roar || B.strike) rect(s, hx + 1, hy - 3, 4, 2, C.ink)
        const br = R(sway * 0.5)
        for (const bx of [hx - 1, hx + 4]) {
            line(s, bx, hy + 6, bx + br, hy + 15, C.frost, 2)
            rect(s, bx - 1 + br, hy + 9, 3, 1, C.gold2)
            rect(s, bx - 1 + br, hy + 13, 3, 1, C.gold1)
            px(s, bx + br, hy + 16, C.cyan)
        }
        // the helm: a dome with a crown band, a nasal and cheek guards, curving horns
        for (const d of [-1, 1]) {
            const hbx = hx + d * 7
            // out from the helm and up, curling in at the tip
            for (let i = 0; i <= 12; i++) {
                const u = i / 12
                const ox = hbx + d * (u * 9 - u * u * 5)
                const oy = hy - 13 - u * 15 + u * u * 3
                disc(s, ox, oy, 2 - u * 1.2, i >= 11 ? C.white : C.bone1)
                if (i % 3 === 1) px(s, R(ox), R(oy + 1), C.bone0) // ridges
            }
        }
        ellipse(s, hx, hy - 14, 8, 5, C.steel2)
        ellipse(s, hx - 2, hy - 16, 4, 2, C.steel3)
        rect(s, hx - 8, hy - 14, 17, 3, C.gold1)
        rect(s, hx - 8, hy - 14, 17, 1, C.gold2)
        for (let i = 0; i < 4; i++) tri(s, hx - 6 + i * 4, hy - 14, hx - 4 + i * 4, hy - 14, hx - 5 + i * 4, hy - 17, C.gold2)
        rect(s, hx + 6, hy - 11, 2, 4, C.steel2) // the nasal
        rect(s, hx - 7, hy - 11, 3, 6, C.steel1) // the cheek guard
        px(s, hx - 6, hy - 10, C.steel3)

        // the bear's head, worn on the near shoulder
        const bx = tx + 10
        const by = sy + 1
        ball(s, bx, by, 6, 5, BEARSKIN)
        tri(s, bx - 4, by - 3, bx - 1, by - 4, bx - 4, by - 7, BEARSKIN[1]) // the ear
        px(s, bx - 3, by - 5, BEARSKIN[0])
        ellipse(s, bx + 6, by + 1, 4, 2.5, BEARSKIN[1])
        ellipse(s, bx + 7, by + 1, 2, 1.5, C.brown3) // the muzzle
        px(s, bx + 10, by, C.ink) // the nose
        for (let i = 0; i < 3; i++) px(s, bx + 5 + i * 2, by + 3, C.white) // teeth
        px(s, bx + 2, by - 1, C.ink); px(s, bx + 3, by - 1, C.gold2) // the glass eye

        // The great axe, both hands on the haft: planted head-down beside him at rest, heaved up
        // over his head on the wind-up, cleaving down on the strike.
        const nx = -dy
        const ny = dx
        const ax = gx + dx * 33
        const ay = gy + dy * 33
        line(s, R(gx - dx * 4), R(gy - dy * 4), R(ax), R(ay), C.brown1, 2)
        line(s, R(gx - dx * 4 + nx), R(gy - dy * 4 + ny), R(ax + nx), R(ay + ny), C.brown2)
        for (let k = 0; k < 4; k++) {
            const wx = gx + dx * (k * 2)
            const wy = gy + dy * (k * 2)
            line(s, R(wx - nx * 1.5), R(wy - ny * 1.5), R(wx + nx * 1.5), R(wy + ny * 1.5), C.brown0) // the grip wrap
        }
        disc(s, gx - dx * 4, gy - dy * 4, 1.5, C.steel2) // the butt cap
        const side = ga > 0 ? 1 : -1
        const E = (u: number, v: number): [number, number] => [ax + dx * u + nx * v * side, ay + dy * u + ny * v * side]
        const Q = (pts: number[], c: number) => {
            const out: number[] = []
            for (let i = 0; i < pts.length; i += 2) { const [qx, qy] = E(pts[i]!, pts[i + 1]!); out.push(qx, qy) }
            for (let i = 2; i + 3 < out.length; i += 2) tri(s, out[0]!, out[1]!, out[i]!, out[i + 1]!, out[i + 2]!, out[i + 3]!, c)
        }
        // the bearded blade: dark along the back, bright facets, a white cutting edge
        Q([-5, 1, 3, 1, 6, 15, -3, 16, -17, 19, -10, 6], C.cyan)
        Q([-5, 1, 3, 1, 1, 6, -6, 6], C.blue2)
        Q([1, 7, 6, 15, -3, 16, -1, 9], C.frost)
        Q([-10, 9, -3, 15, -15, 18], C.frost)
        const [c0x, c0y] = E(6, 15)
        const [c1x, c1y] = E(-3, 16)
        const [c2x, c2y] = E(-17, 19)
        line(s, R(c0x), R(c0y), R(c1x), R(c1y), C.white)
        line(s, R(c1x), R(c1y), R(c2x), R(c2y), C.white)
        const [k0x, k0y] = E(-2, 5)
        const [k1x, k1y] = E(-6, 12)
        line(s, R(k0x), R(k0y), R(k1x), R(k1y), C.blue1) // a flaw deep in the ice
        // the iron socket binding it to the haft, and the back spike
        Q([-6, -2, 4, -2, 4, 2, -6, 2], C.steel1)
        const [s0x, s0y] = E(-6, -2)
        const [s1x, s1y] = E(4, -2)
        line(s, R(s0x), R(s0y), R(s1x), R(s1y), C.steel2)
        Q([-2, -2, 2, -2, 0, -7], C.cyan)

        // the near arm on the upper grip: a mail sleeve, a leather bracer, a gold arm ring, a fist
        const hx2 = gx + dx * 7
        const hy2 = gy + dy * 7
        const nsx = tx + 11
        const nsy = sy + 4
        elbow(nsx, nsy, hx2, hy2, 11, 11, 1)
        const nex = P.x
        const ney = P.y
        limbT(s, nsx, nsy, nex, ney, 8, 7, MAIL)
        mailRings(s, R(Math.min(nsx, nex)) - 5, R(Math.min(nsy, ney)) - 5, R(Math.abs(nex - nsx)) + 10, R(Math.abs(ney - nsy)) + 10)
        limbT(s, nex, ney, hx2, hy2, 7, 6, JARL_SKIN)
        const mx = nex + (hx2 - nex) * 0.55
        const my = ney + (hy2 - ney) * 0.55
        disc(s, mx, my, 3, C.brown1) // the bracer
        px(s, R(mx) - 1, R(my) - 1, C.brown2)
        disc(s, nex + (hx2 - nex) * 0.2, ney + (hy2 - ney) * 0.2, 2, C.gold1) // the arm ring
        ball(s, hx2, hy2, 3.5, 3.5, JARL_SKIN)
        px(s, R(hx2) + 1, R(hy2) - 1, JARL_SKIN[0]) // knuckles
        finish(s, Entry.Walk, 10)
    },
    fx(dst, st, t, x, y, dir) {
        const k = fr(t, 10, 20)
        for (let i = 0; i < 5; i++) dst.set(x + dir * (-30 + ((i * 17 + k * 3) % 60)), y - 80 + ((k * 4 + i * 23) % 76), C.white)
        // frost breathing off the axe head at rest
        if (st === 'idle') for (let i = 0; i < 3; i++) dst.set(x + dir * (8 + ((k + i * 5) % 7)), y - 4 - ((k * 2 + i * 3) % 8), C.frost)
        if (st === 'attack' && B.strike) for (let i = 0; i < 12; i++) { dst.set(x + dir * (22 + i * 2), y - 1 - (i % 3), i & 1 ? C.frost : C.cyan); dst.set(x + dir * (22 + ((i * 7) % 16)), y - 3 - ((i * 5) % 9), C.white) } // shards of ice thrown up
        if (B.roar) for (let i = 0; i < 4; i++) dst.set(x + dir * (14 + i * 3), y - 56 - i, C.frost)
    }
}

/** A small snowy pine, standing on a titan's shoulder to show how big he is. */
function titanPine(s: Surface, x: number, y: number, h: number): void {
    tri(s, x - R(h * 0.35), y, x + R(h * 0.35), y, x, y - h, C.green0)
    line(s, x, y - h, x - R(h * 0.3), y - 2, C.white)
    px(s, x, y + 1, C.brown0)
}

/**
 * A crag of the titan's rock: a lumpy boulder of overlapping lobes, shaded low and to the right,
 * lit on its upper left, cracked, and dusted with snow along its top when `snow` is set.
 */
function crag(s: Surface, x: number, y: number, rx: number, ry: number, seed: number, snow: boolean, far = false): void {
    const m: Mat = far ? [C.stone0, C.stone1, C.stone2] : TITAN_ROCK
    const lobes = 3
    for (let i = 0; i < lobes; i++) {
        const lx = x + (hash2(seed, i) - 0.5) * rx * 0.8
        const ly = y + (hash2(seed + 1, i) - 0.5) * ry * 0.6
        ellipse(s, lx, ly, rx * (0.6 + hash2(seed + 2, i) * 0.3), ry * (0.6 + hash2(seed + 3, i) * 0.3), m[0])
    }
    ellipse(s, x, y, rx, ry, m[0])
    ellipse(s, x - 1, y - 1, rx - 1.5, ry - 1.5, m[1])
    ellipse(s, x - rx * 0.3, y - ry * 0.35, rx * 0.45, ry * 0.35, m[2])
    // cracks, and the light catching their upper lips
    for (let i = 0; i < 2; i++) {
        const cx0 = x + (hash2(seed + 4, i) - 0.5) * rx
        const cy0 = y + (hash2(seed + 5, i) - 0.5) * ry * 0.8
        const cx1 = cx0 + (hash2(seed + 6, i) - 0.3) * rx * 0.6
        const cy1 = cy0 + ry * 0.4
        line(s, R(cx0), R(cy0), R(cx1), R(cy1), C.ink)
        line(s, R(cx0) - 1, R(cy0), R(cx1) - 1, R(cy1), m[2])
    }
    if (snow) {
        for (let a = Math.PI * 1.1; a < Math.PI * 1.85; a += 0.08) px(s, x + Math.cos(a) * (rx - 1), y + Math.sin(a) * (ry - 1), C.white)
        for (let a = Math.PI * 1.25; a < Math.PI * 1.7; a += 0.1) px(s, x + Math.cos(a) * (rx - 2), y + Math.sin(a) * (ry - 2), C.frost)
    }
}

/**
 * A chunk of glacier ice: a slanted prism with a lit face, a mid face and a dark face, a white
 * ridge where the light catches it and a frost streak inside. `a` tilts it.
 */
function crystal(s: Surface, x: number, y: number, w: number, h: number, a: number): void {
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const T = (u: number, v: number): [number, number] => [x + u * ca - v * sa, y + u * sa + v * ca]
    const [p0x, p0y] = T(0, -h)
    const [p1x, p1y] = T(-w, -h * 0.5)
    const [p2x, p2y] = T(-w, h * 0.5)
    const [p3x, p3y] = T(0, h)
    const [p4x, p4y] = T(w, h * 0.5)
    const [p5x, p5y] = T(w, -h * 0.5)
    const [mx, my] = T(w * 0.1, -h * 0.1)
    tri(s, p0x, p0y, p1x, p1y, mx, my, C.cyan)
    tri(s, p1x, p1y, p2x, p2y, mx, my, C.cyan)
    tri(s, p2x, p2y, p3x, p3y, mx, my, C.blue2)
    tri(s, p0x, p0y, mx, my, p5x, p5y, C.blue2)
    tri(s, p5x, p5y, mx, my, p4x, p4y, C.blue1)
    tri(s, p4x, p4y, mx, my, p3x, p3y, C.blue1)
    line(s, R(p1x), R(p1y), R(p0x), R(p0y), C.white)
    line(s, R(p0x), R(p0y), R(mx), R(my), C.frost)
    const [f0x, f0y] = T(-w * 0.5, -h * 0.2)
    const [f1x, f1y] = T(-w * 0.2, h * 0.5)
    line(s, R(f0x), R(f0y), R(f1x), R(f1y), C.frost)
}

/** A hanging icicle: two pixels wide at the root, tapering to a bright tip. */
function icicle(s: Surface, x: number, y: number, len: number): void {
    line(s, x, y, x, y + len, C.cyan)
    line(s, x + 1, y, x + 1, y + R(len * 0.55), C.frost)
    px(s, x, y + len, C.white)
}

/**
 * Vinterhel, the Glacier Titan: a mountain that got up and walked. He is built of crags of rock
 * dusted with snow and crusted with chunks of glacier ice, lit from the upper left: legs of
 * stacked boulders iced at the knee, feet like snow-capped outcrops trailing icicles; a hunched
 * body of massed crag with a cavity of crystal in the chest where a cold star burns; shoulders
 * that are two snow-capped peaks with pines on them. His head is a craggy block jutting low
 * between the peaks: an overhanging brow, sockets lit cold, a knuckle of rock for a nose, a
 * crevice of a mouth and a beard of long icicles, under a crown of crystal spires. One arm hangs,
 * its fist a cluster of knuckle boulders; the other lifts elbow-first and brings it down.
 */
/** A boulder of glacier ice at (x, y), `r` across, turning with `a`: a lit face, a shaded face, snow on top. */
function iceBoulder(s: Surface, x: number, y: number, r: number, a: number): void {
    disc(s, x, y, r, C.blue1)
    disc(s, x - 1, y - 1, r - 1, C.cyan)
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    line(s, R(x - ca * r * 0.7), R(y - sa * r * 0.7), R(x + ca * r * 0.7), R(y + sa * r * 0.7), C.blue2)
    ellipse(s, x - 1, y - r * 0.6, r * 0.7, r * 0.35, C.white)
    px(s, R(x - r * 0.4), R(y - r * 0.2), C.frost)
}

/**
 * Avalanche: he rears up and brings both fists down on the ground; the mountainside answers, and
 * boulders of glacier ice and snow come crashing down onto the party out of the sky.
 */
const AVALANCHE: BossSpecial = {
    name: 'Avalanche', tint: 'night0', hits: [1.5, 1.64, 1.78, 1.92, 2.06, 2.2], spread: true,
    fx(s, t, st) {
        const q = sq(t)
        const d = st.dir
        shockRing(s, st.bx + d * 30, st.by - 1, t, 1.15, 0.6, 6, 50, C.frost, true)
        debris(s, st.bx + d * 30, st.by - 2, st.by, t, 1.15, 16, 120, 'frost', 171)
        // snow sliding down out of the sky as the mountain lets go
        if (q > 1.1 && q < 2.6) for (let i = 0; i < 40; i++) {
            const u = ((q - 1.1) * 0.9 + hash2(i, 1)) % 1
            s.set(R(st.bx - 150 + hash2(i, 2) * 170 - u * 20 * d), R(-10 + u * (st.by + 10)), i % 3 ? C.white : C.frost)
        }
        // the boulders, each falling onto one of them
        st.party.forEach((p, i) => {
            const hit = 1.5 + i * 0.14
            const u = sp(t, hit - 0.45, hit)
            if (u > 0 && u < 1) {
                const x = p.x + d * 30 * (1 - u)
                const y = p.y - 150 * (1 - u * u) - 10
                iceBoulder(s, R(x), R(y), 6 + (i % 3), q * 8 + i)
            }
            blast(s, p.x, p.y - 8, t, hit, 11, 0.6, FROST6, 181 + i, 'frost')
            debris(s, p.x, p.y - 2, p.y, t, hit, 10, 110, 'frost', 191 + i)
        })
    }
}

export const VINTERHEL: CreatureDef = {
    name: 'Vinterhel, the Glacier Titan', size: 256, shadow: 60, accent: C.cyan,
    states: withSpecial(bossStates(1.5, 2.0, 2.4), 2.8),
    special: AVALANCHE,
    draw(s, st, t) {
        drive(this, st, t, 6, 2.0)
        // a fist raised high and brought down on the ground, the mountain answering
        if (st === 'special') spAttack(0.38, 0.42, 0.58, 4)
        const x = s.ax - 4 + B.lunge - B.kb
        const y = s.ay
        const sink = R(B.die * 22)
        const hip = y - 38 + sink
        const shY = y - 80 + B.breath + sink
        const pulse = fr(t, 4, 2) === 1 || B.glow > 0.5
        const fist = (fx: number, fy: number, far: boolean, seed: number) => {
            crag(s, fx, fy, 10, 9, seed, false, far)
            for (let i = 0; i < 3; i++) crag(s, fx + 5, fy - 5 + i * 5, 4, 3.5, seed + 10 + i, false, far) // knuckles
            for (let i = 0; i < 3; i++) icicle(s, R(fx - 6 + i * 5), R(fy + 7), 3 + (i & 1) * 3)
        }

        // the far arm, hanging: shoulder, upper arm, a crystal at the elbow, forearm, fist
        crag(s, x - 38, shY + 26, 9, 12, 41, false, true)
        crystal(s, x - 42, shY + 38, 5, 6, 0.3)
        crag(s, x - 43, shY + 50, 8, 11, 42, false, true)
        fist(x - 40, shY + 64, true, 43)
        // the legs: a thigh boulder, a crystal knee, a shin boulder, a snow-capped outcrop of a foot
        for (const [lx, far, seed] of [[-18, true, 51], [18, false, 61]] as const) {
            crag(s, x + lx, hip + 6, 13, 11, seed, false, far)
            crag(s, x + lx - (far ? 1 : -1), y - 16, 11, 11, seed + 1, false, far)
            crystal(s, x + lx, hip + 17, 7, 6, far ? -0.2 : 0.2)
            crag(s, x + lx + 2, y - 5, 15, 6, seed + 2, true, far)
            for (let i = 0; i < 4; i++) icicle(s, x + lx - 9 + i * 6, y - 3, 2 + (i & 1) * 2)
        }
        // the body: massed crag from the hips to the shoulders
        crag(s, x - 2, shY + 44, 30, 16, 71, false)
        crag(s, x + 2, shY + 24, 40, 22, 72, false)
        crag(s, x - 28, shY + 18, 14, 14, 73, true)
        crag(s, x + 30, shY + 16, 14, 14, 74, true)
        // chunks of glacier crusting it
        crystal(s, x - 30, shY + 34, 8, 10, -0.4)
        crystal(s, x - 20, shY + 46, 7, 8, 0.2)
        crystal(s, x + 30, shY + 34, 9, 11, 0.5)
        crystal(s, x + 20, shY + 48, 7, 9, -0.3)
        crystal(s, x - 8, shY + 52, 6, 7, 0.1)
        // the cavity of crystal in the chest, the cold star burning in it
        const cx = x + 8
        const cy = shY + 30
        ellipse(s, cx, cy, 11, 9, C.blue0)
        for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3 + 0.2
            crystal(s, cx + Math.cos(a) * 9, cy + Math.sin(a) * 7, 3, 4, a + Math.PI / 2)
        }
        ditherEllipse(s, cx, cy, 9, 7, C.cyan, pulse ? 9 : 6)
        disc(s, cx, cy, pulse ? 4 : 3, C.frost)
        px(s, cx, cy, C.white)
        for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2 + 0.4
            line(s, cx, cy, R(cx + Math.cos(a) * (6 + (pulse ? 2 : 0))), R(cy + Math.sin(a) * (5 + (pulse ? 2 : 0))), C.white)
        }
        // the shoulders: two snow-capped peaks, rocky faces, pines growing on them
        for (const [px0, h, far] of [[-30, 32, true], [30, 36, false]] as const) {
            const bx = x + px0
            poly(s, [-19, 8, -6, -h, 3, -h + 4, 19, 8], bx, shY, far ? C.stone1 : C.stone2)
            poly(s, [-6, -h, 3, -h + 4, 19, 8, 5, 8], bx, shY, far ? C.stone0 : C.stone1)
            line(s, bx - 6, shY - h, bx - 17, shY + 6, far ? C.stone2 : C.stone3)
            line(s, bx - 1, shY - h + 10, bx + 4, shY + 4, C.ink) // a gully
            poly(s, [-10, -h + 10, -6, -h, 3, -h + 4, 7, -h + 12, 2, -h + 9, -2, -h + 13, -6, -h + 9], bx, shY, C.white)
            poly(s, [-6, -h, 3, -h + 4, 7, -h + 12, 2, -h + 9], bx, shY, C.frost)
            titanPine(s, bx - 14, shY + 4, 8)
            titanPine(s, bx + 11, shY + 3, 10)
            titanPine(s, bx + 15, shY + 6, 7)
        }

        // the head: a craggy block jutting low between the peaks
        const hx = x + 12
        const hy = shY + 2 + R(bz(0, -3, 5))
        crag(s, hx, hy, 19, 15, 81, false)
        crag(s, hx + 2, hy - 7, 18, 6, 82, true) // the brow, overhanging, snow on it
        for (const [sx0, h] of [[-12, 12], [-4, 22], [5, 18], [13, 11]] as const) crystal(s, hx + sx0, hy - 14 - h * 0.5, 3, h * 0.5, 0)
        // the sockets, lit cold, glowing out onto the rock round them
        const eye = B.hurt ? C.blue1 : B.glow > 0.5 ? C.white : C.frost
        for (const ex of [hx - 4, hx + 10]) {
            ditherEllipse(s, ex, hy - 1, 5, 3, C.cyan, 6)
            ellipse(s, ex, hy - 1, 3, 2, C.ink)
            rect(s, ex - 1, hy - 1, 3, 1, eye)
        }
        crag(s, hx + 16, hy + 3, 4, 3, 83, false) // the nose
        const gape = B.roar || B.strike ? 5 : 0
        rect(s, hx - 6, hy + 6, 20, 2 + gape, C.ink)
        if (gape) ditherEllipse(s, hx + 4, hy + 8 + (gape >> 1), 8, gape >> 1, C.cyan, 8)
        for (let i = 0; i < 9; i++) icicle(s, hx - 8 + i * 3, hy + 8 + gape, 9 + ((i * 5) % 8))

        // the near arm: raised on the wind-up, brought down on the strike
        const sx = x + 34
        const sy = shY + 12
        const a1 = bz(1.2, -1.4, 0.9)
        const a2 = B.wind > 0 ? 1.4 - 3.2 * B.wind ** 2 : a1 + bz(0.2, -1.2, 0.5)
        reach(sx, sy, a1, 30)
        const ex = P.x
        const ey = P.y
        reach(ex, ey, a2, 28)
        const hx2 = P.x
        const hy2 = P.y
        for (let i = 1; i <= 2; i++) crag(s, sx + (ex - sx) * i / 3, sy + (ey - sy) * i / 3, 10, 10, 90 + i, false)
        crystal(s, ex, ey, 7, 7, a1)
        for (let i = 1; i <= 2; i++) crag(s, ex + (hx2 - ex) * i / 3, ey + (hy2 - ey) * i / 3, 9, 9, 95 + i, false)
        fist(hx2, hy2, false, 99)
        crag(s, sx, sy, 12, 11, 89, true) // the knot of the shoulder, over the arm's root
        finish(s, Entry.Rise, 22)
    },
    fx(dst, st, t, x, y, dir) {
        const k = fr(t, 10, 20)
        // snow swirling round him
        for (let i = 0; i < 10; i++) dst.set(x + dir * (-60 + ((i * 17 + k * 3) % 120)), y - 110 + ((k * 5 + i * 23) % 106), i & 1 ? C.white : C.frost)
        if (B.roar) for (let i = 0; i < 8; i++) dst.set(x + dir * (22 + i * 3), y - 76 + ((i * 3 + k) % 5), i & 1 ? C.frost : C.white) // frost breath
        if (st === 'attack' && B.strike) {
            for (let i = 0; i < 16; i++) dst.set(x + dir * (44 + i * 2), y - (i % 4), i & 1 ? C.frost : C.white)
            for (let i = 0; i < 8; i++) dst.set(x + dir * (46 + ((i * 7) % 22)), y - 3 - ((i * 5) % 12), i & 1 ? C.cyan : C.white) // shards thrown up
        }
    }
}

// ═══════════════════════════════════════════════════════════════ 5 · Sunken Amarath

// Stage 5: Tidecaller Nerine, a drowned siren-priestess who still calls the tide, trident in one
// hand and a conch in the other. Stage 10: Queen Maerith of the Deep, the drowned empire's last
// queen, a kraken below the waist.

const SEA_SKIN: Mat = [C.teal1, C.teal2, C.teal3]
const KRAKEN: Mat = [C.purple0, C.purple1, C.purple2]
const HAIR: Mat = [C.ink, C.teal0, C.teal1]
const SEAFOAM: Mat = [C.teal3, C.frost, C.white]

/** A translucent fin trailing off a forearm from (x0, y0) to (x1, y1), hanging `drop` below it. */
function forearmFin(s: Surface, x0: number, y0: number, x1: number, y1: number, drop: number, t: number): void {
    const mx = (x0 + x1) / 2
    const my = (y0 + y1) / 2
    for (let k = 0; k < 4; k++) {
        const bx = x0 + (x1 - x0) * k / 4
        const by = y0 + (y1 - y0) * k / 4
        const tx = x0 - drop * 0.27 + k * drop * 0.18 + wv(t, 1.1, 1)
        const ty = y0 + drop + k * drop * 0.14
        tri(s, bx, by, mx, my, tx, ty, k & 1 ? C.teal2 : C.teal1)
        line(s, R(bx), R(by), R(tx), R(ty), C.cyan)
    }
    if (drop > 8) ditherEllipse(s, R(x0 + 1), R(y0 + drop * 0.8), drop * 0.36, drop * 0.27, C.frost, 4)
}

/**
 * A tapered tentacle from (x, y) setting off along `a`: it curls further toward its tip, waving
 * with `ph`, shaded along its length, suckers along its underside, a lit ridge along its top, the
 * tip shading to pink. `far` draws it darker, behind.
 */
function krakenArm(s: Surface, x: number, y: number, a: number, len: number, w: number, ph: number, curl: number, far: boolean): void {
    const m: Mat = far ? [C.void, C.purple0, C.purple1] : KRAKEN
    let cx = x
    let cy = y
    const pts: number[] = []
    for (let i = 0; i <= len; i++) {
        const u = i / len
        const ang = a + Math.sin(ph + u * 2.6) * 0.5 * u + curl * u * u
        cx += Math.cos(ang)
        cy += Math.sin(ang)
        pts.push(cx, cy, ang)
    }
    for (let i = 0; i < pts.length; i += 3) {
        const u = i / pts.length
        const r = Math.max(0.6, w * (1 - u * 0.88))
        disc(s, pts[i]!, pts[i + 1]!, r, m[0])
    }
    for (let i = 0; i < pts.length; i += 3) {
        const u = i / pts.length
        const r = Math.max(0.5, w * (1 - u * 0.88) - 1)
        disc(s, pts[i]! - 0.4, pts[i + 1]! - 0.4, r, u > 0.8 ? (far ? C.purple1 : C.pink) : m[1])
    }
    for (let i = 0; i < pts.length; i += 3) {
        const u = i / pts.length
        const r = w * (1 - u * 0.88)
        const ang = pts[i + 2]!
        // the lit ridge along the top, the suckers along the underside
        if (r > 1.5 && (i / 3) % 2 === 0) px(s, pts[i]! + Math.sin(ang) * r * 0.6, pts[i + 1]! - Math.cos(ang) * r * 0.6, m[2])
        if (r > 2 && (i / 3) % 4 === 1) {
            const sx = pts[i]! - Math.sin(ang) * r * 0.55
            const sy = pts[i + 1]! + Math.cos(ang) * r * 0.55
            px(s, sx, sy, far ? C.purple1 : C.pink)
            px(s, sx + 0.5, sy + 0.5, far ? C.void : C.purple0)
        }
    }
}

/**
 * Tidecaller Nerine, the drowned siren-priestess: a slender mermaid risen on a whirl of water, a
 * scaled tail shading from teal to blue down an S to a great translucent fluke, a pale stripe down
 * its belly; a shell bodice, a pearl necklace and a gold belt hung with pearls; long wavy hair
 * streaming back threaded with shells, a crown of branching red coral; a face in profile with gill
 * lines. One hand holds a trident of gold with curved, barbed side prongs; the other raises a
 * conch. She lifts the trident and thrusts it, calling the tide down on the front rank.
 */
/** How far ahead of the peak a breaker's lip comes down, fully curled, as a share of its height. */
const LIP_REACH = 0.12

/**
 * A breaking wave rolling toward `dir`, its peak over `fx` on the ground `gy`, `h` tall: one body of
 * water with one surface. It is built round the tube, a hollow of radius `ri` sitting on the ground
 * under the peak: behind the peak the back slopes away down to the ground; over the peak the same
 * surface carries on forward and down round the tube as the lip, thick at the peak and thinning as
 * it curls, `curl` 0 → 1 wrapping it from standing up to pitched down onto the ground ahead; the
 * back of the tube is the wave's own concave face. Filled in bands of teal by height, the inside of
 * the tube in shadow, foam along wherever the water meets open air above it.
 */
function breaker(s: Surface, fx: number, gy: number, h: number, curl: number, dir: number, q: number): void {
    if (h < 4) return
    const ri = h * (0.12 + 0.18 * curl)
    const cy = gy - ri
    const ro0 = h - ri
    const top = -Math.PI / 2
    const end = top + curl * Math.PI * 0.9
    const back = 88
    // the outer radius round the tube, thinning from the peak to the lip's tip
    const roAt = (th: number): number => {
        const u = end > top ? Math.max(0, Math.min(1, (th - top) / (end - top))) : 0
        return ro0 - (ro0 - ri - 3) * u
    }
    const water = (X: number, y: number): boolean => {
        if (y >= gy) return false
        const dy = y - cy
        const rho = Math.hypot(X, dy)
        if (rho < ri) return false // the tube
        if (X <= 0) {
            // the back: an S from the ground up to the peak, level at the top so it rolls straight
            // over into the lip, the swell running in it fading out toward the peak
            const u = -X / back
            return u <= 1 && y >= gy - h * (1 - u * u * (3 - 2 * u)) - Math.sin(X * 0.3 + q * 8) * 1.2 * Math.min(1, u * 4)
        }
        const th = Math.atan2(dy, X)
        return th >= top && th <= end && rho < roAt(th)
    }
    const inTube = (X: number, y: number): boolean => y < gy && Math.hypot(X, y - cy) < ri
    const x1 = Math.ceil(ro0 + 2)
    for (let y = Math.floor(gy - h - 2); y < gy; y++) {
        for (let X = -back; X <= x1; X++) {
            if (!water(X, y)) continue
            const v = (gy - y) / h + Math.sin(X * 0.25 - y * 0.15 + q * 6) * 0.06
            let c: number = v > 0.78 ? C.teal3 : v > 0.5 ? C.teal2 : v > 0.24 ? C.teal1 : C.teal0
            const rho = Math.hypot(X, y - cy)
            if (!water(X, y - 1) && !inTube(X, y - 1)) {
                // the surface: foam, whitest over the peak and along the lip
                c = X > -10 ? C.white : (X + Math.floor(q * 16)) % 6 === 0 ? C.white : C.frost
            } else if (rho < ri + 1.8 && y < cy + ri * 0.5) c = C.teal0 // the inside of the tube, in its own shadow
            else if (rho < ri + 3 && y < cy + ri * 0.5 && c === C.teal3) c = C.teal2
            s.set(R(fx + dir * X), y, c)
        }
    }
    // the hollow of the tube, dark where the lip closes over it
    if (curl > 0.35) {
        for (let y = Math.floor(cy - ri); y < gy; y++) {
            for (let X = Math.floor(-ri); X <= ri; X++) {
                if (!inTube(X, y) || ((X + y) & 1)) continue
                const th = Math.atan2(y - cy, X)
                if (th < end && X < ri * 0.6) s.set(R(fx + dir * X), y, C.void)
            }
        }
    }
    // spray blown off the peak and the lip's tip as it goes over
    const tr = ri + 1.5
    const tx = fx + dir * Math.cos(end) * tr
    const ty = cy + Math.sin(end) * tr
    for (let i = 0; i < 12; i++) {
        const u = ((q * 2.2 + i / 12) % 1)
        if (curl > 0.2) s.set(R(tx + dir * (u * 8 + (i % 3))), R(ty - 2 - u * 8 + (i % 4)), u < 0.5 ? C.white : C.frost)
        s.set(R(fx - dir * (i * 3 + u * 6)), R(gy - h - 2 - u * 4 + (i % 2)), u < 0.4 ? C.white : C.frost)
    }
}

/**
 * Whitewater surging out from where a wave broke at `x` on the ground `gy`, `age` 0..1: a band of
 * foam racing on ahead, its top boiling in lumps of white over the teal of the water under it, a
 * thin sheet of water running out in front, thinning and breaking into holes as it spreads.
 */
function whitewater(s: Surface, x: number, gy: number, dir: number, age: number, q: number): void {
    if (age <= 0 || age >= 1) return
    // it surges on past the break and back across what it broke over
    const front = x + dir * (10 + 50 * (1 - (1 - age) * (1 - age)))
    const back = x - dir * (18 + 46 * (1 - (1 - age) * (1 - age)))
    const peak = 24 * Math.pow(1 - age, 0.8)
    const f = Math.floor(q * 14)
    const n = Math.abs(front - back)
    // the sheet running out ahead of it
    line(s, R(front), gy - 1, R(front + dir * 12 * (1 - age)), gy - 1, C.teal3)
    for (let k = 0; k <= n; k += 3) {
        const u = k / n
        const xx = back + dir * k
        // highest just behind the front, where it is still breaking, lumps boiling frame to frame
        const h = peak * (0.3 + 0.7 * Math.sin(u * Math.PI)) * (0.7 + 0.3 * hash2(k, f))
        const r = 2 + h * 0.32
        const cy = gy - h * 0.55
        disc(s, xx, cy + r * 0.5, r, C.teal2)
        disc(s, xx, cy, r * 0.85, age < 0.55 ? C.white : C.frost)
        disc(s, xx + 1, cy + r * 0.3, r * 0.45, C.frost)
        if (age > 0.45 && hash2(k, f + 3) < (age - 0.4) * 1.6) disc(s, xx, cy + 1, r * 0.4, C.teal2) // breaking into holes
        if (hash2(k, f + 7) < 0.3) s.set(R(xx), R(cy - r - 1), C.white) // spray off the top
    }
}

/**
 * Siren's Call: she lifts the conch to her lips and sounds it; the sea answers, and a great wave
 * rises behind her and waits; she flicks the trident at the party and on that beat it sets off,
 * rolling on over the plaza and over the party, and breaks just past them: its
 * lip pitches down, a sheet of spray bursts up where it lands, and the wave collapses into
 * whitewater that surges back across them all.
 */
const SIRENS_CALL: BossSpecial = {
    name: 'Siren\'s Call', tint: 'night0', hits: [2.16, 2.22, 2.28, 2.34, 2.4, 2.46], spread: true,
    fx(s, t, st) {
        const q = sq(t)
        const d = st.dir
        // the call rolling out of the conch
        for (let r = 0; r < 3; r++) shockRing(s, st.bx + d * 6, st.by - 50, t, 0.4 + r * 0.18, 0.5, 3, 22, C.teal3)
        const gy = Math.max(...st.party.map(p => p.y)) + 2
        const H = 58
        // it waits risen behind her until she flicks the trident at `go`, and sets off on that beat
        const go = 1.12
        const crash = 2.15
        // it rolls over the party and breaks just past the back row, the crest standing short of
        // that by the lip's reach, so the whitewater starts where the lip's tip comes down
        const far = st.party[st.party.length - 1]!.x
        const land = far + d * 8
        const crestAt = land - d * H * LIP_REACH
        if (q > 0.7 && q < crash + 0.35) {
            const rise = sp(t, 0.6, 1.1)
            const roll = sp(t, go, crash)
            const fx = st.bx - d * 26 + (crestAt - (st.bx - d * 26)) * sm(roll)
            const curl = sp(t, go + 0.5, crash)
            const fall = sp(t, crash, crash + 0.35)
            // once it has broken the wave sinks into its own whitewater, the lip lying pitched on the ground
            breaker(s, fx, gy, H * rise * (1 - fall), curl, d, q)
        }
        // the break: a sheet of spray bursting up where it lands, thrown water falling back, the
        // whitewater surging back across them
        const age = sp(t, crash, crash + 1.0)
        if (age > 0 && age < 0.7) {
            const lift = Math.sin(Math.min(1, age / 0.25) * Math.PI / 2) * (1 - Math.max(0, age - 0.25) / 0.45)
            for (let i = 0; i < 16; i++) {
                const off = (i - 7.5) * 2.2
                const h = lift * (26 + hash2(i, 5) * 22) * (1 - Math.abs(off) / 22)
                const lean = off * 0.5 - d * 3
                const top = gy - 4 - h
                line(s, R(land + off), gy - 4, R(land + off + lean), R(top), i & 1 ? C.frost : C.teal3)
                s.set(R(land + off + lean), R(top), C.white)
                s.set(R(land + off + lean * 1.2), R(top - 2 - hash2(i, 6) * 4), C.white)
            }
        }
        debris(s, land, gy - 10, gy, t, crash + 0.1, 40, 220, 'water', 251, 1.1)
        debris(s, land + d * 8, gy - 6, gy, t, crash + 0.18, 20, 150, 'water', 252, 0.9)
        whitewater(s, land, gy, d, age, q)
        st.party.forEach((p, i) => {
            // each of them struck by the water: a splash thrown up off them, foam ringing their feet
            const t0 = 2.16 + i * 0.06
            debris(s, p.x, chest(p), p.y, t, t0, 10, 110, 'water', 201 + i, 0.6)
            shockRing(s, p.x, p.y - 1, t, t0, 0.4, 3, 12, C.white, true)
        })
    }
}

export const TIDECALLER_NERINE: CreatureDef = {
    name: 'Tidecaller Nerine', size: 96, shadow: 0, accent: C.teal3,
    // for the trident thrust at the front rank, and the wave it rolls out
    room: 16,
    states: withSpecial(bossStates(1.2, 1.6, 2.0), 3.3),
    special: SIRENS_CALL,
    draw(s, st, t) {
        drive(this, st, t, 8, 1.6)
        if (st === 'special') {
            // the conch raised to her lips and sounded, then the trident thrust with the wave
            // the conch sounded first; then the trident drawn back and flicked at the party at 1.12 s,
            // the beat the wave sets off on, and held there while it rolls
            spAttack(0.34, 0.37, 0.5, 4)
            B.roar = B.sp > 0.09 && B.sp < 0.27
            if (B.sp < 0.27) { B.wind = 0; B.lunge = 0; B.glow = 0 } else if (B.sp < 0.34) B.wind = sm((B.sp - 0.27) / 0.07)
        }
        const x = s.ax - 4 + B.lunge - B.kb
        const y = s.ay
        const float = -8 + wv(t, 1.6, 2) + R(B.die * 14)
        const hip = y - 30 + float
        const top = hip - 18
        const ph = q(t) * 3
        const flick = wv(t, 0.8, 2)

        // seafoam-white hair billowing up and back in the water, shells and pearls threaded through it
        ellipse(s, x - 2, top - 9, 7, 6, SEAFOAM[0])
        for (let i = 0; i < 4; i++) {
            const sway = Math.sin(ph + i * 1.4) * 3
            const ex = x - 16 - i * 5 + sway
            const ey = top - 24 + i * 7 - sway
            chain(s, x - 1, top - 10 + i * 2, x - 6 - i * 3 + sway, top - 20 + i * 2, ex, ey, 5 - i * 0.5, 1, SEAFOAM, 24)
            if (i === 1) { disc(s, R((x + ex) / 2 - 3), R((top + ey) / 2 - 6), 1.5, C.pink); px(s, R((x + ex) / 2 - 3), R((top + ey) / 2 - 7), C.white) }
            if (i === 3) px(s, R((x + ex) / 2 - 2), R((top + ey) / 2 - 4), C.teal2)
        }
        // the tail: an S from the hips to the fluke, scaled, shading teal to blue, a pale belly
        const tx0 = x
        const ty0 = hip
        const tcx = x - 20
        const tcy = y - 8 + float
        const tx1 = x + 6
        const ty1 = y - 4 + float
        for (let i = 0; i <= 22; i++) {
            const u = i / 22
            bez(tx0, ty0, tcx, tcy, tx1, ty1, u)
            const r = 7 - u * 4
            disc(s, P.x, P.y, r, u < 0.5 ? C.teal1 : C.blue1)
        }
        for (let i = 0; i <= 22; i++) {
            const u = i / 22
            bez(tx0, ty0, tcx, tcy, tx1, ty1, u)
            const r = 7 - u * 4
            disc(s, P.x - 0.5, P.y - 0.5, r - 1, u < 0.5 ? C.teal2 : C.blue2)
            if (i % 2 === 0 && r > 3) { px(s, P.x - r * 0.3, P.y - r * 0.5, u < 0.5 ? C.teal3 : C.cyan); px(s, P.x + r * 0.2, P.y - r * 0.2, u < 0.5 ? C.teal1 : C.blue1) } // scales
            if (r > 3) px(s, P.x + r * 0.5, P.y + r * 0.5, C.teal3) // the pale belly
        }
        // the fluke, translucent, ribbed with rays
        const fx = tx1 + 2
        const fy = ty1
        for (const [dy, len] of [[-1, 12], [1, 11]] as const) {
            for (let k = 0; k < 6; k++) {
                const a = -0.3 * dy + (k - 2.5) * 0.18 * dy + flick * 0.05
                const ex = fx + Math.cos(a) * len
                const ey = fy + Math.sin(a) * len * 0.9 + dy * k * 1.4
                line(s, fx, fy, R(ex), R(ey), k & 1 ? C.cyan : C.teal3)
            }
        }
        ditherEllipse(s, fx + 6, fy, 7, 8, C.frost, 5)
        // the far arm raising the conch
        const conchUp = B.roar ? 1 : 0.3
        const cx = x - 6
        const cy = top + 8 - R(conchUp * 8)
        elbow(x - 5, top + 3, cx, cy, 7, 7, -1)
        limbT(s, x - 5, top + 3, P.x, P.y, 3, 3, [C.teal1, C.teal1, C.teal2])
        forearmFin(s, P.x, P.y, cx, cy, 6, t)
        limbT(s, P.x, P.y, cx, cy, 3, 2.5, [C.teal1, C.teal1, C.teal2])
        poly(s, [0, -4, 5, -1, 3, 4, -2, 3, -3, 0], cx - 3, cy, C.bone1)
        line(s, cx - 3, cy - 3, cx + 1, cy + 3, C.pink)
        px(s, cx + 2, cy - 1, C.white)
        // the torso: a slender waist up to the shoulders, the shell bodice, pearls, the gold belt
        chain(s, x, hip, x - 1, top + 12, x + 1, top + 2, 6, 7, SEA_SKIN, 10)
        for (const [sx, lit] of [[x, false], [x + 5, true]] as const) {
            ellipse(s, sx, top + 7, 3, 2.5, lit ? C.pink : C.purple2)
            for (let k = 0; k < 3; k++) line(s, sx, top + 9, sx - 2 + k * 2, top + 5, lit ? C.white : C.pink)
            px(s, sx, top + 9, C.bone1)
        }
        line(s, x, top + 5, x + 5, top + 5, C.gold2) // the chain between the shells
        line(s, x - 3, top + 3, x + 6, top + 4, C.gold1)
        for (let i = 0; i < 6; i++) px(s, x - 3 + i * 2, top + 3 + (i === 0 || i === 5 ? 0 : 1), C.white)
        disc(s, x + 2, top + 5, 1.2, C.cyan); px(s, x + 2, top + 5, C.white) // the pendant
        for (let i = 0; i < 4; i++) px(s, x - 3 + i, top + 1 - (i >> 1), C.frost); for (let i = 0; i < 3; i++) px(s, x + 4 + i, top + 1, C.frost) // the light from above on her shoulders
        rect(s, x - 6, hip - 3, 13, 2, C.gold1)
        rect(s, x - 6, hip - 3, 13, 1, C.gold2)
        for (let i = 0; i < 3; i++) line(s, x - 4 + i * 4, hip - 1, x - 4 + i * 4, hip + 2 + (i & 1), C.white) // pearl strands
        // the head: a face in profile, gill lines, eyes under a dark lash, the coral crown
        // the head: larger, a clear face lit from the water above, a fin for an ear, glowing eyes
        const hx = x + 2
        const hy = top - 2
        for (let k = 0; k < 4; k++) {
            const a = -Math.PI * (0.6 + k * 0.11) + Math.sin(ph + k) * 0.06
            tri(s, hx - 3, hy - 6, R(hx - 3 + Math.cos(a) * 8), R(hy - 6 + Math.sin(a) * 8), R(hx - 3 + Math.cos(a + 0.35) * 6), R(hy - 6 + Math.sin(a + 0.35) * 6), k & 1 ? C.teal2 : C.teal1)
            line(s, hx - 3, hy - 6, R(hx - 3 + Math.cos(a) * 8), R(hy - 6 + Math.sin(a) * 8), C.cyan)
        }
        ball(s, hx, hy - 6, 7, 7, SEA_SKIN)
        ellipse(s, hx + 3, hy - 7, 4, 5, C.teal3) // the lit face
        for (let i = 0; i < 6; i++) {
            const a = -Math.PI * (0.3 + i * 0.09)
            px(s, R(hx + Math.cos(a) * 6.5), R(hy - 6 + Math.sin(a) * 7), C.frost)
        }
        ellipse(s, hx - 4, hy - 11, 4, 2, C.frost) // the seafoam hair swept back off her brow
        line(s, hx - 7, hy - 10, hx - 1, hy - 13, C.white)
        px(s, hx + 7, hy - 6, C.teal3); px(s, hx + 7, hy - 5, C.teal2) // the nose
        const eye = B.hurt ? C.ink : B.glow > 0.5 ? C.white : C.cyan
        if (!B.hurt) ditherDisc(s, hx + 4, hy - 8, 4, C.cyan, 4 + R(B.glow * 5))
        ellipse(s, hx + 4, hy - 8, 2.5, 1.5, C.ink)
        rect(s, hx + 3, hy - 9, 3, 2, eye)
        if (!B.hurt) px(s, hx + 4, hy - 9, C.white)
        line(s, hx + 2, hy - 11, hx + 6, hy - 10, C.teal0) // the brow
        if (B.roar || B.strike) {
            rect(s, hx + 4, hy - 3, 3, 2, C.ink)
            px(s, hx + 4, hy - 3, C.white); px(s, hx + 6, hy - 3, C.white)
        } else {
            line(s, hx + 4, hy - 3, hx + 6, hy - 3, C.teal0)
            px(s, hx + 5, hy - 2, C.red2)
        }
        for (let i = 0; i < 3; i++) line(s, hx - 2, hy - 7 + i * 2, hx - 1, hy - 6 + i * 2, C.teal0) // gills
        // the crown of branching red coral, pearls caught in it
        for (let i = 0; i < 5; i++) {
            const bx = hx - 5 + i * 2.5
            const h = i === 2 ? 14 : i & 1 ? 11 : 8
            const tx = bx + (i - 2) * 1.5
            line(s, R(bx), hy - 12, R(tx), hy - 12 - h, C.red2)
            line(s, R((bx + tx) / 2), hy - 12 - R(h / 2), R((bx + tx) / 2 + (i < 2 ? -3 : 3)), hy - 14 - R(h / 2), C.red2)
            px(s, R(tx), hy - 13 - h, C.red3)
            px(s, R((bx + tx) / 2 + (i < 2 ? -3 : 3)), hy - 15 - R(h / 2), C.red3)
        }
        line(s, hx - 5, hy - 12, hx + 5, hy - 12, C.red1)
        disc(s, hx, hy - 13, 1.2, C.white)
        // the near arm and the trident: raised on the wind-up, thrust on the strike
        const a = bz(-1.3, -2.1, -0.1)
        const gx = x + 9 + R(bz(0, -3, 8))
        const gy = top + 10 + R(bz(0, -8, -4))
        elbow(x + 5, top + 3, gx, gy, 7, 7, 1)
        limbT(s, x + 5, top + 3, P.x, P.y, 3, 3, SEA_SKIN)
        forearmFin(s, P.x, P.y, gx, gy, 7, t)
        limbT(s, P.x, P.y, gx, gy, 3, 2.5, SEA_SKIN)
        const dx = Math.cos(a)
        const dy = Math.sin(a)
        const nx = -dy
        const ny = dx
        line(s, R(gx - dx * 12), R(gy - dy * 12), R(gx + dx * 22), R(gy + dy * 22), C.gold1, 2)
        line(s, R(gx - dx * 12 + nx), R(gy - dy * 12 + ny), R(gx + dx * 22 + nx), R(gy + dy * 22 + ny), C.gold2)
        const ex = gx + dx * 22
        const ey = gy + dy * 22
        disc(s, ex, ey, 1.8, C.white) // the pearl at the socket
        line(s, R(ex - nx * 5), R(ey - ny * 5), R(ex + nx * 5), R(ey + ny * 5), C.gold2, 2)
        line(s, R(ex), R(ey), R(ex + dx * 11), R(ey + dy * 11), C.gold3, 2) // the centre spear
        for (const d of [-1, 1]) {
            // a side prong curving out and in again, barbed
            const bx = ex + nx * 5 * d
            const by = ey + ny * 5 * d
            const mx = bx + dx * 5 + nx * d * 1.5
            const my = by + dy * 5 + ny * d * 1.5
            line(s, R(bx), R(by), R(mx), R(my), C.gold2)
            line(s, R(mx), R(my), R(mx + dx * 4 - nx * d), R(my + dy * 4 - ny * d), C.gold2)
            px(s, R(mx + dx * 4 - nx * d), R(my + dy * 4 - ny * d), C.white)
            px(s, R(mx - nx * d), R(my - ny * d), C.gold1) // the barb
        }
        px(s, R(ex + dx * 11), R(ey + dy * 11), C.white)
        ball(s, gx, gy, 2, 2, SEA_SKIN)
        finish(s, Entry.Rise, 0)
    },
    fx(dst, st, t, x, y, dir) {
        // the whirl of water she rises on
        const k = fr(t, 10, 8)
        ditherEllipse(dst, x, y - 1, 22, 2, C.teal0, 16)
        for (let i = 0; i < 20; i++) {
            const a = (i / 20) * Math.PI * 2 + k * 0.4
            const r = 5 + (i % 10) * 2
            dst.set(x + R(Math.cos(a) * r), y - 3 - (i % 5) * 2 + R(Math.sin(a) * r * 0.2), i & 1 ? C.teal3 : C.cyan)
        }
        if ((st === 'attack' && B.strike) || B.roar) {
            // the tide she calls: a wave rolling out at the front rank
            for (let i = 0; i < 18; i++) {
                const h = R(Math.sin(i / 17 * Math.PI) * 10)
                dst.set(x + dir * (30 + i * 2), y - 2 - h, i & 1 ? C.white : C.teal3)
                dst.set(x + dir * (30 + i * 2), y - 1 - h + 2, C.teal2)
            }
        }
    }
}

/**
 * Queen Maerith of the Deep, the drowned empire's last queen: a kraken below the waist, eight
 * great tentacles sprawled across the plaza, spotted and suckered, shading to pink at the tips,
 * the far ones reaching off past the edge of the screen. From the mantle she rises regal: a gown
 * of kelp under a bodice of drowned gold set with pearls, pauldrons of shell, a long neck; hair
 * floating up round her in the water, black-green, threaded with pearls; a tall crown of gold
 * with pearl and coral spikes; large eyes lit from within. She holds a pearl sceptre; every
 * tentacle stays low on the floor, and the forward one is her whip, coiled back and lashed out
 * along the ground at the front rank with a crack at its tip.
 */
/**
 * Kraken's Embrace: she draws her arms back, and tentacles burst up out of the plaza under every
 * one of the party, coil round them and squeeze, then whip down and slam them into the stones.
 */
const KRAKENS_EMBRACE: BossSpecial = {
    name: 'Kraken\'s Embrace', tint: 'night0', hits: [1.3, 1.38, 1.46, 1.54, 1.62, 1.7], spread: true,
    fx(s, t, st) {
        const q = sq(t)
        st.party.forEach((p, i) => {
            const t0 = 0.95 + i * 0.07
            const rise = sp(t, t0, t0 + 0.3)
            if (rise <= 0 || q > 2.6) return
            const slam = sp(t, 1.95, 2.1)
            const sink = sp(t, 2.3, 2.6)
            const side = i & 1 ? -1 : 1
            // the tentacle rising beside them and curling over and round them, then whipping down
            const len = R((10 + 26 * rise) * (1 - sink))
            const a = -Math.PI / 2 - side * (0.2 + slam * 1.2)
            if (len > 2) krakenArm(s, p.x + side * 7, p.y, a, len, 5, q * 4 + i, side * (2.6 - slam * 2.2), false)
            pit(s, p.x + side * 7, p.y, 5, C.ink, C.teal0)
            if (rise > 0 && q < t0 + 0.2) debris(s, p.x + side * 7, p.y - 2, p.y, t, t0, 6, 80, 'water', 221 + i, 0.5)
            blast(s, p.x, chest(p), t, 1.3 + i * 0.08, 6, 0.4, WATER6, 231 + i, 'water')
            // the slam: water and stone thrown up where they come down
            blast(s, p.x, p.y - 3, t, 2.08, 9, 0.5, WATER6, 241 + i, 'water', true)
        })
        const f = st.party[0]!
        shockRing(s, f.x, f.y - 1, t, 2.08, 0.5, 4, 36, C.white, true)
    }
}

/** The water she rises out of, spread across the plaza. */
const MAERITH_POOL: Pool = { dx: 0, rx: 56, ry: 3 }

export const QUEEN_MAERITH: CreatureDef = {
    name: 'Queen Maerith of the Deep', size: 256, shadow: 0, accent: C.teal3,
    states: withSpecial(bossStates(1.5, 2.0, 2.4), 2.8),
    special: KRAKENS_EMBRACE,
    draw(s, st, t) {
        drive(this, st, t, 6, 2.0)
        // arms drawn back as her tentacles rise under the party, flung open as they slam
        if (st === 'special') spAttack(0.66, 0.72, 0.84, 4)
        const x = s.ax - 2 + B.lunge - B.kb
        const y = s.ay
        const ph = q(t) * 2.2
        const sink = R(B.die * 30)
        const mantleY = y - 26 + sink + B.breath
        const top = y - 78 + B.breath + sink

        // the far tentacles, sprawled back along the floor, tips curling up
        krakenArm(s, x - 14, mantleY + 12, Math.PI * 0.98, 72, 9, ph, 1.2, true)
        krakenArm(s, x - 6, mantleY + 14, Math.PI * 0.88, 58, 8, ph + 1, -1.0, true)
        krakenArm(s, x + 10, mantleY + 14, Math.PI * 0.04, 54, 8, ph + 2, -1.3, true)
        const wx = x + 1
        // hair billowing up and back in the water in heavy locks, lit from above, pearls in it
        ellipse(s, wx - 8, top - 14, 13, 11, HAIR[0])
        for (let i = 0; i < 5; i++) {
            const sway = Math.sin(ph + i * 1.3) * 4
            const ex = wx - 34 - i * 8 + sway
            const ey = top - 42 + i * 9 - sway
            chain(s, wx - 2, top - 10 + i * 2, wx - 10 - i * 6 + sway, top - 34 + i * 3, ex, ey, 9 - i * 0.7, 1, HAIR, 36)
            if (i < 3) px(s, R(wx - 10 - i * 3), R(top - 30 + i * 5), C.frost) // the light from above on the top locks
            if (i % 2 === 0) { disc(s, R((wx + ex) / 2 - 6), R((top + ey) / 2 - 12), 1.2, C.white); px(s, R((wx + ex) / 2 - 6), R((top + ey) / 2 - 13), C.frost) }
        }
        // the collar of fins fanning out behind her head and shoulders: kraken-purple webbing on
        // pink rays, the spine tips bright, so her teal head reads against it
        const cx0 = wx - 1
        const cy0 = top + 8
        const rays: number[] = []
        for (let k = 0; k <= 10; k++) {
            const a = -Math.PI * (0.02 + k * 0.096)
            const len = 38 + (k & 1 ? 4 : 0) + Math.sin(ph + k * 0.8) * 2 + R(B.glow * 3)
            rays.push(cx0 + Math.cos(a) * len, cy0 + Math.sin(a) * len * 0.95)
        }
        for (let k = 0; k < 10; k++) {
            const [ax, ay, bx, by] = [rays[k * 2]!, rays[k * 2 + 1]!, rays[k * 2 + 2]!, rays[k * 2 + 3]!]
            // the web sags between the spines
            const mx = (ax + bx) / 2 + (cx0 - (ax + bx) / 2) * 0.16
            const my = (ay + by) / 2 + (cy0 - (ay + by) / 2) * 0.16
            tri(s, cx0, cy0, ax, ay, mx, my, k & 1 ? C.purple1 : C.purple0)
            tri(s, cx0, cy0, mx, my, bx, by, k & 1 ? C.purple1 : C.purple0)
            ditherEllipse(s, R(mx * 0.75 + cx0 * 0.25), R(my * 0.75 + cy0 * 0.25), 4, 3, C.purple2, 6)
        }
        for (let k = 0; k <= 10; k++) {
            const ax = rays[k * 2]!
            const ay = rays[k * 2 + 1]!
            line(s, cx0, cy0, R(ax), R(ay), C.pink)
            px(s, R(ax), R(ay), C.white)
            px(s, R(ax + (ax - cx0) * 0.04), R(ay + (ay - cy0) * 0.04), B.glow > 0.5 ? C.white : C.cyan)
        }
        // the mantle: the kraken's body under her, spotted, its underside paler
        ellipse(s, x, mantleY + 6, 32, 18, KRAKEN[0])
        ellipse(s, x - 1, mantleY + 4, 30, 16, KRAKEN[1])
        ellipse(s, x - 9, mantleY - 2, 14, 6, KRAKEN[2])
        ellipse(s, x + 4, mantleY + 16, 22, 4, C.pink)
        for (let i = 0; i < 12; i++) disc(s, x - 24 + i * 4, mantleY + ((i * 7) % 5) * 3 - 2, (i & 1) + 0.8, C.purple0)
        // the near tentacles, curling forward and back across the plaza
        krakenArm(s, x - 16, mantleY + 16, Math.PI * 0.92, 50, 10, ph + 3, 1.5, false)
        // The whip: the forward tentacle, kept low on the floor like the rest. It coils back on the
        // wind-up and lashes out straight along the ground at the front rank, a wave running down
        // it, then curls back to rest.
        // the lash is full on the strike frame itself, so the crack lands with the tip
        const lash = B.strike ? 1 : B.wind > 0 ? 0 : B.rec
        const coil = B.strike ? 0 : B.wind
        const whipLen = R(58 - 18 * coil + 22 * lash)
        const whipCurl = -1.4 - 1.8 * coil + 1.25 * lash
        const whipWave = lash > 0 ? ph * 6 : ph + 4
        krakenArm(s, x + 16, mantleY + 16, Math.PI * (0.06 + 0.06 * coil - 0.06 * lash), whipLen, 10, whipWave, whipCurl, false)
        krakenArm(s, x + 4, mantleY + 18, Math.PI * 0.28, 36, 9, ph + 5, -2.2, false)
        // the skirt of kelp flaring from her waist over the mantle, the bodice of gold above it
        poly(s, [-8, 0, 8, 0, 22, 22, 8, 26, -6, 24, -22, 22], wx, top + 34, C.green1)
        poly(s, [-8, 0, -3, 0, -8, 25, -22, 22], wx, top + 34, C.green0)
        for (let i = 0; i < 9; i++) {
            const fx = wx - 20 + i * 5
            line(s, R(wx - 6 + i * 1.5), top + 36, fx, top + 58 + (i & 1) * 3, i & 1 ? C.green2 : C.green1)
            px(s, fx, top + 59 + (i & 1) * 3, C.green2)
        }
        // the waist and a broad torso, the bodice of drowned gold set with pearls
        chain(s, wx, top + 36, wx - 1, top + 26, wx, top + 14, 8, 12, SEA_SKIN, 8)
        poly(s, [-15, 0, 15, 0, 11, 18, 0, 22, -11, 18], wx, top + 14, C.gold1)
        poly(s, [-15, 0, -6, 0, -6, 21, -11, 18], wx, top + 14, C.gold0)
        line(s, wx - 14, top + 15, wx + 14, top + 15, C.gold2)
        line(s, wx + 3, top + 17, wx + 10, top + 29, C.gold2) // the lit edge of the plate
        for (let i = 0; i < 8; i++) px(s, wx - 10 + i * 3, top + 19 + (i & 1) * 3, C.white)
        const jewel = B.glow > 0.5 ? C.white : C.cyan
        disc(s, wx + 1, top + 27, 3.5, C.teal1); disc(s, wx + 1, top + 27, 2.5, C.teal3); px(s, wx, top + 26, jewel); px(s, wx + 1, top + 26, C.white)
        // the far arm holding the pearl sceptre upright
        elbow(wx - 15, top + 16, wx - 22, top + 34, 11, 11, -1)
        limbT(s, wx - 15, top + 16, P.x, P.y, 6, 5, [C.teal0, C.teal1, C.teal2])
        limbT(s, P.x, P.y, wx - 22, top + 34, 5, 4, [C.teal0, C.teal1, C.teal2])
        line(s, wx - 23, top + 50, wx - 24, top + 4, C.gold1, 2)
        line(s, wx - 22, top + 50, wx - 23, top + 4, C.gold2)
        disc(s, wx - 24, top + 1, 4, C.white)
        disc(s, wx - 25, top, 2, C.frost)
        for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; px(s, R(wx - 24 + Math.cos(a) * 6), R(top + 1 + Math.sin(a) * 6), C.gold2) }
        // scallop shells for pauldrons, ridges fanning out from the hinge, the near one lit from above
        for (const [sxo, far] of [[-14, true], [14, false]] as const) {
            const px0 = wx + sxo
            const py0 = top + 18
            for (let k = 0; k < 8; k++) {
                const a = -Math.PI * (0.1 + k * 0.115)
                const ex = px0 + Math.cos(a) * 11
                const ey = py0 + Math.sin(a) * 9
                tri(s, px0, py0, ex, ey, px0 + Math.cos(a - 0.13) * 11, py0 + Math.sin(a - 0.13) * 9, far ? C.bone0 : k & 1 ? C.bone1 : C.white)
                line(s, px0, py0, R(ex), R(ey), far ? C.brown2 : C.pink)
                if (!far && k > 1 && k < 6) px(s, R(ex), R(ey) - 1, C.frost)
            }
            rect(s, px0 - 3, py0 - 1, 7, 2, far ? C.bone0 : C.bone1) // the hinge
        }
        // the neck, gill slits down its side
        rect(s, wx - 3, top + 2, 8, 13, C.teal2)
        rect(s, wx + 2, top + 2, 3, 13, C.teal3)
        for (let i = 0; i < 3; i++) line(s, wx - 2, top + 5 + i * 3, wx, top + 6 + i * 3, C.teal0)
        // the head: large, lit from the water above, a fin for an ear, eyes burning through a halo
        const hx = wx + 2
        const hy = top + 2
        // the ear fin, behind the cheek
        for (let k = 0; k < 5; k++) {
            const a = -Math.PI * (0.62 + k * 0.1) + Math.sin(ph + k) * 0.05
            tri(s, hx - 5, hy - 9, R(hx - 5 + Math.cos(a) * 11), R(hy - 9 + Math.sin(a) * 11), R(hx - 5 + Math.cos(a + 0.3) * 9), R(hy - 9 + Math.sin(a + 0.3) * 9), k & 1 ? C.teal2 : C.teal1)
            line(s, hx - 5, hy - 9, R(hx - 5 + Math.cos(a) * 11), R(hy - 9 + Math.sin(a) * 11), C.cyan)
        }
        ball(s, hx, hy - 9, 12, 13, SEA_SKIN)
        ellipse(s, hx + 5, hy - 10, 6, 8, C.teal3) // the lit face
        for (let i = 0; i < 9; i++) {
            // the rim of light from the water above, round the crown of the head
            const a = -Math.PI * (0.25 + i * 0.07)
            px(s, R(hx + Math.cos(a) * 11), R(hy - 9 + Math.sin(a) * 12), C.frost)
        }
        px(s, hx + 12, hy - 9, C.teal3); px(s, hx + 12, hy - 8, C.teal2); px(s, hx + 11, hy - 7, C.teal2) // the nose
        const eye = B.hurt ? C.ink : B.glow > 0.5 ? C.white : C.cyan
        if (!B.hurt) ditherDisc(s, hx + 7, hy - 12, 6, C.cyan, 5 + R(B.glow * 5))
        ellipse(s, hx + 7, hy - 12, 3.5, 2, C.ink)
        rect(s, hx + 5, hy - 13, 5, 2, eye)
        if (!B.hurt) rect(s, hx + 7, hy - 13, 2, 2, C.white)
        line(s, hx + 3, hy - 15, hx + 10, hy - 14, C.teal0) // the brow, drawn down
        line(s, hx + 4, hy - 16, hx + 9, hy - 16, C.teal1)
        // the lips, parted on the strike and the roar, needle teeth
        if (B.roar || B.strike) {
            rect(s, hx + 6, hy - 4, 5, 3, C.ink)
            for (let i = 0; i < 3; i++) px(s, hx + 6 + i * 2, hy - 4, C.white)
            line(s, hx + 6, hy - 1, hx + 10, hy - 1, C.red2)
        } else {
            line(s, hx + 6, hy - 4, hx + 10, hy - 4, C.teal0)
            line(s, hx + 7, hy - 3, hx + 9, hy - 3, C.red2)
            px(s, hx + 8, hy - 3, C.pink)
        }
        for (let i = 0; i < 3; i++) line(s, hx - 3, hy - 9 + i * 3, hx, hy - 7 + i * 3, C.teal0) // gills
        // the crown: tall, gold, spiked with pearls and branching red coral
        rect(s, hx - 11, hy - 22, 23, 4, C.gold1)
        rect(s, hx - 11, hy - 22, 23, 1, C.gold2)
        for (let i = 0; i < 4; i++) px(s, hx - 8 + i * 6, hy - 20, C.white)
        for (let i = 0; i < 7; i++) {
            const cx = hx - 10 + i * 3.4
            const h = i === 3 ? 15 : i & 1 ? 11 : 7
            tri(s, cx - 1.5, hy - 22, cx + 1.5, hy - 22, cx, hy - 22 - h, i === 3 ? C.gold3 : C.gold2)
            line(s, R(cx - 1), hy - 23, R(cx), hy - 21 - h, C.gold1)
            px(s, R(cx), hy - 22 - h, i === 3 ? C.white : i & 1 ? C.white : C.red3)
        }
        for (const d of [-1, 1]) {
            // coral branching off the crown's sides
            const bx = hx + d * 11
            line(s, bx, hy - 21, bx + d * 5, hy - 28, C.red2)
            line(s, bx + d * 2, hy - 24, bx + d * 7, hy - 25, C.red2)
            px(s, bx + d * 5, hy - 29, C.red3); px(s, bx + d * 7, hy - 26, C.red3)
        }
        disc(s, hx, hy - 20, 2, C.teal3); px(s, hx - 1, hy - 21, C.white)
        // the near arm reaching out at the party, a fin trailing off the forearm, a clawed hand:
        // drawn back on the wind-up and flung open on the lash
        const sx = wx + 14
        const sy = top + 17
        const hax = wx + 32 + R(bz(0, -10, 8))
        const hay = top + 30 + B.breath + R(bz(0, -18, -6))
        elbow(sx, sy, hax, hay, 13, 13, 1)
        const ex = P.x
        const ey = P.y
        limbT(s, sx, sy, ex, ey, 6, 5, SEA_SKIN)
        forearmFin(s, ex, ey, hax, hay, 11, t)
        limbT(s, ex, ey, hax, hay, 5, 4, SEA_SKIN)
        ball(s, hax, hay, 4, 4, SEA_SKIN)
        const da = Math.atan2(hay - ey, hax - ex)
        const open = B.strike ? 0.35 : B.wind > 0 ? -0.1 : 0.15
        for (let k = 0; k < 4; k++) {
            // the fingers, long and jointed, hooked claws at their tips
            const a = da - 0.65 + k * (0.38 + open * 0.3)
            const jx = hax + Math.cos(a) * 5
            const jy = hay + Math.sin(a) * 5
            const tx = jx + Math.cos(a + 0.5) * 4
            const ty = jy + Math.sin(a + 0.5) * 4
            line(s, R(hax), R(hay), R(jx), R(jy), C.teal2, k === 0 ? 1 : 2)
            line(s, R(jx), R(jy), R(tx), R(ty), C.teal2)
            px(s, R(tx), R(ty), C.bone1)
            px(s, R(tx + Math.cos(a + 1.2)), R(ty + Math.sin(a + 1.2)), C.white)
        }
        finish(s, Entry.Rise, 0)
        waterline(s, MAERITH_POOL)
    },
    fx(dst, st, t, x, y, dir) {
        drawPool(dst, MAERITH_POOL, x, y, dir, C.teal0)
        const k = fr(t, 10, 10)
        for (let i = 0; i < 6; i++) dst.set(x + dir * (-50 + ((i * 19 + k * 7) % 100)), y - 3, C.teal3)
        for (let i = 0; i < 4; i++) dst.set(x + dir * (-24 + i * 14), y - 100 - ((k * 4 + i * 11) % 30), C.teal3) // rising bubbles
        if (st === 'attack' && B.strike) {
            // the crack at the whip's tip: a bright arc, and water thrown up off the plaza
            const tx = x + dir * 94
            const ty = y - 11
            for (let i = 0; i < 9; i++) {
                const a = -Math.PI * 0.5 + (i - 4) * 0.28
                dst.set(tx + dir * R(Math.cos(a) * 7), ty + R(Math.sin(a) * 7), i & 1 ? C.white : C.cyan)
            }
            dst.set(tx, ty, C.white)
            for (let i = 0; i < 10; i++) dst.set(tx + dir * (-8 + i * 2), y - 2 - ((i * 5) % 7), i & 1 ? C.teal3 : C.white)
        }
    }
}

export const BOSSES_A: readonly (readonly [CreatureDef, CreatureDef])[] = [
    [OLD_GNARLHIDE, GORSECROWN],
    [MOTHER_LEECH, ROTHEART],
    [SLAGJAW, PYRRHAX],
    [JARL_HRIMGAR, VINTERHEL],
    [TIDECALLER_NERINE, QUEEN_MAERITH]
]

