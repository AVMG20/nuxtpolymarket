// The screen a cleared run waits on: the party walking a bridge of light across the dark, and the
// one button that begins the next run. Pressed, the bridge stops, a portal opens ahead onto
// Thornwick Vale and the party walks into it. An iris closes on the portal (`PrestigeGate`), and
// the battle stage opens World 1 on the other side.

import { C, CLEAR } from './palette'
import { Surface, bayer, hash } from './surface'
import { qt, eo } from './vfx-kit'
import { drawText, textWidth } from './font'
import { SW, SH, FLOOR_Y, WORLD_SCENES, mod } from './scenery'
import { artById, bake, type Baked } from './catalog'
import { HERO_ART } from './heroes'
import { blitStrip, drawPlateButton, DEFAULT_SPLASH_PARTY, type ButtonBox, type PlayButtonState, type SplashParty } from './menu-splash'
import { CHAMPION_BY_ID } from '../../../shared/utils/hero-quest/content/champions'

export const BEGIN_AGAIN_LABEL = 'BEGIN AGAIN'

/** The row the party walks on, the bridge's lit top edge. */
const DECK_Y = 132
/**
 * The stage's move strip is a run; played at a share of its speed it is a walk. Ground speed
 * keeps step with the playback (`STRIDE_SPEED` per unit of it) so the feet do not slide: the
 * bridge scrolls at the idle pace, and the party covers ground a little quicker into the portal.
 */
const STRIDE_SPEED = 48
const IDLE_PACE = 0.5
const LEAVE_PACE = 0.75
const LEAVE_SPEED = STRIDE_SPEED * LEAVE_PACE
/** Where the leader walks, and the gap to each body behind it. */
const LEAD_X = 214
const FILE_GAP = 24
/** Columns at either side over which the bridge fades into the dark. */
const EDGE_FADE = 64
/** Gap between the bridge's seams of light, which carry the sense of walking. */
const SEAM_GAP = 20
const MOTES = 22

/** The portal: its centre, standing on the deck, and its full radii. */
const PORTAL_X = 284
const PORTAL_Y = DECK_Y - 24
const PORTAL_RX = 18
const PORTAL_RY = 32
/** Seconds the portal takes to open, and how long it holds once the last body is through. */
const PORTAL_OPEN = 0.9
const PORTAL_HOLD = 0.35
/** The share of the portal that shows the world rather than the rim. */
const PORTAL_INNER = 0.84
/** Seconds the rim flares as a body steps through. */
const STEP_FLARE = 0.22
/** The rim's bands, swirling. */
const RIM = [C.white, C.frost, C.cyan, C.teal3] as const

export const BEGIN_AGAIN_BUTTON: ButtonBox = (() => {
    const w = textWidth(BEGIN_AGAIN_LABEL, 'big') + 20
    return { x: (SW - w) >> 1, y: 64, w, h: 22 }
})()

/** Whether a point on the screen, in scene pixels, is on the button. */
export function onBeginAgain(x: number, y: number): boolean {
    const b = BEGIN_AGAIN_BUTTON
    return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h
}

interface Body { strip: Baked, x: number, offset: number }

/** Where an iris opens on the bridge (the Hero, leading) and closes as the party leaves it (the portal), as shares of the frame. */
export const BRIDGE_HERO_FOCUS = { x: LEAD_X / SW, y: (DECK_Y - 16) / SH } as const
export const BRIDGE_PORTAL_FOCUS = { x: PORTAL_X / SW, y: PORTAL_Y / SH } as const

export class PrestigeBridge {
    readonly frame = new Surface(SW, SH, 0, 0)
    private readonly world = new Surface(SW, SH, 0, 0)
    private readonly bodies: Body[]
    private leftAt: number | null = null

    /** Bakes the party's walk strips, so build it once per party and render it every frame. */
    constructor(party: SplashParty) {
        const classId = HERO_ART[party.classId] ? party.classId : DEFAULT_SPLASH_PARTY.classId
        const fielded = party.champions.filter(c => CHAMPION_BY_ID[c.id as keyof typeof CHAMPION_BY_ID]).slice(0, 5)
        const bases = [`hero/${classId}`, ...fielded.map(c => `champion/${c.id}`)]
        this.bodies = bases.flatMap((base, i) => {
            const asset = artById(`${base}/move`) ?? artById(`${base}/idle`)
            if (!asset) return []
            // the Hero leads; the Champions follow in file, each out of step with the last
            return [{ strip: bake(asset), x: LEAD_X - i * FILE_GAP, offset: i * 0.29 }]
        })
    }

    /** Send the party into the portal, from scene time `t`. */
    leave(t: number): void {
        if (this.leftAt === null) this.leftAt = t
    }

    /** Seconds after leaving that the last body is through the portal. */
    private get crossed(): number {
        const last = this.bodies.reduce((m, b) => Math.min(m, b.x), LEAD_X)
        // a body is through once its back edge passes the portal's centre line
        return (PORTAL_X - last + 12) / LEAVE_SPEED
    }

    /** Whether the last body is through the portal and it has held a beat: time for the iris. */
    finished(t: number): boolean {
        return this.leftAt !== null && t - this.leftAt >= this.crossed + PORTAL_HOLD
    }

    render(t: number, button: PlayButtonState = 'idle'): Surface {
        const s = this.frame
        s.clear(C.ink)
        const away = this.leftAt === null ? 0 : t - this.leftAt
        const leaving = this.leftAt !== null
        // walking in place scrolls the bridge; once they leave, the bridge holds and the party walks on
        const scroll = (leaving ? this.leftAt! : t) * STRIDE_SPEED * IDLE_PACE
        const walked = away * LEAVE_SPEED
        const stride = (leaving ? this.leftAt! : t) * IDLE_PACE + away * LEAVE_PACE

        drawBridge(s, scroll, t)

        if (leaving) {
            const open = eo(Math.min(1, away / PORTAL_OPEN))
            let flare = false
            for (const b of this.bodies) {
                const at = (PORTAL_X - b.x) / LEAVE_SPEED
                if (away >= at && away < at + STEP_FLARE) flare = true
            }
            WORLD_SCENES[0]!.draw(this.world, 0, t)
            this.drawPortal(s, t, open, flare)
        }

        for (const b of this.bodies) {
            const x = b.x + walked
            if (x - b.strip.ax > PORTAL_X) continue
            blitClipped(s, b.strip, stride + b.offset, x, DECK_Y, leaving ? PORTAL_X : SW)
        }

        if (!leaving) {
            drawText(s, 'THE VOID IS BEATEN', SW / 2, 44, C.steel2, { align: 1, shadow: 0 })
            drawPlateButton(s, BEGIN_AGAIN_BUTTON, BEGIN_AGAIN_LABEL, t, button, false)
        }
        return s
    }

    /**
     * An ellipse onto World 1: inside it the world's own pixels, offset so its floor meets the
     * deck, then a swirling rim and a dithered glow.
     */
    private drawPortal(s: Surface, t: number, open: number, flare: boolean): void {
        const rx = PORTAL_RX * open
        const ry = PORTAL_RY * open
        if (rx < 1 || ry < 1) return
        const dy = FLOOR_Y - DECK_Y
        const glow = 1.35
        const x0 = Math.max(0, Math.floor(PORTAL_X - rx * glow))
        const x1 = Math.min(SW - 1, Math.ceil(PORTAL_X + rx * glow))
        const y0 = Math.max(0, Math.floor(PORTAL_Y - ry * glow))
        const y1 = Math.min(SH - 1, Math.ceil(PORTAL_Y + ry * glow))
        const spin = qt(t) * 6
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const u = (x - PORTAL_X) / rx
                const v = (y - PORTAL_Y) / ry
                const e = Math.sqrt(u * u + v * v)
                if (e < PORTAL_INNER) {
                    const c = this.world.get(x, Math.min(SH - 1, y + dy))
                    if (c !== CLEAR) s.data[y * SW + x] = c
                } else if (e < 1) {
                    const band = Math.atan2(v, u) * 3 + spin + e * 9
                    s.data[y * SW + x] = flare ? C.white : RIM[mod(Math.floor(band), RIM.length)]!
                } else if (e < glow && bayer(x, y, Math.round((glow - e) / (glow - 1) * (flare ? 12 : 7)))) {
                    s.data[y * SW + x] = C.cyan
                }
            }
        }
    }
}

/**
 * The bridge: a lit deck with a glow under it and a haze over it, seams of light passing under
 * the party, and motes rising off it, all fading into the dark at both edges.
 */
function drawBridge(s: Surface, scroll: number, t: number): void {
    const put = (x: number, y: number, c: number): void => {
        if (x < 0 || x >= SW || y < 0 || y >= SH) return
        const edge = Math.min(x, SW - 1 - x) / EDGE_FADE
        if (edge < 1 && !bayer(x, y, Math.round(edge * 16))) return
        s.data[y * SW + x] = c
    }
    for (let x = 0; x < SW; x++) {
        // the haze over the deck, then the deck's lit edge and its body
        for (let r = 1; r <= 3; r++) if (bayer(x, DECK_Y - r, 6 - r * 2)) put(x, DECK_Y - r, C.cyan)
        put(x, DECK_Y, C.white)
        put(x, DECK_Y + 1, C.frost)
        put(x, DECK_Y + 2, C.cyan)
        put(x, DECK_Y + 3, C.teal3)
        put(x, DECK_Y + 4, C.teal2)
        // the glow it throws down into the dark
        for (let r = 0; r < 12; r++) {
            const y = DECK_Y + 5 + r
            if (bayer(x, y, 12 - r)) put(x, y, r < 4 ? C.teal1 : C.teal0)
        }
    }
    // seams of light, each with a drip under it, passing under the party as it walks
    const seams = Math.ceil(SW / SEAM_GAP) + 2
    for (let k = 0; k < seams; k++) {
        const x = Math.round(mod(k * SEAM_GAP - scroll, seams * SEAM_GAP) - SEAM_GAP)
        put(x, DECK_Y + 1, C.white)
        put(x, DECK_Y + 2, C.white)
        put(x, DECK_Y + 3, C.frost)
        for (let r = 0; r < 8; r++) if (bayer(x, DECK_Y + 4 + r, 12 - r)) put(x, DECK_Y + 4 + r, C.cyan)
    }
    // motes lifting off the deck and drifting back as the bridge passes
    const tt = qt(t)
    for (let i = 0; i < MOTES; i++) {
        const life = 1.6 + hash(i * 7 + 1) * 1.4
        const age = mod(tt + hash(i * 7 + 2) * life, life) / life
        const x = Math.round(mod(hash(i * 7 + 3) * SW * 1.5 - scroll * 0.9 - age * 6, SW * 1.5) - SW * 0.25)
        const y = Math.round(DECK_Y - 2 - age * (18 + hash(i * 7 + 4) * 26))
        put(x, y, age < 0.5 ? C.white : age < 0.8 ? C.frost : C.teal3)
    }
}

/** A baked strip's frame at `t` on its anchor, with every column from `clipX` on left out. */
function blitClipped(dst: Surface, b: Baked, t: number, x: number, y: number, clipX: number): void {
    if (clipX >= dst.w) {
        blitStrip(dst, b, t, x, y)
        return
    }
    const src = b.frames[Math.floor(t * b.fps) % b.frames.length]!
    const ox = Math.round(x) - b.ax
    const oy = Math.round(y) - b.ay
    for (let sy = 0; sy < src.h; sy++) {
        const yy = oy + sy
        if (yy < 0 || yy >= dst.h) continue
        for (let sx = 0; sx < src.w; sx++) {
            const xx = ox + sx
            if (xx < 0 || xx >= clipX) continue
            const c = src.data[sy * src.w + sx]!
            if (c !== CLEAR) dst.data[yy * dst.w + xx] = c
        }
    }
}
