// The Archer line on the chibi body: Archer → Bowman → Marksman, Archer → Hunter → Beast
// Master.
//
// The novice has a short bow and the Beginner's tunic under a hand-me-down cloak. One branch
// goes to longer bows and better hats; the other pulls up a hood and ends up wearing a wolf.

import { Ease, step } from './anim'
import { C } from './palette'
import { line, px, rect, type Surface } from './surface'
import { HP, J, fxX, fxY, hclip, hitClip, deathClip, rest } from './rig'
import { chibiHead, face, head, ROOKIE_HEAD } from './chibi'
import { M } from './weapons'
import { CH, CA, RE, is, chibiLook, chibiCape, aura, loose, bowAttack, bowPainter, crossbowPainter, shout, GILT, MOON, POISON } from './hero-kit'
import type { HeroArt } from './heroes'

/** Scene effects a keyframe can call for, through the `fxk` pose parameter. */
const enum FXK { None, Release, Aim, BigRelease, Fan, Volley, Whistle, Call }

/** A quiver slung across the back, fletching showing over the shoulder. */
function quiver(s: Surface, x: number, y: number, body: number, fletch: number): void {
    line(s, x - 6, y, x - 3, y + 8, body, 3)
    px(s, x - 7, y - 2, fletch); px(s, x - 6, y - 3, fletch); px(s, x - 5, y - 2, C.bone1)
}

/** Charge gathering on the nocked arrowhead: six motes closing in on it. */
function aimFx(dst: Surface, t: number, c0: number, c1: number, dx = 9, dy = 0): void {
    const k = step(t, 10, 3)
    const x = J.hx + dx
    const y = J.hy + dy
    for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + k * 0.5
        const d = 7 - k * 2
        dst.set(fxX(Math.round(x + Math.cos(a) * d)), fxY(Math.round(y + Math.sin(a) * d)), i & 1 ? c0 : c1)
    }
    dst.set(fxX(x), fxY(y), C.white)
}

// ═══════════════════════════════════════════════════════════════ Archer (base)
// The Beginner's tunic under a leather vest, a green cloak with its hood down, a quiver and
// a plain wooden short bow.

const ARCHER_REST = rest({ hx: 5, hy: 3, wa: 0.35, bhx: 1, bhy: 5, ffx: 3, bfx: -3 })

const archer: HeroArt = {
    look: chibiLook({
        accent: C.green4,
        armLow: C.skin1, armBackLow: C.skin0,
        back: (s, x, y, _p, t) => {
            chibiCape(s, x, y, 10, t, C.green1, C.green0, C.green2)
            quiver(s, x, y, C.brown1, C.red2)
            rect(s, x - 7, y - 2, 5, 3, C.green2) // the hood, down
            px(s, x - 7, y, C.green1)
        },
        torso: (s, x, y) => {
            rect(s, x - 5, y, 10, 8, C.bone1)
            rect(s, x - 5, y, 2, 8, C.bone0)
            rect(s, x - 3, y + 1, 3, 4, C.brown2) // leather vest
            rect(s, x + 2, y + 1, 2, 4, C.brown2)
            px(s, x - 2, y + 2, C.brown3)
            rect(s, x, y, 2, 1, C.skin1)
            line(s, x + 3, y, x - 3, y + 5, C.brown1) // quiver strap
            rect(s, x - 5, y + 5, 10, 1, C.brown1)
            px(s, x + 1, y + 5, C.gold2)
            rect(s, x - 5, y + 7, 10, 1, C.bone0)
        },
        head: (s, x, y, p) => chibiHead(s, ROOKIE_HEAD, x, y, p),
        weapon: bowPainter(M.wood, 7),
        fx: (dst, p, t) => {
            if (is(p, FXK.Release)) loose(dst, p[HP.wa]!, C.bone1, false)
            if (is(p, FXK.Aim)) {
                aimFx(dst, t, C.green3, C.green4)
                aura(dst, t, POISON, 7, 12)
            }
            if (is(p, FXK.BigRelease)) loose(dst, p[HP.wa]!, C.green3, true)
        }
    }),
    clips: {
        idle: hclip('idle', 1.2, true, [[0, {}], [0.6, { crouch: 1, hy: 4, bhy: 6 }], [1.2, {}]], ARCHER_REST),
        attack: bowAttack(ARCHER_REST, 1, FXK.Release),
        // Piercing Arrow: set the feet, a long draw while the head charges, then a punching release
        cast: hclip('cast', 1.6, false, [
            [0, {}],
            [0.2, { wa: 0, hx: 8, hy: 0, bhx: 9, bhy: 0, crouch: 2, ffx: 5, bfx: -4, aux: 0.1 }, Ease.Out, CH],
            [0.4, { aux: 1, bhx: 2, glow: 0.8, fxk: FXK.Aim }, Ease.InOut, CH],
            [0.9, { glow: 1 }, Ease.Linear, CH],
            [1.0, { aux: 0, bhx: -2, lean: -2, fxk: FXK.BigRelease }, Ease.Hold, CA],
            [1.1, { fxk: 0 }, Ease.Hold, RE],
            [1.6, { wa: 0.35, hx: 5, hy: 3, bhx: 1, bhy: 5, crouch: 0, ffx: 3, bfx: -3, lean: 0, glow: 0 }]
        ], ARCHER_REST),
        hit: hitClip(ARCHER_REST),
        death: deathClip(ARCHER_REST)
    }
}

// ═══════════════════════════════════════════════════════════════ Bowman (elite)
// A peaked green cap with a long red feather, a green jerkin under a scalloped capelet, and
// a middle-sized bow, a step up from the short bow.

const BOWMAN_HEAD = head([
    '..z.........',
    '...z........',
    '...zz.......',
    '....zNNN....',
    '...nNNmNNN..',
    '..nNNNNNNNNN',
    '.nnnnnnnnnn.',
    'hHHHHHHHHsH.',
    ...face()
], 5, 9)

const BOWMAN_REST = rest({ hx: 5, hy: 3, wa: 0.35, bhx: 1, bhy: 5, ffx: 3, bfx: -3 })

const bowman: HeroArt = {
    look: chibiLook({
        accent: C.green4,
        pants: C.brown1, pantsDk: C.brown0, boot: C.brown0, bootHi: C.brown3,
        arm: C.green2, armLow: C.brown2, armBack: C.green1, armBackLow: C.brown1,
        back: (s, x, y) => quiver(s, x, y, C.brown2, C.white),
        torso: (s, x, y) => {
            rect(s, x - 5, y, 10, 8, C.green2)
            rect(s, x - 5, y, 2, 8, C.green1)
            rect(s, x + 2, y + 3, 2, 2, C.green3)
            rect(s, x - 6, y - 1, 11, 3, C.green1) // capelet, scalloped
            px(s, x - 5, y + 2, C.green1); px(s, x - 2, y + 2, C.green1); px(s, x + 1, y + 2, C.green1); px(s, x + 4, y + 2, C.green1)
            rect(s, x - 5, y - 1, 9, 1, C.green2)
            px(s, x + 1, y, C.gold2) // clasp
            rect(s, x - 5, y + 5, 10, 1, C.brown1)
            px(s, x + 1, y + 5, C.gold2)
        },
        head: (s, x, y, p) => chibiHead(s, BOWMAN_HEAD, x, y, p),
        weapon: bowPainter(M.wood, 11),
        fx: (dst, p, t) => {
            if (is(p, FXK.Release)) loose(dst, p[HP.wa]!, C.bone1, false)
            if (is(p, FXK.Aim)) {
                aimFx(dst, t, C.green3, C.green4)
                aura(dst, t, POISON, 7, 14)
            }
            if (is(p, FXK.Fan)) {
                const a = p[HP.wa]!
                for (let i = -1; i <= 1; i++) loose(dst, a + i * 0.3, i === 0 ? C.green3 : C.green4, i === 0)
            }
        }
    }),
    clips: {
        idle: hclip('idle', 1.3, true, [[0, {}], [0.65, { crouch: 1, hy: 4, bhy: 6 }], [1.3, {}]], BOWMAN_REST),
        attack: bowAttack(BOWMAN_REST, 1, FXK.Release),
        // Fan of Arrows: aim high, nock three at once, loose them in a spread
        cast: hclip('cast', 1.6, false, [
            [0, {}],
            [0.2, { wa: -0.35, hx: 7, hy: -2, bhx: 8, bhy: -2, aux: 0.1, lean: -1 }, Ease.Out, CH],
            [0.4, { aux: 1, bhx: 2, glow: 0.8, fxk: FXK.Aim }, Ease.InOut, CH],
            [0.9, { glow: 1 }, Ease.Linear, CH],
            [1.0, { aux: 0, bhx: -2, bhy: -3, lean: -2, fxk: FXK.Fan }, Ease.Hold, CA],
            [1.1, { fxk: 0 }, Ease.Hold, RE],
            [1.6, { wa: 0.35, hx: 5, hy: 3, bhx: 1, bhy: 5, lean: 0, glow: 0, aux: 0 }]
        ], BOWMAN_REST),
        hit: hitClip(BOWMAN_REST),
        death: deathClip(BOWMAN_REST)
    }
}

// ═══════════════════════════════════════════════════════════════ Marksman (master)
// A charcoal wide-brimmed hat with a white plume, a long teal duster whose tails reach his
// boots, a red scarf, and a gilded longbow taller than he is. He takes every shot from one knee.

const MARKSMAN_HEAD = head([
    'w.............',
    '.w...5556.....',
    '..w.455666....',
    '...w4555665...',
    '....4gGGGg5...',
    '4455555555556.',
    '.hHHHHHHHHsH..',
    ...face(1, 1)
], 6, 10)

// the longbow is carried slanted, so its lower tip stays clear of the ground
const MARKSMAN_REST = rest({ hx: 5, hy: 2, wa: 0.75, bhx: 1, bhy: 5, ffx: 3, bfx: -3 })
const GILDED = [C.gold0, C.gold1, C.gold2] as const

const marksman: HeroArt = {
    look: chibiLook({
        accent: C.gold3,
        pants: C.stone2, pantsDk: C.stone1, boot: C.brown0, bootHi: C.brown2,
        arm: C.teal1, armLow: C.teal1, armBack: C.teal0, armBackLow: C.teal0,
        back: (s, x, y, _p, t) => {
            quiver(s, x, y, C.brown0, C.gold2)
            // the scarf's tail streaming back off his neck
            const f = step(t, 3, 2)
            rect(s, x - 8, y - 1 + f, 4, 2, C.red1)
            px(s, x - 9, y + f, C.red1)
        },
        torso: (s, x, y) => {
            rect(s, x - 5, y, 10, 8, C.teal1)
            rect(s, x - 5, y, 2, 8, C.teal0)
            rect(s, x + 2, y + 1, 2, 5, C.teal2)
            rect(s, x - 1, y + 1, 2, 7, C.stone1) // the shirt, between the lapels
            rect(s, x - 3, y - 1, 6, 2, C.red2) // scarf
            px(s, x - 3, y, C.red1)
            rect(s, x - 5, y + 5, 10, 1, C.brown0)
            px(s, x + 1, y + 5, C.gold2)
            // duster tails to the boots, the back one longer
            rect(s, x - 6, y + 8, 4, 4, C.teal1)
            rect(s, x - 6, y + 8, 1, 4, C.teal0)
            rect(s, x + 2, y + 8, 3, 2, C.teal1)
            px(s, x + 4, y + 8, C.teal2)
        },
        head: (s, x, y, p) => chibiHead(s, MARKSMAN_HEAD, x, y, p, p[HP.glow]! > 0.5 ? C.gold2 : C.ink),
        weapon: bowPainter(GILDED, 15, C.gold3),
        fx: (dst, p, t) => {
            if (is(p, FXK.Release)) loose(dst, p[HP.wa]!, C.gold3, false)
            if (is(p, FXK.Aim)) {
                aimFx(dst, t, C.gold2, C.gold3, 7, -5)
                aura(dst, t, GILT, 8, 16)
            }
            if (is(p, FXK.Volley)) {
                // a sheaf of arrows going up together
                const a = p[HP.wa]!
                for (let i = 0; i < 3; i++) loose(dst, a + (i - 1) * 0.12, i === 1 ? C.gold3 : C.gold2, i === 1)
            }
        }
    }),
    clips: {
        idle: hclip('idle', 1.4, true, [[0, {}], [0.7, { crouch: 1, hy: 3, bhy: 6 }], [1.4, {}]], MARKSMAN_REST),
        // the kneeling precision shot
        attack: hclip('attack', 1.0, false, [
            [0, {}],
            [0.1, { kneel: 1, crouch: 3, wa: -0.25, hx: 8, hy: -3, bhx: 9, bhy: -3, aux: 0.1, ffx: 5 }, Ease.Out, CH],
            [0.3, { aux: 1, bhx: 3 }, Ease.InOut, CH],
            [0.4, { aux: 0, bhx: -1, bhy: -4, fxk: FXK.Release, lean: -1 }, Ease.Hold, CA],
            [0.5, { fxk: 0 }, Ease.Hold, RE],
            [0.7, {}, Ease.Linear],
            [1.0, { kneel: 0, crouch: 0, wa: 0.75, hx: 5, hy: 2, bhx: 1, bhy: 5, ffx: 3, lean: 0, aux: 0 }]
        ], MARKSMAN_REST),
        // Arrow Rain: aim steeply skyward and empty the quiver in two sheaves
        cast: hclip('cast', 1.8, false, [
            [0, {}],
            [0.2, { wa: -1.1, hx: 4, hy: -5, bhx: 6, bhy: -5, aux: 0.1, lean: -2, tilt: -1 }, Ease.Out, CH],
            [0.4, { aux: 1, bhx: 1, bhy: -2, glow: 0.8, fxk: FXK.Aim }, Ease.InOut, CH],
            [0.8, { glow: 1 }, Ease.Linear, CH],
            [0.9, { aux: 0, bhx: -2, bhy: 0, fxk: FXK.Volley }, Ease.Hold, CA],
            [1.0, { aux: 0.8, bhx: 2, bhy: -2, fxk: 0 }, Ease.Out, CA],
            [1.1, { aux: 0, bhx: -2, bhy: 0, fxk: FXK.Volley }, Ease.Hold, CA],
            [1.2, { fxk: 0 }, Ease.Hold, RE],
            [1.8, { wa: 0.75, hx: 5, hy: 2, bhx: 1, bhy: 5, lean: 0, tilt: 0, glow: 0, aux: 0 }]
        ], MARKSMAN_REST),
        hit: hitClip(MARKSMAN_REST),
        death: deathClip(MARKSMAN_REST)
    }
}

// ═══════════════════════════════════════════════════════════════ Hunter (elite)
// A fox-eared hood up over his hair, fur-trimmed leathers, a bolt case and a steel-prodded
// crossbow, the Hunter branch's mark against the Bowman branch's bows. Basic Attack looses three
// (strikesPerAttack 3).

const HUNTER_HEAD = head([
    '.bO....bO...',
    '.OOO..OOO...',
    '.qOOOOOOOO..',
    'qOOOOOOOOOO.',
    'qOOOOOOOOOOO',
    'qOOOObHHHsO.',
    'qOOOHsSSSkS.',
    'qqOOdsSSSkSs',
    '.qOOssSbbSS.',
    '.qqOssSSSSS.',
    '..qOsssSSs..',
    '.....ddd....'
], 5, 9)

const HUNTER_REST = rest({ hx: 5, hy: 3, wa: 0.35, bhx: 1, bhy: 5, ffx: 3, bfx: -3 })

const hunter: HeroArt = {
    look: chibiLook({
        accent: C.orange,
        pants: C.brown1, pantsDk: C.brown0, boot: C.brown0, bootHi: C.bone0,
        arm: C.brown2, armLow: C.brown3, armBack: C.brown1, armBackLow: C.brown2, hand: C.skin1,
        back: (s, x, y) => {
            line(s, x - 6, y, x - 3, y + 8, C.brown1, 3) // bolt case
            px(s, x - 7, y - 2, C.red2); px(s, x - 6, y - 3, C.red2); px(s, x - 5, y - 2, C.bone1)
        },
        torso: (s, x, y) => {
            rect(s, x - 5, y, 10, 8, C.brown2)
            rect(s, x - 5, y, 2, 8, C.brown1)
            rect(s, x + 2, y + 1, 2, 4, C.brown3)
            rect(s, x - 5, y - 1, 10, 2, C.orange) // fur collar
            px(s, x - 3, y + 1, C.bone1); px(s, x + 3, y, C.bone1)
            line(s, x - 4, y, x + 3, y + 5, C.brown0) // quiver strap
            rect(s, x - 5, y + 5, 10, 1, C.brown0)
            px(s, x + 1, y + 5, C.gold2)
        },
        head: (s, x, y, p) => chibiHead(s, HUNTER_HEAD, x, y, p),
        weapon: crossbowPainter(M.darkwood, M.steel),
        fx: (dst, p, t) => {
            if (is(p, FXK.Release)) loose(dst, p[HP.wa]!, C.orange, false)
            if (is(p, FXK.BigRelease)) loose(dst, p[HP.wa]!, C.red2, true)
            if (is(p, FXK.Aim)) aimFx(dst, t, C.red3, C.white)
        }
    }),
    clips: {
        idle: hclip('idle', 1.2, true, [[0, {}], [0.6, { crouch: 1, hy: 4, bhy: 6 }], [1.2, {}]], HUNTER_REST),
        attack: bowAttack(HUNTER_REST, 3, FXK.Release),
        // Kill Shot: drop to a knee, draw long while the arrowhead charges, loose one
        cast: hclip('cast', 1.8, false, [
            [0, {}],
            [0.2, { wa: -0.05, hx: 8, hy: 0, bhx: 9, bhy: 0, crouch: 3, kneel: 1, ffx: 5, aux: 0.1 }, Ease.Out, CH],
            [0.5, { aux: 1, bhx: 2, glow: 0.8, fxk: FXK.Aim }, Ease.InOut, CH],
            [1.0, { glow: 1 }, Ease.Linear, CH],
            [1.1, { aux: 0, bhx: -2, lean: -2, fxk: FXK.BigRelease }, Ease.Hold, CA],
            [1.2, { fxk: 0 }, Ease.Hold, RE],
            [1.8, { wa: 0.35, hx: 5, hy: 3, bhx: 1, bhy: 5, crouch: 0, kneel: 0, ffx: 3, lean: 0, glow: 0 }]
        ], HUNTER_REST),
        hit: hitClip(HUNTER_REST),
        death: deathClip(HUNTER_REST)
    }
}

// ═══════════════════════════════════════════════════════════════ Beast Master (master)
// A wolf's pelt worn as a cloak with its head for a hood — ears up, snout and teeth over his
// brow, a gold glass eye — a claw charm, a horn at the belt, and a crossbow with a prod of
// bone. The Wolf itself is a summon (summons.ts). Basic Attack looses four (strikesPerAttack 4).

const WOLF_HOOD = face(0, 4).map((row, i) => i < 3 ? '5' + row.slice(1) : row)

const BEAST_HEAD = head([
    '.7....7.........',
    '.67..67.........',
    '56666666........',
    '5666666666......',
    '56666Y666667777k',
    '566666666667777.',
    '5666666666.w.w..',
    '5hHHHHHHHHsH....',
    ...WOLF_HOOD
], 5, 9)

const BONE = [C.bone0, C.bone1, C.white] as const

const BEAST_REST = rest({ hx: 5, hy: 3, wa: 0.35, bhx: 1, bhy: 5, ffx: 3, bfx: -3 })

const beastMaster: HeroArt = {
    look: chibiLook({
        accent: C.steel3,
        pants: C.brown1, pantsDk: C.brown0, boot: C.stone1, bootHi: C.stone3,
        arm: C.brown2, armLow: C.skin1, armBack: C.brown1, armBackLow: C.skin0,
        back: (s, x, y, _p, t) => {
            chibiCape(s, x, y - 1, 13, t, C.stone2, C.stone1, C.stone3)
            // the tail, tufted
            const f = step(t, 3, 2)
            rect(s, x - 11 - f, y + 10, 3, 2, C.stone2)
            px(s, x - 12 - f, y + 11, C.stone3)
        },
        torso: (s, x, y) => {
            rect(s, x - 5, y, 10, 8, C.brown2)
            rect(s, x - 5, y, 2, 8, C.brown1)
            rect(s, x + 2, y + 1, 2, 4, C.brown3)
            rect(s, x - 6, y - 1, 11, 2, C.stone3) // pelt over the shoulders
            px(s, x - 4, y + 1, C.stone2); px(s, x + 2, y + 1, C.stone2)
            px(s, x - 1, y + 2, C.bone1); px(s, x, y + 3, C.white); px(s, x + 1, y + 2, C.bone1) // claw charm
            rect(s, x - 5, y + 5, 10, 1, C.brown0)
            rect(s, x - 4, y + 6, 4, 1, C.bone1) // horn at the belt
            px(s, x - 5, y + 5, C.bone0); px(s, x, y + 6, C.gold2)
        },
        head: (s, x, y, p) => chibiHead(s, BEAST_HEAD, x, y, p, p[HP.glow]! > 0.5 ? C.steel3 : C.ink),
        weapon: crossbowPainter(M.wood, BONE, C.bone1),
        fx: (dst, p, t) => {
            if (is(p, FXK.Release)) loose(dst, p[HP.wa]!, C.steel3, false)
            if (is(p, FXK.Whistle)) shout(dst, J.headX + 6, J.headY - 3, t, C.steel3, 0.6)
            if (is(p, FXK.Call)) {
                aura(dst, t, MOON, 8, 18)
                shout(dst, J.bhx + 3, J.bhy, t, C.frost, 0.7)
            }
        }
    }),
    clips: {
        idle: hclip('idle', 1.3, true, [[0, {}], [0.65, { crouch: 1, hy: 4, bhy: 6 }], [1.3, {}]], BEAST_REST),
        attack: bowAttack(BEAST_REST, 4, FXK.Release),
        // Man's Best Friend: fingers to his lips and a long whistle, then point the wolf in
        cast: hclip('cast', 1.6, false, [
            [0, {}],
            [0.2, { bhx: 8, bhy: -3, headY: 0, crouch: 1, glow: 0.4 }, Ease.Out, CH],
            [0.3, { fxk: FXK.Whistle }, Ease.Hold, CH],
            [0.8, { fxk: 0 }, Ease.Hold, CH],
            [0.9, { bhx: 13, bhy: 0, lean: 2, tilt: 1, ffx: 5, bfx: -5, mouth: 1, glow: 1, fxk: FXK.Call }, Ease.Out, CA],
            [1.3, { fxk: 0, mouth: 0 }, Ease.Hold, RE],
            [1.6, { bhx: 1, bhy: 5, lean: 0, tilt: 0, ffx: 3, bfx: -3, crouch: 0, glow: 0 }]
        ], BEAST_REST),
        hit: hitClip(BEAST_REST),
        death: deathClip(BEAST_REST)
    }
}

export const ARCHER_LINE: Readonly<Record<string, HeroArt>> = {
    class_archer: archer,
    class_bowman: bowman,
    class_marksman: marksman,
    class_hunter: hunter,
    class_beast_master: beastMaster
}
