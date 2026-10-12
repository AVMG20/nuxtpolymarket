// UI backgrounds (asset-list §4), UI chrome (§5) and branding (§6). The menu scenes draw on plain
// dark (the bespoke tab backgrounds were dropped 2026-10-10). Chrome pieces are pixel panels and
// cards; the web UI can use them as 9-slice borders or reference renders.

import { C, RARITY_COLORS, TRAIT_GRADES } from './palette'
import { Surface, rect, px, disc, ring, dither, ditherEllipse, poly, arc, bayer, blit } from './surface'
import { drawText } from './font'
import { qt } from './vfx-kit'
import { drawLogo } from './logos'
import { SW, SH, WORLD_SCENES  } from './scenery'
import { Actor } from './rig'
import { HERO_ART } from './heroes'
import { championLook, CHASSIS } from './champions'
import { glyph } from './icon-kit'
import { ARTIFACT_ICONS, CURRENCY_ICONS } from './icons-items'
import { traitFrame } from './icons-misc'
import type { Mat } from './weapons'

const R = Math.round

// ── Panels ─────────────────────────────────────────────────────────────────────────

/** A bevelled pixel panel — the 9-slice every chrome piece is built from. */
export function panel(s: Surface, x: number, y: number, w: number, h: number, m: Mat = [C.night0, C.night1, C.night3], fill: number = C.night1): void {
    rect(s, x, y, w, h, C.ink)
    rect(s, x + 1, y + 1, w - 2, h - 2, m[0])
    rect(s, x + 2, y + 2, w - 4, h - 4, fill)
    rect(s, x + 1, y + 1, w - 2, 1, m[2])
    rect(s, x + 1, y + 1, 1, h - 2, m[1])
    px(s, x + 1, y + 1, C.white)
}

function title(s: Surface, text: string, x: number, y: number, c: number = C.gold2): void {
    drawText(s, text, x, y, c, { shadow: 1 })
}

// ── World map ──────────────────────────────────────────────────────────────────────

const WORLD_TINT = [C.green2, C.teal1, C.lava1, C.frost, C.teal2, C.purple2, C.bone0, C.haze, C.stone3, C.purple1]

/** The stage-select map: a road from the frontier (left) inward past the door to the Void. */
export function drawWorldMap(s: Surface, t: number): void {
    rect(s, 0, 0, SW, SH, C.night0)
    // terrain patches, one per world, blending into each other
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
        const w = Math.min(9, Math.floor((x + Math.sin(y * 0.07) * 10) / 32))
        const c = WORLD_TINT[w]!
        if (bayer(x, y, w >= 9 ? 3 : 5)) s.set(x, y, c)
    }
    dither(s, 0, 0, SW, SH, C.night0, 7)
    // the road
    const pts: [number, number][] = []
    for (let i = 0; i < 10; i++) pts.push([16 + i * 32, 96 + R(Math.sin(i * 1.3) * 40)])
    for (let i = 0; i < 9; i++) {
        const [x0, y0] = pts[i]!
        const [x1, y1] = pts[i + 1]!
        for (let k = 0; k <= 16; k++) {
            const u = k / 16
            const xx = x0 + (x1 - x0) * u
            const yy = y0 + (y1 - y0) * u + Math.sin(u * Math.PI) * 8
            if (k & 1) px(s, R(xx), R(yy), C.bone1)
        }
    }
    // nodes
    const pulse = Math.floor(qt(t) * 4) & 1
    pts.forEach(([x, y], i) => {
        disc(s, x, y, 7, C.ink)
        disc(s, x, y, 6, WORLD_TINT[i]!)
        disc(s, x, y, 4, C.night1)
        drawText(s, String(i + 1), x + (i === 9 ? 0 : 1), y - 2, C.white, { align: 1, shadow: 0 })
        if (i === 0) ring(s, x, y, 9 + pulse, C.gold2) // "you are here"
    })
    // the door marker at World 6
    const [dx, dy] = pts[5]!
    poly(s, [0, -12, 3, -4, 0, 0, 3, 4, 0, 12, -3, 4, 0, 0, -3, -4], dx, dy - 20, C.pink)
    title(s, 'THE ROAD TO THE VOID', 8, 8)
    drawText(s, 'FRONTIER', 8, SH - 12, C.green3, { shadow: 1 })
    drawText(s, 'THE EDGE', SW - 8, SH - 12, C.purple2, { align: 2, shadow: 1 })
}

// ── UI chrome ──────────────────────────────────────────────────────────────────────

const CHROME_ACTOR = new Actor(64)
const TILE = new Surface(24, 24, 0, 0)

// Readability: every label carries a drop shadow, body text is bone on the night panels, and
// colour goes only on the word that carries meaning, in the lightest step of its ramp. Text never
// sits on a coloured fill: a bar's label goes beside it, a button's on its own plate.

/** A tab in a slot's corner: a coloured plate, its letter white. */
function tab(s: Surface, x: number, y: number, text: string, plate: number): void {
    rect(s, x, y, 7, 9, C.ink)
    rect(s, x + 1, y + 1, 5, 7, plate)
    drawText(s, text, x + 2, y + 2, C.white, { shadow: 0 })
}

/** A small button: an inked plate with its label centred on it. */
function button(s: Surface, x: number, y: number, w: number, text: string, plate: number, lit: number): void {
    rect(s, x, y, w, 9, C.ink)
    rect(s, x + 1, y + 1, w - 2, 7, plate)
    rect(s, x + 1, y + 1, w - 2, 1, lit)
    drawText(s, text, x + (w >> 1), y + 2, C.white, { align: 1, shadow: 1 })
}

function mini(s: Surface, id: 'hero' | string, x: number, y: number, t: number, facing: 1 | -1 = 1): void {
    if (id === 'hero') CHROME_ACTOR.draw(s, x, y, HERO_ART.class_knight!.look, HERO_ART.class_knight!.clips.idle, t, facing, 0, false)
    else CHROME_ACTOR.draw(s, x, y, championLook(id), CHASSIS[id === 'champ_borin' ? 'tank' : id === 'champ_lys' ? 'support' : id === 'champ_nym' ? 'control' : 'damage'].idle, t, facing, 0, false)
}

export interface Chrome { id: string, label: string, w: number, h: number, frames: number, draw(s: Surface, t: number): void }

export const CHROME: readonly Chrome[] = [
    {
        id: 'formation_grid', label: 'Formation grid — 3 front / 3 back', w: 160, h: 96, frames: 12,
        draw(s, t) {
            panel(s, 0, 0, 160, 96)
            title(s, 'FORMATION', 6, 5)
            drawText(s, 'F FRONT  B BACK', 154, 5, C.bone0, { align: 2, shadow: 1 })
            const party = ['champ_borin', 'hero', 'champ_rask', 'champ_lys', 'champ_nym', '']
            for (let i = 0; i < 6; i++) {
                const front = i < 3
                const x = 10 + (i % 3) * 48
                const y = front ? 16 : 56
                panel(s, x, y, 44, 36, front ? [C.red0, C.red1, C.red2] : [C.blue0, C.blue1, C.blue2], C.night0)
                if (party[i]) mini(s, party[i]!, x + 26, y + 33, t)
                else { drawText(s, '+', x + 22, y + 13, C.steel2, { font: 'big', align: 1, shadow: 1 }); drawText(s, 'EMPTY', x + 22, y + 24, C.stone3, { align: 1, shadow: 1 }) }
                tab(s, x + 2, y + 2, front ? 'F' : 'B', front ? C.red1 : C.blue1)
            }
        }
    },
    {
        id: 'loadout_cards', label: 'Loadout save-slot cards (2 → 6)', w: 200, h: 60, frames: 1,
        draw(s) {
            for (let i = 0; i < 4; i++) {
                const x = 2 + i * 50
                const locked = i === 3
                panel(s, x, 2, 46, 56, locked ? [C.stone0, C.stone1, C.stone2] : i === 0 ? [C.gold0, C.gold1, C.gold2] : undefined, locked ? C.stone0 : C.night1)
                drawText(s, locked ? 'LOCKED' : `SLOT ${i + 1}`, x + 23, 7, locked ? C.bone0 : C.bone1, { align: 1, shadow: 1 })
                if (!locked) {
                    for (let k = 0; k < 3; k++) rect(s, x + 6 + k * 12, 18, 10, 10, C.night0)
                    for (let k = 0; k < 3; k++) rect(s, x + 6 + k * 12, 32, 10, 10, C.night0)
                    if (i === 0) drawText(s, 'ACTIVE', x + 23, 47, C.gold3, { align: 1, shadow: 1 })
                } else {
                    rect(s, x + 19, 26, 9, 8, C.stone3); arc(s, x + 23, 26, 3, Math.PI, Math.PI * 2, C.stone3); px(s, x + 23, 29, C.ink); px(s, x + 23, 30, C.ink)
                    glyph(s, CURRENCY_ICONS.gems!, x + 23, 46, true)
                }
            }
        }
    },
    {
        id: 'trait_slots', label: 'Trait slots — 5 fixed, roll and lock states', w: 150, h: 56, frames: 8,
        draw(s, t) {
            panel(s, 0, 0, 150, 56)
            title(s, 'TRAITS', 6, 5)
            const rolling = Math.floor(qt(t) * 10)
            for (let i = 0; i < 5; i++) {
                const x = 6 + i * 28
                const tile = TILE
                tile.clear()
                const grade = i === 1 ? TRAIT_GRADES[rolling % 9]! : TRAIT_GRADES[[2, 0, 5, 7, 3][i]!]!
                traitFrame(tile, grade)
                blit(s, tile, x, 16)
                const locked = i === 2 || i === 3
                if (locked) { rect(s, x + 8, 42, 7, 6, C.gold1); arc(s, x + 11, 42, 2, Math.PI, Math.PI * 2, C.gold2) } else if (i === 1) button(s, x, 41, 24, 'ROLL', C.purple1, C.purple2)
            }
        }
    },
    {
        id: 'arena_candidate', label: 'Arena candidate card', w: 96, h: 64, frames: 12,
        draw(s, t) {
            panel(s, 0, 0, 96, 64, [C.red0, C.red1, C.red2])
            drawText(s, 'RIVAL', 6, 5, C.red3, { shadow: 1 })
            drawText(s, '1482', 90, 5, C.gold3, { align: 2, shadow: 1 })
            // the rival's party faces yours, as enemies do on the stage
            for (let i = 0; i < 3; i++) mini(s, ['hero', 'champ_ulrid', 'champ_seraphel'][i]!, 20 + i * 28, 50, t, -1)
            button(s, 4, 53, 88, 'ATTACK', C.red1, C.red2)
        }
    },
    {
        id: 'arena_log', label: 'Arena battle log', w: 140, h: 60, frames: 1,
        draw(s) {
            panel(s, 0, 0, 140, 60)
            title(s, 'BATTLE LOG', 6, 5)
            const rows: [string, string, number][] = [['WON', '+24', C.green4], ['LOST', '-11', C.red3], ['WON', '+19', C.green4], ['DEFENDED', '+6', C.cyan]]
            rows.forEach(([outcome, delta, c], i) => {
                const y = 14 + i * 10
                rect(s, 5, y, 130, 9, i & 1 ? C.night0 : C.night2)
                drawText(s, outcome, 9, y + 2, c, { shadow: 1 })
                drawText(s, `${delta} RATING`, 131, y + 2, C.bone1, { align: 2, shadow: 1 })
            })
        }
    },
    {
        id: 'arena_leaderboard', label: 'Arena Rating leaderboard', w: 140, h: 72, frames: 1,
        draw(s) {
            panel(s, 0, 0, 140, 72)
            title(s, 'RATING', 6, 5)
            const rows: [string, string][] = [['KAIRAFAN', '2410'], ['VOIDWALKER', '2388'], ['HEDGEKNIGHT', '2301'], ['YOU', '1482']]
            rows.forEach(([name, rating], i) => {
                const you = i === 3
                const y = 15 + i * 13
                rect(s, 5, y, 130, 11, you ? C.blue1 : C.night0)
                drawText(s, String(i + 1), 9, y + 3, i === 0 ? C.gold3 : i === 1 ? C.steel3 : i === 2 ? C.orange : C.white, { shadow: 1 })
                drawText(s, name, 21, y + 3, you ? C.white : C.bone1, { shadow: 1 })
                drawText(s, rating, 131, y + 3, you ? C.white : C.gold3, { align: 2, shadow: 1 })
            })
        }
    },
    {
        id: 'encyclopedia_list', label: 'Encyclopedia list view (168 collectibles + 16 nodes)', w: 160, h: 90, frames: 1,
        draw(s) {
            panel(s, 0, 0, 160, 90)
            title(s, 'ENCYCLOPEDIA', 6, 5)
            const ids = Object.keys(ARTIFACT_ICONS)
            for (let i = 0; i < 18; i++) {
                const x = 6 + (i % 6) * 25
                const y = 15 + Math.floor(i / 6) * 25
                const tile = TILE
                tile.clear()
                const known = i % 5 !== 3
                const r = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'][Math.floor(i / 3)]!
                const m = RARITY_COLORS[r]!
                rect(tile, 0, 0, 24, 24, C.ink); rect(tile, 1, 1, 22, 22, m[0]); rect(tile, 2, 2, 20, 20, C.night0)
                if (known) glyph(tile, ARTIFACT_ICONS[ids[i * 2]!]!, 12, 12)
                else drawText(tile, '?', 12, 7, C.stone3, { scale: 2, align: 1, shadow: 1 })
                blit(s, tile, x, y)
            }
        }
    },
    {
        id: 'encyclopedia_detail', label: 'Encyclopedia detail view', w: 160, h: 90, frames: 12,
        draw(s, t) {
            panel(s, 0, 0, 160, 90, [C.gold0, C.gold1, C.gold2])
            panel(s, 6, 6, 58, 78, [C.purple0, C.purple1, C.purple2], C.night2)
            ditherEllipse(s, 35, 72, 16, 3, C.night0, 10)
            mini(s, 'champ_kaira', 35, 72, t)
            drawText(s, 'KAIRA', 70, 8, C.white, { font: 'big', shadow: 1 })
            drawText(s, 'THE REAVER', 70, 18, C.bone1, { shadow: 1 })
            const w = drawText(s, 'MYTHIC', 70, 26, RARITY_COLORS.mythic![2]!, { shadow: 1 })
            drawText(s, 'DAMAGE', 76 + w, 26, C.bone0, { shadow: 1 })
            const stats = [['PWR', 64, C.red2], ['SPD', 38, C.gold2], ['LCK', 51, C.green3], ['IMP', 72, C.blue2], ['VIT', 88, C.purple2]] as const
            stats.forEach(([label, v, c], i) => {
                const y = 38 + i * 9
                drawText(s, label, 70, y + 1, C.bone1, { shadow: 1 })
                rect(s, 86, y, 50, 7, C.ink)
                rect(s, 87, y + 1, 48, 5, C.night0)
                rect(s, 87, y + 1, R(48 * v / 100), 5, c)
                drawText(s, String(v), 154, y + 1, C.white, { align: 2, shadow: 1 })
            })
        }
    }
]

// ── Branding ───────────────────────────────────────────────────────────────────────

/**
 * The wordmark. ⚠ `asset-list.md` §6: "HeroQuest" is an existing, actively republished board
 * game — resolve the name before shipping this. The logo is text, so a rename is one string.
 */
/** Splash / loading screen at scene resolution: Thornwick at dusk, the rookie, the logo. */
export function drawSplash(s: Surface, t: number): void {
    WORLD_SCENES[0]!.draw(s, qt(t) * 20, t)
    dither(s, 0, 0, SW, SH, C.night0, 6)
    CHROME_ACTOR.draw(s, 80, 150, HERO_ART.class_beginner!.look, HERO_ART.class_beginner!.clips.idle, t)
    drawLogo(s, SW / 2 + 20, 40, t)
    const dots = Math.floor(qt(t) * 3) % 4
    drawText(s, 'LOADING' + '.'.repeat(dots), SW / 2 + 20, 132, C.bone1, { align: 1, shadow: 1 })
    rect(s, SW / 2 - 40, 142, 120, 5, C.ink)
    rect(s, SW / 2 - 39, 143, R(118 * ((qt(t) * 0.4) % 1)), 3, C.gold2)
}

