// Summons (asset-list §1.3): Disciple, Raised Dead, Wolf — Move and Attack only, no Hit or
// Death.
//
// All three are chibi, like the Heroes: the Disciple and the Raised Dead ride the chibi body
// (chibi.ts) with their own heads, and the Wolf is a chibi creature — a big head on a round
// body and stubby legs. They are companions, so they stand a little smaller than the Hero: the
// Disciple hovers, the Raised Dead stoops, and the Wolf comes up to his chest.

import { Ease, step, type Clip } from './anim'
import { C } from './palette'
import { ellipse, line, px, rect, type Surface } from './surface'
import { HP, J, fxX, fxY, hclip, floatClip, rest } from './rig'
import { HEAD_KEY, crescent, pix, put, type Pix } from './chibi'
import { M, mace, sword } from './weapons'
import { CH, CA, RE, is, chibiLook, robe } from './hero-kit'
import { A, attackPhase, fr, q, type CreatureDef } from './creature'

export const SUMMON_STATES = ['move', 'attack'] as const
export interface SummonClips { move: Clip, attack: Clip }

/** Scene effects a summon keyframe can call for, through the `fxk` pose parameter. */
const enum FXK { None, Slash, SlashFade }

/** Put a head map with its neck column at (x, y), bottom-aligned like a chibi head. */
function putHead(s: Surface, h: Pix, neck: number, x: number, y: number): { ox: number, oy: number } {
    const ox = Math.round(x) - neck
    const oy = Math.round(y) - h.h
    put(s, h, ox, oy)
    return { ox, oy }
}

/** A walk for the chibi body: 8 frames, feet alternating, a bob on the passing pose. */
function walkClip(r: Float32Array, shamble = false): Clip {
    const sw = shamble ? 1 : 0
    return hclip('move', 0.8, true, [
        [0, { ffx: 4, bfx: -4, ffy: 0, bfy: 0, crouch: 0 }],
        [0.1, { ffx: 2, bfx: -2, bfy: 1, crouch: 1, lean: sw }, Ease.Linear],
        [0.2, { ffx: 0, bfx: 0, bfy: 2, crouch: 0 }, Ease.Linear],
        [0.3, { ffx: -2, bfx: 2, bfy: 1, crouch: 0, lean: 0 }, Ease.Linear],
        [0.4, { ffx: -4, bfx: 4, ffy: 0, bfy: 0, crouch: 0 }, Ease.Linear],
        [0.5, { ffx: -2, bfx: 2, ffy: 1, crouch: 1, lean: -sw }, Ease.Linear],
        [0.6, { ffx: 0, bfx: 0, ffy: 2, crouch: 0 }, Ease.Linear],
        [0.7, { ffx: 2, bfx: -2, ffy: 1, crouch: 0, lean: 0 }, Ease.Linear],
        [0.8, { ffx: 4, bfx: -4, ffy: 0, bfy: 0 }, Ease.Linear]
    ], r)
}

// ═══════════════════════════════════════════════════════════════ Disciple (Paladin)
// A little acolyte in a cream hood with a gold trim, a halo bobbing over it, a sun-mace
// and a lantern. It hovers — the robe never touches the ground.

const DISCIPLE_HEAD = pix([
    '....BbbbB...',
    '..BbbwwwwbB.',
    '.Bbwwwwwwwwb',
    '.Bwwgggggggw',
    'BbwgsssssssG',
    'BbwgsSSSkSSG',
    'BbwgsSSSkSSs',
    '.BwgssSSSSS.',
    '.BbwgssSSs..',
    '..Bbwgggg...',
    '...BbbbB....'
], HEAD_KEY)
const DISCIPLE_NECK = 5
const DISCIPLE_EYE = 8

const DISCIPLE_REST = rest({ hx: 4, hy: 3, wa: -1.3, bhx: -5, bhy: 3, ffx: 2, bfx: -2, jump: -2 })

export const DISCIPLE_LOOK = chibiLook({
    accent: C.gold3,
    arm: C.bone1, armLow: C.bone1, armBack: C.bone0, armBackLow: C.bone0, hand: C.skin1,
    torso: (s, x, y) => {
        rect(s, x - 5, y, 10, 8, C.bone1)
        rect(s, x - 5, y, 2, 8, C.bone0)
        rect(s, x + 2, y + 1, 2, 4, C.white)
        rect(s, x - 1, y, 2, 8, C.gold1) // the stole
        rect(s, x - 2, y + 2, 4, 1, C.gold2)
        px(s, x, y + 2, C.gold3)
        rect(s, x - 5, y + 5, 10, 1, C.gold1) // cord
    },
    lower: robe([C.bone0, C.bone1, C.white], C.gold1, 1),
    head: (s, x, y, p, t) => {
        const { ox, oy } = putHead(s, DISCIPLE_HEAD, DISCIPLE_NECK, x, y)
        // eyes squeeze shut when struck, glow gold when it strikes
        const ey = oy + DISCIPLE_HEAD.h - 6
        if (p[HP.glow]! > 0.5) { s.set(ox + DISCIPLE_EYE, ey, C.gold3); s.set(ox + DISCIPLE_EYE, ey + 1, C.gold3) }
        // the halo, bobbing a pixel over the hood
        const hy = oy - 3 - step(t, 3, 2)
        rect(s, ox + 3, hy, 6, 1, C.gold3)
        px(s, ox + 2, hy + 1, C.gold2); px(s, ox + 9, hy + 1, C.gold2)
        rect(s, ox + 3, hy + 2, 6, 1, C.gold1)
    },
    weapon: (s, x, y, p) => mace(s, x, y, p[HP.wa]!, 7, M.gold, M.wood),
    offhand: (s, x, y, _p, t) => {
        // the lantern on a short chain, its flame flickering
        line(s, x, y, x, y + 2, C.gold1)
        rect(s, x - 2, y + 2, 5, 5, C.gold1)
        rect(s, x - 1, y + 3, 3, 3, step(t, 6, 2) ? C.gold3 : C.gold2)
        px(s, x, y + 4, C.white)
        rect(s, x - 1, y + 7, 3, 1, C.gold0)
    },
    fx: (dst, p, t) => {
        if (is(p, FXK.Slash)) crescent(dst, J.fsx, J.fsy, 12, p[HP.fxa]!, p[HP.wa]!, 5, C.gold2, C.white, C.gold1)
        if (is(p, FXK.SlashFade)) crescent(dst, J.fsx, J.fsy, 12, p[HP.fxa]!, p[HP.wa]!, 2, C.gold1, C.gold3, C.gold0)
        // motes rising off the lantern
        const k = step(t, 10, 6)
        dst.set(fxX(J.bhx + (k % 3) - 1), fxY(J.bhy + 3 - k), k & 1 ? C.gold3 : C.white)
    }
})

export const DISCIPLE_CLIPS: SummonClips = {
    move: floatClip(DISCIPLE_REST),
    attack: hclip('attack', 0.8, false, [
        [0, {}],
        [0.1, { wa: -1.8, hx: 4, hy: -3, lean: -1 }, Ease.Out, CH],
        [0.3, { wa: -1.95, hx: 3, hy: -5, glow: 0.6 }, Ease.InOut, CH],
        [0.4, { wa: 0.4, hx: 7, hy: 2, lean: 2, glow: 1, fxk: FXK.Slash, fxa: -1.95 }, Ease.Out, CA],
        [0.5, { fxk: FXK.SlashFade, fxa: -0.8 }, Ease.Hold, RE],
        [0.6, { fxk: 0 }, Ease.Hold, RE],
        [0.8, { wa: -1.3, hx: 4, hy: 3, lean: 0, glow: 0 }]
    ], DISCIPLE_REST)
}

// ═══════════════════════════════════════════════════════════════ Raised Dead (Witch Doctor)
// A skeleton dragged up out of the ground: an oversized cracked skull with one grave-green eye
// burning in its socket, a ribcage under a rotting shoulder-rag, and a rusted sword.

const SKULL = pix([
    '...bbbbbb...',
    '..bwwbbbbbb.',
    '.bwbbbbbbbbb',
    '.bbbbbbbbbbb',
    'bbbBbbbbbbbb',
    'BbbbBbkkbbkb',
    'BbbbbbkkbbkB',
    '.Bbbbbbbbkbb',
    '..Bbbbbbbbb.',
    '..BwkwkwkwB.',
    '...BBBBBB...'
], HEAD_KEY)
const SKULL_NECK = 5

const DEAD_REST = rest({ hx: 4, hy: 4, wa: -0.9, bhx: 2, bhy: 5, ffx: 3, bfx: -3, tilt: 1 })

export const RAISED_DEAD_LOOK = chibiLook({
    accent: C.green4,
    skin: [C.bone0, C.bone1, C.white],
    pants: C.bone1, pantsDk: C.bone0, boot: C.bone0, bootHi: C.bone1,
    arm: C.bone1, armLow: C.bone1, armBack: C.bone0, armBackLow: C.bone0, hand: C.bone1,
    torso: (s, x, y) => {
        rect(s, x - 4, y, 8, 7, C.stone0) // the hollow behind the ribs
        rect(s, x - 1, y, 2, 8, C.bone1) // spine
        for (let i = 0; i < 3; i++) {
            rect(s, x - 4, y + 1 + i * 2, 8, 1, C.bone1)
            px(s, x - 4, y + 1 + i * 2, C.bone0)
            px(s, x + 3, y + 1 + i * 2, C.white)
        }
        rect(s, x - 3, y + 7, 6, 1, C.bone0) // pelvis
        rect(s, x - 5, y - 1, 4, 3, C.olive1) // the shoulder-rag
        px(s, x - 5, y + 2, C.olive1); px(s, x - 3, y + 2, C.olive0)
        rect(s, x - 5, y + 6, 4, 3, C.olive1) // and the rotting kilt
        px(s, x - 4, y + 9, C.olive0); px(s, x - 2, y + 8, C.olive2)
        px(s, x + 1, y + 3, C.green2) // grave-moss
    },
    head: (s, x, y, p, t) => {
        const { ox, oy } = putHead(s, SKULL, SKULL_NECK, x, y)
        // the eye burns green and flickers; it flares white-hot on the strike
        const hot = p[HP.glow]! > 0.5
        s.set(ox + 7, oy + 5, hot ? C.white : C.green4)
        s.set(ox + 6, oy + 6, step(t, 5, 2) ? C.green3 : C.green2)
        s.set(ox + 10, oy + 5, C.green3)
    },
    weapon: (s, x, y, p) => sword(s, x, y, p[HP.wa]!, 11, M.rust, M.iron, C.brown0),
    fx: (dst, p, t) => {
        if (is(p, FXK.Slash)) crescent(dst, J.fsx, J.fsy, 14, p[HP.fxa]!, p[HP.wa]!, 5, C.green3, C.white, C.green2)
        if (is(p, FXK.SlashFade)) crescent(dst, J.fsx, J.fsy, 14, p[HP.fxa]!, p[HP.wa]!, 2, C.green2, C.green4, C.green1)
        // a wisp of grave-light trailing off the eye
        const k = step(t, 10, 4)
        dst.set(fxX(J.headX + 3 - k), fxY(J.headY - 6 - (k >> 1)), k < 2 ? C.green4 : C.green2)
    }
})

export const RAISED_DEAD_CLIPS: SummonClips = {
    move: walkClip(DEAD_REST, true),
    attack: hclip('attack', 0.8, false, [
        [0, {}],
        [0.1, { wa: -1.75, hx: 4, hy: -2, lean: -1, tilt: 0 }, Ease.Out, CH],
        [0.3, { wa: -1.9, hx: 3, hy: -4, headX: -1, glow: 0.6 }, Ease.InOut, CH],
        [0.4, { wa: 0.5, hx: 7, hy: 3, lean: 2, tilt: 2, ffx: 5, headX: 1, glow: 1, fxk: FXK.Slash, fxa: -1.9 }, Ease.Out, CA],
        [0.5, { fxk: FXK.SlashFade, fxa: -0.8 }, Ease.Hold, RE],
        [0.6, { fxk: 0 }, Ease.Hold, RE],
        [0.8, { wa: -0.9, hx: 4, hy: 4, lean: 0, tilt: 1, ffx: 3, headX: 0, glow: 0 }]
    ], DEAD_REST)
}

// ═══════════════════════════════════════════════════════════════ Wolf (Beast Master)
// The chibi wolf: a head as big as its body, a pale ruff and belly, stubby legs and a bushy
// tail that never stops. Gold eyes; a mouthful of fangs when it bites.

const WOLF_HEAD = pix([
    '.7...7..........',
    '.67..67.........',
    '.667.667........',
    '666666666.......',
    '6666666666......',
    '66666k5G666.....',
    '6666666667777777',
    '566666667777777k',
    '5566666665555555',
    '.556666bbbbbb...',
    '..5556bbbb......'
], HEAD_KEY)
const WOLF_BITE = pix([
    '.7...7..........',
    '.67..67.........',
    '.667.667........',
    '666666666.......',
    '6666666666......',
    '66666k5Y666.....',
    '6666666667777777',
    '566666667777777k',
    '55666666yzwyyzw.',
    '.556666bbbbbbb..',
    '..5556bbbb......'
], HEAD_KEY)

// 6-frame gallop: [front-leg x, front lift, hind x, hind lift, body bob]
const GALLOP = [
    [3, 0, -3, 1, 0], [2, 2, -2, 0, -1], [-1, 2, 1, 0, -1], [-2, 1, 2, 0, 0], [-1, 0, 2, 2, 1], [2, 0, -1, 2, 0]
]

/** A stubby leg: a 3px column from the body down to a paw that lifts on `lift`. */
function stubLeg(s: Surface, x: number, top: number, floor: number, lift: number, c: number, paw: number): void {
    rect(s, x - 1, top, 3, floor - lift - top, c)
    rect(s, x - 1, floor - lift - 1, 3, 1, paw)
}

export const WOLF: CreatureDef = {
    name: 'Wolf',
    size: 48,
    shadow: 9,
    accent: C.steel3,
    states: { move: { dur: 0.6, loop: true }, attack: { dur: 0.8, loop: false } },
    draw(s, st, t) {
        const ax = s.ax
        const ay = s.ay
        let g = GALLOP[0]!
        let lunge = 0
        let crouch = 0
        let bite = false
        let reach = 0
        if (st === 'move') g = GALLOP[fr(t, 10, 6)]!
        else {
            attackPhase(t, 0.8, 7)
            lunge = A.lunge
            crouch = Math.round(A.wind * 2)
            bite = A.strike || A.wind > 0.8
            reach = A.strike ? 2 : 0 // the forelegs thrown forward in the pounce
            g = A.strike ? GALLOP[1]! : GALLOP[0]!
        }
        const bx = ax + lunge
        const by = ay - 8 + g[4]! + crouch
        // far legs, in shadow
        stubLeg(s, bx + 4 + g[0]! + reach, by + 2, ay, g[1]!, C.stone1, C.stone2)
        stubLeg(s, bx - 5 + g[2]!, by + 2, ay, g[3]!, C.stone1, C.stone2)
        // the tail: a bushy plume streaming up and back, swishing a pixel on every other frame
        const sw = Math.floor(q(t) * 10) & 1
        for (let i = 0; i < 6; i++) {
            const tx = bx - 8 - i * 2 + (i > 3 ? i - 3 : 0)
            const ty = by - 1 - Math.round(i * 1.6) - (i > 2 ? sw : 0)
            rect(s, tx - 1, ty - 1, 3, 3, i < 4 ? C.stone2 : C.stone3)
            px(s, tx, ty - 1, C.stone3)
        }
        rect(s, bx - 17, by - 11 - sw, 2, 2, C.bone1) // the pale tip
        // the body: round, lit along the back, pale underneath
        ellipse(s, bx, by, 8, 5, C.stone2)
        ellipse(s, bx, by - 2, 6, 2, C.stone3)
        rect(s, bx - 5, by + 3, 9, 2, C.bone1)
        px(s, bx - 6, by + 3, C.bone0)
        // near legs
        stubLeg(s, bx + 6 + g[2]! + reach, by + 2, ay, g[3]!, C.stone2, C.stone3)
        stubLeg(s, bx - 3 + g[0]!, by + 2, ay, g[1]!, C.stone2, C.stone3)
        // the ruff, frothing out under the jaw
        rect(s, bx + 4, by - 2, 4, 5, C.bone1)
        px(s, bx + 3, by + 1, C.bone1); px(s, bx + 8, by + 2, C.bone0)
        // the head, nodding into the bite
        const head = bite ? WOLF_BITE : WOLF_HEAD
        put(s, head, bx + 3, by - 10 + (bite ? 1 : 0))
    },
    fx(dst, st, t, x, y, dir) {
        if (st === 'attack') {
            attackPhase(t, 0.8, 7)
            if (A.strike) {
                // bite flash at the jaws
                for (let i = 0; i < 3; i++) {
                    dst.set(x + dir * (24 + i), y - 10 + i * 2, C.white)
                    dst.set(x + dir * (25 + i), y - 9 + i * 2, C.steel3)
                }
            }
        } else if (fr(t, 10, 6) === 0) {
            dst.set(x - dir * 8, y - 1, C.stone3); dst.set(x - dir * 10, y - 2, C.stone2) // kicked dust
        }
    }
}
