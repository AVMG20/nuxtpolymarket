// The stage's navigation: a band of icon buttons under the view, one per menu scene,
// and the backdrops those scenes draw until each has a scene of its own. Battle has no button: it
// is what shows when every scene is closed, and an open scene's button turns into its close.

import { C } from './palette'
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

const ICONS: Readonly<Record<HqMenuScene, Glyph>> = {
    gacha: GUMBALL,
    collections: (g, x, y) => ABILITY_ICON_PARTS.book(g, x, y, C.red1, C.bone1),
    loadouts: LOADOUT_GLYPH,
    classes: NODE_TREE,
    // Void Shards are what a prestige pays out
    prestige: CURRENCY_ICONS.void_shards!
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
 * open scene's button shows a close instead of its icon.
 */
export function drawMenuBand(s: Surface, open: HqScene, hover: HqMenuScene | null, pressed: boolean): void {
    const y0 = s.h - BAND_H
    rect(s, 0, y0, s.w, BAND_H, C.night0)
    rect(s, 0, y0, s.w, 1, C.ink)
    rect(s, 0, y0 + 1, s.w, 1, C.night1)
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
    }
}

/**
 * A scene with the band under it rather than over it, so the band covers none of the scene. The
 * scene keeps its own pixels, so anything hit-tested on it is unchanged.
 */
export class BandedFrame {
    readonly frame: Surface

    constructor(w: number, h: number) {
        this.frame = new Surface(w, h + BAND_H, 0, 0)
    }

    compose(scene: Surface, open: HqScene, hover: HqMenuScene | null, pressed: boolean): Surface {
        // the same width, so the scene's rows are the frame's first ones
        this.frame.data.set(scene.data.subarray(0, this.frame.w * (this.frame.h - BAND_H)))
        drawMenuBand(this.frame, open, hover, pressed)
        return this.frame
    }
}

/** A scene with no tab background of its own borrows one: Classes trains in the battle's camp. */
const BACKDROP_OF: Partial<Record<HqMenuScene, string>> = { classes: 'battle' }

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
        const bg = TAB_BACKGROUNDS.find(b => b.id === (BACKDROP_OF[scene] ?? scene))
        this.full.clear(C.night0)
        bg?.draw(this.full, t)
        this.view.clear(C.night0)
        blit(this.view, this.full, -this.cam.x, -this.cam.y)
        if (titled) textOut(this.view, HQ_SCENE_LABELS[scene].toUpperCase(), this.cam.w >> 1, 10, C.gold2, 'big', 1, 1, 1, C.ink, -1)
        return this.view
    }
}
