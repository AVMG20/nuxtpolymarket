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
import { line, px, rect, disc, ellipse, tri, dither, bayer, poly } from './surface'
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

// 4 · Rimeholt — Frostbound Raider: frost-pale skin, fur, horned helm hung with icicles.
const frostboundRaider: WorldSkin = {
    legLen: 8, torsoLen: 9,
    skin: [C.night3, C.haze, C.frost],
    head: (s, x, y, p) => {
        rect(s, x - 2, y - 7, 5, 7, C.haze)
        rect(s, x + 1, y - 6, 2, 4, C.frost)
        px(s, x + 3, y - 3, C.frost)
        eyes(s, x + 2, y - 4, C.cyan, p)
        rect(s, x - 1, y - 2, 5, 3, C.white) // frosted beard
        px(s, x + 1, y + 1, C.frost); px(s, x + 3, y + 1, C.frost); px(s, x + 2, y + 2, C.cyan)
        rect(s, x - 3, y - 10, 7, 3, C.steel1)
        rect(s, x - 3, y - 7, 2, 4, C.steel0)
        px(s, x - 1, y - 10, C.steel2)
        px(s, x - 4, y - 10, C.bone1); px(s, x - 5, y - 11, C.bone1); px(s, x - 5, y - 12, C.white)
        px(s, x + 3, y - 10, C.bone1); px(s, x + 4, y - 11, C.bone1); px(s, x + 4, y - 12, C.white)
        px(s, x - 2, y - 6, C.cyan); px(s, x - 2, y - 5, C.frost) // icicle
    },
    torso: (s, x, y) => {
        rect(s, x - 4, y, 8, 9, C.brown2)
        rect(s, x - 4, y, 1, 9, C.brown1)
        rect(s, x - 5, y - 1, 10, 3, C.bone1) // fur mantle
        px(s, x - 4, y + 2, C.bone0); px(s, x - 1, y + 2, C.bone1); px(s, x + 3, y + 2, C.bone0)
        dither(s, x - 5, y - 1, 10, 3, C.white, 3)
        rect(s, x - 4, y + 6, 8, 1, C.blue0)
        px(s, x + 1, y + 6, C.cyan)
    },
    pants: C.stone2, pantsDk: C.stone1, boot: C.bone0, bootHi: C.bone1,
    arm: C.brown2, armLow: C.haze, armBack: C.brown1, armBackLow: C.night3, hand: C.brown1,
    blade: M.ice, haft: M.darkwood, gem: M.ice, gemStyle: Gem.Crystal, accent: C.cyan,
    ambient: (dst, t) => {
        const k = step(t, 10, 10)
        dst.set(fxX(J.bx - 6 + ((k * 3) % 13)), fxY(J.topY - 6 + k * 2), C.white)
    }
}

// 5 · Sunken Amarath — Drowned Sailor: bloated grey-green, barnacled, still in the tricorne.
const drownedSailor: WorldSkin = {
    legLen: 8, torsoLen: 9,
    skin: [C.teal0, C.teal2, C.teal3],
    head: (s, x, y, p) => {
        rect(s, x - 2, y - 7, 6, 7, C.teal2)
        rect(s, x + 1, y - 6, 2, 4, C.teal3)
        px(s, x + 4, y - 3, C.teal2)
        eyes(s, x + 2, y - 4, C.white, p)
        px(s, x + 2, y - 5, C.teal0)
        rect(s, x + 1, y - 1, 3, 1, C.teal0)
        px(s, x - 1, y - 3, C.bone1); px(s, x, y - 2, C.bone0) // barnacles
        // tricorne
        rect(s, x - 5, y - 8, 11, 1, C.stone1)
        rect(s, x - 3, y - 10, 7, 2, C.stone1)
        px(s, x - 5, y - 9, C.stone1); px(s, x + 5, y - 9, C.stone1)
        rect(s, x - 3, y - 9, 7, 1, C.gold0)
        line(s, x - 3, y - 7, x - 5, y - 3, C.olive2) // seaweed
    },
    torso: (s, x, y) => {
        rect(s, x - 4, y, 8, 9, C.bone1)
        for (let i = 0; i < 4; i++) rect(s, x - 4, y + 1 + i * 2, 8, 1, C.blue1) // striped shirt
        rect(s, x - 4, y, 1, 9, C.bone0)
        rect(s, x + 1, y + 4, 3, 3, C.teal2) // torn hole
        px(s, x + 2, y + 5, C.teal0)
        rect(s, x - 4, y + 7, 8, 1, C.brown0)
        px(s, x - 2, y + 2, C.bone0); px(s, x - 3, y + 6, C.bone1) // barnacles
    },
    pants: C.blue0, pantsDk: C.night0, boot: C.brown0, bootHi: C.brown1,
    arm: C.bone1, armLow: C.teal2, armBack: C.bone0, armBackLow: C.teal1, hand: C.teal2,
    blade: M.rust, haft: M.darkwood, gem: M.sea, gemStyle: Gem.Moon, accent: C.teal3,
    ambient: (dst, t) => {
        const k = step(t, 10, 9)
        if (k < 6) dst.set(fxX(J.headX + 5), fxY(J.headY - 8 - k * 2), C.teal3)
    }
}

// 6 · Duskspire — Hollow Acolyte: robes, and nothing inside the hood but two points of light.
const hollowAcolyte: WorldSkin = {
    legLen: 8, torsoLen: 9,
    skin: [C.void, C.ink, C.purple0],
    head: (s, x, y, p) => {
        rect(s, x - 3, y - 9, 7, 9, C.purple1)
        rect(s, x - 4, y - 7, 2, 8, C.purple0)
        rect(s, x - 2, y - 10, 4, 1, C.purple1)
        rect(s, x - 1, y - 7, 4, 6, C.ink) // the empty hood
        px(s, x + 3, y - 6, C.purple1)
        if (p[HP.flash]! > 0.5) { px(s, x, y - 5, C.white); px(s, x + 2, y - 5, C.white) } else {
            px(s, x, y - 5, C.pink); px(s, x + 2, y - 5, C.pink)
        }
        px(s, x - 1, y - 9, C.purple2)
    },
    torso: (s, x, y) => {
        rect(s, x - 4, y, 8, 9, C.purple1)
        rect(s, x - 4, y, 1, 9, C.purple0)
        rect(s, x + 1, y, 1, 9, C.purple2)
        rect(s, x - 1, y + 2, 1, 5, C.night3) // stole
        px(s, x - 1, y + 4, C.gold2)
    },
    lower: (s, x, hipY, p, t) => robeSkirt(s, x, hipY, J.oy - 1, [C.purple0, C.purple1, C.purple2], C.night2, (Math.floor(t * 2) & 1) - 0.5, C.ink, 0),
    pants: C.purple0, pantsDk: C.void, boot: C.ink, bootHi: C.void,
    arm: C.purple1, armLow: C.purple1, armBack: C.purple0, armBackLow: C.purple0, hand: C.ink,
    blade: M.voidm, haft: M.obsidian, gem: M.voidm, gemStyle: Gem.Crystal, accent: C.pink
}

// 7 · The Bonefields — Restless Legionnaire: bones in rusted legion kit, crest still red.
const restlessLegionnaire: WorldSkin = {
    legLen: 8, torsoLen: 9,
    skin: [C.bone0, C.bone1, C.white],
    back: (s, x, y, p, t) => {
        for (let i = 0; i < 10; i++) rect(s, x - 5 - (i >> 2) - (Math.floor(t * 3) & 1) * (i >> 3), y + i, 3, 1, i > 7 ? C.red0 : C.red1) // tattered cloak
    },
    head: (s, x, y, p) => {
        rect(s, x - 2, y - 7, 5, 6, C.bone1)
        rect(s, x - 1, y - 1, 4, 1, C.bone0) // jaw
        px(s, x, y - 1, C.ink); px(s, x + 2, y - 1, C.ink)
        rect(s, x + 1, y - 5, 2, 2, C.ink)
        eyes(s, x + 2, y - 5, C.green4, p)
        px(s, x + 3, y - 3, C.ink)
        // rusted helm with a crest
        rect(s, x - 3, y - 9, 6, 3, C.brown2)
        rect(s, x - 3, y - 7, 1, 5, C.brown1)
        px(s, x - 1, y - 9, C.orange)
        rect(s, x - 3, y - 11, 6, 2, C.red1)
        px(s, x - 4, y - 11, C.red0); px(s, x - 1, y - 12, C.red2)
    },
    torso: (s, x, y) => {
        // rib cage behind rusted segmented plate
        rect(s, x - 4, y, 8, 9, C.bone0)
        for (let i = 0; i < 3; i++) rect(s, x - 4, y + 1 + i * 2, 8, 1, C.brown2)
        rect(s, x - 4, y, 8, 1, C.orange)
        rect(s, x - 1, y, 2, 9, C.bone1) // spine
        rect(s, x - 4, y + 7, 8, 2, C.red1) // skirt strips
        px(s, x - 3, y + 8, C.red0); px(s, x, y + 8, C.red0); px(s, x + 3, y + 8, C.red0)
    },
    pants: C.bone1, pantsDk: C.bone0, boot: C.brown1, bootHi: C.brown2,
    arm: C.bone1, armLow: C.bone1, armBack: C.bone0, armBackLow: C.bone0, hand: C.bone1,
    blade: M.rust, haft: M.darkwood, gem: M.nature, gemStyle: Gem.Skull, accent: C.green4
}

// 8 · The Shattered Sky — Skyshard Wisp: a floating shard of storm-lit stone with a tail of wind.
const skyshardWisp: WorldSkin = {
    legLen: 8, torsoLen: 9,
    skin: [C.stone1, C.stone2, C.stone3],
    head: (s, x, y, p) => {
        tri(s, x - 3, y - 1, x + 4, y - 1, x + 1, y - 10, C.stone2)
        tri(s, x - 3, y - 1, x + 1, y - 1, x + 1, y - 10, C.stone1)
        line(s, x + 1, y - 9, x + 2, y - 3, C.stone3)
        eyes(s, x + 2, y - 5, C.cyan, p)
        px(s, x + 1, y - 5, C.white)
        line(s, x - 1, y - 3, x, y - 7, C.cyan) // crack
    },
    torso: (s, x, y) => {
        tri(s, x - 5, y, x + 5, y, x, y + 10, C.stone2)
        tri(s, x - 5, y, x, y, x, y + 10, C.stone1)
        line(s, x - 1, y + 1, x + 2, y + 6, C.cyan)
        px(s, x + 1, y + 3, C.white)
        px(s, x + 3, y + 1, C.stone3)
    },
    lower: (s, x, hipY, p, t) => {
        // a tail of wind instead of legs, hovering
        const k = Math.floor(t * 8) & 3
        for (let i = 0; i < 7; i++) {
            const w = Math.max(0, 3 - (i >> 1))
            const sx = x - (i >> 1) + ((i + k) & 1)
            rect(s, sx - w, hipY + 2 + i, w * 2 + 1, 1, i < 3 ? C.haze : C.night3)
        }
        px(s, x - 4, hipY + 9, C.frost)
    },
    pants: C.haze, pantsDk: C.night3, boot: C.haze, bootHi: C.frost,
    arm: C.stone2, armLow: C.stone3, armBack: C.stone1, armBackLow: C.stone2, hand: C.cyan,
    blade: M.ice, haft: M.obsidian, gem: M.ice, gemStyle: Gem.Crystal, accent: C.cyan,
    ambient: (dst, t) => {
        const k = step(t, 10, 6)
        if (k === 0) { dst.set(fxX(J.bx + 2), fxY(J.topY - 12), C.white); dst.set(fxX(J.bx + 3), fxY(J.topY - 11), C.cyan) }
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
    one(frostboundRaider), one(drownedSailor),
    one(hollowAcolyte), one(restlessLegionnaire), one(skyshardWisp), one(unravelledKnight), one(voidThrall)
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

