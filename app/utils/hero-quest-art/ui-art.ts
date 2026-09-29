// UI backgrounds (asset-list §4), UI chrome (§5) and branding (§6).
//
// Tab backgrounds sit behind Nuxt UI panels, so they are deliberately low-contrast: dark
// ramps, one accent, nothing that competes with text. Chrome pieces are pixel panels and
// cards; the web UI can use them as 9-slice borders or reference renders.

import { C, RARITY_COLORS, TRAIT_GRADES, TRAIT_GRADE_COLORS } from './palette'
import { Surface, rect, px, line, disc, ring, tri, ellipse, dither, ditherDisc, ditherEllipse, poly, arc, hash2, bayer, blit } from './surface'
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
import { sword, shield, staff, bow, axe, M, ShieldStyle, Gem } from './weapons'
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

// ── Tab backgrounds ────────────────────────────────────────────────────────────────

function vignette(s: Surface): void {
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
        const dx = (x - SW / 2) / (SW / 2)
        const dy = (y - SH / 2) / (SH / 2)
        const d = dx * dx + dy * dy
        if (d > 0.55 && bayer(x, y, Math.min(16, R((d - 0.55) * 30)))) s.set(x, y, C.ink)
    }
}

function floorLine(s: Surface, y: number, c: number, c2: number): void {
    rect(s, 0, y, SW, SH - y, c)
    rect(s, 0, y, SW, 1, c2)
    dither(s, 0, y + 1, SW, SH - y, C.ink, 5)
}

function torch(s: Surface, x: number, y: number, t: number): void {
    rect(s, x - 1, y, 3, 8, C.brown1)
    const f = Math.floor(qt(t) * 8) & 1
    tri(s, x - 3, y, x + 3, y, x + f, y - 7, C.orange)
    tri(s, x - 1, y, x + 1, y, x, y - 4, C.gold3)
    ditherDisc(s, x, y - 3, 14, C.orange, 2)
}

export interface TabBackground { id: string, label: string, built: boolean, draw(s: Surface, t: number): void }

export const TAB_BACKGROUNDS: readonly TabBackground[] = [
    {
        id: 'battle', label: 'Battle', built: true,
        draw(s, t) {
            WORLD_SCENES[0]!.draw(s, 0, t)
            dither(s, 0, 0, SW, SH, C.night0, 9) // dimmed so the battle UI owns the foreground
            // the camp: tents and banners
            for (let i = 0; i < 4; i++) {
                const x = 30 + i * 80
                tri(s, x - 18, 150, x + 18, 150, x, 122, C.brown1); tri(s, x, 122, x + 18, 150, x + 6, 150, C.brown0)
                line(s, x, 122, x, 108, C.brown2); poly(s, [0, 0, 10, 2, 8, 5, 10, 8, 0, 7], x + 1, 108 + (Math.floor(qt(t) * 3) & 1), C.red1)
            }
            vignette(s)
        }
    },
    {
        id: 'gacha', label: 'Gacha', built: true,
        draw(s, t) {
            rect(s, 0, 0, SW, SH, C.night0)
            floorLine(s, 140, C.night1, C.night2)
            // an altar of four seals round a summoning circle
            ditherEllipse(s, 160, 140, 80, 14, C.purple0, 10)
            const k = qt(t)
            for (let i = 0; i < 16; i++) { const a = k * 0.5 + i * Math.PI / 8; px(s, R(160 + Math.cos(a) * 70), R(140 + Math.sin(a) * 11), i & 1 ? C.purple2 : C.pink) }
            rect(s, 140, 110, 40, 30, C.stone1); rect(s, 136, 106, 48, 5, C.stone2); rect(s, 140, 110, 40, 1, C.stone3)
            const seals = [C.blue1, C.red1, C.orange, C.teal2]
            seals.forEach((c, i) => { const x = 90 + i * 47 - (i > 1 ? -46 : 0) * 0; disc(s, 70 + i * 60, 96 + (i === 1 || i === 2 ? -10 : 0), 8, c); disc(s, 70 + i * 60, 96 + (i === 1 || i === 2 ? -10 : 0), 5, C.ink); void x })
            ditherDisc(s, 160, 86, 22, C.gold2, 2 + (Math.floor(k * 4) & 1))
            vignette(s)
        }
    },
    {
        id: 'collections', label: 'Collections', built: true,
        draw(s) {
            rect(s, 0, 0, SW, SH, C.brown0)
            // shelves of relics
            for (let row = 0; row < 4; row++) {
                const y = 30 + row * 36
                rect(s, 0, y, SW, 4, C.brown1); rect(s, 0, y, SW, 1, C.brown2)
                for (let i = 0; i < 12; i++) {
                    const x = 14 + i * 26
                    const ids = Object.keys(ARTIFACT_ICONS)
                    glyph(s, ARTIFACT_ICONS[ids[(row * 12 + i) % ids.length]!]!, x, y - 10)
                }
            }
            dither(s, 0, 0, SW, SH, C.brown0, 8)
            vignette(s)
        }
    },
    {
        id: 'loadouts', label: 'Loadouts', built: true,
        draw(s) {
            rect(s, 0, 0, SW, SH, C.stone0)
            floorLine(s, 146, C.stone1, C.stone2)
            // armoury racks
            for (let i = 0; i < 6; i++) {
                const x = 30 + i * 52
                rect(s, x - 16, 60, 32, 3, C.brown1); rect(s, x - 16, 60, 2, 86, C.brown1); rect(s, x + 14, 60, 2, 86, C.brown1)
                if (i % 3 === 0) { sword(s, x - 6, 140, -Math.PI / 2, 60, M.steel, M.gold, C.brown1); sword(s, x + 6, 140, -Math.PI / 2, 56, M.iron, M.bronze, C.brown0) }
                if (i % 3 === 1) { shield(s, x, 96, ShieldStyle.Kite, M.steel, [C.blue0, C.blue1, C.blue2], C.gold2); axe(s, x - 8, 140, -Math.PI / 2, 50, M.steel, M.wood) }
                if (i % 3 === 2) { staff(s, x - 6, 140, -Math.PI / 2, 60, M.wood, M.arcane, Gem.Crystal, 0, 0); bow(s, x + 6, 100, 0, 0, false, M.wood, 16) }
            }
            dither(s, 0, 0, SW, SH, C.stone0, 8)
            vignette(s)
        }
    },
    {
        id: 'prestige', label: 'Prestige', built: true,
        draw(s, t) {
            rect(s, 0, 0, SW, SH, C.ink)
            for (let i = 0; i < 40; i++) px(s, R(hash2(5, i) * SW), R(hash2(6, i) * SH), (i + Math.floor(qt(t) * 3)) % 4 ? C.night2 : C.haze)
            // the door, and the Void through it
            rect(s, 130, 40, 60, 120, C.stone1); ellipse(s, 160, 42, 30, 22, C.stone1)
            rect(s, 138, 46, 44, 114, C.void); ellipse(s, 160, 46, 22, 16, C.void)
            for (let r = 4; r < 30; r += 6) { const a0 = qt(t) + r * 0.2; arc(s, 160, 100, r, a0, a0 + 3.5, r & 4 ? C.purple1 : C.purple2) }
            disc(s, 160, 100, 3, C.pink)
            floorLine(s, 160, C.night0, C.purple1)
            vignette(s)
        }
    },
    {
        id: 'wiki', label: 'Wiki', built: true,
        draw(s, t) {
            rect(s, 0, 0, SW, SH, C.brown0)
            // a scholar's desk: open tome, map, candles
            rect(s, 0, 120, SW, 60, C.brown1); rect(s, 0, 120, SW, 2, C.brown2)
            rect(s, 110, 96, 100, 34, C.bone1); rect(s, 159, 96, 2, 34, C.bone0)
            for (let i = 0; i < 6; i++) { line(s, 116, 102 + i * 4, 154, 102 + i * 4, C.stone2); line(s, 166, 102 + i * 4, 204, 102 + i * 4, C.stone2) }
            rect(s, 20, 104, 70, 22, C.bone0); for (let i = 0; i < 5; i++) line(s, 26 + i * 12, 108, 32 + i * 12, 122, C.brown2)
            for (const x of [240, 262]) { rect(s, x, 100, 5, 20, C.bone1); const f = Math.floor(qt(t) * 6 + x) & 1; tri(s, x, 100, x + 4, 100, x + 2 + f, 93, C.gold2); ditherDisc(s, x + 2, 96, 18, C.gold1, 2) }
            dither(s, 0, 0, SW, 120, C.brown1, 4) // bookshelves in the dark
            for (let i = 0; i < 30; i++) rect(s, i * 11, 30, 8, 50, (i * 7) % 3 === 0 ? C.red0 : (i * 5) % 3 === 0 ? C.teal0 : C.brown1)
            dither(s, 0, 0, SW, SH, C.brown0, 7)
            vignette(s)
        }
    },
    {
        id: 'raids', label: 'Raids', built: false,
        draw(s, t) {
            rect(s, 0, 0, SW, SH, C.stone0)
            // a dungeon gate between torches
            rect(s, 110, 50, 100, 100, C.stone1); ellipse(s, 160, 52, 50, 24, C.stone1)
            rect(s, 124, 64, 72, 86, C.ink); ellipse(s, 160, 66, 36, 18, C.ink)
            for (let i = 0; i < 7; i++) line(s, 128 + i * 11, 58, 128 + i * 11, 150, C.stone2) // portcullis
            for (let i = 0; i < 5; i++) line(s, 124, 76 + i * 16, 196, 76 + i * 16, C.stone2)
            torch(s, 96, 80, t); torch(s, 224, 80, t)
            floorLine(s, 150, C.stone1, C.stone2)
            vignette(s)
        }
    },
    {
        id: 'traits', label: 'Traits', built: false,
        draw(s, t) {
            rect(s, 0, 0, SW, SH, C.night0)
            // a crystal cavern with five sockets
            for (let i = 0; i < 12; i++) { const x = i * 30; tri(s, x, 0, x + 20, 0, x + 10, 20 + (i * 7) % 20, C.night1) }
            for (let i = 0; i < 5; i++) {
                const x = 60 + i * 50
                const g = TRAIT_GRADE_COLORS[TRAIT_GRADES[i * 2]!]
                tri(s, x - 10, 130, x + 10, 130, x, 96 - (i === 2 ? 10 : 0), g[1])
                tri(s, x - 10, 130, x, 130, x, 96 - (i === 2 ? 10 : 0), g[0])
                ditherDisc(s, x, 110, 20, g[2], 2 + (Math.floor(qt(t) * 3 + i) & 1))
            }
            floorLine(s, 130, C.night1, C.night3)
            vignette(s)
        }
    },
    {
        id: 'arena', label: 'Arena', built: false,
        draw(s, t) {
            rect(s, 0, 0, SW, SH, C.night1)
            // coliseum tiers with banners, sand floor
            for (let tier = 0; tier < 4; tier++) {
                const y = 20 + tier * 22
                rect(s, 0, y, SW, 18, tier & 1 ? C.stone1 : C.stone2)
                for (let i = 0; i < 20; i++) rect(s, i * 16 + 4, y + 4, 8, 12, C.stone0)
                for (let i = 0; i < 40; i++) px(s, i * 8 + (tier * 3) % 8, y + 2, hash2(tier, i) > 0.6 ? C.skin1 : C.brown1) // the crowd
            }
            for (let i = 0; i < 5; i++) { const x = 32 + i * 64; line(s, x, 10, x, 40, C.brown1); poly(s, [0, 0, 12, 0, 12, 16, 6, 12, 0, 16], x + 1, 12 + (Math.floor(qt(t) * 3 + i) & 1), i & 1 ? C.red1 : C.blue1) }
            floorLine(s, 110, C.gold0, C.gold1)
            dither(s, 0, 112, SW, 68, C.brown3, 4)
            vignette(s)
        }
    },
    {
        id: 'leaderboard', label: 'Leaderboard', built: false,
        draw(s, t) {
            rect(s, 0, 0, SW, SH, C.night0)
            // the podium: three steps, laurel banners
            const steps = [[140, 90, C.gold2], [96, 110, C.steel2], [184, 120, C.brown3]] as const
            for (const [x, y, c] of steps) { rect(s, x, y, 40, 150 - y, c as number); rect(s, x, y, 40, 2, C.white) }
            drawText(s, '1', 160, 96, C.ink, { font: 'big', align: 1, shadow: 0 }); drawText(s, '2', 116, 116, C.ink, { font: 'big', align: 1, shadow: 0 }); drawText(s, '3', 204, 126, C.ink, { font: 'big', align: 1, shadow: 0 })
            for (const x of [40, 280]) { line(s, x, 20, x, 150, C.brown1, 2); poly(s, [0, 0, 18, 0, 18, 40, 9, 34, 0, 40], x + 1, 22 + (Math.floor(qt(t) * 3) & 1), C.purple1); arc(s, x + 10, 40, 5, 0.4, 2.8, C.gold2) }
            ditherDisc(s, 160, 60, 40, C.gold1, 2)
            floorLine(s, 150, C.night1, C.night3)
            vignette(s)
        }
    }
]

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
        id: 'loadout_cards', label: 'Loadout save-slot cards (2 → 10)', w: 200, h: 60, frames: 1,
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
    },
    {
        id: 'holiday_banner', label: 'Holiday claim banner', w: 200, h: 40, frames: 12,
        draw(s, t) {
            panel(s, 0, 0, 200, 40, [C.red0, C.red1, C.red3], C.red0)
            for (let i = 0; i < 24; i++) {
                const x = R(hash2(1, i) * 200)
                const y = R(((hash2(2, i) * 40) + qt(t) * 12) % 40)
                if ((y >= 5 && y <= 16 && x >= 30 && x <= 170) || (y >= 20 && y <= 36 && x >= 66 && x <= 134)) continue
                px(s, x, y, C.white)
            }
            drawText(s, 'A GIFT FOR THE SEASON', 100, 8, C.gold3, { align: 1, shadow: 2 })
            panel(s, 70, 22, 60, 13, [C.gold0, C.gold1, C.gold3], C.gold1)
            drawText(s, 'CLAIM', 100, 25, C.ink, { align: 1, shadow: 0 })
        }
    },
    {
        id: 'holiday_gifts', label: 'Holiday gift-box icons (4 holidays)', w: 112, h: 32, frames: 1,
        draw(s) {
            // New Year, Lunar New Year, Halloween, Winter Holiday
            const sets: [number, number, number][] = [[C.blue1, C.gold2, C.white], [C.red1, C.gold2, C.gold3], [C.orange, C.purple1, C.green3], [C.green1, C.red2, C.white]]
            sets.forEach(([box, ribbon, hi], i) => {
                const x = 14 + i * 28
                rect(s, x - 9, 12, 19, 16, C.ink); rect(s, x - 8, 13, 17, 14, box); rect(s, x - 10, 9, 21, 5, C.ink); rect(s, x - 9, 10, 19, 3, box)
                rect(s, x - 1, 10, 3, 17, ribbon); rect(s, x - 9, 17, 17, 2, ribbon)
                disc(s, x - 3, 7, 2.5, ribbon); disc(s, x + 3, 7, 2.5, ribbon); px(s, x - 3, 6, hi); px(s, x + 3, 6, hi)
                if (i === 2) { rect(s, x - 5, 18, 2, 2, C.ink); rect(s, x + 3, 18, 2, 2, C.ink); rect(s, x - 3, 22, 7, 1, C.ink) } // a jack-o'-lantern face
                if (i === 3) for (let k = 0; k < 4; k++) px(s, x - 6 + k * 4, 24 - (k & 1) * 6, C.white) // snow
                if (i === 0) px(s, x + 6, 3, C.gold3) // a new-year spark
                if (i === 1) { px(s, x - 6, 16, C.gold3); px(s, x + 6, 22, C.gold3) }
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

