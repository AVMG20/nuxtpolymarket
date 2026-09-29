// A live battle vignette built from the finished assets — the proof that they play together.
//
// Party on the left (the Hero in any class plus five Champions), and on the right whichever wave
// the viewer picked (`WaveKind`), fought over and over: six of the chosen world's trash with an
// elite among them, the world's boss, or its super boss, each making its entrance. Both sides stand on the 3 front / 3 back formation grid, which the
// side-on camera shows as three ranks of two. Each unit runs the state machine the art is
// authored for:
//
//     IDLE → CHARGE → CAST → RECOVER → IDLE
//
// with the hit landing at the Cast boundary (the clip's `impact`), or, for a ranged unit, when
// its arrow or bolt arrives. Hits spawn pooled particles and damage numbers; Hero and Champion
// casts play their ability VFX.
//
// Two clocks, after Pixel Crusade: bodies play their held 10 fps frames, while everything that
// flies (projectiles, particles, VFX, shake) and the scenery move at the 60 Hz of the loop.
//
// The hit feel is scaled to a crowd. Twelve bodies trading blows would stutter the whole
// scene if every hit froze it, so an ordinary hit only holds the two bodies involved for a
// few ticks, and the target flashes and jolts. The scene-wide freeze, shake, flash and slow
// motion are kept for the moments that matter: a kill (gated, so a chain of kills can't
// freeze it over and over), each impact of a Hero skill, the last kill of a wave, and a boss.
// See JUICE. The dead shatter into their own pixels; bodies winding up are rim-lit in their
// accent colour, and casters leave afterimages.
//
// A boss with a special (presentation only: bosses have no abilities in the game yet) opens with
// it and uses it now and then after, presented like a Hero skill turned on the party: the scene
// tinted, everyone else holding, its hits landing on its own clock. Skills and specials put up no
// name; a boss's own name goes up in the banner halfway through its entrance.
//
// Between waves the party marches: it holds its marks and plays its gait while the scenery
// parallax-scrolls past and the next wave closes in from the right edge.
//
// Every body is baked to frames at setup, so the 60 Hz update and the render allocate nothing:
// the loop only moves numbers and blits surfaces. The scene and the VFX are drawn live each
// frame instead, under the smooth clock (`clock.smooth`): a baked strip is fixed at scroll 0
// and on the 10 fps grid, and neither could parallax or move at 60 Hz.

import { ANIM_FPS, Phase, phaseAt, type Clip } from './anim'
import { C, CLEAR, RAMP, type RampName } from './palette'
import { Surface, bayer, ring } from './surface'
import { textOut } from './font'
import { Particles } from './particles'
import { artById, bake, bakeLater, bakeStep, FORGE_BOSSES, type Baked, type BakeJob } from './catalog'
import { HERO_ART } from './heroes'
import { CHASSIS, championLook } from './champions'
import { ENEMY_RIGS, ELITE_MARK, drawEliteMark, type EnemyWeapon } from './enemies'
import { NUMBER_STYLES, drawNumberAt, type NumberStyle } from './feedback'
import { VL, clock } from './vfx-kit'
import { VFX_BY_ID, type VfxDef } from './vfx'
import { SW, SH, FLOOR_Y, SCROLL_PERIOD, WORLD_SCENES, reflectWater, type WorldScene } from './scenery'
import { CINEMATIC_BY_ID, type CinematicVfx } from './vfx-cinematic'
import { drawSkillBanner, tintLut, applyTint } from './presentation'
import { CLASS_BY_ID } from '../../../shared/utils/hero-quest/content/classes'
import { CHAMPION_BY_ID, CHAMPIONS } from '../../../shared/utils/hero-quest/content/champions'
import { WORLDS } from '../../../shared/utils/hero-quest/content/worlds'
import { specialState, specialsOf, type BossSpecial, type CreatureDef } from './creature'
import { BOSSES_A } from './bosses-a'
import { BOSSES_B } from './bosses-b'
import { GILDED_WARLORD, GREAT_DUMMY, DUMMY_IMPACT, DEEPCOIL, RAMPANT, RAMPAGE_ROAR, RAMPAGE_SLAM } from './raids'
import { STAGE } from './special-kit'
import { ENTRY_SETTLED } from './boss-kit'

export const DEMO_W = SW
export const DEMO_H = SH

/**
 * What the player sees of the scene. The stage always composes the full SW×SH scene; a camera
 * crops a 16:9 window of it and hands that on, and because the display blits at the largest
 * integer scale that fits, a smaller window is bigger pixels. No art changes size. `zoom3` is the
 * camera for the regular stages (the user's choice, 2026-09-25), placed on the formation: both
 * sides span x 79–250 and stand on y 122–154, with the millpond below to y 180. `zoom1`, the whole
 * scene, is kept for the raid bosses to come, which it gives room to be bigger.
 */
export const CAMERAS = {
    zoom1: { label: 'Wide', x: 0, y: 0, w: SW, h: SH },
    zoom3: { label: 'Stage', x: 29, y: 27, w: 272, h: 153 }
} as const
export type CameraId = keyof typeof CAMERAS

/**
 * VL (the VFX stage) is placed inside the scene so effects line up with bodies. The near rank
 * stands a little below the scenery's floor line (`STAGE.oy`). That is what buys the ranks their
 * extra spacing without shoving the rear one up into the hedgerow, and the field runs deep
 * enough to take it.
 */
const OX = STAGE.ox
const OY = STAGE.oy
/** How often a boss reaches for its special once it has opened with it. */
const SPECIAL_CHANCE = 0.3
/**
 * How long a boss's name stays up once it goes up, halfway through its entrance: a base, and a
 * beat more per letter, so a long name can be read before it goes.
 */
const NAME_BASE = 1.4
const NAME_PER_CHAR = 0.08

/** A raid, keyed as its assets are (`raid/<id>/…`). */
export type RaidId = 'guild' | 'training_grounds' | 'dig_site' | 'forge' | 'trait'
/**
 * Which wave the stage fights, over and over: a pack of trash with its elite, the boss, the super
 * boss, or one of the raids. A raid boss is too big for the Stage camera, so a raid is watched on
 * the whole scene (`cameraFor`).
 */
export type WaveKind = 'regular' | 'boss' | 'superboss' | `raid_${RaidId}` | `forge_${ForgeBossId}`
/** One of the Forge raid's three bosses, fought on its own (`forge_<id>`), to look at each in turn. */
export type ForgeBossId = typeof FORGE_BOSSES[number][0]
export const WAVE_KINDS: readonly { id: WaveKind, label: string }[] = [
    { id: 'regular', label: 'Regular + elite' },
    { id: 'boss', label: 'Boss' },
    { id: 'superboss', label: 'Super boss' },
    { id: 'raid_guild', label: 'Raid · Guild' },
    { id: 'raid_training_grounds', label: 'Raid · Training Grounds' },
    { id: 'raid_dig_site', label: 'Raid · Dig-site' },
    { id: 'raid_forge', label: 'Raid · Forge' },
    ...FORGE_BOSSES.map(([id, def]) => ({ id: `forge_${id}` as const, label: `Forge · ${def.name}` })),
    { id: 'raid_trait', label: 'Raid · Trait' }
]
export function raidOf(kind: WaveKind): RaidId | null {
    if (kind.startsWith('forge_')) return 'forge'
    return kind.startsWith('raid_') ? kind.slice(5) as RaidId : null
}
/** The Forge boss a `forge_<id>` wave fights on its own; null for any other wave. */
export function forgeBossOf(kind: WaveKind): ForgeBossId | null {
    return kind.startsWith('forge_') ? kind.slice(6) as ForgeBossId : null
}
/** The camera a wave is watched on: the whole scene for a raid, the Stage camera otherwise. */
export function cameraFor(kind: WaveKind): CameraId {
    return raidOf(kind) ? 'zoom1' : 'zoom3'
}
/** Seconds between a Dig-site raid's add waves, and hits between a Trait raid's escalations. */
const ADD_WAVE_EVERY = 7
const RAMPAGE_EVERY = 10
/**
 * Milliseconds of each tick spent baking in the background. A raid bakes only what it opens with
 * up front (the Trait raid's first tier, the Forge's first boss); the rest bakes a frame at a time
 * while it plays, instead of holding the page for seconds when the raid is picked.
 */
const BAKE_BUDGET = 4
/** How far behind the near rank's mark a raid boss stands (special-kit.ts previews it the same), less its own `advance`. */
const RAID_BOSS_DX = 22
/**
 * A Training Grounds round: seconds the party has to hit the dummy, and how long TIME UP holds
 * before it dissolves (from `DUMMY_FADE_AT`) and the party marches on to the next.
 */
const DUMMY_ROUND = 20
const DUMMY_HOLD = 2.2
const DUMMY_FADE_AT = 1.5

/**
 * Hits to bring each down. Generous, since the stage is for watching the animations play out, and
 * picking the wave means there is no longer any waiting for a boss to come round.
 */
const TOUGHNESS = { trash: 9, elite: 18, boss: 30, superboss: 42, raid: 60 } as const

/** A formation mark in VL space: `x` horizontal, `y` chest height, `g` the ground it stands on. */
type Mark = { readonly x: number, readonly y: number, readonly g: number }

/** Party size, and so the index in `units` where the enemy wave starts. */
const PARTY = 6

/** Which ally marks the Champions take: the Hero holds the near front mark, they take the rest. */
const CHAMP_MARKS = [0, 1, 3, 4, 5] as const

/**
 * How long the party runs between battles. The speed is derived so one march covers exactly one
 * SCROLL_PERIOD, which is what puts the scenery's framing pines back at the edges of the screen
 * by the time the next fight starts.
 */
const MARCH_DUR = 2.4
const MARCH_SPEED = SCROLL_PERIOD / MARCH_DUR

/** The scene ground lines the formation stands on, furthest rank first — the draw order. */
const RANK_Y = [...new Set(VL.foes.map(f => f.g))].sort((a, b) => a - b).map(g => OY + g)

const enum U { Idle, Attack, Cast, Hit, Death, Entry, Gone, Move }

/**
 * The hit feel, per event. `hold` is 60 Hz ticks the bodies involved stop animating; `freeze`
 * is ticks the whole stage stops; `shake` is px of screen shake for `shakeFor` seconds; `flash`
 * is the strength of a dithered full-screen flash; `slowmo` is seconds of the stage at 35%.
 */
const JUICE = {
    hit: { hold: 3 },
    crit: { hold: 5, shake: 1, shakeFor: 0.1 },
    bossHit: { shake: 1, shakeFor: 0.1 },
    kill: { freeze: 3, shake: 1, shakeFor: 0.15 },
    waveEnd: { freeze: 8, shake: 2, shakeFor: 0.3, slowmo: 0.6 },
    skill: { freeze: 4, shake: 2, shakeFor: 0.2, flash: 0.5 },
    bossDown: { freeze: 14, shake: 4, shakeFor: 0.7, flash: 1, slowmo: 1 }
} as const
/** Seconds after a freeze before an ordinary kill may freeze the stage again. */
const FREEZE_GAP = 0.35
/** How far into the Hit clip a struck body starts: straight onto its white flash frame. */
const HIT_FLASH_AT = 0.1
/** How long a cast's afterimages trail it once the strike begins. */
const AFTERIMAGE_FOR = 0.25
/** The seconds between the arrows of one multi-strike volley — the bow clip's release cadence. */
const VOLLEY_GAP = 0.3

/**
 * What a ranged unit looses: an arrow (fletched in its accent), a crossbow quarrel (shorter,
 * flying flat and fast) or a bolt burning through a ramp.
 */
type ShotKind = 'arrow' | 'quarrel' | 'bolt'
interface Shot { kind: ShotKind, ramp: RampName }
const ARROW: Shot = { kind: 'arrow', ramp: 'spark' }
const QUARREL: Shot = { kind: 'quarrel', ramp: 'spark' }
const bolt = (ramp: RampName): Shot => ({ kind: 'bolt', ramp })
const HERO_SHOTS: Readonly<Record<string, Shot>> = {
    class_archer: ARROW, class_bowman: ARROW, class_marksman: ARROW, class_hunter: QUARREL, class_beast_master: QUARREL,
    class_mage: bolt('arcane'), class_wizard: bolt('frost'), class_sorcerer: bolt('fire'),
    class_shaman: bolt('water'), class_witch_doctor: bolt('poison')
}
/** Champion archetypes that fight at range: the casters float at the back and throw bolts. */
const CHAMPION_SHOTS: Readonly<Record<string, Shot>> = { support: bolt('holy'), control: bolt('arcane') }
/** Enemy rigs, in the order `setup` builds them: sword, axe, staff, bow. */
const RIG_SHOTS: readonly (Shot | null)[] = [null, null, bolt('shadow'), ARROW]

interface Unit {
    side: 0 | 1
    x: number
    /** The ground this body stands on: the floor for the front rank, higher for the rear. */
    y: number
    /** Horizontal offset from the mark — how far a wave still has to close before the fight. */
    ox: number
    elite: boolean
    boss: boolean
    frames: Baked[] // indexed by U
    clips: (Clip | null)[] // phase source for Attack / Cast
    impact: number[] // seconds into Attack / Cast when the effect fires
    vfx: VfxDef | null // cast VFX, drawn live
    /** Rim-light colour while winding up and striking. */
    accent: number
    /** What it looses at range, or null for a melee body. */
    shot: Shot | null
    /** Arrows or bolts per Basic Attack (the class's strikesPerAttack). */
    shots: number
    /** Enemy rig index into RIG_SHOTS; -1 for the party and the boss. */
    rig: number
    /** Ticks this body holds its pose: the local hit-stop. */
    hold: number
    /** Ticks left of the struck jolt, a 1 px shudder. */
    jolt: number
    /** Ticks left of a white flash drawn over the body: a boss struck mid-swing, which keeps swinging. */
    flash: number
    /** Px it is drawn below its ground (`CreatureDef.lower`); `y` stays the rank it stands in. */
    sit: number
    /** Px above its ground where a hit lands, and where its numbers stack: a raid boss's are far higher. */
    chest: number
    crown: number
    /** When (in `t`) this body's strike began, for the afterimages' brief window. */
    strikeAt: number
    state: U
    t: number
    wait: number
    fired: boolean
    hp: number
    phase: Phase
    /** Numbers stacked on this unit by the skill playing now. */
    stack: number
}

/**
 * A Hero skill or a boss special being presented: scene tinted, hits landing on its own clock. A
 * special (`special` set) draws its own effect and hits the party.
 */
interface Cine {
    lut: Uint8Array, t: number, next: number, first: Unit | null
    hits: readonly number[], spread: boolean, dur: number, special: BossSpecial | null
}


interface Fx { live: boolean, def: VfxDef | null, t: number }
interface Proj {
    live: boolean, kind: ShotKind, ramp: RampName, color: number
    x: number, y: number, vx: number, vy: number, grav: number
    /** Seconds before it leaves the bow (a volley's later arrows), then its flight time left. */
    delay: number, left: number
    from: Unit | null, to: Unit | null
}
interface Ring { live: boolean, x: number, y: number, t: number, big: boolean }
interface Num { live: boolean, x: number, y: number, dx: number, t: number, style: NumberStyle, text: string, hold: boolean }

/** How long a stacked (held) number stays up, against 0.9 s for a rising one. */
const HOLD_LIFE = 1.8

const NUM_TEXT: Readonly<Record<string, readonly string[]>> = {
    normal: ['128', '96', '1.24K', '211', '87', '640'],
    crit: ['2.4K!', '8.61K!', '1.9K!'],
    heal: ['+356', '+120', '+88'],
    miss: ['MISS'],
    total: ['48.2K', '31.7K', '52.9K', '44.1K']
}
/** What each damage text is worth, for the Training Grounds tally. */
const NUM_VALUE = new Map([...NUM_TEXT.normal!, ...NUM_TEXT.crit!].map(t => [t, parseFloat(t) * (t.includes('K') ? 1000 : 1)]))

/** A damage total the way the numbers show it: 950, 12.4K, 1.20M. */
function compact(n: number): string {
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
    return String(Math.round(n))
}

function frameAt(b: Baked, t: number): Surface {
    const n = b.frames.length
    let f = Math.floor(t * b.fps + 1e-6)
    f = b.loop ? f % n : Math.min(n - 1, f)
    return b.frames[f]!
}

/**
 * Blit a baked body. `rim` paints the edge facing `dir` (+1 right, −1 left) in that colour —
 * Pixel Crusade's rim light: a sprite pixel is lit when the pixel toward the light is empty,
 * or is the outline with empty space beyond it (so interior ink, an eye, never lights). The
 * pixel behind it must be solid too, so a one-pixel line (an aura flame, a spark baked into
 * the frame) is never relit into a stripe.
 */
function blitAt(dst: Surface, b: Baked, t: number, x: number, y: number, fade = 0, halo: number = CLEAR, rim: number = CLEAR, dir = 1): void {
    const src = frameAt(b, t)
    const ox = Math.round(x) - b.ax
    const oy = Math.round(y) - b.ay
    const w = src.w
    if (halo !== CLEAR) {
        // the elite mark's gold ring: every empty pixel touching the sprite
        for (let sy = 0; sy < src.h; sy++) {
            for (let sx = 0; sx < w; sx++) {
                if (src.data[sy * w + sx] !== CLEAR) continue
                if (src.get(sx - 1, sy) === CLEAR && src.get(sx + 1, sy) === CLEAR && src.get(sx, sy - 1) === CLEAR && src.get(sx, sy + 1) === CLEAR) continue
                dst.set(ox + sx, oy + sy, halo)
            }
        }
    }
    for (let sy = 0; sy < src.h; sy++) {
        const yy = oy + sy
        if (yy < 0 || yy >= dst.h) continue
        for (let sx = 0; sx < w; sx++) {
            const c = src.data[sy * w + sx]!
            if (c === CLEAR) continue
            if (fade > 0 && bayer(sx, sy, fade)) continue
            const xx = ox + sx
            if (xx < 0 || xx >= dst.w) continue
            let out = c
            if (rim !== CLEAR && c !== C.ink && src.get(sx - dir, sy) !== CLEAR) {
                const n = src.get(sx + dir, sy)
                if (n === CLEAR || (n === C.ink && src.get(sx + dir * 2, sy) === CLEAR)) out = rim
            }
            dst.data[yy * dst.w + xx] = out
        }
    }
}

/** A checker-dithered silhouette of a body in one colour: an afterimage trailing a cast. */
function ghostAt(dst: Surface, b: Baked, t: number, x: number, y: number, color: number): void {
    const src = frameAt(b, t)
    const ox = Math.round(x) - b.ax
    const oy = Math.round(y) - b.ay
    for (let sy = 0; sy < src.h; sy++) {
        for (let sx = 0; sx < src.w; sx++) {
            if (src.data[sy * src.w + sx] === CLEAR || ((ox + sx + oy + sy) & 1)) continue
            dst.set(ox + sx, oy + sy, color)
        }
    }
}

function frameIndex(b: Baked, t: number): number {
    return Math.min(b.frames.length - 1, Math.floor(t * b.fps + 1e-6))
}

/**
 * The first frame of a death strip where the body starts dissolving: where the pixel count
 * drops by more than a sixth from one frame to the next. The stage shatters the body there
 * instead of letting it fade. Worked out once per strip.
 */
const FADE_START = new WeakMap<Baked, number>()
function fadeStart(b: Baked): number {
    let f = FADE_START.get(b)
    if (f !== undefined) return f
    const count = b.frames.map(s => { let n = 0; for (let i = 0; i < s.data.length; i++) if (s.data[i] !== CLEAR) n++; return n })
    f = b.frames.length - 1
    for (let i = 1; i < count.length; i++) if (count[i]! < count[i - 1]! * 0.83) { f = i; break }
    FADE_START.set(b, f)
    return f
}

function rnd(a: number, b: number): number { return a + Math.random() * (b - a) }

export class BattleDemo {
    readonly frame = new Surface(DEMO_W, DEMO_H, 0, 0)
    private particles = new Particles(2400)
    private scene: WorldScene | null = null
    private units: Unit[] = []
    private fx: Fx[] = Array.from({ length: 8 }, () => ({ live: false, def: null, t: 0 }))
    /** Scratch the live VFX draw into, then blit onto the frame at the VL origin. */
    private vfxLayer = new Surface(VL.W, VL.H, 0, 0)
    /** The scene's foreground, drawn apart so it can go over the fighters and still take the tint. */
    private frontLayer = new Surface(DEMO_W, DEMO_H, 0, 0)
    /** Scratch for the shake: the frame copied out so it can be written back shifted. */
    private shakeLayer = new Surface(DEMO_W, DEMO_H, 0, 0)
    private projs: Proj[] = Array.from({ length: 32 }, () => ({
        live: false, kind: 'arrow' as const, ramp: 'spark' as RampName, color: CLEAR, x: 0, y: 0, vx: 0, vy: 0, grav: 0, delay: 0, left: 0, from: null, to: null
    }))

    private rings: Ring[] = Array.from({ length: 8 }, () => ({ live: false, x: 0, y: 0, t: 0, big: false }))
    // the scene-wide hit feel (JUICE)
    private freeze = 0
    private freezeGap = 0
    private shakeT = 0
    private shakeAmp = 0
    private flash = 0
    private flashColor: number = C.white
    private slowmo = 0
    private nums: Num[] = Array.from({ length: 24 }, () => ({ live: false, x: 0, y: 0, dx: 0, t: 0, style: NUMBER_STYLES[0]!, text: '', hold: false }))
    private heroCine: CinematicVfx | null = null
    private cine: Cine | null = null
    private water = -1
    private glitter = -1
    private time = 0
    private wave = 0
    private waveTimer = 0
    /** Seconds left in the march to the next battle; 0 when a fight is on. */
    private march = 0
    /** A boss waiting out the march, to make its entrance once the party stands on its ground. */
    private bossDue: Unit | null = null
    /** How far the world has travelled, in px — what every scenery layer parallaxes against. */
    private scroll = 0
    private numCursor = 0
    private world = 1
    private classId = 'class_beginner'
    /** The wave being fought, set with `setup`. */
    waveKind: WaveKind = 'regular'
    /** Frame tables for the world's boss and super boss, swapped onto the one boss body. */
    private bossFrames: Baked[][] = []
    /** The world's boss and super boss specials, in step with `bossFrames`, and the one on the stage. */
    private bossSpecials: (BossSpecial | null)[] = []
    private bossSpecial: BossSpecial | null = null
    /** Whether the world's boss and super boss scroll into view with the scenery (`CreatureDef.scrollsIn`), and the one on the stage. */
    private bossScrolls: boolean[] = []
    private bossScrollsIn = false
    /** How far below its mark the world's boss and super boss stand (`CreatureDef.lower`). */
    private bossLower: number[] = []
    /** The world's boss and super boss by name, the one on the stage, and how long its name has been up (−1: not yet). */
    private bossNames: string[] = []
    private bossName = ''
    private nameT = -1
    private nameFor = 0
    /** Whether the boss on the stage has opened with its special yet. */
    private bossOpened = false
    /**
     * A raid wave: its boss's frame tables (one per Forge phase or Trait rampage tier, else one), which
     * is up, and for the Dig-site its adds' tables and the time to the next add wave; for the Trait
     * raid the hits taken toward the next escalation, and whether one is playing. For the Training
     * Grounds: seconds left on the round, the damage landed, and seconds since TIME UP (−1: running).
     * A raid boss with specials has a frame table per special (its body in the Cast slot), taken in turn.
     */
    private raid: {
        id: RaidId, name: string, tables: Baked[][], at: number, adds: Baked[][], next: number, hits: number, escalating: boolean
        clock: number, dmg: number, over: number
        specials: readonly (readonly BossSpecial[])[], spTables: Baked[][][], spNext: number
        /** The boss behind each table, where it is known: for how far in front of its mark it stands. */
        defs: readonly (CreatureDef | undefined)[]
    } | null = null

    /** The Training Grounds' timer and damage readout, rebuilt only when either changes. */
    private tally = ''
    private tallyKey = -1
    /** Where the fight stands for a special's effect, reused every frame. */
    private spParty = Array.from({ length: PARTY }, () => ({ x: 0, y: 0 }))
    /** The boss's adds still standing, for a special that works on them; pooled so the loop allocates nothing. */
    private spAddPool = Array.from({ length: PARTY }, () => ({ x: 0, y: 0 }))
    private spAdds: { x: number, y: number }[] = []
    private spStage = { bx: 0, by: 0, dir: -1, party: this.spParty, adds: this.spAdds }
    private trash: Baked[][] = []
    private rigFrames: Baked[][] = []
    /** Frames still baking in the background, in the order they are needed, each tagged with its raid table. */
    private jobs: (BakeJob & { table: number })[] = []
    paused = false
    camera: CameraId = 'zoom3'
    /** One reusable window per camera, so switching allocates nothing in the loop. */
    private views = Object.fromEntries(Object.entries(CAMERAS).map(([id, c]) => [id, new Surface(c.w, c.h, 0, 0)])) as Record<CameraId, Surface>
    /** HUD label, rebuilt only when the wave changes — never inside the loop. */
    private label = ''
    private labels: string[] = []

    /** Rebuild for a world (1–10), a Hero class and a wave. Bakes every frame the stage will show. */
    setup(world: number, classId: string, waveKind: WaveKind = this.waveKind): void {
        this.jobs.length = 0
        this.world = world
        this.classId = classId
        this.waveKind = waveKind
        const w = WORLDS[world - 1]!
        this.scene = WORLD_SCENES[world - 1]!
        const hero = HERO_ART[classId]!
        const heroFrames = ['idle', 'attack', 'cast', 'hit', 'death', 'idle', 'move'].map(st => bake(artById(`hero/${classId}/${st}`)!))
        const skill = CLASS_BY_ID[classId as keyof typeof CLASS_BY_ID]!.skill.id
        const heroUnit = this.unit(0, VL.allies[2], heroFrames, [hero.clips.attack, hero.clips.cast], VFX_BY_ID[skill] ?? null)
        heroUnit.accent = hero.look.accent
        heroUnit.shot = HERO_SHOTS[classId] ?? null
        heroUnit.shots = CLASS_BY_ID[classId as keyof typeof CLASS_BY_ID]!.strikesPerAttack
        this.heroCine = CINEMATIC_BY_ID[skill] ?? null
        this.cine = null
        const scene = WORLD_SCENES[world - 1]!
        this.water = scene.water ?? -1
        this.glitter = scene.glitter ?? -1
        // five Champions around the Hero, varied by world: the melee pair share his front rank,
        // the ranged three fall in behind — the archetypes' own default rows (§6).
        const pick = (arch: string, k: number) => CHAMPIONS.filter(c => c.archetype === arch)[(world * 3 + k) % 12]!.id
        const roster = [pick('tank', 1), pick('damage', 2), pick('support', 3), pick('control', 4), pick('damage', 5)]
        const champs = roster.map((id, i) => {
            const def = CHAMPION_BY_ID[id]!
            const frames = ['idle', 'attack', 'cast', 'hit', 'death', 'idle', 'move'].map(st => bake(artById(`champion/${id}/${st}`)!))
            const ability = def.abilities[0]!.id
            const u = this.unit(0, VL.allies[CHAMP_MARKS[i]!]!, frames, [CHASSIS[def.archetype].attack, CHASSIS[def.archetype].cast], VFX_BY_ID[ability] ?? null)
            u.accent = championLook(id).accent
            u.shot = CHAMPION_SHOTS[def.archetype] ?? null
            return u
        })
        // the world's trash on three rigs, the middle one elite
        const rigs: EnemyWeapon[] = ['sword', 'axe', 'staff', 'bow']
        this.trash = rigs.map(r => ['idle', 'attack', 'hit', 'death'].map(st => bake(artById(`enemy/${w.id}/${r}/${st}`)!)))
        const pair = [...BOSSES_A, ...BOSSES_B][world - 1]!
        this.bossSpecials = pair.map(def => def.special ?? null)
        this.bossNames = pair.map(def => def.name.toUpperCase())
        this.bossScrolls = pair.map(def => def.scrollsIn ?? false)
        this.bossLower = pair.map(def => def.lower ?? 0)
        this.bossFrames = [`boss/${w.id}`, `superboss/${w.id}`].map((kind, k) => {
            const b = ['idle', 'attack', 'hit', 'death', 'entry'].map(st => bake(artById(`${kind}/${st}`)!))
            // the special plays in the Cast slot; without one the boss only ever swings
            const special = pair[k]!.special ? bake(artById(`${kind}/special`)!) : b[1]!
            // a death that collapses or shrinks on purpose says when to break it apart
            const at = pair[k]!.shatterAt
            if (at !== undefined) FADE_START.set(b[3]!, Math.min(b[3]!.frames.length - 1, Math.round(at * b[3]!.fps)))
            return [b[0]!, b[1]!, special, b[2]!, b[3]!, b[4]!, b[0]!]
        })
        // frame tables per rig, built once so a wave only swaps references
        this.rigFrames = this.trash.map(rig => [rig[0]!, rig[1]!, rig[1]!, rig[2]!, rig[3]!, rig[0]!, rig[0]!])
        this.raid = this.bakeRaid(raidOf(waveKind), forgeBossOf(waveKind))
        this.camera = cameraFor(waveKind)
        // a fixed pool: a wave of six trash bodies and one boss, reset in place each wave
        const foes = [0, 1, 2, 3, 4, 5].map(i => this.unit(1, VL.foes[i]!, this.rigFrames[i % 4]!, [ENEMY_RIGS.sword.attack], null))
        // a raid boss stands on the near rank, well back, its bulk filling the right of the scene
        const boss = this.raid
            ? this.unit(1, VL.foes[0], this.raid.tables[0]!, [], null, RAID_BOSS_DX - (this.raid.defs[0]?.advance ?? 0))
            : this.unit(1, VL.foes[1], this.bossFrames[0]!, [], null, 6)
        boss.boss = true
        // the Dig-site's adds crawl out in front of the Deepcoil, not inside it
        if (this.raid?.id === 'dig_site') for (let k = 0; k < 3; k++) foes[k]!.x -= 44
        // the dummy's target sits high on its chest, and its bucket higher than any raid boss's crown
        const dummy = this.raid?.id === 'training_grounds'
        boss.chest = dummy ? 78 : this.raid ? 64 : 30
        boss.crown = dummy ? 140 : this.raid ? 112 : 52
        this.units = [heroUnit, ...champs, ...foes, boss]
        for (const u of [...foes, boss]) u.state = U.Gone
        const name = w.name.toUpperCase()
        const suffix = this.raid ? `  ${this.raid.id.replace('_', ' ').toUpperCase()} RAID` : waveKind === 'boss' ? '  BOSS' : waveKind === 'superboss' ? '  SUPER BOSS' : ''
        this.labels = Array.from({ length: 99 }, (_, i) => `${name}  WAVE ${i + 1}${suffix}`)
        this.wave = 0
        this.bossDue = null
        this.march = 0
        // a boss that scrolls into view has to be marched up to, even on the first wave
        if (waveKind !== 'regular' && this.bossScrolls[waveKind === 'superboss' ? 1 : 0]) this.startMarch()
        else this.spawnWave()
        this.particles.clear()
        for (const f of this.fx) f.live = false
        for (const n of this.nums) n.live = false
        for (const p of this.projs) p.live = false
        for (const r of this.rings) r.live = false
        this.freeze = 0; this.freezeGap = 0; this.shakeT = 0; this.flash = 0; this.slowmo = 0
    }

    private unit(side: 0 | 1, mark: Mark, frames: Baked[], clips: (Clip | null)[], vfx: VfxDef | null, dx = 0): Unit {
        const [idle, attack, cast, hit, death, entry, move] = frames
        return {
            side, x: OX + mark.x + dx, y: OY + mark.g, ox: 0, elite: false, boss: false,
            frames: [idle!, attack!, cast ?? attack!, hit!, death!, entry ?? idle!, idle!, move ?? idle!],
            clips: [null, clips[0] ?? null, clips[1] ?? null],
            impact: [0, clips[0]?.impact ?? 0.45 * attack!.frames.length / ANIM_FPS, clips[1]?.impact ?? 0.45 * (cast ?? attack!).frames.length / ANIM_FPS],
            vfx, accent: C.red3, shot: null, shots: 1, rig: -1, hold: 0, jolt: 0, flash: 0, sit: 0, chest: 14, crown: 40, strikeAt: -1,
            state: U.Idle, t: 0, wait: 0.5 + Math.random() * 1.2, fired: false, hp: 4, phase: Phase.Idle, stack: 0
        }
    }

    /**
     * Bake a raid's boss, one frame table per Forge boss or Trait rampage tier (one for the rest), and
     * the Dig-site's adds; null for a wave that is not a raid. A table follows the unit's slots: idle,
     * attack, cast (the attack again), hit, death, entry, idle; a boss with specials gets a copy of its
     * table per special, with that special's body in the cast slot, and each Trait tier has its own,
     * sized to its body. Each Trait tier's escalation plays in its entry slot, and it has no death.
     * The Training Grounds dummy has only idle, hit and entry.
     */
    private bakeRaid(id: RaidId | null, solo: ForgeBossId | null = null): BattleDemo['raid'] {
        if (!id) return null
        // a table after the first (a later Trait tier or Forge boss) bakes in the background
        let later = -1
        const b = (asset: string): Baked => {
            if (later < 1) return bake(artById(asset)!)
            const j = Object.assign(bakeLater(artById(asset)!), { table: later })
            this.jobs.push(j)
            return j.baked
        }
        const table = (base: string, entry: string | null, death: string | null, idleForHit = false, k = 0): Baked[] => {
            later = k
            const idle = b(`${base}/idle`)
            const attack = b(`${base}/attack`)
            const out = [idle, attack, attack, idleForHit ? idle : b(`${base}/hit`), death ? b(death) : idle, entry ? b(entry) : idle, idle]
            later = -1
            return out
        }
        let tables: Baked[][]
        let name: string
        // the Forge's bosses in the order they come: all three, or the one picked to fight alone
        const forge = FORGE_BOSSES.filter(([b]) => !solo || b === solo)
        if (id === 'forge') {
            // three bosses back to back, each a table of its own
            tables = forge.map(([b], k) => table(`raid/forge/${b}`, `raid/forge/${b}/entry`, `raid/forge/${b}/death`, false, k))
            name = forge[0]![1].name
        } else if (id === 'trait') {
            tables = RAMPANT.map((_, i) => table(`raid/trait/rampage${i + 1}`, i < RAMPANT.length - 1 ? `raid/trait/rampage${i + 1}/escalate` : null, null, false, i))
            name = RAMPANT[0]!.name
        } else if (id === 'training_grounds') {
            // the dummy only lands, stands and takes hits: its idle fills the attack and death slots
            const idle = b('raid/training_grounds/idle')
            tables = [[idle, idle, idle, b('raid/training_grounds/hit'), idle, b('raid/training_grounds/entry'), idle]]
            name = GREAT_DUMMY.name
        } else {
            tables = [table(`raid/${id}`, `raid/${id}/entry`, `raid/${id}/death`)]
            name = { guild: GILDED_WARLORD, dig_site: DEEPCOIL }[id].name
        }
        const adds = id === 'dig_site' ? ['burrow_grub', 'ore_beetle'].map(a => table(`raid/dig_site/add_${a}`, null, `raid/dig_site/add_${a}/death`, true)) : []
        // the boss behind each table, where it has specials, and where its assets are
        const defs = id === 'trait' ? RAMPANT : id === 'forge' ? forge.map(([, d]) => d) : id === 'guild' ? [GILDED_WARLORD] : id === 'dig_site' ? [DEEPCOIL] : []
        const base = (k: number) => id === 'trait' ? `raid/trait/rampage${k + 1}` : id === 'forge' ? `raid/forge/${forge[k]![0]}` : `raid/${id}`
        const specials = tables.map((_, k) => defs[k] ? specialsOf(defs[k]) : [])
        const spTables = tables.map((tb, k) => specials[k]!.map((_, n) => {
            later = k
            const body = b(`${base(k)}/${specialState(n)}`)
            later = -1
            return tb.map((f, j) => j === 2 ? body : f)
        }))
        // baked in the order they come: each table with its specials, the next tier or boss after
        this.jobs.sort((a, c) => a.table - c.table)
        return { id, name: name.split(' — ')[0]!.toUpperCase(), tables, at: 0, adds, next: 0, hits: 0, escalating: false, clock: DUMMY_ROUND, dmg: 0, over: -1, specials, spTables, spNext: 0, defs: tables.map((_, k) => defs[k]) }
    }

    /** Bake in the background for up to BAKE_BUDGET ms: the raid's later tables, in the order they come. */
    private bakeSome(): void {
        const until = performance.now() + BAKE_BUDGET
        while (this.jobs.length && performance.now() < until) {
            const j = this.jobs[0]!
            if (bakeStep(j)) this.jobs.shift()
        }
    }

    /** Whether raid table `k` and its specials are baked. */
    private baked(k: number): boolean {
        return !this.jobs.some(j => j.table === k)
    }

    /** Finish baking raid table `k` now, for a table needed before the background got to it. */
    private finishBaking(k: number): void {
        for (const j of this.jobs) if (j.table === k) while (!bakeStep(j));
        this.jobs = this.jobs.filter(j => j.table !== k)
    }

    /**
     * Let go of every baked frame and anything still baking. The stage calls it when it unmounts:
     * the dev tools keep an unmounted component alive, and with it everything it baked.
     */
    dispose(): void {
        this.jobs.length = 0
        this.raid = null
        this.units = []
        this.bossFrames = []
        this.trash = []
        this.rigFrames = []
        for (const p of this.projs) { p.live = false; p.from = null; p.to = null }
        this.scene = null
    }

    /**
     * A raid boss takes `dmg`, before the kill check: the Trait raid's Rampant never falls, and every
     * RAMPAGE_EVERY hits it plays its escalation beat, untouchable, and comes out a tier up.
     */
    private raidHurt(u: Unit, dmg: number): void {
        const r = this.raid
        if (!r) return
        if (r.id === 'training_grounds') {
            u.hp = Math.max(1, u.hp)
        } else if (r.id === 'trait') {
            u.hp = Math.max(1, u.hp)
            r.hits += dmg
            // it escalates once a special it is playing is done
            if (r.hits >= RAMPAGE_EVERY && r.at < r.tables.length - 1 && !r.escalating && u.state !== U.Entry && u.state !== U.Cast && this.baked(r.at + 1)) {
                r.hits = 0
                r.escalating = true
                u.state = U.Entry
                u.t = 0
                // it gathers itself: a pink wash as the beat begins; the weight comes on the slam
                this.flashFor(0.3, C.pink)
            }
        }
    }

    /** Put `text` up in the boss banner, the way its name goes up on its entrance. */
    private announce(text: string): void {
        this.bossName = text
        this.nameT = 0
        this.nameFor = NAME_BASE + NAME_PER_CHAR * text.length
    }

    /** A Dig-site add wave: burrow grubs and ore beetles crawl out onto the empty marks before the Deepcoil. */
    private raidAdds(r: NonNullable<BattleDemo['raid']>, dt: number): void {
        const boss = this.units[this.units.length - 1]!
        if (!standingAny(boss) || this.cine) return
        r.next -= dt
        if (r.next > 0) return
        r.next = ADD_WAVE_EVERY
        for (let k = 0; k < 3; k++) {
            const u = this.units[PARTY + k]!
            if (u.state !== U.Gone) continue
            u.frames = r.adds[k & 1]!
            u.state = U.Entry
            u.t = 0
            u.hp = TOUGHNESS.trash
            u.elite = false
            u.rig = -1
            // the beetles spit molten ore; the grubs close and bite
            u.shot = k & 1 ? bolt('ember') : null
            u.wait = 0.8 + Math.random()
            u.fired = false
        }
    }

    /**
     * A Training Grounds round: the clock runs while the dummy stands, TIME UP goes up when it runs
     * out, and after DUMMY_HOLD the dummy is taken off so the party marches on to the next one.
     */
    private dummyRound(r: NonNullable<BattleDemo['raid']>, dt: number): void {
        const boss = this.units[this.units.length - 1]!
        if (r.over >= 0) {
            r.over += dt
            if (r.over >= DUMMY_HOLD && boss.state !== U.Gone) boss.state = U.Gone
        } else if (standingAny(boss)) {
            r.clock = Math.max(0, r.clock - dt)
            if (r.clock === 0) { r.over = 0; this.announce('TIME UP') }
        }
        const key = Math.ceil(r.clock) * 1e9 + r.dmg
        if (key !== this.tallyKey) {
            this.tallyKey = key
            this.tally = `${compact(r.dmg)} DMG  0:${String(Math.ceil(r.clock)).padStart(2, '0')}`
        }
    }

    private spawnWave(): void {
        const bossWave = this.waveKind !== 'regular'
        const which = this.waveKind === 'superboss' ? 1 : 0
        for (let i = PARTY; i < this.units.length; i++) {
            const u = this.units[i]!
            const active = u.boss ? bossWave : !bossWave
            u.state = active ? U.Entry : U.Gone
            u.t = 0
            u.fired = false
            u.hold = 0
            u.jolt = 0
            u.flash = 0
            u.wait = 0.5 + Math.random() * 1.2
            if (!u.boss && active) {
                const slot = i - PARTY
                // rotate the roster each wave, so every creature takes its turn in the elite slot
                u.rig = (slot + this.wave) % 4
                u.frames = this.rigFrames[u.rig]!
                u.shot = RIG_SHOTS[u.rig]!
                u.elite = slot === 1
                u.hp = u.elite ? TOUGHNESS.elite : TOUGHNESS.trash
            }
            if (u.boss && active) {
                const r = this.raid
                if (r) { r.at = 0; r.hits = 0; r.escalating = false; r.next = ADD_WAVE_EVERY / 2; r.clock = DUMMY_ROUND; r.dmg = 0; r.over = -1 }
                u.frames = r ? r.tables[0]! : this.bossFrames[which]!
                this.bossSpecial = r ? r.specials[0]![0] ?? null : this.bossSpecials[which]!
                this.bossOpened = false
                this.bossName = r ? r.name : this.bossNames[which]!
                this.nameT = -1
                this.nameFor = NAME_BASE + NAME_PER_CHAR * this.bossName.length
                this.bossScrollsIn = r ? false : this.bossScrolls[which]!
                u.sit = r ? 0 : this.bossLower[which]!
                u.hp = r ? TOUGHNESS.raid : which & 1 ? TOUGHNESS.superboss : TOUGHNESS.boss
                // sliding in with the scroll would play its entry off-screen, so it waits for the march
                // to end; one already standing in the world comes into view with the ground instead
                if (this.march > 0) { u.state = this.bossScrollsIn ? U.Idle : U.Gone; this.bossDue = u }
            }
        }
        this.wave++
        this.label = this.labels[(this.wave - 1) % this.labels.length]!
    }

    /**
     * Set off for the next battle. The party holds its marks and plays its gait while the world
     * scrolls past, and the wave spawns off the right edge to close as the ground is covered —
     * so the next pack is walked into rather than appearing out of nowhere.
     */
    private startMarch(): void {
        this.march = MARCH_DUR
        this.spawnWave()
        for (let i = 0; i < this.units.length; i++) {
            const u = this.units[i]!
            if (i < PARTY) {
                if (u.state === U.Gone) continue
                u.state = U.Move
                u.t = Math.random() * 0.4 // break the lockstep: six units on one cycle reads as a chorus line
            } else if (u.state !== U.Gone) {
                u.ox = MARCH_SPEED * MARCH_DUR
            }
        }
    }

    private endMarch(): void {
        this.march = 0
        // The last tick of a march overshoots by up to a frame's worth of scroll, and over many
        // waves that crept the framing off the edges and onto the fight. Land on the period.
        this.scroll = Math.round(this.scroll / SCROLL_PERIOD) * SCROLL_PERIOD
        for (let i = 0; i < this.units.length; i++) {
            const u = this.units[i]!
            u.ox = 0
            if (i < PARTY && u.state === U.Move) { u.state = U.Idle; u.t = 0; u.wait = 0.3 + Math.random() * 0.8 }
        }
        if (this.bossDue) {
            const u = this.bossDue
            const entry = u.frames[U.Entry]!
            u.state = U.Entry
            // one that scrolled into view has already arrived: it only roars
            u.t = this.bossScrollsIn ? ENTRY_SETTLED * entry.frames.length / entry.fps : 0
            this.bossDue = null
        }
    }

    private target(side: 0 | 1): Unit | null {
        for (let i = 0; i < this.units.length; i++) {
            const u = this.units[i]!
            if (u.side !== side && u.state !== U.Death && u.state !== U.Gone && u.state !== U.Entry) return u
        }
        return null
    }

    private number(x: number, y: number, kind: 'normal' | 'crit' | 'heal' | 'miss' | 'total', hold = false): string {
        const n = this.nums[this.numCursor]!
        this.numCursor = (this.numCursor + 1) % this.nums.length
        const list = NUM_TEXT[kind]!
        n.live = true; n.x = x; n.y = y; n.t = 0; n.hold = hold
        // loose numbers scatter a few px so a burst of hits doesn't print on one spot; stacks stay aligned
        n.dx = hold ? 0 : Math.round((Math.random() - 0.5) * 8)
        n.style = kind === 'normal' ? NUMBER_STYLES[0]! : kind === 'crit' || kind === 'total' ? NUMBER_STYLES[1]! : kind === 'heal' ? NUMBER_STYLES[2]! : NUMBER_STYLES[3]!
        n.text = list[Math.floor(Math.random() * list.length)]!
        return n.text
    }

    /** Add a hit's shown damage to the Training Grounds tally, while its round is running. */
    private count(tgt: Unit, text: string): void {
        const r = this.raid
        if (r?.id === 'training_grounds' && tgt.boss && r.over < 0) r.dmg += NUM_VALUE.get(text) ?? 0
    }

    /** Start presenting the Hero's skill: the VFX runs from the first frame of the cast. */
    private startCine(def: CinematicVfx, u: Unit): void {
        u.fired = true // hits come from the skill's own clock, not the clip's impact
        this.playFx(u.vfx)
        for (let i = 0; i < this.units.length; i++) this.units[i]!.stack = 0
        const k = def.cinematic
        this.cine = { lut: tintLut(k.tint), t: 0, next: 0, first: null, hits: k.hits, spread: k.spread, dur: def.dur, special: null }
    }

    /** Start presenting a boss's special: its body plays the Cast slot, its effect and hits run on the special's clock. */
    private startSpecial(sp: BossSpecial, u: Unit): void {
        u.fired = true
        for (let i = 0; i < this.units.length; i++) this.units[i]!.stack = 0
        const b = u.frames[U.Cast]!
        this.cine = { lut: tintLut(sp.tint), t: 0, next: 0, first: null, hits: sp.hits, spread: sp.spread, dur: b.frames.length / b.fps, special: sp }
    }

    /** One of the skill's impacts: damage the next target, stack its number, total at the end. */
    private cineHit(c: Cine, i: number): void {
        let tgt = this.units[0]!
        // a special that strengthens the boss's adds lands on them, walking the line: it mends them
        if (c.special?.target === 'adds') {
            let n = 0
            for (let k = PARTY; k < this.units.length - 1; k++) if (standingAny(this.units[k]!)) n++
            if (!n) return
            let pick = i % n
            for (let k = PARTY; k < this.units.length - 1; k++) {
                const u = this.units[k]!
                if (standingAny(u) && pick-- === 0) { tgt = u; break }
            }
            this.number(tgt.x, tgt.y - tgt.crown, 'heal', true)
            this.particles.burst(tgt.x, tgt.y - 10, 14, 50, 0.7, 'arcane', 0, tgt.y)
            tgt.hp += 3
            if (i === 0) this.flashFor(0.3, C.pink)
            return
        }
        if (c.special) {
            // a special lands on the party, nearest first, walking the line if it spreads
            const party = this.units.slice(0, PARTY).filter(standingAny).sort((a, b) => b.x - a.x)
            if (!party.length) return
            const k = c.special.order?.[i] ?? (c.spread ? i : 0)
            tgt = party[k % party.length]!
        } else {
            let n = 0
            for (let k = 0; k < this.units.length; k++) if (standing(this.units[k]!)) n++
            if (!n) return
            let pick = c.spread ? i % n : 0
            for (let k = 0; k < this.units.length; k++) {
                const u = this.units[k]!
                if (standing(u) && pick-- === 0) { tgt = u; break }
            }
        }
        if (!c.first) c.first = tgt
        const top = tgt.y - tgt.crown
        this.count(tgt, this.number(tgt.x, top - tgt.stack * 7, c.special ? 'crit' : 'normal', true))
        tgt.stack++
        this.particles.burst(tgt.x, tgt.y - 14, 16, 80, 0.6, c.special ? 'blood' : 'ember', 140, tgt.y)
        tgt.hp -= 2
        if (tgt.side === 0) tgt.hp = Math.max(1, tgt.hp) // the party doesn't die in the showcase
        if (tgt.boss) this.raidHurt(tgt, 2)
        this.stopFor(JUICE.skill.freeze, true)
        this.shake(JUICE.skill.shake, JUICE.skill.shakeFor)
        if (i === 0) this.flashFor(JUICE.skill.flash, C.white)
        if (tgt.hp <= 0) this.kill(tgt)
        else this.struck(tgt, JUICE.hit.hold)
        if (i === c.hits.length - 1) {
            const f = c.first
            this.number(f.x + 6, f.y - f.crown - f.stack * 7 - 8, 'total', true)
        }
    }

    private playFx(def: VfxDef | null): void {
        if (!def) return
        for (let i = 0; i < this.fx.length; i++) {
            const f = this.fx[i]!
            if (!f.live) { f.live = true; f.def = def; f.t = 0; return }
        }
    }

    // ── the hit feel ───────────────────────────────────────────────────────────────

    /** Freeze the whole stage for `ticks`. An ordinary kill respects FREEZE_GAP; `force` doesn't. */
    private stopFor(ticks: number, force = false): void {
        if (!force && this.freezeGap > 0) return
        this.freeze = Math.max(this.freeze, ticks)
        this.freezeGap = FREEZE_GAP
    }

    private shake(amp: number, t: number): void {
        if (amp >= this.shakeAmp || this.shakeT <= 0) { this.shakeAmp = amp; this.shakeT = t }
    }

    private flashFor(k: number, color: number): void {
        if (k >= this.flash) { this.flash = k; this.flashColor = color }
    }

    /**
     * A body takes a hit: straight onto its white flash frame, held and shuddering. A boss already
     * swinging keeps swinging, as the big ones do: it flashes and shudders, hitching for a tick,
     * but the hit no longer cancels the attack (it used to, before the swing ever landed).
     */
    private struck(tgt: Unit, hold: number): void {
        // mid-escalation the Rampant only flashes: the beat plays out
        if (tgt.state === U.Entry) { tgt.flash = 3; return }
        // a boss swings through a hit, and plays its special through one too
        if (tgt.boss && (tgt.state === U.Attack || tgt.state === U.Cast)) {
            tgt.flash = 3
            tgt.hold = 1
            tgt.jolt = hold + 4
            return
        }
        tgt.state = U.Hit
        tgt.t = HIT_FLASH_AT
        tgt.hold = hold
        tgt.jolt = hold + 4
    }

    /** A body goes down: the kill ring, then a freeze and shake sized to what it meant. */
    private kill(tgt: Unit): void {
        // a boss felled mid-special takes its special down with it
        if (tgt.boss && this.cine?.special) this.cine = null
        tgt.state = U.Death
        tgt.t = 0
        tgt.hold = 0
        const y = tgt.y - tgt.chest
        this.ringAt(tgt.x + tgt.ox, y, tgt.boss)
        this.particles.burst(tgt.x, tgt.y - 10, 18, 40, 0.8, 'dust', 60, tgt.y)
        let left = 0
        for (let k = 0; k < this.units.length; k++) if (standing(this.units[k]!)) left++
        const j = tgt.boss ? JUICE.bossDown : left === 0 ? JUICE.waveEnd : null
        if (j) {
            this.stopFor(j.freeze, true)
            this.shake(j.shake, j.shakeFor)
            this.slowmo = Math.max(this.slowmo, j.slowmo)
            if ('flash' in j) this.flashFor(j.flash, C.white)
        } else {
            this.stopFor(JUICE.kill.freeze)
            this.shake(JUICE.kill.shake, JUICE.kill.shakeFor)
        }
    }

    private ringAt(x: number, y: number, big: boolean): void {
        for (let i = 0; i < this.rings.length; i++) {
            const r = this.rings[i]!
            if (!r.live) { r.live = true; r.x = x; r.y = y; r.t = 0; r.big = big; return }
        }
    }

    /**
     * Break a dying body into chunks of its own pixels, thrown up and away from the party and
     * bouncing on its own ground, then take it off the stage.
     */
    private shatter(u: Unit, b: Baked, src: Surface): void {
        const ox = Math.round(u.x + u.ox) - b.ax
        const oy = Math.round(u.y + u.sit) - b.ay
        const cx = u.x + u.ox
        const cy = u.y - u.chest
        const away = u.side ? 1 : -1
        for (let sy = 0; sy < src.h; sy += 2) {
            for (let sx = 0; sx < src.w; sx += 2) {
                // each 2×2 chunk takes its first body colour: the baked frame carries its ink
                // outline, and chunks of outline would fall as black grit
                let c: number = CLEAR
                for (let k = 0; k < 4 && c === CLEAR; k++) {
                    const v = src.get(sx + (k & 1), sy + (k >> 1))
                    if (v !== CLEAR && v !== C.ink) c = v
                }
                if (c === CLEAR) continue
                const wx = ox + sx
                const wy = oy + sy
                const vx = (wx - cx) * rnd(2, 5) + away * rnd(20, 70)
                const vy = (wy - cy) * rnd(1.5, 4) - rnd(60, 150)
                this.particles.spawnShard(wx, wy, vx, vy, rnd(0.6, 1.1), c, 380, 0.4, u.y + u.sit + rnd(1, 7))
            }
        }
        this.particles.burst(cx, cy, 14, 160, 0.3, 'spark', 0, 0)
        u.state = U.Gone
    }

    // ── attacks ────────────────────────────────────────────────────────────────────

    private strike(u: Unit, cast: boolean): void {
        const tgt = this.target(u.side)
        if (cast && u.vfx) this.playFx(u.vfx)
        if (!tgt) return
        // a ranged Basic Attack looses its arrows or bolts; the hit lands when they arrive
        if (u.shot && !cast) {
            for (let k = 0; k < u.shots; k++) this.loose(u, tgt, k * VOLLEY_GAP)
            return
        }
        this.land(u, tgt, cast, true)
    }

    private loose(u: Unit, tgt: Unit, delay: number): void {
        let p: Proj | null = null
        for (let i = 0; i < this.projs.length; i++) if (!this.projs[i]!.live) { p = this.projs[i]!; break }
        if (!p) { this.land(u, tgt, false, false); return }
        p.live = true; p.kind = u.shot!.kind; p.ramp = u.shot!.ramp; p.color = u.accent
        p.delay = delay; p.from = u
        this.aim(p, tgt)
    }

    /** Point a projectile from its owner's bow hand at `tgt`, timed to arrive on its chest. */
    private aim(p: Proj, tgt: Unit): void {
        const u = p.from!
        const dir = u.side ? -1 : 1
        const x0 = u.x + u.ox + dir * 9
        const y0 = u.y - 15
        const x1 = tgt.x + tgt.ox
        const y1 = tgt.y - tgt.chest
        const arrow = p.kind === 'arrow'
        const speed = arrow ? 260 : p.kind === 'quarrel' ? 360 : 170
        const dur = Math.max(0.12, Math.abs(x1 - x0) / speed)
        p.x = x0; p.y = y0; p.left = dur; p.to = tgt
        // an arrow flies a shallow arc; a quarrel and a bolt fly straight
        p.grav = arrow ? 220 : 0
        p.vx = (x1 - x0) / dur
        p.vy = (y1 - y0) / dur - 0.5 * p.grav * dur
    }

    /** Resolve a hit on `tgt`: the number, the burst, the damage and the hit feel. */
    private land(u: Unit, tgt: Unit, cast: boolean, melee: boolean): void {
        if (!standingAny(tgt)) {
            // the target fell before this arrived: take the next one, or fizzle
            const next = this.target(u.side)
            if (!next) return
            tgt = next
        }
        const roll = Math.random()
        const y = tgt.y - tgt.chest
        if (roll < 0.08) { this.number(tgt.x, y - 8, 'miss'); return }
        const crit = cast || roll > 0.82
        this.count(tgt, this.number(tgt.x, y - 8, crit ? 'crit' : 'normal'))
        this.particles.burst(tgt.x - (tgt.side ? 4 : -4), y, crit ? 14 : 8, crit ? 70 : 45, 0.5, tgt.side ? 'spark' : 'blood', 120, tgt.y)
        tgt.hp -= crit ? 2 : 1
        if (tgt.side === 0) tgt.hp = Math.max(1, tgt.hp) // the party doesn't die in the showcase
        if (tgt.boss) this.raidHurt(tgt, crit ? 2 : 1)
        const hold = crit ? JUICE.crit.hold : JUICE.hit.hold
        if (melee) u.hold = hold // the swing connects: the striker stops on it too
        // only the Hero's own crits shake the screen: with twelve bodies trading blows, everyone's would never stop
        if (crit && u === this.units[0]) this.shake(JUICE.crit.shake, JUICE.crit.shakeFor)
        if (tgt.boss) this.shake(JUICE.bossHit.shake, JUICE.bossHit.shakeFor)
        if (tgt.hp <= 0) this.kill(tgt)
        else this.struck(tgt, hold)
        if (u.side === 0 && Math.random() < 0.25) { const ally = this.units[0]!; this.number(ally.x - 16, ally.y - 30, 'heal') }
    }

    update(dt: number): void {
        if (this.jobs.length) this.bakeSome()
        if (this.paused) return
        if (this.shakeT > 0) this.shakeT -= dt
        if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 4)
        if (this.freeze > 0) {
            // the whole stage holds; only the sparks keep drifting, slowly
            this.freeze--
            this.particles.update(dt * 0.3)
            return
        }
        if (this.freezeGap > 0) this.freezeGap -= dt
        if (this.slowmo > 0) { this.slowmo -= dt; dt *= 0.35 }
        this.time += dt
        const dummy = this.raid?.id === 'training_grounds' ? this.raid : null
        for (let i = 0; i < this.units.length; i++) {
            const u = this.units[i]!
            if (u.jolt > 0) u.jolt--
            if (u.flash > 0) u.flash--
            if (u.hold > 0) { u.hold--; continue }
            u.t += dt
            const b = u.frames[u.state]!
            const dur = b.frames.length / b.fps
            switch (u.state) {
                case U.Idle:
                    u.phase = Phase.Idle
                    // everyone holds while a Hero skill has the stage
                    // the Training Grounds dummy never swings, and nobody swings at it once time is up
                    if (!this.cine && !this.march && u.t >= u.wait && this.target(u.side) && !(dummy && (u.boss || dummy.over >= 0))) {
                        // a boss opens with its special, then reaches for it now and then
                        const special = u.boss && this.bossSpecial !== null && (!this.bossOpened || Math.random() < SPECIAL_CHANCE)
                        const cast = u.side === 0 ? Math.random() < 0.3 : special
                        u.state = cast ? U.Cast : U.Attack
                        u.t = 0
                        u.fired = false
                        if (cast && i === 0 && this.heroCine) this.startCine(this.heroCine, u)
                        if (special) {
                            // a raid boss with several specials takes them in turn, its body swapped into the Cast slot
                            const r = this.raid
                            const list = r?.specials[r.at]
                            if (r && list?.length) {
                                // one that works on its adds waits until there are adds to work on
                                let n = r.spNext % list.length
                                for (let k = 0; k < list.length && list[n]!.target === 'adds' && !this.addsStanding(); k++) n = (n + 1) % list.length
                                this.bossSpecial = list[n]!
                                u.frames = r.spTables[r.at]![n]!
                                r.spNext = (n + 1) % list.length
                            }
                            this.bossOpened = true
                            this.startSpecial(this.bossSpecial!, u)
                        }
                    }
                    break
                case U.Attack:
                case U.Cast: {
                    const clip = u.clips[u.state]
                    const was = u.phase
                    u.phase = clip ? phaseAt(clip, u.t) : (u.t < u.impact[u.state]! ? Phase.Charge : u.t < u.impact[u.state]! + 0.15 ? Phase.Cast : Phase.Recover)
                    if (u.phase === Phase.Cast && was !== Phase.Cast) u.strikeAt = u.t
                    if (!u.fired && u.t >= u.impact[u.state]!) { u.fired = true; this.strike(u, u.state === U.Cast) }
                    if (u.t >= dur) { u.state = U.Idle; u.t = 0; u.wait = (u.side ? 1.0 : 0.6) + Math.random() * 1.4 }
                    break
                }
                case U.Hit:
                    // a boss answers a flinch with a swing; restarting its wait let the party's steady
                    // hits keep it from ever attacking
                    if (u.t >= dur) { u.state = U.Idle; u.t = 0; u.wait = u.boss ? 0.4 : 0.3 + Math.random() }
                    break
                case U.Death: {
                    // it staggers and falls as authored, then shatters where it would dissolve
                    const fs = fadeStart(b)
                    if (frameIndex(b, u.t) >= fs || u.t >= dur) {
                        this.shatter(u, b, b.frames[Math.max(0, fs - 1)]!)
                        // the Forge: as one of its bosses falls, the next comes out
                        const r = this.raid
                        if (u.boss && r?.id === 'forge' && r.at < r.tables.length - 1) {
                            r.at++
                            this.finishBaking(r.at)
                            // each stands where its own reach wants it
                            u.x = OX + VL.foes[0].x + RAID_BOSS_DX - (r.defs[r.at]?.advance ?? 0)
                            // it opens with a special of its own
                            this.bossSpecial = r.specials[r.at]![0] ?? null
                            this.bossOpened = false
                            r.spNext = 0
                            u.frames = r.tables[r.at]!
                            u.state = U.Entry
                            u.t = 0
                            u.hp = TOUGHNESS.raid
                            this.bossName = r.defs[r.at]!.name.toUpperCase()
                            this.nameT = -1
                            this.nameFor = NAME_BASE + NAME_PER_CHAR * this.bossName.length
                        }
                    }
                    break
                }
                case U.Entry:
                    // a boss's name goes up halfway through its entrance
                    if (u.boss && this.nameT < 0 && u.t >= dur * 0.5) this.nameT = 0
                    // the dummy's stake hits the ground: the whole stage jumps
                    if (u.boss && dummy && u.t >= DUMMY_IMPACT && u.t - dt < DUMMY_IMPACT) {
                        this.shake(JUICE.bossDown.shake, 0.5)
                        this.particles.burst(u.x, u.y - 4, 24, 90, 0.7, 'dust', 60, u.y)
                    }
                    // a Trait raid's escalation: the roar shakes the stage; the slam stops it dead, throws
                    // it about, washes it white, slows it, knocks the party back, and calls the new rampage
                    if (u.boss && this.raid?.escalating) {
                        const r = this.raid
                        if (u.t >= RAMPAGE_ROAR && u.t - dt < RAMPAGE_ROAR) this.shake(2, 0.45)
                        if (u.t >= RAMPAGE_SLAM && u.t - dt < RAMPAGE_SLAM) {
                            this.stopFor(JUICE.bossDown.freeze + 4, true)
                            this.shake(JUICE.bossDown.shake + 1, 0.9)
                            this.flashFor(1, C.white)
                            this.slowmo = Math.max(this.slowmo, 0.6)
                            this.announce(`RAMPAGE ${r.at + 2}`)
                            this.particles.burst(u.x - 30, u.y - 4, 30, 120, 0.9, 'dust', 60, u.y)
                            for (let k = 0; k < PARTY; k++) {
                                const p = this.units[k]!
                                if (!standingAny(p)) continue
                                this.struck(p, JUICE.crit.hold)
                                this.particles.burst(p.x, p.y - 2, 6, 40, 0.5, 'dust', 40, p.y)
                            }
                        }
                    }
                    if (u.t >= (u.boss ? dur : 0.6)) {
                        u.state = U.Idle
                        u.t = 0
                        // a Trait raid's escalation beat plays in the Entry slot; it ends a tier up
                        const r = this.raid
                        // its banner went up on the slam
                        if (u.boss && r?.escalating) { r.escalating = false; r.at++; u.frames = r.tables[r.at]! }
                    }
                    break
                case U.Move:
                case U.Gone:
                    break
            }
        }
        if (this.raid?.id === 'dig_site' && !this.march) this.raidAdds(this.raid, dt)
        if (dummy && !this.march) this.dummyRound(dummy, dt)
        if (this.nameT >= 0 && this.nameT < this.nameFor) this.nameT += dt
        const c = this.cine
        if (c) {
            c.t += dt
            const hits = c.hits
            while (c.next < hits.length && c.t >= hits[c.next]!) this.cineHit(c, c.next++)
            if (c.t >= c.dur + 0.3) this.cine = null
        }
        // march to the next battle once the pack is down
        if (this.march > 0) {
            this.march -= dt
            this.scroll += MARCH_SPEED * dt
            // The wave stands still in the world; it is the party closing the distance. Its
            // offset is just the ground still to cover, so it slides at exactly the scroll rate.
            const slide = Math.round(MARCH_SPEED * Math.max(0, this.march))
            for (let i = PARTY; i < this.units.length; i++) this.units[i]!.ox = slide
            if (this.march <= 0) this.endMarch()
        } else {
            let foes = 0
            for (let i = 0; i < this.units.length; i++) if (this.units[i]!.side === 1 && this.units[i]!.state !== U.Gone) foes++
            if (foes === 0) {
                this.waveTimer += dt
                if (this.waveTimer > 0.7) { this.waveTimer = 0; this.startMarch() }
            }
        }
        for (let i = 0; i < this.fx.length; i++) {
            const f = this.fx[i]!
            if (!f.live) continue
            f.t += dt
            if (f.t >= f.def!.dur) f.live = false
        }
        for (let i = 0; i < this.projs.length; i++) {
            const p = this.projs[i]!
            if (!p.live) continue
            if (p.delay > 0) {
                p.delay -= dt
                // a later arrow in a volley aims at whoever is standing when it leaves
                if (p.delay <= 0 && p.to && !standingAny(p.to)) { const next = this.target(p.from!.side); if (next) this.aim(p, next) }
                continue
            }
            p.vy += p.grav * dt
            p.x += p.vx * dt
            p.y += p.vy * dt
            p.left -= dt
            if (p.kind === 'bolt' && (this.time * 60 & 1)) this.particles.spawn(p.x, p.y, rnd(-8, 8), rnd(-8, 8), 0.25, p.ramp)
            if (p.left <= 0) {
                p.live = false
                if (p.kind === 'bolt') this.particles.burst(p.x, p.y, 8, 50, 0.35, p.ramp)
                if (p.from && p.to) this.land(p.from, p.to, false, false)
            }
        }
        for (let i = 0; i < this.rings.length; i++) { const r = this.rings[i]!; if (r.live && (r.t += dt) > 0.35) r.live = false }
        for (let i = 0; i < this.nums.length; i++) { const n = this.nums[i]!; if (!n.live) continue; n.t += dt; if (n.t > (n.hold ? HOLD_LIFE : 0.9)) n.live = false }
        this.particles.update(dt)
        // ambient: embers, dust — cosmetic
        if (Math.random() < 0.05) this.particles.spawn(Math.random() * DEMO_W, FLOOR_Y - 1, (Math.random() - 0.5) * 6, -8 - Math.random() * 10, 2.5, 'dust')
    }

    render(): Surface {
        const s = this.frame
        if (!this.scene) return s
        // Everything drawn from here to the shake samples time smoothly, at the loop's 60 Hz.
        clock.smooth = true
        // Drawn live rather than blitted from a baked strip: a bake is fixed at scroll 0, and the
        // march needs every layer to parallax against `scroll`. Measured at ~1 ms, 6% of a frame.
        this.scene.draw(s, this.scroll, this.time)
        const c = this.cine
        // the scene dims toward the skill's colour, stepping in and out through the dither
        const tint = c ? Math.min(16, Math.floor(Math.min(c.t / 0.2, (c.dur + 0.3 - c.t) / 0.3) * 16)) : 0
        if (c) applyTint(s, c.lut, tint)
        // Painter's order: furthest rank first, each nearer one drawn over it. Within a rank the
        // old right-to-left walk stands, so party and enemies overlap the way they always did.
        for (let r = 0; r < RANK_Y.length; r++) {
            const gy = RANK_Y[r]!
            for (let i = this.units.length - 1; i >= 0; i--) {
                const u = this.units[i]!
                if (u.state === U.Gone || u.y !== gy) continue
                const b = u.frames[u.state]!
                // adds fade in; the Training Grounds dummy, with no death, dissolves once its round is done
                const done = u.boss && this.raid?.id === 'training_grounds' ? this.raid.over - DUMMY_FADE_AT : -1
                const fade = u.state === U.Entry && !u.boss ? Math.max(0, 16 - Math.floor(u.t * 30)) : done > 0 ? Math.min(16, Math.floor(done * 24)) : 0
                const dir = u.side ? -1 : 1
                const x = u.x + u.ox + (u.jolt > 0 ? ((u.jolt >> 1) & 1 ? dir : -dir) : 0)
                const acting = u.state === U.Attack || u.state === U.Cast
                // rim-lit while winding up and striking, and the Hero for as long as he casts his skill
                const lit = acting && (u.phase === Phase.Charge || u.phase === Phase.Cast || (i === 0 && this.cine !== null && !this.cine.special) || (u.boss && this.cine?.special != null))
                // a caster's strike leaves two afterimages behind it, for a moment
                if (u.state === U.Cast && u.phase === Phase.Cast && u.t - u.strikeAt < AFTERIMAGE_FOR) {
                    ghostAt(s, b, u.t, x - dir * 6, u.y + u.sit, C.night3)
                    ghostAt(s, b, u.t, x - dir * 3, u.y + u.sit, u.accent)
                }
                blitAt(s, b, u.t, x, u.y + u.sit, fade, u.elite && u.state !== U.Death && fade === 0 ? ELITE_MARK : CLEAR, lit ? u.accent : CLEAR, dir)
                if (u.flash > 0) ghostAt(s, b, u.t, x, u.y + u.sit, C.white)
                if (u.elite && u.state !== U.Death) drawEliteMark(s, u.x + u.ox, u.y - 36, this.time)
            }
        }
        for (let i = 0; i < this.fx.length; i++) {
            const f = this.fx[i]!
            if (!f.live) continue
            const v = this.vfxLayer
            v.clear()
            f.def!.draw(v, f.t)
            for (let y = 0; y < v.h; y++) {
                for (let x = 0; x < v.w; x++) {
                    const c = v.data[y * v.w + x]!
                    if (c !== CLEAR) s.set(OX + x, OY + y, c)
                }
            }
        }
        if (c?.special && c.t < c.dur) this.drawSpecial(s, c)
        for (let i = 0; i < this.projs.length; i++) { const p = this.projs[i]!; if (p.live && p.delay <= 0) drawProj(s, p) }
        for (let i = 0; i < this.rings.length; i++) {
            const r = this.rings[i]!
            if (!r.live) continue
            const u = r.t / 0.35
            ring(s, r.x, r.y, 3 + u * (r.big ? 40 : 16), u < 0.5 ? C.white : C.gold2)
            if (r.big) ring(s, r.x, r.y, 2 + u * 28, C.gold3)
        }
        this.particles.draw(s)
        // the foreground stands nearer the camera than the near rank, so it goes over the fight
        if (this.scene.front) {
            const f = this.frontLayer
            f.clear()
            this.scene.front(f, this.scroll, this.time)
            if (c) applyTint(f, c.lut, tint)
            for (let i = 0; i < f.data.length; i++) if (f.data[i] !== CLEAR) s.data[i] = f.data[i]!
        }
        // standing water mirrors the fight, not just the scenery
        if (this.water >= 0) reflectWater(s, this.water, this.time, this.glitter)
        for (let i = 0; i < this.nums.length; i++) { const n = this.nums[i]!; if (n.live) drawNumber(s, n) }
        clock.smooth = false
        if (this.shakeT > 0) {
            // quantised shake: a new offset every other tick, never a smooth wobble
            const a = this.shakeAmp
            const k = Math.floor(this.time * 30)
            shift(s, this.shakeLayer, ((k * 7919) % 3 - 1) * a, ((k * 104729) % 3 - 1) * Math.max(1, a - 1))
        }
        if (this.flash > 0) {
            // at most 6/16 of the pixels: a boss kill at half coverage washed the whole scene out
            const level = Math.ceil(this.flash * 2) * 3
            for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (bayer(x, y, level)) s.data[y * s.w + x] = this.flashColor
        }
        // the camera: crop the window, then draw the HUD on what the player actually sees
        const cam = CAMERAS[this.camera]
        let out = s
        if (cam.w !== SW) {
            out = this.views[this.camera]
            for (let y = 0; y < cam.h; y++) out.data.set(s.data.subarray((cam.y + y) * s.w + cam.x, (cam.y + y) * s.w + cam.x + cam.w), y * cam.w)
        }
        textOut(out, this.label, 6, 5, C.bone1, 'small', 1, 0, 1, C.ink, -1)
        if (this.raid?.id === 'training_grounds') textOut(out, this.tally, cam.w - 6, 5, this.raid.clock <= 5 ? C.red3 : C.gold3, 'small', 1, 2, 1, C.ink, -1)
        if (this.nameT >= 0 && this.nameT < this.nameFor) drawSkillBanner(out, this.bossName, cam.w / 2, 14, this.nameT, true, this.nameFor - this.nameT)
        return out
    }

    /** Whether any of the boss's adds are standing. */
    private addsStanding(): boolean {
        for (let k = PARTY; k < this.units.length - 1; k++) if (standingAny(this.units[k]!)) return true
        return false
    }

    /** A boss special's effect, drawn over the fight where the boss and the party stand now. */
    private drawSpecial(s: Surface, c: Cine): void {
        const boss = this.units[this.units.length - 1]!
        const st = this.spStage
        st.bx = boss.x + boss.ox
        st.by = boss.y + boss.sit
        for (let i = 0; i < PARTY; i++) { const u = this.units[i]!; this.spParty[i]!.x = u.x + u.ox; this.spParty[i]!.y = u.y }
        this.spParty.sort((a, b) => b.x - a.x)
        this.spAdds.length = 0
        for (let i = PARTY; i < this.units.length - 1; i++) {
            const u = this.units[i]!
            if (!standingAny(u)) continue
            const a = this.spAddPool[this.spAdds.length]!
            a.x = u.x + u.ox
            a.y = u.y
            this.spAdds.push(a)
        }
        c.special!.fx(s, c.t, st)
    }
}

/** An enemy that can still be hit. */
function standing(u: Unit): boolean {
    return u.side === 1 && standingAny(u)
}

/** Any body, either side, that can still be hit. */
function standingAny(u: Unit): boolean {
    return u.state !== U.Death && u.state !== U.Gone && u.state !== U.Entry
}

/** Copy the frame out and write it back offset by (dx, dy), clamping at the edges. */
function shift(s: Surface, tmp: Surface, dx: number, dy: number): void {
    if (!dx && !dy) return
    tmp.data.set(s.data)
    for (let y = 0; y < s.h; y++) {
        const sy = Math.min(s.h - 1, Math.max(0, y - dy))
        for (let x = 0; x < s.w; x++) {
            const sx = Math.min(s.w - 1, Math.max(0, x - dx))
            s.data[y * s.w + x] = tmp.data[sy * s.w + sx]!
        }
    }
}

/**
 * A projectile in flight. An arrow: a white head, a bone shaft and fletching in its owner's
 * accent, pointed along its velocity. A bolt: a white-hot core in its ramp (its particle trail
 * is spawned by `update`).
 */
function drawProj(s: Surface, p: Proj): void {
    const x = Math.round(p.x)
    const y = Math.round(p.y)
    if (p.kind !== 'bolt') {
        const sp = Math.hypot(p.vx, p.vy) || 1
        const ux = p.vx / sp
        const uy = p.vy / sp
        const len = p.kind === 'arrow' ? 7 : 5
        for (let i = 0; i < len; i++) {
            const c = i < 2 ? (i === 0 ? C.white : C.steel3) : i < len - 2 ? (p.kind === 'arrow' ? C.bone1 : C.brown3) : p.color
            s.set(Math.round(x - ux * i), Math.round(y - uy * i), c)
        }
        s.set(Math.round(x - ux * (len - 1) - uy), Math.round(y - uy * (len - 1) + ux), p.color)
        return
    }
    const r = RAMP[p.ramp]
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
            const d = dx * dx + dy * dy
            if (d <= 5) s.set(x + dx, y + dy, d <= 1 ? (d === 0 ? C.white : r[1]!) : d <= 2 ? r[2]! : r[3]!)
        }
    }
}

function drawNumber(s: Surface, n: Num): void {
    const u = n.t / (n.hold ? HOLD_LIFE : 0.9)
    // a held number pops up 3px and stays put in its stack; a loose one floats away
    const rise = n.hold ? Math.min(3, Math.round(n.t * 30)) : Math.round((1 - (1 - u) * (1 - u)) * 14)
    if (u > 0.75 && (Math.floor(n.t * 10) & 1)) return
    drawNumberAt(s, n.style, n.text, n.x + n.dx, n.y - rise, n.t)
}
