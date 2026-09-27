// Trash enemies and elites (asset-list §1.4): 4 weapon rigs × 4 states, 10 world skins.
//
// "The weapon is the rig; the world is the skin." Each rig (sword, axe, bow, staff) is one
// clip set, animated once, and every world dresses it as an inhabitant of that place. Drawn
// facing right like every humanoid and mirrored at stamp time to face the party.
//
// Elites are the same body with one consistent mark everywhere: a gold halo outline and a
// chevron over the head (`ELITE_MARK`, drawn by `drawEliteMark`).

import { Ease, Phase, step, type Clip } from './anim'
import { C } from './palette'
import type { Surface} from './surface';
import { line, px, rect, disc, ellipse, tri, dither, bayer, poly, arc } from './surface'
import { HP, J, fxX, fxY, hclip, hitClip, deathClip, rest, type Look, type Painter } from './rig'
import { robeSkirt, smear, sparks, streak } from './hero-parts'
import { M, tip, sword, axe, bow, staff, Gem, type Mat } from './weapons'
import type { EnemyStyle } from '../../../shared/utils/hero-quest/content/worlds'

export const ENEMY_WEAPONS = ['sword', 'axe', 'bow', 'staff'] as const
export type EnemyWeapon = typeof ENEMY_WEAPONS[number]
export const ENEMY_STATES = ['idle', 'attack', 'hit', 'death'] as const
export interface EnemyClips { idle: Clip, attack: Clip, hit: Clip, death: Clip }

const CH = Phase.Charge
const CA = Phase.Cast
const RE = Phase.Recover
const enum EFX { None, Smear, Release, Burst }
const is = (p: Float32Array, k: EFX) => Math.round(p[HP.fxk]!) === k

// ── The four rigs ──────────────────────────────────────────────────────────────────

const SWORD_REST = rest({ hx: 3, hy: 6, wa: -1.0, bhx: 0, bhy: 6, ffx: 3, bfx: -3 })
const AXE_REST = rest({ hx: 3, hy: 5, wa: -1.3, bhx: 1, bhy: 6, ffx: 3, bfx: -3, tilt: 1 })
const BOW_REST = rest({ hx: 4, hy: 6, wa: 0.3, bhx: 0, bhy: 6, ffx: 3, bfx: -3 })
const STAFF_REST = rest({ hx: 4, hy: 6, wa: -1.4, bhx: 1, bhy: 6, ffx: 2, bfx: -2 })

export const ENEMY_RIGS: Readonly<Record<EnemyWeapon, EnemyClips>> = {
    sword: {
        idle: hclip('idle', 1.0, true, [[0, {}], [0.5, { crouch: 1, hy: 7, wa: -0.9 }], [1.0, {}]], SWORD_REST),
        attack: hclip('attack', 0.8, false, [
            [0, {}],
            [0.1, { wa: -2.2, hx: -1, hy: -3, lean: -1 }, Ease.Out, CH],
            [0.3, { wa: -2.5, hx: -2, hy: -4, lean: -2, crouch: 1 }, Ease.InOut, CH],
            [0.4, { wa: 0.4, hx: 7, hy: 3, lean: 2, ffx: 5, fxk: EFX.Smear, fxa: -2.5 }, Ease.Out, CA],
            [0.5, { fxk: 0, wa: 0.7 }, Ease.Out, RE],
            [0.8, { wa: -1.0, hx: 3, hy: 6, lean: 0, crouch: 0, ffx: 3 }]
        ], SWORD_REST),
        hit: hitClip(SWORD_REST),
        death: deathClip(SWORD_REST)
    },
    axe: {
        idle: hclip('idle', 1.2, true, [[0, {}], [0.6, { crouch: 1, hy: 6 }], [1.2, {}]], AXE_REST),
        attack: hclip('attack', 1.0, false, [
            [0, {}],
            [0.1, { wa: -1.7, hx: 0, hy: -6, lean: -1, tilt: -1 }, Ease.Out, CH],
            [0.4, { wa: -1.95, hx: -1, hy: -7, lean: -2, jump: -1 }, Ease.InOut, CH],
            [0.5, { wa: 0.6, hx: 7, hy: 6, lean: 3, crouch: 3, tilt: 2, jump: 0, fxk: EFX.Smear, fxa: -1.95 }, Ease.Out, CA],
            [0.6, { fxk: 0 }, Ease.Hold, RE],
            [1.0, { wa: -1.3, hx: 3, hy: 5, lean: 0, crouch: 0, tilt: 1 }]
        ], AXE_REST),
        hit: hitClip(AXE_REST),
        death: deathClip(AXE_REST)
    },
    bow: {
        idle: hclip('idle', 1.2, true, [[0, {}], [0.6, { crouch: 1, hy: 7 }], [1.2, {}]], BOW_REST),
        attack: hclip('attack', 1.0, false, [
            [0, {}],
            [0.1, { wa: 0, hx: 8, hy: 0, bhx: 11, bhy: 0, aux: 0.1, lean: -1 }, Ease.Out, CH],
            [0.4, { aux: 1, bhx: 4 }, Ease.InOut, CH],
            [0.5, { aux: 0, bhx: -2, bhy: -1, fxk: EFX.Release }, Ease.Hold, CA],
            [0.6, { fxk: 0 }, Ease.Hold, RE],
            [1.0, { wa: 0.3, hx: 4, hy: 6, bhx: 0, bhy: 6, lean: 0, aux: 0 }]
        ], BOW_REST),
        hit: hitClip(BOW_REST),
        death: deathClip(BOW_REST)
    },
    staff: {
        idle: hclip('idle', 1.4, true, [[0, {}], [0.7, { crouch: 1, hy: 7, glow: 0.3 }], [1.4, {}]], STAFF_REST),
        attack: hclip('attack', 1.0, false, [
            [0, {}],
            [0.1, { hx: 5, hy: 1, wa: -1.57, bhx: 5, bhy: 2, glow: 0.4 }, Ease.Out, CH],
            [0.4, { glow: 0.8, hy: 0 }, Ease.InOut, CH],
            [0.5, { hx: 9, hy: 2, wa: -0.4, lean: 2, glow: 1, fxk: EFX.Burst, bhx: -2 }, Ease.Out, CA],
            [0.6, { fxk: 0, glow: 0.4 }, Ease.Hold, RE],
            [1.0, { hx: 4, hy: 6, wa: -1.4, bhx: 1, bhy: 6, lean: 0, glow: 0 }]
        ], STAFF_REST),
        hit: hitClip(STAFF_REST),
        death: deathClip(STAFF_REST)
    }
}

// ── World skins ────────────────────────────────────────────────────────────────────

interface WorldSkin {
    /** Body proportions: goblins and kobolds are small. */
    legLen: number
    torsoLen: number
    skin: Mat
    head: Painter
    torso: Painter
    lower?: Painter
    back?: Painter
    pants: number
    pantsDk: number
    boot: number
    bootHi: number
    arm: number
    armLow: number
    armBack: number
    armBackLow: number
    hand: number
    /** Blade/head, haft, bow wood, staff gem and style. */
    blade: Mat
    haft: Mat
    gem: Mat
    gemStyle: Gem
    accent: number
    /** Scene-space ambience (drips, embers, frost) drawn every frame. */
    ambient?: (dst: Surface, t: number) => void
}

function eyes(s: Surface, x: number, y: number, c: number, p: Float32Array): void {
    if (p[HP.flash]! > 0.5 || p[HP.mouth]! > 0.5) { px(s, x, y, C.ink); px(s, x + 1, y + 1, C.ink); return }
    px(s, x, y, c)
}

// 1 · Thornwick Vale — Bramble Goblin: green, big-eared, in a leather jerkin bound in thorny
// vine and berries, barefoot.
const brambleGoblin: WorldSkin = {
    legLen: 6, torsoLen: 7,
    skin: [C.green1, C.green2, C.green3],
    head: (s, x, y, p) => {
        tri(s, x - 3, y - 6, x - 3, y - 3, x - 9, y - 7, C.green1) // ear
        ellipse(s, x, y - 4, 4, 4, C.green2)
        rect(s, x + 1, y - 6, 3, 3, C.green3)
        rect(s, x + 3, y - 4, 3, 1, C.green2); px(s, x + 5, y - 3, C.green1) // hooked nose
        eyes(s, x + 2, y - 5, C.gold2, p)
        rect(s, x, y - 1, 3, 1, C.green0); px(s, x + 1, y - 1, C.white)
        // bramble crown
        for (let i = -3; i <= 2; i++) px(s, x + i, y - 8 - ((i & 1) ? 1 : 0), i & 1 ? C.brown1 : C.green1)
        px(s, x - 2, y - 9, C.red2); px(s, x + 1, y - 9, C.red2)
        px(s, x - 4, y - 8, C.brown2)
    },
    torso: (s, x, y) => {
        rect(s, x - 3, y, 7, 7, C.brown2)
        rect(s, x - 3, y, 1, 7, C.brown1)
        rect(s, x + 1, y + 1, 2, 2, C.brown3)
        line(s, x - 3, y + 1, x + 3, y + 5, C.green1) // bramble wrap
        line(s, x - 3, y + 4, x + 3, y + 2, C.green0)
        px(s, x - 1, y + 3, C.red2); px(s, x + 2, y + 4, C.red3); px(s, x - 2, y + 2, C.red2) // berries
        rect(s, x - 3, y + 6, 7, 1, C.brown0) // ragged hem
        px(s, x - 2, y + 7, C.brown1); px(s, x + 1, y + 7, C.brown1)
    },
    // brown trousers and bare green feet
    pants: C.brown1, pantsDk: C.brown0, boot: C.green1, bootHi: C.green3,
    arm: C.green2, armLow: C.green2, armBack: C.green1, armBackLow: C.green1, hand: C.green3,
    blade: M.iron, haft: M.wood, gem: M.nature, gemStyle: Gem.Totem, accent: C.green4
}

// 1 · Thornwick Vale — Thornhide Hobgoblin (heavy): the goblins' hulking cousin, reddish-brown
// and tusked, a heavy brow, studded leather with a bramble-wrapped spiked pauldron and a necklace
// of boar tusks.
const thornhideHobgoblin: WorldSkin = {
    legLen: 7, torsoLen: 9,
    skin: [C.skin0, C.brown2, C.skin1],
    head: (s, x, y, p) => {
        tri(s, x - 3, y - 6, x - 3, y - 3, x - 8, y - 7, C.skin0) // ear
        ellipse(s, x, y - 4, 5, 4, C.brown2)
        rect(s, x + 1, y - 7, 3, 2, C.skin1) // the lit crown
        rect(s, x - 1, y - 6, 6, 1, C.skin0) // heavy brow
        eyes(s, x + 3, y - 5, C.gold2, p)
        rect(s, x + 4, y - 4, 3, 2, C.brown2); px(s, x + 6, y - 3, C.skin0) // flat nose
        rect(s, x + 1, y - 1, 5, 1, C.ink)
        px(s, x + 2, y - 2, C.white); px(s, x + 5, y - 2, C.white) // tusks
        // a topknot bound in bramble
        rect(s, x - 2, y - 10, 3, 2, C.brown0)
        px(s, x - 1, y - 11, C.green1); px(s, x + 1, y - 10, C.red2)
    },
    torso: (s, x, y) => {
        rect(s, x - 5, y, 10, 9, C.brown1)
        rect(s, x - 5, y, 2, 9, C.brown0)
        for (let i = 0; i < 3; i++) { px(s, x - 1 + i * 2, y + 3, C.steel2); px(s, x + i * 2, y + 6, C.steel2) } // studs
        // a spiked pauldron bound in bramble
        ellipse(s, x + 2, y + 1, 4, 2, C.steel1)
        for (let i = 0; i < 3; i++) tri(s, x - 1 + i * 3, y, x + 1 + i * 3, y, x + i * 3, y - 3, C.steel2)
        line(s, x - 1, y + 2, x + 5, y, C.green1)
        px(s, x + 3, y + 1, C.red2)
        // a necklace of boar tusks
        for (let i = 0; i < 3; i++) px(s, x - 2 + i * 2, y + 1 + (i & 1), C.bone1)
        rect(s, x - 5, y + 8, 10, 1, C.brown0)
    },
    pants: C.brown1, pantsDk: C.brown0, boot: C.brown0, bootHi: C.brown1,
    arm: C.brown2, armLow: C.brown2, armBack: C.skin0, armBackLow: C.skin0, hand: C.skin1,
    blade: M.iron, haft: M.wood, gem: M.nature, gemStyle: Gem.Totem, accent: C.red2
}

// 1 · Thornwick Vale — Scarecrow Stalker (ranged): a scarecrow come down off its pole. A stitched
// burlap head with glowing button eyes under a floppy straw hat, a patched coat, straw poking out
// at the neck and cuffs, loosing from a crooked bow.
const scarecrowStalker: WorldSkin = {
    legLen: 7, torsoLen: 8,
    skin: [C.bone0, C.bone0, C.bone1],
    head: (s, x, y, p, t) => {
        // straw bursting out under the sack at the neck
        for (let i = 0; i < 4; i++) line(s, x - 2 + i * 2, y, x - 3 + i * 2, y + 2, C.gold2)
        ellipse(s, x, y - 4, 4, 4, C.bone1)
        rect(s, x - 4, y - 3, 1, 3, C.bone0)
        line(s, x - 1, y - 1, x + 4, y - 1, C.brown1) // the stitched mouth
        for (let i = 0; i < 3; i++) px(s, x + i * 2, y, C.brown1)
        const glow = (Math.floor(t * 3) & 3) !== 0 && p[HP.flash]! < 0.5
        px(s, x + 1, y - 4, glow ? C.gold3 : C.brown0); px(s, x + 3, y - 4, glow ? C.gold3 : C.brown0) // button eyes
        // the floppy straw hat, brim drooping
        rect(s, x - 6, y - 8, 12, 1, C.gold1)
        px(s, x - 6, y - 7, C.gold1); px(s, x + 5, y - 7, C.gold1)
        rect(s, x - 3, y - 11, 6, 3, C.gold1)
        rect(s, x - 3, y - 9, 6, 1, C.red1) // the band
        px(s, x - 2, y - 11, C.gold2)
    },
    torso: (s, x, y) => {
        rect(s, x - 3, y, 7, 8, C.brown2)
        rect(s, x - 3, y, 1, 8, C.brown1)
        rect(s, x - 1, y + 2, 2, 2, C.red1); rect(s, x + 2, y + 5, 2, 2, C.blue1) // patches
        px(s, x, y + 2, C.bone1); px(s, x + 3, y + 5, C.bone1) // a stitch on each
        rect(s, x - 3, y + 6, 7, 1, C.brown0) // a rope belt
        px(s, x - 3, y + 7, C.gold2); px(s, x + 3, y + 8, C.gold2) // straw at the hem
    },
    pants: C.brown1, pantsDk: C.brown0, boot: C.brown0, bootHi: C.brown1,
    arm: C.brown2, armLow: C.brown2, armBack: C.brown1, armBackLow: C.brown1, hand: C.gold2,
    blade: M.iron, haft: M.darkwood, gem: M.nature, gemStyle: Gem.Totem, accent: C.gold3
}

// 1 · Thornwick Vale — Hedge-Witch (caster): a hunched goblin crone with a long nose, a pointed
// hat of woven brown straw set with leaves and berries, a cloak of hedge leaves over a berry-red
// dress, calling on the antler totem. The dress keeps her off the green of the meadow.
const hedgeWitch: WorldSkin = {
    legLen: 6, torsoLen: 7,
    skin: [C.green1, C.green2, C.green3],
    head: (s, x, y, p) => {
        tri(s, x - 3, y - 5, x - 3, y - 3, x - 7, y - 6, C.green1) // ear
        ellipse(s, x, y - 4, 3.5, 3.5, C.green2)
        line(s, x + 3, y - 4, x + 7, y - 2, C.green2) // the long nose
        px(s, x + 7, y - 2, C.green1); px(s, x + 5, y - 3, C.green3)
        eyes(s, x + 1, y - 5, C.gold3, p)
        rect(s, x, y - 1, 3, 1, C.green0)
        for (let i = 0; i < 3; i++) line(s, x - 3 + i, y - 3, x - 4 + i, y + 1, C.steel2) // grey hair
        // the pointed hat, woven with leaves and berries, its tip bent over
        rect(s, x - 5, y - 7, 10, 1, C.brown1)
        tri(s, x - 3, y - 7, x + 3, y - 7, x - 2, y - 14, C.brown1)
        line(s, x - 2, y - 14, x - 5, y - 13, C.brown1)
        line(s, x - 1, y - 12, x + 2, y - 8, C.brown2) // the weave
        px(s, x - 1, y - 9, C.green3); px(s, x + 1, y - 8, C.green2)
        px(s, x - 2, y - 10, C.red2); px(s, x, y - 8, C.red2)
    },
    torso: (s, x, y) => {
        rect(s, x - 3, y, 7, 7, C.red1)
        rect(s, x - 3, y, 1, 7, C.red0)
        // the cloak of leaves, layered
        for (let i = 0; i < 4; i++) {
            px(s, x - 2 + i * 2, y + 1, C.green2)
            px(s, x - 3 + i * 2, y + 3, C.green3)
            px(s, x - 2 + i * 2, y + 5, C.green2)
        }
        px(s, x + 2, y + 2, C.red2); px(s, x - 1, y + 4, C.red3) // berries
    },
    lower: (s, x, hipY, _p, t) => robeSkirt(s, x, hipY, J.oy - 1, [C.red0, C.red1, C.red2], C.green2, (Math.floor(t * 2) & 1) - 0.5, C.brown0, 0),
    pants: C.red1, pantsDk: C.red0, boot: C.brown0, bootHi: C.brown1,
    arm: C.green2, armLow: C.red1, armBack: C.green1, armBackLow: C.red0, hand: C.green3,
    blade: M.iron, haft: M.wood, gem: M.nature, gemStyle: Gem.Totem, accent: C.green4
}

// 2 · Mirewood — Bog Lurker: a hunched frog-man of the drowned forest. A wide flat head thrust
// forward with gold eyes bulging on top and a long lipless mouth, a pale belly, warts down the
// back, a mantle of bog moss over the shoulders and a reed belt with a bone charm.
const bogLurker: WorldSkin = {
    legLen: 6, torsoLen: 8,
    skin: [C.teal0, C.teal1, C.teal2],
    head: (s, x, y, p, t) => {
        // the skull, low and wide, and the broad jaw under it
        ellipse(s, x + 1, y - 4, 6, 3, C.teal1)
        ellipse(s, x + 2, y - 1, 6, 2, C.teal1)
        rect(s, x - 2, y - 7, 6, 1, C.teal2) // wet sheen along the crown
        rect(s, x - 3, y, 9, 1, C.olive2) // pale throat
        // the long mouth, turned down at the corner
        line(s, x - 2, y - 2, x + 7, y - 2, C.ink)
        px(s, x + 7, y - 1, C.ink)
        px(s, x + 8, y - 3, C.teal0) // nostril
        px(s, x - 2, y - 5, C.teal0); px(s, x + 1, y - 6, C.teal0); px(s, x - 4, y - 3, C.teal0) // spots
        // eyes bulging on top of the head, gold with a dark bar of a pupil
        disc(s, x + 1, y - 7, 2, C.teal1)
        disc(s, x + 5, y - 7, 2, C.teal1)
        rect(s, x + 1, y - 8, 2, 2, C.gold2); rect(s, x + 5, y - 8, 2, 2, C.gold2)
        eyes(s, x + 2, y - 8, C.ink, p); eyes(s, x + 6, y - 8, C.ink, p)
        px(s, x + 1, y - 8, C.gold3); px(s, x + 5, y - 8, C.gold3)
        // moss hanging off the back of the head
        for (let i = 0; i < 3; i++) line(s, x - 5 + i, y - 5, x - 5 + i, y - 2 + (i & 1) * 2, i & 1 ? C.green2 : C.olive1)
        if ((Math.floor(t * 3) & 3) === 0) px(s, x + 7, y + 1, C.teal3) // a drip off the lip
    },
    torso: (s, x, y) => {
        rect(s, x - 4, y, 8, 8, C.teal1)
        rect(s, x - 4, y, 2, 8, C.teal0)
        rect(s, x, y + 2, 4, 5, C.olive2) // pale belly
        px(s, x + 2, y + 3, C.gold3)
        px(s, x - 3, y + 4, C.teal2); px(s, x - 2, y + 6, C.teal2) // warts down the back
        // a mantle of bog moss over the shoulders, strands hanging from it
        rect(s, x - 4, y, 8, 2, C.green1)
        rect(s, x - 3, y, 6, 1, C.green2)
        for (let i = 0; i < 4; i++) line(s, x - 4 + i * 2, y + 2, x - 4 + i * 2, y + 3 + (i & 1) * 2, i & 1 ? C.green2 : C.olive1)
        // a reed belt and a bone charm
        rect(s, x - 4, y + 6, 8, 1, C.brown1)
        px(s, x - 2, y + 6, C.olive2); px(s, x + 1, y + 6, C.olive2)
        px(s, x + 2, y + 7, C.bone1)
    },
    // teal legs, wide webbed feet
    pants: C.teal1, pantsDk: C.teal0, boot: C.teal0, bootHi: C.teal2,
    arm: C.teal1, armLow: C.teal1, armBack: C.teal0, armBackLow: C.teal0, hand: C.teal2,
    blade: M.bone, haft: M.darkwood, gem: M.sea, gemStyle: Gem.Orb, accent: C.teal3,
    ambient: (dst, t) => { if ((Math.floor(t * 4) & 3) === 1) dst.set(fxX(J.bx + 3), fxY(J.oy - 1), C.teal2) }
}

// 2 · Mirewood — Peat Brute (heavy): a hulking bog troll, grey-violet and warty under clods of
// peat, moss hanging off its shoulders and a mushroom growing out of its back, a heavy jaw and
// small eyes lit green. Kept off the brown and dark green of the bog it wades through.
const peatBrute: WorldSkin = {
    legLen: 7, torsoLen: 9,
    skin: [C.stone1, C.stone2, C.stone3],
    head: (s, x, y, p) => {
        ellipse(s, x + 1, y - 4, 5, 4, C.stone2)
        rect(s, x - 3, y - 7, 6, 1, C.stone3) // the lit crown
        rect(s, x, y - 5, 5, 1, C.stone1) // brow
        eyes(s, x + 2, y - 4, C.green4, p); eyes(s, x + 4, y - 4, C.green4, p)
        rect(s, x + 1, y - 1, 6, 2, C.stone1) // the heavy jaw
        px(s, x + 2, y - 2, C.bone1); px(s, x + 5, y - 2, C.bone1) // underbite fangs
        px(s, x - 2, y - 3, C.stone3); px(s, x - 3, y - 5, C.stone1) // warts
        rect(s, x - 3, y - 8, 3, 2, C.brown1) // a clod of peat on the head
        px(s, x - 2, y - 9, C.green2)
    },
    torso: (s, x, y) => {
        rect(s, x - 5, y, 10, 9, C.stone2)
        rect(s, x - 5, y, 2, 9, C.stone1)
        px(s, x + 1, y + 3, C.stone3); px(s, x - 1, y + 6, C.stone3); px(s, x + 3, y + 7, C.stone1) // warts
        // clods of peat and hanging moss on the shoulders
        rect(s, x - 5, y, 5, 2, C.brown1); rect(s, x + 2, y + 1, 3, 2, C.brown1)
        for (let i = 0; i < 4; i++) line(s, x - 5 + i * 3, y + 2, x - 5 + i * 3, y + 4 + (i & 1) * 2, C.green2)
        // a mushroom growing out of its back
        rect(s, x - 6, y + 3, 1, 2, C.bone1)
        rect(s, x - 8, y + 2, 4, 1, C.red1); px(s, x - 7, y + 2, C.bone1)
    },
    pants: C.stone2, pantsDk: C.stone1, boot: C.stone1, bootHi: C.stone2,
    arm: C.stone2, armLow: C.stone2, armBack: C.stone1, armBackLow: C.stone1, hand: C.stone3,
    blade: M.bone, haft: M.darkwood, gem: M.sea, gemStyle: Gem.Orb, accent: C.green4
}

// 2 · Mirewood — Reed Spitter (ranged): a lanky thing woven of dry reeds, a cattail for a head
// with two pale eyes in it, reed fronds for hair, shooting thorns from a bent-reed bow.
const reedSpitter: WorldSkin = {
    legLen: 8, torsoLen: 8,
    skin: [C.brown2, C.gold1, C.gold2],
    head: (s, x, y, p, t) => {
        // reed fronds sprouting off the top, swaying
        const sway = Math.floor(t * 2) & 1
        line(s, x - 1, y - 7, x - 4 - sway, y - 12, C.gold1)
        line(s, x + 1, y - 7, x + 2 + sway, y - 13, C.gold2)
        // the cattail head, brown and furred
        ellipse(s, x + 1, y - 4, 3, 4, C.brown2)
        rect(s, x + 2, y - 7, 1, 6, C.brown3)
        eyes(s, x + 2, y - 5, C.bone1, p); eyes(s, x + 3, y - 3, C.bone1, p)
        // the reed stalk of a neck
        rect(s, x, y - 1, 2, 2, C.gold1)
    },
    torso: (s, x, y) => {
        // a narrow weave of reeds
        rect(s, x - 2, y, 5, 8, C.gold1)
        for (let i = 0; i < 5; i++) line(s, x - 2 + i, y, x - 2 + i, y + 7, i & 1 ? C.brown3 : C.gold1)
        for (let k = 1; k < 8; k += 3) rect(s, x - 2, y + k, 5, 1, C.brown2) // the binding
        px(s, x + 2, y + 2, C.gold2)
    },
    pants: C.gold1, pantsDk: C.brown2, boot: C.brown2, bootHi: C.gold1,
    arm: C.gold1, armLow: C.gold1, armBack: C.brown2, armBackLow: C.brown2, hand: C.gold2,
    blade: M.bone, haft: M.wood, gem: M.sea, gemStyle: Gem.Orb, accent: C.gold3
}

// 2 · Mirewood — Bog Crone (caster): a stooped grey hag with long stringy hair and a hooked nose,
// a shawl of moss over violet rags, calling up the black water with an orb-headed staff.
const bogCrone: WorldSkin = {
    legLen: 6, torsoLen: 7,
    skin: [C.stone1, C.stone2, C.stone3],
    head: (s, x, y, p) => {
        ellipse(s, x, y - 4, 3.5, 3.5, C.stone3)
        line(s, x + 3, y - 4, x + 6, y - 2, C.stone3) // the hooked nose
        px(s, x + 6, y - 1, C.stone2)
        eyes(s, x + 1, y - 5, C.teal3, p)
        rect(s, x, y - 1, 3, 1, C.stone1)
        px(s, x + 2, y - 3, C.stone1) // a wart
        // long stringy hair falling from under a hood of moss
        ellipse(s, x - 1, y - 7, 5, 2, C.green1)
        for (let i = 0; i < 4; i++) line(s, x - 4 + i, y - 6, x - 5 + i, y + 1 + (i & 1) * 2, C.bone0)
        px(s, x + 2, y - 8, C.green2); px(s, x - 3, y - 8, C.green2)
    },
    torso: (s, x, y) => {
        rect(s, x - 3, y, 7, 7, C.purple1)
        rect(s, x - 3, y, 1, 7, C.purple0)
        // the shawl of moss over the shoulders
        rect(s, x - 3, y, 7, 3, C.green1)
        for (let i = 0; i < 4; i++) px(s, x - 3 + i * 2, y + 3, C.green2)
        px(s, x + 1, y + 1, C.green2)
        rect(s, x - 1, y + 4, 2, 1, C.bone1) // a bone clasp
    },
    lower: (s, x, hipY, _p, t) => robeSkirt(s, x, hipY, J.oy - 1, [C.purple0, C.purple1, C.purple2], C.green1, (Math.floor(t * 2) & 1) - 0.5, C.stone1, 0),
    pants: C.purple1, pantsDk: C.purple0, boot: C.stone1, bootHi: C.stone2,
    arm: C.stone2, armLow: C.purple1, armBack: C.stone1, armBackLow: C.purple0, hand: C.stone3,
    blade: M.bone, haft: M.darkwood, gem: M.sea, gemStyle: Gem.Orb, accent: C.teal3
}

// 3 · Cinderpass — Cinder Kobold: a scaled little dog-lizard of the ash mines. A big head with a
// long snout, gold eyes, horns swept back and a fin of an ear, a dented miner's helmet with a
// candle guttering on it; a soot-black leather apron over gold belly scales, a rope belt with a
// pouch, a pick slung across the back and a whip of a tail.
const cinderKobold: WorldSkin = {
    legLen: 6, torsoLen: 7,
    skin: [C.red1, C.orange, C.gold2],
    back: (s, x, y) => {
        // the pick across the back, head over the shoulder
        line(s, x - 4, y + 7, x + 1, y - 2, C.brown1)
        line(s, x - 1, y - 3, x + 3, y - 1, C.steel2)
        px(s, x - 2, y - 4, C.steel1)
        // the tail, curling up at the tip
        line(s, x - 3, y + 7, x - 7, y + 10, C.red1, 2)
        line(s, x - 7, y + 10, x - 10, y + 9, C.red1)
        px(s, x - 11, y + 8, C.orange)
    },
    head: (s, x, y, p, t) => {
        // horns swept back, and the fin of an ear
        line(s, x - 2, y - 7, x - 6, y - 9, C.bone1)
        px(s, x - 7, y - 9, C.bone0)
        tri(s, x - 3, y - 5, x - 3, y - 2, x - 7, y - 4, C.red2)
        line(s, x - 3, y - 4, x - 6, y - 4, C.red1)
        // skull and the long snout, lit along the ridge
        ellipse(s, x, y - 4, 4, 3.5, C.red1)
        // a tapering reptile snout, lit along the ridge, and the lower jaw under it
        poly(s, [0, -6, 4, -6, 8, -4, 8, -3, 0, -2], x + 1, y, C.orange)
        line(s, x + 2, y - 6, x + 8, y - 4, C.gold2)
        px(s, x + 8, y - 4, C.ink) // nostril
        rect(s, x + 1, y - 2, 6, 1, C.red1)
        line(s, x + 2, y - 2, x + 7, y - 3, C.ink)
        px(s, x + 3, y - 2, C.white); px(s, x + 6, y - 3, C.white) // teeth
        // a gold eye with a slit pupil under a heavy brow
        rect(s, x - 1, y - 7, 4, 1, C.red0)
        rect(s, x, y - 6, 2, 2, C.gold3)
        eyes(s, x + 1, y - 6, C.ink, p)
        // the dented miner's helmet and its candle
        ellipse(s, x - 1, y - 7, 4, 2, C.steel1)
        rect(s, x - 5, y - 6, 9, 1, C.steel0)
        px(s, x - 3, y - 8, C.steel2); px(s, x + 1, y - 7, C.steel0)
        rect(s, x - 1, y - 11, 2, 3, C.bone1)
        px(s, x - 1, y - 9, C.bone0) // wax run
        const flick = Math.floor(t * 8) & 1
        px(s, x - 1 + flick, y - 12, C.gold2)
        px(s, x, y - 13 - flick, C.gold3)
    },
    torso: (s, x, y) => {
        rect(s, x - 3, y, 7, 7, C.orange)
        rect(s, x - 3, y, 1, 7, C.red1)
        rect(s, x, y + 1, 3, 5, C.gold2) // belly scales
        px(s, x + 1, y + 2, C.gold1); px(s, x, y + 4, C.gold1)
        // the soot-black leather apron over them, strapped at the neck
        rect(s, x - 2, y + 2, 4, 5, C.brown0)
        rect(s, x - 2, y + 2, 4, 1, C.brown1)
        line(s, x - 2, y, x + 1, y + 2, C.brown0)
        px(s, x - 1, y + 5, C.stone2) // ash on it
        // a rope belt and a pouch
        rect(s, x - 3, y + 5, 7, 1, C.brown2)
        rect(s, x + 2, y + 5, 2, 2, C.brown1)
    },
    pants: C.orange, pantsDk: C.red1, boot: C.red0, bootHi: C.red1,
    arm: C.orange, armLow: C.orange, armBack: C.red1, armBackLow: C.red1, hand: C.red1,
    blade: M.obsidian, haft: M.darkwood, gem: M.lava, gemStyle: Gem.Flame, accent: C.lava1,
    ambient: (dst, t) => {
        const k = step(t, 10, 8)
        dst.set(fxX(J.bx - 3 + (k % 5)), fxY(J.topY - 4 - k), k & 1 ? C.orange : C.gold2)
    }
}

// 3 · Cinderpass — Slag Golem (heavy): cooled slag-iron from the kobolds' forges walking, a craggy
// lump of a head with a glowing slit, a broad cracked chest with a molten core, rough shoulders
// shedding embers. Blue-grey iron, so it reads off the pass's brown-grey basalt.
const slagGolem: WorldSkin = {
    legLen: 7, torsoLen: 9,
    skin: [C.steel0, C.steel1, C.steel2],
    head: (s, x, y, p, t) => {
        // a craggy lump of a head, no neck, lit on top
        poly(s, [-4, 0, -5, -4, -3, -7, 1, -8, 4, -7, 5, -3, 5, 0], x, y, C.steel1)
        poly(s, [-4, 0, -5, -4, -3, -7, -2, 0], x, y, C.steel0)
        line(s, x - 2, y - 7, x + 3, y - 7, C.steel2)
        px(s, x + 3, y - 3, C.steel2); px(s, x - 1, y - 1, C.steel2)
        rect(s, x, y - 5, 5, 2, C.ink) // the slit
        const on = p[HP.flash]! < 0.5
        rect(s, x + 1, y - 5, 3, 1, on ? C.lava1 : C.ink)
        px(s, x + 2, y - 5, on ? C.gold2 : C.ink)
        line(s, x - 2, y - 7, x, y - 2, C.lava0) // a crack down the brow
        if ((Math.floor(t * 4) & 3) === 0) px(s, x + 3, y - 1, C.orange) // molten drip
    },
    torso: (s, x, y) => {
        // a broad trunk of slag, craggy at the edges and patched with lighter rock
        poly(s, [-5, 0, 6, 0, 6, 5, 5, 9, -4, 9, -6, 5], x, y, C.steel1)
        poly(s, [-5, 0, -3, 0, -3, 9, -4, 9, -6, 5], x, y, C.steel0)
        rect(s, x - 1, y + 6, 3, 2, C.steel2); px(s, x + 4, y + 7, C.steel2)
        // rough rock heaped on the shoulders
        poly(s, [-7, 2, -6, -2, -3, -2, -2, 2], x, y, C.steel2)
        poly(s, [3, 2, 4, -2, 7, -1, 7, 2], x, y, C.steel2)
        px(s, x - 5, y - 2, C.steel3); px(s, x + 5, y - 2, C.steel3)
        // the molten core, and the seams running out of it
        disc(s, x + 1, y + 4, 2.5, C.lava1)
        disc(s, x + 1, y + 4, 1, C.gold2)
        px(s, x + 1, y + 4, C.gold3)
        line(s, x, y + 5, x - 3, y + 8, C.lava1)
        line(s, x + 2, y + 3, x + 5, y + 1, C.lava1)
        line(s, x, y + 3, x - 3, y + 1, C.lava0)
        line(s, x + 3, y + 5, x + 5, y + 8, C.lava0)
    },
    pants: C.steel1, pantsDk: C.steel0, boot: C.steel0, bootHi: C.steel1,
    arm: C.steel1, armLow: C.steel1, armBack: C.steel0, armBackLow: C.steel0, hand: C.steel2,
    blade: M.obsidian, haft: M.darkwood, gem: M.lava, gemStyle: Gem.Flame, accent: C.lava1,
    ambient: (dst, t) => {
        const k = step(t, 10, 6)
        dst.set(fxX(J.bx + 4), fxY(J.topY - 2 - k * 2), k & 1 ? C.orange : C.lava1)
    }
}

// 3 · Cinderpass — Ash Imp (ranged): a small charred devil of the vents, big-eared and grinning,
// bone horns, bat wings and a barbed tail, dusted in ash, loosing from a bone bow.
const ashImp: WorldSkin = {
    legLen: 5, torsoLen: 6,
    skin: [C.red0, C.red1, C.red2],
    back: (s, x, y, _p, t) => {
        // bat wings beating a little, and the barbed tail
        const beat = Math.floor(t * 6) & 1
        tri(s, x - 1, y + 1, x - 10, y - 5 - beat, x - 8, y + 4, C.red0)
        line(s, x - 1, y + 1, x - 10, y - 5 - beat, C.red1)
        line(s, x - 5, y - 1, x - 7, y + 3, C.red1)
        line(s, x - 2, y + 6, x - 7, y + 9, C.red0)
        tri(s, x - 8, y + 8, x - 8, y + 11, x - 10, y + 9, C.red1)
    },
    head: (s, x, y, p) => {
        ellipse(s, x, y - 4, 4, 3.5, C.red1)
        // big pointed ears and bone horns
        tri(s, x - 3, y - 5, x - 2, y - 3, x - 8, y - 8, C.red1)
        line(s, x - 3, y - 5, x - 7, y - 7, C.red2)
        line(s, x - 1, y - 7, x - 2, y - 10, C.bone1)
        line(s, x + 2, y - 7, x + 3, y - 10, C.bone1)
        // a hooked nose and the grin, fangs showing
        px(s, x + 4, y - 4, C.red2); px(s, x + 5, y - 3, C.red1)
        line(s, x, y - 2, x + 4, y - 2, C.ink)
        px(s, x + 1, y - 1, C.white); px(s, x + 3, y - 1, C.white)
        rect(s, x + 1, y - 6, 3, 1, C.red0) // brow
        eyes(s, x + 2, y - 5, C.gold3, p)
        px(s, x - 2, y - 6, C.stone3); px(s, x + 1, y - 7, C.stone3) // ash
    },
    torso: (s, x, y) => {
        rect(s, x - 3, y, 6, 6, C.red1)
        rect(s, x - 3, y, 1, 6, C.red0)
        px(s, x, y + 2, C.red2); px(s, x + 1, y + 3, C.red2)
        rect(s, x - 3, y + 5, 6, 2, C.brown0) // a scrap of loincloth
        px(s, x - 2, y + 1, C.stone3); px(s, x + 1, y, C.stone3)
    },
    pants: C.red1, pantsDk: C.red0, boot: C.red0, bootHi: C.red1,
    arm: C.red1, armLow: C.red1, armBack: C.red0, armBackLow: C.red0, hand: C.red2,
    blade: M.obsidian, haft: M.bone, gem: M.lava, gemStyle: Gem.Flame, accent: C.orange
}

// 3 · Cinderpass — Salamander Firecaller (caster): a tall crimson fire salamander with gold spots,
// a wide flat head with bulging gold eyes and a crest of living flame, in a dark indigo robe with
// gold trim and a string of bone beads, calling fire from a flame-headed staff.
const salamanderFirecaller: WorldSkin = {
    legLen: 8, torsoLen: 8,
    skin: [C.red0, C.red1, C.gold2],
    back: (s, x, y) => {
        // the spotted tail curling out from under the robe
        line(s, x - 3, y + 14, x - 9, y + 18, C.red1, 2)
        px(s, x - 6, y + 16, C.gold2); px(s, x - 9, y + 17, C.gold2)
    },
    head: (s, x, y, p, t) => {
        // the crest of living flame, flickering
        const k = Math.floor(t * 10) & 3
        for (let i = 0; i < 4; i++) {
            const h = 3 + ((i + k) % 3)
            tri(s, x - 3 + i * 2, y - 7, x - 1 + i * 2, y - 7, x - 4 + i * 2, y - 7 - h, i & 1 ? C.orange : C.lava1)
            px(s, x - 3 + i * 2, y - 8, C.gold2)
        }
        // a wide flat head, blotched gold, the mouth a long line
        ellipse(s, x + 1, y - 4, 6, 3, C.red1)
        rect(s, x + 2, y - 3, 6, 2, C.red1)
        line(s, x - 3, y - 4, x + 5, y - 6, C.red2) // the lit crown
        line(s, x - 1, y - 2, x + 8, y - 2, C.ink)
        px(s, x + 7, y - 1, C.red1) // the tongue's tip
        rect(s, x - 3, y - 4, 2, 2, C.gold2); rect(s, x + 5, y - 4, 2, 1, C.gold2); px(s, x, y - 1, C.gold2)
        // bulging gold eyes on top of the head
        disc(s, x + 3, y - 6, 2, C.red1)
        rect(s, x + 2, y - 7, 3, 2, C.gold3)
        eyes(s, x + 3, y - 7, C.ink, p)
    },
    torso: (s, x, y) => {
        rect(s, x - 3, y, 7, 8, C.night2)
        rect(s, x - 3, y, 1, 8, C.night1)
        line(s, x + 3, y, x + 3, y + 7, C.gold1) // trim
        // a string of bone beads
        for (let i = 0; i < 4; i++) px(s, x - 2 + i * 2, y + 1 + (i & 1), C.bone1)
        rect(s, x - 3, y + 6, 7, 1, C.gold1)
    },
    lower: (s, x, hipY, _p, t) => robeSkirt(s, x, hipY, J.oy - 1, [C.night1, C.night2, C.night3], C.gold1, (Math.floor(t * 2) & 1) - 0.5, C.red1, 0),
    pants: C.night2, pantsDk: C.night1, boot: C.red0, bootHi: C.red1,
    arm: C.red1, armLow: C.night2, armBack: C.red0, armBackLow: C.night1, hand: C.red2,
    blade: M.obsidian, haft: M.darkwood, gem: M.lava, gemStyle: Gem.Flame, accent: C.orange
}

// 4 · Rimeholt — Frostbound Raider (melee): a raider who swore himself to the cold. Frost-pale
// skin with a band of blue woad across the eyes, a horned helm hung with icicles, a braided beard
// white with rime, a fur mantle over mail, a painted round shield slung on the back.
const frostboundRaider: WorldSkin = {
    legLen: 8, torsoLen: 9,
    skin: [C.night3, C.haze, C.frost],
    back: (s, x, y) => {
        // the round shield slung on the back, painted in halves, an iron boss
        disc(s, x - 4, y + 5, 5, C.brown1)
        disc(s, x - 4, y + 5, 4, C.red1)
        tri(s, x - 8, y + 5, x, y + 5, x - 4, y + 1, C.bone1)
        disc(s, x - 4, y + 5, 1.5, C.steel2)
    },
    head: (s, x, y, p) => {
        ellipse(s, x, y - 4, 4, 4, C.haze)
        rect(s, x + 1, y - 6, 3, 3, C.frost)
        rect(s, x - 2, y - 5, 7, 2, C.blue1) // the woad across the eyes
        eyes(s, x + 2, y - 5, C.cyan, p)
        px(s, x + 4, y - 3, C.haze) // nose
        // the beard, braided and white with rime
        rect(s, x - 1, y - 2, 5, 3, C.white)
        line(s, x + 1, y + 1, x + 1, y + 4, C.frost); line(s, x + 3, y + 1, x + 3, y + 3, C.frost)
        px(s, x + 1, y + 4, C.cyan); px(s, x + 3, y + 3, C.cyan)
        // the helm, its horns, icicles off the brim
        ellipse(s, x, y - 8, 4, 2.5, C.steel1)
        rect(s, x - 4, y - 7, 9, 1, C.steel0)
        px(s, x - 1, y - 10, C.steel2)
        line(s, x - 4, y - 8, x - 7, y - 12, C.bone1); px(s, x - 7, y - 13, C.white)
        line(s, x + 4, y - 8, x + 6, y - 12, C.bone1); px(s, x + 6, y - 13, C.white)
        px(s, x - 3, y - 6, C.cyan); px(s, x - 3, y - 5, C.frost) // icicle
        px(s, x + 4, y - 6, C.frost)
    },
    torso: (s, x, y) => {
        rect(s, x - 4, y, 8, 9, C.steel1) // mail
        for (let k = 1; k < 9; k += 2) for (let i = -3; i < 4; i += 2) px(s, x + i + (k & 2 ? 1 : 0), y + k, C.steel2)
        rect(s, x - 4, y, 1, 9, C.steel0)
        rect(s, x - 5, y - 1, 10, 3, C.bone1) // fur mantle
        px(s, x - 4, y + 2, C.bone0); px(s, x - 1, y + 2, C.white); px(s, x + 3, y + 2, C.bone0)
        rect(s, x - 4, y + 6, 8, 1, C.brown1) // belt
        px(s, x, y + 6, C.gold2)
    },
    pants: C.brown2, pantsDk: C.brown1, boot: C.bone0, bootHi: C.bone1,
    arm: C.brown2, armLow: C.haze, armBack: C.brown1, armBackLow: C.night3, hand: C.haze,
    blade: M.ice, haft: M.darkwood, gem: M.ice, gemStyle: Gem.Crystal, accent: C.cyan,
    ambient: (dst, t) => {
        const k = step(t, 10, 10)
        dst.set(fxX(J.bx - 6 + ((k * 3) % 13)), fxY(J.topY - 6 + k * 2), C.white)
    }
}

// 4 · Rimeholt — Rime Troll (heavy): a big shaggy frost troll, blue-skinned under a mane of white
// fur hung with icicles, a long nose over tusks, small eyes glinting cyan.
const rimeTroll: WorldSkin = {
    legLen: 8, torsoLen: 10,
    skin: [C.blue0, C.blue1, C.blue2],
    head: (s, x, y, p) => {
        // the mane first, falling round the head and down the back
        ellipse(s, x - 1, y - 4, 6, 5, C.white)
        for (let i = 0; i < 4; i++) line(s, x - 5 + i * 2, y - 1, x - 6 + i * 2, y + 3 + (i & 1) * 2, i & 1 ? C.frost : C.white)
        ellipse(s, x + 2, y - 4, 4, 3.5, C.blue1)
        rect(s, x + 1, y - 7, 3, 1, C.blue2)
        // the long nose, the tusks, the eyes
        line(s, x + 4, y - 4, x + 8, y - 2, C.blue2)
        px(s, x + 8, y - 1, C.blue1)
        rect(s, x + 1, y - 1, 5, 1, C.ink)
        px(s, x + 2, y - 2, C.white); px(s, x + 5, y - 2, C.white)
        eyes(s, x + 3, y - 5, C.cyan, p)
        px(s, x - 3, y - 8, C.cyan); px(s, x - 3, y - 7, C.frost) // icicles in the mane
        px(s, x + 1, y - 9, C.frost)
    },
    torso: (s, x, y) => {
        rect(s, x - 5, y, 11, 10, C.blue1)
        rect(s, x - 5, y, 2, 10, C.blue0)
        rect(s, x + 1, y + 3, 4, 5, C.blue2) // the lit belly
        // the white mane running down the back and shoulders
        rect(s, x - 6, y - 1, 8, 4, C.white)
        for (let i = 0; i < 3; i++) px(s, x - 5 + i * 3, y + 3, C.frost)
        rect(s, x - 5, y + 8, 11, 2, C.bone0) // a loincloth of hide
        px(s, x - 1, y + 9, C.bone1)
    },
    pants: C.blue1, pantsDk: C.blue0, boot: C.white, bootHi: C.frost,
    arm: C.blue1, armLow: C.blue1, armBack: C.blue0, armBackLow: C.blue0, hand: C.blue2,
    blade: M.ice, haft: M.darkwood, gem: M.ice, gemStyle: Gem.Crystal, accent: C.cyan
}

// 4 · Rimeholt — Snowfield Huntress (ranged): a hunter in white winter furs, a fur-lined hood
// thrown back off a dark braid, blue war paint on the cheeks, a quiver across her back.
const snowfieldHuntress: WorldSkin = {
    legLen: 8, torsoLen: 8,
    skin: [C.skin0, C.skin1, C.skin2],
    back: (s, x, y) => {
        line(s, x - 4, y + 7, x + 1, y - 2, C.brown1, 2) // the quiver
        px(s, x + 1, y - 3, C.white); px(s, x + 2, y - 3, C.bone1); px(s, x, y - 3, C.cyan) // fletching
    },
    head: (s, x, y, p) => {
        // the hood thrown back, fur-lined, and the dark braid falling from it
        ellipse(s, x - 2, y - 4, 5, 4, C.bone1)
        dither(s, x - 7, y - 8, 10, 8, C.white, 8)
        line(s, x - 3, y - 2, x - 4, y + 5, C.brown0, 2)
        px(s, x - 4, y + 6, C.red1)
        ellipse(s, x + 1, y - 4, 3.5, 3.5, C.skin1)
        rect(s, x, y - 7, 3, 2, C.brown0) // hair
        eyes(s, x + 2, y - 4, C.ink, p)
        line(s, x + 1, y - 3, x + 3, y - 3, C.blue1) // war paint
        px(s, x + 4, y - 3, C.skin0)
        px(s, x + 2, y - 1, C.red1) // lips
    },
    torso: (s, x, y) => {
        rect(s, x - 3, y, 7, 8, C.bone1)
        rect(s, x - 3, y, 1, 8, C.bone0)
        line(s, x - 3, y, x + 3, y + 6, C.brown1) // the quiver strap
        rect(s, x - 3, y + 6, 7, 1, C.brown1)
        dither(s, x - 3, y + 7, 7, 2, C.white, 8) // the fur hem
    },
    pants: C.brown2, pantsDk: C.brown1, boot: C.white, bootHi: C.bone1,
    arm: C.bone1, armLow: C.bone1, armBack: C.bone0, armBackLow: C.bone0, hand: C.skin1,
    blade: M.ice, haft: M.wood, gem: M.ice, gemStyle: Gem.Crystal, accent: C.cyan
}

// 4 · Rimeholt — Rune Skald (caster): the hold's old bard and seer, a long white beard under a
// bearskin hood, a deep red cloak edged in gold, calling the cold down with a staff of runes that
// glow cyan.
const runeSkald: WorldSkin = {
    legLen: 7, torsoLen: 8,
    skin: [C.skin0, C.skin1, C.skin2],
    head: (s, x, y, p, t) => {
        // the bearskin hood, the bear's own head over his brow
        ellipse(s, x - 1, y - 5, 5, 4, C.brown1)
        ellipse(s, x + 1, y - 8, 4, 2, C.brown2)
        px(s, x + 4, y - 8, C.ink); px(s, x - 3, y - 10, C.brown1); px(s, x + 2, y - 10, C.brown1) // the bear's snout and ears
        ellipse(s, x + 1, y - 4, 3, 3, C.skin1)
        eyes(s, x + 2, y - 5, C.cyan, p)
        // the long white beard, and a rune glowing on his brow
        tri(s, x - 1, y - 3, x + 4, y - 3, x + 1, y + 5, C.white)
        line(s, x + 1, y - 2, x + 1, y + 3, C.frost)
        px(s, x + 1, y - 6, (Math.floor(t * 3) & 1) ? C.cyan : C.frost)
    },
    torso: (s, x, y) => {
        rect(s, x - 3, y, 7, 8, C.red1)
        rect(s, x - 3, y, 1, 8, C.red0)
        line(s, x + 3, y, x + 3, y + 7, C.gold1) // the gold edge
        rect(s, x - 4, y - 1, 9, 2, C.brown1) // the bearskin over the shoulders
        for (let i = 0; i < 3; i++) px(s, x - 2 + i * 2, y + 3, C.cyan) // runes stitched on the chest
        rect(s, x - 3, y + 6, 7, 1, C.gold1)
    },
    lower: (s, x, hipY, _p, t) => robeSkirt(s, x, hipY, J.oy - 1, [C.red0, C.red1, C.red2], C.gold1, (Math.floor(t * 2) & 1) - 0.5, C.brown0, 0),
    pants: C.red1, pantsDk: C.red0, boot: C.brown0, bootHi: C.brown1,
    arm: C.red1, armLow: C.red1, armBack: C.red0, armBackLow: C.red0, hand: C.skin1,
    blade: M.ice, haft: M.darkwood, gem: M.ice, gemStyle: Gem.Crystal, accent: C.cyan
}

// 5 · Sunken Amarath — Drowned Sailor (melee): bloated sea-green, barnacled at the jaw, still in his
// tricorne with seaweed dripping off the brim, a torn striped shirt, a rusted cutlass.
const drownedSailor: WorldSkin = {
    legLen: 8, torsoLen: 9,
    skin: [C.teal0, C.teal2, C.teal3],
    head: (s, x, y, p) => {
        ellipse(s, x + 1, y - 4, 4, 4, C.teal2)
        rect(s, x + 2, y - 6, 3, 3, C.teal3) // the bloated, lit cheek
        px(s, x + 5, y - 3, C.teal2) // nose
        rect(s, x + 1, y - 6, 3, 1, C.teal1)
        eyes(s, x + 3, y - 5, C.white, p)
        line(s, x + 1, y - 1, x + 4, y - 1, C.teal0)
        px(s, x - 2, y - 2, C.bone1); px(s, x - 1, y - 1, C.bone1); px(s, x, y - 1, C.white) // barnacles
        // the tricorne, and seaweed dripping off its brim
        rect(s, x - 5, y - 8, 12, 1, C.night1)
        poly(s, [-3, 0, 4, 0, 3, -3, -2, -3], x, y - 8, C.night1)
        px(s, x - 5, y - 9, C.night1); px(s, x + 6, y - 9, C.night1)
        rect(s, x - 3, y - 9, 7, 1, C.gold1) // the braid
        line(s, x - 4, y - 7, x - 5, y - 3, C.green2)
        line(s, x + 6, y - 7, x + 6, y - 4, C.green1)
    },
    torso: (s, x, y) => {
        rect(s, x - 4, y, 8, 9, C.bone1)
        for (let i = 0; i < 4; i++) rect(s, x - 4, y + 1 + i * 2, 8, 1, C.blue1) // the striped shirt
        rect(s, x - 4, y, 1, 9, C.steel2)
        poly(s, [0, 0, 3, 1, 2, 4, -1, 3], x + 1, y + 3, C.teal2) // a tear, the drowned skin through it
        px(s, x + 2, y + 5, C.teal0)
        rect(s, x - 4, y + 7, 8, 1, C.night1) // the sash
        px(s, x - 3, y + 2, C.bone1); px(s, x - 2, y + 5, C.white) // barnacles
    },
    pants: C.blue0, pantsDk: C.night0, boot: C.night1, bootHi: C.night2,
    arm: C.bone1, armLow: C.teal2, armBack: C.steel2, armBackLow: C.teal1, hand: C.teal2,
    blade: M.rust, haft: M.darkwood, gem: M.sea, gemStyle: Gem.Moon, accent: C.teal3,
    ambient: (dst, t) => {
        const k = step(t, 10, 9)
        if (k < 6) dst.set(fxX(J.headX + 5), fxY(J.headY - 8 - k * 2), C.teal3)
    }
}

// 5 · Sunken Amarath — Barnacle Brute (heavy): a hulking drowned thing grown over with red crab
// shell, its head a shell helm with eyes on stalks, barnacles crusting its shoulders.
const barnacleBrute: WorldSkin = {
    legLen: 8, torsoLen: 10,
    skin: [C.red0, C.red1, C.red2],
    head: (s, x, y, p) => {
        // the eyes on their stalks
        line(s, x, y - 7, x - 1, y - 10, C.red1); line(s, x + 3, y - 7, x + 4, y - 10, C.red1)
        disc(s, x - 1, y - 11, 1.2, C.ink); disc(s, x + 4, y - 11, 1.2, C.ink)
        eyes(s, x - 1, y - 11, C.gold3, p); eyes(s, x + 4, y - 11, C.gold3, p)
        // the shell helm, ridged, lit on top
        ellipse(s, x + 1, y - 4, 6, 4, C.red1)
        line(s, x - 3, y - 7, x + 5, y - 7, C.red3)
        for (let i = 0; i < 3; i++) px(s, x - 2 + i * 3, y - 5, C.red0) // ridges
        // the mouthparts under it
        rect(s, x + 1, y - 1, 5, 2, C.teal1)
        for (let i = 0; i < 3; i++) px(s, x + 2 + i * 2, y, C.teal3)
        px(s, x - 3, y - 3, C.bone1); px(s, x - 4, y - 2, C.white) // barnacles
    },
    torso: (s, x, y) => {
        rect(s, x - 5, y, 11, 10, C.teal1) // the drowned hide under the shell
        // plates of crab shell over the chest and belly
        ellipse(s, x + 1, y + 3, 5, 3, C.red1)
        ellipse(s, x + 1, y + 7, 4, 2, C.red1)
        line(s, x - 3, y + 1, x + 4, y + 1, C.red3)
        line(s, x - 2, y + 6, x + 4, y + 6, C.red2)
        // barnacles crusting the shoulders
        for (const [bx, by] of [[-5, 0], [-3, -1], [4, 0], [6, 1], [-5, 2]] as const) { px(s, x + bx, y + by, C.bone1); px(s, x + bx + 1, y + by, C.white) }
        rect(s, x - 5, y + 9, 11, 1, C.teal0)
    },
    pants: C.teal1, pantsDk: C.teal0, boot: C.red0, bootHi: C.red1,
    arm: C.red1, armLow: C.teal1, armBack: C.red0, armBackLow: C.teal0, hand: C.red2,
    blade: M.rust, haft: M.darkwood, gem: M.sea, gemStyle: Gem.Moon, accent: C.red3
}

// 5 · Sunken Amarath — Harpoon Siren (ranged): a siren of the drowned harbour, sea-green with fins
// for ears and long violet hair, a scaled blue sheath from hip to ankle, loosing harpoons.
const harpoonSiren: WorldSkin = {
    legLen: 8, torsoLen: 8,
    skin: [C.teal1, C.teal2, C.teal3],
    head: (s, x, y, p, t) => {
        // the long violet hair streaming back, and the fin of an ear
        const drift = Math.floor(t * 3) & 1
        ellipse(s, x - 2, y - 4, 4, 4, C.purple1)
        for (let i = 0; i < 4; i++) line(s, x - 4 + i, y - 2, x - 7 + i - drift, y + 5 + (i & 1) * 2, i & 1 ? C.purple2 : C.purple1)
        ellipse(s, x + 1, y - 4, 3.5, 3.5, C.teal2)
        rect(s, x + 1, y - 6, 3, 2, C.teal3)
        tri(s, x - 2, y - 5, x - 2, y - 2, x - 5, y - 6, C.cyan) // the fin
        line(s, x - 2, y - 4, x - 4, y - 5, C.teal3)
        eyes(s, x + 2, y - 5, C.gold2, p)
        px(s, x + 2, y - 1, C.teal0)
        px(s, x + 3, y - 2, C.teal0) // gill slits
        rect(s, x - 1, y - 8, 4, 1, C.purple2) // the hair over her brow
    },
    torso: (s, x, y) => {
        rect(s, x - 3, y, 7, 8, C.teal2)
        rect(s, x - 3, y, 1, 8, C.teal1)
        // a shell bodice and a string of pearls
        ellipse(s, x, y + 2, 2, 1.5, C.pink); ellipse(s, x + 3, y + 2, 2, 1.5, C.pink)
        for (let i = 0; i < 4; i++) px(s, x - 2 + i * 2, y, C.white)
        // the scaled sheath from the hip
        rect(s, x - 3, y + 5, 7, 3, C.blue1)
        for (let i = 0; i < 3; i++) px(s, x - 2 + i * 2, y + 6, C.blue2)
    },
    pants: C.blue1, pantsDk: C.blue0, boot: C.cyan, bootHi: C.teal3,
    arm: C.teal2, armLow: C.teal2, armBack: C.teal1, armBackLow: C.teal1, hand: C.teal3,
    blade: M.rust, haft: M.darkwood, gem: M.sea, gemStyle: Gem.Moon, accent: C.cyan
}

// 5 · Sunken Amarath — Tide Priestess (caster): a priestess of the drowned temple, pale and
// drowned, in white-and-gold robes, a headdress of red coral, the moon-gem staff of the tides.
const tidePriestess: WorldSkin = {
    legLen: 7, torsoLen: 8,
    skin: [C.teal1, C.teal2, C.teal3],
    head: (s, x, y, p) => {
        // the headdress of coral branching up behind the head
        for (let i = 0; i < 4; i++) {
            line(s, x - 3 + i * 2, y - 7, x - 5 + i * 3, y - 12 - (i & 1) * 2, C.red2)
            px(s, x - 5 + i * 3, y - 13 - (i & 1) * 2, C.red3)
        }
        // the white veil over the head, the face under it
        ellipse(s, x - 1, y - 4, 5, 4.5, C.white)
        ellipse(s, x + 1, y - 4, 3, 3.5, C.teal2)
        rect(s, x + 1, y - 6, 3, 2, C.teal3)
        eyes(s, x + 2, y - 5, C.cyan, p)
        px(s, x + 2, y - 2, C.teal0)
        rect(s, x - 3, y - 8, 7, 1, C.gold2) // the circlet
        px(s, x, y - 8, C.cyan)
    },
    torso: (s, x, y) => {
        rect(s, x - 3, y, 7, 8, C.white)
        rect(s, x - 3, y, 1, 8, C.steel2)
        line(s, x, y, x, y + 7, C.gold1) // the gold panel down the front
        rect(s, x - 3, y + 5, 7, 1, C.gold1) // the girdle
        px(s, x, y + 5, C.cyan)
        for (let i = 0; i < 3; i++) px(s, x - 2 + i * 2, y + 1, C.gold2) // the collar
    },
    lower: (s, x, hipY, _p, t) => robeSkirt(s, x, hipY, J.oy - 1, [C.steel2, C.steel3, C.white], C.gold1, (Math.floor(t * 2) & 1) - 0.5, C.teal1, 0),
    pants: C.steel3, pantsDk: C.steel2, boot: C.teal1, bootHi: C.teal2,
    arm: C.white, armLow: C.teal2, armBack: C.steel3, armBackLow: C.teal1, hand: C.teal3,
    blade: M.rust, haft: M.darkwood, gem: M.sea, gemStyle: Gem.Moon, accent: C.cyan
}

// 6 · Duskspire — Hollow Acolyte (melee): a deep violet robe and a peaked hood lit along its rim,
// nothing inside but the dark and two points of light; a gold-trimmed stole, a void-glass sickle.
const hollowAcolyte: WorldSkin = {
    legLen: 8, torsoLen: 9,
    skin: [C.void, C.ink, C.purple0],
    head: (s, x, y, p, t) => {
        // the hood, peaked and falling back over the shoulders, lit along its rim
        ellipse(s, x, y - 5, 5, 5, C.purple1)
        tri(s, x - 5, y - 6, x - 1, y - 10, x - 7, y - 2, C.purple1)
        px(s, x - 4, y - 11, C.purple1); px(s, x - 5, y - 12, C.purple2) // the peak
        line(s, x - 4, y - 9, x + 1, y - 10, C.purple2)
        line(s, x + 2, y - 10, x + 4, y - 8, C.pink) // the rim of twilight on the hood's edge
        rect(s, x - 5, y - 5, 2, 5, C.purple0)
        // nothing inside but the dark, two points of light, and their glow
        ellipse(s, x + 2, y - 4, 3, 4, C.ink)
        const lit = p[HP.flash]! > 0.5
        dither(s, x, y - 7, 5, 4, C.purple0, 4 + (Math.floor(t * 2) & 1) * 2)
        px(s, x + 1, y - 5, lit ? C.white : C.pink); px(s, x + 3, y - 5, lit ? C.white : C.pink)
        if (!lit) px(s, x + 3, y - 6, C.white)
    },
    torso: (s, x, y) => {
        rect(s, x - 4, y, 8, 9, C.purple1)
        rect(s, x - 4, y, 2, 9, C.purple0)
        line(s, x + 2, y, x + 2, y + 8, C.purple2) // the lit fold
        // the stole, gold-edged, a rune stitched at its end
        rect(s, x - 1, y, 2, 8, C.night2)
        line(s, x - 1, y, x - 1, y + 8, C.gold1)
        px(s, x, y + 6, C.pink); px(s, x, y + 7, C.gold2)
        rect(s, x - 4, y + 5, 8, 1, C.gold0) // the cord belt
        px(s, x + 3, y + 5, C.gold2)
    },
    lower: (s, x, hipY, _p, t) => robeSkirt(s, x, hipY, J.oy - 1, [C.purple0, C.purple1, C.purple2], C.gold1, (Math.floor(t * 2) & 1) - 0.5, C.ink, 0),
    pants: C.purple0, pantsDk: C.void, boot: C.ink, bootHi: C.void,
    arm: C.purple1, armLow: C.purple1, armBack: C.purple0, armBackLow: C.purple0, hand: C.ink,
    blade: M.voidm, haft: M.obsidian, gem: M.voidm, gemStyle: Gem.Crystal, accent: C.pink
}

// 6 · Duskspire — Spire Gargoyle (heavy): a gargoyle of black basalt pried off the towers and set
// walking, horned and fanged, bat wings folded on its back, pink rune-light burning through cracks.
const spireGargoyle: WorldSkin = {
    legLen: 7, torsoLen: 10,
    skin: [C.void, C.stone0, C.stone1],
    back: (s, x, y, _p, t) => {
        // the folded bat wings, a claw at each wrist, twitching
        const tw = Math.floor(t * 2) & 1
        tri(s, x - 3, y, x - 11, y - 5 - tw, x - 8, y + 9, C.stone0)
        tri(s, x - 3, y + 1, x - 9, y - 3 - tw, x - 7, y + 7, C.purple0)
        line(s, x - 3, y, x - 11, y - 5 - tw, C.stone2)
        px(s, x - 12, y - 6 - tw, C.bone0) // the wrist claw
        for (let i = 0; i < 3; i++) line(s, x - 10 + i, y - 4 - tw, x - 9 + i * 1, y + 7 - i, C.void) // the wing fingers
    },
    head: (s, x, y, p) => {
        // ridged horns swept back, a pointed ear, a heavy brow over a fanged muzzle
        line(s, x - 1, y - 8, x - 4, y - 12, C.stone2); line(s, x - 4, y - 12, x - 7, y - 12, C.stone2); px(s, x - 8, y - 11, C.bone0)
        line(s, x + 1, y - 8, x, y - 13, C.stone1); px(s, x - 1, y - 14, C.bone0)
        tri(s, x - 3, y - 6, x - 3, y - 3, x - 7, y - 7, C.stone1)
        ellipse(s, x, y - 4, 4, 4, C.stone1)
        ellipse(s, x - 1, y - 6, 2, 1.5, C.stone2)
        rect(s, x, y - 7, 4, 1, C.stone3) // the lit brow
        rect(s, x + 2, y - 4, 4, 3, C.stone1) // the muzzle
        line(s, x + 2, y - 4, x + 5, y - 4, C.stone2)
        rect(s, x + 2, y - 1, 4, 1, C.ink)
        px(s, x + 3, y - 2, C.white); px(s, x + 5, y - 2, C.white) // fangs
        px(s, x + 1, y - 5, C.purple2); px(s, x + 2, y - 5, C.pink)
        eyes(s, x + 3, y - 5, C.white, p)
    },
    torso: (s, x, y) => {
        rect(s, x - 5, y, 10, 10, C.stone1)
        rect(s, x - 5, y, 2, 10, C.stone0)
        ellipse(s, x + 1, y + 3, 3, 2, C.stone2) // the carved chest
        line(s, x - 2, y, x + 4, y, C.stone3) // the lit shoulders
        line(s, x - 3, y + 7, x + 3, y + 7, C.void) // the belly ridge
        // the rune cracks burning pink
        line(s, x - 1, y + 1, x + 1, y + 4, C.pink); line(s, x + 1, y + 4, x, y + 8, C.purple2)
        px(s, x + 3, y + 6, C.pink)
        rect(s, x - 5, y + 9, 10, 1, C.void)
    },
    pants: C.stone1, pantsDk: C.stone0, boot: C.stone0, bootHi: C.stone1,
    arm: C.stone1, armLow: C.stone1, armBack: C.stone0, armBackLow: C.stone0, hand: C.stone2,
    blade: M.obsidian, haft: M.obsidian, gem: M.voidm, gemStyle: Gem.Claw, accent: C.pink
}

// 6 · Duskspire — Spellbound Construct (ranged): a brass automaton the mages built to guard their
// towers, a domed helm with a glowing visor slit, rivets, a crystal finial, an arcane core in its chest.
const spellboundConstruct: WorldSkin = {
    legLen: 8, torsoLen: 9,
    skin: [C.gold0, C.gold1, C.gold2],
    head: (s, x, y, p, t) => {
        ellipse(s, x, y - 5, 4, 5, C.gold1)
        ellipse(s, x - 1, y - 7, 2, 2, C.gold2) // the lit dome
        px(s, x - 2, y - 8, C.gold3)
        rect(s, x - 4, y - 3, 8, 3, C.gold0) // the jaw plate
        // the visor slit, glowing
        const lit = p[HP.flash]! > 0.5
        rect(s, x, y - 5, 5, 1, C.ink)
        rect(s, x + 1, y - 5, 3, 1, lit ? C.white : C.cyan)
        if (Math.floor(t * 3) & 1) px(s, x + 4, y - 5, C.frost)
        px(s, x - 3, y - 4, C.gold2); px(s, x + 2, y - 2, C.gold2) // rivets
        // the crystal finial
        line(s, x, y - 10, x, y - 11, C.gold0)
        tri(s, x - 1, y - 11, x + 1, y - 11, x, y - 14, C.cyan)
        px(s, x, y - 13, C.white)
    },
    torso: (s, x, y) => {
        rect(s, x - 4, y, 8, 9, C.gold1)
        rect(s, x - 4, y, 2, 9, C.gold0)
        line(s, x + 3, y, x + 3, y + 8, C.gold2)
        // the arcane core, a crystal behind a ring of brass
        disc(s, x + 1, y + 3, 2, C.gold0)
        disc(s, x + 1, y + 3, 1.2, C.cyan)
        px(s, x + 1, y + 3, C.white)
        for (const [rx, ry] of [[-3, 1], [-3, 6], [2, 7], [3, 1]] as const) px(s, x + rx, y + ry, C.gold3) // rivets
        rect(s, x - 4, y + 6, 8, 1, C.gold0) // the waist seam
        line(s, x - 2, y + 7, x - 2, y + 8, C.steel2) // a pipe
    },
    pants: C.gold0, pantsDk: C.brown1, boot: C.gold0, bootHi: C.gold1,
    arm: C.gold1, armLow: C.gold0, armBack: C.gold0, armBackLow: C.brown1, hand: C.gold2,
    blade: M.arcane, haft: M.bronze, gem: M.arcane, gemStyle: Gem.Crystal, accent: C.cyan
}

// 6 · Duskspire — Riftbound Magus (caster): a tower mage half taken by the Void he studied, in
// indigo and gold, a rift torn across his face with stars inside it, shards of it circling his head.
const riftboundMagus: WorldSkin = {
    legLen: 7, torsoLen: 8,
    skin: [C.skin0, C.skin1, C.skin2],
    head: (s, x, y, p, t) => {
        // the high collar behind the head
        tri(s, x - 5, y, x - 1, y - 1, x - 6, y - 8, C.blue0)
        // grey hair swept back off the brow into a tail
        ellipse(s, x - 2, y - 5, 3, 4, C.steel2)
        tri(s, x - 4, y - 6, x - 3, y - 2, x - 8, y - 1, C.steel2)
        line(s, x - 4, y - 8, x - 7, y - 3, C.steel3)
        ellipse(s, x + 1, y - 4, 4, 4.5, C.skin1)
        rect(s, x + 2, y - 7, 3, 3, C.skin2) // the lit brow and cheek
        px(s, x + 5, y - 4, C.skin1) // the nose
        line(s, x - 2, y - 8, x + 3, y - 9, C.steel3) // the hairline
        // the rift across his face: a jagged tear with the Void inside it
        line(s, x, y - 8, x + 1, y - 6, C.ink); line(s, x + 1, y - 6, x, y - 4, C.ink); line(s, x, y - 4, x + 2, y - 1, C.ink)
        px(s, x + 1, y - 7, C.purple2); px(s, x, y - 4, C.white)
        eyes(s, x + 3, y - 5, C.pink, p)
        line(s, x + 3, y - 1, x + 4, y - 1, C.skin0)
        // shards of the Void circling his head
        const a = t * 3
        for (let i = 0; i < 3; i++) {
            const sx = Math.round(x + Math.cos(a + i * 2.1) * 7)
            const sy = Math.round(y - 7 + Math.sin(a + i * 2.1) * 2)
            px(s, sx, sy, i === 0 ? C.pink : C.purple2); px(s, sx, sy - 1, C.void)
        }
    },
    torso: (s, x, y) => {
        rect(s, x - 3, y, 7, 8, C.blue1)
        rect(s, x - 3, y, 2, 8, C.blue0)
        line(s, x + 3, y, x + 3, y + 7, C.gold1) // the gold edge
        rect(s, x - 4, y - 1, 9, 2, C.blue0) // the mantle
        line(s, x - 4, y - 1, x + 4, y - 1, C.gold1)
        px(s, x + 1, y + 1, C.gold2); px(s, x + 1, y + 2, C.pink) // the clasp, and the Void creeping out of it
        line(s, x, y + 3, x - 1, y + 5, C.ink); px(s, x - 1, y + 4, C.purple2)
        rect(s, x - 3, y + 6, 7, 1, C.gold1)
    },
    lower: (s, x, hipY, _p, t) => robeSkirt(s, x, hipY, J.oy - 1, [C.blue0, C.blue1, C.blue2], C.gold1, (Math.floor(t * 2) & 1) - 0.5, C.ink, 0),
    pants: C.blue1, pantsDk: C.blue0, boot: C.ink, bootHi: C.night2,
    arm: C.blue1, armLow: C.blue1, armBack: C.blue0, armBackLow: C.blue0, hand: C.skin1,
    blade: M.voidm, haft: M.darkwood, gem: M.voidm, gemStyle: Gem.Crystal, accent: C.pink
}

// 7 · The Bonefields — Restless Legionnaire (melee): a skull in a rusted bronze legion helm with a
// red crest and cheek guards, green soul-fire in the sockets, ribs showing under a banded bronze
// cuirass over a red tunic, a tattered red cloak, a rusted gladius.
const restlessLegionnaire: WorldSkin = {
    legLen: 8, torsoLen: 9,
    skin: [C.bone0, C.bone1, C.white],
    back: (s, x, y, _p, t) => {
        // the tattered cloak, torn at the hem and stirring
        const f = Math.floor(t * 3) & 1
        for (let i = 0; i < 11; i++) rect(s, x - 5 - (i >> 2) - f * (i >> 3), y + i, 3, 1, i > 8 ? C.red0 : i & 1 ? C.red1 : C.red2)
        px(s, x - 8 - f, y + 11, C.red0)
    },
    head: (s, x, y, p) => {
        // the skull
        ellipse(s, x + 1, y - 4, 3.5, 3.5, C.bone1)
        px(s, x + 2, y - 6, C.white)
        rect(s, x + 1, y - 5, 2, 2, C.ink) // the socket
        eyes(s, x + 2, y - 5, C.green4, p)
        px(s, x + 4, y - 3, C.ink) // the nose hole
        rect(s, x, y - 1, 4, 1, C.bone0) // the jaw
        px(s, x + 1, y - 1, C.ink); px(s, x + 3, y - 1, C.ink)
        // the legion helm: a bronze bowl, a neck guard, a cheek guard, a red crest front to back
        ellipse(s, x, y - 7, 4, 2.5, C.brown2)
        line(s, x - 3, y - 8, x + 2, y - 9, C.orange) // the lit bronze
        rect(s, x - 4, y - 7, 2, 4, C.brown1) // the neck guard
        rect(s, x + 3, y - 6, 1, 3, C.brown1) // the cheek guard
        px(s, x - 1, y - 7, C.green2) // verdigris
        for (let i = 0; i < 7; i++) rect(s, x - 3 + i, y - 11 + (i === 0 || i === 6 ? 1 : 0), 1, 2, i & 1 ? C.red1 : C.red2)
        line(s, x - 3, y - 11, x + 3, y - 11, C.red3)
    },
    torso: (s, x, y) => {
        rect(s, x - 4, y, 8, 9, C.red1) // the tunic
        // the ribs, showing where the cuirass has rusted through
        rect(s, x - 4, y, 8, 5, C.ink)
        for (let i = 0; i < 3; i++) line(s, x - 3, y + 1 + i * 2, x + 3, y + 1 + i * 2, C.bone1)
        rect(s, x - 1, y, 2, 6, C.bone0) // the spine
        // the banded cuirass, what is left of it
        rect(s, x - 4, y, 3, 5, C.brown1); line(s, x - 4, y, x - 2, y, C.orange)
        for (let i = 0; i < 2; i++) line(s, x - 4, y + 5 + i * 2, x + 3, y + 5 + i * 2, i ? C.brown1 : C.brown2)
        px(s, x + 2, y + 5, C.orange)
        rect(s, x - 4, y - 1, 3, 2, C.brown2) // the shoulder plate
        // the pteruges: red strips below the belt
        for (let i = 0; i < 4; i++) rect(s, x - 4 + i * 2, y + 8, 1, 2, i & 1 ? C.red0 : C.red1)
    },
    pants: C.bone1, pantsDk: C.bone0, boot: C.brown1, bootHi: C.brown2,
    arm: C.bone1, armLow: C.bone1, armBack: C.bone0, armBackLow: C.bone0, hand: C.bone1,
    blade: M.rust, haft: M.darkwood, gem: M.nature, gemStyle: Gem.Skull, accent: C.green4
}

// 7 · The Bonefields — Barrow Ghoul (heavy): a hunched thing out of the barrows, grave-pale green,
// bald with pointed ears and a fanged jaw, wrapped in a torn burial shroud, an iron collar with a
// length of broken chain, long black claws.
const barrowGhoul: WorldSkin = {
    legLen: 7, torsoLen: 10,
    skin: [C.olive1, C.olive2, C.green3],
    back: (s, x, y, _p, t) => {
        // the broken chain hanging off the collar behind
        const f = Math.floor(t * 2) & 1
        for (let i = 0; i < 5; i++) px(s, x - 4 - (i >> 1) - f * (i >> 2), y + 1 + i * 2, i & 1 ? C.steel1 : C.steel2)
    },
    head: (s, x, y, p) => {
        tri(s, x - 2, y - 6, x - 2, y - 3, x - 7, y - 8, C.olive1) // the pointed ear
        ellipse(s, x + 1, y - 4, 4, 4, C.olive2)
        ellipse(s, x, y - 6, 2, 1.5, C.green3) // the lit crown of the bald head
        line(s, x + 1, y - 6, x + 4, y - 5, C.olive0) // the heavy brow
        eyes(s, x + 3, y - 5, C.gold3, p)
        px(s, x + 5, y - 4, C.olive1) // the nose
        // the jaw, hanging open on fangs
        rect(s, x + 1, y - 2, 5, 2, C.ink)
        px(s, x + 2, y - 2, C.white); px(s, x + 4, y - 2, C.white); px(s, x + 3, y - 1, C.white)
        rect(s, x, y, 5, 1, C.olive1)
    },
    torso: (s, x, y) => {
        rect(s, x - 5, y, 10, 10, C.olive2)
        rect(s, x - 5, y, 3, 10, C.olive1)
        for (let i = 0; i < 2; i++) line(s, x - 1, y + 3 + i * 2, x + 3, y + 3 + i * 2, C.olive1) // the ribs through the skin
        // the burial shroud wound round it, torn
        line(s, x - 5, y + 1, x + 4, y + 6, C.bone1); line(s, x - 5, y + 2, x + 4, y + 7, C.bone0)
        poly(s, [-5, 6, 4, 8, 3, 10, -5, 10], x, y, C.bone1)
        px(s, x - 2, y + 10, C.bone0); px(s, x + 1, y + 10, C.bone1)
        // the iron collar
        rect(s, x - 3, y - 1, 7, 2, C.steel1)
        line(s, x - 3, y - 1, x + 3, y - 1, C.steel2)
    },
    pants: C.bone0, pantsDk: C.stone2, boot: C.olive1, bootHi: C.olive2,
    arm: C.olive2, armLow: C.olive2, armBack: C.olive1, armBackLow: C.olive1, hand: C.ink,
    blade: M.rust, haft: M.darkwood, gem: M.nature, gemStyle: Gem.Claw, accent: C.gold3
}

// 7 · The Bonefields — Bone Archer (ranged): a skeleton under a dark green hooded cloak, eyes lit
// in the shadow of the hood, a quiver of fletched arrows on its back, a bone-tipped bow.
const boneArcher: WorldSkin = {
    legLen: 8, torsoLen: 8,
    skin: [C.bone0, C.bone1, C.white],
    back: (s, x, y) => {
        // the quiver, arrows fletched red
        rect(s, x - 5, y - 2, 2, 8, C.brown1)
        line(s, x - 5, y - 2, x - 5, y + 5, C.brown2)
        for (let i = 0; i < 3; i++) { line(s, x - 5 + i, y - 3, x - 6 + i, y - 5, C.bone0); px(s, x - 6 + i, y - 6, C.red2) }
    },
    head: (s, x, y, p) => {
        // the hood, pointed, falling to the shoulders
        ellipse(s, x, y - 5, 5, 5, C.green0)
        tri(s, x - 4, y - 6, x - 1, y - 10, x - 7, y - 3, C.green0)
        line(s, x - 3, y - 9, x + 2, y - 10, C.green1) // the lit fold
        line(s, x + 3, y - 9, x + 5, y - 6, C.green1)
        // the skull in the hood's shadow
        ellipse(s, x + 2, y - 4, 3, 3.5, C.ink)
        ellipse(s, x + 3, y - 4, 2, 3, C.bone0)
        px(s, x + 4, y - 6, C.bone1)
        px(s, x + 3, y - 5, C.ink)
        eyes(s, x + 3, y - 5, C.green4, p)
        rect(s, x + 2, y - 1, 3, 1, C.bone0); px(s, x + 3, y - 1, C.ink) // the teeth
    },
    torso: (s, x, y) => {
        // the cloak over the shoulders, the ribs under it
        rect(s, x - 4, y, 8, 8, C.ink)
        for (let i = 0; i < 3; i++) line(s, x - 1, y + 1 + i * 2, x + 3, y + 1 + i * 2, C.bone1)
        rect(s, x - 1, y, 1, 7, C.bone0)
        poly(s, [-5, -1, 0, -1, -2, 8, -5, 8], x, y, C.green0)
        line(s, x - 5, y - 1, x - 5, y + 8, C.green1)
        rect(s, x - 4, y + 6, 8, 1, C.brown1) // the belt
        px(s, x + 2, y + 6, C.gold1)
    },
    pants: C.bone1, pantsDk: C.bone0, boot: C.brown0, bootHi: C.brown1,
    arm: C.bone1, armLow: C.bone1, armBack: C.bone0, armBackLow: C.bone0, hand: C.bone1,
    blade: M.bone, haft: M.darkwood, gem: M.nature, gemStyle: Gem.Skull, accent: C.green4
}

// 7 · The Bonefields — Ossuary Priest (caster): a skeletal priest of the ossuaries in violet
// vestments trimmed in gold with a black stole, a tall mitre with a skull on it, a rosary of bone beads, a
// staff crowned with a skull burning green.
const ossuaryPriest: WorldSkin = {
    legLen: 7, torsoLen: 8,
    skin: [C.bone0, C.bone1, C.white],
    head: (s, x, y, p) => {
        // the skull
        ellipse(s, x + 1, y - 4, 3.5, 3.5, C.bone1)
        px(s, x + 2, y - 6, C.white)
        rect(s, x + 1, y - 5, 2, 2, C.ink)
        eyes(s, x + 2, y - 5, C.green4, p)
        px(s, x + 4, y - 3, C.ink)
        rect(s, x, y - 1, 4, 1, C.bone0)
        px(s, x + 1, y - 1, C.ink); px(s, x + 3, y - 1, C.ink)
        // the tall mitre, split at the top, a gold band and a skull stitched on the front
        poly(s, [-3, -6, 4, -6, 3, -13, 0, -11, -2, -14], x, y, C.night0)
        line(s, x - 2, y - 14, x - 3, y - 7, C.purple1); line(s, x + 3, y - 13, x + 4, y - 7, C.purple1)
        rect(s, x - 3, y - 7, 8, 1, C.gold1)
        line(s, x, y - 13, x + 1, y - 8, C.gold1) // the gold seam
        px(s, x + 1, y - 10, C.bone1); px(s, x + 2, y - 10, C.bone1); px(s, x + 1, y - 9, C.bone0)
    },
    torso: (s, x, y) => {
        rect(s, x - 3, y, 7, 8, C.purple1)
        rect(s, x - 3, y, 2, 8, C.purple0)
        line(s, x + 3, y, x + 3, y + 7, C.purple2) // the lit fold
        // the black stole with gold edges
        rect(s, x + 1, y, 2, 8, C.night0)
        line(s, x + 1, y, x + 1, y + 7, C.gold1)
        // the rosary of bone beads, a skull pendant
        for (let i = 0; i < 4; i++) px(s, x - 2 + i, y + 1 + (i & 1), C.bone1)
        px(s, x, y + 4, C.bone1); px(s, x, y + 5, C.bone0)
        rect(s, x - 3, y + 6, 7, 1, C.gold1)
    },
    lower: (s, x, hipY, _p, t) => robeSkirt(s, x, hipY, J.oy - 1, [C.purple0, C.purple1, C.purple2], C.gold1, (Math.floor(t * 2) & 1) - 0.5, C.bone0, 0),
    pants: C.purple1, pantsDk: C.purple0, boot: C.bone0, bootHi: C.bone1,
    arm: C.purple1, armLow: C.purple1, armBack: C.purple0, armBackLow: C.purple0, hand: C.bone1,
    blade: M.bone, haft: M.darkwood, gem: M.nature, gemStyle: Gem.Skull, accent: C.green4
}

// 8 · The Shattered Sky — Skyshard Wisp (melee): a wisp of the storm wearing a shard of the broken
// sky for a face, a jagged mask of storm-glass with gold eyes burning through it, wind streaming
// back off it, a heart of lightning in a body of wind, a tail of wind for legs, a glass blade.
const skyshardWisp: WorldSkin = {
    legLen: 8, torsoLen: 8,
    skin: [C.blue1, C.blue2, C.cyan],
    back: (s, x, y, _p, t) => {
        // wind streaming back off the head and shoulders
        const f = Math.floor(t * 6) % 3
        for (let i = 0; i < 4; i++) {
            const yy = y - 9 + i * 3
            const len = 5 + ((i + f) % 3) * 2
            line(s, x - 2, yy, x - 2 - len, yy + 2 + (i & 1), i & 1 ? C.blue2 : C.cyan)
            px(s, x - 3 - len, yy + 3 + (i & 1), C.frost)
        }
    },
    head: (s, x, y, p, t) => {
        // the shard: storm-glass split into facets, lit on its upper left, cracked through
        poly(s, [-3, 0, 4, 0, 5, -4, 3, -11, 1, -8, -1, -13, -4, -6], x, y, C.blue2)
        poly(s, [-4, -6, -1, -13, 0, -8, -1, -3, -3, 0], x, y, C.cyan)
        line(s, x - 3, y - 6, x - 1, y - 12, C.frost)
        tri(s, x + 1, y, x + 4, y, x + 5, y - 4, C.blue1)
        line(s, x + 1, y - 8, x + 3, y - 11, C.frost)
        // the eyes burning through, a crack of light running up from them
        rect(s, x + 1, y - 6, 4, 2, C.blue0)
        px(s, x + 2, y - 6, C.gold2)
        eyes(s, x + 4, y - 6, C.gold3, p)
        line(s, x + 1, y - 7, x, y - 10, C.white)
        // splinters of it circling
        const a = t * 5
        px(s, Math.round(x + 1 + Math.cos(a) * 7), Math.round(y - 6 + Math.sin(a) * 3), C.frost)
        px(s, Math.round(x + 1 - Math.cos(a) * 7), Math.round(y - 6 - Math.sin(a) * 3), C.cyan)
    },
    torso: (s, x, y, p, t) => {
        // a body of wind wrapping round itself, streaks travelling down it
        const k = Math.floor(t * 8) & 3
        for (let i = 0; i < 8; i++) {
            const w = i < 5 ? 4 : 3
            rect(s, x - w, y + i, w * 2 + 1, 1, i < 2 ? C.blue2 : C.blue1)
            px(s, x - w + ((i * 3 + k * 2) % (w * 2 + 1)), y + i, (i + k) & 1 ? C.cyan : C.blue2)
        }
        line(s, x - 4, y, x - 1, y, C.frost) // the lit shoulder
        // the heart of lightning
        const hot = p[HP.glow]! > 0.3 || k === 0
        line(s, x, y + 2, x + 2, y + 4, hot ? C.white : C.gold3)
        line(s, x + 2, y + 4, x, y + 5, hot ? C.white : C.gold3)
        line(s, x, y + 5, x + 1, y + 7, C.gold2)
        if (hot) { px(s, x - 1, y + 3, C.gold2); px(s, x + 3, y + 5, C.gold2) }
    },
    lower: (s, x, hipY, _p, t) => {
        // a tail of wind instead of legs, twisting to a point that curls back
        const k = Math.floor(t * 8) & 3
        for (let i = 0; i < 10; i++) {
            const w = Math.max(0, 3 - (i >> 1))
            const sx = x - Math.round(i * 0.5) + (((i + k) & 3) === 0 ? 1 : 0)
            rect(s, sx - w, hipY + i, w * 2 + 1, 1, C.blue1)
            if (w > 0) px(s, sx - w + ((i + k) % (w * 2 + 1)), hipY + i, (i + k) & 1 ? C.cyan : C.frost)
        }
        line(s, x - 5, hipY + 9, x - 7, hipY + 7, C.cyan)
        px(s, x - 8, hipY + 6, C.frost)
    },
    pants: C.blue1, pantsDk: C.blue0, boot: C.blue1, bootHi: C.cyan,
    arm: C.blue2, armLow: C.blue2, armBack: C.blue1, armBackLow: C.blue1, hand: C.frost,
    blade: M.ice, haft: M.obsidian, gem: M.ice, gemStyle: Gem.Crystal, accent: C.gold3,
    ambient: (dst, t) => {
        // static jumping off the shard now and then
        const k = step(t, 10, 7)
        if (k === 0) { dst.set(fxX(J.headX + 3), fxY(J.headY - 14), C.white); dst.set(fxX(J.headX + 4), fxY(J.headY - 15), C.gold3) }
    }
}

const BILLOW_LIT: Mat = [C.night2, C.night3, C.haze]
const BILLOW_DARK: Mat = [C.night0, C.night1, C.night2]

/**
 * A billow of storm cloud at (x, y): shaded underneath, lit along its top toward the upper left.
 * The upper billows of a thunderhead catch the light (`BILLOW_LIT`); the lower ones sit in its shadow.
 */
function billow(s: Surface, x: number, y: number, r: number, m: Mat = BILLOW_LIT): void {
    disc(s, x, y, r, m[0])
    disc(s, x - 0.5, y - 1, r - 1, m[1])
    arc(s, x - 0.5, y - 1, r - 1, Math.PI * 1.05, Math.PI * 1.7, m[2])
    arc(s, x - 0.5, y - 1.5, r - 1.5, Math.PI * 1.15, Math.PI * 1.55, m[2])
    px(s, Math.round(x - r * 0.45), Math.round(y - r * 0.75), m === BILLOW_LIT ? C.white : m[2])
}

// 8 · The Shattered Sky — Thunderhead Golem (heavy): a storm cloud that stood up and walked, piled
// billows lit on top and dark underneath, heaped high at the shoulders; its head a boulder torn off
// an island, sunk between them, gold eyes under a carved brow; lightning crackling in its chest
// and through the rock, rain falling out of it.
const thunderheadGolem: WorldSkin = {
    legLen: 7, torsoLen: 11,
    skin: [C.night2, C.night3, C.haze],
    head: (s, x, y, p) => {
        // a boulder torn off an island, lit on its upper left, a heavy carved brow
        poly(s, [-2, 0, 5, 0, 7, -3, 6, -8, 2, -10, -2, -8, -3, -4], x, y, C.stone2)
        poly(s, [-2, -8, 2, -10, 4, -9, 0, -7, -2, -4], x, y, C.stone3)
        tri(s, x + 3, y, x + 6, y, x + 7, y - 3, C.stone1)
        line(s, x + 1, y - 7, x + 7, y - 6, C.stone1) // the brow, its shadow over the eyes
        line(s, x + 2, y - 6, x + 6, y - 5, C.stone1)
        px(s, x + 3, y - 5, C.gold2)
        eyes(s, x + 6, y - 5, C.gold3, p)
        // lightning crackling through a crack in it
        line(s, x - 1, y - 9, x + 1, y - 6, C.gold2); line(s, x + 1, y - 6, x, y - 3, C.gold1)
        // a crackle of a mouth
        if (p[HP.mouth]! > 0.5) { rect(s, x + 3, y - 3, 4, 2, C.ink); line(s, x + 3, y - 3, x + 6, y - 2, C.gold3) } else line(s, x + 3, y - 2, x + 6, y - 2, C.stone1)
    },
    torso: (s, x, y, p, t) => {
        // piled billows, drawn from the bottom up so each lit top rides over the shade below it,
        // heaped highest at the shoulders
        for (const [bx, by, r] of [[-2, 12, 3.5], [3, 12, 3.5], [-5, 8, 3.5], [5, 7, 4]] as const) billow(s, x + bx, y + by, r, BILLOW_DARK)
        for (const [bx, by, r] of [[0, 6, 5], [-6, 1, 4.5], [6, 1, 4.5], [-3, -2, 3.5]] as const) billow(s, x + bx, y + by, r)
        // lightning crackling in its chest, flaring on the swing
        const k = Math.floor(t * 10) % 5
        const hot = p[HP.glow]! > 0.3 || k === 0
        line(s, x - 3, y + 4, x, y + 6, hot ? C.white : C.gold2)
        line(s, x, y + 6, x - 1, y + 8, hot ? C.white : C.gold2)
        line(s, x - 1, y + 8, x + 2, y + 10, hot ? C.gold3 : C.gold1)
        if (hot) { px(s, x - 4, y + 3, C.gold3); px(s, x + 1, y + 5, C.gold3); px(s, x + 3, y + 10, C.gold2) }
        // a boulder torn off an island bound into the shoulder
        ellipse(s, x + 2, y + 1, 3, 2.5, C.stone1)
        ellipse(s, x + 1, y, 2, 1.5, C.stone2)
        px(s, x, y - 1, C.stone3)
        line(s, x - 1, y + 3, x + 5, y + 2, C.brown1) // a root still hanging off it
    },
    pants: C.night2, pantsDk: C.night1, boot: C.stone1, bootHi: C.stone2,
    arm: C.night2, armLow: C.night3, armBack: C.night1, armBackLow: C.night2, hand: C.stone2,
    blade: M.ice, haft: M.darkwood, gem: M.ice, gemStyle: Gem.Crystal, accent: C.gold3,
    ambient: (dst, t) => {
        // rain falling out of it
        const k = step(t, 10, 6)
        for (let i = 0; i < 3; i++) {
            const yy = J.hipY + 1 + ((k * 2 + i * 5) % 8)
            dst.set(fxX(J.bx - 4 + i * 4), fxY(yy), C.frost)
            dst.set(fxX(J.bx - 4 + i * 4), fxY(yy + 1), C.cyan)
        }
    }
}

// 8 · The Shattered Sky — Harpy Raider (ranged): a harpy off the high rocks, a sharp face with a
// bird's gold eye and blue war paint, a crest of long red feathers swept back, tawny barred wings
// folded behind her, a feathered breast, bird legs with talons, loosing from a horn bow.
const harpyRaider: WorldSkin = {
    legLen: 7, torsoLen: 8,
    skin: [C.skin0, C.skin1, C.skin2],
    back: (s, x, y, _p, t) => {
        // the wing, folded with its wrist raised over her shoulder, stirring: barred coverts, a lit
        // leading edge, long primaries sweeping down behind her, pale at the tips
        const f = Math.floor(t * 3) & 1
        const wx = x - 5
        const wy = y - 12 - f
        for (let i = 0; i < 5; i++) {
            const ex = x - 14 + i * 2
            const ey = y + 7 - i * 2
            line(s, wx - i, wy + 2 + i, ex, ey, i & 1 ? C.brown1 : C.brown0, 2)
            px(s, ex, ey + 1, C.bone1); px(s, ex - 1, ey + 1, C.bone0)
        }
        poly(s, [-1, 1, wx - x + 1, wy - y, wx - x - 3, wy - y + 1, -10, -1, -6, 4], x, y, C.brown2)
        line(s, x - 1, y, wx + 1, wy, C.brown3)
        px(s, wx, wy - 1, C.brown3)
        for (let i = 0; i < 3; i++) line(s, wx - 1 + i, wy + 3 + i * 2, wx - 5 + i, wy + 5 + i * 2, C.brown1) // the bars
    },
    head: (s, x, y, p) => {
        // the crest: long red feathers swept back from the brow
        for (let i = 0; i < 4; i++) {
            line(s, x + 1 - i, y - 8 + i, x - 6 - i * 2, y - 11 + i * 2, i & 1 ? C.red1 : C.red2)
            px(s, x - 7 - i * 2, y - 11 + i * 2, i & 1 ? C.red2 : C.red3)
        }
        // the face, sharp, lit on the brow and cheek
        ellipse(s, x + 1, y - 4, 3.5, 4, C.skin1)
        line(s, x, y - 7, x + 3, y - 7, C.skin2)
        px(s, x + 3, y - 3, C.skin2)
        px(s, x + 5, y - 4, C.skin1) // the nose
        rect(s, x - 2, y - 8, 5, 2, C.red2) // the crest where it meets the brow
        line(s, x - 2, y - 8, x + 2, y - 8, C.red3)
        // a bird's eye, gold round a black pupil, and blue paint under it
        px(s, x + 2, y - 5, C.gold3)
        eyes(s, x + 3, y - 5, C.ink, p)
        line(s, x + 1, y - 3, x + 3, y - 3, C.blue2)
        px(s, x + 3, y - 1, C.skin0) // the mouth
        px(s, x - 1, y - 3, C.gold2) // a gold ring in the ear
    },
    torso: (s, x, y) => {
        // a feathered breast, scalloped pale, a strap across it with a gold buckle
        rect(s, x - 3, y, 7, 8, C.brown2)
        rect(s, x - 3, y, 2, 8, C.brown1)
        for (let i = 0; i < 3; i++) { px(s, x + 1, y + 2 + i * 2, C.bone1); px(s, x + 3, y + 1 + i * 2, C.bone1); px(s, x + 2, y + 3 + i * 2, C.brown3) }
        line(s, x - 3, y + 1, x + 3, y + 6, C.brown0)
        px(s, x, y + 3, C.gold2)
        // a ruff of red at the neck
        rect(s, x - 2, y - 1, 5, 1, C.red1)
        px(s, x + 1, y - 1, C.red2)
    },
    lower: (s, x, hipY) => {
        // bird legs: feathered thighs, bare yellow shanks bending back at the hock, talons
        for (const far of [true, false]) {
            const fx = far ? J.bfx : J.ffx
            const fy = far ? J.bfy : J.ffy
            ellipse(s, x + (far ? -1 : 1), hipY + 2, 2.5, 2.5, far ? C.brown1 : C.brown2)
            const hx = fx - 1
            const hy = fy - 3
            line(s, x + (far ? -1 : 1), hipY + 4, hx, hy, far ? C.gold0 : C.gold1)
            line(s, hx, hy, fx, fy - 1, far ? C.gold0 : C.gold1)
            // three toes forward, one back, black claws
            line(s, fx, fy, fx + 2, fy, far ? C.gold0 : C.gold1)
            px(s, fx + 3, fy, C.ink); px(s, fx - 1, fy, C.ink)
        }
    },
    pants: C.brown2, pantsDk: C.brown1, boot: C.gold1, bootHi: C.gold2,
    arm: C.brown2, armLow: C.skin1, armBack: C.brown1, armBackLow: C.skin0, hand: C.skin1,
    blade: [C.steel1, C.steel2, C.steel3], haft: [C.bone0, C.bone1, C.white], gem: M.ice, gemStyle: Gem.Crystal, accent: C.red3
}

// 8 · The Shattered Sky — Squall Caller (caster): a priest of the storm in deep blue, hooded, a gold
// beaked mask with eyes lit cyan, white feathers blowing off the hood, wind-scarves streaming back,
// calling the squall down on a staff of pale wood crowned with a shard of lightning-glass.
const squallCaller: WorldSkin = {
    legLen: 7, torsoLen: 8,
    skin: [C.skin0, C.skin1, C.skin2],
    back: (s, x, y, _p, t) => {
        // the wind-scarves, streaming back and snapping
        const f = Math.floor(t * 6) % 3
        for (let i = 0; i < 2; i++) {
            const y0 = y + 1 + i * 3
            for (let k = 0; k < 9; k++) {
                const wy = y0 + Math.round(Math.sin((k + f * 2) * 0.9 + i) * 1)
                rect(s, x - 3 - k, wy, 1, 2, k > 6 ? C.steel3 : i ? C.frost : C.white)
            }
        }
    },
    head: (s, x, y, p) => {
        // the hood, peaked, lit blue along its rim
        ellipse(s, x, y - 5, 4.5, 5, C.blue0)
        tri(s, x - 4, y - 7, x, y - 10, x - 6, y - 11, C.blue0)
        line(s, x - 4, y - 9, x + 3, y - 9, C.blue2)
        line(s, x + 3, y - 9, x + 4, y - 4, C.blue1)
        // feathers blowing off the hood
        for (let i = 0; i < 3; i++) { line(s, x - 3 - i, y - 10 + i, x - 7 - i * 2, y - 12 + i * 2, i & 1 ? C.frost : C.white) }
        // the beaked mask, gold, hooked, the eye lit through it
        rect(s, x, y - 7, 4, 6, C.gold1)
        line(s, x, y - 7, x + 3, y - 7, C.gold3)
        poly(s, [3, -6, 8, -4, 7, -2, 3, -2], x, y, C.gold2)
        line(s, x + 3, y - 6, x + 7, y - 4, C.gold3)
        px(s, x + 7, y - 2, C.gold0) // the hook
        px(s, x + 1, y - 5, C.ink)
        eyes(s, x + 2, y - 5, C.cyan, p)
    },
    torso: (s, x, y) => {
        rect(s, x - 3, y, 7, 8, C.blue1)
        rect(s, x - 3, y, 2, 8, C.blue0)
        line(s, x + 3, y, x + 3, y + 7, C.blue2)
        // the scarf round the shoulders and a gold clasp
        rect(s, x - 3, y, 7, 2, C.frost)
        line(s, x - 3, y, x + 3, y, C.white)
        px(s, x + 1, y + 1, C.gold2)
        // the sash with a lightning mark stitched on it
        rect(s, x - 3, y + 6, 7, 1, C.gold1)
        line(s, x + 1, y + 2, x, y + 4, C.gold2); px(s, x + 1, y + 5, C.gold2)
    },
    lower: (s, x, hipY, _p, t) => robeSkirt(s, x, hipY, J.oy - 1, [C.blue0, C.blue1, C.blue2], C.frost, -1 - (Math.floor(t * 3) & 1), C.gold1, 0),
    pants: C.blue1, pantsDk: C.blue0, boot: C.gold1, bootHi: C.gold2,
    arm: C.blue1, armLow: C.blue1, armBack: C.blue0, armBackLow: C.blue0, hand: C.skin1,
    blade: M.ice, haft: [C.bone0, C.bone1, C.white], gem: [C.blue2, C.cyan, C.white], gemStyle: Gem.Crystal, accent: C.cyan,
    ambient: (dst, t) => {
        // gusts whipping past it
        const k = step(t, 10, 8)
        for (let i = 0; i < 2; i++) {
            const gx = J.bx + 8 - ((k * 3 + i * 11) % 20)
            const gy = J.topY - 4 + i * 9
            dst.set(fxX(gx), fxY(gy), C.frost); dst.set(fxX(gx - 1), fxY(gy), C.frost); dst.set(fxX(gx - 2), fxY(gy), C.steel3)
        }
    }
}

// 9 · The Brink — Unravelled Knight: armour with no one in it, coming apart thread by thread.
const unravelledKnight: WorldSkin = {
    legLen: 8, torsoLen: 9,
    skin: [C.stone2, C.stone3, C.steel3],
    head: (s, x, y, p, t) => {
        rect(s, x - 3, y - 9, 7, 9, C.stone3)
        rect(s, x - 3, y - 9, 2, 9, C.stone2)
        rect(s, x, y - 5, 4, 1, C.ink)
        px(s, x + 3, y - 5, p[HP.flash]! > 0.5 ? C.white : C.haze)
        rect(s, x + 1, y - 9, 1, 8, C.steel3)
        // gaps where it has come undone
        for (let i = 0; i < 6; i++) if (bayer(i * 3, i, 6)) px(s, x - 2 + (i % 4), y - 8 + i, C.void)
        const f = Math.floor(t * 3) & 1
        line(s, x - 3, y - 2, x - 5, y + 3 + f, C.haze) // a loose thread
    },
    torso: (s, x, y, p, t) => {
        rect(s, x - 4, y, 8, 9, C.stone3)
        rect(s, x - 4, y, 1, 9, C.stone2)
        rect(s, x + 1, y + 1, 1, 4, C.steel3)
        dither(s, x - 2, y + 3, 5, 5, C.void, 5)
        const f = Math.floor(t * 3) & 1
        line(s, x - 2, y + 8, x - 3, y + 12 + f, C.haze)
        line(s, x + 2, y + 8, x + 3, y + 11 - f, C.bone0)
        line(s, x - 4, y + 3, x - 6, y + 6 + f, C.pink)
    },
    pants: C.stone3, pantsDk: C.stone2, boot: C.stone2, bootHi: C.steel3,
    arm: C.stone3, armLow: C.stone2, armBack: C.stone2, armBackLow: C.stone1, hand: C.stone2,
    blade: [C.stone2, C.stone3, C.bone1], haft: M.obsidian, gem: [C.night3, C.haze, C.white], gemStyle: Gem.Moon, accent: C.haze,
    ambient: (dst, t) => {
        const k = step(t, 10, 12)
        dst.set(fxX(J.bx - 4 + (k % 4)), fxY(J.topY + 4 - k), C.haze)
    }
}

// 10 · The Void — Void Thrall: a hole in the shape of a soldier, rimmed in violet.
const voidThrall: WorldSkin = {
    legLen: 8, torsoLen: 9,
    skin: [C.ink, C.void, C.purple0],
    head: (s, x, y, p, t) => {
        rect(s, x - 2, y - 8, 6, 8, C.void)
        tri(s, x - 3, y - 7, x - 1, y - 7, x - 4, y - 12, C.void) // spikes
        tri(s, x, y - 8, x + 2, y - 8, x + 1, y - 13, C.void)
        eyes(s, x + 2, y - 5, C.pink, p)
        px(s, x + 3, y - 5, C.pink)
        rect(s, x + 1, y - 2, 3, 1, C.purple2)
        if ((Math.floor(t * 5) & 3) === 0) px(s, x - 1, y - 4, C.white) // a star inside
    },
    torso: (s, x, y, p, t) => {
        rect(s, x - 4, y, 8, 9, C.void)
        line(s, x - 2, y + 1, x + 1, y + 7, C.purple1) // crack
        px(s, x, y + 4, C.pink)
        const k = Math.floor(t * 4) & 3
        px(s, x - 3 + k, y + 2 + (k & 1) * 4, C.white)
        px(s, x + 2, y + 1 + k, C.haze)
    },
    pants: C.void, pantsDk: C.ink, boot: C.ink, bootHi: C.purple0,
    arm: C.void, armLow: C.void, armBack: C.ink, armBackLow: C.ink, hand: C.purple0,
    blade: M.voidm, haft: [C.ink, C.void, C.purple0], gem: M.voidm, gemStyle: Gem.Orb, accent: C.purple2,
    ambient: (dst, t) => {
        const k = step(t, 10, 6)
        for (let i = 0; i < 2; i++) dst.set(fxX(J.bx - 5 + i * 9 - (k >> 1)), fxY(J.oy - 3 - k * 2 - i * 5), i ? C.purple2 : C.pink)
    }
}

/** World skins in world order; index 0 is World 1. */
/** A world whose other creatures are not designed yet: its one skin on all four rigs. */
function one(w: WorldSkin): Readonly<Record<EnemyWeapon, WorldSkin>> {
    return { sword: w, axe: w, bow: w, staff: w }
}

/**
 * Each world's roster on the four rigs (`content/worlds.ts` names them: melee on the sword,
 * heavy on the axe, ranged on the bow, caster on the staff).
 */
export const WORLD_ROSTERS: readonly Readonly<Record<EnemyWeapon, WorldSkin>>[] = [
    { sword: brambleGoblin, axe: thornhideHobgoblin, bow: scarecrowStalker, staff: hedgeWitch },
    { sword: bogLurker, axe: peatBrute, bow: reedSpitter, staff: bogCrone },
    { sword: cinderKobold, axe: slagGolem, bow: ashImp, staff: salamanderFirecaller },
    { sword: frostboundRaider, axe: rimeTroll, bow: snowfieldHuntress, staff: runeSkald },
    { sword: drownedSailor, axe: barnacleBrute, bow: harpoonSiren, staff: tidePriestess },
    { sword: hollowAcolyte, axe: spireGargoyle, bow: spellboundConstruct, staff: riftboundMagus },
    { sword: restlessLegionnaire, axe: barrowGhoul, bow: boneArcher, staff: ossuaryPriest },
    { sword: skyshardWisp, axe: thunderheadGolem, bow: harpyRaider, staff: squallCaller },
    one(unravelledKnight), one(voidThrall)
]

/** Which of a world's roster styles each rig draws. */
export const WEAPON_STYLE: Readonly<Record<EnemyWeapon, EnemyStyle>> = { sword: 'melee', axe: 'heavy', bow: 'ranged', staff: 'caster' }

// ── Composition ────────────────────────────────────────────────────────────────────

function weaponPainter(w: WorldSkin, kind: EnemyWeapon): Painter {
    switch (kind) {
        case 'sword': return (s, x, y, p) => sword(s, x, y, p[HP.wa]!, w.legLen < 8 ? 9 : 11, w.blade, w.blade, w.haft[0])
        case 'axe': return (s, x, y, p) => axe(s, x, y, p[HP.wa]!, w.legLen < 8 ? 9 : 11, w.blade, w.haft, false, true)
        case 'bow': return (s, x, y, p) => { const pull = p[HP.aux]!; bow(s, x, y, p[HP.wa]!, pull, pull > 0.05, w.haft, w.legLen < 8 ? 7 : 8, w.blade[2]) }
        case 'staff': return (s, x, y, p, t) => staff(s, x, y, p[HP.wa]!, w.legLen < 8 ? 10 : 12, w.haft, w.gem, w.gemStyle, p[HP.glow]!, t)
    }
}

const LOOKS = new Map<string, Look>()

/** The Look for world `world` (1-based) wielding `kind`. Cached. */
export function enemyLook(world: number, kind: EnemyWeapon): Look {
    const key = `${world}:${kind}`
    const hit = LOOKS.get(key)
    if (hit) return hit
    const w = WORLD_ROSTERS[world - 1]?.[kind]
    if (!w) throw new Error(`No enemy skin for world ${world}`)
    const look: Look = {
        skin: w.skin, pants: w.pants, pantsDk: w.pantsDk, boot: w.boot, bootHi: w.bootHi,
        arm: w.arm, armLow: w.armLow, armBack: w.armBack, armBackLow: w.armBackLow, hand: w.hand,
        torso: w.torso, head: w.head, lower: w.lower, back: w.back,
        legLen: w.legLen, torsoLen: w.torsoLen, accent: w.accent,
        weapon: weaponPainter(w, kind),
        fx: (dst, p, t) => {
            if (w.ambient) w.ambient(dst, t)
            if (is(p, EFX.Smear)) smear(dst, J.fsx, J.fsy, 9, 14, p[HP.fxa]!, p[HP.wa]!, w.accent)
            if (is(p, EFX.Release)) {
                const a = p[HP.wa]!
                streak(dst, J.hx + Math.cos(a) * 12, J.hy + Math.sin(a) * 12, a, 9, w.accent)
            }
            if (is(p, EFX.Burst)) sparks(dst, tip.x + 2, tip.y, 5, 7, step(t, 10, 5), w.accent, C.white)
        }
    }
    LOOKS.set(key, look)
    return look
}

// ── Elite mark ─────────────────────────────────────────────────────────────────────

/** The one elite treatment: a gold halo outline (passed to Actor.draw) plus this chevron. */
export const ELITE_MARK = C.gold2

/** Draw the elite chevron above an enemy whose head top is at (x, y) in scene space. */
export function drawEliteMark(dst: Surface, x: number, y: number, t: number): void {
    const bob = Math.floor(t * 3) & 1
    const X = Math.round(x)
    const Y = Math.round(y) - bob
    for (let i = 0; i < 4; i++) {
        dst.set(X - i, Y - 3 + i, C.gold2)
        dst.set(X + i, Y - 3 + i, C.gold2)
        dst.set(X - i, Y - 2 + i, C.ink)
        dst.set(X + i, Y - 2 + i, C.ink)
    }
    dst.set(X, Y - 4, C.gold3)
    dst.set(X, Y - 3, C.white)
}

