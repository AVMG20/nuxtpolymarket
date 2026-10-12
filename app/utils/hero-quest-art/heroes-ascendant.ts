// The Ascendant, the capstone class past the six masters (`capstone-class.md`), on the chibi body.
//
// Same rookie (see chibi.ts ROOKIE_HEAD): a gold circlet on the mop, a halo behind it, and the
// plaster still on his cheek. One step past the masters, so he outclasses them by calm rather than
// by bulk: white and gold plate over a violet robe, a violet cape lined gold, a gold staff topped
// with a crystal, and hovering a little off the ground. Six motes circle him, one in each master's
// colour, for the six classes he has mastered; casting Convergence, he rises and flings them wide.

import { Ease, step } from './anim'
import { C } from './palette'
import { disc, hash2, px, rect, type Surface } from './surface'
import { HP, J, fxX, fxY, hclip, hitClip, deathClip, rest } from './rig'
import { chibiHead, face, head } from './chibi'
import { M, tip, staff, Gem } from './weapons'
import { CH, CA, RE, is, chibiLook, chibiCape, robe, aura, pop, HOLY } from './hero-kit'
import type { HeroArt } from './heroes'

/** Scene effects a keyframe can call for, through the `fxk` pose parameter. */
const enum FXK { None, Bolt, Converge }

/**
 * One mote per master, in the colour of that master's skill: Enrage, Disciple, Meteor Shower,
 * Raise Dead, Arrow Rain, Man's Best Friend. Convergence flings the same six.
 */
export const MASTER_MOTES: readonly number[] = [C.red2, C.gold3, C.orange, C.green4, C.cyan, C.steel3]

const ASCENDANT_HEAD = head([
    '..hH.hH.H...',
    '.hHHHHHHHh..',
    '.hHHLLLLHHh.',
    'gGGGGGGVwGGg',
    'hHHHHHHHHsHH',
    ...face()
], 5, 9)

// the staff stands forward of him, clear of the face, as the art guide asks of every weapon
const ASCENDANT_REST = rest({ hx: 8, hy: 4, wa: -1.5, bhx: 1, bhy: 5, ffx: 2, bfx: -2, jump: -2 })

/**
 * The orbit's speed, in turns a second, per clip (`aux`): each clip makes whole turns, so every one
 * starts and ends with the six in the same places, and loops and hand-offs never jump.
 */
const ORBIT = {
    idle: 1 / 1.6, // one turn
    attack: 1 / 0.9, // one turn
    cast: 2 / 2.0, // two turns, whirling as he casts
    move: 1 / 0.8 // one turn, on the 0.8 s float
} as const

/**
 * How far round the orbit he is, in [0, 1): `aux` turns a second, so a clip's end is exactly 0
 * again. Rounded first, or a last whole turn reads as 0.9999999 and the mote at angle 0 swaps
 * from in front of him to behind.
 */
function turnsOf(p: Float32Array, t: number): number {
    const turns = Math.round(p[HP.aux]! * t * 1e4) / 1e4
    return ((turns % 1) + 1) % 1
}

/**
 * The time his cape and robe sway by: the orbit's clock laid onto the idle's 1.6 s, so they come
 * round with the motes at every clip's end rather than on their own 1/3 s beat, which a 0.4 s hit
 * ended mid-swing.
 */
function swayClock(p: Float32Array, t: number): number {
    return turnsOf(p, t) * 1.6
}

const ROBE = robe([C.purple0, C.purple1, C.purple2], C.gold2, 3)

/**
 * The six motes circling him: behind the body on the far half of the orbit, in front on the
 * near. They ride wider and higher as he gathers a cast (`glow`), hold still through a hit, and
 * gutter out when he falls.
 */
function motesAround(s: Surface, x: number, y: number, p: Float32Array, t: number, near: boolean): void {
    if (p[HP.fall]! > 0.5) return
    const glow = p[HP.glow]!
    const spin = turnsOf(p, t) * Math.PI * 2
    const rx = 11 + Math.round(glow * 5)
    const ry = 3 + Math.round(glow * 2)
    for (let i = 0; i < MASTER_MOTES.length; i++) {
        const a = spin + i / MASTER_MOTES.length * Math.PI * 2
        if ((Math.sin(a) >= 0) !== near) continue
        const mx = x + Math.round(Math.cos(a) * rx)
        const my = y + 3 - Math.round(glow * 6) + Math.round(Math.sin(a) * ry)
        disc(s, mx, my, 1.5, MASTER_MOTES[i]!)
        px(s, mx, my - 1, C.white)
    }
}

/**
 * The halo: a thin gold ring floating just over his hair, brighter as he casts. Drawn in the
 * effect layer, which takes no outline: stamped with the sprite, a 1 px ring came out as a thick
 * black double ellipse and read as goggles.
 */
function halo(dst: Surface, p: Float32Array): void {
    const lit = p[HP.glow]! > 0.5
    const cx = J.headX + 1
    const cy = J.headY - 14
    for (let i = 0; i < 32; i++) {
        const a = i / 32 * Math.PI * 2
        dst.set(fxX(cx + Math.round(Math.cos(a) * 6)), fxY(cy + Math.round(Math.sin(a) * 2)), Math.sin(a) < 0 ? (lit ? C.white : C.gold3) : C.gold2)
    }
}

/** A ring of gold runes turning on the ground under him while he casts. */
function runeRing(dst: Surface, t: number): void {
    const k = step(t, 10, 16)
    const cy = J.oy - 1
    for (let i = 0; i < 64; i++) {
        const a = i / 64 * Math.PI * 2
        dst.set(fxX(J.bx + Math.round(Math.cos(a) * 14)), fxY(cy + Math.round(Math.sin(a) * 3)), Math.sin(a) > 0 ? C.gold2 : C.purple1)
    }
    for (let j = 0; j < MASTER_MOTES.length; j++) {
        const a = (j / MASTER_MOTES.length + k / 96) * Math.PI * 2
        const rx = J.bx + Math.round(Math.cos(a) * 14)
        const ry = cy + Math.round(Math.sin(a) * 3)
        dst.set(fxX(rx), fxY(ry - 1), MASTER_MOTES[j]!)
        dst.set(fxX(rx), fxY(ry - 2), C.white)
    }
}

const ascendant: HeroArt = {
    look: chibiLook({
        accent: C.gold3,
        arm: C.bone1, armLow: C.gold1, armBack: C.bone0, armBackLow: C.gold0, hand: C.skin1,
        back: (s, x, y, p, t) => {
            // a violet cape lined gold, and the far half of the motes
            chibiCape(s, x, y, 14, swayClock(p, t), C.purple1, C.purple0, C.gold2)
            motesAround(s, x, y, p, t, false)
        },
        torso: (s, x, y) => {
            rect(s, x - 5, y, 10, 8, C.bone1) // white plate
            rect(s, x - 5, y, 2, 8, C.bone0)
            rect(s, x + 2, y + 1, 2, 2, C.white)
            rect(s, x - 1, y + 1, 3, 7, C.purple1) // a violet panel down the front, edged gold
            rect(s, x - 2, y + 1, 1, 7, C.gold1)
            rect(s, x + 2, y + 1, 1, 7, C.gold2)
            rect(s, x - 3, y, 7, 1, C.gold2) // gilt collar
            px(s, x, y + 2, C.purple2)
            rect(s, x - 5, y + 5, 10, 1, C.gold1) // belt, a violet gem at the buckle
            px(s, x, y + 5, C.pink); px(s, x + 1, y + 5, C.gold3)
        },
        over: (s, x, y, p, t) => {
            // a white pauldron on a gold rim, clear of the chin
            rect(s, x + 2, y + 2, 4, 1, C.white)
            rect(s, x + 1, y + 3, 6, 1, C.gold3)
            rect(s, x + 1, y + 4, 6, 1, C.gold1)
            px(s, x + 3, y + 3, C.white)
            motesAround(s, x, y, p, t, true)
        },
        lower: (s, x, y, p, t) => ROBE(s, x, y, p, swayClock(p, t)),
        head: (s, x, y, p) => chibiHead(s, ASCENDANT_HEAD, x, y, p, p[HP.glow]! > 0.5 ? C.gold3 : C.ink),
        weapon: (s, x, y, p, t) => staff(s, x, y, p[HP.wa]!, 17, M.gold, M.holy, Gem.Crystal, p[HP.glow]!, t),
        fx: (dst, p, t) => {
            if (p[HP.fall]! < 0.5) halo(dst, p)
            // a little light always drifting up from under his hem, on the orbit's clock so it loops with it
            if (p[HP.fall]! < 0.5) {
                const turns = turnsOf(p, t)
                for (let i = 0; i < 4; i++) {
                    const u = (((i * 9) / 32 + turns) % 1 + 1) % 1
                    const x = J.bx + [-5, -1, 3, 6][i]! + (hash2(i, Math.floor(u * 8)) > 0.5 ? 1 : 0)
                    dst.set(fxX(x), fxY(J.oy - 1 - Math.round(u * 12)), u < 0.4 ? C.white : u < 0.7 ? C.gold3 : C.gold1)
                }
            }
            if (is(p, FXK.Bolt)) {
                pop(dst, tip.x, tip.y, step(t, 10, 2), C.gold3)
                disc(dst, fxX(tip.x), fxY(tip.y - 1), 2, C.white)
            }
            if (is(p, FXK.Converge)) {
                runeRing(dst, t)
                aura(dst, t, HOLY, 9, 26)
                // the crystal blazing, ringed by the six colours in turn
                const f = step(t, 10, 6)
                disc(dst, fxX(tip.x), fxY(tip.y - 2), 3 + (f & 1), MASTER_MOTES[f]!)
                disc(dst, fxX(tip.x), fxY(tip.y - 2), 2, C.gold3)
                dst.set(fxX(tip.x), fxY(tip.y - 2), C.white)
            }
        }
    }),
    clips: {
        idle: hclip('idle', 1.6, true, [[0, { aux: ORBIT.idle }], [0.8, { jump: -4, hy: 4, bhy: 6 }], [1.6, {}]], ASCENDANT_REST),
        attack: hclip('attack', 0.9, false, [
            [0, { aux: ORBIT.attack }],
            [0.1, { hx: 5, hy: 0, wa: -1.7, lean: -1, glow: 0.4 }, Ease.Out, CH],
            [0.3, { glow: 0.7, jump: -3 }, Ease.InOut, CH],
            [0.4, { hx: 7, hy: 0, wa: -0.4, lean: 2, glow: 0.9, fxk: FXK.Bolt }, Ease.Out, CA],
            [0.6, { fxk: 0, glow: 0.4 }, Ease.Out, RE],
            [0.9, { hx: 8, hy: 4, wa: -1.5, lean: 0, glow: 0, jump: -2 }]
        ], ASCENDANT_REST),
        // Convergence: he rises over a ring of runes, staff and hand to the sky, and flings the six wide
        cast: hclip('cast', 2.0, false, [
            [0, { aux: ORBIT.cast }],
            [0.2, { jump: -6, hx: 9, hy: -5, wa: -1.57, bhx: 1, bhy: -6, glow: 0.7, headY: -1, fxk: FXK.Converge }, Ease.Out, CH],
            [0.5, { jump: -9, glow: 1, mouth: 1 }, Ease.InOut, CA],
            [1.5, { jump: -8, hy: -7 }, Ease.Linear, CA],
            [1.6, { fxk: 0, mouth: 0, glow: 0.5 }, Ease.Hold, RE],
            [2.0, { jump: -2, hx: 8, hy: 4, wa: -1.5, bhx: 1, bhy: 5, headY: 0, glow: 0 }]
        ], ASCENDANT_REST),
        hit: hitClip(ASCENDANT_REST, 0.6),
        death: deathClip(ASCENDANT_REST)
    },
    gait: { aux: ORBIT.move }
}

export const ASCENDANT_LINE: Readonly<Record<string, HeroArt>> = {
    class_ascendant: ascendant
}
