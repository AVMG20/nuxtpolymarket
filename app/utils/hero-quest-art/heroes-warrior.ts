// The Beginner and the Warrior line (Warrior → Barbarian → Berserker, Warrior → Knight →
// Paladin) on the chibi body.
//
// Same rookie in every one (see chibi.ts ROOKIE_HEAD): the headgear changes, the face never.
// Tier shows in the kit — the Warrior is a novice in a kettle cap, the elites have picked a
// side (fur and a great axe, or plate and a kite shield), the masters are unmistakable.

import { Ease, step } from './anim'
import { C } from './palette'
import { disc, line, px, rect } from './surface'
import { HP, J, fxX, fxY, hclip, hitClip, deathClip, rest } from './rig'
import { chibiHead, crescent, face, head, ROOKIE_HEAD } from './chibi'
import { M, tip, sword, axe, flangedMace, shield, ShieldStyle, type Mat } from './weapons'
import { CH, CA, RE, is, chibiLook, chibiCape, aura, pop, shout, slam, lightColumn, BLOOD_FIRE, FIRE, FROST, HOLY } from './hero-kit'
import type { HeroArt } from './heroes'

/** Scene effects a keyframe can call for, through the `fxk` pose parameter. */
const enum FXK { None, Jab, Cross, Burst, Slash, SlashFade, Rage, Spin, Roar, BackSlash, Slam, Pray, Holy }

// ═══════════════════════════════════════════════════════════════ Beginner
// Cream tunic, rope belt, a satchel on his hip, fists up. Two strikes per attack.

const BEGINNER_REST = rest({ hx: 5, hy: 1, bhx: 8, bhy: 0, ffx: 3, bfx: -3 })

const beginner: HeroArt = {
    look: chibiLook({
        accent: C.gold3,
        back: (s, x, y) => {
            // satchel riding the back hip
            rect(s, x - 7, y + 4, 4, 4, C.brown2)
            rect(s, x - 7, y + 4, 4, 1, C.brown3)
            px(s, x - 5, y + 5, C.gold2)
        },
        torso: (s, x, y) => {
            rect(s, x - 5, y, 10, 8, C.bone1)
            rect(s, x - 5, y, 2, 8, C.bone0)
            rect(s, x + 2, y + 1, 2, 3, C.white)
            rect(s, x, y, 3, 1, C.skin1)
            px(s, x + 1, y + 1, C.skin0)
            line(s, x + 3, y, x - 3, y + 5, C.brown2) // satchel strap
            rect(s, x - 5, y + 5, 10, 1, C.brown2) // rope belt
            px(s, x + 1, y + 5, C.gold2)
            rect(s, x - 5, y + 7, 10, 1, C.bone0)
        },
        head: (s, x, y, p) => chibiHead(s, ROOKIE_HEAD, x, y, p),
        fx: (dst, p, t) => {
            if (is(p, FXK.Jab)) pop(dst, J.hx + 2, J.hy, step(t, 10, 2), C.gold3)
            if (is(p, FXK.Cross)) pop(dst, J.bhx + 2, J.bhy, step(t, 10, 2), C.gold3)
            if (is(p, FXK.Burst)) {
                // Haste: speed lines streaming off his back
                for (let i = 0; i < 5; i++) {
                    const yy = J.topY - 6 + i * 5
                    const len = 6 + ((i + step(t, 10, 3)) % 3) * 3
                    for (let k = 0; k < len; k++) if (k < 3 || !((k + i) & 1)) dst.set(fxX(J.bx - 8 - k), fxY(yy), k < 3 ? C.white : C.gold2)
                }
            }
        }
    }),
    clips: {
        idle: hclip('idle', 1.2, true, [
            [0, {}],
            [0.3, { crouch: 1, hy: 2, bhy: 1 }],
            [0.6, { crouch: 0, hy: 1, bhy: 0 }],
            [0.9, { crouch: 1, hy: 2, bhy: 1 }],
            [1.2, {}]
        ], BEGINNER_REST),
        attack: hclip('attack', 0.9, false, [
            [0, {}],
            [0.1, { lean: -1, hx: 2, hy: 2, crouch: 1 }, Ease.Out, CH],
            [0.2, { lean: 2, hx: 9, hy: 1, ffx: 5, bfx: -4, fxk: FXK.Jab }, Ease.Out, CA],
            [0.3, { lean: 1, hx: 4, hy: 2, fxk: 0 }, Ease.InOut, CH],
            [0.4, { lean: 3, bhx: 15, bhy: 1, hx: 1, hy: 4, ffx: 6, tilt: 1, fxk: FXK.Cross }, Ease.Out, CA],
            [0.5, { lean: 3, bhx: 14, tilt: 1, fxk: 0 }, Ease.Hold, RE],
            [0.9, { lean: 0, bhx: 8, bhy: 0, hx: 5, hy: 1, ffx: 3, bfx: -3, tilt: 0 }]
        ], BEGINNER_REST),
        // Haste: crouch and gather, spring up fists high, land running hot
        cast: hclip('cast', 1.4, false, [
            [0, {}],
            [0.2, { crouch: 2, hx: 1, hy: 5, bhx: 2, bhy: 5, glow: 0.4, headY: 1 }, Ease.Out, CH],
            [0.4, { crouch: 3, glow: 0.5 }, Ease.InOut, CH],
            [0.5, { crouch: 0, jump: -6, hx: 3, hy: -7, bhx: 1, bhy: -6, glow: 1, headY: -1, mouth: 1, ffy: 2, bfy: 3, fxk: FXK.Burst }, Ease.Out, CA],
            [0.8, { jump: -7 }, Ease.Out, CA],
            [1.0, { jump: 0, crouch: 2, glow: 0.6, mouth: 0, ffy: 0, bfy: 0, hy: 1, bhy: 0 }, Ease.In, RE],
            [1.1, { fxk: 0 }, Ease.Hold],
            [1.4, { crouch: 0, glow: 0, hx: 5, hy: 1, bhx: 8, bhy: 0, headY: 0 }]
        ], BEGINNER_REST),
        hit: hitClip(BEGINNER_REST),
        death: deathClip(BEGINNER_REST)
    }
}

// ═══════════════════════════════════════════════════════════════ Warrior (base)
// A novice: iron kettle cap, leather jerkin under a red tabard, a broad arming sword and a
// round wooden shield slung on the back arm.

const WARRIOR_HEAD = head([
    '....IIII....',
    '..IjjJJjI...',
    '.IjjjjJJjI..',
    '.IjjjjjjjI..',
    'iIIIIIIIIIIi',
    'hHHHHHHHHsH.',
    ...face()
], 5, 9)

const WARRIOR_REST = rest({ hx: 3, hy: 4, wa: -1.15, bhx: -1, bhy: 4, ffx: 3, bfx: -3 })

const warrior: HeroArt = {
    look: chibiLook({
        accent: C.red2,
        pants: C.steel1, pantsDk: C.steel0, boot: C.brown1, bootHi: C.brown3,
        arm: C.brown2, armLow: C.steel1, armBack: C.brown1, armBackLow: C.steel0, hand: C.brown1,
        torso: (s, x, y) => {
            rect(s, x - 5, y, 10, 8, C.brown2)
            rect(s, x - 5, y, 2, 8, C.brown1)
            rect(s, x - 1, y, 4, 8, C.red1) // tabard
            rect(s, x + 1, y + 1, 1, 6, C.red2)
            rect(s, x - 5, y + 5, 10, 1, C.brown0)
            px(s, x, y + 5, C.gold2)
            rect(s, x - 5, y + 7, 10, 1, C.steel1) // mail skirt
            px(s, x - 3, y + 7, C.steel2); px(s, x + 3, y + 7, C.steel2)
        },
        head: (s, x, y, p) => chibiHead(s, WARRIOR_HEAD, x, y, p),
        weapon: (s, x, y, p) => sword(s, x, y, p[HP.wa]!, 15, M.steel, M.bronze, C.brown1, true),
        offhand: (s, x, y) => {
            disc(s, x - 1, y, 4, C.steel1)
            disc(s, x - 1, y, 3, C.brown2)
            line(s, x - 3, y - 2, x + 1, y - 2, C.brown3)
            rect(s, x - 2, y - 1, 2, 2, C.red2)
        },
        over: (s, x, y) => {
            // pauldron over the sword shoulder
            rect(s, x + 1, y, 5, 3, C.steel1)
            rect(s, x + 2, y, 3, 1, C.steel3)
        },
        fx: (dst, p, t) => {
            if (is(p, FXK.Slash)) crescent(dst, J.fsx, J.fsy, 16, p[HP.fxa]!, p[HP.wa]!, 6, C.red2, C.white, C.red1)
            if (is(p, FXK.SlashFade)) crescent(dst, J.fsx, J.fsy, 16, p[HP.fxa]!, p[HP.wa]!, 3, C.red1, C.red3, C.red0)
            if (is(p, FXK.Rage)) {
                aura(dst, t, BLOOD_FIRE)
                // the blade drinks the light: a white-hot core down its length
                if (step(t, 10, 2)) dst.set(fxX(tip.x), fxY(tip.y - 1), C.white)
            }
            if (is(p, FXK.Spin)) {
                const k = step(t, 10, 4)
                const a = k * Math.PI / 2
                crescent(dst, J.bx, J.topY + 2, 14, a, a + Math.PI * 1.1, 5, C.red2, C.white, C.red1)
                crescent(dst, J.bx, J.topY + 2, 14, a + Math.PI, a + Math.PI * 2.1, 4, C.red1, C.red3, C.red0)
                aura(dst, t, BLOOD_FIRE, 8, 12)
            }
        }
    }),
    clips: {
        idle: hclip('idle', 1.2, true, [
            [0, {}], [0.6, { crouch: 1, hy: 5, bhy: 5, wa: -1.05 }], [1.2, {}]
        ], WARRIOR_REST),
        attack: hclip('attack', 0.9, false, [
            [0, {}],
            [0.1, { wa: -2.2, hx: 0, hy: -3, lean: -1, crouch: 1 }, Ease.Out, CH],
            [0.3, { wa: -2.8, hx: -2, hy: -5, lean: -2, crouch: 1 }, Ease.InOut, CH],
            [0.4, { wa: 0.2, hx: 7, hy: 2, lean: 2, ffx: 5, crouch: 0, fxk: FXK.Slash, fxa: -2.7 }, Ease.Out, CA],
            [0.5, { wa: 0.9, hx: 6, hy: 5, crouch: 2 }, Ease.Out, CA],
            [0.6, { fxk: FXK.SlashFade, fxa: -1.2 }, Ease.Hold, RE],
            [0.7, { fxk: 0 }, Ease.Hold, RE],
            [0.9, { wa: -1.15, hx: 3, hy: 4, lean: 0, crouch: 0, ffx: 3 }]
        ], WARRIOR_REST),
        // Whirlwind: raise the blade and let it catch fire, then spin twice through the pack
        cast: hclip('cast', 1.8, false, [
            [0, {}],
            [0.2, { wa: -1.57, hx: 2, hy: -6, bhx: 0, bhy: 2, crouch: 1, glow: 0.7, fxk: FXK.Rage }, Ease.Out, CH],
            [0.7, { crouch: 2, glow: 1 }, Ease.InOut, CH],
            [0.8, { wa: 0.05, hx: 7, hy: 1, bhx: -2, bhy: 3, lean: 1, ffx: 5, bfx: -5, flip: 1, fxk: FXK.Spin }, Ease.Hold, CA],
            [0.9, { flip: 0 }, Ease.Hold],
            [1.0, { flip: 1 }, Ease.Hold],
            [1.1, { flip: 0 }, Ease.Hold],
            [1.2, { flip: 1 }, Ease.Hold],
            [1.3, { flip: 0, fxk: 0, glow: 0.3 }, Ease.Hold, RE],
            [1.8, { crouch: 0, wa: -1.15, hx: 3, hy: 4, bhx: -1, bhy: 4, ffx: 3, bfx: -3, lean: 0, glow: 0 }]
        ], WARRIOR_REST),
        hit: hitClip(WARRIOR_REST),
        death: deathClip(WARRIOR_REST)
    }
}

// ═══════════════════════════════════════════════════════════════ Barbarian (elite)
// Bare-chested under a fur mantle, a horned iron cap, war paint, and a double-bitted great
// axe carried over the shoulder. Every swing is a two-handed overhead chop.

const BARBARIAN_HEAD = head([
    'w..............w',
    'b..............b',
    'bB.....II.....Bb',
    '.bB..IjjJJI..Bb.',
    '..bBIjjjjJJIBb..',
    '....IjjjjjjjI...',
    '..iIIIIIIIIIIi..',
    '..hHHHHHHHHsH...',
    ...face(2, 2)
], 7, 11)

const BARBARIAN_REST = rest({ hx: 4, hy: 4, wa: -1.25, bhx: 3, bhy: 5, ffx: 4, bfx: -4 })

const barbarian: HeroArt = {
    look: chibiLook({
        accent: C.orange,
        pants: C.brown1, pantsDk: C.brown0, boot: C.bone0, bootHi: C.bone1,
        arm: C.skin1, armLow: C.skin1, armBack: C.skin0, armBackLow: C.skin0, hand: C.brown2,
        torso: (s, x, y) => {
            rect(s, x - 5, y, 10, 8, C.skin1)
            rect(s, x - 5, y, 2, 8, C.skin0)
            rect(s, x + 1, y + 2, 3, 2, C.skin2) // chest
            px(s, x, y + 4, C.skin0); px(s, x + 2, y + 4, C.skin0)
            px(s, x + 2, y + 2, C.red2); px(s, x + 3, y + 3, C.red2) // war paint
            px(s, x - 1, y + 3, C.red2)
            rect(s, x - 6, y, 11, 2, C.bone1) // wolf-fur mantle
            rect(s, x - 6, y + 2, 11, 1, C.bone0)
            px(s, x - 5, y + 3, C.bone0); px(s, x - 2, y + 3, C.bone0); px(s, x + 2, y + 3, C.bone0)
            px(s, x - 6, y, C.bone0); px(s, x - 3, y, C.white); px(s, x + 1, y, C.white)
            rect(s, x - 5, y + 5, 10, 1, C.brown0) // belt
            rect(s, x, y + 5, 2, 1, C.gold2)
            rect(s, x - 5, y + 6, 10, 2, C.brown2) // fur kilt, ragged hem
            px(s, x - 4, y + 7, C.brown1); px(s, x - 1, y + 7, C.brown1); px(s, x + 3, y + 7, C.brown1)
        },
        head: (s, x, y, p) => chibiHead(s, BARBARIAN_HEAD, x, y, p),
        weapon: (s, x, y, p) => axe(s, x, y, p[HP.wa]!, 14, M.steel, M.wood, true),
        backArmFront: true,
        fx: (dst, p, t) => {
            if (is(p, FXK.Slash)) crescent(dst, J.fsx, J.fsy, 17, p[HP.fxa]!, p[HP.wa]!, 7, C.orange, C.white, C.lava1)
            if (is(p, FXK.SlashFade)) crescent(dst, J.fsx, J.fsy, 17, p[HP.fxa]!, p[HP.wa]!, 3, C.lava1, C.gold2, C.lava0)
            if (is(p, FXK.Slam)) slam(dst, tip.x, t, C.orange, C.brown3)
            if (is(p, FXK.Roar)) {
                aura(dst, t, FIRE, 8, 16)
                shout(dst, J.headX + 5, J.headY - 4, t, C.gold3, 1.0)
            }
        }
    }),
    clips: {
        idle: hclip('idle', 1.4, true, [
            [0, {}], [0.7, { crouch: 1, hy: 5, bhy: 6, wa: -1.2 }], [1.4, {}]
        ], BARBARIAN_REST),
        attack: hclip('attack', 1.0, false, [
            [0, {}],
            [0.1, { wa: -1.9, hx: 1, hy: -4, bhx: 1, bhy: -3, lean: -1 }, Ease.Out, CH],
            [0.3, { wa: -2.1, hx: 0, hy: -6, bhx: 0, bhy: -5, lean: -2, tilt: -1, jump: -1 }, Ease.InOut, CH],
            [0.4, { wa: 0.7, hx: 7, hy: 4, bhx: 5, bhy: 4, lean: 3, crouch: 2, tilt: 1, jump: 0, ffx: 6, mouth: 1, fxk: FXK.Slash, fxa: -2.1 }, Ease.Out, CA],
            [0.5, { wa: 1.1, hy: 6, fxk: FXK.Slam }, Ease.Out, CA],
            [0.6, { fxk: FXK.SlashFade, fxa: -0.6 }, Ease.Hold, RE],
            [0.7, { fxk: 0, mouth: 0 }, Ease.Hold, RE],
            [1.0, { wa: -1.25, hx: 4, hy: 4, bhx: 3, bhy: 5, lean: 0, crouch: 0, tilt: 0, ffx: 4 }]
        ], BARBARIAN_REST),
        // Threatening Roar: crouch and fill the lungs, then rear up, axe high, and bellow
        cast: hclip('cast', 1.6, false, [
            [0, {}],
            [0.2, { crouch: 2, tilt: 1, hx: 1, hy: 5, bhx: 1, bhy: 5, wa: -2.4, headY: 1, glow: 0.4 }, Ease.Out, CH],
            [0.4, { crouch: 3, glow: 0.6 }, Ease.InOut, CH],
            [0.5, { crouch: 0, jump: -1, tilt: -2, headY: -1, mouth: 1, hx: 7, hy: 3, wa: 0.5, bhx: -4, bhy: -7, ffx: 5, bfx: -5, glow: 1, fxk: FXK.Roar }, Ease.Back, CA],
            [1.1, { jump: 0 }, Ease.Linear, CA],
            [1.2, { fxk: 0, mouth: 0, glow: 0.3 }, Ease.Hold, RE],
            [1.6, { crouch: 0, tilt: 0, headY: 0, hx: 4, hy: 4, wa: -1.25, bhx: 3, bhy: 5, ffx: 4, bfx: -4, glow: 0 }]
        ], BARBARIAN_REST),
        hit: hitClip(BARBARIAN_REST, 0.7),
        death: deathClip(BARBARIAN_REST)
    }
}

// ═══════════════════════════════════════════════════════════════ Berserker (master)
// The barbarian gone over the edge: wild hair under a red bandana whose tails stream behind
// him, a bandaged and scarred chest, a spiked pauldron, and a hand axe in each fist. He
// never stands up straight. Enrage turns his eyes red and sets him alight.

const BERSERKER_HEAD = head([
    '.....H..h.H...',
    '....hH.hH.HH..',
    '...hHHhHHLHh..',
    '..hHHHHLLLHHH.',
    '..hHHHHHHLLHHH',
    'yxyzzzzzzzzzzy',
    'xyxhHHHHHHHsH.',
    '.x' + face()[0]!,
    '..' + face()[1]!,
    ...face(2).slice(2)
], 7, 11)

const BERSERKER_REST = rest({ hx: 4, hy: 3, wa: -0.7, bhx: 2, bhy: 3, ba: -0.5, ffx: 4, bfx: -4, crouch: 1, tilt: 1 })

const berserker: HeroArt = {
    look: chibiLook({
        accent: C.red2,
        pants: C.brown1, pantsDk: C.brown0, boot: C.brown0, bootHi: C.steel1,
        arm: C.skin1, armLow: C.bone1, armBack: C.skin0, armBackLow: C.bone0, hand: C.brown1,
        torso: (s, x, y) => {
            rect(s, x - 5, y, 10, 8, C.skin1)
            rect(s, x - 5, y, 2, 8, C.skin0)
            rect(s, x + 1, y + 1, 3, 2, C.skin2)
            line(s, x + 4, y, x - 3, y + 5, C.bone1) // bandage wrap
            line(s, x + 4, y + 2, x - 1, y + 5, C.bone0)
            px(s, x - 2, y + 1, C.red1); px(s, x - 1, y + 2, C.red1); px(s, x, y + 3, C.red1) // scar
            rect(s, x - 5, y + 5, 10, 2, C.red1) // sash
            rect(s, x - 5, y + 5, 10, 1, C.red2)
            px(s, x - 6, y + 6, C.red1); px(s, x - 7, y + 7, C.red1)
            rect(s, x - 5, y + 7, 10, 1, C.brown0)
        },
        over: (s, x, y) => {
            // spiked iron pauldron over the leading shoulder
            rect(s, x + 1, y, 5, 3, C.steel1)
            rect(s, x + 2, y, 3, 1, C.steel2)
            px(s, x + 5, y - 1, C.steel3); px(s, x + 6, y + 1, C.steel2)
        },
        head: (s, x, y, p) => chibiHead(s, BERSERKER_HEAD, x, y, p, p[HP.glow]! > 0.5 ? C.red3 : C.ink),
        // blade on the leading side: edge forward at the ready, edge first down the chop
        weapon: (s, x, y, p) => axe(s, x, y, p[HP.wa]!, 9, M.iron, M.darkwood, false, true),
        offhand: (s, x, y, p) => axe(s, x, y, p[HP.ba]!, 9, M.iron, M.darkwood, false, true),
        fx: (dst, p, t) => {
            if (is(p, FXK.Slash)) crescent(dst, J.fsx, J.fsy, 13, p[HP.fxa]!, p[HP.wa]!, 5, C.red2, C.white, C.red1)
            if (is(p, FXK.BackSlash)) crescent(dst, J.bsx, J.bsy, 14, p[HP.fxa]!, p[HP.ba]!, 5, C.red2, C.white, C.red1)
            if (is(p, FXK.SlashFade)) crescent(dst, J.bsx, J.bsy, 14, p[HP.fxa]!, p[HP.ba]!, 3, C.red1, C.red3, C.red0)
            if (is(p, FXK.Rage)) {
                aura(dst, t, BLOOD_FIRE, 8, 24)
                shout(dst, J.headX + 5, J.headY - 4, t, C.red3, 0.8)
            }
        }
    }),
    clips: {
        // a restless, snorting idle: quicker than anyone else's
        idle: hclip('idle', 0.8, true, [
            [0, {}], [0.4, { crouch: 2, hy: 4, bhy: 4, wa: -0.6, ba: -0.4, headY: 1 }], [0.8, {}]
        ], BERSERKER_REST),
        attack: hclip('attack', 0.9, false, [
            [0, {}],
            [0.1, { wa: -2.2, hx: 1, hy: -4, lean: -1, tilt: 0 }, Ease.Out, CH],
            [0.2, { wa: 0.7, hx: 8, hy: 3, lean: 2, tilt: 2, fxk: FXK.Slash, fxa: -2.2 }, Ease.Out, CA],
            [0.3, { fxk: 0, ba: -2.2, bhx: 2, bhy: -4 }, Ease.InOut, CH],
            [0.4, { ba: 0.7, bhx: 13, bhy: 3, lean: 3, wa: 1.0, hx: 3, hy: 5, ffx: 6, fxk: FXK.BackSlash, fxa: -2.2 }, Ease.Out, CA],
            [0.5, { fxk: FXK.SlashFade, fxa: -0.6 }, Ease.Hold, RE],
            [0.6, { fxk: 0 }, Ease.Hold, RE],
            [0.9, { wa: -0.7, hx: 4, hy: 3, ba: -0.5, bhx: 2, bhy: 3, lean: 0, tilt: 1, ffx: 4 }]
        ], BERSERKER_REST),
        // Enrage: hunch low, then rear up screaming with both axes high as the blood-fire takes him
        cast: hclip('cast', 1.8, false, [
            [0, {}],
            [0.2, { crouch: 3, tilt: 2, hx: 2, hy: 6, bhx: 1, bhy: 6, headY: 1, glow: 0.4 }, Ease.Out, CH],
            [0.5, { crouch: 3, tilt: 3, glow: 0.6 }, Ease.InOut, CH],
            [0.6, { crouch: -1, tilt: -2, headY: -1, mouth: 1, hx: 5, hy: -6, wa: -1.2, bhx: -1, bhy: -7, ba: -1.9, ffx: 5, bfx: -5, glow: 1, fxk: FXK.Rage }, Ease.Back, CA],
            [1.3, { crouch: 0 }, Ease.Linear, CA],
            [1.4, { fxk: 0, mouth: 0 }, Ease.Hold, RE],
            [1.8, { crouch: 1, tilt: 1, headY: 0, hx: 4, hy: 3, wa: -0.7, bhx: 2, bhy: 3, ba: -0.5, ffx: 4, bfx: -4, glow: 0 }]
        ], BERSERKER_REST),
        hit: hitClip(BERSERKER_REST, 0.8),
        death: deathClip(BERSERKER_REST, { ba: 0.4 })
    }
}

// ═══════════════════════════════════════════════════════════════ Knight (elite)
// Steel plate over a blue tabard, a rounded bascinet with cheek guards and a blue plume, a
// longsword and a heater shield carried in front. Shockwave is a leap and a blade driven into
// the ground.

const KNIGHT_HEAD = head([
    '.aAe........',
    'aAAee.......',
    'aa.AeJJ.....',
    '...IjjJJI...',
    '..IjjjjJJI..',
    '.IjjjjjjjjI.',
    'iIIgGGGGGgIi',
    'IjjIHHHHHsH.',
    'IjjjHsSSSkS.',
    'IjjjdsSSSkSs',
    '.IjjssSbbSS.',
    '.iIjssSSSSS.',
    '..ohsssSSs..',
    '.....ddd....'
], 5, 9)

const KNIGHT_REST = rest({ hx: 3, hy: 4, wa: -1.3, bhx: 3, bhy: 4, ffx: 3, bfx: -3 })

const knight: HeroArt = {
    look: chibiLook({
        accent: C.cyan,
        pants: C.steel1, pantsDk: C.steel0, boot: C.steel0, bootHi: C.steel2,
        arm: C.steel2, armLow: C.steel1, armBack: C.steel1, armBackLow: C.steel0, hand: C.steel1,
        torso: (s, x, y) => {
            rect(s, x - 5, y, 10, 8, C.steel2)
            rect(s, x - 5, y, 2, 8, C.steel1)
            rect(s, x + 3, y + 1, 1, 3, C.steel3)
            rect(s, x - 1, y + 1, 4, 7, C.blue1) // tabard
            rect(s, x + 1, y + 2, 1, 5, C.blue2)
            rect(s, x - 1, y + 1, 4, 1, C.gold1)
            px(s, x + 1, y + 3, C.gold2)
            rect(s, x - 5, y + 5, 10, 1, C.brown1) // sword belt
            px(s, x - 1, y + 5, C.gold2)
            rect(s, x - 5, y + 7, 10, 1, C.steel1) // tassets
            px(s, x - 4, y + 7, C.steel3); px(s, x - 2, y + 7, C.steel3)
        },
        over: (s, x, y) => {
            // a rounded plate on the sword shoulder; the chin sits on row y + 1, so it starts below
            rect(s, x + 2, y + 2, 4, 1, C.steel3)
            rect(s, x + 1, y + 3, 6, 1, C.steel2)
            rect(s, x + 1, y + 4, 6, 1, C.steel1)
            px(s, x + 3, y + 3, C.gold2)
            // the shield is carried in front, so it goes on last, over the plate
            shield(s, J.bhx + 1, J.bhy + 1, ShieldStyle.Heater, M.steel, [C.blue0, C.blue1, C.blue2], C.gold2)
        },
        head: (s, x, y, p) => chibiHead(s, KNIGHT_HEAD, x, y, p),
        weapon: (s, x, y, p) => sword(s, x, y, p[HP.wa]!, 15, M.steel, M.gold, C.brown0),
        fx: (dst, p, t) => {
            if (is(p, FXK.Slash)) crescent(dst, J.fsx, J.fsy, 16, p[HP.fxa]!, p[HP.wa]!, 6, C.blue2, C.white, C.blue1)
            if (is(p, FXK.SlashFade)) crescent(dst, J.fsx, J.fsy, 16, p[HP.fxa]!, p[HP.wa]!, 3, C.blue1, C.cyan, C.blue0)
            if (is(p, FXK.Rage)) aura(dst, t, FROST, 7, 16)
            if (is(p, FXK.Slam)) {
                slam(dst, tip.x, t, C.cyan, C.steel3)
                aura(dst, t, FROST, 8, 12)
            }
        }
    }),
    clips: {
        idle: hclip('idle', 1.4, true, [[0, {}], [0.7, { crouch: 1, hy: 5, bhy: 5, wa: -1.25 }], [1.4, {}]], KNIGHT_REST),
        attack: hclip('attack', 0.9, false, [
            [0, {}],
            [0.1, { wa: -2.3, hx: 0, hy: -3, lean: -1 }, Ease.Out, CH],
            [0.3, { wa: -2.7, hx: -2, hy: -5, crouch: 1 }, Ease.InOut, CH],
            [0.4, { wa: 0.2, hx: 8, hy: 2, lean: 2, ffx: 5, crouch: 0, fxk: FXK.Slash, fxa: -2.7 }, Ease.Out, CA],
            [0.5, { wa: 0.7, hx: 7, hy: 4, crouch: 1 }, Ease.Out, CA],
            [0.6, { fxk: FXK.SlashFade, fxa: -1.2 }, Ease.Hold, RE],
            [0.7, { fxk: 0 }, Ease.Hold, RE],
            [0.9, { wa: -1.3, hx: 3, hy: 4, lean: 0, crouch: 0, ffx: 3 }]
        ], KNIGHT_REST),
        // Shockwave: shield up, leap with the blade raised, and drive it into the ground
        cast: hclip('cast', 1.6, false, [
            [0, {}],
            [0.2, { crouch: 2, hx: 2, hy: -5, wa: -1.57, bhx: 4, bhy: 1, glow: 0.5, fxk: FXK.Rage }, Ease.Out, CH],
            [0.4, { crouch: 0, jump: -7, ffy: 2, bfy: 3, glow: 0.8 }, Ease.Out, CH],
            [0.6, { jump: -8, hy: -7 }, Ease.InOut, CH],
            [0.7, { jump: 0, crouch: 3, kneel: 1, ffy: 0, bfy: 0, hx: 7, hy: 6, wa: 1.45, bhx: 5, bhy: 3, glow: 1, mouth: 1, fxk: FXK.Slam }, Ease.In, CA],
            [1.2, {}, Ease.Linear, CA],
            [1.3, { fxk: 0, mouth: 0, glow: 0.3 }, Ease.Hold, RE],
            [1.6, { crouch: 0, kneel: 0, hx: 3, hy: 4, wa: -1.3, bhx: 3, bhy: 4, glow: 0 }]
        ], KNIGHT_REST),
        hit: hitClip(KNIGHT_REST, 0.6),
        death: deathClip(KNIGHT_REST)
    }
}

// ═══════════════════════════════════════════════════════════════ Paladin (master)
// A holy knight, not a Norseman: a steel helm with a gold cross on the brow, white-and-gold
// plate, a crimson cape, a flanged gold mace and a white heater shield with a gold cross,
// carried in front. Disciple: he kneels to pray, then raises the mace into a column of light.

const PALADIN_HEAD = head([
    '.....GYG....',
    '...IjjjjJI..',
    '..IjjjjjGJI.',
    '.IjjjjjGYGJI',
    '.IjjjjjjGJJI',
    'iIgGGGGGGGgI',
    'IjjIHHHHHsH.',
    'IjjjHsSSSkS.',
    'IjjjdsSSSkSs',
    '.IjjssSbbSS.',
    '.iIjssSSSSS.',
    '..ohsssSSs..',
    '.....ddd....'
], 5, 9)

const WHITE: Mat = [C.bone0, C.bone1, C.white]

const PALADIN_REST = rest({ hx: 4, hy: 4, wa: -1.2, bhx: 3, bhy: 4, ffx: 3, bfx: -3 })

const paladin: HeroArt = {
    look: chibiLook({
        accent: C.gold3,
        pants: C.steel2, pantsDk: C.steel1, boot: C.gold1, bootHi: C.gold2,
        arm: C.steel3, armLow: C.steel2, armBack: C.steel2, armBackLow: C.steel1, hand: C.gold1,
        back: (s, x, y, _p, t) => chibiCape(s, x, y - 1, 13, t, C.red1, C.red0, C.red2),
        torso: (s, x, y) => {
            rect(s, x - 5, y, 10, 8, C.steel3)
            rect(s, x - 5, y, 2, 8, C.steel2)
            rect(s, x + 2, y + 1, 2, 2, C.white)
            rect(s, x, y + 1, 1, 5, C.gold2) // the sun cross
            rect(s, x - 1, y + 2, 3, 1, C.gold2)
            px(s, x, y + 2, C.gold3)
            rect(s, x - 5, y + 5, 10, 1, C.gold1) // belt
            px(s, x, y + 5, C.cyan)
            rect(s, x - 5, y + 6, 10, 2, C.white) // tabard skirt
            rect(s, x - 5, y + 6, 2, 2, C.steel2)
            rect(s, x - 1, y + 7, 3, 1, C.gold2)
        },
        over: (s, x, y) => {
            // a big layered pauldron, white plate on a gold rim, clear of the chin
            rect(s, x + 2, y + 2, 4, 1, C.white)
            rect(s, x + 1, y + 3, 6, 1, C.steel3)
            rect(s, x + 1, y + 4, 6, 1, C.gold2)
            px(s, x + 3, y + 3, C.gold3)
            shield(s, J.bhx + 1, J.bhy + 1, ShieldStyle.Heater, M.gold, WHITE, C.gold2)
        },
        head: (s, x, y, p) => chibiHead(s, PALADIN_HEAD, x, y, p, p[HP.glow]! > 0.5 ? C.gold2 : C.ink),
        weapon: (s, x, y, p) => flangedMace(s, x, y, p[HP.wa]!, 8, M.gold, M.darkwood),
        fx: (dst, p, t) => {
            if (is(p, FXK.Slash)) crescent(dst, J.fsx, J.fsy, 17, p[HP.fxa]!, p[HP.wa]!, 6, C.gold2, C.white, C.gold1)
            if (is(p, FXK.SlashFade)) crescent(dst, J.fsx, J.fsy, 17, p[HP.fxa]!, p[HP.wa]!, 3, C.gold1, C.gold3, C.gold0)
            if (is(p, FXK.Slam)) {
                slam(dst, tip.x, t, C.gold2, C.gold3)
                pop(dst, tip.x, tip.y, step(t, 10, 2), C.gold3)
            }
            if (is(p, FXK.Pray)) {
                // motes of light drifting down onto his bowed head
                const k = step(t, 10, 8)
                for (let i = 0; i < 6; i++) {
                    const x = J.bx - 8 + ((i * 5) % 17)
                    const y = J.headY - 22 + ((i * 7 + k * 2) % 18)
                    dst.set(fxX(x), fxY(y), i & 1 ? C.gold3 : C.white)
                }
            }
            if (is(p, FXK.Holy)) {
                lightColumn(dst, tip.x, tip.y, t, HOLY, 3)
                aura(dst, t, HOLY, 9, 18)
            }
        }
    }),
    clips: {
        idle: hclip('idle', 1.4, true, [[0, {}], [0.7, { crouch: 1, hy: 5, bhy: 5, wa: -1.15 }], [1.4, {}]], PALADIN_REST),
        attack: hclip('attack', 1.0, false, [
            [0, {}],
            [0.1, { wa: -2.3, hx: 0, hy: -3, lean: -1, crouch: 1 }, Ease.Out, CH],
            [0.3, { wa: -2.8, hx: -2, hy: -5, lean: -2, crouch: 1, glow: 0.5 }, Ease.InOut, CH],
            [0.4, { wa: 0.3, hx: 7, hy: 3, lean: 2, crouch: 1, ffx: 5, glow: 1, fxk: FXK.Slash, fxa: -2.8 }, Ease.Out, CA],
            [0.5, { wa: 0.9, hx: 6, hy: 5, crouch: 2, fxk: FXK.Slam }, Ease.Out, CA],
            [0.6, { fxk: FXK.SlashFade, fxa: -0.8 }, Ease.Hold, RE],
            [0.7, { fxk: 0 }, Ease.Hold, RE],
            [1.0, { wa: -1.2, hx: 4, hy: 4, lean: 0, crouch: 0, ffx: 3, glow: 0 }]
        ], PALADIN_REST),
        // Disciple: kneel in prayer, then stand and raise the mace into a column of light
        cast: hclip('cast', 2.0, false, [
            [0, {}],
            [0.2, { kneel: 1, crouch: 3, hx: 5, hy: 3, wa: 1.57, bhx: 7, bhy: 2, headY: 1, glow: 0.3, fxk: FXK.Pray }, Ease.Out, CH],
            [0.7, { glow: 0.6 }, Ease.InOut, CH],
            [0.8, { kneel: 0, crouch: 0, jump: -1, hx: 5, hy: -6, wa: -1.57, bhx: -2, bhy: 1, headY: -1, mouth: 1, glow: 1, fxk: FXK.Holy }, Ease.Out, CA],
            [1.5, { jump: 0 }, Ease.Linear, CA],
            [1.6, { fxk: 0, mouth: 0, glow: 0.4 }, Ease.Hold, RE],
            [2.0, { hx: 4, hy: 4, wa: -1.2, bhx: 3, bhy: 4, headY: 0, glow: 0 }]
        ], PALADIN_REST),
        hit: hitClip(PALADIN_REST, 0.6),
        death: deathClip(PALADIN_REST)
    }
}

export const WARRIOR_LINE: Readonly<Record<string, HeroArt>> = {
    class_beginner: beginner,
    class_warrior: warrior,
    class_barbarian: barbarian,
    class_berserker: berserker,
    class_knight: knight,
    class_paladin: paladin
}
