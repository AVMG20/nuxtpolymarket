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
import { line, px, rect, disc, ellipse, tri, dither, bayer } from './surface'
import { HP, J, fxX, fxY, hclip, hitClip, deathClip, rest, type Look, type Painter } from './rig'
import { robeSkirt, smear, sparks, streak } from './hero-parts'
import { M, tip, sword, axe, bow, staff, Gem, type Mat } from './weapons'

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

// 3 · Cinderpass — Cinder Kobold: small scaled dog-faces, ash-caked, a candle on the helmet.
const cinderKobold: WorldSkin = {
    legLen: 6, torsoLen: 7,
    skin: [C.red1, C.orange, C.gold2],
    back: (s, x, y) => { line(s, x - 3, y + 7, x - 8, y + 11, C.red1, 2); px(s, x - 9, y + 12, C.orange) }, // tail
    head: (s, x, y, p, t) => {
        ellipse(s, x, y - 4, 3, 3, C.red1)
        rect(s, x + 1, y - 4, 5, 3, C.orange) // snout
        px(s, x + 5, y - 4, C.ink)
        rect(s, x + 2, y - 2, 4, 1, C.red1)
        eyes(s, x + 1, y - 5, C.gold3, p)
        px(s, x - 3, y - 6, C.red1); px(s, x - 4, y - 7, C.red1) // horn nub
        // ash dusting
        px(s, x - 1, y - 3, C.stone3); px(s, x + 3, y - 3, C.stone3)
        // miner helmet with a candle
        rect(s, x - 3, y - 8, 6, 2, C.steel1); px(s, x - 1, y - 8, C.steel2)
        rect(s, x, y - 10, 1, 2, C.bone1)
        px(s, x, y - 11 - (Math.floor(t * 8) & 1), C.gold2)
    },
    torso: (s, x, y) => {
        rect(s, x - 3, y, 7, 7, C.orange)
        rect(s, x - 3, y, 1, 7, C.red1)
        rect(s, x - 1, y + 1, 3, 5, C.gold2) // belly scales
        px(s, x - 1, y + 2, C.orange); px(s, x + 1, y + 4, C.orange)
        rect(s, x - 3, y + 5, 7, 1, C.brown1)
        dither(s, x - 3, y, 7, 3, C.stone3, 3) // ash
    },
    pants: C.orange, pantsDk: C.red1, boot: C.red0, bootHi: C.red1,
    arm: C.orange, armLow: C.orange, armBack: C.red1, armBackLow: C.red1, hand: C.red1,
    blade: M.obsidian, haft: M.darkwood, gem: M.lava, gemStyle: Gem.Flame, accent: C.lava1,
    ambient: (dst, t) => {
        const k = step(t, 10, 8)
        dst.set(fxX(J.bx - 3 + (k % 5)), fxY(J.topY - 4 - k), k & 1 ? C.orange : C.gold2)
    }
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
export const WORLD_SKINS: readonly WorldSkin[] = [
    brambleGoblin, bogLurker, cinderKobold, frostboundRaider, drownedSailor,
    hollowAcolyte, restlessLegionnaire, skyshardWisp, unravelledKnight, voidThrall
]

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
    const w = WORLD_SKINS[world - 1]
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

