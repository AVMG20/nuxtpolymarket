// The Mage line on the chibi body: Mage → Wizard → Sorcerer, Mage → Shaman → Witch Doctor.
//
// The apprentice is still bare-headed in a robe too big for him; the Wizard earns the hat,
// the Sorcerer is the reference video's fire caster. The other branch trades the robe for
// leather and fur and ends in bone paint and a pushed-up mask.

import { Ease, step } from './anim'
import { C } from './palette'
import { disc, hash2, line, px, rect, type Surface } from './surface'
import { HP, J, fxX, fxY, hclip, hitClip, deathClip, rest } from './rig'
import { chibiHead, face, head, ROOKIE_HEAD } from './chibi'
import { M, tip, staff, tome, Gem, type Mat } from './weapons'
import { CH, CA, RE, is, chibiLook, chibiCape, robe, aura, thickArc, ARCANE, FIRE, FROST, POISON, SPIRIT } from './hero-kit'
import type { HeroArt } from './heroes'

/** Scene effects a keyframe can call for, through the `fxk` pose parameter. */
const enum FXK { None, Bolt, Embers, Gather, BigBolt, Storm, Gust, Rise, Wail }

/**
 * A spell bolt leaving the staff head: a round core cooling through `ramp` with a stepped
 * tail behind it. `k` is the frame since release.
 */
function bolt(dst: Surface, k: number, ramp: readonly number[], big = false): void {
    const x = tip.x + 3 + k * (big ? 3 : 2)
    const y = tip.y
    const r = big ? 4 : 3
    disc(dst, fxX(x), fxY(y), r, ramp[4]!)
    disc(dst, fxX(x), fxY(y), r - 1, ramp[2]!)
    disc(dst, fxX(x), fxY(y), Math.max(1, r - 2), ramp[1]!)
    dst.set(fxX(x), fxY(y), C.white)
    for (let i = 1; i < (big ? 9 : 6); i++) dst.set(fxX(x - r - i), fxY(y + ((i + k) & 1)), i < 3 ? ramp[2]! : ramp[4]!)
}

/** Motes spiralling in onto the staff head while a spell gathers. */
function gather(dst: Surface, t: number, ramp: readonly number[]): void {
    const k = step(t, 10, 4)
    for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + k * 0.6
        const d = 8 - k * 2
        dst.set(fxX(Math.round(tip.x + Math.cos(a) * d)), fxY(Math.round(tip.y + Math.sin(a) * d)), i & 1 ? ramp[1]! : ramp[2]!)
    }
    dst.set(fxX(tip.x), fxY(tip.y), C.white)
}

// ═══════════════════════════════════════════════════════════════ Mage (base)
// An apprentice swimming in an oversized blue robe, its hood down on his back, no hat yet,
// and a violet crystal staff.

const ROBE_BLUE: Mat = [C.blue0, C.blue1, C.blue2]
const MAGE_REST = rest({ hx: 4, hy: 4, wa: -1.45, bhx: 1, bhy: 5, ffx: 2, bfx: -2 })

const mage: HeroArt = {
    look: chibiLook({
        accent: C.pink,
        arm: C.blue1, armLow: C.blue1, armBack: C.blue0, armBackLow: C.blue0, hand: C.skin1,
        back: (s, x, y) => {
            // the hood, down between his shoulders
            rect(s, x - 7, y - 2, 5, 4, C.blue1)
            rect(s, x - 7, y - 2, 5, 1, C.blue2)
            px(s, x - 7, y + 1, C.blue0)
        },
        torso: (s, x, y) => {
            rect(s, x - 5, y, 10, 8, C.blue1)
            rect(s, x - 5, y, 2, 8, C.blue0)
            rect(s, x + 2, y + 1, 2, 4, C.blue2)
            rect(s, x, y, 3, 1, C.bone1) // the Beginner's tunic showing at the collar
            px(s, x + 1, y + 1, C.bone1)
            line(s, x + 3, y, x - 3, y + 5, C.brown1) // satchel strap, still
            rect(s, x - 5, y + 5, 10, 1, C.purple1) // sash
            px(s, x + 1, y + 5, C.pink)
        },
        lower: robe(ROBE_BLUE, C.purple1, 1),
        head: (s, x, y, p) => chibiHead(s, ROOKIE_HEAD, x, y, p, p[HP.glow]! > 0.5 ? C.purple2 : C.ink),
        weapon: (s, x, y, p, t) => staff(s, x, y, p[HP.wa]!, 12, M.darkwood, M.arcane, Gem.Crystal, p[HP.glow]!, t),
        fx: (dst, p, t) => {
            if (is(p, FXK.Gather)) gather(dst, t, ARCANE)
            if (is(p, FXK.Bolt)) bolt(dst, step(t, 10, 2), ARCANE)
            if (is(p, FXK.Embers)) aura(dst, t, ARCANE, 8, 18)
            if (is(p, FXK.BigBolt)) {
                bolt(dst, step(t, 10, 3), ARCANE, true)
                aura(dst, t, ARCANE, 8, 12)
            }
        }
    }),
    clips: {
        idle: hclip('idle', 1.4, true, [[0, {}], [0.7, { crouch: 1, hy: 5, bhy: 6, wa: -1.4 }], [1.4, {}]], MAGE_REST),
        attack: hclip('attack', 0.9, false, [
            [0, {}],
            [0.1, { hx: 3, hy: 1, wa: -1.8, lean: -1, glow: 0.4 }, Ease.Out, CH],
            [0.2, { glow: 0.7, fxk: FXK.Gather }, Ease.InOut, CH],
            [0.4, { hx: 7, hy: 1, wa: -0.4, lean: 2, glow: 1, fxk: FXK.Bolt }, Ease.Out, CA],
            [0.6, { fxk: 0, glow: 0.5 }, Ease.Out, RE],
            [0.9, { hx: 4, hy: 4, wa: -1.45, lean: 0, glow: 0 }]
        ], MAGE_REST),
        // Ethereal Bouncebolt: hold the staff high while it charges, then fling the bolt two-handed
        cast: hclip('cast', 1.6, false, [
            [0, {}],
            [0.2, { hx: 3, hy: -5, wa: -1.57, bhx: 4, bhy: -2, crouch: 1, glow: 0.7, headY: -1, fxk: FXK.Embers }, Ease.Out, CH],
            [0.7, { glow: 1, mouth: 1 }, Ease.InOut, CH],
            [0.8, { hx: 8, hy: 1, wa: -0.3, bhx: 8, bhy: 2, lean: 2, crouch: 0, ffx: 4, fxk: FXK.BigBolt }, Ease.Out, CA],
            [1.1, { fxk: 0, mouth: 0, glow: 0.4 }, Ease.Hold, RE],
            [1.6, { hx: 4, hy: 4, wa: -1.45, bhx: 1, bhy: 5, lean: 0, ffx: 2, headY: 0, glow: 0 }]
        ], MAGE_REST),
        hit: hitClip(MAGE_REST),
        death: deathClip(MAGE_REST)
    }
}

// ═══════════════════════════════════════════════════════════════ Wizard (elite)
// He has earned the hat: a tall blue cone with a gold band and a star on it, the brim wider
// than his shoulders. A starred robe, an ice-orb staff and a spellbook in the off hand.

const WIZARD_HEAD = head([
    '.........aA.....',
    '........aAA.....',
    '.......aAAe.....',
    '......aAAAe.....',
    '......aAAfAe....',
    '.....aAAAAAe....',
    '.....aAYAAAAe...',
    '....gGGGGGGGGg..',
    '.aAAAAAAAAAAAAe.',
    'aaAAAAAAAAAAAAAe',
    '..hHHHHHHHHsH...',
    ...face(2, 2)
], 7, 11)

const WIZARD_REST = rest({ hx: 4, hy: 4, wa: -1.45, bhx: 3, bhy: 3, ffx: 2, bfx: -2 })

const wizard: HeroArt = {
    look: chibiLook({
        accent: C.cyan,
        arm: C.blue1, armLow: C.blue1, armBack: C.blue0, armBackLow: C.blue0, hand: C.skin1,
        torso: (s, x, y) => {
            rect(s, x - 5, y, 10, 8, C.blue1)
            rect(s, x - 5, y, 2, 8, C.blue0)
            rect(s, x + 2, y + 1, 2, 4, C.blue2)
            rect(s, x - 1, y, 2, 8, C.gold1) // front trim
            px(s, x, y + 2, C.gold3)
            px(s, x - 3, y + 2, C.frost); px(s, x + 3, y + 5, C.frost) // stars
            rect(s, x - 5, y + 5, 10, 1, C.gold1)
        },
        lower: (s, x, hipY, p, t) => {
            robe(ROBE_BLUE, C.gold1, 2)(s, x, hipY, p, t)
            px(s, x - 3, J.oy - 4, C.frost); px(s, x + 2, J.oy - 3, C.gold3) // stars on the hem
        },
        head: (s, x, y, p) => chibiHead(s, WIZARD_HEAD, x, y, p, p[HP.glow]! > 0.5 ? C.cyan : C.ink),
        weapon: (s, x, y, p, t) => staff(s, x, y, p[HP.wa]!, 14, M.wood, M.ice, Gem.Orb, p[HP.glow]!, t),
        offhand: (s, x, y, p) => tome(s, x + 1, y, [C.purple0, C.purple1, C.purple2], p[HP.glow]!),
        fx: (dst, p, t) => {
            if (is(p, FXK.Gather)) gather(dst, t, FROST)
            if (is(p, FXK.Bolt)) bolt(dst, step(t, 10, 2), FROST)
            if (is(p, FXK.Storm)) {
                aura(dst, t, FROST, 8, 20)
                // a forked bolt from the orb straight up out of frame, two pixels thick
                const k = step(t, 10, 3)
                let x = tip.x
                for (let yy = tip.y - 3; yy > tip.y - 40; yy--) {
                    if (((yy + k * 5) % 4) === 0) x += ((yy * 7 + k) & 2) - 1
                    dst.set(fxX(x), fxY(yy), C.white)
                    dst.set(fxX(x + 1), fxY(yy), (yy & 3) ? C.cyan : C.frost)
                }
                disc(dst, fxX(tip.x), fxY(tip.y), 2 + (k & 1), C.cyan)
                dst.set(fxX(tip.x), fxY(tip.y), C.white)
            }
        }
    }),
    clips: {
        idle: hclip('idle', 1.4, true, [[0, {}], [0.7, { crouch: 1, hy: 5, bhy: 4 }], [1.4, {}]], WIZARD_REST),
        attack: hclip('attack', 0.9, false, [
            [0, {}],
            [0.1, { hx: 3, hy: 1, wa: -1.8, lean: -1, glow: 0.4 }, Ease.Out, CH],
            [0.2, { glow: 0.7, fxk: FXK.Gather }, Ease.InOut, CH],
            [0.4, { hx: 7, hy: 1, wa: -0.4, lean: 2, glow: 1, fxk: FXK.Bolt }, Ease.Out, CA],
            [0.6, { fxk: 0, glow: 0.5 }, Ease.Out, RE],
            [0.9, { hx: 4, hy: 4, wa: -1.45, lean: 0, glow: 0 }]
        ], WIZARD_REST),
        // Lightning Storm: rise on the air, book open and blazing, staff overhead calling it down
        cast: hclip('cast', 1.8, false, [
            [0, {}],
            [0.2, { jump: -2, hx: 4, hy: -5, wa: -1.57, bhx: 5, bhy: 1, glow: 0.6, headY: -1, fxk: FXK.Gather }, Ease.Out, CH],
            [0.5, { jump: -4, glow: 0.8 }, Ease.InOut, CH],
            [0.6, { jump: -5, hy: -6, glow: 1, mouth: 1, fxk: FXK.Storm }, Ease.Out, CA],
            [1.3, { jump: -4 }, Ease.Linear, CA],
            [1.4, { fxk: 0, mouth: 0, glow: 0.4 }, Ease.Hold, RE],
            [1.8, { jump: 0, hx: 4, hy: 4, wa: -1.45, bhx: 3, bhy: 3, glow: 0, headY: 0 }]
        ], WIZARD_REST),
        hit: hitClip(WIZARD_REST),
        death: deathClip(WIZARD_REST)
    }
}

// ═══════════════════════════════════════════════════════════════ Sorcerer (master)
// The reference video's fire caster, and the end of the line, so he has to outclass the
// Wizard at a glance. He no longer touches the ground: he hovers over a bed of flame in a
// crimson robe with a black panel, a dark cape lined red, a high collar standing behind his
// head and black gold-edged pauldrons. The hat is the biggest in the roster, its tip folded back and smouldering, with
// a flame gem in the band. A fire orb circles him, embers rise off him, and the staff burns.

const SORCERER_HEAD = head([
    '...O..............',
    '...xy.............',
    '....yyx...........',
    '.....zyyx.........',
    '......zyyx........',
    '......zzyyx.......',
    '.....zzzyyyx......',
    '.....zzzyyyyx.....',
    '....zzzzyyyyyx....',
    '...gGGGGYOYGGGGg..',
    'xzzzzzzzzzzzzzzzyx',
    '.xyyyyyyyyyyyyyyx.',
    '...hHHHHHHHHsH....',
    ...face(3, 3)
], 8, 12)

const SORCERER_REST = rest({ hx: 4, hy: 4, wa: -1.5, bhx: 1, bhy: 5, ffx: 2, bfx: -2, jump: -3 })

/** The fire orb circling him: behind the body on the far half of its orbit, in front on the near. */
function fireOrb(s: Surface, x: number, y: number, p: Float32Array, t: number, near: boolean): void {
    if (p[HP.fall]! > 0.5) return // it gutters out when he falls
    const a = step(t, 10, 8) / 8 * Math.PI * 2
    if ((Math.sin(a) >= 0) !== near) return
    const ox = x + Math.round(Math.cos(a) * 11)
    const oy = y + 4 + Math.round(Math.sin(a) * 3)
    disc(s, ox, oy, 2, C.lava1)
    rect(s, ox - 1, oy - 1, 2, 2, C.gold2)
    px(s, ox - 1, oy - 1, C.white)
}

/** A rune ring on the ground under him: an ellipse with gold marks turning along it. */
function runeRing(dst: Surface, t: number): void {
    const k = step(t, 10, 16)
    const cy = J.oy - 1
    for (let i = 0; i < 64; i++) {
        const a = i / 64 * Math.PI * 2
        dst.set(fxX(J.bx + Math.round(Math.cos(a) * 14)), fxY(cy + Math.round(Math.sin(a) * 3)), Math.sin(a) > 0 ? C.orange : C.lava0)
    }
    for (let j = 0; j < 6; j++) {
        const a = (j / 6 + k / 96) * Math.PI * 2
        const rx = J.bx + Math.round(Math.cos(a) * 14)
        const ry = cy + Math.round(Math.sin(a) * 3)
        dst.set(fxX(rx), fxY(ry - 1), C.gold3)
        dst.set(fxX(rx), fxY(ry - 2), Math.sin(a) > 0 ? C.white : C.gold2)
    }
}

const sorcerer: HeroArt = {
    look: chibiLook({
        accent: C.orange,
        arm: C.red1, armLow: C.red1, armBack: C.red0, armBackLow: C.red0, hand: C.skin1,
        back: (s, x, y, p, t) => {
            // a black cape lined red, falling from the shoulders behind the robe
            chibiCape(s, x, y, 15, t, C.purple0, C.void, C.red1)
            // the high collar standing up behind his head, red on the inside
            for (let i = 0; i < 6; i++) {
                const w = 2 + (i >> 2)
                rect(s, x - 6 - w, y + 1 - i, w, 1, C.purple0)
                px(s, x - 6 - w, y + 1 - i, C.void)
                px(s, x - 7, y + 1 - i, C.red1)
            }
            px(s, x - 9, y - 5, C.purple0)
            fireOrb(s, x, y, p, t, false)
        },
        torso: (s, x, y) => {
            rect(s, x - 5, y, 10, 8, C.red1)
            rect(s, x - 5, y, 2, 8, C.red0)
            rect(s, x + 3, y + 1, 1, 4, C.red2)
            rect(s, x - 1, y, 3, 8, C.void) // black front panel
            rect(s, x + 2, y, 1, 8, C.gold1)
            px(s, x, y + 2, C.gold3)
            rect(s, x - 5, y + 5, 10, 1, C.gold1) // sash, with a flame gem at the knot
            px(s, x, y + 5, C.orange); px(s, x + 1, y + 5, C.gold3)
        },
        over: (s, x, y, p, t) => {
            // a black pauldron edged in gold
            rect(s, x + 1, y, 5, 3, C.void)
            rect(s, x + 1, y, 5, 1, C.gold2)
            px(s, x + 6, y + 1, C.gold1); px(s, x + 3, y + 1, C.red1)
            fireOrb(s, x, y, p, t, true)
        },
        lower: robe([C.red0, C.red1, C.red2], C.gold1, 3),
        head: (s, x, y, p, t) => {
            const lit = p[HP.glow]! > 0.5
            chibiHead(s, SORCERER_HEAD, x, y, p, lit ? C.orange : C.ink)
            // the folded tip smoulders, and flares when he casts
            const ox = Math.round(x) - SORCERER_HEAD.neck
            const oy = Math.round(y) - SORCERER_HEAD.pix.h
            s.set(ox + 3, oy, lit ? C.white : step(t, 5, 2) ? C.gold2 : C.orange)
            if (lit) s.set(ox + 9, oy + 9, C.white)
        },
        weapon: (s, x, y, p, t) => staff(s, x, y, p[HP.wa]!, 16, M.darkwood, M.lava, Gem.Flame, p[HP.glow]!, t),
        fx: (dst, p, t) => {
            const k = step(t, 10, 16)
            const hover = Math.round(-p[HP.jump]!)
            // the bed of flame he hovers over: uneven tongues, hottest at the root
            if (hover > 0 && p[HP.fall]! < 0.5) {
                for (let i = 0; i < 4; i++) {
                    const x = J.bx - 5 + i * 4 - (i & 1)
                    const h = 2 + Math.round(hash2(i, k) * (hover + 1))
                    for (let j = 0; j < h; j++) {
                        const y = fxY(J.oy - 1 - j)
                        const u = j / h
                        dst.set(fxX(x), y, u < 0.34 ? C.gold3 : u < 0.8 ? C.orange : C.lava1)
                        if (u < 0.5) {
                            dst.set(fxX(x - 1), y, u < 0.25 ? C.orange : C.lava1)
                            dst.set(fxX(x + 1), y, u < 0.25 ? C.orange : C.lava1)
                        }
                    }
                }
            }
            // embers always rising off him
            for (let i = 0; i < 5; i++) {
                const u = ((i * 7 + k * 2) % 32) / 32
                const x = J.bx + [-9, -6, 7, 10, -11][i]! + ((k >> 2) + i & 1)
                dst.set(fxX(x), fxY(J.oy - 4 - Math.round(u * 30)), u < 0.3 ? C.gold3 : u < 0.6 ? C.orange : C.lava1)
            }
            if (is(p, FXK.Bolt)) bolt(dst, step(t, 10, 2), FIRE, true)
            if (is(p, FXK.Embers)) {
                runeRing(dst, t)
                aura(dst, t, FIRE, 9, 28)
                const f = step(t, 10, 4)
                disc(dst, fxX(tip.x), fxY(tip.y - 2), 3 + (f & 1), C.orange)
                disc(dst, fxX(tip.x), fxY(tip.y - 2), 2, C.gold2)
                dst.set(fxX(tip.x), fxY(tip.y - 2), C.white)
            }
        }
    }),
    clips: {
        idle: hclip('idle', 1.6, true, [[0, {}], [0.8, { jump: -4, hy: 5, bhy: 6 }], [1.6, {}]], SORCERER_REST),
        attack: hclip('attack', 0.9, false, [
            [0, {}],
            [0.1, { hx: 5, hy: 0, wa: -1.7, lean: -1, glow: 0.4 }, Ease.Out, CH],
            [0.3, { glow: 0.8, jump: -4 }, Ease.InOut, CH],
            [0.4, { hx: 7, hy: 0, wa: -0.4, lean: 2, glow: 1, fxk: FXK.Bolt }, Ease.Out, CA],
            [0.6, { fxk: 0, glow: 0.5 }, Ease.Out, RE],
            [0.9, { hx: 4, hy: 4, wa: -1.5, lean: 0, glow: 0, jump: -3 }]
        ], SORCERER_REST),
        // Meteor Shower: he rises high over a ring of runes, staff and hand to the sky, and burns
        cast: hclip('cast', 2.0, false, [
            [0, {}],
            [0.2, { jump: -6, hx: 3, hy: -6, wa: -1.57, bhx: 1, bhy: -6, glow: 0.8, headY: -1, fxk: FXK.Embers }, Ease.Out, CH],
            [0.5, { jump: -8, glow: 1, mouth: 1 }, Ease.InOut, CA],
            [1.5, { jump: -7, hy: -7 }, Ease.Linear, CA],
            [1.6, { fxk: 0, mouth: 0, glow: 0.5 }, Ease.Hold, RE],
            [2.0, { jump: -3, hx: 4, hy: 4, wa: -1.5, bhx: 1, bhy: 5, glow: 0, headY: 0 }]
        ], SORCERER_REST),
        hit: hitClip(SORCERER_REST),
        death: deathClip(SORCERER_REST, { jump: 0 })
    }
}

// ═══════════════════════════════════════════════════════════════ Shaman (elite)
// Leather and a pale fur mantle, a red headband with feathers standing at the back, teal
// paint under the eye, bone beads, and an antlered staff taller than he is.

const SHAMAN_HEAD = head([
    'w.u.........',
    'wzu.........',
    'wzTu........',
    '.wzT.hHhH...',
    '.hwzHHHHHh..',
    'hHHHHHLLHHh.',
    'yyyyyyyyuyyy',
    'hHHHHHHHHsHH',
    'ohHHHsSSSkS.',
    'ohHHdsSSSkTs',
    '.hHHssSbbSS.',
    '.ohHssSSSSS.',
    '..ohsssSSs..',
    '.....ddd....'
], 5, 9)

const SHAMAN_REST = rest({ hx: 4, hy: 4, wa: -1.5, bhx: 1, bhy: 5, ffx: 3, bfx: -3 })

const shaman: HeroArt = {
    look: chibiLook({
        accent: C.teal3,
        pants: C.brown1, pantsDk: C.brown0, boot: C.bone0, bootHi: C.bone1,
        arm: C.brown2, armLow: C.skin1, armBack: C.brown1, armBackLow: C.skin0,
        torso: (s, x, y) => {
            rect(s, x - 5, y, 10, 8, C.brown2)
            rect(s, x - 5, y, 2, 8, C.brown1)
            rect(s, x + 2, y + 2, 2, 3, C.brown3)
            rect(s, x - 6, y, 11, 2, C.bone1) // fur mantle
            px(s, x - 5, y + 2, C.bone0); px(s, x - 1, y + 2, C.bone1); px(s, x + 3, y + 2, C.bone0)
            px(s, x - 3, y, C.white)
            for (let i = 0; i < 5; i++) px(s, x - 2 + i, y + 3 + (i & 1), i === 2 ? C.teal3 : C.bone1) // beads
            rect(s, x - 5, y + 5, 10, 1, C.teal1) // sash
            px(s, x + 1, y + 5, C.teal3)
            rect(s, x - 5, y + 6, 10, 2, C.brown1) // leather kilt
            px(s, x - 3, y + 7, C.brown2); px(s, x + 2, y + 7, C.brown2)
        },
        head: (s, x, y, p) => chibiHead(s, SHAMAN_HEAD, x, y, p, p[HP.glow]! > 0.5 ? C.teal3 : C.ink),
        weapon: (s, x, y, p, t) => staff(s, x, y, p[HP.wa]!, 15, M.wood, M.sea, Gem.Totem, p[HP.glow]!, t),
        fx: (dst, p, t) => {
            if (is(p, FXK.Gather)) gather(dst, t, SPIRIT)
            if (is(p, FXK.Bolt)) bolt(dst, step(t, 10, 2), SPIRIT)
            if (is(p, FXK.Gust)) {
                aura(dst, t, SPIRIT, 8, 16)
                // the wind wheeling round him: three thick arcs chasing each other
                const k = step(t, 10, 8)
                for (let i = 0; i < 3; i++) {
                    const a0 = k * 0.8 + i * Math.PI * 2 / 3
                    thickArc(dst, J.bx, J.topY + 3, 13 - i, a0, a0 + 1.4, i === 1 ? C.teal2 : C.teal3)
                }
            }
        }
    }),
    clips: {
        idle: hclip('idle', 1.4, true, [[0, {}], [0.7, { crouch: 1, hy: 5, bhy: 6, wa: -1.45 }], [1.4, {}]], SHAMAN_REST),
        attack: hclip('attack', 0.9, false, [
            [0, {}],
            [0.1, { hx: 3, hy: 0, wa: -1.6, lean: -1 }, Ease.Out, CH],
            [0.2, { hx: 4, hy: -2, wa: -1.45, glow: 0.5, fxk: FXK.Gather }, Ease.InOut, CH],
            [0.3, { hx: 3, hy: 0, wa: -1.7, glow: 0.7 }, Ease.InOut, CH],
            [0.4, { hx: 7, hy: 1, wa: -0.4, lean: 2, glow: 1, fxk: FXK.Bolt }, Ease.Out, CA],
            [0.6, { fxk: 0, glow: 0.4 }, Ease.Out, RE],
            [0.9, { hx: 4, hy: 4, wa: -1.5, lean: 0, glow: 0 }]
        ], SHAMAN_REST),
        // Totem Storm: hop and plant the totem, throw the free arm up and let the wind wheel
        cast: hclip('cast', 1.8, false, [
            [0, {}],
            [0.2, { hx: 3, hy: -4, wa: -1.57, jump: -3, glow: 0.4 }, Ease.Out, CH],
            [0.4, { hx: 6, hy: 3, wa: -1.57, jump: 0, crouch: 2, glow: 0.7 }, Ease.In, CH],
            [0.5, { bhx: -1, bhy: -8, crouch: 0, headY: -1, mouth: 1, glow: 1, fxk: FXK.Gust }, Ease.Out, CA],
            [1.3, {}, Ease.Linear, CA],
            [1.4, { fxk: 0, mouth: 0, glow: 0.4 }, Ease.Hold, RE],
            [1.8, { hx: 4, hy: 4, wa: -1.5, bhx: 1, bhy: 5, headY: 0, glow: 0 }]
        ], SHAMAN_REST),
        hit: hitClip(SHAMAN_REST),
        death: deathClip(SHAMAN_REST)
    }
}

// ═══════════════════════════════════════════════════════════════ Witch Doctor (master)
// Bone-painted bare chest, a tooth necklace, a straw skirt, a horned bone mask pushed up on
// his head so his face still shows, a voodoo doll and a skull staff burning green. The mask's
// eyes light when he casts.

const WITCH_HEAD = head([
    '.b.......b..',
    '..b.....b...',
    '..bBbbbbbw..',
    '..Bbkbbbkb..',
    '..BbbbzbbbB.',
    '..BbyyyybB..',
    '.hHHHHHHHh..',
    'hHHHHHHHHsHH',
    ...face()
], 5, 9)

const WITCH_REST = rest({ hx: 4, hy: 4, wa: -1.4, bhx: 2, bhy: 4, ffx: 3, bfx: -3, crouch: 1, tilt: 1 })

const witchDoctor: HeroArt = {
    look: chibiLook({
        accent: C.green4,
        pants: C.skin1, pantsDk: C.skin0, boot: C.brown1, bootHi: C.brown2,
        arm: C.skin1, armLow: C.skin1, armBack: C.skin0, armBackLow: C.skin0, hand: C.skin1,
        torso: (s, x, y) => {
            rect(s, x - 5, y, 10, 8, C.skin1)
            rect(s, x - 5, y, 2, 8, C.skin0)
            for (let i = 0; i < 2; i++) rect(s, x - 1, y + 2 + i * 2, 4, 1, C.bone1) // painted ribs
            rect(s, x + 1, y + 1, 1, 4, C.bone1)
            for (let i = 0; i < 5; i++) px(s, x - 3 + i * 2, y + (i & 1), i === 2 ? C.white : C.bone0) // tooth necklace
            rect(s, x - 5, y + 5, 10, 1, C.red1) // waist cord
            // the straw skirt, hanging over the tops of his legs
            for (let i = 0; i < 10; i++) {
                const len = 3 + ((i * 5) % 3)
                line(s, x - 5 + i, y + 6, x - 5 + i, y + 5 + len, i & 1 ? C.olive2 : C.olive1)
            }
        },
        head: (s, x, y, p) => {
            chibiHead(s, WITCH_HEAD, x, y, p, p[HP.glow]! > 0.5 ? C.green4 : C.ink)
            if (p[HP.glow]! > 0.5) {
                // the mask wakes up
                const ox = Math.round(x) - WITCH_HEAD.neck
                const oy = Math.round(y) - WITCH_HEAD.pix.h
                s.set(ox + 4, oy + 3, C.green4)
                s.set(ox + 8, oy + 3, C.green4)
            }
        },
        weapon: (s, x, y, p, t) => staff(s, x, y, p[HP.wa]!, 13, M.darkwood, [C.green1, C.green3, C.green4], Gem.Skull, p[HP.glow]!, t),
        offhand: (s, x, y) => {
            // voodoo doll
            rect(s, x - 1, y - 3, 3, 5, C.olive2)
            rect(s, x - 1, y - 4, 3, 1, C.olive2)
            px(s, x - 1, y - 3, C.olive1)
            px(s, x, y - 3, C.ink)
            px(s, x, y - 1, C.red2); px(s, x + 2, y - 2, C.steel3)
        },
        fx: (dst, p, t) => {
            if (is(p, FXK.Gather)) gather(dst, t, POISON)
            if (is(p, FXK.Bolt)) bolt(dst, step(t, 10, 2), POISON)
            if (is(p, FXK.Rise)) {
                // green soul-light seeping up out of the ground in front of him
                const k = step(t, 10, 8)
                for (let i = 0; i < 5; i++) {
                    const hx = J.bx + 8 + i * 4
                    const h = 2 + ((i * 3 + k) % 6)
                    for (let j = 0; j < h; j++) dst.set(fxX(hx + ((j + i) & 1)), fxY(J.oy - 1 - j), j === h - 1 ? C.green4 : j < 2 ? C.green1 : C.green3)
                }
            }
            if (is(p, FXK.Wail)) {
                aura(dst, t, POISON, 8, 20)
                // spectral hands clawing up from the ground ahead of him
                const k = step(t, 10, 4)
                for (let i = 0; i < 3; i++) {
                    const hx = J.bx + 10 + i * 6
                    const h = Math.min(8, 3 + k * 2 - i)
                    if (h < 1) continue
                    for (let j = 0; j < h; j++) {
                        dst.set(fxX(hx), fxY(J.oy - 1 - j), C.green3)
                        dst.set(fxX(hx + 1), fxY(J.oy - 1 - j), j < 2 ? C.green1 : C.green2)
                    }
                    dst.set(fxX(hx - 1), fxY(J.oy - h), C.green4)
                    dst.set(fxX(hx), fxY(J.oy - 1 - h), C.green4)
                    dst.set(fxX(hx + 2), fxY(J.oy - h), C.green4)
                }
            }
        }
    }),
    clips: {
        // swaying from foot to foot, never still
        idle: hclip('idle', 1.2, true, [
            [0, {}], [0.3, { lean: 1, hy: 5 }], [0.6, { crouch: 2, lean: 0 }], [0.9, { lean: -1, hy: 3 }], [1.2, {}]
        ], WITCH_REST),
        attack: hclip('attack', 0.9, false, [
            [0, {}],
            [0.1, { hx: 3, hy: 1, wa: -1.8, lean: -1, glow: 0.4 }, Ease.Out, CH],
            [0.2, { glow: 0.7, fxk: FXK.Gather }, Ease.InOut, CH],
            [0.4, { hx: 7, hy: 2, wa: -0.4, lean: 2, glow: 1, bhx: -2, fxk: FXK.Bolt }, Ease.Out, CA],
            [0.6, { fxk: 0, glow: 0.4 }, Ease.Out, RE],
            [0.9, { hx: 4, hy: 4, wa: -1.4, bhx: 2, lean: 0, glow: 0 }]
        ], WITCH_REST),
        // Raise Dead: stoop with the palms to the ground, then drag the dead up after them
        cast: hclip('cast', 1.8, false, [
            [0, {}],
            [0.2, { crouch: 3, tilt: 2, hx: 6, hy: 6, wa: 1.3, bhx: 6, bhy: 6, headY: 1, glow: 0.6, fxk: FXK.Rise }, Ease.Out, CH],
            [0.6, { glow: 0.8 }, Ease.InOut, CH],
            [0.7, { crouch: 0, tilt: -2, hx: 5, hy: -5, wa: -1.3, bhx: 3, bhy: -6, headY: -1, glow: 1, mouth: 1, fxk: FXK.Wail }, Ease.Out, CA],
            [1.3, {}, Ease.Linear, CA],
            [1.4, { fxk: 0, mouth: 0, glow: 0.4 }, Ease.Hold, RE],
            [1.8, { crouch: 1, tilt: 1, hx: 4, hy: 4, wa: -1.4, bhx: 2, bhy: 4, headY: 0, glow: 0 }]
        ], WITCH_REST),
        hit: hitClip(WITCH_REST),
        death: deathClip(WITCH_REST)
    }
}

export const MAGE_LINE: Readonly<Record<string, HeroArt>> = {
    class_mage: mage,
    class_wizard: wizard,
    class_sorcerer: sorcerer,
    class_shaman: shaman,
    class_witch_doctor: witchDoctor
}
