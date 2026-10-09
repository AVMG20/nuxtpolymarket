// The stage's navigation: a band of icon buttons under the view, one per menu scene,
// and the backdrops those scenes draw until each has a scene of its own. Battle has no button: it
// is what shows when every scene is closed, and an open scene's button turns into its close.

import { C, CLEAR } from './palette'
import { Surface, rect, line, poly, blit, disc, px } from './surface'
import { glyph, type Glyph } from './icon-kit'
import { ABILITY_ICON_PARTS } from './icons-abilities'
import { CURRENCY_ICONS } from './icons-items'
import { TAB_BACKGROUNDS } from './ui-art'
import { textOut } from './font'
import { SW, SH } from './scenery'
import { HQ_MENU_SCENES, HQ_SCENE_LABELS, type HqMenuScene, type HqScene } from '../hero-quest-scenes'

export const BAND_H = 22
const BTN_W = 22
const BTN_H = 18
const BTN_GAP = 4

/** The Loadouts glyph, shared with the prestige shop's Loadout Slots track. */
export const LOADOUT_GLYPH: Glyph = (g, x, y) => {
    // a sword slung behind a kite shield: what the party carries into the fight
    line(g, x - 6, y + 6, x + 6, y - 6, C.steel2)
    line(g, x - 5, y + 6, x + 6, y - 5, C.steel3)
    rect(g, x - 7, y + 5, 3, 3, C.brown2)
    poly(g, [-4, -5, 4, -5, 4, 1, 0, 6, -4, 1], x, y, C.blue1)
    poly(g, [-3, -4, 3, -4, 3, 1, 0, 5, -3, 1], x, y, C.blue2)
    rect(g, x - 1, y - 4, 2, 9, C.gold2)
    rect(g, x - 3, y - 1, 7, 2, C.gold2)
}

const CLOSE: Glyph = (g, x, y) => {
    for (let i = -4; i <= 3; i++) {
        rect(g, x + i, y + i, 2, 2, C.red2)
        rect(g, x + i, y - i - 1, 2, 2, C.red2)
    }
}

/** A classic gumball machine: a glass globe of gumballs on a red stand, a coin slot and a chute. */
const GUMBALL: Glyph = (g, x, y) => {
    // the stand: a cap, a tapering body with the coin slot, and the chute's dark mouth
    rect(g, x - 1, y - 8, 3, 2, C.red2)
    poly(g, [-4, 2, 4, 2, 5, 7, -5, 7], x, y, C.red1)
    rect(g, x - 4, y + 2, 9, 1, C.red2)
    rect(g, x - 1, y + 3, 3, 1, C.gold2)
    rect(g, x - 2, y + 5, 2, 2, C.ink)
    // the globe packed with gumballs, a glint of glass left at its top left
    disc(g, x, y - 2, 4.5, C.frost)
    const balls = [C.red2, C.gold2, C.green3, C.blue2, C.pink]
    for (let by = -6; by <= 1; by += 2) {
        for (let bx = -4; bx <= 3; bx += 2) {
            const cx = bx + 1
            const cy = by + 3
            if (cx * cx + cy * cy > 13) continue
            rect(g, x + bx, y + by, 2, 2, balls[(bx + by * 3 + 40) % balls.length]!)
        }
    }
    px(g, x - 2, y - 5, C.white)
    px(g, x - 3, y - 4, C.white)
}

/** A small node tree: a root branching to the three class lines, each on to a deeper node. */
const NODE_TREE: Glyph = (g, x, y) => {
    const node = (nx: number, ny: number, c: number) => rect(g, nx - 1, ny - 1, 3, 3, c)
    const rows = [[-5, C.red2, C.red3], [0, C.blue2, C.cyan], [5, C.green2, C.green4]] as const
    for (const [dy] of rows) {
        // out of the root, along to the branch's node, and on to its leaf
        line(g, x - 5, y, x - 3, y, C.steel2)
        line(g, x - 3, y, x - 3, y + dy, C.steel2)
        line(g, x - 3, y + dy, x + 5, y + dy, C.steel2)
    }
    node(x - 6, y, C.gold2)
    for (const [dy, branch, leaf] of rows) {
        node(x, y + dy, branch)
        node(x + 5, y + dy, leaf)
    }
}

/** Fast forward: two arrowheads, the lead one lit, the way a player's clock skips ahead. */
const FAST_FORWARD: Glyph = (g, x, y) => {
    poly(g, [-7, -5, -1, 0, -7, 5], x, y, C.gold1)
    poly(g, [0, -5, 6, 0, 0, 5], x, y, C.gold2)
    line(g, x, y - 4, x + 4, y - 1, C.gold3)
}

/** A war banner: a spear-tipped pole flying a red swallowtail flag with gold crossed blades on it. */
const RAID_BANNER: Glyph = (g, x, y) => {
    // the pole and its spearhead
    rect(g, x - 6, y - 5, 2, 13, C.brown2)
    rect(g, x - 6, y - 5, 1, 13, C.brown3)
    poly(g, [-7, -5, -3, -5, -5, -9], x, y, C.gold2)
    px(g, x - 5, y - 8, C.gold3)
    // the flag, its fly cut into a swallowtail
    rect(g, x - 4, y - 5, 11, 8, C.red1)
    rect(g, x - 4, y - 5, 11, 1, C.red2)
    rect(g, x - 4, y + 2, 11, 1, C.red0)
    poly(g, [7, -3, 7, 3, 3, 3, 3, 1], x, y, CLEAR)
    // the blades crossed on it
    line(g, x - 2, y - 3, x + 2, y + 1, C.gold3)
    line(g, x + 2, y - 3, x - 2, y + 1, C.gold3)
    px(g, x, y - 1, C.white)
}

/** A cog: eight teeth round a steel wheel, a hole through its middle. */
const COG: Glyph = (g, x, y) => {
    for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4
        rect(g, Math.round(x + Math.cos(a) * 6) - 1, Math.round(y + Math.sin(a) * 6) - 1, 3, 3, C.steel2)
    }
    disc(g, x, y, 5, C.steel2)
    disc(g, x - 1, y - 1, 3, C.steel3)
    disc(g, x, y, 2, CLEAR)
}

/** A wall calendar: two rings over a red header, a page of days with one marked. */
const CALENDAR: Glyph = (g, x, y) => {
    rect(g, x - 6, y - 5, 13, 12, C.bone1)
    rect(g, x - 6, y - 5, 13, 4, C.red1)
    rect(g, x - 6, y - 5, 13, 1, C.red2)
    rect(g, x - 4, y - 7, 2, 3, C.steel3)
    rect(g, x + 3, y - 7, 2, 3, C.steel3)
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) rect(g, x - 5 + col * 3, y + row * 2, 2, 1, C.stone2)
    }
    rect(g, x + 1, y + 2, 2, 1, C.red2)
}

/** A trophy: a gold cup with a handle looped out either side, on a stem and a wooden plinth. */
export const TROPHY: Glyph = (g, x, y) => {
    // the handles, behind the cup's rim; kept within ±7, as a small glyph's buffer reaches no further right
    for (const side of [-1, 1]) {
        const hx = side < 0 ? x - 7 : x + 5
        rect(g, hx, y - 6, 3, 1, C.gold1)
        rect(g, side < 0 ? hx : hx + 2, y - 6, 1, 4, C.gold1)
        rect(g, hx, y - 3, 3, 1, C.gold1)
    }
    // the cup, narrowing to its foot, lit from the left with a shade down its right
    rect(g, x - 4, y - 6, 9, 5, C.gold2)
    rect(g, x - 3, y - 1, 7, 1, C.gold2)
    rect(g, x - 2, y, 5, 1, C.gold1)
    rect(g, x + 2, y - 6, 2, 5, C.gold1)
    rect(g, x - 4, y - 7, 9, 1, C.gold3)
    rect(g, x - 2, y - 5, 1, 3, C.white)
    // the stem and the plinth
    rect(g, x - 1, y + 1, 3, 3, C.gold1)
    rect(g, x - 1, y + 1, 1, 3, C.gold2)
    rect(g, x - 3, y + 4, 7, 1, C.gold2)
    rect(g, x - 4, y + 5, 9, 2, C.brown2)
    rect(g, x - 4, y + 5, 9, 1, C.brown3)
}

const ICONS: Readonly<Record<HqMenuScene, Glyph>> = {
    gacha: GUMBALL,
    collections: (g, x, y) => ABILITY_ICON_PARTS.book(g, x, y, C.red1, C.bone1),
    loadouts: LOADOUT_GLYPH,
    raids: RAID_BANNER,
    classes: NODE_TREE,
    // Void Shards are what a prestige pays out
    prestige: CURRENCY_ICONS.void_shards!,
    speed: FAST_FORWARD,
    milestones: TROPHY,
    calendar: CALENDAR,
    settings: COG
}

/** Where a scene's button sits on a view of the given size. */
function buttonBox(w: number, h: number, i: number): { x: number, y: number } {
    const row = HQ_MENU_SCENES.length * BTN_W + (HQ_MENU_SCENES.length - 1) * BTN_GAP
    return { x: ((w - row) >> 1) + i * (BTN_W + BTN_GAP), y: h - BAND_H + ((BAND_H - BTN_H) >> 1) }
}

/** The menu scene whose button a point on the view is over, in the view's own pixels. */
export function menuItemAt(w: number, h: number, x: number, y: number): HqMenuScene | null {
    for (let i = 0; i < HQ_MENU_SCENES.length; i++) {
        const b = buttonBox(w, h, i)
        if (x >= b.x && x < b.x + BTN_W && y >= b.y && y < b.y + BTN_H) return HQ_MENU_SCENES[i]!
    }
    return null
}

/**
 * The band along the bottom of a frame: a dark strip with a bevelled button per menu scene. The
 * open scene's button shows a close instead of its icon; a scene in `alerts` (something waiting
 * there, like today's calendar reward) gets a red dot in its corner.
 */
export function drawMenuBand(s: Surface, open: HqScene, hover: HqMenuScene | null, pressed: boolean, hidden = false, alerts: ReadonlySet<HqMenuScene> = NO_ALERTS): void {
    const y0 = s.h - BAND_H
    rect(s, 0, y0, s.w, BAND_H, C.night0)
    rect(s, 0, y0, s.w, 1, C.ink)
    rect(s, 0, y0 + 1, s.w, 1, C.night1)
    // hidden, the strip stays so the frame keeps its size, with nothing on it to press
    if (hidden) return
    for (let i = 0; i < HQ_MENU_SCENES.length; i++) {
        const id = HQ_MENU_SCENES[i]!
        const b = buttonBox(s.w, s.h, i)
        const lit = hover === id
        const down = lit && pressed ? 1 : 0
        const on = open === id
        rect(s, b.x, b.y, BTN_W, BTN_H, C.ink)
        rect(s, b.x + 1, b.y + 1 + down, BTN_W - 2, BTN_H - 2 - down, lit ? C.night3 : on ? C.night2 : C.night1)
        rect(s, b.x + 1, b.y + 1 + down, BTN_W - 2, 1, lit ? C.steel2 : C.night3)
        if (!down) rect(s, b.x + 1, b.y + BTN_H - 2, BTN_W - 2, 1, C.night0)
        glyph(s, on ? CLOSE : ICONS[id], b.x + (BTN_W >> 1), b.y + (BTN_H >> 1) + down, true)
        if (alerts.has(id) && !on) {
            rect(s, b.x + BTN_W - 6, b.y + 1 + down, 5, 5, C.ink)
            rect(s, b.x + BTN_W - 5, b.y + 2 + down, 3, 3, C.red2)
            px(s, b.x + BTN_W - 5, b.y + 2 + down, C.white)
        }
    }
}

const NO_ALERTS: ReadonlySet<HqMenuScene> = new Set()

/**
 * A scene with the band under it rather than over it, so the band covers none of the scene. The
 * scene keeps its own pixels, so anything hit-tested on it is unchanged.
 */
export class BandedFrame {
    readonly frame: Surface

    constructor(w: number, h: number) {
        this.frame = new Surface(w, h + BAND_H, 0, 0)
    }

    compose(scene: Surface, open: HqScene, hover: HqMenuScene | null, pressed: boolean, hidden = false, alerts: ReadonlySet<HqMenuScene> = NO_ALERTS): Surface {
        // the same width, so the scene's rows are the frame's first ones
        this.frame.data.set(scene.data.subarray(0, this.frame.w * (this.frame.h - BAND_H)))
        drawMenuBand(this.frame, open, hover, pressed, hidden, alerts)
        return this.frame
    }
}

/**
 * The menu scenes, drawn as their tab backgrounds (`ui-art.ts`) cut to the stage's camera, with
 * the scene's name over them. Each is a stand-in for the scene it will become.
 */
export class SceneBackdrops {
    private readonly full = new Surface(SW, SH, 0, 0)
    private readonly view: Surface

    constructor(private readonly cam: { x: number, y: number, w: number, h: number }) {
        this.view = new Surface(cam.w, cam.h, 0, 0)
    }

    render(scene: HqMenuScene, t: number, titled = true): Surface {
        // a scene with no tab background of its own (Classes) stands on plain black
        const bg = TAB_BACKGROUNDS.find(b => b.id === scene)
        this.full.clear(C.ink)
        bg?.draw(this.full, t)
        this.view.clear(C.ink)
        blit(this.view, this.full, -this.cam.x, -this.cam.y)
        if (titled) textOut(this.view, HQ_SCENE_LABELS[scene].toUpperCase(), this.cam.w >> 1, 10, C.gold2, 'big', 1, 1, 1, C.ink, -1)
        return this.view
    }
}
