// The splash Hero Quest opens on: Thornwick at dusk, the logo, and the player's own party.
//
// The `branding/splash` asset is the loading screen the art page reviews, and it stays as drawn.
// This is the menu built from the same parts, with the party from the save standing on the
// battle stage's formation marks in place of the lone rookie, and no loading bar: the splash now
// waits for Start rather than for a load. With no save it is the rookie, the Beginner, alone.

import { C, CLEAR } from './palette'
import { Surface, bayer, dither, rect } from './surface'
import { qt, VL } from './vfx-kit'
import { drawLogo } from './logos'
import { drawText, textWidth } from './font'
import { SW, SH, WORLD_SCENES } from './scenery'
import { artById, bake, type Baked } from './catalog'
import { HERO_ART } from './heroes'
import { STAGE } from './special-kit'
import { runMarks, type RunParty } from './demo'
import { CHAMPION_BY_ID } from '../../../shared/utils/hero-quest/content/champions'

/** The party a splash stands: who, and on which row. The Beginner alone without a save. */
export interface SplashParty {
    classId: string
    heroRow: RunParty['heroRow']
    champions: readonly { id: string, row: RunParty['heroRow'] }[]
}
export const DEFAULT_SPLASH_PARTY: SplashParty = { classId: 'class_beginner', heroRow: 'front', champions: [] }

/** Seconds each body's idle is offset from the last, so the party does not breathe in lockstep. */
const IDLE_STAGGER = 0.37
/** How far left of its battle marks the party stands here, clear of the play button. */
const PARTY_DX = -45

interface Body { strip: Baked, x: number, y: number, offset: number }

export class MenuSplash {
    readonly frame = new Surface(SW, SH, 0, 0)
    private bodies: Body[]

    /** Bakes the party's idle strips, so build it once per party and render it every frame. */
    constructor(party: SplashParty) {
        const classId = HERO_ART[party.classId] ? party.classId : DEFAULT_SPLASH_PARTY.classId
        const fielded = party.champions.filter(c => CHAMPION_BY_ID[c.id as keyof typeof CHAMPION_BY_ID]).slice(0, 5)
        const marks = runMarks(party.heroRow, fielded.map(c => c.row))
        const bases = [`hero/${classId}`, ...fielded.map(c => `champion/${c.id}`)]
        this.bodies = bases.flatMap((base, i) => {
            const asset = artById(`${base}/idle`)
            const mark = VL.allies[marks[i]!]
            if (!asset || !mark) return []
            return [{ strip: bake(asset), x: STAGE.ox + mark.x + PARTY_DX, y: STAGE.oy + mark.g, offset: i * IDLE_STAGGER }]
        })
        // painter's order: the furthest rank first
        this.bodies.sort((a, b) => a.y - b.y)
    }

    render(t: number, button: PlayButtonState = 'idle'): Surface {
        const s = this.frame
        WORLD_SCENES[0]!.draw(s, qt(t) * 20, t)
        dither(s, 0, 0, SW, SH, C.night0, 6)
        for (const b of this.bodies) blitStrip(s, b.strip, t + b.offset, b.x, b.y)
        drawLogo(s, SW / 2, 40, t)
        drawPlayButton(s, t, button)
        return s
    }
}

/**
 * The play button, centred across the splash and down on the middle of the ground, between the
 * treeline and the river: where it is drawn and where a click lands on it.
 */
export const PLAY_BUTTON = { x: (SW - 72) >> 1, y: 133 - 11, w: 72, h: 22 } as const
export type PlayButtonState = 'idle' | 'hover' | 'pressed' | 'busy'
/** Seconds between the glint's passes across the plate, as the logo's glint times its own. */
const BUTTON_GLINT_PERIOD = 2.4
/** The plate's face, top to bottom, at rest and lit under the pointer. */
const PLATE = [C.red3, C.red2, C.red2, C.red1, C.red1] as const
const PLATE_LIT = [C.gold3, C.red3, C.red2, C.red2, C.red1] as const

/** A filled rect with its four corner pixels left out: the button's rounded silhouette. */
function roundRect(s: Surface, x: number, y: number, w: number, h: number, c: number): void {
    rect(s, x + 1, y, w - 2, h, c)
    rect(s, x, y + 1, w, h - 2, c)
}

/** Whether a point on the splash, in scene pixels, is on the play button. */
export function onPlayButton(x: number, y: number): boolean {
    const b = PLAY_BUTTON
    return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h
}

/**
 * The logo's own make: an ink outline, a gold rim, a red plate lit along its top, a play glyph
 * and PLAY in the big face. A glint crosses it now and then; hovered it lights, pressed it sinks
 * onto its shadow, and while the press is on its way it dims.
 */
function drawPlayButton(s: Surface, t: number, state: PlayButtonState): void {
    const { w, h } = PLAY_BUTTON
    const sink = state === 'pressed' ? 2 : 0
    const x = PLAY_BUTTON.x
    const y = PLAY_BUTTON.y + sink
    // the drop shadow it sinks onto when pressed
    if (!sink) roundRect(s, x + 2, y + 2, w, h, C.ink)
    roundRect(s, x, y, w, h, C.ink)
    // the gold rim: lit along the top and left, in shade along the bottom and right
    rect(s, x + 1, y + 1, w - 2, h - 2, C.gold1)
    rect(s, x + 2, y + 1, w - 4, 1, C.gold3)
    rect(s, x + 1, y + 2, 1, h - 4, C.gold2)
    rect(s, x + 2, y + h - 2, w - 4, 1, C.brown1)
    rect(s, x + w - 2, y + 2, 1, h - 4, C.gold0)
    // the plate: a curved face, light at the top falling to deep red, the bands stepped through dither
    const lit = state === 'hover' || state === 'pressed'
    const ramp = lit ? PLATE_LIT : PLATE
    const top = y + 2
    const rows = h - 4
    for (let r = 0; r < rows; r++) {
        const pos = r / (rows - 1) * (ramp.length - 1)
        const band = Math.min(ramp.length - 2, Math.floor(pos))
        const level = Math.round((pos - band) * 16)
        for (let k = 0; k < w - 4; k++) {
            const px = x + 2 + k
            s.set(px, top + r, bayer(px, top + r, level) ? ramp[band + 1]! : ramp[band]!)
        }
    }
    // a bright lip under the rim, and the plate's inner shadow along its bottom and right edge
    rect(s, x + 3, top, w - 6, 1, lit ? C.gold3 : C.red3)
    rect(s, x + 2, top + rows - 1, w - 4, 1, C.red0)
    rect(s, x + w - 3, top + 1, 1, rows - 1, C.red0)
    // the glint: a slanted band of light crossing the plate
    if (state !== 'busy') {
        const u = (t % BUTTON_GLINT_PERIOD) / BUTTON_GLINT_PERIOD
        const gx = Math.round(x - 10 + u * (w + 20) * 2)
        for (let r = 2; r < h - 2; r++) {
            for (let k = 0; k < 3; k++) {
                const px = gx + k - r
                if (px > x + 2 && px < x + w - 3) s.set(px, y + r, C.white)
            }
        }
    }
    // the play glyph and the word, centred together
    const text = 'PLAY'
    const tw = textWidth(text, 'big')
    const gw = 5
    const gap = 4
    const left = x + ((w - gw - gap - tw) >> 1)
    const cy = y + (h >> 1) - 1
    const ink = state === 'busy' ? C.bone1 : C.white
    for (let r = -4; r <= 4; r++) rect(s, left, cy + r, gw - Math.abs(r), 1, ink)
    drawText(s, text, left + gw + gap, cy - 3, ink, { font: 'big', shadow: 1 })
}

/** A baked strip's frame at `t`, on its anchor at (x, y). */
function blitStrip(dst: Surface, b: Baked, t: number, x: number, y: number): void {
    const n = b.frames.length
    const src = b.frames[Math.floor(t * b.fps) % n]!
    const ox = Math.round(x) - b.ax
    const oy = Math.round(y) - b.ay
    for (let sy = 0; sy < src.h; sy++) {
        const yy = oy + sy
        if (yy < 0 || yy >= dst.h) continue
        for (let sx = 0; sx < src.w; sx++) {
            const c = src.data[sy * src.w + sx]!
            const xx = ox + sx
            if (c === CLEAR || xx < 0 || xx >= dst.w) continue
            dst.data[yy * dst.w + xx] = c
        }
    }
}
