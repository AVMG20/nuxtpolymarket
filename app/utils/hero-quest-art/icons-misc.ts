// Frames & badges (asset-list §3.3) and the status-effect icon set (§2.3).
//
//   6 rarity frames      Common grey → Mythic red, shared by all four gachas
//   9 trait-grade frames F → SSS on Traits' own ramp (TRAIT_GRADE_COLORS), not the rarity one
//   4 archetype badges   Damage / Tank / Support / Control
//  16 class-node icons   the Hero's bust in each class's outfit — distinct from its skill icon
//  15 status icons       the ten the list names plus taunt, reflect, redirect, regen and the
//                        generic stat debuff, which covers every StatusKind in status.ts

import { C, RARITY_COLORS, TRAIT_GRADES, TRAIT_GRADE_COLORS, type TraitGrade } from './palette'
import { Surface } from './surface'
import { drawText } from './font'
import { Actor } from './rig'
import { HERO_ART } from './heroes'
import { M, shield, ShieldStyle, type Mat } from './weapons'
import { type Glyph, glyph, rect, px, line, disc, ring, tri, ellipse, dither, ditherDisc, poly } from './icon-kit'
import { ABILITY_ICON_PARTS as P } from './icons-abilities'

// ── Rarity frames (32×32, hollow) ──────────────────────────────────────────────────

export const FRAME = 32

export function rarityFrame(s: Surface, rarity: string, t = 0): void {
    const tier = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'].indexOf(rarity)
    const m = RARITY_COLORS[rarity]!
    const W = FRAME
    rect(s, 0, 0, W, 2 + (tier >= 3 ? 1 : 0), C.ink); rect(s, 0, W - 3, W, 3, C.ink)
    rect(s, 0, 0, 3, W, C.ink); rect(s, W - 3, 0, 3, W, C.ink)
    rect(s, 1, 1, W - 2, 1, m[2]); rect(s, 1, W - 2, W - 2, 1, m[0])
    rect(s, 1, 1, 1, W - 2, m[1]); rect(s, W - 2, 1, 1, W - 2, m[0])
    rect(s, 2, 2, W - 4, 1, m[1]); rect(s, 2, 2, 1, W - 4, m[1])
    // corners grow with the tier
    for (const [cx, cy] of [[2, 2], [W - 3, 2], [2, W - 3], [W - 3, W - 3]] as const) {
        if (tier >= 1) { rect(s, cx - 1, cy - 1, 3, 3, m[1]); px(s, cx, cy, m[2]) }
        if (tier >= 2) { disc(s, cx, cy, 2, m[1]); px(s, cx, cy, C.white) }
        if (tier >= 3) { line(s, cx, cy, cx + (cx < 16 ? 6 : -6), cy, m[2]); line(s, cx, cy, cx, cy + (cy < 16 ? 6 : -6), m[2]) }
    }
    if (tier >= 4) {
        // wings over the top corners
        for (const d of [-1, 1]) {
            const cx = d < 0 ? 3 : W - 4
            for (let i = 0; i < 4; i++) line(s, cx, 3, cx - d * (4 + i), -1 + i * 2, i === 0 ? C.white : m[2])
        }
    }
    if (tier >= 5) {
        // a crown on the top edge and flames licking up the sides
        for (let i = 0; i < 3; i++) tri(s, 12 + i * 4, 1, 14 + i * 4, 1, 13 + i * 4, -3 + (i === 1 ? -1 : 0), C.gold2)
        rect(s, 12, 0, 9, 2, C.gold1)
        const f = Math.floor(t * 8) & 1
        for (let i = 0; i < 4; i++) { px(s, 0, 8 + i * 5 + f, C.orange); px(s, W - 1, 10 + i * 5 - f, C.orange) }
    }
}

// ── Trait-grade frames (24×24 with a grade badge) ──────────────────────────────────

export function traitFrame(s: Surface, grade: TraitGrade): void {
    const m = TRAIT_GRADE_COLORS[grade]
    const tier = TRAIT_GRADES.indexOf(grade)
    rect(s, 0, 0, 24, 24, C.ink)
    rect(s, 1, 1, 22, 22, m[0])
    rect(s, 2, 2, 20, 20, C.night0)
    dither(s, 2, 2, 20, 20, m[0], 3)
    rect(s, 1, 1, 22, 1, m[2]); rect(s, 1, 1, 1, 22, m[1])
    if (tier >= 6) { for (const [x, y] of [[1, 1], [22, 1], [1, 22]] as const) { disc(s, x, y, 2, m[2]); px(s, x, y, C.white) } }
    // grade badge, bottom-right
    const text = grade
    const w = text.length * 4 + 3
    rect(s, 23 - w, 15, w + 1, 9, C.ink)
    rect(s, 24 - w, 16, w - 1, 7, m[1])
    drawText(s, text, 24 - w + 2, 17, tier >= 8 ? C.ink : C.white, { shadow: 0 })
}

// ── Archetype badges (16×16) ───────────────────────────────────────────────────────

/** Paint a pixel map centred on (x, y); '.' is left empty. */
function pixelMap(g: Surface, x: number, y: number, rows: readonly string[], key: Readonly<Record<string, number>>): void {
    const x0 = x - (rows[0]!.length >> 1)
    const y0 = y - (rows.length >> 1)
    rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') px(g, x0 + i, y0 + j, key[row[i]!]!) })
}

/** A broadsword point up: a blade lit down its left edge, a gold crossguard and pommel, a leather grip. */
const BROADSWORD = [
    '...w...',
    '..wsd..',
    '..wsd..',
    '..wsd..',
    '..wsd..',
    '..wsd..',
    'GGGGGgg',
    '...b...',
    '...G...'
] as const

/** A heater shield, lit down its left half, bordered in gold and charged with a gold cross. */
const HEATER = [
    'GGGgggg',
    'GwsYdtg',
    'GYYYYyg',
    'GssYdtg',
    'GssYdtg',
    '.GsYtg.',
    '..GYg..',
    '...g...'
] as const

/** An eye of the arcane: an almond of white round a pink-lit iris and a slit pupil. */
const ARCANE_EYE = [
    '..wwwww..',
    '.wwqkpwb.',
    'wwwqkpwwb',
    '.bwqkpwb.',
    '..bbbbb..'
] as const

const BADGE_KEY: Readonly<Record<string, number>> = {
    w: C.white, s: C.steel3, t: C.steel1, d: C.steel2, g: C.gold1, G: C.gold3, Y: C.gold3, y: C.gold2, b: C.bone1,
    p: C.purple2, q: C.pink, k: C.ink
}
/** The sword's grip, which shares `b` with the eye's shaded white. */
const SWORD_KEY: Readonly<Record<string, number>> = { ...BADGE_KEY, b: C.brown1 }

/** A plus with a bevel: lit where its top or left edge is open, shaded where its bottom or right is. */
function bevelledCross(g: Surface, x: number, y: number): void {
    const inCross = (i: number, j: number) => (Math.abs(i) <= 1 && Math.abs(j) <= 4) || (Math.abs(j) <= 1 && Math.abs(i) <= 4)
    for (let j = -4; j <= 4; j++) {
        for (let i = -4; i <= 4; i++) {
            if (!inCross(i, j)) continue
            const shade = !inCross(i + 1, j) || !inCross(i, j + 1)
            px(g, x + i, y + j, shade ? C.green3 : C.white)
        }
    }
    px(g, x, y, C.gold3)
}

/** The symbol on each archetype's badge; `archetypeBadge` sets it in its medallion. */
export const ARCHETYPE_BADGES: Readonly<Record<string, Glyph>> = {
    damage: (g, x, y) => pixelMap(g, x, y, BROADSWORD, SWORD_KEY),
    tank: (g, x, y) => pixelMap(g, x, y, HEATER, BADGE_KEY),
    support: (g, x, y) => bevelledCross(g, x, y),
    control: (g, x, y) => pixelMap(g, x, y, ARCANE_EYE, BADGE_KEY)
}

/** Each archetype's field, dark → light. */
const ARCHETYPE_FIELD: Readonly<Record<string, Mat>> = {
    damage: [C.red0, C.red1, C.red2],
    tank: [C.blue0, C.blue1, C.blue2],
    support: [C.green0, C.green1, C.green2],
    control: [C.purple0, C.purple1, C.purple2]
}

/**
 * An archetype badge, 16×16: a medallion in the archetype's colour, its gold rim and its field lit
 * from the upper left, with the archetype's symbol outlined on it.
 */
export function archetypeBadge(s: Surface, id: string): void {
    const m = ARCHETYPE_FIELD[id]!
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const dx = x - 8
            const dy = y - 8
            const d = Math.hypot(dx, dy)
            if (d > 7.4) continue
            // toward the light (upper left) +1, away from it −1
            const light = d > 0 ? -(dx + dy) / (d * Math.SQRT2) : 0
            let c: number
            if (d > 6.5) c = C.ink
            else if (d > 5.4) c = light > 0.99 ? C.white : light > 0.3 ? C.gold3 : light > -0.4 ? C.gold2 : C.gold1
            // the field bevelled: a lit arc under the rim at the upper left, a shadowed one at the lower right
            else if (d > 4.4 && light < -0.2) c = m[0]
            else if (d > 4.4 && light > 0.3) c = m[2]
            else c = m[1]
            px(s, x, y, c)
        }
    }
    if (id === 'support') ditherDisc(s, 8, 8, 5, C.green2, 6) // the glow the cross gives off
    glyph(s, ARCHETYPE_BADGES[id]!, 8, 8, true)
}

// ── Class-node icons: the Hero's bust per class ────────────────────────────────────

const BUST = new Surface(64, 64, 32, 58)
const BUST_ACTOR = new Actor(64)
/**
 * The centre of the chibi head on the bust (hair to chin, rows 35–45; columns 26–39), which the
 * crop puts on the medallion's centre. Headgear rises above it and is trimmed by the rim.
 */
const HEAD_X = 32
const HEAD_Y = 40

const LINE_BG: Readonly<Record<string, Mat>> = {
    beginner: [C.gold0, C.gold1, C.gold2],
    warrior: [C.red0, C.red1, C.red2],
    mage: [C.blue0, C.blue1, C.blue2],
    archer: [C.green0, C.green1, C.green2]
}

export function classNodeIcon(s: Surface, classId: string, line: 'beginner' | 'warrior' | 'mage' | 'archer', tier: number): void {
    const art = HERO_ART[classId]!
    const m = LINE_BG[line]!
    // tier shown as the ring: base plain, elite doubled, master gilded
    disc(s, 12, 12, 11, C.ink)
    disc(s, 12, 12, 10, tier >= 3 ? C.gold2 : m[1])
    disc(s, 12, 12, tier >= 2 ? 8 : 9, m[0])
    if (tier >= 2) ring(s, 12, 12, 9, m[2])
    ditherDisc(s, 12, 11, 6, m[1], 5)
    BUST.clear()
    BUST_ACTOR.draw(BUST, 32, 58, art.look, art.clips.idle, 0, 1, 0, false)
    // the head and shoulders, the head centred on the medallion and kept inside it
    for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 24; x++) {
            if ((x - 12) * (x - 12) + (y - 12) * (y - 12) > 100) continue
            const c = BUST.get(HEAD_X - 12 + x, HEAD_Y - 12 + y)
            if (c) s.set(x, y, c)
        }
    }
    if (tier >= 3) { px(s, 12, 1, C.white); px(s, 11, 1, C.gold3); px(s, 13, 1, C.gold3) }
}

// ── Status icons (16×16) ───────────────────────────────────────────────────────────

function statusTile(g: Surface, hostile: boolean): void {
    const m: Mat = hostile ? [C.red0, C.red1, C.red2] : [C.teal0, C.teal1, C.teal2]
    rect(g, 0, 0, 16, 16, C.ink)
    rect(g, 1, 1, 14, 14, m[0])
    rect(g, 1, 1, 14, 1, m[2])
    dither(g, 1, 8, 14, 7, C.ink, 4)
}

export interface StatusIcon { id: string, label: string, hostile: boolean, glyph: Glyph }

export const STATUS_ICONS: readonly StatusIcon[] = [
    { id: 'burn', label: 'Burn / DoT', hostile: true, glyph: (g, x, y) => P.flame(g, x, y + 1, 6, C.lava1, C.orange, C.gold3) },
    { id: 'stun', label: 'Stun', hostile: true, glyph: (g, x, y) => { for (let i = 0; i < 3; i++) { const a = i * 2.1; const sx = Math.round(x + Math.cos(a) * 4); const sy = Math.round(y + Math.sin(a) * 2); P.sparkle(g, sx, sy, 2, C.gold3) } } },
    { id: 'slow', label: 'Slow', hostile: true, glyph: (g, x, y) => { ring(g, x, y, 5, C.cyan); line(g, x, y, x, y - 3, C.white); line(g, x, y, x - 3, y + 1, C.white) } },
    { id: 'silence', label: 'Silence', hostile: true, glyph: (g, x, y) => { ellipse(g, x, y, 4, 2, C.bone1); line(g, x - 3, y, x + 3, y, C.ink); line(g, x - 5, y - 5, x + 5, y + 5, C.pink) } },
    { id: 'armor_shred', label: 'Armor shred', hostile: true, glyph: (g, x, y) => { poly(g, [-4, -5, 4, -5, 4, 1, 0, 5, -4, 1], x, y, C.steel2); line(g, x - 1, y - 5, x + 1, y + 4, C.ink); tri(g, x + 4, y + 2, x + 6, y + 3, x + 5, y + 5, C.steel3) } },
    { id: 'curse', label: 'Curse', hostile: true, glyph: (g, x, y) => { ring(g, x, y, 5, C.purple2); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / 5; const b = a + Math.PI * 4 / 5; line(g, x + Math.cos(a) * 4, y + Math.sin(a) * 4, x + Math.cos(b) * 4, y + Math.sin(b) * 4, C.pink) } } },
    { id: 'weaken', label: 'Stat debuff', hostile: true, glyph: (g, x, y) => P.downArrow(g, x, y, C.red3, 10) },
    { id: 'shield', label: 'Shield', hostile: false, glyph: (g, x, y) => shield(g, x, y, ShieldStyle.Kite, M.gold, [C.teal1, C.teal2, C.teal3], C.white) },
    { id: 'buff', label: 'Buff', hostile: false, glyph: (g, x, y) => P.upArrow(g, x, y, C.gold3, 10) },
    { id: 'regen', label: 'Regen / HoT', hostile: false, glyph: (g, x, y) => { rect(g, x - 1, y - 5, 3, 11, C.green4); rect(g, x - 5, y - 1, 11, 3, C.green4); rect(g, x, y - 4, 1, 9, C.white) } },
    { id: 'immunity', label: 'Debuff-immunity', hostile: false, glyph: (g, x, y) => { ring(g, x, y, 5, C.white); ring(g, x, y, 4, C.frost); P.downArrow(g, x, y, C.stone3, 6); line(g, x - 4, y + 4, x + 4, y - 4, C.white) } },
    { id: 'evasion', label: 'Evasion', hostile: false, glyph: (g, x, y) => { for (let i = 0; i < 3; i++) line(g, x - 5, y - 3 + i * 3, x + 1, y - 3 + i * 3, i === 1 ? C.white : C.frost); tri(g, x + 1, y - 5, x + 1, y + 5, x + 6, y, C.frost) } },
    { id: 'taunt', label: 'Taunt', hostile: false, glyph: (g, x, y) => { rect(g, x - 1, y - 6, 3, 8, C.red2); rect(g, x - 1, y + 3, 3, 3, C.red2); px(g, x, y - 5, C.red3) } },
    { id: 'reflect', label: 'Reflect', hostile: false, glyph: (g, x, y) => { rect(g, x - 5, y - 5, 3, 11, C.frost); line(g, x - 1, y - 1, x + 5, y - 5, C.pink); line(g, x - 1, y + 1, x + 5, y + 5, C.cyan) } },
    { id: 'redirect', label: 'Redirect (guarded)', hostile: false, glyph: (g, x, y) => { P.heart(g, x - 2, y, 2, C.gold2, C.gold3); line(g, x + 1, y, x + 6, y, C.gold3); tri(g, x + 4, y - 2, x + 4, y + 2, x + 7, y, C.gold3) } }
]

export function drawStatusIcon(s: Surface, icon: StatusIcon, g: (dst: Surface, fn: Glyph, cx: number, cy: number, small?: boolean) => void): void {
    statusTile(s, icon.hostile)
    g(s, icon.glyph, 8, 8, true)
}

