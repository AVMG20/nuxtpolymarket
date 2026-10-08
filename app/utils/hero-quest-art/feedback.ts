// Combat feedback (asset-list §2.3) and the gacha reveal (§4).
//
// Damage numbers: four styles (normal, crit, heal, miss), each an animated pop plus a glyph
// atlas the battle can typeset from. The party frame, cooldown sweep and enrage timer are
// pixel UI pieces. The gacha reveal is ONE flash drawn on a neutral ramp and recoloured per
// rarity by a palette map — the locked "one shared flash, recolored per rarity tier", not six
// cinematics.

import { C, CLEAR, shadeLut, type ColorName } from './palette'
import { Surface, blit, rect, px, line, disc, ring, tri, rampLut, hash2 } from './surface'
import { drawText, fontHeight, textOut, textRamp, textWidth, type FontName } from './font'
import { qt, pr, star, R } from './vfx-kit'
import { classNodeIcon, STATUS_ICONS  } from './icons-misc'

// ── Damage numbers ─────────────────────────────────────────────────────────────────

/**
 * One typeface for every number: the 3×5 font for hits, heals and misses, and its 5×7 cut
 * (`mid`, the same letterforms at about 1.5×, two-pixel stems) for crits and skill totals. A
 * straight 2× read far too big once the stage was scaled up, and a 1.5× stretch of the 3×5
 * would give uneven strokes. Each fills with a gradient cooling from a white-hot top (`ramp`,
 * top to bottom) inside an ink outline — the skill banner's treatment.
 */
export interface NumberStyle {
    id: 'normal' | 'crit' | 'heal' | 'miss' | 'void'
    label: string
    sample: string
    font: FontName
    scale: number
    ramp: readonly number[]
    /** Outline colour. */
    shadow: number
}

export const NUMBER_STYLES: readonly NumberStyle[] = [
    { id: 'normal', label: 'Normal hit', sample: '1.24K', font: 'small', scale: 1, ramp: [C.white, C.gold3, C.gold2, C.gold2, C.gold1], shadow: C.ink },
    { id: 'crit', label: 'Crit hit', sample: '8.61K!', font: 'mid', scale: 1, ramp: [C.white, C.red3, C.red3, C.red2, C.red2, C.red1], shadow: C.ink },
    { id: 'heal', label: 'Heal', sample: '+356', font: 'small', scale: 1, ramp: [C.white, C.green4, C.green3, C.green3, C.green2], shadow: C.ink },
    { id: 'miss', label: 'Miss / evasion', sample: 'MISS', font: 'small', scale: 1, ramp: [C.white, C.steel3, C.steel2, C.steel2, C.steel1], shadow: C.ink },
    // the Void Shards a prestige pays, rising over the Hero on the bridge
    { id: 'void', label: 'Void Shards gained', sample: '+800', font: 'mid', scale: 1, ramp: [C.white, C.pink, C.purple2, C.purple2, C.purple1], shadow: C.ink }
]

/** A number's first frames are solid white: the flash it lands with. */
export const NUMBER_FLASH: readonly number[] = [C.white]
/** Seconds a new number shows white, and a crit hops before it settles. */
export const NUMBER_FLASH_FOR = 0.05
export const CRIT_HOP_FOR = 0.1
/** How far a crit hops as it lands, in px. */
const CRIT_HOP = 2

/**
 * Draw one number `t` seconds after it spawned, centred on x with its top at y: white for its
 * first frames, and a crit landing with a hop before it settles.
 */
export function drawNumberAt(s: Surface, style: NumberStyle, text: string, x: number, y: number, t: number): void {
    const hop = style.id === 'crit' && t < CRIT_HOP_FOR ? CRIT_HOP : 0
    textRamp(s, text, x, y - hop, t < NUMBER_FLASH_FOR ? NUMBER_FLASH : style.ramp, style.font, style.scale, 1, style.shadow)
}

/** A number style's glyph height in px. */
export function numberHeight(style: NumberStyle): number {
    return fontHeight(style.font) * style.scale
}

/** The pop: lands, rises, then blinks out. (x, y) is the spawn point. */
export function drawNumberPop(s: Surface, style: NumberStyle, text: string, x: number, y: number, t: number): void {
    const u = qt(t) / 0.9
    if (u >= 1) return
    const rise = R((1 - (1 - u) * (1 - u)) * 14)
    if (u > 0.75 && (Math.floor(qt(t) * 10) & 1)) return
    const wobble = style.id === 'miss' ? R(Math.sin(u * 12) * 1) : 0
    drawNumberAt(s, style, text, x + wobble, y - rise - (numberHeight(style) - 5), qt(t))
}

/** Glyph atlas for a style: every character the battle prints, in one row. */
export const NUMBER_ATLAS_CHARS = '0123456789.KMBT+-!MISS'
export function drawNumberAtlas(s: Surface, style: NumberStyle): void {
    let x = 2
    for (const ch of '0123456789.KMBT+-!') {
        x += textRamp(s, ch, x, 3, style.ramp, style.font, style.scale, 0, style.shadow) + 3
    }
    // a miss only ever prints in the small cut
    if (style.font === 'small') textRamp(s, 'MISS', x, 3, style.ramp, style.font, style.scale, 0, style.shadow)
}
export function numberAtlasWidth(style: NumberStyle): number {
    let w = 4
    for (const ch of '0123456789.KMBT+-!') w += textWidth(ch, style.font, style.scale) + 3
    return w + (style.font === 'small' ? textWidth('MISS', style.font, style.scale) : 0) + 4
}

// ── Party frame + HP bar ───────────────────────────────────────────────────────────

export const PARTY_FRAME_W = 72
export const PARTY_FRAME_H = 22

/** What one party member's frame shows. */
export interface PartyMember {
    /** HP left, 0 → 1. */
    hp: number
    /** HP just lost, drawn on past `hp`: white while `flash`, then red as it drains. */
    lost: number
    flash: boolean
    /** Struck this moment: the portrait's rim flashes red. */
    hurt: boolean
    /** The Hero's frame is rimmed in gold, a Champion's in steel. */
    hero: boolean
    level: number
    /** Status ids (STATUS_ICONS), the first three shown as pips. */
    statuses: readonly string[]
    /** Draws the member's 18×18 head at (x, y). */
    portrait: (s: Surface, x: number, y: number) => void
}

/** The pips' 5×5 glyphs, drawn over a coloured disc; a status without one shows its disc alone. */
const PIP_GLYPHS: Readonly<Record<string, readonly string[]>> = {
    shield: ['XXXXX', 'XXXXX', 'XXXXX', '.XXX.', '..X..'],
    buff: ['..X..', '.XXX.', 'XXXXX', '..X..', '..X..'],
    weaken: ['..X..', '..X..', 'XXXXX', '.XXX.', '..X..'],
    burn: ['..X..', '.XX..', '.XXX.', 'XXXXX', '.XXX.'],
    regen: ['..X..', '..X..', 'XXXXX', '..X..', '..X..'],
    stun: ['X...X', '.X.X.', '..X..', '.X.X.', 'X...X']
}

/** A bar's fill rows, dark to light: its base, its body and the lit line along its top. */
type BarRamp = readonly [number, number, number]

/** Fill a 6-row bar at (x, y), `w` wide: lit along its top, shadowed along its base. */
function barFill(s: Surface, x: number, y: number, w: number, ramp: BarRamp): void {
    if (w <= 0) return
    rect(s, x, y, w, 6, ramp[1])
    rect(s, x, y, w, 1, ramp[2])
    rect(s, x, y + 4, w, 2, ramp[0])
    px(s, x + w - 1, y + 1, ramp[2])
}

const HP_GOOD: BarRamp = [C.green1, C.green2, C.green4]
const HP_MID: BarRamp = [C.gold1, C.gold2, C.gold3]
const HP_LOW: BarRamp = [C.red0, C.red1, C.red2]
const LOST_FLASH: BarRamp = [C.steel3, C.white, C.white]
const LOST_DRAIN: BarRamp = [C.red1, C.red2, C.red3]

/** A 72×22 party frame at (ox, oy): portrait, HP bar, status pips, level. */
export function drawPartyFrameAt(s: Surface, ox: number, oy: number, m: PartyMember): void {
    // the panel: bevelled, lit along its top edge
    rect(s, ox, oy, 72, 22, C.ink)
    rect(s, ox + 1, oy + 1, 70, 20, C.night2)
    rect(s, ox + 1, oy + 1, 70, 1, C.night3)
    rect(s, ox + 1, oy + 20, 70, 1, C.night0)
    // the portrait, rimmed gold for the Hero and steel for a Champion, red as a hit lands
    rect(s, ox + 2, oy + 2, 18, 18, C.night1)
    m.portrait(s, ox + 2, oy + 2)
    const lit = m.hurt ? C.red3 : m.hero ? C.gold3 : C.steel3
    const dark = m.hurt ? C.red1 : m.hero ? C.gold1 : C.steel1
    rect(s, ox + 1, oy + 1, 20, 1, lit); rect(s, ox + 1, oy + 1, 1, 20, lit)
    rect(s, ox + 1, oy + 20, 20, 1, dark); rect(s, ox + 20, oy + 1, 1, 20, dark)
    // HP, and the stretch just lost after it
    const W = 46
    rect(s, ox + 23, oy + 3, W + 2, 8, C.ink)
    rect(s, ox + 24, oy + 4, W, 6, C.night0)
    rect(s, ox + 24, oy + 4, W, 1, C.night1)
    const hp = Math.max(0, Math.min(1, m.hp))
    barFill(s, ox + 24, oy + 4, R(W * Math.min(1, hp + m.lost)), m.flash ? LOST_FLASH : LOST_DRAIN)
    barFill(s, ox + 24, oy + 4, R(W * hp), hp > 0.5 ? HP_GOOD : hp > 0.2 ? HP_MID : HP_LOW)
    for (let i = 1; i < 5; i++) rect(s, ox + 24 + R(W * i / 5), oy + 5, 1, 4, C.night0) // segment ticks
    // status pips: a disc per status, its glyph on it
    for (let i = 0; i < Math.min(3, m.statuses.length); i++) {
        const id = m.statuses[i]!
        const hostile = STATUS_ICONS.find(x => x.id === id)?.hostile ?? false
        const cx = ox + 27 + i * 8
        const cy = oy + 16
        disc(s, cx, cy, 4, C.ink)
        disc(s, cx, cy, 3, hostile ? C.red0 : C.teal0)
        const g = PIP_GLYPHS[id]
        if (!g) continue
        for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
            if (g[y]![x] === 'X') px(s, cx - 2 + x, cy - 2 + y, y < 2 ? (hostile ? C.gold3 : C.white) : (hostile ? C.orange : C.teal3))
        }
    }
    const w = textOut(s, String(m.level), ox + 70, oy + 13, C.bone1, 'small', 1, 2, 1, C.ink, -1)
    textOut(s, 'LV', ox + 68 - w, oy + 13, C.gold2, 'small', 1, 2, 1, C.ink, -1)
}

const PORTRAIT = new Surface(24, 24, 0, 0)

/** The gallery's portrait: the Knight's class icon, cropped to the frame. */
function knightPortrait(s: Surface, x: number, y: number): void {
    PORTRAIT.clear()
    classNodeIcon(PORTRAIT, 'class_knight', 'warrior', 2)
    for (let py = 0; py < 18; py++) for (let px_ = 0; px_ < 18; px_++) { const c = PORTRAIT.get(px_ + 3, py + 3); if (c) s.set(x + px_, y + py, c) }
}

/** The gallery's frame: the Hero taking a hit, HP draining from → to over the clip, the lost stretch flashing then draining. */
export function drawPartyFrame(s: Surface, t: number, hpFrom = 0.9, hpTo = 0.35, hero = true): void {
    const q = qt(t)
    const hp = hpFrom + (hpTo - hpFrom) * pr(t, 0.2, 0.5)
    const lag = hpFrom + (hpTo - hpFrom) * pr(t, 0.5, 0.9)
    drawPartyFrameAt(s, 0, 0, {
        hp, lost: lag - hp, flash: q < 0.45, hurt: q >= 0.2 && q < 0.4, hero, level: hero ? 42 : 38,
        statuses: hero ? ['shield', 'buff', 'burn'] : ['regen', 'weaken'], portrait: knightPortrait
    })
}

// ── Cooldown radial ────────────────────────────────────────────────────────────────

/** How the icon still cooling down is dimmed: darkened toward the night. */
const COOLDOWN_DIM = shadeLut(0.55, 'night0', 0.15)
/** The icon frame's border, left undimmed so the tile keeps its edge. */
const COOLDOWN_INSET = 2

/**
 * A 24×24 overlay on the skill icon already drawn in `s`: the part still cooling down dimmed, a
 * wedge clearing clockwise from the top behind a gold edge, the seconds left in its middle.
 * `u` is 0 → 1 across the cooldown; past 1 it is ready, and a glint crosses the icon by 4/3.
 */
export function drawCooldown(s: Surface, u: number, secs = 3): void {
    if (u < 1) {
        for (let y = COOLDOWN_INSET; y < 24 - COOLDOWN_INSET; y++) for (let x = COOLDOWN_INSET; x < 24 - COOLDOWN_INSET; x++) {
            let a = Math.atan2(x - 11.5, 11.5 - y) / (Math.PI * 2)
            if (a < 0) a += 1
            if (a >= u) s.set(x, y, COOLDOWN_DIM[s.get(x, y)] || C.night0)
        }
        // the sweep's edge, from the middle out to the frame's border, a spark where it meets it
        const a = u * Math.PI * 2
        const dx = Math.sin(a)
        const dy = -Math.cos(a)
        const len = (11.5 - COOLDOWN_INSET) / Math.max(Math.abs(dx), Math.abs(dy))
        line(s, 12, 12, 12 + dx * len, 12 + dy * len, C.gold3)
        px(s, 12 + dx * len, 12 + dy * len, C.white)
        drawText(s, String(Math.ceil((1 - u) * secs)), 12, 9, C.white, { align: 1, shadow: 2 })
        return
    }
    // ready: a bright rim, and a glint crossing it corner to corner
    const g = Math.min(1, (u - 1) * 3)
    rect(s, 0, 0, 24, 1, C.gold3); rect(s, 0, 23, 24, 1, C.gold1); rect(s, 0, 0, 1, 24, C.gold3); rect(s, 23, 0, 1, 24, C.gold1)
    px(s, 0, 0, C.white)
    const k = -8 + g * 40
    for (let i = 0; i < 24; i++) {
        const x = R(k - i)
        if (x >= 1 && x < 23 && i >= 1 && i < 23) { px(s, x, i, C.white); if (x + 1 < 23) px(s, x + 1, i, C.gold3) }
    }
    if (g < 0.5) star(s, 20, 3, 2, C.white)
}

// ── Boss enrage timer ──────────────────────────────────────────────────────────────

/** The skull the timer runs down to: # its outline, o bone, s bone in shadow, e its eyes. */
const SKULL = [
    '..#####..',
    '.#ooooo#.',
    '#oooooos#',
    '#oeeoees#',
    '#oeeoees#',
    '#ooo#oss#',
    '.#oooss#.',
    '..#o#o#..',
    '...###...'
] as const

/** An 88×14 timer bar: hourglass, draining bar, skull. `u` 0 → 1 is time spent; 1 = enraged. */
export function drawEnrageTimer(s: Surface, u: number, t: number): void {
    const low = u > 0.75
    const enraged = u >= 1
    const pulse = Math.floor(qt(t) * 6) & 1
    // the panel: bevelled, its edge burning red once enraged
    rect(s, 0, 0, 88, 14, enraged && pulse ? C.red2 : C.ink)
    rect(s, 1, 1, 86, 12, enraged ? C.red0 : C.night2)
    rect(s, 1, 1, 86, 1, enraged ? C.red1 : C.night3)
    rect(s, 1, 12, 86, 1, C.night0)
    // the hourglass: gold caps and posts, glass, the sand running from the top bulb to the bottom
    const sand = Math.min(1, u)
    rect(s, 2, 2, 9, 2, C.gold1); rect(s, 2, 2, 9, 1, C.gold3)
    rect(s, 2, 10, 9, 2, C.gold1); rect(s, 2, 10, 9, 1, C.gold2)
    rect(s, 3, 4, 1, 6, C.gold0); rect(s, 9, 4, 1, 6, C.gold0)
    tri(s, 4, 4, 8, 4, 6, 7, C.frost); tri(s, 4, 9, 8, 9, 6, 7, C.frost)
    if (sand < 1) tri(s, 5, 4 + R(sand * 2), 7, 4 + R(sand * 2), 6, 7, C.gold2)
    rect(s, 5, 9 - R(sand * 2), 3, R(sand * 2) + 1, C.gold2)
    if (!enraged) px(s, 6, 8, pulse ? C.gold3 : C.gold2)
    // the bar: a trough, the time left lit along its top, its leading edge bright
    rect(s, 13, 3, 60, 8, C.ink)
    rect(s, 14, 4, 58, 6, C.night0)
    const left = enraged ? 58 : R(58 * (1 - sand))
    barFill(s, 14, 4, left, enraged ? [C.red1, C.red2, pulse ? C.orange : C.red3] : low ? (pulse ? [C.red1, C.red2, C.red3] : [C.lava0, C.orange, C.gold3]) : [C.gold1, C.gold2, C.gold3])
    if (!enraged && left > 0) rect(s, 13 + left, 4, 1, 6, C.white)
    for (let i = 1; i < 4; i++) rect(s, 14 + R(58 * i / 4), 5, 1, 4, C.night0)
    // the skull at its end: bone, its eyes kindling as the time runs out, red and blazing when enraged
    const bone = enraged ? [C.red3, C.red2] : [C.bone1, C.bone0]
    const eye = enraged ? (pulse ? C.gold3 : C.orange) : low ? (pulse ? C.lava1 : C.red1) : C.ink
    for (let y = 0; y < SKULL.length; y++) for (let x = 0; x < 9; x++) {
        const ch = SKULL[y]![x]
        if (ch === '.') continue
        px(s, 76 + x, 3 + y, ch === '#' ? C.ink : ch === 'o' ? bone[0]! : ch === 's' ? bone[1]! : eye)
    }
    if (enraged) for (let i = 0; i < 5; i++) px(s, 77 + i * 2, 2 - ((i + pulse) & 1), i & 1 ? C.gold3 : C.orange)
}

// ── Stage progress ─────────────────────────────────────────────────────────────────

/** Crossed swords, a wave stage's mark: l a blade's lit edge, b its body, g a guard, h a grip. */
const SWORDS = [
    'l.......l',
    '.lb...bl.',
    '..lb.bl..',
    '...lbl...',
    '....b....',
    '..gb.bg..',
    '.g.h.h.g.',
    '..h...h..',
    '.h.....h.'
] as const

const PROGRESS: BarRamp = [C.teal1, C.teal2, C.cyan]

/**
 * An 88×14 stage progress bar, the enrage timer's twin on wave stages: crossed swords, a bar
 * filling as the kills land, the count. Red when the party is walled and wipes before it fills.
 */
export function drawStageProgress(s: Surface, kills: number, required: number, walled: boolean): void {
    const u = required > 0 ? Math.min(1, Math.max(0, kills / required)) : 0
    // the panel, bevelled as the timer's is
    rect(s, 0, 0, 88, 14, C.ink)
    rect(s, 1, 1, 86, 12, C.night2)
    rect(s, 1, 1, 86, 1, C.night3)
    rect(s, 1, 12, 86, 1, C.night0)
    for (let y = 0; y < SWORDS.length; y++) for (let x = 0; x < 9; x++) {
        const ch = SWORDS[y]![x]
        if (ch === '.') continue
        px(s, 2 + x, 3 + y, ch === 'l' ? C.white : ch === 'b' ? C.steel2 : ch === 'g' ? C.gold2 : C.brown2)
    }
    // the bar: a trough, filled as far as the stage has got, its leading edge bright
    rect(s, 13, 3, 48, 8, C.ink)
    rect(s, 14, 4, 46, 6, C.night0)
    const filled = R(46 * u)
    barFill(s, 14, 4, filled, walled ? HP_LOW : PROGRESS)
    if (filled > 0 && filled < 46) rect(s, 13 + filled, 4, 1, 6, C.white)
    for (let i = 1; i < 4; i++) rect(s, 14 + R(46 * i / 4), 5, 1, 4, C.night0)
    // the count, right-aligned in what is left of the panel
    textOut(s, `${Math.floor(Math.max(0, kills))}/${required}`, 85, 5, walled ? C.red3 : C.bone1, 'small', 1, 2, 0, C.ink, -1)
}

// ── Profile badge ──────────────────────────────────────────────────────────────────

/** The badge, top left of the stage: a 22 px round portrait, with the GPN bar and the level and stage bar to its right. */
export const BADGE_W = 86
export const BADGE_H = 22
const BADGE_PORTRAIT = 22
/** Where the bars start, tucked under the portrait's right half, and where their text starts, clear of it. */
const BAR_X = 14
const TEXT_X = 25
/** The top bar's rows and the bottom bar's, sharing the ink line between them. */
const TOP_H = 13
const LOW_Y = 12
const LOW_H = 10
/** Seconds the glint takes to cross the GPN bar on a gain, and the change chip stays up. */
export const BADGE_GLINT_FOR = 0.55
export const BADGE_CHIP_FOR = 1.8
/** Seconds a new level shows lit. */
export const BADGE_LEVEL_FOR = 0.8
const BOLT = ['...11', '..11.', '.111.', '11111', '.111.', '.11..', '11...'] as const
const GPN_RAMP = [C.white, C.gold3, C.gold2, C.gold2, C.gold1, C.gold1, C.gold0] as const
const GPN_LIT = [C.white, C.white, C.gold3, C.gold3, C.gold2, C.gold2, C.gold1] as const
const CHIP_UP = [C.white, C.green4, C.green3, C.green3, C.green2] as const
const CHIP_DOWN = [C.white, C.red3, C.red3, C.red2, C.red1] as const

/** The badge's portrait, baked once per class: `head` (a `headOf` crop) in a gold ring lit from the top left. */
export function badgePortrait(head: Surface): Surface {
    const s = new Surface(BADGE_PORTRAIT, BADGE_PORTRAIT, 0, 0)
    const c = BADGE_PORTRAIT / 2
    const ho = (BADGE_PORTRAIT - head.w) >> 1
    for (let y = 0; y < BADGE_PORTRAIT; y++) {
        for (let x = 0; x < BADGE_PORTRAIT; x++) {
            const dx = x + 0.5 - c
            const dy = y + 0.5 - c
            const d = Math.hypot(dx, dy)
            if (d > 11) continue
            if (d > 10 || (d > 7.5 && d <= 8.5)) { s.set(x, y, C.ink); continue }
            if (d > 8.5) {
                const lit = -(dx + dy) / d
                s.set(x, y, lit > 0.5 ? C.gold3 : lit > -0.4 ? C.gold2 : C.gold1)
                continue
            }
            const h = head.get(x - ho, y - ho)
            s.set(x, y, h !== CLEAR ? h : y < c - 2 ? C.night2 : C.night1)
        }
    }
    return s
}

/** One bar's frame: ink round it, its fill lit along its top and shadowed along its base. */
function badgeBar(s: Surface, x: number, y: number, w: number, h: number, fill: readonly [number, number, number], edge: number): void {
    rect(s, x, y, w, h, C.ink)
    rect(s, x + 1, y + 1, w - 2, h - 2, fill[1])
    rect(s, x + 1, y + 1, w - 2, 1, fill[2])
    rect(s, x + 1, y + h - 2, w - 2, 1, fill[0])
    rect(s, x + w - 2, y + 1, 1, h - 2, edge)
}

export interface BadgeView {
    portrait: Surface
    /** The GPN as the stage prints numbers (`stageNumber`). */
    gpn: string
    /** Shown as a pip on the portrait's ring. */
    level: number
    /** `P1-W3-S7`, prestige counted from 1, on the bar under the GPN. */
    stage: string
    /** Seconds since the GPN last rose (glint) and since it last changed (chip), −1 for never. */
    sinceGain: number
    sinceChange: number
    /** `+12%` or `×3.2` for a rise, `-4%` for a fall. */
    chip: string
    up: boolean
    /** Seconds since the level went up, −1 for never. */
    sinceLevel: number
}

/**
 * The profile badge at (ox, oy): the Hero's portrait, the GPN big and gold on the bar beside it,
 * where the run stands under that, and the level on a pip under the face. A rise sends a glint
 * across the GPN bar and a chip naming the change up from under the badge; a level up lights the pip.
 */
export function drawProfileBadge(s: Surface, ox: number, oy: number, v: BadgeView): void {
    const w = BADGE_W - BAR_X
    const glint = v.sinceGain >= 0 && v.sinceGain < BADGE_GLINT_FOR
    const levelLit = v.sinceLevel >= 0 && v.sinceLevel < BADGE_LEVEL_FOR
    // the level and stage bar first, so the GPN bar's base line sits over the seam
    badgeBar(s, ox + BAR_X, oy + LOW_Y, w - 4, LOW_H, [C.purple0, C.purple1, C.purple2], C.purple0)
    badgeBar(s, ox + BAR_X, oy, w, TOP_H, [C.ink, C.night0, C.night1], C.night0)
    if (glint) {
        // the frame flares gold, and a slanted band of light crosses the bar left to right
        if (v.sinceGain < BADGE_GLINT_FOR / 2) {
            rect(s, ox + BAR_X, oy, w, 1, C.gold2)
            rect(s, ox + BADGE_W - 1, oy, 1, TOP_H, C.gold1)
        }
        const head = R(ox + BAR_X - 8 + (w + 16) * (v.sinceGain / BADGE_GLINT_FOR))
        for (let y = 1; y < TOP_H - 1; y++) {
            for (let k = 0; k < 5; k++) {
                const x = head + k - y
                if (x > ox + BAR_X && x < ox + BADGE_W - 1) px(s, x, oy + y, k === 2 ? C.steel3 : k === 1 || k === 3 ? C.night3 : C.night2)
            }
        }
    }
    const lit = glint && v.sinceGain < BADGE_GLINT_FOR / 2
    for (let y = 0; y < BOLT.length; y++) {
        for (let x = 0; x < 5; x++) if (BOLT[y]![x] === '1') px(s, ox + TEXT_X + x, oy + 3 + y, lit ? C.white : y < 3 ? C.gold3 : C.gold2)
    }
    textRamp(s, v.gpn, ox + TEXT_X + 8, oy + 3, lit ? GPN_LIT : GPN_RAMP, 'mid', 1, 0, C.ink)
    textOut(s, v.stage, ox + TEXT_X, oy + LOW_Y + 2, C.bone1, 'small', 1, 0, 1, C.ink, -1)
    blit(s, v.portrait, ox, oy)
    // the level pip, gold on the ring under the face, lit for a moment on a new level
    const label = String(v.level)
    const pw = textWidth(label, 'small') + 4
    const px0 = ox + ((BADGE_PORTRAIT - pw) >> 1)
    rect(s, px0, oy + BADGE_H - 6, pw, 8, C.ink)
    rect(s, px0 + 1, oy + BADGE_H - 5, pw - 2, 6, levelLit ? C.gold2 : C.gold1)
    rect(s, px0 + 1, oy + BADGE_H - 5, pw - 2, 1, levelLit ? C.white : C.gold2)
    textOut(s, label, px0 + 2, oy + BADGE_H - 4, C.white, 'small', 1, 0, 0, C.ink, -1)
    if (v.chip && v.sinceChange >= 0 && v.sinceChange < BADGE_CHIP_FOR) {
        // the chip rises a few px under the badge and blinks out over its last third
        const k = v.sinceChange / BADGE_CHIP_FOR
        if (k < 2 / 3 || (Math.floor(qt(v.sinceChange) * 12) & 1) === 0) {
            textRamp(s, v.chip, ox + TEXT_X, oy + BADGE_H + 5 - R(4 * Math.min(1, k * 3)), v.up ? CHIP_UP : CHIP_DOWN, 'small', 1, 0, C.ink)
        }
    }
}

// ── Boss challenge ─────────────────────────────────────────────────────────────────

export const CHALLENGE_W = 16
export const CHALLENGE_H = 16

/**
 * A 16×16 red button with the enrage timer's skull on it: how a boss lost to a timeout or a wipe
 * is fought again, since it no longer engages on its own. Lit on hover, sunk a pixel when pressed.
 */
export function drawChallengeButton(s: Surface, ox: number, oy: number, state: 'idle' | 'hover' | 'pressed', t: number): void {
    const down = state === 'pressed' ? 1 : 0
    const lit = state === 'hover'
    const pulse = Math.floor(qt(t) * 3) & 1
    rect(s, ox, oy, CHALLENGE_W, CHALLENGE_H, C.ink)
    // its face, and the lip it sits on until pressed down onto it
    rect(s, ox + 1, oy + 1 + down, CHALLENGE_W - 2, CHALLENGE_H - 2 - down, lit ? C.red2 : C.red1)
    rect(s, ox + 1, oy + 1 + down, CHALLENGE_W - 2, 1, lit ? C.red3 : C.red2)
    if (!down) rect(s, ox + 1, oy + CHALLENGE_H - 3, CHALLENGE_W - 2, 2, C.red0)
    const sx = ox + ((CHALLENGE_W - 9) >> 1)
    const sy = oy + 3 + down
    const eye = pulse ? C.gold3 : C.orange
    for (let y = 0; y < SKULL.length; y++) for (let x = 0; x < 9; x++) {
        const ch = SKULL[y]![x]
        if (ch === '.') continue
        px(s, sx + x, sy + y, ch === '#' ? C.ink : ch === 'o' ? C.bone1 : ch === 's' ? C.bone0 : eye)
    }
}

// ── Gacha reveal ───────────────────────────────────────────────────────────────────

/** The neutral ramp the base flash is drawn in (light → dark). */
const BASE = [C.white, C.steel3, C.steel2, C.steel1, C.steel0] as const
const REVEAL_RAMP: Readonly<Record<string, readonly number[]>> = {
    common: BASE,
    uncommon: [C.white, C.green4, C.green3, C.green2, C.green1],
    rare: [C.white, C.cyan, C.blue2, C.blue1, C.blue0],
    epic: [C.white, C.pink, C.purple2, C.purple1, C.purple0],
    legendary: [C.white, C.gold3, C.gold2, C.gold1, C.gold0],
    mythic: [C.white, C.red3, C.red2, C.red1, C.red0]
}

/** Palette maps from the base flash onto each rarity. */
export const REVEAL_LUT: Readonly<Record<string, Uint8Array>> = Object.fromEntries(
    Object.entries(REVEAL_RAMP).map(([r, ramp]) => [r, rampLut([[Uint8Array.from(BASE), Uint8Array.from(ramp)]])])
)

export const REVEAL_SIZE = 72

/**
 * The shared reveal flash, 72×72, 1.4 s: a charge-up glint, the burst, rays turning, a ring,
 * sparkles settling. Draws only BASE colours so a LUT can recolour it losslessly.
 */
export function drawRevealBase(s: Surface, t: number): void {
    const x = 36
    const y = 36
    const q = qt(t)
    if (q < 0.3) {
        // charge: a point of light gathering motes
        const r = 3 + R(pr(t, 0, 0.3) * 3)
        disc(s, x, y, r, BASE[2]); disc(s, x, y, r - 1, BASE[1]); px(s, x, y, BASE[0])
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + q * 4; const d = 26 - pr(t, 0, 0.3) * 20; px(s, R(x + Math.cos(a) * d), R(y + Math.sin(a) * d), BASE[1]) }
        return
    }
    const u = pr(t, 0.3, 1.4)
    // rays
    const n = 12
    for (let i = 0; i < n; i++) {
        const a = i * (Math.PI * 2 / n) + q * 0.8
        const len = 18 + (i & 1 ? 8 : 14) * (1 - u * 0.5)
        const w = i & 1 ? 1 : 2
        for (let k = 6; k < len; k++) {
            const c = k < 12 ? BASE[1] : k < 20 ? BASE[2] : BASE[3]
            for (let j = -w + 1; j < w; j++) px(s, R(x + Math.cos(a) * k - Math.sin(a) * j), R(y + Math.sin(a) * k + Math.cos(a) * j), c)
        }
    }
    // burst core
    const core = R(10 * (1 - pr(t, 0.3, 0.7)) + 5)
    disc(s, x, y, core + 2, BASE[2]); disc(s, x, y, core, BASE[1]); disc(s, x, y, core - 2, BASE[0])
    // ring
    const rr = 8 + eoLocal(pr(t, 0.3, 0.8)) * 26
    if (q < 0.9) { ring(s, x, y, rr, BASE[1]); ring(s, x, y, rr - 1, BASE[2]) }
    // sparkles drifting down
    for (let i = 0; i < 10; i++) {
        const sx = R(x + (hash2(9, i) - 0.5) * 60)
        const sy = R(y - 28 + (hash2(10, i) * 30) + u * 20)
        if (((i + Math.floor(q * 10)) % 3) === 0) continue
        px(s, sx, sy, BASE[0]); px(s, sx - 1, sy, BASE[2]); px(s, sx + 1, sy, BASE[2]); px(s, sx, sy - 1, BASE[2]); px(s, sx, sy + 1, BASE[2])
    }
}

function eoLocal(u: number): number { return 1 - (1 - u) * (1 - u) }

/** One loop of the aura, in seconds: the rays turn one ray's gap and the twinkles a quarter turn in it. */
export const REVEAL_AURA_LOOP = 1.6

/**
 * The glow a revealed card keeps behind it, on the flash's 72×72 canvas and in its BASE colours,
 * so the same LUT gives it the card's rarity. Smaller than the flash (it clears a neighbour 32 px
 * away) and seamless over `REVEAL_AURA_LOOP`, so it can play for as long as the card is up.
 */
export function drawRevealAura(s: Surface, t: number): void {
    const x = 36
    const y = 36
    const u = (t % REVEAL_AURA_LOOP) / REVEAL_AURA_LOOP
    // rays, long and short in turn, stepping round one gap a loop
    const n = 12
    for (let i = 0; i < n; i++) {
        const a = (i + u) * (Math.PI * 2 / n)
        const len = i & 1 ? 17 : 21
        for (let k = 13; k < len; k++) px(s, R(x + Math.cos(a) * k), R(y + Math.sin(a) * k), k < 17 ? BASE[2] : BASE[3])
    }
    // a halo that breathes twice a loop
    const breath = Math.sin(u * Math.PI * 4) > 0 ? 1 : 0
    ring(s, x, y, 14 + breath, BASE[2])
    ring(s, x, y, 13 + breath, BASE[1])
    // four twinkles orbiting the other way, each lit for half its turn
    for (let i = 0; i < 4; i++) {
        const a = (i / 4 - u / 4) * Math.PI * 2
        const sx = R(x + Math.cos(a) * 19)
        const sy = R(y + Math.sin(a) * 19)
        if ((Math.floor(u * 8) + i) % 2) continue
        px(s, sx, sy, BASE[0]); px(s, sx - 1, sy, BASE[2]); px(s, sx + 1, sy, BASE[2]); px(s, sx, sy - 1, BASE[2]); px(s, sx, sy + 1, BASE[2])
    }
}

export type { ColorName }
