// The Shop scene (the `prestige` scene, renamed 2026-10-10): every shop track as a card, two rows of
// three to a page, under the player's Gold, Gems and Void Shards and a pager. A card shows the track's icon and name, how
// far along it is (or that it has no limit), what it gives now and at the next level, and a Buy
// button with the price in its currency; a maxed track says so instead.

import { C, CLEAR } from './palette'
import { rect, ellipse, disc, type Surface } from './surface'
import { drawText, textWidth } from './font'
import { glyph, type Glyph } from './icon-kit'
import { CURRENCY_ICONS } from './icons-items'
import { ABILITY_ICON_PARTS } from './icons-abilities'
import { panel } from './ui-art'
import { plateButton, type Box } from './collections-scene'
import { LOADOUT_GLYPH } from './menu-band'
import type { SceneBackdrops } from './menu-band'

export interface ShopTrackView {
    id: string
    name: string
    level: number
    /** Null for a track with no cap. */
    maxLevel: number | null
    /** What it gives now, and at the next level; `next` is null once maxed. */
    current: string
    next: string | null
    /** The next level's price, spelled out; null once maxed. */
    cost: string | null
    currency: 'voidShards' | 'gems' | 'gold'
    affordable: boolean
}

export interface PrestigeView {
    tracks: readonly ShopTrackView[]
    voidShards: string
    gems: string
    gold: string
    /** The track whose Buy was pressed once and waits for the second press that confirms it. */
    armed?: string | null
}

const COLS = 3
/** Cards to a page: two rows of three. */
export const SHOP_PAGE_SIZE = 6
const PAGER_W = 11
const PAGER_H = 11
const CARD_W = 85
const CARD_H = 66
const GAP = 4
const CARDS_Y = 14
const ICON = 24
const BTN_H = 13
/** Where the NOW and NEXT values start, past their labels. */
const VALUE_X = 21

const MOON: Glyph = (g, x, y) => {
    // a crescent over a few stars: how long the night can run unattended
    disc(g, x, y, 7, C.gold2)
    disc(g, x + 3, y - 2, 6, CLEAR)
    ellipse(g, x - 2, y + 1, 1, 2, C.gold3)
    rect(g, x + 6, y + 4, 1, 1, C.white)
    rect(g, x + 4, y - 7, 1, 1, C.white)
}

/** A stat track's glyph: a broad arrow climbing, in the stat's colour. */
function statGlyph(g: Surface, x: number, y: number, c: number, hi: number): void {
    ABILITY_ICON_PARTS.upArrow(g, x, y, c, 16)
    ABILITY_ICON_PARTS.upArrow(g, x, y - 1, hi, 10)
}

const ICONS: Readonly<Record<string, Glyph>> = {
    offlineEfficiency: (g, x, y) => ABILITY_ICON_PARTS.hourglass(g, x, y, C.gold2),
    offlineCap: MOON,
    championSlots: CURRENCY_ICONS.seal_champion!,
    skillSlots: CURRENCY_ICONS.seal_skill!,
    artifactSlots: CURRENCY_ICONS.seal_artifact!,
    loadoutSlots: LOADOUT_GLYPH,
    traitSaveSlots: CURRENCY_ICONS.trait_gems!,
    statPwr: (g, x, y) => statGlyph(g, x, y, C.red2, C.red3),
    statDef: (g, x, y) => statGlyph(g, x, y, C.steel2, C.steel3),
    statImp: (g, x, y) => statGlyph(g, x, y, C.gold2, C.gold3),
    statVit: (g, x, y) => statGlyph(g, x, y, C.green2, C.green3)
}

const CURRENCY_GLYPH: Readonly<Record<ShopTrackView['currency'], Glyph>> = {
    voidShards: CURRENCY_ICONS.void_shards!,
    gems: CURRENCY_ICONS.gems!,
    gold: CURRENCY_ICONS.gold!
}

const BUY_PLATE = [C.green0, C.green1, C.green2] as const
const CONFIRM_PLATE = [C.gold0, C.gold1, C.gold2] as const

function cardBox(w: number, i: number): Box {
    const row = COLS * CARD_W + (COLS - 1) * GAP
    return { x: ((w - row) >> 1) + (i % COLS) * (CARD_W + GAP), y: CARDS_Y + Math.floor(i / COLS) * (CARD_H + GAP), w: CARD_W, h: CARD_H }
}

function buyBox(card: Box): Box {
    return { x: card.x + 4, y: card.y + card.h - BTN_H - 4, w: card.w - 8, h: BTN_H }
}

/** The pager's two buttons, either side of the page count in the header. */
function pagerBoxes(w: number): { prev: Box, next: Box } {
    const cx = w >> 1
    return {
        prev: { x: cx - 22, y: 2, w: PAGER_W, h: PAGER_H },
        next: { x: cx + 11, y: 2, w: PAGER_W, h: PAGER_H }
    }
}

/** The pager button a point on the view is over. */
export function shopPagerAt(w: number, x: number, y: number): 'prev' | 'next' | null {
    const b = pagerBoxes(w)
    for (const id of ['prev', 'next'] as const) {
        const box = b[id]
        if (x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h) return id
    }
    return null
}

/** The card on the open page whose Buy button a point on the view is over, among `count` cards. */
export function shopBuyAt(w: number, count: number, x: number, y: number): number | null {
    for (let i = 0; i < count; i++) {
        const b = buyBox(cardBox(w, i))
        if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return i
    }
    return null
}

/** Break a name onto at most two lines no wider than `max` px. */
function twoLines(text: string, max: number): string[] {
    const words = text.toUpperCase().split(' ')
    const lines: string[] = []
    let line = ''
    for (const word of words) {
        const next = line ? `${line} ${word}` : word
        if (line && textWidth(next) > max) {
            lines.push(line)
            line = word
        } else line = next
    }
    lines.push(line)
    return lines.slice(0, 2)
}

export class PrestigeScene {
    constructor(private readonly backdrops: SceneBackdrops) {}

    /**
     * The shop's page `page`. `hover` is the card on that page whose Buy button is under the pointer,
     * or a pager button; `busy` holds every Buy button.
     */
    render(t: number, view: PrestigeView, page: number, hover: number | 'prev' | 'next' | null, pressed: boolean, busy: boolean): Surface {
        // the Shop's tabs stand where a title would (`shop-tabs.ts`), drawn over by the canvas
        const s = this.backdrops.render('shop', t, false)
        const pages = Math.max(1, Math.ceil(view.tracks.length / SHOP_PAGE_SIZE))
        if (pages > 1) this.drawPager(s, page, pages, hover, pressed)
        // the three balances the shop spends, right-aligned: Void Shards, Gems, then Gold
        let x = s.w - 6
        for (const [amount, g] of [[view.voidShards, CURRENCY_ICONS.void_shards!], [view.gems, CURRENCY_ICONS.gems!], [view.gold, CURRENCY_ICONS.gold!]] as const) {
            const tw = textWidth(amount.toUpperCase())
            drawText(s, amount.toUpperCase(), x, 4, C.bone1, { align: 2, shadow: 1 })
            glyph(s, g, x - tw - 9, 6, true)
            x -= tw + 24
        }
        view.tracks.slice(page * SHOP_PAGE_SIZE, (page + 1) * SHOP_PAGE_SIZE)
            .forEach((track, i) => this.drawCard(s, cardBox(s.w, i), track, hover === i, pressed, busy, view.armed === track.id))
        return s
    }

    private drawPager(s: Surface, page: number, pages: number, hover: number | 'prev' | 'next' | null, pressed: boolean): void {
        const b = pagerBoxes(s.w)
        drawText(s, `${page + 1}/${pages}`, s.w >> 1, 4, C.bone1, { align: 1, shadow: 1 })
        for (const id of ['prev', 'next'] as const) {
            // the ends do not wrap: the first page has no back, the last no forward
            const enabled = id === 'prev' ? page > 0 : page < pages - 1
            plateButton(s, b[id], '', [C.night0, C.night2, C.night3], enabled, hover === id, pressed)
            // the caret a pixel above where a plate button sets its label, to sit centred on the smaller plate
            const sink = enabled && hover === id && pressed ? 1 : 0
            drawText(s, id === 'prev' ? '<' : '>', b[id].x + (PAGER_W >> 1), b[id].y + 3 + sink, enabled ? C.white : C.stone2, { align: 1, shadow: 1 })
        }
    }

    private drawCard(s: Surface, b: Box, track: ShopTrackView, lit: boolean, pressed: boolean, busy: boolean, armed: boolean): void {
        const maxed = track.next === null || track.cost === null
        const capped = track.maxLevel !== null
        panel(s, b.x, b.y, b.w, b.h, maxed ? [C.gold0, C.gold1, C.gold2] : undefined)
        // the icon on its own dark plate
        rect(s, b.x + 4, b.y + 4, ICON, ICON, C.ink)
        rect(s, b.x + 5, b.y + 5, ICON - 2, ICON - 2, C.night0)
        const g = ICONS[track.id]
        if (g) glyph(s, g, b.x + 4 + (ICON >> 1), b.y + 4 + (ICON >> 1))

        const tx = b.x + ICON + 8
        const tw = b.x + b.w - 4 - tx
        const name = twoLines(track.name, tw)
        name.forEach((line, k) => drawText(s, line, tx, b.y + 5 + k * 7, C.bone1, { shadow: 1 }))
        if (capped) {
            // how far along the track is: a bar, since the longest runs to 32 levels, and the count after it
            const levels = `${track.level}/${track.maxLevel}`
            const bw = tw - textWidth(levels) - 4
            const fill = Math.round((bw - 2) * track.level / Math.max(1, track.maxLevel!))
            rect(s, tx, b.y + 21, bw, 5, C.ink)
            rect(s, tx + 1, b.y + 22, bw - 2, 3, C.night0)
            rect(s, tx + 1, b.y + 22, fill, 3, maxed ? C.gold2 : C.purple1)
            rect(s, tx + 1, b.y + 22, fill, 1, maxed ? C.gold3 : C.purple2)
            drawText(s, levels, b.x + b.w - 4, b.y + 21, maxed ? C.gold2 : C.stone3, { align: 2, shadow: 1 })
        } else {
            // an uncapped track has no bar to fill: that it goes on, under a one-line name, and its level
            if (name.length === 1) drawText(s, 'NO LIMIT', tx, b.y + 12, C.purple2, { shadow: 1 })
            drawText(s, `LEVEL ${track.level}`, tx, b.y + 21, C.stone3, { shadow: 1 })
        }

        const lx = b.x + 4
        const vx = lx + VALUE_X
        drawText(s, 'NOW', lx, b.y + 32, C.stone3, { shadow: 1 })
        drawText(s, track.current.toUpperCase(), vx, b.y + 32, C.bone1, { shadow: 1 })
        if (maxed) {
            const bb = buyBox(b)
            drawText(s, 'MAX LEVEL', bb.x + (bb.w >> 1), bb.y + 4, C.gold2, { align: 1, shadow: 1 })
            return
        }
        drawText(s, 'NEXT', lx, b.y + 40, C.stone3, { shadow: 1 })
        drawText(s, track.next!.toUpperCase(), vx, b.y + 40, C.green3, { shadow: 1 })

        const bb = buyBox(b)
        const enabled = track.affordable && !busy
        plateButton(s, bb, '', armed ? CONFIRM_PLATE : BUY_PLATE, enabled, lit || armed, pressed)
        // the price beside the icon of what pays it, centred on the button; once pressed to spend, the confirm
        const label = `${armed ? 'CONFIRM' : 'BUY'} ${track.cost!.toUpperCase()}`
        const lw = textWidth(label) + 16
        const sink = enabled && lit && pressed ? 1 : 0
        const x0 = bb.x + ((bb.w - lw) >> 1)
        drawText(s, label, x0, bb.y + 4 + sink, enabled ? C.white : C.stone2, { shadow: 1 })
        glyph(s, CURRENCY_GLYPH[track.currency], x0 + lw - 7, bb.y + (BTN_H >> 1) + sink, true)
    }
}
